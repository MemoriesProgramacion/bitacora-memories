// Modo ver como, solo para quien tiene acceso total: permite mirar la Bitácora como la vería otro tipo de
// cuenta, y otro nodo si es de campo, para revisar permisos y pantallas. Es de solo lectura porque el servidor
// rechaza cualquier escritura mientras dura. Con la simulación activa sale una franja con el botón para volver.
import { useState } from 'react';
import { fetchApi } from '../lib/api';
import { API_BASE } from '../lib/config';
import { useSession } from '../hooks/useSession';
import { Btn } from './UI';
import { inputCls } from './FormPiezas';

const ROLES = [
  { rol: 'gestor', label: 'Gestor', conNodo: true },
  { rol: 'coordinador', label: 'Coordinador general' },
  { rol: 'coordinador_compras', label: 'Profesional alianzas y conexión de mercados' },
  { rol: 'coordinador_datos', label: 'Coordinador de datos' },
];

// Llama a la API de simulación para empezar o terminar el modo ver como.
const llamar = (cuerpo) => fetchApi(`${API_BASE}/auth/simular`, { metodo: 'POST', cuerpo });

// Muestra el selector para empezar la simulación y la franja con el botón para volver.
export default function VerComo({ nodos = [] }) {
  const { session, refrescar } = useSession();
  const [abierto, setAbierto] = useState(false);
  const [rol, setRol] = useState('gestor');
  const [nodo, setNodo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const def = ROLES.find((r) => r.rol === rol);

  async function ejecutar(cuerpo) {
    setOcupado(true);
    setError('');
    try {
      await llamar(cuerpo);
      await refrescar();
      setAbierto(false);
    } catch (e) {
      setError(e.respuesta || e.publicMsg || 'No se pudo cambiar la vista.');
    } finally {
      setOcupado(false);
    }
  }

  if (session?.rolReal === 'superadmin') {
    return (
      <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border t-warn px-3 py-2 text-[13px]">
        <span><b>Estás viendo la Bitácora como: {session.label}.</b> Es solo lectura: nada de lo que hagas se guarda.</span>
        <Btn className="!px-3 !py-1.5 !text-xs" disabled={ocupado} onClick={() => ejecutar({ rol: null })}>
          {ocupado ? 'Volviendo…' : 'Volver a superadmin'}
        </Btn>
      </div>
    );
  }
  if (session?.role !== 'superadmin') return null;

  return (
    <div className="mb-3">
      {!abierto ? (
        <button type="button" onClick={() => setAbierto(true)}
          className="text-[12.5px] font-semibold text-gris underline hover:text-marino">
          Ver como otro rol
        </button>
      ) : (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-borde bg-card p-3">
          <label className="flex w-full flex-col text-[11px] font-bold uppercase tracking-wide text-gris sm:w-auto">
            Rol
            <select value={rol} onChange={(e) => setRol(e.target.value)} className={`${inputCls} mt-1 !w-full sm:!w-auto`}>
              {ROLES.map((r) => <option key={r.rol} value={r.rol}>{r.label}</option>)}
            </select>
          </label>
          {def?.conNodo && (
            <label className="flex w-full flex-col text-[11px] font-bold uppercase tracking-wide text-gris sm:w-auto">
              Nodo
              <select value={nodo} onChange={(e) => setNodo(e.target.value)} className={`${inputCls} mt-1 !w-full sm:!w-auto`}>
                <option value="">Elige un nodo…</option>
                {nodos.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
          <Btn className="!py-2 !text-[13px]" disabled={ocupado || (def?.conNodo && !nodo)}
            onClick={() => ejecutar({ rol, ...(def?.conNodo ? { nodo } : {}) })}>
            {ocupado ? 'Cambiando…' : 'Ver como'}
          </Btn>
          <Btn variant="ghost" className="!py-2 !text-[13px]" onClick={() => setAbierto(false)}>Cancelar</Btn>
          {error && <p role="alert" className="w-full text-[12px] font-semibold text-rojo-txt">{error}</p>}
        </div>
      )}
    </div>
  );
}
