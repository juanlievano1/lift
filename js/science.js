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

// La app está pensada solo para gimnasio.
export const EQUIPMENT = { gym: 'Gimnasio' };

// En el gimnasio se usan barras, mancuernas, máquinas y poleas. El peso corporal solo para abdomen y
// algunos ejercicios clásicos que se hacen en barra fija o paralelas.
const GYM_EQUIP = ['barra', 'mancuernas', 'maquina', 'polea', 'barra_fija'];
const GYM_BODYWEIGHT_PATTERNS = ['abdomen'];
const allowedInGym = (e) => GYM_EQUIP.includes(e.equip) || (e.equip === 'peso_corporal' && GYM_BODYWEIGHT_PATTERNS.includes(e.pattern));

// Rangos de tiempo por sesión. El plan se arma para que quepa en el máximo del rango.
export const TIME_RANGES = { '30-45': [30, 45], '45-60': [45, 60], '60-75': [60, 75], '75-90': [75, 90] };
export const timeRangeOf = (p) => (TIME_RANGES[p?.time] ? p.time : (Number(p?.minutes) || 60) <= 45 ? '30-45' : (Number(p?.minutes) || 60) <= 60 ? '45-60' : (Number(p?.minutes) || 60) <= 75 ? '60-75' : '75-90');
export const timeLabel = (r) => `${r.replace('-', '–')} min`;

// Minutos que toma cada serie con su descanso (compuestos más largos) y calentamiento inicial.
const MIN_PER_SET = { c: 3, i: 1.8 };
const WARMUP_MIN = 8;
export function estimateMinutes(day) {
  return Math.round(WARMUP_MIN + day.exercises.reduce((a, e) => a + (Number(e.sets) || 0) * (MIN_PER_SET[e.kind || exerciseByName(e.name)?.kind] ?? 2.4), 0));
}

// Ejercicios que un principiante casi nunca puede hacer bien todavía: se evitan si hay alternativa.
const HARD = new Set(['dominadas', 'dominadas_sup', 'fondos', 'nordico', 'piernas_colgado', 'rueda', 'chin_neg', 'sissy', 'pica', 'flexiones_deficit']);

// Grupos que el usuario puede priorizar.
export const PRIORITIES = {
  brazos: { label: 'Brazos', muscles: ['biceps', 'triceps'] },
  pecho: { label: 'Pecho', muscles: ['pecho'] },
  espalda: { label: 'Espalda', muscles: ['espalda'] },
  hombros: { label: 'Hombros', muscles: ['hombros'] },
  piernas: { label: 'Piernas', muscles: ['cuadriceps', 'isquios'] },
  gluteos: { label: 'Glúteos', muscles: ['gluteos'] },
  abdomen: { label: 'Abdomen', muscles: ['abdomen'] },
};

const GOAL_SHORT = { hipertrofia: 'Ganar músculo', fuerza: 'Fuerza', grasa: 'Perder grasa', recomposicion: 'Recomposición', salud: 'Salud' };

