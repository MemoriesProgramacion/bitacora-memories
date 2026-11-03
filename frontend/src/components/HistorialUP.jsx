// Historial de cambios de la unidad productiva, al final de la ficha. Lee la misma actividad de la consola:
// quién, cuándo, módulo y antes y después de cada cambio de esta unidad.
import { useEffect, useState } from 'react';
import { Chip } from './UI';
import { fetchApi } from '../lib/api';
import { ACTIVIDAD_URL } from '../lib/config';
import { nombreRol } from '../admin/etiquetas';
import { filasGenericas, moduloDe, nombreAccion, prefijoDe } from '../lib/historial';

const LIMITE = 500;

async function pedirHistorial(session, id) {
  return fetchApi(ACTIVIDAD_URL, { token: session.token, params: { up: id, limite: LIMITE } });
}

// Colores de la pastilla de resultado, los mismos de la actividad de la consola.
const RESULTADOS = {
  ok: { tono: 'ok', texto: 'Guardado' },
  rechazado: { tono: 'warn', texto: 'Rechazado' },
  error: { tono: 'bad', texto: 'Error' },
};

const CAMPOS = {
  gestor_telefono: 'Teléfono',
  gestor_direccion: 'Dirección',
  gestor_confirmada_fecha: 'Fecha confirmada',
  gestor_confirmada_hora: 'Hora confirmada',
  solicitud_motivo: 'Motivo',
  solicitud_fecha_anterior: 'Fecha anterior',
  solicitud_fecha_sugerida: 'Fecha sugerida',
  solicitud_acta: 'Acta',
  solicitud_acta_estado: 'Estado del acta',
  alistamiento: 'Alistamiento',
  despachado: 'Despachado',
  entregado: 'Entregado',
  tipo_novedad: 'Tipo de novedad',
  descripcion_novedad: 'Descripción de la novedad',
  observaciones: 'Observaciones',
  fecha_tentativa_entrega: 'Fecha tentativa de entrega',
};
const VALORES = { en_revision: 'En revisión', aprobada: 'Aprobada' };
// Errores que devuelven las rutas de compras y entregas dentro de los cambios.
const ERRORES = {
  servidor: 'Falla del servidor',
  conflicto: 'Alguien más cambió la entrega al mismo tiempo; había que recargarla',
};

// Genera un filtro por cada módulo que aparece en el historial, además de todo y solo errores.
function filtrosDe(items) {
  const prefijos = [...new Set(items.map((it) => prefijoDe(it.accion)))].sort((a, b) => moduloDe(a).localeCompare(moduloDe(b), 'es'));
  return [
    ['todo', 'Todo', () => true],
    ...prefijos.map((p) => [p, moduloDe(p), (it) => prefijoDe(it.accion) === p]),
    ['errores', 'Solo errores', (it) => it.resultado !== 'ok'],
  ];
}

function texto(campo, v) {
  if (v === null || v === undefined || v === '') return '(vacío)';
  if (v === true) return 'Sí';
  if (v === false) return 'No';
  if (campo === 'solicitud_acta') return 'PDF adjunto';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
  return VALORES[v] || String(v);
}

// Genera las filas campo, antes y después; en compras solo se guarda lo nuevo, por eso esas filas no traen el
// valor anterior tachado.
function filas(it) {
  const c = it.cambios || {};
  if (it.resultado !== 'ok') {
    return [{ campo: 'Por qué', despues: ERRORES[c.error] || c.detalle || c.error || '—' }];
  }
  const out = [];
  Object.entries(c.campos || {}).forEach(([k, par]) => {
    if (CAMPOS[k] && Array.isArray(par)) {
      out.push({ campo: CAMPOS[k], antes: texto(k, par[0]), despues: texto(k, par[1]), conAntes: true });
    }
  });
  (c.compras || []).forEach((x) => out.push({ campo: `Ítem ${x.item_n} comprado`, despues: texto('', x.comprado) }));
  Object.entries(c.logistica || {}).forEach(([k, v]) => {
    if (CAMPOS[k]) out.push({ campo: CAMPOS[k], despues: texto(k, v) });
  });
  if ('fecha_tentativa_entrega' in c) {
    out.push({ campo: CAMPOS.fecha_tentativa_entrega, despues: texto('', c.fecha_tentativa_entrega) });
  }
  out.push(...filasGenericas(c, { conocidos: CAMPOS, omitir: ['compras', 'logistica', 'fecha_tentativa_entrega'] }));
  return out;
}

