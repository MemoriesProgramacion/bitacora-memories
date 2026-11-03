// Rutas de ingreso bajo /api/auth: login único para ambos programas, cierre de sesión, token CSRF, consulta de
// sesión, cambio de clave y modo de vista de otro perfil. La cuenta que acierta con la clave define qué módulos
// se abren.
import { Router } from 'express';
import { pool } from '../db.js';
import { config, modulosDeRol } from '../config.js';
import { ok, error, cuerpo, texto } from '../inventario/util.js';
import {
  hashClave, validarClaveNueva, gastarTiempoDeVerificacion, CLAVE_MAX,
} from './clave.js';
import {
  buscarPorUsuario, claveCorrecta, cuentaDeSesion, fijarClave, auditarClave, leerCuenta,
} from './cuentas.js';
import {
  csrfToken, iniciarSesion, cerrarSesion, cerrarSesionesDe, registrarEvento, perfilPublico,
} from './sesiones.js';
import { limitador, ipBloqueada, registrarFalloIp, limpiarFallosIp } from './limites.js';
import { captchaActivo, verificarCaptcha } from './captcha.js';

const router = Router();

const MAX_FALLOS = 5;
const BLOQUEO_MIN = 15;

// Mensaje único para cualquier fallo de ingreso, para no revelar si el usuario existe.
const MSG_LOGIN = `Usuario o contraseña incorrectos. Tras ${MAX_FALLOS} fallos seguidos el usuario se bloquea ${BLOQUEO_MIN} minutos.`;

// Indica si el usuario está bloqueado temporalmente por fallos seguidos.
async function estaBloqueado(usuario) {
  const { rows } = await pool.query(
    'SELECT 1 FROM intentos_login WHERE usuario = $1 AND bloqueado_hasta > now()',
    [usuario],
  );
  return rows.length > 0;
}

// Suma un fallo al usuario y devuelve true si con este quedó bloqueado.
async function sumarFallo(usuario) {
  const { rows: [r] } = await pool.query(
    `INSERT INTO intentos_login (usuario, fallos, ultimo) VALUES ($1, 1, now())
     ON CONFLICT (usuario) DO UPDATE
       SET fallos = CASE WHEN intentos_login.fallos + 1 >= $2 THEN 0 ELSE intentos_login.fallos + 1 END,
           bloqueado_hasta = CASE WHEN intentos_login.fallos + 1 >= $2
                                  THEN now() + make_interval(mins => $3)
                                  ELSE intentos_login.bloqueado_hasta END,
           ultimo = now()
     RETURNING (bloqueado_hasta IS NOT NULL AND bloqueado_hasta > now()) AS bloqueado`,
    [usuario, MAX_FALLOS, BLOQUEO_MIN],
  );
  return Boolean(r?.bloqueado);
}

// Entrega el token CSRF que el frontend envía en cada petición de escritura.
router.get('/csrf', async (req, res) => ok(res, null, { token: await csrfToken(req, res) }));

const ROLES_SIMULABLES = ['gestor', 'coordinador', 'coordinador_compras', 'coordinador_datos'];
// Permite al usuario con acceso total ver la Bitácora como otro perfil, en solo lectura.
// Cambio de clave del propio usuario con límite de intentos.
router.post('/simular', async (req, res) => {
  const cuenta = req.sesion?.cuenta;
  if (!cuenta) return error(res, 'Debes iniciar sesión.', 401, { sesion: false });
  if (cuenta.rol !== 'superadmin') {
    registrarEvento(req, 'acceso_denegado', { exito: false, detalle: 'simular' });
    return error(res, 'Solo el superadmin puede usar «Ver como».', 403);
  }
  const datos = cuerpo(req);
  if (datos.rol === null || datos.rol === undefined || datos.rol === '') {
    await pool.query("UPDATE sesiones_app SET perfil = coalesce(perfil, '{}'::jsonb) - 'sim' WHERE id_hash = $1", [req.sesion.hash]);
    registrarEvento(req, 'simulacion_fin');
    return ok(res, 'Vuelves a ser superadmin.');
  }
  if (!ROLES_SIMULABLES.includes(datos.rol)) return error(res, 'Ese rol no se puede simular.');
  let nodo = null;
  if (datos.rol === 'gestor') {
    nodo = texto(datos.nodo).toUpperCase();
    const { rows } = await pool.query('SELECT 1 FROM triadas WHERE upper(nodo) = $1 LIMIT 1', [nodo]);
    if (!nodo || !rows.length) return error(res, 'Ese nodo no existe.');
  }
  await pool.query("UPDATE sesiones_app SET perfil = coalesce(perfil, '{}'::jsonb) || jsonb_build_object('sim', $2::jsonb) WHERE id_hash = $1",
    [req.sesion.hash, JSON.stringify({ rol: datos.rol, nodo })]);
  registrarEvento(req, 'simulacion_inicio', { detalle: `${datos.rol}${nodo ? ` · ${nodo}` : ''}` });
  return ok(res, 'Ahora ves la Bitácora como ese rol, solo lectura.');
});

// Devuelve quién está conectado, o null si no hay sesión.
router.get('/sesion', async (req, res) => {
  const token = await csrfToken(req, res);
  ok(res, null, { sesion: perfilPublico(req.sesion?.cuenta), empresa: config.empresa, token });
});

