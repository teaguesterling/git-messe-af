# MESSE-AF: MESS Exchange Activity File
## Thread File Format for File-Based Exchanges

**Version:** 1.0.0  
**Date:** 2026-01-31

---

## Overview

A MESSE-AF file represents a single request thread in a MESS exchange. It contains:
1. **Envelope** — Exchange-managed metadata
2. **Messages** — Chronological MESS protocol messages

The envelope tracks state; messages are the source of truth.

File extension: `.messe-af.yaml` or `.messe-af`

---

## Identifiers

### Client ID vs Exchange Ref

| Field | Assigned By | Purpose |
|-------|-------------|---------|
| `id:` | Client (optional) | Client's reference for tracking |
| `ref:` | Exchange (required) | Exchange's canonical identifier, used as filename |

**Single request:** Client may include `id:` in the request. Exchange assigns `ref:` and returns both in the `ack`.

**Multiple requests in one message:** Each request can have its own `id:`. The exchange creates one MESSE-AF thread per request, each with its own `ref:`. The `ack` maps client IDs to exchange refs:

```yaml
# Client sends two requests
MESS:
  - request:
      id: my-task-1
      intent: check the fridge
  - request:
      id: my-task-2
      intent: water the plants

# Exchange acks with mapping
MESS:
  - ack:
      requests:
        - id: my-task-1
          ref: 2026-01-31-001
        - id: my-task-2
          ref: 2026-01-31-002
```

**Subsequent references:** Use `re:` field with either the client's `id:` or exchange's `ref:` — the exchange resolves both:

```yaml
MESS:
  - status:
      re: my-task-1        # Client's ID works
      code: completed
      
  - status:
      re: 2026-01-31-001   # Exchange's ref also works
      code: completed
```

---

## File Structure

A MESSE-AF file is a **multi-document YAML file**:

1. **First document:** Envelope (exchange-managed, updated on each write)
2. **Subsequent documents:** Messages (append-only)

```yaml
# === DOCUMENT 1: ENVELOPE ===
ref: 2026-01-31-001
client_id: my-task-1              # If client provided id
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
  - action: dispatched
    at: 2026-01-31T17:00:01-08:00
    by: exchange
  - action: claimed
    at: 2026-01-31T17:00:30-08:00
    by: teague-phone
  - action: completed
    at: 2026-01-31T17:05:00-08:00
    by: teague-phone

---
# === DOCUMENT 2: First message (agent request) ===
from: claude-agent
received: 2026-01-31T17:00:00-08:00
channel: mcp

MESS:
  - v: 1.0.0
  - request:
      id: my-task-1
      intent: check what's in the fridge
      context:
        - Planning dinner for 4
      response_hint:
        - text
        - image

---
# === DOCUMENT 3: Exchange ack ===
from: exchange
received: 2026-01-31T17:00:01-08:00

MESS:
  - ack:
      re: my-task-1
      ref: 2026-01-31-001

---
# === DOCUMENT 4: Executor claims ===
from: teague-phone
received: 2026-01-31T17:00:30-08:00
channel: http

MESS:
  - status:
      re: 2026-01-31-001
      code: claimed

---
# === DOCUMENT 5: Executor completes with response ===
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
        - image: data:image/jpeg;base64,/9j/4AAQ...
        - |
          Proteins: chicken thighs (1 lb, expires tomorrow)
          Vegetables: broccoli, carrots, half onion
          Dairy: milk, cheddar, butter
      notes: chicken should be used tonight
```

---

## Message Document Fields

Each message document (after the envelope) has:

| Field | Type | Description |
|-------|------|-------------|
| `from` | string | Actor ID: agent, executor, or `exchange` |
| `received` | datetime | When exchange received/generated the message |
| `channel` | string | Optional: `mcp`, `slack`, `http`, `telegram`, `webhook` |
| `MESS` | list | The MESS protocol message |

### Actor Types

- **Agents:** `claude-agent`, `my-bot`, `cron-job`
- **Executors:** `teague-phone`, `roomba-kitchen`, `instacart-proxy`
- **Exchange:** `exchange` (for acks, system messages, expiration notices)

---

## Reading & Writing

### Write Operations

There are two distinct operations:

| Operation | When | Action |
|-----------|------|--------|
| **Append message** | Every incoming message | Append `---` + message doc to file |
| **Update envelope** | State change only | Rewrite first YAML doc |

**Append is always done.** Update envelope only when:
- `status` changes (triggers history entry + possible folder move)
- `executor` is assigned (on `claimed`)

Messages that don't change state (e.g., agent `reply` to `needs_input`) just append — no envelope rewrite needed.

### Create New Thread

