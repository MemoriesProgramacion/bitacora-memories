// Sección de datos cargados, complemento del cargue de datos: aquí se revisa unidad por unidad lo que entró con
// el cargue masivo y se puede cambiar un valor, agregarlo donde faltaba o eliminarlo, con lo que la unidad
// vuelve a quedar sin dato. El servidor vuelve a exigir el permiso en cada petición.
import { useCallback, useEffect, useState } from 'react';
import { EncabezadoSeccion, Card, Btn, Aviso, Chip, Spinner } from '../components/UI';
import { fetchApi } from '../lib/api';
import { CARGUE_DATOS_URL, CARGUE_EDITAR_URL, CARGUE_ELIMINAR_URL } from '../lib/config';

const CAMPO = 'proceso_subsanacion';
const TITULO_CAMPO = 'Proceso de subsanación';
const MAX_VALOR = 500;

const inputCls =
  'w-full rounded-lg border border-borde bg-card px-3 py-2 text-[13px] outline-none focus:border-acento';
const fmt = (n) => Number(n || 0).toLocaleString('es-CO');
const fecha = (v) => (v ? new Date(v).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—');

// Muestra la lista de unidades con el valor cargado de un campo y sus acciones de edición.
export default function DatosCargados({ session, onCambio }) {
  const [filtros, setFiltros] = useState({ q: '', estado: 'todos', valor: '', pagina: 1 });
  const [busqueda, setBusqueda] = useState('');
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [seleccion, setSeleccion] = useState(() => new Set());
  const [editando, setEditando] = useState(null);
  const [confirmando, setConfirmando] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      const r = await fetchApi(CARGUE_DATOS_URL, {
        token: session?.token,
        params: { campo: CAMPO, q: filtros.q, estado: filtros.estado, valor: filtros.valor, pagina: filtros.pagina },
      });
      setDatos(r);
    } catch (err) {
      console.error('[datos-cargados] Lista', err);
      setError(err.publicMsg || 'No se pudo cargar la lista. Intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  }, [session?.token, filtros]);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    const t = setTimeout(() => setFiltros((f) => (f.q === busqueda ? f : { ...f, q: busqueda, pagina: 1 })), 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  const cambiarFiltro = (patch) => {
    setSeleccion(new Set());
    setConfirmando(null);
    setFiltros((f) => ({ ...f, ...patch, pagina: patch.pagina ?? 1 }));
  };

  const terminar = async (mensaje) => {
    setAviso(mensaje);
    setSeleccion(new Set());
    setEditando(null);
    setConfirmando(null);
    await cargar();
    if (onCambio) onCambio();
  };

  async function guardar() {
    const texto = editando.texto.trim();
    if (!texto) { setError('Escribe el valor. Para dejarlo sin dato usa Eliminar.'); return; }
    setOcupado(true);
    setError('');
    setAviso('');
    try {
      await fetchApi(CARGUE_EDITAR_URL, {
        token: session?.token, metodo: 'POST',
        cuerpo: { campo: CAMPO, id_unico: editando.id, valor: texto },
      });
      await terminar(`Unidad ${editando.id} actualizada.`);
    } catch (err) {
      setError(err.publicMsg || 'No se pudo guardar el cambio.');
    } finally {
      setOcupado(false);
    }
  }

  async function eliminar(ids) {
    setOcupado(true);
    setError('');
    setAviso('');
    try {
      const r = await fetchApi(CARGUE_ELIMINAR_URL, {
        token: session?.token, metodo: 'POST', cuerpo: { campo: CAMPO, ids },
      });
      await terminar(`${fmt(r.eliminados)} ${r.eliminados === 1 ? 'dato eliminado' : 'datos eliminados'}.`);
    } catch (err) {
      setError(err.publicMsg || 'No se pudo eliminar.');
    } finally {
      setOcupado(false);
    }
  }

  const items = datos?.items || [];
  const conDatoEnPagina = items.filter((i) => i.valor !== null);
  const todosMarcados = conDatoEnPagina.length > 0 && conDatoEnPagina.every((i) => seleccion.has(i.id_unico));
  const alternar = (id) => setSeleccion((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const alternarTodos = () => setSeleccion(todosMarcados ? new Set() : new Set(conDatoEnPagina.map((i) => i.id_unico)));

  return (
    <>
      <EncabezadoSeccion
        titulo="Datos cargados"
        subtitulo="Revisa lo que subiste con el cargue de datos: cambia un valor, agrégalo donde falta o elimínalo."
      />

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-bold text-marino">{TITULO_CAMPO}</h3>
            <p className="mt-1 text-[13px] text-gris">
              Eliminar no borra la unidad: solo quita este dato y la deja “sin dato”.
            </p>
          </div>
          {datos && (
            <div className="flex flex-wrap gap-2">
              <Chip tono="ok">{fmt(datos.resumen.con_dato)} con dato</Chip>
              <Chip tono="neutral">{fmt(datos.resumen.sin_dato)} sin dato</Chip>
              <Chip tono="neutral">{fmt(datos.resumen.total)} unidades</Chip>
            </div>
          )}
        </div>

        <div className="mt-4 grid gap-2.5 sm:grid-cols-[1fr_11rem_14rem]">
          <input
            type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por ID, unidad o valor…" aria-label="Buscar" className={inputCls}
          />
          <select value={filtros.estado} onChange={(e) => cambiarFiltro({ estado: e.target.value })}
            aria-label="Estado" className={inputCls}>
            <option value="todos">Todas</option>
            <option value="con">Con dato</option>
            <option value="sin">Sin dato</option>
          </select>
          <select value={filtros.valor} onChange={(e) => cambiarFiltro({ valor: e.target.value })}
            aria-label="Valor" className={inputCls}>
            <option value="">Cualquier valor</option>
            {(datos?.valores || []).map((v) => (
              <option key={v.valor} value={v.valor}>{v.valor} ({fmt(v.n)})</option>
            ))}
          </select>
        </div>

        {error && <Aviso tono="bad" className="mt-4 mb-0">{error}</Aviso>}
        {aviso && !error && <Aviso tono="ok" className="mt-4 mb-0">{aviso}</Aviso>}

        {seleccion.size > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2.5 rounded-lg border border-borde bg-bg px-3.5 py-2.5">
            <span className="text-[13px] font-semibold text-texto">{fmt(seleccion.size)} marcadas</span>
            {confirmando === 'seleccion' ? (
              <>
                <span className="text-[13px] text-rojo">¿Eliminar el dato de {fmt(seleccion.size)} unidades?</span>
                <Btn variant="secondary" disabled={ocupado} onClick={() => eliminar([...seleccion])}
                  className="!border-rojo !text-rojo">Sí, eliminar</Btn>
                <Btn variant="ghost" disabled={ocupado} onClick={() => setConfirmando(null)}>No</Btn>
              </>
            ) : (
              <>
                <Btn variant="secondary" disabled={ocupado} onClick={() => setConfirmando('seleccion')}
                  className="!text-rojo">Eliminar datos marcados</Btn>
                <Btn variant="ghost" onClick={() => setSeleccion(new Set())}>Quitar marcas</Btn>
              </>
            )}
          </div>
        )}

        {cargando && !datos ? (
          <Spinner texto="Cargando datos cargados…" />
        ) : (
          <div className={`mt-4 overflow-x-auto rounded-lg border border-borde transition ${cargando ? 'opacity-60' : ''}`}>
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="bg-bg text-left text-[10px] uppercase tracking-wide text-gris">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <input type="checkbox" checked={todosMarcados} onChange={alternarTodos}
                      disabled={!conDatoEnPagina.length} aria-label="Marcar todas las de esta página" />
                  </th>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Unidad productiva</th>
                  <th className="px-3 py-2">Nodo</th>
                  <th className="px-3 py-2">{TITULO_CAMPO}</th>
                  <th className="px-3 py-2">Actualizado</th>
                  <th className="px-3 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-gris">
                    No hay unidades con esos filtros.
                  </td></tr>
                )}
                {items.map((u) => {
                  const enEdicion = editando?.id === u.id_unico;
                  const borrando = confirmando === u.id_unico;
                  return (
                    <tr key={u.id_unico} className="border-t border-borde align-top hover:bg-bg/60">
                      <td className="px-3 py-2.5">
                        <input type="checkbox" disabled={u.valor === null} checked={seleccion.has(u.id_unico)}
                          onChange={() => alternar(u.id_unico)} aria-label={`Marcar ${u.id_unico}`} />
                      </td>
                      <td className="px-3 py-2.5 font-semibold tabular-nums">{u.id_unico}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-texto">{u.up_nombre || '—'}</div>
                        {u.municipio && <div className="text-xs text-gris">{u.municipio}</div>}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">{u.nodo || '—'}</td>
                      <td className="min-w-[14rem] px-3 py-2.5">
                        {enEdicion ? (
                          <input
                            autoFocus value={editando.texto} maxLength={MAX_VALOR}
                            onChange={(e) => setEditando({ ...editando, texto: e.target.value })}
                            onKeyDown={(e) => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setEditando(null); }}
                            aria-label={`${TITULO_CAMPO} de ${u.id_unico}`} className={inputCls}
                          />
                        ) : u.valor === null ? (
                          <span className="italic text-gris">Sin dato</span>
                        ) : (
                          <span className="break-words">{u.valor}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-gris">{fecha(u.fecha_actualizacion)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {enEdicion ? (
                            <>
                              <Btn disabled={ocupado} onClick={guardar} className="!px-3 !py-1.5">Guardar</Btn>
                              <Btn variant="ghost" disabled={ocupado} onClick={() => setEditando(null)} className="!px-3 !py-1.5">Cancelar</Btn>
                            </>
                          ) : borrando ? (
                            <>
                              <Btn variant="secondary" disabled={ocupado} onClick={() => eliminar([u.id_unico])}
                                className="!border-rojo !px-3 !py-1.5 !text-rojo">Sí, eliminar</Btn>
                              <Btn variant="ghost" disabled={ocupado} onClick={() => setConfirmando(null)} className="!px-3 !py-1.5">No</Btn>
                            </>
                          ) : (
                            <>
                              <Btn variant="secondary" disabled={ocupado} className="!px-3 !py-1.5"
                                onClick={() => { setConfirmando(null); setError(''); setEditando({ id: u.id_unico, texto: u.valor || '' }); }}>
                                {u.valor === null ? 'Agregar' : 'Modificar'}
                              </Btn>
                              {u.valor !== null && (
                                <Btn variant="ghost" disabled={ocupado} className="!px-3 !py-1.5 !text-rojo"
                                  onClick={() => { setEditando(null); setConfirmando(u.id_unico); }}>Eliminar</Btn>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {datos && datos.total > datos.por_pagina && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-gris">
            <span>
              Página {fmt(datos.pagina)} de {fmt(datos.paginas)} · {fmt(datos.total)} unidades
            </span>
            <div className="flex gap-2">
              <Btn variant="secondary" disabled={datos.pagina <= 1 || cargando}
                onClick={() => cambiarFiltro({ pagina: datos.pagina - 1 })}>Anterior</Btn>
              <Btn variant="secondary" disabled={datos.pagina >= datos.paginas || cargando}
                onClick={() => cambiarFiltro({ pagina: datos.pagina + 1 })}>Siguiente</Btn>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
