// Entrega al beneficiario: con el plan en compra, quien atiende la unidad carga el documento de recomendaciones
// de uso y registra el acta de recibido de la copia de las facturas y de los soportes de garantía. Sin ambos,
// el plan no se marca como entregado, y el servidor lo exige.
import { useState } from 'react';
import { ClipboardCheck, FileDown, FileUp } from 'lucide-react';
import { pesos } from '../../inventario/lib/api';
import { Alerta, AreaTexto, Boton, Campo, Dialogo, Entrada, Insignia, Tarjeta } from '../../inventario/componentes/ui';
import { hoyISO } from '../../lib/asociados';
import { documentoLimpio, faltasActaRecibido } from '../../lib/entregaFinal';
import { diaColombia } from '../../lib/carrito';

// Muestra un enlace a un soporte.
const Enlace = ({ url, etiqueta, children }) => (
  <a href={`/api${url}`} target="_blank" rel="noopener noreferrer" aria-label={etiqueta} className="inline-flex items-center gap-1 font-semibold text-acento-txt underline">
    <FileDown size={15} aria-hidden="true" />{children}
  </a>
);
// Valores iniciales del formulario del acta de recibido.
const ACTA_VACIA = { fecha: '', recibe_nombre: '', recibe_documento: '', garantias: '', facturas: [] };

