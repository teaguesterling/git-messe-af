# MESS Exchange Deployment Guide

## Architecture Options

### Option A: Cloudflare Workers (Recommended for hosted)
- **Exchange**: Cloudflare Worker + KV
- **Client**: Hosted anywhere (GitHub Pages, Cloudflare Pages)
- **MCP**: Connect via HTTP/SSE to Worker
- **Cost**: Free (100k req/day, 1GB storage)

### Option B: Local + Tunnel (Recommended for privacy)
- **Exchange**: Local MCP server
- **Client**: Hosted or local
- **Tunnel**: Cloudflare Tunnel (free) exposes local server
- **Cost**: Free

### Option C: Fully Local (Development)
- **Exchange**: Local MCP server
- **Client**: Local dev server
- **No tunnel needed**

---

## Option A: Cloudflare Workers Setup

### 1. Install Wrangler CLI
```bash
npm install -g wrangler
wrangler login
```

### 2. Create KV Namespace
```bash
cd mess-exchange-worker
wrangler kv:namespace create MESS_KV
# Copy the ID into wrangler.toml
```

### 3. Update wrangler.toml
```toml
[[kv_namespaces]]
binding = "MESS_KV"
id = "YOUR_ID_FROM_STEP_2"
```

### 4. Deploy
```bash
wrangler deploy
```

Your exchange is now at: `https://mess-exchange.<your-subdomain>.workers.dev`

### 5. Configure Client
Open the MESS Client, click Settings (⚙️), enter your Worker URL.

### 6. Connect Claude Desktop (MCP)
Add to `~/.config/claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "mess": {
      "command": "npx",
      "args": ["-y", "mess-mcp-client", "https://mess-exchange.YOUR.workers.dev"]
    }
  }
}
```

---

## Option B: Local + Cloudflare Tunnel

### 1. Run Local Server
```bash
cd mess-local-server
npm install
npm start
# Server runs on http://localhost:3847
```

### 2. Install Cloudflare Tunnel
```bash
# macOS
brew install cloudflared

# Or download from https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation
```

### 3. Create Tunnel
```bash
cloudflared tunnel login
cloudflared tunnel create mess
cloudflared tunnel route dns mess mess.yourdomain.com
```

### 4. Run Tunnel
```bash
cloudflared tunnel run --url http://localhost:3847 mess
```

Now `https://mess.yourdomain.com` routes to your local server.

### 5. Quick Tunnel (No setup, temporary)
```bash
cloudflared tunnel --url http://localhost:3847
# Gives you a random *.trycloudflare.com URL
```

---

## Client Hosting Options

### GitHub Pages (Free)
1. Fork/create repo with `mess-client.jsx` built to static HTML
2. Enable Pages in repo settings
3. Access at `https://yourusername.github.io/mess-client`

### Cloudflare Pages (Free)
1. Connect GitHub repo
2. Build command: `npm run build`
3. Publish directory: `dist`

### Local Development
```bash
# With Vite
npm create vite@latest mess-client -- --template react
# Copy mess-client-v2.jsx content into src/App.jsx
npm install lucide-react
npm run dev
```

---

## MCP Server Configuration

### For Claude Desktop with local exchange:
```json
{
  "mcpServers": {
    "mess": {
      "command": "node",
      "args": ["/path/to/mess-mcp-server/index.js"],
      "env": {
        "MESS_DIR": "~/.mess"
      }
    }
  }
}
```

### For Claude Desktop with hosted exchange:
```json
{
  "mcpServers": {
    "mess": {
      "command": "node", 
      "args": ["/path/to/mess-mcp-client/index.js"],
      "env": {
        "MESS_API_URL": "https://mess-exchange.YOUR.workers.dev"
      }
    }
  }
}
```

---

## API Endpoints

### Worker / Local Server

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /api/threads` | GET | List all threads |
| `GET /api/threads?folder=received` | GET | List by folder |
| `GET /api/threads/:ref` | GET | Get single thread |
| `POST /api/mess` | POST | Send MESS message |
| `GET /health` | GET | Health check |

### POST /api/mess Body
```json
{
  "from": "teague-phone",
  "mess": [
    { "status": { "re": "2026-01-31-001", "code": "claimed" } }
  ],
  "channel": "http"
}
```

---

## Security Considerations

### Authentication (TODO for v2)
- JWT tokens for client auth
- MCP uses process-level auth (trusted)
- Worker can validate tokens via env secret

### Data Privacy
- KV data is encrypted at rest
- Local option keeps data on your machine
- Tunnel encrypted end-to-end

---

## Troubleshooting

### Worker not responding
```bash
wrangler tail  # View live logs
```

### KV not persisting
- Check namespace ID in wrangler.toml
- Verify binding name matches code

### CORS errors
- Worker includes CORS headers
- Check browser console for specific error

### MCP not connecting
- Check Claude Desktop logs: `~/Library/Logs/Claude/`
- Verify server command/args in config
