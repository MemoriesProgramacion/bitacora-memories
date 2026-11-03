// E7 · Formación en los talleres: la pantalla presenta lo que calcula el servidor (bloques de la sesión, mínimo de
// integrantes por modalidad, validez de cada sesión, encuestas, convocatoria y el 80 %).
import { describe, expect, it } from 'vitest';
import {
  columnasCumplimiento, encuestaDe, encuestasPermitidas, infoUP, promedio, resultadoDe, textoApropiacion, textoBloques, textoConvocatoria,
  textoSesion, validezSeleccion,
} from '../src/lib/formacion';
import {
  MINIMO_INTEGRANTES, bloquesSesion, sesionValida, cumplimientoTaller,
} from '../../backend/src/servicios/talleresFormacion.js';

describe('sesión de 3 horas (ET2-02)', () => {
  it('muestra los bloques que calcula el servidor en hora de Colombia', () => {
    const b = bloquesSesion('2026-11-03T14:00:00.000Z'); // 9:00 a. m. en Colombia
    const t = textoBloques(b);
    expect(t).toMatch(/^Teórico-práctica 9:00\sa\.\sm\.–11:00\sa\.\sm\. · Evaluación 11:00\sa\.\sm\.–12:00\sp\.\sm\.$/);
    expect(textoBloques(null)).toBe('');
  });
});

describe('asistencia por integrante (ET2-06, ET2-08)', () => {
  const taller = { participantes_info: { 7: { id_up: 7, modalidad: 'M3', minimo: MINIMO_INTEGRANTES.M3, integrantes: [] }, 8: { id_up: 8, modalidad: 'M1', minimo: 1, integrantes: [] } } };
  it('el mínimo es el del servidor y la selección dice si la sesión cuenta', () => {
    expect(MINIMO_INTEGRANTES).toEqual({ M1: 1, M2: 3, M3: 5, M4: 5 });
    expect(validezSeleccion(infoUP(taller, 7), [1, 2, 3])).toEqual({ suficiente: false, texto: '3 integrantes de un mínimo de 5 (M3): se guarda, pero la sesión no cuenta para su cumplimiento.' });
    expect(validezSeleccion(infoUP(taller, '7'), [1, 2, 3, 4, 5]).suficiente).toBe(true);
    expect(validezSeleccion(infoUP(taller, 7), [1, 2, 3, 4, 5, 6, 7]).texto).toBe('7 integrantes (mínimo 5): la sesión cuenta.');
    expect(validezSeleccion(infoUP(taller, 8), []).suficiente).toBe(true);
    expect(infoUP(taller, 99)).toBeNull();
  });
  it('el estado de la sesión coincide con la regla del servidor', () => {
    const info = { id_up: 7, modalidad: 'M3', minimo: 5 };
    const realizado = { realizado_en: '2026-11-03', asistencia: ['up:7'], asistencia_integrantes: { 7: [1, 2, 3] } };
    expect(textoSesion({ realizado: true, minimo: 5, ...sesionValida(realizado, info) })).toBe('No cuenta (3 de 5)');
    expect(textoSesion({ realizado: true, minimo: 5, ...sesionValida({ ...realizado, asistencia_integrantes: { 7: [1, 2, 3, 4, 5] } }, info) })).toBe('Cuenta');
    expect(textoSesion({ realizado: true, ...sesionValida({ ...realizado, asistencia: [] }, info) })).toBe('No asistió');
    expect(textoSesion({ realizado: false })).toBe('Pendiente');
  });
});

describe('encuestas, hallazgos y convocatoria', () => {
  const taller = {
    encuestas: [{ id_up: 7, tipo: 'satisfaccion', modulo: 2, respuestas: { a: 4, b: 5 } }, { id_up: 7, tipo: 'apropiacion_entrada', modulo: 0, respuestas: { a: 2 } }],
    resultados: [{ id_up: 7, hallazgos: 'H', recomendaciones: 'R' }],
  };
  it('encuentra lo guardado por UP, tipo y módulo', () => {
    expect(encuestaDe(taller, '7', 'satisfaccion', 2)).toEqual({ a: 4, b: 5 });
    expect(encuestaDe(taller, 7, 'satisfaccion', 1)).toBeNull();
    expect(encuestaDe(taller, 7, 'apropiacion_entrada')).toEqual({ a: 2 });
    expect(resultadoDe(taller, 7).hallazgos).toBe('H');
    expect(promedio({ a: 4, b: 5 })).toBe(4.5);
    expect(promedio({})).toBeNull();
  });
  it('resume la apropiación y el estado de la convocatoria', () => {
    expect(textoApropiacion({ entrada: 2.4, salida: 4.1, variacion: 1.7 })).toBe('Apropiación de conocimientos: entrada 2,4 · salida 4,1 · variación +1,7 (escala 1 a 5).');
    expect(textoApropiacion({ entrada: null, salida: null })).toMatch(/sin encuestas/);
    expect(textoConvocatoria({ enviados: 3, pendientes: 1, fallidos: 0 })).toBe('Convocatoria por correo: 3 enviados · 1 pendiente.');
    expect(textoConvocatoria({ enviados: 0, pendientes: 0, fallidos: 0 })).toMatch(/aún no hay correos/);
  });
});

describe('encuestas que puede registrar cada quien (misma regla del servidor)', () => {
  it('la coordinación y el Tallerista de la entrega final, todas; los demás, las de sus módulos', () => {
    const taller = (modulos, entrega = false) => ({ puede_entregar: entrega, encuentros: modulos.map((modulo) => ({ modulo })) });
    expect(encuestasPermitidas(taller([2]), true)).toEqual({ apropiacion_entrada: true, apropiacion_salida: true, satisfaccion: [1, 2, 3] });
    expect(encuestasPermitidas(taller([], true))).toEqual({ apropiacion_entrada: true, apropiacion_salida: true, satisfaccion: [1, 2, 3] });
    expect(encuestasPermitidas(taller([2]))).toEqual({ apropiacion_entrada: false, apropiacion_salida: false, satisfaccion: [2] });
    expect(encuestasPermitidas(taller([1, 3]))).toEqual({ apropiacion_entrada: true, apropiacion_salida: true, satisfaccion: [1, 3] });
  });
});

describe('informe de cumplimiento del territorio (ET2-13, ET2-15)', () => {
  it('las columnas del Excel salen del cálculo del servidor', async () => {
    const db = { query: async (sql) => {
      if (/FROM talleres_encuentros/.test(sql)) {
        return { rows: [1, 2, 3].map((m) => ({ modulo: m, realizado_en: '2026-11-0' + m, asistencia: ['up:7'], asistencia_integrantes: { 7: m === 2 ? [1] : [1, 2, 3, 4, 5] } })) };
      }
      if (/apropiacion_salida/.test(sql)) return { rows: [{ id_up: 7 }] };
      return { rows: [{ id_up: 7 }] }; // entrega final
    } };
    const c = await cumplimientoTaller(db, { id: 1 }, { 7: { id_up: 7, id_unico: 'UP-7', modalidad: 'M3', minimo: 5 } });
    const fila = { taller: 'Taller', region: 'Región 1', nodo: 'N1', nombre: 'UP siete', ...c[7] };
    const cols = columnasCumplimiento();
    const valor = (t) => cols.find((x) => x.titulo === t).valor(fila);
    expect(valor('Módulo 2')).toBe('No cuenta (1 de 5)');
    expect(valor('Actividades cumplidas')).toBe('4 de 5');
    expect(valor('Cumplimiento (%)')).toBe(80);
    expect(valor('Cumple el 80 %')).toBe('Sí');
  });
});
