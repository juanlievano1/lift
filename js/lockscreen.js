// Descanso con el celular bloqueado: solo con notificaciones (no tocan la música).
// - Al bloquear o salir de la app: aviso silencioso con la hora a la que termina el descanso.
// - Al terminar: el servidor manda una notificación push (ver cloud.scheduleRestPush) o, sin push, el celular.

// ---------- Notificación al terminar el descanso ----------
export const canNotify = () => typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
export const notifyAllowed = () => canNotify() && Notification.permission === 'granted';
export async function askNotify() {
  if (!canNotify()) return false;
  try { return (await Notification.requestPermission()) === 'granted'; } catch { return false; }
}
// Aviso silencioso con la hora a la que termina el descanso: se muestra al bloquear el celular o
// salir de la app, así se ve en la pantalla de bloqueo sin tocar la música.
const ICON = { icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
export async function restInfo(title, body) {
  if (!notifyAllowed()) return;
  try { const reg = await navigator.serviceWorker.ready; await reg.showNotification(title, { body, tag: 'lift-descanso', silent: true, ...ICON }); } catch {}
}
// Al volver a la app, se quita el aviso del descanso (ya se ve en la barra).
export async function clearRestInfo() {
  try { const reg = await navigator.serviceWorker.ready; (await reg.getNotifications({ tag: 'lift-descanso' })).forEach((n) => n.close()); } catch {}
}

// Solo si la app no está en pantalla (con la app abierta ya suena y vibra).
export async function notify(title, body) {
  if (!notifyAllowed() || document.visibilityState === 'visible') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, { body, tag: 'lift-descanso', renotify: true, vibrate: [200, 100, 200], icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' });
  } catch {}
}
