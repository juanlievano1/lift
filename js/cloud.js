// Nube de la app: cuentas, sincronización, amigos, actividad y coach.
// Usa Supabase si está configurado; en modo prueba (?mock=1) usa un servidor simulado en el navegador.

import { SUPABASE_URL, SUPABASE_ANON_KEY, DEMO } from './config.js';
import { db, onChange, replaceState, cloudData, update } from './db.js';

const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';

const params = new URLSearchParams(location.search);
if (params.get('mock') === '1') localStorage.setItem('forja.mock', '1');
if (params.get('mock') === '0') localStorage.removeItem('forja.mock');
const realCloud = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
export const mockMode = localStorage.getItem('forja.mock') === '1' || (DEMO && !realCloud && params.get('mock') !== '0');
export const enabled = mockMode || realCloud;

let api = null;       // backend (real o simulado)
export let user = null;   // { id, email }
export let me = null;     // perfil público { id, username, display_name }

// ---------- Backend real (Supabase) ----------
async function supabaseBackend() {
  const { createClient } = await import(SDK);
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  const must = ({ data, error }) => { if (error) throw new Error(translate(error.message)); return data; };
  const uidNow = async () => (await sb.auth.getUser()).data.user?.id;

  return {
    async session() { const { data } = await sb.auth.getSession(); return data.session?.user || null; },
    async signUp({ email, password, username, displayName }) {
      const data = must(await sb.auth.signUp({ email, password, options: { data: { username: username.toLowerCase(), display_name: displayName }, emailRedirectTo: location.origin + location.pathname } }));
      return { user: data.user, needsConfirm: !data.session };
    },
    async signIn({ email, password }) { return must(await sb.auth.signInWithPassword({ email, password })).user; },
    // Google: redirige a la pantalla de Google y vuelve a la app con la sesión iniciada.
    async signInWithGoogle() { must(await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } } })); return null; },
    async signOut() { await sb.auth.signOut(); },
    async resetPassword(email) { must(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })); },
    async usernameAvailable(u) { return must(await sb.rpc('username_available', { p_username: u })); },
    async profile(id) { return must(await sb.from('profiles').select('id, username, display_name, username_confirmed').eq('id', id).single()); },
    async confirmUsername(id, username, display_name) { must(await sb.from('profiles').update({ username: username.toLowerCase(), display_name, username_confirmed: true }).eq('id', id)); },
    async updateProfile(id, fields) { must(await sb.from('profiles').update(fields).eq('id', id)); },
    async pull(id) { return must(await sb.from('user_data').select('data, updated_at').eq('user_id', id).maybeSingle()); },
    async push(id, data) { must(await sb.from('user_data').upsert({ user_id: id, data, updated_at: new Date().toISOString() })); },
    async friendships() {
      return must(await sb.from('friendships').select('requester, addressee, status, created_at, req:profiles!friendships_requester_fkey(id, username, display_name), adr:profiles!friendships_addressee_fkey(id, username, display_name)'));
    },
    async search(q) { return must(await sb.from('profiles').select('id, username, display_name').ilike('username', `${q.toLowerCase().replace(/[%_]/g, '')}%`).limit(10)); },
    async byUsername(u) { return must(await sb.from('profiles').select('id, username, display_name').eq('username', u.toLowerCase()).maybeSingle()); },
    async request(to) { must(await sb.from('friendships').insert({ requester: await uidNow(), addressee: to })); },
    async accept(from) { must(await sb.from('friendships').update({ status: 'accepted' }).eq('requester', from).eq('addressee', await uidNow())); },
    async remove(other) { const me = await uidNow(); must(await sb.from('friendships').delete().or(`and(requester.eq.${me},addressee.eq.${other}),and(requester.eq.${other},addressee.eq.${me})`)); },
    async feed(userId) {
      let q = sb.from('activity').select('id, user_id, kind, payload, created_at, author:profiles(id, username, display_name), cheers(user_id)').order('created_at', { ascending: false }).limit(40);
      if (userId) q = q.eq('user_id', userId);
      return must(await q);
    },
    async publish(id, kind, payload) { must(await sb.from('activity').insert({ user_id: id, kind, payload })); },
    async feedback(f) { must(await sb.from('feedback').insert(f)); },
    async cheer(activityId, on) {
      const me = await uidNow();
      if (on) must(await sb.from('cheers').insert({ activity_id: activityId, user_id: me }));
      else must(await sb.from('cheers').delete().eq('activity_id', activityId).eq('user_id', me));
    },
    async usage(id) {
      const month = new Date().toISOString().slice(0, 7);
      const u = must(await sb.from('ai_usage').select('cost_micros').eq('user_id', id).eq('month', month).maybeSingle());
      return { usedCents: Math.round((u?.cost_micros || 0) / 10000) };
    },
    async coach(action, payload) {
      const { data, error } = await sb.functions.invoke('coach', { body: { action, payload } });
      if (error) {
        let msg = action === 'import' ? 'No se pudo leer tu rutina. Revisa tu conexión e inténtalo de nuevo.' : 'No se pudo hablar con el coach. Revisa tu conexión.';
        try { const body = await error.context?.json?.(); if (body?.error) msg = body.error; } catch {}
        throw new Error(msg);
      }
      return data;
    },
    onAuth(cb) { sb.auth.onAuthStateChange((_e, session) => cb(session?.user || null)); },
  };
}

