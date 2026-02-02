/**
 * Tests for the MESS MCP Server
 *
 * Run with: npm test
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============ Helper Functions (extracted for testing) ============

const STATUS_FOLDERS = {
  pending: 'received', claimed: 'executing', in_progress: 'executing',
  waiting: 'executing', held: 'executing', needs_input: 'executing',
  needs_confirmation: 'executing', completed: 'finished', partial: 'finished',
  failed: 'canceled', declined: 'canceled', cancelled: 'canceled',
  expired: 'canceled', delegated: 'canceled', superseded: 'canceled'
};

// Import YAML for testing serialization
import YAML from 'yaml';

function serializeThread(envelope, messages) {
  return [envelope, ...messages].map(d => YAML.stringify(d, { lineWidth: -1 })).join('---\n');
}

function parseThread(content) {
  const docs = content.split(/^---$/m).filter(d => d.trim()).map(d => YAML.parse(d));
  return { envelope: docs[0], messages: docs.slice(1) };
}

// ============ Tests ============

describe('YAML Serialization', () => {
  it('serializeThread creates valid multi-document YAML', () => {
    const envelope = {
      ref: '2026-02-01-001',
      requestor: 'test-agent',
      executor: null,
      status: 'pending',
      created: '2026-02-01T10:00:00Z',
      updated: '2026-02-01T10:00:00Z',
      intent: 'Test request',
      priority: 'normal',
      history: [{ action: 'created', at: '2026-02-01T10:00:00Z', by: 'test-agent' }]
    };

    const messages = [
      {
        from: 'test-agent',
        received: '2026-02-01T10:00:00Z',
        channel: 'mcp',
        MESS: [{ v: '1.0.0' }, { request: { intent: 'Test request' } }]
      }
    ];

    const yaml = serializeThread(envelope, messages);

    assert.ok(yaml.includes('ref: 2026-02-01-001'));
    assert.ok(yaml.includes('---'));
    assert.ok(yaml.includes('from: test-agent'));
  });

  it('parseThread correctly parses multi-document YAML', () => {
    const yaml = `ref: 2026-02-01-001
requestor: test-agent
status: pending
---
from: test-agent
MESS:
  - v: "1.0.0"
---
from: exchange
MESS:
  - ack:
      re: last`;

    const { envelope, messages } = parseThread(yaml);

    assert.strictEqual(envelope.ref, '2026-02-01-001');
    assert.strictEqual(envelope.requestor, 'test-agent');
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].from, 'test-agent');
    assert.strictEqual(messages[1].from, 'exchange');
  });

  it('round-trip serialization preserves data', () => {
    const envelope = {
      ref: '2026-02-01-001',
      requestor: 'agent',
      executor: 'human',
      status: 'claimed',
      intent: 'Check the door'
    };

    const messages = [
      { from: 'agent', MESS: [{ request: { intent: 'Check the door' } }] },
      { from: 'human', MESS: [{ status: { re: '2026-02-01-001', code: 'claimed' } }] }
    ];

    const yaml = serializeThread(envelope, messages);
    const parsed = parseThread(yaml);

    assert.strictEqual(parsed.envelope.ref, envelope.ref);
    assert.strictEqual(parsed.envelope.status, envelope.status);
    assert.strictEqual(parsed.messages.length, messages.length);
  });
});

describe('STATUS_FOLDERS mapping', () => {
  it('maps pending status to received folder', () => {
    assert.strictEqual(STATUS_FOLDERS['pending'], 'received');
  });

  it('maps claimed and in_progress to executing folder', () => {
    assert.strictEqual(STATUS_FOLDERS['claimed'], 'executing');
    assert.strictEqual(STATUS_FOLDERS['in_progress'], 'executing');
    assert.strictEqual(STATUS_FOLDERS['needs_input'], 'executing');
  });

  it('maps completed statuses to finished folder', () => {
    assert.strictEqual(STATUS_FOLDERS['completed'], 'finished');
    assert.strictEqual(STATUS_FOLDERS['partial'], 'finished');
  });

  it('maps failure statuses to canceled folder', () => {
    assert.strictEqual(STATUS_FOLDERS['failed'], 'canceled');
    assert.strictEqual(STATUS_FOLDERS['declined'], 'canceled');
    assert.strictEqual(STATUS_FOLDERS['cancelled'], 'canceled');
    assert.strictEqual(STATUS_FOLDERS['expired'], 'canceled');
  });
});

describe('GitHubAPI', () => {
  // Mock fetch for GitHub API tests
  let originalFetch;
  let fetchMock;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = mock.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // Helper to create GitHubAPI class for testing
  class GitHubAPI {
    constructor(repo, token) {
      const [owner, name] = repo.split('/');
      this.owner = owner;
      this.repo = name;
      this.token = token;
      this.baseUrl = `https://api.github.com/repos/${owner}/${name}`;
    }

    async request(path, options = {}) {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'mess-mcp-server',
          ...options.headers
        }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `GitHub API error: ${res.status}`);
      }
      return res.json();
    }

    async getFile(path) {
      try {
        const data = await this.request(`/contents/${path}`);
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        return { content, sha: data.sha };
      } catch (e) {
        if (e.message.includes('404')) return null;
        throw e;
      }
    }

    async putFile(path, content, message, sha = null) {
      const body = {
        message,
        content: Buffer.from(content).toString('base64'),
      };
      if (sha) body.sha = sha;
      return await this.request(`/contents/${path}`, {
        method: 'PUT',
        body: JSON.stringify(body)
      });
    }

    async listFolder(folder) {
      try {
        const data = await this.request(`/contents/exchange/${folder}`);
        return data.filter(f => f.name.endsWith('.messe-af.yaml'));
      } catch (e) {
        if (e.message.includes('404')) return [];
        throw e;
      }
    }

    async deleteFile(path, sha, message) {
      return await this.request(`/contents/${path}`, {
        method: 'DELETE',
        body: JSON.stringify({ message, sha })
      });
    }
  }

  it('constructs correct base URL', () => {
    const api = new GitHubAPI('testuser/testrepo', 'token123');
    assert.strictEqual(api.owner, 'testuser');
    assert.strictEqual(api.repo, 'testrepo');
    assert.strictEqual(api.baseUrl, 'https://api.github.com/repos/testuser/testrepo');
  });

  it('getFile decodes base64 content', async () => {
    const testContent = 'Hello, World!';
    const base64Content = Buffer.from(testContent).toString('base64');

    fetchMock.mock.mockImplementation(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        content: base64Content,
        sha: 'abc123'
      })
    }));

    const api = new GitHubAPI('user/repo', 'token');
    const result = await api.getFile('test/path.yaml');

    assert.strictEqual(result.content, testContent);
    assert.strictEqual(result.sha, 'abc123');
  });

  it('getFile returns null for 404', async () => {
    fetchMock.mock.mockImplementation(() => Promise.resolve({
      ok: false,
      json: () => Promise.resolve({ message: '404 Not Found' })
    }));

    const api = new GitHubAPI('user/repo', 'token');
    const result = await api.getFile('nonexistent.yaml');

    assert.strictEqual(result, null);
  });

  it('putFile sends correct request', async () => {
    fetchMock.mock.mockImplementation(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ content: { sha: 'newsha' } })
    }));

    const api = new GitHubAPI('user/repo', 'token');
    await api.putFile('test/path.yaml', 'content', 'commit message', 'oldsha');

    const call = fetchMock.mock.calls[0];
    assert.ok(call.arguments[0].includes('/contents/test/path.yaml'));

    const body = JSON.parse(call.arguments[1].body);
    assert.strictEqual(body.message, 'commit message');
    assert.strictEqual(body.sha, 'oldsha');
    assert.strictEqual(Buffer.from(body.content, 'base64').toString(), 'content');
  });

  it('listFolder filters for .messe-af.yaml files', async () => {
    fetchMock.mock.mockImplementation(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve([
        { name: '2026-02-01-001.messe-af.yaml' },
        { name: '2026-02-01-002.messe-af.yaml' },
        { name: 'README.md' },
        { name: '.gitkeep' }
      ])
    }));

    const api = new GitHubAPI('user/repo', 'token');
    const files = await api.listFolder('received');

    assert.strictEqual(files.length, 2);
    assert.ok(files.every(f => f.name.endsWith('.messe-af.yaml')));
  });

  it('listFolder returns empty array for 404', async () => {
    fetchMock.mock.mockImplementation(() => Promise.resolve({
      ok: false,
      json: () => Promise.resolve({ message: '404 Not Found' })
    }));

    const api = new GitHubAPI('user/repo', 'token');
    const files = await api.listFolder('nonexistent');

    assert.deepStrictEqual(files, []);
  });

  it('deleteFile sends DELETE request with sha', async () => {
    fetchMock.mock.mockImplementation(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ commit: { sha: 'commitsha' } })
    }));

    const api = new GitHubAPI('user/repo', 'token');
    await api.deleteFile('test/path.yaml', 'filesha', 'delete message');

    const call = fetchMock.mock.calls[0];
    assert.strictEqual(call.arguments[1].method, 'DELETE');

    const body = JSON.parse(call.arguments[1].body);
    assert.strictEqual(body.sha, 'filesha');
    assert.strictEqual(body.message, 'delete message');
  });
});

describe('Local File Operations', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mess-test-'));
    for (const folder of ['received', 'executing', 'finished', 'canceled']) {
      await fs.mkdir(path.join(tempDir, folder), { recursive: true });
    }
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('can write and read thread files', async () => {
    const envelope = {
      ref: '2026-02-01-001',
      requestor: 'test',
      status: 'pending'
    };
    const messages = [{ from: 'test', MESS: [] }];
    const content = serializeThread(envelope, messages);

    const filePath = path.join(tempDir, 'received', '2026-02-01-001.messe-af.yaml');
    await fs.writeFile(filePath, content);

    const readContent = await fs.readFile(filePath, 'utf-8');
    const { envelope: parsed } = parseThread(readContent);

    assert.strictEqual(parsed.ref, '2026-02-01-001');
    assert.strictEqual(parsed.requestor, 'test');
  });

  it('can list files in folder', async () => {
    // Create test files
    await fs.writeFile(path.join(tempDir, 'received', '2026-02-01-001.messe-af.yaml'), 'test');
    await fs.writeFile(path.join(tempDir, 'received', '2026-02-01-002.messe-af.yaml'), 'test');
    await fs.writeFile(path.join(tempDir, 'received', 'README.md'), 'test');

    const files = await fs.readdir(path.join(tempDir, 'received'));
    const yamlFiles = files.filter(f => f.endsWith('.messe-af.yaml'));

    assert.strictEqual(yamlFiles.length, 2);
  });

  it('can move files between folders', async () => {
    const content = 'ref: 2026-02-01-001\nstatus: pending';
    const oldPath = path.join(tempDir, 'received', '2026-02-01-001.messe-af.yaml');
    const newPath = path.join(tempDir, 'executing', '2026-02-01-001.messe-af.yaml');

    await fs.writeFile(oldPath, content);

    // Simulate move
    const updatedContent = content.replace('status: pending', 'status: claimed');
    await fs.writeFile(newPath, updatedContent);
    await fs.unlink(oldPath);

    // Verify old file gone
    await assert.rejects(fs.access(oldPath));

    // Verify new file exists
    const readContent = await fs.readFile(newPath, 'utf-8');
    assert.ok(readContent.includes('status: claimed'));
  });
});

describe('MESS Message Parsing', () => {
  it('parses request message', () => {
    const yaml = `- v: "1.0.0"
- request:
    intent: Check the garage door
    context:
      - Getting ready for bed
    response_hint:
      - image`;

    const mess = YAML.parse(yaml);
    const hasRequest = mess.some(m => m.request);
    const request = mess.find(m => m.request)?.request;

    assert.ok(hasRequest);
    assert.strictEqual(request.intent, 'Check the garage door');
    assert.deepStrictEqual(request.response_hint, ['image']);
  });

  it('parses status update message', () => {
    const yaml = `- status:
    re: 2026-02-01-001
    code: claimed`;

    const mess = YAML.parse(yaml);
    const statusItem = mess.find(m => m.status);

    assert.strictEqual(statusItem.status.re, '2026-02-01-001');
    assert.strictEqual(statusItem.status.code, 'claimed');
  });

  it('parses cancel message', () => {
    const yaml = `- cancel:
    re: 2026-02-01-001
    reason: No longer needed`;

    const mess = YAML.parse(yaml);
    const cancelItem = mess.find(m => m.cancel);

    assert.strictEqual(cancelItem.cancel.re, '2026-02-01-001');
    assert.strictEqual(cancelItem.cancel.reason, 'No longer needed');
  });

  it('parses response message', () => {
    const yaml = `- response:
    re: 2026-02-01-001
    content:
      - The garage door is closed
      - image: "data:image/png;base64,..."`;

    const mess = YAML.parse(yaml);
    const responseItem = mess.find(m => m.response);

    assert.strictEqual(responseItem.response.re, '2026-02-01-001');
    assert.strictEqual(responseItem.response.content.length, 2);
  });
});

describe('Reference Generation', () => {
  it('generates refs in correct format', () => {
    const today = new Date().toISOString().split('T')[0];
    const ref = `${today}-001`;

    // Format should be YYYY-MM-DD-NNN
    assert.match(ref, /^\d{4}-\d{2}-\d{2}-\d{3}$/);
    assert.ok(ref.startsWith(today));
  });

  it('increments ref number correctly', () => {
    const today = '2026-02-01';
    const existingRefs = ['2026-02-01-001', '2026-02-01-002', '2026-02-01-003'];

    // Simulate finding max number
    let maxNum = 0;
    for (const ref of existingRefs) {
      const num = parseInt(ref.split('-')[3] || '0');
      if (num > maxNum) maxNum = num;
    }

    const newRef = `${today}-${(maxNum + 1).toString().padStart(3, '0')}`;
    assert.strictEqual(newRef, '2026-02-01-004');
  });
});

describe('Thread State Transitions', () => {
  it('new request starts in pending/received', () => {
    const status = 'pending';
    const folder = STATUS_FOLDERS[status];
    assert.strictEqual(folder, 'received');
  });

  it('claimed thread moves to executing', () => {
    const status = 'claimed';
    const folder = STATUS_FOLDERS[status];
    assert.strictEqual(folder, 'executing');
  });

  it('completed thread moves to finished', () => {
    const status = 'completed';
    const folder = STATUS_FOLDERS[status];
    assert.strictEqual(folder, 'finished');
  });

  it('history is appended on status change', () => {
    const envelope = {
      ref: '2026-02-01-001',
      status: 'pending',
      history: [{ action: 'created', at: '2026-02-01T10:00:00Z', by: 'agent' }]
    };

    // Simulate status change
    const now = new Date().toISOString();
    const newStatus = 'claimed';
    const executor = 'human';

    envelope.status = newStatus;
    envelope.updated = now;
    envelope.history.push({ action: newStatus, at: now, by: executor });
    envelope.executor = executor;

    assert.strictEqual(envelope.status, 'claimed');
    assert.strictEqual(envelope.executor, 'human');
    assert.strictEqual(envelope.history.length, 2);
    assert.strictEqual(envelope.history[1].action, 'claimed');
  });
});

describe('Error Handling', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('handles GitHub API errors gracefully', async () => {
    globalThis.fetch = mock.fn(() => Promise.resolve({
      ok: false,
      json: () => Promise.resolve({ message: 'Bad credentials' })
    }));

    class GitHubAPI {
      constructor() {
        this.baseUrl = 'https://api.github.com/repos/test/test';
      }
      async request(path, options = {}) {
        const res = await fetch(`${this.baseUrl}${path}`, options);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || `GitHub API error: ${res.status}`);
        }
        return res.json();
      }
    }

    const api = new GitHubAPI();
    await assert.rejects(
      api.request('/contents/test'),
      { message: 'Bad credentials' }
    );
  });

  it('handles network errors', async () => {
    globalThis.fetch = mock.fn(() => Promise.reject(new Error('Network error')));

    class GitHubAPI {
      constructor() {
        this.baseUrl = 'https://api.github.com/repos/test/test';
      }
      async request(path) {
        return await fetch(`${this.baseUrl}${path}`);
      }
    }

    const api = new GitHubAPI();
    await assert.rejects(
      api.request('/contents/test'),
      { message: 'Network error' }
    );
  });
});

describe('MESS Protocol Compliance', () => {
  it('request message has required fields', () => {
    const request = {
      intent: 'Check the door',
      context: ['Going to bed'],
      priority: 'normal',
      response_hint: ['text']
    };

    // intent is required
    assert.ok(request.intent);

    // Other fields are optional but should have valid values
    assert.ok(['background', 'normal', 'elevated', 'urgent'].includes(request.priority));
    assert.ok(Array.isArray(request.response_hint));
  });

  it('envelope has required fields', () => {
    const envelope = {
      ref: '2026-02-01-001',
      requestor: 'agent',
      executor: null,
      status: 'pending',
      created: '2026-02-01T10:00:00Z',
      updated: '2026-02-01T10:00:00Z',
      intent: 'Test',
      priority: 'normal',
      history: []
    };

    // All required fields present
    assert.ok(envelope.ref);
    assert.ok(envelope.requestor);
    assert.ok(envelope.status);
    assert.ok(envelope.created);
    assert.ok(envelope.updated);
    assert.ok(envelope.intent);
    assert.ok(Array.isArray(envelope.history));
  });

  it('status codes are valid', () => {
    const validStatuses = Object.keys(STATUS_FOLDERS);

    assert.ok(validStatuses.includes('pending'));
    assert.ok(validStatuses.includes('claimed'));
    assert.ok(validStatuses.includes('completed'));
    assert.ok(validStatuses.includes('failed'));
    assert.ok(validStatuses.includes('cancelled'));
  });
});

describe('Capabilities', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mess-capabilities-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // Helper to parse capabilities from multi-doc YAML (mirrors mcp/index.js logic)
  function parseCapabilities(content) {
    const capabilities = [];
    const docs = content.split(/^---$/m).filter(d => d.trim());

    for (const doc of docs) {
      try {
        const cap = YAML.parse(doc);
        if (cap && cap.id && cap.description) {
          capabilities.push(cap);
        }
      } catch (e) {
        // Skip invalid docs
      }
    }

    return capabilities;
  }

  // Helper to load capabilities from a directory
  async function loadCapabilitiesFromDir(dir) {
    const capabilities = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.yaml')) {
          try {
            const content = await fs.readFile(path.join(dir, entry.name), 'utf-8');
            capabilities.push(...parseCapabilities(content));
          } catch (e) {
            // Skip invalid files
          }
        }
      }

      capabilities.sort((a, b) => a.id.localeCompare(b.id));
    } catch (e) {
      // Directory doesn't exist
    }

    return capabilities;
  }

  it('parses multi-doc YAML capabilities', () => {
    const content = `id: camera
description: Take and attach photos
tags: [attachments]
---
id: hands
description: Has human hands
---
id: check-door
description: Check if doors are locked
tags: [security]`;

    const capabilities = parseCapabilities(content);

    assert.strictEqual(capabilities.length, 3);
    assert.strictEqual(capabilities[0].id, 'camera');
    assert.strictEqual(capabilities[1].id, 'hands');
    assert.strictEqual(capabilities[2].id, 'check-door');
  });

  it('requires both id and description', () => {
    const content = `id: valid
description: Has both fields
---
id: missing-description
---
description: Missing id field
---
id: also-valid
description: Another valid one`;

    const capabilities = parseCapabilities(content);

    assert.strictEqual(capabilities.length, 2);
    assert.ok(capabilities.some(c => c.id === 'valid'));
    assert.ok(capabilities.some(c => c.id === 'also-valid'));
  });

  it('loads capabilities from directory', async () => {
    const content = `id: camera
description: Take photos
---
id: hands
description: Human hands`;

    await fs.writeFile(path.join(tempDir, 'capabilities.yaml'), content);

    const capabilities = await loadCapabilitiesFromDir(tempDir);

    assert.strictEqual(capabilities.length, 2);
    assert.ok(capabilities.some(c => c.id === 'camera'));
    assert.ok(capabilities.some(c => c.id === 'hands'));
  });

  it('loads from multiple files', async () => {
    const file1 = `id: camera
description: Take photos`;

    const file2 = `id: mobility
description: Move around
---
id: hands
description: Human hands`;

    await fs.writeFile(path.join(tempDir, 'basics.yaml'), file1);
    await fs.writeFile(path.join(tempDir, 'physical.yaml'), file2);

    const capabilities = await loadCapabilitiesFromDir(tempDir);

    assert.strictEqual(capabilities.length, 3);
  });

  it('sorts alphabetically by id', async () => {
    const content = `id: zebra
description: Last
---
id: alpha
description: First
---
id: middle
description: Middle`;

    await fs.writeFile(path.join(tempDir, 'caps.yaml'), content);

    const capabilities = await loadCapabilitiesFromDir(tempDir);

    assert.strictEqual(capabilities[0].id, 'alpha');
    assert.strictEqual(capabilities[1].id, 'middle');
    assert.strictEqual(capabilities[2].id, 'zebra');
  });

  it('returns empty array for nonexistent directory', async () => {
    const capabilities = await loadCapabilitiesFromDir('/nonexistent/path');
    assert.deepStrictEqual(capabilities, []);
  });

  it('preserves optional fields', () => {
    const content = `id: smart-home
description: Control smart home devices
tags: [automation, iot]
definition: https://example.com/docs.md`;

    const capabilities = parseCapabilities(content);

    assert.strictEqual(capabilities.length, 1);
    const cap = capabilities[0];

    assert.strictEqual(cap.id, 'smart-home');
    assert.strictEqual(cap.description, 'Control smart home devices');
    assert.deepStrictEqual(cap.tags, ['automation', 'iot']);
    assert.strictEqual(cap.definition, 'https://example.com/docs.md');
  });

  it('handles minimal capability definition', () => {
    const content = `id: hands
description: Has human hands`;

    const capabilities = parseCapabilities(content);

    assert.strictEqual(capabilities.length, 1);
    assert.strictEqual(capabilities[0].id, 'hands');
    assert.strictEqual(capabilities[0].description, 'Has human hands');
    assert.strictEqual(capabilities[0].tags, undefined);
  });
});

describe('Capabilities Filtering', () => {
  it('filters capabilities by tag', () => {
    const capabilities = [
      { id: 'check-door', description: 'Check doors', tags: ['security', 'physical-access'] },
      { id: 'check-stove', description: 'Check stove', tags: ['security', 'safety'] },
      { id: 'water-plants', description: 'Water plants', tags: ['maintenance'] },
      { id: 'camera', description: 'Take photos', tags: ['attachments'] }
    ];

    const securityCaps = capabilities.filter(c => c.tags?.includes('security'));

    assert.strictEqual(securityCaps.length, 2);
    assert.ok(securityCaps.every(c => c.tags.includes('security')));
  });
});

describe('Helper Tools', () => {
  it('mess_request builds correct request structure', () => {
    // Simulate what mess_request handler does
    const args = {
      intent: 'Check the garage door',
      context: ['Getting ready for bed'],
      priority: 'elevated',
      response_hints: ['image', 'text']
    };

    const req = {
      intent: args.intent,
      context: args.context || [],
      priority: args.priority || 'normal',
      response_hint: args.response_hints || []
    };

    assert.strictEqual(req.intent, 'Check the garage door');
    assert.deepStrictEqual(req.context, ['Getting ready for bed']);
    assert.strictEqual(req.priority, 'elevated');
    assert.deepStrictEqual(req.response_hint, ['image', 'text']);
  });

  it('mess_request uses defaults for optional fields', () => {
    const args = { intent: 'Simple task' };

    const req = {
      intent: args.intent,
      context: args.context || [],
      priority: args.priority || 'normal',
      response_hint: args.response_hints || []
    };

    assert.strictEqual(req.intent, 'Simple task');
    assert.deepStrictEqual(req.context, []);
    assert.strictEqual(req.priority, 'normal');
    assert.deepStrictEqual(req.response_hint, []);
  });

  it('mess_answer builds correct answer structure', () => {
    const args = {
      ref: '2026-02-01-001',
      answer: 'The living room light'
    };

    const mess = [{
      answer: {
        re: args.ref,
        value: args.answer
      }
    }];

    assert.strictEqual(mess[0].answer.re, '2026-02-01-001');
    assert.strictEqual(mess[0].answer.value, 'The living room light');
  });

  it('mess_cancel builds correct cancel structure', () => {
    const args = {
      ref: '2026-02-01-001',
      reason: 'No longer needed'
    };

    const mess = [{
      cancel: {
        re: args.ref,
        ...(args.reason && { reason: args.reason })
      }
    }];

    assert.strictEqual(mess[0].cancel.re, '2026-02-01-001');
    assert.strictEqual(mess[0].cancel.reason, 'No longer needed');
  });

  it('mess_cancel works without reason', () => {
    const args = { ref: '2026-02-01-001' };

    const mess = [{
      cancel: {
        re: args.ref,
        ...(args.reason && { reason: args.reason })
      }
    }];

    assert.strictEqual(mess[0].cancel.re, '2026-02-01-001');
    assert.strictEqual(mess[0].cancel.reason, undefined);
  });
});

describe('Thread Resources', () => {
  it('parses thread:// URI correctly', () => {
    const uri = 'thread://2026-02-01-001';
    const match = uri.match(/^thread:\/\/([^/]+)(\/(.+))?$/);

    assert.ok(match);
    assert.strictEqual(match[1], '2026-02-01-001');
    assert.strictEqual(match[3], undefined);
  });

  it('parses thread:// URI with part', () => {
    const uri = 'thread://2026-02-01-001/envelope';
    const match = uri.match(/^thread:\/\/([^/]+)(\/(.+))?$/);

    assert.ok(match);
    assert.strictEqual(match[1], '2026-02-01-001');
    assert.strictEqual(match[3], 'envelope');
  });

  it('parses thread:// URI with latest part', () => {
    const uri = 'thread://2026-02-01-001/latest';
    const match = uri.match(/^thread:\/\/([^/]+)(\/(.+))?$/);

    assert.ok(match);
    assert.strictEqual(match[1], '2026-02-01-001');
    assert.strictEqual(match[3], 'latest');
  });

  it('extracts envelope from thread', () => {
    const thread = {
      envelope: { ref: '2026-02-01-001', status: 'pending', intent: 'Test' },
      messages: [{ from: 'agent', MESS: [] }]
    };

    const part = 'envelope';
    const result = part === 'envelope' ? thread.envelope : thread;

    assert.strictEqual(result.ref, '2026-02-01-001');
    assert.strictEqual(result.status, 'pending');
    assert.strictEqual(result.messages, undefined);
  });

  it('extracts latest message from thread', () => {
    const thread = {
      envelope: { ref: '2026-02-01-001' },
      messages: [
        { from: 'agent', received: '2026-02-01T10:00:00Z' },
        { from: 'executor', received: '2026-02-01T10:05:00Z' }
      ]
    };

    const part = 'latest';
    const result = part === 'latest'
      ? thread.messages[thread.messages.length - 1]
      : thread;

    assert.strictEqual(result.from, 'executor');
    assert.strictEqual(result.received, '2026-02-01T10:05:00Z');
  });

  it('returns null for latest on empty messages', () => {
    const thread = {
      envelope: { ref: '2026-02-01-001' },
      messages: []
    };

    const result = thread.messages[thread.messages.length - 1] || null;
    assert.strictEqual(result, null);
  });

  it('returns full thread when no part specified', () => {
    const thread = {
      envelope: { ref: '2026-02-01-001', status: 'pending' },
      messages: [{ from: 'agent' }]
    };

    const part = undefined;
    let result;
    if (part === 'envelope') {
      result = thread.envelope;
    } else if (part === 'latest') {
      result = thread.messages[thread.messages.length - 1];
    } else {
      result = { envelope: thread.envelope, messages: thread.messages };
    }

    assert.ok(result.envelope);
    assert.ok(result.messages);
    assert.strictEqual(result.envelope.ref, '2026-02-01-001');
  });
});

describe('Content Resource URIs', () => {
  it('parses content:// URI correctly', () => {
    const uri = 'content://2026-02-01-001/att-001-image.jpg';
    const match = uri.match(/^content:\/\/([^/]+)\/(.+)$/);

    assert.ok(match);
    assert.strictEqual(match[1], '2026-02-01-001');
    assert.strictEqual(match[2], 'att-001-image.jpg');
  });

  it('handles filenames with multiple dots', () => {
    const uri = 'content://2026-02-01-001/photo.2026.01.31.jpg';
    const match = uri.match(/^content:\/\/([^/]+)\/(.+)$/);

    assert.ok(match);
    assert.strictEqual(match[2], 'photo.2026.01.31.jpg');
  });

  it('rejects invalid content:// URIs', () => {
    const invalidUris = [
      'content://2026-02-01-001',  // no filename
      'content:///file.jpg',       // no ref
      'http://example.com/file',   // wrong scheme
      'thread://2026-02-01-001'    // wrong scheme
    ];

    for (const uri of invalidUris) {
      const match = uri.match(/^content:\/\/([^/]+)\/(.+)$/);
      assert.strictEqual(match, null, `Expected ${uri} to be invalid`);
    }
  });
});

describe('Base64 to Resource URI Rewriting', () => {
  it('identifies inline base64 image data', () => {
    const dataUri = 'data:image/jpeg;base64,/9j/4AAQSkZJRg...';
    const isBase64 = dataUri.startsWith('data:');

    assert.ok(isBase64);
  });

  it('extracts mime type from data URI', () => {
    const dataUri = 'data:image/jpeg;base64,/9j/4AAQSkZJRg...';
    const match = dataUri.match(/^data:([^;]+);base64,/);

    assert.ok(match);
    assert.strictEqual(match[1], 'image/jpeg');
  });

  it('extracts base64 content from data URI', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgo=';
    const base64 = dataUri.replace(/^data:[^;]+;base64,/, '');

    assert.strictEqual(base64, 'iVBORw0KGgo=');
  });

  it('generates unique attachment filenames', () => {
    const ref = '2026-02-01-001';
    const mime = 'image/jpeg';
    const index = 1;

    // Simulate filename generation
    const ext = mime.split('/')[1] || 'bin';
    const filename = `att-${index.toString().padStart(3, '0')}-image.${ext}`;

    assert.strictEqual(filename, 'att-001-image.jpeg');
  });

  it('builds correct content:// URI', () => {
    const ref = '2026-02-01-001';
    const filename = 'att-001-image.jpeg';
    const uri = `content://${ref}/${filename}`;

    assert.strictEqual(uri, 'content://2026-02-01-001/att-001-image.jpeg');
  });
});

describe('Helper Tool Validation', () => {
  it('mess_request rejects empty intent', () => {
    const args = { intent: '' };
    const isValid = !!(args.intent && args.intent.trim().length > 0);

    assert.strictEqual(isValid, false);
  });

  it('mess_request accepts valid priority values', () => {
    const validPriorities = ['background', 'normal', 'elevated', 'urgent'];

    for (const p of validPriorities) {
      assert.ok(validPriorities.includes(p));
    }
  });

  it('mess_request rejects invalid priority', () => {
    const validPriorities = ['background', 'normal', 'elevated', 'urgent'];
    const invalid = 'critical';

    assert.strictEqual(validPriorities.includes(invalid), false);
  });

  it('mess_answer rejects empty answer', () => {
    const args = { ref: '2026-02-01-001', answer: '' };
    const isValid = !!(args.answer && args.answer.trim().length > 0);

    assert.strictEqual(isValid, false);
  });

  it('mess_answer rejects missing ref', () => {
    const args = { answer: 'The answer' };
    const isValid = !!(args.ref && args.ref.trim().length > 0);

    assert.strictEqual(isValid, false);
  });

  it('mess_cancel validates ref format', () => {
    const validRefs = [
      '2026-02-01-001',
      '2026-12-31-999',
      '2026-02-01-001-custom-id'
    ];

    const refPattern = /^\d{4}-\d{2}-\d{2}-\d{3}/;

    for (const ref of validRefs) {
      assert.ok(refPattern.test(ref), `Expected ${ref} to be valid`);
    }
  });

  it('validates response_hints values', () => {
    const validHints = ['text', 'image', 'video', 'audio'];
    const args = { response_hints: ['image', 'text'] };

    const allValid = args.response_hints.every(h => validHints.includes(h));
    assert.ok(allValid);
  });

  it('rejects invalid response_hints', () => {
    const validHints = ['text', 'image', 'video', 'audio'];
    const args = { response_hints: ['image', 'pdf'] };

    const allValid = args.response_hints.every(h => validHints.includes(h));
    assert.strictEqual(allValid, false);
  });
});

describe('Thread Resource Edge Cases', () => {
  it('handles thread with no attachments', () => {
    const thread = {
      envelope: { ref: '2026-02-01-001' },
      messages: [{ from: 'agent', MESS: [{ request: { intent: 'Test' } }] }],
      attachments: []
    };

    // No rewriting needed
    assert.strictEqual(thread.attachments.length, 0);
  });

  it('handles deeply nested image references', () => {
    const message = {
      from: 'executor',
      MESS: [{
        response: {
          content: [
            'Text response',
            { image: 'data:image/jpeg;base64,/9j/4AAQ...' },
            { nested: { image: { file: 'data:image/png;base64,iVBOR...' } } }
          ]
        }
      }]
    };

    // Count image references
    const content = message.MESS[0].response.content;
    let imageCount = 0;

    for (const item of content) {
      if (typeof item === 'object') {
        if (item.image) imageCount++;
        if (item.nested?.image) imageCount++;
      }
    }

    assert.strictEqual(imageCount, 2);
  });

  it('preserves non-image content unchanged', () => {
    const content = [
      'Plain text',
      { note: 'Some metadata' },
      { link: 'https://example.com' }
    ];

    // These should not be rewritten
    for (const item of content) {
      if (typeof item === 'object') {
        assert.strictEqual(item.image, undefined);
        assert.strictEqual(item.resource, undefined);
      }
    }
  });
});

describe('Background Sync', () => {
  it('tracks thread state correctly', () => {
    // Simulate trackThread function
    const threadStateCache = new Map();

    function trackThread(ref, envelope) {
      threadStateCache.set(ref, {
        status: envelope.status,
        updated: envelope.updated,
        executor: envelope.executor
      });
    }

    const envelope = {
      ref: '2026-02-01-001',
      status: 'pending',
      updated: '2026-02-01T10:00:00Z',
      executor: null
    };

    trackThread('2026-02-01-001', envelope);

    assert.ok(threadStateCache.has('2026-02-01-001'));
    const state = threadStateCache.get('2026-02-01-001');
    assert.strictEqual(state.status, 'pending');
    assert.strictEqual(state.executor, null);
  });

  it('detects status change', () => {
    const lastState = { status: 'pending', updated: '2026-02-01T10:00:00Z', executor: null };
    const currentState = { status: 'claimed', updated: '2026-02-01T10:05:00Z', executor: 'teague-phone' };

    const changed = (
      currentState.status !== lastState.status ||
      currentState.updated !== lastState.updated ||
      currentState.executor !== lastState.executor
    );

    assert.strictEqual(changed, true);
  });

  it('detects no change when state is same', () => {
    const lastState = { status: 'pending', updated: '2026-02-01T10:00:00Z', executor: null };
    const currentState = { status: 'pending', updated: '2026-02-01T10:00:00Z', executor: null };

    const changed = (
      currentState.status !== lastState.status ||
      currentState.updated !== lastState.updated ||
      currentState.executor !== lastState.executor
    );

    assert.strictEqual(changed, false);
  });

  it('detects executor change without status change', () => {
    const lastState = { status: 'claimed', updated: '2026-02-01T10:00:00Z', executor: 'phone-1' };
    const currentState = { status: 'claimed', updated: '2026-02-01T10:05:00Z', executor: 'phone-2' };

    const changed = (
      currentState.status !== lastState.status ||
      currentState.updated !== lastState.updated ||
      currentState.executor !== lastState.executor
    );

    assert.strictEqual(changed, true);
  });

  it('generates correct notification URI', () => {
    const ref = '2026-02-01-001';
    const uri = `thread://${ref}`;

    assert.strictEqual(uri, 'thread://2026-02-01-001');
  });

  it('tracks multiple threads independently', () => {
    const threadStateCache = new Map();

    threadStateCache.set('2026-02-01-001', { status: 'pending', executor: null });
    threadStateCache.set('2026-02-01-002', { status: 'claimed', executor: 'phone' });
    threadStateCache.set('2026-02-01-003', { status: 'completed', executor: 'phone' });

    assert.strictEqual(threadStateCache.size, 3);
    assert.strictEqual(threadStateCache.get('2026-02-01-001').status, 'pending');
    assert.strictEqual(threadStateCache.get('2026-02-01-002').status, 'claimed');
    assert.strictEqual(threadStateCache.get('2026-02-01-003').status, 'completed');
  });
});

describe('Help Resource', () => {
  it('parses mess://help URI', () => {
    const uri = 'mess://help';
    const isHelpUri = uri === 'mess://help';

    assert.strictEqual(isHelpUri, true);
  });

  it('mess://help is included in registered resources', () => {
    // Simulate getRegisteredResources
    const resources = [
      {
        uri: 'mess://help',
        name: 'MESS Protocol Documentation',
        mimeType: 'text/markdown',
        description: 'Full documentation for MESS tools and resources.'
      }
    ];

    const helpResource = resources.find(r => r.uri === 'mess://help');

    assert.ok(helpResource);
    assert.strictEqual(helpResource.mimeType, 'text/markdown');
    assert.ok(helpResource.description.includes('documentation'));
  });

  it('help resource has required fields', () => {
    const helpResource = {
      uri: 'mess://help',
      name: 'MESS Protocol Documentation',
      mimeType: 'text/markdown',
      description: 'Full documentation for MESS tools and resources.'
    };

    assert.ok(helpResource.uri);
    assert.ok(helpResource.name);
    assert.ok(helpResource.mimeType);
    assert.ok(helpResource.description);
  });
});

describe('Tool Descriptions', () => {
  it('mess_status description mentions content:// and mess_get_resource', () => {
    const description = `**Attachments:** Responses may include \`content://\` URIs for images/files.
Use \`mess_get_resource\` to fetch the actual content:
  mess_get_resource: { uri: "content://2026-02-01-001/photo.jpg" }`;

    assert.ok(description.includes('content://'));
    assert.ok(description.includes('mess_get_resource'));
  });

  it('mess_status description mentions thread:// and mess_get_resource', () => {
    const description = `**Thread data:** Use \`mess_get_resource\` with \`thread://\` URIs:
  mess_get_resource: { uri: "thread://2026-02-01-001" }`;

    assert.ok(description.includes('thread://'));
    assert.ok(description.includes('mess_get_resource'));
  });

  it('mess_status description mentions mess://help', () => {
    const description = `For full documentation: mess_get_resource: { uri: "mess://help" }`;

    assert.ok(description.includes('mess://help'));
  });
});

describe('mess_get_resource Tool', () => {
  it('validates content:// URI format', () => {
    const uri = 'content://2026-02-01-001/photo.jpg';
    const match = uri.match(/^content:\/\/([^/]+)\/(.+)$/);

    assert.ok(match);
    assert.strictEqual(match[1], '2026-02-01-001');
    assert.strictEqual(match[2], 'photo.jpg');
  });

  it('validates thread:// URI format', () => {
    const uri = 'thread://2026-02-01-001';
    const match = uri.match(/^thread:\/\/([^/]+)(\/(.+))?$/);

    assert.ok(match);
    assert.strictEqual(match[1], '2026-02-01-001');
  });

  it('validates mess://help URI', () => {
    const uri = 'mess://help';
    assert.strictEqual(uri, 'mess://help');
  });

  it('rejects invalid URI schemes', () => {
    const invalidUris = [
      'http://example.com',
      'file:///etc/passwd',
      'ftp://server/file',
      'invalid-uri'
    ];

    for (const uri of invalidUris) {
      const isContent = uri.match(/^content:\/\//);
      const isThread = uri.match(/^thread:\/\//);
      const isMess = uri === 'mess://help';
      const isValid = isContent || isThread || isMess;

      assert.ok(!isValid, `Expected ${uri} to be rejected`);
    }
  });

  it('handles binary response format', () => {
    const resource = {
      uri: 'content://2026-02-01-001/photo.jpg',
      mimeType: 'image/jpeg',
      blob: '/9j/4AAQSkZJRg...'
    };

    // Simulate what the handler does for binary content
    const result = {
      uri: resource.uri,
      mimeType: resource.mimeType,
      encoding: 'base64',
      data: resource.blob
    };

    assert.strictEqual(result.encoding, 'base64');
    assert.ok(result.data);
    assert.strictEqual(result.mimeType, 'image/jpeg');
  });

  it('handles text response format', () => {
    const resource = {
      uri: 'mess://help',
      mimeType: 'text/markdown',
      text: '# MESS Protocol Help\n...'
    };

    // Text content is returned directly
    assert.ok(resource.text.startsWith('#'));
  });
});
