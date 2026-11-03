// Casos de éxito, buenas prácticas y lecciones aprendidas por unidad: tipo, título, descripción, resultados,
// fecha, hasta 10 fotos JPG o PNG y un documento PDF opcional. Los registran quienes atienden la unidad y la
// coordinación de su alcance, y el nivel nacional los marca como documentados para el reporte.
import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, FileText, Image, Plus, Trophy } from 'lucide-react';
import { apiGeneral, qs } from '../../inventario/lib/api';
import { AreaTexto, Boton, Campo, Cargando, Dialogo, Entrada, Insignia, Seleccion, Tarjeta, Vacio, useAvisos } from '../../inventario/componentes/ui';
import SelectorIniciativa from '../../components/SelectorIniciativa';
import { urlArchivo } from '../../lib/api';
import { diaColombia } from '../../lib/carrito';
import { MAX_FOTOS_CASO, TIPOS_CASO, faltasCaso, ultimoPedido } from '../../lib/seguimiento';

const ENLACE = 'inline-flex items-center gap-1 font-semibold text-acento-txt underline';
const hoy = () => diaColombia(new Date().toISOString());
const VACIO = { id_unico: '', tipo: 'exito', titulo: '', descripcion: '', resultados: '', fecha: '' };

// Formulario para registrar un caso con sus fotos y su documento.
function FormCaso({ filas, onListo, onCerrar }) {
  const { avisar } = useAvisos();
  const [f, setF] = useState({ ...VACIO, fecha: hoy() });
  const [fotos, setFotos] = useState([]);
  const [documento, setDocumento] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const poner = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }));
  const faltas = faltasCaso(f, { fotos, documento }, hoy());
  const enviar = async (e) => {
    e.preventDefault();
    setOcupado(true);
    try {
      const fd = new FormData();
      for (const k of Object.keys(VACIO)) fd.append(k, f[k]);
      for (const x of fotos) fd.append('fotos', x);
      if (documento) fd.append('documento', documento);
      await apiGeneral.post('/casos', fd);
      avisar('Caso registrado.');
      onListo();
    } catch (err) {
      avisar(err.message, 'error');
    } finally {
      setOcupado(false);
    }
  };
  return (
    <form className="grid gap-3" onSubmit={enviar}>
      <SelectorIniciativa filas={filas} valor={f.id_unico} onElegir={(x) => setF((v) => ({ ...v, id_unico: x.ID_unico }))} etiqueta="Unidad productiva" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Tipo" obligatorio>
          <Seleccion value={f.tipo} onChange={poner('tipo')}>{Object.entries(TIPOS_CASO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Seleccion>
        </Campo>
        <Campo etiqueta="Fecha" obligatorio><Entrada required type="date" max={hoy()} value={f.fecha} onChange={poner('fecha')} /></Campo>
      </div>
      <Campo etiqueta="Título" obligatorio><Entrada required maxLength={300} value={f.titulo} onChange={poner('titulo')} /></Campo>
      <Campo etiqueta="Descripción" obligatorio><AreaTexto required rows={3} maxLength={5000} value={f.descripcion} onChange={poner('descripcion')} /></Campo>
      <Campo etiqueta="Resultados" ayuda="Por ejemplo: ventas antes y después, clientes nuevos, empleos."><AreaTexto rows={2} maxLength={5000} value={f.resultados} onChange={poner('resultados')} /></Campo>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta={`Fotos (JPG o PNG, hasta ${MAX_FOTOS_CASO})`} ayuda="Cada foto hasta 5 MB.">
          <Entrada type="file" multiple accept="image/jpeg,image/png,.jpg,.jpeg,.png" onChange={(e) => setFotos([...(e.target.files || [])])} />
        </Campo>
        <Campo etiqueta="Documento (PDF, opcional)">
          <Entrada type="file" accept="application/pdf,.pdf" onChange={(e) => setDocumento(e.target.files?.[0] || null)} />
        </Campo>
      </div>
      {faltas.length > 0 && <p className="text-[12px] text-gris-txt" aria-live="polite">Falta: {faltas.join(' ')}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton tipo="submit" icono={Trophy} cargando={ocupado} disabled={faltas.length > 0}>Registrar el caso</Boton>
      </div>
    </form>
  );
}

// Muestra la lista de casos con sus filtros y el formulario.
export default function Casos({ filas }) {
  const { avisar } = useAvisos();
  const [datos, setDatos] = useState(null);
  const [tipo, setTipo] = useState('');
  const [registrando, setRegistrando] = useState(false);
  const [marcando, setMarcando] = useState(null);
  const [nuevoPedido] = useState(ultimoPedido);
  const recargar = useCallback(() => {
    const vigente = nuevoPedido();
    apiGeneral.get(`/casos${qs({ tipo })}`)
      .then((r) => { if (vigente()) setDatos(r); })
      .catch((err) => {
        if (!vigente()) return;
        avisar(err.message, 'error');
        setDatos({ items: [] });
      });
  }, [avisar, tipo, nuevoPedido]);
  useEffect(() => {
    recargar();
    return () => { nuevoPedido(); };
  }, [recargar, nuevoPedido]);
  const documentar = async (c) => {
    setMarcando(c.id);
    try {
      await apiGeneral.post('/casos/documentar', { id: c.id });
      avisar(`«${c.titulo}» quedó documentado.`);
      recargar();
    } catch (err) {
      avisar(err.message, 'error');
    } finally {
      setMarcando(null);
    }
  };
  const items = datos?.items || [];
  return (
    <div className="grid gap-5">
      <Tarjeta titulo="Casos de éxito, buenas prácticas y lecciones aprendidas" acciones={
        <div className="flex flex-wrap items-end gap-2">
          <Campo etiqueta="Tipo" className="min-w-44">
            <Seleccion value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Todos</option>
              {Object.entries(TIPOS_CASO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Seleccion>
          </Campo>
          {datos?.puede_registrar && <Boton icono={Plus} onClick={() => setRegistrando(true)}>Registrar</Boton>}
        </div>}>
        <p className="text-[12px] text-gris-txt">El nivel nacional marca los casos documentados para el reporte de casos de éxito.</p>
      </Tarjeta>
      {datos === null ? <Tarjeta><Cargando /></Tarjeta> : !items.length ? <Tarjeta><Vacio icono={Trophy}>No hay casos registrados.</Vacio></Tarjeta> : (
        <ul className="grid gap-3">
          {items.map((c) => (
            <li key={c.id}>
              <Tarjeta titulo={c.titulo} acciones={<div className="flex flex-wrap gap-2"><Insignia tono="neutro">{c.nombre_tipo}</Insignia>{c.documentado && <Insignia tono="ok">Documentado</Insignia>}</div>}>
                <div className="grid gap-1.5 text-[13px]">
                  <p className="text-gris-txt">{c.id_unico} · {c.unidad} · {c.region || '—'} · nodo {c.nodo || '—'} · {c.fecha} · registró {c.registrado_por}</p>
                  <p className="whitespace-pre-wrap break-words">{c.descripcion}</p>
                  {c.resultados && <p className="whitespace-pre-wrap break-words"><strong>Resultados:</strong> {c.resultados}</p>}
                  {c.documentado && <p className="text-[12px] text-gris-txt">Documentado por {c.documentado_por} el {diaColombia(c.documentado_en)}.</p>}
                  <div className="flex flex-wrap items-center gap-3">
                    {c.adjuntos.map((a) => (
                      <a key={a.id} className={ENLACE} href={urlArchivo(`/casos/adjunto${qs({ id: a.id })}`)} target="_blank" rel="noopener noreferrer" aria-label={`${a.clase === 'foto' ? 'Foto' : 'Documento'} ${a.nombre} del caso ${c.titulo}`}>
                        {a.clase === 'foto' ? <Image size={15} aria-hidden="true" /> : <FileText size={15} aria-hidden="true" />}<span className="max-w-48 truncate">{a.nombre}</span>
                      </a>
                    ))}
                    {datos.puede_documentar && !c.documentado && (
                      <Boton variante="fantasma" tamano="sm" icono={BadgeCheck} cargando={marcando === c.id} onClick={() => documentar(c)}>Marcar como documentado</Boton>
                    )}
                  </div>
                </div>
              </Tarjeta>
            </li>
          ))}
        </ul>
      )}
      <Dialogo abierto={registrando} titulo="Registrar un caso" ancho="max-w-2xl" onCerrar={() => setRegistrando(false)}>
        {registrando && <FormCaso filas={filas} onCerrar={() => setRegistrando(false)} onListo={() => { setRegistrando(false); recargar(); }} />}
      </Dialogo>
    </div>
  );
}
