// Convocatoria de un taller por unidad: muestra si el correo salió y las llamadas de confirmación, que se
// agendan, se marcan como contestadas o no y, si contestó, indican si asistirá y si asistirá alguna persona con
// discapacidad.
import { useState } from 'react';
import { CalendarPlus, Mail, PhoneCall, PhoneIncoming, PhoneMissed, Send } from 'lucide-react';
import { apiGeneral } from '../../inventario/lib/api';
import { useCarga } from '../../admin/useCarga';
import { useAccion } from '../../inventario/lib/useDatos';
import { Alerta, AreaTexto, Boton, Campo, Cargando, Dialogo, Entrada, Insignia, Seleccion, Tarjeta } from '../../inventario/componentes/ui';
import { telefonoLegible } from '../../lib/agenda';
import DialogoLlamar from '../agenda/DialogoLlamar';
import { fechaColombia, fechaInput, inicioISO } from './fechas';
import { moduloLimite, textoModulo } from './confirmacion';

const CORREO = {
  enviado: ['ok', 'Correo enviado'], pendiente: ['alerta', 'Correo pendiente'], enviando: ['alerta', 'Correo enviándose'],
  fallido: ['error', 'El correo falló'], vencido: ['error', 'El correo venció sin salir'],
};
const SITUACION = {
  por_llamar: ['neutro', 'Por llamar'], agendada: ['alerta', 'Llamada agendada'], no_contesto: ['error', 'No contestó'],
  vencida: ['error', 'Llamada vencida sin resultado'], sin_efecto: ['neutro', 'Llamada sin efecto'],
  asistira: ['ok', 'Asistirá'], no_asistira: ['error', 'No asistirá'],
};
const ESTADO_LLAMADA = { agendada: 'Agendada', contesto: 'Contestó', no_contesto: 'No contestó', cancelada: 'Cancelada' };
const FILTROS = [['todas', 'Todas'], ['por_llamar', 'Por llamar'], ['agendada', 'Agendadas'], ['vencida', 'Vencidas'], ['no_contesto', 'No contestaron'], ['asistira', 'Asistirán'], ['no_asistira', 'No asistirán'], ['sin_efecto', 'Sin efecto']];

