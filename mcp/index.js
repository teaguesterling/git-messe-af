#!/usr/bin/env node
/**
 * MESS MCP Server with GitHub Sync (v2 - Directory-based storage)
 *
 * Modes:
 * - Local only: MESS_DIR (defaults to ../exchange relative to this script)
 * - GitHub sync: MESS_GITHUB_REPO=user/repo MESS_GITHUB_TOKEN=ghp_xxx
 * - GitHub only: MESS_GITHUB_REPO + MESS_GITHUB_ONLY=true
 *
 * Storage uses Hive partitioning: exchange/state=received/, exchange/state=executing/, etc.
 * V2 format: Each thread is a directory containing numbered YAML files and external attachments.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import YAML from 'yaml';

// Import shared MESSE-AF library
import {
  parseThread,
  parseThreadV1,
  serializeThread,
  getAttachmentType,
  getExtensionFromMime,
  sanitizeFilename,
  getFolderForStatus,
  STATUS_FOLDERS,
  MAX_FILE_SIZE,
  MAX_INLINE_SIZE,
  rewriteToResourceURIs
} from '@messe-af/core';

// Config
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const MESS_DIR = process.env.MESS_DIR || path.join(__dirname, '..', 'exchange');
const CAPABILITIES_DIR = process.env.MESS_CAPABILITIES_DIR || path.join(__dirname, '..', 'capabilities');
const GITHUB_REPO = process.env.MESS_GITHUB_REPO; // format: owner/repo
const GITHUB_TOKEN = process.env.MESS_GITHUB_TOKEN;
const GITHUB_ONLY = process.env.MESS_GITHUB_ONLY === 'true';
const AGENT_ID = process.env.MESS_AGENT_ID || 'claude-agent';

// Capabilities cache
let capabilitiesCache = null;
let capabilitiesCacheTime = 0;
const CAPABILITIES_CACHE_TTL = 60000; // 1 minute

// Attachment cache directory
const CACHE_DIR = process.env.MESS_CACHE_DIR || path.join(os.tmpdir(), 'mess-attachments');

// In-memory registry of cached resources (thread -> attachments)
const resourceRegistry = new Map();

// Background sync configuration
const SYNC_ENABLED = process.env.MESS_SYNC_ENABLED !== 'false'; // enabled by default
const SYNC_INTERVAL = parseInt(process.env.MESS_SYNC_INTERVAL || '30000', 10); // 30 seconds default

// Thread state tracking for change detection
const threadStateCache = new Map(); // ref -> { status, updated, executor }

/**
 * Cache an attachment and register it as a resource
 * @param {string} ref - Thread reference
 * @param {string} filename - Attachment filename
 * @param {string} base64Data - Base64 encoded content
 * @param {string} mime - MIME type
 */
async function cacheAttachment(ref, filename, base64Data, mime) {
  const threadCacheDir = path.join(CACHE_DIR, ref);
  await fs.mkdir(threadCacheDir, { recursive: true });

  const filePath = path.join(threadCacheDir, filename);
  await fs.writeFile(filePath, Buffer.from(base64Data, 'base64'));

  // Register in resource registry
  if (!resourceRegistry.has(ref)) {
    resourceRegistry.set(ref, new Map());
  }
  resourceRegistry.get(ref).set(filename, { path: filePath, mime });

  return filePath;
}

/**
 * Get all registered resources
 * @returns {Array} List of resource descriptors
 */
function getRegisteredResources() {
  const resources = [
    // Always include the help resource
    {
      uri: 'mess://help',
      name: 'MESS Protocol Documentation',
      mimeType: 'text/markdown',
      description: 'Full documentation for MESS tools and resources. Read this to learn how to use MESS effectively.'
    }
  ];
  for (const [ref, attachments] of resourceRegistry) {
    for (const [filename, info] of attachments) {
      resources.push({
        uri: `content://${ref}/${filename}`,
        name: filename,
        mimeType: info.mime,
        description: `Attachment from thread ${ref}`
      });
    }
  }
  return resources;
}

/**
 * Read a resource by URI
 * @param {string} uri - Resource URI (content://ref/filename, thread://ref[/part], or mess://help)
 * @returns {Object} Resource content
 */
