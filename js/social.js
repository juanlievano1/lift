// Amigos: invitar, buscar, solicitudes y feed de actividad con "fuerzas".

import * as cloud from './cloud.js';
import { APP_NAME } from './config.js';
import { db } from './db.js';
import { e1rm } from './science.js';
import { weekInfo } from './program.js';
import { $, esc, toast, actions, timeAgo, avatar, n1, go } from './ui.js';
import { inUnit, numStr } from './program.js';

let cache = { friends: null, feed: null };
let searchTimer = null;

// Publica un resumen del entreno para tus amigos (sin notas privadas).
export function publishSession(session) {
  if (!cloud.enabled || !cloud.user) return;
  const plan = db().plans.find((p) => p.id === session.planId);
  const info = plan && session.week ? weekInfo(plan, session.week) : null;
  const top = session.exercises
    .map((e) => { const best = e.sets.reduce((b, x) => (e1rm(+x.kg, +x.reps) > e1rm(+b.kg, +b.reps) ? x : b), e.sets[0]); return { name: e.name, kg: +best.kg || 0, reps: +best.reps || 0, score: e1rm(+best.kg, +best.reps) || +best.reps }; })
    .sort((a, b) => b.score - a.score).slice(0, 3).map(({ score, ...r }) => r);
  cloud.publish('session', {
    dayName: session.dayName,
    planName: plan?.name || '',
    week: session.week || null,
    weekLabel: info ? `Semana ${info.week} · ${info.blockName}` : '',
    durationMin: session.durationMin,
    sets: session.exercises.reduce((a, e) => a + e.sets.length, 0),
    volumeKg: Math.round(session.exercises.reduce((a, e) => a + e.sets.reduce((b, x) => b + (+x.kg || 0) * (+x.reps || 0), 0), 0)),
    top,
    prs: session.prs || [],
  });
}

export function viewAmigos() {
  const main = $('#main');
  if (!cloud.enabled || !cloud.user) {
    main.innerHTML = `<header class="top"><h1>Amigos</h1></header>
      <section class="card"><h3>Entrena con tus amigos</h3><p class="muted">Para ver los entrenos de tus amigos necesitas una cuenta. Esta copia funciona en modo local.</p></section>`;
    return;
  }
  const sub = location.hash.split('/')[1];
  if (sub) return viewFriend(decodeURIComponent(sub));
  main.innerHTML = `
  <header class="top"><h1>Amigos</h1><button class="btn primary sm" data-act="invite">Invitar</button></header>
  <section class="card">
    <label>Buscar por nombre de usuario<input id="fsearch" type="search" placeholder="@usuario" autocapitalize="none" autocomplete="off"></label>
    <div id="fresults"></div>
  </section>
  <div id="frequests"></div>
  <h3 class="sect">Actividad</h3>
  <div id="feed"><div class="loading small"><div class="spinner"></div></div></div>
  <div id="flist"></div>`;

  $('#fsearch').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim().replace(/^@/, '');
    if (q.length < 2) { $('#fresults').innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      try {
        const [res, fr] = await Promise.all([cloud.searchUsers(q), cloud.friends()]);
        const status = Object.fromEntries(fr.map((f) => [f.id, f.status]));
        $('#fresults').innerHTML = res.filter((u) => u.id !== cloud.user.id).map((u) => `
          <div class="person">${avatar(u.display_name || u.username)}<span><b>${esc(u.display_name || u.username)}</b><span class="muted small">@${esc(u.username)}</span></span>
          ${status[u.id] === 'accepted' ? '<span class="chip ok">Amigos</span>' : status[u.id] ? '<span class="chip">Pendiente</span>' : `<button class="btn primary sm" data-act="addFriend" data-id="${u.id}" data-u="${esc(u.username)}">Agregar</button>`}</div>`).join('') || '<p class="muted small">Nadie con ese usuario.</p>';
      } catch (err) { $('#fresults').innerHTML = `<p class="muted small">${esc(err.message)}</p>`; }
    }, 300);
  });
  loadFriends();
  loadFeed();
}

