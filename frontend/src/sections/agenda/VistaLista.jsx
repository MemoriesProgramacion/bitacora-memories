// Lista de citas agrupadas por día, con la hora, a quién se llama y su número. Es la vista por defecto en el
// celular, donde una rejilla de horas no cabe.
import { useState } from 'react';
import { CalendarCheck, Pencil, Phone, PhoneMissed } from 'lucide-react';
import { Boton, Insignia, Vacio } from '../../inventario/componentes/ui';
import {
  ESTADOS, TIPOS, claveDia, fechaLarga, horaTexto, inicioDeDia, mismoDia, sumarDias, telefonoLegible,
} from '../../lib/agenda';
import DialogoLlamar from './DialogoLlamar';

// Devuelve Hoy o Mañana, o nada, para destacar los días cercanos.
function etiquetaDia(d) {
  const hoy = inicioDeDia(new Date());
  if (mismoDia(d, hoy)) return 'Hoy';
  if (mismoDia(d, sumarDias(hoy, 1))) return 'Mañana';
  return null;
}

// Muestra una cita como tarjeta con hora, iniciativa, número y los botones de resultado.
function Tarjeta({ cita, onAbrir, onResultado, onLlamar }) {
  const e = ESTADOS[cita.estado];
  const Icono = TIPOS[cita.tipo]?.icono;
  const cancelada = cita.estado === 'cancelada';
  return (
    <article
      className={`flex gap-3 rounded-xl border border-borde border-l-4 bg-card p-3.5 shadow-tarjeta sm:gap-4 ${cancelada ? 'opacity-70' : ''}`}
      style={{ borderLeftColor: e.borde }}
    >
      <div className="w-[4.5rem] shrink-0 text-right sm:w-24">
        <div className="cifras text-[15px] font-bold text-marca">{horaTexto(cita.ini)}</div>
        <div className="text-[12px] text-gris-txt">{cita.duracion_min} min</div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`font-semibold text-marca ${cancelada ? 'line-through' : ''}`}>{cita.up_nombre || `Iniciativa ${cita.id_unico}`}</span>
          <Insignia tono={e.tono}>{e.texto}</Insignia>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-gris-txt">
          {Icono && <Icono size={12} aria-hidden="true" />}
          <span>{TIPOS[cita.tipo]?.texto}{cita.motivo ? ` · ${cita.motivo}` : ''}</span>
          <span>· {cita.id_unico}{cita.nodo ? ` · ${cita.nodo}` : ''}</span>
          {cita.municipio && <span>· {cita.municipio}</span>}
        </div>

        {(cita.contacto || cita.telefono) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            {cita.contacto && <span className="font-medium text-marca">{cita.contacto}</span>}
            {cita.telefono && (
              <button type="button" onClick={() => onLlamar(cita)} className="cifras inline-flex cursor-pointer items-center gap-1.5 font-semibold text-acento-txt hover:underline">
                <Phone size={13} aria-hidden="true" /> {telefonoLegible(cita.telefono)}
              </button>
            )}
          </div>
        )}
        {cita.notas && <p className="mt-1.5 line-clamp-2 text-[12px] text-gris-txt">{cita.notas}</p>}

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {onResultado && cita.estado === 'agendada' && (
            <>
              <Boton tamano="sm" variante="fantasma" icono={CalendarCheck} onClick={() => onResultado(cita, 'realizada')}>Se realizó</Boton>
              <Boton tamano="sm" variante="fantasma" icono={PhoneMissed} onClick={() => onResultado(cita, 'no_contesto')}>No contestó</Boton>
            </>
          )}
          <Boton tamano="sm" variante="fantasma" icono={Pencil} onClick={() => onAbrir(cita)}>Abrir</Boton>
        </div>
      </div>
    </article>
  );
}

// Muestra las citas agrupadas por día.
export default function VistaLista({ citas, onAbrir, onResultado }) {
  const [llamarA, setLlamarA] = useState(null);

  if (citas.length === 0) {
    return <Vacio icono={CalendarCheck}>No hay citas en este periodo. Agenda una desde "Por llamar" o con el botón "Nueva cita".</Vacio>;
  }

  const dias = [];
  for (const c of [...citas].sort((a, b) => a.ini - b.ini)) {
    const k = claveDia(c.ini);
    const ultimo = dias[dias.length - 1];
    if (ultimo && ultimo.clave === k) ultimo.citas.push(c);
    else dias.push({ clave: k, fecha: c.ini, citas: [c] });
  }

  return (
    <div className="flex flex-col gap-5">
      {dias.map((d) => (
        <section key={d.clave}>
          <h3 className="mb-2 flex items-center gap-2 text-[14px] font-bold text-marca">
            {fechaLarga(d.fecha)}
            {etiquetaDia(d.fecha) && <Insignia tono="alerta">{etiquetaDia(d.fecha)}</Insignia>}
            <span className="text-[12px] font-normal text-gris-txt">{d.citas.length} cita{d.citas.length > 1 ? 's' : ''}</span>
          </h3>
          <div className="flex flex-col gap-2.5">
            {d.citas.map((c) => <Tarjeta key={c.id} cita={c} onAbrir={onAbrir} onResultado={onResultado} onLlamar={setLlamarA} />)}
          </div>
        </section>
      ))}

      <DialogoLlamar
        abierto={Boolean(llamarA)}
        nombre={llamarA?.representante || llamarA?.contacto}
        telefonos={[
          { etiqueta: 'Teléfono 1', numero: llamarA?.telefono1 },
          { etiqueta: 'Teléfono 2', numero: llamarA?.telefono2 },
        ]}
        onCerrar={() => setLlamarA(null)}
      />
    </div>
  );
}
