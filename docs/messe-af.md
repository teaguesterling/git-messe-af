# MESSE-AF: MESS Exchange Activity File
## Thread File Format for File-Based Exchanges

**Version:** 2.1.0
**Date:** 2026-02-01

---

## Overview

A MESSE-AF file represents a single request thread in a MESS exchange. It contains:
1. **Envelope** — Exchange-managed metadata
2. **Messages** — Chronological MESS protocol messages

The envelope tracks state; messages are the source of truth.

File extension: `.messe-af.yaml` or `.messe-af`

---

## Changelog

### v2.1.0 (2026-02-01)

**Addressable Messages & Resource URIs**

- **Message-level `re:`** — The `re:` field now appears at the message document level, not inside MESS blocks. This eliminates redundant repetition.

- **Deterministic message refs** — Every message (except acks) receives a ref: `{thread-ref}/{mess-type}-{serial}-{tokenized-id}`. Examples:
  - `2026-02-01-001-fridge-check/claim-001`
  - `2026-02-01-001-fridge-check/response-002-inventory`

- **Acks are system messages** — Exchange acks don't consume serial numbers and don't receive message refs. They confirm receipt but aren't addressable content.

- **`content://` resource URIs** — For MCP context, attachments use resource URIs instead of file paths:
  ```yaml
  image:
    resource: content://2026-02-01-001/att-002-image-fridge.jpg
    mime: image/jpeg
    size: 328847
  ```

- **`size` field required** — External attachments must include size in bytes.

- **Executor `id:` on responses** — Executors can optionally include `id:` on responses; the exchange assigns a `ref:` making the response addressable.

### v2.0.0 (2026-02-01)

- Directory-based storage for threads
- External attachments (no inline base64 bloat)
- Thread file overflow for long conversations

### v1.0.0 (2026-01-31)

- Initial specification
- Multi-document YAML format
- Hive-style folder partitioning

---

## Identifiers

### Core Identifier Fields

| Field | Meaning | Assigned By | Scope |
|-------|---------|-------------|-------|
| `id:` | "I call this..." | Sender (optional) | Local to sender |
| `ref:` | "We collectively call this..." | Exchange (required) | Canonical, global |
| `re:` | "I'm referring to..." | Sender | Points to a `ref:` |

### Thread References

When a client creates a request, it may include an `id:` for local tracking. The exchange assigns a canonical `ref:` that becomes the thread identifier:

```yaml
# Client sends request with optional id
from: claude-desktop
MESS:
  - v: 1.0.0
  - request:
      id: check-fridge           # Client's local identifier
      intent: Quick fridge inventory

---
# Exchange acks with canonical ref
from: exchange
MESS:
  - ack:
      re: check-fridge
      ref: 2026-02-01-003-check-fridge   # Thread ref (includes tokenized id)
```

The thread `ref:` format: `{date}-{serial}-{tokenized-id}`
- Date: `YYYY-MM-DD`
- Serial: Zero-padded sequence for that day (e.g., `003`)
- Tokenized ID: Optional, derived from client's `id:` if provided

### Message References

Every message (except acks) receives a deterministic `ref:` from the exchange:

```
{thread-ref}/{mess-type}-{serial}-{tokenized-id}
```

| Component | Description |
|-----------|-------------|
| `thread-ref` | The parent thread's ref |
| `mess-type` | Message type: `claim`, `status`, `response`, `question`, `answer`, `cancel`, `followup` |
| `serial` | Three-digit sequence within thread (001, 002, ...) |
| `tokenized-id` | Optional, from sender's `id:` if provided |

**Example sequence:**
```
Thread created:     2026-02-01-003-check-fridge
Executor claims:    2026-02-01-003-check-fridge/claim-001
Executor responds:  2026-02-01-003-check-fridge/response-002
Executor asks:      2026-02-01-003-check-fridge/question-003-include-drawers
Client answers:     2026-02-01-003-check-fridge/answer-004-yes-veggies
Executor responds:  2026-02-01-003-check-fridge/response-005-veggie-photo
```

### Acks Are System Messages

Acks are exchange-generated confirmations. They do **not** consume serial numbers and do **not** receive message refs. They are protocol metadata, not addressable content.

```yaml
# Executor sends response with optional id
from: teague-phone
re: 2026-02-01-003-check-fridge
MESS:
  - response:
      id: veggie-photo           # Executor's local identifier
      content:
        - image: ...

---
# Exchange acks (no message ref assigned to the ack itself)
from: exchange
MESS:
  - ack:
      re: veggie-photo
      ref: 2026-02-01-003-check-fridge/response-002-veggie-photo
```

