// Periodización: plan de 12 semanas = 3 bloques de 4 semanas (3 de carga + 1 de descarga).
// Calcula la prescripción de cada semana (series, reps, RIR, kg), la progresión esperada
// y la compara con lo que realmente vas levantando para recomendar ajustes.

import { e1rm, exerciseByName, estimateStart1RM, perHand } from './science.js';

export const WEEKS = 12;
const DAY = 864e5;

// Rangos de repeticiones por bloque y objetivo. c = compuesto, i = aislamiento.
const BLOCKS = {
  hipertrofia: [
    { name: 'Base', desc: 'Técnica y volumen con repeticiones medias-altas.', c: [8, 12], i: [12, 15] },
    { name: 'Desarrollo', desc: 'Más carga en el rango clásico de hipertrofia.', c: [6, 10], i: [10, 15] },
    { name: 'Intensificación', desc: 'Cargas más altas en los compuestos.', c: [5, 8], i: [8, 12] },
  ],
  fuerza: [
    { name: 'Base de músculo', desc: 'Construir músculo que luego se convierte en fuerza.', c: [6, 10], i: [10, 15] },
    { name: 'Fuerza', desc: 'Cargas pesadas en los básicos.', c: [4, 6], i: [8, 12] },
    { name: 'Pico', desc: 'Máxima intensidad; menos repeticiones.', c: [2, 4], i: [8, 12] },
  ],
  grasa: [
    { name: 'Base', desc: 'Técnica y volumen mientras arranca el déficit.', c: [8, 12], i: [12, 15] },
    { name: 'Mantener fuerza', desc: 'Entrenar pesado para conservar músculo.', c: [6, 10], i: [10, 15] },
    { name: 'Mantener fuerza II', desc: 'Igual de pesado, gestionando la fatiga del déficit.', c: [6, 10], i: [10, 15] },
  ],
  recomposicion: [
    { name: 'Base', desc: 'Volumen y técnica.', c: [8, 12], i: [12, 15] },
    { name: 'Desarrollo', desc: 'Más carga.', c: [6, 10], i: [10, 15] },
    { name: 'Consolidación', desc: 'Cargas altas sostenidas.', c: [6, 8], i: [8, 12] },
  ],
  salud: [
    { name: 'Adaptación', desc: 'Aprender los movimientos con margen.', c: [10, 12], i: [12, 15] },
    { name: 'Progresión', desc: 'Más carga, misma técnica.', c: [8, 12], i: [10, 15] },
    { name: 'Consolidación', desc: 'Afianzar la fuerza ganada.', c: [8, 10], i: [10, 12] },
  ],
};

// Progreso semanal esperado del 1RM estimado (estimaciones prudentes; se recalibran con tus datos).
function weeklyRate(level, goal, kind, bodyweight) {
  let r = bodyweight ? { principiante: 0.03, intermedio: 0.015, avanzado: 0.008 }[level] : { principiante: 0.02, intermedio: 0.0075, avanzado: 0.004 }[level];
  r = r ?? 0.0075;
  if (kind === 'i') r *= 0.6;
  r *= { grasa: 0.3, recomposicion: 0.6, salud: 0.8, fuerza: 1.1 }[goal] ?? 1;
  return r;
}

// repMode: 'fases' (plan periodizado de 12 semanas), 'fijo' (tus reps, periodizado) o
// 'doble' (tu rutina con progresión doble, sin fases ni fecha de fin).
export function newProgram(profile, startDate, repMode = 'fases') {
  const doble = repMode === 'doble';
  return { weeks: doble ? 52 : WEEKS, startDate, goal: profile.goal, level: profile.level, repMode, deloads: doble ? [] : [4, 8, 12], adjust: {}, dismissed: [] };
}
export const isDouble = (plan) => plan?.program?.repMode === 'doble';

// Asegura que cualquier rutina (incluidas las antiguas o las propias) tenga un plan de 12 semanas.
export function ensureProgram(plan, profile) {
  if (!plan.program) plan.program = newProgram(profile, (plan.createdAt || new Date().toISOString()).slice(0, 10), plan.source === 'propia' ? 'fijo' : 'fases');
  return plan.program;
}

