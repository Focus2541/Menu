// แปลเมนู service worker — เปิดแอปได้แม้ไม่มีเน็ต (การแปลยังต้องใช้เน็ต)
// ไม่ต้องแก้ไฟล์นี้เวลาอัปเดต ให้เปลี่ยนเลขใน version.js แทน
importScripts('version.js');
const CACHE = 'menu-v' + self.APP_VERSION;
const CORE = ['./', './index.html', './version.js', './manifest.json', './icon.svg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, {cache:'reload'})))));
});
self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    // ลบเฉพาะแคชเก่าของแอปนี้ ไม่แตะแคชของแอปอื่นบน focus2541.github.io
    .then(keys => Promise.all(keys.filter(k => k.startsWith('menu-v') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (/er-api\.com|script\.google(usercontent)?\.com/.test(url.hostname)) return;
  if (url.origin === location.origin && !/\/menu\//i.test(url.pathname)) return; // แอปอื่นบนโดเมนเดียวกัน
  if (req.mode === 'navigate') {
    e.respondWith(caches.open(CACHE).then(c => c.match('./index.html')).then(hit => hit || fetch(req)).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.open(CACHE).then(c => c.match(req).then(hit => {
    if (hit) return hit;
    return fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; });
  })).catch(() => caches.match(req)));
});
