import { describe, expect, it } from 'vitest';
import { CONFIRMACION, moduloLimite, resumenConfirmaciones, textoModulo } from '../src/sections/talleres/confirmacion';

describe('confirmación de la convocatoria en la lista de asistencia', () => {
  it('resume cuántas UP confirmaron, dijeron que no o siguen sin confirmar', () => {
    const ups = [{ id_up: 1 }, { id_up: 2 }, { id_up: 3 }, { id_up: 4 }];
    const conf = { 1: { situacion: 'asistira' }, 2: { situacion: 'no_asistira' }, 3: { situacion: 'no_contesto' } };
    expect(resumenConfirmaciones(ups, conf)).toEqual({ asistira: 1, no_asistira: 1, sin_confirmar: 2 });
    expect(resumenConfirmaciones(ups)).toEqual({ asistira: 0, no_asistira: 0, sin_confirmar: 4 });
  });

  it('nombra el módulo de la llamada y cada situación', () => {
    expect(textoModulo(2)).toBe('Módulo 2');
    expect(textoModulo(null)).toBe('Todo el taller');
    expect(CONFIRMACION.no_asistira[1]).toBe('Dijo que no asistirá');
    expect(CONFIRMACION.por_llamar[1]).toBe('Sin confirmar por llamada');
  });

  it('una llamada agendada va antes de su módulo o del primer módulo pendiente', () => {
    const enc = [{ modulo: 2, inicio: 'b', realizado_en: null }, { modulo: 1, inicio: 'a', realizado_en: 'x' }, { modulo: 3, inicio: 'c', realizado_en: null }];
    expect(moduloLimite(enc, '').modulo).toBe(2);
    expect(moduloLimite(enc, '3').modulo).toBe(3);
    expect(moduloLimite(enc, 1)).toBeNull();
    expect(moduloLimite(enc.map((e) => ({ ...e, realizado_en: 'x' })), '')).toBeNull();
  });
});
