# MESS Protocol
## Meatspace Execution and Submission System

```yaml
version: 1.0.0
status: stable
date: 2026-01-31
authors:
  - Teague Stirling
  - Claude (Anthropic)
```

### Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-31 | Initial release |

---

## Overview

MESS enables agents to dispatch physical-world tasks to executors. Executors may be humans, robots, IoT devices, proxy services, or other agents. Routing is based on **capabilities**, not executor identity.

### Design Principles

1. **Minimal required fields** — Only `intent` is mandatory
2. **Executor-agnostic** — Humans and robots are equivalent
3. **Capability-addressed** — Route by skill, not identity
4. **Reference flexibility** — IDs are optional, exchange-assigned, or casual
5. **Rich context** — MIME-like multipart content in requests and responses

---

## 1. Message Structure

All messages are `MESS:` blocks containing a **list** of typed payloads:

```yaml
MESS:
  - v: 1.0.0              # Optional, defaults to latest
  - <type>:
      <payload>
  - <type>:
      <payload>
```

This list structure:
- Preserves message order
- Allows multiple payloads of the same type
- Maps cleanly to JSON: `[{"v": "1.0.0"}, {"request": {...}}]`

### 1.1 Protocol Version

The `v:` field is optional. When omitted, the exchange assumes the current version. Include it for:
- Explicit version pinning
- Cross-exchange compatibility
- Debugging version mismatches

```yaml
# Minimal (version implied)
MESS:
  - request:
      intent: what's in the fridge?

# Explicit version
MESS:
  - v: 1.0.0
  - request:
      intent: what's in the fridge?
```

### 1.2 Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `request` | Agent → Exchange | Request physical-world action |
| `reply` | Agent → Exchange | Answer questions, confirm actions |
| `cancel` | Agent → Exchange | Cancel pending request |
| `query` | Agent → Exchange | Ask about pending requests |
| `config` | Agent → Exchange | Configure executors/routing |
| `ack` | Exchange → Agent | Acknowledge receipt |
| `status` | Executor → Agent | Report task state |
| `response` | Executor → Agent | Deliver completed result |
| `suggestion` | Executor → Agent | Propose protocol action |

### 1.3 The `re:` Field

Messages reference other messages using `re:` (like email Reply-To):

```yaml
MESS:
  - status:
      re: fridge-check         # Client-assigned ID
      code: completed

MESS:
  - status:
      re: shop:2026-01-31:042  # Exchange-assigned ID
      code: claimed

MESS:
  - cancel:
      re: [req-1, req-2]       # Multiple references

MESS:
  - reply:
      re: last                 # Most recent request
      confirm: true
```

**ID Assignment:**
- `id:` on requests is optional (client-assigned)
- Exchange may stamp its own ID in `ack`
- Exchange may namespace: `household:fridge` vs `moltbook:a3f8c2`

---

## 2. Context & Content Format

Both request `context:` and response `content:` use the same MIME-like format:

```yaml
context:                              # or content:
  - Plain text is bare string
  - More text, order preserved
  - image: https://example.com/ref.jpg
  - image: data:image/png;base64,ABC123...
  - audio: data:audio/wav;base64,...
  - file: file://local/path.stl
  - file:
      uri: https://example.com/schematic.pdf
      name: assembly instructions
      mime: application/pdf
  - url: https://recipe.com/stir-fry
  - json: { items: [onions, garlic], servings: 4 }
  - ref: previous-request-id
  - embedding: [0.123, -0.456, 0.789, ...]
```

### 2.1 Context Entry Types

| Type | Format | Description |
|------|--------|-------------|
| *(bare string)* | `- text here` | Plain text context |
| `image` | URL or data URI | Photo, diagram, reference |
| `audio` | URL or data URI | Audio clip, voice note |
| `video` | URL or data URI | Video clip |
| `file` | URI or `{uri, name?, mime?}` | File attachment |
| `url` | URL string | Web page reference |
| `json` | Inline object | Structured data |
| `ref` | Request/response ID | Cross-reference |
| `embedding` | `[float]` | Vector for semantic matching |

