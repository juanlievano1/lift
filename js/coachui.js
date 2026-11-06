// Coach con IA: crear el plan conversando, chat, comentario post-entreno y revisión semanal.
// Toda llamada a Claude pasa por el servidor (cloud.coach), que controla el cupo de cada persona.

import * as cloud from './cloud.js';
import { COACH_ENABLED } from './config.js';
import { db, update, uid, today, activePlan } from './db.js';
import { MUSCLES, weeklyVolume, volumeTarget, lastPerformance } from './science.js';
import { WEEKS, weekOf, weekInfo, planReport, applyReviewChanges, exerciseStatus, dismissRec } from './program.js';
import { volumeBars } from './charts.js';
import { $, esc, fmtDate, clone, toast, openModal, closeModal, actions, go, rerender } from './ui.js';
import { withProgram, currentWeek, weightText } from './domain.js';

let waiting = false;        // esperando respuesta del coach en el chat o la entrevista
let weeklyRunning = false;

const CHANGE_LABEL = {
  swap: (c) => `Cambiar <b>${esc(c.exercise)}</b> por <b>${esc(c.replacement)}</b>`,
  sets: (c) => `<b>${esc(c.exercise)}</b>: ${c.sets} series por sesión`,
  add: (c) => `Añadir <b>${esc(c.exercise)}</b> (${c.sets} series)`,
  remove: (c) => `Quitar <b>${esc(c.exercise)}</b>`,
};

const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
const compactPlan = (p) => p && { name: p.name, rationale: p.rationale, days: p.days.map((d) => ({ name: d.name, focus: d.focus, exercises: d.exercises.map((e) => ({ name: e.name, sets: e.sets, muscle: e.muscle, kind: e.kind, sec: e.sec, repMin: e.repMin, repMax: e.repMax, rir: e.rir, restSec: e.restSec, notes: e.notes })) })) };
const needAccount = () => `<section class="card"><h3>Coach con IA</h3><p class="muted">El coach necesita una cuenta. Esta copia funciona en modo local.</p></section>`;

function bubbles(list, extra) {
  return list.map((m, i) => `
    <div class="msg ${m.role}">
      <div class="bubble">${md(m.text)}</div>
      ${extra ? extra(m, i) : ''}
    </div>`).join('');
}

function composer(id, placeholder, chips = []) {
  return `
  <div class="chips">${chips.map((c) => `<button class="chipbtn" data-act="${c.act || 'sendChip'}" data-to="${id}" data-text="${esc(c.text)}">${esc(c.label || c.text)}</button>`).join('')}</div>
  <form class="composer" data-form="${id}">
    <textarea rows="1" placeholder="${esc(placeholder)}" aria-label="Mensaje para el coach"></textarea>
    <button class="btn primary" type="submit" aria-label="Enviar">➤</button>
  </form>`;
}

function bindComposer(id, send) {
  const form = document.querySelector(`[data-form="${id}"]`);
  if (!form) return;
  const ta = form.querySelector('textarea');
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text || waiting) return;
    ta.value = '';
    send(text);
  });
}

const scrollEnd = () => requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
const typing = () => `<div class="msg assistant"><div class="bubble typing"><span></span><span></span><span></span></div></div>`;

// ---------- Crear el plan conversando ----------
export function viewCrear() {
  const main = $('#main');
  if (!cloud.enabled || !cloud.user) { main.innerHTML = needAccount(); return; }
  const conv = db().coach.interview;
  const hasPlans = db().plans.length > 0;
  main.innerHTML = `
  <header class="top"><div>${hasPlans ? '<a class="link" href="#rutinas">← Planes</a>' : ''}<h1>Ajustar plan</h1><p class="muted small">Dile al coach qué cambiar y lo rehace contigo</p></div>
    ${conv.length ? '<button class="btn ghost sm" data-act="restartInterview">Empezar de nuevo</button>' : ''}</header>
  <div class="chat">${bubbles(conv, (m, i) => (m.plan ? planProposal(m.plan, i, i === lastPlanIndex(conv)) : ''))}${waiting ? typing() : ''}</div>
  ${composer('interview', 'Ej.: más brazo, no me gusta la sentadilla…', conv.length ? [{ text: 'Quiero más trabajo de brazos' }, { text: 'Cambia un ejercicio que no me gusta' }, { text: 'Tengo menos tiempo por sesión' }] : [])}`;
  bindComposer('interview', sendInterview);
  if (!conv.length && !waiting) sendInterview(null);
  else scrollEnd();
}

