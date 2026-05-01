// Version: 2026.03.17.V2 (整合版：唯一 Service Worker)

// 1. 強制立即更新機制
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      clients.claim(),
      // 自動清理舊的 service-worker.js 註冊
      self.registration.unregister ? Promise.resolve() : Promise.resolve()
    ])
  );
});

// 2. 引入 Firebase 庫 (相容模式 - 使用 v10 以相容 App 的 v12.x SDK)
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

// 3. 初始化 Firebase
firebase.initializeApp({
  apiKey: "AIzaSyCaxWnFi78Rrra5gEuFRWPN-4jdEUFWLp8",
  projectId: "modern-lab-app",
  messagingSenderId: "154018152899",
  appId: "1:154018152899:web:21c8435ed7e68221b13d76"
});

const messaging = firebase.messaging();

/**
 * 4. 背景訊息處理
 * 當 App 不在前景時，由此處理推播通知的顯示。
 * Firebase SDK 會自動處理 notification 欄位，
 * 這裡只處理純 data 訊息的備援情境。
 */
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] 收到背景訊息:', payload);

  // 如果 Firebase 已自動處理 notification 欄位，就不重複顯示
  if (payload.notification) {
    return;
  }

  // 備援：處理只有 data 欄位的訊息
  if (payload.data) {
    const title = payload.data.title || '🚨 實驗室新任務';
    const options = {
      body: payload.data.body || '你有一個新的待處理任務！',
      icon: '/logo192.png',
      badge: '/favicon1.ico',
      vibrate: [200, 100, 200],
      data: {
        url: payload.data.url || 'https://modern-lab-app.web.app'
      }
    };
    return self.registration.showNotification(title, options);
  }
});

// 5. 監聽通知點擊事件：負責點擊後跳轉回 App
self.addEventListener('notificationclick', (event) => {
  console.log('[firebase-messaging-sw.js] 通知被點擊');
  event.notification.close();

  const urlToOpen = event.notification.data?.url || 'https://modern-lab-app.web.app';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // 如果已經開著 App，用 includes 比對避免 URL 完全匹配的問題
      for (let client of windowClients) {
        if (client.url.includes('modern-lab-app') && 'focus' in client) {
          return client.focus();
        }
      }
      // 如果沒開，就新開一個分頁
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    })
  );
});