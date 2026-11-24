const PREFIX = 'piano-v1-';
const CACHE = PREFIX + '__BUILD_HASH__';
const url = path => new URL(path, self.registration.scope).href;
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetch(url('precache.json'), { cache: 'no-store' });
    if (!response.ok) throw new Error('Cache manifest unavailable');
    const manifest = await response.text();
    const cache = await caches.open(CACHE);
    const requests = [...new Set(['index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'palm.svg', 'capture-worklet.js', 'rhythm-worklet.js', 'model/model.json', 'model/group1-shard1of1.bin', 'wasm/tfjs-backend-wasm.wasm', 'wasm/tfjs-backend-wasm-simd.wasm', 'wasm/tfjs-backend-wasm-threaded-simd.wasm', ...JSON.parse(manifest)].map(url))].map(path => new Request(path, { cache: 'reload' }));
    await cache.addAll(requests);
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = (await caches.keys()).filter(key => key.startsWith(PREFIX));
    // Retain the previous shell for tabs still using old, hashed lazy chunks.
    await Promise.all(keys.slice(0, -2).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => { if (event.data === 'ACTIVATE') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const target = event.request.mode === 'navigate' ? url('index.html') : event.request;
    // These are public same-origin static assets. Module/style requests may
    // carry a different Origin header than precache fetches (Vary: Origin).
    const own = await (await caches.open(CACHE)).match(target, { ignoreVary: true });
    if (own) return own;
    if (event.request.mode !== 'navigate') {
      const keys = (await caches.keys()).filter(key => key.startsWith(PREFIX) && key !== CACHE).reverse();
      for (const key of keys) { const result = await (await caches.open(key)).match(target, { ignoreVary: true }); if (result) return result; }
    }
    return fetch(event.request);
  })());
});
