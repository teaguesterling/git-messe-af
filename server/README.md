# MESS Exchange Server

API server for the MESS (Meatspace Exchange for Synchronous Services) protocol.

## Architecture

```
server/
├── src/
│   ├── core.js              # Shared business logic (runtime-agnostic)
│   ├── storage/
│   │   ├── index.js         # Storage factory
│   │   ├── filesystem.js    # Local filesystem backend
│   │   ├── s3.js            # S3/MinIO backend
│   │   └── r2.js            # Cloudflare R2 backend
│   └── adapters/
│       ├── express.js       # Self-hosted (Docker/K8s/bare metal)
│       └── worker.js        # Cloudflare Workers
└── deploy/
    ├── cloudflare/          # Wrangler config
    ├── docker/              # Dockerfile + docker-compose
    └── helm/                # Kubernetes Helm chart
```

## Deployment Options

### 1. Docker (Simplest Self-Hosted)

```bash
# Filesystem storage
cd server
docker compose -f deploy/docker/docker-compose.yml up -d mess-exchange

# With MinIO (S3-compatible)
docker compose -f deploy/docker/docker-compose.yml --profile minio up -d
```

### 2. Kubernetes (Helm)

```bash
# Build and push image
docker build -t your-registry/mess-exchange:latest -f deploy/docker/Dockerfile .
docker push your-registry/mess-exchange:latest

# Install chart
helm install mess-exchange deploy/helm \
  --set image.repository=your-registry/mess-exchange \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=mess.yourdomain.com
```

### 3. Cloudflare Workers + R2

```bash
# Create R2 bucket
wrangler r2 bucket create mess-exchange

# Deploy
npm run worker:deploy
```

### 4. Bare Metal / Node.js

```bash
npm install
npm start

# Or with S3
STORAGE_TYPE=s3 S3_ENDPOINT=... S3_BUCKET=... npm start
```

## API Reference

Base: `/api/v1/exchanges/{exchange_id}`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/register` | No | Register executor, get API key |
| GET | `/requests` | Yes | List threads (`?status=pending`) |
| POST | `/requests` | Yes | Create request |
| GET | `/requests/:ref` | Yes | Get thread details |
| PATCH | `/requests/:ref` | Yes | Update status / add message |
| GET | `/executors` | Yes | List executors |
| PATCH | `/executors/:id` | Yes | Update your profile |

### Authentication

```
Authorization: Bearer mess_{exchange}_{token}
```

### Example: Full Workflow

```bash
# 1. Register
curl -X POST http://localhost:3000/api/v1/exchanges/home/register \
  -H "Content-Type: application/json" \
  -d '{"executor_id": "phone", "display_name": "My Phone"}'
# Response: {"api_key": "mess_home_abc123..."}

# 2. Create request
curl -X POST http://localhost:3000/api/v1/exchanges/home/requests \
  -H "Authorization: Bearer mess_home_abc123..." \
  -H "Content-Type: application/json" \
  -d '{"intent": "Check front door", "priority": "normal"}'
# Response: {"ref": "2025-02-01-XY1Z", "status": "pending"}

# 3. Claim
curl -X PATCH http://localhost:3000/api/v1/exchanges/home/requests/2025-02-01-XY1Z \
  -H "Authorization: Bearer mess_home_abc123..." \
  -H "Content-Type: application/json" \
  -d '{"status": "claimed"}'

# 4. Complete with response
curl -X PATCH http://localhost:3000/api/v1/exchanges/home/requests/2025-02-01-XY1Z \
  -H "Authorization: Bearer mess_home_abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed",
    "mess": [{"response": {"content": ["Door is locked ✓"]}}]
  }'
```

## Storage Backends

### Filesystem (Default)

```bash
STORAGE_TYPE=filesystem
STORAGE_PATH=./data
```

Data layout:
```
data/
├── events/exchange={id}/{YYYY}/{MM}/{DD}/{uuid}.jsonl
└── executors/exchange={id}/{executor}.json
```

### S3/MinIO

```bash
STORAGE_TYPE=s3
S3_ENDPOINT=http://minio:9000   # Optional for AWS
S3_BUCKET=mess-exchange
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_REGION=auto                  # Optional
```

### Cloudflare R2

Uses R2 binding directly in Workers (not S3 API). Configure in `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "MESS_BUCKET"
bucket_name = "mess-exchange"
```

## Event Schema

All storage backends use the same event-sourced format (JSON lines):

```json
{
  "event_id": "uuid",
  "ts": "2025-02-01T12:00:00Z",
  "exchange_id": "home",
  "thread_ref": "2025-02-01-ABC1",
  "event_type": "thread_created|status_changed|message_added|executor_registered",
  "actor_id": "executor-id",
  "payload": { ... }
}
```

This format is queryable with DuckDB/MotherDuck:

```sql
SELECT * FROM read_json_auto('s3://mess-exchange/events/**/*.jsonl', hive_partitioning=true);
```

## Notifications

Configure on executor registration:

```json
{
  "executor_id": "my-phone",
  "notifications": [
    {"type": "ntfy", "topic": "mess-alerts"},
    {"type": "slack", "webhook_url": "https://hooks.slack.com/..."},
    {"type": "google_chat", "webhook_url": "https://chat.googleapis.com/..."},
    {"type": "webhook", "url": "https://my-server.com/notify"}
  ],
  "preferences": {
    "min_priority": "normal",
    "quiet_hours": {"enabled": true, "start": "22:00", "end": "07:00"}
  }
}
```
