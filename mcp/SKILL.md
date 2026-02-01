---
name: mess-mcp
description: MCP server tools for creating and managing MESS physical-world task requests. Provides 'mess' and 'mess_status' tools for Claude Desktop integration.
---

# MESS MCP Server

## Overview

The MESS MCP Server provides Claude Desktop with tools to create and manage physical-world task requests. It syncs with GitHub (or local files) to store request threads.

## Tools

### `mess` - Send MESS Protocol Messages

Create new requests or update existing ones.

**Input:** YAML-formatted MESS message

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

**Response:**
```yaml
ref: "2026-02-01-001"
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
          intent: Check if the garage door is closed

  - from: teague-phone
    received: "2026-02-01T22:05:00Z"
    MESS:
      - status:
          re: "2026-02-01-001"
          code: completed
      - response:
          re: "2026-02-01-001"
          content:
            - image: "data:image/jpeg;base64,/9j/4AAQ..."
            - "All clear - garage door is closed and locked"
```

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

## Request Fields

| Field | Required | Description |
|-------|----------|-------------|
| `intent` | Yes | What you need done (be specific) |
| `context` | No | List of relevant context strings |
| `priority` | No | `background`, `normal`, `elevated`, `urgent` |
| `response_hint` | No | Expected response types: `text`, `image`, `video`, `audio` |

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

# Send clarification
- status:
    re: "2026-02-01-001"
    code: claimed
- response:
    re: "2026-02-01-001"
    content:
      - "The living room ceiling light, not the lamp"
```

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
