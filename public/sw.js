/* Vibe Craft service worker：静态工具外壳缓存，API 与 Next 路由永远走网络 */
'use strict';

const CACHE = 'vibe-craft-shell-v2';
const SHELL = [
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/shared/sync-client.js',
  '/shared/sync-widget.js',
  '/contextly/index.html',
  '/expressing/index.html',
  '/desktop-lite/index.html',
  '/adhd-text/index.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // 单个资源失败不阻断安装
      .then(cache => Promise.all(SHELL.map(p => cache.add(p).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // API、健康检查、Next 运行时（含 RSC 请求）不缓存
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz' || url.pathname.startsWith('/_next/')) return;
  if (url.searchParams.has('_rsc')) return;

  // 静态工具页：缓存优先，后台更新；其余导航交给网络
  const isToolShell = SHELL.includes(url.pathname);
  if (req.mode === 'navigate' && !isToolShell) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    }),
  );
});
