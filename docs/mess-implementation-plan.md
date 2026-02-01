# MESS Implementation Plan

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           AGENTS                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ Claude       │  │ Other LLM    │  │ Script/Bot   │              │
│  │ (skill.md)   │  │              │  │              │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
└─────────┼─────────────────┼─────────────────┼───────────────────────┘
          │                 │                 │
          └────────────────┬┴─────────────────┘
                           │ MCP Protocol
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      MESS MCP SERVER                                 │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Tools: mess(), mess_observe(), mess_do(), mess_status()    │   │
│  │  Resources: mess://pending, mess://history                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                           │                                         │
│            ┌──────────────┼──────────────┐                         │
│            ▼              ▼              ▼                         │
│     ┌──────────┐   ┌──────────┐   ┌──────────┐                    │
│     │household │   │ moltbook │   │ work     │  Exchange configs   │
│     │ exchange │   │ exchange │   │ exchange │                     │
│     └──────────┘   └──────────┘   └──────────┘                    │
└─────────────────────────────────────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      EXCHANGE SERVER                                 │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    DuckDB Core                               │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │   │
│  │  │ duckdb_yaml │ │duckdb_scalarfs│ │duckdb_mcp  │           │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘           │   │
│  │                                                              │   │
│  │  Tables: requests, executors, claims, statuses, responses   │   │
│  │  Views: pending_by_capability, executor_availability        │   │
│  │  Macros: route_request(), match_capabilities()              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                           │                                         │
│     Dispatch adapters:    │                                         │
│     ┌─────────┬───────────┼───────────┬─────────┐                  │
│     ▼         ▼           ▼           ▼         ▼                  │
│  ┌──────┐ ┌───────┐ ┌─────────┐ ┌─────────┐ ┌──────┐              │
│  │Slack │ │Telegram│ │Webhook  │ │ HTTP    │ │ SMS  │              │
│  └──────┘ └───────┘ └─────────┘ └─────────┘ └──────┘              │
└─────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        EXECUTORS                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ Human Client │  │ Robot API    │  │ Service Proxy│              │
│  │ (HTML+JS)    │  │ (webhook)    │  │ (Instacart)  │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component 1: skill.md

**Purpose:** Teach Claude how to use MESS protocol via MCP tools.

**Location:** `/mnt/skills/user/mess/SKILL.md`

**Contents:**
```markdown
# MESS Protocol Skill

MESS (Meatspace Execution and Submission System) dispatches physical-world 
tasks to humans, robots, and services.

## When to Use

Use MESS when the user needs something done in the physical world:
- Observations: "what's in the fridge?", "check if package arrived"
- Actions: "vacuum the kitchen", "start the rice cooker"
- Purchases: "order groceries", "buy concert tickets"
- Fabrication: "print this part", "cut this design"

## Tools

### mess(message)
Send raw MESS YAML. Use for complex requests with context, dependencies, etc.

### mess_observe(intent, context?)
Quick observation request. Returns when complete.

### mess_do(intent, context?, requires?)
Quick action request. May require confirmation.

### mess_status(re?)
Check pending requests. Omit `re` for all pending.

### mess_cancel(re, reason?)
Cancel a pending request.

## Examples

### Simple observation
```yaml
mess_observe("what's in the fridge?")
```

### Action with context
```yaml
mess_do(
  intent="vacuum the rice spill",
  context=["it's in front of the kitchen sink", "about a cup of rice"]
)
```

### Complex request with attachments
```yaml
mess("""
MESS:
  - request:
      intent: print 4 cable clips per the attached model
      requires:
        - fabricator: { variants: [3d_printer_fdm] }
      context:
        - file: file:///models/clip_v2.stl
        - Use PETG, 30% infill
""")
```

### Batch with dependencies
```yaml
mess("""
MESS:
  - request:
      id: shop
      intent: buy yellow onions and garlic
  - request:
      id: prep
      intent: dice the onions when they arrive
      constraints:
        depends_on: [shop]
""")
```

## Handling Responses

### needs_input
Executor needs clarification. Reply with answers:
```yaml
mess("""
MESS:
  - reply:
      re: vacuum-kitchen
      answers:
        location: both
""")
```

### needs_confirmation
Executor wants approval before acting:
```yaml
mess("""
MESS:
  - reply:
      re: cleanup-garage
      confirm: true
""")
```

### suggestion
Exchange or executor proposes alternative:
```yaml
mess("""
MESS:
  - reply:
      re: sug:merge-grocery
      accept: true
""")
```

## Response Content

Responses contain MIME-like content arrays:
- Bare strings: text
- `image:` - photos, diagrams
- `file:` - documents, data
- `structured:` - JSON data
- `confirmation:` - yes/no with details

## Best Practices

1. Start simple - `mess_observe` and `mess_do` cover 80% of cases
2. Add context when intent is ambiguous
3. Use `requires` when specific capabilities matter
4. Check `mess_status()` if waiting for completion
5. Handle `needs_input` and `needs_confirmation` promptly
```