async function readResource(uri) {
  // Handle mess://help - return SKILL.md documentation
  if (uri === 'mess://help') {
    const skillPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'SKILL.md');
    try {
      const content = await fs.readFile(skillPath, 'utf8');
      return {
        uri,
        mimeType: 'text/markdown',
        text: content
      };
    } catch (e) {
      // Fallback to inline help if file not found
      return {
        uri,
        mimeType: 'text/markdown',
        text: `# MESS Protocol Help

## Tools
- \`mess_request\` - Create a new physical-world task request
- \`mess_status\` - Check status of requests (returns content:// URIs for attachments)
- \`mess_answer\` - Answer executor questions (when status is needs_input)
- \`mess_cancel\` - Cancel a request
- \`mess_capabilities\` - List available capabilities

## Resources
- \`content://{ref}/{filename}\` - Fetch attachment content (images, files)
- \`thread://{ref}\` - Get full thread data
- \`thread://{ref}/envelope\` - Get thread metadata only
- \`thread://{ref}/latest\` - Get most recent message

## Fetching Attachments
When \`mess_status\` returns a \`content://\` URI, use MCP resources/read to fetch it.
The content will be returned as base64-encoded data.

## Status Codes
pending → claimed → in_progress → completed/failed/needs_input
`
      };
    }
  }

  // Handle thread:// URIs
  const threadMatch = uri.match(/^thread:\/\/([^/]+)(\/(.+))?$/);
  if (threadMatch) {
    const [, ref, , part] = threadMatch;
    return await readThreadResource(ref, part);
  }

  // Handle content:// URIs (attachments)
  const match = uri.match(/^content:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid resource URI: ${uri}`);
  }

  const [, ref, filename] = match;

  // Check registry first
  const threadResources = resourceRegistry.get(ref);
  if (threadResources?.has(filename)) {
    const info = threadResources.get(filename);

    // If content is stored directly in registry
    if (info.content) {
      return {
        uri,
        mimeType: info.mime,
        blob: info.content
      };
    }

    // If content is cached to file
    if (info.path) {
      const data = await fs.readFile(info.path);
      return {
        uri,
        mimeType: info.mime,
        blob: data.toString('base64')
      };
    }
  }

  // Try to load from thread directory (for pre-existing attachments)
  const thread = await findThread(ref);
  if (thread) {
    const att = thread.attachments?.find(a => a.name === filename);
    if (att) {
      // If it's already base64, return directly
      if (att.content) {
        const mime = att.mime || guessMimeType(filename);
        return {
          uri,
          mimeType: mime,
          blob: att.content
        };
      }
    }
  }

  throw new Error(`Resource not found: ${uri}`);
}

/**
 * Read a thread resource
 * @param {string} ref - Thread ref
 * @param {string} part - Optional part: 'envelope', 'latest', or undefined for full thread
 * @returns {Object} Resource content with content:// URIs for attachments
 */
async function readThreadResource(ref, part) {
  const thread = await findThread(ref);
  if (!thread) {
    throw new Error(`Thread not found: ${ref}`);
  }

  // Rewrite inline base64 to content:// URIs
  const rewritten = rewriteToResourceURIs(thread, {
    cacheAttachment: (att) => {
      // Register attachments for content:// access
      if (!resourceRegistry.has(ref)) {
        resourceRegistry.set(ref, new Map());
      }
      const filename = att.name || `attachment-${Date.now()}`;
      resourceRegistry.get(ref).set(filename, {
        mime: att.mime,
        content: att.content
      });
      return `content://${ref}/${filename}`;
    }
  });

  let result;
  if (part === 'envelope') {
    result = rewritten.envelope;
  } else if (part === 'latest') {
    result = rewritten.messages[rewritten.messages.length - 1] || null;
  } else {
    result = {
      envelope: rewritten.envelope,
      messages: rewritten.messages
    };
  }

  return {
    uri: `thread://${ref}${part ? '/' + part : ''}`,
    mimeType: 'application/yaml',
    text: YAML.stringify(result)
  };
}

/**
 * Guess MIME type from filename
 */
function guessMimeType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeTypes = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
    mp3: 'audio/mpeg', mp4: 'video/mp4', txt: 'text/plain'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// ============ Capabilities ============

/**
 * Parse capabilities from multi-doc YAML content
 * @param {string} content - YAML content (may contain multiple docs separated by ---)
 * @returns {Array} List of capabilities
 */
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

/**
 * Load capabilities from local directory
 * @returns {Promise<Array>} List of capabilities
 */
