// Motor de entrenamiento basado en evidencia: biblioteca de ejercicios, generador de rutinas,
// control de volumen semanal y progresión. Funciona sin internet.

import { uid } from './util.js';

export const MUSCLES = {
  pecho: 'Pecho', espalda: 'Espalda', hombros: 'Hombros', biceps: 'Bíceps', triceps: 'Tríceps',
  cuadriceps: 'Cuádriceps', isquios: 'Isquiotibiales', gluteos: 'Glúteos', gemelos: 'Gemelos', abdomen: 'Abdomen',
};

export const GOALS = {
  hipertrofia: 'Ganar músculo',
  fuerza: 'Ganar fuerza',
  grasa: 'Perder grasa',
  recomposicion: 'Recomposición',
  salud: 'Salud y forma general',
};

export const LEVELS = { principiante: 'Principiante (< 1 año)', intermedio: 'Intermedio (1–3 años)', avanzado: 'Avanzado (3+ años)' };

export const EQUIPMENT = {
  gym: 'Gimnasio completo',
  mancuernas: 'Mancuernas y banco',
  casa: 'Peso corporal (casa)',
};

const EQUIP_ALLOWED = {
  gym: ['barra', 'mancuernas', 'maquina', 'polea', 'peso_corporal'],
  mancuernas: ['mancuernas', 'peso_corporal'],
  casa: ['peso_corporal'],
};

