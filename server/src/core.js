/**
 * MESS Exchange Server - Core Business Logic
 * Shared across all deployment modes (Worker, Express, etc.)
 * 
 * This module is runtime-agnostic and works in both Node.js and Workers.
 */

// ============ Helpers ============

/**
 * Expand {{variable}} templates in strings and objects
 * Supports nested access like {{thread.intent}}
 */
export function templateExpand(template, context) {
  if (typeof template === 'string') {
    return template.replace(/\{\{([\w.]+)\}\}/g, (match, path) => {
      const keys = path.split('.');
      let value = context;
      for (const key of keys) {
        if (value === undefined || value === null) return '';
        value = value[key];
      }
      if (value === undefined || value === null) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    });
  }
  if (Array.isArray(template)) {
    return template.map(item => templateExpand(item, context));
  }
  if (typeof template === 'object' && template !== null) {
    const result = {};
    for (const [key, value] of Object.entries(template)) {
      result[key] = templateExpand(value, context);
    }
    return result;
  }
  return template;
}

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

/**
 * Simple YAML parser for capability format
 * Handles basic key: value pairs and arrays
 */
export function parseSimpleYaml(text) {
  const result = {};
  const lines = text.trim().split('\n');
  let currentKey = null;
  let currentArray = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Array item
    if (trimmed.startsWith('- ')) {
      if (currentArray !== null) {
        currentArray.push(trimmed.slice(2).trim());
      }
      continue;
    }

    // Key: value pair
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();

      if (value === '' || value.startsWith('[')) {
        // Start of array or inline array
        if (value.startsWith('[') && value.endsWith(']')) {
          // Inline array: [a, b, c]
          result[key] = value.slice(1, -1).split(',').map(s => s.trim());
        } else {
          // Multi-line array
          currentKey = key;
          currentArray = [];
          result[key] = currentArray;
        }
      } else {
        result[key] = value;
        currentKey = null;
        currentArray = null;
      }
    }
  }

  return result;
}

/**
 * Search MESS content for an attachment with the given filename
 * Returns base64 content if found
 */
export function findAttachmentInMess(mess, filename) {
  if (!Array.isArray(mess)) return null;

  for (const item of mess) {
    // Check response content
    if (item.response?.content) {
      for (const content of item.response.content) {
        if (content.image?.data && content.image.name === filename) {
          return content.image.data;
        }
        if (content.attachment?.data && content.attachment.name === filename) {
          return content.attachment.data;
        }
      }
    }

    // Check request attachments
    if (item.request?.attachments) {
      for (const att of item.request.attachments) {
        if (att.data && att.name === filename) {
          return att.data;
        }
      }
    }
  }

  return null;
}

// ============ Google OAuth Helper ============

/**
 * Get Google OAuth access token using refresh token
 * Works in both Node.js and Cloudflare Workers (uses fetch)
 */
