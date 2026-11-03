import { describe, it, expect } from 'vitest';
import {
  HOJAS_COMPRAS, COLUMNAS_COMPRAS, idNum, columnasClaveFaltantes,
  armarDocumentosCompras, armarEntregas,
} from '../src/lib/cargueCompras';
import { normalizarEncabezado } from '../src/lib/leerExcel';
import { SIN_DATOS } from '../src/lib/config';

// Filas como las devuelve leerFilasExcel: todo texto, vacío = ''.
const ap = (id, extra = {}) => ({
  id_unico: String(id), gestor: 'nodo1', num_documento: '1020304050.0',
  item_n: '1', codigo_actual: '', denominacion: 'Silla', cantidad: '2',
  precio: '50000', total: '100000', comprado: '', ...extra,
});
const co = (id, extra = {}) => ({ id_unico: String(id), item_n: '1', ...extra });

describe('idNum', () => {
  it('número entero positivo o null', () => {
    expect(idNum('12')).toBe(12);
    expect(idNum('12.0')).toBe(12);
    expect(idNum(' 7 ')).toBe(7);
    expect(idNum('0')).toBeNull();
    expect(idNum('-3')).toBeNull();
    expect(idNum('abc')).toBeNull();
    expect(idNum('')).toBeNull();
    expect(idNum('#N/A')).toBeNull();
  });
});

describe('COLUMNAS_COMPRAS', () => {
  it('cada hoja tiene una columna obligatoria que no está en ninguna otra hoja', () => {
    for (const [hoja, columnas] of Object.entries(COLUMNAS_COMPRAS)) {
      const otras = new Set(Object.entries(COLUMNAS_COMPRAS)
        .filter(([h]) => h !== hoja)
        .flatMap(([, cs]) => cs.map((c) => normalizarEncabezado(c.nombre))));
      const propias = columnas.filter((c) => !c.opcional && !otras.has(normalizarEncabezado(c.nombre)));
      expect(propias.length, hoja).toBeGreaterThan(0);
    }
  });

  it('todas las hojas piden ID_unico', () => {
    for (const columnas of Object.values(COLUMNAS_COMPRAS)) {
      expect(columnas.find((c) => c.alias === 'id_unico')?.opcional).toBe(false);
    }
  });
});

describe('columnasClaveFaltantes', () => {
  it('nombra la hoja y la columna que falta', () => {
    expect(columnasClaveFaltantes({
      cronograma: ['fecha_programada', 'proveedor'],
      entregas: ['hora_ruta'],
    })).toEqual(['3. CRONOGRAMA: fecha_programada', '5. ENTREGAS: hora_ruta']);
  });

  it('sin faltantes clave, lista vacía', () => {
    expect(columnasClaveFaltantes({})).toEqual([]);
    expect(columnasClaveFaltantes({ cronograma: ['proveedor'] })).toEqual([]);
  });
});

