// Informe detallado de la Bitácora (LIT-h-02): quiénes están detrás de cada barra del panel, el resumen por nodo y
// el Excel que se descarga, leído de vuelta con el mismo lector de la aplicación.
import { describe, expect, it } from 'vitest';
import {
  audDe, estadoPaso, pasosCumplidos, PASOS_AVANCE, textoCuenta, agrupar, resumenPorNodo, ordenar, coincide, columnasDetalle,
  hojaPaso, SIN_INFO, estadoUpTexto, tonoEstadoUp,
} from '../src/lib/informeBitacora';
import { RUTA } from '../src/lib/etapas';
import { crearLibro, estiloTono, ESTILO } from '../src/lib/exportarExcel';
import { leerFilasExcel } from '../src/lib/leerExcel';

// Datos de la prueba (no se cargan en la aplicación).
const UPS = [
  { ID_unico: '10', unidad_nombre: 'Panadería Norte', integrante_nombre1: 'Ana', integrante_apellido1: 'Ríos', nodo: 'NODO2', nombre_gestor: 'Gestora B', region: 'Región 1', habilitadas: '1', plan_inversion: 'Viabilidad' },
  { ID_unico: '2', unidad_nombre: 'Taller Sur', integrante_nombre1: 'Luis', integrante_apellido1: 'Mora', nodo: 'NODO10', nombre_gestor: 'Gestor C', region: 'Región 2', habilitadas: '0', proceso_subsanacion: 'Pendiente' },
  { ID_unico: '3', unidad_nombre: 'Tienda Centro', nodo: 'NODO2', nombre_gestor: 'Gestora B', region: 'Región 1', habilitadas: '1', mpio: 'Soledad' },
];
const AUD = { 10: { TIENE_RIT: '1', DOC_COMPLETA_VISITA_1: '1' }, 2: { TIENE_RIT: '0' } };
const paso = (n) => RUTA.find((s) => s.n === n);

describe('estado de cada unidad en la ruta', () => {
  it('lee la auditoría por ID y cuenta los pasos de avance', () => {
    expect(audDe(UPS[0], AUD)).toBe(AUD[10]);
    expect(audDe({ ID_unico: ' 10 ' }, AUD)).toBe(AUD[10]);
    expect(audDe(UPS[2], AUD)).toBeUndefined();
    expect(PASOS_AVANCE.some((s) => s.cuenta)).toBe(false);          // Subsanaciones no es avance
    expect(pasosCumplidos(UPS[0], AUD[10])).toBe(3);                 // RIT, Visita 1 y Viabilidad
    expect(estadoPaso(paso('1'), UPS[2], undefined)).toEqual({ label: SIN_INFO, tono: 'neutral', cuenta: false });
    expect(textoCuenta(paso('8'))).toEqual({ si: 'Pendientes', no: 'Sin pendiente' });
    expect(textoCuenta(paso('1'))).toEqual({ si: 'Cumplen', no: 'Les falta' });
    expect([estadoUpTexto({}), tonoEstadoUp(UPS[1]), tonoEstadoUp(UPS[0]), tonoEstadoUp({})]).toEqual(['Sin estado', 'bad', 'ok', 'neutral']);
  });

  it('agrupa del grupo más grande al más pequeño, con «Sin información» al final', () => {
    const g = agrupar(UPS, (up) => estadoPaso(paso('1'), up, audDe(up, AUD)));
    expect(g.map((x) => [x.label, x.filas.length])).toEqual([['Con RIT', 1], ['Sin RIT', 1], [SIN_INFO, 1]]);
  });

  it('ordena por nodo (con números) y por ID, y busca en los datos de la unidad', () => {
    expect(ordenar(UPS).map((u) => u.ID_unico)).toEqual(['3', '10', '2']);   // NODO2 antes que NODO10
    expect(coincide(UPS[0], '  ríos ')).toBe(true);
    expect(coincide(UPS[2], 'soledad')).toBe(true);
    expect(coincide(UPS[1], 'norte')).toBe(false);
    expect(coincide(UPS[1], '')).toBe(true);
  });
});

describe('resumen por nodo', () => {
  it('suma unidades, activas, pasos y el avance promedio de cada nodo', () => {
    const r = resumenPorNodo(UPS, AUD);
    expect(r.map((x) => x.nodo)).toEqual(['NODO2', 'NODO10']);
    const n2 = r[0];
    expect([n2.total, n2.activas, n2.inactivas, n2.gestor]).toEqual([2, 2, 0, 'Gestora B']);
    expect(n2.pasos['1']).toBe(1);
    expect(n2.avance).toBeCloseTo(3 / (2 * PASOS_AVANCE.length));
    expect(r[1].pasos['8']).toBe(1);                                  // la subsanación pendiente se cuenta
    expect(resumenPorNodo([], AUD)).toEqual([]);
  });

  it('la hoja de un paso pone primero a quienes suman en la barra', () => {
    const h = hojaPaso(paso('1'), UPS, AUD);
    expect(h.nombre).toBe('1. RIT');
    expect(h.filas.map((f) => [f.g.label, f.up.ID_unico])).toEqual([['Con RIT', '10'], ['Sin RIT', '2'], [SIN_INFO, '3']]);
    expect(h.columnas[0].estilo(h.filas[0])).toBe(estiloTono('ok'));
    expect(estiloTono('raro')).toBe(ESTILO.normal);
  });
});

describe('el Excel del informe', () => {
  it('se arma y se vuelve a leer con las mismas cifras', async () => {
    const columnas = columnasDetalle(AUD);
    const blob = await crearLibro([
      { nombre: 'Detalle por UP', columnas, filas: ordenar(UPS) },
      { nombre: 'Detalle por UP', columnas, filas: [] },                // nombre repetido: el libro lo corrige
    ]);
    expect(blob.size).toBeGreaterThan(500);
    const r = await leerFilasExcel(blob, {
      hojas: ['Detalle por UP'],
      columnas: [{ alias: 'id', nombre: 'ID' }, { alias: 'unidad', nombre: 'Unidad productiva' }, { alias: 'estado', nombre: 'Estado UP' },
        { alias: 'pasos', nombre: `Pasos cumplidos (de ${PASOS_AVANCE.length})` }, { alias: 'rit', nombre: '1 · RIT' }],
    });
    expect(r.filas).toEqual([
      { id: '3', unidad: 'Tienda Centro', estado: 'Activa', pasos: '0', rit: SIN_INFO },
      { id: '10', unidad: 'Panadería Norte', estado: 'Activa', pasos: '3', rit: 'Con RIT' },
      { id: '2', unidad: 'Taller Sur', estado: 'Inactiva', pasos: '0', rit: 'Sin RIT' },
    ]);
  });
});
