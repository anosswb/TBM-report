/* Offline copy of the app. Network first, so updates arrive as soon as there is signal;
   status.json (the on/off switch) is never cached here. */
var CACHE = 'tbm-report-v5';
var FILES = ['./', 'index.html', 'styles.css', 'app.js', 'portal.js', 'fill.js', 'template.js', 'jszip.min.js',
  'manifest.webmanifest', 'icons/logo.png', 'icons/favicon.png', 'icons/icon-192.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (/status\.json$/.test(url.pathname)) return;           // always live
  e.respondWith(fetch(req).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (r) { return r || caches.match('index.html'); });
  }));
});
