// Lista de las personas conectadas ahora, con la opción de cerrarles la sesión a quien tiene permiso.
import { Monitor, RefreshCw, XCircle } from 'lucide-react';
import {
  Boton, Cargando, Celda, Fila, Insignia, Tabla, Tarjeta,
} from '../inventario/componentes/ui';
import Encabezado from '../inventario/componentes/Encabezado';
import { useAccion } from '../inventario/lib/useDatos';
import { admin } from './apiAdmin';
import { useCarga } from './useCarga';
import { ROLES, fechaHora, resumirAgente } from './etiquetas';

// Muestra las sesiones abiertas y permite cerrarlas.
export default function Sesiones() {
  const { datos, cargando, recargar } = useCarga(() => admin.sesiones());
  const { ejecutar } = useAccion(recargar);

  return (
    <>
      <Encabezado
        titulo="Sesiones abiertas"
        descripcion="Solo quienes están conectados ahora (la lista de todas las cuentas está en Usuarios). Al cerrar una sesión, esa persona tendrá que volver a iniciar."
      >
        <Boton variante="fantasma" icono={RefreshCw} cargando={cargando} onClick={recargar}>Actualizar</Boton>
      </Encabezado>

      <Tarjeta>
        {!datos ? <Cargando /> : (
          <Tabla
            iconoVacio={Monitor}
            vacio="No hay sesiones abiertas."
            cabeceras={['Usuario', 'Rol', 'Desde', 'Inicio', 'Última actividad', { texto: 'Acción', alinear: 'derecha' }]}
          >
            {datos.sesiones.map((s) => (
              <Fila key={s.id}>
                <Celda><span className="font-bold text-marca">{s.usuario}</span></Celda>
                <Celda className="text-[13px]">{ROLES[s.rol] || s.rol}</Celda>
                <Celda className="text-[13px]">
                  <div className="cifras">{s.ip || '—'}</div>
                  <div className="text-[12px] text-gris-txt">{resumirAgente(s.agente)}</div>
                </Celda>
                <Celda className="whitespace-nowrap text-[13px]">{fechaHora(s.creado)}</Celda>
                <Celda className="whitespace-nowrap text-[13px]">{fechaHora(s.ultimo_uso)}</Celda>
                <Celda alinear="derecha">
                  {s.actual ? (
                    <Insignia tono="ok">Tu sesión</Insignia>
                  ) : (
                    <Boton tamano="sm" variante="peligro" icono={XCircle}
                      aria-label={`Cerrar la sesión de ${s.usuario}`}
                      onClick={() => ejecutar(() => admin.cerrarSesion(s.id))}>
                      Cerrar
                    </Boton>
                  )}
                </Celda>
              </Fila>
            ))}
          </Tabla>
        )}
      </Tarjeta>
    </>
  );
}
