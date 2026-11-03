// Formación de la unidad productiva en su ficha: los talleres en que participa, con su asistencia por módulo,
// la satisfacción, la apropiación de entrada y salida, los hallazgos y el 80 %. Lo calcula el servidor con lo
// registrado en Talleres.
import { useEffect, useState } from 'react';
import { Alerta, Boton, Cargando, Insignia, Vacio } from '../inventario/componentes/ui';
import { pedirFormacionUP, textoSesion, textoApropiacion } from '../lib/formacion';

// Pide la formación de la unidad al servidor y la muestra.
export default function FormacionUP({ idUnico }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vigente = true;
    setDatos(null);
    setError('');
    pedirFormacionUP(idUnico)
      .then((d) => vigente && setDatos(d))
      .catch((err) => vigente && setError(err.message || 'No se pudo cargar la formación de la unidad.'));
    return () => { vigente = false; };
  }, [idUnico, intento]);

  if (error) return <Alerta tono="error">{error} <Boton variante="fantasma" tamano="sm" onClick={() => setIntento((n) => n + 1)}>Reintentar</Boton></Alerta>;
  if (!datos) return <Cargando texto="Cargando la formación" />;
  if (!datos.items.length) return <Vacio>La unidad todavía no participa en talleres de fortalecimiento.</Vacio>;

  return (
    <div className="grid gap-3">
      {datos.items.map((t) => (
        <div key={t.taller_id} className="grid min-w-0 gap-2 rounded-xl border border-borde p-3.5 text-[13px]">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 break-words font-semibold text-marca">{t.taller}</span>
            {t.cumplimiento && (
              <Insignia tono={t.cumplimiento.cumple_80 ? 'ok' : 'alerta'}>
                {t.cumplimiento.porcentaje} % · {t.cumplimiento.cumple_80 ? 'cumple el 80 %' : 'no alcanza el 80 %'}
              </Insignia>
            )}
          </div>
          <p className="break-words text-gris-txt">{t.region} · {t.municipio} · {t.lugar}</p>
          <ul className="grid gap-1">
            {t.encuentros.map((e) => (
              <li key={e.modulo} className="break-words">
                Módulo {e.modulo} · {e.modalidad === 'VIRTUAL' ? 'virtual' : 'presencial'} · <strong>{textoSesion(e)}</strong>
                {e.satisfaccion != null && <> · satisfacción {e.satisfaccion} de 5</>}
              </li>
            ))}
          </ul>
          {t.cumplimiento && (
            <p>Encuesta de apropiación de salida: {t.cumplimiento.encuesta_salida ? 'registrada' : 'pendiente'} · Entrega final: {t.cumplimiento.entrega_final ? 'cargada' : 'pendiente'}</p>
          )}
          <p>{textoApropiacion(t.apropiacion)}</p>
          {t.resultado && (
            <div className="grid gap-1 border-t border-borde pt-2">
              <p><span className="text-gris-txt">Hallazgos:</span> {t.resultado.hallazgos}</p>
              <p><span className="text-gris-txt">Recomendaciones:</span> {t.resultado.recomendaciones}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
