// Entregas de kits a las unidades productivas. El servidor fija la bodega de quien opera desde una bodega
// municipal y exige el responsable y el adjunto; el mismo formulario sirve a quienes administran, que eligen
// una municipal.
import { useState } from 'react'
import { FileDown, HandHelping, History, Plus, TriangleAlert, UserPlus, Wrench } from 'lucide-react'
import { api, fecha } from '../lib/api'
import { diaColombia } from '../../lib/carrito'
import { faltasInstalacion, instalacionAFormulario, textoInstalacion } from '../../lib/entregaFinal'
import { useSesion } from '../lib/sesion'
import { useAccion, useDatos } from '../lib/useDatos'
import Encabezado from '../componentes/Encabezado'
import NovedadesKit from '../componentes/NovedadesKit'
import {
  Alerta, AreaTexto, Boton, Campo, Cargando, Celda, Dialogo, Entrada, Fila, Seleccion, Tabla, Tarjeta,
} from '../componentes/ui'

const RESPONSABLE_VACIO = { tipo_documento: 'CC', numero_documento: '', primer_nombre: '', segundo_nombre: '', primer_apellido: '', segundo_apellido: '', celular: '', correo: '' }
const TIPOS_DOC = [['CC', 'Cédula de ciudadanía'], ['CE', 'Cédula de extranjería'], ['TI', 'Tarjeta de identidad'], ['PASAPORTE', 'Pasaporte'], ['PPT', 'Permiso por protección temporal']]
const nombreDe = (r) => r.nombre || [r.primer_nombre, r.segundo_nombre].filter(Boolean).join(' ')