async function loadLocalCapabilities() {
  const capabilities = [];

  try {
    const entries = await fs.readdir(CAPABILITIES_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.yaml')) {
        try {
          const content = await fs.readFile(path.join(CAPABILITIES_DIR, entry.name), 'utf-8');
          capabilities.push(...parseCapabilities(content));
        } catch (e) {
          console.error(`Failed to parse capability ${entry.name}:`, e.message);
        }
      }
    }

    // Sort alphabetically by id
    capabilities.sort((a, b) => a.id.localeCompare(b.id));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error('Failed to load local capabilities:', e.message);
    }
  }

  return capabilities;
}

/**
 * Load capabilities from GitHub
 * @param {GitHubAPI} github - GitHub API client
 * @returns {Promise<Array>} List of capabilities
 */
async function loadGitHubCapabilities(github) {
  const capabilities = [];

  try {
    const entries = await github.getDirectory('capabilities');
    if (!entries) return capabilities;

    for (const entry of entries) {
      if (entry.type === 'file' && entry.name.endsWith('.yaml')) {
        try {
          const result = await github.getFile(`capabilities/${entry.name}`);
          if (result) {
            capabilities.push(...parseCapabilities(result.content));
          }
        } catch (e) {
          console.error(`Failed to parse capability ${entry.name}:`, e.message);
        }
      }
    }

    // Sort alphabetically by id
    capabilities.sort((a, b) => a.id.localeCompare(b.id));
  } catch (e) {
    console.error('Failed to load GitHub capabilities:', e.message);
  }

  return capabilities;
}

/**
 * Get capabilities with caching
 * @returns {Promise<Array>} List of capabilities
 */
