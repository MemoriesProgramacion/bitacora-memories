// E12 · Seguimiento, indicadores y reportes: pestañas por rol, Excel de la ruta, KOKAN, metas y formularios.
// Las reglas son del servidor (backend/src/servicios/seguimiento.js, metas.js, casos.js y comercial.js); las listas deben ser las mismas.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Seguimiento from '../src/sections/Seguimiento';
import {
  GESTION_CON_ENTIDAD, TIPOS_CASO, TIPOS_GESTION, TOTAL_PROGRAMA, cargoDe, columnasConsolidado, columnasKokan, columnasRuta, csvKokan,
  columnasSoportes, textoVersion, faltasCaso, faltasGestion, filtrarRuta, metasParaEnviar, nombrePeriodo, pct, pestanaPorTecla, pestanasSeguimiento, periodosRecientes, porSerie,
  problemaRango, problemasMetas, separarRuta, textoPaso, textoSoporte, tituloAlerta, totalMetas, ultimoPedido,
} from '../src/lib/seguimiento';
import { DICCIONARIO_KOKAN, PASOS, SERIES } from '../../backend/src/servicios/seguimiento.js';
import { TOTAL_PROGRAMA as TOTAL_SERVIDOR } from '../../backend/src/servicios/metas.js';
import { TIPOS_CASO as CASOS_SERVIDOR } from '../../backend/src/servicios/casos.js';
import { TIPOS_GESTION as GESTION_SERVIDOR } from '../../backend/src/servicios/comercial.js';

const png = { name: 'foto.png' };
const pdf = { name: 'acta.pdf' };

describe('pestañas de Seguimiento por rol (DOC-05)', () => {
  it('el nivel nacional ve todo; el gestor, casos y gestión comercial; un rol que no existe, nada', () => {
    expect(pestanasSeguimiento({ role: 'coordinador_datos' })).toEqual(['panel', 'ruta', 'alertas', 'formacion', 'salida', 'informes', 'metas', 'casos', 'comercial', 'multimedia']);
    expect(pestanasSeguimiento({ role: 'entidad' })).toEqual([]);   // rol retirado en E14
    expect(pestanasSeguimiento({ role: 'gestor' })).toEqual(['casos', 'comercial']);
    expect(pestanasSeguimiento({ role: 'coordinador_compras' })).toEqual(['panel', 'ruta', 'alertas', 'formacion', 'salida', 'informes', 'metas', 'casos', 'comercial']);
    expect(pestanasSeguimiento({ role: 'tecnico_administrativo' })).toContain('multimedia');
    expect(pestanasSeguimiento({ role: 'coordinador' })).toContain('multimedia');
    expect(pestanasSeguimiento({ role: 'tallerista' })).toEqual([]);
    expect(pestanasSeguimiento(null)).toEqual([]);
  });
  it('patrón de pestañas: cada pestaña controla su panel y solo la activa está en el orden de tabulación', () => {
    const html = renderToStaticMarkup(createElement(Seguimiento, { session: { role: 'coordinador_datos' } }));
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/id="seguimiento-tab-panel"[^>]*aria-selected="true"[^>]*aria-controls="seguimiento-panel-panel"[^>]*tabindex="0"/);
    expect(html).toMatch(/id="seguimiento-tab-informes"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
    expect(html).not.toContain('aria-controls="seguimiento-panel-informes"');
    expect(html).toMatch(/role="tabpanel" id="seguimiento-panel-panel" aria-labelledby="seguimiento-tab-panel"/);
  });
  it('flechas, Inicio y Fin recorren las pestañas en círculo', () => {
    const ids = ['panel', 'informes', 'metas'];
    expect(['ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter'].map((k) => pestanaPorTecla(ids, 'panel', k))).toEqual(['informes', 'metas', 'panel', 'metas', null]);
    expect(pestanaPorTecla(ids, 'metas', 'ArrowRight')).toBe('panel');
    expect(pestanaPorTecla([], 'panel', 'ArrowRight')).toBeNull();
  });
});

