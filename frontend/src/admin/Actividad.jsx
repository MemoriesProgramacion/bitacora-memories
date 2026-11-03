// Pantalla de actividad: cada cambio importante que hace alguien en la Bitácora, con quién, cuándo, sobre qué y
// qué cambió. Los filtros los aplica el servidor y la lista crece con el botón de ver más antiguos, que usa el
// id como cursor.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, RefreshCw, Search } from 'lucide-react';
import {
  Boton, Cargando, Celda, Entrada, Fila, Insignia, Seleccion, Tabla, Tarjeta, useAvisos,
} from '../inventario/componentes/ui';
import Encabezado from '../inventario/componentes/Encabezado';
import { admin } from './apiAdmin';
import { ROLES_ACTIVIDAD, fechaHora, nombreRol } from './etiquetas';
import { MODULOS as NOMBRES_MODULOS } from '../lib/historial';

const PASO = 100;

// Módulos que registran actividad; el servidor filtra la acción por prefijo.
const MODULOS = Object.entries(NOMBRES_MODULOS).map(([p, t]) => [`${p}.`, t]).sort((a, b) => a[1].localeCompare(b[1], 'es'));

const RESULTADOS = {
  ok: { tono: 'ok', texto: 'Guardado' },
  rechazado: { tono: 'alerta', texto: 'Rechazado' },
  error: { tono: 'error', texto: 'Error' },
};

const vacio = (v) => v === null || v === undefined || v === '';
const valor = (v) => (vacio(v) ? '(vacío)' : typeof v === 'object' ? JSON.stringify(v) : String(v));

// Convierte los campos cambiados, con su antes y después, y otros datos sueltos en líneas para mostrar.
function lineas(cambios = {}) {
  const salida = [];
  Object.entries(cambios.campos || {}).forEach(([campo, par]) => {
    salida.push(`${campo}: ${Array.isArray(par) ? `${valor(par[0])} → ${valor(par[1])}` : valor(par)}`);
  });
  Object.entries(cambios).forEach(([k, v]) => {
    if (k !== 'campos') salida.push(`${k}: ${valor(v)}`);
  });
  return salida;
}

// Muestra la lista de actividad con sus filtros.
export default function Actividad() {
  const { avisar } = useAvisos();
  const [filtros, setFiltros] = useState({ quien: '', rol: '', accion: '', resultado: '' });
  const [quienEscrito, setQuienEscrito] = useState('');
  const [items, setItems] = useState(null);
  const [siguiente, setSiguiente] = useState(null);
  const [cargando, setCargando] = useState(false);
  const pedido = useRef(0);

  const cargar = useCallback(async (antes = null) => {
    const mio = ++pedido.current;
    setCargando(true);
    try {
      const r = await admin.actividad({ ...filtros, limite: PASO, ...(antes ? { antes } : {}) });
      if (mio !== pedido.current) return;
      setItems((prev) => (antes && prev ? [...prev, ...r.items] : r.items));
      setSiguiente(r.siguiente);
    } catch (err) {
      if (mio === pedido.current) avisar(err.message, 'error');
    } finally {
      if (mio === pedido.current) setCargando(false);
    }
  }, [filtros, avisar]);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    const t = setTimeout(() => setFiltros((f) => (f.quien === quienEscrito ? f : { ...f, quien: quienEscrito })), 400);
    return () => clearTimeout(t);
  }, [quienEscrito]);

  const cambiar = (campo) => (e) => setFiltros((f) => ({ ...f, [campo]: e.target.value }));

  return (
    <>
      <Encabezado
        titulo="Actividad"
        descripcion="Los cambios que hacen las personas en la Bitácora: quién, cuándo, sobre qué y qué cambió. Los ingresos están en «Inicios de sesión»."
      >
        <Boton variante="fantasma" icono={RefreshCw} cargando={cargando} onClick={() => cargar()}>Actualizar</Boton>
      </Encabezado>

      <Tarjeta className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="relative">
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-gris" />
            <Entrada className="pl-10" placeholder="Nombre de quien lo hizo" aria-label="Buscar por nombre"
              value={quienEscrito} onChange={(e) => setQuienEscrito(e.target.value)} />
          </div>
          <Seleccion value={filtros.accion} onChange={cambiar('accion')} aria-label="Módulo">
            <option value="">Todos los módulos</option>
            {MODULOS.map(([p, t]) => <option key={p} value={p}>{t}</option>)}
          </Seleccion>
          <Seleccion value={filtros.resultado} onChange={cambiar('resultado')} aria-label="Resultado">
            <option value="">Cualquier resultado</option>
            {Object.entries(RESULTADOS).map(([k, v]) => <option key={k} value={k}>{v.texto}</option>)}
          </Seleccion>
          <Seleccion value={filtros.rol} onChange={cambiar('rol')} aria-label="Rol">
            <option value="">Todos los roles</option>
            {Object.entries(ROLES_ACTIVIDAD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Seleccion>
        </div>
      </Tarjeta>

      <Tarjeta>
        {!items ? <Cargando /> : (
          <Tabla
            iconoVacio={Activity}
            vacio="Todavía no hay actividad con esos filtros."
            cabeceras={['Fecha', 'Quién', 'Acción', 'Resultado', 'Cambios']}
          >
            {items.map((it) => {
              const r = RESULTADOS[it.resultado] || RESULTADOS.error;
              const q = it.quien || {};
              return (
                <Fila key={it.id}>
                  <Celda className="whitespace-nowrap text-[13px]">{fechaHora(it.fecha)}</Celda>
                  <Celda className="text-[13px]">
                    <div className="font-semibold text-marca">{q.nombre || '—'}</div>
                    <div className="text-[12px] text-gris-txt">{[nombreRol(q.rol), q.nodo].filter(Boolean).join(' · ') || '—'}</div>
                  </Celda>
                  <Celda className="text-[13px]">
                    <div className="font-mono text-[12px]">{it.accion}</div>
                    {it.objeto?.id && <div className="text-[12px] text-gris-txt">{it.objeto.tipo} {it.objeto.id}</div>}
                  </Celda>
                  <Celda><Insignia tono={r.tono}>{r.texto}</Insignia></Celda>
                  <Celda className="text-[12px] text-gris-txt [overflow-wrap:anywhere]">
                    {lineas(it.cambios).map((l) => <div key={l}>{l}</div>)}
                  </Celda>
                </Fila>
              );
            })}
          </Tabla>
        )}
        {items && siguiente && (
          <div className="mt-4 text-center">
            <Boton variante="fantasma" cargando={cargando} onClick={() => cargar(siguiente)}>Ver más antiguos</Boton>
          </div>
        )}
      </Tarjeta>
    </>
  );
}
