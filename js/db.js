// Estado de la app guardado en el dispositivo (localStorage) y sincronizado con la nube
// cuando hay sesión iniciada. La app funciona sin conexión; la nube guarda una copia.

const KEY = 'forja.v1';

const empty = () => ({
  version: 2,
  owner: null,            // id del usuario de la nube dueño de estos datos (null = solo local)
  updatedAt: 0,           // ms de la última modificación (para resolver conflictos)
  profile: null,          // perfil de entrenamiento (objetivo, nivel, días...)
  plans: [],              // planes de 12 semanas
  activePlanId: null,
  sessions: [],           // entrenamientos terminados
  activeSession: null,    // entrenamiento en curso (sobrevive a cerrar la app)
  weights: [],            // { id, date: 'YYYY-MM-DD', kg }
  coach: { interview: [], chat: [] }, // conversaciones con el coach
  settings: { restSound: true, coachAfterSession: true, weeklyReview: true },
  outbox: [],             // actividad pendiente de publicar cuando vuelva la conexión
});

let state = load();
const listeners = new Set();

function normalize(raw) {
  const base = empty();
  const s = { ...base, ...raw };
  s.settings = { ...base.settings, ...(raw?.settings || {}) };
  delete s.settings.apiKey; // la key ya no vive en el dispositivo
  s.coach = { ...base.coach, ...(raw?.coach || {}) };
  s.outbox = raw?.outbox || [];
  return s;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalize(JSON.parse(raw)) : empty();
  } catch {
    return empty();
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error('No se pudo guardar', e);
    alert('No se pudo guardar en el dispositivo. Exporta un respaldo desde Perfil.');
  }
}

export function save() {
  state.updatedAt = Date.now();
  persist();
  listeners.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); } });
}

// Suscripción a cambios (la usa la sincronización con la nube).
export const onChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));

export const db = () => state;

export function update(fn) {
  fn(state);
  save();
}

// Reemplaza todo el estado (al bajar datos de la nube o cambiar de cuenta) sin disparar subida.
export function replaceState(data, owner) {
  state = normalize({ ...data, owner });
  persist();
}

export { uid } from './util.js';

export const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export function activePlan() {
  return state.plans.find((p) => p.id === state.activePlanId) || null;
}

// Datos que se suben a la nube (sin metadatos del dispositivo).
export function cloudData() {
  const { owner, outbox, ...rest } = state;
  return rest;
}

export function exportJSON() {
  return JSON.stringify(cloudData(), null, 2);
}

export function importJSON(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !('sessions' in data)) throw new Error('Archivo no válido');
  state = normalize({ ...data, owner: state.owner });
  save();
}

export function resetAll(keepOwner = false) {
  const owner = keepOwner ? state.owner : null;
  state = empty();
  state.owner = owner;
  save();
}

// Pide al navegador que no borre los datos por falta de espacio.
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {}
  return false;
}
