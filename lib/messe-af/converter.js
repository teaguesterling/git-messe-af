/**
 * MESSE-AF Converter
 * Converts between event-sourced format and MESSE-AF format
 */

/**
 * Status mapping for Hive partitioning folders
 */
export const STATUS_FOLDERS = {
  pending: 'received',
  claimed: 'executing',
  'in-progress': 'executing',
  waiting: 'executing',
  held: 'executing',
  needs_input: 'executing',
  needs_confirmation: 'executing',
  completed: 'finished',
  partial: 'finished',
  failed: 'canceled',
  declined: 'canceled',
  cancelled: 'canceled',
  expired: 'canceled',
  delegated: 'canceled',
  superseded: 'canceled'
};

/**
 * Get folder name for a status
 * @param {string} status
 * @returns {string}
 */
export function getFolderForStatus(status) {
  return STATUS_FOLDERS[status] || 'received';
}

/**
 * Convert event-sourced format to MESSE-AF format
 * @param {Array} events - Sorted array of events for a thread
 * @returns {{envelope: Object, messages: Array}}
 */
export function eventsToMesseAf(events) {
  if (!events || events.length === 0) {
    throw new Error('No events to convert');
  }

  // Find thread_created event
  const createdEvent = events.find(e => e.event_type === 'thread_created');
  if (!createdEvent) {
    throw new Error('No thread_created event found');
  }

  const ref = createdEvent.thread_ref;

  // Build envelope from events
  const envelope = {
    ref,
    requestor: createdEvent.payload.requestor_id || createdEvent.actor_id,
    executor: null,
    status: 'pending',
    created: createdEvent.ts,
    updated: createdEvent.ts,
    intent: createdEvent.payload.intent,
    priority: createdEvent.payload.priority || 'normal',
    history: []
  };

  // Build messages from events
  const messages = [];
  let messageSerial = 0; // Acks don't consume serials

  // Add initial request message (no re: - it creates the thread)
  const requestId = createdEvent.payload.client_id;
  messages.push({
    from: envelope.requestor,
    received: createdEvent.ts,
    channel: 'api',
    MESS: [
      { v: '1.0.0' },
      {
        request: {
          ...(requestId && { id: requestId }),
          intent: createdEvent.payload.intent,
          context: createdEvent.payload.context || [],
          response_hint: createdEvent.payload.response_hint || []
        }
      }
    ]
  });

  // Add exchange ack (no message ref - system message)
  messages.push({
    from: 'exchange',
    received: createdEvent.ts,
    MESS: [{ ack: { re: requestId || 'last', ref } }]
  });

  envelope.history.push({ action: 'created', at: createdEvent.ts, by: envelope.requestor });

  // Process remaining events
  for (const event of events) {
    envelope.updated = event.ts;

    switch (event.event_type) {
      case 'thread_created':
        // Already processed above
        break;

      case 'status_changed': {
        messageSerial++;
        const messType = getMessageType([{ status: { code: event.payload.new_status } }]);
        const msgRef = generateMessageRef(ref, messType, messageSerial);

        envelope.status = event.payload.new_status;
        if (event.payload.executor_id) {
          envelope.executor = event.payload.executor_id;
        }
        envelope.history.push({
          action: event.payload.new_status,
          at: event.ts,
          by: event.actor_id,
          ref: msgRef
        });

        // Add status message with message-level re:
        messages.push({
          from: event.actor_id,
          received: event.ts,
          channel: 'api',
          re: ref,
          MESS: [{
            status: {
              code: event.payload.new_status,
              ...(event.payload.message && { message: event.payload.message })
            }
          }]
        });

        // Add exchange ack for the message
        messages.push({
          from: 'exchange',
          received: event.ts,
          MESS: [{ ack: { ref: msgRef } }]
        });
        break;
      }

      case 'message_added': {
        messageSerial++;
        const messType = getMessageType(event.payload.mess);
        const clientId = extractClientId(event.payload.mess);
        const msgRef = generateMessageRef(ref, messType, messageSerial, clientId);

        // Add message with message-level re:
        messages.push({
          from: event.actor_id,
          received: event.ts,
          channel: 'api',
          re: ref,
          MESS: event.payload.mess
        });

        // Add exchange ack
        messages.push({
          from: 'exchange',
          received: event.ts,
          MESS: [{ ack: { ...(clientId && { re: clientId }), ref: msgRef } }]
        });
        break;
      }
    }
  }

  return { envelope, messages };
}

/**
 * Convert MESSE-AF format to event-sourced events
 * @param {Object} envelope - Thread envelope
 * @param {Array} messages - Thread messages
 * @param {string} exchangeId - Exchange ID for events
 * @returns {Array} Array of events
 */
