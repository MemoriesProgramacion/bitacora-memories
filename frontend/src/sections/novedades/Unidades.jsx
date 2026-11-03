// Unidades productivas con su estado, activa o desactivada. Una unidad nunca se borra: el retiro o el reemplazo
// la deja desactivada y conserva su expediente, su historial y el registro con la causal, el acta y el ticket.
// Aquí se ve cuáles siguen activas y cuáles no, y por qué se desactivó cada una.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, FileSpreadsheet } from 'lucide-react';
import { apiGeneral } from '../../inventario/lib/api';
import { Alerta, Boton, Campo, Cargando, Celda, Entrada, Fila, Insignia, Tabla, Tarjeta, useAvisos } from '../../inventario/componentes/ui';
import { columnasUnidadesEstado, filtrarUnidadesEstado, textoDesactivacion } from '../../lib/alistamiento';
import { descargarExcel } from '../../lib/exportarExcel';

// Cantidad máxima de filas que se muestran.
const MAX_FILAS = 200;
const FILTROS = [['', 'Todas'], ['activa', 'Activas'], ['desactivada', 'Desactivadas']];

// Muestra la lista de unidades con filtros por estado y la opción de exportarla.
export default function Unidades() {
  const { avisar } = useAvisos();
  const [datos, setDatos] = useState(null);
  const [estado, setEstado] = useState('');
  const [q, setQ] = useState('');
  const recargar = useCallback(() => {
    apiGeneral.get('/retiros/unidades').then(setDatos).catch((err) => { avisar(err.message, 'error'); setDatos({ items: [], resumen: { total: 0, activas: 0, desactivadas: 0 } }); });
  }, [avisar]);
  useEffect(() => { recargar(); }, [recargar]);
  const items = datos?.items || [];
  const visibles = useMemo(() => filtrarUnidadesEstado(items, { estado, q }), [items, estado, q]);
  const resumen = datos?.resumen;
  const cuenta = { '': resumen?.total, activa: resumen?.activas, desactivada: resumen?.desactivadas };

  return (
    <div className="grid gap-5">
      <Tarjeta titulo="Unidades productivas: activas y desactivadas" acciones={
        items.length > 0 && <Boton variante="fantasma" icono={FileSpreadsheet} onClick={() => descargarExcel('unidades-estado', 'Unidades', columnasUnidadesEstado(), visibles)}>Excel</Boton>}>
        <Alerta tono="info">Una unidad nunca se borra: el retiro o el reemplazo la deja desactivada y conserva su expediente y su historial. Una unidad también aparece desactivada si existe pero aún no está habilitada.</Alerta>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Estado de la unidad">
            {FILTROS.map(([valor, nombre]) => (
              <button key={valor || 'todas'} type="button" aria-pressed={estado === valor} onClick={() => setEstado(valor)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition ${
                  estado === valor ? 'border-marino bg-marino text-white' : 'border-borde bg-card text-texto hover:border-acento'}`}>
                {nombre}
                <span className={`rounded-full px-1.5 text-[11px] ${estado === valor ? 'bg-white/20' : 'bg-lienzo text-gris-txt'}`}>{cuenta[valor] ?? '—'}</span>
              </button>
            ))}
          </div>
          <Campo etiqueta="Buscar" className="min-w-[220px] flex-1">
            <Entrada value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código, unidad, representante, municipio o nodo…" />
          </Campo>
        </div>
      </Tarjeta>
      <Tarjeta>
        {datos === null ? <Cargando /> : (
          <>
            <Tabla cabeceras={['ID único', 'Unidad', 'Nodo', 'Representante', 'Estado', 'Desactivación']} iconoVacio={Building2} vacio="Ninguna unidad coincide con el filtro.">
              {visibles.slice(0, MAX_FILAS).map((u) => (
                <Fila key={u.id_unico}>
                  <Celda><span className="font-semibold">{u.id_unico}</span></Celda>
                  <Celda>{u.nombre || '—'}<span className="block text-[12px] text-gris-txt">{[u.municipio, u.departamento].filter(Boolean).join(', ')}</span></Celda>
                  <Celda>{u.nodo || '—'}</Celda>
                  <Celda>{u.representante || '—'}</Celda>
                  <Celda><Insignia tono={u.estado === 'activa' ? 'ok' : u.desactivacion?.motivo === 'retirada' ? 'error' : 'alerta'}>
                    {u.estado === 'activa' ? 'Activa' : 'Desactivada'}</Insignia></Celda>
                  <Celda><span className="break-words text-[13px] text-gris-txt">{textoDesactivacion(u.desactivacion) || '—'}</span></Celda>
                </Fila>
              ))}
            </Tabla>
            {visibles.length > MAX_FILAS && <p className="px-4 py-3 text-[12px] text-gris-txt">Se muestran las primeras {MAX_FILAS} de {visibles.length}. Filtra o busca para ver el resto (el Excel lleva todas las del filtro).</p>}
          </>
        )}
      </Tarjeta>
    </div>
  );
}
