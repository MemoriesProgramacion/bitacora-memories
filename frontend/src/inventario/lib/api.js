// Cliente de la API del inventario y de las rutas generales. Todas las peticiones viajan con la cookie de
// sesión hacia este mismo sitio y las escrituras llevan el token CSRF en la cabecera X-CSRF-Token; si el
// servidor responde que caducó, se renueva y se reintenta una vez.
import { fijarCsrf, tokenCsrf, renovarCsrf } from '../../lib/csrf'

// Error de la API con el mensaje que se muestra y las pistas que manda el backend.
export class ErrorApi extends Error {
  constructor(mensaje, estado, datos) {
    super(mensaje)
    this.name = 'ErrorApi'
    this.estado = estado
    this.datos = datos || {}
  }
}

// Crea un cliente de la API que manda cookie y token CSRF y, si el token venció, lo renueva y reintenta una
// vez.
function crearCliente(base) {
  async function peticion(metodo, ruta, cuerpo, opciones = {}) {
    const escritura = metodo !== 'GET'
    if (escritura && !tokenCsrf()) await renovarCsrf()

    const enviar = async () => {
      const cabeceras = {}
      if (escritura && tokenCsrf()) cabeceras['X-CSRF-Token'] = tokenCsrf()
      let datos
      if (cuerpo instanceof FormData) {
        datos = cuerpo
      } else if (cuerpo !== undefined) {
        cabeceras['Content-Type'] = 'application/json'
        datos = JSON.stringify(cuerpo)
      }
      return fetch(`${base}${ruta}`, {
        method: metodo,
        credentials: 'same-origin',
        headers: cabeceras,
        body: datos,
        signal: opciones.signal,
      })
    }

    let resp = await enviar()

    if (resp.status === 400 && escritura) {
      const j = await resp.clone().json().catch(() => ({}))
      if (j && j.csrf) {
        await renovarCsrf()
        resp = await enviar()
      }
    }

    const tipo = resp.headers.get('content-type') || ''
    if (!tipo.includes('application/json')) {
      if (!resp.ok) throw new ErrorApi('El servidor no respondió correctamente.', resp.status)
      return resp
    }

    const json = await resp.json().catch(() => ({}))
    if (json && json.token) fijarCsrf(json.token)
    if (resp.status === 401 && json.sesion === false) {
      window.dispatchEvent(new Event('sesion-expirada'))
    }
    if (!resp.ok || json.ok === false) {
      throw new ErrorApi(json.detalle || json.error || 'Ocurrió un error.', resp.status, json)
    }
    return json
  }

  return {
    get: (ruta, opciones) => peticion('GET', ruta, undefined, opciones),
    post: (ruta, cuerpo, opciones) => peticion('POST', ruta, cuerpo ?? {}, opciones),
    put: (ruta, cuerpo, opciones) => peticion('PUT', ruta, cuerpo ?? {}, opciones),
    patch: (ruta, cuerpo, opciones) => peticion('PATCH', ruta, cuerpo ?? {}, opciones),
    del: (ruta, opciones) => peticion('DELETE', ruta, undefined, opciones),
  }
}

// Cliente de las rutas del inventario, /api/inv.
export const api = crearCliente('/api/inv')
// Cliente de las rutas generales, /api/auth y /api/admin.
export const apiGeneral = crearCliente('/api')

// Construye una query string a partir de un objeto, omitiendo los vacíos.
export function qs(obj) {
  const p = new URLSearchParams()
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x))
    else p.append(k, v)
  })
  const s = p.toString()
  return s ? `?${s}` : ''
}

// Da formato de pesos a un precio, por ejemplo 1979208 pasa a $ 1.979.208.
export function pesos(valor) {
  const n = Number(valor)
  if (valor === null || valor === undefined || Number.isNaN(n)) return '-'
  return '$ ' + Math.round(n).toLocaleString('es-CO').replace(/,/g, '.')
}

// Da formato AAAA-MM-DD HH:MM a una fecha ISO.
export function fecha(valor) {
  if (!valor) return ''
  const d = new Date(valor)
  if (Number.isNaN(d.getTime())) return String(valor)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// Devuelve la URL de la imagen del código de barras de un código.
export const urlBarcode = (codigo, hr = true) =>
  `/api/inv/codigos/barcode/${encodeURIComponent(codigo)}.png${hr ? '' : '?hr=0'}`
// Devuelve la URL de la imagen QR de un código.
export const urlQr = (codigo, t = 10) =>
  `/api/inv/codigos/qr/${encodeURIComponent(codigo)}.png?t=${t}`
export const urlPdfOrden = (id) => `/api/inv/ordenes/${id}/pdf`
export const urlPdfPedido = (id) => `/api/inv/pedidos/${id}/pdf`
