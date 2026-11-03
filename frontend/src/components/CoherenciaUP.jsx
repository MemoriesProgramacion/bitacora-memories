// Lista de comprobación de coherencia de la carpeta de cada visita: formatos obligatorios, cédulas frente a los
// asociados, fechas coherentes y datos del diagnóstico iguales a los de la unidad. Lo calcula el servidor con
// lo cargado en la plataforma.
import { useEffect, useState } from 'react';
import { CircleCheck, CircleX } from 'lucide-react';
import { Alerta, Cargando, Insignia, Vacio } from '../inventario/componentes/ui';
import { pedirCoherencia } from '../lib/diagnostico';

// Pide al servidor las comprobaciones de la unidad y las muestra por visita.
export default function CoherenciaUP({ idUnico }) {
  const [visitas, setVisitas] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let vigente = true;
    setVisitas(null);
    pedirCoherencia(idUnico)
      .then((v) => vigente && setVisitas(v))
      .catch((err) => vigente && setError(err.message || 'No se pudo revisar la carpeta.'));
    return () => { vigente = false; };
  }, [idUnico]);

  if (error) return <Alerta tono="error">{error}</Alerta>;
  if (!visitas) return <Cargando texto="Revisando la carpeta" />;
  if (!visitas.length) return <Vacio>La unidad todavía no tiene visitas registradas.</Vacio>;

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {visitas.map((v) => (
        <div key={v.tipo} className="rounded-xl border border-borde p-3.5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[14px] font-semibold text-marca">{v.nombre}{v.cerrada ? ' · cerrada' : ''}</span>
            <Insignia tono={v.completa ? 'ok' : 'alerta'}>{v.completa ? 'Coherente' : 'Revisar'}</Insignia>
          </div>
          <ul className="flex flex-col gap-2">
            {v.items.map((x) => (
              <li key={x.clave} className="flex items-start gap-2 text-[13px]">
                {x.ok
                  ? <CircleCheck size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-ok" />
                  : <CircleX size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-rojo" />}
                <span className="min-w-0">
                  <span className="sr-only">{x.ok ? 'Cumple: ' : 'No cumple: '}</span>
                  <span className="text-marca">{x.texto}</span>
                  {x.detalle && <span className="block break-words text-[12px] text-gris-txt">{x.detalle}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
