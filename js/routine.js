// Revisión científica de una rutina armada por el usuario: detecta problemas concretos y propone
// arreglos que se aplican con un toque. Todo es determinista (sin IA) y funciona sin internet.

import { MUSCLES, EXERCISES, TIME_RANGES, timeRangeOf, estimateMinutes, weeklyVolume, volumeTarget, exerciseByName, exerciseDefaults } from './science.js';

const BIG = ['pecho', 'espalda', 'hombros', 'cuadriceps', 'isquios', 'gluteos'];
const LOWER = new Set(['cuadriceps', 'isquios', 'gluteos', 'gemelos']);
const GYM = ['barra', 'mancuernas', 'maquina', 'polea', 'barra_fija'];
const kindOf = (e) => e.kind || exerciseByName(e.name)?.kind || 'c';
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));

// Ejercicio sugerido para cubrir un músculo que falta (prefiere compuestos para músculos grandes).
function suggestExercise(muscle, plan) {
  const used = new Set(plan.days.flatMap((d) => d.exercises.map((e) => e.name)));
  const opts = EXERCISES.filter((e) => e.muscle === muscle && (GYM.includes(e.equip) || (muscle === 'abdomen' && e.equip === 'peso_corporal')) && !used.has(e.name));
  const big = BIG.includes(muscle);
  // Si ya hay un ejercicio de ese músculo, prefiere otro patrón (p. ej. curl femoral después de un peso muerto).
  const have = new Set(plan.days.flatMap((d) => d.exercises).filter((e) => e.muscle === muscle).map((e) => exerciseByName(e.name)?.pattern));
  const wantCompound = big && !have.size; // el primero, compuesto; el segundo, aislamiento
  const rank = (e) => (have.has(e.pattern) ? 10 : 0) + ((e.kind === 'c') === wantCompound ? 0 : 1);
  return opts.sort((a, b) => rank(a) - rank(b))[0] || null;
}

// Día donde encaja mejor un ejercicio nuevo: el que ya trabaja músculos parecidos y tiene más tiempo libre.
function bestDay(plan, muscle) {
  const lower = LOWER.has(muscle);
  const abs = muscle === 'abdomen';
  const scored = plan.days.map((d, i) => {
    const same = abs || d.exercises.some((e) => LOWER.has(e.muscle) === lower);
    return { i, score: (same ? 1000 : 0) - estimateMinutes(d) };
  });
  return scored.sort((a, b) => b.score - a.score)[0]?.i ?? 0;
}

