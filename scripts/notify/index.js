#!/usr/bin/env node
/**
 * MESS Exchange Notification Dispatcher
 *
 * Processes new request files from git diff and sends notifications
 * to matching executors based on their notification preferences.
 *
 * Usage:
 *   node index.js           # Normal mode
 *   node index.js --dry-run # Test mode (no actual notifications)
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import yaml from 'js-yaml';
import * as senders from './lib/senders/index.js';

const DRY_RUN = process.argv.includes('--dry-run');
const REPO_ROOT = process.cwd().includes('scripts/notify')
  ? path.resolve(process.cwd(), '../..')
  : process.cwd();

// ============ Git Operations ============

/**
 * Find new request files via git diff
 * Handles both V1 (flat yaml) and V2 (directory-based) formats
 *
 * Note: execSync is safe here - command is static with no user input
 */
function findNewRequestFiles() {
  let newFiles = [];
  let newDirs = new Set();

  try {
    const diff = execSync(
      'git diff --name-only --diff-filter=A HEAD~1 HEAD -- "exchange/state=received/"',
      { encoding: 'utf-8', cwd: REPO_ROOT }
    );
    const allNew = diff.trim().split('\n').filter(f => f);

    for (const file of allNew) {
      // Check if this is a v2 directory structure (file inside a directory)
      const parts = file.replace('exchange/state=received/', '').split('/');
      if (parts.length > 1) {
        // V2: file is inside a thread directory
        const dirName = parts[0];
        if (!newDirs.has(dirName)) {
          newDirs.add(dirName);
          // Find the primary yaml file (000-*.messe-af.yaml)
          const primaryFile = path.join(REPO_ROOT, `exchange/state=received/${dirName}/000-${dirName}.messe-af.yaml`);
          if (fs.existsSync(primaryFile)) {
            newFiles.push(primaryFile);
          }
        }
      } else if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        // V1: flat yaml file
        newFiles.push(path.join(REPO_ROOT, file));
      }
    }
  } catch (e) {
    console.log('No previous commit or no new files');
    return [];
  }

  return newFiles;
}

// ============ Executor Loading ============

/**
 * Load all executor configs from executors/ directory
 */
function loadExecutors() {
  const executorsDir = path.join(REPO_ROOT, 'executors');
  const executors = [];

  if (!fs.existsSync(executorsDir)) {
    return executors;
  }

  const files = fs.readdirSync(executorsDir).filter(f =>
    (f.endsWith('.yaml') || f.endsWith('.yml')) && !f.startsWith('_') && f !== 'README.md'
  );

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(executorsDir, file), 'utf-8');
      const config = yaml.load(content);
      if (config.executor_id && config.notifications?.length) {
        executors.push(config);
      }
    } catch (e) {
      console.error(`Failed to load executor ${file}:`, e.message);
    }
  }

  return executors;
}

// ============ Request Processing ============

/**
 * Parse a MESSE-AF file and extract notification payload
 */
function parseRequestFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const docs = content.split(/^---$/m).filter(d => d.trim());
  const envelope = yaml.load(docs[0]);

  // Parse first message for request details
  let request = {};
  if (docs.length > 1) {
    const firstMsg = yaml.load(docs[1]);
    const messItems = firstMsg.MESS || [];
    for (const item of messItems) {
      if (item.request) request = item.request;
    }
  }

  // Build client URL - use CLIENT_URL env if set, otherwise default to template's hosted client
  const clientUrl = process.env.CLIENT_URL || 'https://teaguesterling.github.io/git-messe-af/';

  return {
    ref: envelope.ref,
    intent: envelope.intent || request.intent || 'New request',
    priority: envelope.priority || request.priority || 'normal',
    requestor: envelope.requestor,
    created: envelope.created,
    context: request.context || [],
    wants_photo: request.response_hint?.includes('image') || false,
    required_capabilities: request.required_capabilities || [],
    url: clientUrl
  };
}