async function getCapabilities() {
  const now = Date.now();

  // Return cached if fresh
  if (capabilitiesCache && (now - capabilitiesCacheTime) < CAPABILITIES_CACHE_TTL) {
    return capabilitiesCache;
  }

  let capabilities = [];

  // Load from local first (if not GitHub-only mode)
  if (!GITHUB_ONLY) {
    capabilities = await loadLocalCapabilities();
  }

  // If GitHub is configured and no local capabilities, load from GitHub
  if (capabilities.length === 0 && github) {
    capabilities = await loadGitHubCapabilities(github);
  }

  capabilitiesCache = capabilities;
  capabilitiesCacheTime = now;

  return capabilities;
}

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
      if (e.message.includes('404') || e.message.includes('Not Found')) return null;
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
      const data = await this.request(`/contents/exchange/state=${folder}`);
      return data;
    } catch (e) {
      if (e.message.includes('404') || e.message.includes('Not Found')) return [];
      throw e;
    }
  }

  async deleteFile(path, sha, message) {
    return await this.request(`/contents/${path}`, {
      method: 'DELETE',
      body: JSON.stringify({ message, sha })
    });
  }

  // Get directory contents
  async getDirectory(dirPath) {
    try {
      const data = await this.request(`/contents/${dirPath}`);
      if (!Array.isArray(data)) return null;
      return data;
    } catch (e) {
      if (e.message.includes('404') || e.message.includes('Not Found')) return null;
      throw e;
    }
  }

  // Create directory with files using Git Data API (atomic)
  async createDirectory(dirPath, files, message) {
    // Get current main branch ref
    const refData = await this.request('/git/ref/heads/main');
    const currentCommitSha = refData.object.sha;

    // Get current commit's tree
    const commitData = await this.request(`/git/commits/${currentCommitSha}`);
    const baseTreeSha = commitData.tree.sha;

    // Create tree entries for all files
    const treeEntries = files.map(f => ({
      path: `${dirPath}/${f.name}`,
      mode: '100644',
      type: 'blob',
      content: f.content
    }));

    // Create new tree
    const treeData = await this.request('/git/trees', {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeEntries
      })
    });

    // Create commit
    const newCommit = await this.request('/git/commits', {
      method: 'POST',
      body: JSON.stringify({
        message,
        tree: treeData.sha,
        parents: [currentCommitSha]
      })
    });

    // Update ref
    await this.request('/git/refs/heads/main', {
      method: 'PATCH',
      body: JSON.stringify({ sha: newCommit.sha })
    });

    return newCommit;
  }

  // Move directory atomically using Git Data API
  async moveDirectory(oldDirPath, newDirPath, message, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Get current main branch ref
        const refData = await this.request('/git/ref/heads/main');
        const currentCommitSha = refData.object.sha;

        // Get current commit's tree
        const commitData = await this.request(`/git/commits/${currentCommitSha}`);
        const baseTreeSha = commitData.tree.sha;

        // Get all files in the old directory
        const oldFiles = await this.getDirectory(oldDirPath);
        if (!oldFiles) throw new Error(`Directory not found: ${oldDirPath}`);

        // Create tree entries: delete old files, create new ones
        const treeEntries = [];

        for (const file of oldFiles) {
          // Delete from old location
          treeEntries.push({
            path: `${oldDirPath}/${file.name}`,
            mode: '100644',
            type: 'blob',
            sha: null // null sha = delete
          });

          // Get file content and create at new location
          const fileContent = await this.getFile(`${oldDirPath}/${file.name}`);
          if (fileContent) {
            treeEntries.push({
              path: `${newDirPath}/${file.name}`,
              mode: '100644',
              type: 'blob',
              content: fileContent.content
            });
          }
        }

        // Create new tree
        const treeData = await this.request('/git/trees', {
          method: 'POST',
          body: JSON.stringify({
            base_tree: baseTreeSha,
            tree: treeEntries
          })
        });

        // Create commit
        const newCommit = await this.request('/git/commits', {
          method: 'POST',
          body: JSON.stringify({
            message,
            tree: treeData.sha,
            parents: [currentCommitSha]
          })
        });

        // Update ref
        await this.request('/git/refs/heads/main', {
          method: 'PATCH',
          body: JSON.stringify({ sha: newCommit.sha })
        });

        return newCommit;
      } catch (e) {
        const isConflict = e.message.includes('fast forward') || e.message.includes('422');
        if (isConflict && attempt < retries) {
          await new Promise(r => setTimeout(r, 500 * attempt));
          continue;
        }
        throw e;
      }
    }
  }

  // Update files in a directory atomically
  async updateDirectoryFiles(dirPath, updates, message, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const refData = await this.request('/git/ref/heads/main');
        const currentCommitSha = refData.object.sha;
        const commitData = await this.request(`/git/commits/${currentCommitSha}`);
        const baseTreeSha = commitData.tree.sha;

        // updates is array of { name, content } or { name, sha: null } for delete
        const treeEntries = updates.map(u => ({
          path: `${dirPath}/${u.name}`,
          mode: '100644',
          type: 'blob',
          ...(u.sha === null ? { sha: null } : { content: u.content })
        }));

        const treeData = await this.request('/git/trees', {
          method: 'POST',
          body: JSON.stringify({
            base_tree: baseTreeSha,
            tree: treeEntries
          })
        });

        const newCommit = await this.request('/git/commits', {
          method: 'POST',
          body: JSON.stringify({
            message,
            tree: treeData.sha,
            parents: [currentCommitSha]
          })
        });

        await this.request('/git/refs/heads/main', {
          method: 'PATCH',
          body: JSON.stringify({ sha: newCommit.sha })
        });

        return newCommit;
      } catch (e) {
        const isConflict = e.message.includes('fast forward') || e.message.includes('422');
        if (isConflict && attempt < retries) {
          await new Promise(r => setTimeout(r, 500 * attempt));
          continue;
        }
        throw e;
      }
    }
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
    await fs.mkdir(path.join(MESS_DIR, `state=${dir}`), { recursive: true });
  }
}

async function generateRef() {
  const today = new Date().toISOString().split('T')[0];

  // Check both local and GitHub for existing refs
  let maxNum = 0;

  if (!GITHUB_ONLY) {
    try {
      for (const folder of ['received', 'executing', 'finished', 'canceled']) {
        const folderPath = path.join(MESS_DIR, `state=${folder}`);
        const entries = await fs.readdir(folderPath, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          // Check both directories (v2) and files (v1)
          const name = entry.name.replace('.messe-af.yaml', '');
          if (name.startsWith(today)) {
            const num = parseInt(name.split('-')[3] || '0');
            if (num > maxNum) maxNum = num;
          }
        }
      }
    } catch (e) {}
  }

  if (github) {
    for (const folder of ['received', 'executing', 'finished', 'canceled']) {
      const entries = await github.listFolder(folder);
      for (const entry of entries) {
        const name = entry.name.replace('.messe-af.yaml', '');
        if (name.startsWith(today)) {
          const num = parseInt(name.split('-')[3] || '0');
          if (num > maxNum) maxNum = num;
        }
      }
    }
  }

  return `${today}-${(maxNum + 1).toString().padStart(3, '0')}`;
}

