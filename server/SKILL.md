---
name: mess-server
description: REST API for MESS Exchange Server. Self-hosted deployment with Docker, Kubernetes, or Cloudflare Workers. Event-sourced storage queryable with DuckDB.
---

# MESS Exchange Server API

## Overview

The Exchange Server provides a REST API for MESS operations. Use this instead of GitHub when you need:
- Multi-user support with separate API keys
- Self-hosted deployment (Docker, Kubernetes, Cloudflare Workers)
- Event-sourced storage queryable with DuckDB
- Custom notification integrations

## Base URL

```
/api/v1/exchanges/{exchange_id}
```

Replace `{exchange_id}` with your exchange name (e.g., `home`, `office`).

## Authentication

All endpoints except `/register` require a Bearer token:

```
Authorization: Bearer mess_{exchange}_{token}
```

## Endpoints

### Register Executor

**POST** `/api/v1/exchanges/{exchange_id}/register`

No authentication required. Returns an API key (save it - cannot be retrieved again).

```bash
curl -X POST http://localhost:3000/api/v1/exchanges/home/register \
  -H "Content-Type: application/json" \
  -d '{
    "executor_id": "my-phone",
    "display_name": "My Phone",
    "capabilities": ["photo:capture", "location:indoor"],
    "notifications": [
      {"type": "ntfy", "topic": "mess-home"}
    ]
  }'
```

**Response:**
```json
{
  "executor_id": "my-phone",
  "api_key": "mess_home_abc123def456...",
  "message": "Save this API key - it cannot be retrieved again."
}
```

### List Requests

**GET** `/api/v1/exchanges/{exchange_id}/requests`

Query parameters:
- `status` - Filter by status (optional)

```bash
curl http://localhost:3000/api/v1/exchanges/home/requests \
  -H "Authorization: Bearer mess_home_abc123..."
```

**Response:**
```json
{
  "threads": [
    {
      "ref": "2026-02-01-XY1Z",
      "status": "pending",
      "intent": "Check the front door",
      "requestor_id": "claude-agent",
      "executor_id": null,
      "priority": "normal",
      "created_at": "2026-02-01T22:00:00Z",
      "updated_at": "2026-02-01T22:00:00Z"
    }
  ]
}
```

### Create Request

**POST** `/api/v1/exchanges/{exchange_id}/requests`

```bash
curl -X POST http://localhost:3000/api/v1/exchanges/home/requests \
  -H "Authorization: Bearer mess_home_abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "intent": "Check if the garage door is closed",
    "context": ["Getting ready for bed"],
    "priority": "normal",
    "response_hint": ["image"]
  }'
```

**Response:**
```json
{
  "ref": "2026-02-01-XY1Z",
  "status": "pending"
}
```

### Get Request Details

**GET** `/api/v1/exchanges/{exchange_id}/requests/{ref}`

```bash
curl http://localhost:3000/api/v1/exchanges/home/requests/2026-02-01-XY1Z \
  -H "Authorization: Bearer mess_home_abc123..."
```

**Response:**
```json
{
  "thread": {
    "ref": "2026-02-01-XY1Z",
    "status": "completed",
    "intent": "Check if the garage door is closed",
    "requestor_id": "claude-agent",
    "executor_id": "my-phone",
    "priority": "normal",
    "created_at": "2026-02-01T22:00:00Z",
    "updated_at": "2026-02-01T22:05:00Z",
    "messages": [
      {
        "from": "claude-agent",
        "ts": "2026-02-01T22:00:00Z",
        "mess": [{"request": {"intent": "Check if the garage door is closed"}}]
      },
      {
        "from": "my-phone",
        "ts": "2026-02-01T22:05:00Z",
        "mess": [
          {"status": {"re": "2026-02-01-XY1Z", "code": "completed"}},
          {"response": {"content": ["Garage is closed"]}}
        ]
      }
    ]
  }
}
```

### Update Request

**PATCH** `/api/v1/exchanges/{exchange_id}/requests/{ref}`

