// Servidor simulado SOLO para pruebas (?mock=1). Imita la API de cloud.js en el navegador:
// cuentas, datos, amistades, actividad, fuerzas y respuestas de ejemplo del coach.

import { generatePlan } from './science.js';

const KEY = 'forja.mockdb';
const SKEY = 'forja.mocksession';
const wait = (ms = 500) => new Promise((r) => setTimeout(r, ms));
const id = () => crypto.randomUUID();
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();

function seed() {
  const sofia = { id: id(), email: 'sofia@ejemplo.com', password: 'x', username: 'sofia', display_name: 'Sofía Rojas' };
  const andres = { id: id(), email: 'andres@ejemplo.com', password: 'x', username: 'andres_fit', display_name: 'Andrés Gómez' };
  const camilo = { id: id(), email: 'camilo@ejemplo.com', password: 'x', username: 'camilo', display_name: 'Camilo Pérez' };
  const act = (u, h, payload) => ({ id: id(), user_id: u.id, kind: 'session', created_at: ago(h), payload });
  return {
    users: [sofia, andres, camilo],
    data: {},
    friendships: [], // se crean al registrarse el usuario de prueba
    pendingFor: { sofia: sofia.id, andres: andres.id, camilo: camilo.id },
    activity: [
      act(sofia, 3, { dayName: 'Pierna A', planName: 'Torso / Pierna 4 días', week: 5, weekLabel: 'Semana 5 · Desarrollo', durationMin: 64, sets: 19, volumeKg: 8120, top: [{ name: 'Sentadilla con barra', kg: 70, reps: 8 }, { name: 'Hip thrust con barra', kg: 100, reps: 10 }], prs: ['Hip thrust con barra'] }),
      act(andres, 20, { dayName: 'Empuje', planName: 'Empuje / Tracción / Pierna 6 días', week: 2, weekLabel: 'Semana 2 · Base', durationMin: 71, sets: 22, volumeKg: 9650, top: [{ name: 'Press de banca con barra', kg: 92.5, reps: 6 }], prs: [] }),
      act(sofia, 50, { dayName: 'Torso B', planName: 'Torso / Pierna 4 días', week: 5, weekLabel: 'Semana 5 · Desarrollo', durationMin: 55, sets: 18, volumeKg: 5230, top: [{ name: 'Dominadas', kg: 0, reps: 9 }], prs: ['Dominadas'] }),
    ],
    cheers: [],
    usage: {},
  };
}

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { return seed(); } };
const store = (d) => localStorage.setItem(KEY, JSON.stringify(d));
const pub = (u) => u && { id: u.id, username: u.username, display_name: u.display_name, username_confirmed: u.username_confirmed !== false };