// kind: c = compuesto, i = aislamiento. sec = músculos secundarios (cuentan 0,5 series).
// Orden dentro de cada patrón = preferencia (los primeros se eligen antes si hay equipo).
const L = (id, name, pattern, muscle, sec, equip, kind) => ({ id, name, pattern, muscle, sec, equip, kind });
export const EXERCISES = [
  // Empuje horizontal
  L('banca', 'Press de banca con barra', 'empuje_h', 'pecho', ['triceps', 'hombros'], 'barra', 'c'),
  L('inclinado_mc', 'Press inclinado con mancuernas', 'empuje_h', 'pecho', ['triceps', 'hombros'], 'mancuernas', 'c'),
  L('press_pecho_maq', 'Press de pecho en máquina', 'empuje_h', 'pecho', ['triceps'], 'maquina', 'c'),
  L('banca_mc', 'Press de banca con mancuernas', 'empuje_h', 'pecho', ['triceps', 'hombros'], 'mancuernas', 'c'),
  L('fondos', 'Fondos en paralelas', 'empuje_h', 'pecho', ['triceps'], 'peso_corporal', 'c'),
  L('flexiones', 'Flexiones', 'empuje_h', 'pecho', ['triceps', 'hombros'], 'peso_corporal', 'c'),
  // Empuje vertical
  L('militar', 'Press militar con barra', 'empuje_v', 'hombros', ['triceps'], 'barra', 'c'),
  L('hombro_mc', 'Press de hombro con mancuernas', 'empuje_v', 'hombros', ['triceps'], 'mancuernas', 'c'),
  L('hombro_maq', 'Press de hombro en máquina', 'empuje_v', 'hombros', ['triceps'], 'maquina', 'c'),
  L('pica', 'Flexiones pica', 'empuje_v', 'hombros', ['triceps'], 'peso_corporal', 'c'),
  // Tracción vertical
  L('jalon', 'Jalón al pecho', 'traccion_v', 'espalda', ['biceps'], 'polea', 'c'),
  L('dominadas', 'Dominadas', 'traccion_v', 'espalda', ['biceps'], 'peso_corporal', 'c'),
  L('jalon_neutro', 'Jalón agarre neutro', 'traccion_v', 'espalda', ['biceps'], 'polea', 'c'),
  L('pullover_mc', 'Pullover con mancuerna', 'traccion_v', 'espalda', ['pecho'], 'mancuernas', 'c'),
  L('dominadas_sup', 'Dominadas supinas', 'traccion_v', 'espalda', ['biceps'], 'peso_corporal', 'c'),
  // Tracción horizontal
  L('remo_polea', 'Remo en polea sentado', 'traccion_h', 'espalda', ['biceps', 'hombros'], 'polea', 'c'),
  L('remo_barra', 'Remo con barra', 'traccion_h', 'espalda', ['biceps', 'hombros'], 'barra', 'c'),
  L('remo_mc', 'Remo con mancuerna a una mano', 'traccion_h', 'espalda', ['biceps'], 'mancuernas', 'c'),
  L('remo_maq', 'Remo con pecho apoyado (máquina)', 'traccion_h', 'espalda', ['biceps', 'hombros'], 'maquina', 'c'),
  L('remo_invertido', 'Remo invertido', 'traccion_h', 'espalda', ['biceps'], 'peso_corporal', 'c'),
  // Sentadilla / dominante de rodilla
  L('sentadilla', 'Sentadilla con barra', 'sentadilla', 'cuadriceps', ['gluteos'], 'barra', 'c'),
  L('prensa', 'Prensa de piernas', 'sentadilla', 'cuadriceps', ['gluteos'], 'maquina', 'c'),
  L('hack', 'Sentadilla hack', 'sentadilla', 'cuadriceps', ['gluteos'], 'maquina', 'c'),
  L('bulgara_mc', 'Sentadilla búlgara con mancuernas', 'sentadilla', 'cuadriceps', ['gluteos'], 'mancuernas', 'c'),
  L('goblet', 'Sentadilla goblet', 'sentadilla', 'cuadriceps', ['gluteos'], 'mancuernas', 'c'),
  L('bulgara_pc', 'Sentadilla búlgara (peso corporal)', 'sentadilla', 'cuadriceps', ['gluteos'], 'peso_corporal', 'c'),
  L('sentadilla_pc', 'Sentadilla con pausa (peso corporal)', 'sentadilla', 'cuadriceps', ['gluteos'], 'peso_corporal', 'c'),
  // Bisagra de cadera
  L('rumano', 'Peso muerto rumano con barra', 'bisagra', 'isquios', ['gluteos', 'espalda'], 'barra', 'c'),
  L('hip_thrust', 'Hip thrust con barra', 'bisagra', 'gluteos', ['isquios'], 'barra', 'c'),
  L('rumano_mc', 'Peso muerto rumano con mancuernas', 'bisagra', 'isquios', ['gluteos'], 'mancuernas', 'c'),
  L('hip_thrust_mc', 'Hip thrust con mancuerna', 'bisagra', 'gluteos', ['isquios'], 'mancuernas', 'c'),
  L('hip_thrust_1p', 'Hip thrust a una pierna', 'bisagra', 'gluteos', ['isquios'], 'peso_corporal', 'c'),
  L('rumano_1p', 'Peso muerto a una pierna (peso corporal)', 'bisagra', 'isquios', ['gluteos'], 'peso_corporal', 'c'),
  // Cuádriceps accesorio
  L('extension_cuad', 'Extensión de cuádriceps', 'cuad_iso', 'cuadriceps', [], 'maquina', 'i'),
  L('zancadas_mc', 'Zancadas caminando con mancuernas', 'cuad_iso', 'cuadriceps', ['gluteos'], 'mancuernas', 'c'),
  L('step_up_mc', 'Subida al banco con mancuernas', 'cuad_iso', 'cuadriceps', ['gluteos'], 'mancuernas', 'c'),
  L('zancadas_pc', 'Zancadas inversas (peso corporal)', 'cuad_iso', 'cuadriceps', ['gluteos'], 'peso_corporal', 'c'),
  L('sissy', 'Sentadilla sissy', 'cuad_iso', 'cuadriceps', [], 'peso_corporal', 'i'),
  // Isquios accesorio
  L('curl_fem_sent', 'Curl femoral sentado', 'isq_iso', 'isquios', [], 'maquina', 'i'),
  L('curl_fem_tumb', 'Curl femoral tumbado', 'isq_iso', 'isquios', [], 'maquina', 'i'),
  L('rumano_1p_mc', 'Peso muerto rumano a una pierna con mancuerna', 'isq_iso', 'isquios', ['gluteos'], 'mancuernas', 'c'),
  L('nordico', 'Curl nórdico', 'isq_iso', 'isquios', [], 'peso_corporal', 'i'),
  L('puente_1p', 'Puente de isquios a una pierna', 'isq_iso', 'isquios', ['gluteos'], 'peso_corporal', 'i'),
  // Pecho aislamiento
  L('aperturas_polea', 'Aperturas en polea', 'pecho_iso', 'pecho', [], 'polea', 'i'),
  L('pec_deck', 'Pec deck', 'pecho_iso', 'pecho', [], 'maquina', 'i'),
  L('aperturas_mc', 'Aperturas con mancuernas', 'pecho_iso', 'pecho', [], 'mancuernas', 'i'),
  L('flexiones_deficit', 'Flexiones con déficit', 'pecho_iso', 'pecho', ['triceps'], 'peso_corporal', 'c'),
  // Hombro lateral
  L('lat_polea', 'Elevaciones laterales en polea', 'hombro_lat', 'hombros', [], 'polea', 'i'),
  L('lat_mc', 'Elevaciones laterales con mancuernas', 'hombro_lat', 'hombros', [], 'mancuernas', 'i'),
  L('lat_maq', 'Elevaciones laterales en máquina', 'hombro_lat', 'hombros', [], 'maquina', 'i'),
  L('lat_pc', 'Elevaciones laterales tumbado (peso corporal)', 'hombro_lat', 'hombros', [], 'peso_corporal', 'i'),
  // Hombro posterior
  L('face_pull', 'Face pull', 'hombro_post', 'hombros', ['espalda'], 'polea', 'i'),
  L('reverse_deck', 'Pec deck inverso', 'hombro_post', 'hombros', ['espalda'], 'maquina', 'i'),
  L('pajaros', 'Pájaros con mancuernas', 'hombro_post', 'hombros', ['espalda'], 'mancuernas', 'i'),
  L('ytw', 'Y-T-W en el suelo', 'hombro_post', 'hombros', ['espalda'], 'peso_corporal', 'i'),
  // Bíceps
  L('curl_barra', 'Curl con barra', 'biceps', 'biceps', [], 'barra', 'i'),
  L('curl_inclinado', 'Curl inclinado con mancuernas', 'biceps', 'biceps', [], 'mancuernas', 'i'),
  L('curl_polea', 'Curl en polea', 'biceps', 'biceps', [], 'polea', 'i'),
  L('curl_martillo', 'Curl martillo', 'biceps', 'biceps', [], 'mancuernas', 'i'),
  L('chin_neg', 'Dominadas supinas negativas', 'biceps', 'biceps', ['espalda'], 'peso_corporal', 'c'),
  // Tríceps
  L('ext_polea', 'Extensión de tríceps en polea', 'triceps', 'triceps', [], 'polea', 'i'),
  L('ext_overhead', 'Extensión de tríceps sobre la cabeza', 'triceps', 'triceps', [], 'polea', 'i'),
  L('frances', 'Press francés', 'triceps', 'triceps', [], 'barra', 'i'),
  L('ext_overhead_mc', 'Extensión sobre la cabeza con mancuerna', 'triceps', 'triceps', [], 'mancuernas', 'i'),
  L('flex_diamante', 'Flexiones diamante', 'triceps', 'triceps', ['pecho'], 'peso_corporal', 'c'),
  L('fondos_banco', 'Fondos en banco', 'triceps', 'triceps', [], 'peso_corporal', 'c'),
  // Gemelos
  L('talones_maq', 'Elevación de talones de pie (máquina)', 'gemelos', 'gemelos', [], 'maquina', 'i'),
  L('talones_prensa', 'Elevación de talones en prensa', 'gemelos', 'gemelos', [], 'maquina', 'i'),
  L('talones_mc', 'Elevación de talones con mancuerna', 'gemelos', 'gemelos', [], 'mancuernas', 'i'),
  L('talones_pc', 'Elevación de talones a una pierna', 'gemelos', 'gemelos', [], 'peso_corporal', 'i'),
  // Abdomen
  L('crunch_polea', 'Crunch en polea', 'abdomen', 'abdomen', [], 'polea', 'i'),
  L('piernas_colgado', 'Elevación de piernas colgado', 'abdomen', 'abdomen', [], 'peso_corporal', 'i'),
  L('rueda', 'Rueda abdominal', 'abdomen', 'abdomen', [], 'peso_corporal', 'i'),
  L('crunch', 'Crunch', 'abdomen', 'abdomen', [], 'peso_corporal', 'i'),
];

