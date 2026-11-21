/* 紙飛行機ラボ：ブラウザ版は公開を終えた。
   前に開いた人の端末に残っている保存（ゲーム本体）を消し、この仕組み自体も外して、開いているページを読み直す */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url).catch(() => {});
  })());
});
