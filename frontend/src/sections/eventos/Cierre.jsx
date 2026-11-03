// Cierre por departamento: el evento de cierre de cada departamento con la lista de asistencia, el registro
// fotográfico, la presentación de resultados y las unidades que asistieron, que quedan en la ficha de cada una.
// Lo registra la coordinación de su territorio y los demás lo consultan.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileDown, Flag } from 'lucide-react';
import { apiGeneral } from '../../inventario/lib/api';
import { Alerta, AreaTexto, Boton, Campo, Cargando, Dialogo, Entrada, Seleccion, Tarjeta, Vacio, useAvisos } from '../../inventario/componentes/ui';
import { useSession } from '../../hooks/useSession';
import { departamentosDe, faltasEvento } from '../../lib/alistamiento';
import { hoyISO } from '../../lib/asociados';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
// Indica si el archivo elegido no es un PDF.
const noEsPdf = (a) => (a && !/\.pdf$/i.test(a.name) ? 'Debe ser un PDF.' : undefined);
// Indica si los archivos elegidos no son fotos.
const noSonFotos = (xs) => (xs.some((a) => !/\.(jpe?g|png)$/i.test(a.name)) ? 'Las fotos deben ser JPG o PNG.' : xs.length > 20 ? 'Máximo 20 fotos.' : undefined);

// Formulario para registrar el cierre con sus archivos y las unidades asistentes.
function FormCierre({ unidades, onListo, onCerrar }) {
  const { avisar } = useAvisos();
  const [f, setF] = useState({ fecha: hoyISO(), lugar: '', descripcion: '', departamento: '' });
  const [archivos, setArchivos] = useState({ lista: null, presentacion: null, fotos: [] });
  const [asistentes, setAsistentes] = useState([]);
  const [ocupado, setOcupado] = useState(false);
  const poner = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }));
  const departamentos = useMemo(() => departamentosDe(unidades), [unidades]);
  const delDepartamento = useMemo(() => unidades.filter((u) => u.up_habilitada !== false && norm(u.up_departamento) === norm(f.departamento)), [unidades, f.departamento]);
  const faltas = faltasEvento('cierre', f, { ...archivos, asistentes });
  const marcar = (id, si) => setAsistentes((xs) => (si ? [...new Set([...xs, id])] : xs.filter((x) => x !== id)));
  const enviar = async (e) => {
    e.preventDefault();
    setOcupado(true);
    try {
      const fd = new FormData();
      fd.append('tipo', 'cierre');
      for (const [k, v] of Object.entries(f)) fd.append(k, v);
      fd.append('asistentes', JSON.stringify(asistentes));
      fd.append('lista', archivos.lista);
      fd.append('presentacion', archivos.presentacion);
      for (const x of archivos.fotos) fd.append('fotos', x);
      await apiGeneral.post('/alistamiento/eventos', fd);
      avisar(`Cierre de ${f.departamento} registrado con ${asistentes.length} unidad(es).`);
      onListo();
    } catch (err) {
      avisar(err.message, 'error');
    } finally {
      setOcupado(false);
    }
  };
  return (
    <form className="grid gap-3" onSubmit={enviar}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo etiqueta="Departamento" obligatorio>
          <Seleccion required value={f.departamento} onChange={(e) => { setAsistentes([]); poner('departamento')(e); }}>
            <option value="">Elige…</option>
            {departamentos.map((d) => <option key={d} value={d}>{d}</option>)}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Fecha" obligatorio><Entrada required type="date" max={hoyISO()} value={f.fecha} onChange={poner('fecha')} /></Campo>
        <Campo etiqueta="Lugar" obligatorio><Entrada required maxLength={300} value={f.lugar} onChange={poner('lugar')} /></Campo>
      </div>
      <Campo etiqueta="Descripción"><AreaTexto rows={2} maxLength={5000} value={f.descripcion} onChange={poner('descripcion')} /></Campo>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-[13px] font-semibold text-gris-txt">Unidades que asistieron ({asistentes.length}) <span className="text-rojo-txt" aria-hidden="true">*</span><span className="sr-only"> (obligatorio)</span></legend>
        {!f.departamento ? <p className="text-[13px] text-gris-txt">Elige el departamento para ver sus unidades.</p>
          : !delDepartamento.length ? <p className="text-[13px] text-gris-txt">No hay unidades habilitadas de {f.departamento} en tu alcance.</p> : (
            <>
              <div className="flex gap-2">
                <Boton tamano="sm" variante="fantasma" onClick={() => setAsistentes(delDepartamento.map((u) => u.id_unico))}>Marcar todas</Boton>
                <Boton tamano="sm" variante="fantasma" onClick={() => setAsistentes([])}>Ninguna</Boton>
              </div>
              <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-borde p-2 sm:grid-cols-2">
                {delDepartamento.map((u) => (
                  <label key={u.id_unico} className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" className="size-4 accent-[var(--color-acento)]" checked={asistentes.includes(u.id_unico)} onChange={(e) => marcar(u.id_unico, e.target.checked)} />
                    <span className="min-w-0 break-words">{u.id_unico} · {u.up_nombre}{u.up_municipio ? ` · ${u.up_municipio}` : ''}</span>
                  </label>
                ))}
              </div>
            </>
          )}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Lista de asistencia (PDF)" obligatorio error={noEsPdf(archivos.lista)}>
          <Entrada required type="file" accept="application/pdf,.pdf" aria-invalid={Boolean(noEsPdf(archivos.lista)) || undefined} onChange={(e) => setArchivos((x) => ({ ...x, lista: e.target.files?.[0] || null }))} />
        </Campo>
        <Campo etiqueta="Presentación de resultados (PDF)" obligatorio error={noEsPdf(archivos.presentacion)}>
          <Entrada required type="file" accept="application/pdf,.pdf" aria-invalid={Boolean(noEsPdf(archivos.presentacion)) || undefined} onChange={(e) => setArchivos((x) => ({ ...x, presentacion: e.target.files?.[0] || null }))} />
        </Campo>
      </div>
      <Campo etiqueta="Registro fotográfico (JPG o PNG)" obligatorio ayuda="Hasta 20 fotos de máximo 5 MB." error={noSonFotos(archivos.fotos)}>
        <Entrada required type="file" multiple accept="image/jpeg,image/png,.jpg,.jpeg,.png" aria-invalid={Boolean(noSonFotos(archivos.fotos)) || undefined} onChange={(e) => setArchivos((x) => ({ ...x, fotos: Array.from(e.target.files || []) }))} />
      </Campo>
      {faltas.length > 0 && <p className="text-[12px] text-gris-txt">Falta: {faltas.join(' ')}</p>}
      <div className="flex flex-wrap justify-end gap-2"><Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton tipo="submit" icono={Flag} cargando={ocupado} disabled={faltas.length > 0}>Registrar el cierre</Boton></div>
    </form>
  );
}

