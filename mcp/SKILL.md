---
name: mess-mcp
description: MCP server tools for creating and managing MESS physical-world task requests. Provides 'mess', 'mess_status', and 'mess_capabilities' tools for Claude Desktop integration.
---

# MESS MCP Server

## Overview

The MESS MCP Server provides Claude Desktop with tools to create and manage physical-world task requests. It syncs with GitHub (or local files) to store request threads.

## Tools

### `mess` - Send MESS Protocol Messages

Create new requests or update existing ones using free-form YAML.

**Input:** YAML-formatted MESS message

**Why YAML?** The `mess` tool accepts raw MESS protocol messages, allowing you to:
- Include any valid MESS protocol fields, not just common ones
- Add custom context, metadata, or instructions
- Construct complex multi-part messages
- Use the full expressiveness of the MESS protocol

The examples below show common patterns, but you can include any fields defined in the MESS protocol specification.

#### Creating a Request

```yaml
- v: 1.0.0
- request:
    intent: Check if the garage door is closed
    context:
      - Getting ready for bed
      - Want to make sure house is secure
    priority: normal
    response_hint:
      - image
      - text
```

**Response:**
```yaml
ref: "2026-02-01-001"
status: pending
message: "Request created: 2026-02-01-001"
```

#### Updating a Request

Send a status update:
```yaml
- status:
    re: "2026-02-01-001"
    code: claimed
```

Cancel a request:
```yaml
- cancel:
    re: "2026-02-01-001"
    reason: "No longer needed"
```

### `mess_status` - Check Request Status

Query pending requests or get details on a specific thread.

#### List All Active Requests

```yaml
ref: null
```

**Response:**
```yaml
- ref: "2026-02-01-001"
  status: pending
  intent: Check if the garage door is closed
  requestor: claude-desktop
  executor: null
  priority: normal
  created: "2026-02-01T22:00:00Z"

- ref: "2026-02-01-002"
  status: claimed
  intent: What's in the fridge?
  requestor: claude-desktop
  executor: teague-phone
  priority: normal
```

#### Get Specific Thread

```yaml
ref: "2026-02-01-001"
```

**Response (v2.1.0 format):**
```yaml
ref: "2026-02-01-001-garage-check"
status: completed
intent: Check if the garage door is closed
requestor: claude-desktop
executor: teague-phone
messages:
  - from: claude-desktop
    received: "2026-02-01T22:00:00Z"
    MESS:
      - v: "1.0.0"
      - request:
          id: garage-check
          intent: Check if the garage door is closed

  - from: teague-phone
    received: "2026-02-01T22:05:00Z"
    re: "2026-02-01-001-garage-check"      # message-level reference
    MESS:
      - status:
          code: completed
      - response:
          content:
            - image:
                resource: "content://2026-02-01-001-garage-check/att-002-image-door.jpg"
                mime: "image/jpeg"
                size: 245891
            - "All clear - garage door is closed and locked"

attachments:
  - name: att-002-image-door.jpg
    resource: "content://2026-02-01-001-garage-check/att-002-image-door.jpg"
```

**Note:** Images are returned as `content://` resource URIs instead of inline base64 to keep responses lightweight. Use the MCP resource protocol to fetch attachment content when needed.

## Configuration

### GitHub Mode (Recommended)

```json
{
  "mcpServers": {
    "mess": {
      "command": "node",
      "args": ["/path/to/mcp/index.js"],
      "env": {
        "MESS_GITHUB_REPO": "username/mess-exchange",
        "MESS_GITHUB_TOKEN": "github_pat_xxxxx",
        "MESS_GITHUB_ONLY": "true",
        "MESS_AGENT_ID": "claude-desktop"
      }
    }
  }
}
```

### Local Mode

```json
{
  "mcpServers": {
    "mess": {
      "command": "node",
      "args": ["/path/to/mcp/index.js"],
      "env": {
        "MESS_DIR": "~/.mess",
        "MESS_AGENT_ID": "claude-desktop"
      }
    }
  }
}
```

### Hybrid Mode (Local + GitHub Sync)

```json
{
  "mcpServers": {
    "mess": {
      "command": "node",
      "args": ["/path/to/mcp/index.js"],
      "env": {
        "MESS_DIR": "~/.mess",
        "MESS_GITHUB_REPO": "username/mess-exchange",
        "MESS_GITHUB_TOKEN": "github_pat_xxxxx",
        "MESS_AGENT_ID": "claude-desktop"
      }
    }
  }
}
```

