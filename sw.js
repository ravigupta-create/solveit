// SolveIt Service Worker — PWA offline caching
const CACHE_NAME = 'solveit-v1';
const APP_SHELL = [
    './',
    'index.html',
    'style.css',
    'app.js',
    'lib/purify.min.js',
    'lib/marked.min.js',
    'lib/highlight.min.js',
    'lib/pdf.min.js',
    'lib/pdf.worker.min.js',
    'lib/Readability.min.js',
    'lib/atom-one-dark.min.css',
    'manifest.json',
];

// Install: cache app shell
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
    );
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: cache-first for app shell, network-first for API calls
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Don't cache API calls or CORS proxy requests
    if (url.hostname.includes('googleapis.com') ||
        url.hostname.includes('corsproxy.io') ||
        url.hostname.includes('allorigins.win') ||
        url.hostname.includes('workers.dev')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((response) => {
                // Cache successful same-origin responses
                if (response.ok && url.origin === self.location.origin) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => {
                // Offline fallback
                if (event.request.mode === 'navigate') {
                    return caches.match('index.html');
                }
            });
        })
    );
});