describe('respuestas viejas (Casos y Gestión comercial)', () => {
  it('solo el último pedido sigue vigente', () => {
    const nuevoPedido = ultimoPedido();
    const cliente = nuevoPedido();
    const canal = nuevoPedido();
    expect([cliente(), canal()]).toEqual([false, true]);
    nuevoPedido(); // al desmontar o cambiar el filtro, ninguno de los anteriores pinta
    expect(canal()).toBe(false);
  });
});

describe('panel y alertas (DOC-05, DOC-06)', () => {
  it('la subsanación pendiente va aparte en el avance de la ruta: es una espera, no un paso cumplido', () => {
    const ruta = PASOS.map((p) => ({ clave: p.clave, nombre: p.nombre, n: 1, porcentaje: 10 }));
    const { pasos, espera } = separarRuta(ruta);
    expect(pasos.map((x) => x.clave)).toEqual(PASOS.filter((p) => !p.pendiente).map((p) => p.clave));
    expect(espera.map((x) => x.clave)).toEqual(['subsanacion']);
    expect(separarRuta([{ clave: 'otra', pendiente: true }]).espera).toHaveLength(1);
    expect(separarRuta(undefined)).toEqual({ pasos: [], espera: [] });
  });
  it('el título de la alerta nunca dice «Nodo null»', () => {
    expect(tituloAlerta({ tipo: 'v3_pendiente', id_unico: 'A-1', unidad: 'Panadería', nodo: 'ATLAN1' })).toBe('A-1 · Panadería');
    expect(tituloAlerta({ tipo: 'gestor_cerca_tope', id_unico: null, unidad: null, nodo: 'ATLAN1' })).toBe('Nodo ATLAN1');
    expect(tituloAlerta({ tipo: 'defectuoso_abierto', id_unico: null, unidad: null, nodo: null, nombre_tipo: 'Acta de elementos defectuosos sin reemplazo' }))
      .toBe('Acta sin unidad asociada');
    expect(tituloAlerta({ tipo: 'otra', nodo: null, nombre_tipo: 'Otra alerta' })).toBe('Otra alerta');
  });
});

describe('ruta por unidad (ET4-08, TR-02)', () => {
  const fila = {
    id_unico: 'A-1', nombre: 'Panadería', region: 'Región 1', nodo: 'ATLAN1', municipio: 'Soledad', modalidad: 'M1', estado_programa: 'en_programa', avance: 2, de: 11,
    pasos: { visita1: { logrado: true, fecha: '2026-09-10' }, formacion: { logrado: false, porcentaje: 60 }, rit: { logrado: true, fecha: null }, visita2: { logrado: false } },
  };
  it('los 12 pasos del servidor dan una columna cada uno', () => {
    const cols = columnasRuta(PASOS);
    expect(cols).toHaveLength(9 + 3 + 12);
    const valor = (titulo, x = fila) => cols.find((c) => c.titulo === titulo).valor(x);
    expect([valor('Módulo 1', { ...fila, modulos: [true, false, false] }), valor('Módulo 2', { ...fila, modulos: [true, false, false] }), valor('Módulo 1')]).toEqual(['Sí', 'No', '']);
    expect([valor('Visita 1 cerrada'), valor('RIT'), valor('80 % de formación'), valor('Avance'), valor('Estado en el programa')])
      .toEqual(['Sí (2026-09-10)', 'Sí', 'No (60 %)', '2 de 11', 'En el programa']);
  });
  it('filtra por texto y por el paso pendiente (solo las que siguen en el programa)', () => {
    const retirada = { ...fila, id_unico: 'B-2', estado_programa: 'retirada' };
    expect(filtrarRuta([fila, retirada], { texto: 'soledad' })).toHaveLength(2);
    expect(filtrarRuta([fila, retirada], { pendiente: 'visita2' }).map((f) => f.id_unico)).toEqual(['A-1']);
    expect(filtrarRuta([fila], { pendiente: 'visita1' })).toEqual([]);
  });
  it('textos del paso y del porcentaje', () => {
    expect([textoPaso(null), textoPaso({ logrado: true }), pct(12.5), pct(null)]).toEqual(['No', 'Sí', '12,5 %', '—']);
  });
});