// Muestra los soportes de la entrega y el formulario del acta de recibido.
export default function EntregaBeneficiario({ c, carrito }) {
  const [subiendo, setSubiendo] = useState(false);
  const [acta, setActa] = useState(false);
  const [archivo, setArchivo] = useState(null);
  const [f, setF] = useState(ACTA_VACIA);
  if (!['en_compra', 'entregado'].includes(c.estado)) return null;
  const e = c.entrega_beneficiario || {};
  const puede = c.puede_entrega_beneficiario;
  const facturas = c.facturas_up || [];
  const faltas = faltasActaRecibido(f, archivo);
  const esPdf = Boolean(archivo) && /\.pdf$/i.test(archivo.name);
  const completa = !(c.faltas_entrega || []).length;
  const abrirActa = () => { setArchivo(null); setF({ ...ACTA_VACIA, fecha: hoyISO(), facturas: facturas.map((x) => x.id) }); setActa(true); };
  const marcarFactura = (id, si) => setF((x) => ({ ...x, facturas: si ? [...new Set([...x.facturas, id])] : x.facturas.filter((k) => k !== id) }));

  return (
    <Tarjeta titulo="Entrega al beneficiario" acciones={<Insignia tono={completa ? 'ok' : 'alerta'}>{completa ? 'Completa' : 'Incompleta'}</Insignia>}>
      <div className="grid gap-3 text-[13px]">
        <p className="text-gris-txt">Al entregar los activos, la unidad recibe el documento de recomendaciones de uso y buenas prácticas, la copia de las facturas y los soportes de garantía, con acta de recibido. Sin esto el plan no se marca como entregado.</p>
        <div className="grid gap-1 rounded-lg border border-borde p-3">
          <strong className="text-marca">Recomendaciones de uso y buenas prácticas</strong>
          {e.recomendaciones ? (
            <p className="break-words">Cargado por {e.recomendaciones.cargado_por} el {diaColombia(e.recomendaciones.cargado_en)} · <Enlace url={e.recomendaciones.soporte_url} etiqueta="Documento de recomendaciones de uso">Ver documento</Enlace></p>
          ) : <p className="text-gris-txt">Sin cargar.</p>}
          {puede && <div><Boton tamano="sm" variante="fantasma" icono={FileUp} onClick={() => { setArchivo(null); setSubiendo(true); }}>{e.recomendaciones ? 'Reemplazar el documento' : 'Cargar el documento (PDF)'}</Boton></div>}
        </div>
        <div className="grid gap-1 rounded-lg border border-borde p-3">
          <strong className="text-marca">Acta de recibido de la copia de la factura y de los soportes de garantía</strong>
          {e.acta_recibido ? (
            <p className="break-words">
              {e.acta_recibido.fecha} · recibió {e.acta_recibido.recibe_nombre} ({e.acta_recibido.recibe_documento}) · facturas {e.acta_recibido.facturas.map((x) => x.numero).join(', ')} · garantías: {e.acta_recibido.garantias}
              {' · '}<Enlace url={e.acta_recibido.soporte_url} etiqueta="Acta de recibido firmada">Ver acta</Enlace>
            </p>
          ) : <p className="text-gris-txt">Sin registrar.</p>}
          {puede && <div><Boton tamano="sm" icono={ClipboardCheck} onClick={abrirActa}>{e.acta_recibido ? 'Registrar el acta de nuevo' : 'Registrar el acta de recibido'}</Boton></div>}
        </div>
      </div>

      <Dialogo abierto={subiendo} titulo="Documento de recomendaciones de uso y buenas prácticas" onCerrar={() => setSubiendo(false)}>
        {subiendo && (
          <form className="grid gap-3" onSubmit={async (ev) => { ev.preventDefault(); if (await carrito.recomendaciones(archivo)) setSubiendo(false); }}>
            <p className="text-[13px] text-gris-txt">El documento que se entregó a la unidad productiva, en PDF.</p>
            <Campo etiqueta="Documento (PDF)" obligatorio error={archivo && !esPdf ? 'Debe ser un PDF.' : undefined}>
              <Entrada required type="file" accept="application/pdf,.pdf" aria-invalid={(archivo && !esPdf) || undefined} onChange={(ev) => setArchivo(ev.target.files?.[0] || null)} />
            </Campo>
            <div className="flex flex-wrap justify-end gap-2"><Boton variante="fantasma" onClick={() => setSubiendo(false)}>Cancelar</Boton><Boton tipo="submit" cargando={carrito.ocupado} disabled={!esPdf}>Cargar</Boton></div>
          </form>
        )}
      </Dialogo>

      <Dialogo abierto={acta} titulo="Acta de recibido de la copia de la factura y de la garantía" ancho="max-w-2xl" onCerrar={() => setActa(false)}>
        {acta && (
          <form className="grid gap-3" onSubmit={async (ev) => {
            ev.preventDefault();
            if (await carrito.actaRecibido({ ...f, recibe_documento: documentoLimpio(f.recibe_documento), facturas: JSON.stringify(f.facturas) }, archivo)) setActa(false);
          }}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo etiqueta="Fecha del acta" obligatorio><Entrada required type="date" max={hoyISO()} value={f.fecha} onChange={(ev) => setF((x) => ({ ...x, fecha: ev.target.value }))} /></Campo>
              <Campo etiqueta="Quien recibe (nombre)" obligatorio><Entrada required maxLength={200} value={f.recibe_nombre} onChange={(ev) => setF((x) => ({ ...x, recibe_nombre: ev.target.value }))} /></Campo>
              <Campo etiqueta="Documento de quien recibe" obligatorio><Entrada required maxLength={20} autoComplete="off" autoCapitalize="characters" value={f.recibe_documento} onChange={(ev) => setF((x) => ({ ...x, recibe_documento: ev.target.value }))} /></Campo>
            </div>
            <fieldset className="grid gap-1.5">
              <legend className="mb-1 text-[13px] font-semibold text-gris-txt">Facturas entregadas en copia <span className="text-rojo-txt" aria-hidden="true">*</span></legend>
              {!facturas.length ? <Alerta tono="aviso">La unidad no tiene facturas de capitalización en el Inventario: regístralas primero (Inventario › Facturas, con la unidad productiva).</Alerta> : facturas.map((x) => (
                <label key={x.id} className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" className="size-4 accent-[var(--color-acento)]" checked={f.facturas.includes(x.id)} onChange={(ev) => marcarFactura(x.id, ev.target.checked)} />
                  <span>Factura {x.numero} · {x.fecha} · {x.proveedor || 'sin proveedor'} · <span className="cifras">{pesos(x.total)}</span></span>
                </label>
              ))}
            </fieldset>
            <Campo etiqueta="Soportes de garantía entregados" obligatorio ayuda="Qué garantías recibió la unidad (certificados, pólizas, tiempo de garantía) o «Sin garantía».">
              <AreaTexto required rows={2} maxLength={2000} value={f.garantias} onChange={(ev) => setF((x) => ({ ...x, garantias: ev.target.value }))} />
            </Campo>
            <Campo etiqueta="Acta de recibido firmada (PDF)" obligatorio error={archivo && !esPdf ? 'Debe ser un PDF.' : undefined}>
              <Entrada required type="file" accept="application/pdf,.pdf" aria-invalid={(archivo && !esPdf) || undefined} onChange={(ev) => setArchivo(ev.target.files?.[0] || null)} />
            </Campo>
            {faltas.length > 0 && <p className="text-[12px] text-gris-txt">Falta: {faltas.join(' ')}</p>}
            <div className="flex flex-wrap justify-end gap-2"><Boton variante="fantasma" onClick={() => setActa(false)}>Cancelar</Boton><Boton tipo="submit" cargando={carrito.ocupado} disabled={faltas.length > 0}>Registrar</Boton></div>
          </form>
        )}
      </Dialogo>
    </Tarjeta>
  );
}