function translate(msg = '') {
  const m = msg.toLowerCase();
  if (m.includes('invalid login')) return 'Correo o contraseña incorrectos.';
  if (m.includes('already registered')) return 'Ese correo ya tiene una cuenta. Inicia sesión.';
  if (m.includes('email not confirmed')) return 'Confirma tu correo antes de entrar (revisa tu bandeja).';
  if (m.includes('password should be')) return 'La contraseña debe tener al menos 6 caracteres.';
  if (m.includes('duplicate key') && m.includes('friendships')) return 'Ya hay una solicitud entre ustedes.';
  if (m.includes('duplicate key') && m.includes('username')) return 'Ese nombre de usuario ya está en uso.';
  if (m.includes('provider is not enabled')) return 'El inicio con Google aún no está activado en el servidor.';
  if (m.includes('database error saving new user')) return 'Ese nombre de usuario ya está en uso.';
  if (m.includes('rate limit')) return 'Demasiados intentos. Espera un momento.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Sin conexión. Inténtalo de nuevo.';
  return msg || 'Algo salió mal.';
}

// ---------- Arranque y sesión ----------
const authListeners = new Set();
export const onAuthChange = (fn) => authListeners.add(fn);

export async function init() {
  if (!enabled) return null;
  api = mockMode ? (await import('./mock.js')).mockBackend() : await supabaseBackend();
  const u = await api.session();
  if (u) await setUser(u);
  api.onAuth(async (nu) => {
    if ((nu?.id || null) === (user?.id || null)) return;
    if (nu) await setUser(nu); else { user = null; me = null; }
    authListeners.forEach((fn) => fn(user));
  });
  return user;
}

async function setUser(u) {
  user = { id: u.id, email: u.email };
  try { me = await api.profile(u.id); } catch { me = { id: u.id, username: '', display_name: '', username_confirmed: true }; }
}

export async function signUp(f) { const r = await api.signUp(f); if (!r.needsConfirm && r.user) await setUser(r.user); return r; }
export async function signIn(f) { const u = await api.signIn(f); await setUser(u); return u; }
export async function signInWithGoogle() { const u = await api.signInWithGoogle(); if (u) await setUser(u); return u; }
export async function confirmUsername(username, displayName) { await api.confirmUsername(user.id, username, displayName); me = { ...me, username: username.toLowerCase(), display_name: displayName, username_confirmed: true }; }
export const needsUsername = () => !!user && me?.username_confirmed === false;
export async function signOut() { await flush(); await api.signOut(); user = null; me = null; }
export const resetPassword = (email) => api.resetPassword(email);
export const usernameAvailable = (u) => api.usernameAvailable(u);
export async function updateDisplayName(name) { await api.updateProfile(user.id, { display_name: name }); me.display_name = name; }

// ---------- Sincronización ----------
// Gana la copia modificada más recientemente (dispositivo o nube).
export async function syncOnLogin({ askAdoptLocal }) {
  const remote = await api.pull(user.id);
  const local = db();
  const remoteAt = remote?.data?.updatedAt || 0;
  if (local.owner === user.id) {
    if (remoteAt > local.updatedAt) replaceState(remote.data, user.id);
    else if (local.updatedAt > remoteAt) await api.push(user.id, cloudData());
  } else if (!local.owner && local.profile && (!remote || !remote.data?.profile || (await askAdoptLocal()))) {
    // Datos creados en este dispositivo antes de tener cuenta: pasan a la cuenta.
    update((s) => (s.owner = user.id));
    await api.push(user.id, cloudData());
  } else {
    replaceState(remote?.data || {}, user.id);
  }
}

