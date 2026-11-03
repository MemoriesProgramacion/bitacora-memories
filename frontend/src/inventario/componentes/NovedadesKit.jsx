// Ventana de novedades de un kit: arriba el formulario con los artículos afectados, cada uno con su foto, tipo
// y texto, y abajo lo que ya se reportó del kit.
import { useEffect, useMemo, useState } from 'react'
import { Camera, FileDown, PackageCheck, Truck } from 'lucide-react'
import { api, fecha } from '../lib/api'
import { useAccion, useDatos } from '../lib/useDatos'
import { AreaTexto, Boton, Campo, Cargando, Dialogo, Entrada, Insignia, Seleccion } from './ui'
import { ESTADOS_DEFECTO, textoSeguimiento } from '../../lib/entregaFinal'

const hoyColombia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
const SEGUIMIENTO_VACIO = { proveedor_id: '', fecha: '', guia: '', nota: '' }

const MAX_FOTO_MB = 10
const MAX_ARTICULOS = 20
const TIPOS = { danado: 'Dañado', incompleto: 'Incompleto', otro: 'Otro' }
const TONOS = { danado: 'error', incompleto: 'alerta', otro: 'neutro' }

// Muestra una miniatura que abre la foto en tamaño completo.
function Miniatura({ src, texto }) {
  return (
    <a href={src} target="_blank" rel="noreferrer" aria-label={`Abrir la foto de ${texto} en tamaño completo`} className="shrink-0">
      <img src={src} alt={`Foto de ${texto}`} loading="lazy" className="size-20 rounded-lg border border-borde object-cover" />
    </a>
  )
}