```bash
# 1. Generate ref
ref="2026-01-31-001"

# 2. Write envelope + first message as 2 YAML docs
cat > ~/.mess/state=received/${ref}.messe-af.yaml << 'EOF'
ref: 2026-01-31-001
requestor: claude-agent
status: pending
created: 2026-01-31T17:00:00-08:00
updated: 2026-01-31T17:00:00-08:00
intent: check what's in the fridge
priority: normal
history:
  - action: created
    at: 2026-01-31T17:00:00-08:00
    by: claude-agent
---
from: claude-agent
received: 2026-01-31T17:00:00-08:00
channel: mcp
MESS:
  - v: 1.0.0
  - request:
      intent: check what's in the fridge
EOF
```

### Append Message (No State Change)

```bash
# Just append --- and new document
cat >> ~/.mess/state=executing/${ref}.messe-af.yaml << 'EOF'
---
from: claude-agent
received: 2026-01-31T18:02:30-08:00
channel: mcp
MESS:
  - reply:
      re: 2026-01-31-001
      answers:
        location: both
EOF

# No envelope update needed — status didn't change
```

### Append Message + Update Envelope (State Change)

```bash
# 1. Append the message
cat >> ~/.mess/state=received/${ref}.messe-af.yaml << 'EOF'
---
from: teague-phone
received: 2026-01-31T17:00:30-08:00
channel: http
MESS:
  - status:
      re: 2026-01-31-001
      code: claimed
EOF

# 2. Update envelope (rewrite first doc)
#    - status: pending → claimed
#    - executor: teague-phone
#    - updated: now
#    - history: append claimed entry

# 3. Move file to new folder
mv ~/.mess/state=received/${ref}.messe-af.yaml ~/.mess/state=executing/
```

### State Changes That Trigger Envelope Update

| Message | Envelope Changes |
|---------|------------------|
| `status: claimed` | `status`, `executor`, `updated`, `history` |
| `status: in_progress` | `status`, `updated`, `history` |
| `status: needs_input` | `status`, `updated`, `history` |
| `status: completed` | `status`, `updated`, `history` |
| `status: failed` | `status`, `updated`, `history` |
| `cancel` (from agent) | `status` → `cancelled`, `updated`, `history` |
| `reply` (no status change) | **No envelope update** |
| `response` (no status change) | **No envelope update** |

---

## Envelope Fields

| Field | Type | Description |
|-------|------|-------------|
| `ref` | string | Exchange-assigned ID, also the filename (e.g., `2026-01-31-001`) |
| `client_id` | string | Client-assigned ID if provided (optional) |
| `requestor` | string | Agent/client that created the request |
| `executor` | string | Executor who claimed (null if unclaimed) |
| `status` | enum | Current status (see below) |
| `created` | datetime | When request was received |
| `updated` | datetime | Last activity |
| `expires` | datetime | When request times out (optional) |
| `intent` | string | Cached intent from original request |
| `priority` | enum | Cached priority (`background`, `normal`, `elevated`, `urgent`) |
| `history` | list | State transition log |

### Status Values

```
pending         # Received, awaiting claim
claimed         # Executor accepted
in_progress     # Work underway
waiting         # Blocked on something
held            # Paused by executor
needs_input     # Awaiting agent clarification
needs_confirmation  # Awaiting agent approval
completed       # Done (terminal)
partial         # Partially done (terminal)
failed          # Couldn't complete (terminal)
declined        # Executor won't do it (terminal)
expired         # Timed out (terminal)
cancelled       # Agent cancelled (terminal)
```

### History Log

```yaml
history:
  - action: created
    at: 2026-01-31T17:00:00-08:00
    by: claude-agent
    
  - action: dispatched
    at: 2026-01-31T17:00:01-08:00
    by: exchange
    note: "notified teague-phone via slack"
    
  - action: claimed
    at: 2026-01-31T17:00:30-08:00
    by: teague-phone
    
  - action: completed
    at: 2026-01-31T17:05:00-08:00
    by: teague-phone
```

---

## Example: Complete Thread

```yaml
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
  - action: dispatched
    at: 2026-01-31T17:00:01-08:00
    by: exchange
    note: "notified via slack"
  - action: claimed
    at: 2026-01-31T17:00:30-08:00
    by: teague-phone
  - action: completed
    at: 2026-01-31T17:05:00-08:00
    by: teague-phone

---
from: claude-agent
received: 2026-01-31T17:00:00-08:00
channel: mcp

MESS:
  - v: 1.0.0
  - request:
      intent: check what's in the fridge
      context:
        - Planning dinner for 4
        - Kids prefer pasta
      response_hint:
        - text
        - image

---
from: exchange
received: 2026-01-31T17:00:01-08:00

MESS:
  - ack:
      re: last
      ref: 2026-01-31-001

---
from: teague-phone
received: 2026-01-31T17:00:30-08:00
channel: http

MESS:
  - status:
      re: 2026-01-31-001
      code: claimed

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
        - image: data:image/jpeg;base64,/9j/4AAQ...
        - |
          Proteins: chicken thighs (1 lb, expires tomorrow)
          Vegetables: broccoli, carrots, half onion
          Dairy: milk, cheddar, butter
          Pantry: rice, pasta, soy sauce
      notes: chicken should be used tonight
```

