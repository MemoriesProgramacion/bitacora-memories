// Usuarios activos: quién entró en el periodo, cuántas veces, cuándo fue la última y qué hizo. Activo significa
// que entró al menos una vez; las operaciones son solo las que salieron bien.
import { useState } from 'react';
import { RefreshCw, Users } from 'lucide-react';
import {
  Boton, Cargando, Celda, Fila, Indicador, Insignia, Seleccion, Tabla, Tarjeta,
} from '../inventario/componentes/ui';
import Encabezado from '../inventario/componentes/Encabezado';
import { admin } from './apiAdmin';
import { useCarga } from './useCarga';
import { fechaHora, nombreRol } from './etiquetas';
import { moduloDe } from '../lib/historial';

// Muestra el resumen de uso por periodo.
export default function Uso() {
  const [dias, setDias] = useState(30);
  const { datos, cargando, recargar } = useCarga(() => admin.uso({ dias }), [dias]);

  return (
    <>
      <Encabezado titulo="Usuarios activos" descripcion="Quién entró a la aplicación en el periodo elegido y qué operaciones hizo.">
        <Seleccion value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Periodo" className="w-44">
          <option value={7}>Últimos 7 días</option>
          <option value={30}>Últimos 30 días</option>
          <option value={90}>Últimos 90 días</option>
        </Seleccion>
        <Boton variante="fantasma" icono={RefreshCw} cargando={cargando} onClick={recargar}>Actualizar</Boton>
      </Encabezado>

      {!datos ? <Cargando /> : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Indicador etiqueta="Usuarios activos" valor={datos.totales.activos} icono={Users} />
            <Indicador etiqueta="Cuentas activas en total" valor={datos.totales.cuentas} />
            <Indicador etiqueta="Sin ingresar en el periodo" valor={datos.totales.sin_ingresar} />
            <Indicador etiqueta="Operaciones correctas" valor={datos.totales.operaciones} />
          </div>
          <Tarjeta>
            <Tabla iconoVacio={Users} vacio="Nadie ha entrado en este periodo."
              cabeceras={['Usuario', 'Rol', 'Ingresos', 'Último ingreso', 'Operaciones']}>
              {datos.usuarios.map((u) => (
                <Fila key={`${u.origen}:${u.id}`}>
                  <Celda><span className="font-semibold text-marca">{u.usuario}</span></Celda>
                  <Celda className="text-[13px]">{nombreRol(u.rol) || '—'}</Celda>
                  <Celda className="cifras">{u.ingresos}</Celda>
                  <Celda className="whitespace-nowrap text-[13px]">{fechaHora(u.ultimo_ingreso)}</Celda>
                  <Celda className="text-[12px]">
                    {u.total_operaciones === 0 ? <span className="text-gris-txt">Solo consultó</span> : (
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(u.operaciones).map(([m, n]) => <Insignia key={m} tono="neutro">{moduloDe(m)}: {n}</Insignia>)}
                      </div>
                    )}
                  </Celda>
                </Fila>
              ))}
            </Tabla>
          </Tarjeta>
        </>
      )}
    </>
  );
}