async function loadFriends() {
  try {
    const fr = await timeout(cloud.friends());
    cache.friends = fr;
    const incoming = fr.filter((f) => f.status === 'incoming');
    const outgoing = fr.filter((f) => f.status === 'outgoing');
    const accepted = fr.filter((f) => f.status === 'accepted');
    const req = $('#frequests');
    if (req) req.innerHTML = incoming.length || outgoing.length ? `<section class="card">
      ${incoming.length ? `<p class="eyebrow">Solicitudes para ti</p>${incoming.map((u) => `
        <div class="person">${avatar(u.display_name || u.username)}<span><b>${esc(u.display_name || u.username)}</b><span class="muted small">@${esc(u.username)}</span></span>
        <span class="row"><button class="btn primary sm" data-act="acceptFriend" data-id="${u.id}">Aceptar</button><button class="icon" data-act="removeFriend" data-id="${u.id}" aria-label="Rechazar">✕</button></span></div>`).join('')}` : ''}
      ${outgoing.length ? `<p class="eyebrow">Enviadas</p>${outgoing.map((u) => `
        <div class="person">${avatar(u.display_name || u.username)}<span><b>${esc(u.display_name || u.username)}</b><span class="muted small">@${esc(u.username)} · esperando</span></span>
        <button class="link" data-act="removeFriend" data-id="${u.id}">Cancelar</button></div>`).join('')}` : ''}
    </section>` : '';
    const list = $('#flist');
    if (list) list.innerHTML = `<h3 class="sect">Tus amigos (${accepted.length})</h3>${accepted.length ? `<section class="card">${accepted.map((u) => `
      <a class="person link-row" href="#amigos/${encodeURIComponent(u.username)}">${avatar(u.display_name || u.username)}<span><b>${esc(u.display_name || u.username)}</b><span class="muted small">@${esc(u.username)}</span></span><span class="chev">›</span></a>`).join('')}</section>`
      : `<section class="card empty-card"><p>Aún no tienes amigos en ${APP_NAME}.</p><button class="btn primary" data-act="invite">Invitar amigos</button></section>`}`;
  } catch (err) { toast(err.message); }
}

// Si la red se queda pegada (pasa en iPhone al volver a la app), no dejar la ruedita girando para siempre.
const timeout = (p, ms = 15000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('La conexión tardó demasiado')), ms))]);
// Mensaje de error con el motivo real y un botón para reintentar (el motivo ayuda a saber qué pasó).
const failBox = (what, err) => `<section class="card empty-card"><p>No se pudieron cargar ${what}.</p><p class="muted small">Motivo: ${esc(err?.message || 'desconocido')}${navigator.onLine ? '' : ' (estás sin conexión)'}</p><button class="btn ghost sm" data-act="retryFriends">Reintentar</button></section>`;

async function loadFeed(userId) {
  const box = $('#feed');
  try {
    const items = await timeout(cloud.feed(userId));
    cache.feed = items;
    if (!box) return;
    box.innerHTML = items.length ? items.map(safeCard).join('') : `<section class="card empty-card"><p>${userId ? 'Todavía no ha compartido entrenos.' : 'Cuando tú o tus amigos terminen un entreno, aparecerá aquí. Toca a un amigo para ver su avance y su rutina.'}</p></section>`;
  } catch (err) { console.warn('feed', err); if (box) box.innerHTML = failBox('los entrenos', err); }
}

// El contenido de cada actividad lo escribe otra persona: nunca se confía en su forma.
// Los números se convierten a número (o '—') y los textos se escapan antes de mostrarlos.
const num = (v) => { const n = Number(v); return v !== null && v !== '' && Number.isFinite(n) ? n : null; };
const list = (v) => (Array.isArray(v) ? v : []);
const safeCard = (a) => { try { return activityCard(a); } catch { return ''; } };

function activityCard(a) {
  const raw = a.payload && typeof a.payload === 'object' ? a.payload : {};
  const p = {
    planName: raw.planName, dayName: raw.dayName, weekLabel: raw.weekLabel,
    days: num(raw.days) ?? '—', durationMin: num(raw.durationMin), sets: num(raw.sets), volumeKg: num(raw.volumeKg),
    prs: list(raw.prs).map(String),
    top: list(raw.top).filter((t) => t && typeof t === 'object').map((t) => ({ name: t.name, kg: num(t.kg), reps: num(t.reps) ?? '—' })),
  };
  const who = a.author?.display_name || a.author?.username || 'Alguien';
  const mine = a.user_id === cloud.user.id;
  const myUnit = db().profile?.unit === 'lb' ? 'lb' : 'kg';
  const cheered = (a.cheers || []).some((c) => c.user_id === cloud.user.id);
  const n = (a.cheers || []).length;
  const head = `<div class="ahead">${avatar(who)}<span><b>${mine ? 'Tú' : esc(who)}</b><span class="muted small">${esc(timeAgo(a.created_at))}</span></span></div>`;
  if (a.kind === 'plan') {
    return `<section class="card activity">${head}<p>Empezó una rutina nueva${raw.weeks === 12 ? ' de 12 semanas' : ''}: <b>${esc(p.planName)}</b> · ${p.days} días por semana 🗓️</p></section>`;
  }
  return `<section class="card activity">
    ${head}
    <p class="atitle"><b>${esc(p.dayName)}</b>${p.weekLabel ? ` <span class="muted small">· ${esc(p.weekLabel)}</span>` : ''}</p>
    <div class="astats"><span><b>${p.durationMin ?? '—'}</b> min</span><span><b>${p.sets ?? '—'}</b> series</span>${p.volumeKg ? `<span><b>${Math.round(inUnit(p.volumeKg, myUnit)).toLocaleString('es')}</b> ${myUnit} levantados en total</span>` : ''}</div>
    ${p.prs?.length ? `<p class="prs">🏆 Récord en ${p.prs.map(esc).join(', ')}</p>` : ''}
    ${p.top?.length ? `<ul class="mini">${p.top.map((t) => `<li><span>${esc(t.name)}</span><span>${t.kg ? `${numStr(inUnit(t.kg, myUnit))} ${myUnit} × ${t.reps}` : `${t.reps} reps`}</span></li>`).join('')}</ul>` : ''}
    <div class="afoot"><button class="cheer ${cheered ? 'on' : ''}" data-act="cheer" data-id="${esc(a.id)}" ${mine ? 'disabled' : ''} aria-pressed="${cheered}">💪 ${n ? n : ''} ${mine ? (n ? `fuerza${n > 1 ? 's' : ''}` : 'Sin fuerzas aún') : cheered ? 'Le diste fuerzas' : 'Dar fuerzas'}</button></div>
  </section>`;
}

