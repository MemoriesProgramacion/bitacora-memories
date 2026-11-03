// Histórico de la base maestra del proceso de subsanación. Una fila por cargue que tocó el proceso de
// subsanación: cuándo, quién, desde qué cargue, el Excel adjunto, que se puede descargar, y, al abrirla, qué
// unidades cambiaron con su antes y después.
import { useCallback, useEffect, useState } from 'react';
import { Card, Btn, Aviso, Chip } from '../../components/UI';
import { fetchApi } from '../../lib/api';
import {
  CARGUE_HISTORIAL_URL, CARGUE_HISTORIAL_CAMBIOS_URL, CARGUE_HISTORIAL_ARCHIVO_URL, SIN_DATOS,
} from '../../lib/config';

const fmt = (n) => Number(n || 0).toLocaleString('es-CO');
const fechaHora = (v) => (v ? new Date(v).toLocaleString('es-CO', {
  timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short',
}) : '—');
// Da formato legible al tamaño de un archivo.
const peso = (b) => (b ? `${(b / (1024 * 1024)).toFixed(1)} MB` : '');
// Nombre legible del origen de cada cargue.
const ORIGEN = { subsanacion: 'Solo subsanación', documentacion: 'Documentación completa' };
const ROL = { superadmin: 'Coordinador general', coordinador_datos: 'Prof. de seguimiento e información' };

