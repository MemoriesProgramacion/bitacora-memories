// Entregas de encuentros de Niñas TIC, Mujeres TIC y Alfabetizadores TIC. Sigue el diagrama de flujo: se crea el
// espacio de entrega del grupo, la primera vez se suben los consentimientos, y cada uno de los 10 encuentros se
// entrega con sus cuatro archivos (registro fotográfico, lista de asistencia, video e informe) antes de guardarlo
// en la carpeta de evidencias. Los formatos para imprimir y la herramienta del registro fotográfico se descargan
// desde aquí.
import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, Camera, Check, FileDown, FolderCheck, Plus, Upload, Users } from 'lucide-react';
import { apiGeneral } from '../inventario/lib/api';
import { useCarga } from '../admin/useCarga';
import { useAccion } from '../inventario/lib/useDatos';
import Encabezado from '../inventario/componentes/Encabezado';
import { Alerta, Boton, Campo, Cargando, EnlaceBoton, Entrada, Insignia, Seleccion, Tarjeta, Vacio } from '../inventario/componentes/ui';

const API = '/encuentros-tic';
const urlArchivo = (id) => `/api${API}/archivos/${id}`;
const FORMATO_LISTA = {
  ninas: '2. Lista de asistencia - Niñas TIC',
  alfabetizadores: '3. Lista de asistencia - Alfabetizadores TIC',
  mujeres: '4. Lista de asistencia - Mujeres TIC',
};
const FORMATOS = [
  { nombre: '1. Informe de actividades', detalle: 'Un informe por encuentro, con el juego, el tema y las tres autonomías.' },
  { nombre: '2. Lista de asistencia - Niñas TIC', detalle: 'Una hoja para los 10 encuentros, con las tres autonomías de cada uno.' },
  { nombre: '3. Lista de asistencia - Alfabetizadores TIC', detalle: 'Tres hojas para los 10 encuentros, con autonomías y horas.' },
  { nombre: '4. Lista de asistencia - Mujeres TIC', detalle: 'Una hoja para los 10 encuentros, con documento y las tres autonomías.' },
];
const DESCRIPCION = {
  fotos: 'Un solo PDF con una foto por hoja: salón, equipos, las tres autonomías y foto grupal. Se arma con la herramienta de registro fotográfico.',
  asistencia: 'Diligenciada y firmada. Escaneada en PDF, en foto legible o el formato en Word lleno.',
  video: 'Registro en video del encuentro.',
  informe: 'Informe del encuentro en el formato de la Fundación.',
};
const PASOS = ['Espacio de entrega', 'Consentimientos', 'Encuentro 1 a 10', 'Entregables', 'Carpeta de evidencias', 'Fin'];
const fecha = (iso) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
const tam = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const completo = (e) => Object.values(e.elementos).every(Boolean);
const algo = (e) => Object.values(e.elementos).some(Boolean);

function estadoEncuentro(e) {
  if (e.entregado_en) return ['Entregado', 'ok'];
  if (completo(e)) return ['Listo para guardar', 'alerta'];
  if (algo(e)) return ['En curso', 'alerta'];
  return ['Pendiente', 'neutro'];
}
function estadoGrupo(g, total) {
  if (!g.consentimientos.length) return ['Faltan consentimientos', 'error'];
  if (g.entregados === total) return [`${total} de ${total} entregados`, 'ok'];
  return [`${g.entregados} de ${total} entregados`, g.entregados ? 'alerta' : 'neutro'];
}

// Barra de avance de los encuentros entregados.
function Barra({ valor, total }) {
  return (
    <div className="h-2 overflow-hidden rounded-full border border-borde bg-lienzo" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={valor}>
      <div className={`h-full rounded-full ${valor === total ? 'bg-ok' : 'bg-marca'}`} style={{ width: `${(valor / total) * 100}%` }} />
    </div>
  );
}

// Pasos del diagrama de flujo, con el actual resaltado.
function Pasos({ activo }) {
  return (
    <ol className="mb-4 flex flex-wrap gap-1.5" aria-label="Paso del flujo">
      {PASOS.map((t, i) => {
        const hecho = i < activo || (activo === PASOS.length - 1 && i === activo);
        const actual = i === activo && !hecho;
        return (
          <li key={t} aria-current={actual ? 'step' : undefined}
            className={`flex items-center gap-1.5 rounded-full border py-1 pr-3 pl-1 text-[12px] font-semibold ${hecho ? 'border-ok-borde bg-ok-bg text-ok-txt' : actual ? 'border-acento bg-acento text-marino' : 'border-borde bg-card text-gris-txt'}`}>
            <span className={`flex size-5 items-center justify-center rounded-full text-[11px] ${hecho ? 'bg-ok text-white' : actual ? 'bg-marino text-white' : 'border border-borde'}`}>{hecho ? <Check size={12} aria-hidden="true" /> : i + 1}</span>
            {t}
          </li>
        );
      })}
    </ol>
  );
}

