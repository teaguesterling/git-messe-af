#!/usr/bin/env node
/**
 * MESSE-AF CLI
 * Manage local MESSE-AF files from the command line
 *
 * Usage:
 *   mess list [--status pending|claimed|completed|...]
 *   mess show <ref>
 *   mess create <intent> [--priority normal] [--from agent-id]
 *   mess update <ref> --status <status> [--message <msg>]
 *   mess claim <ref> [--by executor-id]
 *   mess complete <ref> [--message <msg>]
 *   mess cancel <ref> [--message <msg>]
 *   mess import <file>
 *   mess export <ref> [--format v1|v2] [--output <file>]
 *
 * Environment:
 *   MESS_DIR - Directory containing MESSE-AF files (default: ./exchange)
 *   MESS_AGENT_ID - Default agent ID for operations (default: cli)
 */

import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';

import {
  parseThread,
  parseThreadV1,
  serializeThread,
  serializeThreadV1,
  getFolderForStatus
} from '@messe-af/core';

const MESS_DIR = process.env.MESS_DIR || path.join(process.cwd(), 'exchange');
const AGENT_ID = process.env.MESS_AGENT_ID || 'cli';

// ============ Helpers ============

function parseArgs(args) {
  const result = { _: [] };
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i += 2;
      } else {
        result[key] = true;
        i++;
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      result[key] = true;
      i++;
    } else {
      result._.push(arg);
      i++;
    }
  }
  return result;
}

async function ensureDirs() {
  for (const folder of ['received', 'executing', 'finished', 'canceled']) {
    await fs.mkdir(path.join(MESS_DIR, `state=${folder}`), { recursive: true });
  }
}

async function generateRef() {
  const today = new Date().toISOString().split('T')[0];
  let maxNum = 0;

  for (const folder of ['received', 'executing', 'finished', 'canceled']) {
    const folderPath = path.join(MESS_DIR, `state=${folder}`);
    try {
      const entries = await fs.readdir(folderPath, { withFileTypes: true });
      for (const entry of entries) {
        const name = entry.name.replace('.messe-af.yaml', '');
        if (name.startsWith(today)) {
          const num = parseInt(name.split('-')[3] || '0');
          if (num > maxNum) maxNum = num;
        }
      }
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }

  return `${today}-${(maxNum + 1).toString().padStart(3, '0')}`;
}

async function findThread(ref) {
  for (const folder of ['received', 'executing', 'finished', 'canceled']) {
    // Check v2 directory format
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
        return { folder, path: dirPath, format: 'v2', ...parsed };
      }
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }

    // Check v1 flat file format
    const filePath = path.join(MESS_DIR, `state=${folder}`, `${ref}.messe-af.yaml`);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = parseThreadV1(content);
      return { folder, path: filePath, format: 'v1', ...parsed };
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  return null;
}