const isoToMs = (iso) => +new Date(iso + 'T12:00:00');
export const weekOf = (plan, dateIso) => Math.floor((isoToMs(dateIso) - isoToMs(plan.program.startDate)) / (7 * DAY)) + 1;
export const weekDate = (plan, w) => new Date(isoToMs(plan.program.startDate) + ((w - 1) * 7 + 3) * DAY).toISOString().slice(0, 10);

export function weekInfo(plan, w) {
  const p = plan.program;
  if (p.repMode === 'doble') {
    const week = Math.max(1, Math.min(w, p.weeks));
    return { week, block: 1, inBlock: 1, deload: false, mode: 'doble', blockName: 'Tu rutina', blockDesc: 'Progresión doble', label: 'Progresión doble', finished: w > p.weeks };
  }
  const week = Math.max(1, Math.min(w, p.weeks));
  const block = Math.min(Math.ceil(week / 4), 3);
  const inBlock = week - (block - 1) * 4;
  const deload = p.deloads.includes(week);
  const blocks = BLOCKS[p.goal] || BLOCKS.hipertrofia;
  return {
    week, block, inBlock, deload,
    blockName: blocks[block - 1].name,
    blockDesc: blocks[block - 1].desc,
    label: deload ? (week === p.weeks ? 'Descarga y evaluación' : 'Semana de descarga') : inBlock === 3 ? 'Semana más exigente' : 'Semana de carga',
    finished: w > p.weeks,
  };
}

// Semanas que suman progreso entre dos semanas (las de descarga no suman).
function progressWeeks(plan, from, to) {
  let n = 0;
  for (let w = from + 1; w <= to; w++) if (!plan.program.deloads.includes(w)) n++;
  return n;
}

const isBodyweight = (ex) => (exerciseByName(ex.name)?.equip || '') === 'peso_corporal';

// Métrica de rendimiento de una serie: 1RM estimado con las reps en reserva (o reps totales posibles si es peso corporal).
export function setMetric(set, bw) {
  const reps = Number(set.reps) || 0;
  const rir = Number(set.rir) || 0;
  if (bw) return reps + rir;
  return e1rm(Number(set.kg) || 0, reps + rir);
}

function sessionMetric(exLog, bw) {
  return Math.max(0, ...exLog.sets.filter((s) => s.done !== false).map((s) => setMetric(s, bw)));
}

// Línea base del ejercicio: primera sesión dentro del plan; si no hay, la más reciente anterior (≤ 8 semanas).
export function baseline(plan, sessions, ex) {
  const bw = isBodyweight(ex);
  const start = isoToMs(plan.program.startDate);
  const inPlan = sessions.filter((s) => s.planId === plan.id && isoToMs(s.date) >= start);
  for (const s of inPlan) {
    const e = s.exercises.find((z) => z.name === ex.name);
    if (e) { const m = sessionMetric(e, bw); if (m > 0) return { metric: m, week: weekOf(plan, s.date) }; }
  }
  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i];
    if (isoToMs(s.date) >= start || isoToMs(s.date) < start - 56 * DAY) continue;
    const e = s.exercises.find((z) => z.name === ex.name);
    if (e) { const m = sessionMetric(e, bw); if (m > 0) return { metric: m, week: 1 }; }
  }
  return null;
}

export function plannedMetric(plan, sessions, ex, w) {
  const base = baseline(plan, sessions, ex);
  if (!base) return null;
  const rate = weeklyRate(plan.program.level, plan.program.goal, ex.kind || exerciseByName(ex.name)?.kind, isBodyweight(ex));
  const adj = plan.program.adjust[ex.name] || 1;
  return base.metric * (1 + rate) ** progressWeeks(plan, base.week, w) * adj;
}

