// Exportación de solo lectura de los datos de entrenamiento de UNA cuenta de Lift.
// La usa el proyecto "Gym" en Claude para leer tus entrenos sin subir respaldos a mano.
//
// Seguridad:
// - Solo responde a GET con el encabezado `x-export-token` igual al secreto EXPORT_TOKEN.
// - Solo puede leer la fila de user_data de EXPORT_USER_ID. No acepta otro id por parámetro.
// - No escribe nada. Devuelve perfil, planes, entrenos y pesos; deja fuera el chat del coach,
//   los ajustes y la cola de actividad.
// - Se despliega sin verificación de JWT (no hay sesión de usuario); el token hace ese papel.

import { createClient } from 'npm:@supabase/supabase-js@2';

const TOKEN = Deno.env.get('EXPORT_TOKEN') ?? '';
const USER_ID = Deno.env.get('EXPORT_USER_ID') ?? '';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

// Comparación en tiempo constante para no filtrar el token por tiempos de respuesta.
function sameToken(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'GET') return json(405, { error: 'Solo GET' });
  if (TOKEN.length < 32 || !USER_ID) return json(500, { error: 'Función sin configurar' });
  if (!sameToken(req.headers.get('x-export-token') ?? '', TOKEN)) return json(401, { error: 'No autorizado' });

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { data: row, error } = await sb.from('user_data').select('data, updated_at').eq('user_id', USER_ID).maybeSingle();
  if (error) return json(500, { error: 'No se pudo leer' });
  if (!row) return json(404, { error: 'Sin datos' });

  const d = row.data ?? {};
  return json(200, {
    exportedAt: new Date().toISOString(),
    updatedAt: row.updated_at,
    profile: d.profile ?? null,
    plans: d.plans ?? [],
    activePlanId: d.activePlanId ?? null,
    sessions: d.sessions ?? [],
    weights: d.weights ?? [],
  });
});
