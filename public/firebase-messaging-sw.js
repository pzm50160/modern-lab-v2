// Version: 2026.05.14.V4
// 不使用 Firebase Messaging SDK，直接攔截 push event 以完整控制通知內容

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(clients.claim()); });

function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, '')       // HTML 標籤（如 <font color="...">）
    .replace(/- \[[ x]\] /gi, '')  // Markdown checkbox - [ ] / - [x]
    .replace(/^[-*]\s+/gm, '')     // 列表符號 - 或 *
    .replace(/#{1,6}\s+/g, '')     // 標題 #
    .replace(/\*\*?|__?/g, '')     // 粗體/斜體
    .replace(/\n{2,}/g, '\n')       // 多個換行合為一個
    .trim();
}

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  // FCM payload: { notification: { title, body }, data: { ... } }
  const n = payload.notification || {};
  const d = payload.data || {};

  const title = n.title || d.title || '🚨 實驗室新任務';
  const body = cleanText(n.body || d.body || '');

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [200, 100, 200],
      data: { url: d.url || 'https://modern-lab-app-v2.web.app' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || 'https://modern-lab-app-v2.web.app';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes('modern-lab-app') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    })
  );
});
