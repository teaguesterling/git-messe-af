# Notification Setup Guide

This guide covers how to configure each notification method for MESS Exchange. Notifications are sent when new requests arrive, alerting executors who can fulfill them.

## Overview

Notifications are configured per-executor in your `executors/` directory. Each executor can have multiple notification channels, and the system will send to all configured channels when a matching request arrives.

```yaml
# executors/my-phone.yaml
executor_id: my-phone
display_name: "My Phone"

notifications:
  - type: ntfy
    topic: my-secret-topic
  - type: slack
    webhook_url: https://hooks.slack.com/services/xxx

preferences:
  min_priority: normal
  quiet_hours:
    enabled: true
    start: "22:00"
    end: "07:00"
    timezone: America/Los_Angeles
```

---

## ntfy (Recommended for Personal Use)

[ntfy](https://ntfy.sh) is a free, open-source notification service. No account required.

### Setup

1. Choose a unique, hard-to-guess topic name (this acts as your "password")
2. Install the ntfy app on your phone ([iOS](https://apps.apple.com/app/ntfy/id1625396347), [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy))
3. Subscribe to your topic in the app

### Configuration

```yaml
notifications:
  - type: ntfy
    topic: my-secret-mess-topic-abc123
```

With a self-hosted ntfy server:

```yaml
notifications:
  - type: ntfy
    topic: mess-requests
    server: https://ntfy.your-server.com
```

### Security Note

Anyone who knows your topic name can send you notifications. Use a long, random string for your topic name.

---

## Slack

Send notifications to a Slack channel or DM via incoming webhooks.

### Setup

1. Go to [Slack API Apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Name it (e.g., "MESS Notifications") and select your workspace
4. Go to **Incoming Webhooks** → Enable → **Add New Webhook to Workspace**
5. Select the channel to post to
6. Copy the webhook URL

### Configuration

```yaml
notifications:
  - type: slack
    webhook_url: https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

### Features

- Rich message formatting with request details
- "View Request" button linking to the client
- Priority and photo request indicators

---

## Google Chat

Send notifications to a Google Chat space.

### Setup

1. Open Google Chat and go to the space where you want notifications
2. Click the space name → **Manage webhooks**
3. Click **Add webhook**, give it a name (e.g., "MESS")
4. Copy the webhook URL

### Configuration

```yaml
notifications:
  - type: google_chat
    webhook_url: https://chat.googleapis.com/v1/spaces/XXXXX/messages?key=XXXXX&token=XXXXX
```

---

## Google Tasks

Create tasks directly in your Google Tasks list when new MESS requests arrive.

### Setup

This requires a one-time OAuth setup to get a refresh token.

#### Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Enable the **Google Tasks API**:
   - Go to **APIs & Services** → **Library**
   - Search for "Tasks API" and enable it

#### Step 2: Create OAuth Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. If prompted, configure the OAuth consent screen:
   - User Type: External (or Internal if using Workspace)
   - Add your email as a test user
4. Application type: **Desktop app**
5. Download the JSON file (you'll need `client_id` and `client_secret`)

#### Step 3: Get Refresh Token

Run this one-time script to authorize and get your refresh token:

```bash
# Install dependencies
npm install googleapis

# Create auth script
cat > get_google_token.js << 'EOF'
const { google } = require('googleapis');
const http = require('http');
const url = require('url');

const CLIENT_ID = 'YOUR_CLIENT_ID';
const CLIENT_SECRET = 'YOUR_CLIENT_SECRET';
const REDIRECT_URI = 'http://localhost:3000/callback';

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/tasks'],
  prompt: 'consent'
});

console.log('Open this URL in your browser:\n');
console.log(authUrl);
console.log('\nWaiting for authorization...');

const server = http.createServer(async (req, res) => {
  const query = url.parse(req.url, true).query;
  if (query.code) {
    const { tokens } = await oauth2Client.getToken(query.code);
    console.log('\n=== Save this refresh token as a GitHub secret ===');
    console.log('GOOGLE_TASKS_REFRESH_TOKEN:', tokens.refresh_token);
    console.log('================================================\n');
    res.end('Authorization successful! You can close this window.');
    server.close();
  }
}).listen(3000);
EOF

node get_google_token.js
```

#### Step 4: Configure GitHub Secrets

Add these secrets to your repository (**Settings** → **Secrets and variables** → **Actions**):

| Secret | Value |
|--------|-------|
| `GOOGLE_TASKS_CLIENT_ID` | Your OAuth client ID |
| `GOOGLE_TASKS_CLIENT_SECRET` | Your OAuth client secret |
| `GOOGLE_TASKS_REFRESH_TOKEN` | The refresh token from Step 3 |

#### Step 5: Get Your Task List ID (Optional)

By default, tasks are added to your primary "@default" list. To use a specific list:

1. Go to [Google Tasks](https://tasks.google.com/)
2. Open browser DevTools → Network tab
3. Reload the page and look for a request to `tasks.googleapis.com`
4. Find your list ID in the response

### Configuration

```yaml
notifications:
  - type: google_tasks
    # Optional: specify a task list (defaults to primary list)
    # list_id: "MDExNTkyOTk0OTk5MzQ5MzY0MzE6MDow"
```

### Features

- Creates a task with the request intent as the title
- Includes priority, requestor, and context in task notes
- Links to the MESS client for easy access

---

## Pushover

[Pushover](https://pushover.net/) provides reliable push notifications to iOS/Android ($5 one-time purchase per platform).

### Setup

1. Create a Pushover account at [pushover.net](https://pushover.net/)
2. Install the Pushover app and log in
3. Note your **User Key** from the dashboard
4. Create an application at [pushover.net/apps](https://pushover.net/apps/build)
5. Note the **API Token/Key**

### GitHub Secrets

Add to your repository secrets:

| Secret | Value |
|--------|-------|
| `PUSHOVER_APP_TOKEN` | Your application API token |

### Configuration

```yaml
notifications:
  - type: pushover
    user_key: your-user-key-here
```

### Features

- Priority mapping (background/normal/elevated/urgent)
- Urgent notifications repeat until acknowledged
- Direct link to request

---

## Email (SendGrid)

Send email notifications via [SendGrid](https://sendgrid.com/) (free tier: 100 emails/day).

### Setup

1. Create a SendGrid account
2. Go to **Settings** → **API Keys** → **Create API Key**
3. Give it "Mail Send" permission
4. Verify a sender email address under **Settings** → **Sender Authentication**

### GitHub Secrets

| Secret | Value |
|--------|-------|
| `SENDGRID_API_KEY` | Your API key |
| `SENDGRID_FROM_EMAIL` | Your verified sender email |

### Configuration

```yaml
notifications:
  - type: email
    address: recipient@example.com
```

---

## Gmail (SMTP)

Send emails directly through Gmail using an app password.

### Setup

1. Enable 2-factor authentication on your Google account
2. Go to [Google Account Security](https://myaccount.google.com/security)
3. Under "2-Step Verification", click **App passwords**
4. Generate a new app password for "Mail"

### GitHub Secrets

| Secret | Value |
|--------|-------|
| `GMAIL_EMAIL` | Your Gmail address |
| `GMAIL_APP_PASSWORD` | The 16-character app password |

### Configuration

```yaml
notifications:
  - type: gmail
    # Optional: send to different address (defaults to self)
    to: other@example.com
```

---

## SMS (Twilio)

Send text messages via [Twilio](https://www.twilio.com/).

### Setup

1. Create a Twilio account
2. Get a phone number from the console
3. Find your Account SID and Auth Token in the dashboard

### GitHub Secrets

| Secret | Value |
|--------|-------|
| `TWILIO_ACCOUNT_SID` | Your account SID |
| `TWILIO_AUTH_TOKEN` | Your auth token |
| `TWILIO_FROM_NUMBER` | Your Twilio phone number (e.g., +15551234567) |

### Configuration

```yaml
notifications:
  - type: sms
    phone: "+15559876543"
```

---

## Generic Webhook

For custom integrations, send the raw request payload to any URL.

### Configuration

```yaml
notifications:
  - type: webhook
    url: https://your-service.com/webhook
    method: POST  # Optional, defaults to POST
    headers:      # Optional custom headers
      Authorization: Bearer your-token
      X-Custom-Header: value
```

### Payload Format

```json
{
  "ref": "2026-01-31-001",
  "intent": "Check if the garage door is closed",
  "priority": "normal",
  "requestor": "claude-desktop",
  "created": "2026-01-31T21:00:00Z",
  "context": ["Getting ready for bed"],
  "wants_photo": false,
  "required_capabilities": ["check:visual"],
  "url": "https://your-client-url.com"
}
```

---

## Multiple Notification Channels

You can configure multiple channels to ensure you don't miss requests:

```yaml
notifications:
  # Primary: push notification
  - type: ntfy
    topic: mess-urgent

  # Backup: email for record
  - type: email
    address: me@example.com

  # Work hours: Slack
  - type: slack
    webhook_url: https://hooks.slack.com/services/xxx
```

---

## Filtering Notifications

### By Priority

Only receive notifications above a certain priority level:

```yaml
preferences:
  min_priority: elevated  # Only elevated and urgent
```

Priority levels (lowest to highest): `background`, `normal`, `elevated`, `urgent`

### Quiet Hours

Silence non-urgent notifications during specified hours:

```yaml
preferences:
  quiet_hours:
    enabled: true
    start: "22:00"
    end: "07:00"
    timezone: America/New_York
```

Urgent requests will still notify during quiet hours.

---

## Troubleshooting

### Notifications not sending?

1. Check the GitHub Actions log:
   - Go to **Actions** → **MESS Notifications** → latest run
   - Look for errors in the "Process notifications" step

2. Verify your executor file:
   - Must be in `executors/` directory
   - Must have `.yaml` or `.yml` extension
   - Must not start with `_` (underscore files are ignored)
   - Must have valid YAML syntax

3. Check secrets are configured:
   - Go to **Settings** → **Secrets and variables** → **Actions**
   - Ensure all required secrets for your notification type exist

### Test mode

Run the workflow manually in test mode to debug:

1. Go to **Actions** → **MESS Notifications**
2. Click **Run workflow**
3. Enable "Run in test mode"

This will log what would be sent without actually sending notifications.
