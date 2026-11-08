// Utilidades de interfaz compartidas por todas las pantallas.
import { SUPABASE_URL } from './config.js';

export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
export const n1 = (n) => (Math.round(n * 10) / 10).toLocaleString('es');
export const clone = (o) => JSON.parse(JSON.stringify(o));
export const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';

export function timeAgo(isoDateTime) {
  const s = Math.max(0, (Date.now() - new Date(isoDateTime).getTime()) / 1000);
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `hace ${Math.floor(s / 86400)} d`;
  return new Date(isoDateTime).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

export function toast(msg) {
  const t = $('#toast');
  t.setAttribute('role', 'status');
  t.hidden = false;
  t.textContent = msg;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 2800);
}

let lastFocus = null;
export function openModal(html, closable = true) {
  const m = $('#modal');
  if (m.hidden) lastFocus = document.activeElement;
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${closable ? '<button class="icon close" data-act="closeModal" aria-label="Cerrar">✕</button>' : ''}${html}</div>`;
  m.hidden = false;
  m.dataset.closable = closable ? '1' : '';
  document.body.classList.add('noscroll');
  // El foco entra al diálogo (para lectores de pantalla y teclado).
  const sheet = m.querySelector('.sheet');
  const h = sheet.querySelector('h2, h3');
  if (h) { h.tabIndex = -1; sheet.setAttribute('aria-labelledby', h.id || (h.id = 'modal-title')); }
  setTimeout(() => (sheet.querySelector('input, textarea, select') || h || sheet).focus?.({ preventScroll: true }), 30);
}

export function closeModal() {
  $('#modal').hidden = true;
  $('#modal').innerHTML = '';
  document.body.classList.remove('noscroll');
  try { lastFocus?.focus?.({ preventScroll: true }); } catch {}
  lastFocus = null;
}
// Escape cierra el diálogo (si se puede cerrar).
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden && $('#modal').dataset.closable) closeModal(); });

export const modalOpen = () => !$('#modal').hidden;

// Registros que cada módulo amplía: acciones (data-act) y rutas (#hash).
export const actions = {};
export const routes = {};

let renderer = () => {};
export const setRenderer = (fn) => (renderer = fn);
export const rerender = () => renderer();
export const go = (r) => { if (location.hash === '#' + r) renderer(); else location.hash = r; };

// Círculo con la foto de la persona; si no tiene (o no carga), sus iniciales.
const AVATAR_BASE = `${SUPABASE_URL}/storage/v1/object/public/avatars/`;
export function avatarSrc(pic) {
  if (typeof pic !== 'string') return null;
  if (/^[0-9a-f-]{36}\/[0-9]{10,16}\.jpg$/.test(pic)) return AVATAR_BASE + pic;
  if (/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(pic)) return pic; // versión de prueba
  return null;
}
export const avatar = (name, size = '', pic = null) => {
  const src = avatarSrc(pic);
  return `<span class="avatar ${size}${src ? ' pic' : ''}" aria-hidden="true">${esc(initials(name))}${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">` : ''}</span>`;
};
// Si una foto no carga, se quita y quedan las iniciales.
if (typeof document !== 'undefined') document.addEventListener('error', (e) => { const t = e.target; if (t instanceof HTMLImageElement && t.parentElement?.classList.contains('avatar')) { t.parentElement.classList.remove('pic'); t.remove(); } }, true);
// Recorta al centro en cuadrado y reduce la foto (JPEG pequeño) antes de subirla.
export async function squarePhoto(file, size = 256) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { throw new Error('No pudimos abrir esa foto. Prueba con otra.'); }
    const w = img.naturalWidth, h = img.naturalHeight, s = Math.min(w, h);
    if (!s) throw new Error('No pudimos abrir esa foto. Prueba con otra.');
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, size, size);
    return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('No pudimos procesar la foto.'))), 'image/jpeg', 0.85));
  } finally { URL.revokeObjectURL(url); }
}
