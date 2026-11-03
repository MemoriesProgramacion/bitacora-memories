// Administración del catálogo, solo para la coordinación: agregar y editar productos uno por uno, ocultar los
// que ya no se ofrecen o cargar muchos de una vez desde un Excel o un CSV. Volver a cargar el mismo archivo
// actualiza y no duplica. Cada producto se clasifica con su clase UNSPSC y su rubro, o se marca como no
// financiable.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Pencil, Plus, Save, Search, Store, Trash2, Upload } from 'lucide-react';
import { apiGeneral, pesos, qs } from '../../inventario/lib/api';
import {
  Alerta, AreaTexto, Boton, Campo, Cargando, Celda, Confirmar, Dialogo, Entrada, Fila, Insignia,
  Seleccion, Tabla, Tarjeta, useAvisos,
} from '../../inventario/componentes/ui';
import { PLANTILLA_CATALOGO, PLANTILLA_UNSPSC } from '../../lib/carrito';
import { cargarListas, nombreDe, rubrosPorGrupo } from '../../lib/clasificacion';
import { esGeneral } from '../../lib/permisos';
import CampoUnspsc from './CampoUnspsc';

// Producto en blanco para el formulario de uno nuevo.
const VACIO = {
  codigo: '', nombre: '', precio: '', iva: '19', tipologia: '', sector: '', proceso: '', tipo: '', descripcion: '',
  unspsc: '', rubro: '', no_financiable: '',
};

// Formulario para crear o editar un producto; al editar, el código no se cambia.
function FormProducto({ producto, listas, onGuardado, onCerrar }) {
  const { avisar } = useAvisos();
  const editando = Boolean(producto?.id_producto);
  const [f, setF] = useState(() => (producto
    ? { ...VACIO, ...Object.fromEntries(Object.entries(producto).map(([k, v]) => [k, v ?? ''])), codigo: producto.id_origen || '' }
    : VACIO));
  const [enviando, setEnviando] = useState(false);
  const poner = (campo) => (e) => setF((x) => ({ ...x, [campo]: e.target.value }));

  const guardar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    try {
      await apiGeneral.post('/catalogo/guardar', {
        ...f, id_producto: producto?.id_producto, precio: f.precio, iva: f.iva,
        unspsc: f.unspsc.trim() || null, rubro: f.rubro || null, no_financiable: f.no_financiable || null,
      });
      avisar(editando ? 'Producto actualizado.' : 'Producto agregado al catálogo.');
      onGuardado();
    } catch (err) {
      avisar(err.message, 'error');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <Campo etiqueta="Nombre del producto">
        <Entrada required maxLength={300} value={f.nombre} onChange={poner('nombre')} />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo etiqueta="Precio (sin IVA)">
          <Entrada required type="number" min="0" step="any" inputMode="decimal" value={f.precio} onChange={poner('precio')} />
        </Campo>
        <Campo etiqueta="IVA (%)">
          <Entrada type="number" min="0" max="100" step="any" inputMode="decimal" value={f.iva} onChange={poner('iva')} />
        </Campo>
        <Campo etiqueta="Código" ayuda={editando ? 'No se cambia.' : 'Opcional.'}>
          <Entrada maxLength={100} value={f.codigo} onChange={poner('codigo')} disabled={editando} />
        </Campo>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Tipología"><Entrada maxLength={150} value={f.tipologia} onChange={poner('tipologia')} /></Campo>
        <Campo etiqueta="Sector"><Entrada maxLength={150} value={f.sector} onChange={poner('sector')} /></Campo>
        <Campo etiqueta="Proceso"><Entrada maxLength={150} value={f.proceso} onChange={poner('proceso')} /></Campo>
        <Campo etiqueta="Tipo"><Entrada maxLength={100} value={f.tipo} onChange={poner('tipo')} /></Campo>
      </div>
      <Campo etiqueta="Descripción">
        <AreaTexto rows={3} maxLength={2000} value={f.descripcion} onChange={poner('descripcion')} />
      </Campo>
      <fieldset className="flex flex-col gap-4 rounded-xl border border-borde p-3.5">
        <legend className="px-1 text-[13px] font-semibold text-marca">Clasificación del Anexo</legend>
        <CampoUnspsc valor={f.unspsc} onCambio={(v) => setF((x) => ({ ...x, unspsc: v }))}
          ayuda={listas && !listas.unspsc_cargadas ? 'Todavía no se ha cargado el catálogo de clases UNSPSC.' : undefined} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Rubro capitalizable" ayuda={f.no_financiable ? 'Un producto no financiable no lleva rubro.' : undefined}>
            <Seleccion value={f.rubro} onChange={poner('rubro')} disabled={Boolean(f.no_financiable)}>
              <option value="">Sin rubro</option>
              {rubrosPorGrupo(listas?.rubros).map((g) => (
                <optgroup key={g.grupo} label={g.grupo}>
                  {g.items.map((r) => <option key={r.codigo} value={r.codigo}>{r.nombre}</option>)}
                </optgroup>
              ))}
            </Seleccion>
          </Campo>
          <Campo etiqueta="No financiable" ayuda="Si se marca, no se puede poner en ningún carrito.">
            <Seleccion value={f.no_financiable}
              onChange={(e) => setF((x) => ({ ...x, no_financiable: e.target.value, rubro: e.target.value ? '' : x.rubro }))}>
              <option value="">Es financiable</option>
              {(listas?.no_financiables || []).map((n) => <option key={n.codigo} value={n.codigo}>{n.nombre}</option>)}
            </Seleccion>
          </Campo>
        </div>
      </fieldset>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton tipo="submit" icono={Save} cargando={enviando}>{editando ? 'Guardar cambios' : 'Agregar producto'}</Boton>
      </div>
    </form>
  );
}

