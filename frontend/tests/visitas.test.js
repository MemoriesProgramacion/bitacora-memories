import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TIPOS_PROCESO, tipoDeVisita, formatosDe, gruposFormatos, urlFormato,
  formatosFaltantes, avanceUP, visitaAEstado, mapearVisita, deApi, situacionVisita,
} from '../src/lib/visitas.js';

const up = (modalidad) => ({ modalidad, unidad_doc: '123' });
const nombres = (lista) => lista.map((f) => f.nombre);
const v1 = tipoDeVisita('v1');
const v2 = tipoDeVisita('v2');
const v3 = tipoDeVisita('v3');
const todos = (tipo, u) => Object.fromEntries(formatosDe(tipo, u).map((f) => [f.nombre, true]));

describe('catálogo: solo las tres visitas', () => {
  it('se programan V1, V2 y V3 en ese orden', () => {
    expect(TIPOS_PROCESO.map((t) => t.id)).toEqual(['v1', 'v2', 'v3']);
    expect(v2.requiere).toEqual(['v1']);
    expect(v3.requiere).toEqual(['v2']);
  });
  it('Fortalecimiento y Capitalización quedan solo para lectura', () => {
    expect(tipoDeVisita('fort').legado).toBe(true);
    expect(tipoDeVisita('cap').legado).toBe(true);
  });
  it('la V3 lleva los cuatro documentos de la tabla y el soporte de visita virtual (opcional)', () => {
    expect(nombres(v3.formatos)).toEqual(['Bitácora', 'Acta de Visita 3', 'Registro fotográfico', 'Video de salida', 'Soporte de la visita virtual']);
  });
});

describe('V1: documentos del beneficiario por modalidad', () => {
  const benef = (mod) => Object.fromEntries(
    gruposFormatos(v1, up(mod)).beneficiario.map((f) => [f.nombre, f.opcional ? 'opc' : 'obl']));

  it('M1: cédula obligatoria; RUT, cámara y tenencia opcionales; sin cédulas de asociados', () => {
    expect(benef('M1')).toEqual({
      'Cédula del representante legal': 'obl',
      RUT: 'opc',
      'Certificado de existencia o Cámara de comercio': 'opc',
      Tenencia: 'opc',
    });
  });
  // ET1-06: el RUT y el certificado de existencia se exigen en M3 y M4 (opcionales en M2).
  it('M2: todo obligatorio menos el RUT y la cámara de comercio', () => {
    expect(benef('M2')).toEqual({
      'Cédula del representante legal': 'obl',
      'Cédulas de los asociados': 'obl',
      RUT: 'opc',
      'Certificado de existencia o Cámara de comercio': 'opc',
      Tenencia: 'obl',
    });
  });
  it.each(['M3', 'M4'])('%s: todo obligatorio', (m) => {
    expect(Object.values(benef(m)).every((x) => x === 'obl')).toBe(true);
    expect(Object.keys(benef(m))).toHaveLength(5);
  });
  it('los del beneficiario se parten en obligatorios y opcionales de la modalidad de la unidad', () => {
    const partido = (mod) => {
      const g = gruposFormatos(v1, up(mod));
      return [nombres(g.beneficiarioObligatorios), nombres(g.beneficiarioOpcionales)];
    };
    expect(partido('M1')).toEqual([
      ['Cédula del representante legal'],
      ['RUT', 'Certificado de existencia o Cámara de comercio', 'Tenencia'],
    ]);
    expect(partido('M2')).toEqual([
      ['Cédula del representante legal', 'Cédulas de los asociados', 'Tenencia'],
      ['RUT', 'Certificado de existencia o Cámara de comercio'],
    ]);
    for (const m of ['M3', 'M4']) {
      const [obl, opc] = partido(m);
      expect(obl).toHaveLength(5);
      expect(opc).toEqual([]);
    }
    // Sin modalidad registrada nada es obligatorio salvo la cédula del representante.
    expect(partido('')[0]).toEqual(['Cédula del representante legal']);
    // Ningún documento aparece en los dos grupos.
    for (const m of ['', 'M1', 'M2', 'M3', 'M4']) {
      const [obl, opc] = partido(m);
      expect(obl.filter((n) => opc.includes(n))).toEqual([]);
      expect(obl.length + opc.length).toBe(gruposFormatos(v1, up(m)).beneficiario.length);
    }
  });
  it('opcionales de la visita: novedad, no aceptación y retiro', () => {
    expect(nombres(gruposFormatos(v1, up('M3')).opcionales))
      .toEqual(['Acta de Novedades', 'Acta de No Aceptación', 'Acta de Retiro', 'Soporte de la visita virtual']);
  });
  it('obligatorios de la visita: los cinco de la tabla', () => {
    expect(nombres(gruposFormatos(v1, up('M1')).obligatorios)).toEqual([
      'Acta de Compromiso', 'Acta de Visita 1', 'Imágenes de caracterización',
      'Video de caracterización', 'Autorización para el tratamiento de datos personales',
    ]);
  });
});

