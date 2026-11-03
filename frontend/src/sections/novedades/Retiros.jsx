// Retiros y reemplazos de unidades. El retiro lleva una de las 9 causales y el acta de retiro o desistimiento;
// el reemplazo agrega el concepto del comité y la persona que entra, una por una, con el mismo formulario del
// ingreso del acta de novedades. Cada registro resuelve un ticket de su etapa, y el formulario lista solo los
// de la etapa elegida. También se elige quién sale del personal activo de la unidad. Después de cerrada la
// segunda visita no se puede reemplazar.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileDown, FileSpreadsheet, UserMinus, UserRoundX } from 'lucide-react';
import { apiGeneral } from '../../inventario/lib/api';
import { Alerta, AreaTexto, Boton, Campo, Cargando, Dialogo, Entrada, Insignia, Seleccion, Tarjeta, Vacio, useAvisos } from '../../inventario/componentes/ui';
import SelectorIniciativa from '../../components/SelectorIniciativa';
import { CamposAsociado } from '../../components/AsociadosUP';
import DescargaFormato from '../../components/DescargaFormato';
import { CAUSALES, columnasRetiros, faltasRetiro, filasSelector } from '../../lib/alistamiento';
import { descargarExcel } from '../../lib/exportarExcel';
import { diaColombia } from '../../lib/carrito';
import { asociadoVacio, cargarListasAsociados, erroresAsociado, formularioAAsociado, hoyISO, pedirAsociados } from '../../lib/asociados';
import { ETAPAS_TICKET, listarTickets } from '../../lib/tickets';

// Valores iniciales del formulario de retiro.
const VACIO = { tipo: 'retiro', id_unico: '', id_ticket: '', personal_sale: [], causal: '', observaciones: '', comite_fecha: '', comite_concepto: '' };
const CERRADOS = ['respondido', 'resuelto'];