### 2.2 Response-Only Content Types

| Type | Format | Description |
|------|--------|-------------|
| `text` | String | Explicit text (vs bare string) |
| `confirmation` | `true`/`false` or `{confirmed, details?}` | Yes/no result |
| `structured` | Object | Typed structured data |
| `error` | `{code, message, detail?}` | Error information |

### 2.3 Data URI Format

For inline binary data, use standard data URIs:

```
data:<mime>;base64,<data>
```

Examples:
- `data:image/png;base64,iVBORw0KGgo...`
- `data:audio/wav;base64,UklGRi4A...`
- `data:application/pdf;base64,JVBERi0...`

### 2.4 Reference Resolution

| Format | Resolves To |
|--------|-------------|
| `https://...`, `http://...` | Fetch URL content |
| `file://...` | Local filesystem |
| `data:...` | Inline encoded data |
| Bare string in list | Text |
| MESS ID (in `ref:`) | Previous request/response |

---

## 3. Request Message

### 3.1 Minimal Request

```yaml
MESS:
  - request:
      intent: what's in the fridge?
```

### 3.2 Full Request Schema

```yaml
MESS:
  - request:
      # === REQUIRED ===
      intent: string
      
      # === OPTIONAL: Identity ===
      id: string                    # Client-assigned reference (exchange returns 'ref' in ack)
      
      # === OPTIONAL: Precision ===
      precision: loose | guided | exact
      
      # === OPTIONAL: Capabilities ===
      requires:
        - <capability-id>                    # Simple capability ID
        - <capability-id>: <metadata>        # With exchange-specific metadata
      
      # === OPTIONAL: Context (MIME-like) ===
      context:
        - <entry>
        - <entry>
        
      # === OPTIONAL: Constraints ===
      constraints:
        location: string | { lat, lng, radius_km }
        timing:
          not_before: datetime
          expires: datetime | duration    # "2h" or ISO8601
          urgency: whenever | soon | now
        environment: [string]             # "daylight", "indoor"
        depends_on: [id]                  # Other requests
        
      # === OPTIONAL: Response Hints ===
      response_hint:
        - <type>
        - <type>: <spec>
        
      # === OPTIONAL: Priority ===
      priority: background | normal | elevated | urgent
      compensation:
        shells: integer
        note: string
```

### 3.3 Request Examples

**Loose — Exploratory:**
```yaml
MESS:
  - request:
      intent: show me something about San Anselmo
      precision: loose
```

**Guided — Clear goal:**
```yaml
MESS:
  - request:
      intent: check what ingredients we have for dinner
      context:
        - Planning meal for family of 4
        - Kids ages 6 and 9, prefer pasta
      response_hint:
        - text: list proteins, vegetables, starches
        - image
```

**Exact — Precise specification:**
```yaml
MESS:
  - request:
      id: vacuum-kitchen
      intent: vacuum the rice spill in front of the kitchen sink
      precision: exact
      requires:
        - vacuum-floor
        - home-kitchen-access
      response_hint:
        - confirmation
```

**With attachments:**
```yaml
MESS:
  - request:
      intent: print 4 of these cable clips and assemble per instructions
      precision: exact
      requires:
        - 3d-print-fdm
        - assembly
      context:
        - Need these for desk cable management
        - file:
            uri: file://clip_v2.stl
            name: clip body model
        - file:
            uri: file://assembly.pdf
            name: spring attachment instructions
        - image:
            uri: https://example.com/orientation.png
            name: print orientation reference
      response_hint:
        - image: completed assemblies
        - confirmation
```

**Batch with dependencies:**
```yaml
MESS:
  - request:
      id: get-onions
      intent: buy yellow onions
      constraints:
        location: grocery store near home
        
  - request:
      id: deliver-onions
      intent: deliver onions to home
      constraints:
        depends_on: [get-onions]
        
  - request:
      id: dice-onions
      intent: dice the onions, medium dice
      requires:
        - precision-knife-work
        - home-kitchen-access
      constraints:
        depends_on: [deliver-onions]
```

---

## 4. Status Message

### 4.1 Status Schema