async function findThread(ref) {
  // Check local first
  if (!GITHUB_ONLY) {
    for (const folder of ['received', 'executing', 'finished', 'canceled']) {
      // Check for v2 directory format
      const dirPath = path.join(MESS_DIR, `state=${folder}`, ref);
      try {
        const stat = await fs.stat(dirPath);
        if (stat.isDirectory()) {
          const entries = await fs.readdir(dirPath);
          const files = [];
          for (const entry of entries) {
            const content = await fs.readFile(path.join(dirPath, entry), 'utf-8');
            files.push({ name: entry, content });
          }
          const parsed = parseThread(files);
          return { folder, dirPath, files, ...parsed, source: 'local', format: 'v2' };
        }
      } catch (e) {}

      // Check for v1 flat file format
      const filePath = path.join(MESS_DIR, `state=${folder}`, `${ref}.messe-af.yaml`);
      try {
        await fs.access(filePath);
        const content = await fs.readFile(filePath, 'utf-8');
        const parsed = parseThreadV1(content);
        return { folder, filePath, content, ...parsed, source: 'local', format: 'v1' };
      } catch (e) {}
    }
  }

  // Check GitHub
  if (github) {
    for (const folder of ['received', 'executing', 'finished', 'canceled']) {
      // Check for v2 directory format
      const ghDirPath = `exchange/state=${folder}/${ref}`;
      const dirContents = await github.getDirectory(ghDirPath);
      if (dirContents) {
        const files = [];
        for (const entry of dirContents) {
          if (entry.type === 'file') {
            const fileData = await github.getFile(`${ghDirPath}/${entry.name}`);
            if (fileData) {
              files.push({ name: entry.name, content: fileData.content, sha: fileData.sha });
            }
          }
        }
        const parsed = parseThread(files);
        return { folder, ghDirPath, files, ...parsed, source: 'github', format: 'v2' };
      }

      // Check for v1 flat file format
      const ghFilePath = `exchange/state=${folder}/${ref}.messe-af.yaml`;
      const result = await github.getFile(ghFilePath);
      if (result) {
        const parsed = parseThreadV1(result.content);
        return { folder, ghPath: ghFilePath, content: result.content, sha: result.sha, ...parsed, source: 'github', format: 'v1' };
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

  const files = serializeThread(envelope, messages);

  // Write locally (v2 directory format)
  if (!GITHUB_ONLY) {
    const dirPath = path.join(MESS_DIR, 'state=received', ref);
    await fs.mkdir(dirPath, { recursive: true });
    for (const file of files) {
      const filePath = path.join(dirPath, file.name);
      if (file.binary) {
        await fs.writeFile(filePath, Buffer.from(file.content, 'base64'));
      } else {
        await fs.writeFile(filePath, file.content);
      }
    }
  }

  // Push to GitHub (v2 directory format)
  if (github) {
    const ghDirPath = `exchange/state=received/${ref}`;
    await github.createDirectory(ghDirPath, files, `${ref}: New request`);
  }

  // Track for change notifications
  trackThread(ref, envelope);

  return { ref, status: 'pending', message: `Request created: ${ref}` };
}

async function updateThread(ref, from, mess, newStatus = null) {
  const found = await findThread(ref);
  if (!found) {
    return { error: `Thread ${ref} not found` };
  }

  const now = new Date().toISOString();
  const envelope = { ...found.envelope };
  const messages = [...found.messages];
  const attachments = [...(found.attachments || [])];

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
  const files = serializeThread(envelope, messages, attachments);

  // Handle v1 format - upgrade to v2 on modification
  if (found.format === 'v1') {
    // Local: create directory, delete old file
    if (!GITHUB_ONLY && found.source === 'local') {
      const newDirPath = path.join(MESS_DIR, `state=${newFolder}`, ref);
      await fs.mkdir(newDirPath, { recursive: true });
      for (const file of files) {
        const filePath = path.join(newDirPath, file.name);
        if (file.binary) {
          await fs.writeFile(filePath, Buffer.from(file.content, 'base64'));
        } else {
          await fs.writeFile(filePath, file.content);
        }
      }
      // Delete old v1 file
      await fs.unlink(found.filePath).catch(() => {});
    }

    // GitHub: create directory, delete old file
    if (github && found.source === 'github') {
      const newGhDirPath = `exchange/state=${newFolder}/${ref}`;

      // Use Git Data API to create dir and delete old file atomically
      const refData = await github.request('/git/ref/heads/main');
      const currentCommitSha = refData.object.sha;
      const commitData = await github.request(`/git/commits/${currentCommitSha}`);
      const baseTreeSha = commitData.tree.sha;

      const treeEntries = [
        // Delete old v1 file
        { path: found.ghPath, mode: '100644', type: 'blob', sha: null },
        // Create new v2 files
        ...files.map(f => ({
          path: `${newGhDirPath}/${f.name}`,
          mode: '100644',
          type: 'blob',
          content: f.binary ? Buffer.from(f.content, 'base64').toString('binary') : f.content
        }))
      ];

      const treeData = await github.request('/git/trees', {
        method: 'POST',
        body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries })
      });

      const newCommit = await github.request('/git/commits', {
        method: 'POST',
        body: JSON.stringify({
          message: `${ref}: ${newStatus || 'Update'} (upgraded to v2)`,
          tree: treeData.sha,
          parents: [currentCommitSha]
        })
      });

      await github.request('/git/refs/heads/main', {
        method: 'PATCH',
        body: JSON.stringify({ sha: newCommit.sha })
      });
    }

    return { ref, status: envelope.status };
  }

  // Handle v2 format
  // Local
  if (!GITHUB_ONLY && found.source === 'local') {
    if (oldFolder !== newFolder) {
      // Move directory
      const newDirPath = path.join(MESS_DIR, `state=${newFolder}`, ref);
      await fs.mkdir(newDirPath, { recursive: true });
      for (const file of files) {
        const filePath = path.join(newDirPath, file.name);
        if (file.binary) {
          await fs.writeFile(filePath, Buffer.from(file.content, 'base64'));
        } else {
          await fs.writeFile(filePath, file.content);
        }
      }
      // Remove old directory
      await fs.rm(found.dirPath, { recursive: true }).catch(() => {});
    } else {
      // Update in place
      for (const file of files) {
        const filePath = path.join(found.dirPath, file.name);
        if (file.binary) {
          await fs.writeFile(filePath, Buffer.from(file.content, 'base64'));
        } else {
          await fs.writeFile(filePath, file.content);
        }
      }
    }
  }

  // GitHub
  if (github) {
    const newGhDirPath = `exchange/state=${newFolder}/${ref}`;

    if (found.source === 'github') {
      if (oldFolder !== newFolder) {
        // Move directory atomically
        await github.moveDirectory(found.ghDirPath, newGhDirPath, `${ref}: ${newStatus || 'Update'}`);
        // Then update files if needed
        const updates = files.filter(f => !f.binary).map(f => ({ name: f.name, content: f.content }));
        if (updates.length > 0) {
          await github.updateDirectoryFiles(newGhDirPath, updates, `${ref}: Update content`);
        }
      } else {
        // Update files in place
        const updates = files.filter(f => !f.binary).map(f => ({ name: f.name, content: f.content }));
        await github.updateDirectoryFiles(found.ghDirPath, updates, `${ref}: ${newStatus || 'Update'}`);
      }
    } else {
      // Local source, push to GitHub
      await github.createDirectory(newGhDirPath, files, `${ref}: Sync`);
    }
  }

  return { ref, status: envelope.status };
}

async function getStatus(ref) {
  if (ref) {
    const found = await findThread(ref);
    if (!found) return { error: `Thread ${ref} not found` };

    // Rewrite inline base64 to content:// resource URIs
    const rewritten = rewriteToResourceURIs(
      { envelope: found.envelope, messages: found.messages, attachments: found.attachments },
      { cacheAttachment }
    );

    // Register any existing external attachments as resources
    if (found.attachments) {
      for (const att of found.attachments) {
        if (!resourceRegistry.has(found.envelope.ref)) {
          resourceRegistry.set(found.envelope.ref, new Map());
        }
        const mime = guessMimeType(att.name);
        resourceRegistry.get(found.envelope.ref).set(att.name, {
          path: null, // loaded on-demand from thread
          mime,
          content: att.content
        });
      }
    }

    return {
      ...rewritten.envelope,
      messages: rewritten.messages,
      attachments: found.attachments?.map(a => ({
        name: a.name,
        resource: `content://${found.envelope.ref}/${a.name}`
      })),
      folder: found.folder,
      source: found.source,
      format: found.format
    };
  }

  // List all active threads
  const results = [];

  for (const folder of ['received', 'executing']) {
    // Local
    if (!GITHUB_ONLY) {
      try {
        const folderPath = path.join(MESS_DIR, `state=${folder}`);
        const entries = await fs.readdir(folderPath, { withFileTypes: true });

        for (const entry of entries) {
          try {
            if (entry.isDirectory()) {
              // v2 format
              const dirPath = path.join(folderPath, entry.name);
              const files = await fs.readdir(dirPath);
              const fileContents = [];
              for (const f of files) {
                const content = await fs.readFile(path.join(dirPath, f), 'utf-8');
                fileContents.push({ name: f, content });
              }
              const { envelope } = parseThread(fileContents);
              results.push({ ...envelope, folder, source: 'local', format: 'v2' });
            } else if (entry.name.endsWith('.messe-af.yaml')) {
              // v1 format
              const content = await fs.readFile(path.join(folderPath, entry.name), 'utf-8');
              const { envelope } = parseThreadV1(content);
              results.push({ ...envelope, folder, source: 'local', format: 'v1' });
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    // GitHub (only if not already found locally)
    if (github) {
      const entries = await github.listFolder(folder);

      for (const entry of entries) {
        try {
          if (entry.type === 'dir') {
            // v2 format
            const ref = entry.name;
            if (results.some(r => r.ref === ref)) continue;

            const ghDirPath = `exchange/state=${folder}/${ref}`;
            const dirContents = await github.getDirectory(ghDirPath);
            if (dirContents) {
              const files = [];
              for (const f of dirContents) {
                if (f.type === 'file' && f.name.endsWith('.messe-af.yaml')) {
                  const fileData = await github.getFile(`${ghDirPath}/${f.name}`);
                  if (fileData) {
                    files.push({ name: f.name, content: fileData.content });
                  }
                }
              }
              if (files.length > 0) {
                const { envelope } = parseThread(files);
                results.push({ ...envelope, folder, source: 'github', format: 'v2' });
              }
            }
          } else if (entry.name.endsWith('.messe-af.yaml')) {
            // v1 format
            const ref = entry.name.replace('.messe-af.yaml', '');
            if (results.some(r => r.ref === ref)) continue;

            const result = await github.getFile(`exchange/state=${folder}/${entry.name}`);
            if (result) {
              const { envelope } = parseThreadV1(result.content);
              results.push({ ...envelope, folder, source: 'github', format: 'v1' });
            }
          }
        } catch (e) {}
      }
    }
  }

  return results.sort((a, b) => new Date(b.updated) - new Date(a.updated));
}

// ============ MCP Server ============
const server = new Server(
  { name: 'mess', version: '2.1.0' },
  { capabilities: { tools: {}, resources: {} } }
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
- Get responses from completed requests

**Attachments:** Responses may include \`content://\` URIs for images/files.
These are MCP resources - fetch them using the MCP resources/read protocol.
Example: \`content://2026-02-01-001/photo.jpg\`

**Thread data:** Use \`thread://{ref}\` resources for structured thread access.
Example: \`thread://2026-02-01-001\` or \`thread://2026-02-01-001/latest\`

For full documentation, read the \`mess://help\` resource.`,
      inputSchema: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Specific thread ref (e.g., "2026-01-31-001")' }
        }
      }
    },
    {
      name: 'mess_capabilities',
      description: `List available physical-world capabilities for this exchange.

Returns capabilities that human executors can perform. Each capability has:
- id: Unique identifier
- description: What the capability enables
- tags: Optional searchable tags
- definition: Optional URL to detailed documentation

Use this to understand what kinds of physical-world tasks can be requested.`,
      inputSchema: {
        type: 'object',
        properties: {
          tag: { type: 'string', description: 'Filter by tag (e.g., "security", "attachments")' }
        }
      }
    },
    {
      name: 'mess_request',
      description: `Create a new physical-world task request.

This is a simpler alternative to the raw 'mess' tool for creating requests.
Returns the assigned ref for tracking.`,
      inputSchema: {
        type: 'object',
        properties: {
          intent: { type: 'string', description: 'What you need done (be specific)' },
          context: {
            type: 'array',
            items: { type: 'string' },
            description: 'Relevant context (e.g., "Getting ready for bed")'
          },
          priority: {
            type: 'string',
            enum: ['background', 'normal', 'elevated', 'urgent'],
            description: 'Request priority (default: normal)'
          },
          response_hints: {
            type: 'array',
            items: { type: 'string', enum: ['text', 'image', 'video', 'audio'] },
            description: 'Expected response types'
          }
        },
        required: ['intent']
      }
    },
    {
      name: 'mess_answer',
      description: `Answer an executor's question (when status is needs_input).

Use this to provide clarification when an executor asks for more information.`,
      inputSchema: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Thread ref (e.g., "2026-01-31-001")' },
          answer: { type: 'string', description: 'Your answer to the executor\'s question' }
        },
        required: ['ref', 'answer']
      }
    },
    {
      name: 'mess_cancel',
      description: `Cancel a pending or in-progress request.

Use this when you no longer need the task completed.`,
      inputSchema: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Thread ref to cancel' },
          reason: { type: 'string', description: 'Why you\'re cancelling (optional)' }
        },
        required: ['ref']
      }
    }
  ]
}));