// ---------- Perfil de un amigo: su avance (de lo que comparte) y su rutina ----------
const DAY = 864e5;
function progressCard(items, name) {
  const ss = items.filter((a) => a.kind === 'session').map((a) => ({ at: new Date(a.created_at).getTime(), p: a.payload && typeof a.payload === 'object' ? a.payload : {} }));
  if (!ss.length) return '';
  const now = Date.now();
  const n7 = ss.filter((s) => now - s.at < 7 * DAY).length;
  const n30 = ss.filter((s) => now - s.at < 30 * DAY).length;
  // Semanas seguidas (de lunes a domingo) con al menos un entreno, contando desde esta semana o la anterior.
  const monday = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
  const weeks = new Set(ss.map((s) => monday(s.at)));
  let w = monday(now), streak = 0;
  if (!weeks.has(w)) w -= 7 * DAY;
  while (weeks.has(w)) { streak++; w -= 7 * DAY; }
  const prs = [...new Set(ss.filter((s) => now - s.at < 30 * DAY).flatMap((s) => (Array.isArray(s.p.prs) ? s.p.prs : []).map(String)))].slice(0, 5);
  // Mejor serie de cada ejercicio entre lo que compartió.
  const best = new Map();
  for (const s of ss) for (const t of Array.isArray(s.p.top) ? s.p.top : []) {
    const kg = Number(t?.kg) || 0, reps = Number(t?.reps) || 0, score = kg ? e1rm(kg, reps) : reps;
    if (t?.name && reps && (!best.has(t.name) || score > best.get(t.name).score)) best.set(t.name, { kg, reps, score });
  }
  const unit = db().profile?.unit === 'lb' ? 'lb' : 'kg';
  const top = [...best.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 5);
  return `<section class="card"><h3>Avance de ${name}</h3>
    <div class="fstats"><div><b>${n7}</b><span>entreno${n7 === 1 ? '' : 's'} en 7 días</span></div><div><b>${n30}</b><span>en 30 días</span></div><div><b>${streak}</b><span>semana${streak === 1 ? '' : 's'} seguida${streak === 1 ? '' : 's'}</span></div></div>
    <p class="muted small">Último entreno: ${esc(timeAgo(new Date(ss[0].at).toISOString()))}</p>
    ${prs.length ? `<p class="prs">🏆 Récords recientes: ${prs.map(esc).join(', ')}</p>` : ''}
    ${top.length ? `<p class="eyebrow">Mejores series</p><ul class="mini">${top.map(([n, b]) => `<li><span>${esc(n)}</span><span>${b.kg ? `${numStr(inUnit(b.kg, unit))} ${unit} × ${b.reps}` : `${b.reps} reps`}</span></li>`).join('')}</ul>` : ''}
  </section>`;
}
function routineCard(r, name) {
  if (!r || !Array.isArray(r.days)) return `<p class="muted small center">${name} no comparte su rutina.</p>`;
  return `<section class="card"><h3>Rutina de ${name}</h3><p class="muted small">${esc(r.name)} · ${r.days.length} día${r.days.length === 1 ? '' : 's'} por semana</p>
    ${r.days.map((d) => `<details class="day"><summary><b>${esc(d?.name)}</b> <span class="muted small">· ${(d?.exercises || []).length} ejercicios</span></summary>
      <ul class="mini">${(Array.isArray(d?.exercises) ? d.exercises : []).map((e) => `<li><span>${esc(e?.name)}</span><span class="muted">${Number(e?.sets) || '—'} × ${Number(e?.repMin) || ''}–${Number(e?.repMax) || ''}</span></li>`).join('')}</ul></details>`).join('')}
  </section>`;
}

