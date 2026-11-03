// E11 · Alistamiento, retiros y cierre: las causales, lo que falta en cada formulario y la carga de los gestores.
// Las reglas son del servidor (backend/src/servicios/retiros.js y alistamiento.js); las causales deben ser las mismas.
import { describe, expect, it } from 'vitest';
import {
  CAUSALES, TIPOS_EVENTO_EQUIPO, columnasRetiros, columnasUnidadesEstado, departamentosDe, faltasEvento, faltasRetiro, filasSelector,
  filtrarUnidadesEstado, textoCarga, textoDesactivacion,
} from '../src/lib/alistamiento';
import { CAUSALES as CAUSALES_SERVIDOR } from '../../backend/src/servicios/retiros.js';
import { TIPOS_EVENTO } from '../../backend/src/servicios/alistamiento.js';

const pdf = { name: 'acta.pdf' };
const png = { name: 'foto.png' };

describe('retiro y reemplazo (ET1-26, ET1-27, NOV-01)', () => {
  it('las 9 causales son las del servidor', () => {
    expect(Object.keys(CAUSALES)).toHaveLength(9);
    expect(CAUSALES).toEqual(CAUSALES_SERVIDOR);
    expect(TIPOS_EVENTO_EQUIPO).toEqual(TIPOS_EVENTO);
  });
  it('el retiro exige la unidad, el ticket de la etapa Retiro, la causal y el acta', () => {
    expect(faltasRetiro({ tipo: 'retiro', id_unico: 'A', id_ticket: '7', causal: 'fallecimiento' }, { acta: pdf })).toEqual([]);
    expect(faltasRetiro({ tipo: 'retiro', id_unico: 'A', id_ticket: '', causal: 'fallecimiento' }, { acta: pdf }))
      .toEqual(['Elige el ticket de la etapa Retiro que se resuelve con este registro.']);
    expect(faltasRetiro({ tipo: 'retiro', id_unico: '', id_ticket: '', causal: 'otra' }, { acta: { name: 'acta.jpg' } })).toHaveLength(4);
  });
  it('si la unidad tiene personal activo hay que elegir quién sale: varios en el retiro, uno solo en el reemplazo', () => {
    const retiro = { tipo: 'retiro', id_unico: 'A', id_ticket: '7', causal: 'fallecimiento', personal_sale: [] };
    expect(faltasRetiro(retiro, { acta: pdf, personalDisponible: 3 })).toEqual(['Elige el personal de la unidad que sale.']);
    expect(faltasRetiro({ ...retiro, personal_sale: [1, 2] }, { acta: pdf, personalDisponible: 3 })).toEqual([]);
    // Sin personal registrado no hay nada que elegir.
    expect(faltasRetiro(retiro, { acta: pdf, personalDisponible: 0 })).toEqual([]);
    const persona = { nombre: 'Rosa Elena Gómez', documento: '52123456', telefono: '3001234567', sexo: 'mujer' };
    const r = { tipo: 'reemplazo', id_unico: 'A', id_ticket: '8', causal: 'informacion_falsa', comite_fecha: '2026-10-20', comite_concepto: 'Aprobado', persona, personal_sale: [] };
    const op = { acta: pdf, actaComite: pdf, personalDisponible: 2 };
    expect(faltasRetiro(r, op)).toEqual(['Elige a la persona de la unidad que sale (1 a 1).']);
    expect(faltasRetiro({ ...r, personal_sale: [1, 2] }, op)).toEqual(['Elige a la persona de la unidad que sale (1 a 1).']);
    expect(faltasRetiro({ ...r, personal_sale: [1] }, op)).toEqual([]);
  });
  it('el reemplazo es 1 a 1: además del Comité y su ticket, exige UNA persona que entra con los datos del ingreso', () => {
    const persona = { nombre: 'Rosa Elena Gómez', documento: '52123456', telefono: '3001234567', sexo: 'mujer' };
    const r = { tipo: 'reemplazo', id_unico: 'A', id_ticket: '8', causal: 'informacion_falsa', comite_fecha: '2026-10-20', comite_concepto: 'Aprobado', persona };
    expect(faltasRetiro(r, { acta: pdf, actaComite: pdf })).toEqual([]);
    const falta = ['Completa los datos de la persona que entra (nombre completo, cédula, teléfono y sexo).'];
    expect(faltasRetiro({ ...r, persona: { ...persona, nombre: 'Rosa' } }, { acta: pdf, actaComite: pdf })).toEqual(falta);
    expect(faltasRetiro({ ...r, persona: { ...persona, documento: '12' } }, { acta: pdf, actaComite: pdf })).toEqual(falta);
    expect(faltasRetiro({ ...r, persona: { ...persona, telefono: '' } }, { acta: pdf, actaComite: pdf })).toEqual(falta);
    expect(faltasRetiro({ ...r, persona: { ...persona, sexo: '' } }, { acta: pdf, actaComite: pdf })).toEqual(falta);
    expect(faltasRetiro({ ...r, persona: undefined }, { acta: pdf, actaComite: pdf })).toEqual(falta);
    expect(faltasRetiro({ ...r, id_ticket: '' }, { acta: pdf, actaComite: pdf }))
      .toEqual(['Elige el ticket de la etapa Reemplazo que se resuelve con este registro.']);
    expect(faltasRetiro({ ...r, comite_concepto: ' ' }, { acta: pdf })).toEqual(['Escribe el concepto del Comité Técnico.', 'Adjunta el acta del Comité Técnico en PDF.']);
  });
  it('el Excel lleva la causal, el Comité, quién entra y el ticket', () => {
    const fila = { creado_en: '2026-10-20T15:00:00Z', tipo: 'reemplazo', id_unico: 'A', nombre_causal: 'Retiro voluntario', comite: { fecha: '2026-10-19', concepto: 'Sí' }, ticket: 'TK-00013' };
    const v = (r) => Object.fromEntries(columnasRetiros().map((c) => [c.titulo, c.valor({ ...fila, ...r })]));
    expect(v({ personal_sale: [{ nombre: 'Ana Pérez', documento: '123' }, { nombre: 'Luis Mora', documento: '456' }] })['Personal que sale']).toBe('Ana Pérez · 123; Luis Mora · 456');
    expect(v({ persona_entra: { nombre: 'Rosa Elena Gómez', documento: '52123456' } }))
      .toMatchObject({ Fecha: '2026-10-20', Tipo: 'Reemplazo', 'Concepto del Comité': 'Sí', Entra: 'Rosa Elena Gómez · 52123456', Ticket: 'TK-00013' });
    // Los reemplazos de antes entraban con una unidad elegible.
    expect(v({ id_unico_entra: 'B', unidad_entra: 'Panadería' }).Entra).toBe('B · Panadería');
  });
});

