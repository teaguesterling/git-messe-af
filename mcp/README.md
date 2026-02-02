# MESS MCP Server

An MCP (Model Context Protocol) server that enables AI agents like Claude to dispatch physical-world tasks to human executors.

## Features

- **GitHub sync**: Tasks sync to/from your GitHub repository
- **Local mode**: Store tasks locally without GitHub
- **Hybrid mode**: Local storage with GitHub backup
- Seven tools: `mess`, `mess_status`, `mess_capabilities`, `mess_request`, `mess_answer`, `mess_cancel`, `mess_get_resource`
- Resources: `content://` for attachments, `thread://` for thread data

## Installation

```bash
cd mcp
npm install
```

## Configuration

The server supports three modes via environment variables:

### Mode 1: GitHub Only (Recommended for sharing)

All tasks stored in GitHub. Best when multiple executors/agents share the same exchange.

```bash
MESS_GITHUB_REPO=your-username/mess-exchange
MESS_GITHUB_TOKEN=github_pat_xxxxx
MESS_GITHUB_ONLY=true
MESS_AGENT_ID=claude-desktop
```

### Mode 2: GitHub Sync (Hybrid)

Tasks stored locally AND synced to GitHub. Good for offline capability with cloud backup.

```bash
MESS_GITHUB_REPO=your-username/mess-exchange
MESS_GITHUB_TOKEN=github_pat_xxxxx
MESS_DIR=~/.mess
MESS_AGENT_ID=claude-desktop
```

### Mode 3: Local Only

Tasks stored only on local filesystem. Good for single-machine use or testing.

```bash
MESS_DIR=~/.mess
MESS_AGENT_ID=claude-desktop
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MESS_GITHUB_REPO` | No | - | GitHub repo in `owner/name` format |
| `MESS_GITHUB_TOKEN` | If using GitHub | - | GitHub Personal Access Token |
| `MESS_GITHUB_ONLY` | No | `false` | Set `true` to disable local storage |
| `MESS_DIR` | No | `~/.mess` | Local directory for task files |
| `MESS_AGENT_ID` | No | `claude-agent` | Identifier for this agent |
| `MESS_CAPABILITIES_DIR` | No | `../capabilities` | Directory containing capability definitions |
| `MESS_SYNC_ENABLED` | No | `true` | Enable background sync for change notifications |
| `MESS_SYNC_INTERVAL` | No | `30000` | Sync interval in milliseconds |

## Setting up with Claude Desktop

### macOS

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mess": {
      "command": "node",
      "args": ["/absolute/path/to/mcp/index.js"],
      "env": {
        "MESS_GITHUB_REPO": "your-username/mess-exchange",
        "MESS_GITHUB_TOKEN": "github_pat_xxxxx",
        "MESS_GITHUB_ONLY": "true",
        "MESS_AGENT_ID": "claude-desktop"
      }
    }
  }
}
```

### Linux

Edit `~/.config/claude/claude_desktop_config.json` with the same structure.

### Windows

Edit `%APPDATA%\Claude\claude_desktop_config.json` with the same structure.

After editing, restart Claude Desktop.

## Setting up with Claude Code

Add to your Claude Code MCP settings or use the command line:

```bash
export MESS_GITHUB_REPO=your-username/mess-exchange
export MESS_GITHUB_TOKEN=github_pat_xxxxx
export MESS_GITHUB_ONLY=true
export MESS_AGENT_ID=claude-code

node /path/to/mcp/index.js
```

## Self-Hosting Locally (No Cloud)

For a completely local setup without GitHub:

### 1. Create the local exchange directory

```bash
mkdir -p ~/.mess/{received,executing,finished,canceled}
```

### 2. Configure Claude Desktop for local mode

```json
{
  "mcpServers": {
    "mess": {
      "command": "node",
      "args": ["/absolute/path/to/mcp/index.js"],
      "env": {
        "MESS_DIR": "~/.mess",
        "MESS_AGENT_ID": "claude-desktop"
      }
    }
  }
}
```

### 3. Run the client locally

Open `client/index.html` directly in your browser. When configuring:

1. Skip the GitHub token step (click "I have my token")
2. For repository, you'll need to set up a local adapter (see below)

**Note:** The web client currently requires GitHub. For fully local operation, you can:

- View task files directly in `~/.mess/received/`
- Use any text editor to respond to tasks
- Create a simple local web server (future enhancement)

### Local File Format

Tasks are stored as YAML files in `~/.mess/<status>/<ref>.messe-af.yaml`:

```yaml
ref: 2026-02-01-001
requestor: claude-desktop
executor: null
status: pending
created: 2026-02-01T10:00:00Z
updated: 2026-02-01T10:00:00Z
intent: Check if the garage door is closed
priority: normal
history:
  - action: created
    at: 2026-02-01T10:00:00Z
    by: claude-desktop
