#!/usr/bin/env node
/**
 * MESS MCP Server with GitHub Sync
 * 
 * Modes:
 * - Local only: MESS_DIR=~/.mess
 * - GitHub sync: MESS_GITHUB_REPO=user/repo MESS_GITHUB_TOKEN=ghp_xxx
 * - GitHub only: MESS_GITHUB_REPO + MESS_GITHUB_ONLY=true
 * 
 * With sync enabled, local changes push to GitHub, and periodically pulls.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import YAML from 'yaml';

// Config
const MESS_DIR = process.env.MESS_DIR || path.join(process.env.HOME, '.mess');
const GITHUB_REPO = process.env.MESS_GITHUB_REPO; // format: owner/repo
const GITHUB_TOKEN = process.env.MESS_GITHUB_TOKEN;
const GITHUB_ONLY = process.env.MESS_GITHUB_ONLY === 'true';
const AGENT_ID = process.env.MESS_AGENT_ID || 'claude-agent';

const STATUS_FOLDERS = {
  pending: 'received', claimed: 'executing', in_progress: 'executing',
  waiting: 'executing', held: 'executing', needs_input: 'executing',
  needs_confirmation: 'executing', completed: 'finished', partial: 'finished',
  failed: 'canceled', declined: 'canceled', cancelled: 'canceled',
  expired: 'canceled', delegated: 'canceled', superseded: 'canceled'
};

// ============ GitHub API ============
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

let github = null;
if (GITHUB_REPO && GITHUB_TOKEN) {
  github = new GitHubAPI(GITHUB_REPO, GITHUB_TOKEN);
  console.error(`GitHub sync enabled: ${GITHUB_REPO}`);
}

// ============ Local File Operations ============
async function ensureDirs() {
  if (GITHUB_ONLY) return;
  for (const dir of ['received', 'executing', 'finished', 'canceled']) {
    await fs.mkdir(path.join(MESS_DIR, dir), { recursive: true });
  }
}

async function generateRef() {
  const today = new Date().toISOString().split('T')[0];
  
  // Check both local and GitHub for existing refs
  let maxNum = 0;
  
  if (!GITHUB_ONLY) {
    try {
      for (const folder of ['received', 'executing', 'finished', 'canceled']) {
        const files = await fs.readdir(path.join(MESS_DIR, folder)).catch(() => []);
        for (const f of files) {
          if (f.startsWith(today)) {
            const num = parseInt(f.split('-')[3]?.split('.')[0] || '0');
            if (num > maxNum) maxNum = num;
          }
        }
      }
    } catch (e) {}
  }
  
  if (github) {
    for (const folder of ['received', 'executing', 'finished', 'canceled']) {
      const files = await github.listFolder(folder);
      for (const f of files) {
        if (f.name.startsWith(today)) {
          const num = parseInt(f.name.split('-')[3]?.split('.')[0] || '0');
          if (num > maxNum) maxNum = num;
        }
      }
    }
  }
  
  return `${today}-${(maxNum + 1).toString().padStart(3, '0')}`;
}

function serializeThread(envelope, messages) {
  return [envelope, ...messages].map(d => YAML.stringify(d, { lineWidth: -1 })).join('---\n');
}

function parseThread(content) {
  const docs = content.split(/^---$/m).filter(d => d.trim()).map(d => YAML.parse(d));
  return { envelope: docs[0], messages: docs.slice(1) };
}

async function findThread(ref) {
  // Check local first
  if (!GITHUB_ONLY) {
    for (const folder of ['received', 'executing', 'finished', 'canceled']) {
      const filePath = path.join(MESS_DIR, folder, `${ref}.messe-af.yaml`);
      try {
        await fs.access(filePath);
        const content = await fs.readFile(filePath, 'utf-8');
        return { folder, filePath, content, source: 'local' };
      } catch (e) {}
    }
  }
  
  // Check GitHub
  if (github) {
    for (const folder of ['received', 'executing', 'finished', 'canceled']) {
      const ghPath = `exchange/${folder}/${ref}.messe-af.yaml`;
      const result = await github.getFile(ghPath);
      if (result) {
        return { folder, ghPath, content: result.content, sha: result.sha, source: 'github' };
      }
    }
  }
  
  return null;
}

// ============ Core Operations ============
async function createRequest(from, request) {
  await ensureDirs();
  const ref = await generateRef();
  const now = new Date().toISOString();
  
  const envelope = {
    ref,
    requestor: from,
    executor: null,
    status: 'pending',
    created: now,
    updated: now,
    intent: request.intent || 'Unknown',
    priority: request.priority || 'normal',
    history: [{ action: 'created', at: now, by: from }]
  };
  
  const messages = [
    { from, received: now, channel: 'mcp', MESS: [{ v: '1.0.0' }, { request }] },
    { from: 'exchange', received: now, MESS: [{ ack: { re: 'last', ref } }] }
  ];
  
  const content = serializeThread(envelope, messages);
  
  // Write locally
  if (!GITHUB_ONLY) {
    const filePath = path.join(MESS_DIR, 'received', `${ref}.messe-af.yaml`);
    await fs.writeFile(filePath, content);
  }
  
  // Push to GitHub
  if (github) {
    const ghPath = `exchange/state=received/${ref}.messe-af.yaml`;
    await github.putFile(ghPath, content, `New request: ${request.intent}`);
  }
  
  return { ref, status: 'pending', message: `Request created: ${ref}` };
}

async function updateThread(ref, from, mess, newStatus = null) {
  const found = await findThread(ref);
  if (!found) {
    return { error: `Thread ${ref} not found` };
  }
  
  const { envelope, messages } = parseThread(found.content);
  const now = new Date().toISOString();
  
  // Append message
  messages.push({ from, received: now, channel: 'mcp', MESS: mess });
  
  // Update status if changed
  const oldFolder = STATUS_FOLDERS[envelope.status] || 'received';
  
  if (newStatus && newStatus !== envelope.status) {
    envelope.status = newStatus;
    envelope.updated = now;
    envelope.history.push({ action: newStatus, at: now, by: from });
    
    if (newStatus === 'claimed') {
      envelope.executor = from;
    }
  }
  
  const newFolder = STATUS_FOLDERS[envelope.status] || 'received';
  const content = serializeThread(envelope, messages);
  
  // Update local
  if (!GITHUB_ONLY && found.source === 'local') {
    if (oldFolder !== newFolder) {
      const newPath = path.join(MESS_DIR, newFolder, `${ref}.messe-af.yaml`);
      await fs.writeFile(newPath, content);
      await fs.unlink(found.filePath);
    } else {
      await fs.writeFile(found.filePath, content);
    }
  }
  
  // Update GitHub
  if (github) {
    const newGhPath = `exchange/${newFolder}/${ref}.messe-af.yaml`;
    
    if (found.source === 'github') {
      if (oldFolder !== newFolder) {
        // Move: create new, delete old
        await github.putFile(newGhPath, content, `${newStatus || 'Update'}: ${envelope.intent}`);
        await github.deleteFile(found.ghPath, found.sha, `Move to ${newFolder}`);
      } else {
        await github.putFile(found.ghPath, content, `Update: ${envelope.intent}`, found.sha);
      }
    } else {
      // Local source, push to GitHub
      const existing = await github.getFile(newGhPath);
      await github.putFile(newGhPath, content, `Sync: ${envelope.intent}`, existing?.sha);
    }
  }
  
  return { ref, status: envelope.status };
}

async function getStatus(ref) {
  if (ref) {
    const found = await findThread(ref);
    if (!found) return { error: `Thread ${ref} not found` };
    
    const { envelope, messages } = parseThread(found.content);
    return { ...envelope, messages, folder: found.folder, source: found.source };
  }
  
  // List all active threads
  const results = [];
  
  for (const folder of ['received', 'executing']) {
    // Local
    if (!GITHUB_ONLY) {
      try {
        const files = await fs.readdir(path.join(MESS_DIR, folder));
        for (const f of files) {
          if (f.endsWith('.messe-af.yaml')) {
            const content = await fs.readFile(path.join(MESS_DIR, folder, f), 'utf-8');
            const { envelope } = parseThread(content);
            results.push({ ...envelope, folder, source: 'local' });
          }
        }
      } catch (e) {}
    }
    
    // GitHub (only if not already found locally)
    if (github) {
      const files = await github.listFolder(folder);
      for (const f of files) {
        const ref = f.name.replace('.messe-af.yaml', '');
        if (!results.some(r => r.ref === ref)) {
          const result = await github.getFile(`exchange/${folder}/${f.name}`);
          if (result) {
            const { envelope } = parseThread(result.content);
            results.push({ ...envelope, folder, source: 'github' });
          }
        }
      }
    }
  }
  
  return results.sort((a, b) => new Date(b.updated) - new Date(a.updated));
}

// ============ MCP Server ============
const server = new Server(
  { name: 'mess', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'mess',
      description: `Send a MESS protocol message to request physical-world tasks from human executors.

Use this to:
- Request someone check on something (garage door, fridge, weather)
- Ask someone to do a physical task (water plants, pick up item)
- Get real-world information requiring human observation

The message should be YAML with a request block:
- intent: What you need (required)
- context: List of relevant context (optional)
- priority: background/normal/elevated/urgent (optional)
- response_hint: What response type [text, image] (optional)

Example:
\`\`\`yaml
- v: 1.0.0
- request:
    intent: Check if the garage door is closed
    context:
      - Getting ready for bed
    response_hint:
      - image
\`\`\`

${github ? `\n📡 GitHub sync: ${GITHUB_REPO}` : '📁 Local mode: ' + MESS_DIR}`,
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'YAML-formatted MESS message' }
        },
        required: ['message']
      }
    },
    {
      name: 'mess_status',
      description: `Check status of MESS requests.

Without ref: Returns all pending/in-progress requests.
With ref: Returns full details including message history.

Use to:
- See if any requests need attention
- Check if a request was completed
- Get responses from completed requests`,
      inputSchema: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Specific thread ref (e.g., "2026-01-31-001")' }
        }
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    if (name === 'mess') {
      const mess = YAML.parse(args.message);
      const hasRequest = mess.some(m => m.request);
      
      let result;
      if (hasRequest) {
        const req = mess.find(m => m.request)?.request;
        result = await createRequest(AGENT_ID, req);
      } else {
        const statusItem = mess.find(m => m.status);
        const cancelItem = mess.find(m => m.cancel);
        const ref = statusItem?.status?.re || cancelItem?.cancel?.re;
        
        if (!ref) {
          result = { error: 'Missing re: field' };
        } else {
          const newStatus = cancelItem ? 'cancelled' : statusItem?.status?.code;
          result = await updateThread(ref, AGENT_ID, mess, newStatus);
        }
      }
      
      return { content: [{ type: 'text', text: YAML.stringify(result) }] };
    }
    
    if (name === 'mess_status') {
      const result = await getStatus(args.ref);
      return { content: [{ type: 'text', text: YAML.stringify(result) }] };
    }
    
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
  }
});

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`MESS MCP Server started`);
console.error(`  Local: ${GITHUB_ONLY ? 'disabled' : MESS_DIR}`);
console.error(`  GitHub: ${github ? GITHUB_REPO : 'disabled'}`);
