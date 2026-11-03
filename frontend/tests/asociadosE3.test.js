// E3 · Asociados de la unidad productiva: reglas que la pantalla revisa antes de enviar
// (el servidor las vuelve a aplicar) y quién ve la sección.
import { describe, expect, it } from 'vitest';
import {
  activosTrasActa, armarActa, asociadoAFormulario, asociadoVacio, avisoMinimo, bloquesPerfil, erroresAsociado,
  fechaLegible, formularioAAsociado, hoyISO, problemasActa,
} from '../src/lib/asociados';
import { puedeVerAsociados } from '../src/lib/permisos';

const valido = () => ({ ...asociadoVacio(), nombre: 'Ana María Pérez', documento: '1.001.234.567', telefono: '300 123 4567', sexo: 'mujer' });
const resumenM3 = (total) => ({ modalidad: 'M3', total, minimo: 15 });

describe('datos obligatorios del asociado', () => {
  it('pide nombre completo, cédula, teléfono y sexo', () => {
    expect(Object.keys(erroresAsociado(asociadoVacio())).sort()).toEqual(['documento', 'nombre', 'sexo', 'telefono']);
    expect(erroresAsociado({ ...valido(), nombre: 'Ana' }).nombre).toMatch(/nombre completo/);
    expect(erroresAsociado({ ...valido(), documento: '1234' }).documento).toMatch(/5 y 15 dígitos/);
    expect(erroresAsociado({ ...valido(), telefono: '12345' }).telefono).toMatch(/7 y 15 dígitos/);
    expect(erroresAsociado(valido())).toEqual({});
  });

  it('la fecha de nacimiento es opcional pero no puede ser futura', () => {
    const hoy = new Date('2026-10-23T12:00:00Z');
    expect(erroresAsociado({ ...valido(), fecha_nacimiento: '1990-05-01' }, hoy)).toEqual({});
    expect(erroresAsociado({ ...valido(), fecha_nacimiento: '2030-01-01' }, hoy).fecha_nacimiento).toMatch(/no es válida/);
  });

  it('al enviar deja solo dígitos en cédula y teléfono y manda los vacíos como null', () => {
    const a = formularioAAsociado({ ...valido(), nombre: '  Ana   María  Pérez ', discapacidad: 'si' });
    expect(a).toMatchObject({ nombre: 'Ana María Pérez', documento: '1001234567', telefono: '3001234567', discapacidad: 'si', zona: null });
    expect(a.id).toBeUndefined();
  });

  it('el asociado del servidor vuelve al formulario con Sí/No', () => {
    const f = asociadoAFormulario({ id: 4, nombre: 'Luis Gómez', documento: '123456', telefono: '3001112233', sexo: 'hombre', discapacidad: false, victima: true });
    expect(f).toMatchObject({ id: 4, discapacidad: 'no', victima: 'si', zona: '', tipo: 'directo' });
  });
});

describe('mínimo de la modalidad', () => {
  it('avisa cuántos faltan o que cumple', () => {
    expect(avisoMinimo(resumenM3(12))).toEqual({ tono: 'alerta', texto: '12 de 15: faltan 3 para el mínimo de la modalidad M3.' });
    expect(avisoMinimo(resumenM3(15)).tono).toBe('ok');
    expect(avisoMinimo({ modalidad: 'M1', total: 1, minimo: null }).texto).toMatch(/no exige un mínimo/);
  });

  it('el acta calcula lo que deja la unidad', () => {
    expect(activosTrasActa(15, [{}], [{ id: 1 }, { id: 2 }])).toBe(14);
  });
});

