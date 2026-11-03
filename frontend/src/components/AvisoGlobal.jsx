// Avisos que se publican para todos los usuarios y franja del modo mantenimiento. Se consultan en GET
// /api/config al entrar y cada 5 minutos; el servidor ya devuelve solo los vigentes y, si la consulta falla, no
// se muestra nada.
import { useCallback, useEffect, useState } from 'react';
import { fetchApi } from '../lib/api';
import { CONFIG_URL } from '../lib/config';

const CADA_MS = 5 * 60 * 1000;
const CLAVE_CERRADOS = 'bitacora_avisos_cerrados';

// Colores de la franja para el tema claro y oscuro; las clases están en index.css.
const TONOS = {
  info: 't-info',
  alerta: 't-warn',
  urgente: 't-bad',
  mantenimiento: 'border-marino bg-marino text-white',
};

// Lee los avisos que el usuario cerró, que se recuerdan solo en esta pestaña.
function leerCerrados() {
  try { return JSON.parse(sessionStorage.getItem(CLAVE_CERRADOS)) || []; } catch { return []; }
}
// Guarda los avisos cerrados en la pestaña.
function guardarCerrados(ids) {
  try { sessionStorage.setItem(CLAVE_CERRADOS, JSON.stringify(ids)); } catch { }
}

// Muestra un aviso como franja con su botón para cerrarlo.
function Franja({ tono, icono, texto, onCerrar }) {
  return (
    <div className={`border-b ${TONOS[tono] || TONOS.info}`} role="status">
      <div className="mx-auto flex max-w-5xl items-start gap-2.5 px-4 py-2 text-[13px] sm:px-5">
        <svg className="mt-0.5 shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          {icono === 'alerta'
            ? <><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v4M12 17.5v.5" /></>
            : <><circle cx="12" cy="12" r="10" /><path d="M12 11v6M12 7.5v.5" /></>}
        </svg>
        <p className="min-w-0 flex-1">{texto}</p>
        {onCerrar && (
          <button type="button" onClick={onCerrar} aria-label="Ocultar aviso" className="shrink-0 text-xs font-semibold underline underline-offset-2 hover:no-underline">
            Ocultar
          </button>
        )}
      </div>
    </div>
  );
}

// Muestra un solo aviso sin consultar el servidor, para la vista previa del formulario.
export function AvisoVistaPrevia({ aviso }) {
  if (!aviso) return null;
  return <Franja tono={aviso.nivel} icono={aviso.nivel === 'info' ? 'info' : 'alerta'} texto={aviso.texto} />;
}

// Consulta los avisos periódicamente y los muestra.
export default function AvisoGlobal({ session }) {
  const [config, setConfig] = useState(null);
  const [cerrados, setCerrados] = useState(leerCerrados);

  const actualizar = useCallback(async () => {
    try {
      setConfig(await fetchApi(CONFIG_URL, { token: session?.token }));
    } catch (err) {
      console.warn('[bitacora] No se pudieron leer los avisos', err?.code, err?.detail);
    }
  }, [session?.token]);

  useEffect(() => {
    actualizar();
    const id = setInterval(() => { if (!document.hidden) actualizar(); }, CADA_MS);
    return () => clearInterval(id);
  }, [actualizar]);

  const cerrar = (id) => {
    const nuevos = [...cerrados, id];
    setCerrados(nuevos);
    guardarCerrados(nuevos);
  };

  if (!config) return null;
  const avisos = (config.avisos || []).filter((a) => a?.texto && !cerrados.includes(a.id));

  return (
    <>
      {config.mantenimiento && (
        <Franja tono="mantenimiento" icono="alerta"
          texto={config.mantenimiento_texto || 'La app está en mantenimiento: puedes consultar, pero no guardar.'} />
      )}
      {avisos.map((a) => (
        <Franja key={a.id} tono={a.nivel} icono={a.nivel === 'info' ? 'info' : 'alerta'}
          texto={a.texto} onCerrar={() => cerrar(a.id)} />
      ))}
    </>
  );
}
