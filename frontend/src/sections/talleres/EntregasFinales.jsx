// Entregas finales de un grupo: al terminar los tres módulos, cada unidad del grupo tiene su entrega final en
// PDF, que carga el docente y que la coordinación puede consultar y reemplazar.
import { useState } from 'react';
import { FileDown, Upload } from 'lucide-react';
import { apiGeneral } from '../../inventario/lib/api';
import { useAccion } from '../../inventario/lib/useDatos';
import { Alerta, Boton, Entrada, Insignia, Tarjeta, useAvisos } from '../../inventario/componentes/ui';
import { EtiquetaUP } from './GruposUP';

// Muestra una unidad con su entrega final y la acción de cargarla.
function FilaUP({ taller, up, entrega, puedeReemplazar, recargar }) {
  const [archivo, setArchivo] = useState(null);
  const [clave, setClave] = useState(0);
  const { ejecutar, ocupado } = useAccion(recargar);
  const { avisar } = useAvisos();
  const subir = async (ev) => {
    ev.preventDefault();
    if (!archivo || archivo.size > 10 * 1024 * 1024) { avisar('Adjunta un PDF de máximo 10 MB.', 'error'); return; }
    const f = new FormData();
    f.append('archivo', archivo);
    const r = await ejecutar(() => apiGeneral.post(`/talleres/${taller.id}/entregas-finales/${up.id_up}`, f));
    if (r) { setArchivo(null); setClave((k) => k + 1); }
  };
  return (
    <li className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-lg border border-borde p-3 text-[13px] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0 break-words"><EtiquetaUP up={up} />
        {entrega && <p className="mt-1"><Insignia tono="ok">Entregada</Insignia> <a href={`/api/talleres/entregas-finales/${entrega.id}`} className="ml-1 inline-flex items-center gap-1 font-semibold text-acento-txt underline"><FileDown size={16} aria-hidden="true" />{entrega.nombre}</a></p>}
      </div>
      {(!entrega || puedeReemplazar) && (
        <form onSubmit={subir} className="flex min-w-0 flex-wrap items-center gap-2">
          <Entrada key={clave} type="file" aria-label={`PDF de la entrega final de ${up.nombre}`} accept="application/pdf,.pdf" className="w-full min-w-0 sm:w-auto sm:flex-1" onChange={(ev) => setArchivo(ev.target.files?.[0] || null)} />
          <Boton tipo="submit" tamano="sm" icono={Upload} cargando={ocupado} disabled={!archivo}>{entrega ? 'Reemplazar' : 'Cargar entrega final'}</Boton>
        </form>
      )}
    </li>
  );
}

// Muestra las entregas finales de las unidades de un grupo.
export default function EntregasFinales({ taller, recargar, puedeReemplazar, encabezado = null, visibles = null }) {
  const porUP = new Map(taller.entregas_finales.map((f) => [f.id_up, f]));
  const cargadas = taller.participantes.filter((p) => porUP.has(p.id_up)).length;
  return (
    <Tarjeta titulo={taller.nombre} acciones={<Insignia tono={cargadas === taller.participantes.length && cargadas > 0 ? 'ok' : 'alerta'}>{cargadas}/{taller.participantes.length} UP con entrega final</Insignia>}>
      {encabezado}
      {!taller.grupo_completo
        ? <Alerta tono="aviso">La entrega final de cada UP se carga cuando el grupo termina sus tres módulos.</Alerta>
        : !(visibles || taller.participantes).length ? <p className="text-[13px] text-gris-txt">Ninguna UP de este grupo coincide con la búsqueda.</p>
        : <ul className="grid gap-2">{(visibles || taller.participantes).map((up) => <FilaUP key={up.id_up} taller={taller} up={up} entrega={porUP.get(up.id_up)} puedeReemplazar={puedeReemplazar} recargar={recargar} />)}</ul>}
    </Tarjeta>
  );
}
