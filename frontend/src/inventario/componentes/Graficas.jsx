// Gráficas del panel del inventario, hechas a mano con SVG y CSS sin librerías: pesan poco, se adaptan al ancho
// y usan los colores del tema. Cada una avisa con un texto alternativo qué muestra y deja el detalle exacto en
// el tooltip.
import { Vacio } from './ui';

// Convierte números largos en cortos para los ejes y etiquetas: 3.780.000 pasa a 3,8 M.
export function compacto(n) {
  const v = Math.abs(n);
  const con = (x, sufijo) => `${(Math.round(x * 10) / 10).toLocaleString('es-CO')}${sufijo}`;
  if (v >= 1e9) return con(n / 1e9, ' mil M');
  if (v >= 1e6) return con(n / 1e6, ' M');
  if (v >= 1e4) return con(n / 1e3, ' mil');
  return Math.round(n).toLocaleString('es-CO');
}

export const pesosCorto = (n) => `$ ${compacto(n)}`;

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Convierte 2026-05 en may.
export const mesCorto = (mes) => MESES[Number(String(mes).slice(5, 7)) - 1] || mes;

// Convierte 2026-10-07 en 7 oct.
export const diaCorto = (dia) => `${Number(String(dia).slice(8, 10))} ${MESES[Number(String(dia).slice(5, 7)) - 1]}`;

// Calcula una escala redonda para el eje vertical, con un paso de 1, 2 o 5 por una potencia de diez que deje a
// lo sumo cinco divisiones.
function escala(max) {
  if (max <= 0) return { tope: 1, marcas: [0, 1] };
  const base = 10 ** Math.floor(Math.log10(max));
  const paso = [base / 10, base / 5, base / 2, base, base * 2, base * 5].find((p) => max / p <= 5) ?? base * 10;
  const tope = Math.ceil(max / paso) * paso;
  const marcas = Array.from({ length: Math.round(tope / paso) + 1 }, (_, i) => i * paso);
  return { tope, marcas };
}

const tintaFuerte = { fill: 'var(--tinta)' };
const tintaSuave = { fill: 'var(--color-gris-txt)' };

// Barras horizontales para comparar cantidades entre nombres.
export function BarrasH({ items, formato = (n) => n.toLocaleString('es-CO'), color = 'var(--graf-azul)', vacio }) {
  const lista = (items || []).filter((i) => i.valor > 0);
  if (lista.length === 0) return <Vacio>{vacio || 'Todavía no hay datos para mostrar.'}</Vacio>;
  const max = Math.max(...lista.map((i) => i.valor));

  return (
    <ul className="flex flex-col gap-3">
      {lista.map((it) => (
        <li key={it.nombre}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate font-medium text-marca" title={it.nombre}>{it.nombre}</span>
            <span className="cifras shrink-0 font-semibold text-marca">{formato(it.valor)}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-lienzo" role="presentation">
            <div
              className="graf-barra h-full rounded-full"
              style={{ width: `${Math.max(2, (it.valor / max) * 100)}%`, background: color }}
            />
          </div>
          {it.extra && <div className="mt-0.5 text-[11px] text-gris-txt">{it.extra}</div>}
        </li>
      ))}
    </ul>
  );
}

