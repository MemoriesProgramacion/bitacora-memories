// Componentes base compartidos con el inventario y la administración: botones, etiquetas, tarjetas, secciones
// colapsables, datos de la ficha, avisos e indicador de carga.
import { useState, useRef, useEffect, useCallback } from 'react';

// Hook para una barra de pestañas que se desliza de lado en celular; devuelve la referencia del contenedor y
// marca data-mas con los lados donde hay más contenido.
export function useBarraDeslizable(activa, alCambiar) {
  const ref = useRef(null);
  const aviso = useRef(alCambiar);
  aviso.current = alCambiar;

  const marcar = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const izq = el.scrollLeft > 4;
    const der = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    el.dataset.mas = izq && der ? 'ambos' : der ? 'derecha' : izq ? 'izquierda' : '';
    aviso.current?.({ izq, der });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    marcar();
    el.addEventListener('scroll', marcar, { passive: true });
    window.addEventListener('resize', marcar);
    return () => {
      el.removeEventListener('scroll', marcar);
      window.removeEventListener('resize', marcar);
    };
  }, [marcar]);

  useEffect(() => {
    const el = ref.current;
    const tab = el?.querySelector('[data-activa="true"]');
    if (!el || !tab) return;
    const r = tab.getBoundingClientRect();
    const centro = el.scrollLeft + (r.left - el.getBoundingClientRect().left) - (el.clientWidth - r.width) / 2;
    el.scrollTo({ left: Math.max(0, centro), behavior: 'smooth' });
    marcar();
  }, [activa, marcar]);

  return ref;
}


export function Btn({ variant = 'primary', className = '', ...props }) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 ' +
    'text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed';
  const variantes = {
    primary: 'bg-marino text-white hover:bg-marino2',
    secondary: 'border border-borde bg-card text-texto hover:border-acento',
    ghost: 'text-gris hover:text-texto',
  };
  return <button className={`${base} ${variantes[variant]} ${className}`} {...props} />;
}

// Pastilla de estado con tono ok, bad, warn o neutral.
export function Chip({ tono = 'neutral', children, className = '' }) {
  const tonos = { ok: 't-ok', bad: 't-bad', warn: 't-warn', neutral: 't-neutral' };
  const icono = tono === 'ok' ? '✓' : tono === 'bad' ? '✗' : tono === 'warn' ? '!' : '•';
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs ${tonos[tono]} ${className}`}>
      <b className="font-bold">{icono}</b> {children}
    </span>
  );
}

export function Card({ className = '', children }) {
  return (
    <div className={`rounded-card border border-borde bg-card ${className}`}>{children}</div>
  );
}

// Sección colapsable de la ficha; con mantener, plegarla solo la oculta y no se pierde lo escrito en sus
// formularios.
export function Seccion({ titulo, children, abierta = true, mantener = false }) {
  const [open, setOpen] = useState(abierta);
  return (
    <div className="seccion-pdf mb-3 overflow-hidden rounded-card border border-borde bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3.5 text-left"
      >
        <span className="text-base font-bold text-marino">{titulo}</span>
        <span aria-hidden="true" className={`text-gris transition-transform ${open ? 'rotate-180' : ''} no-print`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {mantener
        ? <div hidden={!open} className="border-t border-borde p-4">{children}</div>
        : open && <div className="border-t border-borde p-4">{children}</div>}
    </div>
  );
}

// Dato con etiqueta en la cuadrícula de la ficha; los textos muy largos se recortan con un enlace para
// desplegarlos y en el PDF se muestran completos.
export function InfoItem({ label, value, limite = 150 }) {
  const [abierto, setAbierto] = useState(false);
  const texto = value === null || value === undefined || value === '' ? '—' : String(value);
  const esLargo = texto.length > limite;

  return (
    <div className="rounded-lg bg-bg p-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gris">{label}</div>
      <div
        className={`text-sm font-medium break-words text-texto ${
          esLargo && !abierto ? 'line-clamp-3' : ''
        } [.pdf-export_&]:line-clamp-none`}
      >
        {texto}
      </div>
      {esLargo && (
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          className="no-print mt-1.5 text-[11px] font-bold uppercase tracking-wide text-acento-txt hover:underline"
        >
          {abierto ? 'Ver menos' : 'Ver más'}
        </button>
      )}
    </div>
  );
}

export function EncabezadoSeccion({ titulo, subtitulo }) {
  return (
    <>
      <h2 className="text-lg font-bold text-marino">{titulo}</h2>
      <p className="mb-5 text-[13px] text-gris">{subtitulo}</p>
    </>
  );
}

export function Aviso({ tono = 'warn', children, className = '' }) {
  const tonos = {
    warn: 't-warn border-l-acento',
    bad: 't-bad border-l-rojo',
    ok: 't-ok border-l-[#38a169]',
  };
  return (
    <div className={`mb-4 rounded-lg border border-l-4 px-3.5 py-2.5 text-xs ${tonos[tono]} ${className}`}>
      {children}
    </div>
  );
}

export function Spinner({ texto = 'Cargando datos...', sub }) {
  return (
    <div className="py-16 text-center">
      <div className="spinner" />
      <p className="text-sm text-gris">{texto}</p>
      {sub && <p className="mt-1 text-xs text-[rgba(138,143,158,0.7)]">{sub}</p>}
    </div>
  );
}