export function mockBackend() {
  let d = load(); store(d);
  let listener = () => {};
  const current = () => d.users.find((u) => u.id === localStorage.getItem(SKEY)) || null;
  const meId = () => current()?.id;

  return {
    async session() { const u = current(); return u ? { id: u.id, email: u.email } : null; },
    async signUp({ email, password, username, displayName }) {
      await wait(400);
      if (d.users.some((u) => u.email === email)) throw new Error('Ese correo ya tiene una cuenta. Inicia sesión.');
      if (d.users.some((u) => u.username === username.toLowerCase())) throw new Error('Ese nombre de usuario ya está en uso.');
      const u = { id: id(), email, password, username: username.toLowerCase(), display_name: displayName };
      d.users.push(u);
      // Escenario de prueba: ya eres amigo de Sofía y Andrés, y Camilo te envió una solicitud.
      d.friendships.push({ requester: u.id, addressee: d.pendingFor.sofia, status: 'accepted', created_at: ago(100) });
      d.friendships.push({ requester: d.pendingFor.andres, addressee: u.id, status: 'accepted', created_at: ago(90) });
      d.friendships.push({ requester: d.pendingFor.camilo, addressee: u.id, status: 'pending', created_at: ago(2) });
      store(d);
      localStorage.setItem(SKEY, u.id);
      return { user: { id: u.id, email }, needsConfirm: false };
    },
    // Simula volver de Google con una cuenta nueva (en la app real, Google pide elegir la cuenta).
    async signInWithGoogle() {
      await wait(600);
      let u = d.users.find((x) => x.email === 'google.prueba@gmail.com');
      if (!u) {
        u = { id: id(), email: 'google.prueba@gmail.com', password: null, username: `juanprueba${Math.floor(Math.random() * 9000) + 1000}`, display_name: 'Juan Prueba', username_confirmed: false };
        d.users.push(u);
        d.friendships.push({ requester: u.id, addressee: d.pendingFor.sofia, status: 'accepted', created_at: ago(100) });
        d.friendships.push({ requester: d.pendingFor.andres, addressee: u.id, status: 'accepted', created_at: ago(90) });
        d.friendships.push({ requester: d.pendingFor.camilo, addressee: u.id, status: 'pending', created_at: ago(2) });
        store(d);
      }
      localStorage.setItem(SKEY, u.id);
      return { id: u.id, email: u.email };
    },
    async confirmUsername(uid, username, display_name) {
      if (d.users.some((x) => x.username === username.toLowerCase() && x.id !== uid)) throw new Error('Ese nombre de usuario ya está en uso.');
      Object.assign(d.users.find((x) => x.id === uid), { username: username.toLowerCase(), display_name, username_confirmed: true }); store(d);
    },
    async signIn({ email, password }) {
      await wait(300);
      const u = d.users.find((x) => x.email === email && x.password === password);
      if (!u) throw new Error('Correo o contraseña incorrectos.');
      localStorage.setItem(SKEY, u.id);
      return { id: u.id, email };
    },
    async signOut() { localStorage.removeItem(SKEY); listener(null); },
    async resetPassword() { await wait(300); },
    async usernameAvailable(u) { return /^[a-z0-9_]{3,20}$/.test(u.toLowerCase()) && !d.users.some((x) => x.username === u.toLowerCase()); },
    async profile(uid) { return pub(d.users.find((u) => u.id === uid)); },
    async updateProfile(uid, f) { Object.assign(d.users.find((u) => u.id === uid), f); store(d); },
    async pull(uid) { return d.data[uid] || null; },
    async push(uid, data) { d.data[uid] = { data, updated_at: new Date().toISOString() }; store(d); },
    async friendships() {
      const me = meId();
      return d.friendships.filter((f) => f.requester === me || f.addressee === me).map((f) => ({ ...f, req: pub(d.users.find((u) => u.id === f.requester)), adr: pub(d.users.find((u) => u.id === f.addressee)) }));
    },
    async search(q) { return d.users.filter((u) => u.id !== meId() && u.username.startsWith(q.toLowerCase())).map(pub); },
    async byUsername(name) { return pub(d.users.find((u) => u.username === name.toLowerCase())); },
    async request(to) {
      const me = meId();
      if (d.friendships.some((f) => (f.requester === me && f.addressee === to) || (f.requester === to && f.addressee === me))) throw new Error('Ya hay una solicitud entre ustedes.');
      d.friendships.push({ requester: me, addressee: to, status: 'pending', created_at: new Date().toISOString() }); store(d);
    },
    async accept(from) { const f = d.friendships.find((x) => x.requester === from && x.addressee === meId()); if (f) f.status = 'accepted'; store(d); },
    async remove(other) { const me = meId(); d.friendships = d.friendships.filter((f) => !((f.requester === me && f.addressee === other) || (f.requester === other && f.addressee === me))); store(d); },
    async feed(userId) {
      await wait(200);
      const me = meId();
      const friendIds = d.friendships.filter((f) => f.status === 'accepted' && (f.requester === me || f.addressee === me)).map((f) => (f.requester === me ? f.addressee : f.requester));
      return d.activity
        .filter((a) => (a.user_id === me || friendIds.includes(a.user_id)) && (!userId || a.user_id === userId))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((a) => ({ ...a, author: pub(d.users.find((u) => u.id === a.user_id)), cheers: d.cheers.filter((c) => c.activity_id === a.id).map((c) => ({ user_id: c.user_id })) }));
    },
    async publish(uid, kind, payload) { d.activity.push({ id: id(), user_id: uid, kind, payload, created_at: new Date().toISOString() }); store(d); },
    async cheer(aid, on) { const me = meId(); d.cheers = d.cheers.filter((c) => !(c.activity_id === aid && c.user_id === me)); if (on) d.cheers.push({ activity_id: aid, user_id: me }); store(d); },
    async usage(uid) { return { usedCents: d.usage[uid] || 0 }; },
    async coach(action, payload) {
      await wait(900);
      const me = meId();
      d.usage[me] = (d.usage[me] || 0) + 3; store(d);
      const usage = { usedCents: d.usage[me], limitCents: 200 };
      return { ...mockCoach(action, payload), usage };
    },
    onAuth(cb) { listener = cb; },
  };
}

