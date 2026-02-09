# PHP MESS Exchange Server - Deployment Guide

This guide covers deploying the PHP MESS Exchange Server in various environments.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Deployment Options](#deployment-options)
  - [Docker (Recommended)](#docker-recommended)
  - [Bare Metal / VPS](#bare-metal--vps)
  - [Shared Hosting](#shared-hosting)
  - [Raspberry Pi / Home Server](#raspberry-pi--home-server)
- [Configuration](#configuration)
- [Security Hardening](#security-hardening)
- [Syncing with Git Remote](#syncing-with-git-remote)
- [Backup and Recovery](#backup-and-recovery)
- [Troubleshooting](#troubleshooting)

---

## Overview

The PHP MESS Exchange Server is a lightweight, self-contained server that:

- Serves the MESS web client
- Provides the REST API for request management
- Stores data in MESSE-AF YAML format
- Uses git for version control and audit trails

**Resource Requirements:**
- PHP 8.1+ with CLI
- ~50MB disk for application
- ~10MB RAM per worker
- Git (optional but recommended)

---

## Prerequisites

### Required
- PHP 8.1 or higher
- Composer (for dependency installation)

### Optional
- Git (for version-controlled storage)
- A reverse proxy (nginx, Apache, Caddy) for production

### PHP Extensions
The server uses minimal extensions, all typically included in standard PHP:
- `json` (bundled)
- `mbstring` (common)

---

## Deployment Options

### Docker (Recommended)

The fastest way to deploy. Works on any system with Docker.

#### Quick Start

```bash
cd php-server
docker compose up -d
```

Access at: `http://localhost:8080/client/`

#### Custom Configuration

Create a `config.php` before building:

```bash
cp config.example.php config.php
# Edit config.php with your settings
```

Then rebuild:

```bash
docker compose build --no-cache
docker compose up -d
```

#### Persistent Data

By default, data is stored in `./data/`. To persist across container rebuilds:

```yaml
# docker-compose.yml
volumes:
  - ./data:/app/data          # Persist MESS data
  - ../client:/app/../client:ro  # Mount client files
```

#### Environment Variables

```yaml
environment:
  - PHP_CLI_SERVER_WORKERS=4  # Number of PHP workers
```

#### Docker with External Reverse Proxy

For production, run behind nginx/Caddy:

```yaml
# docker-compose.yml
services:
  mess-php:
    build: .
    expose:
      - "8080"  # Don't publish directly
    networks:
      - web
```

---

### Bare Metal / VPS

For dedicated servers or VPS (Ubuntu, Debian, RHEL, etc.)

#### 1. Install Dependencies

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install php8.2-cli php8.2-mbstring composer git
```

**RHEL/Rocky/Alma:**
```bash
sudo dnf install php-cli php-mbstring composer git
```

**Arch Linux:**
```bash
sudo pacman -S php composer git
```

#### 2. Clone and Install

```bash
cd /opt
git clone https://github.com/your-user/git-messe-af.git mess
cd mess/php-server

# Install PHP dependencies
composer install --no-dev --optimize-autoloader

# Configure
cp config.example.php config.php
# Edit config.php as needed

# Initialize data directory
mkdir -p data/exchange/{state=received,state=executing,state=finished,state=canceled}
mkdir -p data/executors
cd data && git init && git config user.email "mess@local" && git config user.name "MESS Server"
```

#### 3. Run with Systemd

Create `/etc/systemd/system/mess-server.service`:

```ini
[Unit]
Description=MESS Exchange Server
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/mess/php-server
ExecStart=/usr/bin/php -S 127.0.0.1:8080 -t public
Restart=always
RestartSec=5

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/mess/php-server/data

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable mess-server
sudo systemctl start mess-server
```

#### 4. Reverse Proxy (nginx)

Create `/etc/nginx/sites-available/mess`:

```nginx
server {
    listen 80;
    server_name mess.example.com;

    # Redirect to HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name mess.example.com;

    ssl_certificate /etc/letsencrypt/live/mess.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mess.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable:

```bash
sudo ln -s /etc/nginx/sites-available/mess /etc/nginx/sites-enabled/
sudo certbot --nginx -d mess.example.com  # Optional: HTTPS
sudo systemctl reload nginx
```

#### 5. Reverse Proxy (Caddy - Simpler)

Create `/etc/caddy/Caddyfile`:

```
mess.example.com {
    reverse_proxy localhost:8080
}
```

Caddy automatically provisions HTTPS via Let's Encrypt.

---

### Shared Hosting

For cPanel, Plesk, or similar shared hosting environments.

#### Requirements
- PHP 8.1+ support
- SSH access (for Composer)
- Ability to set document root

#### Steps

1. **Upload files** via FTP/SFTP or git:
   ```
   public_html/
   └── mess/
       ├── public/         <- Set as document root
       ├── src/
       ├── vendor/
       ├── data/
       └── config.php
   ```

2. **Install dependencies** via SSH:
   ```bash
   cd ~/public_html/mess
   composer install --no-dev --optimize-autoloader
   ```

3. **Set document root** in cPanel:
   - Go to "Domains" or "Subdomains"
   - Point `mess.yourdomain.com` to `/public_html/mess/public`

4. **Configure** `config.php`:
   ```php
   return [
       'exchange_id' => 'home',
       'data_path' => __DIR__ . '/data',
       'git_enabled' => false,  // Git may not work on shared hosting
       'git_push' => false,
   ];
   ```

5. **Set permissions**:
   ```bash
   chmod 755 data
   chmod -R 755 data/exchange data/executors
   ```

#### .htaccess for Apache

Create `public/.htaccess`:

```apache
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.php [L]

# Security headers
Header set X-Content-Type-Options "nosniff"
Header set X-Frame-Options "DENY"
Header set X-XSS-Protection "1; mode=block"
```

---

### Raspberry Pi / Home Server

Perfect for always-on home deployment.

#### 1. Install on Raspberry Pi OS

```bash
sudo apt update
sudo apt install php-cli php-mbstring composer git

# Clone repository
cd /home/pi
git clone https://github.com/your-user/git-messe-af.git mess
cd mess/php-server

composer install --no-dev
cp config.example.php config.php
```

#### 2. Initialize Data

```bash
mkdir -p data/exchange/{state=received,state=executing,state=finished,state=canceled}
mkdir -p data/executors
cd data && git init
```

#### 3. Create Systemd Service

```bash
sudo nano /etc/systemd/system/mess.service
```

```ini
[Unit]
Description=MESS Exchange Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/mess/php-server
ExecStart=/usr/bin/php -S 0.0.0.0:8080 -t public
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable mess
sudo systemctl start mess
```

#### 4. Access from Network

- Local: `http://raspberrypi.local:8080/client/`
- By IP: `http://192.168.1.x:8080/client/`

#### 5. Optional: Tailscale for Remote Access

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Access from anywhere: `http://raspberrypi:8080/client/`

---

## Configuration

### config.php Options

```php
return [
    // Exchange identifier (used in API paths)
    'exchange_id' => 'home',

    // Path to data directory (must be writable)
    'data_path' => __DIR__ . '/data',

    // Enable git commits after each change
    'git_enabled' => true,

    // Auto-push to remote after commits
    'git_push' => false,

    // Pre-configured tokens (optional, usually auto-generated)
    'tokens' => [
        // 'mess_home_abc123' => ['exchange' => 'home', 'executor' => 'claude']
    ],
];
```

### Multi-Exchange Setup

To run multiple exchanges:

```php
'exchange_id' => getenv('MESS_EXCHANGE_ID') ?: 'home',
```

Then run multiple instances:

```bash
MESS_EXCHANGE_ID=home php -S 127.0.0.1:8080 -t public &
MESS_EXCHANGE_ID=work php -S 127.0.0.1:8081 -t public &
```

---

## Security Hardening

### 1. HTTPS Only

Always use HTTPS in production. Use Let's Encrypt with Caddy or Certbot.

### 2. Firewall Rules

Only expose necessary ports:

```bash
# UFW (Ubuntu)
sudo ufw allow 22    # SSH
sudo ufw allow 443   # HTTPS
sudo ufw enable
```

### 3. Rate Limiting (nginx)

```nginx
limit_req_zone $binary_remote_addr zone=mess:10m rate=10r/s;

server {
    location /api/ {
        limit_req zone=mess burst=20 nodelay;
        proxy_pass http://127.0.0.1:8080;
    }
}
```

### 4. File Permissions

```bash
# Application files (read-only)
chmod -R 755 /opt/mess/php-server
chown -R www-data:www-data /opt/mess/php-server

# Data directory (writable)
chmod -R 775 /opt/mess/php-server/data
```

### 5. Disable PHP Dangerous Functions

Create `php.ini` or add to existing:

```ini
disable_functions = exec,passthru,shell_exec,system,popen
```

Note: Git integration requires `proc_open`, which is used safely.

---

## Syncing with Git Remote

### Initial Setup

```bash
cd /opt/mess/php-server/data
git remote add origin git@github.com:user/private-messe-af-store.git
git fetch origin
git checkout -b main origin/main  # Or merge as needed
```

### Enable Auto-Push

In `config.php`:

```php
'git_push' => true,
```

### SSH Key Setup

Generate a deploy key:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/mess_deploy -N ""
```

Add public key to GitHub repository as a deploy key with write access.

Configure SSH:

```bash
# ~/.ssh/config
Host github.com-mess
    HostName github.com
    User git
    IdentityFile ~/.ssh/mess_deploy
```

Update remote:

```bash
git remote set-url origin git@github.com-mess:user/private-messe-af-store.git
```

---

## Backup and Recovery

### Backup

The entire state is in the `data/` directory:

```bash
# Simple backup
tar -czf mess-backup-$(date +%Y%m%d).tar.gz data/

# Or use git
cd data && git push origin main
```

### Recovery

```bash
# From tarball
tar -xzf mess-backup-20260208.tar.gz

# From git
cd data && git pull origin main
```

### Automated Backups

Add to crontab:

```bash
0 3 * * * cd /opt/mess/php-server && tar -czf /backups/mess-$(date +\%Y\%m\%d).tar.gz data/
```

---

## Troubleshooting

### Server Won't Start

**Check PHP version:**
```bash
php -v  # Must be 8.1+
```

**Check port availability:**
```bash
ss -tlnp | grep 8080
```

**Check permissions:**
```bash
ls -la data/
# Should be writable by the PHP process user
```

### 500 Internal Server Error

**Check PHP error log:**
```bash
tail -f /var/log/php-errors.log
# Or in Docker:
docker logs mess-php
```

**Common causes:**
- Missing composer dependencies: `composer install`
- Invalid config.php syntax
- Data directory not writable

### Git Commits Not Working

**Check git configuration:**
```bash
cd data
git config user.email  # Must be set
git config user.name   # Must be set
```

**Check permissions:**
```bash
ls -la data/.git/
# .git directory must be writable
```

### Client Shows "Local Server Detected" but Doesn't Work

**Verify API is accessible:**
```bash
curl http://localhost:8080/health
```

**Check CORS headers:**
```bash
curl -I http://localhost:8080/health
# Should include: Access-Control-Allow-Origin: *
```

### Executor Registration Fails

**Check the error message:**
```bash
curl -X POST http://localhost:8080/api/v1/exchanges/home/register \
  -H "Content-Type: application/json" \
  -d '{"executor_id": "test"}'
```

**Common issues:**
- Exchange ID mismatch with config
- Data directory not writable
- Executor already exists (409 Conflict)

---

## Monitoring

### Health Check Endpoint

```bash
curl http://localhost:8080/health
```

Returns:
```json
{
    "status": "ok",
    "service": "mess-exchange-server",
    "version": "1.0.0",
    "php_version": "8.2.x",
    "exchange_id": "home"
}
```

### Uptime Monitoring

Use any uptime service (UptimeRobot, Healthchecks.io, etc.) to monitor `/health`.

### Log Rotation

For systemd services, logs are managed by journald:

```bash
journalctl -u mess-server -f  # Follow logs
journalctl -u mess-server --since "1 hour ago"
```

---

## Upgrading

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
```

### Bare Metal

```bash
cd /opt/mess
git pull
cd php-server
composer install --no-dev --optimize-autoloader
sudo systemctl restart mess-server
```

Data is preserved in `data/` directory and doesn't need migration.
