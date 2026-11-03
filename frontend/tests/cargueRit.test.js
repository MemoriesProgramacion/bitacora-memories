// Cargue del RIT: las filas que viajan al servidor y el texto de los errores (src/lib/cargueRit.js).
import { describe, it, expect } from 'vitest';
import { prepararFilasRit, textoErrorRit, COLUMNAS_RIT, HOJA_RIT } from '../src/lib/cargueRit.js';

describe('cargue del RIT', () => {
  it('lee la hoja RIT con las columnas cedula y nombre', () => {
    expect(HOJA_RIT).toBe('RIT');
    expect(COLUMNAS_RIT.map((c) => c.nombre)).toEqual(['cedula', 'nombre']);
    expect(COLUMNAS_RIT.every((c) => !c.opcional)).toBe(true);
  });

  it('cada fila conserva su número del Excel', () => {
    const { filas, errores } = prepararFilasRit([
      { _fila: 2, cedula: '1001', nombre: 'Ana Pérez' },
      { _fila: 5, cedula: '1002', nombre: 'Luis Gómez' },
    ]);
    expect(errores).toEqual([]);
    expect(filas).toEqual([
      { fila: 2, cedula: '1001', nombre: 'Ana Pérez' },
      { fila: 5, cedula: '1002', nombre: 'Luis Gómez' },
    ]);
  });

  it('una cédula repetida (aunque cambie el formato) se envía una vez y la repetida queda como error', () => {
    const { filas, errores } = prepararFilasRit([
      { _fila: 2, cedula: '1.001.000', nombre: 'Ana Pérez' },
      { _fila: 3, cedula: '1002', nombre: 'Luis Gómez' },
      { _fila: 4, cedula: '1001000', nombre: 'Ana Pérez' },
      { _fila: 6, cedula: ' 1001000 ', nombre: 'Otra Persona' },
    ]);
    expect(filas.map((f) => f.fila)).toEqual([2, 3]);
    expect(errores).toHaveLength(2);
    expect(errores[0]).toMatchObject({ fila: 4, columna: 'cedula' });
    expect(errores[0].motivo).toContain('fila 2');
    expect(errores[0].motivo).not.toContain('otro nombre');
    expect(errores[1].motivo).toContain('otro nombre');
  });

  it('las filas sin cédula pasan al servidor, que es quien dice qué falta', () => {
    const { filas, errores } = prepararFilasRit([{ _fila: 7, cedula: '', nombre: 'Sin cédula' }]);
    expect(errores).toEqual([]);
    expect(filas).toEqual([{ fila: 7, cedula: '', nombre: 'Sin cédula' }]);
  });

  it('el texto del error dice la fila y la columna', () => {
    expect(textoErrorRit({ fila: 9, columna: 'nombre', motivo: 'El nombre está vacío.' }))
      .toBe('Fila 9 · columna nombre: El nombre está vacío.');
    expect(textoErrorRit({ columna: 'cedula', motivo: 'x' })).toBe('Fila ? · columna cedula: x');
  });
});
