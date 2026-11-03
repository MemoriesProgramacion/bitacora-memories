// E2 · Clasificación de la capitalización: formatos UNSPSC y CIIU, rubros agrupados, guía de la tenencia,
// cambios de la ficha (CIIU y actividad no financiable) y lo que muestra el panel del carrito.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import {
  formatoUnspsc, formatoCiiu, rubrosPorGrupo, tenenciaPideAnios, guiaTenencia, nombreDe,
} from '../src/lib/clasificacion.js';
import { CAMPOS_UP, armarCambios } from '../src/lib/fichaUP.js';
import PanelCarrito from '../src/sections/capitalizacion/PanelCarrito';

const TENENCIAS = [
  { codigo: 'propia', nombre: 'Propia', anios_minimos: null },
  { codigo: 'comodato', nombre: 'Comodato', anios_minimos: 5 },
  { codigo: 'arriendo', nombre: 'Arriendo', anios_minimos: 3 },
  { codigo: 'otra', nombre: 'Otra (permiso o posesión)', anios_minimos: null },
];

describe('formatos', () => {
  it('UNSPSC: 6 dígitos o vacío', () => {
    expect(formatoUnspsc('101015')).toBe(true);
    expect(formatoUnspsc('')).toBe(true);
    expect(formatoUnspsc(' 101015 ')).toBe(true);
    for (const v of ['10101', '1010150', '10a015', '10101501']) expect(formatoUnspsc(v), v).toBe(false);
  });
  it('CIIU: 4 dígitos o vacío', () => {
    expect(formatoCiiu('1071')).toBe(true);
    expect(formatoCiiu('')).toBe(true);
    for (const v of ['107', '10712', 'A107']) expect(formatoCiiu(v), v).toBe(false);
  });
});

describe('listas del Anexo', () => {
  it('agrupa los rubros como en el Anexo, conservando el orden', () => {
    const g = rubrosPorGrupo([
      { codigo: 'a', grupo: 'Dotación', nombre: 'A' }, { codigo: 'b', grupo: 'Capital semilla', nombre: 'B' },
      { codigo: 'c', grupo: 'Dotación', nombre: 'C' },
    ]);
    expect(g.map((x) => x.grupo)).toEqual(['Dotación', 'Capital semilla']);
    expect(g[0].items.map((x) => x.codigo)).toEqual(['a', 'c']);
  });
  it('nombre de un código, o el código si no está', () => {
    expect(nombreDe([{ codigo: 'x', nombre: 'Equis' }], 'x')).toBe('Equis');
    expect(nombreDe([], 'y')).toBe('y');
    expect(nombreDe([], null)).toBe('');
  });
});

describe('guía de la tenencia (la regla la aplica el servidor)', () => {
  it('pide años solo en comodato y arriendo', () => {
    expect(tenenciaPideAnios(TENENCIAS, 'comodato')).toBe(true);
    expect(tenenciaPideAnios(TENENCIAS, 'arriendo')).toBe(true);
    expect(tenenciaPideAnios(TENENCIAS, 'propia')).toBe(false);
  });
  it('habilita adecuaciones: propia, comodato ≥ 5 o arriendo ≥ 3, siempre con certificación', () => {
    expect(guiaTenencia(TENENCIAS, 'propia', '', true).habilita).toBe(true);
    expect(guiaTenencia(TENENCIAS, 'propia', '', false).texto).toMatch(/certificación/);
    expect(guiaTenencia(TENENCIAS, 'comodato', '4', true).habilita).toBe(false);
    expect(guiaTenencia(TENENCIAS, 'comodato', '5', true).habilita).toBe(true);
    expect(guiaTenencia(TENENCIAS, 'arriendo', '2,5', true).habilita).toBe(false);
    expect(guiaTenencia(TENENCIAS, 'arriendo', '3', true).habilita).toBe(true);
    expect(guiaTenencia(TENENCIAS, 'arriendo', '', true).texto).toMatch(/cuántos años/);
    expect(guiaTenencia(TENENCIAS, 'otra', '', true).habilita).toBe(false);
    expect(guiaTenencia(TENENCIAS, '', '', true).texto).toMatch(/Elige/);
  });
});

