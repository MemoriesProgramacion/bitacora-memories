// Transiciones entre secciones con la API nativa de View Transitions del navegador: la cabecera y el fondo se
// quedan quietos y solo el contenido se funde y sube un poco. Si el navegador no la tiene, o la persona pidió
// menos movimiento, el cambio es inmediato y sin animación.
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { flushSync } from 'react-dom';

// Indica si la persona pidió menos movimiento en su sistema.
const prefiereMenosMovimiento = () =>
  typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Ejecuta un cambio de estado o de ruta dentro de la transición.
export function conTransicion(actualizar) {
  if (typeof document === 'undefined' || !document.startViewTransition || prefiereMenosMovimiento()) {
    actualizar();
    return;
  }
  document.startViewTransition(() => { flushSync(actualizar); });
}

// Devuelve una función igual a navigate pero con la transición.
export function useIrA() {
  const navegar = useNavigate();
  return useCallback((ruta, opciones) => conTransicion(() => navegar(ruta, opciones)), [navegar]);
}
