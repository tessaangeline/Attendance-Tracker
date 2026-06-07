// sw.js — Service Worker
// Handles push notifications and the magic "mark from notification" action

const CACHE = 'attendance-v1';
const CACHED = ['/employee.html', '/style.css', '/manifest.json'];

// ── Install: cache key assets ─────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CACHED)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first, fall back to cache ──────────────────
self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('/api/')) return; // Never cache API
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// ── Push: show the attendance notification ────────────────────
self.addEventListener('push', (e) => {
  if (!e.data) return;

  let data;
  try { data = e.data.json(); }
  catch { return; }

  const todayLabel = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'short',
  });

  e.waitUntil(
    self.registration.showNotification(data.title || `Attendance — ${todayLabel}`, {
      body:             data.body || 'Tap a button to mark your attendance for today.',
      icon:             '/icon-192.png',
      badge:            '/icon-192.png',
      tag:              'attendance-daily',   // Only one per day (replaces previous)
      renotify:         false,
      requireInteraction: true,               // Stays until dismissed
      actions: [
        { action: 'present', title: '✅ Present' },
        { action: 'leave',   title: '🌴 On Leave' },
      ],
      data: {
        token:        data.token,
        date:         data.date,
        dashboardUrl: `/employee.html?token=${data.token}`,
      },
    })
  );
});

// ── Notification click ────────────────────────────────────────
self.addEventListener('notificationclick', (e) => {
  e.notification.close();

  const { token, date, dashboardUrl } = e.notification.data || {};

  if (e.action === 'present' || e.action === 'leave') {
    // ── Mark directly from notification (no app open needed) ──
    e.waitUntil(
      fetch('/api/mark', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, status: e.action, date }),
      })
        .then((r) => r.json())
        .then((result) => {
          const emoji     = e.action === 'present' ? '✅' : '🌴';
          const statusTxt = e.action === 'present' ? 'Present' : 'On Leave';
          const balance   = result.leavesRemaining ?? '–';
          const bodyMsg   = result.alreadyMarked
            ? `Already marked as ${result.status} today.`
            : `Leaves remaining this month: ${balance}/4`;

          return self.registration.showNotification(`${emoji} Marked ${statusTxt}`, {
            body:    bodyMsg,
            icon:    '/icon-192.png',
            tag:     'attendance-confirm',
            requireInteraction: false,
          });
        })
        .catch(() => {
          // Fallback: open the dashboard so they can mark manually
          return self.clients.openWindow(dashboardUrl || '/employee.html');
        })
    );
  } else {
    // Tapped notification body → open dashboard
    e.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
        for (const w of wins) {
          if (w.url.includes('/employee.html') && 'focus' in w) return w.focus();
        }
        return self.clients.openWindow(dashboardUrl || '/employee.html');
      })
    );
  }
});
