// E5 · Línea base y evaluación de salida: lo que falta, la variación, el Excel del tablero y quién lo ve.
import { describe, expect, it } from 'vitest';
import { bloqueosSalida, columnasTablero, faltantesSalida, faltantesUsoActivos, textoIndicador, textoVariacion } from '../src/lib/salida';
import { puedeVerTableroEvaluacion } from '../src/lib/permisos';
import { ESQUEMA_SALIDA, INDICADORES, comparacion, promedioEncuesta } from '../../backend/src/servicios/salida.js';

const seccion = (clave) => ESQUEMA_SALIDA.find((s) => s.clave === clave);

describe('evaluación de salida', () => {
  it('pide la observación del acta solo si el cumplimiento es parcial o no cumple (misma regla del servidor)', () => {
    expect(faltantesSalida(seccion('compromiso'), { cumplimiento: 'parcial' })).toEqual(['Observación']);
    expect(faltantesSalida(seccion('compromiso'), { cumplimiento: 'cumple' })).toEqual([]);
    expect(faltantesSalida(seccion('encuesta'), { acompanamiento: 5 }).length).toBe(4);
  });

  it('cada bien del plan aprobado necesita su estado y, si no está en uso, el motivo', () => {
    const bienes = [{ id_linea: 1, nombre: 'Horno' }, { id_linea: 2, nombre: 'Mesa' }];
    expect(faltantesUsoActivos(bienes, { items: [{ id_linea: 1, estado: 'en_uso' }] })).toEqual(['Mesa']);
    expect(faltantesUsoActivos(bienes, { items: [{ id_linea: 1, estado: 'danado' }, { id_linea: 2, estado: 'en_uso' }] }))
      .toEqual(['Horno: explica por qué no está en uso']);
    expect(faltantesUsoActivos([], null)).toEqual([]);
  });

  it('calcula la variación frente a la línea base y el promedio de la encuesta', () => {
    const c = Object.fromEntries(comparacion({ ventas_mensuales: 1800000, clientes_mes: 120 }, { ventas_mensuales: 2700000, clientes_mes: 90 }).map((x) => [x.clave, x]));
    expect([c.ventas_mensuales.variacion_pct, c.clientes_mes.variacion_pct]).toEqual([50, -25]);
    expect(textoVariacion(50)).toBe('+50 %');
    expect(textoVariacion(-12.5)).toBe('−12,5 %');
    expect(textoVariacion(null)).toBe('—');
    expect(promedioEncuesta({ acompanamiento: 5, formacion: 4, bienes: 5, oportunidad: 3, general: 4 })).toBe(4.2);
    expect(textoIndicador('pesos', 2700000)).toBe(`$ ${(2700000).toLocaleString('es-CO')}`);
  });

  it('avisa a la V3 lo que impide cerrarla', () => {
    expect(bloqueosSalida({ completitud: { completo: false, faltan: ['a', 'b', 'c'] } })).toEqual(['evaluación de salida: 3 dato(s)']);
    expect(bloqueosSalida({ completitud: { completo: true, faltan: [] } })).toEqual([]);
  });
});

describe('tablero de indicadores', () => {
  it('el Excel lleva línea base, salida y variación de cada indicador', () => {
    const cols = columnasTablero(INDICADORES);
    expect(cols.map((c) => c.titulo)).toContain('Ventas mensuales (variación %)');
    expect(cols.length).toBe(5 + INDICADORES.length * 3 + 2);
    const fila = { id_unico: 'E4-A', indicadores: { ventas_mensuales: { base: 1, salida: 2, variacion_pct: 100 } }, satisfaccion: null, estado_revision: 'revisado' };
    expect(cols.find((c) => c.titulo === 'Ventas mensuales (variación %)').valor(fila)).toBe(100);
    expect(cols.find((c) => c.titulo === 'Clientes al mes (salida)').valor(fila)).toBe('');
  });
  it('lo ven la coordinación y el técnico; no el gestor, compras ni el tallerista', () => {
    for (const role of ['superadmin', 'coordinador', 'coordinador_datos', 'tecnico_administrativo']) expect(puedeVerTableroEvaluacion({ role })).toBe(true);
    for (const role of ['gestor', 'coordinador_compras', 'tallerista']) expect(puedeVerTableroEvaluacion({ role })).toBe(false);
  });
});

describe('revisión de E5: cambios sin guardar y textos del Excel', () => {
  it('los cambios sin guardar también impiden cerrar la visita', async () => {
    const { bloqueosDeCierre } = await import('../src/lib/diagnostico');
    const completo = { completitud: { v1: { faltan: [], verificacion_negativa: [] }, v2: { faltan: [] } } };
    expect(bloqueosDeCierre(completo, 'v2', ['Matriz FODA'])).toEqual(['cambios sin guardar en: Matriz FODA']);
    expect(bloqueosSalida({ completitud: { completo: true, faltan: [] } }, ['Encuesta de satisfacción'])).toEqual(['cambios sin guardar en: Encuesta de satisfacción']);
  });
  it('el Excel muestra el estado de la revisión en palabras', () => {
    const col = columnasTablero(INDICADORES).find((c) => c.titulo === 'Revisión');
    expect(col.valor({ estado_revision: 'pendiente' })).toBe('En revisión');
    expect(col.valor({ estado_revision: 'raro' })).toBe('Sin enviar');
  });
});