// Redondea al incremento real del equipo y respeta el mínimo físico (la barra sola ya pesa 20 kg).
// ---------- Unidades: todo se guarda en kg; se muestra y se redondea en la unidad de cada ejercicio ----------
export const LB = 0.45359237;
export const unitOf = (profile, name) => profile?.exUnits?.[name] || profile?.unit || 'kg';
// kg → número en la unidad (libras a 0,5; kilos a 0,01).
export function inUnit(kg, unit = 'kg') {
  const n = Number(kg);
  if (!Number.isFinite(n)) return '';
  return unit === 'lb' ? Math.round((n / LB) * 2) / 2 : Math.round(n * 100) / 100;
}
export const fromUnit = (v, unit = 'kg') => (unit === 'lb' ? Math.round(Number(v) * LB * 1000) / 1000 : Number(v));
export const numStr = (v) => String(v).replace('.', ',');
export const fmtW = (kg, unit = 'kg') => `${numStr(inUnit(kg, unit))} ${unit}`;

const LIGHT_BAR = ['curl_barra', 'frances', 'curl_predicador'];
// Redondea al incremento real del equipo y respeta el mínimo físico (la barra sola: 20 kg o 45 lb).
function roundLoad(kg, ex, unit = 'kg') {
  const lib = exerciseByName(ex.name);
  const eq = lib?.equip;
  if (unit === 'lb') {
    // En libras: discos de 2,5 lb por lado y mancuernas/placas de 5 en 5.
    const step = eq === 'barra' || eq === 'maquina' || eq === 'polea' || eq === 'mancuernas' ? 5 : 1;
    const min = eq === 'barra' ? (LIGHT_BAR.includes(lib.id) ? 20 : 45) : eq === 'maquina' ? 10 : eq === 'polea' || eq === 'mancuernas' ? 5 : step;
    return fromUnit(Math.max(min, Math.round(kg / LB / step) * step), 'lb');
  }
  const step = eq === 'barra' || eq === 'maquina' || eq === 'polea' ? 2.5 : eq === 'mancuernas' ? 2 : 1;
  const min = eq === 'barra' ? (LIGHT_BAR.includes(lib.id) ? 10 : 20) : eq === 'maquina' ? 5 : eq === 'polea' ? 2.5 : eq === 'mancuernas' ? 2 : step;
  return Math.max(min, Math.round(kg / step) * step);
}

// Prescripción de un ejercicio para una semana concreta.
// profile (opcional): permite sugerir el peso inicial antes de la primera sesión.
export function prescribe(plan, sessions, ex, w, profile = null) {
  if (plan.program.repMode === 'doble') return prescribeDouble(plan, sessions, ex, profile);
  const info = weekInfo(plan, w);
  const kind = ex.kind || exerciseByName(ex.name)?.kind || 'c';
  const lvl = plan.program.level;
  let [repMin, repMax] = plan.program.repMode === 'fijo' ? [ex.repMin, ex.repMax] : (BLOCKS[plan.program.goal] || BLOCKS.hipertrofia)[info.block - 1][kind];
  let rir, sets = Number(ex.sets) || 3;
  if (info.deload) { rir = 4; sets = Math.max(1, Math.ceil(sets / 2)); }
  else {
    rir = (lvl === 'principiante' ? [3, 3, 2] : [3, 2, 1])[info.inBlock - 1] ?? 2;
    if (kind === 'i') rir = Math.max(lvl === 'principiante' ? 1 : 0, rir - 1);
    // Salud: siempre con margen (2–3 en reserva), como promete el plan; nunca cerca del fallo.
    if (plan.program.goal === 'salud') rir = Math.max(rir, 2);
    if (info.inBlock === 3 && sets < 5) sets += 1;
  }
  const restSec = kind === 'c' ? (repMax <= 6 ? 210 : 150) : 75;
  const targetReps = Math.round((repMin + repMax) / 2);
  const bw = isBodyweight(ex);
  const unit = unitOf(profile, ex.name);
  const pm = plannedMetric(plan, sessions, ex, info.week);
  let kg = null, text;
  if (pm == null) {
    const est = !bw && estimateStart1RM(profile, ex.name);
    if (est) {
      kg = roundLoad(est / (1 + (targetReps + rir) / 30), ex, unit);
      text = `Peso sugerido para empezar: ${fmtW(kg, unit)}${perHand(ex.name) ? ' por mancuerna' : ''} × ${targetReps} reps (estimado con tu peso y nivel). Si te sobran más de ${rir} reps o no llegas, ajústalo: esta sesión calibra tu plan.`;
    } else if (bw) {
      text = `Primera vez: haz ${targetReps} reps por serie dejando ${rir} en reserva. Si no llegas, haz la versión más fácil; si te sobran muchas, ponle más dificultad.`;
    } else {
      text = `Primera vez: elige un peso con el que hagas ${targetReps} reps dejando ${rir} en reserva. Con eso calculo tu progresión.`;
    }
  } else if (bw) {
    const reps = Math.round(pm - rir);
    text = reps > repMax
      ? `Objetivo ${reps} reps: supera el rango, añade dificultad (lastre, pausa o tempo lento).`
      : `Objetivo: ${Math.max(reps, 1)} reps por serie dejando ${rir} en reserva.`;
  } else {
    kg = roundLoad(pm / (1 + (targetReps + rir) / 30), ex, unit);
    text = `Objetivo: ${fmtW(kg, unit)}${perHand(ex.name) ? ' por mancuerna' : ''} × ${targetReps} reps, RIR ${rir}${info.deload ? ' (descarga: más ligero, recupera)' : ''}.`;
  }
  return { sets, repMin, repMax, rir, restSec, targetReps, kg, text, deload: info.deload };
}