const enUnaHora = () => { const d = new Date(Date.now() + 60 * 60_000); d.setMinutes(0, 0, 0); return fechaInput(d.toISOString()); };
// Opciones del módulo de la llamada: todo el taller o uno de sus módulos con su fecha; al agendar, los módulos
// ya realizados no se ofrecen.
function SelectorModulo({ taller, valor, onCambio, pendientes = false }) {
  return (
    <Campo etiqueta="¿Para qué módulo?" ayuda="La confirmación se ve en la lista de asistencia de ese módulo (o de los tres).">
      <Seleccion value={valor} onChange={(e) => onCambio(e.target.value)}>
        <option value="">Todo el taller (los 3 módulos)</option>
        {taller.encuentros.map((e) => <option key={e.modulo} value={e.modulo} disabled={pendientes && Boolean(e.realizado_en)}>
          Módulo {e.modulo} · {fechaColombia(e.inicio)}{e.realizado_en ? ' · ya realizado' : ''}</option>)}
      </Seleccion>
    </Campo>
  );
}

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// Muestra la convocatoria de un taller con sus filtros y la lista de unidades.
export default function ConvocatoriaTaller({ taller, recargarTaller }) {
  const { datos, cargando, recargar } = useCarga(() => apiGeneral.get(`/talleres/${taller.id}/convocatoria`), [taller.id]);
  const { ejecutar, ocupado } = useAccion(recargar);
  const [filtro, setFiltro] = useState('todas');
  const [llamarA, setLlamarA] = useState(null);
  const [agendarA, setAgendarA] = useState(null);
  const [resultadoDe, setResultadoDe] = useState(null);

  if (!datos) return <Tarjeta titulo="Convocatoria: correo y llamadas">{cargando ? <Cargando /> : <Alerta tono="error">No se pudo cargar la convocatoria. <Boton variante="fantasma" onClick={recargar}>Reintentar</Boton></Alerta>}</Tarjeta>;
  const r = datos.resumen;
  const visibles = datos.items.filter((i) => filtro === 'todas' || i.situacion === filtro);
  const reenviar = () => ejecutar(async () => { const x = await apiGeneral.post(`/talleres/${taller.id}/convocar`, {}); recargarTaller?.(); return x; });

  return (
    <Tarjeta titulo="Convocatoria: correo y llamadas"
      acciones={<Boton tamano="sm" variante="fantasma" icono={Send} cargando={ocupado} onClick={reenviar}>Reenviar convocatoria</Boton>}>
      <div className="grid gap-4">
        <p className="text-[13px] text-gris-txt">
          Verifica que el correo de la convocatoria llegó a cada UP y confirma por llamada: agenda la llamada, registra si contestó y, si contestó, si asistirá y si asistirá alguna persona con discapacidad.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[13px]"><Mail size={16} aria-hidden="true" className="text-gris-txt" />
            <Insignia tono="ok">{plural(r.correo.enviados, 'enviado', 'enviados')}</Insignia>
            {r.correo.pendientes > 0 && <Insignia tono="alerta">{plural(r.correo.pendientes, 'pendiente', 'pendientes')}</Insignia>}
            {r.correo.fallidos > 0 && <Insignia tono="error">{plural(r.correo.fallidos, 'fallido', 'fallidos')}</Insignia>}
            {r.correo.sin_correo > 0 && <Insignia>{r.correo.sin_correo} sin correo</Insignia>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[13px]"><PhoneCall size={16} aria-hidden="true" className="text-gris-txt" />
            <Insignia tono="ok">{r.llamadas.asistira} asistirán</Insignia>
            {r.llamadas.no_asistira > 0 && <Insignia tono="error">{r.llamadas.no_asistira} no asistirán</Insignia>}
            {r.llamadas.no_contesto > 0 && <Insignia tono="error">{r.llamadas.no_contesto} no contestaron</Insignia>}
            {r.llamadas.agendada > 0 && <Insignia tono="alerta">{plural(r.llamadas.agendada, 'agendada', 'agendadas')}</Insignia>}
            {r.llamadas.vencida > 0 && <Insignia tono="error">{plural(r.llamadas.vencida, 'vencida', 'vencidas')} sin resultado</Insignia>}
            <Insignia>{r.llamadas.por_llamar} por llamar</Insignia>
            {r.con_discapacidad > 0 && <Insignia tono="alerta">{r.con_discapacidad} con discapacidad</Insignia>}
          </div>
        </div>
        <Campo etiqueta="Mostrar" className="max-w-xs">
          <Seleccion value={filtro} onChange={(e) => setFiltro(e.target.value)}>
            {FILTROS.map(([id, t]) => <option key={id} value={id}>{t}{id === 'todas' ? '' : ` (${r.llamadas[id]})`}</option>)}
          </Seleccion>
        </Campo>
        {!visibles.length ? <p className="text-[13px] text-gris-txt">Ninguna UP en «{FILTROS.find(([id]) => id === filtro)[1]}».</p> : (
          <ul className="grid gap-2">
            {visibles.map((i) => <FilaUP key={i.id_up} i={i} ocupado={ocupado}
              onLlamar={() => setLlamarA(i)} onAgendar={(llamada) => setAgendarA({ up: i, llamada })} onResultado={(llamada) => setResultadoDe({ up: i, llamada })}
              onCancelar={(l) => { if (window.confirm('¿Cancelar esta llamada agendada?')) ejecutar(() => apiGeneral.patch(`/talleres/${taller.id}/convocatoria/llamadas/${l.id}`, { estado: 'cancelada' })); }} />)}
          </ul>
        )}
      </div>
      <DialogoLlamar abierto={Boolean(llamarA)} nombre={llamarA?.representante} telefonos={llamarA?.telefonos || []} onCerrar={() => setLlamarA(null)} />
      {agendarA && <DialogoAgendar taller={taller} {...agendarA} ocupado={ocupado} ejecutar={ejecutar} onCerrar={() => setAgendarA(null)} />}
      {resultadoDe && <DialogoResultado taller={taller} {...resultadoDe} ocupado={ocupado} ejecutar={ejecutar} onCerrar={() => setResultadoDe(null)} />}
    </Tarjeta>
  );
}

// Muestra una unidad con su correo, sus llamadas y sus acciones.
function FilaUP({ i, ocupado, onLlamar, onAgendar, onResultado, onCancelar }) {
  const agendada = i.llamadas.find((l) => l.estado === 'agendada');
  const ultima = i.llamadas.find((l) => l.estado !== 'cancelada');
  const [tonoS, textoS] = SITUACION[i.situacion];
  const [tonoC, textoC] = i.correo ? (CORREO[i.correo.estado] || ['neutro', i.correo.estado]) : ['neutro', i.tiene_correo ? 'Sin correo de convocatoria' : 'Sin correo registrado'];
  const intentosSinRespuesta = i.llamadas.filter((l) => l.estado === 'no_contesto').length;
  return (
    <li className="grid min-w-0 gap-2 rounded-lg border border-borde p-3 text-[13px]">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <span className="min-w-0">
          <strong className="block break-words">{i.id_unico} · {i.nombre}</strong>
          <span className="block text-xs text-gris-txt">{i.representante || 'Sin representante'}</span>
        </span>
        <span className="flex flex-wrap gap-1.5"><Insignia tono={tonoC}>{textoC}</Insignia><Insignia tono={tonoS}>{textoS}</Insignia></span>
      </div>
      {i.correo && (
        <p className="break-words text-xs text-gris-txt">
          {i.correo.para.join(', ')} · {i.correo.estado === 'enviado' ? `enviado el ${fechaColombia(i.correo.enviado_en)}` : `en la bandeja desde el ${fechaColombia(i.correo.creado_en)}`}
          {i.correo.error ? ` · ${i.correo.error}` : ''}
        </p>
      )}
      {agendada && !agendada.vencida && !agendada.sin_efecto && <p className="text-xs">Llamada agendada para el <strong>{fechaColombia(agendada.inicio)}</strong>{agendada.telefono ? ` al ${telefonoLegible(agendada.telefono)}` : ''} · {textoModulo(agendada.modulo)}.</p>}
      {agendada?.vencida && <p className="text-xs text-rojo-txt">La llamada agendada para el <strong>{fechaColombia(agendada.inicio)}</strong> ({textoModulo(agendada.modulo)}) venció sin resultado: registra qué pasó o agenda otro intento.</p>}
      {agendada?.sin_efecto && <p className="text-xs text-gris-txt">La llamada agendada para el {fechaColombia(agendada.inicio)} ({textoModulo(agendada.modulo)}) quedó sin efecto: {agendada.modulo ? 'el módulo ya se realizó' : 'los tres módulos ya se realizaron'}.</p>}
      {ultima?.estado === 'contesto' && (
        <p className="text-xs">
          Contestó el {fechaColombia(ultima.inicio)} ({textoModulo(ultima.modulo)}): <strong>{ultima.asistira ? 'asistirá' : 'no asistirá'}</strong>
          {' · '}{ultima.discapacidad ? <>persona con discapacidad: <strong>{ultima.discapacidad_detalle}</strong></> : 'sin personas con discapacidad'}.
        </p>
      )}
      {intentosSinRespuesta > 0 && i.situacion !== 'asistira' && i.situacion !== 'no_asistira' && <p className="text-xs text-gris-txt">{plural(intentosSinRespuesta, 'intento', 'intentos')} sin respuesta.</p>}
      <div className="flex flex-wrap gap-2">
        <Boton tamano="sm" variante="fantasma" icono={PhoneCall} onClick={onLlamar}>Teléfonos</Boton>
        {agendada ? <>
          <Boton tamano="sm" icono={PhoneIncoming} disabled={ocupado} onClick={() => onResultado(agendada)}>Registrar resultado</Boton>
          <Boton tamano="sm" variante="fantasma" icono={CalendarPlus} disabled={ocupado} onClick={() => onAgendar(agendada)}>Reprogramar</Boton>
          <Boton tamano="sm" variante="fantasma" disabled={ocupado} onClick={() => onCancelar(agendada)}>Cancelar llamada</Boton>
        </> : <>
          <Boton tamano="sm" variante="fantasma" icono={CalendarPlus} disabled={ocupado} onClick={() => onAgendar(null)}>{i.llamadas.length ? 'Agendar otra llamada' : 'Agendar llamada'}</Boton>
          <Boton tamano="sm" icono={PhoneIncoming} disabled={ocupado} onClick={() => onResultado(null)}>Registrar llamada</Boton>
        </>}
      </div>
      {i.llamadas.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-semibold text-marino">Historial de llamadas ({i.llamadas.length})</summary>
          <ul className="mt-2 grid gap-1.5">
            {i.llamadas.map((l) => (
              <li key={l.id} className="break-words">
                <strong>{fechaColombia(l.inicio)}</strong> · {textoModulo(l.modulo)} · {l.sin_efecto ? 'Sin efecto' : l.vencida ? 'Vencida sin resultado' : ESTADO_LLAMADA[l.estado]}
                {l.estado === 'contesto' ? ` · ${l.asistira ? 'asistirá' : 'no asistirá'}${l.discapacidad ? ' · con discapacidad' : ''}` : ''}
                {l.telefono ? ` · ${telefonoLegible(l.telefono)}` : ''} · {l.actualizado_por || l.creado_por}
                {l.notas ? <span className="block text-gris-txt">{l.notas}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

const numerosDe = (up) => up.telefonos.filter((t) => t.numero);

// Diálogo para agendar una llamada de confirmación.
function DialogoAgendar({ taller, up, llamada, ocupado, ejecutar, onCerrar }) {
  const [inicio, setInicio] = useState(llamada ? fechaInput(llamada.inicio) : enUnaHora());
  const [telefono, setTelefono] = useState(llamada?.telefono || numerosDe(up)[0]?.numero || '');
  const [notas, setNotas] = useState(llamada?.notas || '');
  const [modulo, setModulo] = useState(llamada?.modulo ? String(llamada.modulo) : '');
  const limite = moduloLimite(taller.encuentros, modulo);
  const fueraDePlazo = Boolean(limite && inicio && inicioISO(inicio) && new Date(inicioISO(inicio)) >= new Date(limite.inicio));
  const guardar = async (ev) => {
    ev.preventDefault();
    const cuerpo = { inicio: inicioISO(inicio), telefono, notas, modulo: modulo || null };
    const r = await ejecutar(() => (llamada
      ? apiGeneral.patch(`/talleres/${taller.id}/convocatoria/llamadas/${llamada.id}`, cuerpo)
      : apiGeneral.post(`/talleres/${taller.id}/convocatoria/llamadas`, { ...cuerpo, id_up: up.id_up })));
    if (r) onCerrar();
  };
  return (
    <Dialogo abierto titulo={llamada ? 'Reprogramar la llamada' : 'Agendar llamada de convocatoria'} onCerrar={onCerrar}>
      <form onSubmit={guardar} className="grid gap-3">
        <p className="text-[13px]"><strong>{up.id_unico} · {up.nombre}</strong><span className="block text-gris-txt">{up.representante || 'Sin representante'}</span></p>
        <SelectorModulo taller={taller} valor={modulo} onCambio={setModulo} pendientes />
        <Campo etiqueta="Fecha y hora (hora de Colombia)" obligatorio
          ayuda={limite ? `Antes del ${fechaColombia(limite.inicio)} (inicio del módulo ${limite.modulo}).` : undefined}
          error={!limite ? (modulo ? `El módulo ${modulo} ya se realizó: no hay nada que confirmar.` : 'Todos los módulos ya se realizaron: no hay nada que confirmar.')
            : fueraDePlazo ? `La llamada debe ser antes del módulo ${limite.modulo} (${fechaColombia(limite.inicio)}).` : undefined}>
          <Entrada required type="datetime-local" value={inicio} max={limite ? fechaInput(limite.inicio) : undefined} onChange={(e) => setInicio(e.target.value)} />
        </Campo>
        <Campo etiqueta="Número al que se llama">
          <Seleccion value={telefono} onChange={(e) => setTelefono(e.target.value)}>
            <option value="">Sin número registrado</option>
            {numerosDe(up).map((t) => <option key={t.etiqueta} value={t.numero}>{t.etiqueta}: {telefonoLegible(t.numero)}</option>)}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Notas"><AreaTexto rows={2} maxLength={2000} value={notas} onChange={(e) => setNotas(e.target.value)} /></Campo>
        <div className="flex justify-end gap-2"><Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton><Boton tipo="submit" icono={CalendarPlus} cargando={ocupado} disabled={!limite || fueraDePlazo}>{llamada ? 'Guardar' : 'Agendar'}</Boton></div>
      </form>
    </Dialogo>
  );
}

function SiNo({ valor, onCambio, nombre }) {
  return (
    <div className="flex gap-4">{[['si', 'Sí'], ['no', 'No']].map(([v, t]) => (
      <label key={v} className="flex min-h-11 cursor-pointer items-center gap-2"><input type="radio" name={nombre} checked={valor === v} onChange={() => onCambio(v)} />{t}</label>
    ))}</div>
  );
}

// Diálogo con el resultado de la llamada: si contestó y, si contestó, si asistirá y si asistirá alguna persona
// con discapacidad.
function DialogoResultado({ taller, up, llamada, ocupado, ejecutar, onCerrar }) {
  const [contesto, setContesto] = useState('');
  const [asistira, setAsistira] = useState('');
  const [discapacidad, setDiscapacidad] = useState('');
  const [detalle, setDetalle] = useState('');
  const [telefono, setTelefono] = useState(llamada?.telefono || numerosDe(up)[0]?.numero || '');
  const [notas, setNotas] = useState(llamada?.notas || '');
  const [modulo, setModulo] = useState(llamada?.modulo ? String(llamada.modulo) : '');
  const completo = contesto === 'no' || (contesto === 'si' && asistira && discapacidad && (discapacidad === 'no' || detalle.trim()));
  const guardar = async (ev) => {
    ev.preventDefault();
    const cuerpo = contesto === 'si'
      ? { estado: 'contesto', asistira: asistira === 'si', discapacidad: discapacidad === 'si', discapacidad_detalle: discapacidad === 'si' ? detalle : '', telefono, notas, modulo: modulo || null }
      : { estado: 'no_contesto', telefono, notas, modulo: modulo || null };
    const r = await ejecutar(() => (llamada
      ? apiGeneral.patch(`/talleres/${taller.id}/convocatoria/llamadas/${llamada.id}`, cuerpo)
      : apiGeneral.post(`/talleres/${taller.id}/convocatoria/llamadas`, { ...cuerpo, id_up: up.id_up })));
    if (r) onCerrar();
  };
  return (
    <Dialogo abierto titulo="Resultado de la llamada" onCerrar={onCerrar}>
      <form onSubmit={guardar} className="grid gap-3">
        <p className="text-[13px]"><strong>{up.id_unico} · {up.nombre}</strong><span className="block text-gris-txt">{up.representante || 'Sin representante'}{llamada ? ` · agendada para el ${fechaColombia(llamada.inicio)}` : ' · llamada de ahora'}</span></p>
        <SelectorModulo taller={taller} valor={modulo} onCambio={setModulo} />
        <Campo etiqueta="Número al que se llamó">
          <Seleccion value={telefono} onChange={(e) => setTelefono(e.target.value)}>
            <option value="">Sin número registrado</option>
            {numerosDe(up).map((t) => <option key={t.etiqueta} value={t.numero}>{t.etiqueta}: {telefonoLegible(t.numero)}</option>)}
          </Seleccion>
        </Campo>
        <fieldset className="grid gap-1"><legend className="text-[13px] font-semibold text-gris-txt">¿Contestó? *</legend><SiNo nombre="contesto" valor={contesto} onCambio={setContesto} /></fieldset>
        {contesto === 'si' && <>
          <fieldset className="grid gap-1"><legend className="text-[13px] font-semibold text-gris-txt">{modulo ? `¿Asistirá al módulo ${modulo}? *` : '¿Asistirá al taller? *'}</legend><SiNo nombre="asistira" valor={asistira} onCambio={setAsistira} /></fieldset>
          <fieldset className="grid gap-1"><legend className="text-[13px] font-semibold text-gris-txt">¿Asistirá alguna persona con discapacidad? *</legend><SiNo nombre="discapacidad" valor={discapacidad} onCambio={setDiscapacidad} /></fieldset>
          {discapacidad === 'si' && (
            <Campo etiqueta="Tipo de discapacidad y ajuste que necesita" obligatorio ayuda="Por ejemplo: movilidad reducida, necesita acceso sin escaleras.">
              <AreaTexto required rows={2} maxLength={500} value={detalle} onChange={(e) => setDetalle(e.target.value)} />
            </Campo>
          )}
        </>}
        {contesto === 'no' && <Alerta tono="info">Queda como «No contestó». Después puedes agendar otro intento.</Alerta>}
        <Campo etiqueta="Notas"><AreaTexto rows={2} maxLength={2000} value={notas} onChange={(e) => setNotas(e.target.value)} /></Campo>
        <div className="flex justify-end gap-2"><Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton><Boton tipo="submit" icono={contesto === 'no' ? PhoneMissed : PhoneIncoming} cargando={ocupado} disabled={!completo}>Guardar resultado</Boton></div>
      </form>
    </Dialogo>
  );
}