export const exerciseByName = (name) => EXERCISES.find((e) => e.name.toLowerCase() === String(name).toLowerCase());

// Plantillas de días: [patrón, variante]. La variante elige otra opción del mismo patrón.
const DAYS = {
  FB_A: { name: 'Full Body A', focus: 'Cuerpo completo', slots: [['sentadilla', 0], ['empuje_h', 0], ['traccion_h', 0], ['isq_iso', 0], ['hombro_lat', 0], ['biceps', 0], ['abdomen', 0], ['gemelos', 0]] },
  FB_B: { name: 'Full Body B', focus: 'Cuerpo completo', slots: [['bisagra', 0], ['traccion_v', 0], ['empuje_v', 0], ['cuad_iso', 0], ['pecho_iso', 0], ['triceps', 0], ['hombro_post', 0], ['abdomen', 1]] },
  FB_C: { name: 'Full Body C', focus: 'Cuerpo completo', slots: [['sentadilla', 1], ['empuje_h', 1], ['traccion_v', 1], ['bisagra', 1], ['hombro_lat', 1], ['triceps', 1], ['biceps', 1], ['gemelos', 1]] },
  UA: { name: 'Torso A', focus: 'Pecho, espalda, hombros, brazos', slots: [['empuje_h', 0], ['traccion_h', 0], ['empuje_v', 0], ['traccion_v', 0], ['hombro_lat', 0], ['biceps', 0], ['triceps', 0], ['hombro_post', 0]] },
  UB: { name: 'Torso B', focus: 'Pecho, espalda, hombros, brazos', slots: [['empuje_h', 1], ['traccion_v', 1], ['traccion_h', 1], ['pecho_iso', 0], ['hombro_lat', 1], ['triceps', 1], ['biceps', 1], ['hombro_post', 1]] },
  LA: { name: 'Pierna A', focus: 'Cuádriceps, isquios, glúteos', slots: [['sentadilla', 0], ['bisagra', 0], ['cuad_iso', 0], ['isq_iso', 0], ['gemelos', 0], ['abdomen', 0]] },
  LB: { name: 'Pierna B', focus: 'Glúteos, isquios, cuádriceps', slots: [['bisagra', 1], ['sentadilla', 1], ['isq_iso', 1], ['cuad_iso', 1], ['gemelos', 1], ['abdomen', 1]] },
  PUSH: { name: 'Empuje', focus: 'Pecho, hombros, tríceps', slots: [['empuje_h', 0], ['empuje_v', 0], ['empuje_h', 1], ['hombro_lat', 0], ['pecho_iso', 0], ['triceps', 0], ['triceps', 1]] },
  PULL: { name: 'Tracción', focus: 'Espalda, deltoide posterior, bíceps', slots: [['traccion_v', 0], ['traccion_h', 0], ['traccion_v', 1], ['hombro_post', 0], ['biceps', 0], ['biceps', 1], ['abdomen', 0]] },
  PUSH2: { name: 'Empuje B', focus: 'Pecho, hombros, tríceps', slots: [['empuje_h', 1], ['empuje_v', 1], ['pecho_iso', 1], ['hombro_lat', 1], ['empuje_h', 2], ['triceps', 1], ['triceps', 2]] },
  PULL2: { name: 'Tracción B', focus: 'Espalda, deltoide posterior, bíceps', slots: [['traccion_h', 1], ['traccion_v', 1], ['traccion_h', 2], ['hombro_post', 1], ['biceps', 1], ['biceps', 2], ['abdomen', 1]] },
};

