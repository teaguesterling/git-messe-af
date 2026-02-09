# MESS Exchange Server - PHP

A PHP 8.x implementation of the MESS Exchange Server with git-backed storage.

> **Deploying to production?** See [DEPLOYMENT.md](DEPLOYMENT.md) for Docker, VPS, Raspberry Pi, and shared hosting guides.

## Features

- Serves the MESS client as static files
- Provides the MESS REST API
- Stores data in MESSE-AF YAML format
- Uses local git repository for version control
- Simple bearer token authentication

## Requirements

- PHP 8.1 or higher
- Composer
- Git (for git-backed storage)

## Installation

```bash
cd php-server

# Install dependencies
composer install

# Copy config and customize
cp config.example.php config.php

# Initialize the data directory as a git repo (optional but recommended)
mkdir -p data
cd data
git init
cd ..
```

## Configuration

Edit `config.php`:

```php
return [
    'exchange_id' => 'home',           // Your exchange identifier
    'data_path' => __DIR__ . '/data',  // Path to git repository
    'git_enabled' => true,             // Enable git commits
    'git_push' => false,               // Auto-push after commits
];
```

## Running

### Docker (Recommended)

```bash
docker compose up -d
```

Access the client at `http://localhost:8080/client/`

### Development Server

```bash
# Using PHP's built-in server
php -S localhost:8080 -t public

# Or using composer
composer start
```

### Production

For production, use a proper web server like Apache or Nginx with PHP-FPM.

#### Apache (with mod_rewrite)

Create `.htaccess` in the `public` directory:

```apache
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.php [L]
```

#### Nginx

```nginx
server {
    listen 80;
    server_name mess.example.com;
    root /path/to/php-server/public;
    index index.php;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass unix:/var/run/php/php8.1-fpm.sock;
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    }
}
```

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/health` | GET | No | Health check |
| `/api/v1/exchanges/{id}/register` | POST | No | Register new executor |
| `/api/v1/exchanges/{id}/requests` | GET | Yes | List requests |
| `/api/v1/exchanges/{id}/requests` | POST | Yes | Create request |
| `/api/v1/exchanges/{id}/requests/{ref}` | GET | Yes | Get request |
| `/api/v1/exchanges/{id}/requests/{ref}` | PATCH | Yes | Update request |
| `/api/v1/exchanges/{id}/executors` | GET | Yes | List executors |
| `/api/v1/exchanges/{id}/executors/{eid}` | PATCH | Yes | Update executor |
| `/client/*` | GET | No | Static client files |

## Usage Examples

### Health Check

```bash
curl http://localhost:8080/health
```

### Register an Executor

```bash
curl -X POST http://localhost:8080/api/v1/exchanges/home/register \
  -H "Content-Type: application/json" \
  -d '{"executor_id": "claude", "display_name": "Claude"}'
```

Save the returned API key!

### Create a Request

```bash
curl -X POST http://localhost:8080/api/v1/exchanges/home/requests \
  -H "Authorization: Bearer mess_home_xxx" \
  -H "Content-Type: application/json" \
  -d '{"intent": "Check if the garage door is closed"}'
```

### List Requests

```bash
curl http://localhost:8080/api/v1/exchanges/home/requests \
  -H "Authorization: Bearer mess_home_xxx"
```

### Update Request Status

```bash
curl -X PATCH http://localhost:8080/api/v1/exchanges/home/requests/2024-01-15-ABCD \
  -H "Authorization: Bearer mess_home_xxx" \
  -H "Content-Type: application/json" \
  -d '{"status": "claimed"}'
```

### Access the Client

Open in browser: `http://localhost:8080/client/`

## Data Storage

Data is stored in MESSE-AF format:

```
data/
├── .git/
├── exchange/
│   ├── state=received/      # Pending requests
│   │   └── 2024-01-15-ABCD/
│   │       └── 000-2024-01-15-ABCD.messe-af.yaml
│   ├── state=executing/     # In-progress requests
│   ├── state=finished/      # Completed requests
│   └── state=canceled/      # Canceled/rejected requests
└── executors/
    └── exchange=home/
        └── claude.json
```

## Syncing with Git Remote

If you want to sync with a remote (e.g., private-messe-af-store):

```bash
cd data
git remote add origin git@github.com:user/private-messe-af-store.git
git pull origin main
```

Set `git_push` to `true` in config to auto-push after commits.

## Testing

Run the test suite inside Docker:

```bash
docker compose up -d
docker compose exec mess-php php /app/tests/api_test.php
```

Or locally with a running server:

```bash
php -S localhost:8080 -t public &
php tests/api_test.php
```

The test suite includes 73 tests covering:
- Health checks and CORS
- Executor registration
- Authentication and authorization
- Request lifecycle (create, claim, complete)
- Path traversal and injection attack prevention
- Input validation and edge cases

## Security

The server implements several security measures:

- **Path traversal prevention**: Thread refs are validated against a strict pattern
- **Input validation**: All user input is sanitized before use
- **Bearer token authentication**: API keys are hashed with SHA-256
- **CORS headers**: Configurable cross-origin access
- **Git audit trail**: All changes are tracked in git history

For production deployment security, see [DEPLOYMENT.md](DEPLOYMENT.md#security-hardening).
