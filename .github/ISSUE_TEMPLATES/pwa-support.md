# Add Progressive Web App (PWA) support for mobile executors

## Summary

Enable git-messe-af client to be installed as a Progressive Web App (PWA) on mobile devices, allowing executors to receive and respond to requests on the go with a native app-like experience.

## Current State

The client (`client/index.html`) already has:
- ✅ Responsive, touch-friendly UI
- ✅ Camera capture via native file input
- ✅ Dark mode support
- ✅ Mobile viewport configuration
- ✅ localStorage for configuration persistence

However, it lacks true PWA capabilities:
- ❌ No Service Worker (`sw.js`) for offline functionality
- ❌ No Web App Manifest (`manifest.json`)
- ❌ No install-to-homescreen support
- ❌ No background sync for queued responses
- ❌ No push notification integration

## Proposed Implementation

### 1. Web App Manifest
Create `client/manifest.json`:
```json
{
  "name": "MESS Exchange",
  "short_name": "MESS",
  "description": "AI-to-human task dispatch system",
  "start_url": "/client/",
  "display": "standalone",
  "background_color": "#1e1e1e",
  "theme_color": "#3b82f6",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### 2. Service Worker
Create `client/sw.js` to:
- Cache the single-page HTML app for offline use
- Queue responses when offline and sync when reconnected
- Handle background fetch for thread updates

### 3. Push Notifications (optional enhancement)
- Integrate with existing notification infrastructure (ntfy.sh, Pushover, etc.)
- Allow web push as an additional notification channel
- Service worker handles incoming push events

## Benefits

- **Instant access**: Tap app icon instead of opening browser and navigating
- **Offline capability**: View cached threads and queue responses without network
- **Better notifications**: Native push notifications on mobile
- **Full-screen experience**: No browser chrome, feels like native app

## Related Files

- `client/index.html` - Add manifest link and SW registration
- New: `client/manifest.json`
- New: `client/sw.js`
- New: `client/icon-*.png` (app icons)