// Resource handlers
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: getRegisteredResources()
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  const content = await readResource(uri);
  return { contents: [content] };
});

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

    if (name === 'mess_capabilities') {
      const capabilities = await getCapabilities();
      let result = capabilities;

      // Filter by tag if specified
      if (args.tag) {
        result = capabilities.filter(c => c.tags?.includes(args.tag));
      }

      return { content: [{ type: 'text', text: YAML.stringify(result) }] };
    }

    if (name === 'mess_request') {
      const req = {
        intent: args.intent,
        context: args.context || [],
        priority: args.priority || 'normal',
        response_hint: args.response_hints || []
      };
      const result = await createRequest(AGENT_ID, req);
      return { content: [{ type: 'text', text: YAML.stringify(result) }] };
    }

    if (name === 'mess_answer') {
      const mess = [{
        answer: {
          re: args.ref,
          value: args.answer
        }
      }];
      const result = await updateThread(args.ref, AGENT_ID, mess);
      return { content: [{ type: 'text', text: YAML.stringify(result) }] };
    }

    if (name === 'mess_cancel') {
      const mess = [{
        cancel: {
          re: args.ref,
          ...(args.reason && { reason: args.reason })
        }
      }];
      const result = await updateThread(args.ref, AGENT_ID, mess, 'cancelled');
      return { content: [{ type: 'text', text: YAML.stringify(result) }] };
    }

    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
  }
});