const SPLITS = {
  2: { name: 'Full Body 2 días', days: ['FB_A', 'FB_B'] },
  3: { name: 'Full Body 3 días', days: ['FB_A', 'FB_B', 'FB_C'] },
  4: { name: 'Torso / Pierna 4 días', days: ['UA', 'LA', 'UB', 'LB'] },
  5: { name: 'Torso / Pierna + Empuje / Tracción 5 días', days: ['UA', 'LA', 'PUSH', 'PULL', 'LB'] },
  6: { name: 'Empuje / Tracción / Pierna 6 días', days: ['PUSH', 'PULL', 'LA', 'PUSH2', 'PULL2', 'LB'] },
};

// Esquema de series/reps/RIR/descanso por objetivo (compuesto vs aislamiento).
function scheme(goal, level, kind) {
  const base = {
    fuerza: kind === 'c' ? [4, 6, 2, 180] : [8, 12, 1, 90],
    hipertrofia: kind === 'c' ? [6, 10, 2, 150] : [10, 15, 1, 75],
    grasa: kind === 'c' ? [6, 10, 2, 150] : [10, 15, 1, 75],
    recomposicion: kind === 'c' ? [6, 10, 2, 150] : [10, 15, 1, 75],
    salud: kind === 'c' ? [8, 12, 3, 120] : [12, 15, 2, 60],
  }[goal] || [8, 12, 2, 120];
  let [repMin, repMax, rir, restSec] = base;
  if (level === 'principiante') rir = Math.min(rir + 1, 3); // técnica primero, más margen
  const sets = { principiante: kind === 'c' ? 3 : 2, intermedio: 3, avanzado: kind === 'c' ? 4 : 3 }[level] || 3;
  return { sets, repMin, repMax, rir, restSec };
}

