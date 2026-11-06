// Bienvenida, registro, inicio de sesión e invitaciones.

import * as cloud from './cloud.js';
import { APP_NAME, APP_TAGLINE } from './config.js';
import { $, esc, toast, actions, rerender } from './ui.js';

// Enlace de invitación: ?invite=usuario (se guarda hasta que la persona entra).
const inv = new URLSearchParams(location.search).get('invite');
if (inv) {
  sessionStorage.setItem('forja.invite', inv.toLowerCase());
  const url = new URL(location.href); url.searchParams.delete('invite');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}
const pendingInvite = () => sessionStorage.getItem('forja.invite');

let mode = 'welcome'; // welcome | signup | login | reset | confirm | username

// Logo oficial de Google (colores de marca) para el botón de inicio de sesión.
const GOOGLE_G = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.9 6.2C12.4 13.7 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.5 0 20.1 0 24s1 7.5 2.6 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/></svg>';
const googleBtn = (label = 'Continuar con Google') => `<button class="btn google big" data-act="google" type="button">${GOOGLE_G}<span>${label}</span></button>`;
let busy = false;

export function viewAuth() {
  const main = $('#main');
  const invite = pendingInvite();
  const head = `<section class="hero"><div class="logo">${APP_NAME}</div>`;
  if (cloud.needsUsername()) return viewUsername(head);
  if (mode === 'welcome') {
    main.innerHTML = `${head}
      <h1>${APP_TAGLINE.replace('. ', '.<br>')}</h1>
      ${invite ? `<p class="invite">💪 <b>@${esc(invite)}</b> te invitó a entrenar en ${APP_NAME}</p>` : ''}
    </section>
    <ul class="features">
      <li><b>Tu rutina, revisada</b><span>Arma la tuya o créala al instante. La app revisa que esté balanceada.</span></li>
      <li><b>Pesos sugeridos</b><span>Te dice cuánto peso poner y cuándo subirlo.</span></li>
      <li><b>Amigos</b><span>Mira sus entrenos y récords, y dales fuerzas.</span></li>
    </ul>
    ${googleBtn()}
    <div class="divider"><span>o con tu correo</span></div>
    <div class="row2">
      <button class="btn ghost" data-act="authMode" data-mode="signup">Crear cuenta</button>
      <button class="btn ghost" data-act="authMode" data-mode="login">Entrar</button>
    </div>
    <p class="muted small center">Al continuar aceptas la <a href="privacidad.html">política de privacidad</a>.</p>
    ${cloud.mockMode ? '<p class="demo-note"><b>Versión de prueba.</b> Las cuentas, los amigos y las respuestas del coach son simulados y todo se guarda solo en este celular.</p>' : ''}`;
    return;
  }
  if (mode === 'confirm') {
    main.innerHTML = `${head}<h1>Revisa tu correo</h1></section>
      <section class="card"><p>Te enviamos un enlace para confirmar tu cuenta. Ábrelo desde este celular y vuelve aquí.</p></section>
      <button class="btn primary big" data-act="authMode" data-mode="login">Ya confirmé, entrar</button>`;
    return;
  }
  const signup = mode === 'signup';
  const reset = mode === 'reset';
  main.innerHTML = `${head}<h1>${signup ? 'Crea tu cuenta' : reset ? 'Recuperar contraseña' : 'Bienvenido de vuelta'}</h1></section>
    ${reset ? '' : `${googleBtn(signup ? 'Registrarme con Google' : 'Entrar con Google')}<div class="divider"><span>o con tu correo</span></div>`}
    <form id="authf" class="card form" novalidate>
      ${signup ? `
      <label>Tu nombre<input name="displayName" autocomplete="name" maxlength="40" required placeholder="Juan Liévano"></label>
      <label>Nombre de usuario<input name="username" autocomplete="username" maxlength="20" required placeholder="juan_fit" pattern="[a-zA-Z0-9_]{3,20}" autocapitalize="none"></label>
      <p class="muted small" id="uhint">Así te encuentran tus amigos. Letras, números y _ (3 a 20).</p>` : ''}
      <label>Correo<input name="email" type="email" autocomplete="email" required placeholder="tu@correo.com" autocapitalize="none"></label>
      ${reset ? '' : `<label>Contraseña<input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="6" placeholder="Mínimo 6 caracteres"></label>`}
      <p class="formerr" id="aerr" hidden></p>
      <button class="btn primary big" type="submit">${signup ? 'Crear cuenta' : reset ? 'Enviar enlace' : 'Entrar'}</button>
      ${!signup && !reset ? '<button class="link" type="button" data-act="authMode" data-mode="reset">¿Olvidaste tu contraseña?</button>' : ''}
    </form>
    <button class="link center-block" data-act="authMode" data-mode="${signup ? 'login' : 'signup'}">${signup ? '¿Ya tienes cuenta? Entra' : '¿No tienes cuenta? Créala'}</button>
    <button class="link center-block" data-act="authMode" data-mode="welcome">← Volver</button>`;

  const form = $('#authf');
  const err = (m) => { const e = $('#aerr'); e.textContent = m; e.hidden = !m; };
  form.addEventListener('input', () => err(''));
  if (signup) {
    form.username.addEventListener('blur', async () => {
      const u = form.username.value.trim();
      if (!u) return;
      const hint = $('#uhint');
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(u)) { hint.textContent = 'Usa 3 a 20 letras, números o _.'; hint.className = 'small warn'; return; }
      try {
        const ok = await cloud.usernameAvailable(u);
        hint.textContent = ok ? `@${u.toLowerCase()} está disponible` : `@${u.toLowerCase()} ya está en uso`;
        hint.className = `small ${ok ? 'good' : 'warn'}`;
      } catch {}
    });
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const f = Object.fromEntries(new FormData(form));
    f.email = (f.email || '').trim();
    if (!/^\S+@\S+\.\S+$/.test(f.email)) return err('Escribe un correo válido.');
    if (!reset && (f.password || '').length < 6) return err('La contraseña debe tener al menos 6 caracteres.');
    if (signup) {
      f.username = (f.username || '').trim();
      f.displayName = (f.displayName || '').trim();
      if (!f.displayName) return err('Escribe tu nombre.');
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(f.username)) return err('El usuario debe tener 3 a 20 letras, números o _.');
    }
    busy = true;
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Un momento…';
    try {
      if (reset) {
        await cloud.resetPassword(f.email);
        toast('Te enviamos un enlace para cambiar la contraseña');
        mode = 'login'; viewAuth();
      } else if (signup) {
        if (!(await cloud.usernameAvailable(f.username))) throw new Error(`@${f.username.toLowerCase()} ya está en uso. Prueba otro.`);
        const r = await cloud.signUp(f);
        if (r.needsConfirm) { mode = 'confirm'; viewAuth(); }
        else await enter();
      } else {
        await cloud.signIn(f);
        await enter();
      }
    } catch (ex) {
      err(ex.message || 'Algo salió mal.');
      btn.disabled = false; btn.textContent = signup ? 'Crear cuenta' : reset ? 'Enviar enlace' : 'Entrar';
    } finally { busy = false; }
  });
}