describe('eventos del equipo (ET0-03, ET0-04, ET4-07)', () => {
  it('cada tipo pide lo suyo', () => {
    expect(faltasEvento('kit_gestor', { fecha: '2026-10-20', id_gestor: '3', contenido: 'Chaleco' }, { acta: pdf })).toEqual([]);
    expect(faltasEvento('kit_gestor', { fecha: '', id_gestor: '', contenido: '' }, {})).toHaveLength(4);
    expect(faltasEvento('transferencia', { fecha: '2026-10-20', lugar: 'Bogotá' }, { lista: pdf, fotos: [png], asistentes: ['gestor:1'] })).toEqual([]);
    expect(faltasEvento('transferencia', { fecha: '2026-10-20', lugar: 'Bogotá' }, { lista: pdf, fotos: [{ name: 'x.gif' }], asistentes: [] }))
      .toEqual(['Las fotos deben ser JPG o PNG.', 'Marca a los integrantes del equipo que asistieron.']);
    expect(faltasEvento('cierre', { fecha: '2026-10-20', lugar: 'Barranquilla', departamento: 'Atlántico' }, { lista: pdf, fotos: [png], presentacion: pdf, asistentes: ['A'] })).toEqual([]);
    expect(faltasEvento('cierre', { fecha: '2026-10-20', lugar: 'B', departamento: '' }, { lista: pdf, fotos: [png], asistentes: [] }))
      .toEqual(['Elige el departamento.', 'Adjunta la presentación de resultados en PDF.', 'Marca las unidades que asistieron.']);
  });
});

