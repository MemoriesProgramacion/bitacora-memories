// Sección de proveedores: se crean, ven y editan proveedores y se consultan las facturas de cada uno, que son
// las mismas del inventario. Cada proveedor lleva su documento (NIT o cédula), contacto, teléfono, correo y
// dirección. Eliminar es una acción más restringida y un proveedor con facturas, artículos o recepciones no se
// puede eliminar.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EncabezadoSeccion, Card, Btn, Aviso, Spinner, Chip } from '../components/UI';
import { Confirmar } from '../inventario/componentes/ui';
import { fetchApi } from '../lib/api';
import { PROVEEDORES_URL, API_BASE } from '../lib/config';

const VACIO = {
  nombre: '', tipo_documento: 'NIT', numero_documento: '', contacto: '', telefono: '', correo: '',
  direccion: '', municipio: '', departamento: '',
};
const TIPOS = { NIT: 'NIT', CC: 'Cédula de ciudadanía', CE: 'Cédula de extranjería', PASAPORTE: 'Pasaporte' };
const FILTROS = [['todos', 'Todos'], ['con', 'Con facturas'], ['sin', 'Sin facturas'], ['incompletos', 'Datos incompletos']];

const documento = (p) => (p.numero_documento ? `${p.tipo_documento} ${p.numero_documento}` : '');
const incompleto = (p) => !p.numero_documento || !p.contacto || !p.telefono || !p.correo || !p.direccion;
const pesos = (v) => `$ ${Math.round(Number(v) || 0).toLocaleString('es-CO')}`;
const dia = (v) => String(v || '').slice(0, 10);
const sinTildes = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const inputCls =
  'mt-1 w-full rounded-lg border border-borde bg-card px-3 py-2 text-[13px] font-normal normal-case tracking-normal text-texto outline-none focus:border-acento';
const labelCls = 'block text-[11px] font-bold uppercase tracking-wide text-gris';
const btnMini = '!px-3 !py-1.5 !text-[12px]';

