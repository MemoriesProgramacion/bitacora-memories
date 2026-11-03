import { describe, it, expect } from 'vitest';
import { cumple, describirFiltro, FILTRO_VACIO } from '../src/components/FiltroBitacora';
import { buscarUnidades } from '../src/lib/utils';

const up = (extra) => ({
  region: '1', dpto: 'ANTIOQUIA', modalidad: 'M1', nodo: 'NODO1', habilitadas: '1', ...extra,
});

describe('filtro de la Bitácora (cumple)', () => {
  it('sin filtros pasa todo', () => {
    expect(cumple(up(), FILTRO_VACIO)).toBe(true);
  });

  it('cada campo puesto tiene que coincidir', () => {
    const f = { ...FILTRO_VACIO, dpto: 'ANTIOQUIA', modalidad: 'M1' };
    expect(cumple(up(), f)).toBe(true);
    expect(cumple(up({ modalidad: 'M2' }), f)).toBe(false);
  });

  it('estado: activa, inactiva y UP sin estado', () => {
    const activas = { ...FILTRO_VACIO, estado: 'activa' };
    const inactivas = { ...FILTRO_VACIO, estado: 'inactiva' };
    expect(cumple(up({ habilitadas: '1' }), activas)).toBe(true);
    expect(cumple(up({ habilitadas: '0' }), activas)).toBe(false);
    expect(cumple(up({ habilitadas: '0' }), inactivas)).toBe(true);
    // Sin dato de estado no cuenta ni como activa ni como inactiva.
    expect(cumple(up({ habilitadas: '' }), activas)).toBe(false);
    expect(cumple(up({ habilitadas: '' }), inactivas)).toBe(false);
  });

  it('el campo exceptuado no se evalúa (para armar las opciones en cascada)', () => {
    const f = { ...FILTRO_VACIO, nodo: 'NODO2', estado: 'inactiva' };
    expect(cumple(up(), f, 'nodo')).toBe(false);
    expect(cumple(up({ habilitadas: '0' }), f, 'nodo')).toBe(true);
    expect(cumple(up({ nodo: 'NODO2' }), f, 'estado')).toBe(true);
  });

  it('una UP vacía no pasa', () => {
    expect(cumple(null, FILTRO_VACIO)).toBe(false);
  });
});

describe('describirFiltro', () => {
  it('une los valores puestos y el estado', () => {
    expect(describirFiltro({ ...FILTRO_VACIO, dpto: 'ANTIOQUIA', nodo: 'NODO1', estado: 'inactiva' }))
      .toBe('ANTIOQUIA_NODO1_inactivas');
    expect(describirFiltro(FILTRO_VACIO)).toBe('');
  });
});

describe('buscarUnidades', () => {
  const datos = [
    { ID_unico: '3186', unidad_nombre: 'Panadería La Espiga', integrante_nombre1: 'Ana',
      integrante_apellido1: 'Pérez', unidad_doc: '1.023.456', nombre_gestor: 'Carlos Ruiz' },
    { ID_unico: '4001', unidad_nombre: 'Taller El Tornillo', integrante_nombre1: 'Luis',
      integrante_apellido1: 'Gómez', integrante_doc_inicial: '98765432' },
  ];
  const ids = (q) => buscarUnidades(datos, q).map((u) => u.ID_unico);

  it('busca por ID, cédula, representante, UP y gestor', () => {
    expect(ids('3186')).toEqual(['3186']);
    expect(ids('1023456')).toEqual(['3186']);
    expect(ids('1.023.456')).toEqual(['3186']);
    expect(ids('98765')).toEqual(['4001']);
    expect(ids('luis gómez')).toEqual(['4001']);
    expect(ids('TORNILLO')).toEqual(['4001']);
    expect(ids('carlos')).toEqual(['3186']);
  });

  it('texto vacío o sin coincidencias: nada', () => {
    expect(ids('')).toEqual([]);
    expect(ids('   ')).toEqual([]);
    expect(ids('zapatería')).toEqual([]);
  });

  it('devuelve máximo 50 resultados', () => {
    const muchas = Array.from({ length: 80 }, (_, i) => ({ ID_unico: `10${i}`, unidad_nombre: 'Tienda' }));
    expect(buscarUnidades(muchas, 'tienda')).toHaveLength(50);
  });
});

describe('filtro con Municipio (Cronograma y Ruta)', () => {
  const CON_MPIO = { region: 'region', dpto: 'dpto', mpio: 'mpio', modalidad: 'modalidad', nodo: 'nodo' };

  it('el municipio también tiene que coincidir', () => {
    const f = { ...FILTRO_VACIO, mpio: 'MEDELLIN' };
    expect(cumple(up({ mpio: 'MEDELLIN' }), f, null, CON_MPIO)).toBe(true);
    expect(cumple(up({ mpio: 'BELLO' }), f, null, CON_MPIO)).toBe(false);
  });

  it('sin la lista con municipio, el municipio no se evalúa', () => {
    expect(cumple(up({ mpio: 'BELLO' }), { ...FILTRO_VACIO, mpio: 'MEDELLIN' })).toBe(true);
  });

  it('describirFiltro incluye el municipio y «activas»', () => {
    expect(describirFiltro({ ...FILTRO_VACIO, dpto: 'ANTIOQUIA', mpio: 'MEDELLIN', estado: 'activa' }))
      .toBe('ANTIOQUIA_MEDELLIN_activas');
  });
});

describe('filtro: valores vacíos en la UP', () => {
  it('una UP sin el campo no pasa si ese filtro está puesto', () => {
    expect(cumple(up({ nodo: '' }), { ...FILTRO_VACIO, nodo: 'NODO1' })).toBe(false);
    expect(cumple(up({ nodo: 'null' }), { ...FILTRO_VACIO, nodo: 'NODO1' })).toBe(false);
  });

  it('la región se filtra igual que los demás campos', () => {
    expect(cumple(up(), { ...FILTRO_VACIO, region: '1' })).toBe(true);
    expect(cumple(up(), { ...FILTRO_VACIO, region: '2' })).toBe(false);
  });
});

describe('buscarUnidades: casos borde', () => {
  const datos = [
    { ID_unico: '3186', unidad_nombre: 'Panadería La Espiga', integrante_nombre1: 'Ana',
      integrante_nombre2: 'María', integrante_apellido1: 'Pérez', unidad_doc: '1023456' },
    { ID_unico: '4001', unidad_nombre: null, nombre_gestor: undefined },
  ];
  const ids = (q) => buscarUnidades(datos, q).map((u) => u.ID_unico);

  it('una UP con campos vacíos no rompe la búsqueda', () => {
    expect(ids('4001')).toEqual(['4001']);
  });

  it('busca por el segundo nombre', () => {
    expect(ids('ana maría')).toEqual(['3186']);
  });

  it('un texto sin dígitos no busca por cédula', () => {
    expect(ids('abc')).toEqual([]);
  });

  it('busca sin importar tildes (como el filtro por nodo)', () => {
    expect(ids('panaderia')).toEqual(['3186']);
    expect(ids('perez')).toEqual(['3186']);
  });
});
