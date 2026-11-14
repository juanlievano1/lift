// Nube de la app: cuentas, sincronización, amigos, actividad y coach.
// Usa Supabase si está configurado; en modo prueba (?mock=1) usa un servidor simulado en el navegador.

import { SUPABASE_URL, SUPABASE_ANON_KEY, DEMO, VAPID_PUBLIC_KEY } from './config.js';
import { db, onChange, replaceState, cloudData, update, reloadIfNewer } from './db.js';
import { mergeDocs, hashOf, baseOf, strip } from './sync.js';

const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';

const params = new URLSearchParams(location.search);
const realCloud = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
// El servidor simulado (?mock=1) solo se puede activar en el computador de desarrollo o en la versión demo:
// en la app publicada, un enlace con ?mock=1 dejaba el celular pegado a cuentas falsas y podía borrar datos sin sincronizar.
const DEV = DEMO || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
if (DEV && params.get('mock') === '1') localStorage.setItem('forja.mock', '1');
if (!DEV || params.get('mock') === '0') localStorage.removeItem('forja.mock');
export const mockMode = (DEV && localStorage.getItem('forja.mock') === '1') || (DEMO && !realCloud && params.get('mock') !== '0');
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
    // Si la sesión no se pudo renovar (señal mala), es un fallo de red, no un "cierra sesión".
    async session() { const { data, error } = await sb.auth.getSession(); if (error && !data?.session) throw error; return data.session?.user || null; },
    async signUp({ email, password, username, displayName }) {
      const data = must(await sb.auth.signUp({ email, password, options: { data: { username: username.toLowerCase(), display_name: displayName }, emailRedirectTo: returnUrl() } }));
      // Correo ya registrado (p. ej. entró antes con Google): Supabase no da error, pero tampoco manda correo.
      if (data.user && !data.session && data.user.identities?.length === 0) throw new Error('Ese correo ya tiene una cuenta. Inicia sesión.');
      return { user: data.user, needsConfirm: !data.session };
    },
    async signIn({ email, password }) { return must(await sb.auth.signInWithPassword({ email, password })).user; },
    // Google: redirige a la pantalla de Google y vuelve a la app con la sesión iniciada.
    async signInWithGoogle() { must(await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: returnUrl(), queryParams: { prompt: 'select_account' } } })); return null; },
    async signOut() { await sb.auth.signOut(); },
    async resetPassword(email) { must(await sb.auth.resetPasswordForEmail(email, { redirectTo: returnUrl() })); },
    async usernameAvailable(u) { return must(await sb.rpc('username_available', { p_username: u })); },
    async profile(id) { return must(await sb.from('profiles').select('id, username, display_name, username_confirmed, avatar_path').eq('id', id).single()); },
    async confirmUsername(id, username, display_name) { must(await sb.from('profiles').update({ username: username.toLowerCase(), display_name, username_confirmed: true }).eq('id', id)); },
    async updateProfile(id, fields) { must(await sb.from('profiles').update(fields).eq('id', id)); },
    // Foto de perfil: un archivo nuevo cada vez (así nadie ve la foto vieja guardada en caché).
    async uploadAvatar(id, blob) {
      const path = `${id}/${Date.now()}.jpg`;
      must(await sb.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false }));
      return path;
    },
    async removeAvatarFile(path) { const { error } = await sb.storage.from('avatars').remove([path]); if (error) throw new Error(error.message); },
    async pull(id) { return must(await sb.from('user_data').select('data, updated_at').eq('user_id', id).maybeSingle()); },
    async push(id, data) { must(await sb.from('user_data').upsert({ user_id: id, data, updated_at: new Date().toISOString() })); },
    async friendships() {
      return must(await sb.from('friendships').select('requester, addressee, status, created_at, req:profiles!friendships_requester_fkey(id, username, display_name, avatar_path), adr:profiles!friendships_addressee_fkey(id, username, display_name, avatar_path)'));
    },
    async search(q) {
      // El guion bajo es válido en un @usuario: se busca literal (antes se borraba y "juan_f" no encontraba a nadie).
      const safe = q.toLowerCase().replace(/[^a-z0-9_.]/g, '').replace(/_/g, '\\_');
      if (!safe) return [];
      return must(await sb.from('profiles').select('id, username, display_name, avatar_path').ilike('username', `${safe}%`).limit(10));
    },
    async byUsername(u) { return must(await sb.from('profiles').select('id, username, display_name, avatar_path').eq('username', u.toLowerCase()).maybeSingle()); },
    async request(to) { must(await sb.from('friendships').insert({ requester: await uidNow(), addressee: to })); },
    async accept(from) { must(await sb.from('friendships').update({ status: 'accepted' }).eq('requester', from).eq('addressee', await uidNow())); },
    async inviteCode() { return must(await sb.rpc('my_invite_code')); },
    async inviteOwner(code) { return must(await sb.rpc('invite_owner', { p_code: code }))?.[0] || null; },
    async acceptInvite(code) { return must(await sb.rpc('accept_invite', { p_code: code })); },
    async remove(other) { const me = await uidNow(); must(await sb.from('friendships').delete().or(`and(requester.eq.${me},addressee.eq.${other}),and(requester.eq.${other},addressee.eq.${me})`)); },
    async feed(userId) {
      let q = sb.from('activity').select('id, user_id, kind, payload, created_at, author:profiles!activity_user_id_fkey(id, username, display_name, avatar_path), cheers(user_id)').order('created_at', { ascending: false }).limit(40);
      if (userId) q = q.eq('user_id', userId);
      return must(await q);
    },
    async publish(id, kind, payload) { must(await sb.from('activity').insert({ user_id: id, kind, payload })); },
    async clearActivity(id) { must(await sb.from('activity').delete().eq('user_id', id)); },
    async friendRoutine(id) {
      const { data, error } = await sb.from('shared_routines').select('data, updated_at').eq('user_id', id).maybeSingle();
      if (error) { if (/shared_routines|schema cache|does not exist/i.test(error.message)) return null; throw new Error(translate(error.message)); }
      return data;
    },
    async shareRoutine(id, data) { must(await sb.from('shared_routines').upsert({ user_id: id, data, updated_at: new Date().toISOString() })); },
    async friendRoutines(ids) {
      const { data, error } = await sb.from('shared_routines').select('user_id, data, updated_at').in('user_id', ids);
      if (error) { if (/shared_routines|schema cache|does not exist/i.test(error.message)) return {}; throw new Error(translate(error.message)); }
      return Object.fromEntries((data || []).map((r) => [r.user_id, r]));
    },
    async unshareRoutine(id) { must(await sb.from('shared_routines').delete().eq('user_id', id)); },
    async dropPush(endpoint) { must(await sb.from('push_subscriptions').delete().eq('endpoint', endpoint)); },
    async savePush(s) { must(await sb.rpc('save_push_subscription', { p_endpoint: s.endpoint, p_p256dh: s.p256dh, p_auth: s.auth })); },
    async restTimer(id, endsAt, next) { must(await sb.from('rest_timers').upsert({ user_id: id, ends_at: endsAt, next, sent: false, updated_at: new Date().toISOString() })); },
    async cancelRest(id) { must(await sb.from('rest_timers').delete().eq('user_id', id)); },
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
        let msg = action === 'import' ? 'No se pudo leer tu rutina. Revisa tu conexión e inténtalo de nuevo.' : action === 'adjust' ? 'No se pudo ajustar la rutina. Revisa tu conexión e inténtalo de nuevo.' : 'No se pudo hablar con el coach. Revisa tu conexión.';
        try { const body = await error.context?.json?.(); if (body?.error) msg = body.error; } catch {}
        throw new Error(msg);
      }
      return data;
    },
    onAuth(cb) { sb.auth.onAuthStateChange((ev, session) => cb(session?.user || null, ev)); },
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
  if (m.includes('provider is not enabled')) return 'Entrar con Google no está disponible por ahora. Usa tu correo.';
  if (m.includes('database error saving new user')) return 'Ese nombre de usuario ya está en uso.';
  if (m.includes('rate limit')) return 'Demasiados intentos. Espera un momento.';
  if (m.includes('for security purposes')) return 'Acabas de pedirlo. Espera un minuto e inténtalo de nuevo.';
  // iPhone dice "Load failed" donde Chrome dice "Failed to fetch".
  if (!navigator.onLine || /failed to fetch|load failed|network/.test(m)) return 'Sin conexión. Inténtalo de nuevo.';
  if (m.includes('duplicate key')) return 'Eso ya estaba hecho.';
  return msg || 'Algo salió mal.';
}