// Muestra el formulario de novedad y el historial de novedades del kit.
export default function NovedadesKit({ kit, onCerrar, alCambiar }) {
  const { datos, cargando, recargar } = useDatos(`/kits/${kit.id}/novedades`)
  const { ejecutar, ocupado } = useAccion(recargar)
  const [afectados, setAfectados] = useState({})
  const [fotos, setFotos] = useState({})
  const [erroresFoto, setErroresFoto] = useState({})
  const [tipo, setTipo] = useState('danado')
  const [texto, setTexto] = useState('')
  const [archivoKey, setArchivoKey] = useState(0)
  const [accion, setAccion] = useState(null)
  const [seg, setSeg] = useState(SEGUIMIENTO_VACIO)
  const [soporte, setSoporte] = useState(null)
  const abrirAccion = (n, tipo) => { setSeg({ ...SEGUIMIENTO_VACIO, fecha: hoyColombia() }); setSoporte(null); setAccion({ id: n.id, tipo }) }
  const registrarSeguimiento = async (n) => {
    let r
    if (accion.tipo === 'devolucion') {
      r = await ejecutar(() => api.post(`/kits/novedades/${n.id}/devolucion`, { proveedor_id: seg.proveedor_id, fecha: seg.fecha, guia: seg.guia.trim(), nota: seg.nota.trim() }))
    } else {
      const f = new FormData()
      f.append('fecha', seg.fecha); f.append('nota', seg.nota.trim())
      if (soporte) f.append('soporte', soporte)
      r = await ejecutar(() => api.post(`/kits/novedades/${n.id}/reemplazo`, f))
    }
    if (r) { setAccion(null); setSoporte(null); alCambiar?.() }
  }

  const vistas = useMemo(() => Object.fromEntries(Object.entries(fotos).map(([aid, f]) => [aid, URL.createObjectURL(f)])), [fotos])
  useEffect(() => () => Object.values(vistas).forEach((u) => URL.revokeObjectURL(u)), [vistas])

  const articulos = datos?.kit?.articulos || []
  const proveedores = datos?.proveedores || []
  const marcados = articulos.filter((a) => afectados[a.articulo_id] !== undefined)

  const sinClave = (obj, clave) => { const sig = { ...obj }; delete sig[clave]; return sig }
  const marcar = (a, si) => {
    setAfectados((m) => (si ? { ...m, [a.articulo_id]: 1 } : sinClave(m, a.articulo_id)))
    if (!si) {
      setFotos((m) => sinClave(m, a.articulo_id))
      setErroresFoto((m) => sinClave(m, a.articulo_id))
    }
  }
  const fijarCantidad = (a, valor) => setAfectados((m) => ({ ...m, [a.articulo_id]: valor }))
  const cantidadValida = (a) => Number.isInteger(afectados[a.articulo_id]) && afectados[a.articulo_id] >= 1 && afectados[a.articulo_id] <= a.cantidad

  const elegirFoto = (a, e) => {
    const f = e.target.files?.[0] || null
    const excede = f && f.size > MAX_FOTO_MB * 1024 * 1024
    setErroresFoto((m) => (excede ? { ...m, [a.articulo_id]: `La foto supera el máximo de ${MAX_FOTO_MB} MB.` } : sinClave(m, a.articulo_id)))
    setFotos((m) => (f && !excede ? { ...m, [a.articulo_id]: f } : sinClave(m, a.articulo_id)))
  }

  const enviar = async (e) => {
    e.preventDefault()
    const faltan = marcados.filter((a) => !fotos[a.articulo_id])
    if (faltan.length) {
      setErroresFoto((m) => ({ ...m, ...Object.fromEntries(faltan.map((a) => [a.articulo_id, 'Adjunta la foto de este artículo.'])) }))
      return
    }
    const f = new FormData()
    f.append('kit_id', String(kit.id))
    f.append('articulos', JSON.stringify(marcados.map((a) => ({ articulo_id: a.articulo_id, cantidad: afectados[a.articulo_id] }))))
    f.append('tipo', tipo)
    f.append('texto', texto.trim())
    for (const a of marcados) f.append(`foto_${a.articulo_id}`, fotos[a.articulo_id])
    const r = await ejecutar(() => api.post('/kits/novedades', f))
    if (r) {
      setTexto(''); setTipo('danado'); setAfectados({}); setFotos({}); setErroresFoto({}); setArchivoKey((k) => k + 1)
      alCambiar?.()
    }
  }

  const novedades = datos?.novedades || []
  const listo = marcados.length > 0 && marcados.every((a) => cantidadValida(a) && fotos[a.articulo_id]) && texto.trim()

  return (
    <Dialogo abierto titulo={`Novedades de ${kit.nombre}`} onCerrar={onCerrar} ancho="max-w-2xl">
      <form onSubmit={enviar} className="grid gap-4">
        <p className="text-[13px] text-gris-txt">
          Marca los artículos del kit que tienen la novedad y sube la foto de cada uno. Se guarda con tu nombre y la fecha; no cambia el inventario.
          Una novedad «Dañado» o «Incompleto» es el acta de elementos defectuosos: se avisa al Coordinador local regional de la unidad y
          aquí se registran la devolución al proveedor y el reemplazo.
        </p>

        <fieldset>
          <legend className="mb-1.5 block text-[13px] font-semibold text-gris-txt">
            Artículos con novedad ({marcados.length})<span aria-hidden="true" className="ml-0.5 text-rojo-txt">*</span>
            <span className="sr-only"> (obligatorio)</span>
          </legend>
          {cargando && !datos ? <Cargando /> : !articulos.length ? (
            <p className="text-[13px] text-gris-txt">Este kit no tiene artículos.</p>
          ) : (
            <ul className="grid gap-2">
              {articulos.map((a) => {
                const marcado = afectados[a.articulo_id] !== undefined
                const idCasilla = `nov-art-${a.articulo_id}`
                const idFoto = `nov-foto-${a.articulo_id}`
                const errorFoto = erroresFoto[a.articulo_id]
                const lleno = !marcado && marcados.length >= MAX_ARTICULOS
                return (
                  <li key={a.articulo_id} className={`rounded-xl border px-3 py-2 ${marcado ? 'border-acento bg-acento-bg' : 'border-borde'}`}>
                    <div className="flex flex-wrap items-center gap-3">
                      <input id={idCasilla} type="checkbox" checked={marcado} disabled={lleno} onChange={(e) => marcar(a, e.target.checked)}
                        className="h-4 w-4 shrink-0 accent-[var(--color-acento)]" />
                      <label htmlFor={idCasilla} className="min-w-0 flex-1 cursor-pointer text-[13px] font-semibold">
                        {a.nombre}
                        <span className="ml-1 font-normal text-gris-txt">· el kit lleva {a.cantidad}</span>
                      </label>
                      {marcado && a.cantidad > 1 && (
                        <label className="flex items-center gap-2 text-[12px] text-gris-txt">
                          Unidades afectadas
                          <Entrada type="number" inputMode="numeric" min={1} max={a.cantidad} step={1} className="w-20"
                            value={afectados[a.articulo_id] ?? ''} aria-invalid={!cantidadValida(a) || undefined}
                            onChange={(e) => fijarCantidad(a, e.target.value === '' ? '' : Number(e.target.value))} />
                        </label>
                      )}
                    </div>
                    {marcado && (
                      <div className="mt-2 flex flex-wrap items-start gap-3 border-t border-borde pt-2 sm:pl-7">
                        <div className="min-w-0 flex-1 basis-60">
                          <label htmlFor={idFoto} className="mb-1 block text-[12px] font-semibold text-gris-txt">
                            Foto de {a.nombre}<span aria-hidden="true" className="ml-0.5 text-rojo-txt">*</span><span className="sr-only"> (obligatoria)</span>
                          </label>
                          <Entrada key={`${archivoKey}-${a.articulo_id}`} id={idFoto} type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                            onChange={(e) => elegirFoto(a, e)} aria-invalid={Boolean(errorFoto) || undefined}
                            aria-describedby={errorFoto ? `${idFoto}-error` : undefined} />
                          {errorFoto
                            ? <p id={`${idFoto}-error`} className="mt-1 text-[12px] text-rojo-txt" role="alert">{errorFoto}</p>
                            : <p className="mt-1 text-[12px] text-gris">JPG o PNG. Máximo {MAX_FOTO_MB} MB.</p>}
                        </div>
                        {vistas[a.articulo_id] && (
                          <img src={vistas[a.articulo_id]} alt={`Vista previa de la foto de ${a.nombre}`} className="size-20 rounded-lg border border-borde object-cover" />
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {marcados.some((a) => !cantidadValida(a)) && (
            <p className="mt-1.5 text-[12px] text-rojo-txt" role="alert">Las unidades afectadas deben estar entre 1 y lo que lleva el kit.</p>
          )}
        </fieldset>

        <Campo etiqueta="Tipo de novedad" obligatorio>
          <Seleccion value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Estado de los artículos" obligatorio ayuda="Cuenta qué pasó: qué está dañado o qué falta.">
          <AreaTexto required maxLength={2000} rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} />
        </Campo>
        <div className="flex justify-end">
          <Boton tipo="submit" icono={Camera} cargando={ocupado} disabled={!listo}>
            {marcados.length > 1 ? `Registrar novedad de ${marcados.length} artículos` : 'Registrar novedad'}
          </Boton>
        </div>
      </form>

      <div className="mt-6 border-t border-borde pt-4">
        <h3 className="mb-3 text-[14px] font-bold">Novedades de {kit.nombre} ({novedades.length})</h3>
        {cargando && !datos ? <Cargando /> : !novedades.length ? (
          <p className="text-[13px] text-gris-txt">Este kit no tiene novedades.</p>
        ) : (
          <ul className="grid gap-3">
            {novedades.map((n) => {
              const base = `/api/inv/kits/${kit.id}/novedades/${n.id}`
              const conFotos = (n.articulos || []).filter((a) => a.con_foto)
              return (
                <li key={n.id} className="rounded-xl border border-borde p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Insignia tono={TONOS[n.tipo] || 'neutro'}>{TIPOS[n.tipo] || n.tipo}</Insignia>
                    {n.estado && <Insignia tono={ESTADOS_DEFECTO[n.estado]?.tono}>Acta {String(n.id).padStart(5, '0')} · {ESTADOS_DEFECTO[n.estado]?.texto}</Insignia>}
                    <span className="text-[12px] text-gris-txt">{n.creado_por} · {fecha(n.creado)}{n.id_unico ? ` · U.P. ${n.id_unico}` : ''}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-[13px]">{n.texto}</p>
                  {conFotos.length > 0 ? (
                    <ul className="mt-2 flex flex-wrap gap-3">
                      {(n.articulos || []).map((a) => (
                        <li key={a.articulo_id} className="grid w-24 gap-1 text-[12px]">
                          {a.con_foto && <Miniatura src={`${base}/articulos/${a.articulo_id}/foto`} texto={a.nombre} />}
                          <span className="break-words font-semibold">{a.cantidad} × {a.nombre}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-start gap-3">
                      {n.con_foto && <Miniatura src={`${base}/foto`} texto="la novedad" />}
                      {n.articulos?.length > 0 && (
                        <p className="text-[13px] font-semibold">{n.articulos.map((a) => `${a.cantidad} × ${a.nombre}`).join(', ')}</p>
                      )}
                    </div>
                  )}
                  {n.tambien?.length > 0 && <p className="mt-1 text-[12px] text-gris-txt">También aplica a: {n.tambien.join(', ')}</p>}
                  {n.estado && (
                    <div className="mt-2 grid gap-2 border-t border-borde pt-2 text-[12px]">
                      <p className="text-gris-txt">{textoSeguimiento(n)}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <a href={`${base}/acta`} target="_blank" rel="noreferrer" aria-label={`Acta de elementos defectuosos ${n.id} (PDF)`} className="inline-flex items-center gap-1 font-semibold text-acento-txt underline"><FileDown size={14} aria-hidden="true" />Acta (PDF)</a>
                        {n.reemplazo_con_soporte && <a href={`${base}/reemplazo/soporte`} aria-label={`Soporte del reemplazo del acta ${n.id}`} className="inline-flex items-center gap-1 font-semibold text-acento-txt underline"><FileDown size={14} aria-hidden="true" />Soporte del reemplazo</a>}
                        {n.estado === 'reportada' && accion?.id !== n.id && <Boton tamano="sm" variante="fantasma" icono={Truck} disabled={ocupado} onClick={() => abrirAccion(n, 'devolucion')}>Registrar devolución al proveedor</Boton>}
                        {n.estado === 'devuelta' && accion?.id !== n.id && <Boton tamano="sm" variante="fantasma" icono={PackageCheck} disabled={ocupado} onClick={() => abrirAccion(n, 'reemplazo')}>Registrar reemplazo entregado</Boton>}
                      </div>
                      {accion?.id === n.id && (
                        <form className="grid gap-2 rounded-lg border border-borde p-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); registrarSeguimiento(n) }}>
                          {accion.tipo === 'devolucion' ? (
                            <>
                              <Campo etiqueta="Proveedor" obligatorio>
                                <Seleccion required value={seg.proveedor_id} onChange={(e) => setSeg((s) => ({ ...s, proveedor_id: e.target.value }))}>
                                  <option value="">Elige el proveedor…</option>
                                  {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                                </Seleccion>
                              </Campo>
                              {!proveedores.length && <p className="text-[12px] text-aviso-txt sm:col-span-2">No hay proveedores registrados en el Inventario: el administrador los crea en Inventario › Proveedores.</p>}
                              <Campo etiqueta="Fecha de la devolución" obligatorio><Entrada required type="date" max={hoyColombia()} value={seg.fecha} onChange={(e) => setSeg((s) => ({ ...s, fecha: e.target.value }))} /></Campo>
                              <Campo etiqueta="Guía o remisión"><Entrada maxLength={100} value={seg.guia} onChange={(e) => setSeg((s) => ({ ...s, guia: e.target.value }))} /></Campo>
                            </>
                          ) : (
                            <>
                              <Campo etiqueta="Fecha en que la unidad recibió el reemplazo" obligatorio><Entrada required type="date" max={hoyColombia()} value={seg.fecha} onChange={(e) => setSeg((s) => ({ ...s, fecha: e.target.value }))} /></Campo>
                              <Campo etiqueta="Soporte del reemplazo" obligatorio ayuda="Acta o foto en PDF, JPG o PNG. Máximo 10 MB.">
                                <Entrada required type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" onChange={(e) => setSoporte(e.target.files?.[0] || null)} />
                              </Campo>
                            </>
                          )}
                          <Campo etiqueta="Nota" className="sm:col-span-2"><Entrada maxLength={1000} value={seg.nota} onChange={(e) => setSeg((s) => ({ ...s, nota: e.target.value }))} /></Campo>
                          <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
                            <Boton tamano="sm" variante="fantasma" onClick={() => setAccion(null)}>Cancelar</Boton>
                            <Boton tamano="sm" tipo="submit" cargando={ocupado} disabled={accion.tipo === 'devolucion' ? !seg.proveedor_id || !seg.fecha : !seg.fecha || !soporte}>Guardar</Boton>
                          </div>
                        </form>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Dialogo>
  )
}
