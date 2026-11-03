// E10 · Entregas completas: la instalación de la entrega del kit, el acta de recibido de facturas y garantías y el
// seguimiento del acta de elementos defectuosos. Las reglas las aplica el servidor; aquí se comprueba lo que la pantalla
// avisa antes de enviar.
import { describe, expect, it } from 'vitest';
import {
  ESTADOS_DEFECTO, columnasDefectuosos, documentoLimpio, faltasActaRecibido, faltasInstalacion, instalacionAFormulario, textoInstalacion, textoSeguimiento,
} from '../src/lib/entregaFinal';

const completa = { aplica: 'si', fecha_instalacion: '2026-10-20', fecha_puesta_marcha: '2026-10-21', capacitacion: 'si', capacitacion_fecha: '2026-10-21', capacitacion_por: 'Técnico', capacitacion_recibe: 'Representante', observaciones: '' };

describe('instalación y puesta en marcha (ET3-21)', () => {
  it('no aplica: solo hace falta decirlo', () => {
    expect(faltasInstalacion({ aplica: '' })).toEqual(['Indica si aplica la instalación.']);
    expect(faltasInstalacion({ aplica: 'no' })).toEqual([]);
  });
  it('aplica: fechas en orden, desde la entrega, capacitación completa y soporte', () => {
    expect(faltasInstalacion(completa, { soporte: {}, entregado: '2026-10-19' })).toEqual([]);
    expect(faltasInstalacion(completa, { tieneSoporte: true })).toEqual([]);
    expect(faltasInstalacion(completa, {})).toEqual(['Adjunta el soporte de la instalación (PDF, JPG o PNG).']);
    expect(faltasInstalacion({ ...completa, fecha_instalacion: '2026-10-18' }, { soporte: {}, entregado: '2026-10-19' })[0]).toContain('anterior a la entrega');
    expect(faltasInstalacion({ ...completa, fecha_puesta_marcha: '2026-10-19' }, { soporte: {} })).toEqual(['La puesta en marcha no puede ser anterior a la instalación.']);
    expect(faltasInstalacion({ ...completa, capacitacion_por: ' ' }, { soporte: {} })).toEqual(['Escribe quién dio la capacitación.']);
    expect(faltasInstalacion({ ...completa, capacitacion: 'no', capacitacion_por: '' }, { soporte: {} })).toEqual([]);
  });
  it('resume lo registrado y lo vuelve formulario para corregirlo', () => {
    expect(textoInstalacion(null)).toBe('Sin registrar');
    expect(textoInstalacion({ aplica: false })).toBe('No aplica');
    expect(textoInstalacion({ aplica: true, fecha_instalacion: '2026-10-20', fecha_puesta_marcha: '2026-10-21', capacitacion: false })).toBe('Instalado el 2026-10-20 · en marcha el 2026-10-21 · sin capacitación');
    expect(textoInstalacion({ aplica: true, fecha_instalacion: '2026-10-20', fecha_puesta_marcha: '2026-10-21', capacitacion: true, capacitacion_fecha: '2026-10-21', capacitacion_por: 'A', capacitacion_recibe: 'B' })).toContain('capacitación el 2026-10-21 (A → B)');
    expect(instalacionAFormulario(null).aplica).toBe('');
    expect(instalacionAFormulario({ aplica: false, observaciones: 'x' })).toMatchObject({ aplica: 'no', capacitacion: '', observaciones: 'x' });
    expect(instalacionAFormulario({ aplica: true, capacitacion: true, capacitacion_por: 'A' })).toMatchObject({ aplica: 'si', capacitacion: 'si', capacitacion_por: 'A' });
  });
});

describe('acta de recibido de facturas y garantías (ET3-25, NOV-03)', () => {
  const ok = { fecha: '2026-10-20', recibe_nombre: 'Rep', recibe_documento: '8.850.001', garantias: '12 meses', facturas: [1] };
  it('exige fecha, quien recibe con documento, garantías, facturas y el PDF', () => {
    expect(faltasActaRecibido(ok, { name: 'acta.pdf' })).toEqual([]);
    expect(faltasActaRecibido({ ...ok, facturas: [] }, { name: 'acta.pdf' })).toEqual(['Marca al menos una factura entregada en copia.']);
    expect(faltasActaRecibido({ ...ok, recibe_documento: '12' }, { name: 'acta.pdf' })[0]).toContain('documento de quien recibe');
    expect(faltasActaRecibido(ok, { name: 'acta.jpg' })).toEqual(['El acta debe ser un PDF.']);
    expect(faltasActaRecibido({ ...ok, garantias: '' }, null)).toHaveLength(2);
  });
  it('el documento se manda como lo guarda el servidor', () => {
    expect(documentoLimpio(' 8.850.001 ')).toBe('8850001');
    expect(documentoLimpio('ab 12345')).toBe('AB12345');
  });
});

describe('acta de elementos defectuosos (ET3-26, NOV-02)', () => {
  it('tiene los tres estados del servidor y resume el seguimiento', () => {
    expect(Object.keys(ESTADOS_DEFECTO)).toEqual(['reportada', 'devuelta', 'reemplazada']);
    expect(textoSeguimiento({})).toBe('Reporte sin dar por recibido');
    expect(textoSeguimiento({ reporte: { por: 'Local', en: '2026-10-20T15:00:00Z' }, devolucion: { proveedor: 'Prov', fecha: '2026-10-21', guia: 'G1' }, reemplazo: { fecha: '2026-10-25' } }))
      .toBe('Reporte recibido por Local el 2026-10-20 · Devuelto a Prov el 2026-10-21 (guía G1) · Reemplazo entregado el 2026-10-25');
  });
  it('el Excel lleva la U.P., el kit, los elementos, el estado y el seguimiento', () => {
    const fila = { id: 7, creado: '2026-10-20T10:00:00Z', id_unico: 'E10-A', unidad: 'Panadería', region: 'Región 1', nodo: 'N1', kit: 'E10-A', nombre_tipo: 'Dañado',
      articulos: [{ cantidad: 1, nombre: 'Horno' }], texto: 'Puerta rota', nombre_estado: 'Reportada' };
    const v = Object.fromEntries(columnasDefectuosos().map((c) => [c.titulo, c.valor(fila)]));
    expect(v.Acta).toBe('00007');
    expect(v.Elementos).toBe('1 × Horno');
    expect(v.Seguimiento).toBe('Reporte sin dar por recibido');
  });
});
