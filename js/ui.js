// Utilidades de interfaz compartidas por todas las pantallas.

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

export const avatar = (name, size = '') => `<span class="avatar ${size}" aria-hidden="true">${esc(initials(name))}</span>`;