// Muestra un archivo adjunto del cierre como enlace.
const Adjunto = ({ a, fecha }) => (
  <a href={`/api/alistamiento/eventos/adjunto?id=${a.id}`} target="_blank" rel="noopener noreferrer" aria-label={`${a.clase === 'lista' ? 'Lista de asistencia' : a.clase === 'presentacion' ? 'Presentación de resultados' : 'Foto'} del cierre del ${fecha}: ${a.nombre}`}
    className="inline-flex items-center gap-1 text-[12px] font-semibold text-acento-txt underline">
    <FileDown size={13} aria-hidden="true" />{a.clase === 'lista' ? 'Lista de asistencia' : a.clase === 'presentacion' ? 'Presentación' : 'Foto'}
  </a>
);

// Muestra los cierres registrados y el formulario para crear uno.
export default function Cierre() {
  const { session } = useSession();
  const { avisar } = useAvisos();
  const [items, setItems] = useState(null);
  const [unidades, setUnidades] = useState(null);
  const [registrando, setRegistrando] = useState(false);
  const puedeRegistrar = ['coordinador', 'superadmin', 'coordinador_datos'].includes(session?.role);
  const recargar = useCallback(() => {
    apiGeneral.get('/alistamiento/eventos?tipo=cierre').then((r) => setItems(r.items || [])).catch((err) => { avisar(err.message, 'error'); setItems([]); });
  }, [avisar]);
  useEffect(() => { recargar(); }, [recargar]);
  const abrir = async () => {
    setRegistrando(true);
    if (!unidades) {
      try { setUnidades((await apiGeneral.get('/unidades')).items || []); } catch (err) { avisar(err.message, 'error'); setUnidades([]); }
    }
  };
  return (
    <div className="grid gap-4">
      <Tarjeta titulo="Eventos de cierre por departamento" acciones={puedeRegistrar && <Boton icono={Flag} onClick={abrir}>Registrar un cierre</Boton>}>
        <Alerta tono="info">Cada departamento cierra con un evento que presenta los resultados: se registran la lista de asistencia, las fotos, la presentación y las unidades que asistieron (queda en la ficha de cada una).</Alerta>
      </Tarjeta>
      {items === null ? <Tarjeta><Cargando /></Tarjeta> : !items.length ? <Tarjeta><Vacio icono={Flag}>No hay eventos de cierre registrados.</Vacio></Tarjeta> : items.map((e) => (
        <Tarjeta key={e.id} titulo={`${e.departamento} · ${e.fecha}`}>
          <div className="grid gap-1.5 text-[13px]">
            <p className="text-gris-txt">{e.lugar} · registró {e.registrado_por}</p>
            {e.descripcion && <p className="whitespace-pre-wrap break-words">{e.descripcion}</p>}
            <p className="break-words"><strong>Asistieron {e.asistentes.length} unidad(es):</strong> {e.asistentes.map((s) => `${s.ref}${s.nombre ? ` (${s.nombre})` : ''}`).join(', ')}</p>
            <div className="flex flex-wrap gap-3">{e.adjuntos.map((a) => <Adjunto key={a.id} a={a} fecha={e.fecha} />)}</div>
          </div>
        </Tarjeta>
      ))}
      <Dialogo abierto={registrando} titulo="Evento de cierre por departamento" ancho="max-w-2xl" onCerrar={() => setRegistrando(false)}>
        {registrando && (unidades === null ? <Cargando /> : <FormCierre unidades={unidades} onCerrar={() => setRegistrando(false)} onListo={() => { setRegistrando(false); setUnidades(null); recargar(); }} />)}
      </Dialogo>
    </div>
  );
}