describe('V2: diagnóstico según modalidad', () => {
  it('M1 sube el individual y no el solidario', () => {
    expect(nombres(formatosDe(v2, up('M1')))).toContain('Diagnóstico de unidades productivas individuales (M1)');
    expect(nombres(formatosDe(v2, up('M1')))).not.toContain('Diagnóstico de unidades productivas solidarias (M2, M3, M4)');
  });
  it.each(['M2', 'M3', 'M4'])('%s sube el solidario y no el individual', (m) => {
    const n = nombres(formatosDe(v2, up(m)));
    expect(n).toContain('Diagnóstico de unidades productivas solidarias (M2, M3, M4)');
    expect(n).not.toContain('Diagnóstico de unidades productivas individuales (M1)');
  });
});

describe('alistamiento: formatos en blanco', () => {
  const carpeta = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/plantillas/visitas');

  it('cada formato con archivo propio apunta a un PDF que existe en public/plantillas/visitas', () => {
    const conFormato = v1.formatos.filter((f) => f.formato);
    expect(conFormato.map((f) => f.nombre)).toEqual([
      'Acta de Compromiso', 'Acta de Visita 1', 'Autorización para el tratamiento de datos personales',
      'Acta de Novedades', 'Acta de No Aceptación', 'Acta de Retiro',
    ]);
    for (const f of conFormato) {
      const ruta = path.join(carpeta, f.formato);
      expect(fs.existsSync(ruta), f.formato).toBe(true);
      expect(fs.readFileSync(ruta).subarray(0, 5).toString()).toBe('%PDF-');
      expect(urlFormato(f)).toBe(`/plantillas/visitas/${f.formato}`);
    }
  });

  it('todo formato del catálogo (Visitas 1 a 3) apunta a un PDF que existe', () => {
    const todos = TIPOS_PROCESO.flatMap((t) => t.formatos).filter((f) => f.formato);
    expect(todos.length).toBeGreaterThanOrEqual(11);
    for (const f of todos) {
      expect(fs.readFileSync(path.join(carpeta, f.formato)).subarray(0, 5).toString(), f.formato).toBe('%PDF-');
    }
  });

  it('los documentos obligatorios de la Visita 1 que tienen formato oficial lo traen', () => {
    const obligatorios = gruposFormatos(v1, up('M1')).obligatorios.filter((f) => f.plantilla);
    expect(obligatorios.length).toBe(3);
    expect(obligatorios.every((f) => f.formato)).toBe(true);
  });

  it('un documento sin formato propio no tiene enlace', () => {
    expect(urlFormato(v1.formatos.find((f) => f.nombre === 'RUT'))).toBe('');
    expect(urlFormato(undefined)).toBe('');
  });

  it('modalidad desconocida: los del beneficiario por modalidad quedan opcionales y avisan que dependen de ella', () => {
    const rut = formatosDe(v1, up('')).find((f) => f.nombre === 'RUT');
    expect(rut.opcional && rut.segunModalidad).toBe(true);
  });
});

describe('cierre de la V1', () => {
  const arch = (n = 1) => Array.from({ length: n }, (_, i) => ({ nombre: `f${i}.jpg` }));
  it('exige los documentos del beneficiario obligatorios', () => {
    const archivos = {
      'Acta de Compromiso': { nombre: 'a.pdf' }, 'Acta de Visita 1': { nombre: 'b.pdf' },
      'Imágenes de caracterización': arch(4), 'Video de caracterización': { nombre: 'v.mp4' },
      'Autorización para el tratamiento de datos personales': { nombre: 'c.pdf' },
      'Cédula del representante legal': { nombre: 'cc.pdf' },
    };
    expect(formatosFaltantes(v1, up('M1'), archivos)).toEqual([]);
    expect(formatosFaltantes(v1, up('M2'), archivos))
      .toEqual(['Cédulas de los asociados', 'Tenencia']);
  });
  it('pide 4 imágenes', () => {
    expect(formatosFaltantes(v1, up('M1'), { 'Imágenes de caracterización': arch(2) }))
      .toContain('Imágenes de caracterización (lleva 2 de 4 imágenes)');
  });
  it('con acta de no aceptación solo exige el acta de visita', () => {
    expect(formatosFaltantes(v1, up('M4'), { 'Acta de No Aceptación': { nombre: 'x.pdf' } }))
      .toEqual(['Acta de Visita 1']);
  });
});

