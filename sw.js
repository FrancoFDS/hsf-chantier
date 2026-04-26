// Planify Service Worker — Push notifications
const CACHE = 'planify-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

// Cache the app shell on fetch
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('supabase.co')) return; // never cache API
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// Handle push events (for future VAPID integration)
self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'Planify — HSF Marceau', {
      body: data.body || 'Nouvelle notification',
      icon: '/hsf-chantier/icon-192.png',
      badge: '/hsf-chantier/icon-72.png',
      tag: data.task_id || 'planify',
      data: { url: '/hsf-chantier/', task_id: data.task_id },
    })
  );
});

// Click on notification → open the app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({type:'window'}).then(cs => {
      const c = cs.find(c => c.url.includes('hsf-chantier'));
      if (c) return c.focus();
      return clients.openWindow('/hsf-chantier/');
    })
  );
});