### The `re:` Field

The `re:` field appears at the **message document level**, not inside MESS blocks. It indicates what thread or message this message refers to:

```yaml
# Correct: re: at message level
from: teague-phone
re: 2026-02-01-003-check-fridge      # Message-level reference
MESS:
  - status:
      code: claimed
  - response:
      content:
        - "On my way to the kitchen"

# Incorrect (deprecated): re: inside each block
MESS:
  - status:
      re: 2026-02-01-003-check-fridge   # Don't do this
      code: claimed
```

**When `re:` is omitted:**
- For the initial request: creates a new thread
- For messages inside a MESSE-AF file: implied by file location

**Multiple requests in one message:**
```yaml
# Client sends two requests (each gets its own thread)
from: claude-desktop
MESS:
  - request:
      id: task-a
      intent: check the fridge
  - request:
      id: task-b
      intent: water the plants

---
# Exchange acks with mapping (creates two separate threads)
from: exchange
MESS:
  - ack:
      requests:
        - id: task-a
          ref: 2026-02-01-003-task-a
        - id: task-b
          ref: 2026-02-01-004-task-b
```

---

## File Structure

A MESSE-AF file is a **multi-document YAML file**:

1. **First document:** Envelope (exchange-managed, updated on each write)
2. **Subsequent documents:** Messages (append-only)

```yaml
# === DOCUMENT 1: ENVELOPE ===
ref: 2026-02-01-001-fridge-check
client_id: my-task-1              # If client provided id
requestor: claude-agent
executor: teague-phone
status: completed
created: 2026-02-01T17:00:00-08:00
updated: 2026-02-01T17:05:00-08:00
intent: check what's in the fridge
priority: normal

history:
  - action: created
    at: 2026-02-01T17:00:00-08:00
    by: claude-agent
  - action: dispatched
    at: 2026-02-01T17:00:01-08:00
    by: exchange
  - action: claimed
    at: 2026-02-01T17:00:30-08:00
    by: teague-phone
    ref: 2026-02-01-001-fridge-check/claim-001
  - action: completed
    at: 2026-02-01T17:05:00-08:00
    by: teague-phone
    ref: 2026-02-01-001-fridge-check/response-002-inventory

---
# === DOCUMENT 2: First message (agent request) ===
# No 're:' needed - this creates the thread
from: claude-agent
received: 2026-02-01T17:00:00-08:00
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
# === DOCUMENT 3: Exchange ack (no message ref, system message) ===
from: exchange
received: 2026-02-01T17:00:01-08:00

MESS:
  - ack:
      re: my-task-1
      ref: 2026-02-01-001-fridge-check

---
# === DOCUMENT 4: Executor claims ===
from: teague-phone
received: 2026-02-01T17:00:30-08:00
channel: http
re: 2026-02-01-001-fridge-check          # Message-level reference

MESS:
  - status:
      code: claimed

---
# === DOCUMENT 5: Exchange ack for claim (no message ref) ===
from: exchange
received: 2026-02-01T17:00:30-08:00

MESS:
  - ack:
      ref: 2026-02-01-001-fridge-check/claim-001

---
# === DOCUMENT 6: Executor completes with response ===
from: teague-phone
received: 2026-02-01T17:05:00-08:00
channel: http
re: 2026-02-01-001-fridge-check          # Message-level reference

MESS:
  - status:
      code: completed
  - response:
      id: inventory                       # Executor's optional local id
      content:
        - image:
            file: att-002-image-fridge.jpg
            mime: image/jpeg
            size: 328847
        - |
          Proteins: chicken thighs (1 lb, expires tomorrow)
          Vegetables: broccoli, carrots, half onion
          Dairy: milk, cheddar, butter
      notes: chicken should be used tonight

---
# === DOCUMENT 7: Exchange ack for response (no message ref) ===
from: exchange
received: 2026-02-01T17:05:00-08:00

MESS:
  - ack:
      re: inventory
      ref: 2026-02-01-001-fridge-check/response-002-inventory
```

---

## Message Document Fields

Each message document (after the envelope) has:

| Field | Type | Description |
|-------|------|-------------|
| `from` | string | Actor ID: agent, executor, or `exchange` |
| `received` | datetime | When exchange received/generated the message |
| `channel` | string | Optional: `mcp`, `slack`, `http`, `telegram`, `webhook` |
| `re` | string | Reference to thread or message this relates to (message-level) |
| `MESS` | list | The MESS protocol message |

