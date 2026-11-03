// E4 · Diagnóstico estructurado: conversión de valores, lo que falta por sección (misma regla que el servidor),
// el catálogo de formatos del servidor igual al de la pantalla y quién ve el diagnóstico.
import { describe, expect, it } from 'vitest';
import {
  ESTADOS_REVISION, aEnvio, aFormulario, esObligatorio, faltantes, pesos, seccionesDe, textoValor,
} from '../src/lib/diagnostico';
import { TIPOS_VISITA, formatosDe, mensajeVisita, textoPlazoV3 } from '../src/lib/visitas';
import { puedeVerDiagnostico } from '../src/lib/permisos';
import { CATALOGO, formatosDe as formatosServidor } from '../../backend/src/servicios/catalogoVisitas.js';
import { ESQUEMA } from '../../backend/src/servicios/diagnostico.js';

const seccion = (clave) => ESQUEMA.find((s) => s.clave === clave);

describe('formulario del diagnóstico', () => {
  it('convierte lo guardado al formulario y de vuelta (vacíos como null, listas sin líneas en blanco)', () => {
    const foda = seccion('foda');
    const f = aFormulario(foda, { fortalezas: ['Receta propia'], amenazas: null });
    expect(f.fortalezas).toEqual(['Receta propia']);
    expect(f.amenazas).toEqual(['']);
    expect(aEnvio(foda, { ...f, debilidades: ['  ', 'Poca capacidad '] })).toMatchObject({ debilidades: ['Poca capacidad'], amenazas: [] });
    const rec = seccion('recursos');
    expect(aFormulario(rec, { ingresos_mensuales: 2000000 }).ingresos_mensuales).toBe('2000000');
    expect(aEnvio(rec, aFormulario(rec, {})).costos_mensuales).toBeNull();
  });

  it('marca lo que falta con la misma regla del servidor', () => {
    const form = seccion('formalizacion');
    expect(faltantes(form, { camara_comercio: 'si', rut: 'no' })).toEqual(['Número de matrícula mercantil']);
    expect(esObligatorio(form.campos.find((c) => c.clave === 'nit'), { rut: 'si' })).toBe(true);
    expect(faltantes(seccion('verificacion'), { existe: 'no', funciona: 'si', informacion_veraz: 'si', fecha: '2026-10-01' }))
      .toEqual(['Observación (hay una respuesta «No»)']);
    expect(faltantes(seccion('socializacion'), { realizada: 'no', fecha: '2026-10-01' })).toEqual(['La ruta debe socializarse en la Visita 1']);
  });

  it('muestra los valores guardados en palabras', () => {
    const rec = seccion('recursos');
    expect(textoValor(rec.campos.find((c) => c.clave === 'ingresos_mensuales'), 2000000)).toBe(pesos(2000000));
    expect(textoValor(seccion('identificacion').campos.find((c) => c.clave === 'zona'), 'rural')).toBe('Rural');
    expect(textoValor(seccion('verificacion').campos[0], 'no')).toBe('No');
    expect(textoValor(seccion('foda').campos[0], [])).toBe('—');
    expect(ESTADOS_REVISION.devuelto.tono).toBe('error');
  });

  it('separa las secciones de la Visita 1 y de la Visita 2', () => {
    const esquema = { secciones: ESQUEMA };
    expect(seccionesDe(esquema, 'v1').map((s) => s.clave)).toEqual(['verificacion', 'socializacion', 'identificacion', 'formalizacion', 'actividad']);
    expect(seccionesDe(esquema, 'v2').map((s) => s.clave)).toEqual(['recursos', 'indicadores', 'negocio', 'mercado', 'foda', 'plan_fortalecimiento', 'concepto']);
    expect(seccionesDe(esquema).length).toBe(12); // con el estado del negocio (E12 · TR-04)
  });
});

describe('catálogo de formatos: el servidor y la pantalla dicen lo mismo', () => {
  for (const tipo of ['v1', 'v2', 'v3']) {
    for (const modalidad of ['', 'M1', 'M2', 'M3', 'M4']) {
      it(`${tipo} ${modalidad || 'sin modalidad'}`, () => {
        const pantalla = formatosDe(TIPOS_VISITA.find((t) => t.id === tipo), { modalidad })
          .map((f) => [f.nombre, Boolean(f.opcional), Boolean(f.alternativa)]);
        const servidor = formatosServidor(tipo, modalidad).map((f) => [f.nombre, Boolean(f.opcional), Boolean(f.alternativa)]);
        expect(servidor).toEqual(pantalla);
      });
    }
  }
  it('la V2 exige los indicadores iniciales INNPULSA', () => {
    expect(CATALOGO.v2.formatos.some((f) => f.nombre === 'Indicadores iniciales INNPULSA' && !f.opcional)).toBe(true);
  });
  it('los mínimos por clase de archivo (videos e imágenes) son los mismos', () => {
    for (const tipo of ['v1', 'v2', 'v3']) {
      const pantalla = TIPOS_VISITA.find((t) => t.id === tipo).formatos.filter((f) => f.minimos).map((f) => [f.nombre, f.minimos]);
      const servidor = CATALOGO[tipo].formatos.filter((f) => f.minimos).map((f) => [f.nombre, f.minimos]);
      expect(servidor).toEqual(pantalla);
    }
    expect(CATALOGO.v3.formatos.find((f) => f.nombre === 'Video de salida').minimos).toEqual({ video: 1 });
  });
});