// ============ Background Sync ============

/**
 * Check for changes to tracked threads and send notifications
 */
async function checkForChanges() {
  if (threadStateCache.size === 0) return;

  for (const [ref, lastState] of threadStateCache.entries()) {
    try {
      const thread = await findThread(ref);
      if (!thread) continue;

      const currentState = {
        status: thread.envelope.status,
        updated: thread.envelope.updated,
        executor: thread.envelope.executor
      };

      // Check if state changed
      const changed = (
        currentState.status !== lastState.status ||
        currentState.updated !== lastState.updated ||
        currentState.executor !== lastState.executor
      );

      if (changed) {
        // Update cache
        threadStateCache.set(ref, currentState);

        // Send notification
        try {
          await server.sendResourceUpdated({ uri: `thread://${ref}` });
          console.error(`[sync] Thread ${ref} changed: ${lastState.status} → ${currentState.status}`);
        } catch (e) {
          // Notification failed, client may not support it
          console.error(`[sync] Failed to notify for ${ref}: ${e.message}`);
        }
      }
    } catch (e) {
      console.error(`[sync] Error checking ${ref}: ${e.message}`);
    }
  }
}

/**
 * Start the background sync loop
 */
function startSyncLoop() {
  if (!SYNC_ENABLED) {
    console.error(`  Sync: disabled`);
    return;
  }

  console.error(`  Sync: every ${SYNC_INTERVAL / 1000}s`);

  setInterval(async () => {
    try {
      await checkForChanges();
    } catch (e) {
      console.error(`[sync] Error: ${e.message}`);
    }
  }, SYNC_INTERVAL);
}

/**
 * Track a thread for change notifications
 * @param {string} ref - Thread reference
 * @param {Object} envelope - Thread envelope
 */
function trackThread(ref, envelope) {
  threadStateCache.set(ref, {
    status: envelope.status,
    updated: envelope.updated,
    executor: envelope.executor
  });
}

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`MESS MCP Server v2.1 started`);
console.error(`  Local: ${GITHUB_ONLY ? 'disabled' : MESS_DIR}`);
console.error(`  GitHub: ${github ? GITHUB_REPO : 'disabled'}`);
console.error(`  Cache: ${CACHE_DIR}`);

// Start background sync
startSyncLoop();