export function reviewRoutine(plan, profile) {
  const items = [];
  if (!plan?.days?.length) return [{ id: 'vacia', level: 'warn', title: 'Tu rutina no tiene días', text: 'Agrega al menos un día con ejercicios.' }];
  const total = plan.days.reduce((n, d) => n + d.exercises.length, 0);
  if (total < 3) return [{ id: 'empieza', level: 'info', title: 'Agrega tus ejercicios', text: 'Cuando tengas tus días armados te digo si la rutina está balanceada: series por músculo, duración y orden.' }];
  const empty = plan.days.filter((d) => !d.exercises.length);
  if (empty.length) items.push({ id: 'dia-vacio', level: 'warn', title: `${empty.map((d) => d.name).join(', ')} sin ejercicios`, text: 'Agrega ejercicios o borra ese día.' });

  const vol = weeklyVolume(plan);
  const level = profile?.level || 'intermedio';
  for (const m of Object.keys(MUSCLES)) {
    const [lo, hi] = volumeTarget(level, m);
    const small = !BIG.includes(m) && !['biceps', 'triceps'].includes(m);
    const exs = plan.days.flatMap((d) => d.exercises).filter((e) => e.muscle === m);
    if (vol[m] < lo) {
      if (!exs.length) {
        const ex = suggestExercise(m, plan);
        const di = bestDay(plan, m);
        items.push({
          id: `falta-${m}`, level: small ? 'info' : 'warn',
          title: vol[m] ? `Pocas series de ${MUSCLES[m].toLowerCase()}` : `No trabajas ${MUSCLES[m].toLowerCase()} directamente`,
          text: `Tienes ${fmt(vol[m])} series a la semana${vol[m] ? ', solo de forma indirecta' : ''} (recomendado ${lo}–${hi} para tu nivel)${ex ? `. Te propongo ${ex.name} en ${plan.days[di].name}.` : '.'}`,
          fix: ex ? { type: 'addExercise', name: ex.name, day: di, label: `Agregar ${ex.name}` } : null,
        });
      } else if (exs.length) {
        const need = Math.ceil(lo - vol[m]);
        const cap = level === 'principiante' ? 4 : 5;
        const room = exs.reduce((a, e) => a + Math.max(0, cap - (Number(e.sets) || 0)), 0);
        // En gemelos y abdomen basta con sumar series; en los demás, si no caben, se agrega otro ejercicio.
        const ex = room < need && !small ? suggestExercise(m, plan) : null;
        if (ex) {
          const di = bestDay(plan, m);
          items.push({ id: `poco-${m}`, level: small ? 'info' : 'warn', title: `Pocas series de ${MUSCLES[m].toLowerCase()}`, text: `${fmt(vol[m])} series a la semana; lo recomendado para tu nivel es ${lo}–${hi}. Tus ejercicios actuales ya tienen muchas series: mejor agrega ${ex.name} en ${plan.days[di].name}.`, fix: { type: 'addExercise', name: ex.name, day: di, label: `Agregar ${ex.name}` } });
          continue;
        }
        items.push({
          id: `poco-${m}`, level: small ? 'info' : 'warn',
          title: `Pocas series de ${MUSCLES[m].toLowerCase()}`,
          text: `${fmt(vol[m])} series a la semana; lo recomendado para tu nivel es ${lo}–${hi}. Sumar ${need} serie${need > 1 ? 's' : ''} lo deja en rango.`,
          fix: room > 0 ? { type: 'addSets', muscle: m, n: Math.min(need, room), label: `Sumar ${Math.min(need, room)} serie${Math.min(need, room) > 1 ? 's' : ''}` } : null,
        });
      }
    } else if (vol[m] > hi + 2 && exs.length) {
      const extra = Math.floor(vol[m] - hi);
      items.push({
        id: `mucho-${m}`, level: 'info',
        title: `Muchas series de ${MUSCLES[m].toLowerCase()}`,
        text: `${fmt(vol[m])} series a la semana, por encima de ${hi}. Más volumen no siempre da más resultado y suma fatiga.`,
        fix: { type: 'removeSets', muscle: m, n: extra, label: `Quitar ${extra} serie${extra > 1 ? 's' : ''}` },
      });
    }
    // Frecuencia: los músculos grandes rinden mejor entrenados 2 veces por semana.
    if (BIG.includes(m) && plan.days.length >= 3 && vol[m] >= lo) {
      const daysWith = plan.days.filter((d) => d.exercises.some((e) => e.muscle === m)).length;
      if (daysWith === 1) items.push({ id: `frec-${m}`, level: 'info', title: `${MUSCLES[m]} solo un día por semana`, text: 'Repartir las mismas series en 2 días suele dar mejores resultados que hacerlas todas el mismo día.' });
    }
  }

  const maxMin = TIME_RANGES[timeRangeOf(profile)][1];
  plan.days.forEach((d, i) => {
    if (!d.exercises.length) return;
    const min = estimateMinutes(d);
    if (min > maxMin + 2) items.push({ id: `largo-${i}`, level: 'warn', title: `${d.name} dura ≈ ${min} min`, text: `Tu tiempo por sesión es de hasta ${maxMin} min. Puedo recortar series de los aislamientos de ese día.`, fix: { type: 'trimDay', day: i, max: maxMin, label: 'Recortar a tiempo' } });
    // Orden: los compuestos primero, cuando estás fresco.
    const firstIso = d.exercises.findIndex((e) => kindOf(e) === 'i');
    const lastComp = d.exercises.map(kindOf).lastIndexOf('c');
    if (firstIso !== -1 && lastComp > firstIso) items.push({ id: `orden-${i}`, level: 'info', title: `Orden en ${d.name}`, text: 'Tienes aislamientos antes que ejercicios compuestos. Hacer primero los compuestos te deja levantar más donde más importa.', fix: { type: 'reorder', day: i, label: 'Ordenar' } });
    const names = d.exercises.map((e) => e.name);
    const dup = names.find((n, k) => names.indexOf(n) !== k);
    if (dup) items.push({ id: `dup-${i}`, level: 'warn', title: `${dup} está dos veces en ${d.name}`, text: 'Probablemente es un error. Puedo dejar solo uno.', fix: { type: 'dedupe', day: i, label: 'Dejar uno' } });
    d.exercises.forEach((e, k) => {
      if (Number(e.repMin) > Number(e.repMax)) items.push({ id: `reps-${i}-${k}`, level: 'warn', title: `Rango invertido en ${e.name}`, text: `Mínimo ${e.repMin} y máximo ${e.repMax}.`, fix: { type: 'swapReps', day: i, name: e.name, label: 'Corregir' } });
      else if (Number(e.repMax) > 30) items.push({ id: `reps-${i}-${k}`, level: 'info', title: `${e.name}: hasta ${e.repMax} reps`, text: 'Por encima de ~30 reps el estímulo se parece más a resistencia que a fuerza o músculo.' });
    });
  });

  if (!items.some((x) => x.level === 'warn')) items.unshift({ id: 'ok', level: 'good', title: 'Tu rutina está bien balanceada', text: 'El volumen por músculo, la duración y el orden están dentro de lo recomendado.' });
  const rank = { good: 0, warn: 1, info: 2 };
  return items.sort((a, b) => rank[a.level] - rank[b.level]);
}

