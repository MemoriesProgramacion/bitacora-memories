// Administración del alistamiento: la carga de cada cuenta de campo frente al tope de 50 unidades, el cambio de
// nodo de una unidad, la transferencia metodológica al equipo y la entrega del kit a cada cuenta, con sus
// soportes y asistentes.
import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, FileDown, Package, Presentation } from 'lucide-react';
import {
  Alerta, AreaTexto, Boton, Campo, Cargando, Celda, Dialogo, Entrada, Fila, Insignia, Seleccion, Tabla, Tarjeta, useAvisos,
} from '../inventario/componentes/ui';
import Encabezado from '../inventario/componentes/Encabezado';
import SelectorIniciativa from '../components/SelectorIniciativa';
import { useSession } from '../hooks/useSession';
import { hoyISO } from '../lib/asociados';
import { TIPOS_EVENTO_EQUIPO, faltasEvento, filasSelector, textoCarga } from '../lib/alistamiento';
import { admin } from './apiAdmin';
import { useCarga } from './useCarga';
import { ROLES } from './etiquetas';

// Muestra un archivo adjunto de un evento como enlace.
const Adjunto = ({ a }) => (
  <a href={`/api/alistamiento/eventos/adjunto?id=${a.id}`} target="_blank" rel="noopener noreferrer" aria-label={`${a.clase === 'lista' ? 'Lista de asistencia' : a.clase === 'acta' ? 'Acta' : a.clase === 'presentacion' ? 'Presentación de resultados' : 'Foto'}: ${a.nombre}`}
    className="inline-flex items-center gap-1 text-[12px] font-semibold text-acento-txt underline">
    <FileDown size={13} aria-hidden="true" />{a.clase === 'lista' ? 'Lista' : a.clase === 'acta' ? 'Acta' : a.clase === 'presentacion' ? 'Presentación' : 'Foto'}
  </a>
);

// Campo para elegir un archivo; muestra un error cuando el archivo no es del tipo pedido.
function CampoArchivo({ etiqueta, obligatorio, accept, multiple, onCambio, ayuda, error }) {
  return (
    <Campo etiqueta={etiqueta} obligatorio={obligatorio} ayuda={ayuda} error={error}>
      <Entrada type="file" accept={accept} multiple={multiple} aria-invalid={Boolean(error) || undefined}
        onChange={(e) => onCambio(multiple ? Array.from(e.target.files || []) : (e.target.files?.[0] || null))} />
    </Campo>
  );
}
const noEsPdf = (a) => (a && !/\.pdf$/i.test(a.name) ? 'Debe ser un PDF.' : undefined);
const noSonFotos = (xs) => (xs.some((a) => !/\.(jpe?g|png)$/i.test(a.name)) ? 'Las fotos deben ser JPG o PNG.' : xs.length > 20 ? 'Máximo 20 fotos.' : undefined);

