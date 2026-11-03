// Validador de documentos de entrega (LIT-h-02): los soportes de cada tipo de entrega son los del servidor, y la
// pantalla revisa formato y peso antes de enviar.
import { describe, expect, it } from 'vitest';
import {
  DOCS_ENTREGA, TIPOS_ENTREGA, tipoEntrega, docsDeTipo, puedeCambiarTipo, estaAprobado, estaCargado, urlDocumento,
  documentosCargados, semaforoUP, validarFormatoSoporte, validarTipoSoporte, validarTamanoTotal, nombreBlob, MAX_PDF_MB, MAX_TOTAL_MB,
} from '../src/lib/validador';

const MB = 1024 * 1024;
const archivo = (name, size = 10, type = '') => ({ name, size, type });

describe('soportes por tipo de entrega', () => {
  it('coinciden con los del servidor (claves, campos y nombres del archivo)', async () => {
    const servidor = await import('../../backend/src/servicios/validador.js');
    expect(DOCS_ENTREGA.map((d) => [d.clave, d.campo, d.blob])).toEqual(servidor.DOCS_ENTREGA.map((d) => [d.clave, d.campo, d.blob]));
    expect(Object.fromEntries(TIPOS_ENTREGA.map((t) => [t.id, t.soportes]))).toEqual(servidor.SOPORTES_POR_TIPO);
  });

  it('lo que no trae tipo es una entrega completa', () => {
    expect(tipoEntrega({})).toBe('completa');
    expect(tipoEntrega({ tipo_entrega: 'otro' })).toBe('completa');
    expect(tipoEntrega({ tipo_entrega: 'parcial' })).toBe('parcial');
    expect(docsDeTipo('no_entrega').map((d) => d.clave)).toEqual(['acta_no_entrega']);
  });

  it('una entrega completa enviada solo cambia de tipo si la devolvieron', () => {
    expect(puedeCambiarTipo(null)).toBe(true);
    expect(puedeCambiarTipo({ documentos_cargados: [] })).toBe(true);
    expect(puedeCambiarTipo({ documentos_cargados: ['orden_pedido'] })).toBe(false);
    expect(puedeCambiarTipo({ documentos_cargados: ['orden_pedido'], estado_validacion: 'correcciones' })).toBe(true);
    expect(puedeCambiarTipo({ documentos_cargados: ['acta_parcial'], tipo_entrega: 'parcial' })).toBe(true);
  });
});

describe('estado de lo cargado', () => {
  const info = {
    tipo_entrega: 'parcial',
    documentos_cargados: [{ clave: 'acta_parcial', url: '/x/ACTA%20NOVEDAD%20ENTREGA%20PARCIAL_123.pdf?v=2', estado: 'aprobado' }, 'orden_pedido'],
  };

  it('acepta claves sueltas u objetos con su URL', () => {
    expect(estaCargado(info, 'acta_parcial')).toBe(true);
    expect(estaCargado(info, 'orden_pedido')).toBe(true);
    expect(estaCargado(info, 'video_entrega')).toBe(false);
    expect(estaAprobado(info, 'acta_parcial')).toBe(true);
    expect(estaAprobado(info, 'orden_pedido')).toBe(false);
    expect(urlDocumento({ urls_archivos: { a: '/u' } }, 'a')).toBe('/u');
    expect(urlDocumento(info, 'orden_pedido')).toBeNull();
  });

  it('solo cuentan los soportes del tipo actual', () => {
    expect(documentosCargados(info).map((d) => d.clave)).toEqual(['acta_parcial']);   // la orden de pedido ya no aplica
  });

  it('el nombre del archivo sale de la URL guardada o de la convención', () => {
    const acta = DOCS_ENTREGA.find((d) => d.clave === 'acta_parcial');
    expect(nombreBlob(acta, info, '123')).toBe('ACTA NOVEDAD ENTREGA PARCIAL_123.pdf');
    const orden = DOCS_ENTREGA.find((d) => d.clave === 'orden_pedido');
    expect(nombreBlob(orden, {}, '456')).toBe('ORDEN DE PEDIDO_456.pdf');
    expect(nombreBlob(orden, {}, '')).toBe('');
  });

  it('semáforo: sin documentos, en revisión, por corregir o aprobado', () => {
    expect(semaforoUP('en_revision').tono).toBe('espera');
    expect(semaforoUP('correcciones').tono).toBe('malo');
    expect(semaforoUP('aprobado').label).toBe('Aprobado');
    expect(semaforoUP('raro')).toEqual(semaforoUP('pendiente'));
  });
});

describe('formato y peso antes de enviar', () => {
  const pdf = DOCS_ENTREGA.find((d) => d.clave === 'orden_pedido');
  const video = DOCS_ENTREGA.find((d) => d.clave === 'video_entrega');

  it('cada soporte exige su formato', () => {
    expect(validarFormatoSoporte(pdf, archivo('orden.PDF'))).toBe('');
    expect(validarFormatoSoporte(pdf, archivo('orden.docx'))).toMatch(/debe ser un archivo PDF/);
    expect(validarFormatoSoporte(video, archivo('entrega.mov'))).toBe('');
    expect(validarFormatoSoporte(video, archivo('sin-extension', 10, 'video/mp4'))).toBe('');
    expect(validarFormatoSoporte(video, archivo('foto.jpg', 10, 'image/jpeg'))).toMatch(/archivo de video/);
    expect(validarFormatoSoporte(pdf, null)).toBe('');
  });

  it('el peso por archivo y el total del envío', () => {
    expect(validarTipoSoporte(pdf, archivo('a.pdf', MAX_PDF_MB * MB))).toBe('');
    expect(validarTipoSoporte(pdf, archivo('a.pdf', MAX_PDF_MB * MB + 1))).toMatch(/Vuelve a exportar el PDF/);
    expect(validarTipoSoporte(video, archivo('v.mp4', 81 * MB), { comprimido: true })).toMatch(/Recórtalo/);
    expect(validarTipoSoporte(video, archivo('v.mp4', 81 * MB))).toMatch(/grábalo en 720p/);
    expect(validarTamanoTotal({ a: archivo('a', 50 * MB), b: archivo('b', 40 * MB), c: null })).toBe('');
    expect(validarTamanoTotal({ a: archivo('a', 50 * MB), b: archivo('b', 46 * MB) })).toMatch(new RegExp(`no puede pasar de ${MAX_TOTAL_MB} MB`));
  });
});