// ---------- Progresión doble (rutinas propias) ----------
// Trabajas en un rango de repeticiones con el mismo peso. Cuando completas el tope del rango en
// todas las series, subes el peso y vuelves al mínimo. Si te quedas muy corto, la carga baja.
const LOWER_BODY = new Set(['cuadriceps', 'isquios', 'gluteos', 'gemelos']);

function lastLog(sessions, name) {
  for (let i = sessions.length - 1; i >= 0; i--) {
    const e = sessions[i].exercises.find((x) => x.name === name);
    const done = e?.sets.filter((x) => x.done !== false && x.reps !== '' && x.reps != null);
    if (done?.length) return { date: sessions[i].date, sets: done };
  }
  return null;
}

// Salto de peso en kg (en libras: 5 lb, que es lo mínimo que sube un gimnasio en libras).
function loadStep(ex, unit = 'kg') {
  const lib = exerciseByName(ex.name);
  const eq = lib?.equip;
  const base = unit === 'lb' ? (eq ? 5 * LB : LB) : eq === 'mancuernas' ? 2 : eq === 'barra' || eq === 'maquina' || eq === 'polea' ? 2.5 : 1;
  // En piernas con barra o máquina se progresa más rápido.
  return LOWER_BODY.has(ex.muscle || lib?.muscle) && (eq === 'barra' || eq === 'maquina') && (lib?.kind || ex.kind) === 'c' ? base * 2 : base;
}

