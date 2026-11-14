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
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
    return raw ? normalize(JSON.parse(raw)) : empty();
  } catch {
    // Datos dañados: se guarda una copia antes de empezar de cero, para poder recuperarlos.
    try { if (raw) localStorage.setItem(`${KEY}.dañado`, raw); } catch {}
    return empty();
  }
}

let warnedFull = false;
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error('No se pudo guardar', e);
    if (!warnedFull) { warnedFull = true; alert('No se pudo guardar en el celular (¿sin espacio?). Exporta un respaldo desde Perfil.'); }
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
// Dos ventanas de Lift en el mismo celular (la app instalada y una pestaña del navegador) comparten el
// almacenamiento pero cada una tenía su copia en memoria: la más vieja pisaba a la otra y, al sincronizar,
// borraba sus entrenos de la nube. Ahora cada una adopta lo más nuevo que encuentre guardado.
export function reloadIfNewer() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object' && (Number(raw.updatedAt) || 0) > (Number(state.updatedAt) || 0)) { state = normalize(raw); return true; }
  } catch { /* se queda con lo que hay en memoria */ }
  return false;
}
if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('storage', (e) => { if (e.key === KEY) reloadIfNewer(); });

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

// Datos que se suben a la nube: sin metadatos del celular ni el entreno en curso
// (ese vive solo en el celular donde se está haciendo; al terminarlo pasa a "sessions").
export function cloudData() {
  const { owner, outbox, activeSession, ...rest } = state;
  return rest;
}

export function exportJSON() {
  return JSON.stringify({ ...cloudData(), activeSession: null }, null, 2);
}

// Revisa que un respaldo tenga la forma correcta antes de usarlo.
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('el archivo no es un respaldo de Lift'); }
  const arr = (k) => data?.[k] === undefined || Array.isArray(data[k]);
  if (!data || typeof data !== 'object' || !Array.isArray(data.sessions) || !arr('plans') || !arr('weights')) throw new Error('el archivo no es un respaldo de Lift');
  if (data.profile != null && typeof data.profile !== 'object') throw new Error('el perfil del respaldo está dañado');
  return cleanBackup(data);
}

// Un respaldo es un archivo que puede venir de otra persona ("importa mi rutina"): los campos que la app
// pinta como números o identificadores se fuerzan a serlo, y ningún texto conserva etiquetas HTML.
const NUMERIC = new Set(['repMin', 'repMax', 'restSec', 'durationMin', 'reps', 'week', 'weight', 'height', 'age', 'minutes', 'nextDay', 'startedAt']);
const IDS = new Set(['id', 'planId', 'dayId', 'activePlanId']);
function cleanBackup(v, key = '') {
  if (Array.isArray(v)) return v.map((x) => cleanBackup(x, key));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k.replace(/[<>]/g, '')] = k === 'exUnits' && x && typeof x === 'object'
        ? Object.fromEntries(Object.entries(x).map(([n, u]) => [n.replace(/[<>]/g, ''), u === 'lb' ? 'lb' : 'kg']))
        : cleanBackup(x, k);
    }
    return out;
  }
  if (typeof v !== 'string') return v;
  if (IDS.has(key)) return v.replace(/[^\w-]/g, '').slice(0, 64);
  if (NUMERIC.has(key) || key === 'days' || key === 'sets') return v === '' ? '' : Number(v.replace(',', '.')) || 0; // "days"/"sets" como texto (los de verdad son listas o números)
  if (key === 'kg') return v === '' ? '' : Number(v.replace(',', '.')) || '';
  if (key === 'rir') return v.replace(/[^0-9.,\-–]/g, '').slice(0, 8);
  return v.replace(/[<>]/g, '');
}

// Importa un respaldo. Conserva el entreno en curso y la cuenta.
// merge = hay cuenta: lo que ya está en el celular y no viene en el respaldo se conserva (se juntan).
export function importJSON(text, merge = false) {
  const data = parseBackup(text);
  if (merge) {
    for (const c of ['sessions', 'weights', 'plans']) {
      // Lo del celular manda; del respaldo solo entra lo que aquí no existe (no revierte rutinas editadas después).
      const have = new Set((state[c] || []).map((x) => x?.id));
      data[c] = [...(state[c] || []), ...(data[c] || []).filter((x) => !have.has(x?.id))];
      if (c !== 'plans') data[c].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    }
    // Perfil, ajustes (p. ej. qué compartes con amigos) y rutina activa: los actuales, si existen.
    if (state.profile) data.profile = state.profile;
    if (state.profile) { data.settings = state.settings; data.coach = state.coach; }
    if (state.activePlanId && data.plans.some((p) => p.id === state.activePlanId)) data.activePlanId = state.activePlanId;
    else if (!data.plans.some((p) => p.id === data.activePlanId)) data.activePlanId = data.plans[0]?.id || null;
  }
  state = normalize({ ...data, owner: state.owner, activeSession: state.activeSession, outbox: state.outbox });
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
