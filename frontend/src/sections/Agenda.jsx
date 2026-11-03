// Agenda de citas: organiza las llamadas, visitas y reuniones con las iniciativas como un calendario, que se ve
// por día, semana, mes o lista, con la lista de las iniciativas a las que todavía falta llamar y sus números.
// Cada cuenta de campo trabaja con las de su nodo y la coordinación ve todas.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarCheck, CalendarClock, CalendarPlus, ChevronLeft, ChevronRight, Phone, PhoneMissed,
} from 'lucide-react';
import { apiGeneral } from '../inventario/lib/api';
import Encabezado from '../inventario/componentes/Encabezado';
import {
  Boton, Cargando, Indicador, Seleccion, Tarjeta, useAvisos,
} from '../inventario/componentes/ui';
import {
  ESTADOS, inicioDeDia, mismoDia, normalizar, representante, sumarDias, sumarMeses, titulo,
} from '../lib/agenda';
import DialogoCita from './agenda/DialogoCita';
import PorLlamar from './agenda/PorLlamar';
import VistaLista from './agenda/VistaLista';
import { VistaMes, VistaSemana } from './agenda/VistaCalendario';

const VISTAS = [['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes'], ['lista', 'Lista']];

// Carga las citas y las iniciativas, y muestra la vista elegida junto con los diálogos para crear y cambiar
// citas.
export default function Agenda({ data, session }) {
  const { avisar } = useAvisos();
  const esCoordinacion = session.role !== 'gestor';
  const soloLectura = Boolean(session.soloLectura);

  const [citas, setCitas] = useState(null);
  const [vista, setVista] = useState(() => (window.innerWidth < 768 ? 'lista' : 'semana'));
  const [fecha, setFecha] = useState(() => new Date());
  const [nodo, setNodo] = useState('');
  const [estado, setEstado] = useState('');
  const [dialogo, setDialogo] = useState(null);
  const [q, setQ] = useState('');
  const [panel, setPanel] = useState('calendario');

  const cargar = useCallback(async () => {
    try {
      const r = await apiGeneral.get('/agenda');
      setCitas(r.items.map(normalizar));
    } catch (err) {
      avisar(err.message, 'error');
      setCitas([]);
    }
  }, [avisar]);
  useEffect(() => { cargar(); }, [cargar]);

  const filas = useMemo(
    () => data.filter((f) => f.habilitadas !== '0' && (!nodo || f.nodo === nodo)),
    [data, nodo],
  );
  const nodos = useMemo(() => [...new Set(data.map((f) => f.nodo).filter(Boolean))].sort(), [data]);

  const visibles = useMemo(
    () => (citas || []).filter((c) => (!nodo || c.nodo === nodo) && (!estado || c.estado === estado)),
    [citas, nodo, estado],
  );

  const porIniciativa = useMemo(() => {
    const mapa = new Map();
    for (const c of citas || []) {
      const r = mapa.get(c.id_unico) || { agendada: false, realizada: false, intentos: 0, ultima: null };
      if (c.estado === 'agendada') r.agendada = true;
      if (c.estado === 'realizada') r.realizada = true;
      if (c.estado === 'no_contesto') {
        r.intentos += 1;
        if (!r.ultima || c.ini > r.ultima) r.ultima = c.ini;
      }
      mapa.set(c.id_unico, r);
    }
    return mapa;
  }, [citas]);

  const pendientes = useMemo(() => {
    const t = q.trim().toLowerCase();
    return filas
      .filter((f) => {
        const r = porIniciativa.get(f.ID_unico);
        return !(r?.agendada || r?.realizada);
      })
      .map((f) => ({ fila: f, intentos: porIniciativa.get(f.ID_unico)?.intentos || 0, ultima: porIniciativa.get(f.ID_unico)?.ultima || null }))
      .filter(({ fila }) => !t || [fila.unidad_nombre, fila.ID_unico, fila.mpio, representante(fila)]
        .some((v) => String(v || '').toLowerCase().includes(t)))
      .sort((a, b) => a.intentos - b.intentos || String(a.fila.unidad_nombre).localeCompare(String(b.fila.unidad_nombre)));
  }, [filas, porIniciativa, q]);

  const cuenta = useMemo(() => {
    let agendadas = 0;
    let realizadas = 0;
    for (const f of filas) {
      const r = porIniciativa.get(f.ID_unico);
      if (r?.agendada) agendadas += 1;
      if (r?.realizada) realizadas += 1;
    }
    return { agendadas, realizadas, sinContestar: pendientes.filter((p) => p.intentos > 0).length };
  }, [filas, porIniciativa, pendientes]);

  const mover = (sentido) => setFecha((f) => {
    if (vista === 'dia') return sumarDias(f, sentido);
    if (vista === 'semana') return sumarDias(f, 7 * sentido);
    return sumarMeses(f, sentido);
  });

  const citasDelRango = useMemo(() => {
    if (vista === 'dia') return visibles.filter((c) => mismoDia(c.ini, fecha));
    if (vista === 'lista') return visibles.filter((c) => c.ini.getFullYear() === fecha.getFullYear() && c.ini.getMonth() === fecha.getMonth());
    return visibles;
  }, [visibles, vista, fecha]);

  const nueva = (up = null, inicio = null) => setDialogo({ up, inicio });
  const cerrarYRecargar = () => { setDialogo(null); cargar(); };

  const resultado = async (cita, nuevoEstado) => {
    try {
      await apiGeneral.post('/agenda/estado', { id: cita.id, estado: nuevoEstado });
      avisar(`Cita marcada como "${ESTADOS[nuevoEstado].texto.toLowerCase()}".`);
      cargar();
    } catch (err) {
      avisar(err.message, 'error');
    }
  };

  if (citas === null) return <Cargando />;

  return (
    <>
      <Encabezado
        titulo="Agenda"
        descripcion="Citas y llamadas con las iniciativas: a quién toca llamar, con qué número y a qué hora quedó cada cita."
      >
        {!soloLectura && <Boton icono={CalendarPlus} onClick={() => nueva()}>Nueva cita</Boton>}
      </Encabezado>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Indicador etiqueta="Por llamar" valor={pendientes.length} icono={Phone} retardo={0}
          tono={pendientes.length ? 'alerta' : 'ok'} detalle="Sin cita agendada" />
        <Indicador etiqueta="Con cita agendada" valor={cuenta.agendadas} icono={CalendarClock} retardo={60}
          detalle="Falta hacer la llamada" />
        <Indicador etiqueta="Ya atendidas" valor={cuenta.realizadas} icono={CalendarCheck} retardo={120}
          tono="ok" detalle="Cita realizada" />
        <Indicador etiqueta="No contestaron" valor={cuenta.sinContestar} icono={PhoneMissed} retardo={180}
          tono={cuenta.sinContestar ? 'error' : 'ok'} detalle="Hay que volver a llamar" />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-lienzo p-1 xl:hidden" role="group" aria-label="Qué ver">
        {[['calendario', 'Calendario'], ['llamar', `Por llamar (${pendientes.length})`]].map(([id, texto]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPanel(id)}
            aria-pressed={panel === id}
            className={`rounded-lg px-3 py-2.5 text-[14px] font-semibold transition-colors ${
              panel === id ? 'bg-card text-marca shadow-sm' : 'text-gris-txt'
            }`}
          >
            {texto}
          </button>
        ))}
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className={panel === 'llamar' ? 'max-xl:hidden' : ''}>
          <Tarjeta>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Boton variante="fantasma" tamano="sm" onClick={() => setFecha(new Date())}>Hoy</Boton>
              <button type="button" onClick={() => mover(-1)} aria-label="Anterior"
                className="flex size-9 items-center justify-center rounded-lg border border-borde bg-card text-marca hover:border-acento">
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => mover(1)} aria-label="Siguiente"
                className="flex size-9 items-center justify-center rounded-lg border border-borde bg-card text-marca hover:border-acento">
                <ChevronRight size={18} aria-hidden="true" />
              </button>
              <h3 className="mr-auto min-w-0 text-[15px] font-bold text-marca">
                {titulo(vista === 'lista' ? 'mes' : vista, fecha)}
              </h3>
              <div className="flex rounded-lg bg-lienzo p-0.5" role="group" aria-label="Forma de ver el calendario">
                {VISTAS.map(([id, texto]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setVista(id)}
                    aria-pressed={vista === id}
                    className={`rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                      vista === id ? 'bg-card text-marca shadow-sm' : 'text-gris-txt hover:text-marca'
                    }`}
                  >
                    {texto}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              {esCoordinacion && (
                <Seleccion value={nodo} onChange={(e) => setNodo(e.target.value)} aria-label="Filtrar por nodo" className="sm:w-48">
                  <option value="">Todos los nodos</option>
                  {nodos.map((n) => <option key={n} value={n}>{n}</option>)}
                </Seleccion>
              )}
              <Seleccion value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Filtrar por estado" className="sm:w-48">
                <option value="">Todos los estados</option>
                {Object.entries(ESTADOS).map(([k, e]) => <option key={k} value={k}>{e.texto}</option>)}
              </Seleccion>
            </div>

            {vista === 'semana' && (
              <VistaSemana fecha={fecha} dias={7} citas={visibles} onAbrir={(cita) => setDialogo({ cita })} onHueco={soloLectura ? undefined : (d) => nueva(null, d)} />
            )}
            {vista === 'dia' && (
              <VistaSemana fecha={fecha} dias={1} citas={visibles} onAbrir={(cita) => setDialogo({ cita })} onHueco={soloLectura ? undefined : (d) => nueva(null, d)} />
            )}
            {vista === 'mes' && (
              <VistaMes fecha={fecha} citas={visibles} onAbrir={(cita) => setDialogo({ cita })}
                onDia={(d) => { setFecha(inicioDeDia(d)); setVista('dia'); }} />
            )}
            {vista === 'lista' && (
              <VistaLista citas={citasDelRango} onAbrir={(cita) => setDialogo({ cita })} onResultado={soloLectura ? undefined : resultado} />
            )}
          </Tarjeta>
        </div>

        <div className={panel === 'calendario' ? 'max-xl:hidden' : ''}>
          <Tarjeta titulo={`Por llamar (${pendientes.length})`} className="xl:sticky xl:top-16">
            <PorLlamar
              pendientes={pendientes}
              q={q}
              onQ={setQ}
              mostrarNodo={esCoordinacion}
              onAgendar={soloLectura ? undefined : (fila) => nueva(fila)}
            />
          </Tarjeta>
        </div>
      </div>

      <DialogoCita inicial={dialogo} filas={filas} soloLectura={soloLectura} onCerrar={() => setDialogo(null)} onCambio={cerrarYRecargar} />
    </>
  );
}