const lastPlanIndex = (conv) => { for (let i = conv.length - 1; i >= 0; i--) if (conv[i].plan) return i; return -1; };

function planProposal(plan, i, latest) {
  const profile = db().profile;
  const vol = weeklyVolume(plan);
  const rows = Object.keys(MUSCLES).map((m) => { const [lo, hi] = volumeTarget(profile.level, m); return { label: MUSCLES[m], value: vol[m], lo, hi }; });
  return `<section class="card proposal ${latest ? '' : 'old'}">
    <p class="eyebrow">${latest ? 'Propuesta del coach' : 'Propuesta anterior'}</p>
    <h3>${esc(plan.name)}</h3>
    ${plan.days.map((d) => `<details class="day" ${latest ? 'open' : ''}><summary><b>${esc(d.name)}</b> <span class="muted small">${d.exercises.length} ejercicios</span></summary>
      <ul class="mini">${d.exercises.map((e) => `<li><span>${esc(e.name)}${e.notes ? `<br><span class="muted small">${esc(e.notes)}</span>` : ''}</span><span class="muted">${e.sets} series</span></li>`).join('')}</ul></details>`).join('')}
    ${latest ? `<details class="day"><summary><b>Volumen semanal</b> <span class="muted small">series por músculo</span></summary>${volumeBars(rows)}</details>
    ${plan.rationale ? `<p class="muted small">${esc(plan.rationale)}</p>` : ''}
    <button class="btn primary big" data-act="usePlan" data-i="${i}">Usar este plan</button>
    <p class="muted small">Se convierte en tu plan de 12 semanas: la app calcula el peso de cada semana. ¿Algo no te convence? Díselo al coach abajo.</p>` : ''}
  </section>`;
}

async function sendInterview(text) {
  if (text) update((s) => s.coach.interview.push({ role: 'user', text, at: Date.now() }));
  waiting = true; viewCrear();
  try {
    const conv = db().coach.interview;
    // Parte del plan activo (creado al instante) hasta que el coach proponga uno nuevo.
    const last = conv[lastPlanIndex(conv)]?.plan || activePlan() || null;
    const res = await cloud.coach('interview', {
      profile: db().profile,
      currentPlan: compactPlan(last),
      messages: conv.map((m) => ({ role: m.role, text: m.plan ? `${m.text}\n[Plan propuesto: ${planSummary(m.plan)}]` : m.text })),
    });
    update((s) => s.coach.interview.push({ role: 'assistant', text: res.message || '', plan: res.plan || null, at: Date.now() }));
  } catch (err) {
    toast(err.message);
    if (text) update((s) => { s.coach.interview.pop(); });
  } finally {
    waiting = false;
    if (location.hash.startsWith('#crear')) viewCrear();
  }
}

const planSummary = (p) => `${p.name} — ${p.days.map((d) => `${d.name}: ${d.exercises.map((e) => `${e.name} ${e.sets}x`).join(', ')}`).join(' | ')}`;

