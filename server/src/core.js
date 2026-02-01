/**
 * MESS Exchange Server - Core Business Logic
 * Shared across all deployment modes (Worker, Express, etc.)
 * 
 * This module is runtime-agnostic and works in both Node.js and Workers.
 */

// ============ Helpers ============

export function generateRef() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const seq = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${date}-${seq}`;
}

export function generateApiKey(exchangeId) {
  const random = crypto.randomUUID().replace(/-/g, '');
  return `mess_${exchangeId}_${random}`;
}

export async function hashApiKey(key) {
  // Works in both Node.js and Workers
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(key);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(hash)));
  } else {
    // Node.js fallback
    const { createHash } = await import('crypto');
    return createHash('sha256').update(key).digest('base64');
  }
}

export function todayPath() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

export function parseApiKey(apiKey) {
  const parts = apiKey.split('_');
  if (parts.length < 3 || parts[0] !== 'mess') {
    return { valid: false, exchangeId: null };
  }
  return { valid: true, exchangeId: parts[1] };
}

// ============ Handler Factory ============

/**
 * Create API handlers bound to a storage backend
 * @param {Object} storage - Storage implementation (filesystem, S3, or R2)
 */
export function createHandlers(storage) {
  
  // ---- Storage Operations ----
  
  async function writeEvent(event) {
    const path = `events/exchange=${event.exchange_id}/${todayPath()}/${event.event_id}.jsonl`;
    await storage.put(path, JSON.stringify(event) + '\n');
    return path;
  }

  async function getExecutor(exchangeId, executorId) {
    const path = `executors/exchange=${exchangeId}/${executorId}.json`;
    const data = await storage.get(path);
    return data ? JSON.parse(data) : null;
  }

  async function putExecutor(exchangeId, executor) {
    const path = `executors/exchange=${exchangeId}/${executor.id}.json`;
    await storage.put(path, JSON.stringify(executor, null, 2));
  }

  async function listExecutors(exchangeId) {
    const prefix = `executors/exchange=${exchangeId}/`;
    const files = await storage.list(prefix);
    const executors = [];
    for (const file of files) {
      const data = await storage.get(file);
      if (data) {
        try {
          executors.push(JSON.parse(data));
        } catch (e) {
          console.error(`Failed to parse executor ${file}:`, e);
        }
      }
    }
    return executors;
  }

  // ---- Auth ----
  
  async function authenticate(apiKey) {
    const { valid, exchangeId } = parseApiKey(apiKey);
    if (!valid) return null;
    
    const keyHash = await hashApiKey(apiKey);
    const executors = await listExecutors(exchangeId);
    
    for (const executor of executors) {
      if (executor.api_key_hash === keyHash) {
        return { ...executor, exchange_id: exchangeId };
      }
    }
    
    return null;
  }

  // ---- Thread State ----
  
  async function getThreadEvents(exchangeId, ref) {
    const prefix = `events/exchange=${exchangeId}/`;
    const files = await storage.list(prefix);
    
    const events = [];
    for (const file of files) {
      const data = await storage.get(file);
      if (data) {
        for (const line of data.trim().split('\n')) {
          if (line) {
            try {
              const event = JSON.parse(line);
              if (event.thread_ref === ref) {
                events.push(event);
              }
            } catch (e) {
              // Skip malformed lines
            }
          }
        }
      }
    }
    
    return events.sort((a, b) => new Date(a.ts) - new Date(b.ts));
  }

  function computeThreadState(events) {
    if (events.length === 0) return null;
    
    const state = {
      ref: null,
      status: 'pending',
      intent: '',
      requestor_id: '',
      executor_id: null,
      priority: 'normal',
      created_at: null,
      updated_at: null,
      messages: [],
    };
    
    for (const event of events) {
      state.updated_at = event.ts;
      
      switch (event.event_type) {
        case 'thread_created':
          state.ref = event.thread_ref;
          state.intent = event.payload.intent;
          state.requestor_id = event.payload.requestor_id;
          state.priority = event.payload.priority || 'normal';
          state.created_at = event.ts;
          break;
        case 'status_changed':
          state.status = event.payload.new_status;
          if (event.payload.executor_id) {
            state.executor_id = event.payload.executor_id;
          }
          break;
        case 'message_added':
          state.messages.push({
            from: event.actor_id,
            ts: event.ts,
            mess: event.payload.mess,
          });
          break;
      }
    }
    
    return state;
  }

  async function listThreads(exchangeId, status = null) {
    const prefix = `events/exchange=${exchangeId}/`;
    const files = await storage.list(prefix);
    
    const threadEvents = new Map();
    
    for (const file of files) {
      const data = await storage.get(file);
      if (data) {
        for (const line of data.trim().split('\n')) {
          if (line) {
            try {
              const event = JSON.parse(line);
              if (event.thread_ref) {
                if (!threadEvents.has(event.thread_ref)) {
                  threadEvents.set(event.thread_ref, []);
                }
                threadEvents.get(event.thread_ref).push(event);
              }
            } catch (e) {
              // Skip malformed events
            }
          }
        }
      }
    }
    
    const threads = [];
    for (const [ref, events] of threadEvents) {
      events.sort((a, b) => new Date(a.ts) - new Date(b.ts));
      const state = computeThreadState(events);
      if (state && (!status || state.status === status)) {
        threads.push(state);
      }
    }
    
    threads.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    return threads;
  }

  // ---- Notifications ----
  
  async function dispatchNotifications(exchangeId, thread, eventType) {
    const executors = await listExecutors(exchangeId);
    
    for (const executor of executors) {
      // Don't notify requestor of their own request
      if (executor.id === thread.requestor_id && eventType === 'thread_created') {
        continue;
      }
      
      // Check quiet hours
      if (executor.preferences?.quiet_hours?.enabled && thread.priority !== 'urgent') {
        const now = new Date();
        const hours = now.getHours();
        const start = parseInt(executor.preferences.quiet_hours.start?.split(':')[0] || '22');
        const end = parseInt(executor.preferences.quiet_hours.end?.split(':')[0] || '7');
        
        if (start > end) {
          if (hours >= start || hours < end) continue;
        } else {
          if (hours >= start && hours < end) continue;
        }
      }
      
      // Check priority threshold
      const priorities = ['background', 'normal', 'elevated', 'urgent'];
      const minPriority = executor.preferences?.min_priority || 'normal';
      if (priorities.indexOf(thread.priority) < priorities.indexOf(minPriority)) {
        continue;
      }
      
      for (const channel of executor.notifications || []) {
        try {
          await sendNotification(channel, thread, eventType);
        } catch (e) {
          console.error(`Notification failed for ${executor.id}:`, e.message);
        }
      }
    }
  }

  async function sendNotification(channel, thread, eventType) {
    const title = eventType === 'thread_created' 
      ? `🆕 New MESS Request`
      : `📬 MESS Update: ${thread.status}`;
    
    const body = `${thread.intent}\n\nRef: ${thread.ref}\nPriority: ${thread.priority}`;
    
    switch (channel.type) {
      case 'ntfy':
        await fetch(`${channel.server || 'https://ntfy.sh'}/${channel.topic}`, {
          method: 'POST',
          headers: { 'Title': title, 'Priority': thread.priority === 'urgent' ? '5' : '3' },
          body: body,
        });
        break;
        
      case 'slack':
      case 'google_chat':
        await fetch(channel.webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `*${title}*\n${body}` }),
        });
        break;
        
      case 'webhook':
        await fetch(channel.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, body, thread, event_type: eventType }),
        });
        break;
    }
  }

  // ---- API Handlers ----
  // Return { data, status } or { error, status }
  
  async function handleRegister(exchangeId, body) {
    if (!body.executor_id) {
      return { error: 'executor_id required', status: 400 };
    }
    
    const existing = await getExecutor(exchangeId, body.executor_id);
    if (existing) {
      return { error: 'Executor already registered', status: 409 };
    }
    
    const apiKey = generateApiKey(exchangeId);
    const keyHash = await hashApiKey(apiKey);
    
    const executor = {
      id: body.executor_id,
      display_name: body.display_name || body.executor_id,
      capabilities: body.capabilities || [],
      notifications: body.notifications || [],
      preferences: body.preferences || {},
      api_key_hash: keyHash,
      created_at: new Date().toISOString(),
      last_seen: new Date().toISOString(),
    };
    
    await putExecutor(exchangeId, executor);
    
    await writeEvent({
      event_id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      exchange_id: exchangeId,
      thread_ref: null,
      event_type: 'executor_registered',
      actor_id: body.executor_id,
      payload: { display_name: executor.display_name, capabilities: executor.capabilities },
    });
    
    return {
      data: {
        executor_id: executor.id,
        api_key: apiKey,
        message: 'Save this API key - it cannot be retrieved again.',
      },
      status: 201,
    };
  }

  async function handleListRequests(auth, query = {}) {
    const threads = await listThreads(auth.exchange_id, query.status);
    const summary = threads.map(t => ({
      ref: t.ref,
      status: t.status,
      intent: t.intent,
      requestor_id: t.requestor_id,
      executor_id: t.executor_id,
      priority: t.priority,
      created_at: t.created_at,
      updated_at: t.updated_at,
    }));
    
    return { data: { threads: summary }, status: 200 };
  }

  async function handleGetRequest(auth, ref) {
    const events = await getThreadEvents(auth.exchange_id, ref);
    const thread = computeThreadState(events);
    
    if (!thread) {
      return { error: 'Thread not found', status: 404 };
    }
    
    return { data: { thread }, status: 200 };
  }

  async function handleCreateRequest(auth, body) {
    if (!body.intent) {
      return { error: 'intent required', status: 400 };
    }
    
    const ref = generateRef();
    const now = new Date().toISOString();
    
    await writeEvent({
      event_id: crypto.randomUUID(),
      ts: now,
      exchange_id: auth.exchange_id,
      thread_ref: ref,
      event_type: 'thread_created',
      actor_id: auth.id,
      payload: {
        intent: body.intent,
        context: body.context || [],
        priority: body.priority || 'normal',
        requestor_id: auth.id,
        response_hint: body.response_hint || [],
      },
    });
    
    await writeEvent({
      event_id: crypto.randomUUID(),
      ts: now,
      exchange_id: auth.exchange_id,
      thread_ref: ref,
      event_type: 'message_added',
      actor_id: auth.id,
      payload: {
        mess: [{ request: { intent: body.intent, context: body.context || [], response_hint: body.response_hint || [] } }],
      },
    });
    
    const thread = { ref, intent: body.intent, priority: body.priority || 'normal', status: 'pending', requestor_id: auth.id };
    await dispatchNotifications(auth.exchange_id, thread, 'thread_created');
    
    return { data: { ref, status: 'pending' }, status: 201 };
  }

  async function handleUpdateRequest(auth, ref, body) {
    const events = await getThreadEvents(auth.exchange_id, ref);
    const thread = computeThreadState(events);
    
    if (!thread) {
      return { error: 'Thread not found', status: 404 };
    }
    
    const now = new Date().toISOString();
    
    if (body.status && body.status !== thread.status) {
      await writeEvent({
        event_id: crypto.randomUUID(),
        ts: now,
        exchange_id: auth.exchange_id,
        thread_ref: ref,
        event_type: 'status_changed',
        actor_id: auth.id,
        payload: {
          old_status: thread.status,
          new_status: body.status,
          executor_id: body.status === 'claimed' ? auth.id : thread.executor_id,
          message: body.message,
        },
      });
    }
    
    if (body.mess) {
      await writeEvent({
        event_id: crypto.randomUUID(),
        ts: now,
        exchange_id: auth.exchange_id,
        thread_ref: ref,
        event_type: 'message_added',
        actor_id: auth.id,
        payload: { mess: body.mess },
      });
    }
    
    if (body.status && body.status !== thread.status) {
      const updated = { ...thread, status: body.status };
      await dispatchNotifications(auth.exchange_id, updated, 'status_changed');
    }
    
    return { data: { ref, status: body.status || thread.status }, status: 200 };
  }

  async function handleListExecutors(auth) {
    const executors = await listExecutors(auth.exchange_id);
    
    const safe = executors.map(e => ({
      id: e.id,
      display_name: e.display_name,
      capabilities: e.capabilities,
      last_seen: e.last_seen,
      created_at: e.created_at,
    }));
    
    return { data: { executors: safe }, status: 200 };
  }

  async function handleUpdateExecutor(auth, executorId, body) {
    if (auth.id !== executorId) {
      return { error: 'Can only update your own profile', status: 403 };
    }
    
    const executor = await getExecutor(auth.exchange_id, executorId);
    if (!executor) {
      return { error: 'Executor not found', status: 404 };
    }
    
    if (body.display_name) executor.display_name = body.display_name;
    if (body.capabilities) executor.capabilities = body.capabilities;
    if (body.notifications) executor.notifications = body.notifications;
    if (body.preferences) executor.preferences = body.preferences;
    executor.last_seen = new Date().toISOString();
    
    await putExecutor(auth.exchange_id, executor);
    
    return { data: { executor_id: executor.id, updated: true }, status: 200 };
  }

  return {
    authenticate,
    handleRegister,
    handleListRequests,
    handleGetRequest,
    handleCreateRequest,
    handleUpdateRequest,
    handleListExecutors,
    handleUpdateExecutor,
  };
}