describe('informe mensual (TR-09)', () => {
  it('meses recientes y su nombre', () => {
    expect(periodosRecientes('2026-02-15', 4)).toEqual(['2026-02', '2026-01', '2025-12', '2025-11']);
    expect(nombrePeriodo('2026-10')).toBe('octubre de 2026');
  });
  it('columnas del consolidado: lo del mes y el acumulado', () => {
    const c = { metricas_mes: { visita1: 'Visitas 1 cerradas' }, metricas_acumulado: { entrega: 'Entregadas' } };
    const cols = columnasConsolidado(c);
    expect(cols.map((x) => x.titulo)).toEqual(['Región', 'Departamento', 'Modalidad', 'Unidades en el programa', 'Visitas 1 cerradas (mes)', 'Entregadas (acumulado)']);
    expect(cols[4].valor({ periodo: { visita1: 3 }, acumulado: {} })).toBe(3);
  });
});

describe('KOKAN (TR-14)', () => {
  const fila = Object.fromEntries(DICCIONARIO_KOKAN.map((c) => [c.campo, '']));
  it('las columnas son los campos del diccionario del servidor, en orden', () => {
    expect(columnasKokan(DICCIONARIO_KOKAN).map((c) => c.titulo)).toEqual(DICCIONARIO_KOKAN.map((c) => c.campo));
  });
  it('CSV con punto y coma, comillas cuando hace falta y sin fórmulas', () => {
    const csv = csvKokan([{ ...fila, nombre_unidad: 'Pan; y "café"', nombre_representante: '=HYPERLINK("x")', documento: '1001' }], DICCIONARIO_KOKAN);
    const [cab, linea] = csv.replace('﻿', '').split('\r\n');
    expect(cab.split(';')).toEqual(DICCIONARIO_KOKAN.map((c) => c.campo));
    expect(linea).toContain('"Pan; y ""café"""');
    expect(linea).toContain(`"'=HYPERLINK(""x"")"`);
    expect(linea).toContain(';1001;');
    expect(csv.startsWith('﻿')).toBe(true);
  });
  it('el rango de fechas', () => {
    expect(problemaRango('', '')).toBe('');
    expect(problemaRango('2026-01-01', '2025-01-01')).toMatch(/posterior/);
    expect(problemaRango('ayer', '')).toMatch(/AAAA-MM-DD/);
  });
});

describe('metas de cupos (ET0-06)', () => {
  it('el total del programa es el del servidor', () => { expect(TOTAL_PROGRAMA).toBe(TOTAL_SERVIDOR); });
  it('revisa cada fila y las repetidas', () => {
    const filas = [{ region: 'Región 1', modalidad: 'M1', departamento: '', meta: '3000' }, { region: 'región 1 ', modalidad: 'M1', departamento: '', meta: '1' },
      { region: '', modalidad: 'M9', departamento: '', meta: '-2' }];
    expect(problemasMetas(filas)).toEqual(['Fila 2: está repetida.', 'Fila 3: falta la región.', 'Fila 3: elige la modalidad.', 'Fila 3: la meta debe ser un número entero de 0 en adelante.']);
    expect(problemasMetas(filas.slice(0, 1))).toEqual([]);
  });
  it('el total no suma el desglose por departamento', () => {
    const filas = [{ region: 'R1', modalidad: 'M1', meta: '3000' }, { region: 'R1', modalidad: 'M1', departamento: 'Atlántico', meta: '1200' }, { region: 'R2', modalidad: 'M2', meta: '20' }];
    expect(totalMetas(filas)).toBe(3020);
    expect(metasParaEnviar([{ region: ' R1 ', modalidad: 'M1', meta: '7' }])).toEqual([{ region: 'R1', modalidad: 'M1', departamento: '', meta: 7 }]);
  });
});