export function prescribeDouble(plan, sessions, ex, profile = null) {
  const kind = ex.kind || exerciseByName(ex.name)?.kind || 'c';
  const repMin = Number(ex.repMin) || (kind === 'c' ? 6 : 10);
  const repMax = Math.max(Number(ex.repMax) || (kind === 'c' ? 10 : 15), repMin);
  const sets = Number(ex.sets) || 3;
  const rir = Number.isFinite(Number(ex.rir)) && ex.rir !== '' ? Number(ex.rir) : 2;
  const restSec = Number(ex.restSec) || (kind === 'c' ? 150 : 75);
  const bw = isBodyweight(ex);
  const hand = perHand(ex.name) ? ' por mancuerna' : '';
  const unit = unitOf(profile, ex.name);
  const W = (kg) => fmtW(kg, unit);
  const base = { sets, repMin, repMax, rir, restSec, deload: false };
  const last = lastLog(sessions, ex.name);

  if (!last) {
    const target = Math.min(repMax, repMin + 1);
    const est = !bw && estimateStart1RM(profile, ex.name);
    if (est) {
      const kg = roundLoad(est / (1 + (target + rir) / 30), ex, unit);
      return { ...base, targetReps: target, kg, text: `Peso sugerido para empezar: ${W(kg)}${hand} × ${target} reps (estimado con tu peso y nivel). Si te sobran más de ${rir} reps o no llegas, ajústalo: así la app aprende tu nivel.` };
    }
    return { ...base, targetReps: target, kg: null, text: bw ? `Primera vez: haz ${target}–${repMax} reps por serie dejando ${rir} en reserva.` : `Primera vez: elige un peso con el que hagas ${target} reps dejando ${rir} en reserva.` };
  }

  const kgs = last.sets.map((x) => Number(x.kg) || 0);
  const top = Math.max(...kgs);
  const atTop = last.sets.filter((x) => (Number(x.kg) || 0) === top);
  const reps = atTop.map((x) => Number(x.reps) || 0);
  const minReps = Math.min(...reps);
  const avgRir = atTop.reduce((a, x) => a + (Number(x.rir) || 0), 0) / atTop.length;
  const completed = atTop.length >= sets && minReps >= repMax;

  if (bw) {
    if (completed) return { ...base, targetReps: repMax, kg: null, text: `Completaste ${repMax} reps en todas las series: hazlo más difícil (lastre, pausa o tempo lento) y vuelve a ${repMin}.` };
    return { ...base, targetReps: Math.min(repMax, minReps + 1), kg: null, text: `Busca ${Math.min(repMax, minReps + 1)} reps en cada serie (la vez pasada: ${reps.join(', ')}).` };
  }
  if (completed) {
    // Si además te sobraron muchas reps en reserva, el salto es doble.
    const jump = loadStep(ex, unit) * (avgRir >= rir + 2 ? 2 : 1);
    const kg = roundLoad(top + jump, ex, unit);
    return { ...base, targetReps: repMin, kg, text: `¡Subes peso! Completaste ${repMax} reps en todas las series: ${numStr(inUnit(top, unit))} → ${W(kg)}${hand}. Vuelve a ${repMin} reps y sube desde ahí.` };
  }
  if (minReps < repMin - 1) {
    const kg = roundLoad(top * 0.9, ex, unit);
    return { ...base, targetReps: repMin, kg, text: `La vez pasada te quedaste corto (${reps.join(', ')} reps). Baja a ${W(kg)}${hand} y busca ${repMin} reps con buena técnica.` };
  }
  const target = Math.min(repMax, Math.max(repMin, minReps + 1));
  return { ...base, targetReps: target, kg: top, text: `Mantén ${W(top)}${hand} y busca ${target} reps en cada serie (la vez pasada: ${reps.join(', ')}). Al llegar a ${repMax} en todas, subes peso.` };
}

// Series de plan vs real para un ejercicio (para graficar).
export function exerciseTrack(plan, sessions, ex) {
  const bw = isBodyweight(ex);
  const real = [];
  for (const s of sessions) {
    if (s.planId !== plan.id) continue;
    const e = s.exercises.find((z) => z.name === ex.name);
    if (!e) continue;
    const m = sessionMetric(e, bw);
    if (m > 0) real.push({ x: s.date, y: m, week: weekOf(plan, s.date) });
  }
  const planned = [];
  for (let w = 1; w <= plan.program.weeks; w++) {
    const pm = plannedMetric(plan, sessions, ex, w);
    if (pm != null) planned.push({ x: weekDate(plan, w), y: pm, week: w });
  }
  return { real, planned, unit: bw ? 'reps' : 'kg', bw };
}

// Estado de cada ejercicio: últimas dos sesiones comparadas con lo planificado para su semana.
export function exerciseStatus(plan, sessions) {
  const exs = uniqueExercises(plan);
  return exs.map((ex) => {
    const t = exerciseTrack(plan, sessions, ex);
    const pts = t.real.map((r) => ({ ...r, plan: plannedMetric(plan, sessions, ex, r.week) })).filter((r) => r.plan);
    const last = pts.slice(-2).map((r) => r.y / r.plan);
    const ratio = last.length ? last[last.length - 1] : null;
    const status = ratio == null ? 'sin' : ratio >= 1.03 ? 'arriba' : ratio <= 0.97 ? 'abajo' : 'linea';
    const streak = last.length === 2 && last.every((r) => r >= 1.03) ? 'arriba' : last.length === 2 && last.every((r) => r <= 0.97) ? 'abajo' : null;
    return { ex, ratio, status, streak, n: pts.length, last: pts[pts.length - 1] };
  });
}

