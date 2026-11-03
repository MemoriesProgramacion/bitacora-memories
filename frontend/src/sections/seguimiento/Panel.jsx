// Panel de seguimiento: lo agregado en tiempo real, es decir, las unidades frente a las metas, el avance de
// cada paso de la ruta, los indicadores de gestión y de producto por región, modalidad o departamento y cuántas
// alertas hay. No tiene filas por unidad ni datos personales y lo consulta y exporta a Excel el nivel nacional.
import { useEffect, useState } from 'react';
import { AlertTriangle, FileSpreadsheet, PackageCheck, Target, Users } from 'lucide-react';
import { apiGeneral, qs } from '../../inventario/lib/api';
import { Alerta, Boton, Campo, Cargando, Celda, Fila, Indicador, Seleccion, Tabla, Tarjeta, useAvisos } from '../../inventario/componentes/ui';
import { descargarExcel } from '../../lib/exportarExcel';
import { diaColombia } from '../../lib/carrito';
import { pct, separarRuta } from '../../lib/seguimiento';

const AGRUPAR = { region: 'Región', modalidad: 'Modalidad', departamento: 'Departamento' };
const GESTION = [['visita1', 'V1'], ['visita2', 'V2'], ['formacion', '80 %'], ['aprobacion', 'Aprobados'], ['entrega', 'Entregadas'], ['visita3', 'V3'], ['cierre', 'Cierre']];

// Devuelve las columnas del Excel de indicadores, las mismas de la tabla.
function columnasIndicadores(agrupar) {
  return [
    { titulo: AGRUPAR[agrupar], valor: (g) => g.grupo, ancho: 18 },
    { titulo: 'Unidades', valor: (g) => g.unidades, ancho: 10 },
    { titulo: 'Meta', valor: (g) => g.meta ?? '', ancho: 10 },
    { titulo: '% de cobertura', valor: (g) => g.cobertura_pct ?? '', ancho: 12 },
    ...GESTION.map(([k, t]) => ({ titulo: t, valor: (g) => g.gestion[k].n, ancho: 10 })),
    { titulo: 'Con salida', valor: (g) => g.producto.con_salida, ancho: 10 },
    { titulo: 'Variación de ventas (%)', valor: (g) => g.producto.variacion_ventas_pct ?? '', ancho: 14 },
    { titulo: 'Variación de clientes (%)', valor: (g) => g.producto.variacion_clientes_pct ?? '', ancho: 14 },
  ];
}