// Dona para ver cómo se reparte un total en partes.
export function Donut({ partes, centro, texto, vacio }) {
  const total = partes.reduce((n, p) => n + p.valor, 0);
  if (total === 0) return <Vacio>{vacio || 'Todavía no hay datos para mostrar.'}</Vacio>;

  const R = 54;
  const C = 2 * Math.PI * R;
  const visibles = partes.filter((p) => p.valor > 0);
  const hueco = visibles.length > 1 ? 2 : 0;
  let acumulado = 0;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-7">
      <svg
        viewBox="0 0 140 140"
        className="size-40 shrink-0"
        role="img"
        aria-label={`${texto}: ${partes.map((p) => `${p.etiqueta} ${p.valor}`).join(', ')}`}
      >
        <circle cx="70" cy="70" r={R} fill="none" strokeWidth="18" style={{ stroke: 'var(--color-lienzo)' }} />
        {visibles.map((p) => {
          const largo = (p.valor / total) * C;
          const tramo = (
            <circle
              key={p.etiqueta}
              className="graf-dona"
              cx="70" cy="70" r={R} fill="none" strokeWidth="18"
              stroke={p.color}
              strokeDasharray={`${Math.max(largo - hueco, 0.5)} ${C}`}
              strokeDashoffset={-acumulado}
              transform="rotate(-90 70 70)"
            >
              <title>{`${p.etiqueta}: ${p.valor.toLocaleString('es-CO')}`}</title>
            </circle>
          );
          acumulado += largo;
          return tramo;
        })}
        <text x="70" y="70" textAnchor="middle" fontSize="26" fontWeight="700" style={tintaFuerte}>{centro}</text>
        <text x="70" y="90" textAnchor="middle" fontSize="11" style={tintaSuave}>{texto}</text>
      </svg>

      <ul className="flex w-full min-w-0 flex-1 flex-col gap-2.5">
        {partes.map((p) => (
          <li key={p.etiqueta} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="flex min-w-0 items-center gap-2 text-marca">
              <span className="size-3 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden="true" />
              <span className="truncate">{p.etiqueta}</span>
            </span>
            <span className="cifras shrink-0 font-semibold text-marca">
              {p.valor.toLocaleString('es-CO')}
              <span className="ml-1.5 font-normal text-gris-txt">{Math.round((p.valor / total) * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Columnas agrupadas en el tiempo, con una o varias series.
export function Columnas({
  datos, series, rotulo, formato = (n) => n.toLocaleString('es-CO'), formatoEje = compacto,
  descripcion, alto = 200, ancho: anchoTotal = 560, className = '',
}) {
  const hayDatos = datos.some((d) => series.some((s) => d[s.clave] > 0));
  if (!hayDatos) return <div className={className}><Vacio>Todavía no hay datos en este periodo.</Vacio></div>;

  const W = anchoTotal;
  const izq = 46;
  const abajo = 26;
  const arriba = 10;
  const H = alto + abajo + arriba;
  const ancho = W - izq - 6;
  const { tope, marcas } = escala(Math.max(...datos.flatMap((d) => series.map((s) => d[s.clave] || 0))));
  const casilla = ancho / datos.length;
  const gruesoTotal = Math.min(casilla * 0.72, 34 * series.length);
  const grueso = gruesoTotal / series.length;
  const paso = Math.ceil(datos.length / 8);

  return (
    <figure className={className}>
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
        {series.map((s) => (
          <span key={s.clave} className="flex items-center gap-2 text-marca">
            <span className="size-3 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
            {s.etiqueta}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={descripcion}>
        {marcas.map((m) => {
          const y = arriba + alto * (1 - m / tope);
          return (
            <g key={m}>
              <line x1={izq} x2={W - 6} y1={y} y2={y} strokeWidth="1" style={{ stroke: 'var(--color-borde)' }} />
              <text x={izq - 8} y={y + 4} textAnchor="end" fontSize="12" style={tintaSuave}>{formatoEje(m)}</text>
            </g>
          );
        })}
        {datos.map((d, i) => {
          const x0 = izq + casilla * i + (casilla - gruesoTotal) / 2;
          return (
            <g key={i}>
              {series.map((s, j) => {
                const v = d[s.clave] || 0;
                const h = (v / tope) * alto;
                return (
                  <rect
                    key={s.clave}
                    className="graf-columna"
                    x={x0 + grueso * j + 0.5}
                    y={arriba + alto - h}
                    width={Math.max(grueso - 1, 1)}
                    height={h}
                    rx="2"
                    fill={s.color}
                  >
                    <title>{`${rotulo(d)} · ${s.etiqueta}: ${formato(v)}`}</title>
                  </rect>
                );
              })}
              {i % paso === 0 && (
                <text x={izq + casilla * i + casilla / 2} y={H - 6} textAnchor="middle" fontSize="12" style={tintaSuave}>
                  {rotulo(d)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

// Barra chica para meter dentro de una tabla, por ejemplo el stock frente al mínimo; pct va de 0 a 100.
export function MiniBarra({ pct, color }) {
  return (
    <div className="h-2 w-24 overflow-hidden rounded-full bg-lienzo" role="presentation">
      <div className="graf-barra h-full rounded-full" style={{ width: `${Math.min(100, Math.max(pct > 0 ? 4 : 0, pct))}%`, background: color }} />
    </div>
  );
}
