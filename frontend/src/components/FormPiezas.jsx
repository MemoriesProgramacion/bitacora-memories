// Piezas comunes de los formularios de eventos y novedades.
import { useGestores, destLabel, plural } from '../lib/comunicaciones';

export const inputCls =
  'w-full rounded-lg border border-borde bg-card px-3 py-2.5 text-[13px] outline-none focus:border-acento';

export function BloqueTitulo({ n, titulo, ayuda }) {
  return (
    <>
      <h4 className="mb-1 flex items-center gap-2 text-sm font-bold text-marino">
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-marino text-[11px] text-acento">
          {n}
        </span>
        {titulo}
      </h4>
      {ayuda && <p className="mb-3 text-xs leading-relaxed text-gris">{ayuda}</p>}
    </>
  );
}

// Envuelve un control con su etiqueta; el error se anuncia a los lectores de pantalla y queda enlazado con
// aria-describedby.
export function Campo({ label, error, opcional, children, id }) {
  return (
    <div className={`mb-3.5 ${error ? 'rounded-lg bg-[rgba(229,62,62,0.05)] p-2 ring-1 ring-rojo/30' : ''}`}>
      <label htmlFor={id} className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-gris">
        {label}
        {opcional && <span className="ml-1 font-normal normal-case text-[rgba(138,143,158,0.7)]">(opcional)</span>}
      </label>
      {children}
      {error && <p id={id ? `${id}-error` : undefined} role="alert" className="mt-1 text-[11px] font-semibold text-rojo">{error}</p>}
    </div>
  );
}

export function FormHead({ titulo, onCancelar }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3 border-b border-borde pb-3">
      <h3 className="text-base font-bold text-marino">{titulo}</h3>
      <button type="button" onClick={onCancelar}
        className="text-[13px] font-semibold text-gris hover:text-marino">
        Cancelar
      </button>
    </div>
  );
}

