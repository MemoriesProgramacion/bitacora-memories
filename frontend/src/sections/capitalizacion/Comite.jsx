// Comité de aprobación. Quien tiene permiso registra la sesión con su fecha, los 3 integrantes (2 de
// Prosperidad Social y 1 de INNPULSA), el acta en PDF y la calificación de 1 a 5 de cada integrante a cada plan
// viable o subsanado. Con promedio de 3 o más el plan queda aprobado; si no, queda en subsanación con 4 días
// hábiles.
import { useCallback, useEffect, useState } from 'react';
import { FileDown, Gavel, Users } from 'lucide-react';
import { apiGeneral } from '../../inventario/lib/api';
import { AreaTexto, Alerta, Boton, Campo, Cargando, Dialogo, Entrada, Insignia, Seleccion, Tarjeta, Vacio, useAvisos } from '../../inventario/componentes/ui';
import { ENTIDADES_COMITE, integrantesValidos, promedioComite } from '../../lib/carrito';
import { hoyISO } from '../../lib/asociados';
import { esGeneral } from '../../lib/permisos';

// Integrantes del comité con su entidad.
const INTEGRANTES = [
  { nombre: '', entidad: 'Prosperidad Social' },
  { nombre: '', entidad: 'Prosperidad Social' },
  { nombre: '', entidad: 'INNPULSA' },
];