describe('armarDocumentosCompras', () => {
  it('solo entran las U.P. de APROBADO; las que están solo en COMPRAS se cuentan', () => {
    const { docs, info } = armarDocumentosCompras({
      aprobado: [ap(2), ap(1)],
      compras: [co(1), co(3), co(3, { item_n: '2' })],
    });
    expect(docs.map((d) => d.id_unico)).toEqual([1, 2]);
    expect(docs[0].id).toBe('1');
    expect(info.soloCompras).toEqual([3]);
  });

  it('descarta filas sin ID_unico válido', () => {
    const { docs } = armarDocumentosCompras({ aprobado: [ap(''), ap('abc'), ap(4)], compras: [] });
    expect(docs.map((d) => d.id_unico)).toEqual([4]);
  });

  it('«comprado» sale de la columna COMPRADO de APROBADO', () => {
    const { docs, info } = armarDocumentosCompras({
      aprobado: [
        ap(1, { item_n: '1', comprado: '1' }),
        ap(1, { item_n: '2', denominacion: 'Mesa', comprado: '0' }),
        ap(1, { item_n: '3', denominacion: 'Estufa', comprado: '' }),
        ap(2, { comprado: '' }),
      ],
      compras: [],
    });
    expect(docs[0].items.map((it) => it.comprado_excel)).toEqual([true, false, false]);
    expect(info.itemsComprados).toBe(1);
    expect(info.upConCompras).toBe(1);
    expect(info.items).toBe(4);
  });

  it('cruza con COMPRAS por código, luego por nombre y al final por item_n', () => {
    const { docs, info } = armarDocumentosCompras({
      aprobado: [
        ap(1, { item_n: '1', codigo_actual: 'AB-12', denominacion: 'Silla' }),
        ap(1, { item_n: '2', denominacion: 'Mesa plegable' }),
        ap(1, { item_n: '3', denominacion: 'Estufa' }),
      ],
      compras: [
        co(1, { item_n: '9', codigo_actual: 'ab12', nombre_carrito_actual: 'Silla Rimax' }),
        co(1, { item_n: '1', nombre_solicitado: 'MESA PLEGABLE', nombre_carrito_actual: 'Mesa Pro' }),
        co(1, { item_n: '3', nombre_carrito_actual: 'Estufa 2 puestos' }),
        co(1, { item_n: '7', nombre_carrito_actual: 'Sin par' }),
      ],
    });
    expect(docs[0].items.map((it) => it.nombre_carrito_actual))
      .toEqual(['Silla Rimax', 'Mesa Pro', 'Estufa 2 puestos']);
    expect(info.itemsSoloCompras).toBe(1);
  });

  it('una fila de COMPRAS se usa una sola vez', () => {
    const { docs } = armarDocumentosCompras({
      aprobado: [ap(1, { item_n: '1' }), ap(1, { item_n: '2' })],
      compras: [co(1, { item_n: '5', nombre_solicitado: 'Silla', nombre_carrito_actual: 'Silla Rimax' })],
    });
    expect(docs[0].items.map((it) => it.nombre_carrito_actual)).toEqual(['Silla Rimax', 'Silla']);
  });

  it('sin par en COMPRAS, el nombre del carrito es la denominación', () => {
    const { docs } = armarDocumentosCompras({ aprobado: [ap(1)], compras: [] });
    expect(docs[0].items[0].nombre_solicitado).toBe('Silla');
    expect(docs[0].items[0].nombre_carrito_actual).toBe('Silla');
    expect(docs[0].items[0].origen).toBe('APROBADO');
  });

  it('recalcula el total cuando no es precio × cantidad', () => {
    const { docs } = armarDocumentosCompras({
      aprobado: [
        ap(1, { item_n: '1', precio: '50000', cantidad: '2', total: '100000' }),
        ap(1, { item_n: '2', precio: '10000', cantidad: '3', total: '25000' }),
        ap(1, { item_n: '3', precio: '1000', cantidad: '1', total: '' }),
      ],
      compras: [],
    });
    const [a, b, c] = docs[0].items;
    expect(a.total).toBe(100000);
    expect(a.total_recalculado).toBeUndefined();
    expect(b.total).toBe(30000);
    expect(b.total_recalculado).toBe(true);
    expect(c.total).toBe(1000);
    expect(docs[0].resumen).toEqual({ total_items: 3, total_unidades: 6, valor_total: 131000 });
  });

  it('ordena los ítems por item_n', () => {
    const { docs } = armarDocumentosCompras({
      aprobado: [ap(1, { item_n: '3' }), ap(1, { item_n: '' }), ap(1, { item_n: '1' })],
      compras: [],
    });
    expect(docs[0].items.map((it) => it.item_n)).toEqual([1, 3, null]);
  });

  it('limpia los datos de la cabecera', () => {
    const { docs, info } = armarDocumentosCompras({
      aprobado: [ap(1, {
        gestor: ' nodo3 ', num_documento: '1020304050.0', region: '2', dpto: '#N/A', mpio: 'Soacha',
        ubicacion: '4.58; -74.21', aprobado_comite: 'Sí', precio: '$1,200', cantidad: '1', total: '',
      })],
      compras: [co(1, { fecha_solicitud_pi: '7/10/2026', fecha_procesado_pi: '2026-10-08T00:00' })],
    });
    const d = docs[0];
    expect(d.nodo).toBe('NODO3');
    expect(d.num_documento).toBe('1020304050');
    expect(d.region).toBe(2);
    expect(d.departamento).toBe(SIN_DATOS);
    expect(d.municipio).toBe('Soacha');
    expect(d.ubicacion).toEqual({ latitud: 4.58, longitud: -74.21 });
    expect(d.aprobacion.aprobado_comite).toBe(true);
    expect(d.aprobacion.resultado_comite).toBe(SIN_DATOS);
    expect(d.aprobacion.fecha_solicitud_plan_inversion).toBe('2026-10-07');
    expect(d.aprobacion.fecha_procesado_plan_inversion).toBe('2026-10-08');
    expect(d.items[0].precio_solicitado).toBe(1200);
    expect(d.unidad_nombre).toBe(SIN_DATOS);
    expect(info.cedulas).toBe(1);
  });

  it('cuenta cédulas distintas', () => {
    const { info } = armarDocumentosCompras({
      aprobado: [ap(1, { num_documento: '111' }), ap(2, { num_documento: '111' }), ap(3, { num_documento: '222' })],
      compras: [],
    });
    expect(info.cedulas).toBe(2);
  });

  it('sin las hojas 3, 4 y 5 no manda cronograma, ruta ni entrega', () => {
    const { docs } = armarDocumentosCompras({ aprobado: [ap(1)], compras: [] });
    expect(docs[0]).not.toHaveProperty('cronograma');
    expect(docs[0]).not.toHaveProperty('ruta');
    expect(docs[0]).not.toHaveProperty('entrega');
  });

  it('con las hojas 3, 4 y 5 agrega cronograma, ruta y entrega', () => {
    const { docs, info } = armarDocumentosCompras({
      aprobado: [ap(1), ap(2)],
      compras: [],
      cronograma: [{ id_unico: '1', unidad_nombre: 'La Huerta', estado_programacion: 'PROGRAMADA', fecha_programada: '15/10/2026' }],
      rutas: [{ id_unico: '1', gestor_telefono: '300 1', telefono_gestor: '310 9', hora_visita: '9:30', unidad_tel1: '311', unidad_tel2: '312' }],
      entregas: [{ id_unico: '1', ruta: 'R3', region_ruta: 'Sur', en_ruta: 'si', estado_entrega: '' }],
    });
    const [d1, d2] = docs;
    expect(d1.unidad_nombre).toBe('La Huerta');
    expect(d1.cronograma.estado_programacion).toBe('PROGRAMADA');
    expect(d1.cronograma.fecha_programada).toBe('2026-10-15');
    expect(d1.ruta.telefono_gestor).toBe('300 1');
    expect(d1.ruta.ruta).toBe('R3');
    expect(d1.ruta.region).toBe('Sur');
    expect(d1.ruta.hora_visita).toBe('09:30');
    expect(d1.ruta.telefono_up).toBe('311 · 312');
    expect(d1.entrega.en_ruta).toBe(true);
    expect(d1.entrega.estado_entrega).toBe(SIN_DATOS);
    // La U.P. 2 no está en esas hojas: lleva las secciones vacías.
    expect(d2.cronograma.estado_programacion).toBe(SIN_DATOS);
    expect(info).toMatchObject({ conCronograma: 1, conRuta: 1, conEntrega: 1 });
  });
});