// Muestra el pie del formulario con el resumen de destinatarios, contados por conjuntos contra la lista viva.
export function FormPie({ sel, editando, textoBoton, onCancelar, onGuardar }) {
  const lista = useGestores();
  const deLista = new Set(lista.map((g) => g.nodo));
  const elegidos = [...new Set(sel)];
  const activos = elegidos.filter((x) => deLista.has(x));
  const huerfanos = elegidos.filter((x) => !deLista.has(x));
  const n = activos.length;
  let texto;
  let falta = false;
  if (!elegidos.length) {
    texto = 'Aún no has elegido a quién le llega.';
    falta = true;
  } else {
    const verbo = editando ? 'Lo verán' : 'Se enviará a';
    const y = editando ? 'y' : 'y a';
    const cuantos = plural(n, 'gestor', 'gestores');
    const sinGestor = huerfanos.length
      ? `${plural(huerfanos.length, 'nodo', 'nodos')} sin gestor activo${huerfanos.length <= 3 ? ` (${huerfanos.join(', ')})` : ''}`
      : '';
    if (!n) {
      texto = `${verbo} ${sinGestor}`;
    } else if (n === lista.length) {
      texto = sinGestor
        ? `${verbo} ${cuantos} (${n === 1 ? 'el único activo' : 'todos los activos'}) ${y} ${sinGestor}`
        : `${verbo} todos los gestores (${n})`;
    } else {
      const etiqueta = destLabel(activos);
      const base = etiqueta === cuantos ? `${verbo} ${cuantos}` : `${verbo} ${cuantos}: ${etiqueta}`;
      texto = sinGestor ? `${base} ${y} ${sinGestor}` : base;
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-borde pt-4">
      <p className={`text-[13px] ${falta ? 'font-semibold text-rojo' : 'text-gris'}`}>{texto}</p>
      <div className="flex gap-2">
        <button type="button" onClick={onCancelar}
          className="rounded-lg border border-borde bg-card px-3.5 py-2 text-[13px] font-semibold text-texto hover:border-acento">
          Cancelar
        </button>
        <button type="button" onClick={onGuardar}
          className="rounded-lg bg-marino px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-marino2">
          {textoBoton}
        </button>
      </div>
    </div>
  );
}

// Muestra una lista de personas agrupadas, como las respuestas de eventos y las lecturas de novedades.
export function ListaPersonas({ grupos, pie }) {
  const tonos = { ok: 'bg-verde-ok', warn: 'bg-acento', bad: 'bg-rojo', neutral: 'bg-gris' };
  return (
    <div className="mt-3 rounded-lg border border-borde bg-bg p-3">
      {grupos.map((g) => (
        <div key={g.titulo} className="mb-3 last:mb-0">
          <div className="mb-1.5 flex items-center gap-2 text-xs font-bold text-texto">
            <span className={`h-2 w-2 rounded-full ${tonos[g.tono] || tonos.neutral}`} />
            {g.titulo} ({g.items.length})
          </div>
          {g.items.length ? g.items.map((it) => (
            <div key={it.nodo} className="border-t border-borde/60 py-1.5 pl-4 first:border-t-0">
              <span className="text-[13px] font-medium text-texto">{it.nombre}</span>
              <span className="ml-2 text-[11px] text-gris">{it.meta}</span>
              {it.extra && (
                <div className="mt-0.5 text-xs italic text-gris">{it.extra}</div>
              )}
            </div>
          )) : (
            <p className="pl-4 text-xs italic text-gris">Nadie en este grupo.</p>
          )}
        </div>
      ))}
      {pie}
    </div>
  );
}

export function Confirmar({ texto, onCancelar, onBorrar }) {
  return (
    <div role="alert"
      className="mt-3 flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-[rgba(229,62,62,0.35)] bg-[rgba(229,62,62,0.08)] p-3">
      <span className="text-[13px] text-texto">{texto}</span>
      <div className="flex gap-2">
        <button type="button" onClick={onCancelar}
          className="rounded-md border border-borde bg-card px-2.5 py-1 text-[11px] font-semibold text-gris hover:text-marino">
          Cancelar
        </button>
        <button type="button" onClick={onBorrar}
          className="rounded-md border border-rojo bg-rojo px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-90">
          Sí, eliminar
        </button>
      </div>
    </div>
  );
}

export function BtnMini({ children, peligro, ...props }) {
  return (
    <button type="button"
      className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-40 ${
        peligro
          ? 'border-[rgba(229,62,62,0.4)] bg-card text-rojo hover:bg-[rgba(229,62,62,0.1)]'
          : 'border-borde bg-card text-gris hover:border-acento hover:text-marino'
      }`}
      {...props}>
      {children}
    </button>
  );
}

export function LinkBtn({ children, peligro, ...props }) {
  return (
    <button type="button"
      className={`text-[13px] font-semibold transition ${
        peligro ? 'text-rojo hover:underline' : 'text-gris hover:text-marino'
      }`}
      {...props}>
      {children}
    </button>
  );
}

// Muestra una insignia que, con ajustar, se parte en varias líneas en vez de desbordar la tarjeta.
export function Badge({ tono = 'neutral', children, title, ajustar = false }) {
  const tonos = {
    ok: 'border-[rgba(56,161,105,0.35)] bg-[rgba(56,161,105,0.12)] text-verde-ok',
    warn: 'border-[rgba(245,164,136,0.45)] bg-[rgba(245,164,136,0.14)] text-aviso-txt',
    bad: 'border-[rgba(229,62,62,0.35)] bg-[rgba(229,62,62,0.1)] text-rojo',
    info: 'border-[#3182ce]/35 bg-[#3182ce]/10 text-[var(--color-info-txt)]',
    accent: 'border-acento bg-acento text-marino',
    neutral: 'border-borde bg-card text-gris',
  };
  return (
    <span title={title}
      className={`inline-block border px-2.5 py-0.5 text-[11px] font-semibold ${
        ajustar ? 'max-w-full whitespace-normal rounded-xl text-left [overflow-wrap:anywhere]' : 'whitespace-nowrap rounded-full'
      } ${tonos[tono]}`}>
      {children}
    </span>
  );
}
