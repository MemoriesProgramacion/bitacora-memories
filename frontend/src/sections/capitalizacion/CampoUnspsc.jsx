// Campo de la clase UNSPSC de 6 dígitos con sugerencias del catálogo de clases cargado. Se usa en el catálogo
// de la capitalización y en los artículos del inventario; el servidor vuelve a validar que el código tenga 6
// dígitos y exista en el catálogo.
import { useEffect, useId, useState } from 'react';
import { Campo, Entrada } from '../../inventario/componentes/ui';
import { buscarClases, formatoUnspsc } from '../../lib/clasificacion';

// Muestra el campo con las sugerencias.
export default function CampoUnspsc({ valor, onCambio, etiqueta = 'Clase UNSPSC', ayuda }) {
  const lista = useId();
  const [sugerencias, setSugerencias] = useState([]);

  useEffect(() => {
    let vivo = true;
    const espera = setTimeout(() => {
      buscarClases(valor).then((s) => { if (vivo) setSugerencias(s); }).catch(() => { if (vivo) setSugerencias([]); });
    }, 250);
    return () => { vivo = false; clearTimeout(espera); };
  }, [valor]);

  const texto = String(valor ?? '').trim();
  const elegida = sugerencias.find((s) => s.codigo === texto);
  const soloDigitos = /^\d+$/.test(texto);
  const buscando = texto !== '' && !formatoUnspsc(texto) && !(soloDigitos && texto.length > 6);
  const error = soloDigitos && texto.length > 6 ? 'Debe tener 6 dígitos.' : undefined;
  const guia = buscando ? 'Sigue escribiendo o elige una clase de la lista.'
    : elegida ? elegida.nombre : ayuda || 'Escribe el código o parte del nombre de la clase.';
  return (
    <Campo etiqueta={etiqueta} error={error} ayuda={error ? undefined : guia}>
      <Entrada
        maxLength={80} list={lista} value={valor ?? ''} placeholder="Ej. 101015"
        onChange={(e) => {
          const v = e.target.value;
          const m = /^(\d{6})\s+—/.exec(v);
          onCambio(m ? m[1] : v);
        }}
      />
      <datalist id={lista}>
        {sugerencias.map((s) => <option key={s.codigo} value={`${s.codigo} — ${s.nombre}`} />)}
      </datalist>
    </Campo>
  );
}
