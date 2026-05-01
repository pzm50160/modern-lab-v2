// 負責在所有環境中註冊唯一的 Service Worker: firebase-messaging-sw.js
const isLocalhost = Boolean(
  window.location.hostname === 'localhost' ||
    window.location.hostname === '[::1]' ||
    window.location.hostname.match(/^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/)
);

export function register(config) {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      // 先清理可能殘留的舊 service-worker.js
      cleanupOldServiceWorkers();

      const swUrl = '/firebase-messaging-sw.js';

      if (isLocalhost) {
        checkValidServiceWorker(swUrl, config);
      } else {
        registerValidSW(swUrl, config);
      }
    });
  }
}

/**
 * 清理舊版 service-worker.js 的註冊
 * 使用者的瀏覽器中可能殘留之前註冊的 service-worker.js，
 * 這裡會自動偵測並移除它。
 */
async function cleanupOldServiceWorkers() {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const reg of registrations) {
      // 如果這個 SW 不是我們要的 firebase-messaging-sw.js，就移除
      if (reg.active && reg.active.scriptURL && !reg.active.scriptURL.includes('firebase-messaging-sw.js')) {
        console.log('清理舊的 Service Worker:', reg.active.scriptURL);
        await reg.unregister();
      }
    }
  } catch (error) {
    console.error('清理舊 SW 失敗:', error);
  }
}

function registerValidSW(swUrl, config) {
  navigator.serviceWorker
    .register(swUrl)
    .then((registration) => {
      // 每次都檢查更新
      registration.update();

      registration.onupdatefound = () => {
        const installingWorker = registration.installing;
        if (installingWorker == null) return;
        installingWorker.onstatechange = () => {
          if (installingWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              console.log('新版 Service Worker 已就緒，頁面將自動重新整理。');
              window.location.reload();
            } else {
              console.log('Service Worker 已快取供離線使用。');
            }
          }
        };
      };
    })
    .catch((error) => {
      console.error('Service Worker 註冊失敗:', error);
    });
}

function checkValidServiceWorker(swUrl, config) {
  fetch(swUrl, { headers: { 'Service-Worker': 'script' } })
    .then((response) => {
      const contentType = response.headers.get('content-type');
      if (response.status === 404 || (contentType != null && contentType.indexOf('javascript') === -1)) {
        navigator.serviceWorker.ready.then((registration) => {
          registration.unregister().then(() => {
            window.location.reload();
          });
        });
      } else {
        registerValidSW(swUrl, config);
      }
    })
    .catch(() => {
      console.log('無網路連線，App 正以離線模式執行。');
    });
}

export function unregister() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => {
        registration.unregister();
      })
      .catch((error) => {
        console.error(error.message);
      });
  }
}