**Deliverable:** Single SKILL.md file + example configs

**Effort:** 1 day

---

## Component 2: MCP Server (mess-mcp)

**Purpose:** Bridge between agents and exchanges. Manages exchange connections, 
routes messages, surfaces pending requests.

**Tech:** TypeScript MCP server (or Python with FastMCP)

### Tools

```typescript
// Core tool - raw MESS message
{
  name: "mess",
  description: "Send MESS protocol message to exchange",
  inputSchema: {
    type: "object",
    properties: {
      message: { 
        type: "string", 
        description: "YAML-formatted MESS message" 
      },
      exchange: { 
        type: "string", 
        description: "Exchange ID (default: primary)",
        default: "primary"
      }
    },
    required: ["message"]
  }
}

// Convenience: quick observation
{
  name: "mess_observe",
  description: "Request observation from physical world",
  inputSchema: {
    type: "object",
    properties: {
      intent: { type: "string" },
      context: { type: "array", items: { type: "string" } },
      exchange: { type: "string", default: "primary" }
    },
    required: ["intent"]
  }
}

// Convenience: quick action
{
  name: "mess_do",
  description: "Request physical action",
  inputSchema: {
    type: "object",
    properties: {
      intent: { type: "string" },
      context: { type: "array", items: { type: "string" } },
      requires: { type: "array", items: { type: "string" } },
      exchange: { type: "string", default: "primary" }
    },
    required: ["intent"]
  }
}

// Status check
{
  name: "mess_status",
  description: "Check status of pending requests",
  inputSchema: {
    type: "object",
    properties: {
      re: { type: "string", description: "Request ID or 'all'" },
      exchange: { type: "string", default: "primary" }
    }
  }
}

// Cancel
{
  name: "mess_cancel",
  description: "Cancel pending request",
  inputSchema: {
    type: "object",
    properties: {
      re: { type: "string" },
      reason: { type: "string" },
      exchange: { type: "string", default: "primary" }
    },
    required: ["re"]
  }
}
```

### Resources

```typescript
// Pending requests
{
  uri: "mess://pending",
  name: "Pending MESS requests",
  mimeType: "application/x-yaml"
}

// Request history
{
  uri: "mess://history",
  name: "MESS request history", 
  mimeType: "application/x-yaml"
}

// Specific request
{
  uri: "mess://request/{id}",
  name: "MESS request details",
  mimeType: "application/x-yaml"
}
```

### Configuration

```yaml
# ~/.config/mess-mcp/config.yaml
agent_id: claude-agent

# Local file-based exchange (default)
exchange:
  type: local
  path: ~/.mess
  
# Executors defined in ~/.mess/config.yaml

# Dispatch settings
dispatch:
  slack:
    bot_token: ${SLACK_BOT_TOKEN}
  
# HTTP server for human client (optional)
http:
  enabled: true
  port: 8420
  secret: ${MESS_SECRET}  # For JWT signing

# Future: remote exchanges
# exchanges:
#   moltbook:
#     type: remote
#     url: https://moltbook.net/mess
#     api_key: ${MOLTBOOK_API_KEY}
```

