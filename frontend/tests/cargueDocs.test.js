// Cargue de documentación (expedientes por etapas): las columnas que el navegador extrae de los dos Excel
// (src/lib/cargueDocs.js) son las que lee el servidor (backend/src/servicios/cargueDocumentos.js).
// El servidor no exporta sus alias (los usa en el código y en su tabla ETAPAS), así que se leen de su fuente.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLUMNAS_MASTER, COLUMNAS_AUDITORIA, HOJA_MASTER, HOJA_AUDITORIA, PLANTILLAS } from '../src/lib/cargueDocs.js';
import { normalizarEncabezado, leerFilasExcel, leerColumnasExcel } from '../src/lib/leerExcel.js';
import { COLUMNAS_RIT, HOJA_RIT } from '../src/lib/cargueRit.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const fuente = fs.readFileSync(path.join(aqui, '../../backend/src/servicios/cargueDocumentos.js'), 'utf8');

const aliases = (cols) => cols.map((c) => c.alias);
const unicos = (lista) => [...new Set(lista)].sort();

// Alias que el servidor lee directo de la fila: m.<alias> (BASE MASTER) y a?.<alias> (auditoría).
const leidos = (obj) => unicos([...fuente.matchAll(new RegExp(`\\b${obj}\\??\\.(\\w+)`, 'g'))].map((m) => m[1]));

// Tabla ETAPAS del servidor: { codigo, a: prefijo en la auditoría, docM/fecha/… : alias del master, checklist }.
const bloqueEtapas = /const ETAPAS = \[([\s\S]*?)\n\];/.exec(fuente)?.[1] || '';
const ETAPAS = [...bloqueEtapas.matchAll(/\{([^}]*)\}/g)]
  .map((m) => Object.fromEntries([...m[1].matchAll(/(\w+):\s*'([^']*)'/g)].map((p) => [p[1], p[2]])));
const CAMPOS_MASTER_ETAPA = ['docM', 'fecha', 'reprog', 'agend', 'modal', 'result'];

describe('hojas y columnas del cargue de documentación', () => {
  it('las hojas son las que documenta el servidor', () => {
    expect(fuente).toContain(`hoja «${HOJA_MASTER}» de la BASE MASTER`);
    expect(fuente).toContain(`hoja «${HOJA_AUDITORIA}» de auditoria_global_archivos`);
  });

  for (const [nombre, cols] of [['master', COLUMNAS_MASTER], ['auditoría', COLUMNAS_AUDITORIA]]) {
    it(`${nombre}: ni alias ni encabezados repetidos`, () => {
      const alias = aliases(cols);
      expect(alias.filter((a, i) => alias.indexOf(a) !== i)).toEqual([]);
      // Un mismo encabezado solo puede pedirse dos veces si cada vez es otra aparición en la hoja.
      const claves = cols.map((c) => `${normalizarEncabezado(c.nombre)}#${c.ocurrencia || 1}`);
      expect(claves.filter((k, i) => claves.indexOf(k) !== i)).toEqual([]);
    });

    it(`${nombre}: el cruce por ID_unico es obligatorio`, () => {
      const id = cols.find((c) => c.alias === 'id_unico');
      expect(id).toBeTruthy();
      expect(id.opcional).toBeFalsy();
      expect(normalizarEncabezado(id.nombre)).toBe('id_unico');
    });
  }

  it('la tabla de etapas del servidor se pudo leer', () => {
    expect(ETAPAS.length).toBeGreaterThan(10);
    expect(ETAPAS.every((e) => e.codigo)).toBe(true);
  });

  it('cada columna del master que lee el servidor la extrae el navegador', () => {
    const delServidor = unicos([
      ...leidos('m'),
      ...ETAPAS.flatMap((e) => CAMPOS_MASTER_ETAPA.map((k) => e[k]).filter(Boolean)),
    ]);
    expect(delServidor.length).toBeGreaterThan(20);
    const delNavegador = new Set(aliases(COLUMNAS_MASTER));
    expect(delServidor.filter((a) => !delNavegador.has(a))).toEqual([]);
  });

  it('cada columna de la auditoría que lee el servidor la extrae el navegador', () => {
    const delServidor = unicos([...leidos('a'), ...ETAPAS.map((e) => e.checklist).filter(Boolean)]);
    expect(delServidor.length).toBeGreaterThan(5);
    const delNavegador = new Set(aliases(COLUMNAS_AUDITORIA));
    expect(delServidor.filter((a) => !delNavegador.has(a))).toEqual([]);
  });

  it('cada columna de archivos, checks o completa de la auditoría cae en una etapa del servidor', () => {
    const prefijos = new Set(ETAPAS.map((e) => e.a).filter(Boolean));
    const porEtapa = aliases(COLUMNAS_AUDITORIA).filter((a) => /_(archivos|checks|completa)$/.test(a));
    expect(porEtapa.length).toBeGreaterThan(10);
    expect(porEtapa.filter((a) => !prefijos.has(a.replace(/_(archivos|checks|completa)$/, '')))).toEqual([]);
  });

  it('solo la visita 3 no trae columnas en la auditoría (sale de documentacion_visita3 del master)', () => {
    const delNavegador = new Set(aliases(COLUMNAS_AUDITORIA));
    const sinColumnas = ETAPAS.filter((e) => e.a && !['archivos', 'checks', 'completa'].some((k) => delNavegador.has(`${e.a}_${k}`)))
      .map((e) => e.codigo);
    // Si la auditoría empieza a traer la visita 3, agrega sus columnas en cargueDocs.js y quita esta excepción.
    expect(sinColumnas).toEqual(['visita3']);
    expect(aliases(COLUMNAS_MASTER)).toContain(ETAPAS.find((e) => e.codigo === 'visita3').docM);
  });
});

// Las plantillas de public/plantillas/ las lee el mismo lector del cargue: si una columna cambia y la plantilla
// no se regenera, el usuario descargaría un archivo que el cargue rechaza.
describe('plantillas descargables del cargue de datos', () => {
  const abrir = (clave) => {
    const buf = fs.readFileSync(path.join(aqui, '../public', PLANTILLAS[clave].href));
    return new File([buf], PLANTILLAS[clave].archivo);
  };

  it('BASE MASTER: trae todas las columnas que lee el cargue', async () => {
    const r = await leerFilasExcel(abrir('master'), { hojas: [HOJA_MASTER], columnas: COLUMNAS_MASTER });
    expect(r.hoja).toBe(HOJA_MASTER);
    expect(r.filas).toEqual([]);
  });

  it('auditoría: trae todas las columnas, incluidas las opcionales', async () => {
    const r = await leerFilasExcel(abrir('auditoria'), { hojas: [HOJA_AUDITORIA], columnas: COLUMNAS_AUDITORIA });
    expect(r.hoja).toBe(HOJA_AUDITORIA);
    expect(r.faltantes).toEqual([]);
  });

  it('subsanaciones: trae ID_unico y proceso_subsanacion', async () => {
    const r = await leerColumnasExcel(abrir('subsanacion'), {
      hojas: [HOJA_MASTER],
      columnas: ['ID_unico', 'proceso_subsanacion'],
    });
    expect(r.hoja).toBe(HOJA_MASTER);
    expect(r.filas).toEqual([]);
  });

  it('RIT: trae cedula y nombre en la hoja RIT y sin filas de ejemplo', async () => {
    const r = await leerFilasExcel(abrir('rit'), { hojas: [HOJA_RIT], columnas: COLUMNAS_RIT, conNumeroFila: true });
    expect(r.hoja).toBe(HOJA_RIT);
    expect(r.filas).toEqual([]);
  });
});
