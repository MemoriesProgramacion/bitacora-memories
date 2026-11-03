// Historial de cambios de clave: quién la asignó o cambió y cuándo. Nunca se guarda la clave, solo que el
// cambio ocurrió.
import { ScrollText } from 'lucide-react';
import { Cargando, Celda, Fila, Tabla, Tarjeta } from '../inventario/componentes/ui';
import Encabezado from '../inventario/componentes/Encabezado';
import { admin } from './apiAdmin';
import { useCarga } from './useCarga';
import { fechaHora, nombreAccionClave } from './etiquetas';

// Muestra la tabla del historial de cambios de clave.
export default function Auditoria() {
  const { datos } = useCarga(() => admin.auditoriaClaves());

  return (
    <>
      <Encabezado
        titulo="Cambios de clave"
        descripcion="Historial de claves asignadas o cambiadas. La clave en sí nunca se guarda."
      />
      <Tarjeta>
        {!datos ? <Cargando /> : (
          <Tabla
            iconoVacio={ScrollText}
            vacio="Todavía no hay cambios registrados."
            cabeceras={['Fecha', 'Usuario', 'Qué pasó', 'Hecho por']}
          >
            {datos.registro.map((r) => (
              <Fila key={r.id}>
                <Celda className="whitespace-nowrap text-[13px]">{fechaHora(r.fecha)}</Celda>
                <Celda><strong className="font-semibold">{r.usuario_texto || '—'}</strong></Celda>
                <Celda>{nombreAccionClave(r.accion)}</Celda>
                <Celda className="text-[13px]">{r.hecho_por || '—'}</Celda>
              </Fila>
            ))}
          </Tabla>
        )}
      </Tarjeta>
    </>
  );
}
