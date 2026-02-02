/**
 * Tests for MESSE-AF storage mode
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  parseThread,
  parseThreadV1,
  parseYamlDocs,
  serializeThread,
  serializeThreadV1,
  eventsToMesseAf,
  messeAfToEvents,
  getFolderForStatus
} from '@messe-af/core';
import { MesseAfStorage } from '../src/storage/messe-af-storage.js';
import { FilesystemStorage } from '../src/storage/filesystem.js';
import { createHandlers } from '../src/core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA = path.join(__dirname, 'test-data-messe-af');

// Clean up test data before/after tests
async function cleanup() {
  try {
    await fs.rm(TEST_DATA, { recursive: true });
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

describe('MESSE-AF Parser', () => {
  it('parses v1 flat file format', () => {
    const content = `ref: 2026-01-31-001
requestor: alice
executor: null
status: pending
created: 2026-01-31T10:00:00Z
updated: 2026-01-31T10:00:00Z
intent: Check the garage door
priority: normal
history:
  - action: created
    at: 2026-01-31T10:00:00Z
    by: alice
---
from: alice
received: 2026-01-31T10:00:00Z
channel: mcp
MESS:
  - v: "1.0.0"
  - request:
      intent: Check the garage door`;

    const result = parseThreadV1(content);

    assert.equal(result.envelope.ref, '2026-01-31-001');
    assert.equal(result.envelope.status, 'pending');
    assert.equal(result.envelope.intent, 'Check the garage door');
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].from, 'alice');
  });

  it('parses v2 directory format', () => {
    const files = [
      {
        name: '000-2026-01-31-001.messe-af.yaml',
        content: `ref: 2026-01-31-001
requestor: alice
executor: null
status: pending
created: 2026-01-31T10:00:00Z
updated: 2026-01-31T10:00:00Z
intent: Check the garage door
priority: normal
history:
  - action: created
    at: 2026-01-31T10:00:00Z
    by: alice
---
from: alice
received: 2026-01-31T10:00:00Z
channel: mcp
MESS:
  - v: "1.0.0"
  - request:
      intent: Check the garage door`
      }
    ];

    const result = parseThread(files);

    assert.equal(result.envelope.ref, '2026-01-31-001');
    assert.equal(result.messages.length, 1);
    assert.deepEqual(result.attachments, []);
  });

  it('parses multi-file v2 format', () => {
    const files = [
      {
        name: '000-2026-01-31-001.messe-af.yaml',
        content: `ref: 2026-01-31-001
requestor: alice
status: pending
---
from: alice
MESS:
  - v: "1.0.0"`
      },
      {
        name: '001-2026-01-31-001.messe-af.yaml',
        content: `from: bob
MESS:
  - response:
      text: Done!`
      }
    ];

    const result = parseThread(files);

    assert.equal(result.messages.length, 2);
    assert.equal(result.messages[0].from, 'alice');
    assert.equal(result.messages[1].from, 'bob');
  });

  it('collects attachments from directory', () => {
    const files = [
      {
        name: '000-2026-01-31-001.messe-af.yaml',
        content: `ref: 2026-01-31-001
requestor: alice
status: pending`
      },
      {
        name: 'att-001-image-photo.jpg',
        content: 'binary data',
        sha: 'abc123'
      }
    ];

    const result = parseThread(files);

    assert.equal(result.attachments.length, 1);
    assert.equal(result.attachments[0].name, 'att-001-image-photo.jpg');
    assert.equal(result.attachments[0].sha, 'abc123');
  });
});

describe('MESSE-AF Serializer', () => {
  it('serializes to v1 flat file format', () => {
    const envelope = {
      ref: '2026-01-31-001',
      requestor: 'alice',
      executor: null,
      status: 'pending',
      created: '2026-01-31T10:00:00Z',
      updated: '2026-01-31T10:00:00Z',
      intent: 'Test intent',
      priority: 'normal',
      history: []
    };

    const messages = [
      { from: 'alice', MESS: [{ v: '1.0.0' }] }
    ];

    const result = serializeThreadV1(envelope, messages);

    assert.ok(result.includes('ref: 2026-01-31-001'));
    assert.ok(result.includes('---'));
    assert.ok(result.includes('from: alice'));
  });

  it('serializes to v2 directory format', () => {
    const envelope = {
      ref: '2026-01-31-001',
      requestor: 'alice',
      executor: null,
      status: 'pending',
      created: '2026-01-31T10:00:00Z',
      updated: '2026-01-31T10:00:00Z',
      intent: 'Test intent',
      priority: 'normal',
      history: []
    };

    const messages = [
      { from: 'alice', MESS: [{ v: '1.0.0' }] }
    ];

    const files = serializeThread(envelope, messages);

    assert.equal(files.length, 1);
    assert.equal(files[0].name, '000-2026-01-31-001.messe-af.yaml');
    assert.ok(files[0].content.includes('ref: 2026-01-31-001'));
  });

  it('roundtrips v1 format', () => {
    const envelope = {
      ref: '2026-01-31-001',
      requestor: 'alice',
      executor: 'bob',
      status: 'completed',
      created: '2026-01-31T10:00:00Z',
      updated: '2026-01-31T11:00:00Z',
      intent: 'Test intent',
      priority: 'elevated',
      history: [
        { action: 'created', at: '2026-01-31T10:00:00Z', by: 'alice' }
      ]
    };

    const messages = [
      { from: 'alice', received: '2026-01-31T10:00:00Z', MESS: [{ v: '1.0.0' }] },
      { from: 'bob', received: '2026-01-31T11:00:00Z', MESS: [{ response: { text: 'Done' } }] }
    ];

    const serialized = serializeThreadV1(envelope, messages);
    const parsed = parseThreadV1(serialized);

    assert.equal(parsed.envelope.ref, envelope.ref);
    assert.equal(parsed.envelope.status, envelope.status);
    assert.equal(parsed.messages.length, messages.length);
  });

  it('roundtrips v2 format', () => {
    const envelope = {
      ref: '2026-01-31-002',
      requestor: 'alice',
      executor: null,
      status: 'pending',
      created: '2026-01-31T10:00:00Z',
      updated: '2026-01-31T10:00:00Z',
      intent: 'Test v2',
      priority: 'normal',
      history: []
    };

    const messages = [
      { from: 'alice', received: '2026-01-31T10:00:00Z', MESS: [{ v: '1.0.0' }] }
    ];

    const files = serializeThread(envelope, messages);
    const parsed = parseThread(files);

    assert.equal(parsed.envelope.ref, envelope.ref);
    assert.equal(parsed.messages.length, messages.length);
  });
});

describe('MESSE-AF Converter', () => {
  it('converts events to MESSE-AF format', () => {
    const events = [
      {
        event_id: '1',
        ts: '2026-01-31T10:00:00Z',
        exchange_id: 'test',
        thread_ref: '2026-01-31-001',
        event_type: 'thread_created',
        actor_id: 'alice',
        payload: {
          intent: 'Check something',
          context: ['context1'],
          priority: 'normal',
          requestor_id: 'alice',
          response_hint: []
        }
      },
      {
        event_id: '2',
        ts: '2026-01-31T11:00:00Z',
        exchange_id: 'test',
        thread_ref: '2026-01-31-001',
        event_type: 'status_changed',
        actor_id: 'bob',
        payload: {
          old_status: 'pending',
          new_status: 'claimed',
          executor_id: 'bob'
        }
      }
    ];

    const result = eventsToMesseAf(events);

    assert.equal(result.envelope.ref, '2026-01-31-001');
    assert.equal(result.envelope.status, 'claimed');
    assert.equal(result.envelope.executor, 'bob');
    assert.ok(result.messages.length >= 2);
  });

  it('converts MESSE-AF to events', () => {
    const envelope = {
      ref: '2026-01-31-001',
      requestor: 'alice',
      executor: 'bob',
      status: 'completed',
      created: '2026-01-31T10:00:00Z',
      updated: '2026-01-31T11:00:00Z',
      intent: 'Do something',
      priority: 'normal',
      history: [
        { action: 'created', at: '2026-01-31T10:00:00Z', by: 'alice' },
        { action: 'completed', at: '2026-01-31T11:00:00Z', by: 'bob' }
      ]
    };

    const messages = [
      {
        from: 'alice',
        received: '2026-01-31T10:00:00Z',
        MESS: [{ v: '1.0.0' }, { request: { intent: 'Do something' } }]
      },
      {
        from: 'bob',
        received: '2026-01-31T11:00:00Z',
        MESS: [{ response: { text: 'Done' } }]
      }
    ];

    const events = messeAfToEvents(envelope, messages, 'test-exchange');

    assert.ok(events.length >= 2);
    assert.equal(events[0].event_type, 'thread_created');
    assert.equal(events[0].exchange_id, 'test-exchange');
  });

  it('maps status to folder correctly', () => {
    assert.equal(getFolderForStatus('pending'), 'received');
    assert.equal(getFolderForStatus('claimed'), 'executing');
    assert.equal(getFolderForStatus('in-progress'), 'executing');
    assert.equal(getFolderForStatus('completed'), 'finished');
    assert.equal(getFolderForStatus('cancelled'), 'canceled');
    assert.equal(getFolderForStatus('failed'), 'canceled');
  });
});

describe('MesseAfStorage', () => {
  let storage;

  before(async () => {
    await cleanup();
    const baseStorage = new FilesystemStorage(TEST_DATA);
    storage = new MesseAfStorage(baseStorage, { version: 2 });
  });

  after(cleanup);

  it('has correct type', () => {
    assert.equal(storage.type, 'messe-af-v2');
  });

  it('passes through executor operations', async () => {
    const executor = { id: 'test', name: 'Test' };
    await storage.put('executors/exchange=test/test.json', JSON.stringify(executor));

    const result = await storage.get('executors/exchange=test/test.json');
    assert.deepEqual(JSON.parse(result), executor);
  });
});

describe('MESSE-AF Integration', () => {
  let storage;
  let handlers;

  beforeEach(async () => {
    await cleanup();
    const baseStorage = new FilesystemStorage(TEST_DATA);
    storage = new MesseAfStorage(baseStorage, { version: 2 });
    handlers = createHandlers(storage);
  });

  after(cleanup);

  it('creates request in MESSE-AF format', async () => {
    // Register executor
    const regResult = await handlers.handleRegister('test-exchange', {
      executor_id: 'alice',
      display_name: 'Alice'
    });
    assert.equal(regResult.status, 201);

    // Authenticate
    const auth = await handlers.authenticate(regResult.data.api_key);
    assert.ok(auth);

    // Create request
    const createResult = await handlers.handleCreateRequest(auth, {
      intent: 'Check the garage door',
      context: ['Going to bed'],
      priority: 'normal'
    });

    assert.equal(createResult.status, 201);
    assert.ok(createResult.data.ref);

    // Verify MESSE-AF file was created
    const ref = createResult.data.ref;
    const dirPath = path.join(TEST_DATA, 'exchange=test-exchange', 'state=received', ref);

    const files = await fs.readdir(dirPath);
    assert.ok(files.some(f => f.endsWith('.messe-af.yaml')));

    // Read and parse the file
    const yamlFile = files.find(f => f.endsWith('.messe-af.yaml'));
    const content = await fs.readFile(path.join(dirPath, yamlFile), 'utf-8');
    const parsed = parseThreadV1(content);

    assert.equal(parsed.envelope.ref, ref);
    assert.equal(parsed.envelope.intent, 'Check the garage door');
    assert.equal(parsed.envelope.status, 'pending');
  });

  it('supports import/export', async () => {
    // Register executor
    const regResult = await handlers.handleRegister('test-exchange', {
      executor_id: 'importer',
      display_name: 'Importer'
    });
    const auth = await handlers.authenticate(regResult.data.api_key);

    // Import a thread
    const yamlContent = `ref: 2026-01-30-999
requestor: external
executor: null
status: pending
created: 2026-01-30T10:00:00Z
updated: 2026-01-30T10:00:00Z
intent: Imported request
priority: normal
history:
  - action: created
    at: 2026-01-30T10:00:00Z
    by: external
---
from: external
received: 2026-01-30T10:00:00Z
channel: import
MESS:
  - v: "1.0.0"
  - request:
      intent: Imported request`;

    const importResult = await handlers.handleImportThread(auth, { content: yamlContent });
    assert.equal(importResult.status, 201);
    assert.equal(importResult.data.imported, 1);

    // Export the thread
    const exportResult = await handlers.handleExportThread(auth, '2026-01-30-999', { format: 'v2' });
    assert.equal(exportResult.status, 200);
    assert.ok(exportResult.data.files);
    assert.ok(exportResult.data.files.length > 0);
  });
});