**Deliverable:** npm package `@mess/mcp-server`

**Effort:** 3-5 days

---

## Component 3: Exchange (File-Based)

**Purpose:** Store threads, route requests to executors, track state.

**Tech:** YAML files + optional simple router in MCP server.

**No separate server needed for household use** — MCP server manages files directly.

### Directory Structure

```
~/.mess/
  config.yaml                             # Executors, routing rules
  
  # Status-based folders (files move between these)
  state=received/                               # New, awaiting claim
    2026-01-31-001.messe-af.yaml
  state=executing/                              # Claimed, being worked on
    2026-01-31-002.messe-af.yaml
  state=finished/                               # Completed successfully
  state=canceled/                               # Cancelled, failed, declined, expired
  
  archive/                                # Old finished threads (optional)
    2026-01/
      ...
```

### MESSE-AF Thread File Format

Each thread is a MESSE-AF (MESS Exchange Activity File) — a multi-document YAML file:

```yaml
# === DOCUMENT 1: ENVELOPE (updated on each write) ===
ref: 2026-01-31-001
requestor: claude-agent
executor: teague-phone
status: completed
created: 2026-01-31T17:00:00-08:00
updated: 2026-01-31T17:05:00-08:00
intent: check what's in the fridge
priority: normal

history:
  - action: created
    at: 2026-01-31T17:00:00-08:00
    by: claude-agent
  - action: claimed
    at: 2026-01-31T17:00:30-08:00
    by: teague-phone
  - action: completed
    at: 2026-01-31T17:05:00-08:00
    by: teague-phone

---
# === DOCUMENT 2+: MESSAGES (append-only) ===
from: claude-agent
received: 2026-01-31T17:00:00-08:00
channel: mcp

MESS:
  - v: 1.0.0
  - request:
      intent: check what's in the fridge
      context:
        - Planning dinner for 4

---
from: exchange
received: 2026-01-31T17:00:01-08:00

MESS:
  - ack:
      re: last
      ref: 2026-01-31-001

---
from: teague-phone
received: 2026-01-31T17:05:00-08:00
channel: http

MESS:
  - status:
      re: 2026-01-31-001
      code: completed
  - response:
      re: 2026-01-31-001
      content:
        - image: data:image/jpeg;base64,...
        - "Chicken, broccoli, rice"
```

### Config File

```yaml
# ~/.mess/config.yaml
agent_id: claude-agent

executors:
  teague-phone:
    name: "Teague's Phone"
    capabilities: [visual_sensor, audio_sensor, mobility, judgment]
    access: [home, san_anselmo]
    notify:
      slack: U04XXXXXX
      
  roomba-kitchen:
    name: "Kitchen Roomba"
    capabilities: [cleaning, mobility]
    access: [home/kitchen, home/living_room]
    notify:
      webhook: http://localhost:8080/roomba/mess

routing:
  - match: { capability: cleaning }
    prefer: [roomba-kitchen]
  - default:
    prefer: [teague-phone]

dispatch:
  slack:
    bot_token: ${SLACK_BOT_TOKEN}
  webhook:
    # Signing key for JWT tokens
    secret: ${MESS_SECRET}
```

### MCP Server Thread Management