// ---------- Arranque y sesión ----------
const authListeners = new Set();
export const onAuthChange = (fn) => authListeners.add(fn);

async function connect() {
  if (api) return;
  api = mockMode ? (await import('./mock.js')).mockBackend() : await supabaseBackend();
  api.onAuth(async (nu, ev) => {
    if ((nu?.id || null) === (user?.id || null) && !user?.offline) return;
    // Trabajando con los datos del celular (sin señal): que la sesión no se haya podido renovar NO es un cierre
    // de sesión. Sin esto, a los ~30 s de abrir la app sin datos aparecía la pantalla de entrada en pleno entreno.
    if (!nu && user?.offline && ev !== 'SIGNED_OUT') return;
    if (nu) await setUser(nu); else { user = null; me = null; }
    authListeners.forEach((fn) => fn(user));
  });
}

export async function init() {
  if (!enabled) return null;
  let failed = false;
  const e0 = epoch;
  try {
    await connect();
    const u = await api.session();
    if (epoch !== e0) return user; // cerró sesión mientras esto seguía en camino: no se vuelve a entrar solo
    if (u) await setUser(u);
    else if (user?.offline && navigator.onLine) { user = null; me = null; } // arrancó con los datos del celular, pero la sesión ya no existe
  } catch (e) { console.warn('Sin conexión con la nube', e); failed = true; }
  // Sin señal (o la sesión no se pudo renovar sin internet): se entra igual con los datos de este celular.
  if (!user && db().owner && (failed || !navigator.onLine)) goOffline();
  return user;
}