// Formulario para registrar un responsable de entrega una sola vez; después se busca con el número de documento
// completo.
function FormResponsable({ alGuardar, ocupado, alCancelar, documento = '' }) {
  const [f, setF] = useState({ ...RESPONSABLE_VACIO, numero_documento: documento })
  const poner = (campo) => (e) => setF((v) => ({ ...v, [campo]: e.target.value }))
  return (
    <form onSubmit={(e) => { e.preventDefault(); alGuardar(f) }}>
      <fieldset disabled={ocupado} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Campo etiqueta="Tipo de documento" obligatorio>
          <Seleccion required value={f.tipo_documento} onChange={poner('tipo_documento')}>
            {TIPOS_DOC.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Número de documento" obligatorio>
          <Entrada required minLength={5} maxLength={20} value={f.numero_documento} onChange={poner('numero_documento')} autoComplete="off" />
        </Campo>
        <Campo etiqueta="Primer nombre" obligatorio>
          <Entrada required maxLength={60} value={f.primer_nombre} onChange={poner('primer_nombre')} autoComplete="off" />
        </Campo>
        <Campo etiqueta="Segundo nombre">
          <Entrada maxLength={60} value={f.segundo_nombre} onChange={poner('segundo_nombre')} autoComplete="off" />
        </Campo>
        <Campo etiqueta="Primer apellido" obligatorio>
          <Entrada required maxLength={60} value={f.primer_apellido} onChange={poner('primer_apellido')} autoComplete="off" />
        </Campo>
        <Campo etiqueta="Segundo apellido">
          <Entrada maxLength={60} value={f.segundo_apellido} onChange={poner('segundo_apellido')} autoComplete="off" />
        </Campo>
        <Campo etiqueta="Celular" obligatorio ayuda="10 dígitos, empieza por 3.">
          <Entrada required type="tel" inputMode="numeric" maxLength={20} value={f.celular} onChange={poner('celular')} autoComplete="off" />
        </Campo>
        <Campo etiqueta="Correo electrónico" obligatorio>
          <Entrada required type="email" maxLength={150} value={f.correo} onChange={poner('correo')} autoComplete="off" />
        </Campo>
        <div className="flex flex-wrap justify-end gap-2 border-t border-borde pt-4 sm:col-span-2">
          <Boton variante="fantasma" onClick={alCancelar}>Cancelar</Boton>
          <Boton tipo="submit" icono={UserPlus} cargando={ocupado}>Guardar responsable</Boton>
        </div>
      </fieldset>
    </form>
  )
}

// Formulario de instalación, puesta en marcha y capacitación de uso de una entrega; si no aplica solo se dice y
// si aplica van las fechas, que no pueden ser anteriores a la entrega.
function FormInstalacion({ entrega, ocupado, alGuardar, alCancelar }) {
  const [f, setF] = useState(() => instalacionAFormulario(entrega.instalacion))
  const [soporte, setSoporte] = useState(null)
  const [errorSoporte, setErrorSoporte] = useState('')
  const entregado = diaColombia(entrega.fecha)
  const faltas = faltasInstalacion(f, { soporte, tieneSoporte: entrega.instalacion_con_soporte && entrega.instalacion?.aplica, entregado })
  const poner = (campo) => (e) => setF((v) => ({ ...v, [campo]: e.target.value }))
  const enviar = (e) => {
    e.preventDefault()
    const fd = new FormData()
    for (const [k, v] of Object.entries(f)) fd.append(k, v)
    if (soporte) fd.append('soporte', soporte)
    alGuardar(fd)
  }
  return (
    <form onSubmit={enviar}>
      <fieldset disabled={ocupado} className="grid min-w-0 gap-4">
        <p className="text-[13px] text-gris-txt">Entrega de kit {String(entrega.id).padStart(5, '0')} · {entrega.kit} · entregado el {entregado}.</p>
        <Campo etiqueta="¿Aplica la instalación y puesta en marcha?" obligatorio>
          <Seleccion required value={f.aplica} onChange={poner('aplica')}>
            <option value="">Elige…</option><option value="si">Sí</option><option value="no">No: el kit no requiere instalación</option>
          </Seleccion>
        </Campo>
        {f.aplica === 'si' && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo etiqueta="Fecha de instalación" obligatorio><Entrada required type="date" min={entregado} value={f.fecha_instalacion} onChange={poner('fecha_instalacion')} /></Campo>
              <Campo etiqueta="Fecha de puesta en marcha" obligatorio><Entrada required type="date" min={f.fecha_instalacion || entregado} value={f.fecha_puesta_marcha} onChange={poner('fecha_puesta_marcha')} /></Campo>
            </div>
            <Campo etiqueta="¿Hubo capacitación de uso?" obligatorio>
              <Seleccion required value={f.capacitacion} onChange={poner('capacitacion')}>
                <option value="">Elige…</option><option value="si">Sí</option><option value="no">No</option>
              </Seleccion>
            </Campo>
            {f.capacitacion === 'si' && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Campo etiqueta="Fecha de la capacitación" obligatorio><Entrada required type="date" min={entregado} value={f.capacitacion_fecha} onChange={poner('capacitacion_fecha')} /></Campo>
                <Campo etiqueta="Quién la dio" obligatorio><Entrada required maxLength={200} value={f.capacitacion_por} onChange={poner('capacitacion_por')} /></Campo>
                <Campo etiqueta="Quién la recibió" obligatorio><Entrada required maxLength={200} value={f.capacitacion_recibe} onChange={poner('capacitacion_recibe')} /></Campo>
              </div>
            )}
            <Campo etiqueta="Soporte de la instalación" obligatorio={!entrega.instalacion_con_soporte} error={errorSoporte}
              ayuda={entrega.instalacion_con_soporte ? 'Ya hay un soporte guardado; adjunta otro solo para reemplazarlo. PDF, JPG o PNG, máximo 10 MB.' : 'Acta o foto en PDF, JPG o PNG. Máximo 10 MB.'}>
              <Entrada type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" aria-invalid={Boolean(errorSoporte) || undefined} onChange={(e) => {
                const a = e.target.files?.[0] || null
                const excede = a && a.size > 10 * 1024 * 1024
                setErrorSoporte(excede ? 'El archivo supera el máximo de 10 MB.' : '')
                setSoporte(excede ? null : a)
              }} />
            </Campo>
          </>
        )}
        <Campo etiqueta="Observaciones"><AreaTexto maxLength={2000} rows={2} value={f.observaciones} onChange={poner('observaciones')} /></Campo>
        {faltas.length > 0 && f.aplica && <p className="text-[12px] text-gris-txt">Falta: {faltas.join(' ')}</p>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-borde pt-4">
          <Boton variante="fantasma" onClick={alCancelar}>Cancelar</Boton>
          <Boton tipo="submit" icono={Wrench} cargando={ocupado} disabled={faltas.length > 0 || Boolean(errorSoporte)}>Guardar</Boton>
        </div>
      </fieldset>
    </form>
  )
}