// Muestra la lista de cargues del histórico.
export default function HistorialMaster({ session }) {
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [abierta, setAbierta] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      setDatos(await fetchApi(CARGUE_HISTORIAL_URL, { token: session?.token, params: { pagina } }));
    } catch (err) {
      setError(err.publicMsg || 'No se pudo leer el histórico.');
    } finally {
      setCargando(false);
    }
  }, [session?.token, pagina]);

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <Card className="mt-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold text-marino">Histórico de la BASE MASTER · subsanación</h3>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-gris">
            Cada actualización del proceso de subsanación desde la BASE MASTER: cuándo se hizo,
            quién la hizo, qué cambió en cada U.P. y el archivo que se adjuntó. Solo lo ve el
            Coordinador general.
          </p>
        </div>
        <Btn variant="secondary" onClick={cargar} disabled={cargando}>Actualizar</Btn>
      </div>

      {error && <Aviso tono="bad" className="mt-4 mb-0">{error}</Aviso>}

      {datos && !datos.items.length && (
        <p className="mt-4 text-sm text-gris">Aún no hay actualizaciones registradas.</p>
      )}

      {datos?.items.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-borde">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-[10px] uppercase tracking-wide text-gris">
              <tr>
                <th className="px-3 py-2">Cuándo</th>
                <th className="px-3 py-2">Quién</th>
                <th className="px-3 py-2">Cargue</th>
                <th className="px-3 py-2">Archivo</th>
                <th className="px-3 py-2 text-right">U.P. cambiadas</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {datos.items.map((h) => (
                <FilaHistorial
                  key={h.id}
                  h={h}
                  session={session}
                  abierta={abierta === h.id}
                  alAlternar={() => setAbierta((a) => (a === h.id ? null : h.id))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {datos && datos.paginas > 1 && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-gris">
            Página {fmt(datos.pagina)} de {fmt(datos.paginas)} · {fmt(datos.total)} cargues
          </p>
          <div className="flex gap-2">
            <Btn variant="secondary" disabled={datos.pagina <= 1 || cargando}
              onClick={() => setPagina(datos.pagina - 1)}>Anterior</Btn>
            <Btn variant="secondary" disabled={datos.pagina >= datos.paginas || cargando}
              onClick={() => setPagina(datos.pagina + 1)}>Siguiente</Btn>
          </div>
        </div>
      )}
    </Card>
  );
}

// Muestra un cargue del histórico con sus datos y el archivo adjunto.
function FilaHistorial({ h, session, abierta, alAlternar }) {
  const incompleto = h.actualizados + h.sin_cambios + h.no_encontrados + h.fallidos < h.filas;
  return (
    <>
      <tr className="border-t border-borde align-top">
        <td className="whitespace-nowrap px-3 py-2">{fechaHora(h.fecha)}</td>
        <td className="px-3 py-2">
          <div className="font-semibold text-texto">{h.usuario_nombre || '—'}</div>
          <div className="text-[11px] text-gris">{ROL[h.usuario_rol] || h.usuario_rol}</div>
        </td>
        <td className="px-3 py-2">
          <Chip tono={incompleto || h.fallidos ? 'warn' : 'neutral'}>{ORIGEN[h.origen] || h.origen}</Chip>
          {incompleto && <div className="mt-1 text-[11px] text-gris">No terminó: se detuvo a mitad</div>}
        </td>
        <td className="px-3 py-2">
          <a
            className="break-all text-acento underline"
            href={`${CARGUE_HISTORIAL_ARCHIVO_URL}?id=${h.id}`}
            download={h.archivo_nombre}
          >
            {h.archivo_nombre}
          </a>
          <div className="text-[11px] text-gris">{peso(h.archivo_tamano)}</div>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">
          <div className="font-semibold">{fmt(h.actualizados)}</div>
          <div className="text-[11px] text-gris">
            de {fmt(h.filas)} · {fmt(h.sin_cambios)} iguales
            {h.no_encontrados > 0 && ` · ${fmt(h.no_encontrados)} sin expediente`}
            {h.fallidos > 0 && ` · ${fmt(h.fallidos)} con error`}
          </div>
        </td>
        <td className="px-3 py-2 text-right">
          <Btn variant="ghost" className="px-2 py-1 text-xs" onClick={alAlternar} disabled={!h.actualizados}>
            {abierta ? 'Ocultar' : 'Ver cambios'}
          </Btn>
        </td>
      </tr>
      {abierta && (
        <tr className="border-t border-borde bg-bg">
          <td colSpan={6} className="px-3 py-3">
            <CambiosDe id={h.id} session={session} />
          </td>
        </tr>
      )}
    </>
  );
}

// Muestra qué unidades cambiaron en un cargue, con su antes y después.
function CambiosDe({ id, session }) {
  const [busqueda, setBusqueda] = useState('');
  const [q, setQ] = useState('');
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => { setQ(busqueda.trim()); setPagina(1); }, 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  useEffect(() => {
    let vivo = true;
    setError('');
    fetchApi(CARGUE_HISTORIAL_CAMBIOS_URL, { token: session?.token, params: { id, q, pagina } })
      .then((r) => { if (vivo) setDatos(r); })
      .catch((err) => { if (vivo) setError(err.publicMsg || 'No se pudieron leer los cambios.'); });
    return () => { vivo = false; };
  }, [id, q, pagina, session?.token]);

  const valor = (v) => (v ? v : <span className="italic text-gris">{SIN_DATOS}</span>);

  return (
    <div>
      <input
        type="search"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar por ID_unico, nombre o valor"
        className="w-full max-w-sm rounded-lg border border-borde bg-card px-3 py-2 text-sm text-texto"
      />
      {error && <Aviso tono="bad" className="mt-3 mb-0">{error}</Aviso>}
      {datos && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-borde bg-card">
          <table className="w-full text-xs">
            <thead className="text-left text-[10px] uppercase tracking-wide text-gris">
              <tr>
                <th className="px-3 py-2">ID_unico</th>
                <th className="px-3 py-2">U.P.</th>
                <th className="px-3 py-2">Antes</th>
                <th className="px-3 py-2">Después</th>
              </tr>
            </thead>
            <tbody>
              {datos.items.map((c) => (
                <tr key={c.id_unico} className="border-t border-borde align-top">
                  <td className="px-3 py-2 font-semibold tabular-nums">{c.id_unico}</td>
                  <td className="px-3 py-2">{c.up_nombre || '—'}</td>
                  <td className="px-3 py-2 text-gris">{valor(c.antes)}</td>
                  <td className="px-3 py-2">{valor(c.despues)}</td>
                </tr>
              ))}
              {!datos.items.length && (
                <tr><td colSpan={4} className="px-3 py-3 text-gris">Nada coincide con la búsqueda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {datos && datos.paginas > 1 && (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-[11px] text-gris">
            Página {fmt(datos.pagina)} de {fmt(datos.paginas)} · {fmt(datos.total)} U.P.
          </p>
          <div className="flex gap-2">
            <Btn variant="secondary" className="px-3 py-1.5 text-xs" disabled={datos.pagina <= 1}
              onClick={() => setPagina(datos.pagina - 1)}>Anterior</Btn>
            <Btn variant="secondary" className="px-3 py-1.5 text-xs" disabled={datos.pagina >= datos.paginas}
              onClick={() => setPagina(datos.pagina + 1)}>Siguiente</Btn>
          </div>
        </div>
      )}
    </div>
  );
}
