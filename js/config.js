// Nombre de la app: cámbialo aquí (y en index.html, manifest.webmanifest y supabase/functions/coach/core.js).
export const APP_NAME = 'Racha';
export const APP_TAGLINE = 'Entrena con plan. Progresa con tu parche.';

// Conexión con Supabase. Ambos valores son públicos (la seguridad la dan las reglas de la base de datos).
// Déjalos vacíos para usar la app en modo local (un solo usuario, sin cuentas ni coach).
// Encuéntralos en Supabase → Project Settings → API.
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

// Versión de prueba: sin Supabase, la app arranca con cuentas, amigos y coach SIMULADOS
// (cada quien en su propio celular). Pon false para el modo local de una sola persona.
export const DEMO = true;
