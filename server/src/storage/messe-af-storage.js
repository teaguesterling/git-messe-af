/**
 * MESSE-AF Storage Backend
 *
 * Wraps a base storage backend to store data in MESSE-AF format.
 * Uses Hive-style partitioning: state=received/, state=executing/, etc.
 *
 * This storage backend intercepts the event-sourced storage calls
 * and converts them to/from MESSE-AF format transparently.
 */

import {
  parseThread,
  parseThreadV1,
  serializeThread,
  eventsToMesseAf,
  messeAfToEvents,
  getFolderForStatus,
  STATUS_FOLDERS
} from '../messe-af/index.js';

/**
 * MESSE-AF Storage Adapter
 * Implements the storage interface but stores in MESSE-AF format
 */
export class MesseAfStorage {
  /**
   * @param {Object} baseStorage - Underlying storage (filesystem, S3, etc.)
   * @param {Object} options
   * @param {number} options.version - MESSE-AF version (1 or 2)
   * @param {Object} options.blobStore - Optional separate blob storage
   */
  constructor(baseStorage, options = {}) {
    this.storage = baseStorage;
    this.version = options.version || 2;
    this.blobStore = options.blobStore || baseStorage;
    this.type = `messe-af-v${this.version}`;
  }

  /**
   * Store data - intercepts event writes and converts to MESSE-AF
   */
  async put(key, data) {
    // Check if this is an event write
    if (key.startsWith('events/')) {
      return this._putEvent(key, data);
    }

    // Check if this is an executor write
    if (key.startsWith('executors/')) {
      return this.storage.put(key, data);
    }

    // Pass through other writes
    return this.storage.put(key, data);
  }

  /**
   * Get data - intercepts event reads and converts from MESSE-AF
   */
  async get(key) {
    // Check if this is an event read
    if (key.startsWith('events/')) {
      return this._getEvent(key);
    }

    return this.storage.get(key);
  }

  /**
   * List files
   */
  async list(prefix) {
    // For event listing, we need to scan MESSE-AF threads
    if (prefix.startsWith('events/')) {
      return this._listEvents(prefix);
    }

    return this.storage.list(prefix);
  }

  /**
   * Delete data
   */
  async delete(key) {
    return this.storage.delete(key);
  }

  // ============ Internal Methods ============

  /**
   * Handle event write - update or create MESSE-AF thread
   */
  async _putEvent(key, data) {
    const event = JSON.parse(data.trim());
    const exchangeId = event.exchange_id;
    const ref = event.thread_ref;

    if (!ref) {
      // Non-thread event (e.g., executor_registered)
      return this.storage.put(key, data);
    }

    // Find existing thread or create new one
    const existingThread = await this._findThread(exchangeId, ref);

    if (existingThread) {
      // Update existing thread
      return this._updateThread(exchangeId, existingThread, event);
    } else if (event.event_type === 'thread_created') {
      // Create new thread
      return this._createThread(exchangeId, event);
    } else {
      // Orphan event - store as regular event
      return this.storage.put(key, data);
    }
  }

  /**
   * Create new MESSE-AF thread
   */
  async _createThread(exchangeId, event) {
    const ref = event.thread_ref;
    const now = event.ts;

    const envelope = {
      ref,
      requestor: event.payload.requestor_id || event.actor_id,
      executor: null,
      status: 'pending',
      created: now,
      updated: now,
      intent: event.payload.intent,
      priority: event.payload.priority || 'normal',
      history: [{ action: 'created', at: now, by: event.actor_id }]
    };

    const messages = [
      {
        from: envelope.requestor,
        received: now,
        channel: 'api',
        MESS: [
          { v: '1.0.0' },
          {
            request: {
              intent: event.payload.intent,
              context: event.payload.context || [],
              response_hint: event.payload.response_hint || []
            }
          }
        ]
      },
      {
        from: 'exchange',
        received: now,
        MESS: [{ ack: { re: 'last', ref } }]
      }
    ];

    const folder = getFolderForStatus(envelope.status);
    const basePath = `exchange=${exchangeId}/state=${folder}`;

    if (this.version === 2) {
      const files = serializeThread(envelope, messages);
      const dirPath = `${basePath}/${ref}`;

      for (const file of files) {
        const filePath = `${dirPath}/${file.name}`;
        if (file.binary) {
          await this.blobStore.put(filePath, Buffer.from(file.content, 'base64'));
        } else {
          await this.storage.put(filePath, file.content);
        }
      }
    } else {
      // v1 flat file
      const { serializeThreadV1 } = await import('../messe-af/serializer.js');
      const content = serializeThreadV1(envelope, messages);
      await this.storage.put(`${basePath}/${ref}.messe-af.yaml`, content);
    }
  }

