# MESS Web Client

## Overview

The MESS Web Client is a static HTML/JavaScript application for human executors to view and respond to requests. It works with GitHub as the backend and requires no server.

## Features

- View incoming requests (Inbox)
- Claim and respond to requests
- Take photos directly from mobile devices
- Create new requests (optional)
- Dark/light theme support
- Works offline once configured

## Setup

### 1. Host the Client

The client is a single HTML file. Host it anywhere:

- **GitHub Pages**: Automatic if using the template repo
- **Cloudflare Pages**: Upload `client/` folder
- **Netlify/Vercel**: Drag and drop
- **Local file**: Just open `client/index.html`

### 2. Create GitHub Token

1. Go to [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
2. Select "Only select repositories" → your MESS repo
3. Permissions: Contents → Read and write
4. Generate and copy the token

### 3. Configure on First Launch

The setup wizard walks you through:

1. **Token** - Paste your GitHub token
2. **Repository** - Enter `username/mess-exchange`
3. **Profile** - Set executor ID, display name, capabilities

## Interface

### Tabs

| Tab | Contents |
|-----|----------|
| **Inbox** | Pending requests waiting to be claimed |
| **Active** | Requests you've claimed and are working on |
| **Done** | Completed requests |
| **Closed** | Failed, declined, or cancelled requests |

### Thread List

Each thread shows:
- Status badge (pending, claimed, etc.)
- Intent (what's being requested)
- Reference number and time
- Priority indicator (if elevated/urgent)
- Camera icon (if photo requested)

### Thread Detail

Click a thread to see:
- Full message history
- Response form (if claimed)
- Action buttons (Claim, Complete, Need Info, Can't Do)

## Actions

### Claiming a Request

**Quick claim**: Click the arrow button on any pending request

**From detail view**:
1. Click the thread to open detail
2. Click "Claim This Request"

### Completing a Request

1. Open a claimed thread
2. (Optional) Add text response
3. (Optional) Take/attach photo
4. Click "✓ Complete"

### Taking Photos

1. Click the camera button (📷)
2. Take photo or select from gallery
3. Preview appears below
4. Photo is included when you complete

### Need More Info

If you need clarification:
1. Click "More" to expand options
2. Click "Need Info"
3. Wait for requestor to respond

### Can't Complete

If you can't do the task:
1. Click "More" to expand options
2. Click "Can't Do"
3. Thread moves to Closed

## Creating Requests

If "Can Create Requests" is enabled in your profile:

1. Click "+ New" button
2. Fill in:
   - **What do you need?** - The request intent
   - **Context** - Additional details (one per line)
   - **Priority** - How urgent
   - **Want photo** - Check if you want an image response
3. Click "Submit Request"

## Settings

Click the gear icon (⚙️) to access:

- View current configuration
- Test GitHub connection
- Reset settings (clears all data)

## Capabilities

Configure what tasks you can handle:

**Physical Tasks**
- `visual:check` - Look at something
- `physical:inspect` - Touch/measure
- `fetch:indoor` - Get items inside
- `fetch:outdoor` - Get items outside
- `appliance:operate` - Use appliances
- `vehicle:operate` - Drive/move vehicles

**Communication**
- `comm:phone` - Make phone calls
- `comm:text` - Send texts
- `comm:person` - Talk to people

**Information**
- `photo:capture` - Take photos
- `document:read` - Read documents
- `research:local` - Local research

**Care**
- `care:plants` - Plant care
- `care:pets` - Pet care
- `care:children` - Child supervision

## URL Parameters

Configure the client via URL for easy sharing:

```
https://your-client.com/?repo=username/mess-exchange
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1-4` | Switch tabs |
| `Escape` | Close detail view |
| `r` | Refresh |

## Troubleshooting

### "No threads here"
- Check your GitHub token has correct permissions
- Verify repository name is correct
- Try refreshing

### "Action failed: sha wasn't supplied"
- Thread was modified elsewhere
- Refresh and try again

### Photos not working
- Allow camera permissions in browser
- On iOS, use Safari for best camera support

### Token expired
- Create a new token
- Go to Settings → Reset → Re-enter new token

## Data Storage

All configuration is stored in browser localStorage:
- `mess_config` - Token, repo, profile settings

No data is sent to any server except GitHub's API.

## Privacy

- Your token is stored only in your browser
- Tasks are stored in your private GitHub repo
- The client code contains no tracking
- Photos are stored as base64 in the thread files