describe('casos de éxito y gestión comercial (ET4-10, TR-07, TR-08)', () => {
  it('los tipos son los del servidor', () => {
    expect(TIPOS_CASO).toEqual(CASOS_SERVIDOR);
    expect(TIPOS_GESTION).toEqual(GESTION_SERVIDOR);
  });
  it('lo que falta para registrar un caso', () => {
    const ok = { id_unico: 'A-1', tipo: 'exito', titulo: 'Vende más', descripcion: 'En la feria', fecha: '2026-10-01' };
    expect(faltasCaso(ok, { fotos: [png], documento: pdf }, '2026-10-24')).toEqual([]);
    expect(faltasCaso({ ...ok, fecha: '2026-12-01' }, {}, '2026-10-24')).toEqual(['La fecha no puede ser futura.']);
    expect(faltasCaso({ ...ok, tipo: '' }, { fotos: [pdf], documento: png })).toEqual(['Elige el tipo.', 'Las fotos deben ser JPG o PNG.', 'El documento debe ser un PDF.']);
    expect(faltasCaso(ok, { fotos: Array(11).fill(png) })).toEqual(['Máximo 10 fotos.']);
  });
  it('lo que falta para registrar una gestión', () => {
    const ok = { id_unico: 'A-1', tipo: 'visita_comercial', fecha: '2026-10-01', descripcion: 'Empaque' };
    expect(faltasGestion(ok, pdf)).toEqual([]);
    for (const tipo of GESTION_CON_ENTIDAD) expect(faltasGestion({ ...ok, tipo })).toEqual(['Escribe la entidad, el aliado o el cliente.']);
    expect(faltasGestion(ok, { name: 'x.docx' })).toEqual(['El soporte debe ser PDF, JPG o PNG.']);
  });
});

describe('expediente por unidad (TR-10)', () => {
  it('las versiones anteriores dicen cuándo y quién, sin documentos (TR-12)', () => {
    expect(textoVersion({ fecha: '2026-10-01T15:00:00Z', subido_por: 'Ana', reemplazado_en: '2026-10-20T15:00:00Z', reemplazado_por: '1012345678' }))
      .toBe('cargada el 2026-10-01 por Ana · reemplazada el 2026-10-20');
    expect(textoVersion({ fecha: null, subido_por: null })).toBe('cargada');
  });
  it('el Excel del expediente lleva serie, metadatos y verificación (FUN-PSI-04)', () => {
    const cols = columnasSoportes();
    const x = { nombre_serie: 'Entrega', tipo: 'Acta', nombre: 'a.pdf', fecha: '2026-10-20T15:00:00Z', subido_por: 'Ana', versiones: 2, verificacion: { verificado_por: 'Técnico', verificado_en: '2026-10-21T15:00:00Z', observacion: 'Bien' } };
    expect(cols.map((c) => c.valor(x))).toEqual(['Entrega', 'Acta', 'a.pdf', '2026-10-20', 'Ana', 2, 'Técnico', '2026-10-21', 'Bien']);
    expect(cols[6].valor({ ...x, verificacion: null })).toBe('');
  });
  it('«Cargó» no muestra una cédula: solo el nombre de quien cargó', () => {
    const x = { fecha: '2026-10-20T15:00:00Z', subido_por: '1012345678' };
    expect([cargoDe(x), cargoDe({ subido_por: '1.012.345.678' }), cargoDe({ subido_por: 'Gestora 1' }), cargoDe({}), cargoDe(null)]).toEqual(['', '', 'Gestora 1', '', '']);
    expect(textoSoporte(x)).toBe('2026-10-20');
    expect(textoSoporte({ ...x, subido_por: 'Gestora 1' })).toBe('2026-10-20 · Gestora 1');
    expect(columnasSoportes().find((c) => c.titulo === 'Cargó').valor(x)).toBe('');
  });
  it('agrupa los soportes por serie en el orden del servidor', () => {
    const g = porSerie([{ serie: 'entrega', nombre: 'b' }, { serie: 'diagnostico', nombre: 'a' }, { serie: 'entrega', nombre: 'c' }], SERIES);
    expect(g.map((x) => [x.clave, x.items.length])).toEqual([['diagnostico', 1], ['entrega', 2]]);
  });
});