  /**
   * Update existing MESSE-AF thread
   */
  async _updateThread(exchangeId, existing, event) {
    const { envelope, messages, attachments, folder, format, path } = existing;
    const now = event.ts;

    // Update envelope
    envelope.updated = now;

    switch (event.event_type) {
      case 'status_changed':
        envelope.status = event.payload.new_status;
        if (event.payload.executor_id) {
          envelope.executor = event.payload.executor_id;
        }
        envelope.history.push({
          action: event.payload.new_status,
          at: now,
          by: event.actor_id
        });
        // Add status message
        messages.push({
          from: event.actor_id,
          received: now,
          channel: 'api',
          MESS: [{
            status: {
              re: envelope.ref,
              code: event.payload.new_status,
              ...(event.payload.message && { message: event.payload.message })
            }
          }]
        });
        break;

      case 'message_added':
        messages.push({
          from: event.actor_id,
          received: now,
          channel: 'api',
          MESS: event.payload.mess
        });
        break;
    }

    const newFolder = getFolderForStatus(envelope.status);
    const basePath = `exchange=${exchangeId}/state=${newFolder}`;
    const ref = envelope.ref;

    // Write updated thread (always use v2 format)
    const files = serializeThread(envelope, messages, attachments);
    const dirPath = `${basePath}/${ref}`;

    for (const file of files) {
      const filePath = `${dirPath}/${file.name}`;
      if (file.binary) {
        await this.blobStore.put(filePath, Buffer.from(file.content, 'base64'));
      } else {
        await this.storage.put(filePath, file.content);
      }
    }

    // If folder changed, delete from old location
    if (folder !== newFolder) {
      const oldBasePath = `exchange=${exchangeId}/state=${folder}`;
      if (format === 'v2') {
        // Delete old directory contents
        const oldFiles = await this.storage.list(`${oldBasePath}/${ref}/`);
        for (const f of oldFiles) {
          await this.storage.delete(f);
        }
      } else {
        // Delete old v1 file
        await this.storage.delete(`${oldBasePath}/${ref}.messe-af.yaml`);
      }
    }
  }

  /**
   * Find thread by ref in any folder
   */
  async _findThread(exchangeId, ref) {
    for (const folderName of ['received', 'executing', 'finished', 'canceled']) {
      const basePath = `exchange=${exchangeId}/state=${folderName}`;

      // Check for v2 directory format
      const dirPath = `${basePath}/${ref}`;
      const dirFiles = await this.storage.list(`${dirPath}/`);

      if (dirFiles.length > 0) {
        const files = [];
        for (const filePath of dirFiles) {
          const content = await this.storage.get(filePath);
          if (content) {
            const fileName = filePath.split('/').pop();
            files.push({ name: fileName, content });
          }
        }

        if (files.length > 0) {
          const parsed = parseThread(files);
          return {
            ...parsed,
            folder: folderName,
            format: 'v2',
            path: dirPath
          };
        }
      }

      // Check for v1 flat file format
      const filePath = `${basePath}/${ref}.messe-af.yaml`;
      const content = await this.storage.get(filePath);

      if (content) {
        const parsed = parseThreadV1(content);
        return {
          ...parsed,
          folder: folderName,
          format: 'v1',
          path: filePath
        };
      }
    }

    return null;
  }

