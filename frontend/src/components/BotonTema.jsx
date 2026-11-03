// Botón para pasar del modo claro al oscuro y al revés. Muestra el icono del modo al que se va a cambiar y se
// usa en la cabecera y en el ingreso.
import { Moon, Sun } from 'lucide-react';
import { alternarTema, useTema } from '../lib/tema';

// Muestra el botón y alterna el tema al pulsarlo.
export default function BotonTema({ className = '' }) {
  const tema = useTema();
  const aOscuro = tema === 'claro';
  const texto = aOscuro ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro';

  return (
    <button
      type="button"
      onClick={alternarTema}
      aria-label={texto}
      title={texto}
      className={`flex size-9 items-center justify-center rounded-lg border border-white/25 text-white/80 transition hover:border-acento hover:text-white ${className}`}
    >
      {aOscuro ? <Moon size={16} aria-hidden="true" /> : <Sun size={16} aria-hidden="true" />}
    </button>
  );
}