// Modo sin conexión: la cuenta es la dueña de los datos del celular; se sincroniza al volver la señal.
function goOffline() {
  user = { id: db().owner, email: '', offline: true };
  me = cachedMe() || { id: db().owner, username: '', display_name: db().profile?.name || '', username_confirmed: true };
}
export const isOffline = () => !!user?.offline;
// Arranque con señal lenta: se entra ya con los datos de este celular mientras la nube responde.
// Solo si la sesión guardada en el celular es de la misma cuenta dueña de los datos: si otra persona acaba de
// entrar en este celular, se espera a la nube en vez de mostrarle los datos de la cuenta anterior.
function storedSessionUser() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (/^sb-.+-auth-token$/.test(k)) { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v?.user?.id || v?.currentSession?.user?.id || null; }
    }
  } catch { /* sin sesión legible */ }
  return null;
}
export function startOffline() {
  const sid = storedSessionUser();
  if (enabled && !user && db().owner && (!sid || sid === db().owner)) goOffline();
  return !!user && user.id === db().owner;
}
let epoch = 0; // sube en cada cierre de sesión
const ME_KEY = 'forja.me';
const cachedMe = () => { try { const m = JSON.parse(localStorage.getItem(ME_KEY) || 'null'); return m?.id === db().owner ? m : null; } catch { return null; } };

async function reconnect() {
  try {
    await connect();
    const u = await api.session();
    if (u) { await setUser(u); authListeners.forEach((fn) => fn(user)); }
    else { user = null; me = null; authListeners.forEach((fn) => fn(null)); } // hay que volver a entrar; los datos siguen en el celular
  } catch { /* sigue sin conexión */ }
}

