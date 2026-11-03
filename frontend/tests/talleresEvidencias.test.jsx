import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProveedorAvisos } from '../src/inventario/componentes/ui';
import Adjuntos from '../src/sections/talleres/Adjuntos';
import { EVIDENCIAS, problemaEvidencia } from '../src/sections/talleres/evidencias';

const archivo = (name, mb = 1) => ({ name, size: mb * 1024 * 1024 });
const ver = (e, puedeEditar = false) => renderToStaticMarkup(createElement(ProveedorAvisos, null,
  createElement(Adjuntos, { taller: { id: 1 }, e: { modulo: 1, mio: true, ...e }, recargar: () => {}, puedeEditar })));

describe('evidencias del módulo: informe, fotos y videos', () => {
  it('muestra las tres secciones con su formato; antes de registrar no deja anexar', () => {
    const html = ver({ realizado_en: null, soportes: [] });
    for (const t of ['Informe del módulo', 'Fotos del módulo', 'Videos del módulo']) expect(html).toContain(t);
    expect(html).toContain('PDF o Word (.docx)');
    expect(html).toContain('MOV o WEBM');
    expect(html).toContain('se cargan al registrar el módulo realizado');
    expect(html).not.toContain('Anexar');
  });

  it('ya realizado: marca la sección que falta y cada caja acepta solo su formato', () => {
    const html = ver({ realizado_en: '2026-10-01T17:00:00Z', soportes: [
      { id: 1, nombre: 'asistencia.pdf', tipo: 'asistencia' }, { id: 2, nombre: 'informe.pdf', tipo: 'informe' }, { id: 3, nombre: 'foto.png', tipo: 'foto' },
    ] });
    expect(html).toContain('Falta');
    expect(html).toContain('Asistencia firmada');
    expect(html).toContain('accept="image/jpeg,image/png,.jpg,.jpeg,.png"');
    expect(html).toContain('accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"');
  });

  it('valida cantidad, formato y peso antes de subir', () => {
    const [informe, fotos, videos] = EVIDENCIAS;
    expect(problemaEvidencia(informe, [])).toMatch(/obligatorio/);
    expect(problemaEvidencia(informe, [archivo('a.pdf'), archivo('b.pdf')])).toMatch(/máximo 1/);
    expect(problemaEvidencia(fotos, [archivo('foto.pdf')])).toMatch(/no es JPG o PNG/);
    expect(problemaEvidencia(videos, [archivo('v.mp4', 201)])).toMatch(/supera los 200 MB/);
    expect(problemaEvidencia(videos, [archivo('v.MOV', 150)])).toBe('');
    expect(problemaEvidencia(fotos, [archivo('f.jpg', 21)])).toMatch(/supera los 20 MB/);
    expect(problemaEvidencia(informe, [archivo('i.docx', 25)])).toBe('');
  });
});