// Formulario para registrar una sesión del comité con sus calificaciones.
function FormComite({ onListo, onCerrar }) {
  const { avisar } = useAvisos();
  const [planes, setPlanes] = useState(null);
  const [fecha, setFecha] = useState(hoyISO());
  const [integrantes, setIntegrantes] = useState(INTEGRANTES.map((x) => ({ ...x })));
  const [notas, setNotas] = useState({});
  const [archivo, setArchivo] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    apiGeneral.get('/comites/planes').then((r) => setPlanes(r.items || []))
      .catch((err) => { avisar(err.message, 'error'); setPlanes([]); });
  }, [avisar]);

  const nota = (id) => notas[id] || { incluir: false, calificaciones: ['', '', ''], observacion: '' };
  const cambiarNota = (id, cambio) => setNotas((n) => ({ ...n, [id]: { ...nota(id), ...cambio } }));
  const elegidos = (planes || []).filter((p) => nota(p.id_unico).incluir);
  const completos = elegidos.length > 0 && elegidos.every((p) => promedioComite(nota(p.id_unico).calificaciones));
  const pdfMalo = !!archivo && !/\.pdf$/i.test(archivo.name);
  const listo = integrantesValidos(integrantes) && completos && archivo && !pdfMalo;

  const enviar = async (e) => {
    e.preventDefault();
    setOcupado(true);
    try {
      const cuerpo = new FormData();
      cuerpo.append('fecha', fecha);
      cuerpo.append('integrantes', JSON.stringify(integrantes.map((x) => ({ nombre: x.nombre.trim(), entidad: x.entidad }))));
      cuerpo.append('planes', JSON.stringify(elegidos.map((p) => {
        const n = nota(p.id_unico);
        return { id_unico: p.id_unico, calificaciones: n.calificaciones.map(Number), observacion: n.observacion.trim() };
      })));
      cuerpo.append('archivo', archivo);
      const r = await apiGeneral.post('/comites', cuerpo);
      const aprobados = r.item.planes.filter((p) => p.resultado === 'aprobado').length;
      avisar(`Comité registrado: ${aprobados} aprobado(s) y ${r.item.planes.length - aprobados} en subsanación.`);
      onListo();
    } catch (err) {
      avisar(err.message, 'error');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <form className="grid gap-4" onSubmit={enviar}>
      <Campo etiqueta="Fecha del comité" obligatorio><Entrada required type="date" max={hoyISO()} value={fecha} onChange={(e) => setFecha(e.target.value)} /></Campo>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[13px] font-semibold text-marca">Integrantes (2 de Prosperidad Social y 1 de INNPULSA)</legend>
        {integrantes.map((x, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_12rem]">
            <Entrada required aria-label={`Nombre del integrante ${i + 1}`} placeholder={`Integrante ${i + 1}`} maxLength={200} value={x.nombre}
              onChange={(e) => setIntegrantes((xs) => xs.map((y, k) => (k === i ? { ...y, nombre: e.target.value } : y)))} />
            <Seleccion aria-label={`Entidad del integrante ${i + 1}`} value={x.entidad}
              onChange={(e) => setIntegrantes((xs) => xs.map((y, k) => (k === i ? { ...y, entidad: e.target.value } : y)))}>
              {ENTIDADES_COMITE.map((en) => <option key={en} value={en}>{en}</option>)}
            </Seleccion>
          </div>
        ))}
        {integrantes.every((x) => x.nombre.trim()) && !integrantesValidos(integrantes) && (
          <p className="text-[12px] font-semibold text-rojo-txt">Deben ser 2 de Prosperidad Social y 1 de INNPULSA.</p>
        )}
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[13px] font-semibold text-marca">Planes presentados (viables o subsanados)</legend>
        {planes === null ? <Cargando /> : !planes.length ? <p className="text-[13px] text-gris-txt">No hay planes viables ni subsanados esperando el comité.</p> : (
          <ul className="grid gap-2">
            {planes.map((p) => {
              const n = nota(p.id_unico);
              const r = promedioComite(n.calificaciones);
              const sinFormacion = !p.formacion?.cumple;
              return (
                <li key={p.id_unico} className="grid min-w-0 gap-2 rounded-lg border border-borde p-3 text-[13px]">
                  <label className="flex min-w-0 items-start gap-2">
                    <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-acento)]" checked={n.incluir} disabled={sinFormacion}
                      onChange={(e) => cambiarNota(p.id_unico, { incluir: e.target.checked })} />
                    <span className="min-w-0 break-words">
                      <strong>{p.id_unico}</strong> · {p.nombre} · {p.region || '—'} · {p.nodo || '—'} · {p.estado === 'subsanado' ? 'Subsanado' : 'Viable'}
                      {' · '}<span className={sinFormacion ? 'font-semibold text-rojo-txt' : 'text-ok-txt'}>formación {p.formacion?.porcentaje ?? 0} %{sinFormacion ? ' (no alcanza el 80 %)' : ''}</span>
                    </span>
                  </label>
                  {n.incluir && (
                    <fieldset className="grid gap-2 sm:grid-cols-[repeat(3,7rem)_1fr] sm:items-end">
                      <legend className="sr-only">Calificaciones de {p.id_unico} · {p.nombre}</legend>
                      {n.calificaciones.map((cal, i) => (
                        <Campo key={i} etiqueta={integrantes[i].nombre.trim() || `Integrante ${i + 1}`} obligatorio>
                          <Seleccion required value={cal} onChange={(e) => cambiarNota(p.id_unico, { calificaciones: n.calificaciones.map((x, k) => (k === i ? e.target.value : x)) })}>
                            <option value="">—</option>{[1, 2, 3, 4, 5].map((v) => <option key={v} value={v}>{v}</option>)}
                          </Seleccion>
                        </Campo>
                      ))}
                      <p className="sm:pb-2">{r ? <>Promedio {r.promedio} · <Insignia tono={r.aprobado ? 'ok' : 'error'}>{r.aprobado ? 'Aprobado' : 'A subsanación'}</Insignia></> : <span className="text-gris-txt">Falta calificar.</span>}</p>
                      <Campo etiqueta="Observación" className="sm:col-span-4"><AreaTexto rows={2} maxLength={1000} value={n.observacion} onChange={(e) => cambiarNota(p.id_unico, { observacion: e.target.value })} /></Campo>
                    </fieldset>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>
      <Campo etiqueta="Acta del comité (PDF)" obligatorio error={pdfMalo ? 'El acta debe ser un PDF.' : undefined}>
        <Entrada required type="file" accept="application/pdf,.pdf" aria-invalid={pdfMalo || undefined} onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
      </Campo>
      <div className="flex flex-wrap justify-end gap-2">
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton tipo="submit" icono={Gavel} cargando={ocupado} disabled={!listo}>Registrar el comité</Boton>
      </div>
    </form>
  );
}

// Muestra las sesiones y el formulario para registrarlas.
export default function Comite({ session }) {
  const { avisar } = useAvisos();
  const [items, setItems] = useState(null);
  const [registrando, setRegistrando] = useState(false);
  const recargar = useCallback(() => {
    apiGeneral.get('/comites').then((r) => setItems(r.items || []))
      .catch((err) => { avisar(err.message, 'error'); setItems([]); });
  }, [avisar]);
  useEffect(() => { recargar(); }, [recargar]);
  const general = esGeneral(session);

  return (
    <div className="grid gap-5">
      <Tarjeta titulo="Comité de aprobación" acciones={general && <Boton icono={Gavel} onClick={() => setRegistrando(true)}>Registrar una sesión</Boton>}>
        <Alerta tono="info">Cada integrante califica el plan de 1 a 5. Con promedio de 3 o más queda aprobado; si no, la unidad tiene 4 días hábiles para subsanarlo. Solo se presentan planes viables con el 80 % de formación.</Alerta>
      </Tarjeta>
      {items === null ? <Tarjeta><Cargando /></Tarjeta> : !items.length ? <Tarjeta><Vacio icono={Users}>No hay sesiones del comité registradas.</Vacio></Tarjeta> : items.map((c) => (
        <Tarjeta key={c.id} titulo={`Comité del ${c.fecha}`}
          acciones={<a href={`/api/comites/acta?id=${c.id}`} target="_blank" rel="noopener noreferrer" aria-label={`Acta del comité del ${c.fecha}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-acento-txt underline"><FileDown size={15} aria-hidden="true" />Acta</a>}>
          <div className="grid gap-3 text-[13px]">
            <p className="break-words text-gris-txt">Integrantes: {c.integrantes.map((x) => `${x.nombre} (${x.entidad})`).join(' · ')} · registró {c.registrado_por}</p>
            {!c.planes.length && <p className="text-gris-txt">La sesión no tiene planes que puedas ver.</p>}
            <ul className="grid gap-1.5">
              {c.planes.map((p) => (
                <li key={p.id_unico} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-borde px-3 py-2">
                  <span className="min-w-0 break-words"><strong>{p.id_unico}</strong> · {p.nombre} · calificaciones {p.calificaciones.join(', ')} · promedio {p.promedio}{p.observacion ? ` · ${p.observacion}` : ''}</span>
                  <Insignia tono={p.resultado === 'aprobado' ? 'ok' : 'error'}>{p.resultado === 'aprobado' ? 'Aprobado' : 'No aprobado'}</Insignia>
                </li>
              ))}
            </ul>
          </div>
        </Tarjeta>
      ))}
      <Dialogo abierto={registrando} titulo="Sesión del comité de aprobación" ancho="max-w-3xl" onCerrar={() => setRegistrando(false)}>
        {registrando && <FormComite onCerrar={() => setRegistrando(false)} onListo={() => { setRegistrando(false); recargar(); }} />}
      </Dialogo>
    </div>
  );
}