// Muestra la carga de cada cuenta de campo y permite cambiar el nodo de una unidad.
function CargaGestores({ carga, cargando, recargar, puedeMover }) {
  const { avisar } = useAvisos();
  const [moviendo, setMoviendo] = useState(false);
  const [unidades, setUnidades] = useState(null);
  const [f, setF] = useState({ id_unico: '', nodo: '', motivo: '' });
  const [ocupado, setOcupado] = useState(false);
  const gestores = carga?.items || [];
  const filas = useMemo(() => filasSelector(unidades), [unidades]);
  const abrir = async () => {
    setF({ id_unico: '', nodo: '', motivo: '' });
    setMoviendo(true);
    if (!unidades) {
      try { setUnidades((await admin.unidades()).items || []); } catch (err) { avisar(err.message, 'error'); setUnidades([]); }
    }
  };
  const mover = async (e) => {
    e.preventDefault();
    setOcupado(true);
    try {
      const r = await admin.moverUP(f);
      avisar(`La unidad ${r.item.id_unico} pasó al nodo ${r.item.nodo}.`);
      setMoviendo(false);
      setUnidades(null);
      recargar();
    } catch (err) {
      avisar(err.message, 'error');
    } finally {
      setOcupado(false);
    }
  };
  const elegida = filas.find((x) => x.ID_unico === f.id_unico);
  return (
    <Tarjeta titulo="Carga de los gestores" acciones={puedeMover && <Boton icono={ArrowRightLeft} onClick={abrir}>Mover una unidad de nodo</Boton>}>
      <Alerta tono="info">Cada gestor atiende las unidades de su nodo: el máximo es {carga?.tope || 50} habilitadas. El servidor no deja mover una unidad a un nodo cuyo gestor ya está lleno.</Alerta>
      {carga?.sin_nodo > 0 && <Alerta tono="aviso" className="mt-2">{carga.sin_nodo} unidad(es) habilitada(s) sin nodo: asígnales un gestor moviéndolas.</Alerta>}
      <div className="mt-3">
        {cargando && !carga ? <Cargando /> : (
          <Tabla cabeceras={['Gestor', 'Nodo', 'Región', { texto: 'Habilitadas', alinear: 'derecha' }, 'Carga']} vacio="No hay gestores en tu territorio.">
            {gestores.map((g) => {
              const c = textoCarga(g);
              return (
                <Fila key={g.id_gestor}>
                  <Celda><strong>{g.nombre}</strong>{!g.activo && <Insignia tono="neutro"> inactivo</Insignia>}</Celda>
                  <Celda className="font-mono text-[12px]">{g.nodo}</Celda>
                  <Celda className="text-gris-txt">{g.region}</Celda>
                  <Celda alinear="derecha" className="cifras">{g.unidades}{g.registradas > g.unidades ? <span className="text-gris-txt"> ({g.registradas} registradas)</span> : null}</Celda>
                  <Celda>
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="h-2 w-32 max-w-full overflow-hidden rounded-full bg-lienzo" role="progressbar" aria-valuenow={g.unidades} aria-valuemin={0} aria-valuemax={g.tope} aria-label={`Carga de ${g.nombre}`}>
                        <div className="h-full rounded-full" style={{ width: `${c.porcentaje}%`, background: c.tono === 'ok' ? 'var(--color-ok)' : c.tono === 'alerta' ? 'var(--color-acento)' : 'var(--color-rojo)' }} />
                      </div>
                      <Insignia tono={c.tono}>{c.texto}</Insignia>
                    </div>
                  </Celda>
                </Fila>
              );
            })}
          </Tabla>
        )}
      </div>
      <Dialogo abierto={moviendo} titulo="Mover una unidad a otro nodo" onCerrar={() => { if (!ocupado) setMoviendo(false); }} ancho="max-w-xl">
        {moviendo && (
          <form className="grid gap-3" onSubmit={mover}>
            {unidades === null ? <Cargando /> : <SelectorIniciativa filas={filas} valor={f.id_unico} onElegir={(x) => setF((v) => ({ ...v, id_unico: x.ID_unico }))} etiqueta="Unidad productiva" />}
            {elegida && <p className="text-[13px] text-gris-txt">Nodo actual: <strong>{elegida.nodo || 'sin nodo'}</strong>.</p>}
            <Campo etiqueta="Nodo al que pasa" obligatorio>
              <Seleccion required value={f.nodo} onChange={(e) => setF((v) => ({ ...v, nodo: e.target.value }))}>
                <option value="">Elige el nodo…</option>
                {gestores.filter((g) => g.activo).map((g) => {
                  const bloqueado = g.lleno && elegida?.habilitadas !== '0';
                  return <option key={g.id_gestor} value={g.nodo} disabled={bloqueado}>{g.nodo} · {g.nombre} ({g.unidades} de {g.tope}){g.lleno ? ' · lleno' : ''}</option>;
                })}
              </Seleccion>
            </Campo>
            <p className="text-[12px] text-gris-txt">El máximo de 50 por gestor cuenta solo las unidades habilitadas.</p>
            <Campo etiqueta="Motivo" obligatorio><AreaTexto required rows={2} maxLength={1000} value={f.motivo} onChange={(e) => setF((v) => ({ ...v, motivo: e.target.value }))} /></Campo>
            <div className="flex flex-wrap justify-end gap-2"><Boton variante="fantasma" onClick={() => setMoviendo(false)}>Cancelar</Boton>
              <Boton tipo="submit" icono={ArrowRightLeft} cargando={ocupado} disabled={!f.id_unico || !f.nodo || !f.motivo.trim()}>Mover</Boton></div>
          </form>
        )}
      </Dialogo>
    </Tarjeta>
  );
}

