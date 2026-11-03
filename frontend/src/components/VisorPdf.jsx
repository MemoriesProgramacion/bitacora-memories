// Visor del PDF del carrito, tomado del almacén de archivos de la API.
import { useState, useEffect } from 'react';
import { VISOR_API_URL, VISOR_ID_KEYS } from '../lib/config';
import { val, pick } from '../lib/utils';
import { urlArchivo } from '../lib/api';

// Extrae del nombre del archivo la fecha y hora pegadas, para poder ordenar por antigüedad.
function tsDeBlob(nombre) {
  const m = String(nombre).match(/_(\d{8})_(\d{6})/);
  return m ? m[1] + m[2] : '';
}

// Devuelve la misma fecha lista para mostrar: DD/MM/AAAA HH:MM.
function fechaDeBlob(nombre) {
  const m = String(nombre).match(/_(\d{8})_(\d{6})_/);
  if (!m) return null;
  const d = m[1], h = m[2];
  return `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)} ${h.slice(0, 2)}:${h.slice(2, 4)}`;
}

// Muestra el último PDF validado de una unidad productiva y avisa cuántas versiones hay.
export default function VisorPdf({ up }) {
  const [estado, setEstado] = useState({ cargando: true });

  useEffect(() => {
    let vivo = true;
    if (!VISOR_API_URL) return;

    const id = val(pick(up, VISOR_ID_KEYS));
    if (!id) { setEstado({ mensaje: 'Sin código para consultar el documento.' }); return; }
    const idLimpio = String(id).trim();

    setEstado({ cargando: true });
    (async () => {
      try {
        const res = await fetch(`${VISOR_API_URL}?action=list&id=${encodeURIComponent(idLimpio)}`, {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const propios = (data.blobs || []).filter(
          (b) => String(b.name).indexOf(idLimpio + '_') === 0
        );
        if (!vivo) return;

        if (!propios.length) {
          if ((data.blobs || []).length) {
            console.warn(`[bitacora][E-VISOR] ${data.blobs.length} archivo(s) por prefijo "${idLimpio}", ninguno exacto.`);
          }
          setEstado({ mensaje: 'No hay PDF cargado en el validador.' });
          return;
        }

        const ordenados = [...propios].sort((a, b) => tsDeBlob(a.name).localeCompare(tsDeBlob(b.name)));
        const ultimo = ordenados[ordenados.length - 1];
        setEstado({
          url: urlArchivo(`${VISOR_API_URL}?action=get&blobName=${encodeURIComponent(ultimo.name)}`),
          fecha: fechaDeBlob(ultimo.name),
          total: propios.length,
        });
      } catch (err) {
        console.error('[bitacora][E-VISOR] No se pudo consultar el visor:', err);
        if (vivo) setEstado({ mensaje: 'No se pudo consultar el documento.' });
      }
    })();

    return () => { vivo = false; };
  }, [up]);

  if (estado.cargando) {
    return <p className="mt-2.5 text-xs italic text-gris">Buscando último PDF validado…</p>;
  }
  if (estado.mensaje) {
    return <p className="mt-2.5 text-xs italic text-gris">{estado.mensaje}</p>;
  }

  return (
    <div className="mt-2.5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {estado.fecha && <span className="text-[11px] text-gris">Cargado: {estado.fecha}</span>}
        {estado.total > 1 && (
          <span className="text-[11px] text-gris">({estado.total} versiones)</span>
        )}
        <a
          href={estado.url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-borde bg-card px-3 py-1.5 text-xs font-semibold text-texto hover:border-acento hover:text-marino"
        >
          Abrir aparte
        </a>
      </div>
      <iframe
        src={`${estado.url}#toolbar=1&navpanes=0`}
        title="Último PDF validado del carrito"
        loading="lazy"
        className="h-[560px] w-full rounded-lg border border-borde bg-white no-print"
      />
    </div>
  );
}
