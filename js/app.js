import { db, update, uid, today, activePlan, exportJSON, importJSON, parseBackup, resetAll, requestPersistence } from './db.js';
import { MUSCLES, GOALS, LEVELS, EQUIPMENT, EXERCISES, PRINCIPLES, PRIORITIES, exerciseDefaults, TIME_RANGES, timeRangeOf, timeLabel, estimateMinutes, generatePlan, SPLIT_OPTIONS, weeklyVolume, volumeTarget, suggestion, lastPerformance, e1rm, weightRateTarget, exerciseByName, MARK_LIFTS } from './science.js';
import { lineChart, volumeBars } from './charts.js';
import { reviewRoutine, applyFix } from './routine.js';
import { WEEKS, newProgram, ensureProgram, weekInfo, prescribe, unitOf, inUnit, fromUnit, numStr, fmtW, roundLoad, exerciseTrack, exerciseStatus, uniqueExercises, applyRec, dismissRec, blocksFor, planReport, applyReviewChanges } from './program.js';
import { $, esc, fmtDate, n1, clone, toast, openModal, closeModal, modalOpen, actions, routes, setRenderer, go, avatar } from './ui.js';
import { MODE_LABEL, SOURCE, withProgram, rxLabel, currentWeek, weekStart, weightStats, weightText, planRecs } from './domain.js';
import * as cloud from './cloud.js';
import * as lock from './lockscreen.js';
import { APP_NAME, COACH_ENABLED, ADJUST_ENABLED } from './config.js';
import { viewAuth, consumeInvite } from './auth.js';
import { viewAmigos, publishSession } from './social.js';
import { viewCoach, viewCrear, runPostSession, maybeWeeklyReview, coachBanner } from './coachui.js';

const main = $('#main');

let draft = null;          // rutina en edición
let pickerCb = null;       // callback del selector de ejercicios
let restTimer = null;      // temporizador de descanso
let progressExercise = ''; // ejercicio seleccionado en Progreso
let planExercise = '';     // ejercicio seleccionado en Plan vs real
let booted = false;

// ---------- Navegación ----------
Object.assign(routes, { hoy: viewHoy, entreno: viewEntreno, rutinas: viewRutinas, progreso: viewProgreso, perfil: viewPerfil, editar: viewEditar, dividir: viewSplit, amigos: viewAmigos, coach: viewCoach, crear: viewCrear });

