// Asociados de la unidad productiva, dentro de la primera visita y de la ficha. Muestra el total frente al
// mínimo de la modalidad, directos e indirectos, el perfil sociodemográfico, los retirados y las actas de
// novedades. Lo que cada usuario puede hacer lo dice el servidor y lo vuelve a exigir en cada petición.
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Pencil, Trash2, UserPlus, Users } from 'lucide-react';
import { apiGeneral } from '../inventario/lib/api';
import {
  Alerta, AreaTexto, Boton, Campo, Cargando, Celda, Confirmar, Dialogo, Entrada, Fila, Insignia, Seleccion, Tabla,
  useAvisos,
} from '../inventario/componentes/ui';
import DescargaFormato from './DescargaFormato';
import { urlArchivo } from '../lib/api';
import {
  activosTrasActa, armarActa, asociadoAFormulario, asociadoVacio, avisoMinimo, bloquesPerfil, cargarListasAsociados,
  erroresAsociado, fechaLegible, formularioAAsociado, hoyISO, pedirAsociados, problemasActa,
} from '../lib/asociados';

// Devuelve el nombre de un código dentro de una lista, o el mismo código.
const nombreDe = (lista, codigo) => (lista || []).find((x) => x.codigo === codigo)?.nombre || codigo || '—';