// Selector de archivo con su botón de carga.
function Subir({ etiqueta, accept, multiple = false, ocupado, onSubir, variante = 'principal' }) {
  const ref = useRef(null);
  return (
    <>
      <input ref={ref} type="file" className="hidden" accept={accept} multiple={multiple} aria-label={etiqueta}
        onChange={(ev) => { const f = [...(ev.target.files || [])]; ev.target.value = ''; if (f.length) onSubir(f); }} />
      <Boton tamano="sm" variante={variante} icono={Upload} cargando={ocupado} onClick={() => ref.current?.click()}>{etiqueta}</Boton>
    </>
  );
}

export default function EntregasEncuentros({ session }) {
  const { datos, cargando, recargar } = useCarga(() => apiGeneral.get(API), [session.usuario]);
  const { ejecutar, ocupado } = useAccion(recargar);
  const [vista, setVista] = useState('grupos');
  const [filtro, setFiltro] = useState('todos');
  const [crear, setCrear] = useState(false);
  const [form, setForm] = useState({ programa: 'ninas', nombre: '', municipio: '', lugar: '' });
  const [grupoId, setGrupoId] = useState(null);
  const [encuentro, setEncuentro] = useState(null);

  const grupos = useMemo(() => (datos?.grupos || []).filter((g) => filtro === 'todos' || g.programa === filtro), [datos, filtro]);
  if (!datos) return cargando ? <Cargando /> : <Alerta tono="error">No se pudieron cargar las entregas de encuentros. <Boton variante="fantasma" onClick={recargar}>Reintentar</Boton></Alerta>;

  const total = datos.total_encuentros;
  const grupo = datos.grupos.find((g) => g.id === grupoId);
  const enc = grupo?.encuentros.find((e) => e.numero === encuentro);
  const elementos = datos.elementos;

  const crearGrupo = async (ev) => {
    ev.preventDefault();
    const r = await ejecutar(() => apiGeneral.post(`${API}/grupos`, form));
    if (r) { setCrear(false); setForm({ programa: form.programa, nombre: '', municipio: '', lugar: '' }); setGrupoId(r.item.id); setEncuentro(null); }
  };
  const subir = (ruta, campo, archivos, mensaje) => ejecutar(async () => {
    const f = new FormData();
    archivos.forEach((a) => f.append(campo, a));
    await apiGeneral.post(ruta, f);
    return { mensaje };
  });
  const entregar = () => ejecutar(async () => {
    await apiGeneral.post(`${API}/grupos/${grupo.id}/encuentros/${enc.numero}/entregar`, {});
    const quedan = total - grupo.entregados - 1;
    setEncuentro(null);
    return { mensaje: quedan > 0 ? `Encuentro ${enc.numero} guardado en la carpeta de evidencias. Quedan ${quedan} por entregar.` : `Los ${total} encuentros están entregados.` };
  });

  const pasoActivo = !grupo ? 0 : !grupo.consentimientos.length ? 1 : !enc ? (grupo.entregados === total ? 5 : 2) : completo(enc) ? 4 : 3;
  const carpeta = grupo ? `Evidencias › ${grupo.programa_nombre} › ${grupo.nombre}${enc ? ` › Encuentro ${enc.numero}` : ''}` : '';
  const herramienta = grupo && enc ? `/herramientas/registro-encuentros.html?${new URLSearchParams({ programa: grupo.programa_nombre, grupo: grupo.nombre, encuentro: String(enc.numero), lugar: grupo.lugar || grupo.municipio })}` : '';

  return <>
    <Encabezado titulo="Entregas de encuentros" descripcion={`Niñas TIC, Mujeres TIC y Alfabetizadores TIC: cada grupo entrega las evidencias de sus ${total} encuentros.`}>
      {vista === 'grupos' && !grupo && !crear && <Boton variante="acento" icono={Plus} onClick={() => setCrear(true)}>Crear espacio de entrega</Boton>}
    </Encabezado>

    <div className="mb-4 flex flex-wrap gap-1 border-b border-borde" role="tablist" aria-label="Entregas de encuentros">
      {[['grupos', 'Entregas por grupo'], ['formatos', 'Formatos']].map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={vista === id} onClick={() => { setVista(id); setGrupoId(null); setEncuentro(null); }}
          className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold ${vista === id ? 'border-marino text-marino' : 'border-transparent text-gris-txt'}`}>{label}</button>
      ))}
    </div>

    {vista === 'formatos' ? (
      <div className="grid gap-4">
        <Tarjeta titulo="Formatos para imprimir y llenar">
          <ul className="grid gap-2 sm:grid-cols-2">
            {FORMATOS.map((f) => (
              <li key={f.nombre} className="grid gap-2 rounded-lg border border-borde p-3 text-[13px]">
                <div><p className="font-semibold text-marca">{f.nombre}</p><p className="text-gris-txt">{f.detalle}</p></div>
                <div className="flex flex-wrap gap-2">
                  <EnlaceBoton href={`/formatos-entregas/${encodeURIComponent(f.nombre)}.docx`} download tamano="sm" icono={FileDown}>Word</EnlaceBoton>
                  <EnlaceBoton href={`/formatos-entregas/${encodeURIComponent(f.nombre)}.pdf`} download tamano="sm" icono={FileDown}>PDF para imprimir</EnlaceBoton>
                </div>
              </li>
            ))}
          </ul>
        </Tarjeta>
        <Tarjeta titulo="Registro fotográfico de encuentros">
          <div className="grid gap-3 text-[13px]">
            <p className="text-gris-txt">Herramienta que se abre en el navegador: se cargan las fotos de cada evidencia (salón, equipos, las tres autonomías y foto grupal) y genera el PDF con una foto por hoja. Funciona sin conexión una vez descargada.</p>
            <div className="flex flex-wrap gap-2">
              <EnlaceBoton href="/herramientas/registro-encuentros.html" target="_blank" rel="noopener noreferrer" variante="principal" icono={Camera}>Abrir en el navegador</EnlaceBoton>
              <EnlaceBoton href="/herramientas/registro-encuentros.html" download="registro-fotografico-encuentros.html" icono={FileDown}>Descargar herramienta</EnlaceBoton>
            </div>
          </div>
        </Tarjeta>
        <Alerta tono="info">La lista de asistencia va aparte del registro fotográfico, como su propio entregable, para que se lean bien los nombres y las firmas.</Alerta>
      </div>
    ) : !grupo ? (
      <div className="grid gap-4">
        <Pasos activo={crear ? 0 : 0} />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por programa">
          {[['todos', 'Todos'], ...datos.programas.map((p) => [p.codigo, p.nombre])].map(([id, t]) => (
            <button key={id} type="button" aria-pressed={filtro === id} onClick={() => setFiltro(id)}
              className={`rounded-full border px-3.5 py-1.5 text-[12px] font-bold transition ${filtro === id ? 'border-marino bg-marino text-white' : 'border-borde bg-card text-gris-txt hover:border-acento'}`}>{t}</button>
          ))}
        </div>
        {crear && (
          <Tarjeta titulo="Crear espacio de entrega">
            <form onSubmit={crearGrupo} className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo etiqueta="Programa" obligatorio>
                  <Seleccion value={form.programa} onChange={(e) => setForm({ ...form, programa: e.target.value })}>
                    {datos.programas.map((p) => <option key={p.codigo} value={p.codigo}>{p.nombre}</option>)}
                  </Seleccion>
                </Campo>
                <Campo etiqueta="Nombre del grupo" obligatorio><Entrada required maxLength={150} value={form.nombre} placeholder="Ej: Grupo 3 · IE San José" onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></Campo>
                <Campo etiqueta="Municipio" obligatorio><Entrada required maxLength={100} value={form.municipio} onChange={(e) => setForm({ ...form, municipio: e.target.value })} /></Campo>
                <Campo etiqueta="Lugar" ayuda="Institución o sitio donde se hacen los encuentros."><Entrada maxLength={200} value={form.lugar} onChange={(e) => setForm({ ...form, lugar: e.target.value })} /></Campo>
              </div>
              <p className="text-[12px] text-gris-txt">Si es la primera entrega del grupo, el siguiente paso pide los consentimientos. Solo se suben una vez.</p>
              <div className="flex flex-wrap gap-2"><Boton tipo="submit" cargando={ocupado}>Crear espacio</Boton><Boton variante="fantasma" onClick={() => setCrear(false)}>Cancelar</Boton></div>
            </form>
          </Tarjeta>
        )}
        {!grupos.length ? (
          <Tarjeta><Vacio icono={Users}>{datos.grupos.length ? 'No hay grupos de este programa.' : 'Aún no hay grupos. Crea el espacio de entrega del primero.'}</Vacio></Tarjeta>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {grupos.map((g) => {
              const [t, tono] = estadoGrupo(g, total);
              return (
                <Tarjeta key={g.id} titulo={g.nombre} acciones={<Insignia tono="neutro">{g.programa_nombre}</Insignia>}>
                  <div className="grid gap-3 text-[13px]">
                    <p className="text-gris-txt">{[g.municipio, g.lugar].filter(Boolean).join(' · ')}</p>
                    <Barra valor={g.entregados} total={total} />
                    <div className="flex flex-wrap items-center justify-between gap-2"><Insignia tono={tono}>{t}</Insignia><Boton tamano="sm" variante="fantasma" onClick={() => { setGrupoId(g.id); setEncuentro(null); }}>Abrir</Boton></div>
                  </div>
                </Tarjeta>
              );
            })}
          </div>
        )}
      </div>
    ) : !enc ? (
      <div className="grid gap-4">
        <Boton variante="fantasma" icono={ArrowLeft} className="justify-self-start" onClick={() => setGrupoId(null)}>Todos los grupos</Boton>
        <Pasos activo={pasoActivo} />
        <Tarjeta titulo={grupo.nombre} acciones={<Insignia tono="neutro">{grupo.programa_nombre}</Insignia>}>
          <div className="grid gap-3 text-[13px]">
            <div className="grid gap-2 sm:grid-cols-[1fr_220px] sm:items-end">
              <p className="text-gris-txt">{[grupo.municipio, grupo.lugar].filter(Boolean).join(' · ')}<br /><span className="font-mono text-[12px]">{carpeta}</span></p>
              <div className="grid gap-1.5"><span className="text-gris-txt"><b className="text-[18px] text-marca">{grupo.entregados}</b> de {total} encuentros</span><Barra valor={grupo.entregados} total={total} /></div>
            </div>
            {grupo.consentimientos.length ? (
              <div className="grid gap-2">
                <Alerta tono="info">Consentimientos del grupo cargados. Si faltó alguno, puedes agregarlo.</Alerta>
                <ul className="flex flex-wrap gap-2">{grupo.consentimientos.map((a) => <li key={a.id}><a href={urlArchivo(a.id)} className="inline-flex items-center gap-1 font-semibold text-acento-txt underline"><FileDown size={14} aria-hidden="true" />{a.nombre}</a></li>)}</ul>
                <div><Subir etiqueta="Agregar consentimientos" variante="fantasma" multiple accept={datos.consentimiento.ext.join(',')} ocupado={ocupado} onSubir={(f) => subir(`${API}/grupos/${grupo.id}/consentimientos`, 'archivos', f, 'Consentimientos agregados.')} /></div>
              </div>
            ) : (
              <Alerta tono="aviso">
                <div className="grid gap-2">
                  <p><strong>Primera entrega de este grupo.</strong> Antes de entregar encuentros, sube los consentimientos de {grupo.programa_nombre}. Solo se hace una vez. Formatos: {datos.consentimiento.formatos}, hasta {datos.consentimiento.max} archivos.</p>
                  <div><Subir etiqueta="Subir consentimientos" multiple accept={datos.consentimiento.ext.join(',')} ocupado={ocupado} onSubir={(f) => subir(`${API}/grupos/${grupo.id}/consentimientos`, 'archivos', f, 'Consentimientos cargados. Ya puedes entregar los encuentros.')} /></div>
                </div>
              </Alerta>
            )}
          </div>
        </Tarjeta>
        {grupo.entregados === total && <Alerta tono="info"><strong>Fin: {total} encuentros entregados.</strong> Todas las evidencias del grupo están en su carpeta.</Alerta>}
        <Tarjeta titulo="Seleccionar encuentro">
          <p className="mb-3 text-[12px] text-gris-txt">Las rayas de cada encuentro muestran los entregables: fotos · asistencia · video · informe.</p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {grupo.encuentros.map((e) => {
              const [t, tono] = estadoEncuentro(e);
              return (
                <button key={e.numero} type="button" disabled={!grupo.consentimientos.length} onClick={() => setEncuentro(e.numero)}
                  className={`grid gap-2 rounded-lg border p-3 text-left transition hover:border-acento disabled:cursor-not-allowed disabled:opacity-50 ${e.entregado_en ? 'border-ok-borde bg-ok-bg' : 'border-borde bg-card'}`}>
                  <b className="text-[14px] text-marca">Encuentro {e.numero}</b>
                  <span className="flex gap-1" aria-hidden="true">{elementos.map((el) => <span key={el.codigo} className={`h-1 flex-1 rounded ${e.elementos[el.codigo] ? (e.entregado_en ? 'bg-ok' : 'bg-marca') : 'bg-borde'}`} />)}</span>
                  <span><Insignia tono={tono}>{t}</Insignia></span>
                </button>
              );
            })}
          </div>
        </Tarjeta>
      </div>
    ) : (
      <div className="grid gap-4">
        <Boton variante="fantasma" icono={ArrowLeft} className="justify-self-start" onClick={() => setEncuentro(null)}>{grupo.nombre}</Boton>
        <Pasos activo={pasoActivo} />
        <Tarjeta titulo={`Encuentro ${enc.numero} de ${total} · ${grupo.programa_nombre}`} acciones={<Insignia tono={estadoEncuentro(enc)[1]}>{estadoEncuentro(enc)[0]}</Insignia>}>
          <div className="grid gap-3">
            <p className="text-[13px] text-gris-txt">Cada encuentro se entrega <b>siempre</b> con estos 4 archivos. <span className="font-mono text-[12px]">{carpeta}</span></p>
            {elementos.map((el, i) => {
              const a = enc.elementos[el.codigo];
              const formato = el.codigo === 'asistencia' ? FORMATO_LISTA[grupo.programa] : el.codigo === 'informe' ? '1. Informe de actividades' : el.codigo === 'fotos' ? '5. Registro fotográfico de encuentros' : null;
              return (
                <div key={el.codigo} className={`grid gap-2.5 rounded-lg border p-4 ${a ? 'border-ok-borde' : 'border-borde'}`}>
                  <div className="flex items-start gap-3">
                    <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white ${a ? 'bg-ok' : 'bg-marino'}`}>{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[14px] font-bold text-marca">{el.titulo}</h3><Insignia tono={a ? 'ok' : 'neutro'}>{a ? 'Cargado' : 'Falta'}</Insignia></div>
                      <p className="text-[12.5px] text-gris-txt">{DESCRIPCION[el.codigo]}</p>
                      {formato && <p className="text-[12px] text-gris-txt">Formato: <b className="text-marca">{formato}</b> · Archivo: {el.formatos}, hasta {el.mb} MB</p>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-10">
                    {el.codigo === 'fotos' && <EnlaceBoton href={herramienta} target="_blank" rel="noopener noreferrer" tamano="sm" icono={Camera}>Armar registro fotográfico</EnlaceBoton>}
                    <Subir etiqueta={a ? 'Reemplazar' : 'Subir archivo'} variante={a ? 'fantasma' : 'principal'} accept={el.ext.join(',')} ocupado={ocupado}
                      onSubir={([f]) => subir(`${API}/grupos/${grupo.id}/encuentros/${enc.numero}/${el.codigo}`, 'archivo', [f], `${el.titulo} cargado.`)} />
                    {a && <a href={urlArchivo(a.id)} className="inline-flex min-w-0 items-center gap-1 text-[12.5px] font-semibold break-all text-ok-txt underline"><FileDown size={14} aria-hidden="true" className="shrink-0" />{a.nombre} · {tam(a.tamano)}</a>}
                  </div>
                </div>
              );
            })}
            <div className={`grid gap-2.5 rounded-xl border-2 border-dashed p-4 ${completo(enc) ? 'border-ok-borde bg-ok-bg' : 'border-borde bg-lienzo'}`}>
              <h3 className="text-[14px] font-bold text-marca">¿Están los 4 entregables completos?</h3>
              {completo(enc) ? <p className="text-[13px] text-gris-txt">Sí. Se guardan juntos en la carpeta del encuentro.</p> : <>
                <p className="text-[13px] text-gris-txt">Todavía no. Falta:</p>
                <ul className="list-disc pl-5 text-[13px] text-aviso-txt">{elementos.filter((el) => !enc.elementos[el.codigo]).map((el) => <li key={el.codigo}>{el.titulo}</li>)}</ul>
              </>}
              <div className="flex flex-wrap items-center gap-3">
                <Boton icono={FolderCheck} disabled={!completo(enc)} cargando={ocupado} onClick={entregar}>{enc.entregado_en ? 'Actualizar carpeta' : 'Guardar en carpeta de evidencias'}</Boton>
                {enc.entregado_en && <span className="text-[12px] text-gris-txt">Guardado el {fecha(enc.entregado_en)}{enc.entregado_por ? ` por ${enc.entregado_por}` : ''}</span>}
              </div>
            </div>
          </div>
        </Tarjeta>
      </div>
    )}
  </>;
}
