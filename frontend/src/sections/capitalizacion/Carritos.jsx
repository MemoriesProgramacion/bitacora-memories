// Tablero de seguimiento de todos los carritos con su estado, cuánto suman y cuánto de su presupuesto llevan.
// Desde aquí se abre el carrito de cualquier iniciativa.
import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, ShoppingCart, Wallet } from 'lucide-react';
import { apiGeneral, pesos } from '../../inventario/lib/api';
import {
  Boton, Cargando, Celda, Fila, Indicador, Insignia, Tabla, Tarjeta, useAvisos,
} from '../../inventario/componentes/ui';
import { MiniBarra } from '../../inventario/componentes/Graficas';
import { APROBADOS, ESTADOS_CARRITO } from '../../lib/carrito';

// Muestra el tablero con las gráficas y la lista de carritos.
export default function Carritos({ filas, onAbrir }) {
  const { avisar } = useAvisos();
  const [items, setItems] = useState(null);
  const [estado, setEstado] = useState('');

  useEffect(() => {
    let vigente = true;
    apiGeneral.get('/carritos')
      .then((r) => { if (vigente) setItems(r.items); })
      .catch((err) => { if (vigente) { avisar(err.message, 'error'); setItems([]); } });
    return () => { vigente = false; };
  }, [avisar]);

  const idsEnAlcance = useMemo(() => new Set(filas.map((f) => f.ID_unico)), [filas]);
  const carritos = useMemo(() => (items || []).filter((c) => idsEnAlcance.has(c.id_unico)), [items, idsEnAlcance]);
  const porEstado = useMemo(() => {
    const n = { borrador: 0, enviado: 0, aprobado: 0, devuelto: 0 };
    carritos.forEach((c) => { n[c.estado] = (n[c.estado] || 0) + 1; });
    return n;
  }, [carritos]);
  const conCarrito = useMemo(() => new Set(carritos.map((c) => c.id_unico)), [carritos]);
  const sinCarrito = filas.filter((f) => !conCarrito.has(f.ID_unico));

  if (items === null) return <Cargando />;

  const visibles = carritos.filter((c) => !estado || c.estado === estado);
  const aprobados = carritos.filter((c) => APROBADOS.includes(c.estado));
  const aprobado = aprobados.reduce((n, c) => n + c.total, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Indicador etiqueta="Carritos armados" valor={carritos.length} icono={ShoppingCart} retardo={0}
          detalle={`${porEstado.borrador} en borrador`} />
        <Indicador etiqueta="Por revisar" valor={porEstado.enviado} icono={ClipboardList} retardo={60}
          tono={porEstado.enviado ? 'alerta' : 'ok'} detalle="Enviados a la coordinación" />
        <Indicador etiqueta="Valor aprobado" valor={pesos(aprobado)} icono={Wallet} retardo={120}
          tono="ok" detalle={`${aprobados.length} planes aprobados`} />
        <Indicador etiqueta="Sin carrito" valor={sinCarrito.length} icono={ShoppingCart} retardo={180}
          tono={sinCarrito.length ? 'alerta' : 'ok'} detalle="Iniciativas que aún no lo empiezan" />
      </div>

      <Tarjeta titulo={`Carritos (${visibles.length})`}>
        <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0" role="group" aria-label="Filtrar por estado">
          {[['', 'Todos', carritos.length], ...Object.entries(ESTADOS_CARRITO).map(([k, e]) => [k, e.texto, porEstado[k] || 0])]
            .map(([clave, texto, total]) => (
              <button
                key={clave || 'todos'}
                type="button"
                onClick={() => setEstado(clave)}
                aria-pressed={estado === clave}
                className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-[background-color,border-color,color] duration-150 ${
                  estado === clave ? 'border-marino bg-marino text-white' : 'border-borde bg-card text-marca hover:border-acento'
                }`}
              >
                {texto} <span className="cifras opacity-70">{total}</span>
              </button>
            ))}
        </div>

        <Tabla
          cabeceras={[
            'Iniciativa', 'Nodo', 'Estado', { texto: 'Productos', alinear: 'derecha' },
            { texto: 'Total', alinear: 'derecha' }, 'Presupuesto', { texto: '', alinear: 'derecha' },
          ]}
          vacio={carritos.length ? 'Ningún carrito tiene ese estado.' : 'Todavía no hay carritos. Se crean al agregar el primer producto desde la pestaña Tienda.'}
          iconoVacio={ShoppingCart}
        >
          {visibles.map((c) => {
            const e = ESTADOS_CARRITO[c.estado] || ESTADOS_CARRITO.borrador;
            const base = c.presupuesto_productos ?? c.presupuesto_maximo;
            const pct = base ? (c.total / base) * 100 : null;
            return (
              <Fila key={c.id_carrito}>
                <Celda>
                  <div className="font-semibold text-marca">{c.nombre_up || `Iniciativa ${c.id_unico}`}</div>
                  <div className="text-[12px] text-gris-txt">{c.id_unico}</div>
                </Celda>
                <Celda className="text-[13px]">{c.nodo || '—'}</Celda>
                <Celda><Insignia tono={e.tono}>{e.texto}</Insignia></Celda>
                <Celda alinear="derecha" className="cifras">{c.lineas}</Celda>
                <Celda alinear="derecha" className="cifras whitespace-nowrap font-semibold">{pesos(c.total)}</Celda>
                <Celda>
                  {pct === null ? (
                    <span className="text-[12px] text-gris-txt">Sin modalidad</span>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <MiniBarra pct={Math.round(pct)} color={pct > 100 ? 'var(--color-rojo)' : pct >= 85 ? 'var(--color-acento)' : 'var(--color-ok)'} />
                      <span className="cifras text-[11px] text-gris-txt">{Math.round(pct)} % de {pesos(base)}{c.modalidad ? ` · ${c.modalidad}` : ''}</span>
                    </div>
                  )}
                </Celda>
                <Celda alinear="derecha">
                  <Boton tamano="sm" variante="fantasma" onClick={() => onAbrir(c.id_unico)}>Abrir</Boton>
                </Celda>
              </Fila>
            );
          })}
        </Tabla>
      </Tarjeta>
    </div>
  );
}
