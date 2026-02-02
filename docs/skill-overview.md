# MESS - Meatspace Execution and Submission System

## Overview

MESS enables AI agents to request physical-world tasks from human executors. Use MESS when you need something done in the real world that you cannot do yourself.

## When to Use MESS

**Use MESS for:**
- Observations: "Is the garage door closed?", "What's the temperature outside?"
- Physical checks: "Is there milk in the fridge?", "Did the package arrive?"
- Actions: "Turn off the living room light", "Start the dishwasher"
- Photos: "Take a picture of the backyard", "Show me what's in the pantry"
- Purchases: "Order more coffee pods", "Buy tickets for Saturday"

**Don't use MESS for:**
- Information you can look up online
- Tasks that don't require physical presence
- Emergencies (call 911 instead)

## Components

| Component | Purpose | Documentation |
|-----------|---------|---------------|
| MCP Server | Claude Desktop integration | [mcp/SKILL.md](../mcp/SKILL.md) |
| Exchange Server | Self-hosted REST API | [server/SKILL.md](../server/SKILL.md) |
| Web Client | Human executor interface | [client/SKILL.md](../client/SKILL.md) |

## Quick Start (MCP Server)

If you have the MESS MCP server configured, you have these tools:

### Core Tools

| Tool | Purpose |
|------|---------|
| `mess` | Send raw MESS protocol messages |
| `mess_status` | Check request status |
| `mess_capabilities` | Discover available capabilities |

### Helper Tools (Simpler)

| Tool | Purpose |
|------|---------|
| `mess_request` | Create a request with structured params |
| `mess_answer` | Answer executor's question |
| `mess_cancel` | Cancel a request |

### Creating a Request

**Using `mess_request` (recommended):**
```yaml
intent: "Check if the garage door is closed"
context:
  - "Getting ready for bed"
priority: elevated
response_hints:
  - image
```

**Using raw `mess`:**
```yaml
- v: 1.0.0
- request:
    intent: Check if the garage door is closed
    context:
      - Getting ready for bed
    response_hint:
      - image
```

### Checking Status

```yaml
# Check all pending requests
ref: null

# Check specific request
ref: "2026-02-01-001"
```

### Answering Questions

When an executor asks for clarification (status: `needs_input`):

```yaml
ref: "2026-02-01-001"
answer: "The front garage door (main one)"
```

## Request Lifecycle

```
pending → claimed → completed
                 → failed
                 → needs_input → claimed → ...
```

1. **pending**: Request created, waiting for executor
2. **claimed**: Executor accepted, working on it
3. **completed**: Task done, response available
4. **failed**: Could not complete
5. **needs_input**: Executor needs clarification

## Best Practices

### Writing Good Requests

**Good:**
```yaml
intent: Check if the front door is locked
context:
  - About to go to sleep
  - Heard a noise earlier
response_hints:
  - text
```

**Bad:**
```yaml
intent: door
```

### Priority Levels

| Priority | Use When |
|----------|----------|
| `background` | Not time-sensitive, can wait hours |
| `normal` | Regular requests, respond when convenient |
| `elevated` | Somewhat urgent, within the hour |
| `urgent` | Time-critical, needs immediate attention |

### Response Hints

- `text` - Written response sufficient
- `image` - Photo would be helpful
- `video` - Video needed (rare)
- `audio` - Voice/sound recording

## Example Workflows

### Morning Check
```yaml
intent: "What's the weather like outside?"
context:
  - "Deciding what to wear"
response_hints:
  - text
  - image
```

### Home Security
```yaml
intent: "Check all doors and windows are locked"
context:
  - "Leaving for vacation tomorrow"
priority: elevated
response_hints:
  - text
```

### Shopping Request
```yaml
intent: "Pick up milk and eggs from the store"
context:
  - "Running low on breakfast supplies"
  - "Any brand is fine"
priority: normal
```

## Checking Results

After creating a request, use `mess_status` to check on it:

```yaml
# Response when completed
ref: "2026-02-01-001"
status: completed
intent: Check if the garage door is closed
executor: teague-phone
messages:
  - from: teague-phone
    MESS:
      - response:
          content:
            - image:
                resource: "content://2026-02-01-001/att-001-door.jpg"
            - "Garage door is closed and locked"
```

**Note:** Images are returned as `content://` resource URIs. Use the MCP resource protocol to fetch attachment content when needed.

## Resources

The MCP server provides resources for accessing thread data:

| URI | Returns |
|-----|---------|
| `thread://{ref}` | Full thread (envelope + messages) |
| `thread://{ref}/envelope` | Just metadata |
| `thread://{ref}/latest` | Most recent message |
| `content://{ref}/{file}` | Attachment content |

## Error Handling

If a request needs clarification:

```yaml
# mess_status response
ref: "2026-02-01-001"
status: needs_input
messages:
  - from: executor
    MESS:
      - status:
          code: needs_input
          message: "Which garage door - front or back?"
```

Use `mess_answer` to respond:
```yaml
ref: "2026-02-01-001"
answer: "The front garage door (main one)"
```
