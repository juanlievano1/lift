// Mezcla de copias (este celular ↔ la nube) sin perder entrenos.
//
// Antes ganaba la copia más reciente ENTERA y la otra se perdía (p. ej. un entreno hecho sin señal).
// Ahora es una mezcla "de tres vías": se compara cada copia con la última versión que este celular
// sincronizó (la "base"). Así se sabe qué es nuevo en cada lado y qué se borró:
//   - está en las dos copias        → se queda (con la versión de la copia más reciente)
//   - está en una sola y no en base → es nuevo en ese lado → se queda
//   - está en una sola y sí en base → el otro lado lo borró → se va
// Perfil, ajustes y rutina activa se toman de la copia modificada más recientemente.

export const COLLECTIONS = ['sessions', 'weights', 'plans'];
const keyOf = (x) => (x && x.id != null ? String(x.id) : JSON.stringify(x));

// JSON con las claves ordenadas: dos copias iguales dan el mismo texto aunque el orden de claves cambie.
export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

// Huella del contenido (sin la fecha de modificación).
export function hashOf(doc) {
  const { updatedAt, ...rest } = doc || {};
  const s = stableStringify(rest);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${h >>> 0}`;
}

// Lo que se guarda como "base" tras sincronizar: los ids de cada colección y la huella.
export function baseOf(doc) {
  const b = { hash: hashOf(doc) };
  for (const c of COLLECTIONS) b[c] = (doc?.[c] || []).map(keyOf);
  return b;
}

// Datos que viajan a la nube: nunca el entreno en curso (vive solo en el celular donde se está haciendo).
export function strip(doc) {
  const { owner, outbox, activeSession, ...rest } = doc || {};
  return rest;
}

export function mergeDocs(local, remote, base = null) {
  local = strip(local);
  remote = strip(remote);
  const localNewer = (local.updatedAt || 0) >= (remote.updatedAt || 0);
  const newer = localNewer ? local : remote;
  const older = localNewer ? remote : local;
  const out = { ...older, ...newer };
  for (const c of COLLECTIONS) {
    const L = new Map((local[c] || []).map((x) => [keyOf(x), x]));
    const R = new Map((remote[c] || []).map((x) => [keyOf(x), x]));
    const B = new Set(base?.[c] || []);
    const seen = new Set();
    const res = [];
    for (const x of [...(newer[c] || []), ...(older[c] || [])]) {
      const k = keyOf(x);
      if (seen.has(k)) continue;
      seen.add(k);
      if (L.has(k) && R.has(k)) res.push(localNewer ? L.get(k) : R.get(k));
      else if (!B.has(k)) res.push(x); // nuevo en un lado
      // (si estaba en la base y falta en un lado, ese lado lo borró)
    }
    // Entrenos y pesajes en orden de fecha (estable: el mismo día conserva su orden).
    if (c !== 'plans') res.sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')));
    out[c] = res;
  }
  if (out.activePlanId && !out.plans.some((p) => p.id === out.activePlanId)) out.activePlanId = out.plans[out.plans.length - 1]?.id ?? null;
  out.updatedAt = Math.max(local.updatedAt || 0, remote.updatedAt || 0);
  return out;
}
