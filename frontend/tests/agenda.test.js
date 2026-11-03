// Agenda (LIT-h-02): semanas de lunes a domingo, horas, teléfonos y el reparto de citas que se cruzan.
import { describe, expect, it } from 'vitest';
import {
  inicioSemana, sumarDias, sumarMeses, mismoDia, claveDia, claveHora, horaCorta, titulo, normalizar, proximaHora,
  enlaceTel, telefonoLegible, representante, distribuir, ESTADOS, TIPOS,
} from '../src/lib/agenda';

const d = (dia, h = 0, m = 0) => new Date(2026, 9, dia, h, m); // octubre de 2026, hora local

describe('fechas de la agenda', () => {
  it('la semana empieza el lunes', () => {
    expect(claveDia(inicioSemana(d(24, 15)))).toBe('2026-10-19');   // sábado → lunes 19
    expect(claveDia(inicioSemana(d(19, 8)))).toBe('2026-10-19');    // el lunes es su propio inicio
    expect(claveDia(inicioSemana(d(25)))).toBe('2026-10-19');       // el domingo cierra la semana
  });

  it('sumar días y meses, comparar días y armar claves', () => {
    expect(claveDia(sumarDias(d(30, 9, 15), 3))).toBe('2026-11-02');
    expect(claveHora(sumarDias(d(30, 9, 15), 3))).toBe('09:15');
    expect(claveDia(sumarMeses(d(31), 1))).toBe('2026-11-01');
    expect(mismoDia(d(24, 1), d(24, 23))).toBe(true);
    expect(mismoDia(d(24), d(25))).toBe(false);
  });

  it('horas cortas para los bloques del calendario', () => {
    expect(horaCorta(d(24, 13, 5))).toBe('1:05');
    expect(horaCorta(d(24, 0, 0))).toBe('12:00');
    expect(horaCorta(d(24, 9, 30))).toBe('9:30');
  });

  it('el título dice el rango que se ve', () => {
    expect(titulo('semana', d(24))).toMatch(/^19 – 25 de .+ 2026$/);
    expect(titulo('dia', d(24))).toMatch(/^Sábado/);
    expect(titulo('mes', d(24))).toMatch(/^Octubre/);
    expect(titulo('semana', d(29))).toMatch(/^26 .+ – 1 .+ 2026$/);  // semana que cruza de mes
  });

  it('una cita del servidor trae su fin; la nueva se propone a la hora en punto siguiente', () => {
    const c = normalizar({ inicio: d(24, 9).toISOString(), duracion_min: 45 });
    expect(claveHora(c.fin)).toBe('09:45');
    expect(claveHora(normalizar({ inicio: d(24, 9).toISOString() }).fin)).toBe('09:30');   // 30 minutos por defecto
    expect(claveHora(proximaHora(d(24, 9, 40)))).toBe('10:00');
    expect(claveDia(proximaHora(d(24, 23, 10)))).toBe('2026-10-25');
  });
});

describe('teléfonos y nombres', () => {
  it('el enlace marca solo dígitos y el texto se lee por grupos', () => {
    expect(enlaceTel('(310) 123-4567')).toBe('tel:3101234567');
    expect(enlaceTel('+57 310 123 4567')).toBe('tel:+573101234567');
    expect(telefonoLegible('3101234567')).toBe('310 123 4567');
    expect(telefonoLegible('6051234')).toBe('6051234');
    expect(telefonoLegible(null)).toBe('');
  });

  it('el representante junta los nombres que existan', () => {
    expect(representante({ integrante_nombre1: 'Ana', integrante_apellido1: 'Pérez', integrante_apellido2: '' })).toBe('Ana Pérez');
  });

  it('cada estado y tipo tiene su texto', () => {
    expect(Object.values(ESTADOS).every((e) => e.texto && e.borde && e.fondo)).toBe(true);
    expect(Object.keys(TIPOS)).toEqual(['llamada', 'visita', 'reunion']);
  });
});

describe('citas que se cruzan', () => {
  const cita = (id, h1, m1, h2, m2) => ({ id, ini: d(24, h1, m1), fin: d(24, h2, m2) });

  it('las que se cruzan comparten el ancho y la que va sola lo ocupa todo', () => {
    const r = distribuir([cita('c', 11, 0, 11, 30), cita('b', 9, 30, 10, 30), cita('a', 9, 0, 10, 0)]);
    const de = (id) => r.find((x) => x.cita.id === id);
    expect([de('a').col, de('a').columnas]).toEqual([0, 2]);
    expect([de('b').col, de('b').columnas]).toEqual([1, 2]);
    expect([de('c').col, de('c').columnas]).toEqual([0, 1]);
  });

  it('una columna libre se vuelve a usar dentro del mismo grupo', () => {
    const r = distribuir([cita('a', 9, 0, 12, 0), cita('b', 9, 0, 10, 0), cita('c', 10, 0, 11, 0)]);
    expect(r.map((x) => [x.cita.id, x.col, x.columnas])).toEqual([['a', 0, 2], ['b', 1, 2], ['c', 1, 2]]);
    expect(distribuir([])).toEqual([]);
  });
});