// Ventana encima de la pantalla que se cierra con el botón, con Escape o tocando fuera.
function Ventana({ titulo, subtitulo, onCerrar, ancho = 'max-w-2xl', children }) {
  useEffect(() => {
    const alTeclear = (e) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [onCerrar]);
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6" role="dialog"
      aria-modal="true" aria-label={titulo} onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className={`my-auto w-full ${ancho} rounded-card border border-borde bg-card shadow-xl`}>
        <div className="flex items-start justify-between gap-3 border-b border-borde px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-marino">{titulo}</h3>
            {subtitulo && <p className="text-xs text-gris">{subtitulo}</p>}
          </div>
          <button type="button" onClick={onCerrar} className="shrink-0 text-[13px] font-semibold text-gris hover:text-marino">Cerrar ✕</button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function Campo({ etiqueta, campo, form, setForm, ...props }) {
  return (
    <label className={labelCls}>
      {etiqueta}
      <input {...props} value={form[campo]} onChange={(e) => setForm({ ...form, [campo]: e.target.value })} className={inputCls} />
    </label>
  );
}

// Formulario de un proveedor para crear o editar.
function Formulario({ form, setForm, onEnviar, guardando, error, textoBoton }) {
  const c = { form, setForm };
  return (
    <form onSubmit={onEnviar} className="grid gap-3 sm:grid-cols-2">
      <p className="text-xs text-gris sm:col-span-2">Los campos con * son obligatorios.</p>
      <div className="sm:col-span-2"><Campo etiqueta="Nombre o razón social *" campo="nombre" required maxLength={120} {...c} /></div>
      <label className={labelCls}>Tipo de documento *
        <select value={form.tipo_documento} onChange={(e) => setForm({ ...form, tipo_documento: e.target.value })} className={inputCls}>
          {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <Campo etiqueta={form.tipo_documento === 'NIT' ? 'NIT * (900123456-7)' : 'Número de documento *'} campo="numero_documento" required maxLength={20} {...c} />
      <Campo etiqueta="Persona de contacto *" campo="contacto" required maxLength={120} {...c} />
      <Campo etiqueta="Teléfono de contacto *" campo="telefono" type="tel" required maxLength={20} {...c} />
      <div className="sm:col-span-2"><Campo etiqueta="Correo electrónico *" campo="correo" type="email" required maxLength={150} {...c} /></div>
      <div className="sm:col-span-2"><Campo etiqueta="Dirección *" campo="direccion" required maxLength={200} {...c} /></div>
      <Campo etiqueta="Municipio *" campo="municipio" required maxLength={100} {...c} />
      <Campo etiqueta="Departamento" campo="departamento" maxLength={100} {...c} />
      <div className="sm:col-span-2">
        {error && <Aviso tono="bad">{error}</Aviso>}
        <div className="flex justify-end"><Btn type="submit" disabled={guardando}>{guardando ? 'Guardando…' : textoBoton}</Btn></div>
      </div>
    </form>
  );
}

const Dato = ({ etiqueta, children }) => (
  <div className="rounded-lg border border-borde px-3 py-2">
    <dt className="text-[11px] font-bold uppercase tracking-wide text-gris">{etiqueta}</dt>
    <dd className="break-words text-[13px]">{children || <span className="text-gris">—</span>}</dd>
  </div>
);

// Muestra el número de facturas, que al tocarlo las lista; si no tiene, es solo un cero.
function ContadorFacturas({ p, onVer }) {
  if (!p.facturas) return <span className="text-gris">0</span>;
  return (
    <button type="button" onClick={onVer} aria-label={`Ver las ${p.facturas} facturas de ${p.nombre}`}
      className="inline-flex min-w-8 cursor-pointer items-center justify-center rounded-full border border-borde bg-bg px-2.5 py-0.5 text-[13px] font-bold text-marino transition hover:border-acento hover:bg-acento/20">
      {p.facturas}
    </button>
  );
}

// Muestra la lista de proveedores con sus filtros, su ficha y sus acciones.
export default function Proveedores({ session }) {
  const token = session?.token;
  const puedeEliminar = session?.role === 'superadmin';
  const [items, setItems] = useState(null);
  const [errorLista, setErrorLista] = useState('');
  const [ok, setOk] = useState('');
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState('todos');
  const [nuevo, setNuevo] = useState(null);
  const [editando, setEditando] = useState(null);
  const [viendo, setViendo] = useState(null);
  const [eliminando, setEliminando] = useState(null);
  const [facturas, setFacturas] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    try {
      setItems((await fetchApi(PROVEEDORES_URL, { token })).items);
      setErrorLista('');
    } catch (e) {
      setErrorLista(e.publicMsg || 'No se pudieron cargar los proveedores.');
    }
  }, [token]);
  useEffect(() => { cargar(); }, [cargar]);

  const resumen = useMemo(() => ({
    total: items?.length ?? 0,
    con: (items || []).filter((p) => p.facturas > 0).length,
    incompletos: (items || []).filter(incompleto).length,
  }), [items]);

  const visibles = useMemo(() => {
    const t = sinTildes(q).trim();
    return (items || []).filter((p) => {
      if (filtro === 'con' && !p.facturas) return false;
      if (filtro === 'sin' && p.facturas) return false;
      if (filtro === 'incompletos' && !incompleto(p)) return false;
      return !t || [p.nombre, p.numero_documento, p.contacto, p.correo, p.telefono, p.municipio, p.codigo].some((v) => sinTildes(v).includes(t));
    });
  }, [items, q, filtro]);

  async function guardar(e, metodo, datos, cerrar, mensaje) {
    e.preventDefault();
    setGuardando(true);
    setError('');
    setOk('');
    try {
      const r = await fetchApi(PROVEEDORES_URL, { token, metodo, cuerpo: datos });
      setOk(`Proveedor «${r.item.nombre}» ${mensaje}.`);
      cerrar();
      cargar();
    } catch (err) {
      setError(err.publicMsg || 'No se pudo guardar el proveedor.');
    } finally {
      setGuardando(false);
    }
  }

  const abrirEdicion = (p) => {
    setError('');
    setEditando({
      id: p.id, nombre: p.nombre, tipo_documento: p.tipo_documento || 'NIT', numero_documento: p.numero_documento || '',
      contacto: p.contacto || '', telefono: p.telefono || '', correo: p.correo || '', direccion: p.direccion || '',
      municipio: p.municipio || '', departamento: p.departamento || '',
    });
  };
  async function eliminar() {
    const p = eliminando;
    setEliminando(null);
    setOk('');
    try {
      await fetchApi(PROVEEDORES_URL, { token, metodo: 'DELETE', params: { id: p.id } });
      setErrorLista('');
      setOk(`Proveedor «${p.nombre}» eliminado.`);
      cargar();
    } catch (e) {
      setErrorLista(e.publicMsg || 'No se pudo eliminar el proveedor.');
    }
  }
  const verFacturas = async (p) => {
    try {
      setFacturas({ ...(await fetchApi(`${PROVEEDORES_URL}/facturas`, { token, params: { id: p.id } })), detalle: null });
    } catch (e) { setErrorLista(e.publicMsg || 'No se pudieron cargar las facturas.'); }
  };
  const verFactura = async (f) => {
    try {
      setFacturas({ ...facturas, detalle: await fetchApi(`${API_BASE}/facturas/detalle`, { token, params: { id: f.id } }) });
    } catch (e) { setErrorLista(e.publicMsg || 'No se pudo cargar la factura.'); }
  };
  const cerrarNuevo = useCallback(() => setNuevo(null), []);
  const cerrarEdicion = useCallback(() => setEditando(null), []);
  const cerrarVer = useCallback(() => setViendo(null), []);
  const cerrarFacturas = useCallback(() => setFacturas(null), []);

  const Acciones = ({ p }) => (
    <div className="flex flex-wrap gap-1.5">
      <Btn variant="secondary" className={btnMini} onClick={() => setViendo(p)} aria-label={`Ver a ${p.nombre}`}>Ver</Btn>
      <Btn variant="secondary" className={btnMini} onClick={() => abrirEdicion(p)} aria-label={`Editar a ${p.nombre}`}>Editar</Btn>
      {puedeEliminar && (
        <Btn variant="secondary" className={`${btnMini} !text-rojo-txt`} onClick={() => setEliminando(p)} aria-label={`Eliminar a ${p.nombre}`}>Eliminar</Btn>
      )}
    </div>
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><EncabezadoSeccion titulo="Proveedores" subtitulo="De quién llega la mercancía a las bodegas, con su documento, su contacto y sus facturas" /></div>
        <Btn onClick={() => { setError(''); setNuevo({ ...VACIO }); }}>+ Crear proveedor</Btn>
      </div>
      {ok && <Aviso tono="ok">{ok}</Aviso>}
      {errorLista && <Aviso tono="bad">{errorLista}</Aviso>}

      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3.5">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, documento, contacto, correo o municipio…"
          aria-label="Buscar proveedores" className="min-w-[220px] flex-1 rounded-lg border border-borde bg-card px-3 py-2 text-[13px] outline-none focus:border-acento" />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar proveedores">
          {FILTROS.map(([id, nombre]) => (
            <button key={id} type="button" onClick={() => setFiltro(id)} aria-pressed={filtro === id}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${filtro === id ? 'border-marino bg-marino text-white' : 'border-borde bg-card text-gris hover:text-texto'}`}>
              {nombre}
            </button>
          ))}
        </div>
      </Card>

      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <Chip>{resumen.total} proveedores</Chip>
        <Chip tono="ok">{resumen.con} con facturas</Chip>
        {resumen.incompletos > 0 && <Chip tono="warn">{resumen.incompletos} con datos incompletos</Chip>}
        {(q || filtro !== 'todos') && <Chip>{visibles.length} coinciden</Chip>}
      </div>

      {!items && !errorLista && <Spinner texto="Cargando proveedores…" />}
      {items && !items.length && (
        <Card className="p-8 text-center text-[13px] text-gris">Todavía no hay proveedores. Crea el primero con el botón «Crear proveedor».</Card>
      )}
      {items?.length > 0 && !visibles.length && (
        <Card className="p-8 text-center text-[13px] text-gris">Ningún proveedor coincide con la búsqueda.</Card>
      )}

      {visibles.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
            {visibles.map((p) => (
              <Card key={p.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-marino">{p.nombre}</div>
                    <div className="text-xs text-gris">{documento(p) || 'Sin documento'}</div>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-gris">Facturas <ContadorFacturas p={p} onVer={() => verFacturas(p)} /></div>
                </div>
                <div className="mt-2 text-[13px]">
                  {p.contacto || <span className="text-gris">Sin contacto</span>}{p.telefono && ` · ${p.telefono}`}
                  {p.correo && <div className="break-all text-gris">{p.correo}</div>}
                </div>
                {incompleto(p) && <div className="mt-2"><Chip tono="warn">Datos incompletos</Chip></div>}
                <div className="mt-3"><Acciones p={p} /></div>
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-x-auto lg:block">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-borde bg-bg text-[11px] font-bold uppercase tracking-wide text-gris">
                  <th className="px-4 py-2.5">Proveedor</th><th className="px-3 py-2.5">Documento</th><th className="px-3 py-2.5">Contacto</th>
                  <th className="px-3 py-2.5">Ubicación</th><th className="px-3 py-2.5 text-center">Facturas</th><th className="px-4 py-2.5">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((p) => (
                  <tr key={p.id} className="border-b border-borde align-top last:border-0 hover:bg-bg/60">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-marino">{p.nombre}</div>
                      {incompleto(p) && <div className="mt-1"><Chip tono="warn">Datos incompletos</Chip></div>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">{documento(p) || <span className="text-gris">Sin documento</span>}</td>
                    <td className="px-3 py-3">
                      {p.contacto || <span className="text-gris">Sin contacto</span>}
                      {p.telefono && <div>{p.telefono}</div>}
                      {p.correo && <div className="break-all text-gris">{p.correo}</div>}
                    </td>
                    <td className="px-3 py-3 text-gris">{[p.municipio, p.departamento].filter(Boolean).join(', ') || '—'}</td>
                    <td className="px-3 py-3 text-center"><ContadorFacturas p={p} onVer={() => verFacturas(p)} /></td>
                    <td className="whitespace-nowrap px-4 py-3"><Acciones p={p} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {nuevo && (
        <Ventana titulo="Crear proveedor" onCerrar={cerrarNuevo}>
          <Formulario form={nuevo} setForm={setNuevo} guardando={guardando} error={error} textoBoton="Guardar proveedor"
            onEnviar={(e) => guardar(e, 'POST', nuevo, cerrarNuevo, 'agregado')} />
        </Ventana>
      )}
      {editando && (
        <Ventana titulo={`Editar a ${editando.nombre}`} onCerrar={cerrarEdicion}>
          <Formulario form={editando} setForm={setEditando} guardando={guardando} error={error} textoBoton="Guardar cambios"
            onEnviar={(e) => guardar(e, 'PUT', editando, cerrarEdicion, 'actualizado')} />
        </Ventana>
      )}
      {viendo && (
        <Ventana titulo={viendo.nombre} subtitulo={documento(viendo) || 'Sin documento'} onCerrar={cerrarVer}>
          <dl className="grid gap-2 sm:grid-cols-2">
            <Dato etiqueta="Documento">{documento(viendo)}</Dato>
            <Dato etiqueta="Código interno">{viendo.codigo}</Dato>
            <Dato etiqueta="Persona de contacto">{viendo.contacto}</Dato>
            <Dato etiqueta="Teléfono">{viendo.telefono}</Dato>
            <Dato etiqueta="Correo">{viendo.correo}</Dato>
            <Dato etiqueta="Dirección">{viendo.direccion}</Dato>
            <Dato etiqueta="Municipio">{[viendo.municipio, viendo.departamento].filter(Boolean).join(', ')}</Dato>
            <Dato etiqueta="Facturas registradas">{String(viendo.facturas)}</Dato>
          </dl>
          {incompleto(viendo) && <Aviso className="mt-3">A este proveedor le faltan datos. Edítalo para completarlos.</Aviso>}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {viendo.facturas > 0 && <Btn variant="secondary" onClick={() => { verFacturas(viendo); setViendo(null); }}>Ver sus facturas</Btn>}
            {puedeEliminar && <Btn variant="secondary" className="!text-rojo-txt" onClick={() => { setEliminando(viendo); setViendo(null); }}>Eliminar</Btn>}
            <Btn onClick={() => { abrirEdicion(viendo); setViendo(null); }}>Editar</Btn>
          </div>
        </Ventana>
      )}
      <Confirmar
        abierto={!!eliminando}
        titulo="¿Eliminar este proveedor?"
        texto={eliminando ? `Se eliminará «${eliminando.nombre}». Si ya tiene facturas, artículos o recepciones, el sistema no lo permitirá.` : ''}
        etiquetaOk="Sí, eliminar"
        onOk={eliminar}
        onCancelar={() => setEliminando(null)}
      />
      {facturas && (
        <Ventana titulo={`Facturas de ${facturas.proveedor.nombre}`} subtitulo={`${facturas.facturas.length} registradas`} onCerrar={cerrarFacturas} ancho="max-w-4xl">
          {!facturas.detalle && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead><tr className="text-[11px] font-bold uppercase tracking-wide text-gris"><th className="py-1.5 pr-3">Factura</th><th className="py-1.5 pr-3">Fecha</th><th className="py-1.5 pr-3">Líneas</th><th className="py-1.5 text-right">Total</th></tr></thead>
                  <tbody>
                    {facturas.facturas.map((f) => (
                      <tr key={f.id} className="border-t border-borde">
                        <td className="py-2 pr-3"><button type="button" onClick={() => verFactura(f)} className="font-semibold text-marino underline decoration-dotted underline-offset-2 hover:text-acento-txt">{f.numero}</button></td>
                        <td className="py-2 pr-3">{dia(f.fecha)}</td><td className="py-2 pr-3">{f.lineas}</td><td className="py-2 text-right font-semibold">{pesos(f.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 border-t border-borde pt-3 text-right text-[14px]">
                Total facturado: <strong>{pesos(facturas.facturas.reduce((s, f) => s + Number(f.total || 0), 0))}</strong>
              </p>
            </>
          )}
          {facturas.detalle && (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <Btn variant="secondary" className={btnMini} onClick={() => setFacturas({ ...facturas, detalle: null })}>← Volver a las facturas</Btn>
                <span className="text-[13px] text-gris">
                  Factura <strong className="text-texto">{facturas.detalle.factura.numero}</strong> · {dia(facturas.detalle.factura.fecha)}{facturas.detalle.factura.vencimiento ? ` · vence ${dia(facturas.detalle.factura.vencimiento)}` : ''} · registrada por {facturas.detalle.factura.creado_por || '—'}
                  {facturas.detalle.factura.tiene_adjunto && (
                    <> · <a className="font-semibold text-marino underline" href={`${API_BASE}/facturas/adjunto?id=${facturas.detalle.factura.id}`} target="_blank" rel="noreferrer">Ver PDF</a></>
                  )}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="text-[11px] font-bold uppercase tracking-wide text-gris">
                      <th className="py-1.5 pr-3">Nombre</th><th className="py-1.5 pr-3">Descripción</th><th className="py-1.5 pr-3">SKU</th><th className="py-1.5 pr-3 text-right">Cant.</th>
                      <th className="py-1.5 pr-3 text-right">V. unitario</th><th className="py-1.5 pr-3 text-right">Impuesto</th><th className="py-1.5 pr-3 text-right">Total</th><th className="py-1.5">Bodega</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facturas.detalle.items.map((i) => (
                      <tr key={i.id} className="border-t border-borde align-top">
                        <td className="py-2 pr-3 font-semibold">{i.nombre}</td><td className="py-2 pr-3 text-gris">{i.descripcion || '—'}</td><td className="py-2 pr-3">{i.sku}</td>
                        <td className="py-2 pr-3 text-right">{i.cantidad}</td><td className="py-2 pr-3 text-right">{pesos(i.valor_unitario)}</td><td className="py-2 pr-3 text-right">{pesos(i.valor_impuesto)}</td>
                        <td className="py-2 pr-3 text-right font-semibold">{pesos(i.total)}</td><td className="py-2">{i.bodega}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 border-t border-borde pt-3 text-right text-[15px]">Total de la factura: <strong>{pesos(facturas.detalle.factura.total)}</strong></p>
            </>
          )}
        </Ventana>
      )}
    </>
  );
}
