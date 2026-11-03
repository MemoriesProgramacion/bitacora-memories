// Piezas de interfaz reutilizables: tarjeta, botones, campos, tabla adaptable, insignias, alertas, avisos,
// diálogos y estados de carga. Todas cumplen reglas de diseño y accesibilidad: iconos SVG, objetivos táctiles
// amplios, texto de 16 px en campos y transiciones cortas que se apagan con prefers-reduced-motion.
import {
  Children, cloneElement, createContext, isValidElement, useCallback, useContext,
  useEffect, useRef, useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import {
  ChevronDown, CircleAlert, CircleCheck, Eye, EyeOff, Home, Inbox, ShieldAlert, TriangleAlert, X,
} from 'lucide-react'
import FondoAnimado from '../../components/FondoAnimado'

const conAncho = (clase) => /(^|\s)(w-|flex-1|min-w-|max-w-|basis-)/.test(clase)

// Indicador de actividad.
export function Spinner({ tam = 16, className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={tam}
      height={tam}
      fill="none"
      aria-hidden="true"
      className={`animate-girar ${className}`}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

// Contenedor con título y acciones.
export function Tarjeta({ titulo, acciones, children, className = '' }) {
  return (
    <section
      className={`min-w-0 rounded-card border border-borde bg-card shadow-tarjeta ${className}`}
    >
      {(titulo || acciones) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-borde px-4 py-3.5 sm:px-5">
          {titulo && (
            <h2 className="min-w-0 font-display text-[15px] font-semibold tracking-tight text-marca">
              {titulo}
            </h2>
          )}
          {acciones && (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{acciones}</div>
          )}
        </header>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  )
}

const ESTILOS_BOTON = {
  principal: 'bg-marino text-white shadow-sm hover:bg-marino2',
  oscuro: 'bg-marca text-white shadow-sm hover:bg-marca-hover',
  acento: 'bg-acento text-marino shadow-sm hover:bg-acento-hover',
  fantasma: 'border border-borde bg-card text-marca hover:border-acento hover:bg-lienzo',
  peligro: 'border border-rojo-borde bg-rojo-bg text-rojo-txt hover:bg-rojo-borde/60',
}

const TAMANOS_BOTON = {
  md: 'min-h-11 px-4 text-[14px] sm:min-h-10',
  sm: 'min-h-10 px-3 text-[13px] sm:min-h-8',
}

const BASE_BOTON =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out select-none active:scale-[0.97] ' +
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100'

// Botón con icono opcional que, mientras está cargando, se apaga para que no se pulse dos veces.
export function Boton({
  variante = 'principal', tamano = 'md', icono: Icono, cargando = false,
  className = '', tipo = 'button', children, disabled, ...props
}) {
  return (
    <button
      type={tipo}
      disabled={disabled || cargando}
      aria-busy={cargando || undefined}
      className={`${BASE_BOTON} ${TAMANOS_BOTON[tamano]} ${ESTILOS_BOTON[variante]} ${className}`}
      {...props}
    >
      {cargando ? <Spinner /> : Icono && <Icono size={16} aria-hidden="true" className="shrink-0" />}
      {children}
    </button>
  )
}

// Enlace con aspecto de botón: to navega dentro de la aplicación y href abre otra dirección.
export function EnlaceBoton({
  to, href, variante = 'fantasma', tamano = 'md', icono: Icono, className = '', children, ...props
}) {
  const clase = `${BASE_BOTON} ${TAMANOS_BOTON[tamano]} ${ESTILOS_BOTON[variante]} ${className}`
  const contenido = (
    <>
      {Icono && <Icono size={16} aria-hidden="true" className="shrink-0" />}
      {children}
    </>
  )
  return to ? (
    <Link to={to} className={clase} {...props}>{contenido}</Link>
  ) : (
    <a href={href} className={clase} {...props}>{contenido}</a>
  )
}

// Envuelve un control con su etiqueta; con error, el mensaje reemplaza la ayuda.
export function Campo({ etiqueta, ayuda, error, obligatorio = false, children, className = '' }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      {etiqueta && (
        <span className="text-[13px] font-semibold text-gris-txt">
          {etiqueta}
          {obligatorio && (
            <>
              <span aria-hidden="true" className="ml-0.5 text-rojo-txt">*</span>
              <span className="sr-only"> (obligatorio)</span>
            </>
          )}
        </span>
      )}
      {children}
      {error ? (
        <span className="flex animate-aparecer items-start gap-1.5 text-[12px] leading-snug font-medium text-rojo-txt">
          <CircleAlert size={14} aria-hidden="true" className="mt-px shrink-0" />
          {error}
        </span>
      ) : ayuda && <span className="text-[12px] leading-snug text-gris">{ayuda}</span>}
    </label>
  )
}

// Clase de los campos, cuyo borde cumple el contraste 3:1 contra el fondo.
export const claseCampo =
  'min-h-11 rounded-lg border border-campo bg-card px-3.5 py-2 text-[16px] text-marca ' +
  'outline-none transition-[border-color,box-shadow,background-color] duration-150 ' +
  'placeholder:text-gris hover:border-gris focus:border-acento focus:ring-4 focus:ring-acento/20 ' +
  'disabled:cursor-not-allowed disabled:bg-lienzo disabled:text-gris sm:min-h-10 sm:text-[14px] ' +
  'aria-invalid:border-rojo-txt aria-invalid:focus:border-rojo-txt aria-invalid:focus:ring-rojo-txt/15'

// Campo de texto, con 16 px en celular para que iOS no haga zoom al enfocarlo.
export function Entrada({ className = '', ...props }) {
  return <input className={`${conAncho(className) ? '' : 'w-full'} ${claseCampo} ${className}`} {...props} />
}

// Campo de clave con un ojo para ver u ocultar lo que se escribe.
export function EntradaClave({ className = '', ...props }) {
  const [visible, setVisible] = useState(false)
  const Icono = visible ? EyeOff : Eye
  return (
    <div className={`relative ${conAncho(className) ? className : `w-full ${className}`}`}>
      <input className={`w-full pr-12 ${claseCampo}`} {...props} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Ocultar clave' : 'Mostrar clave'}
        aria-pressed={visible}
        title={visible ? 'Ocultar clave' : 'Mostrar clave'}
        className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center rounded-r-lg text-gris-txt transition-colors duration-150 hover:text-marca"
      >
        <Icono size={18} aria-hidden="true" />
      </button>
    </div>
  )
}

// Lista desplegable con la misma apariencia que los campos de texto.
export function Seleccion({ children, className = '', ...props }) {
  return (
    <div className={`relative ${conAncho(className) ? className : `w-full ${className}`}`}>
      <select className={`w-full cursor-pointer appearance-none pr-10 ${claseCampo}`} {...props}>
        {children}
      </select>
      <ChevronDown
        size={16}
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-gris"
      />
    </div>
  )
}

export function AreaTexto({ className = '', ...props }) {
  return (
    <textarea
      className={`${conAncho(className) ? '' : 'w-full'} min-h-24 resize-y ${claseCampo} ${className}`}
      {...props}
    />
  )
}

const CtxTabla = createContext([])

// Tabla en pantalla ancha; en celular y tablet cada fila se convierte en una tarjeta con el nombre de la
// columna junto a cada dato.
export function Tabla({ cabeceras, children, vacio = 'No hay registros.', iconoVacio }) {
  const etiquetas = cabeceras.map((c) => (typeof c === 'string' ? c : c.texto))
  const hayFilas = Array.isArray(children) ? children.length > 0 : Boolean(children)

  if (!hayFilas) return <Vacio icono={iconoVacio}>{vacio}</Vacio>

  return (
    <CtxTabla.Provider value={etiquetas}>
      <div className="lg:-mx-5 lg:overflow-x-auto lg:px-5">
        <table className="w-full border-collapse text-[14px] max-lg:block">
          <thead className="max-lg:hidden">
            <tr className="border-y border-borde bg-lienzo/70">
              {cabeceras.map((c, i) => (
                <th
                  key={i}
                  scope="col"
                  className={`px-3 py-2.5 text-[12px] font-semibold whitespace-nowrap text-gris-txt first:rounded-l-lg last:rounded-r-lg ${
                    c?.alinear === 'derecha' ? 'text-right' : 'text-left'
                  }`}
                >
                  {typeof c === 'string' ? c : c.texto}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="max-lg:flex max-lg:flex-col max-lg:gap-3">{children}</tbody>
        </table>
      </div>
    </CtxTabla.Provider>
  )
}

// Le pasa a cada celda el nombre de su columna para mostrarlo en la vista de tarjeta.
export function Fila({ children, className = '' }) {
  const etiquetas = useContext(CtxTabla)
  return (
    <tr
      className={`border-b border-borde/70 transition-colors duration-150 last:border-b-0 hover:bg-lienzo/80 max-lg:block max-lg:rounded-xl max-lg:border max-lg:border-borde max-lg:bg-card max-lg:p-3.5 max-lg:shadow-tarjeta max-lg:last:border-b ${className}`}
    >
      {Children.map(children, (hijo, i) =>
        isValidElement(hijo) ? cloneElement(hijo, { etiqueta: etiquetas[i] }) : hijo,
      )}
    </tr>
  )
}

export function Celda({ children, alinear, etiqueta, className = '', ...props }) {
  return (
    <td
      className={`px-3 py-3 align-middle max-lg:flex max-lg:items-center max-lg:justify-between max-lg:gap-4 max-lg:px-0 max-lg:py-1.5 ${
        alinear === 'derecha' ? 'text-right' : ''
      } ${etiqueta ? '' : 'max-lg:mt-1.5 max-lg:justify-end max-lg:border-t max-lg:border-borde/70 max-lg:pt-3'} ${className}`}
      {...props}
    >
      {etiqueta && (
        <span className="shrink-0 text-[12px] font-medium text-gris lg:hidden">{etiqueta}</span>
      )}
      <div className={`min-w-0 ${etiqueta ? 'max-lg:text-right' : 'max-lg:w-full'}`}>{children}</div>
    </td>
  )
}

const TONOS_INSIGNIA = {
  neutro: 'border-borde bg-lienzo text-gris-txt',
  ok: 'border-ok-borde bg-ok-bg text-ok-txt',
  alerta: 'border-aviso-borde bg-aviso-bg text-aviso-txt',
  error: 'border-rojo-borde bg-rojo-bg text-rojo-txt',
}
const PUNTOS_INSIGNIA = {
  neutro: 'bg-gris',
  ok: 'bg-ok',
  alerta: 'bg-acento',
  error: 'bg-rojo',
}

// Etiqueta de estado que siempre lleva texto además del color; con ajustar, el texto largo baja de renglón.
export function Insignia({ tono = 'neutro', ajustar = false, children }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2.5 py-0.5 text-[12px] font-semibold ${
        ajustar ? 'rounded-xl whitespace-normal text-left' : 'rounded-full whitespace-nowrap'
      } ${TONOS_INSIGNIA[tono]}`}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${PUNTOS_INSIGNIA[tono]}`} aria-hidden="true" />
      {children}
    </span>
  )
}

// Aviso dentro de la página que no desaparece solo.
export function Alerta({ tono = 'aviso', children, className = '' }) {
  const estilos = {
    aviso: 'border-aviso-borde bg-aviso-bg text-aviso-txt',
    error: 'border-rojo-borde bg-rojo-bg text-rojo-txt',
    info: 'border-borde bg-lienzo text-gris-txt',
  }
  const Icono = tono === 'info' ? CircleCheck : TriangleAlert
  return (
    <div
      role="note"
      className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] leading-snug ${estilos[tono]} ${className}`}
    >
      <Icono size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

const TONOS_INDICADOR = {
  error: 'bg-rojo-bg text-rojo-txt',
  alerta: 'bg-aviso-bg text-aviso-txt',
  ok: 'bg-ok-bg text-ok-txt',
}

// Tarjeta de indicador para el panel y los resúmenes.
export function Indicador({ etiqueta, valor, detalle, icono: Icono, retardo = 0, tono }) {
  return (
    <div
      className="animate-entrar tarjeta-viva rounded-card border border-borde bg-card p-4 shadow-tarjeta sm:p-5"
      style={{ animationDelay: `${retardo}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-gris-txt">{etiqueta}</div>
          <div className="cifras mt-1.5 font-display text-[24px] leading-tight font-semibold tracking-tight break-words text-marca sm:text-[28px]">
            {valor}
          </div>
        </div>
        {Icono && (
          <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${TONOS_INDICADOR[tono] || 'bg-acento-bg text-acento'}`}>
            <Icono size={20} aria-hidden="true" />
          </span>
        )}
      </div>
      {detalle && <div className="mt-2 text-[12px] text-gris">{detalle}</div>}
    </div>
  )
}

const CtxAvisos = createContext(null)

// Proveedor de avisos que aparecen arriba y se van solos; los de error duran más.
export function ProveedorAvisos({ children }) {
  const [avisos, setAvisos] = useState([])

  const quitar = useCallback((id) => {
    setAvisos((xs) => xs.map((a) => (a.id === id ? { ...a, saliendo: true } : a)))
    setTimeout(() => setAvisos((xs) => xs.filter((a) => a.id !== id)), 220)
  }, [])

  const avisar = useCallback((texto, tono = 'ok') => {
    if (!texto) return
    const id = Math.random().toString(36).slice(2)
    setAvisos((xs) => [...xs.slice(-3), { id, texto, tono, saliendo: false }])
    setTimeout(() => quitar(id), tono === 'error' ? 8000 : 4500)
  }, [quitar])

  return (
    <CtxAvisos.Provider value={{ avisar }}>
      {children}
      <div className="no-imprimir pointer-events-none fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[60] flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:w-[400px]">
        {avisos.map((a) => {
          const error = a.tono === 'error'
          const Icono = error ? CircleAlert : CircleCheck
          return (
            <div
              key={a.id}
              role={error ? 'alert' : 'status'}
              className={`pointer-events-auto flex items-start gap-3 rounded-xl border-l-4 bg-card p-3.5 shadow-elevada ring-1 ring-marino/5 ${
                error ? 'border-rojo' : 'border-ok'
              } ${a.saliendo ? 'translate-x-6 opacity-0 transition-[opacity,transform] duration-200' : 'animate-toast'}`}
            >
              <Icono
                size={20}
                aria-hidden="true"
                className={`mt-px shrink-0 ${error ? 'text-rojo' : 'text-ok'}`}
              />
              <p className="min-w-0 flex-1 text-[14px] leading-snug font-medium text-marca">{a.texto}</p>
              <button
                type="button"
                onClick={() => quitar(a.id)}
                className="-m-1.5 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-gris transition-colors duration-150 hover:bg-lienzo hover:text-marca"
                aria-label="Cerrar aviso"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          )
        })}
      </div>
    </CtxAvisos.Provider>
  )
}

// Atajo para mostrar un aviso desde cualquier pantalla.
export function useAvisos() {
  const ctx = useContext(CtxAvisos)
  if (!ctx) throw new Error('useAvisos necesita <ProveedorAvisos>')
  return ctx
}

// Modal de confirmación que entra y sale con transición, devuelve el foco a donde estaba y atrapa el tabulador
// dentro.
export function Confirmar({
  abierto, titulo = '¿Confirmar?', texto, etiquetaOk = 'Eliminar', icono: Icono = TriangleAlert, onOk, onCancelar,
}) {
  const [montado, setMontado] = useState(abierto)
  const [visible, setVisible] = useState(false)
  const ultimo = useRef({ titulo, texto, etiquetaOk })
  const refCancelar = useRef(null)
  const refOk = useRef(null)
  const foco = useRef(null)

  if (abierto) ultimo.current = { titulo, texto, etiquetaOk }

  useEffect(() => {
    if (abierto) {
      foco.current = document.activeElement
      setMontado(true)
      const r = requestAnimationFrame(() => {
        setVisible(true)
        refCancelar.current?.focus()
      })
      return () => cancelAnimationFrame(r)
    }
    setVisible(false)
    const t = setTimeout(() => {
      setMontado(false)
      foco.current?.focus?.()
    }, 200)
    return () => clearTimeout(t)
  }, [abierto])

  useEffect(() => {
    if (!abierto) return
    const anterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const teclas = (e) => {
      if (e.key === 'Escape') onCancelar?.()
      if (e.key === 'Tab') {
        const a = refCancelar.current
        const b = refOk.current
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b?.focus() }
        else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a?.focus() }
      }
    }
    window.addEventListener('keydown', teclas)
    return () => {
      document.body.style.overflow = anterior
      window.removeEventListener('keydown', teclas)
    }
  }, [abierto, onCancelar])

  if (!montado) return null
  const c = ultimo.current
  return createPortal(
    <div
      className={`no-imprimir fixed inset-0 z-50 flex items-end justify-center bg-marca/55 p-4 backdrop-blur-[3px] transition-opacity duration-200 sm:items-center ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={onCancelar}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmar-titulo"
        aria-describedby={c.texto ? 'confirmar-texto' : undefined}
        className={`w-full max-w-sm rounded-2xl bg-card p-6 text-center shadow-elevada transition-[opacity,transform] duration-200 ease-out ${
          visible ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-95 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-aviso-bg text-aviso-txt">
          <Icono size={22} aria-hidden="true" />
        </div>
        <h3 id="confirmar-titulo" className="font-display text-[17px] font-semibold text-marca">
          {c.titulo}
        </h3>
        {c.texto && (
          <p id="confirmar-texto" className="mt-1.5 text-[14px] leading-snug text-gris-txt">
            {c.texto}
          </p>
        )}
        <div className="mt-6 grid grid-cols-2 gap-2.5">
          <Boton ref={refCancelar} variante="fantasma" onClick={onCancelar}
            className="hover:-translate-y-0.5 hover:shadow-md hover:ring-2 hover:ring-acento/40">
            Cancelar
          </Boton>
          <Boton ref={refOk} variante="peligro" onClick={onOk}
            className="hover:-translate-y-0.5 hover:shadow-md hover:ring-2 hover:ring-rojo-borde">
            {c.etiquetaOk}
          </Boton>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// Diálogo con contenido propio, para formularios dentro de una ventana, con la misma mecánica que Confirmar.
export function Dialogo({ abierto, titulo, onCerrar, children, ancho = 'max-w-md' }) {
  const [montado, setMontado] = useState(abierto)
  const [visible, setVisible] = useState(false)
  const panel = useRef(null)
  const foco = useRef(null)
  const pulsoEnFondo = useRef(false)

  useEffect(() => {
    if (abierto) {
      foco.current = document.activeElement
      setMontado(true)
      const r = requestAnimationFrame(() => {
        setVisible(true)
        panel.current?.querySelector('input, select, textarea, button')?.focus()
      })
      return () => cancelAnimationFrame(r)
    }
    setVisible(false)
    const t = setTimeout(() => {
      setMontado(false)
      foco.current?.focus?.()
    }, 200)
    return () => clearTimeout(t)
  }, [abierto])

  useEffect(() => {
    if (!abierto) return
    const anterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const teclas = (e) => {
      if (e.key === 'Escape') onCerrar?.()
      if (e.key === 'Tab' && panel.current) {
        const enfocables = [...panel.current.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')]
        if (!enfocables.length) return
        const primero = enfocables[0]
        const ultimo = enfocables[enfocables.length - 1]
        if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus() }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus() }
      }
    }
    window.addEventListener('keydown', teclas)
    return () => {
      document.body.style.overflow = anterior
      window.removeEventListener('keydown', teclas)
    }
  }, [abierto, onCerrar])

  if (!montado) return null
  return createPortal(
    <div
      className={`no-imprimir fixed inset-0 z-50 flex items-end justify-center bg-marca/55 p-3 backdrop-blur-[3px] transition-opacity duration-200 sm:items-center sm:p-4 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      onMouseDown={(e) => { pulsoEnFondo.current = e.target === e.currentTarget }}
      onClick={(e) => { if (pulsoEnFondo.current && e.target === e.currentTarget) onCerrar?.(); pulsoEnFondo.current = false }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialogo-titulo"
        className={`max-h-[92vh] w-full ${ancho} overscroll-contain overflow-y-auto rounded-2xl bg-card p-5 shadow-elevada transition-[opacity,transform] duration-200 ease-out sm:p-6 ${
          visible ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-95 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 id="dialogo-titulo" className="text-[17px] font-bold text-marca">{titulo}</h3>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="-m-1.5 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-gris transition-colors duration-150 hover:bg-lienzo hover:text-marca"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

// Indicador de estado de carga.
export function Cargando({ texto = 'Cargando' }) {
  return (
    <div role="status" className="flex flex-col gap-3 py-2">
      <span className="sr-only">{texto}</span>
      {[100, 86, 94, 68].map((ancho, i) => (
        <div
          key={i}
          className="h-4 animate-brillo rounded-md bg-[linear-gradient(90deg,#E2DEEC_25%,#EEEBF5_50%,#E2DEEC_75%)] bg-[length:200%_100%]"
          style={{ width: `${ancho}%` }}
        />
      ))}
    </div>
  )
}

// Pantalla completa mientras se comprueba la sesión.
export function PantallaCarga() {
  return (
    <div role="status" className="relative flex min-h-screen flex-col items-center justify-center gap-3 text-gris-txt">
      <FondoAnimado />
      <Spinner tam={28} className="text-acento" />
      <span className="text-[14px]">Cargando</span>
    </div>
  )
}

// Aviso para quien abre una dirección que su tipo de cuenta no permite, con el destino que intentó abrir.
export function SinPermiso({ rol, destino, volverA, completa = false }) {
  const tarjeta = (
    <section
      role="alert"
      className="relative w-full max-w-md animate-entrar overflow-hidden rounded-card border border-borde bg-card text-center shadow-tarjeta"
    >
      <div className="h-1 bg-rojo-borde" aria-hidden="true" />
      <div className="flex flex-col items-center gap-4 px-5 pt-8 pb-6 sm:px-8">
        <span className="relative flex size-16 items-center justify-center">
          <span className="absolute inset-0 animate-pulso rounded-full bg-rojo-bg" aria-hidden="true" />
          <span className="relative flex size-14 items-center justify-center rounded-full border border-rojo-borde bg-rojo-bg text-rojo-txt">
            <ShieldAlert size={26} aria-hidden="true" />
          </span>
        </span>

        <h1 className="text-balance font-display text-[19px] font-semibold tracking-tight text-marca">
          No tiene permisos para estar en este módulo
        </h1>

        <p className="max-w-sm text-[14px] leading-relaxed text-gris-txt">
          {rol ? <>Tu rol (<strong className="font-semibold text-marca">{rol}</strong>)</> : 'Tu rol'}
          {' '}no tiene acceso a{' '}
          {destino ? <strong className="font-semibold text-marca">{destino}</strong> : 'esta sección'}.
          {' '}Si crees que deberías tenerlo, pídeselo al administrador del sistema.
        </p>

      </div>

      {volverA && (
        <div className="flex justify-center border-t border-borde px-5 py-4 sm:px-8">
          <EnlaceBoton to={volverA} variante="principal" icono={Home} replace>
            Ir a mi inicio
          </EnlaceBoton>
        </div>
      )}
    </section>
  )
  if (!completa) return <div className="flex justify-center px-4 py-8">{tarjeta}</div>
  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-8">
      <FondoAnimado />
      {tarjeta}
    </main>
  )
}

// Mensaje de estado vacío con su icono.
export function Vacio({ children, icono: Icono = Inbox }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-lienzo text-gris">
        <Icono size={22} aria-hidden="true" />
      </span>
      <p className="max-w-sm text-[14px] leading-snug text-gris-txt">{children}</p>
    </div>
  )
}
