// Cambio de clave del propio usuario. Sirve para cualquier tipo de cuenta: el servidor sabe en qué tabla está y
// cierra sus otras sesiones al guardar.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Circle, ShieldCheck } from 'lucide-react';
import { useSession, rutaInicial } from '../hooks/useSession';
import { apiGeneral } from '../inventario/lib/api';
import MarcoApp from '../components/MarcoApp';
import Encabezado from '../inventario/componentes/Encabezado';
import { Boton, Campo, EntradaClave, Tarjeta, useAvisos } from '../inventario/componentes/ui';

// Largo mínimo de la clave, que el servidor exige igual.
const MIN = 12;

// Muestra el formulario de clave actual y nueva y envía el cambio.
export default function CambiarClavePage() {
  const { session, logout, refrescar } = useSession();
  const { avisar } = useAvisos();
  const navegar = useNavigate();
  const [datos, setDatos] = useState({ actual: '', nueva: '', repetir: '' });
  const [enviando, setEnviando] = useState(false);

  const obligatorio = Boolean(session?.cambiarClave);

  const enviar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await apiGeneral.post('/auth/cambiar-clave', datos);
      avisar(r.mensaje || 'Clave actualizada.');
      await refrescar();
      navegar(rutaInicial(session), { replace: true });
    } catch (err) {
      avisar(err.message, 'error');
    } finally {
      setEnviando(false);
    }
  };

  const campo = (clave) => ({
    value: datos[clave],
    onChange: (e) => setDatos({ ...datos, [clave]: e.target.value }),
  });

  const requisitos = [
    { ok: datos.nueva.length >= MIN, texto: `Al menos ${MIN} caracteres` },
    { ok: datos.nueva.length > 0 && datos.nueva === datos.repetir, texto: 'Las dos claves nuevas coinciden' },
    { ok: datos.nueva.length > 0 && datos.nueva !== datos.actual, texto: 'Es distinta de la clave actual' },
  ];

  return (
    <MarcoApp
      clave="cuenta"
      session={session}
      titulo="Mi cuenta"
      subtitulo="Seguridad de tu acceso"
      onLogout={logout}
    >
      <div className="mx-auto max-w-lg">
        <Encabezado
          titulo="Cambiar clave"
          descripcion={
            obligatorio
              ? 'Debes cambiar tu clave antes de usar el sistema.'
              : `La clave nueva debe tener al menos ${MIN} caracteres.`
          }
        />
        <Tarjeta>
          <form onSubmit={enviar} className="flex flex-col gap-4">
            <Campo etiqueta="Clave actual">
              <EntradaClave autoComplete="current-password" required maxLength={128} {...campo('actual')} />
            </Campo>
            <Campo
              etiqueta="Clave nueva"
              ayuda="Una frase larga es mejor que una palabra con símbolos. Evita claves comunes y tu nombre de usuario."
            >
              <EntradaClave autoComplete="new-password" required minLength={MIN} maxLength={128} {...campo('nueva')} />
            </Campo>
            <Campo etiqueta="Repetir clave nueva">
              <EntradaClave autoComplete="new-password" required minLength={MIN} maxLength={128} {...campo('repetir')} />
            </Campo>

            <ul className="flex flex-col gap-1.5 rounded-xl bg-lienzo px-3.5 py-3" aria-label="Requisitos de la clave">
              {requisitos.map((r) => (
                <li
                  key={r.texto}
                  className={`flex items-center gap-2 text-[13px] transition-colors duration-200 ${
                    r.ok ? 'text-ok-txt' : 'text-gris-txt'
                  }`}
                >
                  {r.ok ? (
                    <Check size={15} aria-hidden="true" className="shrink-0" />
                  ) : (
                    <Circle size={15} aria-hidden="true" className="shrink-0" />
                  )}
                  {r.texto}
                  <span className="sr-only">{r.ok ? ', cumplido' : ', pendiente'}</span>
                </li>
              ))}
            </ul>

            <Boton tipo="submit" icono={ShieldCheck} cargando={enviando} className="mt-1">
              {enviando ? 'Guardando…' : 'Guardar clave'}
            </Boton>
            <p className="text-center text-[12px] text-gris-txt">
              Al cambiarla se cierran tus otras sesiones abiertas.
            </p>
          </form>
        </Tarjeta>
      </div>
    </MarcoApp>
  );
}