function render() {
  if (!booted) return;
  const s = db();
  const route = (location.hash.slice(1) || 'hoy').split('/')[0];
  const needsAuth = cloud.enabled && (!cloud.user || cloud.needsUsername());
  document.body.classList.toggle('onboarding', needsAuth || !s.profile);
  if (needsAuth) return viewAuth();
  if (!s.profile) return viewOnboarding();
  if (s.plans.some((p) => !p.program)) update((st) => st.plans.forEach((p) => ensureProgram(p, st.profile)));
  if ((route === 'crear' || route === 'dividir') && !s.plans.length) document.body.classList.add('onboarding');
  if (!COACH_ENABLED && (route === 'coach' || route === 'crear')) { location.replace('#hoy'); return; }
  (routes[route] || viewHoy)();
  addProfileButton(route);
  if (route === 'hoy' && s.plans.length && !s.settings.tourDone && !s.activeSession && !modalOpen()) openTour(0);
  const coachTab = document.querySelector('.nav a[href="#coach"]');
  if (coachTab) coachTab.hidden = !COACH_ENABLED;
  document.querySelectorAll('.nav a').forEach((a) => { const on = a.getAttribute('href') === '#' + route; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  renderRestBar();
  if (!modalOpen()) window.scrollTo(0, 0);
}
setRenderer(render);

// Acceso a Perfil (y a cerrar sesión) desde la esquina de cada pantalla.
function addProfileButton(route) {
  const top = main.querySelector('header.top');
  if (!top || top.querySelector('.me') || ['perfil', 'entreno', 'editar'].includes(route)) return;
  const btn = `<a href="#perfil" class="me" aria-label="Tu perfil y cerrar sesión">${avatar(cloud.me?.display_name || db().profile?.name)}</a>`;
  if (top.children.length >= 2) {
    const right = top.lastElementChild;
    const wrap = document.createElement('div');
    wrap.className = 'topright';
    top.replaceChild(wrap, right);
    wrap.append(right);
    wrap.insertAdjacentHTML('beforeend', btn);
  } else top.insertAdjacentHTML('beforeend', btn);
}
window.addEventListener('hashchange', render);

// Números escritos con coma o punto ("57,5" o "57.5"). Vacío o inválido → null.
const parseNum = (v) => { const t = String(v ?? '').trim().replace(',', '.'); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
// Unidad en que se muestran y se escriben los pesos de un ejercicio (kg o lb).
const unitFor = (name) => unitOf(db().profile, name);

// ---------- Onboarding ----------
function profileForm(p = {}) {
  const opt = (obj, v) => Object.entries(obj).map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('');
  return `
  <label>Nombre<input name="name" value="${esc(p.name)}" placeholder="Tu nombre" autocomplete="given-name"></label>
  <div class="row2">
    <label>Peso (kg)<input name="weight" type="text" inputmode="decimal" value="${esc(p.weight === undefined || p.weight === '' ? '' : numStr(p.weight))}" required></label>
    <label>Altura (cm)<input name="height" type="number" inputmode="numeric" value="${esc(p.height)}"></label>
  </div>
  <div class="row2">
    <label>Edad<input name="age" type="number" inputmode="numeric" value="${esc(p.age)}"></label>
    <label>Sexo<select name="sex" required>${p.sex ? '' : '<option value="" selected disabled>Elige…</option>'}${opt({ hombre: 'Hombre', mujer: 'Mujer', otro: 'Prefiero no decir' }, p.sex)}</select></label>
  </div>
  <label>Objetivo principal<select name="goal" required>${p.goal ? '' : '<option value="" selected disabled>Elige…</option>'}${opt(GOALS, p.goal)}</select></label>
  <p class="muted small goalhelp"><b>Ganar músculo:</b> verte más grande y marcado. <b>Ganar fuerza:</b> levantar más peso. <b>Perder grasa:</b> bajar de peso sin perder músculo. <b>Recomposición:</b> bajar grasa y ganar algo de músculo a la vez. <b>Salud y forma:</b> tonificar, sentirte fuerte y moverte mejor.</p>
  <label>Experiencia entrenando<select name="level" required>${p.level ? '' : '<option value="" selected disabled>Elige…</option>'}${opt(LEVELS, p.level)}</select></label>
  <div class="row2">
    <label>Días por semana<select name="days">${[2, 3, 4, 5, 6].map((d) => `<option ${Number(p.days || 4) === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
    <label>Tiempo por entreno<select name="time">${Object.keys(TIME_RANGES).map((r) => `<option value="${r}" ${timeRangeOf({ time: p.time, minutes: p.minutes || 75 }) === r ? 'selected' : ''}>${timeLabel(r)}</option>`).join('')}</select></label>
  </div>
  <label>Las pesas de tu gimnasio están en<select name="unit">${opt({ kg: 'Kilos (kg)', lb: 'Libras (lb)' }, p.unit || 'kg')}</select></label>
  <p class="muted small">Si alguna máquina usa la otra unidad, la cambias en ese ejercicio durante el entreno.</p>
  <fieldset class="prios"><legend>¿Qué quieres priorizar? <span class="muted">(opcional, máximo 2)</span></legend>
    ${Object.entries(PRIORITIES).map(([k, v]) => `<label class="pchip"><input type="checkbox" name="prio" value="${k}" ${(p.priorities || []).includes(k) ? 'checked' : ''}><span>${v.label}</span></label>`).join('')}
  </fieldset>
  <label>Lesiones o limitaciones <span class="muted">(opcional)</span><input name="injuries" value="${esc(p.injuries)}" placeholder="Ej.: molestia en hombro derecho"></label>
  <p class="muted small">Por ahora la app no elige ejercicios según esto. Si algo te molesta, cámbialo con ⇄ en el entreno o con «Pídenos cambios».</p>
  <details class="marks" ${Object.values(p.marks || {}).some((v) => v > 0) ? 'open' : ''}><summary>¿Ya sabes cuánto levantas? <span class="muted">(opcional)</span></summary>
    <p class="muted small">Tu máximo a 1 repetición, aproximado, en la unidad que elegiste arriba. Con esto los pesos sugeridos arrancan a tu nivel. Si no lo sabes, déjalo vacío: la app lo calcula en tu primer entreno.</p>
    <div class="row3">${Object.entries(MARK_LIFTS).map(([k, l]) => `<label>${l}<input name="mk_${k}" type="text" inputmode="decimal" value="${p.marks?.[k] ? numStr(inUnit(p.marks[k], p.unit || 'kg')) : ''}"></label>`).join('')}</div>
  </details>`;
}

function readProfile(form) {
  const fd = new FormData(form);
  const f = Object.fromEntries(fd);
  delete f.prio;
  const unit = f.unit === 'lb' ? 'lb' : 'kg';
  const marks = {};
  for (const k of Object.keys(MARK_LIFTS)) { const v = parseNum(f[`mk_${k}`]); if (v > 0) marks[k] = fromUnit(v, unit); delete f[`mk_${k}`]; }
  const time = TIME_RANGES[f.time] ? f.time : '60-75';
  return { ...f, marks, unit, equipment: 'gym', time, priorities: fd.getAll('prio').slice(0, 2), weight: parseNum(f.weight) || 0, height: Number(f.height) || '', age: Number(f.age) || '', days: Number(f.days), minutes: TIME_RANGES[time][1] };
}

function viewOnboarding() {
  const name = cloud.me?.display_name?.split(' ')[0] || '';
  main.innerHTML = `
  <section class="hero">
    <div class="logo">${APP_NAME}</div>
    <h1>${name ? `Hola, ${esc(name)}` : 'Tu entrenador de bolsillo'}</h1>
    <p class="muted">Cuéntanos lo básico para sugerirte los pesos correctos y armar tu rutina con base científica.</p>
  </section>
  <form id="onb" class="card form">${profileForm({ name })}
    <button class="btn primary big" type="submit">Continuar</button>
  </form>`;
  $('#onb').addEventListener('change', (e) => {
    // Máximo 2 prioridades: más que eso deja de ser prioridad.
    if (e.target.name !== 'prio') return;
    const on = [...e.target.form.querySelectorAll('input[name=prio]:checked')];
    if (on.length > 2) { e.target.checked = false; toast('Elige máximo 2 prioridades'); }
  });
  $('#onb').addEventListener('submit', (e) => {
    e.preventDefault();
    const p = readProfile(e.target);
    update((s) => {
      s.profile = p;
      s.weights.push({ id: uid(), date: today(), kg: p.weight });
    });
    requestPersistence();
    viewStart();
  });
}

function generateSciencePlan() {
  const plan = withProgram(generatePlan(db().profile));
  update((s) => { s.plans.push(plan); s.activePlanId = plan.id; });
  sharePlan(plan);
  toast('Rutina de 12 semanas creada');
  return plan;
}

// ---------- Guía rápida (sale una vez; se puede volver a ver desde Perfil) ----------
function tourSteps() {
  const ai = ADJUST_ENABLED && cloud.enabled;
  return [
    { tab: 'hoy', icon: '🏋️', title: 'Hoy', text: 'Aquí está el entreno que te toca, con el peso sugerido para cada ejercicio. Tocas <b>Empezar</b> y la app te lleva serie por serie, con el descanso cronometrado.' },
    { tab: 'rutinas', icon: '📋', title: 'Rutina', text: `Tus días y ejercicios. Puedes editarlos, elegir cómo progresar o importar otra rutina desde un PDF o fotos.${ai ? ' ¿No te gusta algo? Toca <b>Pídenos cambios</b> y la IA la ajusta.' : ''}` },
    cloud.enabled && { tab: 'amigos', icon: '🤝', title: 'Amigos', text: 'Invita a tu parche con tu link. Ves sus entrenos y récords, y les das <b>fuerzas</b> 💪 cuando entrenan.' },
    { tab: 'progreso', icon: '📈', title: 'Progreso', text: 'Tus récords, tu peso corporal y cómo vas subiendo en cada ejercicio, semana a semana.' },
  ].filter(Boolean);
}
function openTour(i = 0) {
  const steps = tourSteps();
  const st = steps[i], last = i === steps.length - 1;
  const tabs = [...document.querySelectorAll('.nav a')].filter((a) => !a.hidden)
    .map((a) => `<span class="${a.getAttribute('href') === '#' + st.tab ? 'on' : ''}">${a.innerHTML}</span>`).join('');
  openModal(`<div class="tour">
    <p class="eyebrow">Guía rápida · ${i + 1} de ${steps.length}</p>
    <div class="tourico" aria-hidden="true">${st.icon}</div>
    <h2>${st.title}</h2>
    <p>${st.text}</p>
    <p class="muted small">Lo encuentras en la barra de abajo:</p>
    <div class="tournav" aria-hidden="true">${tabs}</div>
    ${last ? `<p class="small tourme">${avatar(cloud.me?.display_name || db().profile?.name)}<span>Arriba a la derecha está tu <b>Perfil</b>: ahí cambias kg o lb, invitas amigos y puedes ver esta guía otra vez.</span></p>` : ''}
    <div class="dots" aria-hidden="true">${steps.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('')}</div>
    <div class="actions">
      ${i > 0 ? `<button class="btn ghost" data-act="tourGo" data-i="${i - 1}">Atrás</button>` : '<button class="btn ghost" data-act="tourEnd">Saltar</button>'}
      ${last ? '<button class="btn primary" data-act="tourEnd">¡A entrenar!</button>' : `<button class="btn primary" data-act="tourGo" data-i="${i + 1}">Siguiente</button>`}
    </div>
  </div>`, false);
}

// ---------- Hoy ----------
function viewHoy() {
  const s = db();
  const plan = activePlan();
  const ws = weightStats();
  const weekCount = s.sessions.filter((x) => new Date(x.date + 'T12:00:00') >= weekStart()).length;
  const day = plan?.days[(plan.nextDay || 0) % plan.days.length];
  const wk = plan ? currentWeek(plan) : 1;
  const info = plan ? weekInfo(plan, wk) : null;
  const recs = planRecs(plan).filter((r) => r.level !== 'info' || r.key === 'fin');
  const hour = new Date().getHours();
  const hi = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  const [rlo, rhi] = weightRateTarget(s.profile.goal);
  const rateOk = ws?.rate != null && ws.rate >= rlo - 0.05 && ws.rate <= rhi + 0.05;

  main.innerHTML = `
  <header class="top"><div><p class="muted">${hi}${s.profile.name ? ', ' + esc(s.profile.name) : ''} · ${new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1>Hoy</h1></div><a href="#perfil" class="me" aria-label="Tu perfil">${avatar(cloud.me?.display_name || s.profile.name)}</a></header>

  ${coachBanner()}

  ${s.activeSession ? `
  <section class="card accent">
    <p class="eyebrow">Entreno en curso</p>
    <h2>${esc(s.activeSession.dayName)}</h2>
    <p class="muted">${s.activeSession.exercises.reduce((a, e) => a + e.sets.filter((x) => x.done).length, 0)} series hechas</p>
    <a class="btn primary big" href="#entreno">Continuar</a>
  </section>` : day ? `
  <section class="card accent">
    <p class="eyebrow">${info.mode === 'doble' ? `Semana ${info.week} · ${esc(plan.name)}` : `Semana ${info.week} de ${WEEKS} · Bloque ${info.block}: ${esc(info.blockName)}`}</p>
    ${info.deload && info.mode !== 'doble' ? '<p class="small">🔋 <b>Semana de descarga:</b> más liviana a propósito, para recuperarte y seguir subiendo después.</p>' : ''}
    <h2>${esc(day.name)}</h2>
    <p class="muted">${info.deload ? '🔋 ' : ''}${info.mode === 'doble' ? '' : esc(info.label) + ' · '}⏱ ≈ ${estimateMinutes(day)} min · ${esc(day.focus || '')}</p>
    <ul class="mini">${day.exercises.map((e) => { const rx = prescribe(plan, s.sessions, e, wk, s.profile); return `<li><span>${esc(e.name)}</span><span class="muted">${rxLabel(rx, unitOf(s.profile, e.name))}</span></li>`; }).join('')}</ul>
    <div class="actions"><button class="btn primary big" data-act="start" data-day="${day.id}">Empezar entreno</button></div>
    ${plan.days.length > 1 ? `<button class="link" data-act="skipDay">Hacer otro día</button>` : ''}
  </section>` : `
  <section class="card"><h2>Aún no tienes rutina</h2><p class="muted">Créala en un minuto o arma la tuya.</p><a class="btn primary" href="#rutinas">Crear mi rutina</a></section>`}

  ${s.coach.newPlanTip && plan && !s.activeSession && !s.sessions.some((x) => x.planId === plan.id) ? `
  <section class="card newplan">
    <p class="eyebrow">Tu rutina</p>
    <h3>${esc(plan.name)}</h3>
    <p class="small">${plan.days.length} días por semana, con el peso sugerido para cada ejercicio. ¿Quieres cambiar ejercicios, series o repeticiones? Edítala cuando quieras: la app revisa que siga balanceada.</p>
    <div class="actions wrap"><button class="btn ghost sm" data-act="editActive">Editar rutina</button>${ADJUST_ENABLED && cloud.enabled ? `<button class="btn ghost sm" data-act="askChanges" data-plan="${plan.id}">💬 Pídenos cambios</button>` : ''}<button class="btn ghost sm" data-act="tipDone">Así está bien</button></div>
  </section>` : ''}

  ${recs.length ? `<a class="card recbanner ${recs[0].level}" href="#rutinas"><b>${esc(recs[0].title)}</b><span class="muted small">${recs.length > 1 ? `y ${recs.length - 1} ajuste${recs.length > 2 ? 's' : ''} más · ` : ''}Ver en tu rutina ›</span></a>` : ''}

  <section class="stats">
    <div class="stat"><span class="eyebrow">Esta semana</span><b>${weekCount}<small> / ${s.profile.days}</small></b><span class="muted">entrenos</span></div>
    <div class="stat"><span class="eyebrow">Peso (media 7 d)</span><b>${ws ? n1(ws.nowAvg) : '—'}<small> kg</small></b>
      <span class="${ws?.rate == null ? 'muted' : rateOk ? 'good' : 'warn'}">${ws?.rate == null ? 'Registra más días' : (ws.rate > 0 ? '+' : '') + n1(ws.rate) + ' %/sem'}</span></div>
  </section>

  <section class="card">
    <h3>Registrar peso de hoy</h3>
    <form id="wform" class="inline">
      <input name="kg" type="text" inputmode="decimal" placeholder="${ws ? n1(ws.last.kg) : 'kg'}" required aria-label="Peso en kg">
      <button class="btn primary" type="submit">Guardar</button>
    </form>
    <p class="muted small">Pésate en ayunas, después de ir al baño. La media de 7 días elimina el ruido diario.</p>
  </section>
  ${cloud.enabled ? '<button class="link center-block" data-act="feedback">💬 ¿Algo no funciona o tienes una idea? Cuéntanos</button>' : ''}`;

  $('#wform').addEventListener('submit', (e) => {
    e.preventDefault();
    const kg = parseNum(new FormData(e.target).get('kg'));
    if (!kg) return toast('Escribe tu peso, p. ej. 78,5');
    update((s2) => {
      const d = today();
      const ex = s2.weights.find((w) => w.date === d);
      if (ex) ex.kg = kg; else s2.weights.push({ id: uid(), date: d, kg });
      s2.profile.weight = kg;
    });
    toast('Peso guardado');
    render();
  });
  maybeWeeklyReview();
}

// ---------- Entreno ----------
function startSession(dayId) {
  const plan = activePlan();
  const s = db();
  const day = plan?.days.find((d) => d.id === dayId);
  const exs = day ? day.exercises : [];
  const wk = plan ? currentWeek(plan) : null;
  update((st) => {
    st.activeSession = {
      id: uid(),
      planId: plan?.id || null,
      dayId: day?.id || null,
      dayName: day?.name || 'Entreno libre',
      week: day ? weekInfo(plan, wk).week : null,
      startedAt: Date.now(),
      date: today(),
      exercises: exs.map((e) => sessionExercise(e, plan, wk, s.sessions)),
    };
  });
  go('entreno');
}

// Ejercicio listo para registrar: usa la prescripción de la semana del plan, o progresión doble si es entreno libre.
function sessionExercise(e, plan, wk, sessions) {
  if (plan && wk) {
    const rx = prescribe(plan, sessions, e, wk, db().profile);
    return {
      name: e.name, muscle: e.muscle, sec: e.sec, kind: e.kind, notes: e.notes,
      target: { sets: rx.sets, repMin: rx.repMin, repMax: rx.repMax, rir: rx.rir, restSec: rx.restSec, kg: rx.kg, reps: rx.targetReps },
      hint: rx.text,
      sets: Array.from({ length: rx.sets }, () => ({ kg: rx.kg ?? lastKg(sessions, e.name), reps: '', rir: '', done: false })),
    };
  }
  const sug = suggestion(sessions, e, e.name, unitFor(e.name));
  return {
    name: e.name, muscle: e.muscle, sec: e.sec, kind: e.kind, notes: e.notes,
    target: { sets: e.sets, repMin: e.repMin, repMax: e.repMax, rir: e.rir, restSec: e.restSec },
    hint: sug.text,
    sets: Array.from({ length: e.sets }, () => ({ kg: sug.kg ?? '', reps: '', rir: '', done: false })),
  };
}

function lastKg(sessions, name) {
  const l = lastPerformance(sessions, name);
  return l ? Math.max(...l.ex.sets.map((x) => Number(x.kg) || 0)) || '' : '';
}

function viewEntreno() {
  const s = db();
  const a = s.activeSession;
  if (!a) {
    const plan = activePlan();
    main.innerHTML = `
    <header class="top"><h1>Entrenar</h1></header>
    ${plan ? `<p class="muted">Elige el día de <b>${esc(plan.name)}</b>:</p>
    <div class="list">${plan.days.map((d, i) => `
      <button class="card daypick" data-act="start" data-day="${d.id}">
        <span><b>${esc(d.name)}</b>${i === (plan.nextDay || 0) % plan.days.length ? ' <span class="pill sm">Toca hoy</span>' : ''}<br><span class="muted small">${d.exercises.length} ejercicios · ≈ ${estimateMinutes(d)} min · ${esc(d.focus || '')}</span></span><span class="chev">›</span>
      </button>`).join('')}</div>` : ''}
    <button class="btn ghost big" data-act="start" data-day="">Entreno libre</button>`;
    return;
  }
  const done = a.exercises.reduce((x, e) => x + e.sets.filter((z) => z.done).length, 0);
  const total = a.exercises.reduce((x, e) => x + e.sets.length, 0);
  main.innerHTML = `
  <header class="top"><div><p class="eyebrow">${a.week ? `Semana ${a.week} · ` : ''}En curso · <span id="elapsed"></span></p><h1>${esc(a.dayName)}</h1></div>
    <button class="btn ghost sm" data-act="cancelSession">Descartar</button></header>
  <div class="progress"><span style="width:${total ? (done / total) * 100 : 0}%"></span></div>
  ${!s.settings.workoutTipsDone ? firstWorkoutTips(s) : lock.canNotify() && Notification.permission === 'default' && !s.settings.notifyAsked ? `<section class="card tipcard"><p class="small"><b>🔔 ¿Te avisamos cuando termine el descanso?</b> Si sales de la app, te llega una notificación (en iPhone puede no llegar con la pantalla bloqueada).</p>
    <div class="actions wrap"><button class="btn primary sm" data-act="enableNotify">Sí, avisarme</button><button class="btn ghost sm" data-act="skipNotify">Ahora no</button></div></section>` : ''}
  ${a.exercises.map((e, i) => exerciseCard(e, i, s)).join('')}
  <button class="btn ghost big" data-act="pickForSession">+ Agregar ejercicio</button>
  <label class="notes">Notas del entreno<textarea id="snotes" rows="2" placeholder="Cómo te sentiste, molestias, etc.">${esc(a.notes)}</textarea></label>
  <button class="btn primary big" data-act="finish">Terminar entreno</button>`;
  $('#snotes').addEventListener('change', (ev) => update((st) => (st.activeSession.notes = ev.target.value)));
  tickElapsed();
}

function firstWorkoutTips(s) {
  const u = s.profile?.unit === 'lb' ? 'lb' : 'kg';
  const other = u === 'lb' ? 'kilos' : 'libras';
  return `<section class="card tipcard firsttips">
    <p class="eyebrow">Así funciona el entreno</p>
    <ul class="small">
      <li><b>Calienta primero:</b> 5 minutos suaves (caminadora o bici) y una serie liviana del primer ejercicio.</li>
      <li><b>¿No conoces un ejercicio?</b> Toca <b>▶ Ver cómo se hace</b> debajo de su nombre.</li>
      <li><b>Toca ✓ al terminar cada serie.</b> Arranca el descanso solo y te avisa cuando acabe.</li>
      <li><b>El peso sugerido ya viene puesto.</b> Si hiciste lo que dice, solo toca ✓. Si no, escribe tu peso y tus reps antes. «3 × 10» quiere decir 3 series de 10 repeticiones.</li>
      <li><b>RIR</b> son las reps que te quedaron en reserva: cuántas más podías hacer.</li>
      <li><b>¿Máquina ocupada?</b> Toca <b>⇄ Cambiar ejercicio</b> y elige otro para el mismo músculo.</li>
      <li><b>¿Esa máquina está en ${other}?</b> Toca <b>${u} ⇄</b> en el ejercicio y cambia la unidad solo para ese.</li>
    </ul>
    <button class="btn primary sm" data-act="tipsDone">Entendido</button>
  </section>`;
}

function exerciseCard(e, i, s) {
  const last = lastPerformance(s.sessions, e.name);
  const u = unitFor(e.name);
  const w = (kg) => (kg === '' || kg == null ? '' : numStr(inUnit(kg, u)));
  const lastTxt = last ? `${last.ex.sets.filter((x) => x.done).map((x) => `${w(x.kg)}×${x.reps}`).join(', ')} (${u})` : '';
  return `
  <section class="card ex ${e.sets.every((x) => x.done) ? 'complete' : ''}">
    <div class="exhead">
      <div><h3>${esc(e.name)}</h3><a class="howto" href="https://www.youtube.com/results?search_query=${encodeURIComponent(`cómo hacer ${e.name} técnica`)}" target="_blank" rel="noopener">▶ Ver cómo se hace</a>
      <p class="muted small">${MUSCLES[e.muscle] || ''} · ${e.target.sets}×${e.target.repMin}–${e.target.repMax} · RIR ${e.target.rir} · descanso ${restLabel(e.target.restSec)}</p></div>
      <button class="icon" data-act="removeEx" data-ex="${i}" aria-label="Quitar ejercicio">✕</button>
    </div>
    ${e.hint ? `<p class="hint">↗ ${esc(e.hint)}</p>` : ''}
    ${lastTxt ? `<p class="muted small">Última vez (${fmtDate(last.date)}): ${esc(lastTxt)}</p>` : ''}
    ${e.notes ? `<p class="muted small">ℹ ${esc(e.notes)}</p>` : ''}
    <div class="sets">
      <div class="sethead"><span>#</span><button class="unitbtn" data-act="exUnit" data-ex="${i}" aria-label="Cambiar unidad de ${esc(e.name)}">${u} ⇄</button><span>reps</span><span>RIR</span><span></span></div>
      ${e.sets.map((st, j) => `
      <div class="set ${st.done ? 'done' : ''}">
        <span class="num">${j + 1}</span>
        <input type="text" inputmode="decimal" value="${w(st.kg)}" data-bind="kg" data-ex="${i}" data-set="${j}" aria-label="Peso en ${u === 'lb' ? 'libras' : 'kilos'}, serie ${j + 1}">
        <input type="number" inputmode="numeric" value="${esc(st.reps)}" placeholder="${e.target.reps ?? `${e.target.repMin}–${e.target.repMax}`}" data-bind="reps" data-ex="${i}" data-set="${j}" aria-label="Repeticiones serie ${j + 1}">
        <input type="number" inputmode="numeric" value="${esc(st.rir)}" placeholder="${e.target.rir}" data-bind="rir" data-ex="${i}" data-set="${j}" aria-label="RIR serie ${j + 1}">
        <button class="check" data-act="toggleSet" data-ex="${i}" data-set="${j}" aria-pressed="${!!st.done}" aria-label="Serie ${j + 1} hecha">✓</button>
      </div>`).join('')}
    </div>
    <div class="exfoot"><button class="link" data-act="addSet" data-ex="${i}">+ Serie</button>${e.sets.length > 1 ? `<button class="link" data-act="delSet" data-ex="${i}">− Serie</button>` : ''}<button class="link swap" data-act="swapEx" data-ex="${i}">⇄ Cambiar ejercicio</button></div>
  </section>`;
}

// ---------- Cambiar un ejercicio durante el entreno (máquina ocupada, etc.) ----------
const EQUIP_LABEL = { barra: 'barra', mancuernas: 'mancuernas', maquina: 'máquina', polea: 'polea', barra_fija: 'barra fija / paralelas', peso_corporal: 'peso corporal' };
// Primero el mismo movimiento con otro equipo; luego otros ejercicios del mismo músculo.
function alternatives(name, muscle) {
  const lib = exerciseByName(name);
  const m = lib?.muscle || muscle;
  const ok = (e) => e.name !== name && inGym(e);
  const same = lib ? EXERCISES.filter((e) => ok(e) && e.pattern === lib.pattern) : [];
  const more = EXERCISES.filter((e) => ok(e) && e.muscle === m && !same.includes(e));
  return { same, more };
}
let swapIdx = null;
function openSwap(i) {
  swapIdx = i;
  const e = db().activeSession.exercises[i];
  const { same, more } = alternatives(e.name, e.muscle);
  const item = (x) => `<button class="pitem" data-act="swapTo" data-name="${esc(x.name)}">${esc(x.name)}<span class="muted small">${EQUIP_LABEL[x.equip] || ''}</span></button>`;
  const inPlan = !!db().plans.find((p) => p.id === db().activeSession.planId)?.days.some((d) => d.exercises.some((x) => x.name === e.name));
  openModal(`<p class="eyebrow">Cambiar ejercicio</p><h2>${esc(e.name)}</h2>
    <p class="muted small">¿Máquina ocupada o prefieres otro? Elige el reemplazo. Se mantienen tus series, repeticiones y RIR${e.sets.some((x) => x.done) ? '; las series que ya hiciste quedan guardadas' : ''}.</p>
    ${inPlan ? `<label class="switch"><input type="checkbox" id="swapPerm"> Cambiarlo también en mi rutina (desde ahora)</label>` : ''}
    ${same.length ? `<p class="eyebrow">Mismo movimiento</p>${same.map(item).join('')}` : ''}
    ${more.length ? `<p class="eyebrow">Otros de ${(MUSCLES[e.muscle] || '').toLowerCase()}</p>${more.map(item).join('')}` : ''}
    <button class="btn ghost big" data-act="swapSearch">Buscar otro ejercicio</button>`);
}
function swapExercise(lib, permArg) {
  const i = swapIdx;
  const perm = permArg ?? !!$('#swapPerm')?.checked;
  closeModal();
  const a = db().activeSession;
  const old = a.exercises[i];
  const plan = db().plans.find((p) => p.id === a.planId);
  const day = plan?.days.find((d) => d.id === a.dayId);
  const def = day?.exercises.find((x) => x.name === old.name);
  // El reemplazo hereda el esquema (series, rango, RIR, descanso) del ejercicio original.
  const scheme = def || { sets: old.target.sets, repMin: old.target.repMin, repMax: old.target.repMax, rir: old.target.rir, restSec: old.target.restSec };
  const base = { ...scheme, name: lib.name, muscle: lib.muscle, sec: lib.sec || [], kind: lib.kind, notes: '' };
  const fresh = sessionExercise(base, def ? plan : null, def ? currentWeek(plan) : null, db().sessions);
  if (!perm) fresh.swappedFrom = old.swappedFrom || old.name; // cambio solo por hoy: se respeta si editas la rutina
  const doneSets = old.sets.filter((x) => x.done).length;
  update((st) => {
    const exs = st.activeSession.exercises;
    if (doneSets) {
      // Lo hecho queda con el ejercicio original; lo que falta pasa al nuevo.
      fresh.sets = fresh.sets.slice(0, Math.max(1, old.sets.length - doneSets));
      exs[i].sets = exs[i].sets.filter((x) => x.done);
      exs.splice(i + 1, 0, fresh);
    } else exs[i] = fresh;
    if (perm && def) {
      const p = st.plans.find((x) => x.id === a.planId);
      const d = p.days.find((x) => x.id === a.dayId);
      const k = d.exercises.findIndex((x) => x.name === old.name);
      if (k >= 0) d.exercises[k] = { ...d.exercises[k], name: lib.name, muscle: lib.muscle, sec: lib.sec || [], kind: lib.kind, notes: '' };
    }
  });
  toast(perm && def ? `Cambiado por ${lib.name}, también en tu rutina` : `Cambiado por ${lib.name} solo por hoy`);
  viewEntreno();
}

// Rehace el entreno en curso según el día editado: mismo orden y ejercicios que la rutina nueva.
// Los ejercicios que siguen se conservan con lo que ya registraste; los nuevos llegan con su sugerencia;
// los que quitaste desaparecen, salvo que ya tengan series hechas.
function syncSessionWithDay(plan, day) {
  const s = db();
  const cur = s.activeSession.exercises;
  const wk = currentWeek(plan);
  const next = day.exercises.flatMap((def) => {
    const had = cur.find((x) => x.name === def.name);
    // Si hoy lo cambiaste por otro (máquina ocupada), se mantiene el reemplazo y lo ya hecho en el original.
    const swapped = cur.find((x) => x.swappedFrom === def.name);
    if (swapped) return [...(had?.sets.some((z) => z.done) ? [{ ...had, sets: had.sets.filter((z) => z.done) }] : []), swapped];
    const fresh = sessionExercise(def, plan, wk, s.sessions);
    if (!had) return fresh;
    // Conserva lo registrado y ajusta el número de series pendientes a la rutina nueva.
    const done = had.sets.filter((x) => x.done);
    const pending = had.sets.filter((x) => !x.done).slice(0, Math.max(0, fresh.sets.length - done.length));
    while (done.length + pending.length < fresh.sets.length) pending.push({ kg: fresh.target.kg ?? pending.at(-1)?.kg ?? done.at(-1)?.kg ?? '', reps: '', rir: '', done: false });
    return { ...fresh, sets: [...done, ...pending] };
  });
  const extra = cur.filter((x) => !day.exercises.some((d) => d.name === x.name || d.name === x.swappedFrom) && x.sets.some((z) => z.done)).map((x) => ({ ...x, sets: x.sets.filter((z) => z.done) }));
  update((st) => { st.activeSession.exercises = [...next, ...extra]; st.activeSession.dayName = day.name; });
}

const restLabel = (sec) => (sec < 120 ? `${sec} s` : `${String(Math.round((sec / 60) * 10) / 10).replace('.', ',')} min`);

function tickElapsed() {
  const el = $('#elapsed');
  const a = db().activeSession;
  if (!el || !a) return;
  const m = Math.floor((Date.now() - a.startedAt) / 60000);
  el.textContent = `${m} min`;
  clearTimeout(tickElapsed.t);
  tickElapsed.t = setTimeout(tickElapsed, 30000);
}

function finishSession() {
  const s = db();
  const a = s.activeSession;
  const exs = a.exercises.map((e) => ({ ...e, sets: e.sets.filter((x) => x.done) })).filter((e) => e.sets.length);
  if (!exs.length) { if (!confirm('No marcaste ninguna serie. ¿Descartar el entreno?')) return; update((st) => (st.activeSession = null)); stopRest(); lock.stop(); return go('hoy'); }
  const pending = a.exercises.reduce((n, e) => n + e.sets.filter((x) => !x.done).length, 0);
  if (pending && !confirm(`Te ${pending === 1 ? 'falta 1 serie' : `faltan ${pending} series`} sin marcar. ¿Terminar el entreno igual? (Las que no marcaste no se guardan.)`)) return;
  // Récords personales (por e1RM estimado)
  const prs = [];
  for (const e of exs) {
    const best = Math.max(...e.sets.map((x) => e1rm(Number(x.kg), Number(x.reps))));
    const prev = Math.max(0, ...s.sessions.flatMap((ss) => ss.exercises.filter((z) => z.name === e.name).flatMap((z) => z.sets.map((x) => e1rm(Number(x.kg), Number(x.reps))))));
    if (best > 0 && prev > 0 && best > prev) prs.push(e.name);
  }
  const session = { id: a.id, date: a.date, planId: a.planId, dayId: a.dayId, dayName: a.dayName, week: a.week || null, durationMin: Math.round((Date.now() - a.startedAt) / 60000), notes: a.notes || '', exercises: exs.map(({ hint, ...rest }) => rest), prs };
  update((st) => {
    st.sessions.push(session);
    st.activeSession = null;
    const plan = st.plans.find((p) => p.id === a.planId);
    if (plan && a.dayId) {
      const idx = plan.days.findIndex((d) => d.id === a.dayId);
      if (idx >= 0) plan.nextDay = (idx + 1) % plan.days.length;
    }
  });
  stopRest();
  lock.stop();
  go('hoy');
  shareSession(session);
  if (COACH_ENABLED && cloud.enabled && db().settings.coachAfterSession) runPostSession(session.id);
  else showSummary(session, prs);
}

// Resumen al terminar: lo que hiciste, los récords y, la primera vez, una felicitación.
function showSummary(session, prs) {
  const sets = session.exercises.reduce((n, e) => n + e.sets.length, 0);
  const first = db().sessions.length === 1;
  openModal(`<div class="summary">
    <div class="tourico" aria-hidden="true">${prs.length ? '🏆' : '💪'}</div>
    <h2>${first ? '¡Primer entreno hecho!' : '¡Entreno guardado!'}</h2>
    <p class="muted">${esc(session.dayName)} · ${session.durationMin} min · ${sets} serie${sets === 1 ? '' : 's'} · ${session.exercises.length} ejercicio${session.exercises.length === 1 ? '' : 's'}</p>
    ${prs.length ? `<p class="prs">Récord en ${prs.map(esc).join(', ')}</p>` : ''}
    <p class="small">${first ? 'Lo más difícil ya lo hiciste: empezar. La próxima vez la app ajusta los pesos con lo que registraste hoy.' : 'La próxima vez la app ajusta los pesos con lo que registraste hoy.'}</p>
    <button class="btn primary big" data-act="closeModal">Listo</button></div>`);
}

// Compartir con amigos: la primera vez se pregunta; luego se respeta lo que elegiste (se cambia en Perfil).
function sharePlan(plan) {
  if (db().settings.shareActivity === false) return;
  cloud.publish('plan', { planName: plan.name, days: plan.days.length, source: plan.source, weeks: plan.program?.repMode === 'doble' ? null : 12 });
}
function shareSession(session) {
  if (!cloud.enabled || !cloud.user) return;
  const pref = db().settings.shareActivity;
  if (pref === false) return;
  if (pref === true) return publishSession(session);
  const ok = confirm('¿Quieres que tus amigos vean tus entrenos (día, duración, series y récords)? Tus notas y tu peso no se comparten. Puedes cambiarlo en Perfil.');
  update((st) => (st.settings.shareActivity = ok));
  if (ok) publishSession(session);
}

// ---------- Temporizador de descanso ----------
// ctx: { ex, next } para mostrar en la pantalla de bloqueo qué viene después.
function startRest(sec, ctx = {}) {
  restTimer = { end: Date.now() + sec * 1000, total: sec, ...ctx };
  renderRestBar();
}
function stopRest() { restTimer = null; renderRestBar(); lockIdle(); }
// Panel del celular entre descansos: "Entrenando · Torso A".
function lockIdle() {
  const a = db().activeSession;
  if (!a || !lock.active()) return;
  const done = a.exercises.reduce((x, e) => x + e.sets.filter((z) => z.done).length, 0);
  const total = a.exercises.reduce((x, e) => x + e.sets.length, 0);
  lock.show({ title: `Entrenando · ${a.dayName}`, artist: 'Lift', album: `${done} de ${total} series` });
}
function renderRestBar() {
  const bar = $('#rest');
  document.body.classList.toggle('resting', !!restTimer);
  if (!restTimer) { bar.hidden = true; return; }
  const left = Math.max(0, Math.round((restTimer.end - Date.now()) / 1000));
  bar.hidden = false;
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  // Se arma una vez y luego solo cambia el número y la barra: los botones no se recrean cada segundo.
  if (!bar.querySelector('.rclock')) {
    bar.innerHTML = `<span class="rlabel">Descanso</span><b class="rclock" role="timer" aria-live="off"></b>
    <span class="rtrack"><span></span></span>
    <button class="link" data-act="restAdd">+30 s</button><button class="link" data-act="restStop">Saltar</button>`;
  }
  bar.querySelector('.rclock').textContent = clock;
  bar.querySelector('.rtrack > span').style.width = `${(left / restTimer.total) * 100}%`;
  lock.show({ title: `Descanso ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, artist: restTimer.ex ? `Lift · ${restTimer.ex}` : 'Lift', album: restTimer.next || '', duration: restTimer.total, position: restTimer.total - left });
  if (left === 0) {
    try { navigator.vibrate?.([200, 100, 200]); } catch {}
    beep();
    lock.notify('¡Vamos con la siguiente serie!', restTimer.next || 'Terminó tu descanso');
    setTimeout(lockIdle, 1500);
    toast('¡Vamos con la siguiente serie!');
    restTimer = null;
    bar.innerHTML = '';
    setTimeout(renderRestBar, 50);
    return;
  }
  clearTimeout(renderRestBar.t);
  renderRestBar.t = setTimeout(renderRestBar, 1000);
}
function beep() {
  if (!db().settings.restSound) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.value = 0.15;
    o.start(); o.stop(ctx.currentTime + 0.25);
  } catch {}
}

// ---------- Rutinas ----------
function planCard(plan, s, active) {
  const vol = weeklyVolume(plan);
  const rows = Object.keys(MUSCLES).map((m) => { const [lo, hi] = volumeTarget(s.profile.level, m); return { label: MUSCLES[m], value: vol[m], lo, hi }; });
  return `
  <section class="card ${active ? 'accent' : ''}">
    <p class="eyebrow">${active ? 'Rutina activa · ' : ''}${SOURCE[plan.source] || ''}</p>
    <h2>${esc(plan.name)}</h2>
    ${plan.rationale ? `<p class="muted small">${esc(plan.rationale)}</p>` : ''}
    ${planTimeline(plan, active)}
    ${active ? recsBlock(plan) : ''}
    ${plan.days.map((d) => `
    <details class="day"><summary><b>${esc(d.name)}</b> <span class="muted small">${d.exercises.length} ejercicios · ≈ ${estimateMinutes(d)} min</span></summary>
      <ul class="mini">${d.exercises.map((e) => { const rx = prescribe(plan, s.sessions, e, active ? currentWeek(plan) : 1, s.profile); return `<li><span>${esc(e.name)}${e.notes ? `<br><span class="muted small">${esc(e.notes)}</span>` : ''}</span><span class="muted">${rxLabel(rx, unitOf(s.profile, e.name))} · RIR ${rx.rir}</span></li>`; }).join('')}</ul>
      <p class="muted small">${active ? `Prescripción de la semana ${weekInfo(plan, currentWeek(plan)).week}.` : 'Prescripción de la semana 1.'} Cambia cada semana según la fase.</p>
    </details>`).join('')}
    <details class="day"><summary><b>Volumen semanal por músculo</b> <span class="muted small">series, objetivo sombreado</span></summary>${volumeBars(rows)}</details>
    <div class="actions wrap">
      ${active ? '' : `<button class="btn primary sm" data-act="activate" data-plan="${plan.id}">Activar</button>`}
      <button class="btn ghost sm" data-act="edit" data-plan="${plan.id}">Editar</button>
      ${ADJUST_ENABLED && cloud.enabled ? `<button class="btn ghost sm" data-act="askChanges" data-plan="${plan.id}">💬 Pídenos cambios</button>` : ''}
      <button class="btn ghost sm" data-act="duplicate" data-plan="${plan.id}">Duplicar</button>
      <button class="btn ghost sm danger" data-act="deletePlan" data-plan="${plan.id}">Eliminar</button>
    </div>
  </section>`;
}

// Línea de tiempo de 12 semanas con bloques, descargas y semana actual.
function planTimeline(plan, active) {
  const p = plan.program;
  if (p.repMode === 'doble') {
    const cur = active ? currentWeek(plan) : 0;
    return `<div class="timeline"><div class="tlhead"><span class="eyebrow">Progresión doble${cur ? ` · semana ${cur}` : ''}</span></div>
      <p class="muted small">${MODE_HELP.doble} Cada ejercicio muestra en Hoy el peso y las reps para la próxima sesión.</p></div>`;
  }
  const cur = active ? currentWeek(plan) : 0;
  const blocks = blocksFor(p.goal);
  const cells = Array.from({ length: p.weeks }, (_, i) => {
    const w = i + 1;
    const inf = weekInfo(plan, w);
    const cls = ['wk', `b${inf.block}`, inf.deload ? 'dl' : '', w === cur ? 'now' : '', w < cur ? 'past' : ''].join(' ');
    return `<span class="${cls}" title="Semana ${w}: ${inf.blockName} · ${inf.label}">${inf.deload ? '↓' : w}</span>`;
  }).join('');
  const startTxt = new Date(p.startDate + 'T12:00:00').toLocaleDateString('es', { day: 'numeric', month: 'short' });
  const endTxt = new Date(+new Date(p.startDate + 'T12:00:00') + (p.weeks * 7 - 1) * 864e5).toLocaleDateString('es', { day: 'numeric', month: 'short' });
  return `
  <div class="timeline">
    <div class="tlhead"><span class="eyebrow">Plan de ${p.weeks} semanas · ${startTxt} – ${endTxt}</span>${cur ? `<span class="pill sm">Semana ${Math.min(cur, p.weeks)}</span>` : ''}</div>
    <div class="weeks">${cells}</div>
    <div class="blocks">${blocks.map((b, i) => `<div class="blk b${i + 1}"><b>${i + 1}. ${esc(b.name)}</b><span class="muted small">${esc(b.desc)}</span></div>`).join('')}</div>
    <p class="muted small">↓ = descarga: mitad de series y más reserva para recuperar. ${MODE_LABEL[p.repMode]}.</p>
  </div>`;
}

// ---------- Revisión con IA (ver coachui.js) ----------
function reviewsBlock(plan) {
  const revs = plan.reviews || [];
  return `<div class="aireview">
    ${COACH_ENABLED && cloud.enabled ? '<button class="btn ghost big" data-act="aiReview">💬 Revisar mi progreso con el coach</button>' : ''}
    ${revs.length ? `<details class="day"><summary><b>Revisiones anteriores</b> <span class="muted small">${revs.length}</span></summary>
      ${revs.map((r) => `<button class="pitem" data-act="showReview" data-id="${r.id}"><span>Semana ${r.week} · ${fmtDate(r.date)}<br><span class="muted small">${esc(r.summary.slice(0, 90))}…</span></span><span class="muted small">${r.applied.length}/${r.changes.length} cambios</span></button>`).join('')}
    </details>` : ''}
  </div>`;
}

function recsBlock(plan) {
  const recs = planRecs(plan);
  if (!recs.length) return `<div class="rec"><b>Aún sin datos para comparar</b><p class="small">Cuando hagas al menos 2 entrenos con un ejercicio, aquí verás si vas por delante o por detrás de lo previsto y qué ajustar.</p></div>${reviewsBlock(plan)}`;
  return `<div class="recs"><p class="eyebrow">Ajustes recomendados</p>${recs.map((r, i) => `
    <div class="rec ${r.level}"><b>${esc(r.title)}</b><p class="small">${esc(r.text)}</p>
      <div class="actions wrap">${r.action ? `<button class="btn primary sm" data-act="applyRec" data-i="${i}">${esc(r.cta || 'Continuar')}</button>` : ''}<button class="btn ghost sm" data-act="dismissRec" data-i="${i}">${r.action ? 'Ahora no' : 'Entendido'}</button></div>
    </div>`).join('')}</div>${reviewsBlock(plan)}`;
}

function viewRutinas() {
  const s = db();
  const plan = activePlan();
  main.innerHTML = `
  <header class="top"><h1>Rutina</h1></header>
  <p class="eyebrow">Crear una rutina nueva</p>
  <section class="gen">
    <button class="gencard" data-act="newPlan"><span class="gi">✍️</span><b>Armar mi rutina</b><span class="muted small">Tus ejercicios</span></button>
    <button class="gencard" data-act="genScience"><span class="gi">⚡</span><b>Créame una</b><span class="muted small">Al instante, con ciencia</span></button>
  </section>
  ${cloud.enabled ? '<button class="btn ghost big" data-act="importRoutine">📄 Importar desde PDF o fotos</button>' : ''}
  ${plan ? planCard(plan, s, true) : ''}
  ${s.plans.filter((p) => p.id !== s.activePlanId).length ? `<h3 class="sect">Otras rutinas</h3>` : ''}
  ${s.plans.filter((p) => p.id !== s.activePlanId).reverse().map((p) => planCard(p, s, false)).join('')}`;
}

function showPlanPreview(plan) {
  const s = db();
  openModal(`<p class="eyebrow">Nueva rutina</p>${planCard(plan, s, false).replace('class="card ', 'class="card flat ')}${ADJUST_ENABLED && cloud.enabled ? `<button class="btn ghost big" data-act="askChanges" data-plan="${plan.id}">💬 Pídenos cambios</button>` : ''}<button class="btn ghost big" data-act="closeModal">Ver después</button>`);
}

// ---------- Elegir la distribución de los días ----------
// Cuántos días a la semana trabaja cada grupo en una rutina (como músculo principal).
const FREQ_GROUPS = { Pecho: ['pecho'], Espalda: ['espalda'], Hombros: ['hombros'], Brazos: ['biceps', 'triceps'], Piernas: ['cuadriceps', 'isquios', 'gluteos'] };
function frequencyText(plan) {
  return Object.entries(FREQ_GROUPS).map(([g, ms]) => `${g} ${plan.days.filter((d) => d.exercises.some((e) => ms.includes(e.muscle))).length}×`).join(' · ');
}

function viewSplit() {
  const p = db().profile;
  const days = Math.max(2, Math.min(6, Number(p.days) || 3));
  const first = !db().plans.length;
  main.innerHTML = `
  <header class="top"><div><h1>¿Cómo repartes tus días?</h1><p class="muted small">Elige la que más te guste: cambian cuántas veces por semana trabajas cada músculo y en qué se enfoca cada día.</p></div>
    ${first ? '<button class="btn ghost sm" data-act="backToStart">← Volver</button>' : '<a class="btn ghost sm" href="#rutinas">Cancelar</a>'}</header>
  <p class="eyebrow">Días por semana</p>
  <div class="daychips">${[2, 3, 4, 5, 6].map((n) => `<button class="chip ${n === days ? 'on' : ''}" data-act="splitDays" data-n="${n}">${n}</button>`).join('')}</div>
  ${SPLIT_OPTIONS[days].map((o) => {
    const plan = generatePlan(p, o.key);
    const mins = plan.days.map((d) => estimateMinutes(d));
    return `<section class="card splitopt">
      <h3>${esc(o.name)}</h3>
      <p class="muted small daysline">${plan.days.map((d) => esc(d.name)).join(' · ')}</p>
      <p class="small">${esc(o.why)}</p>
      <p class="muted small">Por semana: ${frequencyText(plan)} · ≈ ${Math.min(...mins)}–${Math.max(...mins)} min por entreno</p>
      <button class="btn primary" data-act="chooseSplit" data-key="${o.key}">Elegir esta</button>
    </section>`;
  }).join('')}
  <p class="muted small center">Después puedes editar cualquier ejercicio${ADJUST_ENABLED && cloud.enabled ? ' o pedir cambios con tus palabras' : ''}.</p>`;
}

// ---------- "¿No te gusta algo?": cambios a la rutina pedidos en palabras (IA) ----------
let changeReq = null; // { planId, request, result }
const CHANGE_EXAMPLES = ['Quiero más trabajo de bíceps', 'Junta pecho y tríceps el mismo día', 'No tengo prensa de piernas', 'Que las sesiones duren máximo 50 minutos'];
function openAskChanges(planId) {
  if (!cloud.enabled || !cloud.user) return alert('Inicia sesión para pedir cambios.');
  changeReq = { planId };
  openModal(`<p class="eyebrow">Ajustar rutina</p><h2>¿No te gusta algo?</h2>
    <p class="muted small">Cuéntanos con tus palabras qué cambiarías y la ajustamos. Antes de aplicar nada, te mostramos cómo queda.</p>
    <textarea id="chreq" rows="4" maxlength="1500" placeholder="Ej.: quiero entrenar pierna solo una vez y más hombro"></textarea>
    <div class="chips">${CHANGE_EXAMPLES.map((t) => `<button class="chip" data-act="exampleChange" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <button class="btn primary big" data-act="sendChanges">Enviar</button>`);
  setTimeout(() => $('#chreq')?.focus(), 50);
}

async function sendChanges() {
  const request = $('#chreq')?.value.trim();
  if (!request) return toast('Escribe qué te gustaría cambiar');
  const plan = db().plans.find((p) => p.id === changeReq?.planId);
  if (!plan) return closeModal();
  changeReq.request = request;
  openModal(`<p class="eyebrow">Ajustar rutina</p><h2>Ajustando tu rutina…</h2><p class="muted">Puede tardar hasta medio minuto. No cierres la app.</p><div class="spinner" aria-hidden="true"></div>`, false);
  try {
    const slim = { name: plan.name, days: plan.days.map((d) => ({ name: d.name, exercises: d.exercises.map(({ name, muscle, kind, sets, repMin, repMax, rir, restSec }) => ({ name, muscle, kind, sets, repMin, repMax, rir, restSec })) })) };
    const res = await cloud.adjustPlan({ plan: slim, profile: db().profile, request });
    if (!res?.plan?.days?.length) throw new Error('No pude ajustar la rutina. Prueba a decirlo de otra forma.');
    changeReq.result = res;
    showChangePreview(plan, res);
  } catch (err) {
    openModal(`<h2>No se pudo ajustar</h2><p>${esc(err.message || 'Algo salió mal.')}</p><div class="actions"><button class="btn primary" data-act="askChanges" data-plan="${plan.id}">Intentar de nuevo</button></div>`);
  }
}

// Muestra qué entra y qué sale en cada día antes de aplicar.
function showChangePreview(plan, res) {
  const draftDays = res.plan.days;
  const diff = draftDays.map((d, i) => {
    const before = plan.days[i]?.exercises.map((e) => e.name) || [];
    const after = d.exercises.map((e) => e.name);
    const add = after.filter((n) => !before.includes(n)), rem = before.filter((n) => !after.includes(n));
    const setsChanged = d.exercises.filter((e) => { const o = plan.days[i]?.exercises.find((x) => x.name === e.name); return o && (o.sets !== e.sets || o.repMin !== e.repMin || o.repMax !== e.repMax); }).map((e) => e.name);
    return { d, add, rem, setsChanged, renamed: plan.days[i] && plan.days[i].name !== d.name };
  });
  const removedDays = plan.days.slice(draftDays.length).map((d) => d.name);
  const mins = draftDays.map((d) => estimateMinutes(d));
  openModal(`<p class="eyebrow">Así quedaría</p><h2>${esc(res.plan.name || plan.name)}</h2>
    ${res.message ? `<p class="small">${esc(res.message)}</p>` : ''}
    ${diff.map(({ d, add, rem, setsChanged, renamed }, i) => `
    <details class="day" ${add.length || rem.length || setsChanged.length || renamed ? 'open' : ''}><summary><b>${esc(d.name)}</b> <span class="muted small">${d.exercises.length} ejercicios · ≈ ${mins[i]} min</span></summary>
      ${add.length || rem.length || setsChanged.length ? `<p class="small">${add.map((n) => `<span class="tag add">+ ${esc(n)}</span>`).join(' ')} ${rem.map((n) => `<span class="tag rem">− ${esc(n)}</span>`).join(' ')} ${setsChanged.map((n) => `<span class="tag">± ${esc(n)}</span>`).join(' ')}</p>` : '<p class="muted small">Sin cambios en este día.</p>'}
      <ul class="mini">${d.exercises.map((e) => `<li><span>${esc(e.name)}</span><span class="muted">${e.sets}×${e.repMin}–${e.repMax}</span></li>`).join('')}</ul>
    </details>`).join('')}
    ${removedDays.length ? `<p class="small"><span class="tag rem">Se quita: ${esc(removedDays.join(', '))}</span></p>` : ''}
    <div class="actions wrap"><button class="btn primary" data-act="applyChanges">Aplicar cambios</button><button class="btn ghost" data-act="askChanges" data-plan="${plan.id}">Pedir otra cosa</button><button class="btn ghost" data-act="closeModal">Descartar</button></div>`);
}

function applyChanges() {
  const res = changeReq?.result;
  if (!res) return closeModal();
  const profile = db().profile;
  update((st) => {
    const p = st.plans.find((x) => x.id === changeReq.planId);
    if (!p) return;
    p.name = res.plan.name || p.name;
    p.days = res.plan.days.map((d, i) => ({
      id: p.days[i]?.id || uid(), name: d.name, focus: d.focus || '',
      exercises: d.exercises.map((e) => {
        const def = exerciseDefaults(profile, e.kind);
        return { ...def, name: e.name, muscle: e.muscle, sec: e.sec || [], kind: e.kind, sets: e.sets ?? def.sets, repMin: e.repMin ?? def.repMin, repMax: e.repMax ?? def.repMax, rir: e.rir ?? def.rir, restSec: e.restSec ?? def.restSec, notes: e.notes || '' };
      }),
    }));
    p.nextDay = (p.nextDay || 0) % p.days.length;
  });
  closeModal();
  changeReq = null;
  toast('Rutina actualizada');
  render();
}

// ---------- Arma tu rutina (editor) ----------
// Pantalla para quien ya tiene rutina: elige si la arma o si se la creamos al instante.
function viewStart() {
  document.body.classList.add('onboarding');
  main.innerHTML = `
  <section class="hero"><div class="logo">${APP_NAME}</div><h1>¿Ya tienes una rutina?</h1>
    <p class="muted">Si ya sabes qué ejercicios haces, ármala y la app te dice cuánto peso poner y cuándo subir. Si no, te creamos una con base científica.</p></section>
  <button class="card choice" data-act="startOwn">
    <span class="gi">✍️</span><span><b>Sí, quiero armar la mía</b><br><span class="muted small">Pones tus días y ejercicios. La app revisa que esté balanceada y te sugiere los pesos.</span></span>
  </button>
  ${cloud.enabled ? `<button class="card choice" data-act="importRoutine">
    <span class="gi">📄</span><span><b>La tengo en PDF o en fotos</b><br><span class="muted small">Súbela y la app la pasa a ${APP_NAME}. Luego la revisas y ajustas lo que haga falta.</span></span>
  </button>` : ''}
  <button class="card choice" data-act="startScience">
    <span class="gi">⚡</span><span><b>No, créame una</b><br><span class="muted small">Eliges cómo repartir tus días y queda lista con tu perfil: plan de 12 semanas que luego puedes editar.</span></span>
  </button>`;
}

// ---------- Importar una rutina desde PDF o fotos ----------
const toBase64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]);
  r.onerror = () => rej(new Error('No pude leer el archivo.'));
  r.readAsDataURL(blob);
});

// Las fotos se achican en el celular (máx. 2000 px) para que suban rápido.
async function fileToPart(f) {
  if (f.type === 'application/pdf') {
    if (f.size > 10e6) throw new Error(`${f.name} pesa más de 10 MB. Prueba con un PDF más liviano o con fotos.`);
    return { type: f.type, data: await toBase64(f) };
  }
  if (!f.type.startsWith('image/')) throw new Error(`${f.name}: usa un PDF o fotos (JPG o PNG).`);
  let bmp;
  try { bmp = await createImageBitmap(f); } catch { throw new Error(`No pude abrir ${f.name}. Prueba con una foto JPG o PNG.`); }
  const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  return { type: 'image/jpeg', data: await toBase64(blob) };
}

function draftFromImport(res) {
  const profile = db().profile;
  const d = {
    id: uid(), name: res.name, source: 'propia', createdAt: new Date().toISOString(), rationale: res.notes || '', nextDay: 0,
    days: res.days.map((day) => ({ id: uid(), name: day.name, focus: '', exercises: day.exercises.map((e) => {
      const def = exerciseDefaults(profile, e.kind);
      return { name: e.name, muscle: e.muscle, sec: e.sec || [], kind: e.kind, ...def, sets: e.sets, repMin: e.repMin, repMax: e.repMax, rir: e.rir ?? def.rir, restSec: e.restSec ?? def.restSec, notes: e.notes || '' };
    }) })),
    _new: true,
    _imported: { notes: res.notes || '', unmatched: res.days.flatMap((x) => x.exercises.filter((e) => !e.matched).map((e) => e.name)) },
  };
  withProgram(d, 'doble');
  return d;
}

async function runImport(files) {
  if (!files.length) return;
  if (files.length > 10) return alert('Máximo 10 archivos a la vez.');
  openModal(`<p class="eyebrow">Importando</p><h2>Leyendo tu rutina…</h2><p class="muted">Puede tardar hasta un minuto. No cierres la app.</p><div class="spinner" aria-hidden="true"></div>`, false);
  try {
    const res = await cloud.importRoutine({ files: await Promise.all(files.map(fileToPart)) });
    if (!res?.ok) throw new Error(res?.problem || 'No pude leer la rutina.');
    draft = draftFromImport(res);
    keepDraft();
    closeModal();
    if (location.hash.startsWith('#editar')) viewEditar(); else go('editar');
    window.scrollTo(0, 0);
  } catch (err) {
    openModal(`<h2>No se pudo importar</h2><p>${esc(err.message || 'Algo salió mal.')}</p><div class="actions"><button class="btn primary" data-act="importRoutine">Probar con otro archivo</button></div>`);
  }
}

// El borrador se guarda en el celular mientras lo editas: si sales o recargas, no se pierde.
const DRAFT_KEY = 'forja.draft';
const keepDraft = () => { try { if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); else localStorage.removeItem(DRAFT_KEY); } catch {} };

function viewEditar() {
  if (!draft) { try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { draft = null; } }
  if (!draft) return go('rutinas');
  keepDraft();
  const profile = db().profile;
  const review = reviewRoutine(draft, profile);
  const muscleOpts = (v) => Object.entries(MUSCLES).map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('');
  const custom = (e) => !exerciseByName(e.name);
  main.innerHTML = `
  <header class="top"><div><h1>${draft._new ? 'Tu rutina' : 'Editar rutina'}</h1><p class="muted small">Tus días y ejercicios. La app sugiere los pesos.</p></div><button class="btn ghost sm" data-act="cancelEdit">Cancelar</button></header>
  ${draft._imported ? `<section class="card"><div class="rec info"><b>Rutina importada</b>
    <p class="small">Revisa que los ejercicios, las series y las repeticiones estén bien antes de guardar.${draft._imported.unmatched.length ? ` Estos no están en la biblioteca de la app: ${esc(draft._imported.unmatched.join(', '))}. Revisa su músculo en "Más opciones".` : ''}</p>
    ${draft._imported.notes ? `<p class="small muted">${esc(draft._imported.notes)}</p>` : ''}</div></section>` : ''}
  <label>Nombre<input data-draft="name" value="${esc(draft.name)}" maxlength="60"></label>
  <fieldset class="modes"><legend>Cómo progresar</legend>
    ${Object.entries(MODE_LABEL).map(([k, l]) => `<label class="mode ${draft.program?.repMode === k ? 'on' : ''}"><input type="radio" name="mode" value="${k}" data-draft="mode" ${draft.program?.repMode === k ? 'checked' : ''}><span><b>${l}</b><span class="muted small">${MODE_HELP[k]}</span></span></label>`).join('')}
  </fieldset>
  ${draft.days.map((d, i) => `
  <section class="card dayedit">
    <div class="exhead"><input class="title-in" data-draft="day.name" data-day="${i}" value="${esc(d.name)}" aria-label="Nombre del día" maxlength="30">
      <button class="icon" data-act="delDay" data-day="${i}" aria-label="Eliminar ${esc(d.name)}">✕</button></div>
    <p class="muted small">${d.exercises.length ? `${d.exercises.length} ejercicios · ≈ ${estimateMinutes(d)} min` : 'Sin ejercicios todavía'}</p>
    ${d.exercises.map((e, j) => `
    <div class="edex">
      <div class="edtop"><b>${esc(e.name)}</b>
        <span><button class="icon sm" data-act="moveEx" data-day="${i}" data-ex="${j}" data-dir="-1" aria-label="Subir">↑</button><button class="icon sm" data-act="moveEx" data-day="${i}" data-ex="${j}" data-dir="1" aria-label="Bajar">↓</button><button class="icon sm" data-act="delEx" data-day="${i}" data-ex="${j}" aria-label="Quitar">✕</button></span></div>
      ${e.notes ? `<p class="muted small">ℹ ${esc(e.notes)}</p>` : ''}
      <div class="exnums">
        <div class="stepper"><span class="slabel">Series</span><button class="icon sm" data-act="exSets" data-day="${i}" data-ex="${j}" data-d="-1" aria-label="Menos series">−</button><b>${e.sets}</b><button class="icon sm" data-act="exSets" data-day="${i}" data-ex="${j}" data-d="1" aria-label="Más series">+</button></div>
        <div class="reps"><span class="slabel">Reps</span><input type="number" inputmode="numeric" data-draft="ex.repMin" data-day="${i}" data-ex="${j}" value="${e.repMin}" aria-label="Reps mínimas"><span>–</span><input type="number" inputmode="numeric" data-draft="ex.repMax" data-day="${i}" data-ex="${j}" value="${e.repMax}" aria-label="Reps máximas"></div>
      </div>
      <details class="more"><summary>Más opciones</summary>
        <div class="edgrid">
          <label>RIR<input type="number" inputmode="numeric" data-draft="ex.rir" data-day="${i}" data-ex="${j}" value="${e.rir}"></label>
          <label>Descanso (s)<input type="number" inputmode="numeric" data-draft="ex.restSec" data-day="${i}" data-ex="${j}" value="${e.restSec}"></label>
          ${custom(e) ? `<label>Músculo<select data-draft="ex.muscle" data-day="${i}" data-ex="${j}">${muscleOpts(e.muscle)}</select></label>` : ''}
        </div>
        <p class="muted small">RIR: repeticiones que te quedan en reserva al terminar la serie (0 = al fallo).</p>
      </details>
    </div>`).join('')}
    <button class="btn ghost" data-act="pickForDraft" data-day="${i}">+ Agregar ejercicio</button>
  </section>`).join('')}
  <button class="btn ghost big" data-act="addDay">+ Agregar día</button>

  <section class="card review">
    <p class="eyebrow">Revisión científica</p>
    ${review.map((r, k) => `<div class="rec ${r.level}"><b>${esc(r.title)}</b><p class="small">${esc(r.text)}</p>${r.fix ? `<div class="actions"><button class="btn primary sm" data-act="applyFix" data-i="${k}">${esc(r.fix.label)}</button></div>` : ''}</div>`).join('')}
  </section>
  <button class="btn primary big" data-act="saveDraft">Guardar rutina</button>`;
}

const MODE_HELP = {
  doble: 'Mismo peso hasta que completes el tope del rango en todas las series; ahí subes el peso y vuelves al mínimo de reps. Ej.: 3×8–12 con 60 kg → al lograr 12, 12 y 12, pasas a 62,5 kg y arrancas en 8.',
  fases: 'La app te cambia las repeticiones y el peso cada semana: 3 bloques de 4 semanas, de más reps a más peso, con una semana de descarga al final de cada bloque.',
  fijo: 'Mantienes tus rangos de repeticiones y la app te sube el peso poco a poco durante 12 semanas, con una semana de descarga cada 4.',
};

function newDraft() {
  const n = Math.max(1, Math.min(6, Number(db().profile?.days) || 3));
  draft = { id: uid(), name: 'Mi rutina', source: 'propia', createdAt: new Date().toISOString(), rationale: '', nextDay: 0, days: Array.from({ length: n }, (_, k) => ({ id: uid(), name: `Día ${k + 1}`, focus: '', exercises: [] })), _new: true };
  withProgram(draft, 'doble');
  go('editar');
}

function exerciseFromLib(ex) {
  return { name: ex.name, muscle: ex.muscle, sec: ex.sec || [], kind: ex.kind, ...exerciseDefaults(db().profile, ex.kind), notes: '' };
}

// ---------- Selector de ejercicios (solo gimnasio) ----------
const inGym = (e) => e.equip !== 'peso_corporal' || e.pattern === 'abdomen';
function openPicker(cb) {
  pickerCb = cb;
  const groups = Object.entries(MUSCLES).map(([m, l]) => {
    const list = EXERCISES.filter((e) => e.muscle === m && inGym(e));
    return list.length ? `<div class="pgroup" data-muscle="${m}"><p class="eyebrow">${l}</p>${list.map((e) => `<button class="pitem" data-act="pick" data-name="${esc(e.name)}">${esc(e.name)}<span class="muted small">${e.kind === 'c' ? 'compuesto' : 'aislamiento'}</span></button>`).join('')}</div>` : '';
  }).join('');
  openModal(`<h2>Agregar ejercicio</h2>
    <input id="psearch" type="search" placeholder="Buscar: banca, remo, curl…" aria-label="Buscar ejercicio">
    <div id="plist">${groups}</div>
    <details class="day"><summary><b>¿No está? Crea el tuyo</b></summary>
      <label>Nombre<input id="cname" placeholder="Press Arnold"></label>
      <label>Músculo principal<select id="cmuscle">${Object.entries(MUSCLES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label>Tipo<select id="ckind"><option value="c">Compuesto (varias articulaciones)</option><option value="i">Aislamiento (un músculo)</option></select></label>
      <button class="btn primary" data-act="pickCustom">Agregar</button>
    </details>`);
  $('#psearch').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    document.querySelectorAll('.pitem').forEach((b) => (b.hidden = q && !b.dataset.name.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').includes(q)));
    document.querySelectorAll('.pgroup').forEach((g) => (g.hidden = ![...g.querySelectorAll('.pitem')].some((b) => !b.hidden)));
    const none = q && ![...document.querySelectorAll('.pitem')].some((b) => !b.hidden);
    const det = $('#plist + details');
    if (none && det) { det.open = true; $('#cname').value = e.target.value.trim(); det.querySelector('summary b').textContent = `No está «${e.target.value.trim()}». Créalo:`; }
  });
  setTimeout(() => $('#psearch')?.focus(), 50);
}

// ---------- Progreso ----------
function viewProgreso() {
  const s = db();
  const ws = weightStats();
  const names = [...new Set(s.sessions.flatMap((x) => x.exercises.map((e) => e.name)))].sort();
  if (!names.includes(progressExercise)) progressExercise = names[0] || '';
  // Volumen real de los últimos 7 días
  const since = Date.now() - 7 * 864e5;
  const real = Object.fromEntries(Object.keys(MUSCLES).map((m) => [m, 0]));
  for (const ss of s.sessions.filter((x) => +new Date(x.date + 'T12:00:00') >= since)) {
    for (const e of ss.exercises) {
      const n = e.sets.length;
      if (real[e.muscle] !== undefined) real[e.muscle] += n;
      for (const m of e.sec || exerciseByName(e.name)?.sec || []) if (real[m] !== undefined) real[m] += n * 0.5;
    }
  }
  const [rlo, rhi] = weightRateTarget(s.profile.goal);
  const protein = s.profile.weight ? [Math.round(s.profile.weight * 1.6), Math.round(s.profile.weight * 2.2)] : null;

  const plan = activePlan();
  const status = plan ? exerciseStatus(plan, s.sessions) : [];
  const planExs = plan ? uniqueExercises(plan) : [];
  if (!planExs.some((e) => e.name === planExercise)) planExercise = (status.find((x) => x.n > 0) || status[0])?.ex.name || '';
  const ST = { arriba: ['Por delante', 'good'], linea: ['En línea', 'ok'], abajo: ['Por debajo', 'warn'], sin: ['Sin datos', 'muted'] };
  const pct = (r) => (r == null ? '—' : `${r >= 1 ? '+' : ''}${n1((r - 1) * 100)} %`);

  main.innerHTML = `
  <header class="top"><h1>Progreso</h1></header>

  ${plan ? `
  <section class="card">
    <div class="exhead"><h3>Previsto vs real</h3><span class="pill">Semana ${weekInfo(plan, currentWeek(plan)).week}${plan.program?.repMode === 'doble' ? '' : ` de ${WEEKS}`}</span></div>
    <p class="muted small">Línea punteada: hacia dónde deberías ir. Línea continua: tu fuerza real, es decir, el peso que podrías levantar 1 vez, calculado con tus series.</p>
    <select id="psel" aria-label="Ejercicio de tu rutina">${planExs.map((e) => `<option ${e.name === planExercise ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
    <div id="pchart"></div>
    <table class="stable">
      <thead><tr><th>Ejercicio</th><th>vs previsto</th><th>Estado</th></tr></thead>
      <tbody>${status.map((x) => `<tr data-act="pickPlanEx" data-name="${esc(x.ex.name)}" class="${x.ex.name === planExercise ? 'sel' : ''}"><td>${esc(x.ex.name)}</td><td class="num">${pct(x.ratio)}</td><td><span class="chip ${ST[x.status][1]}">${ST[x.status][0]}</span></td></tr>`).join('')}</tbody>
    </table>
    <p class="muted small">"Por delante" o "por debajo" = más de un 3 % de diferencia en la última sesión. Con 2 sesiones seguidas, la app te propone un ajuste en Rutinas.</p>
  </section>` : ''}

  <section class="card">
    <div class="exhead"><h3>Peso corporal</h3>${ws ? `<span class="pill">${n1(ws.nowAvg)} kg</span>` : ''}</div>
    <div id="wchart"></div>
    <p class="muted small">Ritmo actual: <b>${ws?.rate == null ? '—' : (ws.rate > 0 ? '+' : '') + n1(ws.rate) + ' % por semana'}</b> · objetivo para ${GOALS[s.profile.goal].toLowerCase()}: ${rlo > 0 ? '+' : ''}${rlo.toLocaleString('es')} a ${rhi > 0 ? '+' : ''}${rhi.toLocaleString('es')} %/sem${protein ? ` · proteína sugerida: ${protein[0]}–${protein[1]} g/día` : ''}</p>
    ${ws ? `<details class="day"><summary><b>Registros</b> <span class="muted small">${ws.w.length}</span></summary><ul class="mini">${[...ws.w].reverse().map((w) => `<li><span>${fmtDate(w.date)}</span><span>${n1(w.kg)} kg <button class="icon sm" data-act="delWeight" data-id="${w.id}" aria-label="Borrar">✕</button></span></li>`).join('')}</ul></details>` : ''}
  </section>

  <section class="card">
    <h3>Fuerza por ejercicio</h3>
    ${names.length ? `<select id="exsel" aria-label="Ejercicio">${names.map((n) => `<option ${n === progressExercise ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
    <div id="echart"></div><div id="ebest"></div>` : `<p class="empty">Completa tu primer entreno para ver tu progreso de fuerza.</p>`}
  </section>

  <section class="card">
    <h3>Series de los últimos 7 días</h3>
    <p class="muted small">Series hechas por músculo (secundario = 0,5). Zona sombreada = rango recomendado para tu nivel.</p>
    ${volumeBars(Object.keys(MUSCLES).map((m) => { const [lo, hi] = volumeTarget(s.profile.level, m); return { label: MUSCLES[m], value: real[m], lo, hi }; }))}
  </section>

  <section class="card">
    <h3>Historial</h3>
    ${s.sessions.length ? [...s.sessions].reverse().slice(0, 40).map((x) => `
    <details class="day"><summary><b>${esc(x.dayName)}</b> <span class="muted small">${fmtDate(x.date)} · ${x.durationMin} min · ${x.exercises.reduce((a, e) => a + e.sets.length, 0)} series${x.prs?.length ? ' · 🏆' : ''}</span></summary>
      <ul class="mini">${x.exercises.map((e) => `<li><span>${esc(e.name)}</span><span class="muted">${e.sets.map((z) => `${z.kg === '' ? '' : numStr(inUnit(z.kg, unitFor(e.name)))}×${z.reps}`).join(', ')} ${unitFor(e.name)}</span></li>`).join('')}</ul>
      ${x.notes ? `<p class="muted small">${esc(x.notes)}</p>` : ''}
      <button class="link danger" data-act="delSession" data-id="${x.id}">Eliminar entreno</button>
    </details>`).join('') : '<p class="empty">Aún no hay entrenos.</p>'}
  </section>`;

  if (plan && planExercise) {
    renderPlanChart(plan);
    $('#psel').addEventListener('change', (e) => { planExercise = e.target.value; viewProgreso(); });
  }
  if (ws) lineChart($('#wchart'), { unit: 'kg', series: [{ name: 'Pesaje', kind: 'dots', points: ws.w.map((w) => ({ x: w.date, y: w.kg })) }, { name: 'Media 7 días', kind: 'line', points: ws.series }] });
  else $('#wchart').innerHTML = '<p class="empty">Registra tu peso en Hoy.</p>';
  if (names.length) {
    renderExerciseChart();
    $('#exsel').addEventListener('change', (e) => { progressExercise = e.target.value; renderExerciseChart(); });
  }
}

function renderPlanChart(plan) {
  const ex = uniqueExercises(plan).find((e) => e.name === planExercise);
  const t = exerciseTrack(plan, db().sessions, ex);
  if (!t.planned.length) {
    $('#pchart').innerHTML = `<p class="empty">Haz tu primera sesión de ${esc(ex.name)}: será la calibración y desde ahí la app proyecta tus 12 semanas.</p>`;
    return;
  }
  lineChart($('#pchart'), {
    unit: t.unit,
    decimals: t.bw ? 0 : 1,
    series: [
      { name: 'Previsto', kind: 'plan', points: t.planned },
      { name: 'Real', kind: 'line', points: t.real },
    ],
  });
}

function renderExerciseChart() {
  const s = db();
  const pts = [];
  let best = null;
  for (const x of s.sessions) {
    const e = x.exercises.find((z) => z.name === progressExercise);
    if (!e) continue;
    let top = 0;
    for (const st of e.sets) {
      const v = e1rm(Number(st.kg), Number(st.reps));
      if (v > top) top = v;
      if (!best || v > best.v) best = { v, kg: st.kg, reps: st.reps, date: x.date };
    }
    if (top > 0) {
      const prev = pts.find((p) => p.x === x.date);
      if (prev) prev.y = Math.max(prev.y, top); else pts.push({ x: x.date, y: top });
    }
  }
  const u = unitFor(progressExercise);
  lineChart($('#echart'), { unit: u, series: [{ name: 'Fuerza (peso a 1 repetición)', kind: 'line', points: pts.map((p) => ({ ...p, y: inUnit(p.y, u) })) }] });
  $('#ebest').innerHTML = best && best.v > 0 ? `<p class="muted small">Mejor serie: <b>${fmtW(best.kg, u)} × ${best.reps}</b> (${fmtDate(best.date)}) · equivale a ≈ ${fmtW(best.v, u)} a 1 repetición</p>` : '';
}

// ---------- Perfil ----------
function viewPerfil() {
  const s = db();
  const acc = cloud.enabled && cloud.user;
  main.innerHTML = `
  <header class="top"><h1>Perfil</h1></header>

  ${acc ? `
  <section class="card account">
    <div class="acchead">${avatar(cloud.me?.display_name || s.profile.name, 'lg')}<div><h2>${esc(cloud.me?.display_name || s.profile.name || '')}</h2><p class="muted small">@${esc(cloud.me?.username || '')} · ${esc(cloud.user.email || '')}</p></div></div>
    <form id="nform" class="inline"><input name="dn" value="${esc(cloud.me?.display_name || '')}" maxlength="40" aria-label="Nombre visible para tus amigos"><button class="btn ghost" type="submit">Cambiar</button></form>
    <p class="muted small">Tu nombre visible para tus amigos.</p>
    <div class="actions wrap"><button class="btn ghost sm" data-act="invite">Invitar amigos</button><button class="btn ghost sm" data-act="logout">Cerrar sesión</button></div>
  </section>

  ${COACH_ENABLED ? `  <section class="card">
    <h3>Coach con IA</h3>
    <div id="usage" class="muted small">Cargando consumo…</div>
    <label class="switch"><input type="checkbox" data-setting="coachAfterSession" ${s.settings.coachAfterSession ? 'checked' : ''}> Comentario del coach al terminar cada entreno</label>
    <label class="switch"><input type="checkbox" data-setting="weeklyReview" ${s.settings.weeklyReview ? 'checked' : ''}> Revisión automática cada semana</label>
  </section>` : ''}` : cloud.enabled ? '' : `
  <section class="card"><h3>Modo local</h3><p class="muted small">Esta copia de ${APP_NAME} funciona sin cuentas: no hay amigos ni coach con IA. Conecta Supabase en <code>js/config.js</code> para activarlos.</p></section>`}

  <form id="pform" class="card form"><h3>Tu entrenamiento</h3>${profileForm(s.profile)}
    <button class="btn primary" type="submit">Guardar</button>
    <p class="muted small">Si cambias objetivo, nivel o días, al guardar te ofrecemos una rutina nueva (tu historial se conserva).</p>
  </form>

  <section class="card">
    <h3>Base científica</h3>
    ${PRINCIPLES.map((p) => `<details class="day"><summary><b>${p.t}</b></summary><p class="small">${p.d}</p><p class="muted small">${p.ref}</p></details>`).join('')}
  </section>

  <section class="card">
    <h3>Tus datos</h3>
    <p class="muted small">${acc ? 'Se guardan en este celular y se sincronizan con tu cuenta.' : 'Todo se guarda en este celular. Exporta un respaldo de vez en cuando.'}</p>
    ${acc ? `<label class="switch"><input type="checkbox" data-setting="shareActivity" ${s.settings.shareActivity !== false ? 'checked' : ''}> Compartir mis entrenos con mis amigos</label>` : ''}
    <label class="switch"><input type="checkbox" data-setting="restSound" ${s.settings.restSound ? 'checked' : ''}> Sonido al terminar el descanso</label>
    ${lock.supported ? `<label class="switch"><input type="checkbox" data-setting="lockScreen" ${s.settings.lockScreen === true ? 'checked' : ''}> Ver el descanso en la pantalla de bloqueo</label>
    <p class="muted small">Ojo: para mostrarlo, la app reproduce un audio en silencio y eso <b>pausa tu música</b> (Spotify, Apple Music…). Actívalo solo si entrenas sin música.</p>` : ''}
    ${lock.canNotify() && Notification.permission !== 'granted' ? `<button class="link" data-act="enableNotify">🔔 Avisarme con una notificación al terminar el descanso</button>` : ''}
    <div class="actions wrap">
      <button class="btn ghost sm" data-act="export">Exportar respaldo</button>
      <label class="btn ghost sm">Importar<input type="file" id="imp" accept="application/json" hidden></label>
      <button class="btn ghost sm danger" data-act="reset">Borrar mis datos</button>
    </div>
  </section>
  <button class="btn ghost big" data-act="tour">🧭 Ver la guía rápida otra vez</button>
  ${acc ? '<button class="btn ghost big" data-act="feedback">💬 Enviar comentario o idea</button>' : ''}
  ${acc ? '<button class="btn ghost big" data-act="logout">Cerrar sesión</button>' : ''}
  ${cloud.mockMode ? '<button class="btn ghost big danger" data-act="demoReset">Empezar la prueba desde cero</button><p class="muted small center">Borra la cuenta de prueba y todos sus datos de este celular.</p>' : ''}
  <p class="muted small center"><a href="privacidad.html">Política de privacidad</a></p>
  <p class="muted small center">${APP_NAME} v0.13${cloud.mockMode ? ' · versión de prueba' : ''}</p>`;

  $('#pform').addEventListener('change', (e) => {
    if (e.target.name !== 'prio') return;
    if (e.target.form.querySelectorAll('input[name=prio]:checked').length > 2) { e.target.checked = false; toast('Elige máximo 2 prioridades'); }
  });
  $('#pform').addEventListener('submit', (e) => {
    e.preventDefault();
    const p = readProfile(e.target);
    const before = db().profile;
    const keys = ['goal', 'level', 'days', 'time', 'sex'];
    const changed = keys.some((k) => String(before[k]) !== String(p[k])) || (before.priorities || []).join() !== p.priorities.join();
    update((st) => { st.profile = { ...st.profile, ...p }; });
    if (changed && confirm('Cambiaste datos que afectan tu plan. ¿Crear un plan nuevo con estos cambios? (Tu historial se conserva.)')) {
      const prev = activePlan();
      const plan = withProgram(generatePlan(db().profile));
      update((st) => {
        if (prev && !st.sessions.some((x) => x.planId === prev.id)) st.plans = st.plans.filter((x) => x.id !== prev.id);
        st.plans.push(plan); st.activePlanId = plan.id; st.coach.newPlanTip = true;
      });
      toast('Rutina nueva creada con tus cambios');
      return go('hoy');
    }
    toast('Perfil guardado');
  });
  $('#nform')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dn = new FormData(e.target).get('dn').trim();
    if (!dn) return;
    try { await cloud.updateDisplayName(dn); toast('Nombre actualizado'); render(); } catch (err) { toast(err.message); }
  });
  $('#imp').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const text = await f.text();
    try { parseBackup(text); } catch (err) { alert('No se pudo importar: ' + err.message); return; }
    if (!confirm(cloud.user ? 'Se cargarán los datos del respaldo y se juntarán con los de tu cuenta. ¿Continuar?' : 'Los datos del respaldo reemplazarán los de este celular. ¿Continuar?')) return;
    try { importJSON(text); toast('Respaldo importado'); render(); } catch (err) { alert('No se pudo importar: ' + err.message); }
  });
  if (acc) cloud.usage().then((u) => {
    const el = $('#usage');
    if (!el) return;
    if (!u) { el.textContent = 'No se pudo cargar el consumo.'; return; }
    const lim = u.limitCents ?? 200;
    const pct = Math.min(100, Math.round((u.usedCents / lim) * 100));
    el.innerHTML = `<div class="meter"><span style="width:${pct}%"></span></div>Este mes: ${pct} % de tu cupo del coach usado. Se renueva el día 1.`;
  });
}

// ---------- Acciones ----------
Object.assign(actions, {
  start: (el) => {
    if (db().activeSession && !confirm('Ya tienes un entreno en curso. ¿Reemplazarlo?')) return go('entreno');
    startSession(el.dataset.day);
  },
  skipDay: () => go('entreno'),
  toggleSet: (el) => {
    const i = +el.dataset.ex, j = +el.dataset.set;
    let rest = 0, ctx = {};
    update((st) => {
      const e = st.activeSession.exercises[i];
      const set = e.sets[j];
      set.done = !set.done;
      if (set.done) {
        if (set.reps === '') set.reps = e.target.reps ?? e.target.repMax;
        if (set.rir === '') set.rir = e.target.rir;
        // propaga el peso a las series siguientes vacías
        for (let k = j + 1; k < e.sets.length; k++) if (e.sets[k].kg === '' && !e.sets[k].done) e.sets[k].kg = set.kg;
        rest = e.target.restSec;
        // Qué viene: la siguiente serie de este ejercicio o el siguiente ejercicio.
        const nextSet = e.sets.findIndex((x, k) => k > j && !x.done);
        const nextEx = st.activeSession.exercises.slice(i + 1).find((x) => x.sets.some((z) => !z.done));
        ctx = { ex: e.name, next: nextSet >= 0 ? `Sigue: serie ${nextSet + 1} de ${e.sets.length}` : nextEx ? `Sigue: ${nextEx.name}` : 'Última serie del entreno' };
      }
    });
    // Opcional (apagado por defecto): el audio en silencio que lo hace posible pausa la música del celular.
    if (rest && db().settings.lockScreen === true) lock.start({ skip: () => stopRest(), add30: () => actions.restAdd() });
    if (rest) startRest(rest, ctx);
    viewEntreno();
  },
  addSet: (el) => { update((st) => { const e = st.activeSession.exercises[+el.dataset.ex]; const l = e.sets[e.sets.length - 1]; e.sets.push({ kg: l?.kg ?? '', reps: '', rir: '', done: false }); }); viewEntreno(); },
  delSet: (el) => {
    const e0 = db().activeSession.exercises[+el.dataset.ex];
    if (e0.sets[e0.sets.length - 1]?.done && !confirm('La última serie ya está marcada como hecha. ¿Quitarla igual?')) return;
    update((st) => { const e = st.activeSession.exercises[+el.dataset.ex]; if (e.sets.length > 1) e.sets.pop(); }); viewEntreno();
  },
  backToStart: () => viewStart(),
  swapEx: (el) => openSwap(+el.dataset.ex),
  swapTo: (el) => { const lib = exerciseByName(el.dataset.name); if (lib) swapExercise(lib); },
  swapSearch: () => {
    const perm = !!$('#swapPerm')?.checked;
    openPicker((ex) => swapExercise(ex, perm));
  },
  // Cambia la unidad de un ejercicio (p. ej. una máquina en libras en un gimnasio en kilos).
  // Los pesos guardados no cambian (están en kg); se recalcula la sugerencia con los saltos de esa unidad.
  exUnit: (el) => {
    const i = +el.dataset.ex;
    const a = db().activeSession;
    const name = a.exercises[i].name;
    const next = unitFor(name) === 'kg' ? 'lb' : 'kg';
    update((st) => {
      const map = { ...(st.profile.exUnits || {}) };
      if (next === (st.profile.unit || 'kg')) delete map[name]; else map[name] = next;
      st.profile.exUnits = map;
    });
    const plan = db().plans.find((p) => p.id === a.planId);
    const def = plan?.days.flatMap((d) => d.exercises).find((x) => x.name === name);
    const cur = a.exercises[i];
    const fresh = sessionExercise(def || { ...cur.target, name: cur.name, muscle: cur.muscle, sec: cur.sec, kind: cur.kind, notes: cur.notes }, def ? plan : null, def ? currentWeek(plan) : null, db().sessions);
    update((st) => {
      const e = st.activeSession.exercises[i];
      const oldKg = e.target.kg;
      e.hint = fresh.hint;
      if (fresh.target.kg) {
        e.sets.forEach((x) => { if (!x.done && (x.kg === '' || x.kg === oldKg)) x.kg = fresh.target.kg; });
        e.target.kg = fresh.target.kg;
      }
      // Lo que quede escrito pasa al peso real más cercano en la nueva unidad (no 93,5 lb).
      e.sets.forEach((x) => { if (!x.done && x.kg !== '' && Number(x.kg) > 0) x.kg = roundLoad(Number(x.kg), e, next); });
    });
    toast(`${name}: pesos en ${next === 'lb' ? 'libras' : 'kilos'}`);
    viewEntreno();
  },
  removeEx: (el) => { if (!confirm('¿Quitar este ejercicio del entreno?')) return; update((st) => st.activeSession.exercises.splice(+el.dataset.ex, 1)); viewEntreno(); },
  pickForSession: () => openPicker((ex) => {
    const a = db().activeSession;
    const plan = db().plans.find((p) => p.id === a.planId);
    const item = sessionExercise(ex, plan, plan && a.week ? currentWeek(plan) : null, db().sessions);
    update((st) => st.activeSession.exercises.push(item));
    viewEntreno();
  }),
  finish: () => finishSession(),
  cancelSession: () => { if (confirm('¿Descartar este entreno? No se guardará.')) { update((st) => (st.activeSession = null)); stopRest(); lock.stop(); go('hoy'); } },
  enableNotify: async () => { const ok = await lock.askNotify(); update((st) => (st.settings.notifyAsked = true)); toast(ok ? 'Listo: te avisamos cuando termine el descanso' : 'Sin permiso de notificaciones: puedes activarlo en los ajustes del celular'); render(); },
  skipNotify: () => { update((st) => (st.settings.notifyAsked = true)); render(); },
  tourGo: (el) => openTour(+el.dataset.i),
  tourEnd: () => { update((st) => (st.settings.tourDone = true)); closeModal(); },
  tour: () => openTour(0),
  tipsDone: () => { update((st) => (st.settings.workoutTipsDone = true)); render(); },
  restAdd: () => { if (restTimer) { restTimer.end += 30000; restTimer.total += 30; renderRestBar(); } },
  restStop: () => stopRest(),

  feedback: () => {
    openModal(`<h2>Cuéntanos</h2>
      <p class="muted small">¿Algo no funciona, te confundió o se te ocurre una idea? Lo lee directamente quien hace la app.</p>
      <textarea id="fbmsg" rows="5" maxlength="2000" placeholder="Ej.: no encontré cómo cambiar un ejercicio en mi rutina"></textarea>
      <p class="formerr" id="fberr" hidden></p>
      <button class="btn primary big" data-act="sendFeedback">Enviar</button>`);
    setTimeout(() => $('#fbmsg')?.focus(), 50);
  },
  sendFeedback: async (el) => {
    const msg = $('#fbmsg').value.trim();
    const err = $('#fberr');
    if (!msg) { err.textContent = 'Escribe tu comentario antes de enviar.'; err.hidden = false; return; }
    el.disabled = true; el.textContent = 'Enviando…';
    try {
      await cloud.sendFeedback({ screen: (location.hash.slice(1) || 'hoy').split('/')[0], message: msg, version: 'v0.13' });
      closeModal(); toast('¡Gracias! Comentario enviado');
    } catch (ex) { err.textContent = ex.message; err.hidden = false; el.disabled = false; el.textContent = 'Enviar'; }
  },
  startOwn: () => newDraft(),
  importRoutine: () => {
    if (!cloud.enabled || !cloud.user) return alert('Inicia sesión para importar tu rutina.');
    closeModal();
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/pdf,image/*'; inp.multiple = true;
    inp.addEventListener('change', () => runImport([...inp.files]));
    inp.click();
  },
  startScience: () => go('dividir'),
  editActive: () => { update((st) => (st.coach.newPlanTip = false)); draft = clone(activePlan()); go('editar'); },
  exSets: (el) => { const e = draft.days[+el.dataset.day].exercises[+el.dataset.ex]; e.sets = Math.max(1, Math.min(8, (Number(e.sets) || 3) + Number(el.dataset.d))); const y = scrollY; viewEditar(); window.scrollTo(0, y); },
  applyFix: (el) => {
    const item = reviewRoutine(draft, db().profile)[+el.dataset.i];
    if (!item?.fix) return;
    applyFix(draft, item.fix, db().profile);
    toast('Listo: ' + item.fix.label.toLowerCase());
    const y = scrollY; viewEditar(); window.scrollTo(0, y);
  },
  tipDone: (el) => { update((st) => (st.coach.newPlanTip = false)); if (el.tagName !== 'A') render(); },
  choiceScience: () => { generateSciencePlan(); go('hoy'); },
  genScience: () => go('dividir'),
  splitDays: (el) => { update((st) => (st.profile.days = Number(el.dataset.n))); viewSplit(); },
  chooseSplit: (el) => {
    const plan = withProgram(generatePlan(db().profile, el.dataset.key));
    const first = !activePlan();
    update((st) => { st.plans.push(plan); if (first) { st.activePlanId = plan.id; st.coach.newPlanTip = true; } });
    if (first) sharePlan(plan);
    if (first) { toast('¡Listo! Este es tu primer entreno'); go('hoy'); }
    else { go('rutinas'); showPlanPreview(plan); }
  },
  askChanges: (el) => openAskChanges(el.dataset.plan),
  sendChanges: () => sendChanges(),
  applyChanges: () => applyChanges(),
  exampleChange: (el) => { const t = $('#chreq'); if (t) { t.value = el.dataset.text; t.focus(); } },
  newPlan: () => newDraft(),
  activate: (el) => {
    update((st) => {
      st.activePlanId = el.dataset.plan;
      const p = st.plans.find((x) => x.id === el.dataset.plan);
      // Si nunca se ha usado, el plan de 12 semanas arranca hoy.
      if (p && !st.sessions.some((x) => x.planId === p.id)) { p.program.startDate = today(); p.nextDay = 0; }
    });
    const p = activePlan();
    sharePlan(p);
    closeModal(); toast('Rutina activada: empieza la semana 1'); go('rutinas');
  },
  edit: (el) => { draft = clone(db().plans.find((p) => p.id === el.dataset.plan)); closeModal(); go('editar'); },
  duplicate: (el) => { const p = clone(db().plans.find((x) => x.id === el.dataset.plan)); p.id = uid(); p.name += ' (copia)'; p.source = 'propia'; p.reviews = []; p.days.forEach((d) => (d.id = uid())); withProgram(p, p.program?.repMode); update((st) => st.plans.push(p)); closeModal(); toast('Rutina duplicada'); render(); },
  applyRec: (el) => {
    const plan = activePlan();
    const rec = planRecs(plan)[+el.dataset.i];
    if (!rec) return;
    if (rec.action === 'nextPlan') return actions.genScience();
    if (rec.action === 'aiReview') return COACH_ENABLED && cloud.enabled ? actions.aiReview() : actions.genScience();
    if (rec.action === 'fewerDays') { update((st) => dismissRec(st.plans.find((p) => p.id === plan.id), rec, today())); toast('Cambia los días en tu perfil y crea una rutina nueva'); return go('perfil'); }
    update((st) => applyRec(st.plans.find((p) => p.id === plan.id), st.sessions, rec, today()));
    toast(rec.action === 'deloadNow' ? 'Descarga adelantada a esta semana' : 'Objetivos recalculados');
    render();
  },
  dismissRec: (el) => {
    const plan = activePlan();
    const rec = planRecs(plan)[+el.dataset.i];
    if (rec) update((st) => dismissRec(st.plans.find((p) => p.id === plan.id), rec, today()));
    render();
  },
  deletePlan: (el) => {
    if (!confirm('¿Eliminar este plan? Tu historial de entrenos se conserva.')) return;
    update((st) => { st.plans = st.plans.filter((p) => p.id !== el.dataset.plan); if (st.activePlanId === el.dataset.plan) st.activePlanId = st.plans[0]?.id || null; });
    closeModal(); render();
  },

  cancelEdit: () => { draft = null; keepDraft(); go('rutinas'); },
  addDay: () => { draft.days.push({ id: uid(), name: `Día ${draft.days.length + 1}`, focus: '', exercises: [] }); viewEditar(); },
  delDay: (el) => { if (draft.days.length > 1 && confirm('¿Eliminar este día?')) { draft.days.splice(+el.dataset.day, 1); viewEditar(); } },
  delEx: (el) => { draft.days[+el.dataset.day].exercises.splice(+el.dataset.ex, 1); viewEditar(); },
  moveEx: (el) => { const arr = draft.days[+el.dataset.day].exercises; const i = +el.dataset.ex, j = i + +el.dataset.dir; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; viewEditar(); },
  pickForDraft: (el) => { const d = +el.dataset.day; openPicker((ex) => { draft.days[d].exercises.push(ex); viewEditar(); }); },
  saveDraft: () => {
    if (!draft.days.length) return alert('Agrega al menos un día.');
    if (draft.days.some((d) => !d.exercises.length)) return alert('Cada día necesita al menos un ejercicio (o bórralo).');
    const isNew = draft._new; delete draft._new; delete draft._imported;
    draft.days.forEach((d) => { d.focus = [...new Set(d.exercises.map((e) => MUSCLES[e.muscle]))].slice(0, 4).join(', '); d.exercises.forEach((e) => { if (Number(e.repMin) > Number(e.repMax)) [e.repMin, e.repMax] = [e.repMax, e.repMin]; }); });
    const saved = draft;
    update((st) => { const i = st.plans.findIndex((p) => p.id === saved.id); if (i >= 0) st.plans[i] = saved; else st.plans.push(saved); if (isNew || !st.activePlanId) st.activePlanId = saved.id; st.coach.newPlanTip = false; });
    if (isNew) sharePlan(saved);
    draft = null; keepDraft();
    // Si editaste la rutina con un entreno de ese día en curso, ofrece llevar los cambios al entreno.
    const a = db().activeSession;
    const day = !isNew && a && a.planId === saved.id ? saved.days.find((d) => d.id === a.dayId) : null;
    if (day && confirm(`Tienes un entreno de "${day.name}" en curso. ¿Aplicar estos cambios también al entreno de hoy?

Las series que ya marcaste se conservan.`)) {
      syncSessionWithDay(saved, day);
      toast('Rutina guardada y entreno actualizado');
      return go('entreno');
    }
    toast(isNew ? '¡Rutina lista! Mira tu primer entreno en Hoy' : 'Rutina guardada'); go(isNew ? 'hoy' : 'rutinas');
  },

  pick: (el) => { const ex = exerciseByName(el.dataset.name); closeModal(); pickerCb?.(exerciseFromLib(ex)); },
  pickCustom: () => {
    const name = $('#cname').value.trim();
    if (!name) return;
    const ex = { name, muscle: $('#cmuscle').value, sec: [], kind: $('#ckind').value, equip: '' };
    closeModal(); pickerCb?.(exerciseFromLib(ex));
  },
  closeModal: () => closeModal(),
  pickPlanEx: (el) => { planExercise = el.dataset.name; viewProgreso(); document.querySelector('#pchart')?.scrollIntoView({ block: 'center' }); },

  delWeight: (el) => { update((st) => (st.weights = st.weights.filter((w) => w.id !== el.dataset.id))); render(); },
  delSession: (el) => { if (confirm('¿Eliminar este entreno del historial?')) { update((st) => (st.sessions = st.sessions.filter((x) => x.id !== el.dataset.id))); render(); } },
  export: () => {
    const blob = new Blob([exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `forja-respaldo-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  reset: () => {
    if (!(confirm(`Esto borra TODOS tus datos de entrenamiento${cloud.user ? ' de este celular y de tu cuenta' : ' de este celular'}. ¿Seguro?`) && confirm('Última confirmación: ¿borrar todo?'))) return;
    resetAll(!!cloud.user); draft = null; try { localStorage.removeItem(DRAFT_KEY); } catch {}
    cloud.clearActivity(); // también lo publicado en el feed de tus amigos
    location.hash = ''; render();
  },
  demoReset: async () => {
    if (!confirm('¿Borrar la cuenta de prueba y empezar desde cero?')) return;
    Object.keys(localStorage).filter((k) => k.startsWith('forja.')).forEach((k) => localStorage.removeItem(k));
    sessionStorage.clear();
    location.href = location.pathname;
  },
  logout: async () => {
    if (db().activeSession && !confirm('Tienes un entreno en curso. ¿Cerrar sesión igual?')) return;
    // Antes de borrar los datos del celular, que todo esté en la nube.
    if (cloud.hasUnsynced()) {
      await cloud.flush();
      if (cloud.hasUnsynced() && !confirm('Hay cambios que todavía no se han subido a tu cuenta (¿estás sin conexión?). Si cierras sesión ahora, se pierden. ¿Cerrar sesión igual?')) return;
    }
    await cloud.signOut();
    resetAll(false);
    draft = null; try { localStorage.removeItem(DRAFT_KEY); } catch {}
    location.hash = '';
    render();
  },
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) {
    if (e.target.id === 'modal' && $('#modal').dataset.closable) closeModal();
    return;
  }
  const fn = actions[el.dataset.act];
  if (fn) { if (el.tagName !== 'A') e.preventDefault(); fn(el, e); }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.setting) {
    update((st) => (st.settings[el.dataset.setting] = el.checked));
  } else if (el.dataset.bind) {
    // Inputs de series (entreno en curso)
    const i = +el.dataset.ex, j = +el.dataset.set;
    let copied = [];
    update((st) => {
      const ex = st.activeSession.exercises[i];
      const n = parseNum(el.value);
      const val = n == null ? '' : el.dataset.bind === 'kg' ? fromUnit(n, unitFor(ex.name)) : n;
      const old = ex.sets[j][el.dataset.bind];
      ex.sets[j][el.dataset.bind] = val;
      // Como en las apps de gimnasio: el nuevo peso pasa a las series siguientes que seguían con el anterior.
      if (el.dataset.bind === 'kg' && val !== '') {
        ex.sets.forEach((s, k) => { if (k > j && !s.done && (s.kg === old || s.kg === '')) { s.kg = val; copied.push(k); } });
      }
    });
    for (const k of copied) {
      const inp = document.querySelector(`input[data-bind="kg"][data-ex="${i}"][data-set="${k}"]`);
      if (inp) inp.value = el.value.trim();
    }
  } else if (el.dataset.draft && draft) {
    const [scope, field] = el.dataset.draft.split('.');
    const val = el.type === 'number' ? Number(el.value) : el.value;
    if (scope === 'name') draft.name = el.value;
    else if (scope === 'mode') draft.program = { ...newProgram(db().profile, draft.program.startDate, el.value), adjust: draft.program.adjust || {} };
    else if (scope === 'day') draft.days[+el.dataset.day][field] = val;
    else if (scope === 'ex') draft.days[+el.dataset.day].exercises[+el.dataset.ex][field] = val;
    // La revisión y la duración se recalculan con cada cambio.
    if (scope !== 'name' && location.hash.startsWith('#editar')) { const y = scrollY; viewEditar(); window.scrollTo(0, y); }
  }
});

// ---------- Arranque ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

async function afterLogin() {
  await cloud.syncOnLogin({
    askAdoptLocal: async () => confirm('Este celular tiene entrenos guardados sin cuenta. ¿Quieres pasarlos a tu cuenta? Se juntan con lo que ya tienes en la nube. (Si cancelas, se usan solo los datos de la nube.)'),
  });
  await consumeInvite();
}

cloud.onAuthChange(async (u, reason) => {
  if (u && reason !== 'pulled') { try { await afterLogin(); } catch (e) { console.error(e); toast('No se pudo sincronizar. Seguiremos intentando.'); } }
  render();
});

(async function boot() {
  main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const u = await cloud.init();
    if (u && !u.offline) await afterLogin();
    else if (u?.offline) toast('Sin conexión: tus cambios se guardan en este celular y se suben al volver la señal.');
  } catch (e) {
    console.error(e);
    toast('Sin conexión con la nube: usando los datos de este celular.');
  }
  booted = true;
  render();
})();

export { afterLogin, showPlanPreview, planCard };
