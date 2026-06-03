// Service Worker - Appnesthesia
// Estrategia:
//   - Navegaciones HTML (index.html): network-first → garantiza que cualquier
//     deploy nuevo se vea inmediatamente en la siguiente visita.
//   - Assets estáticos (iconos, JSON, PDF, CDN): stale-while-revalidate →
//     funciona offline, pero refresca en segundo plano.
//   - skipWaiting + clients.claim → reemplaza al SW anterior sin esperar
//     a que el usuario cierre todas las pestañas.

const CACHE = 'anestesia-v37';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable.png',
  './logo.png',
  './logo.svg',
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