// Carga del catálogo de clases UNSPSC desde un Excel o CSV con código y nombre; es un catálogo nacional.
function CargaUnspsc({ listas, onCargado }) {
  const { avisar } = useAvisos();
  const archivo = useRef(null);
  const [subiendo, setSubiendo] = useState(false);
  const [informe, setInforme] = useState(null);

  const importar = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setSubiendo(true);
    setInforme(null);
    try {
      const cuerpo = new FormData();
      cuerpo.append('archivo', f);
      const r = await apiGeneral.post('/unspsc/importar', cuerpo);
      setInforme(r);
      avisar(r.mensaje);
      onCargado();
    } catch (err) {
      avisar(err.message, 'error');
    } finally {
      setSubiendo(false);
    }
  };

  const plantilla = () => {
    const url = URL.createObjectURL(new Blob(['﻿', PLANTILLA_UNSPSC], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla-unspsc.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Tarjeta titulo="Catálogo de clases UNSPSC">
      <p className="mb-3 text-[13px] text-gris-txt">
        Los bienes se clasifican con la clase UNSPSC de 6 dígitos. Sube un Excel (.xlsx) o un CSV con las columnas{' '}
        <strong>Código</strong> y <strong>Nombre</strong>. Las filas de segmentos, familias o productos (2, 4 u 8 dígitos) se omiten.
        Hay <strong>{listas?.unspsc_cargadas ?? 0}</strong> clases cargadas.
      </p>
      <div className="flex flex-wrap gap-2">
        <input ref={archivo} type="file" accept=".xlsx,.csv" className="sr-only" onChange={importar} aria-label="Archivo de clases UNSPSC" />
        <Boton icono={Upload} cargando={subiendo} onClick={() => archivo.current?.click()}>Subir clases UNSPSC</Boton>
        <Boton variante="fantasma" icono={Download} onClick={plantilla}>Descargar plantilla</Boton>
      </div>
      {informe && (
        <Alerta tono={informe.errores.length ? 'aviso' : 'info'} className="mt-4">
          <strong>{informe.creadas} nuevas, {informe.actualizadas} actualizadas, {informe.omitidas} omitidas.</strong>
          {informe.errores.length > 0 && (
            <ul className="mt-1.5 list-disc pl-5">
              {informe.errores.map((er) => <li key={er.fila}>Fila {er.fila}: {er.motivo}</li>)}
            </ul>
          )}
        </Alerta>
      )}
    </Tarjeta>
  );
}

// Muestra la lista de productos, su formulario y las cargas masivas.
export default function CatalogoAdmin({ session }) {
  const { avisar } = useAvisos();
  const archivo = useRef(null);
  const [listas, setListas] = useState(null);
  const recargarListas = useCallback(() => {
    cargarListas(true).then(setListas).catch((err) => avisar(err.message, 'error'));
  }, [avisar]);
  useEffect(() => { recargarListas(); }, [recargarListas]);
  const [q, setQ] = useState('');
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState(null);
  const [formulario, setFormulario] = useState(null);
  const [aOcultar, setAOcultar] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const [informe, setInforme] = useState(null);

  const cargar = useCallback(async () => {
    try {
      setDatos(await apiGeneral.get(`/catalogo${qs({ q, pagina })}`));
    } catch (err) {
      avisar(err.message, 'error');
      setDatos({ items: [], total: 0, paginas: 1, pagina: 1 });
    }
  }, [q, pagina, avisar]);
  useEffect(() => {
    const espera = setTimeout(cargar, q ? 300 : 0);
    return () => clearTimeout(espera);
  }, [cargar, q]);

  const importar = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setSubiendo(true);
    setInforme(null);
    try {
      const cuerpo = new FormData();
      cuerpo.append('archivo', f);
      const r = await apiGeneral.post('/catalogo/importar', cuerpo);
      setInforme(r);
      avisar(r.mensaje);
      setPagina(1);
      cargar();
    } catch (err) {
      avisar(err.message, 'error');
    } finally {
      setSubiendo(false);
    }
  };

  const descargarPlantilla = () => {
    const url = URL.createObjectURL(new Blob(['﻿', PLANTILLA_CATALOGO], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla-catalogo.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const ocultar = async () => {
    const id = aOcultar?.id_producto;
    setAOcultar(null);
    try {
      await apiGeneral.del(`/catalogo${qs({ id })}`);
      avisar('Producto retirado del catálogo.');
      cargar();
    } catch (err) {
      avisar(err.message, 'error');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {esGeneral(session) && <CargaUnspsc listas={listas} onCargado={recargarListas} />}
      <Tarjeta titulo="Cargar el catálogo desde un archivo">
        <p className="mb-3 text-[13px] text-gris-txt">
          Sube un Excel (.xlsx) o un CSV con una fila por producto. Necesita al menos las columnas <strong>Nombre</strong> y{' '}
          <strong>Precio</strong>; también se leen Código, IVA, Tipología, Sector, Proceso, Tipo, Descripción, UNSPSC, Rubro
          y No financiable. Si un código ya existe se actualiza; nada se borra, y si el archivo no trae la clasificación, se
          conserva la que tenía el producto.
        </p>
        <div className="flex flex-wrap gap-2">
          <input ref={archivo} type="file" accept=".xlsx,.csv" className="sr-only" onChange={importar} aria-label="Archivo del catálogo" />
          <Boton icono={Upload} cargando={subiendo} onClick={() => archivo.current?.click()}>Subir archivo</Boton>
          <Boton variante="fantasma" icono={Download} onClick={descargarPlantilla}>Descargar plantilla</Boton>
        </div>
        {informe && (
          <Alerta tono={informe.errores.length ? 'aviso' : 'info'} className="mt-4">
            <strong>{informe.creados} nuevos, {informe.actualizados} actualizados, {informe.omitidos} omitidos.</strong>
            {informe.errores.length > 0 && (
              <ul className="mt-1.5 list-disc pl-5">
                {informe.errores.map((er) => <li key={er.fila}>Fila {er.fila}: {er.motivo}</li>)}
              </ul>
            )}
          </Alerta>
        )}
      </Tarjeta>

      <Tarjeta
        titulo={`Productos (${datos?.total ?? 0})`}
        acciones={(
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
            <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
              <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-gris" />
              <Entrada type="search" aria-label="Buscar en el catálogo" placeholder="Buscar…" value={q}
                onChange={(e) => { setQ(e.target.value); setPagina(1); }} className="pl-10" />
            </div>
            <Boton icono={Plus} onClick={() => setFormulario({})}>Nuevo</Boton>
          </div>
        )}
      >
        {datos === null ? <Cargando /> : (
          <>
            <Tabla
              cabeceras={['Producto', 'Clasificación', { texto: 'Precio', alinear: 'derecha' }, { texto: 'IVA', alinear: 'derecha' }, { texto: '', alinear: 'derecha' }]}
              vacio={q ? 'Ningún producto coincide.' : 'El catálogo está vacío. Sube un archivo o agrega un producto.'}
              iconoVacio={Store}
            >
              {datos.items.map((p) => (
                <Fila key={p.id_producto}>
                  <Celda>
                    <div className="font-semibold text-marca">{p.nombre}</div>
                    <div className="font-mono text-[11px] text-gris-txt">{p.id_origen}</div>
                  </Celda>
                  <Celda className="text-[13px]">
                    <div className="flex flex-wrap gap-1">
                      {[p.tipologia, p.sector].filter(Boolean).map((t) => <Insignia key={t}>{t}</Insignia>)}
                      {p.no_financiable
                        ? <Insignia tono="error">No financiable</Insignia>
                        : p.rubro ? <Insignia tono="ok">{nombreDe(listas?.rubros, p.rubro)}</Insignia> : <Insignia tono="alerta">Sin rubro</Insignia>}
                    </div>
                    <div className="mt-1 text-[11px] text-gris-txt">
                      {p.unspsc ? `UNSPSC ${p.unspsc}${p.unspsc_nombre ? ` · ${p.unspsc_nombre}` : ''}` : 'Sin clase UNSPSC'}
                    </div>
                  </Celda>
                  <Celda alinear="derecha" className="cifras whitespace-nowrap font-semibold">{pesos(p.precio)}</Celda>
                  <Celda alinear="derecha" className="cifras">{p.iva} %</Celda>
                  <Celda alinear="derecha">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Boton tamano="sm" variante="fantasma" icono={Pencil} onClick={() => setFormulario(p)} aria-label={`Editar ${p.nombre}`}>Editar</Boton>
                      <Boton tamano="sm" variante="fantasma" icono={Trash2} onClick={() => setAOcultar(p)} aria-label={`Retirar ${p.nombre}`}>Retirar</Boton>
                    </div>
                  </Celda>
                </Fila>
              ))}
            </Tabla>
            {datos.paginas > 1 && (
              <div className="mt-4 flex items-center justify-between gap-3 text-[13px] text-gris-txt">
                <span>Página {datos.pagina} de {datos.paginas}</span>
                <div className="flex gap-2">
                  <Boton variante="fantasma" disabled={pagina <= 1} onClick={() => setPagina((n) => n - 1)}>Anterior</Boton>
                  <Boton variante="fantasma" disabled={pagina >= datos.paginas} onClick={() => setPagina((n) => n + 1)}>Siguiente</Boton>
                </div>
              </div>
            )}
          </>
        )}
      </Tarjeta>

      <Dialogo abierto={Boolean(formulario)} titulo={formulario?.id_producto ? 'Editar producto' : 'Nuevo producto'}
        onCerrar={() => setFormulario(null)} ancho="max-w-xl">
        {formulario && (
          <FormProducto producto={formulario.id_producto ? formulario : null} listas={listas}
            onGuardado={() => { setFormulario(null); cargar(); }} onCerrar={() => setFormulario(null)} />
        )}
      </Dialogo>

      <Confirmar
        abierto={Boolean(aOcultar)}
        titulo="¿Retirar del catálogo?"
        texto={`"${aOcultar?.nombre}" deja de ofrecerse. Los carritos que ya lo tienen lo conservan.`}
        etiquetaOk="Retirar"
        onOk={ocultar}
        onCancelar={() => setAOcultar(null)}
      />
    </div>
  );
}
