# Executor Registration

Executors self-register by creating a YAML file in the `executors/` folder.

## File Location

```
executors/{executor-id}.yaml
```

Example: `executors/teague-phone.yaml`

## Schema

```yaml
# Required
executor_id: teague-phone
display_name: "Teague's Phone"

# Capabilities this executor can handle
# Requests are routed to executors with matching capabilities
capabilities:
  # Physical tasks
  - check:visual           # Look at something, read a display
  - check:physical         # Touch, open, measure
  - fetch:indoor           # Get something from another room
  - fetch:outdoor          # Pick up packages, check mailbox
  - operate:appliance      # Thermostat, washer, coffee maker
  - operate:vehicle        # Drive, check car status
  
  # Communication
  - call:phone             # Make or receive calls
  - message:text           # Send SMS/texts
  - interact:person        # Talk to delivery, neighbors
  
  # Information
  - photo:capture          # Take and send photos
  - read:document          # Physical mail, papers
  - research:local         # Check store hours, availability
  
  # Care tasks
  - care:plant             # Water, prune, check plants
  - care:pet               # Feed, walk, check on pets
  - care:child             # Check on, assist children

# How to notify this executor of new requests
notifications:
  # Google Chat webhook (great for Workspace users)
  - type: google_chat
    webhook_url: https://chat.googleapis.com/v1/spaces/xxx/messages?key=xxx&token=xxx
    
  # Gmail via App Password (uses your Google Workspace account)
  - type: gmail
    to: teague@example.com  # Optional, defaults to GMAIL_EMAIL
    # Requires GMAIL_EMAIL and GMAIL_APP_PASSWORD repo secrets
    
  # Email notification (via SendGrid)
  - type: email
    address: teague@example.com
    
  # Slack (direct message or channel)
  - type: slack
    webhook_url: https://hooks.slack.com/services/T00/B00/xxx
    
  # Pushover (iOS/Android push notifications)
  - type: pushover
    user_key: your-user-key
    # app_token is set as repo secret PUSHOVER_APP_TOKEN
    
  # ntfy.sh (free, open source push notifications)
  - type: ntfy
    topic: my-secret-topic-name
    server: https://ntfy.sh  # or self-hosted
    
  # Generic webhook (POST JSON payload)
  - type: webhook
    url: https://example.com/mess-notify
    method: POST
    headers:
      Authorization: Bearer xxx
      
  # SMS via Twilio
  - type: sms
    phone: "+15551234567"
    # Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER secrets

# Optional preferences
preferences:
  # Minimum priority to receive notifications
  # Options: background, normal, elevated, urgent
  # Default: background (receive all)
  min_priority: normal
  
  # Quiet hours - no notifications during this window
  quiet_hours:
    enabled: true
    start: "22:00"
    end: "07:00"
    timezone: America/Los_Angeles
    
  # Only notify for requests with these capabilities
  # If empty/missing, notified for all requests matching your capabilities
  capability_filter: []
  
  # Auto-claim requests matching these intents (regex patterns)
  auto_claim_patterns: []
```

## Minimal Example

```yaml
executor_id: kitchen-tablet
display_name: "Kitchen Tablet"
capabilities:
  - check:visual
  - photo:capture
notifications:
  - type: ntfy
    topic: kitchen-mess-alerts
```

## How Routing Works

When a new request arrives:

1. **Parse request** - Extract required capabilities from intent/hints
2. **Find matching executors** - Filter by capabilities
3. **Apply preferences** - Check priority, quiet hours
4. **Send notifications** - Via each executor's configured channels

If no capabilities are specified in the request, ALL executors are notified.

## Notification Payload

All notification types receive this information:

```json
{
  "ref": "2026-01-31-001",
  "intent": "Check if the garage door is closed",
  "priority": "normal",
  "requestor": "claude-desktop",
  "created": "2026-01-31T21:00:00Z",
  "context": ["Getting ready for bed"],
  "wants_photo": true,
  "url": "https://github.com/user/mess-exchange/blob/main/exchange/state=received/2026-01-31-001.messe-af.yaml"
}
```

## Security Notes

- Executor files are readable by anyone with repo access
- Don't put sensitive tokens directly in executor files
- Use GitHub Secrets for API tokens (PUSHOVER_APP_TOKEN, TWILIO_*, etc.)
- Webhook URLs with auth should use secrets or be rotatable
