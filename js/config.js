// Nombre de la app: cámbialo aquí (y en index.html, manifest.webmanifest y supabase/functions/coach/core.js).
export const APP_NAME = 'Lift';
export const APP_TAGLINE = 'Entrena con plan. Progresa con tu parche.';

// Conexión con Supabase. Ambos valores son públicos (la seguridad la dan las reglas de la base de datos).
// Déjalos vacíos para usar la app en modo local (un solo usuario, sin cuentas ni coach).
// Encuéntralos en Supabase → Project Settings → API Keys: la URL del proyecto y la clave "publishable"
// (empieza por sb_publishable_). Nunca pongas aquí la clave "secret".
export const SUPABASE_URL = 'https://huzbpfmwauzxoszxxyco.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_mpdX1LdDC-wOh-Ykz0RLmw_I7d9_wbS';

// Versión de prueba: sin Supabase, la app arranca con cuentas, amigos y coach SIMULADOS
// (cada quien en su propio celular). Pon false para el modo local de una sola persona.
export const DEMO = false;

// Coach con IA (Claude). Apagado mientras validamos la app; el servidor ya está listo para encenderlo.
export const COACH_ENABLED = false;
