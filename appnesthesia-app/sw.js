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
const CACHE = 'anestesia-v129';
const ASSETS = [
  './',
  './index.html',
  './privacy.html',
  './terms.html',
  './app.js',
  './horario-xlsx.js',
  './vendor/fflate.min.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable.png',
  './logo.png',
  './logo-aria.png',
  './configs/aria-conocimiento.json',
  './configs/protocolos.json',
  './configs/index.json',
  './configs/andes.json',
  './protocolos/ERAS-Colon-y-Bariatrica.pdf',
  './protocolos/Protocolo-Ayuno-2026.pdf',
  './protocolos/Guia-Suspension-Farmacos-2026.pdf',
  './protocolos/PROCORT-Cirugia-Ortognatica.pdf',
  './protocolos/Norma-Antibioprofilaxis-Quirurgica.pdf',
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

  // El código principal (app.js) y el HTML van SIEMPRE network-first: así un
  // deploy nuevo se ve en la siguiente visita y nunca queda código viejo
  // pegado en caché. (La caché solo se usa como respaldo offline.)
  let _isAppScript = false;
  let _isConfigJson = false;
  try {
    const p = new URL(e.request.url).pathname.replace(/\/+$/,'');
    _isAppScript = p.endsWith('/app.js');
    // Los configs (roster, backend, token) también van network-first: si no,
    // un cambio de configuración tarda una visita extra en llegar.
    _isConfigJson = p.indexOf('/configs/') !== -1 && p.endsWith('.json');
  } catch (err) {}

  // Navegaciones HTML + app.js + configs → network-first (siempre intenta versión fresca)
  if (
    e.request.mode === 'navigate' ||
    e.request.destination === 'document' ||
    _isAppScript ||
    _isConfigJson
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
  let targetUrl = './';
  // El payload (cifrado por el worker de push) trae {title, body, url}. Si no
  // hay payload (suscripción antigua), queda el aviso genérico al inicio.
  try {
    if (e.data) {
      const d = e.data.json();
      if (d && d.title) titulo = d.title;
      if (d && d.body) cuerpo = d.body;
      if (d && d.url) targetUrl = d.url;
    }
  } catch (err) { /* sin payload → genérico */ }
  // tag basado en la URL: así solicitudes distintas se muestran por separado
  // (no se reemplazan entre sí) y cada una abre su propio detalle.
  const tag = 'appx:' + targetUrl;
  e.waitUntil(
    self.registration.showNotification(titulo, {
      body: cuerpo,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: tag,
      renotify: true,
      data: { url: targetUrl }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil((async () => {
    const cl = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of cl) {
      if ('focus' in c) {
        try { await c.focus(); } catch (_) {}
        // La ventana ya está cargada: no cambia de URL, así que le avisamos por
        // mensaje para que navegue al detalle exacto dentro de la app.
        try { c.postMessage({ type: 'appx-open', url: target }); } catch (_) {}
        return;
      }
    }
    // No hay ventana abierta → abrir una nueva con la URL (la app la lee al cargar).
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