// ---------- Chat con el coach ----------
export function viewCoach() {
  const main = $('#main');
  if (!cloud.enabled || !cloud.user) { main.innerHTML = needAccount(); return; }
  const conv = db().coach.chat;
  const plan = activePlan();
  main.innerHTML = `
  <header class="top"><div><h1>Coach</h1><p class="muted small">Pregúntale, pídele cambios o cuéntale cómo te sientes</p></div>
    ${conv.length ? '<button class="btn ghost sm" data-act="clearChat">Nueva charla</button>' : ''}</header>
  ${conv.length ? '' : `<section class="card coachhero">
    <p>Conozco tu plan${plan ? ` (<b>${esc(plan.name)}</b>, semana ${weekInfo(plan, currentWeek(plan)).week} de ${WEEKS})` : ''}, tus entrenos y tu peso. Puedo responder dudas, ajustar el plan contigo o revisar tu progreso.</p>
    <div class="actions wrap"><button class="btn ghost sm" data-act="aiReview">Revisar mi progreso</button><a class="btn ghost sm" href="#crear" data-act="newInterview">Crear un plan nuevo</a></div>
  </section>`}
  <div class="chat">${bubbles(conv, (m, i) => (m.changes?.length ? changeList(m, i) : ''))}${waiting ? typing() : ''}</div>
  ${composer('chat', 'Escribe al coach…', conv.length ? [] : [
    { text: '¿Cómo voy con mi plan?' },
    { text: 'Quiero cambiar un ejercicio que no me gusta' },
    { text: 'Hoy tengo poco tiempo, ¿qué priorizo?' },
  ])}`;
  bindComposer('chat', sendChat);
  if (conv.length) scrollEnd();
}

function changeList(m, i) {
  const applied = m.applied || [];
  const failed = m.failed || [];
  const pending = m.changes.some((_, k) => !applied.includes(k) && !failed.includes(k));
  return `<div class="changes inchat">${m.changes.map((c, k) => `
    <label class="change ${applied.includes(k) || failed.includes(k) ? 'done' : ''}">
      <input type="checkbox" data-chat-change="${i}:${k}" ${applied.includes(k) ? 'checked disabled' : failed.includes(k) ? 'disabled' : 'checked'}>
      <span><span class="ctitle">${CHANGE_LABEL[c.action]?.(c) || esc(c.action)}</span><span class="muted small">${esc(c.day)}${c.day ? ' · ' : ''}${esc(c.reason)}</span>${applied.includes(k) ? '<span class="chip good">Aplicado</span>' : failed.includes(k) ? '<span class="chip warn">No aplicable</span>' : ''}</span>
    </label>`).join('')}
    ${pending ? `<button class="btn primary" data-act="applyChat" data-i="${i}">Aplicar a mi plan</button>` : ''}</div>`;
}

async function sendChat(text) {
  update((s) => s.coach.chat.push({ role: 'user', text, at: Date.now() }));
  waiting = true; viewCoach(); scrollEnd();
  try {
    const plan = activePlan();
    const conv = db().coach.chat.slice(-20);
    const res = await cloud.coach('chat', {
      profile: db().profile,
      plan: compactPlan(plan),
      report: plan ? planReport(plan, db().sessions, today()) : null,
      weightText: weightText(),
      messages: conv.map((m) => ({ role: m.role, text: m.changes?.length ? `${m.text}\n[Propuse cambios: ${m.changes.map((c) => `${c.action} ${c.exercise}${c.replacement ? ' → ' + c.replacement : ''}`).join('; ')}]` : m.text })),
    });
    update((s) => s.coach.chat.push({ role: 'assistant', text: res.message || '', changes: res.changes || [], applied: [], at: Date.now() }));
  } catch (err) {
    update((s) => s.coach.chat.push({ role: 'assistant', text: `⚠️ ${err.message}`, at: Date.now(), error: true }));
  } finally {
    waiting = false;
    if (location.hash.startsWith('#coach')) { viewCoach(); scrollEnd(); }
  }
}