**Note:** The `re:` field is at the message document level, NOT inside MESS blocks. This eliminates redundant repetition when a message contains multiple blocks (e.g., `status` + `response`).

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
received: 2026-02-01T18:02:30-08:00
channel: mcp
re: 2026-02-01-001-fridge-check

MESS:
  - answer:
      id: location-answer
      value: both
EOF

# No envelope update needed — status didn't change
```

### Append Message + Update Envelope (State Change)

```bash
# 1. Append the message
cat >> ~/.mess/state=received/${ref}.messe-af.yaml << 'EOF'
---
from: teague-phone
received: 2026-02-01T17:00:30-08:00
channel: http
re: 2026-02-01-001-fridge-check

MESS:
  - status:
      code: claimed
EOF

# 2. Update envelope (rewrite first doc)
#    - status: pending → claimed
#    - executor: teague-phone
#    - updated: now
#    - history: append claimed entry with ref

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

Each history entry records a state change. Entries for non-ack messages include the message `ref`:

```yaml
history:
  - action: created
    at: 2026-02-01T17:00:00-08:00
    by: claude-agent

  - action: dispatched
    at: 2026-02-01T17:00:01-08:00
    by: exchange
    note: "notified teague-phone via slack"

  - action: claimed
    at: 2026-02-01T17:00:30-08:00
    by: teague-phone
    ref: 2026-02-01-001-fridge-check/claim-001

  - action: completed
    at: 2026-02-01T17:05:00-08:00
    by: teague-phone
    ref: 2026-02-01-001-fridge-check/response-002-inventory
```

---

## Example: Complete Thread

```yaml
ref: 2026-02-01-001-fridge-check
client_id: check-fridge
requestor: claude-agent
executor: teague-phone
status: completed
created: 2026-02-01T17:00:00-08:00
updated: 2026-02-01T17:05:00-08:00
intent: check what's in the fridge
priority: normal

history:
  - action: created
    at: 2026-02-01T17:00:00-08:00
    by: claude-agent
  - action: dispatched
    at: 2026-02-01T17:00:01-08:00
    by: exchange
    note: "notified via slack"
  - action: claimed
    at: 2026-02-01T17:00:30-08:00
    by: teague-phone
    ref: 2026-02-01-001-fridge-check/claim-001
  - action: completed
    at: 2026-02-01T17:05:00-08:00
    by: teague-phone
    ref: 2026-02-01-001-fridge-check/response-002-inventory

---
# Request (creates thread, no re: needed)
from: claude-agent
received: 2026-02-01T17:00:00-08:00
channel: mcp

MESS:
  - v: 1.0.0
  - request:
      id: check-fridge
      intent: check what's in the fridge
      context:
        - Planning dinner for 4
        - Kids prefer pasta
      response_hint:
        - text
        - image

---
# Exchange ack (system message, no message ref)
from: exchange
received: 2026-02-01T17:00:01-08:00

MESS:
  - ack:
      re: check-fridge
      ref: 2026-02-01-001-fridge-check

---
# Executor claims (message-level re:)
from: teague-phone
received: 2026-02-01T17:00:30-08:00
channel: http
re: 2026-02-01-001-fridge-check

MESS:
  - status:
      code: claimed

---
# Exchange ack for claim
from: exchange
received: 2026-02-01T17:00:30-08:00

MESS:
  - ack:
      ref: 2026-02-01-001-fridge-check/claim-001

---
# Executor completes with response
from: teague-phone
received: 2026-02-01T17:05:00-08:00
channel: http
re: 2026-02-01-001-fridge-check

MESS:
  - status:
      code: completed
  - response:
      id: inventory
      content:
        - image:
            file: att-002-image-fridge.jpg
            mime: image/jpeg
            size: 328847
        - |
          Proteins: chicken thighs (1 lb, expires tomorrow)
          Vegetables: broccoli, carrots, half onion
          Dairy: milk, cheddar, butter
          Pantry: rice, pasta, soy sauce
      notes: chicken should be used tonight

---
# Exchange ack for response
from: exchange
received: 2026-02-01T17:05:00-08:00

MESS:
  - ack:
      re: inventory
      ref: 2026-02-01-001-fridge-check/response-002-inventory
```

---

## Example: Needs Input Flow

