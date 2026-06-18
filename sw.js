// Service Worker - Appnesthesia
// Estrategia:
//   - Navegaciones HTML (index.html): network-first → garantiza que cualquier
//     deploy nuevo se vea inmediatamente en la siguiente visita.
//   - Assets estáticos (iconos, JSON, PDF, CDN): stale-while-revalidate →
//     funciona offline, pero refresca en segundo plano.
//   - skipWaiting + clients.claim → reemplaza al SW anterior sin esperar
//     a que el usuario cierre todas las pestañas.

// ⚠️ SUBIR ESTE NÚMERO EN CADA DEPLOY (v72 → v73 → …). Es lo que hace que el
// navegador detecte un service worker nuevo y muestre el aviso "Nueva versión
// disponible". Si no cambia, la app NO se entera de que hay una actualización.
const CACHE = 'anestesia-v73';
const ASSETS = [
  './',
  './index.html',
  './privacy.html',
  './terms.html',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable.png',
  './logo.png',
  './logo.svg',
  './logo-aria.png',
  './configs/aria-conocimiento.json',
  './configs/index.json',
  './configs/andes.json',
  './protocolos/ERAS-Colon-y-Bariatrica.pdf',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  // Navegaciones HTML → network-first (siempre intenta versión fresca)
  if (
    e.request.mode === 'navigate' ||
    e.request.destination === 'document'
  ) {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          if (resp && resp.status === 200) {
            const copy = resp.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
          }
          return resp;
        })
        .catch(() =>
          caches.match(e.request).then(r => r || caches.match('./index.html'))
        )
    );
    return;
  }

  // Resto de assets → stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request).then(resp => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// Permite forzar refresco desde la app si se necesita
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

// ============================================================
// NOTIFICACIONES PUSH
// El envío es SIN payload (no viaja info de paciente). Mostramos un
// aviso genérico; el admin abre la app para ver el detalle.
// ============================================================
self.addEventListener('push', e => {
  let titulo = '📋 Appnesthesia';
  let cuerpo = 'Tienes una nueva solicitud por revisar. Toca para abrir.';
  // Si en el futuro se envía payload, se usa; si no, queda el genérico.
  try {
    if (e.data) {
      const d = e.data.json();
      if (d && d.title) titulo = d.title;
      if (d && d.body) cuerpo = d.body;
    }
  } catch (err) { /* sin payload → genérico */ }
  e.waitUntil(
    self.registration.showNotification(titulo, {
      body: cuerpo,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'agend-nueva',
      renotify: true,
      data: { url: './' }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cl => {
      for (const c of cl) {
        if ('focus' in c) { c.focus(); return; }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