let timer = null;
let pushing = false;
export const syncState = { status: 'idle', at: 0 };

async function pushNow() {
  if (!user || db().owner !== user.id) return;
  if (!navigator.onLine) { syncState.status = 'offline'; return; }
  if (pushing) { schedule(); return; }
  pushing = true;
  try {
    await api.push(user.id, cloudData());
    syncState.status = 'ok'; syncState.at = Date.now();
    await flushOutbox();
  } catch (e) {
    console.warn('Sincronización pendiente', e);
    syncState.status = 'error';
  } finally { pushing = false; }
}
const schedule = () => { clearTimeout(timer); timer = setTimeout(pushNow, 1500); };
export async function flush() { clearTimeout(timer); await pushNow(); }

onChange(() => { if (enabled && user) schedule(); });
window.addEventListener('online', () => user && pushNow());
// Al volver a la app, trae cambios hechos en otro dispositivo.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !user || !navigator.onLine) return;
  try {
    const remote = await api.pull(user.id);
    if ((remote?.data?.updatedAt || 0) > db().updatedAt && !db().activeSession) {
      replaceState(remote.data, user.id);
      authListeners.forEach((fn) => fn(user, 'pulled'));
    }
  } catch {}
});

// ---------- Actividad ----------
export function publish(kind, payload) {
  if (!enabled || !user) return;
  update((s) => s.outbox.push({ kind, payload, at: Date.now() }));
}
async function flushOutbox() {
  const box = db().outbox;
  if (!box.length) return;
  const sent = [];
  for (const item of box) {
    try { await api.publish(user.id, item.kind, item.payload); sent.push(item.at); } catch (e) { console.warn(e); break; }
  }
  if (sent.length) { db().outbox = box.filter((i) => !sent.includes(i.at)); localStorage.setItem('forja.v1', JSON.stringify(db())); }
}

export const feed = (userId) => api.feed(userId);

// Comentarios de los usuarios (los lee el dueño en Supabase).
export async function sendFeedback({ screen, message, version }) {
  if (!enabled || !user) throw new Error('Inicia sesión para enviar comentarios.');
  if (!navigator.onLine) throw new Error('Necesitas conexión para enviar el comentario.');
  await api.feedback({ screen: String(screen).slice(0, 40), message: String(message).slice(0, 2000), app_version: String(version).slice(0, 20) });
}
export const cheer = (id, on) => api.cheer(id, on);

// ---------- Amigos ----------
export async function friends() {
  const rows = await api.friendships();
  return rows.map((r) => {
    const mine = r.requester === user.id;
    const other = mine ? r.adr : r.req;
    return { ...other, status: r.status === 'accepted' ? 'accepted' : mine ? 'outgoing' : 'incoming', since: r.created_at };
  });
}
export const searchUsers = (q) => api.search(q);
export const findUser = (u) => api.byUsername(u);
export const requestFriend = (id) => api.request(id);
export const acceptFriend = (id) => api.accept(id);
export const removeFriend = (id) => api.remove(id);

// ---------- Coach ----------
export async function coach(action, payload) {
  if (!enabled || !user) throw new Error('Crea una cuenta o inicia sesión para usar el coach.');
  if (!navigator.onLine) throw new Error('Necesitas conexión a internet para hablar con el coach.');
  const res = await api.coach(action, payload);
  if (res?.usage) lastUsage = res.usage;
  return res;
}
export let lastUsage = null;

// Importar una rutina desde un PDF, fotos o texto (la lee Claude en el servidor).
export async function importRoutine(payload) {
  if (!enabled || !user) throw new Error('Inicia sesión para importar tu rutina.');
  if (!navigator.onLine) throw new Error('Necesitas conexión a internet para importar tu rutina.');
  return api.coach('import', payload);
}
export async function usage() { try { return { ...(await api.usage(user.id)), ...(lastUsage ? { limitCents: lastUsage.limitCents } : {}) }; } catch { return null; } }

export const inviteLink = () => `${location.origin}${location.pathname}?invite=${encodeURIComponent(me?.username || '')}`;
