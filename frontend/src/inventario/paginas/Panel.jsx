// Resumen del inventario: cifras clave arriba, gráficas en el medio y, al final, lo que se está acabando y lo
// último que se movió.
import { Link } from 'react-router-dom'
import {
  Boxes, ClipboardList, History, Layers, Package, PackageCheck, Truck, TriangleAlert, Wallet,
} from 'lucide-react'
import { fecha, pesos } from '../lib/api'
import { useDatos } from '../lib/useDatos'
import Encabezado from '../componentes/Encabezado'
import {
  BarrasH, Columnas, Donut, MiniBarra, diaCorto, mesCorto, pesosCorto,
} from '../componentes/Graficas'
import {
  Alerta, Cargando, Celda, Fila, Indicador, Insignia, Tabla, Tarjeta,
} from '../componentes/ui'

// Color y nombre con que se muestra cada tipo de movimiento de bodega.
const TONO_MOV = { entrada: 'ok', salida: 'error', ajuste: 'alerta' }
const NOMBRE_MOV = { entrada: 'Entrada', salida: 'Salida', ajuste: 'Ajuste' }

// Colores de las gráficas, tomados de la paleta, que cambian con el tema claro u oscuro.
const VERDE = 'var(--color-ok)'
const AMARILLO = 'var(--color-acento)'
const ROJO = 'var(--color-rojo)'
const AZUL = 'var(--graf-azul)'
const GRIS = 'var(--color-gris)'

const suma = (filas, clave) => filas.reduce((n, f) => n + (f[clave] || 0), 0)