```yaml
ref: 2026-02-01-002-vacuum-spill
requestor: claude-agent
executor: roomba-kitchen
status: in_progress
created: 2026-02-01T18:00:00-08:00
updated: 2026-02-01T18:03:00-08:00
intent: vacuum the kitchen spill
priority: normal

history:
  - action: created
    at: 2026-02-01T18:00:00-08:00
    by: claude-agent
  - action: claimed
    at: 2026-02-01T18:00:05-08:00
    by: roomba-kitchen
    ref: 2026-02-01-002-vacuum-spill/claim-001
  - action: needs_input
    at: 2026-02-01T18:01:00-08:00
    by: roomba-kitchen
    ref: 2026-02-01-002-vacuum-spill/question-002-which-area
    note: "multiple spills detected"
  - action: replied
    at: 2026-02-01T18:02:30-08:00
    by: claude-agent
    ref: 2026-02-01-002-vacuum-spill/answer-003-both
  - action: in_progress
    at: 2026-02-01T18:03:00-08:00
    by: roomba-kitchen
    ref: 2026-02-01-002-vacuum-spill/status-004

---
# Request
from: claude-agent
received: 2026-02-01T18:00:00-08:00
channel: mcp

MESS:
  - v: 1.0.0
  - request:
      id: vacuum-spill
      intent: vacuum the kitchen spill
      context:
        - Rice spill near the sink

---
# Exchange ack
from: exchange
received: 2026-02-01T18:00:00-08:00

MESS:
  - ack:
      re: vacuum-spill
      ref: 2026-02-01-002-vacuum-spill

---
# Executor claims
from: roomba-kitchen
received: 2026-02-01T18:00:05-08:00
channel: webhook
re: 2026-02-01-002-vacuum-spill

MESS:
  - status:
      code: claimed

---
# Executor asks a question
from: roomba-kitchen
received: 2026-02-01T18:01:00-08:00
channel: webhook
re: 2026-02-01-002-vacuum-spill

MESS:
  - status:
      code: needs_input
      message: multiple spills detected
      questions:
        - id: which-area
          question: "Rice near sink AND crumbs by stove. Which area?"
          options: [near sink, by stove, both]

---
# Exchange ack for question
from: exchange
received: 2026-02-01T18:01:00-08:00

MESS:
  - ack:
      re: which-area
      ref: 2026-02-01-002-vacuum-spill/question-002-which-area

---
# Agent answers the question (re: the specific question)
from: claude-agent
received: 2026-02-01T18:02:30-08:00
channel: mcp
re: 2026-02-01-002-vacuum-spill/question-002-which-area

MESS:
  - answer:
      id: both
      value: both

---
# Exchange ack for answer
from: exchange
received: 2026-02-01T18:02:30-08:00

MESS:
  - ack:
      re: both
      ref: 2026-02-01-002-vacuum-spill/answer-003-both

---
# Executor resumes work
from: roomba-kitchen
received: 2026-02-01T18:03:00-08:00
channel: webhook
re: 2026-02-01-002-vacuum-spill

MESS:
  - status:
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

---

## V2: Directory-Based Thread Storage

**Version:** 2.0.0
**Date:** 2026-02-01

### Overview

V2 extends the file format to use directories instead of flat files, enabling:
- External attachments (no inline base64 bloat)
- Thread file overflow for long conversations
- Easy archiving as zip files
- Compatibility with GitHub's API limits (1MB per file)

V2 is backward-compatible: readers should detect and handle both v1 flat files and v2 directories.

### Directory Structure

```
exchange/
  state=received/
    2026-02-01-001/                         # Thread directory
      000-2026-02-01-001.messe-af.yaml      # Primary thread file
      001-2026-02-01-001.messe-af.yaml      # Overflow (if needed)
      att-001-image-IMG_0001.jpg            # External attachment
      att-002-file-assembly_instructions.pdf
    2026-02-01-002/
      000-2026-02-01-002.messe-af.yaml
  state=executing/
    ...
```

### Size Limits

| Limit | Value | Rationale |
|-------|-------|-----------|
| Thread file | 1 MB | GitHub Contents API limit |
| Inline attachment | 768 KB | 0.75 MB (3 × 2⁸ KB), leaves ~256KB for envelope + messages |
| Image compression | 500 KB target | Applied before embedding |
| External attachment | No limit | Stored as separate files |

**Note:** Images are compressed to ~500KB target. If still over 768KB after compression, they're stored externally.

### File Numbering

- Primary file: `000-{ref}.messe-af.yaml`
- Overflow files: `001-{ref}.messe-af.yaml`, `002-{ref}.messe-af.yaml`, etc.
- Envelope lives in `000-*` only
- Messages append to highest-numbered file until it exceeds limit
- Reading a thread: concatenate all numbered files in order

### Attachment References

**File naming convention:**
```
att-{serial}-{type}-{original_name_sanitized}.{ext}
```

The serial number matches the message serial that introduced the attachment, making it easy to associate attachments with their source messages.

Examples:
- `att-001-image-IMG_0001.jpg` — from message `claim-001`
- `att-002-image-fridge.jpg` — from message `response-002`
- `att-005-file-receipt.pdf` — from message `response-005`

**Type prefixes:**
- `image` - jpg, png, gif, webp
- `audio` - mp3, wav, m4a
- `video` - mp4, mov, webm
- `file` - pdf, doc, txt, etc.

**In YAML — File Context (filesystem storage):**
```yaml
content:
  - image:
      file: att-002-image-fridge.jpg      # Relative to thread directory
      name: IMG_0001.jpg                   # Original filename (optional)
      mime: image/jpeg
      size: 328847                         # Size in bytes
  - file:
      file: att-005-file-receipt.pdf
      name: Grocery Receipt.pdf
      mime: application/pdf
      size: 45230
  - Small inline text stays inline
  - image: data:image/png;base64,...      # Images under 768KB can stay inline