// Valida usuario, clave y verificación humana, y abre la sesión.
router.post('/login', async (req, res) => {
  if (await ipBloqueada(req)) {
    registrarEvento(req, 'login_bloqueado_ip', { exito: false });
    return error(res, 'Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.', 429);
  }

  const datos = cuerpo(req);
  const usuario = texto(datos.usuario).toLowerCase();
  const clave = typeof datos.clave === 'string' ? datos.clave : '';

  if (captchaActivo() && !(await verificarCaptcha(datos.captcha, req.ip))) {
    await registrarFalloIp(req);
    registrarEvento(req, 'login_fallo', { exito: false, usuarioTexto: usuario, detalle: 'verificación humana fallida' });
    return error(res, 'No se pudo confirmar la verificación de seguridad. Complétala de nuevo.', 401);
  }

  if (!usuario || usuario.length > 100 || !clave || clave.length > CLAVE_MAX) {
    await gastarTiempoDeVerificacion(clave);
    await registrarFalloIp(req);
    registrarEvento(req, 'login_fallo', { exito: false, usuarioTexto: usuario, detalle: 'datos inválidos' });
    return error(res, MSG_LOGIN, 401);
  }

  const candidatas = await buscarPorUsuario(usuario);
  if (!candidatas.length) {
    await gastarTiempoDeVerificacion(clave);
    await registrarFalloIp(req);
    if (await sumarFallo(usuario)) {
      registrarEvento(req, 'usuario_bloqueado', { exito: false, usuarioTexto: usuario, detalle: `bloqueo de ${BLOQUEO_MIN} min` });
    } else {
      registrarEvento(req, 'login_fallo', { exito: false, usuarioTexto: usuario, detalle: 'usuario inexistente' });
    }
    return error(res, MSG_LOGIN, 401);
  }

  let acertada = null;
  for (const c of candidatas) {
    if (await claveCorrecta(c, clave) && !acertada) acertada = c;
  }
  const bloqueado = await estaBloqueado(usuario);

  if (bloqueado) {
    await registrarFalloIp(req);
    registrarEvento(req, 'login_usuario_bloqueado', { exito: false, usuarioTexto: usuario });
    return error(res, MSG_LOGIN, 401);
  }

  if (!acertada) {
    await registrarFalloIp(req);
    const ahoraBloqueado = await sumarFallo(usuario);
    registrarEvento(req, ahoraBloqueado ? 'usuario_bloqueado' : 'login_fallo', {
      exito: false, usuarioTexto: usuario, origen: candidatas[0].origen, cuentaId: candidatas[0].id,
      rol: candidatas[0].rol,
      detalle: ahoraBloqueado ? `bloqueo de ${BLOQUEO_MIN} min por fallos seguidos` : 'clave incorrecta',
    });
    return error(res, MSG_LOGIN, 401);
  }

  if (!acertada.activo) {
    registrarEvento(req, 'login_fallo', {
      exito: false, usuarioTexto: usuario, origen: acertada.origen, cuentaId: acertada.id,
      rol: acertada.rol, detalle: 'usuario desactivado',
    });
    return error(res, 'Ese usuario está desactivado. Habla con el administrador.', 403);
  }

  await limpiarFallosIp(req);
  await pool.query('DELETE FROM intentos_login WHERE usuario = $1', [usuario]);
  await iniciarSesion(req, res, cuentaDeSesion(acertada));
  registrarEvento(req, 'login_ok', {
    usuarioTexto: acertada.usuario, origen: acertada.origen, cuentaId: acertada.id, rol: acertada.rol,
  });

  return ok(res, null, {
    sesion: perfilPublico(req.sesion.cuenta),
    token: req.sesion.csrf,
    cambiar_clave: acertada.cambiarClave,
  });
});

// Cierra la sesión; solo acepta POST con token CSRF.
router.post('/logout', async (req, res) => {
  if (req.sesion?.cuenta) registrarEvento(req, 'logout');
  await cerrarSesion(req, res);
  ok(res, 'Sesión cerrada.', { token: await csrfToken(req, res) });
});

router.post(
  '/cambiar-clave',
  limitador({
    ventanaMs: 15 * 60_000, max: 10, tipo: 'limite_cambio_clave',
    mensaje: 'Demasiados intentos de cambio de clave. Espera unos minutos.',
    clave: (req) => `c${req.sesion?.cuenta?.origen}:${req.sesion?.cuenta?.id ?? req.ip}`,
  }),
  async (req, res) => {
    const sesionActual = req.sesion?.cuenta;
    if (!sesionActual) return error(res, 'Debes iniciar sesión.', 401, { sesion: false });

    const datos = cuerpo(req);
    const actual = typeof datos.actual === 'string' ? datos.actual : '';
    const nueva = typeof datos.nueva === 'string' ? datos.nueva : '';
    const repetir = typeof datos.repetir === 'string' ? datos.repetir : '';

    const cuenta = await leerCuenta(sesionActual.origen, sesionActual.id);
    if (!cuenta) return error(res, 'La cuenta ya no existe.', 404);
    if (actual.length > CLAVE_MAX || !(await claveCorrecta(cuenta, actual))) {
      registrarEvento(req, 'cambio_clave_fallo', { exito: false, detalle: 'clave actual incorrecta' });
      return error(res, 'La clave actual no es correcta.');
    }
    const motivo = validarClaveNueva(nueva, { usuario: cuenta.usuario });
    if (motivo) return error(res, motivo);
    if (nueva !== repetir) return error(res, 'Las dos claves nuevas no coinciden.');
    if (nueva === actual) return error(res, 'La clave nueva debe ser distinta de la actual.');

    await fijarClave(cuenta.origen, cuenta.id, await hashClave(nueva));
    await auditarClave(cuenta, 'cambio_propio', cuenta.usuario);

    await cerrarSesionesDe(cuenta.origen, cuenta.id);
    await iniciarSesion(req, res, cuentaDeSesion({ ...cuenta, cambiarClave: false }));
    registrarEvento(req, 'cambio_clave');
    return ok(res, 'Clave actualizada.', { sesion: perfilPublico(req.sesion.cuenta), token: req.sesion.csrf });
  },
);

export default router;

export { modulosDeRol };