// kind: c = compuesto, i = aislamiento. sec = músculos secundarios (cuentan 0,5 series).
// Orden dentro de cada patrón = preferencia (los primeros se eligen antes si hay equipo).
const L = (id, name, pattern, muscle, sec, equip, kind) => ({ id, name, pattern, muscle, sec, equip, kind });
export const EXERCISES = [
  // Empuje horizontal
  L('banca', 'Press de banca con barra', 'empuje_h', 'pecho', ['triceps', 'hombros'], 'barra', 'c'),
  L('inclinado_mc', 'Press inclinado con mancuernas', 'empuje_h', 'pecho', ['triceps', 'hombros'], 'mancuernas', 'c'),
  L('press_pecho_maq', 'Press de pecho en máquina', 'empuje_h', 'pecho', ['triceps'], 'maquina', 'c'),
  L('banca_mc', 'Press de banca con mancuernas', 'empuje_h', 'pecho', ['triceps', 'hombros'], 'mancuernas', 'c'),
  L('fondos', 'Fondos en paralelas', 'empuje_h', 'pecho', ['triceps'], 'barra_fija', 'c'),
  L('flexiones', 'Flexiones', 'empuje_h', 'pecho', ['triceps', 'hombros'], 'peso_corporal', 'c'),
  // Empuje vertical
  L('militar', 'Press militar con barra', 'empuje_v', 'hombros', ['triceps'], 'barra', 'c'),
  L('hombro_mc', 'Press de hombro con mancuernas', 'empuje_v', 'hombros', ['triceps'], 'mancuernas', 'c'),
  L('hombro_maq', 'Press de hombro en máquina', 'empuje_v', 'hombros', ['triceps'], 'maquina', 'c'),
  L('pica', 'Flexiones pica', 'empuje_v', 'hombros', ['triceps'], 'peso_corporal', 'c'),
  // Tracción vertical
  L('jalon', 'Jalón al pecho', 'traccion_v', 'espalda', ['biceps'], 'polea', 'c'),
  L('dominadas', 'Dominadas', 'traccion_v', 'espalda', ['biceps'], 'barra_fija', 'c'),
  L('jalon_neutro', 'Jalón agarre neutro', 'traccion_v', 'espalda', ['biceps'], 'polea', 'c'),
  L('pullover_mc', 'Pullover con mancuerna', 'traccion_v', 'espalda', ['pecho'], 'mancuernas', 'c'),
  L('dominadas_sup', 'Dominadas supinas', 'traccion_v', 'espalda', ['biceps'], 'barra_fija', 'c'),
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
  L('chin_neg', 'Dominadas supinas negativas', 'biceps', 'biceps', ['espalda'], 'barra_fija', 'c'),
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
  L('piernas_colgado', 'Elevación de piernas colgado', 'abdomen', 'abdomen', [], 'barra_fija', 'i'),
  L('plancha_lat', 'Plancha lateral con elevación de cadera', 'abdomen', 'abdomen', [], 'peso_corporal', 'i'),
  L('rueda', 'Rueda abdominal', 'abdomen', 'abdomen', [], 'peso_corporal', 'i'),
  L('crunch', 'Crunch', 'abdomen', 'abdomen', [], 'peso_corporal', 'i'),
];

export const exerciseByName = (name) => EXERCISES.find((e) => e.name.toLowerCase() === String(name).toLowerCase());

// Plantillas de días: [patrón, variante] en orden de prioridad.
// La variante elige otra opción del mismo patrón. Los brazos van antes que los accesorios menores.
const DAYS = {
  FB_A: { name: 'Full Body A', focus: 'Cuerpo completo', slots: [['sentadilla', 0], ['empuje_h', 0], ['traccion_h', 0], ['isq_iso', 0], ['biceps', 0], ['triceps', 0], ['hombro_lat', 0], ['abdomen', 0], ['gemelos', 0]] },
  FB_B: { name: 'Full Body B', focus: 'Cuerpo completo', slots: [['bisagra', 0], ['traccion_v', 0], ['empuje_v', 0], ['cuad_iso', 0], ['triceps', 1], ['biceps', 1], ['hombro_post', 0], ['abdomen', 1], ['pecho_iso', 0]] },
  FB_C: { name: 'Full Body C', focus: 'Cuerpo completo', slots: [['sentadilla', 1], ['empuje_h', 1], ['traccion_v', 1], ['bisagra', 1], ['biceps', 2], ['triceps', 2], ['hombro_lat', 1], ['gemelos', 1]] },
  UA: { name: 'Torso A', focus: 'Pecho, espalda, hombros y brazos', slots: [['empuje_h', 0], ['traccion_h', 0], ['empuje_v', 0], ['traccion_v', 0], ['biceps', 0], ['triceps', 0], ['hombro_lat', 0], ['hombro_post', 0]] },
  UB: { name: 'Torso B', focus: 'Pecho, espalda, hombros y brazos', slots: [['empuje_h', 1], ['traccion_v', 1], ['traccion_h', 1], ['hombro_lat', 1], ['biceps', 1], ['triceps', 1], ['pecho_iso', 0], ['hombro_post', 1]] },
  LA: { name: 'Pierna A', focus: 'Cuádriceps, isquios y glúteos', slots: [['sentadilla', 0], ['bisagra', 0], ['cuad_iso', 0], ['isq_iso', 0], ['gemelos', 0], ['abdomen', 0]] },
  LB: { name: 'Pierna B', focus: 'Glúteos, isquios y cuádriceps', slots: [['bisagra', 1], ['sentadilla', 1], ['isq_iso', 1], ['cuad_iso', 1], ['gemelos', 1], ['abdomen', 1]] },
  PUSH: { name: 'Empuje', focus: 'Pecho, hombros y tríceps', slots: [['empuje_h', 0], ['empuje_v', 0], ['empuje_h', 1], ['hombro_lat', 0], ['triceps', 0], ['triceps', 1], ['pecho_iso', 0]] },
  PULL: { name: 'Tracción', focus: 'Espalda, deltoide posterior y bíceps', slots: [['traccion_v', 0], ['traccion_h', 0], ['traccion_v', 1], ['biceps', 0], ['biceps', 1], ['hombro_post', 0], ['abdomen', 0]] },
  PUSH2: { name: 'Empuje B', focus: 'Pecho, hombros y tríceps', slots: [['empuje_h', 1], ['empuje_v', 1], ['pecho_iso', 1], ['hombro_lat', 1], ['triceps', 1], ['triceps', 2], ['empuje_h', 2]] },
  PULL2: { name: 'Tracción B', focus: 'Espalda, deltoide posterior y bíceps', slots: [['traccion_h', 1], ['traccion_v', 1], ['traccion_h', 2], ['biceps', 1], ['biceps', 2], ['hombro_post', 1], ['abdomen', 1]] },
};