// Muestra las entregas y el formulario para registrar una nueva.
export default function EntregasKits() {
  const { esAdmin } = useSesion()
  const [bodegaId, setBodegaId] = useState('')
  const { datos, cargando, recargar } = useDatos(`/entregas-kits${bodegaId ? `?bodega_id=${bodegaId}` : ''}`)
  const { ejecutar, ocupado } = useAccion(recargar)
  const [vista, setVista] = useState('formulario')
  const [kitId, setKitId] = useState('')
  const [responsable, setResponsable] = useState(null)
  const [docBusca, setDocBusca] = useState('')
  const [errorResp, setErrorResp] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [nuevoResponsable, setNuevoResponsable] = useState(false)
  const [nota, setNota] = useState('')
  const [adjunto, setAdjunto] = useState(null)
  const [archivoKey, setArchivoKey] = useState(0)
  const [errorAdjunto, setErrorAdjunto] = useState('')
  const [novedadKit, setNovedadKit] = useState(false)
  const [instalando, setInstalando] = useState(null)

  const bid = esAdmin ? bodegaId : datos?.bodega?.id
  const kits = datos?.kits || []
  const kit = kits.find((k) => String(k.id) === String(kitId)) || null
  const necesarios = kit?.items || []
  const alcanza = necesarios.length > 0 && necesarios.every((i) => i.activo && i.disponible >= i.cantidad)

  const guardar = async (e) => {
    e.preventDefault()
    if (!adjunto) { setErrorAdjunto('Adjunta el soporte de la entrega.'); return }
    const f = new FormData()
    f.append('combo_id', String(kit.id))
    f.append('responsable_id', String(responsable.id))
    f.append('bodega_id', String(bid))
    f.append('nota', nota)
    f.append('adjunto', adjunto)
    const r = await ejecutar(() => api.post('/entregas-kits', f))
    if (r) {
      setKitId(''); setNota(''); setAdjunto(null); setArchivoKey((k) => k + 1)
      setVista('historial')
    }
  }
  const crearResponsable = async (f) => {
    const r = await ejecutar(() => api.post('/entregas-kits/responsables', { ...f, bodega_id: bid }))
    if (r) { setResponsable(r.responsable); setErrorResp(''); setNuevoResponsable(false) }
  }
  const buscarResponsable = async () => {
    setErrorResp(''); setResponsable(null); setBuscando(true)
    try { setResponsable((await api.get(`/entregas-kits/responsables/buscar?documento=${encodeURIComponent(docBusca)}`)).responsable) }
    catch (e) { setErrorResp(e.estado === 404 ? 'notfound' : (e.message || 'No se pudo buscar.')) }
    finally { setBuscando(false) }
  }

  return (
    <>
      <Encabezado titulo="Entregas de kits" descripcion="Registra la salida del kit de una unidad productiva desde la bodega municipal, con su responsable y soporte.">
        <Boton variante="fantasma" icono={vista === 'formulario' ? History : Plus} disabled={ocupado}
          onClick={() => setVista(vista === 'formulario' ? 'historial' : 'formulario')}>
          {vista === 'formulario' ? 'Ver historial' : 'Nueva entrega'}
        </Boton>
      </Encabezado>

      {datos?.aviso && <Alerta tono="aviso" className="mb-4">{datos.aviso}</Alerta>}
      {cargando && !datos ? <Cargando /> : vista === 'formulario' ? (
        <Tarjeta titulo="Nueva entrega de kit">
          <form onSubmit={guardar}>
            <fieldset disabled={ocupado || cargando || Boolean(datos?.aviso)} className="grid min-w-0 gap-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo etiqueta="Bodega municipal" obligatorio ayuda={esAdmin ? 'Bodega de la que saldrán los artículos del kit.' : 'Esta es tu bodega asignada. La entrega solo descuenta sus existencias.'}>
                  {esAdmin ? (
                    <Seleccion required value={bodegaId} onChange={(e) => {
                      setBodegaId(e.target.value); setKitId('')
                    }}>
                      <option value="">Elige la bodega municipal…</option>
                      {(datos?.bodegas || []).map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                    </Seleccion>
                  ) : <Entrada readOnly value={datos?.bodega?.nombre || 'Sin asignar'} />}
                </Campo>
                <Campo etiqueta="Kit / Unidad productiva" obligatorio ayuda="Cada entrega es de una sola unidad productiva.">
                  <Seleccion required value={kitId} disabled={!bid} onChange={(e) => setKitId(e.target.value)}>
                    <option value="">Elige el kit a entregar…</option>
                    {kits.map((k) => <option key={k.id} value={k.id}>{k.nombre} · {k.codigo_barras}</option>)}
                  </Seleccion>
                </Campo>
              </div>

              {bid && !cargando && !datos?.kits?.length && <Alerta tono="aviso">No hay kits pendientes de entrega. Los kits del flujo anterior cuyo inventario ya se descontó no se pueden volver a descontar.</Alerta>}
              {kit && (
                <div>
                  <Tabla cabeceras={['Artículo', 'Cantidad del kit', 'Disponible en esta bodega']}>
                    {necesarios.map((i) => (
                      <Fila key={i.articulo_id}>
                        <Celda>{i.nombre}</Celda><Celda>{i.cantidad}</Celda><Celda>{i.disponible}</Celda>
                      </Fila>
                    ))}
                  </Tabla>
                  {!alcanza && (
                    <Alerta tono="aviso" className="mt-3">El kit no se puede entregar: faltan artículos activos o cantidades en esta bodega.</Alerta>
                  )}
                  <div className="mt-3">
                    <Boton variante="fantasma" icono={TriangleAlert} onClick={() => setNovedadKit(true)}>Reportar novedad del kit</Boton>
                  </div>
                </div>
              )}

              <div className="grid gap-3 border-t border-borde pt-5">
                <div>
                  <label htmlFor="doc-responsable" className="mb-1.5 block text-[13px] font-semibold text-gris-txt">
                    Responsable de la entrega<span aria-hidden="true" className="ml-0.5 text-rojo-txt">*</span><span className="sr-only"> (obligatorio)</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Entrada id="doc-responsable" className="min-w-0 flex-1 basis-56" value={docBusca} disabled={!bid} maxLength={20} autoComplete="off"
                      placeholder="Número de documento"
                      onChange={(e) => { setDocBusca(e.target.value); setErrorResp(''); if (responsable) setResponsable(null) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (docBusca.trim()) buscarResponsable() } }} />
                    <Boton variante="fantasma" disabled={!bid || !docBusca.trim()} cargando={buscando} onClick={buscarResponsable}>Buscar</Boton>
                    <Boton variante="fantasma" icono={UserPlus} disabled={!bid} onClick={() => setNuevoResponsable(true)}>Registrar responsable</Boton>
                  </div>
                  <p className="mt-1.5 text-[12px] leading-snug text-gris">Escribe su número de documento completo para buscarlo. La misma persona se puede usar en varias entregas.</p>
                </div>
                {responsable && (
                  <p className="text-[13px] text-gris-txt"><strong className="text-texto">{nombreDe(responsable)}</strong> · {responsable.tipo_documento} {responsable.documento} · Celular: {responsable.celular} · {responsable.correo}</p>
                )}
                {errorResp === 'notfound' && <Alerta tono="aviso">No hay un responsable con ese número de documento. Verifica que esté completo o regístralo con el botón.</Alerta>}
                {errorResp && errorResp !== 'notfound' && <Alerta tono="aviso">{errorResp}</Alerta>}
              </div>

              <Campo etiqueta="Adjunto de la entrega" obligatorio error={errorAdjunto} ayuda="Acta o soporte en PDF, JPG o PNG. Máximo 10 MB.">
                <Entrada key={archivoKey} type="file" required accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null
                    const excede = f && f.size > 10 * 1024 * 1024
                    setErrorAdjunto(excede ? 'El archivo supera el máximo de 10 MB.' : '')
                    setAdjunto(excede ? null : f)
                  }} />
              </Campo>
              <Campo etiqueta="Observaciones"><AreaTexto maxLength={2000} rows={3} value={nota} onChange={(e) => setNota(e.target.value)} /></Campo>
              <div className="flex justify-end border-t border-borde pt-4">
                <Boton tipo="submit" icono={HandHelping} cargando={ocupado} disabled={!bid || !alcanza || !responsable || !adjunto}>
                  Registrar entrega de kit
                </Boton>
              </div>
            </fieldset>
          </form>
        </Tarjeta>
      ) : (
        <Tarjeta titulo="Historial de entregas de kits">
          <Tabla cabeceras={['Comprobante', 'Fecha', 'Kit / UP', 'Bodega', 'Responsable', 'Artículos', 'Instalación', 'Registró', 'Soporte']} vacio="Todavía no hay entregas de kits.">
            {(datos?.entregas || []).map((e) => (
              <Fila key={e.id}>
                <Celda>Entrega de kit {String(e.id).padStart(5, '0')}</Celda>
                <Celda>{fecha(e.fecha)}</Celda><Celda>{e.kit}</Celda><Celda>{e.bodega}</Celda>
                <Celda><strong>{nombreDe(e.responsable)}</strong><div>{e.responsable.tipo_documento} {e.responsable.documento}</div><div>{e.responsable.celular || e.responsable.telefono}</div><div>{e.responsable.correo}</div></Celda>
                <Celda>{(e.items || []).map((i) => `${i.cantidad} × ${i.nombre}`).join(', ')}{e.nota && <p className="mt-1 text-gris-txt">{e.nota}</p>}</Celda>
                <Celda>
                  <div className="text-[12px]">{textoInstalacion(e.instalacion)}</div>
                  {e.instalacion_con_soporte && <a href={`/api/inv/entregas-kits/${e.id}/instalacion/soporte`} aria-label={`Soporte de la instalación de la entrega ${e.id}`} className="inline-flex items-center gap-1 text-[12px] font-semibold text-acento-txt underline"><FileDown size={14} aria-hidden="true" />Soporte</a>}
                  <div className="mt-1"><Boton tamano="sm" variante="fantasma" icono={Wrench} disabled={ocupado} onClick={() => setInstalando(e)}>{e.instalacion ? 'Corregir' : 'Registrar'}</Boton></div>
                </Celda>
                <Celda>{e.creado_por}</Celda>
                <Celda><a href={`/api/inv/entregas-kits/${e.id}/adjunto`} className="inline-flex items-center gap-2 font-semibold text-acento-txt underline"><FileDown size={16} aria-hidden="true" />Descargar soporte</a></Celda>
              </Fila>
            ))}
          </Tabla>
        </Tarjeta>
      )}

      {novedadKit && kit && <NovedadesKit kit={kit} onCerrar={() => setNovedadKit(false)} />}
      <Dialogo abierto={nuevoResponsable} titulo="Registrar responsable de entrega" onCerrar={() => { if (!ocupado) setNuevoResponsable(false) }} ancho="max-w-xl">
        {nuevoResponsable && <FormResponsable alGuardar={crearResponsable} ocupado={ocupado} documento={docBusca} alCancelar={() => setNuevoResponsable(false)} />}
      </Dialogo>
      <Dialogo abierto={Boolean(instalando)} titulo="Instalación, puesta en marcha y capacitación" onCerrar={() => { if (!ocupado) setInstalando(null) }} ancho="max-w-2xl">
        {instalando && (
          <FormInstalacion entrega={instalando} ocupado={ocupado} alCancelar={() => setInstalando(null)}
            alGuardar={async (fd) => { const r = await ejecutar(() => api.post(`/entregas-kits/${instalando.id}/instalacion`, fd)); if (r) setInstalando(null) }} />
        )}
      </Dialogo>
    </>
  )
}
