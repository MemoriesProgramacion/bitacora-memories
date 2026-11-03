// E8 · Plan de capitalización: el formulario del plan de negocio, el transporte por modalidad, lo que falta para enviar
// y aprobar y el avance de las cotizaciones. Las reglas son del servidor (backend/src/servicios/reglasPlan.js).
import { describe, expect, it } from 'vitest';
import { avanceCotizaciones, formularioAPlan, planAFormulario, problemasPara, textoTransporte, valorPesos } from '../src/lib/carrito';
import { DIMENSIONES, faltantesPlanNegocio, limpiarPlanNegocio } from '../../backend/src/servicios/reglasPlan.js';

describe('plan de negocio (ET3-01)', () => {
  it('el formulario arranca con una fila para escribir y vuelve sin líneas en blanco', () => {
    const f = planAFormulario(null, DIMENSIONES);
    expect(f.social).toEqual(['']);
    expect(f.plan_accion).toEqual([{ accion: '', responsable: '', fecha: '' }]);
    const plan = formularioAPlan({ ...f, social: ['  Vincular jóvenes ', ''], plan_accion: [...f.plan_accion, { accion: 'Comprar', responsable: 'Rep', fecha: '2026-12-01' }] }, DIMENSIONES);
    expect(plan.social).toEqual(['Vincular jóvenes']);
    expect(plan.plan_accion).toEqual([{ accion: 'Comprar', responsable: 'Rep', fecha: '2026-12-01' }]);
    expect(plan.riesgos).toEqual([]);
  });
  it('lo que arma la pantalla pasa la validación del servidor', () => {
    const completo = formularioAPlan({
      social: ['a'], economica: ['b'], empresarial: ['c'], propuesta_valor: 'Pan artesanal', asistencia_tecnica: ['Costos'],
      mercadeo: { segmento: 'Vecinos', canales: 'Tienda', precio: 'Justo', promocion: 'Redes', distribucion: 'Domicilio' },
      plan_accion: [{ accion: 'x', responsable: 'y', fecha: '2026-12-01' }], riesgos: [{ riesgo: 'r', nivel: 'medio', mitigacion: 'm' }],
    }, DIMENSIONES);
    expect(faltantesPlanNegocio(limpiarPlanNegocio(completo))).toEqual([]);
    expect(faltantesPlanNegocio(limpiarPlanNegocio(formularioAPlan(planAFormulario(null, DIMENSIONES), DIMENSIONES)))).toHaveLength(8); // con el plan de mercadeo (E12)
  });
});

describe('transporte, requisitos y cotizaciones', () => {
  it('en M1 el transporte es una bolsa aparte; en M2–M4 incluido o del beneficiario (ET3-05)', () => {
    expect(textoTransporte({ modalidad: 'M1', transporte_m1: 150000 }, {})).toBe('Bolsa de transporte de M1 (aparte del tope): $ 150.000');
    expect(textoTransporte({ modalidad: 'M2', transporte: 300000 }, { transporte_descontado: true })).toBe('Incluido en la capitalización: $ 300.000');
    expect(textoTransporte({ modalidad: 'M3' }, { transporte_descontado: false })).toBe('Asumido por el beneficiario');
  });
  it('para aprobar se suma lo de la aprobación a lo de enviar', () => {
    const cl = { problemas_envio: ['a'], problemas_aprobacion: ['b'] };
    expect(problemasPara(cl, 'enviar')).toEqual(['a']);
    expect(problemasPara(cl, 'aprobar')).toEqual(['a', 'b']);
    expect(problemasPara(undefined, 'aprobar')).toEqual([]);
  });
  it('lee los pesos a la colombiana: punto de miles y coma decimal', () => {
    expect(valorPesos('1.500.000')).toBe('1500000');
    expect(valorPesos('1500000,50')).toBe('1500000.50');
    expect(valorPesos('1.500')).toBe('1500');
    expect(valorPesos('1500')).toBe('1500');
    expect(valorPesos('1.50')).toBeNull();
    expect(valorPesos('1,500,000')).toBeNull();
    expect(valorPesos('0')).toBeNull();
    expect(valorPesos('')).toBeNull();
  });
  it('cuenta proveedores distintos y pide la elegida (ET3-03)', () => {
    const l = { cotizaciones: [{ id_proveedor: 1 }, { id_proveedor: 2 }, { id_proveedor: 2 }] };
    expect(avanceCotizaciones(l)).toEqual({ n: 2, minimo: 3, completo: false });
    expect(avanceCotizaciones({ cotizaciones: [{ id_proveedor: 1 }, { id_proveedor: 2 }, { id_proveedor: 3, elegida: true }] }).completo).toBe(true);
  });
});