async function viewFriend(username) {
  const main = $('#main');
  main.innerHTML = `<header class="top"><div><a class="link" href="#amigos">← Amigos</a><h1>@${esc(username)}</h1></div></header><div id="fhead"></div><h3 class="sect">Sus entrenos</h3><div id="feed"><div class="loading small"><div class="spinner"></div></div></div>`;
  try {
    const u = await cloud.findUser(username);
    if (!u) { $('#feed').innerHTML = '<p class="muted">No encontramos a esa persona.</p>'; return; }
    const fr = cache.friends?.length ? cache.friends : await timeout(cloud.friends());
    const rel = fr.find((f) => f.id === u.id)?.status;
    $('#fhead').innerHTML = `<section class="card"><div class="person">${avatar(u.display_name || u.username, 'lg')}<span><b>${esc(u.display_name || u.username)}</b><span class="muted small">@${esc(u.username)}</span></span>
      ${rel === 'accepted' ? `<button class="link danger" data-act="removeFriend" data-id="${u.id}" data-confirm="1">Eliminar</button>` : rel ? '<span class="chip">Pendiente</span>' : `<button class="btn primary sm" data-act="addFriend" data-id="${u.id}" data-u="${esc(u.username)}">Agregar</button>`}</div></section>`;
    if (rel !== 'accepted') { $('#feed').innerHTML = '<section class="card empty-card"><p>Cuando sean amigos verás sus entrenos y su avance.</p></section>'; return; }
    const name = esc(u.display_name?.split(' ')[0] || `@${u.username}`);
    let feedErr = null;
    const [items, routine] = await Promise.all([timeout(cloud.feed(u.id)).catch((e) => { feedErr = e; console.warn('feed amigo', e); return null; }), timeout(cloud.friendRoutine(u.id)).catch(() => null)]);
    cache.feed = items || [];
    $('#fhead').insertAdjacentHTML('beforeend', progressCard(items || [], name) + routineCard(routine?.data, name));
    $('#feed').innerHTML = items == null ? failBox('sus entrenos', feedErr)
      : items.length ? items.map(safeCard).join('')
      : `<section class="card empty-card"><p>${name} todavía no ha compartido entrenos.</p><p class="muted small">Puede que aún no haya entrenado o que haya elegido no compartirlos.</p></section>`;
  } catch (err) { console.warn('amigo', err); $('#feed').innerHTML = failBox('su perfil', err); }
}

async function share() {
  const link = cloud.inviteLink();
  const text = `Entrena conmigo en ${APP_NAME}: arma tu rutina, la app te dice cuánto peso poner y vemos el progreso del otro. Entra con este enlace y quedamos como amigos:`;
  try {
    // El enlace va dentro del texto: algunas apps (WhatsApp en iPhone) descartan el campo url.
    if (navigator.share) { await navigator.share({ title: APP_NAME, text: `${text}\n${link}` }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(`${text}\n${link}`); toast('Enlace copiado: pégalo en WhatsApp'); }
  catch { prompt('Copia tu enlace de invitación:', link); }
}

Object.assign(actions, {
  invite: () => share(),
  retryFriends: () => { cache = { friends: null, feed: null }; viewAmigos(); },
  addFriend: async (el) => {
    try { await cloud.requestFriend(el.dataset.id); toast(`Solicitud enviada a @${el.dataset.u}`); el.outerHTML = '<span class="chip">Pendiente</span>'; loadFriends(); }
    catch (err) { toast(err.message); }
  },
  acceptFriend: async (el) => {
    try { await cloud.acceptFriend(el.dataset.id); toast('¡Ahora son amigos!'); loadFriends(); loadFeed(); }
    catch (err) { toast(err.message); }
  },
  removeFriend: async (el) => {
    if (el.dataset.confirm && !confirm('¿Eliminar a esta persona de tus amigos?')) return;
    try { await cloud.removeFriend(el.dataset.id); if (location.hash.startsWith('#amigos/')) go('amigos'); else loadFriends(); }
    catch (err) { toast(err.message); }
  },
  cheer: async (el) => {
    const on = !el.classList.contains('on');
    const item = cache.feed?.find((a) => a.id === el.dataset.id);
    if (item) {
      item.cheers = on ? [...(item.cheers || []), { user_id: cloud.user.id }] : (item.cheers || []).filter((c) => c.user_id !== cloud.user.id);
      el.outerHTML = activityCard(item).match(/<button class="cheer[\s\S]*?<\/button>/)[0];
    }
    try { await cloud.cheer(el.dataset.id, on); } catch (err) { toast(err.message); loadFeed(); }
  },
});
