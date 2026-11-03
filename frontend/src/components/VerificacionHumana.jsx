// Verificación de que el usuario es una persona, con Cloudflare Turnstile. El cuadro solo obtiene el token que
// viaja con el ingreso; el servidor lo valida siempre contra Cloudflare, porque sin esa validación bastaría con
// llamar a la API directamente. El script de Cloudflare se carga en index.html.
import { useEffect, useRef } from 'react';
import { useTema } from '../lib/tema';

// Llave pública del sitio, que no es un secreto; vacía significa sin verificación.
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

// Dibuja el cuadro de Turnstile y entrega el token al formulario de ingreso.
export default function VerificacionHumana({ onVerificar, onVencer }) {
  const contenedor = useRef(null);
  const widgetId = useRef(null);
  const tema = useTema();

  useEffect(() => {
    let cancelado = false;
    let espera = null;

    function dibujar() {
      if (!contenedor.current || !window.turnstile) return;
      widgetId.current = window.turnstile.render(contenedor.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: tema === 'oscuro' ? 'dark' : 'light',
        callback: onVerificar,
        'error-callback': onVencer,
        'expired-callback': onVencer,
        'timeout-callback': onVencer,
      });
    }

    if (window.turnstile) dibujar();
    else {
      espera = setInterval(() => {
        if (cancelado || !window.turnstile) return;
        clearInterval(espera);
        dibujar();
      }, 150);
    }

    return () => {
      cancelado = true;
      if (espera) clearInterval(espera);
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tema]);

  return <div ref={contenedor} />;
}