describe('acta de novedades', () => {
  const pdf = { name: 'acta.pdf' };
  const base = { fecha: '2026-10-01', motivo: 'Retiro voluntario', ingresos: [], retiros: [], archivo: pdf };

  it('exige fecha no futura, motivo, al menos un cambio y el PDF', () => {
    const p = problemasActa({ fecha: '2026-12-01', motivo: '', ingresos: [], retiros: [], archivo: null }, resumenM3(16), '2026-10-23');
    expect(p).toEqual([
      'La fecha del acta no puede ser futura.', 'Escribe el motivo del acta.',
      'Registra al menos un ingreso o un retiro.', 'Adjunta el acta firmada en PDF.',
    ]);
    expect(problemasActa({ ...base, retiros: [{ id: 1 }], archivo: { name: 'acta.docx' } }, resumenM3(16), '2026-10-23'))
      .toEqual(['El acta debe ser un archivo PDF.']);
  });

  it('no deja la unidad bajo el mínimo sin el reemplazo en la misma acta', () => {
    const solo = problemasActa({ ...base, retiros: [{ id: 1 }] }, resumenM3(15), '2026-10-23');
    expect(solo).toEqual(['El acta deja 14 asociados y la modalidad M3 exige 15: registra el reemplazo.']);
    expect(problemasActa({ ...base, retiros: [{ id: 1 }], ingresos: [valido()] }, resumenM3(15), '2026-10-23')).toEqual([]);
  });

  it('revisa los datos obligatorios y las cédulas repetidas de los ingresos', () => {
    const p = problemasActa({ ...base, ingresos: [valido(), valido(), asociadoVacio()] }, resumenM3(15), '2026-10-23');
    expect(p).toContain('Completa los datos obligatorios del ingreso 3.');
    expect(p).toContain('Hay cédulas repetidas entre los ingresos.');
  });

  it('arma el multipart con «datos» y «archivo»', () => {
    const archivo = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    const cuerpo = armarActa('E3-B', { ...base, motivo: '  Cambio  ', retiros: [{ id: 7, motivo: '' }], ingresos: [valido()], archivo });
    const datos = JSON.parse(cuerpo.get('datos'));
    expect(datos).toMatchObject({ id_unico: 'E3-B', fecha: '2026-10-01', motivo: 'Cambio', retiros: [{ id: 7, motivo: null }] });
    expect(datos.ingresos[0].documento).toBe('1001234567');
    expect(cuerpo.get('archivo')).toBeTruthy();
  });
});

describe('perfil y fechas', () => {
  it('pinta solo lo que tiene datos, con los nombres de las listas', () => {
    const perfil = {
      sexo: { mujer: 2, hombre: 0, sin_dato: 1 }, edad: { '18_28': 1, sin_dato: 2 }, pertenencia_etnica: { ninguna: 0, sin_dato: 3 },
      nivel_educativo: {}, zona: { rural: 3 }, con_discapacidad: 1, victimas: 0,
    };
    const listas = { sexos: [{ codigo: 'mujer', nombre: 'Mujer' }], zonas: [{ codigo: 'rural', nombre: 'Rural' }] };
    const b = bloquesPerfil(perfil, listas);
    expect(b.map((x) => x.titulo)).toEqual(['Sexo', 'Edad', 'Pertenencia étnica', 'Zona', 'Condiciones']);
    expect(b[0].filas).toEqual([{ nombre: 'Mujer', n: 2 }, { nombre: 'Sin dato', n: 1 }]);
    expect(b[1].filas[0]).toEqual({ nombre: '18 a 28 años', n: 1 });
  });

  it('las fechas sin hora no se corren de día', () => {
    expect(fechaLegible('2026-05-03')).toBe('3 de mayo de 2026');
    expect(hoyISO(new Date(2026, 0, 9))).toBe('2026-01-09');
  });
});

describe('quién ve los asociados', () => {
  it('gestor, coordinación, seguimiento y técnico; no compras ni tallerista', () => {
    for (const role of ['superadmin', 'coordinador', 'coordinador_datos', 'gestor', 'tecnico_administrativo']) {
      expect(puedeVerAsociados({ role })).toBe(true);
    }
    for (const role of ['coordinador_compras', 'tallerista', 'bodeguero']) expect(puedeVerAsociados({ role })).toBe(false);
    expect(puedeVerAsociados(null)).toBe(false);
  });
});