### `mess_capabilities` - Discover Available Capabilities

List physical-world capabilities that executors in this exchange can perform.

**Input:** Optional `tag` filter

#### List All Capabilities

```yaml
# No input needed
```

**Response:**
```yaml
- id: camera
  description: Take and attach photos
  tags: [attachments]
- id: check-door
  description: Check if doors are locked or closed
  tags: [security, physical-access]
- id: hands
  description: Has human hands for physical manipulation
  tags: [physical-access]
```

#### Filter by Tag

```yaml
tag: security
```

**Response:**
```yaml
- id: check-door
  description: Check if doors are locked or closed
  tags: [security, physical-access]
- id: check-stove
  description: Verify stove/oven is turned off
  tags: [security, safety]
```

Use this to understand what kinds of tasks you can request. Capabilities are defined in `capabilities/*.yaml` in the exchange.

## Request Fields

| Field | Required | Description |
|-------|----------|-------------|
| `intent` | Yes | What you need done (be specific) |
| `id` | No | Your local identifier for tracking (exchange assigns canonical `ref`) |
| `context` | No | List of relevant context strings |
| `priority` | No | `background`, `normal`, `elevated`, `urgent` |
| `response_hint` | No | Expected response types: `text`, `image`, `video`, `audio` |

### Free-Form Extensions

The MESS protocol is extensible. Beyond the standard fields above, you can include:

```yaml
- v: 1.0.0
- request:
    intent: Check the garden irrigation system
    context:
      - Haven't watered in 3 days
    priority: normal
    # Standard fields above, custom fields below:
    location: backyard
    equipment_needed:
      - hose access
      - manual valve knowledge
    safety_notes:
      - Watch for wasps near the shed
    deadline: before 6pm today
```

Custom fields are preserved in the thread and visible to executors. Use them for domain-specific context that doesn't fit the standard fields.

## Status Codes

| Status | Meaning |
|--------|---------|
| `pending` | Waiting for executor to claim |
| `claimed` | Executor is working on it |
| `in_progress` | Executor actively working |
| `needs_input` | Executor needs clarification |
| `completed` | Task finished successfully |
| `failed` | Could not complete |
| `declined` | Executor declined the request |
| `cancelled` | Request was cancelled |

## Common Patterns

### Create and Wait

```python
# 1. Create request
mess:
  - v: 1.0.0
  - request:
      intent: Is anyone home?

# 2. Periodically check status
mess_status:
  ref: "2026-02-01-001"

# 3. When completed, read the response
```

### Urgent Request

```yaml
- v: 1.0.0
- request:
    intent: Did I leave the stove on?
    context:
      - Just left the house
      - Can't remember if I turned it off
    priority: urgent
    response_hint:
      - image
      - text
```

### Follow-up After needs_input

```yaml
# Original request got needs_input status
# Executor asked: "Which light?"

# Send clarification (v2.1.0: answer block, message-level re: handled automatically)
- answer:
    id: light-clarification
    value: "The living room ceiling light, not the lamp"
```

## Resources

The MCP server provides `content://` resources for accessing thread attachments.

### Fetching Attachments

When `mess_status` returns a thread, images and files are referenced as resource URIs:

```yaml
image:
  resource: "content://2026-02-01-001/att-002-image-door.jpg"
  mime: "image/jpeg"
  size: 245891
```

Use the MCP resource protocol to fetch the actual content when needed. This keeps status responses lightweight and avoids blowing up context with large base64 payloads.

### Resource URI Format

```
content://{thread-ref}/{attachment-filename}
```

Examples:
- `content://2026-02-01-001-garage-check/att-002-image-door.jpg`
- `content://2026-02-01-003-fridge/att-005-image-contents.jpg`

## Error Handling

**Thread not found:**
```yaml
error: "Thread 2026-02-01-999 not found"
```

**Missing required field:**
```yaml
error: "Missing re: field"
```

**GitHub API error:**
```yaml
error: "GitHub API error: 401"
```

## File Locations

### macOS
- Config: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Local MESS dir: `~/.mess/`

### Linux
- Config: `~/.config/claude/claude_desktop_config.json`
- Local MESS dir: `~/.mess/`

### Windows
- Config: `%APPDATA%\Claude\claude_desktop_config.json`
- Local MESS dir: `%USERPROFILE%\.mess\`
