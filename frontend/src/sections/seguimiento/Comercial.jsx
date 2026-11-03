// Gestión comercial por unidad: visitas comerciales, oferta complementaria, conexión a mercados, clientes
// captados o fidelizados y canales de distribución, con fecha, entidad o cliente, descripción, resultado y un
// soporte opcional en PDF, JPG o PNG.
import { useCallback, useEffect, useState } from 'react';
import { FileDown, FileSpreadsheet, Handshake, Plus } from 'lucide-react';
import { apiGeneral, qs } from '../../inventario/lib/api';
import { AreaTexto, Boton, Campo, Cargando, Celda, Dialogo, Entrada, Fila, Seleccion, Tabla, Tarjeta, useAvisos } from '../../inventario/componentes/ui';
import SelectorIniciativa from '../../components/SelectorIniciativa';
import { urlArchivo } from '../../lib/api';
import { descargarExcel } from '../../lib/exportarExcel';
import { diaColombia } from '../../lib/carrito';
import { GESTION_CON_ENTIDAD, TIPOS_GESTION, faltasGestion, ultimoPedido } from '../../lib/seguimiento';

const hoy = () => diaColombia(new Date().toISOString());
const VACIO = { id_unico: '', tipo: 'visita_comercial', fecha: '', entidad: '', descripcion: '', resultado: '' };
// Columnas del Excel de gestiones comerciales.
const COLUMNAS = [
  { titulo: 'Fecha', valor: (g) => g.fecha, ancho: 12 },
  { titulo: 'ID único', valor: (g) => g.id_unico, ancho: 14 },
  { titulo: 'Unidad productiva', valor: (g) => g.unidad, ancho: 30 },
  { titulo: 'Región', valor: (g) => g.region || '', ancho: 14 },
  { titulo: 'Nodo', valor: (g) => g.nodo || '', ancho: 10 },
  { titulo: 'Tipo', valor: (g) => g.nombre_tipo, ancho: 24 },
  { titulo: 'Entidad, aliado o cliente', valor: (g) => g.entidad || '', ancho: 24 },
  { titulo: 'Descripción', valor: (g) => g.descripcion, ancho: 40 },
  { titulo: 'Resultado', valor: (g) => g.resultado || '', ancho: 40 },
  { titulo: 'Registró', valor: (g) => g.registrado_por, ancho: 20 },
];