```typescript
// Status → folder mapping
const STATUS_FOLDERS = {
  pending: 'received',
  claimed: 'executing',
  in_progress: 'executing',
  waiting: 'executing',
  held: 'executing',
  needs_input: 'executing',
  needs_confirmation: 'executing',
  retrying: 'executing',
  completed: 'finished',
  partial: 'finished',
  failed: 'canceled',
  declined: 'canceled',
  cancelled: 'canceled',
  expired: 'canceled',
  delegated: 'canceled',
  superseded: 'canceled',
};

function getFolderForStatus(status: string): string {
  return STATUS_FOLDERS[status] || 'received';
}

// Multi-doc YAML helpers
async function writeMultiDocYAML(path: string, docs: object[]): Promise<void> {
    const yaml = docs.map(d => YAML.stringify(d)).join('---\n');
    await fs.writeFile(path, yaml);
}

async function appendYAMLDoc(path: string, doc: object): Promise<void> {
    const yaml = '---\n' + YAML.stringify(doc);
    await fs.appendFile(path, yaml);
}

async function readMultiDocYAML(path: string): Promise<object[]> {
    const content = await fs.readFile(path, 'utf-8');
    return YAML.parseAllDocuments(content).map(d => d.toJSON());
}

// Thread operations
async function createThread(agentId: string, messMessage: MessMessage): Promise<Envelope> {
    const ref = generateRef();  // e.g., "2026-01-31-001"
    
    const envelope = {
        ref,
        requestor: agentId,
        executor: null,
        status: 'pending',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        intent: extractIntent(messMessage),
        priority: extractPriority(messMessage) || 'normal',
        history: [
            { action: 'created', at: new Date().toISOString(), by: agentId }
        ]
    };
    
    const messageDoc = {
        from: agentId,
        received: new Date().toISOString(),
        channel: 'mcp',
        MESS: messMessage
    };
    
    // Write envelope + first message as 2 YAML docs
    await writeMultiDocYAML(`~/.mess/state=received/${ref}.messe-af.yaml`, [envelope, messageDoc]);
    return envelope;
}

async function appendMessage(ref: string, from: string, mess: MessMessage): Promise<void> {
    const currentFolder = await findThreadFolder(ref);
    const path = `~/.mess/${currentFolder}/${ref}.messe-af.yaml`;
    
    // Always append new message doc
    const messageDoc = {
        from,
        received: new Date().toISOString(),
        channel: detectChannel(from),
        MESS: mess
    };
    await appendYAMLDoc(path, messageDoc);
    
    // Only update envelope if status changed
    if (!hasStatus(mess)) {
        return; // No state change — done
    }
    
    const newStatus = extractStatus(mess).code;
    const docs = await readMultiDocYAML(path);
    const envelope = docs[0] as Envelope;
    
    if (envelope.status === newStatus) {
        return; // Same status — no envelope update needed
    }
    
    // State change: update envelope
    envelope.status = newStatus;
    envelope.updated = new Date().toISOString();
    envelope.history.push({
        action: newStatus,
        at: new Date().toISOString(),
        by: from
    });
    if (newStatus === 'claimed') {
        envelope.executor = from;
    }
    
    // Rewrite file with updated envelope
    await writeMultiDocYAML(path, [envelope, ...docs.slice(1)]);
    
    // Move if folder changed
    const newFolder = getFolderForStatus(newStatus);
    if (newFolder !== currentFolder) {
        await fs.rename(path, `~/.mess/${newFolder}/${ref}.messe-af.yaml`);
    }
}

async function findThreadFolder(ref: string): Promise<string> {
    const folders = ['received', 'executing', 'finished', 'canceled'];
    for (const folder of folders) {
        const path = `~/.mess/${folder}/${ref}.messe-af.yaml`;
        if (await exists(path)) {
            return folder;
        }
    }
    throw new Error(`Thread ${ref} not found`);
}

async function listPending(): Promise<Envelope[]> {
    const files = await glob('~/.mess/state=received/*.messe-af.yaml');
    // Only read first doc (envelope) from each file
    return Promise.all(files.map(async f => {
        const docs = await readMultiDocYAML(f);
        return docs[0] as Envelope;
    }));
}

async function listExecuting(): Promise<Envelope[]> {
    const files = await glob('~/.mess/state=executing/*.messe-af.yaml');
    return Promise.all(files.map(async f => {
        const docs = await readMultiDocYAML(f);
        return docs[0] as Envelope;
    }));
}
```