// Muestra los eventos de un tipo con sus adjuntos y asistentes.
function ListaEventos({ eventos, vacio }) {
  if (!eventos.length) return <p className="text-[13px] text-gris-txt">{vacio}</p>;
  return (
    <ul className="grid gap-2">
      {eventos.map((e) => (
        <li key={e.id} className="grid min-w-0 gap-1 rounded-lg border border-borde px-3 py-2 text-[13px]">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <strong className="min-w-0 break-words">{e.fecha}{e.lugar ? ` · ${e.lugar}` : ''}{e.gestor ? ` · ${e.gestor} (${e.nodo})` : ''}{e.departamento ? ` · ${e.departamento}` : ''}</strong>
            <span className="text-[12px] text-gris-txt">registró {e.registrado_por}</span>
          </div>
          {e.descripcion && <p className="break-words text-gris-txt">{e.descripcion}</p>}
          {e.datos?.contenido && <p className="break-words"><span className="text-gris-txt">Contenido del kit:</span> {e.datos.contenido}</p>}
          {e.asistentes?.length > 0 && <p className="break-words text-gris-txt">Asistieron ({e.asistentes.length}): {e.asistentes.map((s) => s.nombre || s.ref).join(', ')}</p>}
          <div className="flex flex-wrap gap-3">{(e.adjuntos || []).map((a) => <Adjunto key={a.id} a={a} />)}</div>
        </li>
      ))}
    </ul>
  );
}

