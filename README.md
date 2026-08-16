# SHEBAND 2 — PWA social + emergency

Esta versión convierte SHEBAND en una aplicación web/PWA con:

- Inicio minimalista: botón EMERGENCIA, hora exacta, ubicación y dispositivos/contactos a informar.
- Autenticación mediante Google, Apple (iCloud/Apple ID) o teléfono con OTP usando Supabase Auth.
- Perfil con cuenta pública/privada, bio y foto.
- Publicación de fotos.
- Mensajería 1 a 1 con Supabase Realtime.
- Sección de información sobre violencia de género, femicidios y derechos de las mujeres.
- Contactos de emergencia.
- Backend Node/Express.
- Alertas de emergencia persistidas en Supabase.
- SMS de emergencia mediante Twilio cuando se configuran sus credenciales.
- PWA instalable.

## 1. Supabase

1. Crear un proyecto en Supabase.
2. Abrir SQL Editor y ejecutar `supabase/schema.sql`.
3. En Authentication > Providers activar Google, Apple y Phone.
4. Configurar las URLs de redirección para la URL pública de SHEBAND.
5. Copiar URL y publishable/anon key.
6. Copiar también la service role key SOLO a Render; nunca al navegador.

Supabase Auth soporta OTP por teléfono y proveedores sociales como Google; Apple se usa para acceso con Apple ID/iCloud. Ver documentación oficial:
https://supabase.com/docs/reference/javascript/auth-signinwithotp
https://supabase.com/docs/guides/auth/social-login/auth-google

## 2. Twilio

Crear un Messaging Service y un sender/number. Después cargar en Render:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_MESSAGING_SERVICE_SID`

El backend usa Twilio para mandar el SMS cuando se activa una emergencia y existen contactos con `notify_emergency=true` y teléfono en formato internacional `+54...`.

## 3. Render

Este proyecto está preparado para Docker.

- Runtime: Docker
- Dockerfile: `./Dockerfile`
- Root Directory: dejar vacío
- No usar `yarn` ni `npm` como Build Command si Render está en modo Docker.
- Crear las variables de entorno del `.env.example`.
- Deploy.

La aplicación escucha en `PORT` y expone `/health`.

## 4. Seguridad

Nunca subas `.env` real ni claves secretas al repositorio. La service role key de Supabase y las credenciales de Twilio son secretos de servidor.

## 5. Nota sobre emergencias

La web necesita permisos de ubicación y conexión a Internet para enviar la alerta al backend. Si el navegador no permite ubicación, la alerta puede registrarse sin coordenadas. Para una aplicación de producción conviene añadir notificaciones push nativas, pruebas de entrega y una política de privacidad específica.
