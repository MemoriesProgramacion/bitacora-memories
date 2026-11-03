// Hook que carga los datos de la consola: ejecuta cargar() al montar y cuando cambian las dependencias, y
// permite volver a pedirlos con recargar().
import { useCallback, useEffect, useState } from 'react';
import { useAvisos } from '../inventario/componentes/ui';

// Devuelve los datos, el estado de carga, el error y la función recargar.
export function useCarga(cargar, dependencias = []) {
  const { avisar } = useAvisos();
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pedir = useCallback(cargar, dependencias);

  const recargar = useCallback(async () => {
    setCargando(true);
    try {
      setDatos(await pedir());
    } catch (err) {
      avisar(err.message, 'error');
    } finally {
      setCargando(false);
    }
  }, [pedir, avisar]);

  useEffect(() => { recargar(); }, [recargar]);

  return { datos, cargando, recargar };
}
