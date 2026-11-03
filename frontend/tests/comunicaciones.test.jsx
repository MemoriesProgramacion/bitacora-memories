// Eventos y Avisos (LIT-e-02, LIT-h-02): los destinatarios son los gestores reales del alcance, que trae
// GET /api/gestores; la app no trae gestores de ejemplo. Y las ayudas de fechas y horas de las dos secciones.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Cada prueba arranca con el módulo limpio: la lista de gestores vive en el módulo.
let c;
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('window', { location: { origin: 'http://localhost' }, dispatchEvent: () => true });
  c = await import('../src/lib/comunicaciones');
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const respuesta = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
const DEL_SERVIDOR = [
  { nodo: 'atlan1 ', nombre: 'Gestora Uno', region: 'Región 1', departamento: 'Atlántico', modalidades: ['M1', 'M2'], ups: 12 },
  { nodo: 'ATLAN2', nombre: 'Gestor Dos', region: 'Región 1', departamento: 'Atlántico', modalidades: ['M1'], ups: 3 },
  { nodo: 'BOLIV1', nombre: 'Gestora Tres', region: 'Región 2', departamento: 'Bolívar', modalidades: [], ups: 0 },
];

describe('gestores de Eventos y Avisos', () => {
  it('la app nace sin gestores de ejemplo', () => {
    expect(c.GESTORES).toEqual([]);
    expect(c.destLabel([])).toBe('Nadie');
    expect(c.nombreGestor('ATLAN1')).toBe('ATLAN1');
  });

  it('normaliza lo que entrega el servidor y no repite nodos', () => {
    expect(c.aGestor({ nodo: ' x9 ', departamento: null, modalidades: null })).toEqual({
      nodo: 'X9', nombre: 'x9', region: 'Sin región', dpto: 'Sin departamento', modalidades: [], ups: 0,
    });
    c.fijarGestores([...DEL_SERVIDOR, { nodo: 'ATLAN1', nombre: 'Repetido' }]);
    expect(c.GESTORES.map((g) => g.nodo)).toEqual(['ATLAN1', 'ATLAN2', 'BOLIV1']);
    expect(c.nombreGestor('ATLAN1')).toBe('Gestora Uno');
    expect(c.metaGestor('BOLIV1')).toBe('BOLIV1 · Bolívar');
  });

  it('las etiquetas de destinatarios salen de la lista real', () => {
    c.fijarGestores(DEL_SERVIDOR);
    expect(c.todosNodos()).toEqual(['ATLAN1', 'ATLAN2', 'BOLIV1']);
    expect(c.nodosDeRegion('Región 1')).toEqual(['ATLAN1', 'ATLAN2']);
    expect(c.destLabel(['ATLAN1', 'ATLAN2', 'BOLIV1'])).toBe('Todos los gestores');
    expect(c.destLabel(['ATLAN2', 'ATLAN1'])).toBe('Región 1');
    expect(c.destLabel(['BOLIV1'])).toBe('Gestora Tres');
    expect(c.ordenGestores(['BOLIV1', 'ZZZ', 'ATLAN1'])).toEqual(['ATLAN1', 'BOLIV1', 'ZZZ']);
  });

  it('se piden una vez por sesión; el gestor no los pide; si fallan se puede reintentar', async () => {
    const fetch = vi.fn(async () => respuesta({ ok: true, items: DEL_SERVIDOR }));
    vi.stubGlobal('fetch', fetch);
    await c.cargarGestores({ role: 'gestor', nodo: 'ATLAN1' });
    expect(fetch).not.toHaveBeenCalled();

    const clr = { role: 'coordinador', correo: 'clr@x.co' };
    await Promise.all([c.cargarGestores(clr), c.cargarGestores(clr)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toBe('http://localhost/api/gestores');
    expect(c.GESTORES).toHaveLength(3);

    // Otra sesión: lo del usuario anterior se borra y se piden los de su alcance.
    fetch.mockImplementationOnce(async () => respuesta({ ok: false, error: 'Falla' }, 500));
    await c.cargarGestores({ role: 'coordinador', correo: 'otra@x.co' });
    expect(c.GESTORES).toEqual([]);
    fetch.mockImplementationOnce(async () => respuesta({ ok: true, items: DEL_SERVIDOR.slice(2) }));
    await c.cargarGestores({ role: 'coordinador', correo: 'otra@x.co' });
    expect(c.GESTORES.map((g) => g.nodo)).toEqual(['BOLIV1']);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('el selector de destinatarios pinta los gestores reales o dice que no hay', async () => {
    const { default: Destinatarios, destNuevo } = await import('../src/components/Destinatarios');
    const { FormPie } = await import('../src/components/FormPiezas');
    const pintar = (sel) => renderToStaticMarkup(createElement(Destinatarios, { d: destNuevo(sel), onChange: () => {} }));

    const vacio = pintar([]);
    expect(vacio).toContain('Todavía no hay gestores activos en tu alcance.');
    expect(vacio).toContain('<b>0</b> de 0 gestores');

    c.fijarGestores(DEL_SERVIDOR);
    const lleno = pintar(['BOLIV1']);
    expect(lleno).toContain('<b>1</b> de 3 gestores');
    expect(lleno).toContain('Gestora Tres');
    expect(lleno).toContain('Región 1');
    expect(lleno).not.toContain('Carlos Pérez');
    const pie = renderToStaticMarkup(createElement(FormPie, { sel: c.todosNodos(), textoBoton: 'Publicar', onCancelar() {}, onGuardar() {} }));
    expect(pie).toContain('Se enviará a todos los gestores (3)');
  });

  // Un aviso guardado para ATLAN1, ATLAN2 y ATLAN9 cuyo gestor de ATLAN9 se desactivó: se compara por conjuntos.
  it('un destinatario guardado sin gestor activo no cuenta como de la lista', async () => {
    const { FormPie } = await import('../src/components/FormPiezas');
    const pie = (sel, editando = false) => renderToStaticMarkup(createElement(FormPie,
      { sel, editando, textoBoton: 'Publicar', onCancelar() {}, onGuardar() {} }));
    c.fijarGestores(DEL_SERVIDOR);

    expect(c.destLabel(['ATLAN1', 'ATLAN2', 'ATLAN9'])).toBe('3 gestores'); // mismo número que la lista, no «todos»
    expect(c.destLabel(['ATLAN1', 'ATLAN2', 'BOLIV1', 'ATLAN9'])).toBe('4 gestores');
    expect(c.destLabel(['ATLAN1', 'ATLAN1', 'ATLAN2', 'BOLIV1'])).toBe('Todos los gestores'); // repetidos no suman
    expect(c.destLabel(['ATLAN9'])).toBe('ATLAN9');

    expect(pie(['ATLAN1', 'ATLAN2', 'ATLAN9'])).toContain('Se enviará a 2 gestores: Región 1 y a 1 nodo sin gestor activo (ATLAN9)');
    expect(pie(['ATLAN1', 'ATLAN2', 'ATLAN9'], true)).toContain('Lo verán 2 gestores: Región 1 y 1 nodo sin gestor activo (ATLAN9)');
    const todosMas = pie(['ATLAN1', 'ATLAN2', 'BOLIV1', 'ATLAN9']);
    expect(todosMas).toContain('Se enviará a 3 gestores (todos los activos) y a 1 nodo sin gestor activo (ATLAN9)');
    expect(todosMas).not.toContain('todos los gestores (');
    expect(pie(['ATLAN9'])).toContain('Se enviará a 1 nodo sin gestor activo (ATLAN9)');

    // Sin lista (no llegó o no hay nadie activo) tampoco es «todos».
    c.fijarGestores([]);
    expect(c.destLabel(['ATLAN9', 'BOLIV1'])).toBe('2 gestores');
  });

  it('el selector muestra el huérfano como chip quitable y «Seleccionar todos» suma sin descartarlo', async () => {
    const { default: Destinatarios, destNuevo } = await import('../src/components/Destinatarios');
    c.fijarGestores(DEL_SERVIDOR);

    // Se pinta llamando al componente dentro de un render: así queda el árbol para buscar los botones.
    const pintar = (sel) => {
      const cambios = [];
      let arbol = null;
      const Envoltura = () => { arbol = Destinatarios({ d: destNuevo(sel), onChange: (x) => cambios.push(x) }); return arbol; };
      const html = renderToStaticMarkup(createElement(Envoltura));
      return { html, cambios, boton: (texto) => buscar(arbol, (el) => el?.props?.children === texto) };
    };

    const parcial = pintar(['ATLAN1', 'ATLAN2', 'ATLAN9']);
    expect(parcial.html).toContain('<b>2</b> de 3 gestores');
    expect(parcial.html).toContain('ATLAN9 · sin gestor activo');
    expect(parcial.html).toContain('aria-label="Quitar ATLAN9, sin gestor activo"');
    expect(parcial.html).toContain('text-acento">Región 1</span>'); // la etiqueta habla solo de los de la lista
    expect(parcial.boton('Seleccionar todos').props.disabled).toBe(false);
    parcial.boton('Seleccionar todos').props.onClick();
    expect(parcial.cambios.at(-1).sel).toEqual(['ATLAN1', 'ATLAN2', 'ATLAN9', 'BOLIV1']);

    const todos = pintar(['ATLAN1', 'ATLAN2', 'BOLIV1', 'ATLAN9']);
    expect(todos.html).toContain('<b>3</b> de 3 gestores');
    expect(todos.html).toContain('ATLAN9 · sin gestor activo'); // con todos los de la lista marcados, el huérfano sigue a la vista
    expect(todos.html).not.toContain('aria-label="Quitar a Gestora Uno"');
    expect(todos.boton('Seleccionar todos').props.disabled).toBe(true);

    const soloHuerfano = pintar(['ATLAN9']);
    expect(soloHuerfano.html).toContain('<b>0</b> de 3 gestores');
    expect(soloHuerfano.html).toContain('ATLAN9 · sin gestor activo');
    expect(soloHuerfano.html).not.toContain('Marca una región completa');
    expect(soloHuerfano.boton('Quitar todos').props.disabled).toBe(false);
  });

  it('si la carga falla, el selector lo dice y deja reintentar; la siguiente llamada vuelve a pedir', async () => {
    const { default: Destinatarios, destNuevo } = await import('../src/components/Destinatarios');
    const { ComunicacionesProvider } = await import('../src/hooks/useComunicaciones');
    const clr = { role: 'coordinador', correo: 'clr@x.co' };
    let arbol = null;
    const Envoltura = () => { arbol = Destinatarios({ d: destNuevo([]), onChange: () => {} }); return arbol; };
    const pintar = () => renderToStaticMarkup(createElement(ComunicacionesProvider, { session: clr }, createElement(Envoltura)));

    const fetch = vi.fn(async () => respuesta({ ok: false, error: 'Falla' }, 500));
    vi.stubGlobal('fetch', fetch);
    await c.cargarGestores({ role: 'tallerista', correo: 't@x.co' }); // el Tallerista no usa /api/gestores
    expect(fetch).not.toHaveBeenCalled();

    const enCamino = c.cargarGestores(clr);
    expect(pintar()).toContain('Cargando gestores…');
    await enCamino;
    const fallo = pintar();
    expect(fallo).toContain('No se pudieron cargar los gestores.');
    expect(fallo).toContain('Reintentar');
    expect(fallo).not.toContain('Todavía no hay gestores activos en tu alcance.');

    // «Reintentar» vuelve a pedir con la sesión del provider y llena la lista.
    fetch.mockImplementationOnce(async () => respuesta({ ok: true, items: DEL_SERVIDOR }));
    buscar(arbol, (el) => el?.props?.children === 'Reintentar').props.onClick();
    await c.cargarGestores(clr); // el mismo pedido en camino: no se repite
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(c.GESTORES.map((g) => g.nodo)).toEqual(['ATLAN1', 'ATLAN2', 'BOLIV1']);
    const lleno = pintar();
    expect(lleno).toContain('<b>0</b> de 3 gestores');
    expect(lleno).not.toContain('No se pudieron cargar los gestores.');
  });

  it('tras un fallo, una nueva llamada a cargarGestores vuelve a pedir', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetch);
    const clr = { role: 'coordinador', correo: 'clr@x.co' };
    await c.cargarGestores(clr);
    expect(c.GESTORES).toEqual([]);
    fetch.mockImplementationOnce(async () => respuesta({ ok: true, items: DEL_SERVIDOR }));
    await c.cargarGestores(clr);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(c.GESTORES).toHaveLength(3);
    await c.cargarGestores(clr); // ya cargados: no se piden otra vez
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

// Busca en un árbol de elementos de React el primero que cumpla la condición.
function buscar(nodo, cumple) {
  if (!nodo || typeof nodo !== 'object') return null;
  if (Array.isArray(nodo)) {
    for (const hijo of nodo) { const r = buscar(hijo, cumple); if (r) return r; }
    return null;
  }
  if (cumple(nodo)) return nodo;
  return buscar(nodo.props?.children, cumple);
}

describe('fechas y horas de Eventos y Avisos', () => {
  it('horas en 12 horas, de ida y vuelta', () => {
    expect(c.horaLegible('00:05')).toBe('12:05 a. m.');
    expect(c.horaLegible('13:30')).toBe('1:30 p. m.');
    expect(c.horaLegible('')).toBe('');
    expect(c.horaDecompuesta('12:00')).toEqual({ h: '12', m: '00', ap: 'PM' });
    expect(c.horaCompuesta('12', '15', 'AM')).toBe('00:15');
    expect(c.horaCompuesta('7', '45', 'PM')).toBe('19:45');
    expect(c.horaCompuesta('', '45', 'PM')).toBe('');
  });

  it('cuándo, relativo a hoy', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 10, 0));
    expect(c.hoyISO()).toBe('2026-10-24');
    expect(c.cuandoRelativo('2026-10-24')).toBe('hoy');
    expect(c.cuandoRelativo('2026-10-25')).toBe('mañana');
    expect(c.cuandoRelativo('2026-10-23')).toBe('ayer');
    expect(c.cuandoRelativo('2026-10-30')).toBe('en 6 días');
    expect(c.publicadoRelativo('2026-10-20')).toBe('Hace 4 días');
    expect(c.esPasado('2026-10-23')).toBe(true);
    expect(c.fechaLarga('2026-10-24')).toBe('Sábado 24 de octubre de 2026');
  });

  it('plural, normalizar y únicos', () => {
    expect(c.plural(1, 'gestor', 'gestores')).toBe('1 gestor');
    expect(c.plural(2, 'gestor', 'gestores')).toBe('2 gestores');
    expect(c.norm('Bolívar')).toBe('bolivar');
    expect(c.unicos(['b', '', 'a', 'b', null])).toEqual(['a', 'b']);
  });
});