// Da formato de día a una fecha del historial.
function dia(iso) {
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}
// Da formato de hora a una fecha del historial.
function hora(iso) {
  return new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
}

// Pide la actividad de la unidad al servidor y la muestra con sus filtros.
export default function HistorialUP({ up, session, cargar = pedirHistorial }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [filtro, setFiltro] = useState('todo');
  const id = up?.ID_unico;

  useEffect(() => {
    let vigente = true;
    setItems(null); setError(''); setFiltro('todo');
    cargar(session, id)
      .then((r) => { if (vigente) setItems(r.items || []); })
      .catch((err) => {
        if (vigente) { setItems([]); setError(err?.publicMsg || 'No se pudo cargar el historial.'); }
      });
    return () => { vigente = false; };
  }, [id, session, cargar]);

  if (!items) return <p className="text-[13px] text-gris">Cargando historial…</p>;
  if (error) return <p className="text-[13px] text-gris">{error}</p>;

  const FILTROS = filtrosDe(items);
  const pasa = (FILTROS.find((f) => f[0] === filtro) || FILTROS[0])[2];
  const vis = items.filter(pasa);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar historial">
        {FILTROS.map(([fid, label, f]) => (
          <button key={fid} type="button" onClick={() => setFiltro(fid)} aria-pressed={filtro === fid}
            className={`rounded-full border px-3 py-1 text-xs tabular-nums ${filtro === fid
              ? 'border-marino bg-marino font-semibold text-white'
              : 'border-borde bg-card text-gris hover:border-acento'}`}>
            {label} · {items.filter(f).length}
          </button>
        ))}
      </div>

      {!items.length ? (
        <p className="py-6 text-center text-[13px] text-gris">Esta U.P. todavía no tiene cambios registrados.</p>
      ) : !vis.length ? (
        <p className="py-6 text-center text-[13px] text-gris">No hay cambios con este filtro.</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {vis.map((it) => {
            const r = RESULTADOS[it.resultado] || RESULTADOS.error;
            const q = it.quien || {};
            return (
              <li key={it.id} className="grid grid-cols-[84px_minmax(0,1fr)] gap-3 sm:grid-cols-[110px_minmax(0,1fr)]">
                <time className="pt-0.5 text-right text-xs tabular-nums text-gris">
                  <b className="block font-semibold text-texto">{dia(it.fecha)}</b>{hora(it.fecha)}
                </time>
                <div className="min-w-0 rounded-lg bg-bg p-3">
                  <div className="text-[13px]">
                    <span className="font-semibold text-texto">{q.nombre || '—'}</span>
                    <span className="text-gris"> · {[nombreRol(q.rol), q.nodo].filter(Boolean).join(' · ')}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-gris">{moduloDe(it.accion)}</span>
                    <Chip tono={r.tono}>{nombreAccion(it.accion)}</Chip>
                    {it.resultado !== 'ok' && <span className="text-xs text-gris">{r.texto}: no se guardó</span>}
                  </div>
                  <ul className="mt-2 flex flex-col gap-0.5 text-xs">
                    {filas(it).map((f, i) => (
                      <li key={`${f.campo}-${i}`} className="flex flex-wrap gap-x-1.5 [overflow-wrap:anywhere]">
                        <span className="text-gris">{f.campo}:</span>
                        {f.conAntes && <><span className="text-rojo line-through">{f.antes}</span><span aria-hidden="true">→</span></>}
                        <span className={`font-semibold ${it.resultado === 'ok' ? 'text-verde-ok' : 'text-texto'}`}>{f.despues}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <p className="mt-3 border-t border-borde pt-3 text-xs text-gris">
        {vis.length} cambio{vis.length === 1 ? '' : 's'} registrado{vis.length === 1 ? '' : 's'}
      </p>
    </div>
  );
}
