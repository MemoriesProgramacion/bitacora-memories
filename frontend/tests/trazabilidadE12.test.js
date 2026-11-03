// E12 · Trazabilidad (TR-15, DOC-04): el historial nombra el módulo y la acción y muestra el antes y el después de
// cualquier cambio que guarde el servidor en actividad (cambios.campos = { campo: [antes, después] }).
import { describe, expect, it } from 'vitest';
import { filasGenericas, moduloDe, nombreAccion, nombreCampo, prefijoDe, valorTexto } from '../src/lib/historial';
import { ROLES, ROLES_ACTIVIDAD, nombreRol } from '../src/admin/etiquetas';

describe('módulo y nombre de cada acción', () => {
  it('por el prefijo de «modulo.accion»', () => {
    expect([prefijoDe('carrito.estado'), moduloDe('carrito.estado'), moduloDe('agenda.guardar'), moduloDe('inventario.entrega_kit')])
      .toEqual(['carrito', 'Plan de capitalización', 'Agenda', 'Inventario']);
    expect(moduloDe('nuevo_modulo.algo')).toBe('Nuevo modulo');
    expect(moduloDe('')).toBe('Otro');
  });
  it('las conocidas por su nombre y las demás con su módulo', () => {
    expect(nombreAccion('compras.guardar')).toBe('Compras y logística');
    expect(nombreAccion('agenda.cambiar_estado')).toBe('Agenda · cambiar estado');
    expect(nombreAccion('metas')).toBe('Metas');
  });
  it('Usuarios activos nombra las operaciones por módulo con los mismos nombres (llegan como prefijo)', () => {
    expect(['agenda', 'soporte', 'kit_defectuoso', 'config'].map(moduloDe)).toEqual(['Agenda', 'Expediente', 'Elementos defectuosos', 'Configuración']);
  });
  it('el proceso automático tiene nombre en la actividad, sin volverse un rol de cuenta', () => {
    expect(nombreRol('sistema')).toBe('Proceso automático');
    expect(ROLES_ACTIVIDAD.sistema).toBe('Proceso automático');
    expect('sistema' in ROLES).toBe(false);
    expect([nombreRol('gestor'), nombreRol('otro_rol'), nombreRol(null)]).toEqual(['Gestor', 'otro_rol', null]);
  });
});

describe('nombre de los campos', () => {
  it('con tildes y eñes para las claves frecuentes; las demás desde la clave', () => {
    expect(['tamano', 'justificacion', 'observacion', 'descripcion', 'numero', 'retirada_dps'].map(nombreCampo))
      .toEqual(['Tamaño', 'Justificación', 'Observación', 'Descripción', 'Número', 'Retirada por el DPS']);
    expect(nombreCampo('lote')).toBe('Del cargue masivo n.º');
    expect([nombreCampo('fecha_entrega'), nombreCampo('constructor'), nombreCampo('toString')]).toEqual(['Fecha entrega', 'Constructor', 'ToString']);
  });
});

describe('antes y después', () => {
  it('solo cambios.campos y las claves de par conocidas; las demás listas se muestran unidas', () => {
    const filas = filasGenericas({ campos: { estado: ['programada', 'realizada'], telefono: ['1', '2'], notas: 'Llamó' }, n: 3, ids: ['A', 'B'], motivo: ['a', 'b'], habilitada: [true, false] },
      { conocidos: { telefono: 'Teléfono' } });
    expect(filas).toEqual([
      { campo: 'Estado', antes: 'programada', despues: 'realizada', conAntes: true },
      { campo: 'Notas', despues: 'Llamó' },
      { campo: 'Cantidad', despues: '3' },
      { campo: 'Identificadores', despues: 'A, B' },
      { campo: 'Motivo', despues: 'a, b' },
      { campo: 'Habilitada', antes: 'Sí', despues: 'No', conAntes: true },
    ]);
  });
  it('una lista de dos documentos no es el cambio de uno por otro', () => {
    expect(filasGenericas({ acta: 7, ingresos: ['1001', '1002'], retiros: ['2001'], activos: [3, 4] })).toEqual([
      { campo: 'Acta', despues: '7' },
      { campo: 'Ingresos', despues: '1001, 1002' },
      { campo: 'Retiros', despues: '2001' },
      { campo: 'Activos', antes: '3', despues: '4', conAntes: true },
    ]);
  });
  it('un par acepta null en cualquiera de las dos posiciones', () => {
    expect(filasGenericas({ justificacion: [null, 'Se cambia el horno'], reporte: [null, 'Ana Pérez'], nodo: ['ATLAN1', null] })).toEqual([
      { campo: 'Justificación', antes: '(vacío)', despues: 'Se cambia el horno', conAntes: true },
      { campo: 'Reporte', antes: '(vacío)', despues: 'Ana Pérez', conAntes: true },
      { campo: 'Nodo', antes: 'ATLAN1', despues: '(vacío)', conAntes: true },
    ]);
    expect(filasGenericas({ campos: { fecha_lectura: [null, '2026-10-20'] } }))
      .toEqual([{ campo: 'Fecha de lectura', antes: '(vacío)', despues: '2026-10-20', conAntes: true }]);
  });
  it('los objetos: antes y después campo a campo; los demás, una fila por clave', () => {
    expect(filasGenericas({ antes: { nombre: 'Ana', telefono: '300', tipo: 'socio' }, despues: { nombre: 'Ana', telefono: '301', tipo: 'socio' } }))
      .toEqual([{ campo: 'Teléfono', antes: '300', despues: '301', conAntes: true }]);
    expect(filasGenericas({ antes: null, despues: { nombre: 'Ana' } })).toEqual([{ campo: 'Nombre', antes: '(vacío)', despues: 'Ana', conAntes: true }]);
    expect(filasGenericas({ quitado: { nombre: 'Ana', documento: '1001' } }))
      .toEqual([{ campo: 'Quitado · Nombre', despues: 'Ana' }, { campo: 'Quitado · Documento', despues: '1001' }]);
    // diagnostico.* y evaluacion.* guardan cambios: [sección antes, sección después].
    expect(filasGenericas({ seccion: 'negocio', cambios: [{ ventas: 10, empleos: 2 }, { ventas: 12, empleos: 2 }] }))
      .toEqual([{ campo: 'Sección', despues: 'negocio' }, { campo: 'Ventas', antes: '10', despues: '12', conAntes: true }]);
    expect(filasGenericas({ documentos: {} })).toEqual([]);
  });
  it('omite lo que ya se pinta aparte', () => {
    expect(filasGenericas({ compras: [{ item_n: 1 }], logistica: { x: 1 }, total: [5, 6] }, { omitir: ['compras', 'logistica'] }))
      .toEqual([{ campo: 'Total', antes: '5', despues: '6', conAntes: true }]);
  });
  it('valores', () => {
    expect([valorTexto(null), valorTexto(true), valorTexto(false), valorTexto([]), valorTexto(['a', 2]), valorTexto({ a: 1 })]).toEqual(['(vacío)', 'Sí', 'No', '(vacío)', 'a, 2', '{"a":1}']);
  });
});
