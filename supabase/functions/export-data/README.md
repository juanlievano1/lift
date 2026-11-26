# export-data

Exportación de **solo lectura** de los datos de una cuenta de Lift (perfil, planes, entrenos y pesos), protegida con un token. Sirve para que Claude lea tus entrenos sin que subas respaldos a mano.

## Desplegar

Desde la carpeta del proyecto de Supabase (donde está `supabase/`):

```bash
# 1. Tu id de usuario: Supabase → Authentication → Users → tu cuenta → User UID
supabase secrets set EXPORT_USER_ID=<tu-user-uid>

# 2. Un token largo y aleatorio (guárdalo, lo necesitas para llamar la función)
supabase secrets set EXPORT_TOKEN=$(openssl rand -hex 32)

# 3. Desplegar sin verificación de JWT (el token hace ese papel)
supabase functions deploy export-data --no-verify-jwt
```

En Windows sin `openssl`, genera el token en PowerShell:
`-join ((1..64) | % { '{0:x}' -f (Get-Random -Max 16) })`

## Usar

```bash
curl -H "x-export-token: <token>" https://huzbpfmwauzxoszxxyco.supabase.co/functions/v1/export-data
```

## Qué no hace

- No escribe ni borra nada.
- No lee otras cuentas: el id viene del secreto, no de la petición.
- No devuelve el chat del coach ni los ajustes.

Para cortar el acceso: `supabase secrets set EXPORT_TOKEN=<otro-token>` o `supabase functions delete export-data`.