  /**
   * Get event - reconstruct from MESSE-AF
   */
  async _getEvent(key) {
    // Parse key to extract exchange ID and look for thread ref
    const match = key.match(/events\/exchange=([^/]+)\//);
    if (!match) return null;

    const exchangeId = match[1];

    // Read the event file if it exists (orphan events)
    const content = await this.storage.get(key);
    if (content) return content;

    // Otherwise we'd need to reconstruct from MESSE-AF
    // This is complex and rarely needed - return null
    return null;
  }

  /**
   * List events - scan MESSE-AF threads and generate virtual event paths
   */
  async _listEvents(prefix) {
    const match = prefix.match(/events\/exchange=([^/]+)/);
    if (!match) return [];

    const exchangeId = match[1];
    const eventFiles = [];

    // Scan all MESSE-AF folders
    for (const folderName of ['received', 'executing', 'finished', 'canceled']) {
      const basePath = `exchange=${exchangeId}/state=${folderName}`;
      const entries = await this.storage.list(`${basePath}/`);

      for (const entry of entries) {
        // Extract ref from path
        const parts = entry.split('/');
        let ref;

        if (entry.endsWith('.messe-af.yaml')) {
          // v1 format: .../ref.messe-af.yaml
          ref = parts[parts.length - 1].replace('.messe-af.yaml', '');
        } else {
          // v2 format: .../ref/xxx-ref.messe-af.yaml
          ref = parts[parts.length - 2];
        }

        if (ref && !eventFiles.some(f => f.includes(ref))) {
          // Generate virtual event file path
          const date = ref.split('-').slice(0, 3).join('/');
          eventFiles.push(`events/exchange=${exchangeId}/${date}/${ref}.jsonl`);
        }
      }
    }

    // Also include any orphan event files
    const orphanFiles = await this.storage.list(prefix);
    eventFiles.push(...orphanFiles);

    return [...new Set(eventFiles)];
  }

  /**
   * Get all threads for an exchange (for listing)
   */
  async getThreads(exchangeId, status = null) {
    const threads = [];

    const folders = status
      ? [getFolderForStatus(status)]
      : ['received', 'executing', 'finished', 'canceled'];

    for (const folderName of folders) {
      const basePath = `exchange=${exchangeId}/state=${folderName}`;
      const entries = await this.storage.list(`${basePath}/`);

      const seen = new Set();

      for (const entry of entries) {
        // Extract ref from path
        const parts = entry.split('/');
        let ref;

        if (entry.endsWith('.messe-af.yaml')) {
          // v1 or v2 yaml file
          const fileName = parts[parts.length - 1];
          if (fileName.match(/^\d{3}-/)) {
            // v2 format: .../ref/000-ref.messe-af.yaml
            ref = parts[parts.length - 2];
          } else {
            // v1 format: .../ref.messe-af.yaml
            ref = fileName.replace('.messe-af.yaml', '');
          }
        } else if (!entry.includes('.')) {
          // Directory entry in v2 format
          ref = parts[parts.length - 1];
        }

        if (ref && !seen.has(ref)) {
          seen.add(ref);
          const thread = await this._findThread(exchangeId, ref);
          if (thread) {
            threads.push({
              ref: thread.envelope.ref,
              status: thread.envelope.status,
              intent: thread.envelope.intent,
              requestor_id: thread.envelope.requestor,
              executor_id: thread.envelope.executor,
              priority: thread.envelope.priority,
              created_at: thread.envelope.created,
              updated_at: thread.envelope.updated,
              messages: thread.messages
            });
          }
        }
      }
    }

    return threads.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  }

  /**
   * Get thread events (reconstructed from MESSE-AF)
   */
  async getThreadEvents(exchangeId, ref) {
    const thread = await this._findThread(exchangeId, ref);
    if (!thread) return [];

    return messeAfToEvents(thread.envelope, thread.messages, exchangeId);
  }

  /**
   * Import a MESSE-AF thread
   */
  async importThread(exchangeId, files) {
    const parsed = Array.isArray(files) ? parseThread(files) : parseThreadV1(files);
    const { envelope, messages, attachments } = parsed;

    const folder = getFolderForStatus(envelope.status);
    const basePath = `exchange=${exchangeId}/state=${folder}`;
    const ref = envelope.ref;

    if (this.version === 2 || Array.isArray(files)) {
      const serialized = serializeThread(envelope, messages, attachments);
      const dirPath = `${basePath}/${ref}`;

      for (const file of serialized) {
        const filePath = `${dirPath}/${file.name}`;
        if (file.binary) {
          await this.blobStore.put(filePath, Buffer.from(file.content, 'base64'));
        } else {
          await this.storage.put(filePath, file.content);
        }
      }
    } else {
      const { serializeThreadV1 } = await import('../messe-af/serializer.js');
      const content = serializeThreadV1(envelope, messages);
      await this.storage.put(`${basePath}/${ref}.messe-af.yaml`, content);
    }

    return { ref, status: envelope.status };
  }

  /**
   * Export a thread to MESSE-AF format
   */
  async exportThread(exchangeId, ref, format = 'v2') {
    const thread = await this._findThread(exchangeId, ref);
    if (!thread) return null;

    if (format === 'v2') {
      return serializeThread(thread.envelope, thread.messages, thread.attachments);
    } else {
      const { serializeThreadV1 } = await import('../messe-af/serializer.js');
      return serializeThreadV1(thread.envelope, thread.messages);
    }
  }
}