/**
 * Check if executor should receive notification for this request
 */
function shouldNotifyExecutor(executor, payload) {
  // Check capability match (if request specifies required capabilities)
  if (payload.required_capabilities.length > 0) {
    const execCaps = executor.capabilities || [];
    const hasRequired = payload.required_capabilities.every(cap => execCaps.includes(cap));
    if (!hasRequired) {
      console.log(`    ⏭ Skipping: missing required capabilities`);
      return false;
    }
  }

  // Check priority preference
  const prefs = executor.preferences || {};
  const minPriority = prefs.min_priority || 'background';
  const priorityOrder = ['background', 'normal', 'elevated', 'urgent'];
  const requestPriorityIndex = priorityOrder.indexOf(payload.priority);
  const minPriorityIndex = priorityOrder.indexOf(minPriority);

  if (requestPriorityIndex < minPriorityIndex) {
    console.log(`    ⏭ Skipping: priority ${payload.priority} below minimum ${minPriority}`);
    return false;
  }

  // Check quiet hours
  if (prefs.quiet_hours?.enabled) {
    const tz = prefs.quiet_hours.timezone || 'UTC';
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz
    });
    const currentTime = formatter.format(now);
    const start = prefs.quiet_hours.start || '22:00';
    const end = prefs.quiet_hours.end || '07:00';

    // Simple quiet hours check
    const inQuietHours = start > end
      ? (currentTime >= start || currentTime < end)
      : (currentTime >= start && currentTime < end);

    if (inQuietHours && payload.priority !== 'urgent') {
      console.log(`    ⏭ Skipping: quiet hours (${start}-${end} ${tz})`);
      return false;
    }
  }

  return true;
}

/**
 * Send a notification via the specified sender
 */
async function sendNotification(type, config, payload) {
  const sender = senders[type];
  if (!sender) {
    console.log(`  ⚠ Unknown notification type: ${type}`);
    return null;
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would send ${type}:`, JSON.stringify(config).slice(0, 100) + '...');
    return { dry_run: true };
  }

  try {
    const result = await sender(config, payload);
    console.log(`  ✓ ${type} sent`, result.external_id ? `(id: ${result.external_id})` : '');
    return result;
  } catch (e) {
    console.error(`  ✗ ${type} failed: ${e.message}`);
    return null;
  }
}

/**
 * Process a single request file
 */
async function processRequest(filePath, executors) {
  try {
    const payload = parseRequestFile(filePath);

    console.log(`  Intent: ${payload.intent}`);
    console.log(`  Priority: ${payload.priority}`);

    // Notify matching executors
    for (const executor of executors) {
      console.log(`\n  Checking executor: ${executor.executor_id}`);

      if (!shouldNotifyExecutor(executor, payload)) {
        continue;
      }

      // Send notifications
      for (const notif of executor.notifications) {
        await sendNotification(notif.type, notif, payload);
      }
    }
  } catch (e) {
    console.error(`  Error processing ${filePath}:`, e.message);
  }
}

// ============ Main ============

async function main() {
  console.log('MESS Notification Dispatcher');
  console.log(`Working directory: ${REPO_ROOT}`);
  if (DRY_RUN) console.log('🔸 DRY RUN MODE - no notifications will be sent\n');

  // Find new request files via git diff
  const newFiles = findNewRequestFiles();

  if (newFiles.length === 0) {
    console.log('No new request files');
    return;
  }

  console.log(`Found ${newFiles.length} new request(s)`);

  // Load executor configs
  const executors = loadExecutors();
  console.log(`Loaded ${executors.length} executor config(s)`);

  if (executors.length === 0) {
    console.log('No executors configured for notifications');
    return;
  }

  // Process each new request
  for (const file of newFiles) {
    console.log(`\nProcessing: ${file}`);
    await processRequest(file, executors);
  }

  console.log('\n✓ Notification processing complete');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