async function setUser(u) {
  user = { id: u.id, email: u.email };
  try { me = await api.profile(u.id); localStorage.setItem(ME_KEY, JSON.stringify(me)); }
  catch { me = (cachedMe()?.id === u.id && cachedMe()) || { id: u.id, username: '', display_name: '', username_confirmed: true }; }
  try { me.invite_code = await api.inviteCode(); localStorage.setItem(ME_KEY, JSON.stringify(me)); } catch { /* sin código: el enlace usa el @usuario */ }
}

export async function signUp(f) { const r = await api.signUp(f); if (!r.needsConfirm && r.user) await setUser(r.user); return r; }
export async function signIn(f) { const u = await api.signIn(f); await setUser(u); return u; }
export async function signInWithGoogle() { const u = await api.signInWithGoogle(); if (u) await setUser(u); return u; }
export async function confirmUsername(username, displayName) { await api.confirmUsername(user.id, username, displayName); me = { ...me, username: username.toLowerCase(), display_name: displayName, username_confirmed: true }; saveMe(); }
export const needsUsername = () => !!user && me?.username_confirmed === false;
// Al cerrar sesión este celular deja de recibir los avisos de descanso de la cuenta.
async function dropPush() {
  try {
    if (!pushSupported()) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (!sub) return;
    if (user && !user.offline && navigator.onLine) await api.dropPush?.(sub.endpoint);
    await sub.unsubscribe();
  } catch (e) { console.warn('push', e); }
}
export async function signOut() {
  await flush().catch(() => {}); await dropPush();
  epoch++;
  // Siempre se borra la sesión de este celular, también sin conexión: antes quedaba guardada y la cuenta
  // volvía a entrar sola al recuperar la señal (aunque el celular ya fuera de otra persona).
  try { await api?.signOut(); } catch (e) { console.warn('Cierre de sesión sin conexión', e); }
  try { Object.keys(localStorage).filter((k) => /^sb-.+-auth-token/.test(k)).forEach((k) => localStorage.removeItem(k)); } catch {}
  user = null; me = null; try { localStorage.removeItem(BASE_KEY); localStorage.removeItem(ME_KEY); localStorage.removeItem(RKEY); localStorage.removeItem(PUSH_KEY); } catch {} }
export const resetPassword = (email) => api.resetPassword(email);
export const usernameAvailable = (u) => api.usernameAvailable(u);
export async function updateDisplayName(name) { await api.updateProfile(user.id, { display_name: name }); me.display_name = name; saveMe(); }
function saveMe() { try { localStorage.setItem(ME_KEY, JSON.stringify(me)); } catch {} }
// Foto de perfil (ya recortada y reducida). Se borra la anterior para no dejar archivos sueltos.
export async function setAvatar(blob) {
  if (!navigator.onLine) throw new Error('Necesitas conexión para cambiar tu foto.');
  const old = me?.avatar_path;
  const path = await api.uploadAvatar(user.id, blob);
  try { await api.updateProfile(user.id, { avatar_path: path }); }
  catch (e) { api.removeAvatarFile(path).catch(() => {}); throw e; }
  me = { ...me, avatar_path: path }; saveMe();
  if (old && old !== path) api.removeAvatarFile(old).catch(() => {});
}
export async function clearAvatar() {
  if (!navigator.onLine) throw new Error('Necesitas conexión para quitar tu foto.');
  const old = me?.avatar_path;
  await api.updateProfile(user.id, { avatar_path: null });
  me = { ...me, avatar_path: null }; saveMe();
  if (old) await api.removeAvatarFile(old).catch((e) => console.warn('No se pudo borrar la foto anterior', e));
}

// ---------- Sincronización ----------
// Las copias del celular y de la nube se MEZCLAN (ver sync.js): nada se pierde por usar dos aparatos
// o por entrenar sin señal. "Base" = lo último que este celular sincronizó con éxito.
const BASE_KEY = 'forja.syncbase';
function loadBase(uid) { try { const b = JSON.parse(localStorage.getItem(BASE_KEY) || 'null'); return b?.user === uid ? b : null; } catch { return null; } }
function saveBase(uid, doc) { try { localStorage.setItem(BASE_KEY, JSON.stringify({ user: uid, ...baseOf(doc) })); } catch {} }
export const hasUnsynced = () => !!user && db().owner === user.id && hashOf(cloudData()) !== loadBase(user.id)?.hash;