// ---------- Comentario después del entreno ----------
export async function runPostSession(sessionId) {
  const s = db();
  const session = s.sessions.find((x) => x.id === sessionId);
  if (!session) return;
  const plan = s.plans.find((p) => p.id === session.planId);
  const info = plan && session.week ? weekInfo(plan, session.week) : null;
  const sets = session.exercises.reduce((a, e) => a + e.sets.length, 0);
  openModal(`
    <div class="postsession">
      <p class="eyebrow">Entreno guardado</p>
      <h2 id="pshead">${esc(session.dayName)} completado 💪</h2>
      <div class="astats"><span><b>${session.durationMin}</b> min</span><span><b>${sets}</b> series</span><span><b>${session.exercises.length}</b> ejercicios</span></div>
      ${session.prs?.length ? `<p class="prs">🏆 Récord en ${session.prs.map(esc).join(', ')}</p>` : ''}
      <div id="pscoach" class="coachnote"><div class="bubble typing"><span></span><span></span><span></span></div><span class="muted small">El coach está viendo tu entreno…</span></div>
      <button class="btn primary big" data-act="closeModal">Listo</button>
    </div>`);
  try {
    const status = plan ? Object.fromEntries(exerciseStatus(plan, s.sessions).map((x) => [x.ex.name, x.ratio])) : {};
    const before = s.sessions.filter((x) => x.id !== sessionId);
    const res = await cloud.coach('post_session', {
      profile: s.profile,
      session: {
        dayName: session.dayName,
        weekLabel: info ? `Semana ${info.week} de ${WEEKS} · ${info.blockName} · ${info.label}` : 'Entreno libre',
        durationMin: session.durationMin,
        prs: session.prs,
        notes: session.notes,
        exercises: session.exercises.map((e) => {
          const lp = lastPerformance(before, e.name);
          return {
            name: e.name,
            sets: e.sets.map((x) => ({ kg: x.kg, reps: x.reps, rir: x.rir })),
            target: e.target,
            vsPlanPct: status[e.name] != null ? +((status[e.name] - 1) * 100).toFixed(1) : null,
            last: lp ? lp.ex.sets.filter((x) => x.done !== false).map((x) => `${x.kg}×${x.reps}`).join(', ') : '',
          };
        }),
      },
    });
    update((st) => { const ss = st.sessions.find((x) => x.id === sessionId); if (ss) ss.coach = { headline: res.headline, comment: res.comment }; });
    const box = $('#pscoach');
    if (box) {
      $('#pshead').textContent = res.headline || $('#pshead').textContent;
      box.innerHTML = `<span class="who">Coach</span><p>${md(res.comment)}</p>`;
    }
  } catch (err) {
    const box = $('#pscoach');
    if (box) box.innerHTML = `<p class="muted small">${esc(err.message)}</p>`;
  }
}

// ---------- Revisión del progreso (manual y semanal automática) ----------
function reviewPayload(plan, extra = {}) {
  const report = planReport(plan, db().sessions, today());
  return { report, payload: { profile: db().profile, plan: compactPlan(plan), report, weightText: weightText(), ...extra } };
}

function storeReview(plan, res, { week, kind, finished, question }) {
  const rev = {
    id: uid(), date: today(), week, block: weekInfo(plan, Math.min(week, WEEKS)).block, kind, finished, question: question || '',
    summary: res.summary, wins: res.wins || [], concerns: res.concerns || [], nextFocus: res.nextFocus || '',
    changes: res.changes || [], applied: [], failed: [], unseen: kind === 'weekly',
  };
  update((st) => {
    const p = st.plans.find((x) => x.id === plan.id);
    (p.reviews ||= []).unshift(rev);
    if (kind !== 'weekly') dismissRec(p, { key: finished ? 'fin' : 'bloque' }, today());
  });
  return rev;
}

