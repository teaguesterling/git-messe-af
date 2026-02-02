/**
 * Tests for the MESS Exchange Server
 *
 * Run with: npm test
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';

// Import modules under test
import {
  generateRef,
  generateApiKey,
  hashApiKey,
  parseApiKey,
  todayPath,
  createHandlers,
  parseSimpleYaml,
  findAttachmentInMess,
} from '../src/core.js';

import { FilesystemStorage } from '../src/storage/filesystem.js';

// ============ Helper Functions Tests ============

describe('generateRef', () => {
  it('generates ref in YYYY-MM-DD-XXXX format', () => {
    const ref = generateRef();
    assert.match(ref, /^\d{4}-\d{2}-\d{2}-[A-Z0-9]{4}$/);
  });

  it('uses current date', () => {
    const ref = generateRef();
    const today = new Date().toISOString().slice(0, 10);
    assert.ok(ref.startsWith(today));
  });

  it('generates unique refs', () => {
    const refs = new Set();
    for (let i = 0; i < 100; i++) {
      refs.add(generateRef());
    }
    // With 4 alphanumeric chars, collisions are unlikely but possible
    // We just check we got at least 90 unique refs
    assert.ok(refs.size >= 90, `Expected at least 90 unique refs, got ${refs.size}`);
  });
});

describe('generateApiKey', () => {
  it('generates key with correct prefix', () => {
    const key = generateApiKey('home');
    assert.ok(key.startsWith('mess_home_'));
  });

  it('includes exchange ID', () => {
    const key = generateApiKey('myexchange');
    assert.ok(key.includes('myexchange'));
  });

  it('generates unique keys', () => {
    const key1 = generateApiKey('test');
    const key2 = generateApiKey('test');
    assert.notStrictEqual(key1, key2);
  });
});

describe('hashApiKey', () => {
  it('returns base64 encoded hash', async () => {
    const hash = await hashApiKey('test_key');
    // Base64 characters
    assert.match(hash, /^[A-Za-z0-9+/]+=*$/);
  });

  it('produces same hash for same input', async () => {
    const hash1 = await hashApiKey('same_key');
    const hash2 = await hashApiKey('same_key');
    assert.strictEqual(hash1, hash2);
  });

  it('produces different hashes for different inputs', async () => {
    const hash1 = await hashApiKey('key1');
    const hash2 = await hashApiKey('key2');
    assert.notStrictEqual(hash1, hash2);
  });
});

describe('parseApiKey', () => {
  it('parses valid API key', () => {
    const result = parseApiKey('mess_home_abc123def456');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.exchangeId, 'home');
  });

  it('rejects key without mess prefix', () => {
    const result = parseApiKey('invalid_home_abc123');
    assert.strictEqual(result.valid, false);
  });

  it('rejects key with too few parts', () => {
    const result = parseApiKey('mess_home');
    assert.strictEqual(result.valid, false);
  });

  it('handles exchange IDs with underscores', () => {
    const result = parseApiKey('mess_my_exchange_abc123');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.exchangeId, 'my');
  });
});

describe('todayPath', () => {
  it('returns path in YYYY/MM/DD format', () => {
    const path = todayPath();
    assert.match(path, /^\d{4}\/\d{2}\/\d{2}$/);
  });

  it('uses current UTC date', () => {
    const path = todayPath();
    const now = new Date();
    const expected = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${String(now.getUTCDate()).padStart(2, '0')}`;
    assert.strictEqual(path, expected);
  });
});

// ============ FilesystemStorage Tests ============

describe('FilesystemStorage', () => {
  let tempDir;
  let storage;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mess-storage-test-'));
    storage = new FilesystemStorage(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('put', () => {
    it('creates file with content', async () => {
      await storage.put('test.txt', 'hello world');
      const content = await fs.readFile(path.join(tempDir, 'test.txt'), 'utf8');
      assert.strictEqual(content, 'hello world');
    });

    it('creates nested directories', async () => {
      await storage.put('a/b/c/test.txt', 'nested content');
      const content = await fs.readFile(path.join(tempDir, 'a/b/c/test.txt'), 'utf8');
      assert.strictEqual(content, 'nested content');
    });

    it('overwrites existing files', async () => {
      await storage.put('test.txt', 'first');
      await storage.put('test.txt', 'second');
      const content = await fs.readFile(path.join(tempDir, 'test.txt'), 'utf8');
      assert.strictEqual(content, 'second');
    });
  });

  describe('get', () => {
    it('returns file content', async () => {
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'stored content');
      const content = await storage.get('test.txt');
      assert.strictEqual(content, 'stored content');
    });

    it('returns null for missing files', async () => {
      const content = await storage.get('nonexistent.txt');
      assert.strictEqual(content, null);
    });

    it('reads nested files', async () => {
      await fs.mkdir(path.join(tempDir, 'a/b'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'a/b/test.txt'), 'nested');
      const content = await storage.get('a/b/test.txt');
      assert.strictEqual(content, 'nested');
    });
  });

  describe('list', () => {
    it('lists files with prefix', async () => {
      await fs.mkdir(path.join(tempDir, 'prefix'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'prefix/a.txt'), 'a');
      await fs.writeFile(path.join(tempDir, 'prefix/b.txt'), 'b');
      await fs.writeFile(path.join(tempDir, 'other.txt'), 'other');

      const files = await storage.list('prefix/');
      assert.strictEqual(files.length, 2);
      assert.ok(files.includes('prefix/a.txt'));
      assert.ok(files.includes('prefix/b.txt'));
    });

    it('lists files recursively', async () => {
      await fs.mkdir(path.join(tempDir, 'events/2024/01/01'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'events/2024/01/01/a.jsonl'), 'a');
      await fs.mkdir(path.join(tempDir, 'events/2024/01/02'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'events/2024/01/02/b.jsonl'), 'b');

      const files = await storage.list('events/');
      assert.strictEqual(files.length, 2);
    });

    it('returns empty array for missing prefix', async () => {
      const files = await storage.list('nonexistent/');
      assert.deepStrictEqual(files, []);
    });
  });

  describe('delete', () => {
    it('removes existing file', async () => {
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'content');
      await storage.delete('test.txt');
      await assert.rejects(fs.access(path.join(tempDir, 'test.txt')));
    });

    it('does not throw for missing file', async () => {
      await assert.doesNotReject(storage.delete('nonexistent.txt'));
    });
  });
});

// ============ Handler Tests ============

describe('createHandlers', () => {
  let tempDir;
  let storage;
  let handlers;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mess-handlers-test-'));
    storage = new FilesystemStorage(tempDir);
    handlers = createHandlers(storage);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('handleRegister', () => {
    it('creates new executor', async () => {
      const result = await handlers.handleRegister('home', {
        executor_id: 'phone',
        display_name: 'My Phone',
      });

      assert.strictEqual(result.status, 201);
      assert.strictEqual(result.data.executor_id, 'phone');
      assert.ok(result.data.api_key.startsWith('mess_home_'));
    });

    it('requires executor_id', async () => {
      const result = await handlers.handleRegister('home', {
        display_name: 'No ID',
      });

      assert.strictEqual(result.status, 400);
      assert.strictEqual(result.error, 'executor_id required');
    });

    it('rejects duplicate executor', async () => {
      await handlers.handleRegister('home', { executor_id: 'phone' });
      const result = await handlers.handleRegister('home', { executor_id: 'phone' });

      assert.strictEqual(result.status, 409);
      assert.strictEqual(result.error, 'Executor already registered');
    });

    it('stores executor with hashed API key', async () => {
      const result = await handlers.handleRegister('home', { executor_id: 'phone' });

      const executorFile = await fs.readFile(
        path.join(tempDir, 'executors/exchange=home/phone.json'),
        'utf8'
      );
      const executor = JSON.parse(executorFile);

      assert.strictEqual(executor.id, 'phone');
      assert.ok(executor.api_key_hash);
      assert.ok(!executor.api_key); // API key should not be stored plain
    });
  });

  describe('authenticate', () => {
    it('authenticates valid API key', async () => {
      const { data } = await handlers.handleRegister('home', { executor_id: 'phone' });
      const executor = await handlers.authenticate(data.api_key);

      assert.ok(executor);
      assert.strictEqual(executor.id, 'phone');
      assert.strictEqual(executor.exchange_id, 'home');
    });

    it('rejects invalid API key', async () => {
      await handlers.handleRegister('home', { executor_id: 'phone' });
      const executor = await handlers.authenticate('mess_home_invalidkey');

      assert.strictEqual(executor, null);
    });

    it('rejects malformed API key', async () => {
      const executor = await handlers.authenticate('not_a_valid_key');
      assert.strictEqual(executor, null);
    });
  });

  describe('handleCreateRequest', () => {
    let apiKey;
    let auth;

    beforeEach(async () => {
      const { data } = await handlers.handleRegister('home', { executor_id: 'phone' });
      apiKey = data.api_key;
      auth = await handlers.authenticate(apiKey);
    });

    it('creates new request', async () => {
      const result = await handlers.handleCreateRequest(auth, {
        intent: 'Check the door',
        priority: 'normal',
      });

      assert.strictEqual(result.status, 201);
      assert.ok(result.data.ref);
      assert.strictEqual(result.data.status, 'pending');
    });

    it('requires intent', async () => {
      const result = await handlers.handleCreateRequest(auth, {
        priority: 'normal',
      });

      assert.strictEqual(result.status, 400);
      assert.strictEqual(result.error, 'intent required');
    });

    it('writes event to storage', async () => {
      const { data } = await handlers.handleCreateRequest(auth, {
        intent: 'Test task',
      });

      const events = await storage.list('events/');
      assert.ok(events.length > 0);
    });
  });

  describe('handleListRequests', () => {
    let auth;

    beforeEach(async () => {
      const { data } = await handlers.handleRegister('home', { executor_id: 'phone' });
      auth = await handlers.authenticate(data.api_key);
    });

    it('returns empty list initially', async () => {
      const result = await handlers.handleListRequests(auth);

      assert.strictEqual(result.status, 200);
      assert.deepStrictEqual(result.data.threads, []);
    });

    it('lists created requests', async () => {
      await handlers.handleCreateRequest(auth, { intent: 'Task 1' });
      await handlers.handleCreateRequest(auth, { intent: 'Task 2' });

      const result = await handlers.handleListRequests(auth);

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.threads.length, 2);
    });

    it('filters by status', async () => {
      await handlers.handleCreateRequest(auth, { intent: 'Task 1' });
      const { data } = await handlers.handleCreateRequest(auth, { intent: 'Task 2' });

      // Claim task 2
      await handlers.handleUpdateRequest(auth, data.ref, { status: 'claimed' });

      const pendingResult = await handlers.handleListRequests(auth, { status: 'pending' });
      assert.strictEqual(pendingResult.data.threads.length, 1);

      const claimedResult = await handlers.handleListRequests(auth, { status: 'claimed' });
      assert.strictEqual(claimedResult.data.threads.length, 1);
    });
  });

  describe('handleGetRequest', () => {
    let auth;

    beforeEach(async () => {
      const { data } = await handlers.handleRegister('home', { executor_id: 'phone' });
      auth = await handlers.authenticate(data.api_key);
    });

    it('returns thread details', async () => {
      const { data: created } = await handlers.handleCreateRequest(auth, {
        intent: 'Check garage',
        priority: 'elevated',
      });

      const result = await handlers.handleGetRequest(auth, created.ref);

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.thread.ref, created.ref);
      assert.strictEqual(result.data.thread.intent, 'Check garage');
      assert.strictEqual(result.data.thread.priority, 'elevated');
    });

    it('returns 404 for missing thread', async () => {
      const result = await handlers.handleGetRequest(auth, '2099-01-01-XXXX');

      assert.strictEqual(result.status, 404);
      assert.strictEqual(result.error, 'Thread not found');
    });
  });

  describe('handleUpdateRequest', () => {
    let auth;
    let ref;

    beforeEach(async () => {
      const { data: regData } = await handlers.handleRegister('home', { executor_id: 'phone' });
      auth = await handlers.authenticate(regData.api_key);

      const { data } = await handlers.handleCreateRequest(auth, { intent: 'Test task' });
      ref = data.ref;
    });

    it('updates status', async () => {
      const result = await handlers.handleUpdateRequest(auth, ref, { status: 'claimed' });

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.status, 'claimed');

      const { data } = await handlers.handleGetRequest(auth, ref);
      assert.strictEqual(data.thread.status, 'claimed');
    });

    it('adds message', async () => {
      const result = await handlers.handleUpdateRequest(auth, ref, {
        mess: [{ response: { content: ['Done!'] } }],
      });

      assert.strictEqual(result.status, 200);

      const { data } = await handlers.handleGetRequest(auth, ref);
      assert.ok(data.thread.messages.length > 0);
    });

    it('returns 404 for missing thread', async () => {
      const result = await handlers.handleUpdateRequest(auth, '2099-01-01-XXXX', {
        status: 'claimed',
      });

      assert.strictEqual(result.status, 404);
    });
  });

  describe('handleListExecutors', () => {
    let auth;

    beforeEach(async () => {
      const { data } = await handlers.handleRegister('home', { executor_id: 'phone' });
      auth = await handlers.authenticate(data.api_key);
    });

    it('lists registered executors', async () => {
      const result = await handlers.handleListExecutors(auth);

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.executors.length, 1);
      assert.strictEqual(result.data.executors[0].id, 'phone');
    });

    it('does not expose API key hash', async () => {
      const result = await handlers.handleListExecutors(auth);

      assert.ok(!result.data.executors[0].api_key_hash);
    });
  });

  describe('handleUpdateExecutor', () => {
    let auth;

    beforeEach(async () => {
      const { data } = await handlers.handleRegister('home', {
        executor_id: 'phone',
        display_name: 'Original Name',
      });
      auth = await handlers.authenticate(data.api_key);
    });

    it('updates own profile', async () => {
      const result = await handlers.handleUpdateExecutor(auth, 'phone', {
        display_name: 'New Name',
      });

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.updated, true);

      const { data } = await handlers.handleListExecutors(auth);
      assert.strictEqual(data.executors[0].display_name, 'New Name');
    });

    it('rejects updating other executor', async () => {
      const result = await handlers.handleUpdateExecutor(auth, 'other-phone', {
        display_name: 'Hacked',
      });

      assert.strictEqual(result.status, 403);
    });

    it('updates capabilities', async () => {
      await handlers.handleUpdateExecutor(auth, 'phone', {
        capabilities: ['photo:capture', 'location:indoor'],
      });

      const { data } = await handlers.handleListExecutors(auth);
      assert.deepStrictEqual(data.executors[0].capabilities, ['photo:capture', 'location:indoor']);
    });
  });
});

// ============ Thread State Computation Tests ============

describe('Thread State Computation', () => {
  let tempDir;
  let storage;
  let handlers;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mess-state-test-'));
    storage = new FilesystemStorage(tempDir);
    handlers = createHandlers(storage);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('tracks full request lifecycle', async () => {
    // Register two executors
    const { data: reg1 } = await handlers.handleRegister('home', { executor_id: 'agent' });
    const { data: reg2 } = await handlers.handleRegister('home', { executor_id: 'human' });

    const agentAuth = await handlers.authenticate(reg1.api_key);
    const humanAuth = await handlers.authenticate(reg2.api_key);

    // Agent creates request
    const { data: created } = await handlers.handleCreateRequest(agentAuth, {
      intent: 'Check the door',
      priority: 'normal',
    });
    const ref = created.ref;

    // Human claims
    await handlers.handleUpdateRequest(humanAuth, ref, { status: 'claimed' });

    // Human completes with response
    await handlers.handleUpdateRequest(humanAuth, ref, {
      status: 'completed',
      mess: [{ response: { content: ['Door is locked'] } }],
    });

    // Verify final state
    const { data } = await handlers.handleGetRequest(agentAuth, ref);
    const thread = data.thread;

    assert.strictEqual(thread.status, 'completed');
    assert.strictEqual(thread.requestor_id, 'agent');
    assert.strictEqual(thread.executor_id, 'human');
    assert.ok(thread.messages.length >= 2); // request + response
  });
});

// ============ Event Schema Tests ============

describe('Event Schema', () => {
  let tempDir;
  let storage;
  let handlers;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mess-events-test-'));
    storage = new FilesystemStorage(tempDir);
    handlers = createHandlers(storage);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('writes valid JSON lines events', async () => {
    const { data } = await handlers.handleRegister('home', { executor_id: 'phone' });
    const auth = await handlers.authenticate(data.api_key);

    await handlers.handleCreateRequest(auth, { intent: 'Test' });

    const files = await storage.list('events/');
    assert.ok(files.length > 0);

    for (const file of files) {
      const content = await storage.get(file);
      for (const line of content.trim().split('\n')) {
        const event = JSON.parse(line);
        assert.ok(event.event_id);
        assert.ok(event.ts);
        assert.ok(event.exchange_id);
        assert.ok(event.event_type);
        assert.ok(event.actor_id);
      }
    }
  });

  it('events include correct types', async () => {
    const { data } = await handlers.handleRegister('home', { executor_id: 'phone' });
    const auth = await handlers.authenticate(data.api_key);

    const { data: created } = await handlers.handleCreateRequest(auth, { intent: 'Test' });
    await handlers.handleUpdateRequest(auth, created.ref, { status: 'claimed' });

    const files = await storage.list('events/');
    const eventTypes = new Set();

    for (const file of files) {
      const content = await storage.get(file);
      for (const line of content.trim().split('\n')) {
        const event = JSON.parse(line);
        eventTypes.add(event.event_type);
      }
    }

    assert.ok(eventTypes.has('executor_registered'));
    assert.ok(eventTypes.has('thread_created'));
    assert.ok(eventTypes.has('status_changed'));
    assert.ok(eventTypes.has('message_added'));
  });
});

// ============ Helper Functions Tests ============

describe('parseSimpleYaml', () => {
  it('parses simple key-value pairs', () => {
    const yaml = `
id: test-cap
description: A test capability
`;
    const result = parseSimpleYaml(yaml);
    assert.strictEqual(result.id, 'test-cap');
    assert.strictEqual(result.description, 'A test capability');
  });

  it('parses inline arrays', () => {
    const yaml = `
id: test
tags: [a, b, c]
`;
    const result = parseSimpleYaml(yaml);
    assert.deepStrictEqual(result.tags, ['a', 'b', 'c']);
  });

  it('parses multi-line arrays', () => {
    const yaml = `
id: test
tags:
  - first
  - second
`;
    const result = parseSimpleYaml(yaml);
    assert.deepStrictEqual(result.tags, ['first', 'second']);
  });

  it('ignores comments', () => {
    const yaml = `
# This is a comment
id: test
# Another comment
description: desc
`;
    const result = parseSimpleYaml(yaml);
    assert.strictEqual(result.id, 'test');
    assert.strictEqual(result.description, 'desc');
  });
});

describe('findAttachmentInMess', () => {
  it('finds image attachment in response', () => {
    const mess = [
      {
        response: {
          content: [
            { image: { name: 'photo.jpg', data: 'base64data' } },
            'Text description'
          ]
        }
      }
    ];
    const result = findAttachmentInMess(mess, 'photo.jpg');
    assert.strictEqual(result, 'base64data');
  });

  it('finds attachment in response', () => {
    const mess = [
      {
        response: {
          content: [
            { attachment: { name: 'doc.pdf', data: 'pdfdata' } }
          ]
        }
      }
    ];
    const result = findAttachmentInMess(mess, 'doc.pdf');
    assert.strictEqual(result, 'pdfdata');
  });

  it('finds attachment in request', () => {
    const mess = [
      {
        request: {
          intent: 'Test',
          attachments: [
            { name: 'file.txt', data: 'filedata' }
          ]
        }
      }
    ];
    const result = findAttachmentInMess(mess, 'file.txt');
    assert.strictEqual(result, 'filedata');
  });

  it('returns null for missing attachment', () => {
    const mess = [
      { response: { content: ['Just text'] } }
    ];
    const result = findAttachmentInMess(mess, 'missing.jpg');
    assert.strictEqual(result, null);
  });

  it('handles empty mess array', () => {
    const result = findAttachmentInMess([], 'any.jpg');
    assert.strictEqual(result, null);
  });

  it('handles non-array input', () => {
    const result = findAttachmentInMess(null, 'any.jpg');
    assert.strictEqual(result, null);
  });
});

// ============ Capabilities Tests ============

describe('handleListCapabilities', () => {
  let tempDir;
  let capDir;
  let storage;
  let handlers;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mess-cap-test-'));
    capDir = path.join(tempDir, 'capabilities');
    await fs.mkdir(capDir);

    storage = new FilesystemStorage(tempDir);

    // Set environment variable for capabilities directory
    process.env.CAPABILITIES_DIR = capDir;

    handlers = createHandlers(storage);
  });

  afterEach(async () => {
    delete process.env.CAPABILITIES_DIR;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns empty list when no capabilities exist', async () => {
    const result = await handlers.handleListCapabilities('home');
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(result.data.capabilities, []);
  });

  it('loads capabilities from YAML files', async () => {
    await fs.writeFile(path.join(capDir, 'test.yaml'), `
id: camera
description: Take photos
tags: [visual]
`);

    const result = await handlers.handleListCapabilities('home');
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.capabilities.length, 1);
    assert.strictEqual(result.data.capabilities[0].id, 'camera');
    assert.strictEqual(result.data.capabilities[0].description, 'Take photos');
    assert.deepStrictEqual(result.data.capabilities[0].tags, ['visual']);
  });

  it('loads multi-doc YAML', async () => {
    await fs.writeFile(path.join(capDir, 'multi.yaml'), `
id: first
description: First cap
---
id: second
description: Second cap
`);

    const result = await handlers.handleListCapabilities('home');
    assert.strictEqual(result.data.capabilities.length, 2);
    assert.strictEqual(result.data.capabilities[0].id, 'first');
    assert.strictEqual(result.data.capabilities[1].id, 'second');
  });

  it('filters by tag', async () => {
    await fs.writeFile(path.join(capDir, 'caps.yaml'), `
id: camera
description: Take photos
tags: [visual, attachments]
---
id: door-check
description: Check doors
tags: [security]
`);

    const result = await handlers.handleListCapabilities('home', { tag: 'visual' });
    assert.strictEqual(result.data.capabilities.length, 1);
    assert.strictEqual(result.data.capabilities[0].id, 'camera');
  });
});

// ============ Attachment Handler Tests ============

describe('handleGetAttachment', () => {
  let tempDir;
  let storage;
  let handlers;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mess-att-test-'));
    storage = new FilesystemStorage(tempDir);
    handlers = createHandlers(storage);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('rejects path traversal attempts', async () => {
    const { data } = await handlers.handleRegister('home', { executor_id: 'phone' });
    const auth = await handlers.authenticate(data.api_key);

    const result = await handlers.handleGetAttachment(auth, '2026-01-01-XXXX', '../etc/passwd');
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, 'Invalid filename');
  });

  it('rejects slashes in filename', async () => {
    const { data } = await handlers.handleRegister('home', { executor_id: 'phone' });
    const auth = await handlers.authenticate(data.api_key);

    const result = await handlers.handleGetAttachment(auth, '2026-01-01-XXXX', 'path/to/file.jpg');
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, 'Invalid filename');
  });

  it('returns 404 for missing attachment', async () => {
    const { data } = await handlers.handleRegister('home', { executor_id: 'phone' });
    const auth = await handlers.authenticate(data.api_key);

    const result = await handlers.handleGetAttachment(auth, '2026-01-01-XXXX', 'missing.jpg');
    assert.strictEqual(result.status, 404);
  });
});