export function uniqueExercises(plan) {
  const seen = new Map();
  for (const d of plan.days) for (const e of d.exercises) if (!seen.has(e.name)) seen.set(e.name, e);
  return [...seen.values()];
}

// Motor de ajustes: qué hacer cuando lo real se separa de lo planificado.
export function review(plan, sessions, { now, profile, weightRate }) {
  const w = weekOf(plan, now);
  const info = weekInfo(plan, w);
  const st = exerciseStatus(plan, sessions);
  const tracked = st.filter((s) => s.n >= 2);
  const recs = [];
  const p = plan.program;

  if (info.finished) {
    recs.push({ key: 'fin', level: 'info', title: 'Plan completado 🎉', text: 'Terminaste las 12 semanas. Revisa los resultados con IA para crear el siguiente plan ajustado a ti, o genera uno nuevo con ciencia. Tus marcas actuales serán el punto de partida.', action: 'aiReview', cta: 'Revisar con IA' });
  }

  const ups = tracked.filter((s) => s.streak === 'arriba');
  if (ups.length) recs.push({ key: 'up', level: 'good', title: `Vas por delante en ${ups.length} ejercicio${ups.length > 1 ? 's' : ''}`, text: `${ups.map((s) => s.ex.name).join(', ')}: llevas dos sesiones por encima del plan. Subo los objetivos para que sigan siendo un reto.`, action: 'recal', payload: ups.map((s) => s.ex.name), cta: 'Subir objetivos' });

  const downs = tracked.filter((s) => s.streak === 'abajo');
  const fatigue = tracked.length >= 3 && tracked.filter((s) => s.status === 'abajo').length / tracked.length >= 0.5;
  const nextDeload = p.deloads.find((d) => d >= info.week);
  if (fatigue && !info.deload && nextDeload && nextDeload - info.week >= 1) {
    recs.push({ key: 'deload', level: 'warn', title: 'Señales de fatiga acumulada', text: `La mitad o más de tus ejercicios están por debajo del plan. Lo más eficaz suele ser adelantar la descarga a esta semana (semana ${info.week}) y retomar con energía. Revisa también sueño y comida.`, action: 'deloadNow', cta: 'Adelantar descarga' });
  } else if (downs.length) {
    const hard = info.inBlock === 3;
    recs.push({ key: 'down', level: 'warn', title: `Por debajo del plan en ${downs.length} ejercicio${downs.length > 1 ? 's' : ''}`, text: hard
      ? `${downs.map((s) => s.ex.name).join(', ')}: es la semana más exigente del bloque; es normal rendir un poco menos. La descarga de la semana ${nextDeload} debería devolverte el rendimiento.`
      : `${downs.map((s) => s.ex.name).join(', ')}: dos sesiones seguidas por debajo. Ajusto los objetivos a tu nivel real para que la progresión sea alcanzable.`,
      action: hard ? null : 'recal', payload: downs.map((s) => s.ex.name), cta: hard ? null : 'Ajustar objetivos' });
  }

  // Adherencia: sesiones hechas vs previstas en las semanas ya cerradas.
  const closedWeeks = Math.min(info.week - 1, p.weeks);
  if (closedWeeks >= 2) {
    const startMs = isoToMs(p.startDate);
    const done = sessions.filter((s) => s.planId === plan.id && isoToMs(s.date) >= startMs && weekOf(plan, s.date) <= closedWeeks).length;
    const expected = closedWeeks * plan.days.length;
    const adh = done / expected;
    if (adh < 0.7) recs.push({ key: 'adh', level: 'warn', title: `Adherencia del ${Math.round(adh * 100)} %`, text: `Has hecho ${done} de ${expected} entrenos previstos. Un plan con menos días que sí cumplas da más resultado que uno ideal que no. Considera bajar a ${Math.max(2, plan.days.length - 1)} días.`, action: 'fewerDays', cta: 'Cambiar días' });
  }

  // Peso corporal vs objetivo
  if (weightRate != null && profile) {
    if (profile.goal === 'grasa' && weightRate > -0.25) recs.push({ key: 'peso', level: 'info', title: 'El peso no baja al ritmo previsto', text: `Vas a ${weightRate.toFixed(2)} %/semana; el objetivo es −0,5 a −1 %. Ajusta la dieta (≈ −200–300 kcal/día) antes que añadir más entrenamiento.` });
    if (profile.goal === 'grasa' && weightRate < -1.2) recs.push({ key: 'peso', level: 'warn', title: 'Estás bajando demasiado rápido', text: `Vas a ${weightRate.toFixed(2)} %/semana. Por encima del 1 % aumenta el riesgo de perder músculo y fuerza: come un poco más.` });
    if (profile.goal === 'hipertrofia' && weightRate < 0) recs.push({ key: 'peso', level: 'info', title: 'Para ganar músculo conviene un ligero superávit', text: `Tu peso baja (${weightRate.toFixed(2)} %/semana). Apunta a +0,25–0,5 %/semana para no frenar la progresión.` });
  }

  if (p.repMode !== 'doble' && info.inBlock === 4 && !info.finished && tracked.length) {
    const c = { arriba: 0, linea: 0, abajo: 0 };
    tracked.forEach((s) => c[s.status] !== undefined && c[s.status]++);
    recs.push({ key: 'bloque', level: 'info', title: `Cierre del bloque ${info.block}: ${info.blockName}`, text: `${c.arriba} por delante, ${c.linea} en línea y ${c.abajo} por debajo del plan. Esta semana descarga; la próxima empieza el bloque ${info.block + 1} con nuevos rangos de repeticiones. Buen momento para revisar el bloque con IA.`, action: 'aiReview', cta: 'Revisar con IA' });
  }

  return recs.filter((r) => !p.dismissed.includes(`${r.key}@${info.week}`));
}