---

## Example: Needs Input Flow

```yaml
ref: 2026-01-31-002
requestor: claude-agent
executor: roomba-kitchen
status: in_progress
created: 2026-01-31T18:00:00-08:00
updated: 2026-01-31T18:03:00-08:00
intent: vacuum the kitchen spill
priority: normal

history:
  - action: created
    at: 2026-01-31T18:00:00-08:00
    by: claude-agent
  - action: claimed
    at: 2026-01-31T18:00:05-08:00
    by: roomba-kitchen
  - action: needs_input
    at: 2026-01-31T18:01:00-08:00
    by: roomba-kitchen
    note: "multiple spills detected"
  - action: replied
    at: 2026-01-31T18:02:30-08:00
    by: claude-agent
  - action: in_progress
    at: 2026-01-31T18:03:00-08:00
    by: roomba-kitchen

---
from: claude-agent
received: 2026-01-31T18:00:00-08:00
channel: mcp

MESS:
  - request:
      intent: vacuum the kitchen spill
      context:
        - Rice spill near the sink

---
from: roomba-kitchen
received: 2026-01-31T18:00:05-08:00
channel: webhook

MESS:
  - status:
      re: 2026-01-31-002
      code: claimed

---
from: roomba-kitchen
received: 2026-01-31T18:01:00-08:00
channel: webhook

MESS:
  - status:
      re: 2026-01-31-002
      code: needs_input
      message: multiple spills detected
      questions:
        - field: location
          question: "Rice near sink AND crumbs by stove. Which area?"
          options: [near sink, by stove, both]

---
from: claude-agent
received: 2026-01-31T18:02:30-08:00
channel: mcp

MESS:
  - reply:
      re: 2026-01-31-002
      answers:
        location: both

---
from: roomba-kitchen
received: 2026-01-31T18:03:00-08:00
channel: webhook

MESS:
  - status:
      re: 2026-01-31-002
      code: in_progress
      message: starting with sink area
```

---

## File Naming Convention

```
~/.mess/
  config.yaml                         # Exchange config, executors
  
  # Status-based folders
  state=received/                           # New requests, not yet claimed
    2026-01-31-001.messe-af.yaml
    
  state=executing/                          # Claimed and being worked on
    2026-01-31-002.messe-af.yaml
    
  state=finished/                           # Successfully completed
    2026-01-31-003.messe-af.yaml
    
  state=canceled/                           # Cancelled, failed, declined, expired
    2026-01-31-004.messe-af.yaml
    
  archive/                            # Old finished threads (optional)
    2026-01/
      ...
```

### Folder Mapping

Folders use Hive-style partitioning (`state=value`) enabling efficient DuckDB queries:

```sql
-- Read all threads, state is auto-extracted as a column
SELECT * FROM read_yaml_auto('~/.mess/state=*/*.messe-af.yaml', hive_partitioning=true)
WHERE state = 'executing';
```

| Folder | Statuses |
|--------|----------|
| `state=received/` | `pending` |
| `state=executing/` | `claimed`, `in_progress`, `waiting`, `held`, `needs_input`, `needs_confirmation`, `retrying` |
| `state=finished/` | `completed`, `partial` |
| `state=canceled/` | `cancelled`, `failed`, `declined`, `expired`, `delegated`, `superseded` |

### File Movement

When status changes, the exchange moves the file to the appropriate folder:

```
state=received/001.messe-af.yaml
    ↓ (claimed)
state=executing/001.messe-af.yaml
    ↓ (completed)
state=finished/001.messe-af.yaml
```

This enables simple queries:
```bash
# What's pending?
ls ~/.mess/state=received/

# What's being worked on?
ls ~/.mess/state=executing/

# How many completed today?
ls ~/.mess/state=finished/ | grep "2026-01-31"
```

### Alternative: Flat with Symlinks

For DuckDB queries, a flat structure with symlinks can work:

```
~/.mess/
  threads/                            # All threads (canonical location)
    2026-01-31-001.messe-af.yaml
    2026-01-31-002.messe-af.yaml
    
  by-status/                          # Symlinks by status
    state=received/
      2026-01-31-001.messe-af.yaml → ../../threads/...
    state=executing/
      2026-01-31-002.messe-af.yaml → ../../threads/...
```

This allows both:
- `ls by-status/received/` for quick status checks
- `read_yaml_auto('threads/*.messe-af.yaml')` for full queries