// Si no hay ejercicio para un patrón con el equipo disponible, se usa otro patrón cercano.
const FALLBACK = { traccion_v: 'traccion_h', pecho_iso: 'empuje_h', hombro_post: 'traccion_h' };

const SPLITS = {
  2: { name: 'Full Body 2 días', days: ['FB_A', 'FB_B'] },
  3: { name: 'Full Body 3 días', days: ['FB_A', 'FB_B', 'FB_C'] },
  4: { name: 'Torso / Pierna 4 días', days: ['UA', 'LA', 'UB', 'LB'] },
  5: { name: 'Torso / Pierna + Empuje / Tracción 5 días', days: ['UA', 'LA', 'PUSH', 'PULL', 'LB'] },
  6: { name: 'Empuje / Tracción / Pierna 6 días', days: ['PUSH', 'PULL', 'LA', 'PUSH2', 'PULL2', 'LB'] },
};

// Esquema de series/reps/RIR/descanso por objetivo (compuesto vs aislamiento).
// Series, reps, RIR y descanso sugeridos para un ejercicio según objetivo y nivel.
export const exerciseDefaults = (profile, kind) => scheme(profile?.goal, profile?.level, kind);

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

const maxSets = (level) => (level === 'principiante' ? 4 : 5);

function pick(pattern, variant, profile, used) {
  let opts = EXERCISES.filter((e) => e.pattern === pattern && allowedInGym(e));
  if (!opts.length && FALLBACK[pattern]) opts = EXERCISES.filter((e) => e.pattern === FALLBACK[pattern] && allowedInGym(e));
  if (!opts.length) return null;
  if (profile.level === 'principiante') {
    const easy = opts.filter((e) => !HARD.has(e.id));
    if (easy.length) opts = easy;
  }
  const fresh = opts.filter((e) => !used.has(e.id));
  const pool = fresh.length ? fresh : opts;
  return pool[variant % pool.length];
}

const prioritized = (profile) => new Set((profile.priorities || []).flatMap((k) => PRIORITIES[k]?.muscles || []));