describe('Visita 3 tras la entrega (ET4-01)', () => {
  it('avisa la entrega y la fecha mínima, o que aún no hay entrega', () => {
    expect(textoPlazoV3({ fecha_entrega: '2026-09-01', desde: '2026-10-01', dias: 30 }))
      .toBe('Entrega registrada el 2026-09-01: la Visita 3 se programa desde el 2026-10-01 (30 días después).');
    expect(textoPlazoV3({ fecha_entrega: null, desde: null, dias: 30 })).toMatch(/aún no tiene una entrega de bienes registrada/);
    expect(textoPlazoV3(null)).toBe('');
  });
});

describe('mensajes y permisos', () => {
  it('las reglas del servidor se muestran tal cual; los códigos internos se traducen', () => {
    const regla = 'Para cerrar la Visita 2 falta: el formato «Plan de negocios».';
    expect(mensajeVisita({ respuesta: regla }, 'x')).toBe(regla);
    expect(mensajeVisita({ respuesta: 'visita cerrada' }, 'x')).toMatch(/Recarga/);
  });
  it('ven el diagnóstico el gestor, la coordinación, seguimiento y el técnico; no compras ni tallerista', () => {
    for (const role of ['superadmin', 'coordinador', 'coordinador_datos', 'gestor', 'tecnico_administrativo']) {
      expect(puedeVerDiagnostico({ role })).toBe(true);
    }
    for (const role of ['coordinador_compras', 'tallerista', 'bodeguero']) expect(puedeVerDiagnostico({ role })).toBe(false);
  });
});

describe('revisión de E3/E4: cierre, cambios sin guardar y mensajes del servidor', () => {
  it('dice qué impide cerrar la visita según el diagnóstico', async () => {
    const { bloqueosDeCierre } = await import('../src/lib/diagnostico');
    const base = { completitud: { v1: { faltan: [], verificacion_negativa: [] }, v2: { faltan: [] } } };
    expect(bloqueosDeCierre(base, 'v1')).toEqual([]);
    expect(bloqueosDeCierre({ completitud: { ...base.completitud, v1: { faltan: [], verificacion_negativa: ['no está en funcionamiento'] } } }, 'v1')[0])
      .toMatch(/no está en funcionamiento \(solo cierra con acta de No Aceptación o de Retiro\)/);
    expect(bloqueosDeCierre({ completitud: { ...base.completitud, v2: { faltan: ['a', 'b'] } } }, 'v2')).toEqual(['diagnóstico: 2 dato(s)']);
    expect(bloqueosDeCierre(base, 'v3')).toEqual([]);
  });

  it('detecta cambios sin guardar y entiende obligatorios con varios valores', async () => {
    const { hayCambios, esObligatorio, textoValor } = await import('../src/lib/secciones');
    const s = { campos: [{ clave: 'a', tipo: 'texto' }, { clave: 'l', tipo: 'lista_textos' }] };
    expect(hayCambios(s, { a: 'x', l: [''] }, { a: 'x', l: null })).toBe(false);
    expect(hayCambios(s, { a: 'y', l: [''] }, { a: 'x' })).toBe(true);
    const obs = { obligatorio: { campo: 'cumplimiento', valor: ['parcial', 'no_cumple'] } };
    expect(esObligatorio(obs, { cumplimiento: 'parcial' })).toBe(true);
    expect(esObligatorio(obs, { cumplimiento: 'cumple' })).toBe(false);
    expect(textoValor({ tipo: 'escala' }, 4)).toBe('4 de 5');
  });

  it('el cliente muestra la explicación de «Ver como» y mantenimiento, no el código', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: 'simulacion', detalle: 'En «Ver como» no se guardan cambios.' }),
      { status: 403, headers: { 'content-type': 'application/json' } });
    try {
      const { apiGeneral } = await import('../src/inventario/lib/api');
      await expect(apiGeneral.get('/x')).rejects.toThrow('En «Ver como» no se guardan cambios.');
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('E6 · reglas de las visitas en la pantalla', () => {
  it('lo que le falta a una visita virtual, igual que el servidor', async () => {
    const { faltantesVirtual } = await import('../src/lib/visitas');
    expect(faltantesVirtual({ modalidadVisita: 'presencial' }, {})).toEqual([]);
    expect(faltantesVirtual({ modalidadVisita: 'virtual', causaVirtual: 'orden_publico', justificacionVirtual: ' ' }, {})).toEqual([
      'la causa externa y la justificación de la visita virtual', 'el formato «Soporte de la visita virtual»',
      'la aprobación de la interventoría (la registra la coordinación)',
    ]);
    expect(faltantesVirtual({ modalidadVisita: 'virtual', causaVirtual: 'desastre', justificacionVirtual: 'Inundación', aprobacionVirtual: { fecha: '2026-10-01' } },
      { 'Soporte de la visita virtual': [{ nombre: 'x.pdf' }] })).toEqual([]);
  });
  it('las causas de la visita virtual son las del servidor y el RUT solo se exige en M3–M4', async () => {
    const { CAUSAS_VIRTUAL } = await import('../src/lib/visitas');
    const servidor = await import('../../backend/src/servicios/reglasVisitas.js');
    expect(CAUSAS_VIRTUAL).toEqual(servidor.CAUSAS_VIRTUAL);
    const v1 = TIPOS_VISITA.find((t) => t.id === 'v1');
    expect(formatosDe(v1, { modalidad: 'M2' }).find((f) => f.nombre === 'RUT').opcional).toBe(true);
    expect(formatosDe(v1, { modalidad: 'M3' }).find((f) => f.nombre === 'RUT').opcional).toBe(false);
  });
});