// Muestra una barra de avance con su cifra, porque el color no va solo; las esperas van en otro color.
function Barra({ nombre, n, porcentaje, espera = false }) {
  return (
    <li className="grid gap-1">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className={`min-w-0 break-words ${espera ? 'text-aviso-txt' : 'text-marca'}`}>{nombre}</span>
        <span className="cifras shrink-0 font-semibold text-gris-txt">{n.toLocaleString('es-CO')} · {pct(porcentaje)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-lienzo" aria-hidden="true">
        <div className={`h-full rounded-full ${espera ? 'bg-aviso-txt' : 'bg-acento'}`} style={{ width: `${Math.min(100, porcentaje)}%` }} />
      </div>
    </li>
  );
}

// Muestra las cifras, la cobertura, los indicadores y las alertas.
export default function Panel() {
  const { avisar } = useAvisos();
  const [p, setP] = useState(null);
  const [agrupar, setAgrupar] = useState('region');
  const [ind, setInd] = useState(null);
  useEffect(() => {
    apiGeneral.get('/seguimiento/panel').then(setP).catch((err) => { avisar(err.message, 'error'); setP(false); });
  }, [avisar]);
  useEffect(() => {
    let vivo = true;
    setInd(null);
    apiGeneral.get(`/seguimiento/indicadores${qs({ agrupar })}`).then((r) => { if (vivo) setInd(r); })
      .catch((err) => { if (vivo) { avisar(err.message, 'error'); setInd({ items: [] }); } });
    return () => { vivo = false; };
  }, [agrupar, avisar]);

  if (p === null) return <Tarjeta><Cargando /></Tarjeta>;
  if (p === false) return <Alerta tono="error">No se pudo cargar el panel. Vuelve a intentarlo en un momento.</Alerta>;
  const t = p.total;
  const ruta = separarRuta(p.ruta);
  const items = ind?.items || [];
  return (
    <div className="grid gap-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador etiqueta="Unidades en el programa" valor={t.unidades.toLocaleString('es-CO')} detalle={`De ${p.total_programa.toLocaleString('es-CO')} del programa`} icono={Users} />
        <Indicador etiqueta="Cobertura frente a las metas" valor={pct(t.cobertura_pct)} detalle={t.meta ? `Meta registrada: ${t.meta.toLocaleString('es-CO')}` : p.metas_por_nodo ? 'Las metas van por región y modalidad, no por nodo' : 'Aún no hay metas registradas'} icono={Target} retardo={60} />
        <Indicador etiqueta="Con activos entregados" valor={t.gestion.entrega.n.toLocaleString('es-CO')} detalle={pct(t.gestion.entrega.porcentaje)} icono={PackageCheck} tono="ok" retardo={120} />
        <Indicador etiqueta="Alertas de la ruta" valor={p.alertas.total.toLocaleString('es-CO')} detalle="El detalle por tipo está abajo" icono={AlertTriangle} tono={p.alertas.total ? 'alerta' : 'ok'} retardo={180} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Tarjeta titulo="Avance de la ruta">
          <p className="mb-3 text-[12px] text-gris-txt">Unidades en el programa que cumplieron cada paso. Actualizado el {diaColombia(p.actualizado)}.</p>
          <ul className="grid gap-3">{ruta.pasos.map((x) => <Barra key={x.clave} {...x} />)}</ul>
          {ruta.espera.length > 0 && (
            <div className="mt-4 border-t border-borde pt-3">
              <p className="mb-3 text-[12px] text-gris-txt">Esto no es un paso cumplido: son las unidades que esperan subsanar su plan.</p>
              <ul className="grid gap-3">
                {ruta.espera.map((x) => <Barra key={x.clave} {...x} espera nombre={`En espera: ${x.nombre.charAt(0).toLowerCase()}${x.nombre.slice(1)}`} />)}
              </ul>
            </div>
          )}
        </Tarjeta>
        <Tarjeta titulo="Alertas por tipo">
          {p.alertas.total === 0 ? <p className="text-[13px] text-gris-txt">No hay alertas.</p> : (
            <ul className="grid gap-2 text-[13px]">
              {Object.entries(p.alertas.por_tipo).filter(([, n]) => n).map(([k, n]) => (
                <li key={k} className="flex items-baseline justify-between gap-3 border-b border-borde/70 pb-2 last:border-b-0">
                  <span className="min-w-0 break-words">{p.tipos_alerta?.[k]?.nombre || k}</span>
                  <span className="cifras shrink-0 font-semibold text-marca">{n.toLocaleString('es-CO')}</span>
                </li>
              ))}
            </ul>
          )}
          {p.informes?.length > 0 && <p className="mt-4 text-[12px] text-gris-txt">Último informe mensual: {p.informes[0].periodo} (pestaña Informes).</p>}
        </Tarjeta>
      </div>

      <Tarjeta titulo="Indicadores de cobertura, gestión y producto" acciones={
        <div className="flex flex-wrap items-end gap-2">
          <Campo etiqueta="Agrupar por" className="min-w-40">
            <Seleccion value={agrupar} onChange={(e) => setAgrupar(e.target.value)}>
              {Object.entries(AGRUPAR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Seleccion>
          </Campo>
          {items.length > 0 && <Boton variante="fantasma" icono={FileSpreadsheet} onClick={() => descargarExcel(`indicadores-por-${agrupar}`, 'Indicadores', columnasIndicadores(agrupar), items)}>Excel</Boton>}
        </div>}>
        <p className="mb-3 text-[12px] text-gris-txt">La cobertura compara las unidades en el programa con la meta de cupos. La variación compara la línea base (Visita 2) con la salida (Visita 3).</p>
        {ind === null ? <Cargando /> : (
          <Tabla cabeceras={[AGRUPAR[agrupar], { texto: 'Unidades', alinear: 'derecha' }, { texto: 'Meta', alinear: 'derecha' }, { texto: 'Cobertura', alinear: 'derecha' },
            ...GESTION.map(([, x]) => ({ texto: x, alinear: 'derecha' })), { texto: 'Ventas', alinear: 'derecha' }]} vacio="No hay unidades para mostrar.">
            {items.map((g) => (
              <Fila key={g.grupo}>
                <Celda><span className="font-semibold text-marca">{g.grupo}</span></Celda>
                <Celda alinear="derecha"><span className="cifras">{g.unidades.toLocaleString('es-CO')}</span></Celda>
                <Celda alinear="derecha"><span className="cifras">{g.meta == null ? '—' : g.meta.toLocaleString('es-CO')}</span></Celda>
                <Celda alinear="derecha"><span className="cifras">{pct(g.cobertura_pct)}</span></Celda>
                {GESTION.map(([k]) => <Celda key={k} alinear="derecha"><span className="cifras">{g.gestion[k].n.toLocaleString('es-CO')}</span></Celda>)}
                <Celda alinear="derecha"><span className="cifras">{pct(g.producto.variacion_ventas_pct)}</span></Celda>
              </Fila>
            ))}
          </Tabla>
        )}
      </Tarjeta>

      <Tarjeta titulo="Cobertura por región y modalidad" acciones={p.por_region_modalidad?.length > 0 && (
        <Boton variante="fantasma" icono={FileSpreadsheet} onClick={() => descargarExcel('cobertura-region-modalidad', 'Cobertura', COLUMNAS_COBERTURA, p.por_region_modalidad)}>Excel</Boton>
      )}>
        <p className="mb-3 text-[12px] text-gris-txt">Las metas se registran por región y modalidad: aquí se compara cada una con las unidades en el programa.</p>
        <Tabla cabeceras={['Región', 'Modalidad', { texto: 'Unidades', alinear: 'derecha' }, { texto: 'Meta', alinear: 'derecha' }, { texto: 'Cobertura', alinear: 'derecha' }]}
          vacio="Todavía no hay metas ni unidades para comparar.">
          {(p.por_region_modalidad || []).map((x) => (
            <Fila key={`${x.region}|${x.modalidad}`}>
              <Celda><span className="font-semibold text-marca">{x.region}</span></Celda>
              <Celda>{x.modalidad}</Celda>
              <Celda alinear="derecha"><span className="cifras">{x.unidades.toLocaleString('es-CO')}</span></Celda>
              <Celda alinear="derecha"><span className="cifras">{x.meta == null ? '—' : x.meta.toLocaleString('es-CO')}</span></Celda>
              <Celda alinear="derecha"><span className="cifras">{pct(x.cobertura_pct)}</span></Celda>
            </Fila>
          ))}
        </Tabla>
      </Tarjeta>
    </div>
  );
}

// Columnas del Excel de la cobertura por región y modalidad.
const COLUMNAS_COBERTURA = [
  { titulo: 'Región', valor: (x) => x.region, ancho: 16 },
  { titulo: 'Modalidad', valor: (x) => x.modalidad, ancho: 10 },
  { titulo: 'Unidades', valor: (x) => x.unidades, ancho: 10 },
  { titulo: 'Meta', valor: (x) => x.meta ?? '', ancho: 10 },
  { titulo: '% de cobertura', valor: (x) => x.cobertura_pct ?? '', ancho: 12 },
];
