/* 紙飛行機ラボ：通信がなくても開けるようにする仕組み（サービスワーカー）
   - ページ（index.html）は、まず通信で新しい版を取りにいき、つながらないときだけ保存しておいた版を出す
   - 計算（core.js?v=番号）・three.js・フォント・アイコンは、保存しておいた版を先に使う（番号が変われば別のものとして取り直す）
   - ページを開いたときに、そのページが読みこんだものの一覧を受け取って保存する */
const CACHE = 'kamihikoki-v1';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const okToKeep = r => r && (r.ok || r.type === 'opaque');
async function keep(url) {
  const c = await caches.open(CACHE);
  if (await c.match(url)) return;
  const same = new URL(url).origin === location.origin;
  try { const r = await fetch(url, { mode: same ? 'same-origin' : 'cors', credentials: 'omit' }); if (okToKeep(r)) await c.put(url, r); } catch (e) {}
}
self.addEventListener('message', e => {
  const d = e.data || {};
  if (Array.isArray(d.keep)) e.waitUntil(Promise.all(d.keep.filter(u => /^https?:/.test(u)).map(keep)));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') {                       // ページ：通信を先に。だめなら保存した版
    e.respondWith((async () => {
      try { const r = await fetch(req); if (r.ok) { const c = await caches.open(CACHE); c.put('./', r.clone()); } return r; }
      catch (err) { return (await caches.match('./')) || (await caches.match(req)) || Response.error(); }
    })());
    return;
  }
  const mine = url.origin === location.origin, cdn = /(^|\.)(cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname);
  if (!mine && !cdn) return;
  e.respondWith((async () => {                         // そのほか：保存した版を先に。なければ取りにいって保存
    const hit = await caches.match(req); if (hit) return hit;
    const r = await fetch(req);
    if (okToKeep(r)) { const c = await caches.open(CACHE); c.put(req, r.clone()); }
    return r;
  })());
});
