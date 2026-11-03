// Generador de registro fotográfico. La herramienta es un HTML autocontenido en public/herramientas, sin datos
// personales: abrir en el navegador la abre y ella pide la base a la API con la sesión, y descargar arma una
// copia con la base incrustada, solo con las unidades del alcance de quien la descarga, para usarla sin
// conexión.
import { useState } from 'react';
import { EncabezadoSeccion, Card, Btn, Aviso } from '../components/UI';
import { fetchApi } from '../lib/api';
import {
  ARCHIVO_REGISTRO, NOMBRE_DESCARGA_REGISTRO, URL_DATOS_REGISTRO, enlaceRegistro, incrustarDatos,
} from '../lib/registroFotografico';

// Estilos de botón aplicados a un enlace, porque un botón dentro de un enlace no es HTML válido.
const BASE_BTN =
  'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 ' +
  'text-sm font-semibold transition';

// Muestra las opciones de abrir y descargar la herramienta.
export default function RegistroFotografico({ session }) {
  const [preparando, setPreparando] = useState(false);
  const [error, setError] = useState('');

  const descargar = async () => {
    setPreparando(true);
    setError('');
    try {
      const [plantilla, datos] = await Promise.all([
        fetch(ARCHIVO_REGISTRO, { cache: 'no-store' }).then((r) => {
          if (!r.ok) throw new Error(`plantilla ${r.status}`);
          return r.text();
        }),
        fetchApi(URL_DATOS_REGISTRO, { token: session?.token }).then((r) => r.item),
      ]);
      const url = URL.createObjectURL(new Blob([incrustarDatos(plantilla, datos)], { type: 'text/html' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = NOMBRE_DESCARGA_REGISTRO;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error('[bitacora][E-REGISTRO-FOTO] descargar:', e);
      setError('No se pudo preparar la herramienta. Revisa tu conexión e intenta de nuevo.');
    } finally {
      setPreparando(false);
    }
  };

  return (
    <>
      <EncabezadoSeccion
        titulo="Generador registro fotográfico"
        subtitulo="Descarga la herramienta para armar el PDF de registro fotográfico de las unidades productivas."
      />

      <Card className="p-5">
        <h3 className="text-[15px] font-bold text-marino">Registro fotográfico (HTML)</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-gris">
          Archivo autocontenido: se abre en el navegador, permite cargar las fotos de los
          productos, seleccionar el gestor y la unidad productiva, y generar el PDF.
          Una vez descargado funciona sin conexión.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-gris">
          La copia descargada trae los nombres y cédulas de las unidades productivas de tu alcance:
          es información personal (Ley 1581 de 2012). No la compartas ni la publiques.
        </p>

        {error && <Aviso tono="bad" className="mt-4">{error}</Aviso>}

        <div className="mt-4 flex flex-wrap gap-2.5">
          <Btn type="button" onClick={descargar} disabled={preparando}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {preparando ? 'Preparando…' : 'Descargar herramienta'}
          </Btn>

          <a
            href={enlaceRegistro()}
            target="_blank"
            rel="noopener noreferrer"
            className={`${BASE_BTN} border border-borde bg-card text-texto hover:border-acento`}
          >
            Abrir en el navegador
          </a>
        </div>
      </Card>
    </>
  );
}
