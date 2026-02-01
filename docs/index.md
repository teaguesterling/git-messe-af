# MESS Exchange

**M**eatspace **E**xecution and **S**ubmission **S**ystem

Dispatch physical-world tasks from AI agents to human executors using GitHub as the backend.

## What is MESS?

MESS enables AI agents (like Claude) to request actions in the physical world:

- **Observations**: "What's in the fridge?", "Is the garage door closed?"
- **Actions**: "Start the rice cooker", "Vacuum the kitchen"
- **Purchases**: "Order groceries", "Buy concert tickets"
- **Fabrication**: "3D print this part", "Cut this design"

## Architecture

```
┌─────────────────────┐
│  MESS Client        │  ← Can be hosted ANYWHERE (public)
│  (static HTML/JS)   │     Cloudflare Pages, GitHub Pages, Netlify, local file
└──────────┬──────────┘
           │ GitHub API (authenticated)
           ▼
┌─────────────────────┐
│  Your Data Repo     │  ← PRIVATE repository
│  exchange/*.yaml    │     Only accessible with your token
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  GitHub Actions     │  ← Notifications (optional)
│  Slack/Push/ntfy    │
└─────────────────────┘
```

**Key insight**: The client is just static HTML — it contains no secrets and can be public. Your data stays in a private repo that requires authentication.

## Quick Links

- [MESS Protocol v1](mess-protocol-v1.md) - The full protocol specification
- [MESSE-AF Format](messe-af-v1.md) - Thread file format specification
- [Deployment Guide](mess-deployment-guide.md) - How to deploy MESS
- [Implementation Plan](mess-implementation-plan.md) - Architecture and roadmap

## Getting Started

### 1. Create Your MESS Exchange Repository

This repository is a **template**. Use it to create your own MESS exchange:

1. Go to [github.com/teague/git-messe-af](https://github.com/teague/git-messe-af)
2. Click the green **"Use this template"** button
3. Select **"Create a new repository"**
4. Name your repository (e.g., `mess-exchange`)
5. **Select "Private"** to keep your tasks private
6. Click **"Create repository"**

Your new repo comes pre-configured with the folder structure, GitHub Actions, and client.

### 2. Create a GitHub Token

Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) with:

- **Repository access**: Only select repositories → your MESS repo
- **Permissions**: Contents → Read and write

### 3. Open the Client

The client can be:

- **Hosted**: Deploy to any static host (the GitHub Pages deployment is automatic)
- **Local file**: Just open `client/index.html` in your browser

### 4. Configure Your Profile

On first launch, the client walks you through:

1. **Token setup** — Paste your GitHub token
2. **Repository** — Enter `your-username/mess-exchange`
3. **Profile** — Set your executor name and capabilities

## Connecting Claude Desktop

Add to your Claude Desktop config:

**Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Linux**: `~/.config/claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mess": {
      "command": "node",
      "args": ["/path/to/mcp/index.js"],
      "env": {
        "MESS_GITHUB_REPO": "your-username/mess-exchange",
        "MESS_GITHUB_TOKEN": "github_pat_xxxxx",
        "MESS_AGENT_ID": "claude-desktop"
      }
    }
  }
}
```
