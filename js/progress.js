// Progreso: cálculos sobre el historial para la pestaña Progreso (general, por músculo y por ejercicio).
// Funciones puras: reciben los entrenos y devuelven números; no tocan la pantalla ni el almacenamiento.

import { e1rm, exerciseByName } from './science.js';

const DAY = 864e5;
const noon = (iso) => +new Date(`${iso}T12:00:00`);
// Lunes (00:00, hora local) de la semana de una fecha.
export const mondayOf = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
const byDate = (sessions) => [...sessions].sort((a, b) => String(a.date).localeCompare(String(b.date)));

// Historia de cada ejercicio: un punto por día con su mejor marca.
//  - Con peso: fuerza estimada (el peso que podrías levantar 1 vez, calculado con kg y reps).
//  - Sin peso (peso corporal): la mejor serie en repeticiones.
// Los registros marcados "no contar" no entran.
export function exerciseSeries(sessions) {
  const out = new Map();
  for (const s of byDate(sessions)) {
    for (const e of s.exercises) {
      if (e.skip || !e.name) continue;
      let it = out.get(e.name);
      if (!it) { it = { name: e.name, muscle: e.muscle || exerciseByName(e.name)?.muscle || '', raw: [] }; out.set(e.name, it); }
      it.raw.push({ date: s.date, sets: e.sets });
    }
  }
  for (const it of out.values()) {
    it.weighted = it.raw.some((r) => r.sets.some((z) => Number(z.kg) > 0 && Number(z.reps) > 0));
    it.unit = it.weighted ? 'kg' : 'reps';
    it.points = [];
    it.best = null;
    for (const r of it.raw) {
      let top = 0;
      for (const z of r.sets) {
        const reps = Number(z.reps) || 0, kg = Number(z.kg) || 0;
        const v = it.weighted ? e1rm(kg, reps) : reps;
        if (v > top) top = v;
        if (v > 0 && (!it.best || v > it.best.v)) it.best = { v, kg: z.kg, reps: z.reps, date: r.date };
      }
      if (top <= 0) continue;
      const prev = it.points[it.points.length - 1];
      if (prev && prev.x === r.date) prev.y = Math.max(prev.y, top); else it.points.push({ x: r.date, y: top });
    }
    delete it.raw;
    // Cambio desde el primer registro: se compara con la mejor de las 2 últimas marcas
    // (un mal día aislado no cuenta como retroceso).
    const p = it.points;
    it.n = p.length;
    const cur = p.length >= 3 ? Math.max(p[p.length - 1].y, p[p.length - 2].y) : p.length === 2 ? p[1].y : null; // con solo 2 marcas, la última manda
    it.pct = cur == null ? null : (cur / p[0].y - 1) * 100;
  }
  return out;
}

// En los promedios (general y por músculo) ningún ejercicio aporta más de +75 % ni menos de −50 %:
// un cambio así casi siempre es un dato raro (otra máquina, peso mal anotado) y uno solo no debe
// mover el número de todos. Cada ejercicio sigue mostrando su cambio real.
const capped = (ratioMinus1) => Math.max(-0.5, Math.min(0.75, ratioMinus1));

// Fuerza general: promedio del cambio de todos tus ejercicios (cada uno contra su primer registro).
// Devuelve la línea en el tiempo y el valor de hoy, en %.
export function strengthIndex(series) {
  const exs = [...series.values()].filter((it) => it.points.length >= 2);
  if (!exs.length) return { points: [], now: null, n: 0, since: null };
  const dates = [...new Set(exs.flatMap((it) => it.points.map((p) => p.x)))].sort();
  const points = [];
  for (const d of dates) {
    let sum = 0, n = 0;
    for (const it of exs) {
      const upTo = it.points.filter((p) => p.x <= d);
      if (!upTo.length) continue;
      const cur = upTo.length >= 3 ? Math.max(upTo[upTo.length - 1].y, upTo[upTo.length - 2].y) : upTo[upTo.length - 1].y;
      sum += capped(cur / it.points[0].y - 1); n++;
    }
    if (n) points.push({ x: d, y: Math.round((sum / n) * 1000) / 10 });
  }
  const now = exs.reduce((a, it) => a + capped(it.pct / 100) * 100, 0) / exs.length;
  return { points, now, n: exs.length, since: dates[0] };
}

// Por músculo: el promedio de sus ejercicios (los que tienen al menos 2 registros), y la lista de todos.
export function byMuscle(series) {
  const groups = new Map();
  for (const it of series.values()) {
    const m = it.muscle || 'otros';
    if (!groups.has(m)) groups.set(m, { muscle: m, exercises: [] });
    groups.get(m).exercises.push(it);
  }
  for (const g of groups.values()) {
    const ok = g.exercises.filter((it) => it.pct != null);
    g.pct = ok.length ? ok.reduce((a, it) => a + capped(it.pct / 100) * 100, 0) / ok.length : null;
    g.n = ok.length;
    g.exercises.sort((a, b) => (b.pct ?? -Infinity) - (a.pct ?? -Infinity) || a.name.localeCompare(b.name));
  }
  return [...groups.values()].sort((a, b) => (b.pct ?? -Infinity) - (a.pct ?? -Infinity));
}

// Últimas N semanas (la actual al final): entrenos, series y kilos movidos de cada una.
export function weekly(sessions, weeks = 8, now = Date.now()) {
  const thisMonday = mondayOf(now);
  const out = Array.from({ length: weeks }, (_, k) => ({ start: thisMonday - (weeks - 1 - k) * 7 * DAY, sessions: 0, sets: 0, kg: 0 }));
  for (const s of sessions) {
    // Por número de semana (no por milisegundos): el cambio de horario no corre un entreno de semana.
    const k = weeks - 1 - Math.round((thisMonday - mondayOf(noon(s.date))) / (7 * DAY));
    if (k < 0 || k >= weeks) continue;
    out[k].sessions++;
    for (const e of s.exercises) for (const z of e.sets) { out[k].sets++; out[k].kg += (Number(z.kg) || 0) * (Number(z.reps) || 0); }
  }
  return out;
}

// Semanas seguidas con al menos un entreno (la actual cuenta si ya entrenaste; si no, no rompe la racha).
export function weekStreak(sessions, now = Date.now()) {
  const set = new Set(sessions.map((s) => mondayOf(noon(s.date))));
  let w = mondayOf(now), n = 0;
  if (!set.has(w)) w = mondayOf(w - DAY);
  while (set.has(w)) { n++; w = mondayOf(w - DAY); }
  return n;
}

// Récords personales de cada entreno, recalculados en orden (tras corregir o borrar algo del historial).
// Un récord = superar la mejor marca anterior de ese ejercicio. Devuelve cuántos entrenos cambiaron.
export function recomputePrs(sessions) {
  const best = new Map();
  let changed = 0;
  for (const s of byDate(sessions)) {
    const prs = [];
    for (const e of s.exercises) {
      if (e.skip) continue;
      const top = Math.max(0, ...e.sets.map((z) => e1rm(Number(z.kg), Number(z.reps))));
      const prev = best.get(e.name) || 0;
      if (top > 0 && prev > 0 && top > prev) prs.push(e.name);
      if (top > prev) best.set(e.name, top);
    }
    if ((s.prs || []).join('|') !== prs.join('|')) changed++;
    s.prs = prs;
  }
  return changed;
}