### Simple Router (Optional)

```typescript
interface Router {
    route(thread: Thread): Executor[];
}

function simpleRouter(config: Config): Router {
    return {
        route(thread: Thread): Executor[] {
            const required = extractRequires(thread);
            
            // Check routing rules
            for (const rule of config.routing) {
                if (rule.match && matchesRule(required, rule.match)) {
                    return rule.prefer
                        .map(id => config.executors[id])
                        .filter(Boolean);
                }
            }
            
            // Default: return all capable executors
            return Object.values(config.executors)
                .filter(e => hasCapabilities(e, required));
        }
    };
}

function matchesRule(required: Capability[], match: MatchRule): boolean {
    if (match.capability) {
        return required.some(r => r.capability === match.capability);
    }
    return true;
}
```

### Dispatch (Notifications)

```typescript
async function dispatch(thread: Thread, executors: Executor[]): Promise<void> {
    for (const executor of executors) {
        const token = createJWT({
            ref: thread.ref,
            executor: executor.id,
            exp: Date.now() + 24 * 60 * 60 * 1000  // 24h
        });
        
        const url = `${config.clientUrl}/respond?ref=${thread.ref}&token=${token}`;
        
        if (executor.notify.slack) {
            await slack.chat.postMessage({
                channel: executor.notify.slack,
                text: `MESS: "${thread.intent}"`,
                blocks: [
                    { type: 'section', text: { type: 'mrkdwn', text: `*${thread.intent}*` }},
                    { type: 'actions', elements: [
                        { type: 'button', text: { type: 'plain_text', text: 'Respond' }, url }
                    ]}
                ]
            });
        }
        
        if (executor.notify.webhook) {
            await fetch(executor.notify.webhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/yaml' },
                body: serializeThread(thread)
            });
        }
    }
    
    // Log dispatch
    appendHistory(thread.ref, {
        action: 'dispatched',
        at: new Date().toISOString(),
        by: 'exchange',
        note: `notified ${executors.map(e => e.id).join(', ')}`
    });
}
```

### HTTP Endpoint (for human client)

The MCP server can optionally expose an HTTP endpoint for the human client:

```typescript
// Minimal HTTP server for human client responses
import { Hono } from 'hono';

const app = new Hono();

// Get thread (for client to display)
app.get('/thread/:ref', async (c) => {
    const token = c.req.query('token');
    const claims = verifyJWT(token);
    if (claims.ref !== c.req.param('ref')) {
        return c.json({ error: 'forbidden' }, 403);
    }
    
    const thread = await readThread(claims.ref);
    return c.json(thread);
});

// Post response (from human client)
app.post('/thread/:ref', async (c) => {
    const token = c.req.query('token');
    const claims = verifyJWT(token);
    
    const body = await c.req.text();
    const mess = parseYAML(body);
    
    await appendMessage(claims.ref, claims.executor, mess);
    return c.json({ ok: true });
});

// Serve on port 8420 (or via MCP server's HTTP transport)
```

### When You'd Add DuckDB

Later, for querying across threads:

```sql
-- Query all threads
SELECT * FROM read_yaml_auto('~/.mess/threads/*.yaml');

-- Pending requests
SELECT ref, intent, created, priority
FROM read_yaml_auto('~/.mess/threads/*.yaml')
WHERE status NOT IN ('completed', 'failed', 'cancelled', 'expired', 'declined');

-- Executor stats
SELECT executor, COUNT(*) as completed
FROM read_yaml_auto('~/.mess/archive/**/*.yaml')
WHERE status = 'completed'
GROUP BY executor;
```

But this is optional — grep + jq work fine for household scale.

**Deliverable:** Thread management code in MCP server + HTTP endpoint

**Effort:** 3-4 days

---

## Component 4: Human Executor Client

**Purpose:** Stateless HTML client for humans to view and respond to requests.

**Tech:** Static HTML + vanilla JS (or Preact). No build step required.

