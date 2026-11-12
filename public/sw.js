// Growtopia Web Service Worker (PWA Compliance & Fast App Shell)
const CACHE_NAME = 'growtopia-shell-v9';

const STATIC_RESOURCES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/branding/favicon.png',
  '/branding/logo.png',
  '/branding/icon-192.png',
  '/branding/icon-512.png',
  '/branding/icon-maskable.png',
  '/branding/CenturyGothicBold.ttf'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_RESOURCES).catch((err) => {
        console.warn('[SW] Pre-caching warning:', err);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) {
            return caches.delete(k);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Large binary files & WebSockets MUST bypass ServiceWorker to avoid mobile RAM exhaustion
  if (
    url.pathname.endsWith('client.data') ||
    url.pathname.endsWith('.wasm') ||
    url.hostname.includes('huggingface.co') ||
    url.hostname.includes('hf.co') ||
    url.pathname.startsWith('/enet') ||
    url.pathname.startsWith('/growtopia/server_data.php') ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  // Network-first with cache fallback for shell assets
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache).catch(() => {});
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
