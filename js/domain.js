// Lógica de la app que comparten varias pantallas (plan activo, peso, recomendaciones).

import { db, today } from './db.js';
import { weightRateTarget } from './science.js';
import { newProgram, weekOf, review, fmtW } from './program.js';
import { n1 } from './ui.js';
import { COACH_ENABLED } from './config.js';

export const MODE_LABEL = { doble: 'Progresión doble', fases: 'Plan por fases de 12 semanas', fijo: 'Tus reps, con fases y descargas' };
export const SOURCE = { ciencia: 'Creada con ciencia', ia: 'Creada con el coach', propia: 'Tu rutina' };

// Convierte una rutina en un plan de 12 semanas que empieza hoy.
export function withProgram(plan, repMode) {
  plan.program = newProgram(db().profile, today(), repMode || (plan.source === 'propia' ? 'doble' : 'fases'));
  return plan;
}

export const rxLabel = (rx, unit = 'kg') => (rx.kg ? `${rx.sets}×${rx.targetReps} · ${fmtW(rx.kg, unit)}` : `${rx.sets}×${rx.repMin}–${rx.repMax}`);

export const currentWeek = (plan) => weekOf(plan, today());

export function weekStart(d = new Date()) {
  const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x;
}

export function weightStats() {
  const w = [...db().weights].sort((a, b) => a.date.localeCompare(b.date));
  if (!w.length) return null;
  const avgAt = (dateIso) => {
    const t = +new Date(dateIso);
    const win = w.filter((e) => { const d = +new Date(e.date); return d <= t && d > t - 7 * 864e5; });
    return win.length ? win.reduce((a, e) => a + e.kg, 0) / win.length : null;
  };
  const series = w.map((e) => ({ x: e.date, y: avgAt(e.date) }));
  const last = w[w.length - 1];
  const nowAvg = avgAt(last.date);
  const prevDate = new Date(+new Date(last.date) - 7 * 864e5).toISOString().slice(0, 10);
  const prevAvg = w.some((e) => e.date <= prevDate) ? avgAt(prevDate) : null;
  const rate = prevAvg ? ((nowAvg - prevAvg) / prevAvg) * 100 : null;
  return { w, series, last, nowAvg, rate };
}

export function weightText() {
  const ws = weightStats();
  if (!ws) return 'sin registros';
  const [lo, hi] = weightRateTarget(db().profile.goal);
  return `media 7 días ${n1(ws.nowAvg)} kg; ritmo ${ws.rate == null ? 'sin datos suficientes' : `${ws.rate.toFixed(2)} %/semana`} (objetivo ${lo} a ${hi} %/semana); ${ws.w.length} pesajes desde ${ws.w[0].date}`;
}

export function planRecs(plan) {
  if (!plan?.program) return [];
  const ws = weightStats();
  const recs = review(plan, db().sessions, { now: today(), profile: db().profile, weightRate: ws?.rate ?? null });
  if (COACH_ENABLED) return recs;
  // Sin coach: el cierre de bloque es informativo y al terminar se propone una rutina nueva.
  return recs.map((r) => (r.action !== 'aiReview' ? r : r.key === 'fin'
    ? { ...r, text: 'Terminaste tu plan. Crea el siguiente: tus marcas actuales serán el punto de partida.', action: 'nextPlan', cta: 'Crear el siguiente' }
    : { ...r, text: r.text.replace(' Buen momento para revisar el bloque con IA.', ''), action: null, cta: null }));
}