### URL Structure

```
https://mess.example.com/respond?
    token=<presigned_auth_token>
    &request=<request_id>
    &exchange=<exchange_url>
```

The token is a JWT or signed payload containing:
- Exchange URL
- Request ID
- Executor ID
- Expiration
- Permissions (respond, claim, decline)

### Features

1. **Request Display**
   - Intent prominently displayed
   - Context items rendered (images, text, files, URLs)
   - Constraints shown (timing, location)
   - Required capabilities

2. **Response Builder**
   - Text input (markdown supported)
   - Image capture (camera) / upload
   - Audio recording
   - File attachment
   - Structured data form (if response_hint specifies)

3. **Quick Actions**
   - Claim
   - Decline (with reason)
   - Needs Input (ask questions)
   - Needs Confirmation (before irreversible)
   - Complete

4. **Status Updates**
   - In Progress (with optional %)
   - Waiting (select reason)
   - Held (pause)

### Implementation

```html
<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>MESS Response</title>
    <style>
        /* Minimal responsive CSS */
    </style>
</head>
<body>
    <div id="app">
        <header id="request-header"></header>
        <section id="request-context"></section>
        <section id="response-builder">
            <div id="content-items"></div>
            <div id="add-content">
                <button onclick="addText()">+ Text</button>
                <button onclick="addImage()">+ Photo</button>
                <button onclick="addAudio()">+ Audio</button>
                <button onclick="addFile()">+ File</button>
            </div>
            <textarea id="notes" placeholder="Notes (optional)"></textarea>
        </section>
        <footer id="actions">
            <button onclick="submitStatus('declined')">Decline</button>
            <button onclick="submitStatus('needs_input')">Need Info</button>
            <button onclick="submitStatus('completed')">Complete</button>
        </footer>
    </div>
    
    <script>
        // Parse URL params
        const params = new URLSearchParams(location.search);
        const token = params.get('token');
        const requestId = params.get('request');
        const exchangeUrl = params.get('exchange');
        
        // Decode token (contains exchange auth)
        const auth = parseToken(token);
        
        // Fetch and display request
        async function loadRequest() {
            const res = await fetch(`${exchangeUrl}/mess/${requestId}`, {
                headers: { 'Authorization': `Bearer ${auth.jwt}` }
            });
            const request = await res.json();
            renderRequest(request);
        }
        
        // Content builders
        const contentItems = [];
        
        function addText() {
            const text = prompt('Enter text:');
            if (text) contentItems.push(text);
            renderContentItems();
        }
        
        async function addImage() {
            // Camera capture or file picker
            const file = await captureOrPick('image/*');
            const dataUri = await fileToDataUri(file);
            contentItems.push({ image: dataUri });
            renderContentItems();
        }
        
        async function addAudio() {
            const blob = await recordAudio();
            const dataUri = await blobToDataUri(blob);
            contentItems.push({ audio: dataUri });
            renderContentItems();
        }
        
        // Submit response
        async function submitStatus(code) {
            const message = {
                MESS: [
                    { status: { re: requestId, code } },
                    ...(code === 'completed' ? [{
                        response: {
                            re: requestId,
                            content: contentItems,
                            notes: document.getElementById('notes').value
                        }
                    }] : [])
                ]
            };
            
            await fetch(`${exchangeUrl}/mess`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${auth.jwt}`,
                    'Content-Type': 'application/x-yaml'
                },
                body: toYAML(message)
            });
            
            // Show confirmation, close or redirect
        }
        
        loadRequest();
    </script>