```yaml
MESS:
  - status:
      re: <reference>
      code: <status_code>
      executor: string              # Optional, may be anonymized
      message: string               # Optional, human-readable
      # ... code-specific fields
```

### 4.2 Status Codes

#### Acknowledgment
| Code | Description | Fields |
|------|-------------|--------|
| `received` | Exchange received request | `queue_position?`, `exchange_id?` |

#### Active
| Code | Description | Fields |
|------|-------------|--------|
| `claimed` | Executor accepted | `executor`, `eta?` |
| `in_progress` | Work underway | `progress_pct?`, `eta?`, `partial?` |
| `waiting` | Blocked | `waiting_for: {type, ...}` |
| `held` | Paused by executor | `reason?`, `resume_eta?` |
| `retrying` | Failed, retrying | `attempt`, `max_attempts`, `next_attempt` |

#### Needs Interaction
| Code | Description | Fields | Expects |
|------|-------------|--------|---------|
| `needs_input` | Needs clarification | `questions: [{field, question, options?}]` | `reply` with `answers` |
| `needs_confirmation` | Approval required | `action`, `consequences?`, `reversible?` | `reply` with `confirm` |

#### Terminal: Success
| Code | Description | Fields |
|------|-------------|--------|
| `completed` | Task done | *(response follows)* |
| `partial` | Some completed | `completed: []`, `remaining: []`, `reason?` |

#### Terminal: Failure
| Code | Description | Fields |
|------|-------------|--------|
| `failed` | Couldn't complete | `reason`, `recoverable?`, `suggestion?` |
| `declined` | Executor won't do it | `reason` |
| `expired` | Timed out | `expired_at`, `stage?` |

#### Protocol
| Code | Description | Fields |
|------|-------------|--------|
| `cancelled` | Requester cancelled | `reason?` |
| `superseded` | Replaced by another | `superseded_by`, `reason: merge\|split\|replace` |
| `delegated` | Passed to another | `delegated_to`, `reason?` |

### 4.3 Waiting Types

```yaml
waiting_for:
  type: dependency | condition | resource | access | schedule
  
  # For dependency:
  ref: [request-ids]
  
  # For condition:
  condition: string           # "daylight", "temperature < 30C"
  eta: duration
  
  # For resource:
  resource: string            # "PLA filament", "clean water"
  note: string
  
  # For access:
  location: string
  note: string
  
  # For schedule:
  available_at: datetime
```

### 4.4 Status Examples

**Claimed:**
```yaml
MESS:
  - status:
      re: get-onions
      code: claimed
      executor: instacart-proxy
      eta: 45m
```

**Waiting on dependency:**
```yaml
MESS:
  - status:
      re: dice-onions
      code: waiting
      executor: kitchen-robot
      waiting_for:
        type: dependency
        ref: [deliver-onions]
```

**Waiting on condition:**
```yaml
MESS:
  - status:
      re: outdoor-photo
      code: waiting
      executor: patio-camera
      waiting_for:
        type: condition
        condition: daylight
        eta: 7h
```

**Needs input:**
```yaml
MESS:
  - status:
      re: vacuum-kitchen
      code: needs_input
      executor: roomba
      message: multiple spills detected
      questions:
        - field: location
          question: Rice near sink AND crumbs by stove. Which area?
          options: [near sink, by stove, both]
```

**Needs confirmation:**
```yaml
MESS:
  - status:
      re: cleanup-garage
      code: needs_confirmation
      executor: cleanup-bot
      action: dispose of 12 items marked as trash
      consequences: items cannot be recovered
      reversible: false
```

**In progress:**
```yaml
MESS:
  - status:
      re: print-clips
      code: in_progress
      executor: prusa-mk4
      progress_pct: 35
      eta: 2h15m
      partial:
        layer: 105
        total_layers: 300
```

**Failed:**
```yaml
MESS:
  - status:
      re: garage-check
      code: failed
      executor: indoor-robot
      reason:
        type: access_denied
        detail: garage door is closed
      recoverable: true
      suggestion: open garage door or route to executor with access
```

