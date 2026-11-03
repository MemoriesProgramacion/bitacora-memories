// Pestaña de cumplimiento de la formación del territorio.
import { useMemo, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { useCarga } from '../../admin/useCarga';
import { Alerta, Boton, Campo, Cargando, Entrada, Indicador, Insignia, Tarjeta, Vacio, useAvisos } from '../../inventario/componentes/ui';
import { descargarExcel } from '../../lib/exportarExcel';
import { columnasCumplimiento, pedirCumplimientoTerritorio, textoSesion } from '../../lib/formacion';
import { hoyISO } from '../../lib/asociados';
import { cumple, hayFiltro } from './FiltrosTerritorio';

// Muestra el informe de cumplimiento de la formación del territorio: cada unidad de los talleres que ve el
// usuario con sus tres módulos, la encuesta de salida y la entrega final.
export default function CumplimientoTab({ filtro = null }) {
  const { datos, cargando, recargar } = useCarga(() => pedirCumplimientoTerritorio(), []);
  const [buscar, setBuscar] = useState('');
  const { avisar } = useAvisos();
  const filas = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return (datos?.items || []).filter((f) => (!filtro || !hayFiltro(filtro) || cumple(f.ubicacion, filtro))
      && (!q || [f.taller, f.id_unico, f.nombre, f.region, f.nodo].some((x) => String(x || '').toLowerCase().includes(q))));
  }, [datos, buscar, filtro]);
  const resumenFiltrado = useMemo(() => {
    if (!filtro || !hayFiltro(filtro) || !datos) return null;
    const porUP = new Map();
    for (const f of datos.items) if (cumple(f.ubicacion, filtro)) porUP.set(f.id_up, Boolean(porUP.get(f.id_up)) || f.cumple_80);
    return { unidades: porUP.size, cumplen: [...porUP.values()].filter(Boolean).length };
  }, [datos, filtro]);
  if (!datos) return cargando ? <Cargando /> : <Alerta tono="error">No se pudo cargar el cumplimiento. <Boton variante="fantasma" onClick={recargar}>Reintentar</Boton></Alerta>;
  const r = resumenFiltrado || datos.resumen || { unidades: 0, cumplen: 0 };
  const exportar = async () => {
    try { await descargarExcel(`cumplimiento-formacion-${hoyISO()}.xlsx`, 'Cumplimiento', columnasCumplimiento(), filas); } catch (err) { avisar(err.message || 'No se pudo generar el Excel.', 'error'); }
  };
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Indicador etiqueta="Unidades en formación" valor={r.unidades} />
        <Indicador etiqueta="Cumplen el 80 %" valor={r.cumplen} />
        <Indicador etiqueta="Aún no cumplen" valor={r.unidades - r.cumplen} />
      </div>
      <Tarjeta titulo="Cumplimiento por unidad productiva"
        acciones={<Boton variante="fantasma" icono={FileSpreadsheet} disabled={!filas.length} onClick={exportar}>Exportar a Excel</Boton>}>
        <div className="grid gap-3">
          <Campo etiqueta="Buscar por taller, ID, unidad, región o nodo" className="max-w-md">
            <Entrada type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
          </Campo>
          {!filas.length ? <Vacio>{datos.items.length ? 'Ninguna unidad coincide con la búsqueda o el territorio elegido.' : 'Aún no hay unidades en talleres de tu territorio.'}</Vacio> : (
            <ul className="grid gap-2">
              {filas.map((f) => (
                <li key={`${f.taller_id}-${f.id_up}`} className="grid min-w-0 gap-1.5 rounded-lg border border-borde p-3 text-[13px]">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 break-words font-semibold">{f.id_unico} · {f.nombre}</span>
                    <Insignia tono={f.cumple_80 ? 'ok' : 'alerta'}>{f.porcentaje} % · {f.cumple_80 ? 'cumple' : 'no cumple'}</Insignia>
                  </div>
                  <p className="break-words text-gris-txt">{f.taller} · {f.region} · {f.nodo} · {f.modalidad}</p>
                  <p className="break-words">
                    {f.modulos.map((m) => `Módulo ${m.modulo}: ${textoSesion(m)}`).join(' · ')}
                    {' · '}Encuesta de salida: {f.encuesta_salida ? 'sí' : 'no'} · Entrega final: {f.entrega_final ? 'sí' : 'no'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Tarjeta>
    </div>
  );
}
