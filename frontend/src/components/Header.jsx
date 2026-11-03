// Cabecera y barra de pestañas, compartidas por los tres módulos: Bitácora, inventario y administración.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, KeyRound, Layers, LogOut } from 'lucide-react';
import { Btn, useBarraDeslizable } from './UI';
import { Confirmar } from '../inventario/componentes/ui';
import BotonTema from './BotonTema';
import { useIrA, conTransicion } from '../lib/transicion';

// Los tres módulos de la aplicación, con su nombre y su ruta de entrada.
const MODULOS = {
  bitacora:   { label: 'Bitácora',       ruta: '/' },
  inventario: { label: 'Inventario',     ruta: '/inventario' },
  admin:      { label: 'Administración', ruta: '/admin' },
};

// Pastillas para pasar de un módulo a otro, que solo salen si la persona tiene más de uno.
function SelectorModulo({ modulos, actual }) {
  const irA = useIrA();
  return (
    <div className="mx-auto flex max-w-6xl gap-1.5 overflow-x-auto px-3 pb-3 no-scrollbar sm:px-5" role="tablist" aria-label="Módulos">
      {modulos.map((m) => {
        const activo = m === actual;
        return (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={activo}
            onClick={() => !activo && irA(MODULOS[m].ruta)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-[background-color,color,box-shadow] duration-200 ${
              activo
                ? 'bg-acento text-marino shadow-[0_0_0_3px_rgba(245,164,136,0.18)]'
                : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
            }`}
          >
            {MODULOS[m].label}
          </button>
        );
      })}
    </div>
  );
}

// Cabecera; las pestañas con to son enlaces de ruta y las que no avisan por onSeccion, como en la Bitácora, que
// cambia de sección sin cambiar de dirección.
export default function Header({
  session, modulo, titulo, subtitulo, chip, tabs = [], seccion, onSeccion, onLogout, contadores = {},
}) {
  const irA = useIrA();
  const modulos = session?.modulos || [];
  const [confirmarSalida, setConfirmarSalida] = useState(false);

  const abrir = (t) => {
    if (t.to) irA(t.to);
    else conTransicion(() => onSeccion?.(t.id));
  };

  return (
    <>
      <header className="cabecera-app bg-marino">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-3 py-3 sm:px-5 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-acento text-marino shadow-lg shadow-black/25 ring-1 ring-white/20"
            >
              <Layers size={21} strokeWidth={2.4} />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold text-white sm:text-xl">{titulo}</h1>
              <p className="hidden text-[13px] text-white/60 sm:block">{subtitulo}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="hidden text-[13px] text-white/75 md:inline">{session?.label}</span>
            <BotonTema />
            <Link
              to="/cambiar-clave"
              aria-label="Cambiar clave"
              title="Cambiar clave"
              className="flex size-9 items-center justify-center rounded-lg border border-white/25 text-white/80 transition hover:border-acento hover:text-white"
            >
              <KeyRound size={16} aria-hidden="true" />
            </Link>
            <Btn
              variant="secondary"
              onClick={() => setConfirmarSalida(true)}
              className="!px-3 !py-1.5 !text-xs !bg-transparent !text-white !border-white/30 hover:!border-acento"
            >
              Salir
            </Btn>
            <Confirmar
              abierto={confirmarSalida}
              icono={LogOut}
              titulo="¿Seguro que quieres salir?"
              texto="Se cerrará tu sesión y tendrás que volver a ingresar con tu usuario y clave."
              etiquetaOk="Sí, salir"
              onOk={() => { setConfirmarSalida(false); onLogout?.(); }}
              onCancelar={() => setConfirmarSalida(false)}
            />
            {chip && (
              <span className="rounded-full bg-acento px-3 py-1.5 text-xs font-bold text-marino">{chip}</span>
            )}
          </div>
        </div>
        {modulos.length > 1 && <SelectorModulo modulos={modulos} actual={modulo} />}
      </header>

      {tabs.length > 0 && (
        <BarraSecciones tabs={tabs} seccion={seccion} contadores={contadores} abrir={abrir} />
      )}
    </>
  );
}

// Pestañas fijas arriba que, si no caben, se deslizan de lado con borde desvanecido y flechas.
function BarraSecciones({ tabs, seccion, contadores, abrir }) {
  const [mas, setMas] = useState({ izq: false, der: false });
  const barra = useBarraDeslizable(`${seccion}|${tabs.length}`, setMas);

  useEffect(() => {
    const el = barra.current;
    if (!el) return undefined;
    const rueda = (e) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollBy({ left: e.deltaY });
    };
    el.addEventListener('wheel', rueda, { passive: false });
    return () => el.removeEventListener('wheel', rueda);
  }, [barra]);

  const mover = (sentido) => barra.current?.scrollBy({ left: sentido * barra.current.clientWidth * 0.6, behavior: 'smooth' });

  const flecha = 'absolute top-0 z-10 hidden h-full w-9 items-center justify-center text-white/80 transition hover:text-acento sm:flex';

  return (
    <nav className="sticky top-0 z-20 border-b border-white/10 bg-marino2" aria-label="Secciones">
      <div className="relative mx-auto max-w-6xl">
        <div ref={barra} className="barra-deslizable scroll-al-pasar flex gap-0.5 overflow-x-auto px-3 sm:px-5">
          {tabs.map((t, i) => {
            const activa = seccion === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => abrir(t)}
                data-activa={activa}
                aria-current={activa ? 'page' : undefined}
                className={`shrink-0 whitespace-nowrap border-b-[3px] px-3 py-3 text-[13px] sm:px-[18px] sm:py-3.5 font-semibold transition-[background-color,color,border-color] duration-200 ${
                  i === 0 ? '-ml-3 sm:-ml-[18px]' : ''
                } ${
                  activa
                    ? 'border-acento text-acento'
                    : 'border-transparent text-white/60 hover:bg-white/5 hover:text-white'
                }`}
              >
                {t.label}
                {contadores[t.id] > 0 && (
                  <span className="ml-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-acento px-1 text-[10px] font-bold text-marino">
                    {contadores[t.id]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {mas.izq && (
          <button type="button" onClick={() => mover(-1)} aria-label="Ver pestañas anteriores" className={`${flecha} left-0`}>
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
        )}
        {mas.der && (
          <button type="button" onClick={() => mover(1)} aria-label="Ver más pestañas" className={`${flecha} right-0`}>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        )}
      </div>
    </nav>
  );
}
