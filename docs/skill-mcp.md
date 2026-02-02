# MESS MCP Server

## Overview

The MESS MCP Server provides Claude Desktop with tools to create and manage physical-world task requests. It syncs with GitHub (or local files) to store request threads.

## Tools

### `mess` - Send MESS Protocol Messages

Create new requests or update existing ones using raw YAML. For simpler operations, prefer the helper tools below.

**Input:** YAML-formatted MESS message

#### Creating a Request

```yaml
- v: 1.0.0
- request:
    intent: Check if the garage door is closed
    context:
      - Getting ready for bed
    priority: normal
    response_hint:
      - image
```

**Response:**
```yaml
ref: "2026-02-01-001"
status: pending
message: "Request created"
```

#### Updating a Request

```yaml
- status:
    re: "2026-02-01-001"
    code: claimed
```

### `mess_status` - Check Request Status

Query pending requests or get details on a specific thread.

**Without ref:** Lists all pending/in-progress requests
**With ref:** Returns full thread with messages

```yaml
ref: "2026-02-01-001"
```

**Response:**
```yaml
ref: "2026-02-01-001"
status: completed
intent: Check if the garage door is closed
messages:
  - from: claude-desktop
    MESS:
      - request:
          intent: Check if the garage door is closed
  - from: teague-phone
    MESS:
      - response:
          content:
            - image:
                resource: "content://2026-02-01-001/att-001-door.jpg"
            - "Door is closed and locked"
```

**Note:** Images are returned as `content://` resource URIs instead of inline base64.

### `mess_capabilities` - Discover Capabilities

List physical-world capabilities available in this exchange.

**Input:** Optional `tag` filter

**Response:**
```yaml
- id: camera
  description: Take and attach photos
  tags: [attachments]
- id: check-door
  description: Check if doors are locked
  tags: [security, physical-access]
```

### `mess_request` - Create Request (Simple)

Simpler alternative to raw `mess` for creating requests.

**Input:**
```yaml
intent: "Check if the garage door is closed"
context:
  - "Getting ready for bed"
priority: elevated
response_hints:
  - image
```

### `mess_answer` - Answer Question

Respond to executor's question when status is `needs_input`.

**Input:**
```yaml
ref: "2026-02-01-001"
answer: "The living room ceiling light"
```

### `mess_cancel` - Cancel Request

Cancel a pending or in-progress request.

**Input:**
```yaml
ref: "2026-02-01-001"
reason: "No longer needed"
```

## Resources

### `content://` - Attachments

Fetch attachment content from threads:
```
content://{thread-ref}/{filename}
```

### `thread://` - Thread Data

Read thread data with attachments as `content://` URIs:
```
thread://{ref}          # Full thread
thread://{ref}/envelope # Just metadata
thread://{ref}/latest   # Most recent message
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
