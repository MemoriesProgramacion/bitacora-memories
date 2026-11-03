// Carrito de una iniciativa: sus productos, cuánto lleva del presupuesto, los totales y lo que cada tipo de
// cuenta puede hacer: quien atiende la unidad lo envía y la coordinación define el presupuesto, lo aprueba o lo
// devuelve. También muestra lo que pide el anexo para capitalizar, como la actividad financiable, la
// clasificación de cada producto, la tenencia de la sede y la justificación de los equipos de cómputo; el
// servidor lo vuelve a validar.
import { useEffect, useState } from 'react';
import { Check, Home, Minus, Plus, Send, Trash2, Undo2 } from 'lucide-react';
import { pesos } from '../../inventario/lib/api';
import {
  Alerta, AreaTexto, Boton, Campo, Confirmar, Cargando, Dialogo, Entrada, Insignia, Seleccion, Tarjeta, Vacio,
} from '../../inventario/componentes/ui';
import { ESTADOS_CARRITO, consumo, problemasPara, textoSubsanacion, textoTransporte } from '../../lib/carrito';
import { cargarListas, guiaTenencia, tenenciaPideAnios } from '../../lib/clasificacion';

// Muestra la tenencia de la sede, que ven todos y registran quienes tienen permiso con su certificación.
function TenenciaSede({ clasificacion, carrito }) {
  const actual = clasificacion.tenencia;
  const [tenencias, setTenencias] = useState([]);
  const [abierto, setAbierto] = useState(false);
  const [f, setF] = useState({ tipo: '', anios: '', archivo: null });
  useEffect(() => { cargarListas().then((l) => setTenencias(l.tenencias)).catch(() => {}); }, []);
  const abrir = () => { setF({ tipo: actual?.tipo || '', anios: actual?.anios ?? '', archivo: null }); setAbierto(true); };
  const cerrar = () => { setF({ tipo: '', anios: '', archivo: null }); setAbierto(false); };

  const pideAnios = tenenciaPideAnios(tenencias, f.tipo);
  const guia = guiaTenencia(tenencias, f.tipo, f.anios, Boolean(f.archivo || actual?.soporte));
  const guardar = async () => {
    const r = await carrito.tenencia({ tipo: f.tipo, anios: pideAnios ? f.anios : '', archivo: f.archivo });
    if (r) cerrar();
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-borde p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-marca">
          <Home size={15} aria-hidden="true" /> Tenencia de la sede
        </div>
        {actual ? (
          <Insignia tono={actual.habilita_adecuaciones ? 'ok' : 'alerta'}>
            {actual.habilita_adecuaciones ? 'Habilita adecuaciones' : 'No habilita adecuaciones'}
          </Insignia>
        ) : <Insignia>Sin registrar</Insignia>}
      </div>
      {actual && (
        <div className="text-[12px] text-gris-txt">
          {actual.tipo_nombre}{actual.anios != null ? ` · ${actual.anios} años` : ''}
          {actual.soporte_url && (
            <> · <a className="font-semibold text-marca underline" href={`/api${actual.soporte_url}`} target="_blank" rel="noopener noreferrer">Ver certificación</a></>
          )}
        </div>
      )}
      {clasificacion.puede_registrar_tenencia && !abierto && (
        <div>
          <Boton tamano="sm" variante="fantasma" onClick={abrir}>
            {actual ? 'Actualizar tenencia' : 'Registrar tenencia'}
          </Boton>
        </div>
      )}
      {abierto && (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Tipo de tenencia">
              <Seleccion value={f.tipo} onChange={(e) => setF((x) => ({ ...x, tipo: e.target.value }))}>
                <option value="">Elige…</option>
                {tenencias.map((t) => <option key={t.codigo} value={t.codigo}>{t.nombre}</option>)}
              </Seleccion>
            </Campo>
            {pideAnios && (
              <Campo etiqueta="Años del contrato">
                <Entrada type="number" min="0" max="99" step="0.5" inputMode="decimal" value={f.anios}
                  onChange={(e) => setF((x) => ({ ...x, anios: e.target.value }))} />
              </Campo>
            )}
          </div>
          <Campo etiqueta="Certificación de tenencia, comodato o arriendo"
            ayuda={actual?.soporte ? 'Opcional: ya hay una cargada.' : 'PDF, JPG o PNG.'}>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="text-[13px] text-gris-txt"
              onChange={(e) => setF((x) => ({ ...x, archivo: e.target.files?.[0] || null }))} />
          </Campo>
          <p className={`text-[12px] font-semibold ${guia.habilita ? 'text-ok-txt' : 'text-gris-txt'}`}>{guia.texto}</p>
          <div className="flex flex-wrap gap-2">
            <Boton tamano="sm" icono={Check} cargando={carrito.ocupado} disabled={!f.tipo} onClick={guardar}>Guardar tenencia</Boton>
            <Boton tamano="sm" variante="fantasma" onClick={cerrar}>Cancelar</Boton>
          </div>
        </div>
      )}
    </div>
  );
}