function mockCoach(action, p) {
  const name = p.profile?.name || 'crack';
  if (action === 'interview') {
    const userTurns = (p.messages || []).filter((m) => m.role === 'user').length;
    if (!userTurns) return { message: `¡Hola ${name}! Veo que quieres ${p.profile?.goal === 'fuerza' ? 'ganar fuerza' : 'ganar músculo'} entrenando ${p.profile?.days} días de ${p.profile?.minutes} min. Antes de armarlo:\n\n1. ¿Qué ejercicios te encantan y cuáles prefieres evitar?\n2. ¿Hay algún músculo que quieras priorizar?\n3. ¿Algún día tienes menos tiempo?`, plan: null };
    const base = generatePlan(p.profile || {});
    const last = (p.messages || []).filter((m) => m.role === 'user').pop()?.text || '';
    const plan = { name: 'Plan del coach', rationale: `Diseñado con lo que me contaste ("${last.slice(0, 60)}"). ${base.rationale}`, days: base.days.map(({ id: _i, ...d }) => d) };
    return { message: userTurns === 1 ? 'Listo, aquí está mi propuesta. Prioricé lo que me dijiste y mantuve el volumen en el rango recomendado. ¿Quieres cambiar algo?' : 'Hecho, ajusté el plan con tu comentario. ¿Algo más?', plan };
  }
  if (action === 'chat') {
    const last = (p.messages || []).filter((m) => m.role === 'user').pop()?.text?.toLowerCase() || '';
    if (/cambi|más|mas|quit|no me gusta/.test(last)) {
      const day = p.plan?.days?.[0];
      const ex = day?.exercises?.[day.exercises.length - 1];
      return { message: 'Te propongo este ajuste. Revísalo y aplícalo si te convence:', changes: ex ? [{ action: 'sets', day: day.name, exercise: ex.name, replacement: '', muscle: ex.muscle, kind: ex.kind || 'i', sets: Math.min((ex.sets || 3) + 1, 6), reason: 'Sumar una serie aquí acerca tu volumen al centro del rango sin alargar mucho la sesión.' }] : [] };
    }
    return { message: `Buena pregunta, ${name}. Según tu plan vas en la semana ${p.report?.week ?? 1}: mantén el RIR que te marca la app y prioriza dormir 7–9 h. Si quieres que cambie algo del plan, dímelo y te propongo el ajuste.`, changes: [] };
  }
  if (action === 'review') {
    const ex = p.report?.exercises || [];
    const down = ex.find((e) => e.status === 'abajo');
    return {
      summary: `Semana ${p.reviewWeek || p.report?.week}: ${p.report?.adherence ? `${p.report.adherence.done} de ${p.report.adherence.expected} entrenos hechos.` : ''} ${ex.filter((e) => e.status === 'arriba').length} ejercicios van por delante del plan.`,
      wins: ['Constancia en los entrenos de la semana'],
      concerns: down ? [`${down.name} está por debajo del plan`] : [],
      nextFocus: 'Mantén la técnica y registra el RIR con honestidad: así el plan se ajusta mejor a ti.',
      changes: down ? [{ action: 'sets', day: '', exercise: down.name, replacement: '', muscle: down.muscle, kind: down.kind, sets: Math.max(2, (down.sets || 3) - 1), reason: 'Bajar una serie reduce la fatiga y suele desbloquear la progresión.' }] : [],
    };
  }
  if (action === 'post_session') {
    const s = p.session || {};
    return { headline: s.prs?.length ? `Récord en ${s.prs[0].split(' ').slice(0, 3).join(' ')} 🏆` : 'Sesión sólida 💪', comment: `Buen ${s.dayName}: ${s.exercises?.length || 0} ejercicios en ${s.durationMin} min. ${s.prs?.length ? 'Ese récord confirma que el plan te está funcionando. ' : ''}La próxima vez intenta mantener el RIR objetivo en las últimas series.` };
  }
  return {};
}