const MAX_EX_BY_MINUTES = (min) => (min <= 45 ? 5 : min <= 60 ? 6 : min <= 75 ? 7 : 8);

function pick(pattern, variant, equipment, used) {
  const allowed = EQUIP_ALLOWED[equipment] || EQUIP_ALLOWED.gym;
  const opts = EXERCISES.filter((e) => e.pattern === pattern && allowed.includes(e.equip));
  if (!opts.length) return null;
  const fresh = opts.filter((e) => !used.has(e.id));
  const pool = fresh.length ? fresh : opts;
  return pool[variant % pool.length];
}

export function generatePlan(profile) {
  const days = Math.max(2, Math.min(6, Number(profile.days) || 3));
  const split = SPLITS[days];
  const maxEx = MAX_EX_BY_MINUTES(Number(profile.minutes) || 60);
  const planDays = split.days.map((key) => {
    const tpl = DAYS[key];
    const used = new Set();
    const exercises = [];
    for (const [pattern, variant] of tpl.slots) {
      if (exercises.length >= maxEx) break;
      const ex = pick(pattern, variant, profile.equipment, used);
      if (!ex) continue;
      used.add(ex.id);
      exercises.push({ name: ex.name, muscle: ex.muscle, sec: ex.sec, kind: ex.kind, ...scheme(profile.goal, profile.level, ex.kind), notes: '' });
    }
    return { id: uid(), name: tpl.name, focus: tpl.focus, exercises };
  });
  const plan = {
    id: uid(),
    name: split.name,
    source: 'ciencia',
    createdAt: new Date().toISOString(),
    rationale: rationaleFor(profile, days),
    days: planDays,
    nextDay: 0,
  };
  balanceVolume(plan, profile);
  return plan;
}

function rationaleFor(p, days) {
  const lines = [];
  lines.push(days <= 3
    ? `Con ${days} días, cuerpo completo permite entrenar cada músculo 2–3 veces por semana.`
    : `Con ${days} días, la división reparte el volumen para entrenar cada músculo ~2 veces por semana.`);
  if (p.goal === 'fuerza') lines.push('Compuestos en 4–6 repeticiones con descansos largos: las cargas altas maximizan la fuerza.');
  else lines.push('Rangos de 6–15 repeticiones cerca del fallo: la hipertrofia es similar en un rango amplio si el esfuerzo es alto.');
  if (p.goal === 'grasa' || p.goal === 'recomposicion') lines.push('En déficit se mantiene el entrenamiento pesado para conservar músculo; el déficit lo marca la dieta, no el cardio extra.');
  lines.push('Plan de 12 semanas en 3 bloques de 4 (3 de carga + 1 de descarga): cada semana la app te indica el peso objetivo y compara tu progreso real con el previsto.');
  return lines.join(' ');
}

