// MESS Exchange Service Worker
const CACHE_NAME = 'mess-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  'https://unpkg.com/js-yaml@4.1.0/dist/js-yaml.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap'
];

// Install: cache core assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching app shell');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: network-first for API, cache-first for assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // GitHub API requests: network only (don't cache)
  if (url.hostname === 'api.github.com') {
    event.respondWith(fetch(event.request));
    return;
  }

  // For app assets: try cache first, then network
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          // Return cached version, but also update cache in background
          event.waitUntil(
            fetch(event.request)
              .then((response) => {
                if (response.ok) {
                  caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, response);
                  });
                }
              })
              .catch(() => {/* ignore network errors */})
          );
          return cachedResponse;
        }

        // Not in cache, fetch from network
        return fetch(event.request)
          .then((response) => {
            // Cache successful responses
            if (response.ok && event.request.method === 'GET') {
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseClone);
              });
            }
            return response;
          });
      })
  );
});

// Handle background sync for queued responses
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-responses') {
    console.log('[SW] Background sync: syncing queued responses');
    event.waitUntil(syncQueuedResponses());
  }
});

// Sync queued responses from IndexedDB
async function syncQueuedResponses() {
  // This would integrate with IndexedDB to sync any responses
  // that were queued while offline
  // For now, just notify the client to refresh
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_COMPLETE' });
  });
}

// Handle push notifications (for future integration)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body || 'New request available',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: data.ref || 'mess-notification',
    data: {
      url: data.url || './',
      ref: data.ref
    },
    actions: [
      { action: 'view', title: 'View' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'MESS', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const urlToOpen = event.notification.data?.url || './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus existing window if available
        for (const client of clientList) {
          if (client.url.includes('index.html') && 'focus' in client) {
            client.postMessage({
              type: 'NOTIFICATION_CLICK',
              ref: event.notification.data?.ref
            });
            return client.focus();
          }
        }
        // Open new window
        return self.clients.openWindow(urlToOpen);
      })
  );
});