async function getGoogleAccessToken(hook) {
  const params = new URLSearchParams({
    client_id: hook.client_id,
    client_secret: hook.client_secret,
    refresh_token: hook.refresh_token,
    grant_type: 'refresh_token',
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`Google token refresh failed: ${response.status}`);
  }

  const data = await response.json();
  return data.access_token;
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

  // ---- Webhooks / Hooks ----
  
  /**
   * Execute lifecycle hooks for an event
   * 
   * Hook types:
   * - webhook: POST to any URL with templated body
   * - ifttt: Trigger IFTTT Webhooks (easy path to Google Keep, etc.)
   * - google_tasks: Add to Google Tasks via API (requires OAuth)
   * - zapier: Trigger Zapier webhook
   * 
   * Template variables available:
   * - {{ref}}, {{intent}}, {{status}}, {{priority}}
   * - {{requestor_id}}, {{executor_id}}
   * - {{created_at}}, {{updated_at}}
   * - {{event}} - the event type (created, claimed, completed, etc.)
   */
  async function executeHooks(hookName, thread, executor, extra = {}) {
    const hooks = executor.hooks?.[hookName] || [];
    
    // Build template context
    const context = {
      ...thread,
      event: hookName.replace('on_request_', ''),
      executor_name: executor.display_name,
      ...extra,
    };
    
    const results = [];
    
    for (const hook of hooks) {
      try {
        const result = await executeHook(hook, context);
        results.push({ hook: hook.type, success: true, result });
      } catch (e) {
        console.error(`Hook ${hook.type} failed for ${executor.id}:`, e.message);
        results.push({ hook: hook.type, success: false, error: e.message });
      }
    }
    
    return results;
  }
  
  async function executeHook(hook, context) {
    switch (hook.type) {
      case 'webhook': {
        const url = templateExpand(hook.url, context);
        const headers = templateExpand(hook.headers || {}, context);
        const body = templateExpand(hook.body || {}, context);
        
        const response = await fetch(url, {
          method: hook.method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: JSON.stringify(body),
        });
        
        // Try to extract external ID from response for bidirectional sync
        let externalId = null;
        try {
          const data = await response.json();
          externalId = data.id || data.task_id || data.item_id || null;
        } catch (e) {
          // Response might not be JSON
        }
        
        return { status: response.status, external_id: externalId };
      }
      
      case 'ifttt': {
        // IFTTT Webhooks: https://ifttt.com/maker_webhooks
        // Use this to trigger "Add to Google Keep", "Create iOS Reminder", etc.
        const eventName = hook.event || 'mess_request';
        const key = hook.key; // IFTTT webhook key
        
        if (!key) throw new Error('IFTTT hook requires "key"');
        
        const url = `https://maker.ifttt.com/trigger/${eventName}/with/key/${key}`;
        
        // IFTTT accepts value1, value2, value3
        const body = {
          value1: templateExpand(hook.value1 || '{{intent}}', context),
          value2: templateExpand(hook.value2 || '{{ref}}', context),
          value3: templateExpand(hook.value3 || '{{priority}}', context),
        };
        
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        
        return { status: response.status };
      }
      
      case 'zapier': {
        // Zapier Webhooks
        const url = hook.webhook_url;
        if (!url) throw new Error('Zapier hook requires "webhook_url"');
        
        const body = templateExpand(hook.body || {
          intent: '{{intent}}',
          ref: '{{ref}}',
          priority: '{{priority}}',
          status: '{{status}}',
          event: '{{event}}',
        }, context);
        
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        
        return { status: response.status };
      }
      
      case 'home_assistant': {
        // Home Assistant webhook or REST API
        const url = hook.url || `${hook.base_url}/api/webhook/${hook.webhook_id}`;
        const headers = {};
        
        if (hook.token) {
          headers['Authorization'] = `Bearer ${hook.token}`;
        }
        
        const body = templateExpand(hook.body || {
          action: 'mess_{{event}}',
          intent: '{{intent}}',
          ref: '{{ref}}',
          priority: '{{priority}}',
        }, context);
        
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(body),
        });
        
        return { status: response.status };
      }
      
      case 'todoist': {
        // Todoist REST API
        const token = hook.token;
        if (!token) throw new Error('Todoist hook requires "token"');
        
        const body = {
          content: templateExpand(hook.content || 'MESS: {{intent}}', context),
          description: templateExpand(hook.description || 'Ref: {{ref}}', context),
          priority: hook.priority_map?.[context.priority] || 1,
          labels: hook.labels || [],
        };
        
        if (hook.project_id) body.project_id = hook.project_id;
        if (hook.due_string) body.due_string = templateExpand(hook.due_string, context);
        
        const response = await fetch('https://api.todoist.com/rest/v2/tasks', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
        
        const data = await response.json();
        return { status: response.status, external_id: data.id };
      }
      
      case 'linear': {
        // Linear GraphQL API
        const token = hook.token;
        if (!token) throw new Error('Linear hook requires "token"');
        
        const title = templateExpand(hook.title || 'MESS: {{intent}}', context);
        const description = templateExpand(hook.description || 'Ref: {{ref}}\nPriority: {{priority}}', context);
        
        const query = `
          mutation CreateIssue($title: String!, $description: String, $teamId: String!) {
            issueCreate(input: { title: $title, description: $description, teamId: $teamId }) {
              issue { id identifier url }
            }
          }
        `;
        
        const response = await fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token,
          },
          body: JSON.stringify({
            query,
            variables: { title, description, teamId: hook.team_id },
          }),
        });
        
        const data = await response.json();
        return {
          status: response.status,
          external_id: data.data?.issueCreate?.issue?.identifier,
          url: data.data?.issueCreate?.issue?.url,
        };
      }

      case 'google_tasks': {
        // Google Tasks API - requires OAuth refresh token
        if (!hook.client_id || !hook.client_secret || !hook.refresh_token) {
          throw new Error('Google Tasks hook requires client_id, client_secret, refresh_token');
        }

        const accessToken = await getGoogleAccessToken(hook);
        const tasklist = hook.tasklist || '@default';
        const action = hook.action || 'create';

        if (action === 'create') {
          const title = templateExpand(hook.title || 'MESS: {{intent}}', context);
          const notes = templateExpand(hook.notes || 'Ref: {{ref}}\nPriority: {{priority}}', context);

          const body = { title, notes };
          if (hook.due) {
            body.due = templateExpand(hook.due, context);
          }

          const response = await fetch(
            `https://tasks.googleapis.com/tasks/v1/lists/${tasklist}/tasks`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(body),
            }
          );

          if (!response.ok) {
            const text = await response.text();
            throw new Error(`Google Tasks API error: ${response.status} ${text}`);
          }

          const data = await response.json();
          return { status: response.status, external_id: data.id };

        } else if (action === 'complete') {
          const taskId = templateExpand(hook.task_id, context);
          if (!taskId) {
            throw new Error('task_id required for complete action');
          }

          const response = await fetch(
            `https://tasks.googleapis.com/tasks/v1/lists/${tasklist}/tasks/${taskId}`,
            {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ status: 'completed' }),
            }
          );

          return { status: response.status, completed: true };
        }

        throw new Error(`Unknown google_tasks action: ${action}`);
      }

      default:
        console.warn(`Unknown hook type: ${hook.type}`);
        return { skipped: true };
    }
  }
  
  /**
   * Dispatch hooks to all relevant executors
   */
  async function dispatchHooks(exchangeId, hookName, thread, extra = {}) {
    const executors = await listExecutors(exchangeId);
    
    for (const executor of executors) {
      // Skip executors without hooks for this event
      if (!executor.hooks?.[hookName]?.length) continue;
      
      // For request-specific hooks, check if this executor should receive them
      // (e.g., only the assigned executor gets on_request_completed)
      if (hookName === 'on_request_completed' || hookName === 'on_request_started') {
        if (executor.id !== thread.executor_id) continue;
      }
      
      try {
        await executeHooks(hookName, thread, executor, extra);
      } catch (e) {
        console.error(`Hook dispatch failed for ${executor.id}:`, e.message);
      }
    }
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
      hooks: body.hooks || {},
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
    
    const thread = { 
      ref, 
      intent: body.intent, 
      priority: body.priority || 'normal', 
      status: 'pending', 
      requestor_id: auth.id,
      created_at: now,
      updated_at: now,
    };
    
    // Dispatch notifications and hooks
    await dispatchNotifications(auth.exchange_id, thread, 'thread_created');
    await dispatchHooks(auth.exchange_id, 'on_request_created', thread);
    
    return { data: { ref, status: 'pending' }, status: 201 };
  }

  async function handleUpdateRequest(auth, ref, body) {
    const events = await getThreadEvents(auth.exchange_id, ref);
    const thread = computeThreadState(events);
    
    if (!thread) {
      return { error: 'Thread not found', status: 404 };
    }
    
    const now = new Date().toISOString();
    const oldStatus = thread.status;
    
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
    
    if (body.status && body.status !== oldStatus) {
      const updated = { 
        ...thread, 
        status: body.status,
        executor_id: body.status === 'claimed' ? auth.id : thread.executor_id,
        updated_at: now,
      };
      
      // Dispatch notifications
      await dispatchNotifications(auth.exchange_id, updated, 'status_changed');
      
      // Dispatch appropriate hooks based on status change
      const hookMap = {
        'claimed': 'on_request_claimed',
        'in-progress': 'on_request_started',
        'completed': 'on_request_completed',
        'rejected': 'on_request_rejected',
        'cancelled': 'on_request_cancelled',
      };
      
      const hookName = hookMap[body.status];
      if (hookName) {
        await dispatchHooks(auth.exchange_id, hookName, updated, { 
          old_status: oldStatus,
          actor_id: auth.id,
        });
      }
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
    if (body.hooks) executor.hooks = body.hooks;
    if (body.preferences) executor.preferences = body.preferences;
    executor.last_seen = new Date().toISOString();
    
    await putExecutor(auth.exchange_id, executor);

    return { data: { executor_id: executor.id, updated: true }, status: 200 };
  }

  // ---- Import/Export Handlers ----

  /**
   * Import a MESSE-AF thread
   * Accepts either:
   * - YAML string (v1 flat file format)
   * - Array of {name, content} objects (v2 directory format)
   */
  async function handleImportThread(auth, body) {
    // Check if storage supports MESSE-AF import
    if (typeof storage.importThread !== 'function') {
      return {
        error: 'Import not supported in event-sourced mode. Set STORAGE_MODE=messe-af',
        status: 400
      };
    }

    if (!body.content && !body.files) {
      return { error: 'content or files required', status: 400 };
    }

    try {
      const input = body.files || body.content;
      const result = await storage.importThread(auth.exchange_id, input);

      return {
        data: {
          imported: 1,
          threads: [result]
        },
        status: 201
      };
    } catch (e) {
      return { error: `Import failed: ${e.message}`, status: 400 };
    }
  }

  /**
   * Export a thread to MESSE-AF format
   * @param {Object} auth - Authenticated executor
   * @param {string} ref - Thread reference
   * @param {Object} query - Query options (format: 'yaml' | 'zip')
   */
  async function handleExportThread(auth, ref, query = {}) {
    // Check if storage supports MESSE-AF export
    if (typeof storage.exportThread !== 'function') {
      return {
        error: 'Export not supported in event-sourced mode. Set STORAGE_MODE=messe-af',
        status: 400
      };
    }

    const format = query.format === 'v1' ? 'v1' : 'v2';

    try {
      const result = await storage.exportThread(auth.exchange_id, ref, format);

      if (!result) {
        return { error: 'Thread not found', status: 404 };
      }

      // For v2, result is array of files
      // For v1, result is YAML string
      return {
        data: {
          ref,
          format,
          files: Array.isArray(result) ? result : undefined,
          content: typeof result === 'string' ? result : undefined
        },
        status: 200
      };
    } catch (e) {
      return { error: `Export failed: ${e.message}`, status: 500 };
    }
  }

  // ---- Capabilities Handler ----

  /**
   * List exchange capabilities
   * Loads from YAML files in the capabilities directory (filesystem only)
   * @param {string} exchangeId - Exchange ID
   * @param {Object} query - Query options (tag filter)
   */
  async function handleListCapabilities(exchangeId, query = {}) {
    const capabilitiesDir = process.env.CAPABILITIES_DIR || './capabilities';
    const capabilities = [];

    try {
      // Use direct fs access for capabilities (works for Node.js deployments)
      const fs = await import('fs/promises');
      const path = await import('path');

      const absDir = path.resolve(capabilitiesDir);
      const entries = await fs.readdir(absDir);
      const yamlFiles = entries.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

      for (const file of yamlFiles) {
        const content = await fs.readFile(path.join(absDir, file), 'utf8');
        if (!content) continue;

        // Parse multi-doc YAML (split by ---)
        const docs = content.split(/^---$/m).filter(d => d.trim());

        for (const doc of docs) {
          try {
            // Simple YAML parsing for capability format
            const cap = parseSimpleYaml(doc);
            if (cap && cap.id) {
              capabilities.push({
                id: cap.id,
                description: cap.description || '',
                tags: cap.tags || []
              });
            }
          } catch (e) {
            console.error(`Failed to parse capability in ${file}:`, e.message);
          }
        }
      }
    } catch (e) {
      // Capabilities dir may not exist or fs not available - that's OK
      if (e.code !== 'ENOENT') {
        console.error('Capabilities load error:', e.message);
      }
    }

    // Filter by tag if specified
    let filtered = capabilities;
    if (query.tag) {
      filtered = capabilities.filter(c => c.tags?.includes(query.tag));
    }

    return { data: { capabilities: filtered }, status: 200 };
  }

  // ---- Attachment Handler ----

  /**
   * Get attachment from a thread
   * @param {Object} auth - Authenticated executor
   * @param {string} ref - Thread reference
   * @param {string} filename - Attachment filename
   */
  async function handleGetAttachment(auth, ref, filename) {
    // Validate filename to prevent path traversal
    if (filename.includes('..') || filename.includes('/')) {
      return { error: 'Invalid filename', status: 400 };
    }

    // Check if storage supports direct attachment access
    if (typeof storage.getAttachment === 'function') {
      const data = await storage.getAttachment(auth.exchange_id, ref, filename);
      if (!data) {
        return { error: 'Attachment not found', status: 404 };
      }
      return { data: { content: data, filename }, status: 200 };
    }

    // For MESSE-AF storage, try to find the attachment in the thread directory
    // Try v2 format first: exchange={id}/state={folder}/{ref}/attachments/{filename}
    for (const folder of ['received', 'executing', 'finished', 'canceled']) {
      const attachmentPath = `exchange=${auth.exchange_id}/state=${folder}/${ref}/attachments/${filename}`;
      const data = await storage.get(attachmentPath);
      if (data) {
        return { data: { content: data, filename }, status: 200 };
      }
    }

    // For event-sourced storage, attachments may be embedded in events
    // Search through message events for base64 attachments
    const events = await getThreadEvents(auth.exchange_id, ref);
    for (const event of events) {
      if (event.event_type === 'message_added' && event.payload?.mess) {
        const content = findAttachmentInMess(event.payload.mess, filename);
        if (content) {
          return { data: { content: Buffer.from(content, 'base64'), filename }, status: 200 };
        }
      }
    }

    return { error: 'Attachment not found', status: 404 };
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
    handleImportThread,
    handleExportThread,
    handleListCapabilities,
    handleGetAttachment,
    // Expose for testing/advanced use
    executeHooks,
    templateExpand,
  };
}
