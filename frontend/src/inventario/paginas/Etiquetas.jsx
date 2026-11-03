// Hoja de etiquetas para imprimir. Lo que se elige (tipo, formato, copias e ids) vive en la dirección, así el
// enlace se puede compartir o recargar.
import { useMemo } from 'react'
import { Printer, Tag } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { qs, urlBarcode, urlQr } from '../lib/api'
import { useDatos } from '../lib/useDatos'
import Encabezado from '../componentes/Encabezado'
import {
  Alerta, Boton, Campo, Cargando, Entrada, Seleccion, Tarjeta, Vacio,
} from '../componentes/ui'

// Formatos de etiqueta que se pueden imprimir.
const FORMATOS = [
  { v: 'qr', t: 'Solo QR' },
  { v: 'barras', t: 'Solo código de barras' },
  { v: 'ambos', t: 'QR y código de barras' },
]

// Muestra las opciones y la vista previa de las etiquetas.
export default function Etiquetas() {
  const [params, setParams] = useSearchParams()
  const tipo = params.get('tipo') === 'combo' ? 'combo' : 'articulo'
  const copias = Math.min(20, Math.max(1, Number(params.get('copias') || 1)))
  const formato = FORMATOS.some((f) => f.v === params.get('formato'))
    ? params.get('formato')
    : 'qr'
  const ids = params.getAll('id')

  const ruta = useMemo(() => `/codigos/etiquetas${qs({ tipo, copias, id: ids })}`, [tipo, copias, ids.join(',')])
  const { datos, cargando } = useDatos(ruta)

  const fijar = (cambios) => {
    const base = { tipo, copias: String(copias), formato, ...cambios }
    const p = new URLSearchParams()
    Object.entries(base).forEach(([k, v]) => v && p.append(k, v))
    ids.forEach((i) => p.append('id', i))
    setParams(p)
  }

  const etiquetas = datos?.etiquetas || []

  return (
    <>
      <Encabezado
        titulo="Etiquetas para imprimir"
        descripcion={`${etiquetas.length} etiqueta(s) de ${tipo === 'combo' ? 'Kit UP' : 'artículos'}.`}
      >
        <Boton variante="oscuro" icono={Printer} onClick={() => window.print()}>Imprimir</Boton>
      </Encabezado>

      <Tarjeta className="no-imprimir mb-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo etiqueta="Qué etiquetar">
            <Seleccion value={tipo} onChange={(e) => fijar({ tipo: e.target.value })}>
              <option value="articulo">Artículos</option>
              <option value="combo">Kit UP</option>
            </Seleccion>
          </Campo>
          <Campo etiqueta="Formato">
            <Seleccion value={formato} onChange={(e) => fijar({ formato: e.target.value })}>
              {FORMATOS.map((f) => (
                <option key={f.v} value={f.v}>{f.t}</option>
              ))}
            </Seleccion>
          </Campo>
          <Campo etiqueta="Copias de cada etiqueta">
            <Entrada
              type="number"
              min="1"
              max="20"
              value={copias}
              onChange={(e) => fijar({ copias: e.target.value })}
            />
          </Campo>
        </div>
        {datos?.recortado && (
          <Alerta className="mt-4">
            La lista se recortó a {datos.maximo} etiquetas para no colgar el navegador.
            Imprime por tandas si necesitas más.
          </Alerta>
        )}
      </Tarjeta>

      {cargando ? (
        <Cargando />
      ) : etiquetas.length === 0 ? (
        <Tarjeta>
          <Vacio icono={Tag}>No hay nada que etiquetar todavía.</Vacio>
        </Tarjeta>
      ) : (
        <div className="hoja-etiquetas grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
          {etiquetas.map((e, i) => (
            <div
              key={`${e.codigo}-${i}`}
              className="flex break-inside-avoid flex-col items-center gap-2 papel rounded-xl border border-borde bg-white p-3 text-center shadow-tarjeta"
            >
              <div className="line-clamp-2 min-h-8 text-[12px] leading-tight font-semibold text-marca">
                {e.nombre}
              </div>
              {(formato === 'qr' || formato === 'ambos') && (
                <img
                  src={urlQr(e.codigo, 5)}
                  alt={`QR ${e.codigo}`}
                  width="96"
                  height="96"
                  loading="lazy"
                  className="size-24"
                />
              )}
              {(formato === 'barras' || formato === 'ambos') && (
                <img
                  src={urlBarcode(e.codigo)}
                  alt={`Código ${e.codigo}`}
                  loading="lazy"
                  className="h-12 w-full object-contain"
                />
              )}
              <div className="font-mono text-[11px] text-gris-txt">{e.codigo}</div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