export async function maybeWeeklyReview() {
  if (!COACH_ENABLED) return;
  if (weeklyRunning || !cloud.enabled || !cloud.user || !navigator.onLine) return;
  const s = db();
  const plan = activePlan();
  if (!plan || !s.settings.weeklyReview) return;
  const wk = currentWeek(plan);
  const lastWeek = wk - 1;
  if (lastWeek < 1 || lastWeek > WEEKS) return;
  const key = `${plan.id}:${lastWeek}`;
  if ((s.coach.weeklyDone || []).includes(key)) return;
  const trained = s.sessions.some((x) => x.planId === plan.id && weekOf(plan, x.date) === lastWeek);
  if (!trained) return;
  weeklyRunning = true;
  rerenderIfHome();
  try {
    const { report, payload } = reviewPayload(plan, { kind: 'weekly', reviewWeek: lastWeek });
    const res = await cloud.coach('review', payload);
    storeReview(plan, res, { week: lastWeek, kind: 'weekly', finished: report.finished });
    update((st) => (st.coach.weeklyDone = [...(st.coach.weeklyDone || []), key]));
  } catch (err) {
    console.warn('Revisión semanal pendiente:', err.message);
    if (/límite|no está activado/i.test(err.message)) update((st) => (st.coach.weeklyDone = [...(st.coach.weeklyDone || []), key]));
  } finally {
    weeklyRunning = false;
    rerenderIfHome();
  }
}

const rerenderIfHome = () => { if ((location.hash || '#hoy').startsWith('#hoy') && !$('#modal').innerHTML) rerender(); };

export function coachBanner() {
  if (!COACH_ENABLED) return '';
  if (!cloud.enabled || !cloud.user) return '';
  const plan = activePlan();
  const rev = plan?.reviews?.find((r) => r.unseen);
  if (rev) return `<button class="card recbanner coach" data-act="showReview" data-id="${rev.id}"><b>💬 Tu revisión de la semana ${rev.week} está lista</b><span class="muted small">${esc(rev.summary.slice(0, 110))}${rev.summary.length > 110 ? '…' : ''}</span></button>`;
  if (weeklyRunning) return `<div class="card recbanner coach"><b>💬 El coach está preparando tu revisión semanal…</b><span class="muted small">Te aviso aquí cuando esté lista.</span></div>`;
  return '';
}

function openReviewModal() {
  const plan = activePlan();
  if (!plan) return toast('Activa un plan primero.');
  const inPlan = db().sessions.filter((x) => x.planId === plan.id).length;
  const info = weekInfo(plan, currentWeek(plan));
  openModal(`<h2>Revisar mi progreso</h2>
    <p class="muted small">El coach analizará tus ${inPlan} entrenos de este plan (semana ${info.week} de ${WEEKS}): plan vs real por ejercicio, adherencia, volumen, peso y tus notas. Te propondrá cambios y tú eliges cuáles aplicar.</p>
    ${inPlan < 4 ? '<p class="hint">Aún tienes pocos entrenos en este plan: la revisión será más útil al final del bloque (semana 4).</p>' : ''}
    <label>¿Algo que quieras comentarle? <span class="muted">(opcional)</span><textarea id="revq" rows="3" placeholder="Me molesta el hombro en el press militar; los lunes solo tengo 45 min"></textarea></label>
    <button class="btn primary big" data-act="runReview">Revisar ahora</button>`);
}

async function runReview() {
  const plan = activePlan();
  const question = $('#revq')?.value.trim() || '';
  openModal(`<div class="loading"><div class="spinner"></div><h2>Revisando tu progreso…</h2><p class="muted">El coach está comparando lo planificado con lo que has levantado. Puede tardar hasta un minuto.</p></div>`, false);
  try {
    const { report, payload } = reviewPayload(plan, { kind: 'manual', question });
    const res = await cloud.coach('review', payload);
    const rev = storeReview(plan, res, { week: report.week, kind: 'manual', finished: report.finished, question });
    showReview(rev.id);
  } catch (err) {
    openModal(`<h2>No se pudo revisar</h2><p>${esc(err.message)}</p><button class="btn primary" data-act="closeModal">Cerrar</button>`);
  }
}

