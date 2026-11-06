// Entreno en la pantalla de bloqueo.
// Una web app no puede crear su propio widget en la pantalla de bloqueo (eso es de apps nativas), pero sí puede
// usar el panel de "reproduciendo ahora" del celular, el mismo de la música: mientras entrenas, ahí se ve
// "Descanso 1:30 · Press de banca" con una barra que avanza. Para que el panel aparezca, la app reproduce un
// audio en silencio. Al terminar el descanso, si diste permiso, llega una notificación.
// Funciona mejor en Android (Chrome). En iPhone depende de la versión de iOS y de si la app está instalada.

export const supported = typeof navigator !== 'undefined' && 'mediaSession' in navigator && typeof MediaMetadata !== 'undefined';

let audio = null;
let on = false;
let handlers = {};

// Audio WAV en silencio (10 s, en bucle): basta para que el sistema muestre los controles.
function silentWav(seconds = 10) {
  const rate = 8000, n = rate * seconds;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const tag = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

const artwork = () => [
  { src: new URL('icons/icon-192.png', location.href).href, sizes: '192x192', type: 'image/png' },
  { src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' },
];

// Hay que llamarla desde un toque del usuario (los navegadores solo dejan reproducir audio así).
// actions: { skip, add30 } — lo que hacen los botones del panel.
export function start(actions = {}) {
  if (!supported) return;
  handlers = actions;
  if (!audio) { audio = new Audio(silentWav()); audio.loop = true; audio.setAttribute('playsinline', ''); }
  audio.play().catch(() => {});
  on = true;
  const ms = navigator.mediaSession;
  const set = (name, fn) => { try { ms.setActionHandler(name, fn); } catch { /* acción no soportada */ } };
  set('nexttrack', () => handlers.skip?.());
  set('seekforward', () => handlers.add30?.());
  set('play', () => audio?.play().catch(() => {}));
  set('pause', () => stop());
}

// title/artist/album: lo que se lee en el panel. duration/position (s): la barra de progreso.
export function show({ title, artist = 'Lift', album = '', duration = 0, position = 0 }) {
  if (!supported || !on) return;
  const ms = navigator.mediaSession;
  try { ms.metadata = new MediaMetadata({ title, artist, album, artwork: artwork() }); } catch {}
  try { if (duration > 0) ms.setPositionState({ duration, position: Math.max(0, Math.min(position, duration)), playbackRate: 1 }); } catch {}
  ms.playbackState = 'playing';
}

export function stop() {
  if (!supported) return;
  on = false;
  audio?.pause();
  try { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; } catch {}
}

export const active = () => on;

// ---------- Notificación al terminar el descanso ----------
export const canNotify = () => typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
export const notifyAllowed = () => canNotify() && Notification.permission === 'granted';
export async function askNotify() {
  if (!canNotify()) return false;
  try { return (await Notification.requestPermission()) === 'granted'; } catch { return false; }
}
// Solo si la app no está en pantalla (con la app abierta ya suena y vibra).
export async function notify(title, body) {
  if (!notifyAllowed() || document.visibilityState === 'visible') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, { body, tag: 'lift-descanso', renotify: true, vibrate: [200, 100, 200], icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' });
  } catch {}
}