// Formulario para registrar una gestión comercial.
function FormGestion({ filas, onListo, onCerrar }) {
  const { avisar } = useAvisos();
  const [f, setF] = useState({ ...VACIO, fecha: hoy() });
  const [soporte, setSoporte] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const poner = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }));
  const faltas = faltasGestion(f, soporte, hoy());
  const enviar = async (e) => {
    e.preventDefault();
    setOcupado(true);
    try {
      const fd = new FormData();
      for (const k of Object.keys(VACIO)) fd.append(k, f[k]);
      if (soporte) fd.append('soporte', soporte);
      await apiGeneral.post('/comercial', fd);
      avisar('Gestión comercial registrada.');
      onListo();
    } catch (err) {
      avisar(err.message, 'error');
    } finally {
      setOcupado(false);
    }
  };
  const conEntidad = GESTION_CON_ENTIDAD.includes(f.tipo);
  return (
    <form className="grid gap-3" onSubmit={enviar}>
      <SelectorIniciativa filas={filas} valor={f.id_unico} onElegir={(x) => setF((v) => ({ ...v, id_unico: x.ID_unico }))} etiqueta="Unidad productiva" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Tipo de gestión" obligatorio>
          <Seleccion value={f.tipo} onChange={poner('tipo')}>{Object.entries(TIPOS_GESTION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Seleccion>
        </Campo>
        <Campo etiqueta="Fecha" obligatorio><Entrada required type="date" max={hoy()} value={f.fecha} onChange={poner('fecha')} /></Campo>
      </div>
      <Campo etiqueta="Entidad, aliado o cliente" obligatorio={conEntidad}><Entrada required={conEntidad} maxLength={300} value={f.entidad} onChange={poner('entidad')} /></Campo>
      <Campo etiqueta="Descripción" obligatorio><AreaTexto required rows={3} maxLength={5000} value={f.descripcion} onChange={poner('descripcion')} /></Campo>
      <Campo etiqueta="Resultado"><AreaTexto rows={2} maxLength={5000} value={f.resultado} onChange={poner('resultado')} /></Campo>
      <Campo etiqueta="Soporte (PDF, JPG o PNG, opcional)">
        <Entrada type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" onChange={(e) => setSoporte(e.target.files?.[0] || null)} />
      </Campo>
      {faltas.length > 0 && <p className="text-[12px] text-gris-txt" aria-live="polite">Falta: {faltas.join(' ')}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton tipo="submit" icono={Handshake} cargando={ocupado} disabled={faltas.length > 0}>Registrar la gestión</Boton>
      </div>
    </form>
  );
}

// Muestra la lista de gestiones con sus filtros y el formulario.
export default function Comercial({ filas }) {
  const { avisar } = useAvisos();
  const [datos, setDatos] = useState(null);
  const [tipo, setTipo] = useState('');
  const [registrando, setRegistrando] = useState(false);
  const [nuevoPedido] = useState(ultimoPedido);
  const recargar = useCallback(() => {
    const vigente = nuevoPedido();
    apiGeneral.get(`/comercial${qs({ tipo })}`)
      .then((r) => { if (vigente()) setDatos(r); })
      .catch((err) => {
        if (!vigente()) return;
        avisar(err.message, 'error');
        setDatos({ items: [], resumen: { por_tipo: {}, unidades: 0 } });
      });
  }, [avisar, tipo, nuevoPedido]);
  useEffect(() => {
    recargar();
    return () => { nuevoPedido(); };
  }, [recargar, nuevoPedido]);
  const items = datos?.items || [];
  return (
    <div className="grid gap-5">
      <Tarjeta titulo="Gestión comercial por unidad" acciones={
        <div className="flex flex-wrap items-end gap-2">
          <Campo etiqueta="Tipo" className="min-w-48">
            <Seleccion value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Todos</option>
              {Object.entries(TIPOS_GESTION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Seleccion>
          </Campo>
          {items.length > 0 && <Boton variante="fantasma" icono={FileSpreadsheet} onClick={() => descargarExcel('gestion-comercial', 'Gestión comercial', COLUMNAS, items)}>Excel</Boton>}
          {datos?.puede_registrar && <Boton icono={Plus} onClick={() => setRegistrando(true)}>Registrar</Boton>}
        </div>}>
        {datos === null ? <Cargando /> : (
          <>
            <p className="mb-3 text-[13px]">{items.length.toLocaleString('es-CO')} gestiones en {datos.resumen.unidades.toLocaleString('es-CO')} unidades{tipo ? '' : `: ${Object.entries(TIPOS_GESTION).map(([k, v]) => `${v.toLowerCase()} ${datos.resumen.por_tipo[k] || 0}`).join(' · ')}`}.</p>
            <Tabla cabeceras={['Fecha', 'Unidad', 'Gestión', 'Resultado', 'Soporte']} vacio="No hay gestiones comerciales registradas." iconoVacio={Handshake}>
              {items.map((g) => (
                <Fila key={g.id}>
                  <Celda><span className="cifras whitespace-nowrap">{g.fecha}</span></Celda>
                  <Celda><span className="font-semibold text-marca">{g.id_unico}</span><span className="block break-words text-[12px] text-gris-txt">{g.unidad} · {g.region || '—'} · {g.nodo || '—'}</span></Celda>
                  <Celda><span className="font-medium">{g.nombre_tipo}</span>{g.entidad && <span className="block text-[12px] text-gris-txt">{g.entidad}</span>}<span className="block break-words text-[12px]">{g.descripcion}</span></Celda>
                  <Celda><span className="break-words text-[13px]">{g.resultado || '—'}</span></Celda>
                  <Celda>{g.con_soporte ? (
                    <a className="inline-flex items-center gap-1 font-semibold text-acento-txt underline" href={urlArchivo(`/comercial/soporte${qs({ id: g.id })}`)} target="_blank" rel="noopener noreferrer" aria-label={`Soporte de la gestión del ${g.fecha} de ${g.id_unico}`}><FileDown size={15} aria-hidden="true" />Ver</a>
                  ) : '—'}</Celda>
                </Fila>
              ))}
            </Tabla>
          </>
        )}
      </Tarjeta>
      <Dialogo abierto={registrando} titulo="Registrar una gestión comercial" ancho="max-w-2xl" onCerrar={() => setRegistrando(false)}>
        {registrando && <FormGestion filas={filas} onCerrar={() => setRegistrando(false)} onListo={() => { setRegistrando(false); recargar(); }} />}
      </Dialogo>
    </div>
  );
}