Claim a request:
```bash
curl -X PATCH http://localhost:3000/api/v1/exchanges/home/requests/2026-02-01-XY1Z \
  -H "Authorization: Bearer mess_home_abc123..." \
  -H "Content-Type: application/json" \
  -d '{"status": "claimed"}'
```

Complete with response:
```bash
curl -X PATCH http://localhost:3000/api/v1/exchanges/home/requests/2026-02-01-XY1Z \
  -H "Authorization: Bearer mess_home_abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed",
    "mess": [{"response": {"content": ["Door is locked", {"image": "data:image/..."}]}}]
  }'
```

### List Executors

**GET** `/api/v1/exchanges/{exchange_id}/executors`

```bash
curl http://localhost:3000/api/v1/exchanges/home/executors \
  -H "Authorization: Bearer mess_home_abc123..."
```

**Response:**
```json
{
  "executors": [
    {
      "id": "my-phone",
      "display_name": "My Phone",
      "capabilities": ["photo:capture", "location:indoor"],
      "last_seen": "2026-02-01T22:00:00Z",
      "created_at": "2026-02-01T20:00:00Z"
    }
  ]
}
```

### Update Executor Profile

**PATCH** `/api/v1/exchanges/{exchange_id}/executors/{executor_id}`

Can only update your own profile.

```bash
curl -X PATCH http://localhost:3000/api/v1/exchanges/home/executors/my-phone \
  -H "Authorization: Bearer mess_home_abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "Teague Phone",
    "capabilities": ["photo:capture", "location:indoor", "location:outdoor"],
    "notifications": [
      {"type": "ntfy", "topic": "mess-alerts"},
      {"type": "slack", "webhook_url": "https://hooks.slack.com/..."}
    ],
    "preferences": {
      "min_priority": "normal",
      "quiet_hours": {"enabled": true, "start": "22:00", "end": "07:00"}
    }
  }'
```

## Notification Types

| Type | Configuration |
|------|---------------|
| `ntfy` | `{"type": "ntfy", "topic": "your-topic", "server": "https://ntfy.sh"}` |
| `slack` | `{"type": "slack", "webhook_url": "https://hooks.slack.com/..."}` |
| `google_chat` | `{"type": "google_chat", "webhook_url": "https://chat.googleapis.com/..."}` |
| `webhook` | `{"type": "webhook", "url": "https://your-server.com/notify"}` |

## Deployment

### Docker

```bash
cd server
docker compose -f deploy/docker/docker-compose.yml up -d
```

### Kubernetes

```bash
helm install mess-exchange deploy/helm \
  --set image.repository=your-registry/mess-exchange \
  --set ingress.enabled=true
```

### Cloudflare Workers

```bash
wrangler r2 bucket create mess-exchange
npm run worker:deploy
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `STORAGE_TYPE` | `filesystem` or `s3` | `filesystem` |
| `STORAGE_PATH` | Path for filesystem storage | `./data` |
| `S3_ENDPOINT` | S3/MinIO endpoint | - |
| `S3_BUCKET` | S3 bucket name | - |
| `S3_ACCESS_KEY` | S3 access key | - |
| `S3_SECRET_KEY` | S3 secret key | - |

## Event Storage

All events are stored as JSON lines, partitioned by date:

```
data/
├── events/exchange=home/2026/02/01/{uuid}.jsonl
└── executors/exchange=home/{executor}.json
```

Query with DuckDB:
```sql
SELECT * FROM read_json_auto('data/events/**/*.jsonl', hive_partitioning=true)
WHERE exchange_id = 'home' AND thread_ref IS NOT NULL;
```

## Error Responses

| Status | Meaning |
|--------|---------|
| `400` | Bad request (missing required field) |
| `401` | Unauthorized (invalid or missing API key) |
| `403` | Forbidden (wrong exchange or executor) |
| `404` | Not found (thread or executor doesn't exist) |
| `409` | Conflict (executor already registered) |
| `500` | Internal server error |

Example error response:
```json
{
  "error": "Thread not found"
}
```