// Componente principal; avisa al que lo contiene el total frente al mínimo mediante onEstado, para el botón de
// cierre de la visita.
export default function AsociadosUP({ idUnico, onEstado }) {
  const { avisar } = useAvisos();
  const [datos, setDatos] = useState(null);
  const [listas, setListas] = useState(null);
  const [errorListas, setErrorListas] = useState('');
  const [error, setError] = useState('');
  const [editando, setEditando] = useState(null);
  const [quitando, setQuitando] = useState(null);
  const [acta, setActa] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const recargar = useCallback(async (trasEscribir = false) => {
    try {
      setDatos(await pedirAsociados(idUnico));
      setError('');
    } catch (err) {
      if (trasEscribir) avisar(`Se guardó, pero no se pudo actualizar la lista: ${err.message}`, 'error');
      else setError(err.message || 'No se pudieron cargar los asociados.');
    }
  }, [idUnico, avisar]);

  const pedirListas = useCallback(() => {
    setErrorListas('');
    cargarListasAsociados().then(setListas).catch((err) => setErrorListas(err.message || 'No se pudieron cargar las listas del formulario.'));
  }, []);

  useEffect(() => {
    setDatos(null);
    recargar();
    pedirListas();
  }, [recargar, pedirListas]);

  const avisarEstado = useRef(onEstado);
  avisarEstado.current = onEstado;
  useEffect(() => { if (datos) avisarEstado.current?.(datos.resumen); }, [datos]);

  const escribir = async (fn, exito) => {
    setOcupado(true);
    try {
      await fn();
      avisar(exito);
      await recargar(true);
      return true;
    } catch (err) {
      avisar(err.message, 'error');
      return false;
    } finally {
      setOcupado(false);
    }
  };

  if (error) {
    return (
      <Alerta tono="error">
        {error} <button type="button" className="font-semibold underline" onClick={() => recargar()}>Reintentar</button>
      </Alerta>
    );
  }
  if (!datos) return <Cargando texto="Cargando asociados" />;

  const { resumen: r } = datos;
  const activos = datos.asociados.filter((a) => a.activo);
  const retirados = datos.asociados.filter((a) => !a.activo);
  const minimo = avisoMinimo(r);

  const guardar = (f) => escribir(
    () => apiGeneral.post('/asociados', { id_unico: idUnico, asociado: formularioAAsociado(f) }),
    f.id ? 'Datos del asociado corregidos.' : 'Asociado registrado.',
  ).then((ok) => ok && setEditando(null));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Dato etiqueta="Asociados activos" valor={r.total} />
        <Dato etiqueta={`Mínimo ${r.modalidad || ''}`.trim()} valor={r.minimo ?? 'No aplica'} />
        <Dato etiqueta="Beneficiarios directos" valor={r.directos} />
        <Dato etiqueta="Beneficiarios indirectos" valor={r.indirectos} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Insignia tono={minimo.tono} ajustar>{minimo.texto}</Insignia>
        {!r.con_representante && r.total > 0 && <Insignia tono="alerta">Falta marcar al representante</Insignia>}
      </div>
      {datos.visita1_cerrada && (
        <Alerta tono="info">
          La Visita 1 ya está cerrada: los ingresos y retiros de asociados se registran con el acta de novedades firmada.
          Los datos de un asociado activo se pueden corregir, menos la cédula.
        </Alerta>
      )}

      {errorListas && (
        <Alerta tono="error">
          {errorListas} Sin ellas no se pueden registrar asociados.{' '}
          <button type="button" className="font-semibold underline" onClick={pedirListas}>Reintentar</button>
        </Alerta>
      )}
      {(datos.puede_registrar || (datos.puede_registrar_acta && datos.visita1_cerrada)) && (
        <div className="flex flex-wrap gap-2">
          {datos.puede_registrar && (
            <Boton tamano="sm" icono={UserPlus} disabled={!listas} onClick={() => setEditando(asociadoVacio())}>Agregar asociado</Boton>
          )}
          {datos.puede_registrar_acta && datos.visita1_cerrada && (
            <Boton tamano="sm" variante="fantasma" icono={FileText} disabled={!listas} onClick={() => setActa(true)}>Registrar acta de novedades</Boton>
          )}
          {datos.puede_registrar_acta && datos.visita1_cerrada && <DescargaFormato nombre="Acta de Novedades" etiqueta="Descargar formato del acta" />}
        </div>
      )}

      <Tabla
        cabeceras={['Nombre', 'Cédula', 'Teléfono', 'Tipo', 'Sexo', ...(datos.puede_corregir ? [''] : [])]}
        vacio="Aún no hay asociados registrados." iconoVacio={Users}
      >
        {activos.map((a) => (
          <Fila key={a.id}>
            <Celda>
              <span className="font-semibold text-marca">{a.nombre}</span>
              {a.es_representante && <span className="ml-2"><Insignia tono="ok">Representante</Insignia></span>}
            </Celda>
            <Celda><span className="cifras">{a.documento}</span></Celda>
            <Celda><span className="cifras">{a.telefono}</span></Celda>
            <Celda>{a.tipo === 'indirecto' ? 'Indirecto' : 'Directo'}</Celda>
            <Celda>{nombreDe(listas?.sexos, a.sexo)}</Celda>
            {datos.puede_corregir && (
              <Celda alinear="derecha">
                <div className="flex flex-wrap justify-end gap-1.5">
                  <Boton tamano="sm" variante="fantasma" icono={Pencil} onClick={() => setEditando(asociadoAFormulario(a))}>Corregir</Boton>
                  {datos.puede_registrar && (
                    <Boton tamano="sm" variante="peligro" icono={Trash2} onClick={() => setQuitando(a)}>Quitar</Boton>
                  )}
                </div>
              </Celda>
            )}
          </Fila>
        ))}
      </Tabla>

      {r.total > 0 && <Perfil bloques={bloquesPerfil(r.perfil, listas)} />}

      {retirados.length > 0 && (
        <details className="rounded-xl border border-borde p-3.5">
          <summary className="cursor-pointer text-[13px] font-semibold text-marca">Retirados ({retirados.length})</summary>
          <ul className="mt-2.5 flex flex-col gap-1.5 text-[13px] text-gris-txt">
            {retirados.map((a) => (
              <li key={a.id}>
                <b className="text-marca">{a.nombre}</b> · <span className="cifras">{a.documento}</span>
                {a.fecha_retiro && <> · {fechaLegible(a.fecha_retiro)}</>}
                {a.motivo_retiro && <> · {a.motivo_retiro}</>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {datos.actas.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-semibold text-marca">Actas de novedades</p>
          <ul className="flex flex-col gap-2">
            {datos.actas.map((x) => (
              <li key={x.id} className="rounded-xl border border-borde p-3 text-[13px] text-gris-txt">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><b className="text-marca">{fechaLegible(x.fecha)}</b> · {x.ingresos.length} ingreso(s), {x.retiros.length} retiro(s) · quedan {x.activos_despues}</span>
                  {x.acta_url && (
                    <a className="font-semibold text-marca underline" href={urlArchivo(x.acta_url)} target="_blank" rel="noopener noreferrer">Ver acta</a>
                  )}
                </div>
                <p className="mt-1 break-words">{x.motivo}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialogo abierto={Boolean(editando)} titulo={editando?.id ? 'Corregir asociado' : 'Agregar asociado'}
        onCerrar={() => !ocupado && setEditando(null)} ancho="max-w-2xl">
        {editando && (
          <FormAsociado inicial={editando} listas={listas} ocupado={ocupado}
            bloquearCedula={Boolean(editando.id) && datos.visita1_cerrada}
            onGuardar={guardar} onCancelar={() => setEditando(null)} />
        )}
      </Dialogo>

      <Confirmar
        abierto={Boolean(quitando)}
        titulo="Quitar asociado"
        texto={quitando ? `¿Quitar a ${quitando.nombre} de los asociados? Úsalo solo si se registró por error.` : ''}
        etiquetaOk="Quitar"
        onCancelar={() => setQuitando(null)}
        onOk={() => {
          const id = quitando?.id;
          setQuitando(null);
          if (id && !ocupado) escribir(() => apiGeneral.post('/asociados/quitar', { id_unico: idUnico, id }), 'Asociado quitado.');
        }}
      />

      <Dialogo abierto={acta} titulo="Acta de novedades de asociados" onCerrar={() => !ocupado && setActa(false)} ancho="max-w-3xl">
        {acta && (
          <FormActa activos={activos} resumen={r} listas={listas} ocupado={ocupado} onCancelar={() => setActa(false)}
            onGuardar={(x) => escribir(
              () => apiGeneral.post('/asociados/acta', armarActa(idUnico, x)), 'Acta de novedades registrada.',
            ).then((ok) => ok && setActa(false))} />
        )}
      </Dialogo>
    </div>
  );
}

// Muestra una cifra con su etiqueta.
function Dato({ etiqueta, valor }) {
  return (
    <div className="rounded-xl border border-borde bg-lienzo/60 p-3">
      <div className="text-[12px] font-medium text-gris-txt">{etiqueta}</div>
      <div className="cifras mt-1 text-[20px] font-semibold text-marca">{valor}</div>
    </div>
  );
}

// Muestra el perfil sociodemográfico por bloques.
function Perfil({ bloques }) {
  return (
    <div>
      <p className="mb-2 text-[13px] font-semibold text-marca">Perfil sociodemográfico</p>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {bloques.map((b) => (
          <div key={b.titulo} className="rounded-xl border border-borde p-3">
            <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-gris">{b.titulo}</div>
            <ul className="flex flex-col gap-1 text-[13px]">
              {b.filas.map((f) => (
                <li key={f.nombre} className="flex justify-between gap-3 text-gris-txt">
                  <span>{f.nombre}</span><span className="cifras font-semibold text-marca">{f.n}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// Campos de un asociado, que usan el formulario directo, cada ingreso del acta y la persona que entra en un
// reemplazo.
export function CamposAsociado({ f, set, listas, errores = {}, bloquearCedula = false }) {
  const cambiar = (campo) => (e) => set({ ...f, [campo]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const opciones = (lista) => (lista || []).map((x) => <option key={x.codigo} value={x.codigo}>{x.nombre}</option>);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Campo etiqueta="Nombre completo" obligatorio error={errores.nombre} className="sm:col-span-2">
        <Entrada value={f.nombre} maxLength={200} autoComplete="off" aria-invalid={Boolean(errores.nombre)} onChange={cambiar('nombre')} />
      </Campo>
      <Campo etiqueta="Cédula" obligatorio error={errores.documento}
        ayuda={bloquearCedula ? 'Después de cerrar la Visita 1 la cédula no se cambia.' : undefined}>
        <Entrada value={f.documento} inputMode="numeric" maxLength={15} disabled={bloquearCedula}
          aria-invalid={Boolean(errores.documento)} onChange={cambiar('documento')} />
      </Campo>
      <Campo etiqueta="Teléfono" obligatorio error={errores.telefono}>
        <Entrada value={f.telefono} type="tel" inputMode="tel" maxLength={20} aria-invalid={Boolean(errores.telefono)} onChange={cambiar('telefono')} />
      </Campo>
      <Campo etiqueta="Sexo" obligatorio error={errores.sexo}>
        <Seleccion value={f.sexo} aria-invalid={Boolean(errores.sexo)} onChange={cambiar('sexo')}>
          <option value="">Elige…</option>{opciones(listas?.sexos)}
        </Seleccion>
      </Campo>
      <Campo etiqueta="Tipo de beneficiario">
        <Seleccion value={f.tipo} onChange={cambiar('tipo')}>{opciones(listas?.tipos)}</Seleccion>
      </Campo>
      <Campo etiqueta="Fecha de nacimiento" error={errores.fecha_nacimiento}>
        <Entrada type="date" value={f.fecha_nacimiento} max={hoyISO()} aria-invalid={Boolean(errores.fecha_nacimiento)} onChange={cambiar('fecha_nacimiento')} />
      </Campo>
      <Campo etiqueta="Pertenencia étnica">
        <Seleccion value={f.pertenencia_etnica} onChange={cambiar('pertenencia_etnica')}>
          <option value="">Sin dato</option>{opciones(listas?.etnias)}
        </Seleccion>
      </Campo>
      <Campo etiqueta="Nivel educativo">
        <Seleccion value={f.nivel_educativo} onChange={cambiar('nivel_educativo')}>
          <option value="">Sin dato</option>{opciones(listas?.niveles_educativos)}
        </Seleccion>
      </Campo>
      <Campo etiqueta="Zona">
        <Seleccion value={f.zona} onChange={cambiar('zona')}>
          <option value="">Sin dato</option>{opciones(listas?.zonas)}
        </Seleccion>
      </Campo>
      <Campo etiqueta="Discapacidad">
        <Seleccion value={f.discapacidad} onChange={cambiar('discapacidad')}>
          <option value="">Sin dato</option><option value="si">Sí</option><option value="no">No</option>
        </Seleccion>
      </Campo>
      <Campo etiqueta="Víctima del conflicto">
        <Seleccion value={f.victima} onChange={cambiar('victima')}>
          <option value="">Sin dato</option><option value="si">Sí</option><option value="no">No</option>
        </Seleccion>
      </Campo>
      <label className="flex items-center gap-2 text-[13px] font-semibold text-gris-txt sm:col-span-2">
        <input type="checkbox" className="size-4 accent-[var(--color-acento)]" checked={f.es_representante} onChange={cambiar('es_representante')} />
        Es el representante de la unidad
      </label>
    </div>
  );
}

// Formulario para registrar o corregir un asociado.
function FormAsociado({ inicial, listas, ocupado, bloquearCedula, onGuardar, onCancelar }) {
  const [f, setF] = useState(inicial);
  const [intento, setIntento] = useState(false);
  const errores = intento ? erroresAsociado(f) : {};
  const enviar = (e) => {
    e.preventDefault();
    setIntento(true);
    if (Object.keys(erroresAsociado(f)).length) return;
    onGuardar(f);
  };
  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
      <CamposAsociado f={f} set={setF} listas={listas} errores={errores} bloquearCedula={bloquearCedula} />
      <div className="flex flex-wrap justify-end gap-2">
        <Boton variante="fantasma" onClick={onCancelar} disabled={ocupado}>Cancelar</Boton>
        <Boton tipo="submit" cargando={ocupado}>{inicial.id ? 'Guardar corrección' : 'Registrar asociado'}</Boton>
      </div>
    </form>
  );
}

// Formulario del acta de novedades con ingresos, retiros y archivo firmado.
function FormActa({ activos, resumen, listas, ocupado, onGuardar, onCancelar }) {
  const [fecha, setFecha] = useState(hoyISO());
  const [motivo, setMotivo] = useState('');
  const [retiros, setRetiros] = useState([]);
  const [ingresos, setIngresos] = useState([]);
  const [archivo, setArchivo] = useState(null);
  const [intento, setIntento] = useState(false);

  const x = { fecha, motivo, ingresos, retiros, archivo };
  const problemas = problemasActa(x, resumen);
  const despues = activosTrasActa(resumen.total, ingresos, retiros);
  const aviso = avisoMinimo(resumen, despues);
  const retirado = (id) => retiros.find((r) => r.id === id);
  const alternarRetiro = (id) => setRetiros((rs) => (rs.some((r) => r.id === id) ? rs.filter((r) => r.id !== id) : [...rs, { id, motivo: '' }]));

  const enviar = (e) => {
    e.preventDefault();
    setIntento(true);
    if (!problemas.length) onGuardar(x);
  };

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
        <Campo etiqueta="Fecha del acta" obligatorio>
          <Entrada type="date" value={fecha} max={hoyISO()} onChange={(e) => setFecha(e.target.value)} />
        </Campo>
        <Campo etiqueta="Motivo" obligatorio>
          <AreaTexto rows={2} maxLength={2000} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </Campo>
      </div>

      <fieldset className="flex flex-col gap-2 rounded-xl border border-borde p-3.5">
        <legend className="px-1 text-[13px] font-semibold text-marca">Retiros</legend>
        {activos.length === 0 && <p className="text-[13px] text-gris">No hay asociados activos.</p>}
        {activos.map((a) => (
          <div key={a.id} className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-[13px] text-gris-txt">
              <input type="checkbox" className="size-4 accent-[var(--color-acento)]" checked={Boolean(retirado(a.id))} onChange={() => alternarRetiro(a.id)} />
              <span><b className="text-marca">{a.nombre}</b> · <span className="cifras">{a.documento}</span></span>
            </label>
            {retirado(a.id) && (
              <Entrada placeholder="Motivo del retiro (opcional)" maxLength={500} value={retirado(a.id).motivo}
                onChange={(e) => setRetiros((rs) => rs.map((r) => (r.id === a.id ? { ...r, motivo: e.target.value } : r)))} />
            )}
          </div>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-xl border border-borde p-3.5">
        <legend className="px-1 text-[13px] font-semibold text-marca">Ingresos</legend>
        {ingresos.map((f, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-lg bg-lienzo/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-marca">Ingreso {i + 1}</span>
              <Boton tamano="sm" variante="fantasma" icono={Trash2} onClick={() => setIngresos((xs) => xs.filter((_, k) => k !== i))}>Quitar</Boton>
            </div>
            <CamposAsociado f={f} listas={listas} errores={intento ? erroresAsociado(f) : {}}
              set={(nuevo) => setIngresos((xs) => xs.map((y, k) => (k === i ? nuevo : y)))} />
          </div>
        ))}
        <div>
          <Boton tamano="sm" variante="fantasma" icono={UserPlus} onClick={() => setIngresos((xs) => [...xs, asociadoVacio()])}>Agregar ingreso</Boton>
        </div>
      </fieldset>

      <Campo etiqueta="Acta firmada (PDF)" obligatorio>
        <input type="file" accept=".pdf,application/pdf" className="text-[13px] text-gris-txt"
          onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
      </Campo>

      {aviso && <Insignia tono={aviso.tono} ajustar>Después del acta: {aviso.texto}</Insignia>}
      {intento && problemas.length > 0 && (
        <Alerta tono="error">
          <ul className="list-disc pl-4">{problemas.map((p) => <li key={p}>{p}</li>)}</ul>
        </Alerta>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Boton variante="fantasma" onClick={onCancelar} disabled={ocupado}>Cancelar</Boton>
        <Boton tipo="submit" cargando={ocupado}>Registrar acta</Boton>
      </div>
    </form>
  );
}
