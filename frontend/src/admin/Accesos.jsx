// Pantalla del registro de inicios de sesión y eventos de seguridad: quién entró, cuándo, desde dónde y qué
// intentos fallaron. Se conserva 180 días.
import { useState } from 'react';
import { History, RefreshCw, Search } from 'lucide-react';
import {
  Boton, Cargando, Celda, Entrada, Fila, Insignia, Seleccion, Tabla, Tarjeta,
} from '../inventario/componentes/ui';
import Encabezado from '../inventario/componentes/Encabezado';
import { admin } from './apiAdmin';
import { useCarga } from './useCarga';
import { ROLES, fechaHora, nombreEvento, resumirAgente } from './etiquetas';

// Cantidad de registros que se trae cada vez que se pide ver los más antiguos.
const PASO = 100;

// Muestra la tabla de eventos con sus filtros y el botón para ver más antiguos.
export default function Accesos() {
  const [filtros, setFiltros] = useState({ vista: 'ingresos', exito: '', rol: '', q: '' });
  const [limite, setLimite] = useState(PASO);

  const { datos, cargando, recargar } = useCarga(
    () => admin.accesos({ ...filtros, limite }),
    [filtros, limite],
  );

  const cambiar = (campo) => (e) => {
    setLimite(PASO);
    setFiltros((f) => ({ ...f, [campo]: e.target.value }));
  };

  const eventos = datos?.eventos || [];

  return (
    <>
      <Encabezado
        titulo="Inicios de sesión"
        descripcion="Cada ingreso, intento fallido y bloqueo. Solo aparecen quienes han intentado entrar: la lista completa de cuentas está en Usuarios."
      >
        <Boton variante="fantasma" icono={RefreshCw} cargando={cargando} onClick={recargar}>Actualizar</Boton>
      </Encabezado>

      <Tarjeta className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="relative">
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-gris" />
            <Entrada
              className="pl-10"
              placeholder="Usuario, IP o detalle"
              aria-label="Buscar en el registro"
              value={filtros.q}
              onChange={cambiar('q')}
            />
          </div>
          <Seleccion value={filtros.vista} onChange={cambiar('vista')} aria-label="Qué eventos mostrar">
            <option value="ingresos">Solo ingresos y bloqueos</option>
            <option value="">Todos los eventos</option>
          </Seleccion>
          <Seleccion value={filtros.exito} onChange={cambiar('exito')} aria-label="Resultado">
            <option value="">Cualquier resultado</option>
            <option value="si">Correctos</option>
            <option value="no">Rechazados</option>
          </Seleccion>
          <Seleccion value={filtros.rol} onChange={cambiar('rol')} aria-label="Rol">
            <option value="">Todos los roles</option>
            {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Seleccion>
        </div>
      </Tarjeta>

      <Tarjeta>
        {!datos ? <Cargando /> : (
          <Tabla
            iconoVacio={History}
            vacio="No hay eventos con esos filtros."
            cabeceras={['Fecha', 'Evento', 'Resultado', 'Usuario', 'Rol', 'Desde', 'Detalle']}
          >
            {eventos.map((e) => (
              <Fila key={e.id}>
                <Celda className="whitespace-nowrap text-[13px]">{fechaHora(e.fecha)}</Celda>
                <Celda>{nombreEvento(e.tipo)}</Celda>
                <Celda><Insignia tono={e.exito ? 'ok' : 'error'}>{e.exito ? 'Correcto' : 'Rechazado'}</Insignia></Celda>
                <Celda><span className="font-semibold text-marca">{e.usuario_texto || '—'}</span></Celda>
                <Celda className="text-[13px]">{ROLES[e.rol] || e.rol || '—'}</Celda>
                <Celda className="text-[13px]">
                  <div className="cifras">{e.ip || '—'}</div>
                  <div className="text-[12px] text-gris-txt">{resumirAgente(e.agente)}</div>
                </Celda>
                <Celda className="text-[13px] text-gris-txt">{e.detalle || '—'}</Celda>
              </Fila>
            ))}
          </Tabla>
        )}
        {datos && eventos.length >= limite && (
          <div className="mt-4 text-center">
            <Boton variante="fantasma" cargando={cargando} onClick={() => setLimite((l) => l + PASO)}>
              Ver más antiguos
            </Boton>
          </div>
        )}
      </Tarjeta>
    </>
  );
}