describe('armarEntregas', () => {
  const hojas = {
    cronograma: [{ id_unico: '5', unidad_nombre: 'El Sol', estado_programacion: 'PROGRAMADA', fecha_programada: '2026-10-20' }],
    entregas: [
      { id_unico: '3', unidad_nombre: 'La Luna', hora_ruta: '2:30', ruta: 'R1', estado_entrega: 'ENTREGADA' },
      { id_unico: '3', unidad_nombre: 'Duplicada', estado_entrega: 'OTRA' },
    ],
    rutas: [{ id_unico: '5', fecha_ruta: '19/10/2026', punto_encuentro: 'Parque', hora_visita: '' }],
  };

  it('sin alguna de las tres hojas no arma nada', () => {
    expect(armarEntregas({ cronograma: [], entregas: [] })).toBeNull();
    expect(armarEntregas({ cronograma: [], rutas: [] })).toBeNull();
    expect(armarEntregas({ entregas: [], rutas: [] })).toBeNull();
  });

  it('una entrega por U.P. de cualquiera de las tres hojas, ordenadas', () => {
    const r = armarEntregas(hojas);
    expect(r.map((e) => e.id_unico)).toEqual([3, 5]);
    expect(r.map((e) => e.unidad_nombre)).toEqual(['La Luna', 'El Sol']);
  });

  it('usa la primera fila de cada U.P.', () => {
    const [e3] = armarEntregas(hojas);
    expect(e3.excel.excel_estado_entrega).toBe('ENTREGADA');
  });

  it('columnas planas excel_*; lo vacío viaja como null', () => {
    const [e3, e5] = armarEntregas(hojas);
    expect(e5.excel).toMatchObject({
      excel_estado_programacion: 'PROGRAMADA',
      excel_fecha_programada: '2026-10-20',
      excel_ruta_fecha: '2026-10-19',
      excel_ruta_punto_encuentro: 'Parque',
      excel_ruta_hora_visita: null,
      excel_estado_entrega: null,
      excel_hora_ruta: null,
      excel_ruta: null,
    });
    expect(e3.excel.excel_hora_ruta).toBe('14:30');
    expect(e3.excel.excel_ruta).toBe('R1');
    expect(e3.excel.excel_estado_programacion).toBeNull();
    expect(Object.values(e3.excel)).not.toContain(SIN_DATOS);
  });

  it('los nombres de hoja son los del MASTER ENTREGAS', () => {
    expect(HOJAS_COMPRAS).toEqual({
      aprobado: '1. APROBADO',
      compras: '2. COMPRAS',
      cronograma: '3. CRONOGRAMA',
      rutas: '4. RUTAS',
      entregas: '5. ENTREGAS',
    });
  });
});
