import { describe, it, expect } from 'vitest';
import {
  val, normVal, pick, esErrorHoja, fullName, normDoc, uniqueSorted, countBy, formatDateEs,
} from '../src/lib/utils';

describe('val', () => {
  it('vacío, nulo o «null» es null; lo demás, texto', () => {
    for (const v of [null, undefined, '', 'null']) expect(val(v)).toBeNull();
    expect(val(0)).toBe('0');
    expect(val('NODO1')).toBe('NODO1');
  });
});

describe('normVal', () => {
  it('mayúsculas, sin tildes y sin espacios a los lados', () => {
    expect(normVal(' Nódo uno ')).toBe('NODO UNO');
  });
});

describe('pick', () => {
  it('toma el primer nombre que exista', () => {
    expect(pick({ b: 2, a: 1 }, ['a', 'b'])).toBe(1);
  });

  it('tolera mayúsculas, tildes, espacios y guiones en el nombre del campo', () => {
    expect(pick({ 'Región ': 'R1' }, ['region'])).toBe('R1');
    expect(pick({ ID_Unico: '7' }, ['id unico'])).toBe('7');
  });

  it('sin objeto o sin coincidencia: undefined', () => {
    expect(pick(null, ['a'])).toBeUndefined();
    expect(pick({ a: 1 }, ['z'])).toBeUndefined();
  });
});

describe('esErrorHoja', () => {
  it.each(['#N/A', '#REF!', '#VALUE!', '#DIV/0!', '#NAME?', ' #error '])('%s es error', (v) => {
    expect(esErrorHoja(v)).toBe(true);
  });

  it('los datos normales no son error', () => {
    for (const v of [null, undefined, '', 'Hash #1', 0]) expect(esErrorHoja(v)).toBe(false);
  });
});

describe('fullName', () => {
  it('une nombres y apellidos que haya', () => {
    expect(fullName({ integrante_nombre1: 'Ana', integrante_nombre2: '', integrante_apellido1: 'Pérez',
      integrante_apellido2: 'null' })).toBe('Ana Pérez');
    expect(fullName(null)).toBe('');
  });
});

describe('normDoc', () => {
  it('deja solo los dígitos', () => {
    expect(normDoc('C.C. 1.023.456')).toBe('1023456');
    expect(normDoc(null)).toBe('');
  });
});

describe('uniqueSorted', () => {
  it('sin repetidos ni vacíos, en orden alfabético en español', () => {
    expect(uniqueSorted(['Ñame', 'nodo', 'Antioquia', 'nodo', '', null, 'Ábrego'])).toEqual(
      ['Ábrego', 'Antioquia', 'nodo', 'Ñame'],
    );
  });
});

describe('countBy', () => {
  it('cuenta por valor, de mayor a menor; lo vacío va como «Sin dato»', () => {
    const filas = [{ n: 'A' }, { n: 'B' }, { n: 'A' }, { n: '' }];
    expect(countBy(filas, 'n')).toEqual([
      { label: 'A', n: 2 }, { label: 'B', n: 1 }, { label: 'Sin dato', n: 1 },
    ]);
  });
});

describe('formatDateEs', () => {
  it('día de mes de año', () => {
    expect(formatDateEs(new Date(2026, 9, 12))).toBe('12 de octubre de 2026');
  });
});