describe('carga de los gestores (ET0-02, FUN-GES-08)', () => {
  it('cuenta frente al tope de 50 y colorea', () => {
    expect(textoCarga({ unidades: 12, tope: 50 })).toEqual({ texto: '12 de 50 unidades', porcentaje: 24, tono: 'ok' });
    expect(textoCarga({ unidades: 50, tope: 50 }).tono).toBe('alerta');
    expect(textoCarga({ unidades: 51, tope: 50 })).toMatchObject({ porcentaje: 100, tono: 'error' });
  });
  it('adapta las unidades al selector y saca los departamentos', () => {
    const u = [{ id_unico: 'A', up_nombre: 'Pan', up_municipio: 'Soledad', up_departamento: 'Atlántico', nodo: 'ATLAN1', up_habilitada: false },
      { id_unico: 'B', up_nombre: 'Café', up_departamento: ' Bolívar ', nodo: 'BOLIV1', up_habilitada: true }];
    expect(filasSelector(u).map((f) => [f.ID_unico, f.habilitadas])).toEqual([['A', '0'], ['B', '1']]);
    expect(filasSelector([{ id_unico: 'C', rep_nombre1: 'Ana', rep_apellido1: 'Ruiz' }])[0]).toMatchObject({ integrante_nombre1: 'Ana', integrante_apellido1: 'Ruiz', nodo: '' });
    expect(departamentosDe(u)).toEqual(['Atlántico', 'Bolívar']);
  });
});

describe('estado de las unidades: activas y desactivadas (Coordinador general)', () => {
  const items = [
    { id_unico: '70009', nombre: 'Panadería La Esperanza', representante: 'Diana Torres', municipio: 'Cartagena', nodo: 'BOLIV1', estado: 'activa', desactivacion: null },
    { id_unico: 'BOL-DEMO-01', nombre: 'Panadería Brisas del Mar', representante: 'Marta Pérez', municipio: 'Cartagena', nodo: 'BOLIV1', estado: 'desactivada',
      desactivacion: { motivo: 'retirada', tipo: 'retiro', causal: 'Retiro voluntario', ticket: 'TK-00015', fecha: '2026-10-27T15:00:00Z', registrado_por: 'Local' } },
    { id_unico: 'E11-C', nombre: 'Taller Díaz', representante: 'Carlos Díaz', municipio: 'Turbaco', nodo: 'BOGOT1', estado: 'desactivada', desactivacion: { motivo: 'sin_habilitar' } },
  ];
  it('filtra por estado y por texto sin importar tildes ni mayúsculas', () => {
    expect(filtrarUnidadesEstado(items).map((u) => u.id_unico)).toEqual(['70009', 'BOL-DEMO-01', 'E11-C']);
    expect(filtrarUnidadesEstado(items, { estado: 'activa' }).map((u) => u.id_unico)).toEqual(['70009']);
    expect(filtrarUnidadesEstado(items, { estado: 'desactivada' }).map((u) => u.id_unico)).toEqual(['BOL-DEMO-01', 'E11-C']);
    expect(filtrarUnidadesEstado(items, { q: 'PANADERIA' }).map((u) => u.id_unico)).toEqual(['70009', 'BOL-DEMO-01']);
    expect(filtrarUnidadesEstado(items, { q: 'turbaco', estado: 'desactivada' }).map((u) => u.id_unico)).toEqual(['E11-C']);
    expect(filtrarUnidadesEstado(items, { q: 'inexistente' })).toEqual([]);
  });
  it('dice por qué se desactivó cada unidad', () => {
    expect(textoDesactivacion(null)).toBe('');
    expect(textoDesactivacion(items[1].desactivacion)).toBe('Retiro · Retiro voluntario · TK-00015 · 2026-10-27 · Local');
    expect(textoDesactivacion({ motivo: 'retirada', tipo: 'reemplazo', causal: 'Información falsa o no veraz' })).toBe('Reemplazo · Información falsa o no veraz');
    expect(textoDesactivacion(items[2].desactivacion)).toBe('Sin habilitar');
    expect(textoDesactivacion({ motivo: 'retirada', tipo: null, causal: 'Retiro por carga' })).toBe('Retirada · Retiro por carga');
  });
  it('el Excel lleva el estado y el motivo', () => {
    const v = Object.fromEntries(columnasUnidadesEstado().map((c) => [c.titulo, c.valor(items[1])]));
    expect(v).toMatchObject({ 'ID único': 'BOL-DEMO-01', Estado: 'Desactivada', Desactivación: 'Retiro · Retiro voluntario · TK-00015 · 2026-10-27 · Local', Nodo: 'BOLIV1' });
    expect(columnasUnidadesEstado()[2].valor(items[0])).toBe('Activa');
  });
});
