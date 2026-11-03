// Ventana con los números del representante para llamar. En el computador no hay con qué abrir un enlace tel,
// así que aquí se ven los números para marcarlos o copiarlos; en el celular, además, se pueden marcar con un
// toque.
import { Copy, Phone, PhoneCall } from 'lucide-react';
import { Boton, Dialogo, useAvisos } from '../../inventario/componentes/ui';
import { enlaceTel, telefonoLegible } from '../../lib/agenda';

// Indica si la pantalla es táctil, donde sí hay una aplicación de llamadas.
const esTactil = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

// Muestra los teléfonos recibidos; los vacíos aparecen como No registrado.
export default function DialogoLlamar({ abierto, nombre, telefonos = [], onCerrar }) {
  const { avisar } = useAvisos();
  const tactil = esTactil();

  const copiar = async (numero) => {
    try {
      await navigator.clipboard.writeText(String(numero).replace(/[^\d+]/g, ''));
      avisar('Número copiado.');
    } catch {
      avisar('No se pudo copiar. Selecciona el número y cópialo a mano.', 'error');
    }
  };

  return (
    <Dialogo abierto={abierto} titulo="Llamar al representante" onCerrar={onCerrar}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-acento-bg text-acento-txt">
            <PhoneCall size={20} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="text-[12px] text-gris-txt">Representante</div>
            <div className="truncate font-semibold text-marca">{nombre || 'Sin nombre registrado'}</div>
          </div>
        </div>

        <ul className="flex flex-col gap-2">
          {telefonos.map(({ etiqueta, numero }) => (
            <li
              key={etiqueta}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-borde bg-card px-3.5 py-3"
            >
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-gris-txt">{etiqueta}</div>
                {numero ? (
                  <div className="cifras text-[18px] font-semibold tracking-wide text-marca select-all">
                    {telefonoLegible(numero)}
                  </div>
                ) : (
                  <div className="text-[14px] text-gris">No registrado</div>
                )}
              </div>
              {numero && (
                <div className="flex gap-2">
                  <Boton variante="fantasma" tamano="sm" icono={Copy} onClick={() => copiar(numero)}>
                    Copiar
                  </Boton>
                  {tactil && (
                    <a
                      href={enlaceTel(numero)}
                      className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-marino px-3 text-[13px] font-semibold text-white hover:bg-marino2"
                    >
                      <Phone size={14} aria-hidden="true" /> Marcar
                    </a>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="flex justify-end">
          <Boton variante="fantasma" onClick={onCerrar}>Cerrar</Boton>
        </div>
      </div>
    </Dialogo>
  );
}