async function listThreads(statusFilter = null) {
  const results = [];
  const folders = statusFilter
    ? [getFolderForStatus(statusFilter)]
    : ['received', 'executing', 'finished', 'canceled'];

  for (const folder of folders) {
    const folderPath = path.join(MESS_DIR, `state=${folder}`);
    try {
      const entries = await fs.readdir(folderPath, { withFileTypes: true });
      for (const entry of entries) {
        try {
          let parsed;
          if (entry.isDirectory()) {
            const dirPath = path.join(folderPath, entry.name);
            const files = await fs.readdir(dirPath);
            const fileContents = [];
            for (const f of files) {
              const content = await fs.readFile(path.join(dirPath, f), 'utf-8');
              fileContents.push({ name: f, content });
            }
            parsed = parseThread(fileContents);
          } else if (entry.name.endsWith('.messe-af.yaml')) {
            const content = await fs.readFile(path.join(folderPath, entry.name), 'utf-8');
            parsed = parseThreadV1(content);
          } else {
            continue;
          }

          if (!statusFilter || parsed.envelope.status === statusFilter) {
            results.push(parsed.envelope);
          }
        } catch (e) {
          // Skip malformed entries
        }
      }
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }

  return results.sort((a, b) => new Date(b.updated) - new Date(a.updated));
}

async function saveThread(envelope, messages, attachments = [], oldPath = null, oldFormat = null) {
  const folder = getFolderForStatus(envelope.status);
  const dirPath = path.join(MESS_DIR, `state=${folder}`, envelope.ref);

  // Always save as v2 format
  await fs.mkdir(dirPath, { recursive: true });
  const files = serializeThread(envelope, messages, attachments);

  for (const file of files) {
    const filePath = path.join(dirPath, file.name);
    if (file.binary) {
      await fs.writeFile(filePath, Buffer.from(file.content, 'base64'));
    } else {
      await fs.writeFile(filePath, file.content);
    }
  }

  // Clean up old location if moved or upgraded
  if (oldPath && oldPath !== dirPath) {
    try {
      if (oldFormat === 'v1') {
        await fs.unlink(oldPath);
      } else {
        await fs.rm(oldPath, { recursive: true });
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

// ============ Commands ============

async function cmdList(args) {
  const status = args.status || args.s;
  const threads = await listThreads(status);

  if (threads.length === 0) {
    console.log('No threads found');
    return;
  }

  const format = args.format || 'table';
  if (format === 'json') {
    console.log(JSON.stringify(threads, null, 2));
    return;
  }
  if (format === 'yaml') {
    console.log(YAML.stringify(threads));
    return;
  }

  // Table format
  console.log('REF                 STATUS       PRIORITY   INTENT');
  console.log('─'.repeat(80));
  for (const t of threads) {
    const ref = t.ref.padEnd(19);
    const status = (t.status || 'pending').padEnd(12);
    const priority = (t.priority || 'normal').padEnd(10);
    const intent = (t.intent || '').slice(0, 35);
    console.log(`${ref} ${status} ${priority} ${intent}`);
  }
  console.log(`\n${threads.length} thread(s)`);
}

async function cmdShow(args) {
  const ref = args._[0];
  if (!ref) {
    console.error('Usage: mess show <ref>');
    process.exit(1);
  }

  const thread = await findThread(ref);
  if (!thread) {
    console.error(`Thread not found: ${ref}`);
    process.exit(1);
  }

  const format = args.format || 'yaml';
  if (format === 'json') {
    console.log(JSON.stringify({ envelope: thread.envelope, messages: thread.messages }, null, 2));
  } else {
    console.log(YAML.stringify(thread.envelope));
    console.log('---');
    for (const msg of thread.messages) {
      console.log(YAML.stringify(msg));
      console.log('---');
    }
  }
}

async function cmdCreate(args) {
  const intent = args._.join(' ');
  if (!intent) {
    console.error('Usage: mess create <intent> [--priority normal] [--from agent-id]');
    process.exit(1);
  }

  await ensureDirs();
  const ref = await generateRef();
  const now = new Date().toISOString();
  const from = args.from || AGENT_ID;
  const priority = args.priority || 'normal';

  const envelope = {
    ref,
    requestor: from,
    executor: null,
    status: 'pending',
    created: now,
    updated: now,
    intent,
    priority,
    history: [{ action: 'created', at: now, by: from }]
  };

  const messages = [
    {
      from,
      received: now,
      channel: 'cli',
      MESS: [
        { v: '1.0.0' },
        { request: { intent, context: [], response_hint: [] } }
      ]
    },
    {
      from: 'exchange',
      received: now,
      MESS: [{ ack: { re: 'last', ref } }]
    }
  ];

  await saveThread(envelope, messages);
  console.log(`Created: ${ref}`);
}

async function cmdUpdate(args) {
  const ref = args._[0];
  const status = args.status;
  const message = args.message || args.m;

  if (!ref || !status) {
    console.error('Usage: mess update <ref> --status <status> [--message <msg>]');
    process.exit(1);
  }

  const thread = await findThread(ref);
  if (!thread) {
    console.error(`Thread not found: ${ref}`);
    process.exit(1);
  }

  const now = new Date().toISOString();
  const by = args.by || AGENT_ID;

  thread.envelope.status = status;
  thread.envelope.updated = now;
  thread.envelope.history.push({ action: status, at: now, by });

  if (status === 'claimed' && !thread.envelope.executor) {
    thread.envelope.executor = by;
  }

  thread.messages.push({
    from: by,
    received: now,
    channel: 'cli',
    MESS: [{
      status: {
        re: ref,
        code: status,
        ...(message && { message })
      }
    }]
  });

  await saveThread(thread.envelope, thread.messages, thread.attachments, thread.path, thread.format);
  console.log(`Updated: ${ref} -> ${status}`);
}

async function cmdClaim(args) {
  const ref = args._[0];
  if (!ref) {
    console.error('Usage: mess claim <ref> [--by executor-id]');
    process.exit(1);
  }

  args.status = 'claimed';
  await cmdUpdate(args);
}

async function cmdComplete(args) {
  const ref = args._[0];
  if (!ref) {
    console.error('Usage: mess complete <ref> [--message <msg>]');
    process.exit(1);
  }

  args.status = 'completed';
  await cmdUpdate(args);
}

async function cmdCancel(args) {
  const ref = args._[0];
  if (!ref) {
    console.error('Usage: mess cancel <ref> [--message <msg>]');
    process.exit(1);
  }

  args.status = 'cancelled';
  await cmdUpdate(args);
}

async function cmdImport(args) {
  const file = args._[0];
  if (!file) {
    console.error('Usage: mess import <file>');
    process.exit(1);
  }

  await ensureDirs();

  const stat = await fs.stat(file);
  let envelope, messages, attachments = [];

  if (stat.isDirectory()) {
    // v2 directory format
    const entries = await fs.readdir(file);
    const files = [];
    for (const entry of entries) {
      const content = await fs.readFile(path.join(file, entry), 'utf-8');
      files.push({ name: entry, content });
    }
    const parsed = parseThread(files);
    envelope = parsed.envelope;
    messages = parsed.messages;
    attachments = parsed.attachments;
  } else {
    // v1 flat file
    const content = await fs.readFile(file, 'utf-8');
    const parsed = parseThreadV1(content);
    envelope = parsed.envelope;
    messages = parsed.messages;
  }

  await saveThread(envelope, messages, attachments);
  console.log(`Imported: ${envelope.ref}`);
}

async function cmdExport(args) {
  const ref = args._[0];
  if (!ref) {
    console.error('Usage: mess export <ref> [--format v1|v2] [--output <file>]');
    process.exit(1);
  }

  const thread = await findThread(ref);
  if (!thread) {
    console.error(`Thread not found: ${ref}`);
    process.exit(1);
  }

  const format = args.format || 'v2';
  const output = args.output || args.o;

  if (format === 'v1') {
    const content = serializeThreadV1(thread.envelope, thread.messages);
    if (output) {
      await fs.writeFile(output, content);
      console.log(`Exported to: ${output}`);
    } else {
      console.log(content);
    }
  } else {
    const files = serializeThread(thread.envelope, thread.messages, thread.attachments);
    if (output) {
      await fs.mkdir(output, { recursive: true });
      for (const file of files) {
        const filePath = path.join(output, file.name);
        if (file.binary) {
          await fs.writeFile(filePath, Buffer.from(file.content, 'base64'));
        } else {
          await fs.writeFile(filePath, file.content);
        }
      }
      console.log(`Exported to: ${output}/`);
    } else {
      for (const file of files) {
        if (!file.binary) {
          console.log(`--- ${file.name} ---`);
          console.log(file.content);
        } else {
          console.log(`--- ${file.name} (binary, ${file.content.length} bytes) ---`);
        }
      }
    }
  }
}

function showHelp() {
  console.log(`MESSE-AF CLI - Manage local MESSE-AF files

Usage: mess <command> [options]

Commands:
  list [--status <status>]              List threads
  show <ref>                            Show thread details
  create <intent> [options]             Create new request
  update <ref> --status <status>        Update thread status
  claim <ref> [--by <executor>]         Claim a request
  complete <ref> [--message <msg>]      Mark as completed
  cancel <ref> [--message <msg>]        Cancel a request
  import <file|dir>                     Import MESSE-AF file
  export <ref> [--format v1|v2]         Export thread

Options:
  --status <status>     Filter by status
  --priority <p>        Set priority (background/normal/elevated/urgent)
  --from <id>           Requestor ID (default: $MESS_AGENT_ID or 'cli')
  --by <id>             Executor ID for claims
  --message, -m <msg>   Status message
  --format <fmt>        Output format (table/json/yaml for list, v1/v2 for export)
  --output, -o <path>   Output file/directory

Environment:
  MESS_DIR              Directory for MESSE-AF files (default: ./exchange)
  MESS_AGENT_ID         Default agent ID (default: cli)

Examples:
  mess list --status pending
  mess create "Check the garage door" --priority elevated
  mess claim 2026-02-01-001 --by my-phone
  mess complete 2026-02-01-001 --message "Door was closed"
  mess export 2026-02-01-001 --format v1 -o thread.yaml
`);
}

// ============ Main ============

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._.shift();

  if (!command || args.help || args.h) {
    showHelp();
    process.exit(0);
  }

  try {
    switch (command) {
      case 'list':
      case 'ls':
        await cmdList(args);
        break;
      case 'show':
      case 'get':
        await cmdShow(args);
        break;
      case 'create':
      case 'new':
        await cmdCreate(args);
        break;
      case 'update':
        await cmdUpdate(args);
        break;
      case 'claim':
        await cmdClaim(args);
        break;
      case 'complete':
      case 'done':
        await cmdComplete(args);
        break;
      case 'cancel':
        await cmdCancel(args);
        break;
      case 'import':
        await cmdImport(args);
        break;
      case 'export':
        await cmdExport(args);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

main();