</body>
</html>
```

### Notification Links

When exchange dispatches to human executor:

**Slack:**
```
New MESS request: "check what's in the fridge"
[View & Respond](https://mess.example.com/respond?token=xxx&request=abc123)
```

**Telegram:**
```
🔔 MESS Request
"check what's in the fridge"
[Respond](https://mess.example.com/respond?token=xxx&request=abc123)
```

**SMS:**
```
MESS: "check what's in the fridge"
Respond: https://mess.example.com/r/abc123?t=xxx
```

### Cookie-based Preferences

```javascript
// Stored in localStorage or cookie
const prefs = {
    defaultCamera: 'rear',
    imageQuality: 0.8,
    audioFormat: 'webm',
    theme: 'auto'
};
```

**Deliverable:** 
- Static HTML file (single file, no build)
- Optional: `/respond` endpoint in exchange server

**Effort:** 2-3 days

---

## DuckDB Extensions (Optional, for Scale)

For household use, MESSE-AF folders + `ls` are sufficient. DuckDB becomes valuable for:
- Querying across many threads
- Analytics and reporting
- Complex capability matching
- Public exchanges (Moltbook)

### Basic Queries with read_yaml_auto

```sql
-- Query all threads across all status folders
SELECT * FROM read_yaml_auto('~/.mess/*/*.messe-af.yaml');

-- Pending requests (just check received folder)
SELECT ref, intent, created, priority
FROM read_yaml_auto('~/.mess/state=received/*.messe-af.yaml');

-- Executing work
SELECT ref, intent, executor, updated
FROM read_yaml_auto('~/.mess/state=executing/*.messe-af.yaml');

-- Executor stats from finished
SELECT executor, COUNT(*) as completed
FROM read_yaml_auto('~/.mess/state=finished/*.messe-af.yaml')
GROUP BY executor;

-- Failed requests needing attention
SELECT ref, intent, status, updated
FROM read_yaml_auto('~/.mess/state=canceled/*.messe-af.yaml')
WHERE status = 'failed';
```

### Advanced: duckdb_yaml for Message Parsing

```sql
-- Parse MESSAGES section from thread files
SELECT 
    ref,
    yaml_extract(messages, '$[*].from') as actors,
    yaml_extract(messages, '$[-1].MESS') as last_message
FROM threads;
```

### Advanced: duckdb_mcp for Robot Dispatch

```sql
-- Forward requests to MCP-enabled robots
SELECT mcp_call(
    executor.mcp_endpoint,
    'execute_task',
    json_object('intent', t.intent, 'ref', t.ref)
)
FROM threads t
JOIN executors e ON e.id = t.executor
WHERE e.type = 'mcp';
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1)

**Goal:** Claude can send MESS requests → MESSE-AF files are created → Slack notification sent

#### Deliverables

**1. SKILL.md** (Day 1)
```
/mnt/skills/user/mess/SKILL.md
```
- Protocol overview for Claude
- Tool usage examples
- When to use `mess()` vs direct action

**2. MCP Server Core** (Days 2-4)
```
mcp-server/
├── package.json
├── src/
│   ├── index.ts          # MCP server entry, stdio transport
│   ├── config.ts         # Load ~/.mess/config.yaml
│   ├── threads.ts        # MESSE-AF CRUD + folder movement
│   └── tools/
│       ├── mess.ts       # mess() tool - send raw MESS
│       └── status.ts     # mess_status() tool - check threads
```

**3. Config Parser** (Day 2)
```yaml
# ~/.mess/config.yaml
agent_id: claude-agent
secret: ${MESS_SECRET}

executors:
  teague-phone:
    capabilities: [visual_sensor, judgment]
    notify:
      slack: U04XXXXXX
```

**4. Slack Dispatch** (Day 5)
```
mcp-server/src/dispatch/slack.ts
```
- Generate JWT with ref + executor
- Post message with "Respond" button linking to client URL
- Just notification, no interactivity yet

#### Phase 1 Test Flow

```
1. Claude calls mess() tool with request YAML
2. MCP server parses, creates MESSE-AF in state=received/
3. Router selects executor from config
4. Slack notification sent with JWT link
5. mess_status() returns thread from state=received/
```

#### NOT in Phase 1
- Human client (Phase 2)
- Response handling (Phase 2)
- File movement on status change (Phase 2)
- needs_input/needs_confirmation (Phase 3)
- Multiple exchanges (Phase 3)

---

### Phase 2: Human Loop (Week 2)
- [ ] Human executor client (HTML)
- [ ] Presigned token generation
- [ ] Slack adapter for dispatch
- [ ] Status/response flow

**Milestone:** Human can receive, respond to requests via Slack link

### Phase 3: Full Protocol (Week 3)
- [ ] All MCP convenience tools
- [ ] `needs_input` / `needs_confirmation` flow
- [ ] Suggestions
- [ ] Dependencies (`depends_on`)
- [ ] Multiple exchanges in MCP

**Milestone:** Full v1.0 protocol working

### Phase 4: Scale & Polish (Week 4)
- [ ] Telegram adapter
- [ ] Webhook adapter (robots/services)
- [ ] Exchange WASM build (Cloudflare)
- [ ] Capability matching refinements
- [ ] Shell economy (optional)

**Milestone:** Production-ready for household use

---

## File Structure

```
mess/
├── protocol/
│   ├── mess-protocol-v1.md           # MESS Protocol spec
│   └── messe-af-v1.md                # MESSE-AF file format spec
│
├── skill/
│   └── SKILL.md                      # Claude skill file
│
├── mcp-server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                  # Entry point, MCP server setup
│   │   ├── config.ts                 # Config loading
│   │   ├── threads.ts                # MESSE-AF file operations
│   │   ├── router.ts                 # Capability-based executor selection
│   │   ├── tools/
│   │   │   ├── mess.ts               # mess() tool
│   │   │   └── status.ts             # mess_status() tool
│   │   └── dispatch/
│   │       └── slack.ts              # Slack notifications
│   └── config.example.yaml
│
├── client/
│   └── respond.html                  # Human executor client (Phase 2)
│
└── examples/
    ├── config.yaml                   # Example exchange config
    └── fridge-check.messe-af.yaml    # Example thread
```

---

## Open Questions (Resolved)

1. **Token format** — JWT ✓
2. **File storage** — Data URIs inline in messages for household scale ✓
3. **Real-time updates** — Future (SSE from MCP server)
4. **Multi-exchange routing** — Future
5. **Offline executors** — Queue and retry ✓

---

## v2 Roadmap (Not Implemented)

### Agent Feedback on Responses

Agents should be able to review executor responses and provide feedback:

```yaml
MESS:
  - review:
      re: <ref>
      rating: 1-5 | accept | reject
      feedback: string              # What was wrong/right
      request_redo: boolean         # Ask executor to try again
```

This enables:
- Quality feedback loop for human executors
- Training signal for automated executors
- Reputation/trust scoring in public exchanges

### Payment & Compensation

The `compensation` field in requests should support multiple payment methods, handled by exchanges:

```yaml
compensation:
  # Shell economy (internal)
  shells: 50
  
  # Cryptocurrency
  bitcoin:
    sats: 1000
    address: bc1q...              # Optional, executor can provide
    
  # Fiat
  venmo:
    amount: 5.00
    currency: USD
    
  # Tokens (exchange-specific)
  tokens:
    type: moltbook-credits
    amount: 100
    
  # Escrow
  escrow:
    provider: exchange            # Exchange holds until completion
    release_on: completed | reviewed
```

Payment flow:
1. Agent includes `compensation` in request
2. Exchange validates agent has funds/authorization
3. Exchange escrows payment
4. On `completed` (or after `review`), exchange releases to executor
5. On `failed`/`cancelled`, exchange refunds agent

**Exchanges handle all payment logic** — the protocol just defines the schema.

### Other v2 Considerations

- **Delegation chains** — executor delegates to sub-executor, compensation splits
- **Reputation scores** — per-executor ratings visible to agents
- **Capability verification** — exchanges verify executor capabilities
- **SLAs** — guaranteed response times with penalties
- **Batching** — group related requests for efficiency pricing

---

*Ready to start with Phase 1?*
