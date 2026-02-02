// Mock GitHub API responses for testing

export const mockRepo = {
  full_name: 'testuser/mess-exchange',
  private: true,
  permissions: { push: true, pull: true }
};

export const mockThread = {
  ref: '2026-02-01-001',
  requestor: 'claude-desktop',
  executor: null,
  status: 'pending',
  created: '2026-02-01T10:00:00Z',
  updated: '2026-02-01T10:00:00Z',
  intent: 'Check if the garage door is closed',
  priority: 'normal',
  history: [
    { action: 'created', at: '2026-02-01T10:00:00Z', by: 'claude-desktop' }
  ]
};

export const mockMessages = [
  {
    from: 'claude-desktop',
    received: '2026-02-01T10:00:00Z',
    channel: 'mcp',
    MESS: [
      { v: '1.0.0' },
      {
        request: {
          intent: 'Check if the garage door is closed',
          context: ['Getting ready for bed'],
          response_hint: ['image']
        }
      }
    ]
  },
  {
    from: 'exchange',
    received: '2026-02-01T10:00:00Z',
    MESS: [{ ack: { re: 'last', ref: '2026-02-01-001' } }]
  }
];

export const mockClaimedThread = {
  ...mockThread,
  status: 'claimed',
  executor: 'test-executor',
  updated: '2026-02-01T10:05:00Z',
  history: [
    ...mockThread.history,
    { action: 'claimed', at: '2026-02-01T10:05:00Z', by: 'test-executor' }
  ]
};

export const mockCompletedThread = {
  ...mockClaimedThread,
  status: 'completed',
  updated: '2026-02-01T10:10:00Z',
  history: [
    ...mockClaimedThread.history,
    { action: 'completed', at: '2026-02-01T10:10:00Z', by: 'test-executor' }
  ]
};

// Serialize thread to YAML format (multi-doc)
// Using JSON-style YAML which js-yaml can parse
export function serializeThread(envelope, messages) {
  const docs = [envelope, ...messages];
  return docs.map(d => JSON.stringify(d, null, 2)
    .replace(/"/g, '')  // Remove quotes for simple values
    .replace(/\{/g, '')
    .replace(/\}/g, '')
    .replace(/,\n/g, '\n')
    .replace(/^\s*\n/gm, '')  // Remove empty lines
  ).join('---\n');
}

// Alternative: use actual YAML string literals for reliability
export function getThreadYaml(envelope, messages) {
  // Generate proper YAML that js-yaml will parse correctly
  const yaml = `ref: ${envelope.ref}
requestor: ${envelope.requestor}
executor: ${envelope.executor || 'null'}
status: ${envelope.status}
created: ${envelope.created}
updated: ${envelope.updated}
intent: ${envelope.intent}
priority: ${envelope.priority}
history:
${envelope.history.map(h => `  - action: ${h.action}
    at: ${h.at}
    by: ${h.by}`).join('\n')}
---
from: ${messages[0].from}
received: ${messages[0].received}
channel: ${messages[0].channel}
MESS:
  - v: "1.0.0"
  - request:
      intent: ${envelope.intent}
      context:
        - Getting ready for bed
      response_hint:
        - image
---
from: exchange
received: ${messages[1].received}
MESS:
  - ack:
      re: last
      ref: ${envelope.ref}`;
  return yaml;
}

// Base64 encode content (for GitHub API mock)
export function encodeContent(content) {
  return Buffer.from(content).toString('base64');
}

// Create a mock file list response
export function mockFileList(threads, folder = 'received') {
  return threads.map(t => ({
    name: `${t.ref}.messe-af.yaml`,
    path: `exchange/state=${folder}/${t.ref}.messe-af.yaml`,
    sha: `sha-${t.ref}`,
    type: 'file'
  }));
}

// Create a mock file content response
export function mockFileContent(envelope, messages, path) {
  const content = getThreadYaml(envelope, messages);
  return {
    name: `${envelope.ref}.messe-af.yaml`,
    path,
    sha: `sha-${envelope.ref}`,
    content: encodeContent(content),
    encoding: 'base64'
  };
}

// ============ V2 Directory Format Helpers ============

// Create a mock v2 directory listing
export function mockV2DirectoryList(ref) {
  return [
    { name: `000-${ref}.messe-af.yaml`, type: 'file', sha: `sha-000-${ref}` }
  ];
}

// Create a mock v2 file list response (for listFolder)
export function mockV2FileList(threads) {
  return threads.map(t => ({
    name: t.ref,
    path: `exchange/state=received/${t.ref}`,
    sha: `sha-dir-${t.ref}`,
    type: 'dir'
  }));
}

// Create a mock v2 file content (for getFile inside directory)
export function mockV2FileContent(envelope, messages, ref) {
  const content = getThreadYaml(envelope, messages);
  return {
    name: `000-${ref}.messe-af.yaml`,
    path: `exchange/state=received/${ref}/000-${ref}.messe-af.yaml`,
    sha: `sha-000-${ref}`,
    content: encodeContent(content),
    encoding: 'base64'
  };
}