// Volumen semanal por músculo: serie directa = 1, músculo secundario = 0,5.
export function weeklyVolume(plan) {
  const vol = Object.fromEntries(Object.keys(MUSCLES).map((m) => [m, 0]));
  for (const d of plan.days) {
    for (const ex of d.exercises) {
      const sets = Number(ex.sets) || 0;
      if (vol[ex.muscle] !== undefined) vol[ex.muscle] += sets;
      const sec = ex.sec || exerciseByName(ex.name)?.sec || [];
      for (const s of sec) if (vol[s] !== undefined) vol[s] += sets * 0.5;
    }
  }
  return vol;
}

// Rango objetivo de series semanales por músculo según nivel.
export function volumeTarget(level, muscle) {
  const small = ['gemelos', 'abdomen'].includes(muscle);
  const arms = ['biceps', 'triceps'].includes(muscle); // reciben mucho trabajo indirecto de empujes y tirones
  let r;
  if (level === 'principiante') r = small ? [4, 10] : [8, 14];
  else if (level === 'avanzado') r = small ? [6, 16] : [12, 22];
  else r = small ? [6, 14] : [10, 20];
  return arms ? [r[0] - 2, r[1]] : r;
}

// Ajuste fino: si un músculo grande queda por debajo del rango, suma una serie a su ejercicio
// principal; si queda muy por encima, resta una a su aislamiento.
function balanceVolume(plan, profile) {
  for (let pass = 0; pass < 16; pass++) {
    const vol = weeklyVolume(plan);
    let changed = false;
    for (const m of Object.keys(MUSCLES)) {
      const [lo, hi] = volumeTarget(profile.level, m);
      const exs = plan.days.flatMap((d) => d.exercises).filter((e) => e.muscle === m);
      if (!exs.length) continue;
      if (vol[m] < lo) {
        const target = [...exs].sort((a, b) => a.sets - b.sets)[0];
        if (target.sets < 5) { target.sets += 1; changed = true; }
      } else if (vol[m] > hi) {
        // primero recorta aislamientos, luego compuestos, nunca por debajo de 2 series
        const cand = [...exs].filter((e) => e.sets > 2).sort((a, b) => (a.kind === b.kind ? b.sets - a.sets : a.kind === 'i' ? -1 : 1));
        if (cand[0]) { cand[0].sets -= 1; changed = true; }
      }
    }
    if (!changed) break;
  }
}

// e1RM estimado (Epley). Válido sobre todo entre 1 y 12 repeticiones.
export const e1rm = (kg, reps) => (kg > 0 && reps > 0 ? kg * (1 + Math.min(reps, 12) / 30) : 0);

export function lastPerformance(sessions, name) {
  for (let i = sessions.length - 1; i >= 0; i--) {
    const ex = sessions[i].exercises.find((e) => e.name === name);
    if (ex && ex.sets.some((s) => s.done)) return { date: sessions[i].date, ex };
  }
  return null;
}

// Progresión doble: devuelve la sugerencia para hoy basada en la última sesión.
export function suggestion(sessions, target, name) {
  const last = lastPerformance(sessions, name);
  if (!last) return { kg: '', text: `Primera vez: elige un peso que te deje ${target.rir} repeticiones en reserva al hacer ${target.repMax}.` };
  const done = last.ex.sets.filter((s) => s.done && s.kg !== '' && s.reps !== '');
  if (!done.length) return { kg: '', text: 'Sin datos de la última vez.' };
  const topKg = Math.max(...done.map((s) => Number(s.kg)));
  const atTop = done.filter((s) => Number(s.kg) === topKg);
  const allMax = atTop.length >= target.sets && atTop.every((s) => Number(s.reps) >= target.repMax);
  const ex = exerciseByName(name);
  const inc = ex && ex.kind === 'c' && ex.equip === 'barra' ? 2.5 : ex && ex.equip === 'peso_corporal' ? 0 : ex?.kind === 'c' ? 2 : 1;
  if (allMax) {
    if (!inc) return { kg: topKg, text: `Completaste el rango. Hazlo más difícil (más lento, pausa o lastre) y vuelve a ${target.repMin} reps.` };
    return { kg: +(topKg + inc).toFixed(2), text: `¡Subes peso! ${topKg} → ${+(topKg + inc).toFixed(2)} kg, vuelve a ${target.repMin} reps.` };
  }
  const best = Math.max(...atTop.map((s) => Number(s.reps)));
  return { kg: topKg, text: `Mantén ${topKg} kg y busca +1 rep (última vez máx. ${best}).` };
}

