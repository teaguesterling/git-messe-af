# MESS Exchange

**M**eatspace **E**xecution and **S**ubmission **S**ystem

Dispatch physical-world tasks from AI agents to human executors using GitHub as the backend.

**[Try the Client](https://teaguesterling.github.io/git-messe-af/)** | [Documentation](https://git-messe-af.readthedocs.io/en/latest/)

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

---

## Quick Start

### 1. Create Your MESS Exchange Repository

This repository is a **template**. Click the button below to create your own MESS exchange:

[![Use this template](https://img.shields.io/badge/Use%20this%20template-238636?style=for-the-badge&logo=github&logoColor=white)](https://github.com/teaguesterling/git-messe-af/generate)

Or manually:

1. Click the green **"Use this template"** button at the top of this page
2. Select **"Create a new repository"**
3. Name your repository (e.g., `mess-exchange`)
4. **Select "Private"** ← Important for keeping your tasks private
5. Click **"Create repository"**

Your new repo comes pre-configured with:
- `exchange/` folder structure for task threads
- `executors/` folder for executor configs
- GitHub Actions for notifications
- GitHub Pages workflow for hosting the client
- MCP server for Claude integration

### 2. Create a GitHub Token

See the detailed guide below: [Creating a Minimal-Scope Token](#creating-a-minimal-scope-token)

### 3. Open the Client

The client can be:
- **GitHub Pages**: Enable Pages in your repo settings (Source: GitHub Actions), then visit `https://your-username.github.io/your-repo-name/`
- **Local file**: Just open `client/index.html` in your browser

### 4. Configure Your Executor Profile

On first launch, the client walks you through:

1. **Token setup** — Paste your GitHub token
2. **Repository** — Enter `your-username/mess-exchange`
3. **Profile** — Set your executor name and capabilities

---

## Creating a Minimal-Scope Token

GitHub's fine-grained tokens let you create a token that can ONLY access your MESS exchange repository — nothing else.

### Step-by-Step

1. **Go to token settings**
   
   [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)

2. **Token name**
   ```
   MESS Exchange - [device name]
   ```
   Example: `MESS Exchange - iPhone`, `MESS Exchange - Kitchen Tablet`

3. **Expiration**
   - Choose "No expiration" for convenience
   - Or set a reminder to rotate periodically

4. **Repository access** ← Critical!
   
   Select: **"Only select repositories"**
   
   Then choose ONLY your `mess-exchange` repository.
   
   ⚠️ Do NOT select "All repositories"

5. **Permissions**
   
   Expand "Repository permissions" and set:
   
   | Permission | Access |
   |------------|--------|
   | **Contents** | **Read and write** |
   | Everything else | No access |

6. **Generate token**
   
   Copy the token immediately — you won't see it again!

### What This Token Can Do

✅ Read files in `your-username/mess-exchange`  
✅ Write files in `your-username/mess-exchange`  
❌ Access any other repository  
❌ Access your profile, settings, or other data  
❌ Create/delete repositories  
❌ Manage collaborators or settings  

### Security Best Practices

- **One token per device** — If a device is lost, revoke just that token
- **Private repo** — Your MESSE-AF files contain task details
- **Rotate periodically** — Easy to create new tokens
- **Token stored locally** — Only in your browser's localStorage

### If a Token is Compromised

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Find the compromised token
3. Click "Delete"
4. Create a new one

The attacker could only have accessed your MESS exchange files — no other repositories or settings.

---

## Executor Configuration

### Executor ID

A unique identifier for this device/person:
- `teague-phone`
- `mom-ipad`
- `kitchen-tablet`
- `office-desktop`

This appears in the message history and helps track who handled what.

### Display Name

Human-friendly name shown in the UI:
- `Teague's Phone`
- `Kitchen Tablet`

### Capabilities

What types of tasks can you handle from this device? Select applicable capabilities:

**Physical Tasks**
- Visual checks (look at something, read a display)
- Physical inspection (touch, open, measure)
- Fetch items indoor/outdoor
- Operate appliances
- Vehicle tasks

**Communication**
- Phone calls
- Text messages
- In-person interaction

**Information**
- Take photos
- Read documents
- Local research

**Care Tasks**
- Plant care
- Pet care
- Child supervision

Capabilities enable smart routing in future versions — requests will be dispatched to executors who can handle them.

### Can Create Requests

Toggle whether this client can post new requests (act as requestor) or only respond to them (executor only).

---

## Connecting Claude Desktop

Add to your Claude Desktop config:

**Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Linux**: `~/.config/claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mess": {
      "command": "node",
      "args": ["/path/to/mess-mcp-server-github/index.js"],
      "env": {
        "MESS_GITHUB_REPO": "your-username/mess-exchange",
        "MESS_GITHUB_TOKEN": "github_pat_xxxxx",
        "MESS_AGENT_ID": "claude-desktop"
      }
    }
  }
}
```

Restart Claude Desktop. Now Claude can use `mess` and `mess_status` tools.

---

## Notifications

The included GitHub Action sends notifications when new requests arrive. If you created your repo from this template, the workflow is already included.

### Setup

Add secrets to your repo (Settings → Secrets and variables → Actions):

**For Google Chat (Workspace users):**
1. Open a Google Chat space
2. Click space name → Apps & integrations → Webhooks → Create
3. Copy the webhook URL
4. Add to your executor config (no repo secrets needed - URL goes in executor file)

**For Gmail (Workspace users):**
```
GMAIL_EMAIL = your-email@your-domain.com
GMAIL_APP_PASSWORD = xxxx xxxx xxxx xxxx
```
To create an App Password:
1. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
2. Select "Mail" and "Other (Custom name)" → "MESS"
3. Copy the 16-character password (spaces optional)

**For Slack:**
```
SLACK_WEBHOOK_URL = https://hooks.slack.com/services/xxx
```

**For Pushover (iOS/Android):**
```
PUSHOVER_APP_TOKEN = your-app-token
PUSHOVER_USER = your-user-key
```

**For ntfy.sh (free, self-hostable):**
No secrets needed! Just pick a topic name in your executor config.

**For SMS via Twilio:**
```
TWILIO_ACCOUNT_SID = ACxxxxx
TWILIO_AUTH_TOKEN = xxxxx
TWILIO_FROM_NUMBER = +15551234567
```

**For Email via SendGrid:**
```
SENDGRID_API_KEY = SG.xxxxx
SENDGRID_FROM_EMAIL = noreply@yourdomain.com
```

---

## Hosting the Client

The client is a single HTML file with no build step. Host it anywhere:

### GitHub Pages (Automatic)

If you created your repo from this template, GitHub Pages deployment is already configured:

1. Go to your repo's **Settings → Pages**
2. Under "Build and deployment", select **Source: GitHub Actions**
3. Push any change to `client/` or manually trigger the workflow
4. Your client will be live at `https://your-username.github.io/your-repo-name/`

### Cloudflare Pages
1. Create a new Pages project
2. Upload the `client/` folder
3. Deploy

### Netlify / Vercel
Drag and drop the `client/` folder.

### Local File
Just open `client/index.html` in your browser — it works offline once configured!

---

## FAQ

**Q: Is my data secure?**

Your MESSE-AF files are in a private GitHub repo. Only someone with a valid token can access them. The client is just static HTML that runs in your browser.

**Q: Can I use the same token on multiple devices?**

Yes, but we recommend one token per device. If you lose a device, you can revoke just that token.

**Q: What if GitHub is down?**

The client won't work without GitHub API access. Consider this a household-scale system, not mission-critical infrastructure.

**Q: Can multiple people use the same exchange?**

Yes! Each person creates their own fine-grained token with access to the shared repo. Everyone sees the same threads.

**Q: How do I delete old threads?**

Move them to `canceled/` or delete the files directly in GitHub. Git history preserves the audit trail.

---

## File Format (MESSE-AF)

Threads are stored as multi-document YAML:

```yaml
# Envelope (first doc)
ref: 2026-01-31-001
requestor: claude-desktop
executor: teague-phone
status: completed
created: 2026-01-31T21:00:00Z
updated: 2026-01-31T21:05:00Z
intent: Check if the garage door is closed
priority: normal
history:
  - action: created
    at: 2026-01-31T21:00:00Z
    by: claude-desktop
  - action: claimed
    at: 2026-01-31T21:01:00Z
    by: teague-phone
  - action: completed
    at: 2026-01-31T21:05:00Z
    by: teague-phone
---
# Messages (appended)
from: claude-desktop
received: 2026-01-31T21:00:00Z
channel: mcp
MESS:
  - v: 1.0.0
  - request:
      intent: Check if the garage door is closed
      context:
        - Getting ready for bed
      response_hint:
        - image
---
from: teague-phone
received: 2026-01-31T21:05:00Z
channel: github
MESS:
  - status:
      re: 2026-01-31-001
      code: completed
  - response:
      re: 2026-01-31-001
      content:
        - image: data:image/jpeg;base64,...
        - "All clear - garage is closed and locked"
```
