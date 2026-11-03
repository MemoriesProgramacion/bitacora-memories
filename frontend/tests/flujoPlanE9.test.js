// E9 · Ciclo del plan: estados, historial, subsanación, comité y legalización. Las reglas son del servidor
// (backend/src/servicios/carrito.js y flujoPlan.js); aquí se comprueba que la pantalla las presenta igual.
import { describe, expect, it } from 'vitest';
import {
  APROBADOS, ESTADOS_CARRITO, ORDEN_CICLO, columnasLegalizacion, diaColombia, integrantesValidos, promedioComite, textoHistorial, textoSubsanacion,
} from '../src/lib/carrito';

describe('estados del plan (ET3-28)', () => {
  it('tiene los 10 estados del servidor, cada uno con texto y tono', () => {
    expect(Object.keys(ESTADOS_CARRITO)).toEqual(['borrador', 'enviado', 'devuelto', 'revisado', 'viable', 'en_subsanacion', 'subsanado', 'aprobado', 'en_compra', 'entregado']);
    for (const e of Object.values(ESTADOS_CARRITO)) { expect(e.texto).toBeTruthy(); expect(e.tono).toBeTruthy(); }
    expect(ORDEN_CICLO.every((e) => ESTADOS_CARRITO[e])).toBe(true);
    expect(APROBADOS).toEqual(['aprobado', 'en_compra', 'entregado']);
  });
  it('el historial dice quién movió el plan (con el nombre de su rol), cuándo (día de Colombia) y por qué', () => {
    expect(textoHistorial({ de: 'enviado', a: 'revisado', por: 'Ana', rol: 'coordinador', en: '2026-10-20T15:00:00.000Z' }))
      .toBe('Enviado a revisión → Revisado por la coordinación · Ana (Coordinador local regional) · 2026-10-20');
    // Las 00:00 UTC del 21 son las 19:00 del 20 en Colombia.
    expect(textoHistorial({ de: 'en_subsanacion', a: 'en_subsanacion', por: 'Ana', en: '2026-10-21T00:00:00Z', motivo: 'Reabierta' }))
      .toBe('En subsanación · Ana · 2026-10-20 · Reabierta');
    expect(textoHistorial({ de: 'viable', a: 'aprobado', por: 'Coord', rol: 'coordinador', general: true, en: '2026-10-21T12:00:00Z' }))
      .toContain('(Coordinador general)');
    expect(textoHistorial({ de: 'viable', a: 'aprobado', por: 'Datos', rol: 'coordinador', general: true, es_datos: true, en: '2026-10-21T12:00:00Z' }))
      .toContain('(Profesional de seguimiento e información)');
    expect(diaColombia('no es fecha')).toBe('');
  });
});

describe('subsanación (ET3-11)', () => {
  it('muestra el plazo o que venció', () => {
    expect(textoSubsanacion(null)).toBe('');
    expect(textoSubsanacion({ plazo: '2026-10-16', vencida: false })).toContain('hasta el 2026-10-16');
    expect(textoSubsanacion({ plazo: '2026-10-16', vencida: true })).toContain('venció el 2026-10-16');
  });
});

describe('comité de aprobación (ET3-10)', () => {
  it('promedia como el servidor: 3 notas enteras de 1 a 5; con 3 o más aprueba', () => {
    expect(promedioComite(['3', '3', '3'])).toEqual({ promedio: 3, aprobado: true });
    expect(promedioComite([2, 3, 3])).toEqual({ promedio: 2.67, aprobado: false });
    expect(promedioComite([5, 4, 4])).toEqual({ promedio: 4.33, aprobado: true });
    expect(promedioComite(['', 3, 3])).toBeNull();
    expect(promedioComite([0, 3, 3])).toBeNull();
    expect(promedioComite([6, 3, 3])).toBeNull();
    expect(promedioComite([2.5, 3, 3])).toBeNull();
    expect(promedioComite([3, 3])).toBeNull();
  });
  it('los integrantes son 3 con nombre: 2 de Prosperidad Social y 1 de INNPULSA', () => {
    const ok = [{ nombre: 'A', entidad: 'Prosperidad Social' }, { nombre: 'B', entidad: 'Prosperidad Social' }, { nombre: 'C', entidad: 'INNPULSA' }];
    expect(integrantesValidos(ok)).toBe(true);
    expect(integrantesValidos([...ok.slice(0, 2), { nombre: ' ', entidad: 'INNPULSA' }])).toBe(false);
    expect(integrantesValidos([ok[0], { ...ok[1], entidad: 'INNPULSA' }, ok[2]])).toBe(false);
    expect(integrantesValidos(ok.slice(0, 2))).toBe(false);
    expect(integrantesValidos([ok[0], ok[1], { nombre: 'C', entidad: 'Otra' }])).toBe(false);
  });
});

describe('legalización por U.P. (ET3-27)', () => {
  it('el Excel lleva el plan, lo facturado, la diferencia y las facturas', () => {
    const cols = columnasLegalizacion();
    const fila = { id_unico: 'U1', nombre: 'Panadería', region: 'Caribe', nodo: 'N1', nombre_estado: 'aprobado por el comité', total_plan: 1000, total_facturado: 900,
      diferencia: -100, porcentaje: 90, facturas: [{ numero: 'F-1', fecha: '2026-10-01' }, { numero: 'F-2', fecha: '2026-10-02' }] };
    const valores = Object.fromEntries(cols.map((c) => [c.titulo, c.valor(fila)]));
    expect(valores['Total del plan']).toBe(1000);
    expect(valores['Diferencia']).toBe(-100);
    expect(valores['% legalizado']).toBe(90);
    expect(valores['Facturas']).toBe('F-1 (2026-10-01), F-2 (2026-10-02)');
    expect(cols.find((c) => c.titulo === '% legalizado').valor({ ...fila, porcentaje: null })).toBe('');
  });
});