---

## Write Operations Summary

### Create New Thread

1. Generate `ref` (date-seq or UUID)
2. Write envelope (doc 1) + first message (doc 2) to `received/{ref}.messe-af.yaml`

### Append Message

1. Find file in current folder
2. Append `---` + message doc to file
3. **If status changed:** update envelope, move file if needed
4. **If no status change:** done (no envelope rewrite)

### Status → Folder Mapping

```
pending                    → received/
claimed, in_progress,      → executing/
  waiting, held,
  needs_input,
  needs_confirmation,
  retrying
completed, partial         → finished/
failed, declined,          → canceled/
  cancelled, expired,
  delegated, superseded
```

### Query by Status

```bash
# What needs attention?
ls ~/.mess/state=received/

# What's being worked on?
ls ~/.mess/state=executing/

# What finished today?
ls ~/.mess/state=finished/ | grep "$(date +%Y-%m-%d)"

# What failed?
ls ~/.mess/state=canceled/
```

With DuckDB (optional):
```sql
-- All executing threads
SELECT * FROM read_yaml_auto('~/.mess/state=executing/*.messe-af.yaml');

-- Everything
SELECT * FROM read_yaml_auto('~/.mess/*/*.messe-af.yaml');
```

---

## MCP Server Integration

The MCP server manages MESSE-AF files directly using multi-document YAML:

```typescript
// mess() tool
async function mess(message: string, exchange: string = 'local') {
    const parsed = parseYAML(message);
    
    if (hasRequest(parsed)) {
        // New thread: write envelope + first message as 2 YAML docs
        const ref = generateRef();
        const envelope = createEnvelope(ref, agentId, parsed);
        const messageDoc = createMessageDoc(agentId, 'mcp', parsed);
        await writeMultiDocYAML(`received/${ref}.messe-af.yaml`, [envelope, messageDoc]);
        await dispatch(envelope);  // Notify executors
        return { ref, status: 'pending' };
    }
    
    if (hasReply(parsed) || hasCancel(parsed)) {
        // Existing thread: append new YAML doc, update envelope
        const ref = extractRef(parsed);
        const folder = await findThreadFolder(ref);
        const messageDoc = createMessageDoc(agentId, 'mcp', parsed);
        await appendYAMLDoc(`${folder}/${ref}.messe-af.yaml`, messageDoc);
        await updateEnvelope(ref, parsed);
        return { ref, status: await getStatus(ref) };
    }
}

// mess_status() tool
async function messStatus(ref?: string) {
    if (ref) {
        // Parse first YAML doc only (envelope)
        return await readEnvelope(ref);
    }
    // Return all non-terminal threads
    return await listThreads({ terminal: false });
}
```

---

## Optional: Simple Router

For capability-based routing without a database:

```yaml
# ~/.mess/config.yaml
executors:
  teague-phone:
    name: "Teague's Phone"
    capabilities: [visual_sensor, audio_sensor, mobility, judgment]
    access: [home, san_anselmo]
    notify:
      slack: U04XXXXXX
      # or telegram: 123456789
      # or webhook: https://...
      
  roomba-kitchen:
    name: "Kitchen Roomba"
    capabilities: [cleaning, mobility]
    access: [home/kitchen, home/living_room]
    notify:
      webhook: http://localhost:8080/roomba/mess
      
  instacart-proxy:
    name: "Instacart"
    capabilities: [purchasing, delivery]
    access: [san_anselmo, san_rafael]
    notify:
      webhook: https://my-proxy.example.com/instacart

routing:
  # Optional rules, otherwise broadcast to capable executors
  - match: { capability: cleaning }
    prefer: [roomba-kitchen]
  - match: { capability: purchasing }
    prefer: [instacart-proxy]
  - default:
    prefer: [teague-phone]  # Human fallback
```

Router logic:
1. Parse `requires` from request
2. Filter executors by capability match
3. Apply routing rules
4. Notify preferred executor(s)

---

## Comparison: MESSE-AF vs Raw MESS

| Aspect | MESSE-AF | Raw MESS Messages |
|--------|----------|-------------------|
| State tracking | Envelope caches current state | Must replay messages |
| Audit trail | Full history in one file | Scattered across time |
| Query pending | `ls received/` | Need index |
| Append message | `echo "---" >> file` | Parse, modify, rewrite |
| Portability | Single file = single thread | Need to group by ref |
| Human readable | Yes, multi-doc YAML | Yes, YAML |
| Protocol purity | Envelope is exchange-specific | Pure protocol |

The MESSE-AF format is essentially **MESS messages + email-style threading metadata**, using multi-document YAML for efficient append-only writes.

---

*MESSE-AF v1.0.0 — Ready for implementation*