// Aplica una recomendación al plan (muta el objeto plan).
export function applyRec(plan, sessions, rec, now) {
  const p = plan.program;
  const w = weekOf(plan, now);
  if (rec.action === 'recal') {
    for (const name of rec.payload) {
      const ex = uniqueExercises(plan).find((e) => e.name === name);
      const st = exerciseStatus(plan, sessions).find((s) => s.ex.name === name);
      if (!ex || !st?.last) continue;
      const pm = plannedMetric(plan, sessions, ex, st.last.week);
      if (pm) p.adjust[name] = (p.adjust[name] || 1) * (st.last.y / pm);
    }
  } else if (rec.action === 'deloadNow') {
    const info = weekInfo(plan, w);
    const blockDeload = info.block * 4;
    p.deloads = [...new Set([...p.deloads.filter((d) => d !== blockDeload || d === p.weeks), w])].sort((a, b) => a - b);
  }
  p.dismissed.push(`${rec.key}@${weekInfo(plan, w).week}`);
}

export function dismissRec(plan, rec, now) {
  plan.program.dismissed.push(`${rec.key}@${weekInfo(plan, weekOf(plan, now)).week}`);
}

export const blocksFor = (goal) => BLOCKS[goal] || BLOCKS.hipertrofia;

// Aplica al plan los cambios de una revisión (muta plan). Devuelve qué se aplicó y qué no.
export function applyReviewChanges(plan, changes) {
  const norm = (s) => String(s || '').trim().toLowerCase();
  const results = [];
  for (const c of changes) {
    const day = plan.days.find((d) => norm(d.name) === norm(c.day));
    // Si el día no coincide, busca el ejercicio en todos los días (excepto al añadir).
    const targets = (day ? [day] : plan.days).flatMap((d) => d.exercises.map((e, i) => ({ d, e, i }))).filter((x) => norm(x.e.name) === norm(c.exercise));
    let ok = false;
    if (c.action === 'swap' && c.replacement && targets.length) {
      const lib = exerciseByName(c.replacement);
      for (const { e } of targets) {
        delete plan.program.adjust[e.name];
        Object.assign(e, { name: lib?.name || c.replacement, muscle: lib?.muscle || c.muscle, kind: lib?.kind || c.kind, sec: lib?.sec || [], notes: c.reason });
      }
      ok = true;
    } else if (c.action === 'sets' && c.sets > 0 && targets.length) {
      targets.forEach(({ e }) => (e.sets = Math.min(c.sets, 6)));
      ok = true;
    } else if (c.action === 'remove' && targets.length) {
      for (const { d, e } of targets) if (d.exercises.length > 1) { d.exercises.splice(d.exercises.indexOf(e), 1); ok = true; }
    } else if (c.action === 'add' && day && c.exercise && !day.exercises.some((e) => norm(e.name) === norm(c.exercise))) {
      const lib = exerciseByName(c.exercise);
      const kind = lib?.kind || c.kind;
      day.exercises.push({
        name: lib?.name || c.exercise, muscle: lib?.muscle || c.muscle, sec: lib?.sec || [], kind,
        sets: Math.min(Math.max(c.sets || 3, 1), 6),
        repMin: kind === 'c' ? 6 : 10, repMax: kind === 'c' ? 10 : 15, rir: kind === 'c' ? 2 : 1, restSec: kind === 'c' ? 150 : 75,
        notes: c.reason,
      });
      ok = true;
    }
    results.push({ ...c, ok });
  }
  return results;
}