**Partial:**
```yaml
MESS:
  - status:
      re: vacuum-kitchen
      code: partial
      executor: roomba
      message: vacuumed main area
      completed:
        - main spill area (~80%)
      remaining:
        - rice under cabinet edge
      reason: need smaller tool for cabinet gap
```

---

## 5. Response Message

### 5.1 Response Schema

```yaml
MESS:
  - response:
      re: <reference>
      content:
        - <entry>
        - <entry>
      executor: string            # Optional
      completed_at: datetime      # Optional
      notes: string               # Optional
```

### 5.2 Response Examples

**Simple text:**
```yaml
MESS:
  - response:
      re: fridge-check
      content:
        - |
          Proteins: chicken thighs (1 lb), ground beef (0.5 lb)
          Vegetables: broccoli, carrots, half onion
          Dairy: milk, cheddar, butter
          Pantry: rice, pasta, olive oil
        - Note: chicken expires tomorrow
```

**Image with structured data:**
```yaml
MESS:
  - response:
      re: fridge-check
      content:
        - image: data:image/jpeg;base64,/9j/4AAQ...
        - structured:
            proteins:
              - item: chicken thighs
                quantity: 1 lb
                expires: 2026-02-02
            vegetables:
              - item: broccoli
                quantity: 1 head
              - item: carrots
                quantity: 6
```

**Confirmation with photo:**
```yaml
MESS:
  - response:
      re: vacuum-kitchen
      content:
        - confirmation: true
        - image: data:image/jpeg;base64,...
      notes: moved the mat to get underneath
      completed_at: 2026-01-31T16:45:00-08:00
```

**Fabrication result:**
```yaml
MESS:
  - response:
      re: print-clips
      content:
        - confirmation: { confirmed: true, units: 4 }
        - image: data:image/jpeg;base64,...
        - file:
            uri: file://print_log.json
            name: print telemetry
```

---

## 6. Reply Message

For responding to `needs_input`, `needs_confirmation`, or `suggestion`:

### 6.1 Reply Schema

```yaml
MESS:
  - reply:
      re: <reference>
      
      # For needs_input:
      answers:
        <field>: <value>
        
      # For needs_confirmation:
      confirm: true | false
      
      # For suggestion:
      accept: true | false
      
      # Optional:
      reason: string
      context:
        - <entry>
```

### 6.2 Reply Examples

**Answering questions:**
```yaml
MESS:
  - reply:
      re: vacuum-kitchen
      answers:
        location: both
        priority: sink first
```

**Confirming action:**
```yaml
MESS:
  - reply:
      re: cleanup-garage
      confirm: true
```

**Rejecting with reason:**
```yaml
MESS:
  - reply:
      re: cleanup-garage
      confirm: false
      reason: let me review the items first
```

**With additional context:**
```yaml
MESS:
  - reply:
      re: print-clips
      confirm: true
      context:
        - image: https://example.com/better-orientation.png
        - Actually print them in this orientation instead
```

---

## 7. Other Messages

### 7.1 Cancel

```yaml
MESS:
  - cancel:
      re: <reference>
      reason: string              # Optional
```

### 7.2 Acknowledgment

**Single request:**
```yaml
MESS:
  - ack:
      re: <client-id or "last">   # References client's id or last request
      ref: string                 # Exchange-assigned ID (also MESSE-AF filename)
      received_at: datetime
      queue_position: integer     # Optional
```

**Multiple requests in one message:**
```yaml
MESS:
  - ack:
      requests:
        - id: my-task-1           # Client's ID
          ref: 2026-01-31-001     # Exchange's ref
        - id: my-task-2
          ref: 2026-01-31-002
      received_at: datetime
```

The exchange creates one MESSE-AF thread per request. Use `ref` for subsequent references (`re:` field accepts either client `id` or exchange `ref`).

### 7.3 Query

```yaml
MESS:
  - query:
      type: status | capabilities | executors
      filter:
        re: <reference>
        status: [codes]
        executor: string
        since: datetime
```

### 7.4 Config

