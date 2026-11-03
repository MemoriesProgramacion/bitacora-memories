// Ventana para agendar una cita o ver y cambiar una existente: a quién se llama, con los números de la
// iniciativa, a qué hora, cuánto dura y cómo terminó. Si se cambia la hora de una cita queda anotado en su
// historial.
import { useEffect, useState } from 'react';
import { CalendarCheck, Phone, PhoneMissed, Save, Trash2, XCircle } from 'lucide-react';
import { apiGeneral, qs } from '../../inventario/lib/api';
import {
  AreaTexto, Boton, Campo, Confirmar, Dialogo, Entrada, Seleccion, Insignia, useAvisos,
} from '../../inventario/componentes/ui';
import SelectorIniciativa from '../../components/SelectorIniciativa';
import DialogoLlamar from './DialogoLlamar';
import {
  DURACIONES, ESTADOS, MOTIVOS, TIPOS, claveDia, claveHora, fechaLarga, horaTexto,
  proximaHora, representante, telefonoLegible,
} from '../../lib/agenda';

// El formulario en sí; la ventana del final solo lo envuelve.
function Formulario({ inicial, filas, soloLectura, onCerrar, onCambio }) {
  const { avisar } = useAvisos();
  const cita = inicial.cita || null;
  const editando = Boolean(cita);
  const base = cita ? cita.ini : (inicial.inicio || proximaHora());

  const [idUnico, setIdUnico] = useState(cita?.id_unico || inicial.up?.ID_unico || '');
  const [contactos, setContactos] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [borrar, setBorrar] = useState(false);
  const [llamar, setLlamar] = useState(false);
  const [form, setForm] = useState({
    tipo: cita?.tipo || 'llamada',
    motivo: cita?.motivo || '',
    fecha: claveDia(base),
    hora: claveHora(base),
    duracion: cita?.duracion_min || 30,
    telefono: cita?.telefono || inicial.up?.unidad_tel1 || '',
    contacto: cita?.contacto || (inicial.up ? representante(inicial.up) : ''),
    estado: cita?.estado || 'agendada',
    notas: cita?.notas || '',
  });
  const poner = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  useEffect(() => {
    if (!idUnico) { setContactos([]); return undefined; }
    let vigente = true;
    apiGeneral.get(`/agenda/contactos${qs({ id_unico: idUnico })}`)
      .then((r) => { if (vigente) setContactos(r.contactos || []); })
      .catch(() => { if (vigente) setContactos([]); });
    return () => { vigente = false; };
  }, [idUnico]);

  const elegirIniciativa = (fila) => {
    setIdUnico(fila.ID_unico);
    setForm((f) => ({ ...f, telefono: fila.unidad_tel1 || '', contacto: representante(fila) }));
  };

  const elegirContacto = (c) => setForm((f) => ({ ...f, telefono: c.telefono, contacto: c.nombre }));

  const guardar = async (e) => {
    e.preventDefault();
    if (!idUnico) { avisar('Elige la iniciativa de la cita.', 'error'); return; }
    const inicio = new Date(`${form.fecha}T${form.hora}`);
    if (Number.isNaN(inicio.getTime())) { avisar('La fecha o la hora no son válidas.', 'error'); return; }
    setEnviando(true);
    try {
      const r = await apiGeneral.post('/agenda/guardar', {
        id: cita?.id, id_unico: idUnico, tipo: form.tipo, motivo: form.motivo,
        inicio: inicio.toISOString(), duracion_min: Number(form.duracion),
        telefono: form.telefono, contacto: form.contacto, estado: form.estado, notas: form.notas,
      });
      if (r.choques > 0) {
        avisar(`Ojo: esta cita se cruza con ${r.choques} más de tu nodo a la misma hora.`);
      } else {
        avisar(editando ? 'Cita actualizada.' : 'Cita agendada.');
      }
      onCambio();
    } catch (err) {
      avisar(err.message, 'error');
    } finally {
      setEnviando(false);
    }
  };

  const resultado = async (estado) => {
    setEnviando(true);
    try {
      await apiGeneral.post('/agenda/estado', { id: cita.id, estado, notas: form.notas });
      avisar(`Cita marcada como "${ESTADOS[estado].texto.toLowerCase()}".`);
      onCambio();
    } catch (err) {
      avisar(err.message, 'error');
    } finally {
      setEnviando(false);
    }
  };

  const eliminar = async () => {
    setBorrar(false);
    try {
      await apiGeneral.del(`/agenda${qs({ id: cita.id })}`);
      avisar('Cita eliminada.');
      onCambio();
    } catch (err) {
      avisar(err.message, 'error');
    }
  };

  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <fieldset disabled={soloLectura} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
      {editando ? (
        <div className="rounded-lg border border-borde bg-lienzo/60 px-3.5 py-2.5">
          <div className="font-semibold text-marca">{cita.up_nombre || `Iniciativa ${cita.id_unico}`}</div>
          <div className="text-[12px] text-gris-txt">
            {cita.id_unico} · {[cita.municipio, cita.departamento].filter(Boolean).join(', ')}
            {cita.nodo ? ` · ${cita.nodo}` : ''}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-gris-txt">
            <Insignia tono={ESTADOS[cita.estado].tono}>{ESTADOS[cita.estado].texto}</Insignia>
            <span>{fechaLarga(cita.ini)}, {horaTexto(cita.ini)}</span>
          </div>
        </div>
      ) : (
        <SelectorIniciativa filas={filas} valor={idUnico} onElegir={elegirIniciativa} />
      )}

      {idUnico && (
        <div>
          <span className="mb-1.5 block text-[13px] font-semibold text-gris-txt">A quién se llama</span>
          {contactos.length === 0 ? (
            <p className="rounded-lg border border-dashed border-borde px-3.5 py-3 text-[13px] text-gris-txt">
              Esta iniciativa no tiene teléfonos registrados. Escribe el número abajo.
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {contactos.map((c) => {
                const activo = form.telefono === c.telefono && form.contacto === c.nombre;
                return (
                  <li key={`${c.nombre}-${c.telefono}`}>
                    <button
                      type="button"
                      onClick={() => elegirContacto(c)}
                      aria-pressed={activo}
                      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        activo ? 'border-acento bg-acento-bg' : 'border-borde bg-card hover:border-acento'
                      }`}
                    >
                      <Phone size={16} aria-hidden="true" className="shrink-0 text-acento-txt" />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-marca">{c.nombre}</span>
                        <span className="block text-[12px] text-gris-txt">{c.rol}</span>
                        <span className="cifras block text-[14px] font-semibold text-marca">{telefonoLegible(c.telefono)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Número al que se llama">
          <Entrada value={form.telefono} onChange={poner('telefono')} inputMode="tel" maxLength={30} />
        </Campo>
        <Campo etiqueta="Persona de contacto">
          <Entrada value={form.contacto} onChange={poner('contacto')} maxLength={200} />
        </Campo>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Tipo">
          <Seleccion value={form.tipo} onChange={poner('tipo')}>
            {Object.entries(TIPOS).map(([k, t]) => <option key={k} value={k}>{t.texto}</option>)}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Motivo">
          <Entrada value={form.motivo} onChange={poner('motivo')} list="motivos-cita" maxLength={200} placeholder="Primera llamada, seguimiento…" />
          <datalist id="motivos-cita">{MOTIVOS.map((m) => <option key={m} value={m} />)}</datalist>
        </Campo>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Campo etiqueta="Fecha">
          <Entrada type="date" required value={form.fecha} onChange={poner('fecha')} />
        </Campo>
        <Campo etiqueta="Hora">
          <Entrada type="time" required value={form.hora} onChange={poner('hora')} />
        </Campo>
        <Campo etiqueta="Duración">
          <Seleccion value={form.duracion} onChange={poner('duracion')}>
            {DURACIONES.map((d) => <option key={d} value={d}>{d} min</option>)}
          </Seleccion>
        </Campo>
      </div>

      {editando && (
        <Campo etiqueta="Estado">
          <Seleccion value={form.estado} onChange={poner('estado')}>
            {Object.entries(ESTADOS).map(([k, e]) => <option key={k} value={k}>{e.texto}</option>)}
          </Seleccion>
        </Campo>
      )}

      <Campo etiqueta="Notas" ayuda="Lo que se habló, lo que quedó pendiente o por qué no se pudo.">
        <AreaTexto value={form.notas} onChange={poner('notas')} maxLength={2000} rows={3} />
      </Campo>

      {editando && cita.historial?.length > 0 && (
        <div className="rounded-lg border border-borde px-3.5 py-2.5">
          <div className="mb-1 text-[12px] font-semibold text-gris-txt">Cambios de hora</div>
          <ul className="flex flex-col gap-1 text-[12px] text-gris-txt">
            {cita.historial.map((h, i) => (
              <li key={i}>
                De {new Date(h.de).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })} a{' '}
                {new Date(h.a).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })} · {h.por}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!soloLectura && editando && cita.estado === 'agendada' && (
        <div className="flex flex-wrap gap-2">
          <Boton variante="fantasma" tamano="sm" icono={CalendarCheck} onClick={() => resultado('realizada')} disabled={enviando}>Se realizó</Boton>
          <Boton variante="fantasma" tamano="sm" icono={PhoneMissed} onClick={() => resultado('no_contesto')} disabled={enviando}>No contestó</Boton>
          <Boton variante="fantasma" tamano="sm" icono={XCircle} onClick={() => resultado('cancelada')} disabled={enviando}>Cancelar cita</Boton>
        </div>
      )}

      </fieldset>

      <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        {editando && !soloLectura ? (
          <Boton variante="peligro" tamano="sm" icono={Trash2} onClick={() => setBorrar(true)}>Eliminar</Boton>
        ) : <span />}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {editando && (
            <Boton variante="fantasma" icono={Phone} onClick={() => setLlamar(true)}>Llamar</Boton>
          )}
          <Boton variante="fantasma" onClick={onCerrar}>Cerrar</Boton>
          {!soloLectura && <Boton tipo="submit" icono={Save} cargando={enviando}>{editando ? 'Guardar cambios' : 'Agendar'}</Boton>}
        </div>
      </div>

      {editando && (
        <DialogoLlamar
          abierto={llamar}
          nombre={cita.representante || form.contacto}
          telefonos={[
            { etiqueta: 'Teléfono 1', numero: cita.telefono1 },
            { etiqueta: 'Teléfono 2', numero: cita.telefono2 },
          ]}
          onCerrar={() => setLlamar(false)}
        />
      )}

      <Confirmar
        abierto={borrar}
        titulo="¿Eliminar la cita?"
        texto={'Se borra del calendario. Si solo no se pudo llamar, mejor márcala como "No contestó".'}
        onOk={eliminar}
        onCancelar={() => setBorrar(false)}
      />
    </form>
  );
}

// Muestra la ventana; inicial es null si está cerrada, una cita para verla o una unidad con inicio para crear
// una nueva.
export default function DialogoCita({ inicial, filas, soloLectura = false, onCerrar, onCambio }) {
  return (
    <Dialogo
      abierto={Boolean(inicial)}
      titulo={inicial?.cita ? 'Cita' : 'Agendar una cita'}
      onCerrar={onCerrar}
      ancho="max-w-xl"
    >
      {inicial && <Formulario inicial={inicial} filas={filas} soloLectura={soloLectura} onCerrar={onCerrar} onCambio={onCambio} />}
    </Dialogo>
  );
}
