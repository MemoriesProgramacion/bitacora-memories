// Sección de talleres: lista de talleres con su formulario, los módulos, los contenidos, los grupos de unidades
// y el calendario.
import { useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, Pencil, Plus } from 'lucide-react';
import { apiGeneral } from '../inventario/lib/api';
import { useCarga } from '../admin/useCarga';
import { useAccion } from '../inventario/lib/useDatos';
import { useComunicaciones } from '../hooks/useComunicaciones';
import Encabezado from '../inventario/componentes/Encabezado';
import { Alerta, Boton, Campo, Cargando, Insignia, Seleccion, Tarjeta, Vacio } from '../inventario/componentes/ui';
import FormTaller from './talleres/FormTaller';
import { fechaColombia, regionIgual } from './talleres/fechas';
import Encuentro from './talleres/Encuentro';
import Contenidos from './talleres/Contenidos';
import GruposUP from './talleres/GruposUP';
import Calendario from './talleres/Calendario';
import EntregasFinalesTab from './talleres/EntregasFinalesTab';
import FormacionTaller from './talleres/FormacionTaller';
import ConvocatoriaTaller from './talleres/ConvocatoriaTaller';
import CumplimientoTab from './talleres/CumplimientoTab';
import FiltrosTerritorio, { FILTRO_VACIO, algunaCumple, cumple, hayFiltro } from './talleres/FiltrosTerritorio';