// Trae la nube, mezcla con lo local y sube el resultado si hace falta. Devuelve true si cambió lo local.
async function syncNow() {
  const uid = user.id;
  const remote = await api.pull(uid);
  if (user?.id !== uid) return false; // cambió la cuenta mientras llegaba la respuesta
  reloadIfNewer(); // otra pestaña (o la app instalada) pudo guardar algo más nuevo en este mismo celular
  const rdata = strip(remote?.data || {});
  const local = cloudData();
  // Sin fila en la nube no hay "borrados remotos" que respetar: se sube lo local (antes vaciaba el celular).
  const merged = mergeDocs(local, rdata, remote ? loadBase(uid) : null);
  const mh = hashOf(merged);
  const changedLocal = mh !== hashOf(local);
  // La "base" se toma ANTES de subir: lo que registres mientras la subida va en camino no puede quedar
  // marcado como sincronizado (la siguiente sincronización lo borraba del celular).
  const base = JSON.stringify({ user: uid, ...baseOf(merged) });
  if (changedLocal) { const s = db(); replaceState({ ...merged, activeSession: s.activeSession, outbox: s.outbox }, uid); }
  if (mh !== hashOf(rdata) || !remote) await api.push(uid, merged);
  try { localStorage.setItem(BASE_KEY, base); } catch {}
  return changedLocal;
}

export async function syncOnLogin({ askAdoptLocal }) {
  const local = db();
  if (local.owner === user.id) {
    await syncNow();
  } else {
    const remote = await api.pull(user.id);
    if (!local.owner && local.profile && (!remote?.data?.profile || (await askAdoptLocal()))) {
      // Datos creados en este celular antes de tener cuenta: se juntan con los de la cuenta.
      update((s) => (s.owner = user.id));
      await syncNow();
    } else {
      // Otra cuenta usó este celular antes, o no hay nada local: se usan los datos de la nube.
      replaceState({ ...strip(remote?.data || {}), activeSession: null, outbox: [] }, user.id);
      saveBase(user.id, cloudData());
    }
  }
  await flushOutbox();
  await syncSharedRoutine();
  if (pushSupported() && Notification.permission === 'granted') enablePush();
}

let timer = null;
let pushing = false;
export const syncState = { status: 'idle', at: 0 };

async function pushNow() {
  if (!user || user.offline || db().owner !== user.id) return;
  if (!navigator.onLine) { syncState.status = 'offline'; return; }
  if (pushing) { schedule(); return; }
  pushing = true;
  try {
    // Si nada de lo que va a la nube cambió (p. ej. marcar series del entreno en curso), no se sube nada.
    if (hasUnsynced()) {
      const changed = await syncNow();
      if (changed) authListeners.forEach((fn) => fn(user, 'pulled'));
    }
    syncState.status = 'ok'; syncState.at = Date.now();
    await flushOutbox();
    await syncSharedRoutine();
  } catch (e) {
    console.warn('Sincronización pendiente', e);
    syncState.status = 'error';
  } finally { pushing = false; }
}
const schedule = () => { clearTimeout(timer); timer = setTimeout(pushNow, 1500); };
export async function flush() { clearTimeout(timer); await pushNow(); }

