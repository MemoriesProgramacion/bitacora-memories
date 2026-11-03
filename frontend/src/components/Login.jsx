// Formulario del ingreso único, el mismo para la Bitácora, el inventario y la administración. El servidor
// reconoce el usuario y decide qué se abre.
import { useState } from 'react';
import { Eye, EyeOff, Moon, Sun, TriangleAlert } from 'lucide-react';
import { FondoIngreso } from './FondoAnimado';
import VerificacionHumana, { TURNSTILE_SITE_KEY } from './VerificacionHumana';
import { alternarTema, useTema } from '../lib/tema';
import economiaPopularImg from '../assets/economia-popular.png';
import './Login.css';

// Muestra el formulario de usuario, clave y verificación humana, y envía el ingreso.
export default function Login({ onLogin, error, verificando }) {
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [captcha, setCaptcha] = useState(null);
  const [llaveCaptcha, setLlaveCaptcha] = useState(0);
  const [errores, setErrores] = useState({});
  const tema = useTema();

  async function submit(e) {
    e.preventDefault();
    const faltan = {};
    if (!usuario.trim()) faltan.usuario = 'Ingresa tu usuario.';
    if (!clave) faltan.clave = 'Ingresa tu contraseña.';
    if (TURNSTILE_SITE_KEY && !captcha) faltan.captcha = 'Completa la verificación de seguridad.';
    setErrores(faltan);
    if (Object.keys(faltan).length) return;

    const sesion = await onLogin(usuario, clave, captcha);
    if (!sesion) {
      setClave('');
      setCaptcha(null);
      setLlaveCaptcha((n) => n + 1);
    }
  }

  const textoTema = tema === 'oscuro' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';

  return (
    <div className="login-shell">
      <FondoIngreso />

      <div className="login-card animate-entrar">
        <aside className="login-panel">
          <div className="login-panel__intro">
            <span className="login-panel__mark">
              <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
                <path d="M16 3l11 5v7c0 7.2-4.8 11.4-11 13-6.2-1.6-11-5.8-11-13V8l11-5z" fill="var(--lg-accent)" />
                <path d="M16 6.3l7.5 3.4v5c0 5.1-3.4 8.1-7.5 9.3-4.1-1.2-7.5-4.2-7.5-9.3v-5L16 6.3z" fill="var(--lg-navy-900)" />
              </svg>
              Memories
            </span>
            <h2 className="login-panel__title">Bitácora Memories</h2>
            <p className="login-panel__text">
              Plataforma de seguimiento y acompañamiento de la Fundación Memories.
            </p>
          </div>
          <div className="login-panel__imageWrap">
            <img
              src={economiaPopularImg}
              alt="Bitácora Memories - Fundación Memories"
              className="login-panel__image"
            />
          </div>
        </aside>

        <div className="login-form-panel">
          <div className="login-form-panel__header">
            <button type="button" className="login-tema" onClick={alternarTema} aria-label={textoTema} title={textoTema}>
              {tema === 'oscuro' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
            </button>
          </div>

          <div className="login-form-panel__body">
            <h1 className="login-title">Iniciar sesión</h1>
            <p className="login-subtitle">Ingresa tus credenciales para continuar.</p>

            <form className="login-form" onSubmit={submit} autoComplete="on" noValidate>
              <div className="login-field">
                <label htmlFor="login-user" className="login-field__label">Usuario</label>
                <input
                  id="login-user"
                  name="usuario"
                  type="text"
                  value={usuario}
                  onChange={(e) => setUsuario(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                  maxLength={100}
                  disabled={verificando}
                  aria-invalid={Boolean(errores.usuario)}
                  className="login-field__input"
                />
                {errores.usuario && <p className="login-field__error" role="alert">{errores.usuario}</p>}
              </div>

              <div className="login-field">
                <label htmlFor="login-pass" className="login-field__label">Contraseña</label>
                <div className="login-field__control">
                  <input
                    id="login-pass"
                    name="clave"
                    type={verClave ? 'text' : 'password'}
                    value={clave}
                    onChange={(e) => setClave(e.target.value)}
                    autoComplete="current-password"
                    maxLength={128}
                    disabled={verificando}
                    aria-invalid={Boolean(errores.clave)}
                    className="login-field__input login-field__input--con-boton"
                  />
                  <button
                    type="button"
                    className="login-ojo"
                    onClick={() => setVerClave((v) => !v)}
                    aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    aria-pressed={verClave}
                  >
                    {verClave ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                  </button>
                </div>
                {errores.clave && <p className="login-field__error" role="alert">{errores.clave}</p>}
              </div>

              {TURNSTILE_SITE_KEY && (
                <div className="login-form__captcha">
                  <VerificacionHumana
                    key={llaveCaptcha}
                    onVerificar={(token) => {
                      setCaptcha(token);
                      setErrores((prev) => ({ ...prev, captcha: undefined }));
                    }}
                    onVencer={() => setCaptcha(null)}
                  />
                  {errores.captcha && <p className="login-field__error" role="alert">{errores.captcha}</p>}
                </div>
              )}

              {error && (
                <div role="alert" className="login-alerta">
                  <TriangleAlert size={18} aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              <button type="submit" className="login-submit" disabled={verificando}>
                {verificando ? 'Iniciando sesión…' : 'Iniciar sesión'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