// Campo de justificación de una línea de equipo de cómputo, que se guarda al salir del campo.
function Justificacion({ linea, editable, carrito }) {
  const [texto, setTexto] = useState(linea.justificacion || '');
  useEffect(() => { setTexto(linea.justificacion || ''); }, [linea.justificacion]);
  return (
    <Campo etiqueta="Justificación del equipo de cómputo"
      ayuda={editable ? 'Para qué lo necesita la iniciativa. Sin ella el plan no se envía.' : undefined}>
      <AreaTexto rows={2} maxLength={2000} value={texto} disabled={!editable}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={() => texto !== (linea.justificacion || '') && carrito.justificar(linea.id, texto)} />
    </Campo>
  );
}

// Muestra una fila de las cuentas: subtotal, IVA o total.
function Fila({ etiqueta, valor, fuerte, tono }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${fuerte ? 'text-[15px] font-bold text-marca' : 'text-[13px] text-gris-txt'}`}>
      <span>{etiqueta}</span>
      <span className={`cifras ${tono || ''}`}>{valor}</span>
    </div>
  );
}

// Muestra el carrito con sus líneas, cuentas, estado y acciones.
export default function PanelCarrito({ carrito }) {
  const { vista, cargando, ocupado } = carrito;
  const [vaciando, setVaciando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [devolviendo, setDevolviendo] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [objetivo, setObjetivo] = useState('');
  const [montos, setMontos] = useState({ presupuesto: '', transporte: '', descuenta: false });

  const guardado = vista?.carrito;
  useEffect(() => {
    if (guardado) setObjetivo(guardado.objetivo_plan || '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardado?.id_unico, guardado?.objetivo_plan]);
  useEffect(() => {
    if (!guardado) return;
    setMontos({
      presupuesto: guardado.presupuesto_maximo ?? '',
      transporte: guardado.monto_transporte || '',
      descuenta: guardado.transporte_descontado,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardado?.id_unico, guardado?.presupuesto_maximo, guardado?.monto_transporte, guardado?.transporte_descontado]);

  if (cargando && !vista) return <Tarjeta titulo="Carrito"><Cargando /></Tarjeta>;
  if (!vista) return null;

  const { carrito: c, lineas, resumen: r, clasificacion: cl } = vista;
  const problemas = problemasPara(cl, c.puede_resolver || c.puede_enviar_subsanacion ? 'aprobar' : 'enviar');
  const m1 = r.modalidad === 'M1';
  const estado = ESTADOS_CARRITO[c.estado];
  const { pct, color } = consumo(r);

  const guardarMontos = () => carrito.datos({
    presupuesto_maximo: montos.presupuesto === '' ? null : Number(montos.presupuesto),
    monto_transporte: montos.transporte === '' ? null : Number(montos.transporte),
    transporte_descontado: montos.descuenta,
  }, 'Presupuesto guardado.');

  return (
    <Tarjeta
      titulo={`Carrito (${lineas.length})`}
      acciones={<Insignia tono={estado.tono}>{estado.texto}</Insignia>}
    >
      <div className="flex flex-col gap-4">
        <div>
          <div className="truncate font-semibold text-marca">{c.nombre_up || `Iniciativa ${c.id_unico}`}</div>
          <div className="text-[12px] text-gris-txt">{c.id_unico}{c.nodo ? ` · ${c.nodo}` : ''}</div>
        </div>

        {r.presupuesto_productos !== null ? (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
              <span className="text-gris-txt">Presupuesto para productos</span>
              <span className="cifras font-semibold text-marca">{pesos(r.presupuesto_productos)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-lienzo" role="progressbar"
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)} aria-label="Presupuesto gastado">
              <div className="graf-barra h-full rounded-full" style={{ width: `${Math.min(100, pct * 100)}%`, background: color }} />
            </div>
            <div className={`mt-1.5 text-[12px] font-semibold ${r.excede ? 'text-rojo-txt' : 'text-gris-txt'}`}>
              {r.excede ? `Se pasa por ${pesos(-r.saldo)}` : `Quedan ${pesos(r.saldo)} (${Math.round((1 - pct) * 100)} %)`}
            </div>
          </div>
        ) : (
          <Alerta tono="info">
            La unidad no tiene modalidad registrada: sin ella no hay tope de capitalización y el plan no se envía.
          </Alerta>
        )}
        {r.tope_modalidad != null && (
          <p className="-mt-2 text-[12px] text-gris-txt">
            Tope de la modalidad {r.modalidad}: <span className="cifras">{pesos(r.tope_modalidad)}</span> · {textoTransporte(r, c)}
          </p>
        )}

        {cl?.actividad_no_financiable && (
          <Alerta tono="error">
            La actividad de esta unidad no es financiable ({cl.actividad_no_financiable_nombre}): no se puede capitalizar.
          </Alerta>
        )}

        {c.estado === 'devuelto' && (
          <Alerta tono="error">La coordinación devolvió este carrito. Corrígelo y vuelve a enviarlo.</Alerta>
        )}

        {lineas.length === 0 ? (
          <Vacio icono={Plus}>El carrito está vacío. Agrega productos del catálogo.</Vacio>
        ) : (
          <ul className="flex flex-col divide-y divide-borde">
            {lineas.map((l) => (
              <li key={l.id} className="flex flex-col gap-1.5 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 text-[13px] font-semibold text-marca">{l.nombre}</div>
                  <div className="cifras shrink-0 text-[13px] font-semibold text-marca">{pesos(l.total)}</div>
                </div>
                <div className="flex items-center justify-between gap-2 text-[12px] text-gris-txt">
                  <span className="cifras">{pesos(l.precio)} c/u{l.iva ? ` + ${l.iva} % IVA` : ''}</span>
                  {c.puede_editar ? (
                    <div className="flex items-center gap-1" role="group" aria-label={`Cantidad de ${l.nombre}`}>
                      <button type="button" disabled={ocupado} onClick={() => carrito.fijar(l.id_producto, l.cantidad - 1)}
                        aria-label="Quitar una unidad"
                        className="flex size-8 items-center justify-center rounded-md border border-borde bg-card text-marca hover:border-acento disabled:opacity-50">
                        {l.cantidad <= 1 ? <Trash2 size={14} aria-hidden="true" /> : <Minus size={14} aria-hidden="true" />}
                      </button>
                      <span className="cifras w-9 text-center text-[14px] font-bold text-marca">{l.cantidad}</span>
                      <button type="button" disabled={ocupado} onClick={() => carrito.fijar(l.id_producto, l.cantidad + 1)}
                        aria-label="Agregar una unidad"
                        className="flex size-8 items-center justify-center rounded-md border border-borde bg-card text-marca hover:border-acento disabled:opacity-50">
                        <Plus size={14} aria-hidden="true" />
                      </button>
                    </div>
                  ) : (
                    <span className="cifras font-semibold text-marca">× {l.cantidad}</span>
                  )}
                </div>
                {l.rubro_nombre && (
                  <div className="text-[11px] text-gris-txt">{l.rubro_nombre}{l.unspsc ? ` · UNSPSC ${l.unspsc}` : ''}</div>
                )}
                {l.requiere_justificacion && <Justificacion linea={l} editable={c.puede_editar} carrito={carrito} />}
                {l.faltas?.length > 0 && (
                  <ul className="list-disc pl-5 text-[12px] font-semibold text-rojo-txt">
                    {l.faltas.map((x) => <li key={x}>{x.charAt(0).toUpperCase() + x.slice(1)}.</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}

        {cl && <TenenciaSede clasificacion={cl} carrito={carrito} />}

        <div className="flex flex-col gap-1.5 border-t border-borde pt-3">
          <Fila etiqueta="Subtotal" valor={pesos(r.subtotal)} />
          <Fila etiqueta="IVA" valor={pesos(r.iva)} />
          {r.transporte > 0 && <Fila etiqueta="Transporte (sale del presupuesto)" valor={pesos(r.transporte)} />}
          {r.transporte_m1 > 0 && <Fila etiqueta="Bolsa de transporte M1 (aparte)" valor={pesos(r.transporte_m1)} />}
          <Fila etiqueta="Total de productos" valor={pesos(r.total)} fuerte />
        </div>

        <Campo etiqueta="Objetivo del plan" ayuda={c.puede_editar ? 'Para qué se va a usar esta compra en la iniciativa.' : undefined}>
          <AreaTexto
            rows={3}
            maxLength={2000}
            value={objetivo}
            disabled={!c.puede_editar}
            onChange={(e) => setObjetivo(e.target.value)}
            onBlur={() => objetivo !== (c.objetivo_plan || '') && carrito.datos({ objetivo_plan: objetivo }, 'Objetivo guardado.', { silencioso: true })}
          />
        </Campo>

        {m1 && (
          <label className="flex items-center gap-2 text-[13px] text-marca">
            <input type="checkbox" checked={c.libro_contable} disabled={!c.puede_editar || ocupado} className="size-4 accent-[var(--color-acento)]"
              onChange={(e) => carrito.datos({ libro_contable: e.target.checked }, e.target.checked ? 'Libro contable incluido.' : 'Libro contable quitado.')} />
            El plan incluye el libro contable (obligatorio en M1)
          </label>
        )}

        {c.puede_definir_presupuesto && c.puede_editar && (
          <div className="flex flex-col gap-3 rounded-xl border border-borde bg-lienzo/60 p-3.5">
            <div className="text-[13px] font-semibold text-marca">Presupuesto (coordinación)</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Presupuesto máximo" ayuda={r.tope_modalidad != null ? `Vacío = el tope de la modalidad (${pesos(r.tope_modalidad)}); puede ser menor, no mayor.` : undefined}>
                <Entrada type="number" min="0" max={r.tope_modalidad ?? undefined} inputMode="numeric" value={montos.presupuesto}
                  onChange={(e) => setMontos((m) => ({ ...m, presupuesto: e.target.value }))} />
              </Campo>
              {(m1 || montos.descuenta) && (
                <Campo etiqueta={m1 ? 'Bolsa de transporte (aparte del tope)' : 'Transporte incluido'}>
                  <Entrada type="number" min="0" inputMode="numeric" value={montos.transporte}
                    onChange={(e) => setMontos((m) => ({ ...m, transporte: e.target.value }))} />
                </Campo>
              )}
            </div>
            {!m1 && (
              <Campo etiqueta="Transporte de los activos">
                <Seleccion value={montos.descuenta ? 'incluido' : 'beneficiario'} onChange={(e) => setMontos((m) => ({ ...m, descuenta: e.target.value === 'incluido' }))}>
                  <option value="incluido">Incluido en la capitalización (sale del presupuesto)</option>
                  <option value="beneficiario">Asumido por el beneficiario</option>
                </Seleccion>
              </Campo>
            )}
            <div><Boton tamano="sm" variante="oscuro" icono={Check} cargando={ocupado} onClick={guardarMontos}>Guardar presupuesto</Boton></div>
          </div>
        )}

        {c.subsanacion && c.estado === 'en_subsanacion' && (
          <Alerta tono={c.subsanacion.vencida ? 'error' : 'aviso'}>{textoSubsanacion(c.subsanacion)}</Alerta>
        )}
        <div className="flex flex-wrap gap-2">
          {c.puede_enviar && (
            <Boton icono={Send} cargando={ocupado} onClick={() => setEnviando(true)} disabled={r.excede || problemas.length > 0}>Enviar a revisión</Boton>
          )}
          {c.puede_resolver && (
            <Boton icono={Check} cargando={ocupado} disabled={problemas.length > 0 || r.excede} onClick={() => carrito.estado('revisado', 'Plan revisado: sigue la viabilidad de la interventoría.')}>Marcar como revisado</Boton>
          )}
          {c.puede_enviar_subsanacion && (
            <Boton icono={Send} cargando={ocupado} disabled={problemas.length > 0 || r.excede} onClick={() => carrito.estado('subsanado', 'Subsanación enviada: sigue un nuevo comité.')}>Enviar la subsanación</Boton>
          )}
          {c.puede_comprar && (
            <Boton icono={Check} cargando={ocupado} onClick={() => carrito.estado('en_compra', 'El plan pasó a compra.')}>Pasar a compra</Boton>
          )}
          {c.puede_entregar && (
            <Boton icono={Check} cargando={ocupado} disabled={c.faltas_entrega?.length > 0} onClick={() => carrito.estado('entregado', 'Plan marcado como entregado.')}>Marcar como entregado</Boton>
          )}
          {c.puede_devolver && (
            <Boton variante="fantasma" icono={Undo2} disabled={ocupado} onClick={() => (c.estado === 'enviado' ? carrito.estado('devuelto', 'Carrito devuelto al gestor.') : (setMotivo(''), setDevolviendo(true)))}>Devolver</Boton>
          )}
          {c.puede_editar && lineas.length > 0 && (
            <Boton variante="fantasma" icono={Trash2} disabled={ocupado} onClick={() => setVaciando(true)}>Vaciar</Boton>
          )}
        </div>
        {c.puede_entregar && c.faltas_entrega?.length > 0 && (
          <Alerta tono="aviso">
            <strong>Para marcarlo como entregado falta (lo registra el gestor en «Plan de capitalización › Entrega al beneficiario»):</strong>
            <ul className="mt-1 list-disc pl-5">{c.faltas_entrega.map((p) => <li key={p}>{p}</li>)}</ul>
          </Alerta>
        )}
        {c.estado === 'aprobado' && c.formacion && !c.formacion.cumple && (
          <p className="text-[12px] font-semibold text-rojo-txt">La unidad tiene {c.formacion.porcentaje} % de formación: sin el 80 % no pasa a compra.</p>
        )}
        {problemas.length > 0 && (c.puede_enviar || c.puede_resolver || c.puede_enviar_subsanacion) && (
          <Alerta tono="aviso">
            <strong>Para {c.puede_enviar ? 'enviar' : c.puede_resolver ? 'marcarlo como revisado' : 'enviar la subsanación'} el plan falta:</strong>
            <ul className="mt-1 list-disc pl-5">{problemas.map((p) => <li key={p}>{p}</li>)}</ul>
            <span className="mt-1 block">El plan de negocio, las adecuaciones, las cotizaciones y la firma se registran en la pestaña «Plan de capitalización».</span>
          </Alerta>
        )}
        {r.excede && c.puede_enviar && (
          <p className="text-[12px] font-semibold text-rojo-txt">El carrito se pasa del presupuesto: quita productos para poder enviarlo.</p>
        )}
      </div>

      <Dialogo abierto={devolviendo} titulo="Devolver el plan" onCerrar={() => setDevolviendo(false)}>
        {devolviendo && (
          <form className="grid gap-3" onSubmit={async (e) => {
            e.preventDefault();
            if (await carrito.estado('devuelto', 'Plan devuelto: vuelve a empezar el ciclo.', motivo.trim())) { setDevolviendo(false); setMotivo(''); }
          }}>
            <p className="text-[13px]">El plan ya avanzó en el ciclo ({estado.texto.toLowerCase()}): al devolverlo vuelve a revisión, viabilidad y comité.</p>
            <Campo etiqueta="Motivo" obligatorio><AreaTexto required rows={3} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
            <div className="flex flex-wrap justify-end gap-2"><Boton variante="fantasma" onClick={() => setDevolviendo(false)}>Cancelar</Boton><Boton tipo="submit" cargando={ocupado} disabled={!motivo.trim()}>Devolver</Boton></div>
          </form>
        )}
      </Dialogo>
      <Confirmar
        abierto={vaciando}
        titulo="¿Vaciar el carrito?"
        texto="Se quitan todos los productos. El presupuesto y el objetivo se conservan."
        etiquetaOk="Vaciar"
        onOk={() => { setVaciando(false); carrito.vaciar(); }}
        onCancelar={() => setVaciando(false)}
      />
      <Confirmar
        abierto={enviando}
        titulo="¿Enviar el carrito a revisión?"
        texto="Después de enviarlo no podrás cambiarlo, salvo que la coordinación lo devuelva."
        etiquetaOk="Enviar"
        onOk={() => { setEnviando(false); carrito.estado('enviado', 'Carrito enviado a revisión.'); }}
        onCancelar={() => setEnviando(false)}
      />
    </Tarjeta>
  );
}
