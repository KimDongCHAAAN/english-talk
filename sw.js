// Offline support (spec §9.1): network first so updates arrive, cache fallback for the subway.
const CACHE = 'et-v1';
const SHELL = [
  './', 'index.html', 'app.css', 'app.js', 'config.js', 'manifest.webmanifest', 'icon-180.png',
  'lib/content.js', 'lib/merge.js', 'lib/speech.js', 'lib/srs.js', 'lib/store.js', 'lib/sync.js', 'lib/text.js',
  'content/index.json', 'content/videos.json', 'content/npcs.json',
  'privacy.html', 'terms.html',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // Google APIs and YouTube go straight to the network
  ev.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await Promise.race([
          fetch(req),
          new Promise((_, reject) => setTimeout(() => reject(new Error('slow network')), 4000)),
        ]);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === 'navigate') return cache.match('index.html');
        throw new Error('offline and not cached');
      }
    })(),
  );
});
