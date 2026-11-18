/* TV Dashboard - Service Worker: cache foto Supabase Storage (FOTO SALES & PS)
   Tujuan: menghemat Cached Egress & Log Ingestion Supabase. Hanya menyentuh foto; data/API/audio TIDAK diintersep.
   Ubah CACHE_VERSION bila ingin memaksa semua TV mengunduh ulang foto. */
var CACHE_VERSION = 'v1';
var CACHE_NAME = 'tv-foto-' + CACHE_VERSION;
var TTL_OK_MS = 24 * 60 * 60 * 1000;   // foto ada  : dipakai dari cache 24 jam
var TTL_MISS_MS = 6 * 60 * 60 * 1000;  // foto 404  : tidak ditanyakan ulang selama 6 jam (hemat request)

function isFoto(u) {
  try {
    var url = new URL(u);
    if (url.hostname.indexOf('.supabase.co') === -1) return false;
    var p = decodeURIComponent(url.pathname);
    return p.indexOf('/storage/v1/object/public/FOTO SALES/') === 0 ||
           p.indexOf('/storage/v1/object/public/PS/') === 0;
  } catch (e) { return false; }
}

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('tv-foto-') === 0 && k !== CACHE_NAME; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});
self.addEventListener('message', function (e) {
  if (e.data === 'purge') e.waitUntil(caches.delete(CACHE_NAME));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || !isFoto(req.url)) return;
  e.respondWith(handle(req));
});

async function handle(req) {
  var cache = await caches.open(CACHE_NAME);
  var hit = await cache.match(req.url);
  var now = Date.now();
  if (hit) {
    var at = Number(hit.headers.get('x-sw-at')) || 0;
    var ttl = hit.status === 200 ? TTL_OK_MS : TTL_MISS_MS;
    if (now - at < ttl) return hit;
  }
  try {
    var res = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
    if (res.status === 200 || res.status === 404) {
      var headers = new Headers(res.headers);
      headers.set('x-sw-at', String(now));
      var stamped = new Response(await res.clone().blob(), { status: res.status, statusText: res.statusText, headers: headers });
      await cache.put(req.url, stamped.clone());
      return stamped;
    }
    return hit || res;
  } catch (err) {
    if (hit) return hit;               // offline: pakai cache lama
    try { return await fetch(req); }   // cadangan: request biasa
    catch (e2) { return Response.error(); }
  }
}
