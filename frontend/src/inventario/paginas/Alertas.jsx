// Alertas de stock: qué artículos se están acabando, qué tan urgente es y cuánto conviene pedir. Quien no ve
// precios, ve la pantalla sin valores en pesos.
import { useMemo, useState } from 'react'
import { BellRing, Boxes, CircleAlert, Clock, PackageX, Plus, RefreshCw, Search, TriangleAlert } from 'lucide-react'
import { pesos } from '../lib/api'
import { useSesion } from '../lib/sesion'
import { useDatos } from '../lib/useDatos'
import Encabezado from '../componentes/Encabezado'
import { BarrasH, Donut, MiniBarra } from '../componentes/Graficas'
import {
  Alerta, Boton, Cargando, Celda, EnlaceBoton, Entrada, Fila, Indicador, Insignia, Tabla, Tarjeta, Vacio,
} from '../componentes/ui'

const ROJO = 'var(--color-rojo)'
const NARANJA = 'var(--graf-naranja)'
const AMARILLO = 'var(--color-acento)'
const AZUL = 'var(--graf-azul)'

// Nombre y color de cada nivel de alerta, del más grave al más leve.
const NIVELES = {
  agotado: { texto: 'Agotado', tono: 'error', color: ROJO },
  critico: { texto: 'Crítico', tono: 'error', color: NARANJA },
  bajo: { texto: 'Bajo el mínimo', tono: 'alerta', color: AMARILLO },
  atencion: { texto: 'Por agotarse', tono: 'neutro', color: AZUL },
}

const dias = (n) => `${n < 10 ? n.toLocaleString('es-CO', { maximumFractionDigits: 1 }) : Math.round(n)} días`