describe('ficha de la UP: CIIU y actividad no financiable', () => {
  const vacio = (c) => Object.fromEntries(CAMPOS_UP.map((x) => [x.k, c[x.k] ?? '']));
  it('los campos existen con su tipo', () => {
    expect(CAMPOS_UP.find((c) => c.k === 'ciiu').tipo).toBe('ciiu');
    expect(CAMPOS_UP.find((c) => c.k === 'actividad_no_financiable')).toMatchObject({ tipo: 'lista', lista: 'actividades_no_financiables' });
  });
  it('manda solo lo que cambió, y vacío como null para quitar la marca', () => {
    const inicial = { up: vacio({ actividad_no_financiable: 'juegos_azar' }), representante: {}, expediente: null };
    const actual = { up: vacio({ ciiu: '1071', actividad_no_financiable: '' }), representante: {}, expediente: null };
    expect(armarCambios(inicial, actual).datos_up).toEqual({ ciiu: '1071', actividad_no_financiable: null });
  });
});

describe('panel del carrito', () => {
  const carrito = (extra = {}) => ({
    cargando: false, ocupado: false, tenencia: () => {}, justificar: () => {}, fijar: () => {}, datos: () => {},
    estado: () => {}, vaciar: () => {},
    vista: {
      carrito: {
        id_unico: '2', nombre_up: 'Panadería', nodo: 'ATLAN1', estado: 'borrador', presupuesto_maximo: 5000000,
        monto_transporte: 0, transporte_descontado: false, objetivo_plan: '', puede_editar: true,
        puede_definir_presupuesto: false, puede_enviar: true, puede_resolver: false,
      },
      lineas: [{
        id: 7, id_producto: 3, nombre: 'Computador portátil', cantidad: 1, precio: 2000000, iva: 19, total: 2380000,
        rubro: 'equipos_computo', rubro_nombre: 'Equipos de cómputo (solo justificados)', unspsc: '432115',
        requiere_justificacion: true, justificacion: null, faltas: ['es un equipo de cómputo y le falta la justificación'],
      }],
      resumen: { subtotal: 2000000, iva: 380000, total: 2380000, transporte: 0, presupuesto_maximo: 5000000, presupuesto_productos: 5000000, saldo: 2620000, excede: false },
      clasificacion: {
        actividad_no_financiable: null, tenencia: null, puede_registrar_tenencia: true,
        problemas_envio: ['«Computador portátil» es un equipo de cómputo y le falta la justificación.'],
        ...extra,
      },
    },
  });

  it('muestra lo que falta, pide la justificación y no deja enviar', () => {
    const html = renderToStaticMarkup(createElement(PanelCarrito, { carrito: carrito() }));
    expect(html).toContain('Para enviar el plan falta:');
    expect(html).toContain('Justificación del equipo de cómputo');
    expect(html).toContain('Es un equipo de cómputo y le falta la justificación.');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*Enviar a revisión/s);
    expect(html).toContain('Registrar tenencia');
  });

  it('avisa la actividad no financiable y muestra la tenencia registrada', () => {
    const html = renderToStaticMarkup(createElement(PanelCarrito, { carrito: carrito({
      actividad_no_financiable: 'juegos_azar', actividad_no_financiable_nombre: 'Juegos de azar',
      tenencia: { tipo: 'arriendo', tipo_nombre: 'Arriendo', anios: 3, soporte: '2/TENENCIA_1.pdf',
        soporte_url: '/archivos/tenencias/2/TENENCIA_1.pdf', habilita_adecuaciones: true },
      puede_registrar_tenencia: false,
    }) }));
    expect(html).toContain('no es financiable (Juegos de azar)');
    expect(html).toContain('Arriendo · 3 años');
    expect(html).toContain('href="/api/archivos/tenencias/2/TENENCIA_1.pdf"');
    expect(html).toContain('Habilita adecuaciones');
    expect(html).not.toContain('Registrar tenencia');
  });
});