describe('compatibilidad', () => {
  it('reparte el formato antiguo "Video de caracterización y 4 imágenes"', () => {
    const e = visitaAEstado({
      id: 'x', tipo_visita: 'v1',
      post_visita: { cargue_formatos: { 'Video de caracterización y 4 imágenes': [
        { nombre: 'a.jpg' }, { nombre: 'b.png' }, { nombre: 'c.mp4' },
      ] } },
    });
    expect(e.archivos['Imágenes de caracterización']).toHaveLength(2);
    expect(e.archivos['Video de caracterización'].nombre).toBe('c.mp4');
    expect(e.archivos['Video de caracterización y 4 imágenes']).toBeUndefined();
  });
  it('la V3 queda disponible con la V2 cerrada', () => {
    const cerrada = (t) => ({ tipo_visita: t, cierre: { cerrada: true }, post_visita: { cargue_formatos: {} } });
    const a = avanceUP([cerrada('v1'), cerrada('v2')]);
    expect(a.find((x) => x.tipo.id === 'v3').estado).toBe('disponible');
  });
});

describe('formato del documento (mapearVisita / deApi)', () => {
  const upM2 = { ID_unico: 12, unidad_nombre: 'Panadería', unidad_doc: '1001', modalidad: 'M2', nodo: 'OCA1' };
  const estado = {
    id: '1001_v1', tipo: 'v1', up: upM2, llamada: 'si', intentos: '2', resultado: 'reagendar',
    fecha: '2026-10-20', hora: '09:00', historialAgenda: [{ fecha: '2026-10-18', hora: '08:00', motivo: 'reagendada', en: 'x', por: 'G' }],
    confirmados: { 'Acta de Compromiso': true, RUT: true }, fechaConfirmacion: '2026-10-16T10:00:00Z',
    archivos: {
      'Acta de Compromiso': { nombre: 'acta.pdf', tamano: 10, blob: '1001/01/ACTA_1001.pdf', fecha_cargue: 'f' },
      'Imágenes de caracterización': [{ nombre: 'a.jpg', tamano: 1, blob: 'b1' }, { nombre: 'b.jpg', tamano: 1, blob: 'b2' }],
      'Video de caracterización y 4 imágenes': [{ nombre: 'viejo.mp4' }],
    },
    estado: 'revision', cerrada: false,
  };
  const doc = mapearVisita(estado, { nombre: 'Gestor', nodo: 'OCA1' });

  it('agrupa por secciones legibles', () => {
    expect(Object.keys(doc)).toEqual(['id', 'nodo', 'unidad', 'visita', 'situacion', 'programacion',
      'alistamiento', 'realizacion', 'soportes', 'cierre', 'registro']);
    expect(doc.situacion).toBe('PENDIENTE_SOPORTES');
    expect(doc.programacion.resultado_llamada).toBe('SOLICITA_REAGENDAR');
    expect(doc.alistamiento.documentos_beneficiario.RUT).toBe(true);
    expect(doc.alistamiento.documentos_visita_opcionales['Acta de Retiro']).toBe(false);
    expect(doc.soportes.documentos_visita_obligatorios['Acta de Compromiso'][0].blob).toBe('1001/01/ACTA_1001.pdf');
    expect(doc.soportes.documentos_beneficiario['Cédulas de los asociados']).toEqual([]);
    expect(doc.soportes.otros_documentos['Video de caracterización y 4 imágenes']).toHaveLength(1);
  });

  it('ida y vuelta conserva lo que usa la pantalla', () => {
    const e = visitaAEstado(deApi(doc));
    expect(e.resultado).toBe('reagendar');
    expect(e.llamada).toBe('si');
    expect(e.estado).toBe('revision');
    expect(e.confirmados).toMatchObject({ 'Acta de Compromiso': true, RUT: true });
    expect(e.archivos['Acta de Compromiso'].blob).toBe('1001/01/ACTA_1001.pdf');
    expect(e.archivos['Imágenes de caracterización'].length).toBeGreaterThanOrEqual(2);
    expect(e.historialAgenda[0].motivo).toBe('reagendada');
  });

  it('los documentos del formato anterior se leen igual', () => {
    const viejo = { id: 'x', tipo_visita: 'v2', contacto_control: { resultado_agendamiento: 'AGENDADA' } };
    expect(deApi(viejo)).toBe(viejo);
  });
});

