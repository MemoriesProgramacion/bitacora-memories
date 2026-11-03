import { describe, it, expect } from 'vitest';
import { diaColombia, diasCalendario, moverMes, inicioISO, fechaInput, claveAsistente } from '../src/sections/talleres/fechas';

describe('calendario de encuentros y asistencia por UP', () => {
  it('ubica un evento UTC en el día correspondiente de Colombia', () => {
    expect(diaColombia('2026-11-01T02:00:00Z')).toBe('2026-10-31');
    expect(diaColombia('2026-11-01T05:00:00Z')).toBe('2026-11-01');
    expect(fechaInput(inicioISO('2026-10-22T14:30'))).toBe('2026-10-22T14:30');
  });
  it('incluye los días contiguos y seis semanas completas desde el lunes', () => {
    const dias = diasCalendario('2026-11');
    expect(dias).toHaveLength(42);
    expect(dias[0]).toBe('2026-10-26');
    expect(dias[6]).toBe('2026-11-01');
    expect(dias[41]).toBe('2026-12-06');
    expect(new Set(dias).size).toBe(42);
  });
  it('permite recorrer meses pasados y futuros al cambiar de año', () => {
    expect(moverMes('2026-12', 1)).toBe('2027-01');
    expect(moverMes('2026-01', -1)).toBe('2025-12');
    expect(diasCalendario('2028-02')).toContain('2028-02-29');
    expect(diasCalendario('2027-02')).not.toContain('2027-02-29');
  });
  it('distingue la asistencia de dos UP aunque compartan representante', () => {
    expect(claveAsistente({id_up:1,documento:'111'})).toBe('up:1');
    expect(claveAsistente({id_up:2,documento:'111'})).toBe('up:2');
    expect(claveAsistente({documento:'111'})).toBe('111');
  });
});