export function messeAfToEvents(envelope, messages, exchangeId) {
  const events = [];
  const ref = envelope.ref;

  // Generate UUIDs deterministically from ref + sequence
  let eventSeq = 0;
  const generateEventId = () => `${ref}-${eventSeq++}`;

  // Create thread_created event from first request message
  const requestMsg = messages.find(m => m.MESS?.some(item => item.request));
  const request = requestMsg?.MESS?.find(item => item.request)?.request;

  events.push({
    event_id: generateEventId(),
    ts: envelope.created,
    exchange_id: exchangeId,
    thread_ref: ref,
    event_type: 'thread_created',
    actor_id: envelope.requestor,
    payload: {
      intent: envelope.intent,
      context: request?.context || [],
      priority: envelope.priority || 'normal',
      requestor_id: envelope.requestor,
      response_hint: request?.response_hint || []
    }
  });

  // Add initial message_added event
  if (requestMsg) {
    events.push({
      event_id: generateEventId(),
      ts: requestMsg.received,
      exchange_id: exchangeId,
      thread_ref: ref,
      event_type: 'message_added',
      actor_id: envelope.requestor,
      payload: {
        mess: requestMsg.MESS
      }
    });
  }

  // Track status changes from history
  let lastStatus = 'pending';
  const historyByTime = new Map();
  for (const h of (envelope.history || [])) {
    historyByTime.set(h.at, h);
  }

  // Process remaining messages in order
  for (const msg of messages) {
    // Skip the first request message (already processed)
    if (msg === requestMsg) continue;

    // Skip exchange acks (internal)
    if (msg.from === 'exchange') continue;

    // Check for status updates
    const statusItem = msg.MESS?.find(item => item.status);
    if (statusItem) {
      const newStatus = statusItem.status.code;
      if (newStatus && newStatus !== lastStatus) {
        events.push({
          event_id: generateEventId(),
          ts: msg.received,
          exchange_id: exchangeId,
          thread_ref: ref,
          event_type: 'status_changed',
          actor_id: msg.from,
          payload: {
            old_status: lastStatus,
            new_status: newStatus,
            executor_id: newStatus === 'claimed' ? msg.from : envelope.executor,
            message: statusItem.status.message
          }
        });
        lastStatus = newStatus;
      }
    }

    // Check for response/other content
    const hasContent = msg.MESS?.some(item =>
      item.response || item.request || item.cancel ||
      (item.status && item.status.message)
    );

    if (hasContent) {
      events.push({
        event_id: generateEventId(),
        ts: msg.received,
        exchange_id: exchangeId,
        thread_ref: ref,
        event_type: 'message_added',
        actor_id: msg.from,
        payload: {
          mess: msg.MESS
        }
      });
    }
  }

  // If current status differs from tracked status, add final status change
  if (envelope.status !== lastStatus) {
    const historyEntry = [...historyByTime.values()]
      .find(h => h.action === envelope.status);

    events.push({
      event_id: generateEventId(),
      ts: historyEntry?.at || envelope.updated,
      exchange_id: exchangeId,
      thread_ref: ref,
      event_type: 'status_changed',
      actor_id: historyEntry?.by || envelope.executor || 'system',
      payload: {
        old_status: lastStatus,
        new_status: envelope.status,
        executor_id: envelope.executor
      }
    });
  }

  return events;
}

/**
 * Generate thread reference in format YYYY-MM-DD-NNN-{tokenized-id}
 * @param {number} sequence - Sequence number for today
 * @param {string} clientId - Optional client-provided ID to tokenize
 * @returns {string}
 */
export function generateRef(sequence = 1, clientId = null) {
  const today = new Date().toISOString().split('T')[0];
  const base = `${today}-${sequence.toString().padStart(3, '0')}`;
  if (clientId) {
    return `${base}-${tokenizeId(clientId)}`;
  }
  return base;
}

/**
 * Tokenize an ID for use in refs (lowercase, hyphens, max 32 chars)
 * @param {string} id - User-provided ID
 * @returns {string}
 */
export function tokenizeId(id) {
  if (!id) return '';
  return id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

/**
 * Generate message reference
 * @param {string} threadRef - Parent thread ref
 * @param {string} messType - Message type (claim, status, response, question, answer, etc.)
 * @param {number} serial - Message serial number
 * @param {string} clientId - Optional client-provided ID
 * @returns {string}
 */
export function generateMessageRef(threadRef, messType, serial, clientId = null) {
  const base = `${threadRef}/${messType}-${serial.toString().padStart(3, '0')}`;
  if (clientId) {
    return `${base}-${tokenizeId(clientId)}`;
  }
  return base;
}

/**
 * Determine message type from MESS content
 * @param {Array} mess - MESS array
 * @returns {string}
 */
export function getMessageType(mess) {
  if (!mess || mess.length === 0) return 'message';

  for (const item of mess) {
    if (item.request) return 'request';
    if (item.response) return 'response';
    if (item.status?.code === 'claimed') return 'claim';
    if (item.status?.code === 'needs_input') return 'question';
    if (item.status) return 'status';
    if (item.answer) return 'answer';
    if (item.reply) return 'answer'; // legacy
    if (item.cancel) return 'cancel';
    if (item.followup) return 'followup';
  }
  return 'message';
}

/**
 * Extract client ID from MESS content
 * @param {Array} mess - MESS array
 * @returns {string|null}
 */
export function extractClientId(mess) {
  if (!mess) return null;

  for (const item of mess) {
    if (item.request?.id) return item.request.id;
    if (item.response?.id) return item.response.id;
    if (item.answer?.id) return item.answer.id;
    if (item.status?.id) return item.status.id;
  }
  return null;
}
