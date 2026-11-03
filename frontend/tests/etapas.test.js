// Etapas documentales y ruta de atención de la Bitácora (LIT-h-02): cómo se leen los checks, las banderas y los
// estados de cada paso de la ruta.
import { describe, expect, it } from 'vitest';
import {
  STAGES, RUTA, parseChecks, parseFiles, completaEstado, hasRIT, estPlanInversion, estPlanNegocio, estPdfCarrito,
  estSubsanacion, subsanacionPendiente, estEntregaValidador, pasoLogrado, pasoEstadoUP, isInactiva, estadoUpLabel,
} from '../src/lib/etapas';

describe('checks y archivos', () => {
  it('lee el texto con emojis y las listas que ya trae la API', () => {
    expect(parseChecks('✅ CEDULA | ❌ RUT | X Acta | ')).toEqual([
      { label: 'CEDULA', ok: true, bad: false }, { label: 'RUT', ok: false, bad: true }, { label: 'Acta', ok: false, bad: true },
    ]);
    expect(parseChecks([{ label: 'A', ok: true }, null, { ok: false }])).toEqual([{ label: 'A', ok: true }]);
    expect(parseChecks('')).toEqual([]);
    expect(parseFiles('a.pdf, b.pdf,,')).toEqual(['a.pdf', 'b.pdf']);
    expect(parseFiles(['a.pdf', '', null])).toEqual(['a.pdf']);
    expect(parseFiles(null)).toEqual([]);
  });

  it('la bandera de la etapa: completa, subsanar, vacía o sin dato', () => {
    expect(completaEstado({ K: '1' }, 'K')).toEqual({ label: 'Completa', tono: 'ok' });
    expect(completaEstado({ K: 'sí' }, 'K')).toEqual({ label: 'Completa', tono: 'ok' });
    expect(completaEstado({ K: '0.0' }, 'K')).toEqual({ label: 'Subsanar', tono: 'bad' });
    expect(completaEstado({ K: 'quizá' }, 'K')).toEqual({ label: 'Vacía', tono: 'bad' });   // sin falso OK
    expect(completaEstado({ K: '' }, 'K')).toBeNull();
    expect(completaEstado(null, 'K')).toBeNull();
    expect(hasRIT({ TIENE_RIT: 'SI' })).toBe(true);
    expect(hasRIT({ RIT: 'no' })).toBe(false);
    expect(hasRIT({})).toBeNull();
  });
});

describe('estados que vienen de la base', () => {
  it('viabilidad, aprobación, carrito y subsanación', () => {
    expect(estPlanInversion({ plan_inversion: 'No Viabilidad' }).tono).toBe('bad');   // va antes que «Viabilidad»
    expect(estPlanInversion({ plan_inversion: 'Viabilidad' }).tono).toBe('ok');
    expect(estPlanInversion({ plan_inversion: 'Solicitud de subsanación' }).label).toBe('Solicitud Subsanación');
    expect(estPlanInversion({ plan_inversion: '#N/A' })).toBeNull();
    expect(estPlanNegocio({ plan_negocio: 'NO APROBADO' }).tono).toBe('bad');
    expect(estPlanNegocio({ plan_negocio: 'Aprobado' }).tono).toBe('ok');
    expect(estPdfCarrito({ PDF_carrito: 'procesado' }).tono).toBe('ok');
    expect(estSubsanacion({ proceso_subsanacion: 'Pendiente de Proceso de Subsanación' }).tono).toBe('bad');
    expect(estSubsanacion({ proceso_subsanacion: 'No Aplica' }).tono).toBe('neutral');
    expect(subsanacionPendiente({ proceso_subsanacion: 'Pendiente de proceso' })).toBe(true);
    expect(subsanacionPendiente({})).toBe(false);
    expect(estEntregaValidador({ estado_entrega: 'correcciones' })).toEqual({ label: 'Por corregir', tono: 'bad' });
    expect(estEntregaValidador({ estado_entrega: 'otro' })).toEqual({ label: 'otro', tono: 'warn' });
    expect(estEntregaValidador({})).toBeNull();
  });

  it('el estado de la unidad sale de «habilitadas»', () => {
    expect(isInactiva({ habilitadas: '0' })).toBe(true);
    expect(estadoUpLabel({ habilitadas: '1' })).toBe('Activa');
    expect(estadoUpLabel({ habilitadas: '0' })).toBe('Inactiva');
    expect(estadoUpLabel({})).toBeNull();
  });
});

describe('ruta de atención', () => {
  const paso = (n) => RUTA.find((s) => s.n === n);

  it('tiene los 12 pasos en orden y las etapas anidadas apuntan a pasos que existen', () => {
    expect(RUTA.map((s) => s.n)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
    for (const e of STAGES.filter((x) => x.bajoPaso)) expect(paso(e.bajoPaso), e.titulo).toBeTruthy();
  });

  it('cada tipo de paso decide si la unidad lo logró', () => {
    const aud = { TIENE_RIT: '1', DOC_COMPLETA_VISITA_1: 'TRUE', DOC_COMPLETA_VISITA_2: '0', EVENTO: 'asiste' };
    expect(pasoLogrado(paso('1'), {}, aud)).toBe(true);
    expect(pasoLogrado(paso('2'), {}, aud)).toBe(true);
    expect(pasoLogrado(paso('3'), {}, aud)).toBe(false);
    expect(pasoLogrado(paso('12'), {}, aud)).toBe(true);
    expect(pasoLogrado(paso('6'), { plan_inversion: 'Viabilidad' }, null)).toBe(true);   // los estados no dependen de la auditoría
    expect(pasoLogrado(paso('2'), {}, null)).toBe(false);
    // Subsanaciones cuenta las pendientes, no las logradas.
    expect(pasoLogrado(paso('8'), { proceso_subsanacion: 'Pendiente' }, aud)).toBe(true);
  });

  it('y cómo se ve en la ficha', () => {
    expect(pasoEstadoUP(paso('1'), {}, { RIT: '0' })).toEqual({ label: 'Sin RIT', tono: 'bad' });
    expect(pasoEstadoUP(paso('12'), {}, { EVENTO: 'No asiste' })).toEqual({ label: 'No asiste', tono: 'bad' });
    expect(pasoEstadoUP(paso('3'), {}, { DOC_COMPLETA_VISITA_2: '0' })).toEqual({ label: 'Subsanar', tono: 'bad' });
    expect(pasoEstadoUP(paso('3'), {}, {})).toBeNull();
    expect(pasoEstadoUP(paso('2'), {}, null)).toBeNull();
  });
});