---
from: claude-desktop
received: 2026-02-01T10:00:00Z
channel: mcp
MESS:
  - v: 1.0.0
  - request:
      intent: Check if the garage door is closed
      context:
        - Getting ready for bed
      response_hint:
        - image
```

## Tools Available

### `mess`

Send a MESS protocol message to create or update requests.

**Create a request:**
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

**Cancel a request:**
```yaml
- cancel:
    re: 2026-02-01-001
    reason: No longer needed
```

### `mess_status`

Check status of requests.

- Without `ref`: Lists all pending/in-progress requests
- With `ref`: Returns full details including message history

### `mess_capabilities`

List available physical-world capabilities for this exchange.

- Without `tag`: Lists all capabilities
- With `tag`: Filters by tag (e.g., "security", "attachments")

**Response format:**
```yaml
- id: camera
  description: Take and attach photos
  tags: [attachments]
- id: check-door
  description: Check if doors are locked or closed
  tags: [security, physical-access]
```

Capabilities are defined in `capabilities/*.yaml` files. See [docs/capabilities.md](../docs/capabilities.md) for the format.

### `mess_request`

Create a new physical-world task request (simpler than raw `mess` tool).

**Parameters:**
- `intent` (required): What you need done
- `context`: Array of relevant context strings
- `priority`: `background`, `normal`, `elevated`, or `urgent`
- `response_hints`: Expected response types (`text`, `image`, `video`, `audio`)

**Example:**
```json
{
  "intent": "Check if the garage door is closed",
  "context": ["Getting ready for bed"],
  "priority": "elevated",
  "response_hints": ["image"]
}
```

### `mess_answer`

Answer an executor's question (when status is `needs_input`).

**Parameters:**
- `ref` (required): Thread ref
- `answer` (required): Your answer

### `mess_cancel`

Cancel a pending or in-progress request.

**Parameters:**
- `ref` (required): Thread ref to cancel
- `reason`: Why you're cancelling (optional)

### `mess_get_resource`

Fetch content from MESS resource URIs. Use this to retrieve images, files, or thread data referenced in responses.

**Parameters:**
- `uri` (required): Resource URI

**Supported URIs:**
- `content://{ref}/{filename}` - Attachments (images, files)
- `thread://{ref}` - Full thread data
- `thread://{ref}/envelope` - Thread metadata only
- `thread://{ref}/latest` - Most recent message
- `mess://help` - Protocol documentation

**Example:**
```json
{ "uri": "content://2026-02-01-001/photo.jpg" }
```

For images, returns base64-encoded data with mime type.

## Resources

### `content://` - Attachments

Fetch attachment content from threads:
```
content://{thread-ref}/{filename}
```

### `thread://` - Thread Data

Read thread data with attachments rewritten to `content://` URIs:
```
thread://{ref}          # Full thread (envelope + messages)
thread://{ref}/envelope # Just metadata (status, executor, history)
thread://{ref}/latest   # Most recent message only
```

## Troubleshooting

### "MESS MCP Server started" but no tools appear

- Restart Claude Desktop after config changes
- Check the config file path is correct for your OS
- Verify JSON syntax is valid

### GitHub API errors

- Ensure your token has `Contents: Read and write` permission
- Token must have access to the specific repository
- Check repo name format is `owner/repo` not a URL

### Permission errors on local files

```bash
# Fix permissions
chmod -R 755 ~/.mess
```

## Background Sync

The MCP server automatically polls for changes to tracked threads and sends MCP notifications when state changes (claimed, completed, needs_input, etc.).

- **Enabled by default**: Set `MESS_SYNC_ENABLED=false` to disable
- **30-second interval**: Adjust with `MESS_SYNC_INTERVAL=60000` (in ms)
- **Tracks agent-created threads**: Only threads you create are monitored
- **MCP notifications**: Sends `resources/updated` for `thread://{ref}` URIs

This allows Claude Desktop to be notified when:
- A human claims your request
- A task is completed with a response
- The executor needs clarification (needs_input)

## Development

Run the server directly for testing:

```bash
# GitHub mode
MESS_GITHUB_REPO=user/repo MESS_GITHUB_TOKEN=ghp_xxx node index.js

# Local mode
MESS_DIR=~/.mess node index.js
```

The server communicates via stdio, so you'll see startup logs on stderr.
