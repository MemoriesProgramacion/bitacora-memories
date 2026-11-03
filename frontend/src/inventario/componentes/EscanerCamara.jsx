// Escaneo con la cámara del dispositivo. Lee códigos QR y de barras Code128 con la API BarcodeDetector del
// navegador, sin librerías externas, y al detectar algo llama a onCodigo(valor). La cámara solo funciona por
// HTTPS o en localhost.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CameraOff } from 'lucide-react'
import { Alerta, Boton } from './ui'

const FORMATOS = ['qr_code', 'code_128', 'code_39', 'ean_13']

// Muestra la cámara del celular o del portátil, evita leer el mismo código varias veces seguidas y apaga la
// cámara al cerrar.
export default function EscanerCamara({ onCodigo }) {
  const [abierto, setAbierto] = useState(false)
  const [estado, setEstado] = useState(null)
  const refVideo = useRef(null)
  const refStream = useRef(null)
  const refCorriendo = useRef(false)
  const refUltimo = useRef({ codigo: '', momento: 0 })

  const cerrar = useCallback(() => {
    refCorriendo.current = false
    if (refStream.current) {
      refStream.current.getTracks().forEach((t) => t.stop())
      refStream.current = null
    }
    if (refVideo.current) refVideo.current.srcObject = null
    setAbierto(false)
    setEstado(null)
  }, [])

  useEffect(() => {
    window.addEventListener('pagehide', cerrar)
    return () => {
      window.removeEventListener('pagehide', cerrar)
      cerrar()
    }
  }, [cerrar])

  const entregar = useCallback(
    (codigo) => {
      const ahora = Date.now()
      const ultimo = refUltimo.current
      if (codigo === ultimo.codigo && ahora - ultimo.momento < 2500) return
      refUltimo.current = { codigo, momento: ahora }
      if (navigator.vibrate) navigator.vibrate(80)
      onCodigo(codigo)
    },
    [onCodigo],
  )

  const abrir = async () => {
    setAbierto(true)

    if (!navigator.mediaDevices?.getUserMedia) {
      setEstado({ tono: 'error', texto: 'Este navegador no permite usar la cámara.' })
      return
    }
    if (!window.isSecureContext) {
      setEstado({
        tono: 'error',
        texto:
          'La cámara solo funciona por HTTPS o en localhost. Si entras por la IP ' +
          'del servidor sin HTTPS, el navegador la bloquea. Usa el lector USB o ' +
          'pide que se publique el sistema con HTTPS.',
      })
      return
    }
    if (!('BarcodeDetector' in window)) {
      setEstado({
        tono: 'error',
        texto:
          'Este navegador no trae lector de códigos. Prueba con Chrome en Android, ' +
          'o usa un lector USB.',
      })
      return
    }

    try {
      const soportados = await window.BarcodeDetector.getSupportedFormats()
      const quiero = FORMATOS.filter((f) => soportados.includes(f))
      const detector = new window.BarcodeDetector({
        formats: quiero.length ? quiero : soportados,
      })

      refStream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      if (refVideo.current) {
        refVideo.current.srcObject = refStream.current
        await refVideo.current.play()
      }
      refCorriendo.current = true
      setEstado({ tono: 'ok', texto: 'Apunta al código del artículo.' })

      const bucle = async () => {
        if (!refCorriendo.current) return
        try {
          const v = refVideo.current
          if (v && v.readyState >= 2) {
            const encontrados = await detector.detect(v)
            if (encontrados.length) {
              const valor = (encontrados[0].rawValue || '').trim()
              if (valor && valor.length <= 64) entregar(valor)
            }
          }
        } catch {
        }
        setTimeout(() => requestAnimationFrame(bucle), 180)
      }
      bucle()
    } catch (err) {
      setEstado({
        tono: 'error',
        texto:
          'No se pudo abrir la cámara: ' +
          (err?.name || String(err)) +
          '. Revisa que le hayas dado permiso al navegador.',
      })
    }
  }

  return (
    <div className="no-imprimir">
      {!abierto ? (
        <Boton variante="fantasma" icono={Camera} onClick={abrir} className="max-sm:w-full">
          Escanear con cámara
        </Boton>
      ) : (
        <div className="animate-entrar rounded-xl border border-borde bg-lienzo p-3">
          <video
            ref={refVideo}
            playsInline
            muted
            aria-label="Vista de la cámara"
            className="block aspect-video w-full rounded-lg bg-marca object-cover"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Boton variante="fantasma" icono={CameraOff} onClick={cerrar}>
              Cerrar cámara
            </Boton>
            {estado?.tono === 'ok' && (
              <span role="status" className="flex-1 text-[13px] text-gris-txt">{estado.texto}</span>
            )}
          </div>
          {estado?.tono === 'error' && (
            <Alerta tono="error" className="mt-3">{estado.texto}</Alerta>
          )}
        </div>
      )}
    </div>
  )
}
