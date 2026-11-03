// Ruta por unidad: los 12 pasos de cada unidad calculados con la operación, que son las visitas cerradas, la
// formación, el ciclo del plan, la compra, la entrega, la tercera visita y el evento de cierre. La coordinación
// ve su territorio y el nivel nacional todo el programa.
import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, Route } from 'lucide-react';
import { apiGeneral } from '../../inventario/lib/api';
import { Alerta, Boton, Campo, Cargando, Celda, Entrada, Fila, Insignia, Seleccion, Tabla, Tarjeta, useAvisos } from '../../inventario/componentes/ui';
import { descargarExcel } from '../../lib/exportarExcel';
import { ESTADO_PROGRAMA, columnasRuta, filtrarRuta } from '../../lib/seguimiento';

// Cantidad de unidades que se muestran por página.
const PASO_PAGINA = 100;

// Muestra la tabla de la ruta con sus filtros y la opción de exportarla.
export default function Ruta() {
  const { avisar } = useAvisos();
  const [datos, setDatos] = useState(null);
  const [texto, setTexto] = useState('');
  const [pendiente, setPendiente] = useState('');
  const [region, setRegion] = useState('');
  const [hasta, setHasta] = useState(PASO_PAGINA);
  useEffect(() => {
    apiGeneral.get('/seguimiento/ruta').then(setDatos).catch((err) => { avisar(err.message, 'error'); setDatos({ items: [], pasos: [], resumen: [] }); });
  }, [avisar]);
  const regiones = useMemo(() => [...new Set((datos?.items || []).map((f) => f.region).filter(Boolean))].sort(), [datos]);
  const filas = useMemo(() => filtrarRuta((datos?.items || []).filter((f) => !region || f.region === region), { texto, pendiente }), [datos, texto, pendiente, region]);
  useEffect(() => { setHasta(PASO_PAGINA); }, [texto, pendiente, region]);

  if (datos === null) return <Tarjeta><Cargando /></Tarjeta>;
  const pasos = datos.pasos || [];
  const siguiente = (f) => pasos.find((p) => !p.pendiente && !f.pasos[p.clave]?.logrado);
  return (
    <Tarjeta titulo="Avance de la ruta por unidad" acciones={filas.length > 0 && (
      <Boton variante="fantasma" icono={FileSpreadsheet} onClick={() => descargarExcel('ruta-por-unidad', 'Ruta', columnasRuta(pasos), filas)}>Excel</Boton>
    )}>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Campo etiqueta="Buscar"><Entrada type="search" placeholder="ID, nombre, municipio o nodo" value={texto} onChange={(e) => setTexto(e.target.value)} /></Campo>
        <Campo etiqueta="Región">
          <Seleccion value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">Todas</option>
            {regiones.map((r) => <option key={r} value={r}>{r}</option>)}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Les falta">
          <Seleccion value={pendiente} onChange={(e) => setPendiente(e.target.value)}>
            <option value="">Cualquier paso</option>
            {pasos.filter((p) => !p.pendiente).map((p) => <option key={p.clave} value={p.clave}>{p.nombre}</option>)}
          </Seleccion>
        </Campo>
      </div>
      <p className="mb-3 text-[12px] text-gris-txt" aria-live="polite">{filas.length.toLocaleString('es-CO')} unidades. El avance cuenta 11 pasos; la subsanación pendiente es una espera.</p>
      {!datos.items.length ? <Alerta tono="info">No hay unidades en tu alcance.</Alerta> : (
        <>
          <Tabla cabeceras={['Unidad', 'Territorio', 'Modalidad', 'Avance', 'Siguiente paso', 'Estado']} vacio="Ninguna unidad coincide con el filtro." iconoVacio={Route}>
            {filas.slice(0, hasta).map((f) => {
              const s = siguiente(f);
              return (
                <Fila key={f.id_unico}>
                  <Celda><span className="font-semibold text-marca">{f.id_unico}</span><span className="block break-words text-[12px] text-gris-txt">{f.nombre}</span></Celda>
                  <Celda><span className="text-[13px]">{f.region || '—'} · {f.nodo || '—'}</span><span className="block text-[12px] text-gris-txt">{f.municipio || ''}</span></Celda>
                  <Celda>{f.modalidad || '—'}</Celda>
                  <Celda>
                    <span className="cifras font-semibold">{f.avance} de {f.de}</span>
                    <span className="mt-1 block h-1.5 w-24 overflow-hidden rounded-full bg-lienzo max-lg:ml-auto" aria-hidden="true"><span className="block h-full rounded-full bg-acento" style={{ width: `${(f.avance / f.de) * 100}%` }} /></span>
                    {f.modulos && <span className="mt-1 block text-[11px] text-gris-txt">Módulos: {f.modulos.map((v, i) => `${i + 1} ${v ? 'sí' : 'no'}`).join(' · ')}</span>}
                  </Celda>
                  <Celda><span className="text-[13px]">{s ? s.nombre : 'Ruta completa'}</span>{f.pasos.subsanacion?.logrado && <span className="mt-1 block"><Insignia tono="error">En subsanación</Insignia></span>}</Celda>
                  <Celda><Insignia tono={f.estado_programa === 'en_programa' ? 'ok' : f.estado_programa === 'retirada' ? 'error' : 'neutro'}>{ESTADO_PROGRAMA[f.estado_programa]}</Insignia></Celda>
                </Fila>
              );
            })}
          </Tabla>
          {filas.length > hasta && (
            <div className="mt-4 flex justify-center"><Boton variante="fantasma" onClick={() => setHasta((n) => n + PASO_PAGINA)}>Mostrar {Math.min(PASO_PAGINA, filas.length - hasta)} más</Boton></div>
          )}
        </>
      )}
    </Tarjeta>
  );
}