onChange(() => { if (enabled && user && !user.offline) schedule(); });
window.addEventListener('online', () => { if (user?.offline) reconnect(); else if (user) pushNow(); });
// Al volver a la app, trae (y mezcla) cambios hechos en otro aparato.
// Al salir de la app (bloquear el celular justo después de terminar el entreno) se sube ya lo pendiente,
// sin esperar el segundo y medio habitual: en segundo plano ese temporizador se congela.
const flushSoon = () => { if (timer) flush().catch(() => {}); };
window.addEventListener('pagehide', flushSoon);
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden') return flushSoon();
  if (reloadIfNewer()) authListeners.forEach((fn) => fn(user, 'pulled'));
  // Seguía en modo sin conexión y ya hay señal: se reintenta entrar.
  if (user?.offline && navigator.onLine) return reconnect();
  // La primera carga de datos de esta cuenta falló (celular nuevo con mala señal): se reintenta en vez de
  // dejar a la persona en una app vacía hasta que la reinicie.
  if (user && !user.offline && navigator.onLine && db().owner !== user.id) return authListeners.forEach((fn) => fn(user));
  if (document.visibilityState !== 'visible' || !user || user.offline || !navigator.onLine || pushing || db().owner !== user.id) return;
  pushing = true;
  try { if (await syncNow()) authListeners.forEach((fn) => fn(user, 'pulled')); } catch {} finally { pushing = false; }
});

// "Borrar mis datos": también se quita lo publicado en el feed de los amigos y la rutina compartida.
export async function clearActivity() {
  if (!user || user.offline) return;
  // Si algo falla se avisa (antes se callaba y lo publicado seguía a la vista de los amigos).
  await api.clearActivity(user.id);
  await api.unshareRoutine(user.id);
  try { localStorage.removeItem(RKEY); } catch {}
}

// ---------- Rutina compartida con amigos ----------
// Solo días y ejercicios de la rutina activa, y solo si la persona eligió compartirla (Perfil).
export const sharesRoutine = () => { const s = db().settings; return s.shareRoutine ?? s.shareActivity === true; };
function routineSnapshot() {
  const s = db();
  const p = s.plans.find((x) => x.id === s.activePlanId);
  if (!p) return null;
  return {
    name: String(p.name || '').slice(0, 80), mode: p.program?.repMode || 'fases',
    days: p.days.slice(0, 7).map((d) => ({ name: String(d.name || '').slice(0, 40), exercises: d.exercises.slice(0, 15).map((e) => ({ name: String(e.name || '').slice(0, 80), sets: Number(e.sets) || 0, repMin: Number(e.repMin) || 0, repMax: Number(e.repMax) || 0 })) })),
  };
}
const RKEY = 'forja.sharedroutine';
async function syncSharedRoutine() {
  if (!user || user.offline || !navigator.onLine || db().owner !== user.id) return;
  const snap = sharesRoutine() ? routineSnapshot() : null;
  const sig = `${user.id}:${snap ? hashOf(snap) : 'none'}`;
  if (localStorage.getItem(RKEY) === sig) return;
  try {
    if (snap) await api.shareRoutine(user.id, snap); else await api.unshareRoutine(user.id);
    localStorage.setItem(RKEY, sig);
  } catch (e) { console.warn('Rutina compartida pendiente', e); }
}
export const friendRoutine = (id) => api.friendRoutine(id);
// Rutinas compartidas de varios amigos a la vez: { [id]: { data, updated_at } }.
export const friendRoutines = (ids) => (ids.length ? api.friendRoutines(ids) : Promise.resolve({}));