export function generatePlan(profile) {
  const days = Math.max(2, Math.min(6, Number(profile.days) || 3));
  const split = SPLITS[days];
  const range = timeRangeOf(profile);
  const maxMin = TIME_RANGES[range][1];
  const prio = prioritized(profile);
  const left = [];
  const planDays = split.days.map((key) => {
    const tpl = DAYS[key];
    const used = new Set();
    const exercises = [];
    let minutes = WARMUP_MIN;
    for (const [pattern, variant] of tpl.slots) {
      const ex = pick(pattern, variant, profile, used);
      if (!ex) continue;
      const item = { name: ex.name, muscle: ex.muscle, sec: ex.sec, kind: ex.kind, ...scheme(profile.goal, profile.level, ex.kind), notes: '' };
      const cost = item.sets * MIN_PER_SET[ex.kind];
      // Lo que no cabe en el tiempo se queda por fuera, salvo los músculos que elegiste priorizar.
      if (minutes + cost > maxMin && !prio.has(ex.muscle)) { left.push(`${ex.name} (${tpl.name})`); continue; }
      used.add(ex.id);
      exercises.push(item);
      minutes += cost;
    }
    return { id: uid(), name: tpl.name, focus: tpl.focus, exercises };
  });
  const plan = {
    id: uid(),
    name: `${split.name} · ${GOAL_SHORT[profile.goal] || ''}`.replace(/ · $/, ''),
    source: 'ciencia',
    createdAt: new Date().toISOString(),
    rationale: '',
    days: planDays,
    nextDay: 0,
  };
  balanceVolume(plan, profile);
  // Si al subir volumen alguna sesión se pasó del tiempo, recorta series de aislamiento (no de prioridades).
  for (const d of plan.days) {
    let guard = 30;
    while (estimateMinutes(d) > maxMin + 2 && guard--) {
      const cand = d.exercises.filter((e) => e.sets > 2 && !prio.has(e.muscle)).sort((a, b) => (a.kind === b.kind ? b.sets - a.sets : a.kind === 'i' ? -1 : 1))[0];
      if (!cand) break;
      cand.sets -= 1;
    }
  }
  plan.rationale = rationaleFor(profile, days, range, left);
  return plan;
}

function rationaleFor(p, days, range, left = []) {
  const lines = [];
  lines.push(days <= 3
    ? `Con ${days} días, cuerpo completo permite entrenar cada músculo 2–3 veces por semana.`
    : `Con ${days} días, la división reparte el trabajo para entrenar cada músculo unas 2 veces por semana.`);
  const goalLine = {
    hipertrofia: 'Para ganar músculo: series de 6–15 repeticiones cerca del fallo, con 10–20 series por músculo a la semana.',
    fuerza: 'Para ganar fuerza: los básicos en 4–6 repeticiones con descansos largos; los accesorios sostienen el músculo que luego empuja la fuerza.',
    grasa: 'Para perder grasa: el déficit lo pone la comida (bajar 0,5–1 % de tu peso por semana). Este plan existe para que el peso que pierdas sea grasa y no músculo: mantienes cargas pesadas y volumen suficiente. Suma 8.000–10.000 pasos al día.',
    recomposicion: 'Para recomposición: cargas pesadas y volumen suficiente para ganar músculo mientras comes cerca de tu mantenimiento, con suficiente proteína.',
    salud: 'Para salud y forma: movimientos básicos con margen (2–3 repeticiones en reserva) para ganar fuerza y aprender buena técnica sin lesionarte.',
  }[p.goal];
  if (goalLine) lines.push(goalLine);
  if (p.priorities?.length) lines.push(`Prioridad en ${p.priorities.map((k) => PRIORITIES[k]?.label.toLowerCase()).filter(Boolean).join(', ')}: más series para esos músculos.`);
  lines.push(`Cada sesión está pensada para ${timeLabel(range)}, contando descansos y calentamiento.`);
  if (left.length) lines.push(`Por tiempo quedaron por fuera: ${left.slice(0, 4).join(', ')}. Si tienes más tiempo, súbelo en tu perfil.`);
  lines.push('Son 12 semanas en 3 bloques de 4 (3 de carga + 1 de descarga): cada semana la app te dice qué peso usar y compara tu progreso con el previsto.');
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
  const arms = ['biceps', 'triceps'].includes(muscle); // reciben trabajo indirecto de empujes y tirones
  let r;
  if (level === 'principiante') r = small ? [4, 10] : [8, 14];
  else if (level === 'avanzado') r = small ? [6, 16] : [12, 22];
  else r = small ? [6, 14] : [10, 20];
  return arms ? [r[0] - 2, r[1]] : r;
}