// Formulario para registrar un retiro o un reemplazo con sus archivos y validaciones.
function FormRetiro({ filas, session, onListo, onCerrar }) {
  const { avisar } = useAvisos();
  const [f, setF] = useState({ ...VACIO, comite_fecha: hoyISO(), persona: asociadoVacio() });
  const [acta, setActa] = useState(null);
  const [actaComite, setActaComite] = useState(null);
  const [tickets, setTickets] = useState(null);
  const [listas, setListas] = useState(null);
  const [personal, setPersonal] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const poner = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }));
  const habilitadas = useMemo(() => filas.filter((x) => x.habilitadas !== '0'), [filas]);
  const reemplazo = f.tipo === 'reemplazo';
  useEffect(() => {
    let vivo = true;
    listarTickets(session).then((t) => { if (vivo) setTickets(t); })
      .catch((err) => { if (vivo) { avisar(err.message, 'error'); setTickets([]); } });
    return () => { vivo = false; };
  }, [session, avisar]);
  useEffect(() => {
    setPersonal(null);
    if (!f.id_unico) return undefined;
    let vivo = true;
    pedirAsociados(f.id_unico).then((d) => { if (vivo) setPersonal((d.asociados || []).filter((a) => a.activo)); })
      .catch((err) => { if (vivo) { avisar(err.message, 'error'); setPersonal([]); } });
    return () => { vivo = false; };
  }, [f.id_unico, avisar]);
  useEffect(() => {
    if (!reemplazo || listas) return undefined;
    let vivo = true;
    cargarListasAsociados().then((l) => { if (vivo) setListas(l); }).catch((err) => { if (vivo) avisar(err.message, 'error'); });
    return () => { vivo = false; };
  }, [reemplazo, listas, avisar]);
  const delTipo = useMemo(() => (tickets || []).filter((t) => t.etapa === f.tipo && t.puede?.resolver && !CERRADOS.includes(t.estado)
    && (!t.id_unico || !f.id_unico || t.id_unico === f.id_unico)), [tickets, f.tipo, f.id_unico]);
  const cambiarTipo = (e) => setF((v) => ({ ...v, tipo: e.target.value, id_ticket: '', personal_sale: [] }));
  const elegidos = f.personal_sale.filter((id) => (personal || []).some((a) => a.id === id));
  const alternar = (id) => setF((v) => ({ ...v, personal_sale: reemplazo ? [id] : v.personal_sale.includes(id) ? v.personal_sale.filter((x) => x !== id) : [...v.personal_sale, id] }));
  const elegirUnidad = (x) => setF((v) => {
    const t = (tickets || []).find((y) => String(y.id) === v.id_ticket);
    return { ...v, id_unico: x.ID_unico, id_ticket: t?.id_unico && t.id_unico !== x.ID_unico ? '' : v.id_ticket };
  });
  const elegirTicket = (e) => {
    const t = (tickets || []).find((y) => String(y.id) === e.target.value);
    setF((v) => ({ ...v, id_ticket: e.target.value, id_unico: t?.id_unico && habilitadas.some((x) => x.ID_unico === t.id_unico) ? t.id_unico : v.id_unico }));
  };
  const faltas = faltasRetiro({ ...f, personal_sale: elegidos }, { acta, actaComite, personalDisponible: personal?.length || 0 });
  const actaMala = acta && !/\.pdf$/i.test(acta.name) ? 'Debe ser un PDF.' : undefined;
  const actaComiteMala = actaComite && !/\.pdf$/i.test(actaComite.name) ? 'Debe ser un PDF.' : undefined;
  const personaTocada = Object.entries(f.persona).some(([k, v]) => v && !(k === 'tipo' && v === 'directo'));
  const erroresPersona = personaTocada ? erroresAsociado(f.persona) : {};
  const enviar = async (e) => {
    e.preventDefault();
    setOcupado(true);
    try {
      const fd = new FormData();
      for (const k of ['id_unico', 'id_ticket', 'causal', 'observaciones']) fd.append(k, f[k]);
      fd.append('personal_sale', JSON.stringify(elegidos));
      fd.append('acta', acta);
      if (reemplazo) {
        for (const k of ['comite_fecha', 'comite_concepto']) fd.append(k, f[k]);
        fd.append('persona_entra', JSON.stringify(formularioAAsociado(f.persona)));
        fd.append('acta_comite', actaComite);
      }
      const r = await apiGeneral.post(reemplazo ? '/retiros/reemplazo' : '/retiros', fd);
      const t = r.item.ticket;
      avisar(reemplazo ? `Reemplazo registrado: sale ${r.item.id_unico} y entra ${r.item.entra}.` : `Retiro de ${r.item.id_unico} registrado.`);
      if (t?.resuelto) avisar(`El ticket ${t.consecutivo} quedó respondido.`);
      else if (t) avisar(`El registro quedó hecho, pero no se pudo responder el ticket ${t.consecutivo}: respóndelo desde Tickets. ${t.motivo || ''}`, 'error');
      onListo();
    } catch (err) {
      avisar(err.message, 'error');
    } finally {
      setOcupado(false);
    }
  };
  return (
    <form className="grid gap-3" onSubmit={enviar}>
      <Campo etiqueta="Qué se registra" obligatorio>
        <Seleccion value={f.tipo} onChange={cambiarTipo}>
          <option value="retiro">Retiro de la unidad</option>
          <option value="reemplazo">Reemplazo: sale una unidad y entra una persona (1 a 1)</option>
        </Seleccion>
      </Campo>
      <Campo etiqueta={`Ticket de la etapa ${ETAPAS_TICKET[f.tipo]}`} obligatorio
        ayuda="Al registrar, este ticket queda vinculado y respondido con una nota del registro.">
        {tickets === null ? <Cargando /> : (
          <Seleccion required value={f.id_ticket} onChange={elegirTicket}>
            <option value="">{delTipo.length ? 'Elige el ticket…' : `No hay tickets abiertos de la etapa ${ETAPAS_TICKET[f.tipo]}`}</option>
            {delTipo.map((t) => <option key={t.id} value={t.id}>{t.consecutivo} · {t.titulo}{t.id_unico ? ` · ${t.id_unico}` : ''}</option>)}
          </Seleccion>
        )}
      </Campo>
      <SelectorIniciativa filas={habilitadas} valor={f.id_unico} onElegir={elegirUnidad} etiqueta="Unidad que sale" />
      {f.id_unico && (
        <fieldset className="grid gap-2 rounded-lg border border-borde p-3">
          <legend className="px-1 text-[13px] font-semibold text-marca">Personal de la unidad que sale <span className="text-rojo-txt">*</span></legend>
          {personal === null ? <Cargando /> : !personal.length ? (
            <p className="text-[13px] text-gris-txt">La unidad no tiene personal activo registrado: no hay a quién elegir.</p>
          ) : (
            <>
              <p className="text-[12px] text-gris-txt">
                {reemplazo ? 'Elige la persona que sale (1 a 1).' : 'Elige una o varias personas.'} Quedan asignadas al ticket.
              </p>
              <ul className="grid gap-1.5">
                {personal.map((a) => (
                  <li key={a.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-borde bg-white px-2.5 py-2 text-[13px] hover:border-acento">
                      <input type={reemplazo ? 'radio' : 'checkbox'} name="personal-sale" className="size-4 accent-[var(--color-acento)]"
                        checked={elegidos.includes(a.id)} onChange={() => alternar(a.id)} />
                      <span className="min-w-0 flex-1 break-words"><strong>{a.nombre}</strong> · {a.documento}</span>
                      {a.es_representante && <Insignia tono="alerta">Representante</Insignia>}
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </fieldset>
      )}
      <Campo etiqueta="Causal (numeral 5.6.4)" obligatorio>
        <Seleccion required value={f.causal} onChange={poner('causal')}>
          <option value="">Elige la causal…</option>
          {Object.entries(CAUSALES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Seleccion>
      </Campo>
      <Campo etiqueta="Observaciones"><AreaTexto rows={2} maxLength={2000} value={f.observaciones} onChange={poner('observaciones')} /></Campo>
      <Campo etiqueta="Acta de retiro o desistimiento (PDF)" obligatorio error={actaMala}>
        <Entrada required type="file" accept="application/pdf,.pdf" aria-invalid={Boolean(actaMala) || undefined} onChange={(e) => setActa(e.target.files?.[0] || null)} />
        <span className="mt-1.5 flex flex-wrap gap-2">
          <DescargaFormato nombre="Acta de Retiro" etiqueta="Descargar formato del acta de retiro" />
          <DescargaFormato nombre="Acta de Novedades" etiqueta="Descargar formato del acta de novedades" />
        </span>
      </Campo>
      {reemplazo && (
        <>
          <fieldset className="grid gap-3 rounded-lg border border-borde p-3">
            <legend className="px-1 text-[13px] font-semibold text-marca">Concepto del Comité Técnico</legend>
            <Alerta tono="info">Solo procede antes de cerrar la Visita 2 (diagnóstico).</Alerta>
            <Campo etiqueta="Fecha del concepto" obligatorio><Entrada required type="date" max={hoyISO()} value={f.comite_fecha} onChange={poner('comite_fecha')} /></Campo>
            <Campo etiqueta="Concepto del Comité Técnico" obligatorio><AreaTexto required rows={3} maxLength={5000} value={f.comite_concepto} onChange={poner('comite_concepto')} /></Campo>
            <Campo etiqueta="Acta del Comité Técnico (PDF)" obligatorio error={actaComiteMala}>
              <Entrada required type="file" accept="application/pdf,.pdf" aria-invalid={Boolean(actaComiteMala) || undefined} onChange={(e) => setActaComite(e.target.files?.[0] || null)} />
            </Campo>
          </fieldset>
          <fieldset className="grid gap-3 rounded-lg border border-borde p-3">
            <legend className="px-1 text-[13px] font-semibold text-marca">Ingreso (1 a 1)</legend>
            <Alerta tono="info">El reemplazo es 1 a 1: sale una unidad y entra una sola persona, con los mismos datos de un ingreso del acta de novedades de asociados.</Alerta>
            <div className="rounded-lg bg-lienzo p-3">
              <p className="mb-3 text-[13px] font-semibold text-marca">Ingreso 1</p>
              <CamposAsociado f={f.persona} set={(persona) => setF((v) => ({ ...v, persona }))} listas={listas} errores={erroresPersona} />
            </div>
          </fieldset>
        </>
      )}
      {faltas.length > 0 && <p className="text-[12px] text-gris-txt">Falta: {faltas.join(' ')}</p>}
      <div className="flex flex-wrap justify-end gap-2"><Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton tipo="submit" icono={UserMinus} cargando={ocupado} disabled={faltas.length > 0 || (Boolean(f.id_unico) && personal === null)}>{reemplazo ? 'Registrar el reemplazo' : 'Registrar el retiro'}</Boton></div>
    </form>
  );
}

// Muestra la lista de retiros y reemplazos y el botón para registrar uno.
export default function Retiros({ session }) {
  const { avisar } = useAvisos();
  const [datos, setDatos] = useState(null);
  const [unidades, setUnidades] = useState(null);
  const [registrando, setRegistrando] = useState(false);
  const puedeRegistrar = session?.role === 'coordinador' || session?.role === 'superadmin' || session?.role === 'coordinador_datos';
  const recargar = useCallback(() => {
    apiGeneral.get('/retiros').then(setDatos).catch((err) => { avisar(err.message, 'error'); setDatos({ items: [] }); });
  }, [avisar]);
  useEffect(() => { recargar(); }, [recargar]);
  const abrir = async () => {
    setRegistrando(true);
    if (!unidades) {
      try { setUnidades((await apiGeneral.get('/unidades')).items || []); } catch (err) { avisar(err.message, 'error'); setUnidades([]); }
    }
  };
  const filas = useMemo(() => filasSelector(unidades), [unidades]);
  const items = datos?.items || [];
  return (
    <div className="grid gap-5">
      <Tarjeta titulo="Retiros y reemplazos de unidades" acciones={
        <div className="flex flex-wrap gap-2">
          {items.length > 0 && <Boton variante="fantasma" icono={FileSpreadsheet} onClick={() => descargarExcel('retiros-unidades', 'Retiros', columnasRetiros(), items)}>Excel</Boton>}
          {puedeRegistrar && <Boton icono={UserMinus} onClick={abrir}>Registrar</Boton>}
        </div>}>
        <Alerta tono="info">El retiro lleva una de las 9 causales del numeral 5.6.4 y el acta de retiro o desistimiento. El reemplazo es 1 a 1: agrega el concepto del Comité Técnico y la persona que entra, y solo procede antes de cerrar la Visita 2. Cada registro resuelve un ticket de la etapa Retiro o Reemplazo.</Alerta>
      </Tarjeta>
      {datos === null ? <Tarjeta><Cargando /></Tarjeta> : !items.length ? <Tarjeta><Vacio icono={UserRoundX}>No hay retiros ni reemplazos registrados.</Vacio></Tarjeta> : (
        <ul className="grid gap-3">
          {items.map((r) => (
            <li key={r.id}>
              <Tarjeta titulo={`${r.tipo === 'reemplazo' ? 'Reemplazo' : 'Retiro'} · ${r.unidad || ''} (${r.id_unico})`} acciones={<Insignia tono={r.tipo === 'reemplazo' ? 'alerta' : 'error'}>{r.nombre_causal}</Insignia>}>
                <div className="grid gap-1.5 text-[13px]">
                  <p className="text-gris-txt">{diaColombia(r.creado_en)} · nodo {r.nodo || '—'} · {r.region || '—'} · registró {r.registrado_por}</p>
                  {r.observaciones && <p className="whitespace-pre-wrap break-words">{r.observaciones}</p>}
                  {r.ticket && <p className="text-gris-txt">Ticket {r.ticket}</p>}
                  {r.personal_sale?.length > 0 && <p className="break-words"><strong>Sale:</strong> {r.personal_sale.map((p) => `${p.nombre} · ${p.documento}`).join('; ')}</p>}
                  {r.tipo === 'reemplazo' && (
                    <p className="break-words">
                      <strong>Entra:</strong> {r.persona_entra ? `${r.persona_entra.nombre} · ${r.persona_entra.documento}` : `${r.id_unico_entra} · ${r.unidad_entra || ''}`}
                      {' · '}<strong>Comité Técnico ({r.comite?.fecha}):</strong> {r.comite?.concepto}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-3">
                    <a href={`/api/retiros/acta?id=${r.id}&cual=retiro`} target="_blank" rel="noopener noreferrer" aria-label={`Acta de retiro de ${r.id_unico}`} className="inline-flex items-center gap-1 font-semibold text-acento-txt underline"><FileDown size={15} aria-hidden="true" />Acta de retiro</a>
                    {r.comite_acta_nombre && <a href={`/api/retiros/acta?id=${r.id}&cual=comite`} target="_blank" rel="noopener noreferrer" aria-label={`Acta del Comité Técnico del reemplazo de ${r.id_unico}`} className="inline-flex items-center gap-1 font-semibold text-acento-txt underline"><FileDown size={15} aria-hidden="true" />Acta del Comité</a>}
                  </div>
                </div>
              </Tarjeta>
            </li>
          ))}
        </ul>
      )}
      <Dialogo abierto={registrando} titulo="Retiro o reemplazo de una unidad" ancho="max-w-2xl" onCerrar={() => setRegistrando(false)}>
        {registrando && (unidades === null ? <Cargando /> : <FormRetiro filas={filas} session={session} onCerrar={() => setRegistrando(false)} onListo={() => { setRegistrando(false); setUnidades(null); recargar(); }} />)}
      </Dialogo>
    </div>
  );
}