// Carga los talleres y muestra la vista elegida.
export default function Talleres({ session }) {
  const { datos, cargando, recargar } = useCarga(() => apiGeneral.get('/talleres'), [session.usuario, session.region]);
  const { eventos } = useComunicaciones();
  const { ejecutar, ocupado } = useAccion(recargar);
  const [vista, setVista] = useState('calendario');
  const [formulario, setFormulario] = useState(null);
  const [detalleId, setDetalleId] = useState(null);
  const [modulo, setModulo] = useState(1);
  const [convocatoria, setConvocatoria] = useState(null);
  const [region, setRegion] = useState(session.region || '');
  const [filtro, setFiltro] = useState(FILTRO_VACIO);
  const vistaDatos = useMemo(() => {
    if (!datos?.filtros_territorio || !hayFiltro(filtro)) return datos;
    return { ...datos, talleres: datos.talleres.filter((t) => algunaCumple(t.ubicaciones, filtro)),
      grupos: datos.grupos.filter((g) => g.ups.some((up) => cumple(up, filtro))) };
  }, [datos, filtro]);
  const taller = datos?.talleres.find((t) => t.id === detalleId);
  const moduloVisible = taller?.encuentros.some((e) => e.modulo === modulo) ? modulo : taller?.encuentros[0]?.modulo;
  const primerModulo = (t) => t?.encuentros?.[0]?.modulo ?? 1;
  if (!datos) return cargando ? <Cargando /> : <Alerta tono="error">No se pudieron cargar los talleres. <Boton variante="fantasma" onClick={recargar}>Reintentar</Boton></Alerta>;
  const guardar = async (f) => {
    const r = await ejecutar(() => formulario.id ? apiGeneral.put(`/talleres/${formulario.id}`, f) : apiGeneral.post('/talleres', f));
    if (r) { setFormulario(null); setDetalleId(r.item.id); setModulo(primerModulo(r.item)); }
  };
  const programar = (grupo) => { setFormulario(grupo ? { grupoInicial: grupo } : {}); setConvocatoria(null); };
  const volver = () => { setDetalleId(null); setConvocatoria(null); };
  return <>
    <Encabezado titulo="Talleres de fortalecimiento" descripcion="Grupos de UP de tu región, tres módulos de tres horas y el contenido de cada uno.">
      {!formulario && datos.puede_programar && <Boton icono={Plus} disabled={!datos.nodos.length} onClick={() => datos.grupos.length ? programar() : (setVista('grupos'), volver())}>{datos.grupos.length ? 'Programar módulos' : 'Crear grupo de UP'}</Boton>}
    </Encabezado>
    {datos.aviso && <Alerta tono="aviso" className="mb-4">{datos.aviso}</Alerta>}
    {formulario ? <Tarjeta titulo={formulario.id ? 'Editar programación y grupo' : 'Programar módulos para un grupo de UP'}>
      <FormTaller taller={formulario.id ? formulario : null} grupoInicial={formulario.grupoInicial} datos={datos} session={session} onGuardar={guardar} ocupado={ocupado} onCancelar={() => setFormulario(null)} />
    </Tarjeta> : <>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-borde" role="tablist" aria-label="Talleres">
        {[['calendario', datos.puede_programar ? 'Calendario de eventos' : 'Mi calendario'],['grupos','Grupos de UP'],['registros', datos.puede_programar ? 'Programación y registros' : 'Mis módulos'],['entregas','Entregas finales'],['cumplimiento','Cumplimiento de la formación'],['contenidos','Contenidos de los módulos']].filter(([id]) => datos.puede_programar || id !== 'grupos').map(([id,label]) => <button key={id} type="button" role="tab" aria-selected={vista === id} onClick={() => { setVista(id); volver(); }}
          className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold ${vista === id ? 'border-marino text-marino' : 'border-transparent text-gris-txt'}`}>{label}</button>)}
      </div>
      {datos.filtros_territorio && !convocatoria && !taller && vista !== 'contenidos' && <FiltrosTerritorio territorio={datos.territorio_ups} filtro={filtro} onCambiar={setFiltro}
        resumen={!hayFiltro(filtro) ? 'Se muestran todas las UP. Un taller o grupo aparece si alguna de sus UP está en el territorio elegido.'
          : vista === 'grupos' ? `${vistaDatos.grupos.length} de ${datos.grupos.length} grupos de UP con UP en el territorio elegido.`
          : vista === 'cumplimiento' ? 'Se muestran solo las UP del territorio elegido.'
          : `${vistaDatos.talleres.length} de ${datos.talleres.length} talleres con UP en el territorio elegido.`} />}
      {convocatoria ? <div className="grid gap-4"><Boton variante="fantasma" icono={ArrowLeft} onClick={volver}>Volver al calendario</Boton><Tarjeta titulo={convocatoria.titulo}><div className="grid gap-2 text-[13px]"><p>{fechaColombia(`${convocatoria.fecha}T${convocatoria.hora || '00:00'}-05:00`)}</p><p>{convocatoria.modalidad} · {convocatoria.lugar}</p><p className="whitespace-pre-wrap">{convocatoria.descripcion}</p></div></Tarjeta></div>
      : taller ? <div className="grid gap-4">
        <div className="flex flex-wrap justify-between gap-2"><Boton variante="fantasma" icono={ArrowLeft} onClick={volver}>Volver a {vista === 'calendario' ? 'calendario' : 'programaciones'}</Boton>{datos.puede_programar && !taller.encuentros.some((e) => e.realizado_en) && <Boton variante="fantasma" icono={Pencil} onClick={() => setFormulario(taller)}>Editar programación y grupo</Boton>}</div>
        <Tarjeta titulo={taller.nombre}><dl className="grid gap-2 text-[13px] sm:grid-cols-2">
          <div><dt className="text-gris-txt">Región y lugar</dt><dd>{taller.region} · {taller.nodo} · {taller.municipio} · {taller.lugar}</dd></div><div><dt className="text-gris-txt">{datos.puede_programar ? 'Docentes' : 'Tu docencia'}</dt><dd>{[...new Set(taller.encuentros.map((e) => e.tallerista_nombre))].filter(Boolean).join(', ') || '—'}</dd></div>
          <div><dt className="text-gris-txt">Grupo de UP</dt><dd>{taller.grupo_nombre || 'Registro anterior'} · {taller.participantes.length}/40 {taller.grupo_id ? 'UP' : 'personas'}</dd></div><div><dt className="text-gris-txt">Avance</dt><dd>{taller.encuentros.filter((e) => e.realizado_en).length}/{taller.encuentros.length} {datos.puede_programar ? 'módulos realizados' : 'de tus módulos realizados'}</dd></div>
        </dl></Tarjeta>
        {!taller.encuentros.length ? <Alerta tono="info">No dictas módulos de este taller: tienes a tu cargo la entrega final y los hallazgos de cada UP.</Alerta>
        : <Campo etiqueta={datos.puede_programar ? 'Módulo' : 'Módulo que vas a dictar'}><Seleccion value={moduloVisible} onChange={(e) => setModulo(Number(e.target.value))}>{taller.encuentros.map((e) => <option key={e.modulo} value={e.modulo}>Módulo {e.modulo} · {fechaColombia(e.inicio)}{e.realizado_en ? ' · Realizado' : ''}</option>)}</Seleccion></Campo>}
        {taller.encuentros.filter((e) => e.modulo === moduloVisible).map((e) => <Encuentro key={e.id} taller={taller} e={e} recargar={recargar} contenido={datos.contenidos.find((c) => regionIgual(c.region,taller.region) && c.modulo === e.modulo)} puedeProgramar={datos.puede_programar} talleristas={datos.talleristas} />)}
        {datos.puede_programar && <ConvocatoriaTaller taller={taller} recargarTaller={recargar} />}
        <FormacionTaller taller={taller} recargar={recargar} puedeProgramar={datos.puede_programar} />
      </div>
      : vista === 'grupos' ? <GruposUP datos={vistaDatos} filtro={filtro} recargar={recargar} onProgramar={programar} />
      : vista === 'entregas' ? <EntregasFinalesTab datos={vistaDatos} recargar={recargar} />
      : vista === 'cumplimiento' ? <CumplimientoTab filtro={datos.filtros_territorio ? filtro : null} />
      : vista === 'contenidos' ? <Contenidos datos={datos} region={region} setRegion={setRegion} recargar={recargar} />
      : vista === 'calendario' ? <Calendario talleres={vistaDatos.talleres} convocatorias={eventos} onSeleccionar={(e) => { if (e.taller) { setDetalleId(e.taller.id); setModulo(e.encuentro.modulo); } else setConvocatoria(e.convocatoria); }} />
      : !vistaDatos.talleres.length ? <Tarjeta><Vacio icono={CalendarDays}>{datos.talleres.length ? 'Ningún taller tiene UP en el territorio elegido.' : datos.puede_programar ? 'No hay módulos programados. Crea un grupo de UP y programa sus tres módulos.' : 'La coordinación aún no te ha asignado módulos.'}</Vacio></Tarjeta>
      : <div className="grid gap-4">{vistaDatos.talleres.map((t) => {
        const realizados = t.encuentros.filter((e) => e.realizado_en).length;
        return <Tarjeta key={t.id} titulo={t.nombre} acciones={<Insignia tono={realizados === t.encuentros.length ? 'ok' : 'alerta'}>{realizados}/{t.encuentros.length} {datos.puede_programar ? 'módulos realizados' : 'de tus módulos'}</Insignia>}>
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div className="grid gap-1 text-[13px] text-gris-txt"><p>{t.region} · {t.municipio} · {t.grupo_nombre}</p><p>{datos.puede_programar ? 'Docentes' : 'Tu docencia'}: {[...new Set(t.encuentros.map((e) => e.tallerista_nombre))].filter(Boolean).join(', ') || '—'} · {t.participantes.length}/40 {t.grupo_id ? 'UP' : 'personas'}</p><p>{t.encuentros[0] ? `Primer encuentro: ${fechaColombia(t.encuentros[0].inicio)}` : 'Sin módulos a tu cargo: entrega final y hallazgos'}</p></div><Boton variante="fantasma" onClick={() => { setDetalleId(t.id); setModulo(primerModulo(t)); }}>Ver módulos y asistencia</Boton></div>
        </Tarjeta>;
      })}</div>}
    </>}
  </>;
}