```

**Required fields for external attachments:**
| Field | Required | Description |
|-------|----------|-------------|
| `file` | Yes | Relative path to attachment file |
| `mime` | Yes | MIME type |
| `size` | Yes | Size in bytes |
| `name` | No | Original filename if different from stored name |

### Resource URIs (MCP Context)

When serving content via MCP (not direct filesystem access), attachments are referenced using `content://` resource URIs instead of file paths:

```yaml
content:
  - image:
      resource: content://2026-02-01-003-fridge-check/att-002-image-fridge.jpg
      mime: image/jpeg
      size: 328847
  - "Here's what's in the fridge"
```

**Resource URI format:**
```
content://{thread-ref}/{attachment-filename}
```

Or for message-specific references:
```
content://{thread-ref}/{message-ref}/{attachment-filename}
```

Examples:
- `content://2026-02-01-003-fridge-check/att-002-image-fridge.jpg`
- `content://2026-02-01-003-fridge-check/response-002-inventory/att-002-image-fridge.jpg`

**MCP Server Behavior:**

1. When returning thread status, the MCP server:
   - Extracts embedded base64 data from responses
   - Writes attachments to local cache
   - Rewrites inline `data:` URIs to `content://` resource URIs
   - Returns lightweight response with resource references

2. Agents fetch resources on-demand:
   - View text content immediately
   - Request specific attachments via MCP resource protocol when needed
   - Avoids blowing context with large base64 payloads

**When to use which format:**

| Context | Format | Example |
|---------|--------|---------|
| Filesystem storage | `file:` | `file: att-002-image-fridge.jpg` |
| MCP/API response | `resource:` | `resource: content://...` |
| Small inline data | `data:` | `image: data:image/png;base64,...` |

### Reading a Thread

1. Check if `{ref}` is a directory or file
2. If directory:
   - Read all `{nnn}-{ref}.messe-af.yaml` files in numeric order
   - First file contains envelope as document 1
   - Concatenate all message documents from all files
   - Resolve `file:` references relative to thread directory
3. If file (v1 format):
   - Read as before

### Writing a Thread

**Create new thread:**
1. Create directory `state=received/{ref}/`
2. Write `000-{ref}.messe-af.yaml` with envelope + initial messages

**Append message:**
1. Find highest-numbered `{nnn}-{ref}.messe-af.yaml`
2. If adding message would exceed 1MB:
   - Create next file `{nnn+1}-{ref}.messe-af.yaml`
   - Write message there (no envelope in overflow files)
3. Otherwise append to current file

**Add attachment:**
1. Determine attachment serial (next available across all files)
2. Determine type prefix based on mime type
3. Sanitize original filename (remove spaces, special chars)
4. Write to `att-{serial}-{type}-{sanitized}.{ext}`
5. Reference in YAML with `file:` block

### Archive Format

Zip the directory for transport/backup:
```
2026-02-01-001.messe-af.zip
  └── 2026-02-01-001/
      ├── 000-2026-02-01-001.messe-af.yaml
      ├── 001-2026-02-01-001.messe-af.yaml
      └── att-001-image-IMG_0001.jpg
```

### Moving Threads (Status Changes)

When status changes require moving to a different folder:
1. Move the entire directory atomically
2. With GitHub Git Data API: create new tree with directory in new location, delete from old

### Backward Compatibility

- Readers must support both v1 (flat files) and v2 (directories)
- Detection: check if `{ref}` path is a directory or file
- New threads should use v2 format
- V1 threads can remain as-is until modified (optional migration)

---

*MESSE-AF v2.1.0 — Directory-based storage with addressable messages and resource URIs*
