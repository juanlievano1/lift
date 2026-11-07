// Service worker: deja la app disponible sin internet.
// Sube VERSION cada vez que cambies archivos para que el celular descargue la versión nueva.
const VERSION = 'lift-v27';
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/app.js', './js/db.js', './js/util.js', './js/science.js', './js/program.js', './js/charts.js',
  './js/ui.js', './js/domain.js', './js/config.js', './js/cloud.js', './js/auth.js', './js/social.js', './js/coachui.js', './js/mock.js', './js/routine.js', './js/lockscreen.js', './js/sync.js', './privacidad.html',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
];

// Librerías del CDN (la de cuentas, Supabase) y tipografías: caché aparte que NO se borra al actualizar.
// Si se borrara, abrir la app sin señal después de una actualización dejaría la pantalla de inicio de sesión.
const CDN = 'lift-cdn-1';
const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';

self.addEventListener('install', (e) => {
  // cache: 'reload' evita copiar archivos viejos de la caché del navegador (versiones mezcladas).
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => caches.open(CDN).then((c) => c.match(SDK).then((hit) => hit || c.add(SDK))).catch(() => {}))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== CDN).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname === 'api.anthropic.com') return; // la IA siempre va por red
  // Archivos de la app: red primero (para recibir cambios), caché si no hay conexión.
  if (url.origin === location.origin) {
    e.respondWith(
      // no-cache: siempre se pregunta al servidor (respuesta 304 barata) para no mezclar versiones.
      fetch(e.request.mode === 'navigate' ? e.request : new Request(e.request, { cache: 'no-cache' }))
        .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); } return res; })
        .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
    );
    return;
  }
  // Librerías del CDN y tipografías: caché primero (versiones fijas).
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => { if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CDN).then((c) => c.put(e.request, copy)); } return res; })));
  }
});

// Tocar la notificación de fin de descanso vuelve a la app.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const c = list.find((x) => 'focus' in x);
    return c ? c.focus() : self.clients.openWindow('./#entreno');
  }));
});