// Muestra el resumen por nivel, las gráficas y la lista de artículos.
export default function Alertas() {
  const { esAdmin } = useSesion()
  const { datos, cargando, recargar } = useDatos('/alertas')
  const [nivel, setNivel] = useState('')
  const [q, setQ] = useState('')

  const alertas = datos?.alertas || []

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase()
    return alertas.filter((a) => (
      (!nivel || a.nivel === nivel)
      && (!t || [a.nombre, a.codigo_barras, a.proveedor].some((v) => String(v || '').toLowerCase().includes(t)))
    ))
  }, [alertas, nivel, q])

  if (cargando && !datos) return <Cargando />
  if (!datos) return null

  const { resumen, kits_bloqueados: kits } = datos

  const primeros = alertas
    .filter((a) => a.dias_restantes !== null && a.dias_restantes > 0)
    .sort((a, b) => a.dias_restantes - b.dias_restantes)
    .slice(0, 8)

  return (
    <>
      <Encabezado
        titulo="Alertas de inventario"
        descripcion="Artículos que se están acabando, según el mínimo de cada uno y lo que se ha consumido en los últimos 30 días."
      >
        <Boton variante="fantasma" icono={RefreshCw} cargando={cargando} onClick={recargar}>Actualizar</Boton>
        <EnlaceBoton to="/inventario/recepcion" variante="oscuro" icono={Plus}>Registrar recepción</EnlaceBoton>
      </Encabezado>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Indicador etiqueta="Agotados" valor={resumen.agotado} icono={PackageX} retardo={0}
          tono={resumen.agotado ? 'error' : 'ok'} detalle="No queda ninguna unidad" />
        <Indicador etiqueta="Críticos" valor={resumen.critico} icono={CircleAlert} retardo={60}
          tono={resumen.critico ? 'error' : 'ok'} detalle="Menos de la mitad del mínimo o de una semana" />
        <Indicador etiqueta="Bajo el mínimo" valor={resumen.bajo} icono={TriangleAlert} retardo={120}
          tono={resumen.bajo ? 'alerta' : 'ok'} detalle="Hay que reponer pronto" />
        <Indicador etiqueta="Por agotarse" valor={resumen.atencion} icono={Clock} retardo={180}
          tono={resumen.atencion ? 'alerta' : 'ok'} detalle="Se acaban en menos de un mes" />
      </div>

      {resumen.total === 0 ? (
        <Alerta tono="info" className="mb-5">
          Todo en orden: ningún artículo está agotado ni por agotarse.
        </Alerta>
      ) : (
        <div className="mb-5 grid items-start gap-4 sm:gap-5 lg:grid-cols-2">
          <Tarjeta titulo="Alertas por nivel">
            <Donut
              centro={resumen.total}
              texto="alertas"
              partes={Object.entries(NIVELES).map(([clave, n]) => ({
                etiqueta: n.texto, valor: resumen[clave], color: n.color,
              }))}
            />
          </Tarjeta>

          <Tarjeta titulo="Los que se acaban primero">
            <BarrasH
              items={primeros.map((a) => ({
                nombre: a.nombre,
                valor: a.dias_restantes,
                extra: `Stock ${a.stock} · consume ${a.consumo_diario.toLocaleString('es-CO')} por día`,
              }))}
              formato={dias}
              color={ROJO}
              vacio="Todavía no hay consumo suficiente para calcular cuánto dura cada artículo."
            />
          </Tarjeta>
        </div>
      )}

      <Tarjeta
        className="mb-5"
        titulo={`Artículos en alerta (${visibles.length})`}
        acciones={(
          <div className="relative w-full sm:w-72">
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-gris" />
            <Entrada
              type="search"
              aria-label="Buscar en las alertas"
              placeholder="Buscar artículo o proveedor…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-10"
            />
          </div>
        )}
      >
        <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0" role="group" aria-label="Filtrar por nivel">
          {[['', 'Todas', resumen.total], ...Object.entries(NIVELES).map(([k, n]) => [k, n.texto, resumen[k]])]
            .map(([clave, texto, total]) => (
              <button
                key={clave || 'todas'}
                type="button"
                onClick={() => setNivel(clave)}
                aria-pressed={nivel === clave}
                className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-[background-color,border-color,color] duration-150 ${
                  nivel === clave
                    ? 'border-marino bg-marino text-white'
                    : 'border-borde bg-card text-marca hover:border-acento'
                }`}
              >
                {texto} <span className="cifras opacity-70">{total}</span>
              </button>
            ))}
        </div>

        <Tabla
          cabeceras={[
            'Artículo', 'Nivel', 'Stock y mínimo', { texto: 'Consumo', alinear: 'derecha' },
            { texto: 'Alcanza para', alinear: 'derecha' }, { texto: 'Conviene pedir', alinear: 'derecha' },
          ]}
          vacio={resumen.total ? 'Ninguna alerta coincide con el filtro.' : 'No hay alertas. Todo en orden.'}
          iconoVacio={BellRing}
        >
          {visibles.map((a) => {
            const n = NIVELES[a.nivel]
            const pct = a.minimo ? (a.stock / a.minimo) * 100 : ((a.dias_restantes ?? 0) / 30) * 100
            return (
              <Fila key={a.id}>
                <Celda>
                  <div className="font-semibold text-marca">{a.nombre}</div>
                  <div className="font-mono text-[11px] text-gris-txt">{a.codigo_barras}</div>
                  <div className="text-[12px] text-gris-txt">{a.proveedor}</div>
                </Celda>
                <Celda>
                  <Insignia tono={n.tono}>{n.texto}</Insignia>
                  {a.nivel !== 'agotado' && a.motivos.map((m) => <div key={m} className="mt-1 text-[12px] text-gris-txt">{m}</div>)}
                </Celda>
                <Celda>
                  <div className="cifras text-[13px] text-marca">
                    <strong>{a.stock}</strong> de {a.minimo || '—'}
                  </div>
                  <MiniBarra pct={Math.round(pct)} color={n.color} />
                </Celda>
                <Celda alinear="derecha" className="cifras whitespace-nowrap text-[13px] text-gris-txt">
                  {a.consumo_diario ? `${a.consumo_diario.toLocaleString('es-CO')} por día` : 'Sin consumo'}
                </Celda>
                <Celda alinear="derecha" className="whitespace-nowrap text-[13px] font-semibold">
                  {a.stock === 0 ? 'Ya se acabó' : a.dias_restantes === null ? 'Sin dato' : dias(a.dias_restantes)}
                </Celda>
                <Celda alinear="derecha" className="text-[13px]">
                  {a.sugerido ? (
                    <>
                      <strong className="cifras text-marca">{a.sugerido.toLocaleString('es-CO')}</strong> {a.sugerido === 1 ? 'unidad' : 'unidades'}
                      {esAdmin && a.valor_reponer ? (
                        <div className="cifras text-[12px] text-gris-txt">{pesos(a.valor_reponer)}</div>
                      ) : null}
                    </>
                  ) : '—'}
                </Celda>
              </Fila>
            )
          })}
        </Tabla>
      </Tarjeta>

      <Tarjeta titulo="Kit UP que no se pueden armar por falta de stock">
        {kits.length === 0 ? (
          <Vacio icono={Boxes}>Todos los kits pendientes tienen stock suficiente.</Vacio>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {kits.map((k) => (
              <li key={k.id} className="rounded-xl border border-borde bg-lienzo/60 p-3.5">
                <div className="mb-1.5 font-semibold text-marca">{k.nombre}</div>
                <ul className="flex flex-col gap-1 text-[13px] text-gris-txt">
                  {k.faltantes.map((f) => (
                    <li key={f.articulo}>
                      <span className="font-medium text-marca">{f.articulo}</span>: faltan{' '}
                      <strong className="cifras text-rojo-txt">{f.faltan}</strong> (hay {f.stock}, requiere {f.requiere})
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>
    </>
  )
}