// ---------- Aviso de fin de descanso por push (llega con el celular bloqueado, sin pausar la música) ----------
const PUSH_KEY = 'forja.push';
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
export const pushActive = () => !!user && !user.offline && pushSupported() && Notification.permission === 'granted' && localStorage.getItem(PUSH_KEY) === user.id;
const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0));
// Suscribe este celular (en iPhone solo funciona con la app instalada en la pantalla de inicio).
export async function enablePush() {
  if (!user || user.offline || !pushSupported() || Notification.permission !== 'granted' || !VAPID_PUBLIC_KEY) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
    const j = sub.toJSON();
    await api.savePush({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
    localStorage.setItem(PUSH_KEY, user.id);
    return true;
  } catch (e) { console.warn('Push no disponible', e); return false; }
}
export function scheduleRestPush(endMs, next) {
  if (!pushActive() || !navigator.onLine) return;
  api.restTimer(user.id, new Date(endMs).toISOString(), String(next || '').slice(0, 120)).catch((e) => console.warn('descanso push', e));
}
export function cancelRestPush() {
  if (!pushActive() || !navigator.onLine) return;
  api.cancelRest(user.id).catch(() => {});
}

// ---------- Actividad ----------
export function publish(kind, payload) {
  if (!enabled || !user) return;
  update((s) => s.outbox.push({ kind, payload, at: Date.now() }));
}
let flushing = false; // una sola subida a la vez: dos a la par publicaban cada entreno dos veces
async function flushOutbox() {
  if (flushing) return;
  const box = db().outbox;
  if (!box.length) return;
  flushing = true;
  try {
    const sent = [];
    for (const item of box) {
      try { await api.publish(user.id, item.kind, item.payload); sent.push(item.at); } catch (e) { console.warn(e); break; }
    }
    // Se quita solo lo enviado de la cola ACTUAL (pudo crecer mientras se subía).
    if (sent.length) { db().outbox = db().outbox.filter((i) => !sent.includes(i.at)); localStorage.setItem('forja.v1', JSON.stringify(db())); }
  } finally { flushing = false; }
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
// Al eliminar a alguien, el servidor cambia tu código de invitación (el enlace viejo deja de servirle): se trae el nuevo.
export async function removeFriend(id) {
  await api.remove(id);
  try { me.invite_code = await api.inviteCode(); saveMe(); } catch { /* se actualiza al volver a abrir la app */ }
}

// ---------- Coach ----------
export async function coach(action, payload) {
  if (!enabled || !user) throw new Error('Crea una cuenta o inicia sesión para usar el coach.');
  if (!navigator.onLine) throw new Error('Necesitas conexión a internet para hablar con el coach.');
  const res = await api.coach(action, payload);
  if (res?.usage) lastUsage = res.usage;
  return res;
}
export let lastUsage = null;

// Ajustar una rutina con un pedido en palabras (lo aplica Claude en el servidor).
export async function adjustPlan(payload) {
  if (!enabled || !user) throw new Error('Inicia sesión para pedir cambios.');
  if (!navigator.onLine) throw new Error('Necesitas conexión a internet para pedir cambios.');
  return api.coach('adjust', payload);
}

// Importar una rutina desde un PDF, fotos o texto (la lee Claude en el servidor).
export async function importRoutine(payload) {
  if (!enabled || !user) throw new Error('Inicia sesión para importar tu rutina.');
  if (!navigator.onLine) throw new Error('Necesitas conexión a internet para importar tu rutina.');
  return api.coach('import', payload);
}
export async function usage() { try { return { ...(await api.usage(user.id)), ...(lastUsage ? { limitCents: lastUsage.limitCents } : {}) }; } catch { return null; } }

export const inviteLink = () => `${location.origin}${location.pathname}${me?.invite_code ? `?i=${me.invite_code}` : `?invite=${encodeURIComponent(me?.username || '')}`}`;

// ---------- Invitación pendiente ----------
// Se guarda en el celular (no solo en la pestaña) hasta 14 días, para que sobreviva a la vuelta de Google,
// a confirmar el correo en otra pestaña o a cerrar la app. Se borra solo cuando se resuelve.
const INV_KEY = 'lift.invite';
export function saveInvite(inv) { try { localStorage.setItem(INV_KEY, JSON.stringify({ ...inv, at: Date.now() })); } catch {} }
export function pendingInvite() {
  try {
    const v = JSON.parse(localStorage.getItem(INV_KEY) || 'null');
    if (v && Date.now() - v.at < 14 * 864e5 && (v.code || v.username)) return v;
    localStorage.removeItem(INV_KEY);
  } catch {}
  return null;
}
export function clearInvite() { try { localStorage.removeItem(INV_KEY); } catch {} }
// A dónde vuelve la app tras Google o el correo (la URL autorizada en Supabase; la invitación ya quedó guardada).
function returnUrl() { return location.origin + location.pathname; }
export const inviteOwner = (code) => api.inviteOwner(code);
export const acceptInvite = (code) => api.acceptInvite(code);