```yaml
MESS:
  - config:
      # Register executor
      executor:
        id: string
        name: string              # Optional, human-readable
        capabilities:
          - <capability>
          - <capability>: { level, variants?, constraint? }
        availability: always | schedule | on_demand
        schedule: cron            # If availability: schedule
        
  - config:
      # Or routing rules
      routing:
        rules:
          - match: { capability?, urgency?, precision? }
            prefer: [executor-id] | lower_latency | higher_precision
```

### 7.5 Suggestion

```yaml
MESS:
  - suggestion:
      id: string                  # For reply reference
      type: merge | split | delegate | alternative | defer
      re: [references]            # Related requests
      proposed: <details>
      reason: string
```

**Merge suggestion:**
```yaml
MESS:
  - suggestion:
      id: sug:merge-grocery
      type: merge
      re: [get-onions, get-garlic]
      proposed:
        executor: instacart-proxy
        combined_intent: buy onions and garlic
      reason: same store, saves delivery fee
```

---

## 8. Capabilities

Capabilities are **exchange-level** definitions describing what actions the exchange can delegate to its executors. Executors claim capabilities; requests require them.

### 8.1 Capability Format

A capability is a simple identifier with optional metadata:

```yaml
id: take-photo
description: Capture and attach photos
tags: [visual, attachments]
```

**ID conventions** (recommended, not enforced):
- Use `kebab-case` for readability
- Be specific: `vacuum-floor` not just `cleaning`
- Create distinct IDs for skill levels: `woodworking`, `expert-woodworking`
- Create distinct IDs for variants: `3d-print-fdm`, `3d-print-resin`

### 8.2 Exchange Capability Catalog

Exchanges maintain a catalog of known capabilities. This is informational—it helps with discovery and documentation but doesn't restrict what capabilities can be used.

```yaml
# Example capability definitions (exchange-specific)
---
id: take-photo
description: Capture and attach photos
tags: [visual, attachments]
---
id: check-visual
description: Look at something, read a display
tags: [visual, inspection]
---
id: vacuum-floor
description: Vacuum floors and carpets
tags: [cleaning, maintenance]
---
id: precision-manipulation
description: Fine motor control for delicate tasks
tags: [physical, dexterity]
---
id: home-kitchen-access
description: Physical access to the kitchen
tags: [access, home]
```

**Open capability creation:** Some exchanges (like GitHub-based implementations) allow executors and requestors to freely define new capabilities by adding to the catalog. Others may have a fixed set.

### 8.3 Executors Claim Capabilities

Executors register which capabilities they can handle:

```yaml
MESS:
  - config:
      executor:
        id: roomba-kitchen
        name: Kitchen Roomba
        capabilities:
          - vacuum-floor
          - home-kitchen-access
          - home-living-room-access
        availability: always

  - config:
      executor:
        id: teague-phone
        name: Teague's Phone
        capabilities:
          - take-photo
          - check-visual
          - make-phone-call
          - home-access
          - local-errands
        availability: schedule
        schedule: "0 8-22 * * *"   # 8am-10pm
```

### 8.4 Requests Require Capabilities

Requests can specify required capabilities for routing:

```yaml
MESS:
  - request:
      intent: vacuum the rice spill in front of the kitchen sink
      requires:
        - vacuum-floor
        - home-kitchen-access
```

When `requires` is specified, the exchange routes only to executors claiming all listed capabilities. If omitted, all executors are eligible.

### 8.5 Capability Metadata (Exchange-Specific)

Both requests and executor registrations may include metadata on capabilities. The protocol does not define specific metadata fields—interpretation is left to each exchange:

```yaml
# Request with metadata hints
requires:
  - fabricator: { variant: fdm, material: pla }
  - precision-manipulation: { level: expert }

# Executor registration with metadata
capabilities:
  - vacuum-floor: { areas: [kitchen, living-room] }
  - take-photo: { camera: rear, max-resolution: 4k }
```

Exchanges may use metadata for:
- More precise routing
- Capability matching constraints
- Informational display
- Custom filtering logic

Executors and requestors should gracefully handle unknown metadata fields.

### 8.6 Capability Discovery

Agents can discover available capabilities via query:

```yaml
MESS:
  - query:
      type: capabilities
      filter:
        tags: [visual]
```

Response:
```yaml
MESS:
  - response:
      re: last
      content:
        - structured:
            capabilities:
              - id: take-photo
                description: Capture and attach photos
              - id: check-visual
                description: Look at something, read a display
```

---

## 9. State Machine

```
request
   │
   ▼
received ──────────────────────────────► expired
   │
   ▼
claimed ───────────────────────────────► declined
   │
   ├──► in_progress ◄──┐
   │         │         │
   │         ├─────────┤
   │         │         │
   │         ▼         │
   │    needs_input ───┤ (reply)
   │         │         │
   │         ▼         │
   │  needs_confirmation ◄─┘ (reply)
   │         │
   ├──► waiting ───────────────────────► expired
   │         │
   │         ▼
   │      held ────────────────────────► expired
   │
   ▼
completed ◄──── partial
   │
   ▼
(response delivered)

Other terminals: failed, cancelled, superseded, delegated
```

---

## 10. Quick Reference

### Message Structure
```yaml
MESS:
  - v: 1.0.0              # Optional
  - <type>:
      <payload>
```

### Minimal Request
```yaml
MESS:
  - request:
      intent: <what you need>
```

### With Context
```yaml
MESS:
  - request:
      intent: <what you need>
      context:
        - some text context
        - image: https://example.com/ref.jpg
        - file: file://local/doc.pdf
```

### Check Status
```yaml
MESS:
  - query:
      type: status
```

### Answer Questions
```yaml
MESS:
  - reply:
      re: <request>
      answers:
        <field>: <value>
```

### Confirm Action
```yaml
MESS:
  - reply:
      re: <request>
      confirm: true
```

### Cancel
```yaml
MESS:
  - cancel:
      re: <request>
```

---

## Appendix: Example Conversation

```yaml
# Agent requests ingredient check
MESS:
  - v: 1.0.0
  - request:
      id: dinner-check
      intent: check what ingredients we have
      context:
        - Planning dinner for 4
        - Kids prefer pasta or rice dishes
      response_hint:
        - text
        - image
---
# Exchange acknowledges (version implied from here on)
MESS:
  - ack:
      re: dinner-check
      received_at: 2026-01-31T17:00:00-08:00
---
# Executor claims
MESS:
  - status:
      re: dinner-check
      code: claimed
      executor: household:teague-phone
---
# Executor delivers
MESS:
  - response:
      re: dinner-check
      content:
        - image: data:image/jpeg;base64,...
        - |
          Fridge: chicken thighs (1lb, exp tomorrow), broccoli, carrots
          Pantry: rice, pasta, soy sauce, honey
      notes: chicken should be used tonight
---
# Agent requests action based on previous response
MESS:
  - request:
      id: start-rice
      intent: start rice cooker with 2 cups rice
      precision: exact
      context:
        - ref: dinner-check
        - Making stir fry with the chicken
      requires:
        - operate-appliance
        - home-kitchen-access
---
# Executor needs confirmation
MESS:
  - status:
      re: start-rice
      code: needs_confirmation
      executor: household:kitchen-helper
      action: start rice cooker (2 cups white rice, 2.5 cups water)
      consequences: rice will be ready in ~25 minutes
---
# Agent confirms
MESS:
  - reply:
      re: start-rice
      confirm: true
---
# Executor completes
MESS:
  - response:
      re: start-rice
      content:
        - confirmation: true
        - Rice cooker started, will be ready at 5:30pm
```

---

*MESS Protocol v1.0 — Ready for implementation*

---

## v2 Planned (Not in v1)

The following are documented for future implementation:

**Agent Review/Feedback:**
- `review` message type for rating responses (accept/reject, 1-5 scale)
- Enables quality feedback, reputation, training signals

**Payment Methods:**
- Extended `compensation` schema supporting: shells, bitcoin/sats, venmo, tokens, escrow
- Payment flow delegated entirely to exchanges

**Other:**
- Delegation chains with compensation splits
- Capability verification
- SLAs with penalties

See implementation plan for details.
