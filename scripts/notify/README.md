# MESS Notification Dispatcher

Sends notifications when new MESS requests are created. This module is called by the GitHub Actions workflow when new files appear in `exchange/state=received/`.

## Usage

```bash
# From repo root
cd scripts/notify
npm install
node index.js

# Dry run (no actual notifications)
node index.js --dry-run
```

## How It Works

1. Uses `git diff` to find newly added files in `exchange/state=received/`
2. Loads executor configurations from `executors/*.yaml`
3. For each new request, checks which executors should be notified:
   - Capability matching (if request specifies required capabilities)
   - Priority filtering (respects executor's min_priority setting)
   - Quiet hours (skips non-urgent notifications during quiet hours)
4. Sends notifications via configured channels

## Supported Notification Types

| Type | Description | Required Config |
|------|-------------|-----------------|
| `ntfy` | [ntfy.sh](https://ntfy.sh/) push notifications | `topic`, `server?` |
| `slack` | Slack incoming webhooks | `webhook_url` |
| `google_chat` | Google Chat webhooks | `webhook_url` |
| `google_tasks` | Google Tasks via OAuth | `client_id`, `client_secret`, `refresh_token` |
| `pushover` | [Pushover](https://pushover.net/) | `user_key` |
| `email` | SendGrid email | `address` |
| `gmail` | Gmail SMTP | `to?`, `email?`, `app_password?` |
| `sms` | Twilio SMS | `phone` |
| `webhook` | Generic webhook | `url`, `method?`, `headers?` |

## Environment Variables

Configure these as GitHub repository secrets:

| Variable | Required For | Description |
|----------|--------------|-------------|
| `PUSHOVER_APP_TOKEN` | pushover | Pushover application token |
| `TWILIO_ACCOUNT_SID` | sms | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | sms | Twilio auth token |
| `TWILIO_FROM_NUMBER` | sms | Twilio sender number |
| `SENDGRID_API_KEY` | email | SendGrid API key |
| `SENDGRID_FROM_EMAIL` | email | SendGrid sender address |
| `GMAIL_EMAIL` | gmail | Gmail address |
| `GMAIL_APP_PASSWORD` | gmail | Gmail app password |
| `GOOGLE_CLIENT_ID` | google_tasks | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | google_tasks | Google OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | google_tasks | Google OAuth refresh token |
| `CLIENT_URL` | all | URL to MESS client (optional) |

## Executor Configuration

Add notifications to your executor config in `executors/your-executor.yaml`:

```yaml
executor_id: my-executor
display_name: My Executor
capabilities:
  - check:visual
  - photo:capture

notifications:
  - type: ntfy
    topic: my-mess-notifications

  - type: slack
    webhook_url: https://hooks.slack.com/services/...

  - type: google_tasks
    tasklist: "@default"
    title: "MESS: {{intent}}"
    notes: "Ref: {{ref}}\nPriority: {{priority}}"

preferences:
  min_priority: normal
  quiet_hours:
    enabled: true
    start: "22:00"
    end: "07:00"
    timezone: America/Los_Angeles
```

## Google Tasks Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Enable the **Google Tasks API**
4. Go to **Credentials** → **Create Credentials** → **OAuth client ID**
5. Choose **Desktop app** as application type
6. Download the credentials JSON

### Getting a Refresh Token

Use the [OAuth Playground](https://developers.google.com/oauthplayground/):

1. Click the gear icon (⚙️) → Check "Use your own OAuth credentials"
2. Enter your Client ID and Client Secret
3. In Step 1, add scope: `https://www.googleapis.com/auth/tasks`
4. Click "Authorize APIs" and grant access
5. In Step 2, click "Exchange authorization code for tokens"
6. Copy the `refresh_token` from the response

### Configuration

You can configure Google Tasks credentials either:

**In executor YAML (per-executor):**
```yaml
notifications:
  - type: google_tasks
    client_id: "xxx.apps.googleusercontent.com"
    client_secret: "xxx"
    refresh_token: "xxx"
```

**Via environment variables (shared):**
```
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REFRESH_TOKEN=xxx
```

### Available Options

| Option | Default | Description |
|--------|---------|-------------|
| `tasklist` | `@default` | Task list ID or `@default` for primary |
| `title` | `MESS: {{intent}}` | Task title (supports templates) |
| `notes` | Auto-generated | Task notes/description |
| `due` | None | Due date in RFC 3339 format |
| `action` | `create` | `create` or `complete` |
| `task_id` | Required for complete | Task ID to mark complete |

## Adding New Senders

1. Create `lib/senders/your-sender.js`:

```javascript
import { httpRequest, parseUrl } from '../http.js';

export async function send(config, payload) {
  // config = notification config from executor YAML
  // payload = { ref, intent, priority, requestor, context, wants_photo, url }

  // Send the notification...

  return { success: true, external_id: '...' };
}
```

2. Add export to `lib/senders/index.js`:

```javascript
export { send as your_sender } from './your-sender.js';
```

3. Document required config/env vars in this README

## Template Variables

These variables are available in notification templates:

| Variable | Description |
|----------|-------------|
| `{{ref}}` | Thread reference (e.g., `2024-01-15-ABCD`) |
| `{{intent}}` | Request intent/description |
| `{{priority}}` | Priority level (background, normal, elevated, urgent) |
| `{{requestor}}` | ID of the requestor |
| `{{url}}` | URL to view the request in the client |