export function showReview(id) {
  const plan = activePlan();
  const r = (plan?.reviews || []).find((x) => x.id === id);
  if (!r) return;
  if (r.unseen) update((st) => { const rr = st.plans.find((p) => p.id === plan.id).reviews.find((x) => x.id === id); rr.unseen = false; });
  const failed = r.failed || [];
  const closed = (i) => r.applied.includes(i) || failed.includes(i);
  const pending = r.changes.some((_, i) => !closed(i));
  openModal(`
    <p class="eyebrow">${r.kind === 'weekly' ? 'Revisión semanal' : 'Revisión'} · semana ${r.week} · ${fmtDate(r.date)}</p>
    <h2>Cómo vas</h2>
    <p>${esc(r.summary)}</p>
    ${r.wins.length ? `<h3 class="rh">Lo que va bien</h3><ul class="rlist good">${r.wins.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${r.concerns.length ? `<h3 class="rh">A vigilar</h3><ul class="rlist warn">${r.concerns.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    <h3 class="rh">Cambios propuestos</h3>
    ${r.changes.length ? `<div class="changes">${r.changes.map((c, i) => `
      <label class="change ${closed(i) ? 'done' : ''}">
        <input type="checkbox" data-change="${i}" ${r.applied.includes(i) ? 'checked disabled' : failed.includes(i) ? 'disabled' : 'checked'}>
        <span><span class="ctitle">${CHANGE_LABEL[c.action]?.(c) || esc(c.action)}</span><span class="muted small">${esc(c.day)}${c.day ? ' · ' : ''}${esc(c.reason)}</span>${r.applied.includes(i) ? '<span class="chip good">Aplicado</span>' : failed.includes(i) ? '<span class="chip warn">No aplicable: no encontré ese ejercicio o día</span>' : ''}</span>
      </label>`).join('')}</div>` : '<p class="muted small">Ningún cambio: el plan va bien, sigue así.</p>'}
    ${r.nextFocus ? `<div class="hint"><b>Próximas semanas:</b> ${esc(r.nextFocus)}</div>` : ''}
    ${pending ? `<button class="btn primary big" data-act="applyReview" data-id="${r.id}">${r.finished ? 'Crear el siguiente plan con estos cambios' : 'Aplicar cambios seleccionados'}</button>` : r.finished && !r.changes.length ? `<button class="btn primary big" data-act="applyReview" data-id="${r.id}">Crear el siguiente plan</button>` : ''}
    <button class="btn ghost big" data-act="closeModal">${pending ? 'Ahora no' : 'Cerrar'}</button>
    <p class="muted small">Los cambios se aplican desde tu próximo entreno. Un ejercicio nuevo se calibra en su primera sesión.</p>`);
}

function refocus(p) { p.days.forEach((d) => { d.focus = [...new Set(d.exercises.map((e) => MUSCLES[e.muscle]))].slice(0, 4).join(', '); }); }

function applyReview(id) {
  const plan = activePlan();
  const r = plan.reviews.find((x) => x.id === id);
  const chosen = [...document.querySelectorAll('[data-change]')].filter((x) => x.checked && !x.disabled).map((x) => +x.dataset.change);
  const changes = chosen.map((i) => r.changes[i]);
  let results;
  if (r.finished) {
    // Plan terminado: el siguiente es una copia con los cambios, empezando hoy.
    const next = clone(plan);
    next.id = uid(); next.generation = (plan.generation || 1) + 1;
    next.name = plan.name.replace(/ · plan \d+$/, '') + ` · plan ${next.generation}`;
    next.createdAt = new Date().toISOString(); next.reviews = []; next.nextDay = 0; next.days.forEach((d) => (d.id = uid()));
    results = applyReviewChanges(next, changes);
    refocus(next);
    withProgram(next, plan.program.repMode);
    update((st) => { st.plans.push(next); st.activePlanId = next.id; st.plans.find((p) => p.id === plan.id).reviews.find((x) => x.id === id).applied.push(...chosen.filter((_, k) => results[k].ok)); });
    cloud.publish('plan', { planName: next.name, days: next.days.length, source: next.source });
    closeModal(); toast('Nuevo plan de 12 semanas creado'); return go('rutinas');
  }
  update((st) => {
    const p = st.plans.find((x) => x.id === plan.id);
    results = applyReviewChanges(p, changes);
    const rr = p.reviews.find((x) => x.id === id);
    rr.applied.push(...chosen.filter((_, k) => results[k].ok));
    rr.failed = [...(rr.failed || []), ...chosen.filter((_, k) => !results[k].ok)];
    refocus(p);
  });
  const bad = results.filter((x) => !x.ok).length;
  toast(bad ? `Aplicados ${results.length - bad}; ${bad} no se pudieron aplicar` : `${results.length} cambio${results.length === 1 ? '' : 's'} aplicado${results.length === 1 ? '' : 's'}`);
  rerender();
  showReview(id);
}

Object.assign(actions, {
  aiReview: () => (cloud.enabled && cloud.user ? openReviewModal() : toast('El coach necesita una cuenta.')),
  runReview: () => runReview(),
  showReview: (el) => showReview(el.dataset.id),
  applyReview: (el) => applyReview(el.dataset.id),
  sendChip: (el) => { if (waiting) return; (el.dataset.to === 'chat' ? sendChat : sendInterview)(el.dataset.text); },
  restartInterview: () => { if (!confirm('¿Empezar la conversación del plan desde cero?')) return; update((s) => (s.coach.interview = [])); viewCrear(); },
  newInterview: () => { if (db().coach.interview.length && !confirm('¿Empezar una conversación nueva para crear otro plan?')) return; update((s) => (s.coach.interview = [])); },
  clearChat: () => { update((s) => (s.coach.chat = [])); viewCoach(); },
  usePlan: (el) => {
    const proposal = db().coach.interview[+el.dataset.i]?.plan;
    if (!proposal) return;
    const plan = withProgram({ id: uid(), source: 'ia', createdAt: new Date().toISOString(), nextDay: 0, reviews: [], ...clone(proposal), days: proposal.days.map((d) => ({ id: uid(), ...clone(d) })) }, 'fases');
    const prev = activePlan();
    // Si el plan anterior aún no se ha entrenado, se reemplaza; si ya tiene entrenos, se guarda en "Otros planes".
    const replace = prev && !db().sessions.some((x) => x.planId === prev.id);
    update((s) => {
      if (replace) s.plans = s.plans.filter((p) => p.id !== prev.id);
      s.plans.push(plan); s.activePlanId = plan.id; s.coach.interview = []; s.coach.newPlanTip = false;
    });
    cloud.publish('plan', { planName: plan.name, days: plan.days.length, source: 'ia' });
    toast(replace ? 'Plan actualizado con tus ajustes' : '¡Plan nuevo listo! Empieza tu semana 1');
    go('hoy');
  },
  applyChat: (el) => {
    const i = +el.dataset.i;
    const msg = db().coach.chat[i];
    const plan = activePlan();
    if (!msg || !plan) return toast('Activa un plan primero.');
    const chosen = [...document.querySelectorAll(`[data-chat-change^="${i}:"]`)].filter((x) => x.checked && !x.disabled).map((x) => +x.dataset.chatChange.split(':')[1]);
    if (!chosen.length) return;
    let results;
    update((st) => {
      const p = st.plans.find((x) => x.id === plan.id);
      results = applyReviewChanges(p, chosen.map((k) => msg.changes[k]));
      refocus(p);
      const m = st.coach.chat[i];
      m.applied = [...(m.applied || []), ...chosen.filter((_, k) => results[k].ok)];
      m.failed = [...(m.failed || []), ...chosen.filter((_, k) => !results[k].ok)];
    });
    const bad = results.filter((x) => !x.ok).length;
    toast(bad ? `Aplicados ${results.length - bad}; ${bad} no se pudieron aplicar` : 'Plan actualizado');
    viewCoach();
  },
});