// Resumen completo del plan para la revisión con IA.
export function planReport(plan, sessions, now) {
  const w = weekOf(plan, now);
  const info = weekInfo(plan, w);
  const p = plan.program;
  const startMs = isoToMs(p.startDate);
  const inPlan = sessions.filter((s) => s.planId === plan.id && isoToMs(s.date) >= startMs);
  const closedWeeks = Math.max(0, Math.min(info.week - 1, p.weeks));
  const doneClosed = inPlan.filter((s) => weekOf(plan, s.date) <= closedWeeks).length;
  const status = exerciseStatus(plan, sessions);
  const exercises = status.map((st) => {
    const t = exerciseTrack(plan, sessions, st.ex);
    const days = plan.days.filter((d) => d.exercises.some((e) => e.name === st.ex.name)).map((d) => d.name);
    const lastSession = [...inPlan].reverse().find((s) => s.exercises.some((e) => e.name === st.ex.name));
    const lastSets = lastSession?.exercises.find((e) => e.name === st.ex.name).sets.map((x) => `${x.kg}kg×${x.reps}@RIR${x.rir}`).join(', ') || '';
    return {
      name: st.ex.name, muscle: st.ex.muscle, kind: st.ex.kind || exerciseByName(st.ex.name)?.kind || 'c', sets: st.ex.sets, days,
      sessions: st.n, status: st.status, vsPlanPct: st.ratio == null ? null : +((st.ratio - 1) * 100).toFixed(1),
      unit: t.unit,
      realByWeek: t.real.map((r) => `S${r.week}: ${r.y.toFixed(1)}`).join(' | '),
      plannedNow: t.planned.find((x) => x.week === info.week)?.y?.toFixed(1) ?? null,
      lastSets,
    };
  });
  const notes = inPlan.filter((s) => s.notes).slice(-12).map((s) => `S${weekOf(plan, s.date)} ${s.dayName}: ${s.notes}`);
  return {
    week: info.week, block: info.block, blockName: info.blockName, inBlock: info.inBlock, finished: info.finished,
    blocks: blocksFor(p.goal).map((b, i) => `${i + 1}. ${b.name} (compuestos ${b.c.join('–')} reps, aislamiento ${b.i.join('–')})`),
    deloads: p.deloads, repMode: p.repMode,
    adherence: closedWeeks ? { done: doneClosed, expected: closedWeeks * plan.days.length } : null,
    sessionsTotal: inPlan.length,
    days: plan.days.map((d) => ({ name: d.name, exercises: d.exercises.map((e) => `${e.name} (${e.sets} series)`) })),
    exercises, notes,
  };
}