describe('formatos en blanco (visitas-formatos)', () => {
  it('reconoce el archivo sin importar tildes, mayúsculas ni extensión', async () => {
    const { normPlantilla, plantillaDe } = await import('../src/lib/visitas');
    const m = {};
    ['Acta de Compromiso.docx', 'ACTA DE COMPROMISO.pdf', 'Autorización tratamiento de datos.pdf', 'Plan de negocios.xlsx']
      .forEach((n) => { (m[normPlantilla(n)] = m[normPlantilla(n)] || []).push(n); });
    const f = (nombre) => tipoDeVisita('v1').formatos.find((x) => x.nombre === nombre);
    expect(plantillaDe(f('Acta de Compromiso'), m)).toHaveLength(2);
    expect(plantillaDe(f('Autorización para el tratamiento de datos personales'), m)).toEqual(['Autorización tratamiento de datos.pdf']);
    expect(plantillaDe(f('Acta de Retiro'), m)).toEqual([]);
    expect(plantillaDe(f('RUT'), m)).toEqual([]); // documento del beneficiario: no tiene formato
  });
  it('las tres actas de visita usan el mismo formato', () => {
    const p = ['v1', 'v2', 'v3'].map((t) => tipoDeVisita(t).formatos.find((x) => /^Acta de Visita/.test(x.nombre)).plantilla);
    expect(new Set(p)).toEqual(new Set(['ACTA DE VISITA']));
  });
});

describe('documento de la UP y mensajes', () => {
  it('normaliza el documento como el servidor', async () => {
    const { docUP } = await import('../src/lib/visitas');
    expect(docUP('1.001.234-5')).toBe('10012345');
    expect(docUP(null)).toBe('');
  });
  it('traduce los errores del servidor', async () => {
    const { mensajeVisita } = await import('../src/lib/visitas');
    expect(mensajeVisita({ respuesta: 'fuera de alcance' }, 'x')).toMatch(/tu nodo/);
    expect(mensajeVisita({ code: 'E-SESION', publicMsg: 'Tu sesión expiró' }, 'x')).toBe('Tu sesión expiró');
    expect(mensajeVisita({ respuesta: 'otro' }, 'por defecto')).toBe('por defecto');
    // Las reglas del servidor ya vienen explicadas: se muestran tal cual.
    const regla = 'Primero debe cerrarse la Visita 1: la ruta va Visita 1 → Visita 2 → Visita 3.';
    expect(mensajeVisita({ respuesta: regla }, 'por defecto')).toBe(regla);
  });
});

describe('visita cerrada de formato antiguo (el servidor la entrega sin datos de programación)', () => {
  const antigua = {
    id: '9900001_v1', nodo: 'ATLAN1',
    unidad: { id_unico: 'LEG-1', nombre: 'UP Antigua', documento: '9900001', modalidad: 'M1' },
    visita: { tipo: 'v1', nombre: 'Visita 1 — Caracterización', carpeta: '' }, situacion: 'CERRADA',
    programacion: {}, alistamiento: {}, realizacion: { estado: 'EXITOSA', modalidad: 'PRESENCIAL' }, soportes: {},
    cierre: { cerrada: true, fecha_cierre: '2026-10-21T01:07:11.000Z', cerrada_por: null, reaperturas: [] },
    registro: { creado_en: null, creado_por: null, actualizado_en: null, actualizado_por: null },
  };
  it('aparece como cerrada (Historial) y conserva su cierre para poder reabrirla', () => {
    const e = deApi(antigua);
    expect(situacionVisita(e)).toBe('cerrada');
    expect([e.tipo_visita, e.id_unico, e.cierre.cerrada, e.cierre.fecha_cierre]).toEqual(['v1', 'LEG-1', true, '2026-10-21T01:07:11.000Z']);
  });
  it('al reabrirla se envía con la forma de siempre y sin cerrar', () => {
    // La pantalla le agrega la unidad (`up`) al abrirla.
    const up = { ID_unico: 'LEG-1', unidad_nombre: 'UP Antigua', unidad_doc: '9900001', modalidad: 'M1', nodo: 'ATLAN1' };
    const e = visitaAEstado(deApi(antigua));
    const doc = mapearVisita({ ...e, up, cerrada: false }, { nombre: 'Coord' });
    expect([doc.id, doc.visita.tipo, doc.unidad.documento, doc.cierre.cerrada]).toEqual(['9900001_v1', 'v1', '9900001', false]);
  });
});