// Pide los datos del panel y muestra cifras, gráficas, alertas y movimientos.
export default function Panel() {
  const { datos, cargando } = useDatos('/panel')

  if (cargando) return <Cargando />
  if (!datos) return null

  const {
    estado, kits, movs_dia: movsDia, ordenes_mes: ordenesMes, despachos_mes: despachosMes,
    top_valor: topValor, por_proveedor: porProveedor, por_empresa: porEmpresa, lotes,
  } = datos

  const entradas = suma(movsDia, 'entradas')
  const salidas = suma(movsDia, 'salidas')

  return (
    <>
      <Encabezado titulo="Panel" descripcion="Resumen del inventario: existencias, movimientos, kits, órdenes y despachos." />

      {datos.alertas.total > 0 && (
        <Alerta tono={datos.alertas.agotado ? 'error' : 'aviso'} className="mb-4">
          <strong>
            {datos.alertas.total} artículo{datos.alertas.total > 1 ? 's' : ''} necesita{datos.alertas.total > 1 ? 'n' : ''} reposición:
          </strong>{' '}
          {datos.alertas.agotado} agotado{datos.alertas.agotado === 1 ? '' : 's'}, {datos.alertas.critico} en estado crítico,{' '}
          {datos.alertas.bajo} bajo el mínimo y {datos.alertas.atencion} que se acabarán pronto.{' '}
          <Link to="/inventario/alertas" className="font-semibold underline">Ver las alertas</Link>
        </Alerta>
      )}

      <div className="mb-3 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Indicador etiqueta="Valor en bodega" valor={pesosCorto(datos.valor_stock)} icono={Wallet}
          detalle={pesos(datos.valor_stock)} retardo={0} />
        <Indicador etiqueta="Unidades en stock" valor={datos.total_stock.toLocaleString('es-CO')} icono={Layers}
          detalle={`${datos.n_art} artículos`} retardo={60} />
        <Indicador etiqueta="Alertas de stock" valor={datos.alertas.total} icono={TriangleAlert} retardo={120}
          tono={datos.alertas.agotado ? 'error' : datos.alertas.total ? 'alerta' : 'ok'}
          detalle={datos.alertas.total ? `${datos.alertas.agotado} agotados · ${datos.alertas.critico} críticos` : 'Todo en orden'} />
        <Indicador etiqueta="Proveedores" valor={datos.n_prov} icono={Truck} retardo={180} />
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Indicador etiqueta="Kit UP armados" valor={`${kits.armados} de ${kits.total}`} icono={Boxes}
          detalle={`${kits.en_stock} en bodega`} retardo={240} />
        <Indicador etiqueta="Órdenes este mes" valor={datos.ordenes_este_mes} icono={ClipboardList}
          detalle={`${datos.n_ordenes} en total`} retardo={300} />
        <Indicador etiqueta="Valor despachado" valor={pesosCorto(datos.monto_despachado)} icono={Package}
          detalle={`${datos.n_despachos} despachos`} retardo={360} />
        <Indicador etiqueta="Lotes de pedido" valor={datos.n_lotes} icono={PackageCheck} retardo={420} />
      </div>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
        <Tarjeta
          className="lg:col-span-2"
          titulo="Movimientos de los últimos 30 días"
          acciones={(
            <span className="text-[13px] text-gris-txt">
              <strong className="cifras text-ok-txt">{entradas.toLocaleString('es-CO')}</strong> entradas ·{' '}
              <strong className="cifras text-aviso-txt">{salidas.toLocaleString('es-CO')}</strong> salidas
            </span>
          )}
        >
            <Columnas
              className="max-md:hidden"
              datos={movsDia}
              ancho={1080}
              alto={230}
              rotulo={(d) => diaCorto(d.dia)}
              series={[
                { clave: 'entradas', etiqueta: 'Entradas (recepciones)', color: VERDE },
                { clave: 'salidas', etiqueta: 'Salidas (kits armados)', color: AMARILLO },
              ]}
              descripcion={`Entradas y salidas de unidades por día. En total ${entradas} entradas y ${salidas} salidas.`}
            />
            <Columnas
              className="md:hidden"
              datos={movsDia}
              rotulo={(d) => diaCorto(d.dia)}
              series={[
                { clave: 'entradas', etiqueta: 'Entradas (recepciones)', color: VERDE },
                { clave: 'salidas', etiqueta: 'Salidas (kits armados)', color: AMARILLO },
              ]}
              descripcion={`Entradas y salidas de unidades por día. En total ${entradas} entradas y ${salidas} salidas.`}
            />
        </Tarjeta>

        <Tarjeta titulo="Estado del stock">
                      <Donut
              centro={datos.n_art}
              texto="artículos"
              vacio="Aún no hay artículos registrados."
              partes={[
                { etiqueta: 'Stock normal', valor: estado.normales, color: VERDE },
                { etiqueta: 'Por reponer (en el mínimo)', valor: estado.por_reponer, color: AMARILLO },
                { etiqueta: 'Agotados', valor: estado.agotados, color: ROJO },
              ]}
            />
        </Tarjeta>

        <Tarjeta titulo="Kit UP">
                      <Donut
              centro={kits.total}
              texto="kits"
              vacio="Aún no hay Kit UP creados."
              partes={[
                { etiqueta: 'Armados', valor: kits.armados, color: VERDE },
                { etiqueta: 'Por armar', valor: kits.total - kits.armados, color: GRIS },
              ]}
            />
        </Tarjeta>

        <Tarjeta titulo="Artículos con más valor en bodega">
                      <BarrasH
              items={topValor.map((a) => ({
                nombre: a.nombre,
                valor: a.valor,
                extra: `${a.stock.toLocaleString('es-CO')} unidades`,
              }))}
              formato={pesosCorto}
              vacio="Cuando haya artículos con precio y stock, aparecerán aquí."
            />
        </Tarjeta>

        <Tarjeta titulo="Valor en bodega por proveedor">
                      <BarrasH
              items={porProveedor.map((p) => ({
                nombre: p.nombre,
                valor: p.valor,
                extra: `${p.articulos} artículos · ${p.unidades.toLocaleString('es-CO')} unidades`,
              }))}
              formato={pesosCorto}
              color={AMARILLO}
              vacio="Cuando haya artículos con precio y stock, aparecerán aquí."
            />
        </Tarjeta>

        <Tarjeta titulo="Órdenes de entrega por mes">
                      <Columnas
              datos={ordenesMes}
              rotulo={(d) => mesCorto(d.mes)}
              series={[
                { clave: 'ordenes', etiqueta: 'Órdenes', color: AZUL },
                { clave: 'kits', etiqueta: 'Kit UP entregados', color: AMARILLO },
              ]}
              descripcion="Órdenes de entrega y kits entregados en cada uno de los últimos seis meses."
            />
        </Tarjeta>

        <Tarjeta titulo="Valor despachado por mes">
                      <Columnas
              datos={despachosMes}
              rotulo={(d) => mesCorto(d.mes)}
              series={[{ clave: 'monto', etiqueta: 'Monto de los despachos', color: VERDE }]}
              formato={pesos}
              formatoEje={pesosCorto}
              descripcion="Valor de los despachos registrados en cada uno de los últimos seis meses."
            />
        </Tarjeta>

        <Tarjeta titulo="Despachos por empresa transportadora">
                      <BarrasH
              items={porEmpresa.map((e) => ({
                nombre: e.nombre,
                valor: e.monto,
                extra: `${e.despachos} despachos`,
              }))}
              formato={pesosCorto}
              color={VERDE}
              vacio="Cuando se registren evidencias de transporte, aparecerán aquí."
            />
        </Tarjeta>

        <Tarjeta titulo="Lotes de pedido recientes">
                      <BarrasH
              items={lotes.map((l) => ({
                nombre: l.nombre,
                valor: l.valor,
                extra: `${l.unidades} unidades productivas · ${l.cantidad.toLocaleString('es-CO')} ítems`,
              }))}
              formato={pesosCorto}
              color={AZUL}
              vacio="Cuando se cargue un lote de pedido desde Excel, aparecerá aquí."
            />
        </Tarjeta>

        <Tarjeta titulo="Stock bajo o en el mínimo">
          <Tabla
            cabeceras={['Artículo', { texto: 'Stock', alinear: 'derecha' }, { texto: 'Mínimo', alinear: 'derecha' }, 'Cobertura']}
            vacio="Ningún artículo está en su mínimo. Todo en orden."
            iconoVacio={PackageCheck}
          >
            {(datos.bajos || []).map((a) => {
              const pct = a.minimo ? Math.round((a.stock / a.minimo) * 100) : 0
              return (
                <Fila key={a.id}>
                  <Celda>
                    <Link to="/inventario/articulos" className="font-semibold text-acento-txt hover:underline">
                      {a.nombre}
                    </Link>
                    <div className="font-mono text-[11px] text-gris-txt">{a.codigo_barras}</div>
                  </Celda>
                  <Celda alinear="derecha">
                    <Insignia tono={a.stock === 0 ? 'error' : 'alerta'}>{a.stock}</Insignia>
                  </Celda>
                  <Celda alinear="derecha" className="text-gris-txt">{a.minimo}</Celda>
                  <Celda>
                    <MiniBarra pct={pct} color={a.stock === 0 ? ROJO : AMARILLO} />
                  </Celda>
                </Fila>
              )
            })}
          </Tabla>
        </Tarjeta>

        <Tarjeta titulo="Últimos movimientos">
          <Tabla
            cabeceras={['Fecha', 'Artículo', 'Tipo', { texto: 'Cantidad', alinear: 'derecha' }]}
            vacio="Todavía no hay movimientos registrados."
            iconoVacio={History}
          >
            {(datos.movs || []).map((m) => (
              <Fila key={m.id}>
                <Celda className="whitespace-nowrap text-[13px] text-gris-txt">{fecha(m.fecha)}</Celda>
                <Celda>{m.art_nombre || '—'}</Celda>
                <Celda>
                  <Insignia tono={TONO_MOV[m.tipo] || 'neutro'}>{NOMBRE_MOV[m.tipo] || m.tipo}</Insignia>
                </Celda>
                <Celda alinear="derecha" className="font-semibold">{m.cantidad}</Celda>
              </Fila>
            ))}
          </Tabla>
        </Tarjeta>
      </div>
    </>
  )
}