// Ajuste fino: sube series de los músculos por debajo del rango (o de la mitad del rango si son prioridad)
// y recorta los que se pasan, primero en aislamientos.
function balanceVolume(plan, profile) {
  const prio = prioritized(profile);
  const cap = maxSets(profile.level);
  for (let pass = 0; pass < 20; pass++) {
    const vol = weeklyVolume(plan);
    let changed = false;
    for (const m of Object.keys(MUSCLES)) {
      let [lo, hi] = volumeTarget(profile.level, m);
      if (prio.has(m)) lo = Math.round((lo + hi) / 2);
      const exs = plan.days.flatMap((d) => d.exercises).filter((e) => e.muscle === m);
      if (!exs.length) continue;
      if (vol[m] < lo) {
        const target = [...exs].sort((a, b) => a.sets - b.sets)[0];
        if (target.sets < cap) { target.sets += 1; changed = true; }
      } else if (vol[m] > hi && !prio.has(m)) {
        const cand = [...exs].filter((e) => e.sets > 2).sort((a, b) => (a.kind === b.kind ? b.sets - a.sets : a.kind === 'i' ? -1 : 1));
        if (cand[0]) { cand[0].sets -= 1; changed = true; }
      }
    }
    if (!changed) break;
  }
}

// ---------- Peso sugerido para empezar ----------
// 1RM típico como fracción del peso corporal (hombre de nivel intermedio). Son referencias aproximadas
// de estándares de fuerza: sirven para no empezar a ciegas; la primera sesión calibra el plan.
const START_RATIO = {
  banca: 1.0, inclinado_mc: 0.32, press_pecho_maq: 0.9, banca_mc: 0.36,
  militar: 0.6, hombro_mc: 0.24, hombro_maq: 0.55,
  jalon: 0.8, jalon_neutro: 0.8, pullover_mc: 0.3,
  remo_polea: 0.8, remo_barra: 0.85, remo_mc: 0.42, remo_maq: 0.75,
  sentadilla: 1.3, prensa: 2.3, hack: 1.4, bulgara_mc: 0.3, goblet: 0.45,
  rumano: 1.1, hip_thrust: 1.5, rumano_mc: 0.4, hip_thrust_mc: 0.6,
  extension_cuad: 0.7, zancadas_mc: 0.25, step_up_mc: 0.25,
  curl_fem_sent: 0.6, curl_fem_tumb: 0.5, rumano_1p_mc: 0.3,
  aperturas_polea: 0.2, pec_deck: 0.6, aperturas_mc: 0.15,
  lat_polea: 0.08, lat_mc: 0.12, lat_maq: 0.35,
  face_pull: 0.35, reverse_deck: 0.4, pajaros: 0.1,
  curl_barra: 0.45, curl_inclinado: 0.15, curl_polea: 0.35, curl_martillo: 0.18,
  ext_polea: 0.4, ext_overhead: 0.35, frances: 0.35, ext_overhead_mc: 0.3,
  talones_maq: 1.2, talones_prensa: 1.6, talones_mc: 0.3, crunch_polea: 0.6,
};
// Ejercicios donde el peso es por cada mancuerna.
const PER_HAND = new Set(['inclinado_mc', 'banca_mc', 'hombro_mc', 'remo_mc', 'bulgara_mc', 'rumano_mc', 'zancadas_mc', 'step_up_mc', 'rumano_1p_mc', 'aperturas_mc', 'lat_mc', 'pajaros', 'curl_inclinado', 'curl_martillo', 'talones_mc']);
const UPPER = new Set(['pecho', 'espalda', 'hombros', 'biceps', 'triceps']);
const LEVEL_FACTOR = { principiante: 0.6, intermedio: 1, avanzado: 1.3 };

export const perHand = (name) => PER_HAND.has(exerciseByName(name)?.id);

// Devuelve el 1RM estimado para empezar, o null si no hay referencia (peso corporal o ejercicio propio).
export function estimateStart1RM(profile, name) {
  const ex = exerciseByName(name);
  const bw = Number(profile?.weight);
  if (!ex || !bw || !(ex.id in START_RATIO)) return null;
  let r = START_RATIO[ex.id] * (LEVEL_FACTOR[profile.level] ?? 0.8);
  if (profile.sex === 'mujer') r *= UPPER.has(ex.muscle) ? 0.55 : 0.75;
  return bw * r * 0.9; // 10 % por debajo: mejor empezar fácil y subir
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