export const PRINCIPLES = [
  { t: 'Volumen', d: 'Entre ~10 y 20 series efectivas por músculo a la semana. Más volumen da más crecimiento hasta cierto punto, con rendimientos decrecientes.', ref: 'Schoenfeld, Ogborn & Krieger (2017), J Sports Sci — dosis-respuesta del volumen.' },
  { t: 'Frecuencia', d: 'Entrenar cada músculo al menos 2 veces por semana repartiendo el volumen.', ref: 'Schoenfeld, Ogborn & Krieger (2016), Sports Med — frecuencia e hipertrofia.' },
  { t: 'Repeticiones', d: 'Para músculo, cualquier rango entre ~6 y 30 funciona si llegas cerca del fallo. Para fuerza, las cargas altas (1–6 reps) rinden más.', ref: 'Schoenfeld et al. (2017), JSCR; Lopez et al. (2021), MSSE — carga vs. hipertrofia y fuerza.' },
  { t: 'Esfuerzo (RIR)', d: 'Termina las series a 0–3 repeticiones del fallo. Quedarse lejos del fallo reduce el estímulo; ir siempre al fallo aumenta la fatiga sin mucho beneficio extra.', ref: 'Refalo et al. (2023), Sports Med — proximidad al fallo e hipertrofia.' },
  { t: 'Descanso', d: '2–3 minutos en ejercicios compuestos; 60–90 s en aislamiento.', ref: 'Schoenfeld et al. (2016), JSCR — descansos largos vs. cortos.' },
  { t: 'Progresión', d: 'Sobrecarga progresiva con progresión doble: más repeticiones dentro del rango y luego más peso.', ref: 'Principio de sobrecarga progresiva (ACSM Position Stand, 2009).' },
  { t: 'Periodización', d: 'Organizar el entrenamiento en bloques con cargas que cambian a lo largo de semanas mejora más la fuerza máxima que entrenar siempre igual; para hipertrofia ambos enfoques funcionan si el volumen es similar. Por eso el plan dura 12 semanas en 3 bloques.', ref: 'Williams et al. (2017), Sports Med — periodizado vs. no periodizado; Moesgaard et al. (2022), Sports Med.' },
  { t: 'Descargas', d: 'Una semana más ligera cada 4–6 semanas (menos series y más reserva) ayuda a disipar la fatiga y a seguir progresando. El plan programa una cada 4 semanas y puede adelantarla si detecta fatiga.', ref: 'Bell et al. (2023), Sports Med Open — consenso Delphi sobre descargas.' },
  { t: 'Autorregulación', d: 'Registrar las repeticiones en reserva (RIR) permite ajustar la carga a cómo estás ese día y estimar tu fuerza real sin ir al fallo. El plan compara esa estimación con la proyectada y propone ajustes.', ref: 'Zourdos et al. (2016), JSCR — escala RIR; Helms et al. (2018), Front Physiol — carga por RPE vs. %1RM.' },
  { t: 'Proteína', d: '1,6–2,2 g por kg de peso al día para maximizar la ganancia de músculo.', ref: 'Morton et al. (2018), Br J Sports Med — metaanálisis de proteína.' },
  { t: 'Ritmo de peso', d: 'Pérdida de grasa: −0,5 a −1 % del peso por semana para conservar músculo. Ganancia: +0,25 a +0,5 % por semana.', ref: 'Helms et al. (2014), JISSN — recomendaciones basadas en evidencia.' },
];

// Ritmo de cambio de peso recomendado (% por semana) según objetivo.
export function weightRateTarget(goal) {
  if (goal === 'grasa') return [-1, -0.5];
  if (goal === 'hipertrofia') return [0.25, 0.5];
  if (goal === 'fuerza') return [0, 0.5];
  return [-0.25, 0.25];
}
