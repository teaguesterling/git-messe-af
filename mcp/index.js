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
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import YAML from 'yaml';

// Config
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const MESS_DIR = process.env.MESS_DIR || path.join(__dirname, '..', 'exchange');
const GITHUB_REPO = process.env.MESS_GITHUB_REPO; // format: owner/repo
const GITHUB_TOKEN = process.env.MESS_GITHUB_TOKEN;
const GITHUB_ONLY = process.env.MESS_GITHUB_ONLY === 'true';
const AGENT_ID = process.env.MESS_AGENT_ID || 'claude-agent';

// Size limits (in bytes)
const MAX_FILE_SIZE = 1024 * 1024;        // 1 MB - GitHub Contents API limit
const MAX_INLINE_SIZE = 768 * 1024;       // 768 KB - inline attachment limit

const STATUS_FOLDERS = {
  pending: 'received', claimed: 'executing', in_progress: 'executing',
  waiting: 'executing', held: 'executing', needs_input: 'executing',
  needs_confirmation: 'executing', completed: 'finished', partial: 'finished',
  failed: 'canceled', declined: 'canceled', cancelled: 'canceled',
  expired: 'canceled', delegated: 'canceled', superseded: 'canceled'
};

// ============ Attachment Helpers ============
function getAttachmentType(mimeType) {
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('audio/')) return 'audio';
  if (mimeType?.startsWith('video/')) return 'video';
  return 'file';
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
}

function getExtensionFromMime(mimeType) {
  const mimeToExt = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
    'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/mp4': 'm4a',
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
    'application/pdf': 'pdf', 'text/plain': 'txt'
  };
  return mimeToExt[mimeType] || 'bin';
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

// Serialize thread - returns array of { name, content } for directory format
function serializeThread(envelope, messages, attachments = []) {
  const files = [];

  // Calculate current attachment serial from existing attachments
  let nextAttachmentSerial = 1;
  for (const att of attachments) {
    const match = att.name.match(/^att-(\d+)-/);
    if (match) {
      const serial = parseInt(match[1]);
      if (serial >= nextAttachmentSerial) nextAttachmentSerial = serial + 1;
    }
  }

  // Start with envelope in file 000
  let currentFileNum = 0;
  let currentDocs = [envelope];
  let currentSize = Buffer.byteLength(YAML.stringify(envelope, { lineWidth: -1 }));

  // Process each message, potentially creating overflow files
  for (const msg of messages) {
    // Check for large inline attachments that need externalizing
    const processedMsg = processMessageAttachments(msg, attachments, nextAttachmentSerial);
    if (processedMsg.newAttachments) {
      for (const att of processedMsg.newAttachments) {
        attachments.push(att);
        nextAttachmentSerial++;
      }
    }

    const msgYaml = YAML.stringify(processedMsg.message, { lineWidth: -1 });
    const msgSize = Buffer.byteLength(msgYaml);

    // Would adding this message exceed the limit?
    if (currentSize + msgSize + 4 > MAX_FILE_SIZE && currentDocs.length > 1) {
      // Save current file and start new one
      files.push({
        name: `${currentFileNum.toString().padStart(3, '0')}-${envelope.ref}.messe-af.yaml`,
        content: currentDocs.map(d => YAML.stringify(d, { lineWidth: -1 })).join('---\n')
      });
      currentFileNum++;
      currentDocs = [];
      currentSize = 0;
    }

    currentDocs.push(processedMsg.message);
    currentSize += msgSize + 4; // +4 for "---\n"
  }

  // Save final file
  if (currentDocs.length > 0) {
    files.push({
      name: `${currentFileNum.toString().padStart(3, '0')}-${envelope.ref}.messe-af.yaml`,
      content: currentDocs.map(d => YAML.stringify(d, { lineWidth: -1 })).join('---\n')
    });
  }

  // Add attachment files
  for (const att of attachments) {
    files.push({ name: att.name, content: att.content, binary: att.binary });
  }

  return files;
}

// Process message to externalize large attachments
function processMessageAttachments(msg, existingAttachments, startSerial) {
  const newAttachments = [];
  let serial = startSerial;

  // Deep clone the message to avoid modifying original
  const processedMsg = JSON.parse(JSON.stringify(msg));

  // Look for large inline attachments in MESS items
  if (processedMsg.MESS) {
    for (const item of processedMsg.MESS) {
      if (item.response?.content) {
        item.response.content = item.response.content.map(c => {
          if (typeof c === 'object' && c.image) {
            const dataUrl = c.image;
            const size = Buffer.byteLength(dataUrl);

            if (size > MAX_INLINE_SIZE) {
              // Extract mime and data
              const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                const [, mime, base64Data] = match;
                const type = getAttachmentType(mime);
                const ext = getExtensionFromMime(mime);
                const attName = `att-${serial.toString().padStart(3, '0')}-${type}-image.${ext}`;

                newAttachments.push({
                  name: attName,
                  content: base64Data,
                  binary: true
                });
                serial++;

                // Replace with file reference
                return {
                  file: {
                    path: attName,
                    name: `image.${ext}`,
                    mime: mime
                  }
                };
              }
            }
          }
          return c;
        });
      }
    }
  }

  return { message: processedMsg, newAttachments };
}

// Parse thread from directory format
function parseThread(files) {
  // Sort yaml files by numeric prefix
  const yamlFiles = files
    .filter(f => f.name.endsWith('.messe-af.yaml'))
    .sort((a, b) => {
      const numA = parseInt(a.name.split('-')[0]);
      const numB = parseInt(b.name.split('-')[0]);
      return numA - numB;
    });

  if (yamlFiles.length === 0) {
    throw new Error('No YAML files found in thread directory');
  }

  // Parse first file for envelope
  const firstContent = yamlFiles[0].content;
  const firstDocs = firstContent.split(/^---$/m).filter(d => d.trim()).map(d => YAML.parse(d));
  const envelope = firstDocs[0];
  const messages = firstDocs.slice(1);

  // Parse remaining files for additional messages
  for (let i = 1; i < yamlFiles.length; i++) {
    const content = yamlFiles[i].content;
    const docs = content.split(/^---$/m).filter(d => d.trim()).map(d => YAML.parse(d));
    messages.push(...docs);
  }

  // Collect attachment info
  const attachments = files
    .filter(f => f.name.startsWith('att-'))
    .map(f => ({ name: f.name, sha: f.sha }));

  return { envelope, messages, attachments };
}

// Parse v1 flat file format
function parseThreadV1(content) {
  const docs = content.split(/^---$/m).filter(d => d.trim()).map(d => YAML.parse(d));
  return { envelope: docs[0], messages: docs.slice(1), attachments: [] };
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

    return {
      ...found.envelope,
      messages: found.messages,
      attachments: found.attachments,
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
  { name: 'mess', version: '2.0.0' },
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
console.error(`MESS MCP Server v2 started`);
console.error(`  Local: ${GITHUB_ONLY ? 'disabled' : MESS_DIR}`);
console.error(`  GitHub: ${github ? GITHUB_REPO : 'disabled'}`);
