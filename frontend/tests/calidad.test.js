import { describe, it, expect } from 'vitest';
import { revisar } from '../src/admin/Calidad.jsx';

const up = (id, extra = {}) => ({ id_unico: id, up_nombre: `UP ${id}`, rep_documento: `d${id}`, nodo: 'ATLAN1', up_modalidad: 'M1', up_departamento: 'X', up_municipio: 'Y', region: 'R1', triada: 'T1', ...extra });

describe('calidad de datos', () => {
  it('encuentra U.P. sin nodo, nodos sin gestor, documentos repetidos y gestores sin U.P.', () => {
    const unidades = [up(1), up(2, { nodo: '' }), up(3, { nodo: 'ZZZ9' }), up(4, { rep_documento: 'd1' })];
    const gestores = [{ nodo: 'ATLAN1', nombre: 'A' }, { nodo: 'BOLIV1', nombre: 'B' }];
    const r = revisar(unidades, gestores);
    const por = Object.fromEntries(r.problemas.map((p) => [p.id, p.filas.map((f) => f[0])]));
    expect(por.sin_nodo).toEqual([2]);
    expect(por.nodo_huerfano).toEqual([3]);
    expect(por.duplicadas.sort()).toEqual([1, 4]);
    expect(por.gestores_sin_up).toEqual(['—']);
  });
  it('cuenta los campos vacíos por columna y no falla sin datos', () => {
    const r = revisar([up(1, { up_modalidad: '' }), up(2, { up_modalidad: null })], []);
    expect(r.vaciosPorColumna.find((c) => c.nombre === 'Modalidad').vacios).toBe(2);
    expect(revisar([], []).problemas.every((p) => p.filas.length === 0)).toBe(true);
  });
});