// Formulario para registrar un evento con sus archivos y asistentes.
function FormEvento({ tipo, gestores, onListo, onCerrar }) {
  const { avisar } = useAvisos();
  const [f, setF] = useState({ fecha: hoyISO(), lugar: '', descripcion: '', id_gestor: '', contenido: '' });
  const [archivos, setArchivos] = useState({ lista: null, acta: null, fotos: [] });
  const [equipo, setEquipo] = useState(null);
  const [intento, setIntento] = useState(0);
  const [asistentes, setAsistentes] = useState([]);
  const [ocupado, setOcupado] = useState(false);
  const poner = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }));
  useEffect(() => {
    if (tipo !== 'transferencia') return undefined;
    let vivo = true;
    setEquipo(null);
    admin.equipo().then((r) => { if (vivo) setEquipo(r.items || []); })
      .catch((err) => { if (vivo) { avisar(err.message, 'error'); setEquipo('error'); } });
    return () => { vivo = false; };
  }, [tipo, intento, avisar]);
  const faltas = faltasEvento(tipo, f, { ...archivos, asistentes });
  const enviar = async (e) => {
    e.preventDefault();
    setOcupado(true);
    try {
      const fd = new FormData();
      fd.append('tipo', tipo);
      for (const [k, v] of Object.entries(f)) fd.append(k, v);
      if (tipo === 'transferencia') fd.append('asistentes', JSON.stringify(asistentes));
      if (archivos.lista) fd.append('lista', archivos.lista);
      if (archivos.acta) fd.append('acta', archivos.acta);
      for (const x of archivos.fotos) fd.append('fotos', x);
      await admin.registrarEventoEquipo(fd);
      avisar(`${TIPOS_EVENTO_EQUIPO[tipo]} registrada.`);
      onListo();
    } catch (err) {
      avisar(err.message, 'error');
    } finally {
      setOcupado(false);
    }
  };
  const marcar = (sub, si) => setAsistentes((xs) => (si ? [...new Set([...xs, sub])] : xs.filter((x) => x !== sub)));
  return (
    <form className="grid gap-3" onSubmit={enviar}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Fecha" obligatorio><Entrada required type="date" max={hoyISO()} value={f.fecha} onChange={poner('fecha')} /></Campo>
        {tipo === 'kit_gestor' ? (
          <Campo etiqueta="Gestor que recibe el kit" obligatorio>
            <Seleccion required value={f.id_gestor} onChange={poner('id_gestor')}>
              <option value="">Elige el gestor…</option>
              {gestores.filter((g) => g.activo).map((g) => <option key={g.id_gestor} value={g.id_gestor}>{g.nombre} · {g.nodo}</option>)}
            </Seleccion>
          </Campo>
        ) : <Campo etiqueta="Lugar" obligatorio><Entrada required maxLength={300} value={f.lugar} onChange={poner('lugar')} /></Campo>}
      </div>
      {tipo === 'kit_gestor' ? (
        <>
          <Campo etiqueta="Contenido del kit" obligatorio><AreaTexto required rows={2} maxLength={2000} value={f.contenido} onChange={poner('contenido')} /></Campo>
          <CampoArchivo etiqueta="Acta de entrega (PDF)" obligatorio accept="application/pdf,.pdf" error={noEsPdf(archivos.acta)} onCambio={(a) => setArchivos((x) => ({ ...x, acta: a }))} />
        </>
      ) : (
        <>
          <Campo etiqueta="Descripción"><AreaTexto rows={2} maxLength={5000} value={f.descripcion} onChange={poner('descripcion')} /></Campo>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-[13px] font-semibold text-gris-txt">Integrantes del equipo que asistieron <span className="text-rojo-txt" aria-hidden="true">*</span><span className="sr-only"> (obligatorio)</span></legend>
            {equipo === null ? <Cargando /> : equipo === 'error' ? (
              <Alerta tono="error">No se pudo cargar el equipo. <Boton tamano="sm" variante="fantasma" onClick={() => setIntento((n) => n + 1)}>Reintentar</Boton></Alerta>
            ) : !equipo.length ? <Alerta tono="aviso">No hay integrantes activos del equipo para marcar: créalos en Administración › Usuarios.</Alerta> : (
              <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-borde p-2 sm:grid-cols-2">
                {equipo.map((p) => (
                  <label key={p.sub} className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" className="size-4 accent-[var(--color-acento)]" checked={asistentes.includes(p.sub)} onChange={(e) => marcar(p.sub, e.target.checked)} />
                    <span className="min-w-0 break-words">{p.nombre} <span className="text-gris-txt">· {ROLES[p.rol] || p.rol}{p.region ? ` · ${p.region}` : ''}</span></span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <CampoArchivo etiqueta="Lista de asistencia (PDF)" obligatorio accept="application/pdf,.pdf" error={noEsPdf(archivos.lista)} onCambio={(a) => setArchivos((x) => ({ ...x, lista: a }))} />
          <CampoArchivo etiqueta="Registro fotográfico (JPG o PNG)" obligatorio multiple accept="image/jpeg,image/png,.jpg,.jpeg,.png" ayuda="Hasta 20 fotos de máximo 5 MB."
            error={noSonFotos(archivos.fotos)} onCambio={(xs) => setArchivos((x) => ({ ...x, fotos: xs }))} />
        </>
      )}
      {faltas.length > 0 && <p className="text-[12px] text-gris-txt">Falta: {faltas.join(' ')}</p>}
      <div className="flex flex-wrap justify-end gap-2"><Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton tipo="submit" cargando={ocupado} disabled={faltas.length > 0}>Registrar</Boton></div>
    </form>
  );
}

// Pantalla que reúne la carga, los eventos de transferencia y las entregas de kit.
export default function Alistamiento() {
  const { session } = useSession();
  const esGeneral = session?.role === 'superadmin' || session?.role === 'coordinador_datos';
  const puedeRegistrar = esGeneral || session?.role === 'coordinador';
  const carga = useCarga(() => admin.cargaGestores(), []);
  const eventos = useCarga(() => admin.eventosEquipo(), []);
  const [registrando, setRegistrando] = useState(null);
  const lista = (tipo) => (eventos.datos?.items || []).filter((e) => e.tipo === tipo);

  return (
    <>
      <Encabezado titulo="Alistamiento" descripcion="Carga de los gestores (máximo 50 unidades), transferencia metodológica al equipo y entrega del kit a cada gestor." />
      <div className="grid gap-5">
        <CargaGestores carga={carga.datos} cargando={carga.cargando} recargar={carga.recargar} puedeMover={puedeRegistrar} />
        <Tarjeta titulo="Transferencia metodológica al equipo" acciones={esGeneral && <Boton icono={Presentation} onClick={() => setRegistrando('transferencia')}>Registrar el evento</Boton>}>
          {eventos.cargando && !eventos.datos ? <Cargando /> : <ListaEventos eventos={lista('transferencia')} vacio="Todavía no se registra la transferencia metodológica al equipo (la registra el Coordinador general)." />}
        </Tarjeta>
        <Tarjeta titulo="Entrega del kit a los gestores" acciones={puedeRegistrar && <Boton icono={Package} onClick={() => setRegistrando('kit_gestor')}>Registrar una entrega</Boton>}>
          {eventos.cargando && !eventos.datos ? <Cargando /> : <ListaEventos eventos={lista('kit_gestor')} vacio="Ningún gestor tiene registrada la entrega de su kit." />}
        </Tarjeta>
      </div>
      <Dialogo abierto={Boolean(registrando)} titulo={registrando ? TIPOS_EVENTO_EQUIPO[registrando] : ''} ancho="max-w-2xl" onCerrar={() => setRegistrando(null)}>
        {registrando && <FormEvento tipo={registrando} gestores={carga.datos?.items || []} onCerrar={() => setRegistrando(null)} onListo={() => { setRegistrando(null); eventos.recargar(); }} />}
      </Dialogo>
    </>
  );
}
