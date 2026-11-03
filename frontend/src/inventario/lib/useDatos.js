// Hook de carga de datos del inventario: pide una ruta de la API, expone el resultado y permite recargar
// después de una acción.
import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { useAvisos } from '../componentes/ui'

// Pide una ruta al montar la pantalla, o cuando cambia, y deja volver a pedirla con recargar().
export function useDatos(ruta, { auto = true } = {}) {
  const { avisar } = useAvisos()
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(auto)
  const [error, setError] = useState(null)

  const cargar = useCallback(async () => {
    if (!ruta) return
    setCargando(true)
    try {
      const r = await api.get(ruta)
      setDatos(r)
      setError(null)
    } catch (err) {
      setError(err)
      avisar(err.message, 'error')
    } finally {
      setCargando(false)
    }
  }, [ruta, avisar])

  useEffect(() => {
    if (auto) cargar()
  }, [auto, cargar])

  return { datos, cargando, error, recargar: cargar, setDatos }
}

// Envuelve una acción de escritura: muestra el mensaje del servidor, avisa del error si falla y recarga los
// datos cuando sale bien.
export function useAccion(recargar) {
  const { avisar } = useAvisos()
  const [ocupado, setOcupado] = useState(false)

  const ejecutar = useCallback(
    async (fn, { recargarDespues = true, alFallar } = {}) => {
      setOcupado(true)
      try {
        const r = await fn()
        if (r?.mensaje) avisar(r.mensaje)
        if (recargarDespues) await recargar?.()
        return r
      } catch (err) {
        if (!alFallar?.(err)) avisar(err.message, 'error')
        return null
      } finally {
        setOcupado(false)
      }
    },
    [avisar, recargar],
  )

  return { ejecutar, ocupado }
}