function viewUsername(head) {
  const main = $('#main');
  const me = cloud.me || {};
  main.innerHTML = `${head}<h1>Elige tu @usuario</h1>
      <p class="muted">Así te encuentran tus amigos en ${APP_NAME}. Puedes dejar el que te sugerimos.</p></section>
    <form id="userf" class="card form" novalidate>
      <label>Tu nombre<input name="displayName" maxlength="40" required value="${esc(me.display_name || '')}" autocomplete="name"></label>
      <label>Nombre de usuario<input name="username" maxlength="20" required value="${esc(me.username || '')}" autocapitalize="none" autocomplete="username"></label>
      <p class="muted small" id="uhint">Letras, números y _ (3 a 20).</p>
      <p class="formerr" id="aerr" hidden></p>
      <button class="btn primary big" type="submit">Continuar</button>
    </form>
    <button class="link center-block" data-act="logout">Usar otra cuenta</button>`;
  const form = $('#userf');
  const err = (m) => { const e = $('#aerr'); e.textContent = m; e.hidden = !m; };
  form.addEventListener('input', () => err(''));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const username = form.username.value.trim();
    const displayName = form.displayName.value.trim();
    if (!displayName) return err('Escribe tu nombre.');
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return err('El usuario debe tener 3 a 20 letras, números o _.');
    busy = true;
    try {
      if (username.toLowerCase() !== me.username && !(await cloud.usernameAvailable(username))) throw new Error(`@${username.toLowerCase()} ya está en uso. Prueba otro.`);
      await cloud.confirmUsername(username, displayName);
      await enter();
    } catch (ex) { err(ex.message); } finally { busy = false; }
  });
}

async function enter() {
  const { afterLogin } = await import('./app.js');
  await afterLogin();
  mode = 'welcome';
  location.hash = 'hoy';
  rerender();
}

// Tras entrar: si llegó con invitación, envía la solicitud de amistad automáticamente.
export async function consumeInvite() {
  const u = pendingInvite();
  if (!u || !cloud.user) return;
  sessionStorage.removeItem('forja.invite');
  if (u === cloud.me?.username) return;
  try {
    const other = await cloud.findUser(u);
    if (!other) return;
    await cloud.requestFriend(other.id);
    toast(`Solicitud de amistad enviada a @${u}`);
  } catch (e) {
    if (!/ya hay una solicitud/i.test(e.message)) console.warn(e);
  }
}

Object.assign(actions, {
  authMode: (el) => { mode = el.dataset.mode; viewAuth(); },
  google: async (el) => {
    if (busy) return;
    busy = true;
    el.disabled = true;
    el.querySelector('span').textContent = 'Abriendo Google…';
    try {
      const u = await cloud.signInWithGoogle(); // en la app real la página se va a Google y vuelve con la sesión
      if (u) await enter();
    } catch (ex) {
      toast(ex.message);
      el.disabled = false; el.querySelector('span').textContent = 'Continuar con Google';
    } finally { busy = false; }
  },
});
