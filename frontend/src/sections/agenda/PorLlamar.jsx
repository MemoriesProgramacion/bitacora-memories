// Lista de las iniciativas a las que todavía hay que llamar o volver a llamar: quién es, a qué números se llama
// y cuántas veces no contestaron. De aquí se agenda la cita.
import { useState } from 'react';
import { CalendarPlus, Phone, PhoneMissed, Search } from 'lucide-react';
import { Boton, Entrada, Insignia, Vacio } from '../../inventario/componentes/ui';
import { representante, telefonoLegible } from '../../lib/agenda';
import DialogoLlamar from './DialogoLlamar';

// Cantidad máxima de iniciativas dibujadas, para que la lista no se alargue; el resto se alcanza buscando.
const MAX_VISIBLES = 40;

// Muestra un teléfono que, al tocarlo, abre la ventana con los números del representante.
function Numero({ valor, etiqueta, onLlamar }) {
  if (!valor) return null;
  return (
    <button
      type="button"
      onClick={onLlamar}
      className="cifras inline-flex items-center gap-1.5 rounded-md border border-borde bg-card px-2 py-1 text-[13px] font-semibold text-marca hover:border-acento"
      title={`Llamar al ${etiqueta}`}
    >
      <Phone size={13} aria-hidden="true" className="text-acento-txt" /> {telefonoLegible(valor)}
    </button>
  );
}

// Muestra la lista de iniciativas por llamar.
export default function PorLlamar({ pendientes, q, onQ, onAgendar, mostrarNodo }) {
  const visibles = pendientes.slice(0, MAX_VISIBLES);
  const [llamarA, setLlamarA] = useState(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-gris" />
        <Entrada
          type="search"
          aria-label="Buscar entre las iniciativas por llamar"
          placeholder="Buscar nombre, código o municipio…"
          value={q}
          onChange={(e) => onQ(e.target.value)}
          className="pl-10"
        />
      </div>

      {visibles.length === 0 ? (
        <Vacio icono={Phone}>
          {q ? 'Ninguna iniciativa coincide con la búsqueda.' : 'No queda ninguna iniciativa por llamar. ¡Todas tienen cita!'}
        </Vacio>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {visibles.map(({ fila, intentos, ultima }) => (
            <li key={fila.ID_unico} className="rounded-xl border border-borde bg-card p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-marca">{fila.unidad_nombre || `Iniciativa ${fila.ID_unico}`}</div>
                  <div className="truncate text-[12px] text-gris-txt">
                    {fila.ID_unico}{mostrarNodo && fila.nodo ? ` · ${fila.nodo}` : ''}{fila.mpio ? ` · ${fila.mpio}` : ''}
                  </div>
                </div>
                {intentos > 0 && (
                  <Insignia tono="alerta">
                    <PhoneMissed size={12} aria-hidden="true" /> {intentos}
                  </Insignia>
                )}
              </div>

              {representante(fila) && <div className="mt-1.5 text-[13px] font-medium text-marca">{representante(fila)}</div>}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Numero valor={fila.unidad_tel1} etiqueta="número principal" onLlamar={() => setLlamarA(fila)} />
                <Numero valor={fila.unidad_tel2} etiqueta="segundo número" onLlamar={() => setLlamarA(fila)} />
                {!fila.unidad_tel1 && !fila.unidad_tel2 && (
                  <span className="text-[12px] font-semibold text-rojo-txt">Sin teléfono registrado</span>
                )}
              </div>
              {intentos > 0 && (
                <div className="mt-1.5 text-[12px] text-gris-txt">
                  No contestaron {intentos} {intentos === 1 ? 'vez' : 'veces'}
                  {ultima ? `; el último intento fue el ${ultima.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}` : ''}.
                </div>
              )}

              {onAgendar && (
                <div className="mt-2.5">
                  <Boton tamano="sm" icono={CalendarPlus} onClick={() => onAgendar(fila)}>Agendar cita</Boton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <DialogoLlamar
        abierto={Boolean(llamarA)}
        nombre={llamarA ? representante(llamarA) : ''}
        telefonos={[
          { etiqueta: 'Teléfono 1', numero: llamarA?.unidad_tel1 },
          { etiqueta: 'Teléfono 2', numero: llamarA?.unidad_tel2 },
        ]}
        onCerrar={() => setLlamarA(null)}
      />

      {pendientes.length > MAX_VISIBLES && (
        <p className="text-center text-[12px] text-gris-txt">
          Se muestran {MAX_VISIBLES} de {pendientes.length}. Usa la búsqueda para encontrar otra.
        </p>
      )}
    </div>
  );
}