// Aplica el arreglo de una sugerencia (muta el plan).
export function applyFix(plan, fix, profile) {
  const cap = profile?.level === 'principiante' ? 4 : 5;
  if (fix.type === 'addExercise') {
    const lib = exerciseByName(fix.name);
    const d = plan.days[fix.day];
    if (!lib || !d) return false;
    const def = exerciseDefaults(profile, lib.kind);
    const item = { name: lib.name, muscle: lib.muscle, sec: lib.sec, kind: lib.kind, ...def, notes: '' };
    // Compuestos antes de los aislamientos del día.
    const at = lib.kind === 'c' ? d.exercises.findIndex((e) => kindOf(e) === 'i') : -1;
    if (at === -1) d.exercises.push(item); else d.exercises.splice(at, 0, item);
    return true;
  }
  if (fix.type === 'addSets' || fix.type === 'removeSets') {
    const exs = plan.days.flatMap((d) => d.exercises).filter((e) => e.muscle === fix.muscle);
    let left = fix.n;
    for (let guard = 0; left > 0 && guard < 50; guard++) {
      const sorted = fix.type === 'addSets'
        ? exs.filter((e) => e.sets < cap).sort((a, b) => a.sets - b.sets)
        : exs.filter((e) => e.sets > 2).sort((a, b) => (kindOf(a) === kindOf(b) ? b.sets - a.sets : kindOf(a) === 'i' ? -1 : 1));
      if (!sorted.length) break;
      sorted[0].sets += fix.type === 'addSets' ? 1 : -1;
      left--;
    }
    return left < fix.n;
  }
  if (fix.type === 'trimDay') {
    const d = plan.days[fix.day];
    for (let guard = 0; estimateMinutes(d) > fix.max && guard < 40; guard++) {
      const c = d.exercises.filter((e) => e.sets > 2).sort((a, b) => (kindOf(a) === kindOf(b) ? b.sets - a.sets : kindOf(a) === 'i' ? -1 : 1))[0];
      if (!c) break;
      c.sets -= 1;
    }
    return true;
  }
  if (fix.type === 'reorder') {
    const d = plan.days[fix.day];
    d.exercises = [...d.exercises.filter((e) => kindOf(e) === 'c'), ...d.exercises.filter((e) => kindOf(e) !== 'c')];
    return true;
  }
  if (fix.type === 'dedupe') {
    const d = plan.days[fix.day];
    d.exercises = d.exercises.filter((e, k, a) => a.findIndex((x) => x.name === e.name) === k);
    return true;
  }
  if (fix.type === 'swapReps') {
    const e = plan.days[fix.day]?.exercises.find((x) => x.name === fix.name && Number(x.repMin) > Number(x.repMax));
    if (!e) return false;
    [e.repMin, e.repMax] = [e.repMax, e.repMin];
    return true;
  }
  return false;
}
