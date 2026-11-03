// E1 · Seguridad: el archivo público del registro fotográfico no lleva datos personales,
// la copia descargada los incrusta sin poder romper el <script>, y la pantalla de cada
// rol coincide con lo que el servidor le deja (ROL-PACM-01/02/04/07, ROL-TAR-03, ROL-GES-04).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MARCA_DATOS, incrustarDatos, enlaceRegistro } from '../src/lib/registroFotografico.js';
import { puedeVer, cargasDeSesion } from '../src/lib/permisos.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const publico = path.join(aqui, '../public');
const plantilla = fs.readFileSync(path.join(publico, 'herramientas/registro-fotografico.html'), 'utf8');

// Todos los archivos que se sirven sin sesión.
const archivosPublicos = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? archivosPublicos(path.join(dir, e.name)) : [path.join(dir, e.name)]));

describe('archivos públicos sin datos personales (LIT-g-07, TR-13)', () => {
  it('la plantilla del registro fotográfico no trae la base incrustada', () => {
    expect(plantilla).toContain(MARCA_DATOS);
    expect(plantilla).not.toMatch(/window\.DATOS_EP\s*=\s*\{/);
  });
  it('ningún archivo de public/ lleva números con forma de cédula', () => {
    for (const f of archivosPublicos(publico)) {
      let texto = fs.readFileSync(f, 'utf8');
      // Los formatos en blanco (PDF) traen números propios de su estructura: la tabla de offsets (xref), el ID hex del
      // documento y los UUID de los metadatos XMP (uuid:69982840-B341-…).
      if (/\.pdf$/i.test(f)) {
        texto = texto.replace(/^\d{10} \d{5} [nf]\s*$/gm, '').replace(/<[0-9A-Fa-f]{16,}>/g, '')
          .replace(/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/g, '');
      }
      expect(texto.match(/(?<![\d#.])\d{7,10}(?![\d.])/g) || [], path.relative(publico, f)).toEqual([]);
    }
  });
});

// Scripts de otro dominio en las páginas públicas: el registro fotográfico recibe cédulas, así que lo que baja
// de un CDN tiene que ser exactamente lo auditado (integrity) y pedirse con CORS (sin crossorigin el navegador
// no puede comprobar el integrity y no ejecuta el script).
const etiquetasScript = (html) => [...html.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1]);
const atributo = (attrs, nombre) => new RegExp(`\\b${nombre}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attrs)?.[1];
const esExterno = (src) => /^(https?:)?\/\//i.test(src || '');
const raizJspdf = path.join(aqui, '../node_modules/jspdf');

describe('scripts externos de las páginas públicas (TR-13)', () => {
  it('ningún HTML de public/ trae un <script src> externo sin integrity ni crossorigin', () => {
    const htmls = archivosPublicos(publico).filter((f) => /\.html?$/i.test(f));
    expect(htmls.length).toBeGreaterThan(0);
    for (const f of htmls) {
      for (const attrs of etiquetasScript(fs.readFileSync(f, 'utf8'))) {
        const src = atributo(attrs, 'src');
        if (!esExterno(src)) continue;
        const donde = `${path.relative(publico, f)} → ${src}`;
        expect(atributo(attrs, 'integrity') || '', donde).toMatch(/^sha(256|384|512)-[A-Za-z0-9+/]+=*$/);
        expect(atributo(attrs, 'crossorigin'), donde).toBe('anonymous');
      }
    }
  });

  it('jsPDF es la versión del lockfile y su integrity es el del archivo instalado', () => {
    const externos = etiquetasScript(plantilla).map((a) => atributo(a, 'src')).filter(esExterno);
    const src = externos.find((s) => /\/jspdf@/.test(s));
    expect(src, 'la plantilla debe cargar jsPDF').toBeTruthy();
    const [, version, archivo] = /\/jspdf@([^/]+)\/(.+)$/.exec(src);
    // Si el lockfile sube jsPDF (llega con html2pdf.js), esta prueba obliga a actualizar la plantilla.
    const instalada = JSON.parse(fs.readFileSync(path.join(raizJspdf, 'package.json'), 'utf8')).version;
    expect(version).toBe(instalada);
    // unpkg publica el mismo archivo del paquete de npm: el hash local es el que debe aceptar el navegador.
    const local = fs.readFileSync(path.join(raizJspdf, archivo));
    const esperado = `sha384-${createHash('sha384').update(local).digest('base64')}`;
    const attrs = etiquetasScript(plantilla).find((a) => atributo(a, 'src') === src);
    expect(atributo(attrs, 'integrity')).toBe(esperado);
  });

  it('la copia descargada conserva el mismo script con su integrity', () => {
    const externos = (html) => etiquetasScript(html).filter((a) => esExterno(atributo(a, 'src')));
    const copia = incrustarDatos(plantilla, { gestores: [['ATLAN1', 'Gestora Uno']], ups: {} });
    expect(externos(copia)).toEqual(externos(plantilla));
    expect(externos(copia).length).toBeGreaterThan(0);
  });
});

describe('copia descargada del registro fotográfico', () => {
  const datos = { gestores: [['ATLAN1', 'Gestora Uno']], ups: { ATLAN1: [['1', 'Arepas </script><script>alert(1)</script>', '111']] } };

  it('reemplaza la marca por la base', () => {
    const html = incrustarDatos(plantilla, datos);
    expect(html).not.toContain(MARCA_DATOS);
    const linea = html.split(/\r?\n/).find((l) => l.startsWith('window.DATOS_EP = {'));
    const base = JSON.parse(linea.replace(/^window\.DATOS_EP = /, '').replace(/;$/, ''));
    expect(base).toEqual(datos);
  });
  it('un nombre con </script> no puede cerrar la etiqueta', () => {
    const html = incrustarDatos(plantilla, datos);
    const linea = html.split(/\r?\n/).find((l) => l.startsWith('window.DATOS_EP = {'));
    expect(linea).not.toContain('</script>');
    expect(linea).toContain('\\u003c/script>');
  });
  it('sin datos queda una base vacía y una plantilla sin marca es un error', () => {
    const linea = incrustarDatos(plantilla, null).split(/\r?\n/).find((l) => l.startsWith('window.DATOS_EP = '));
    expect(linea).toBe('window.DATOS_EP = {"gestores":[],"ups":{}};');
    expect(() => incrustarDatos('<html></html>', datos)).toThrow();
  });
  it('el enlace solo pasa la API si es del mismo sitio', () => {
    expect(enlaceRegistro('/api')).toBe('/herramientas/registro-fotografico.html?api=%2Fapi');
    expect(enlaceRegistro('https://otro.co/api')).toBe('/herramientas/registro-fotografico.html');
    expect(enlaceRegistro('//otro.co/api')).toBe('/herramientas/registro-fotografico.html');
  });
});

describe('las pestañas coinciden con la matriz de roles', () => {
  it('Profesional alianzas: sin Bitácora, Agenda, Visitas, Eventos ni Novedades', () => {
    const s = { role: 'coordinador_compras' };
    for (const sec of ['bitacora', 'agenda', 'visitas', 'eventos', 'novedades']) expect(puedeVer(sec, s), sec).toBe(false);
    for (const sec of ['capitalizacion', 'entregas', 'carguecompras']) expect(puedeVer(sec, s), sec).toBe(true);
  });
  it('Técnico de apoyo: sin Visitas', () => {
    expect(puedeVer('visitas', { role: 'tecnico_administrativo' })).toBe(false);
    expect(puedeVer('bitacora', { role: 'tecnico_administrativo' })).toBe(true);
  });
  it('Gestor: Eventos de su nodo (para responder) y Novedades', () => {
    expect(puedeVer('eventos', { role: 'gestor', nodo: 'ATLAN1' })).toBe(true);
    expect(puedeVer('novedades', { role: 'gestor', nodo: 'ATLAN1' })).toBe(true);
  });
});

describe('qué se pide al servidor al abrir la Bitácora', () => {
  it('el Profesional alianzas no pide el avance de la ruta, los eventos ni los avisos', () => {
    expect(cargasDeSesion({ role: 'coordinador_compras' })).toEqual({ rutaBitacora: false, eventos: false, avisos: false });
  });
  it('el gestor pide todo lo de su nodo', () => {
    expect(cargasDeSesion({ role: 'gestor', nodo: 'ATLAN1' })).toEqual({ rutaBitacora: true, eventos: true, avisos: true });
  });
  it('el tallerista pide los eventos (sus talleres) y los avisos, no la ruta', () => {
    expect(cargasDeSesion({ role: 'tallerista' })).toEqual({ rutaBitacora: false, eventos: true, avisos: true });
  });
  it('la coordinación y el técnico de apoyo piden todo', () => {
    for (const role of ['coordinador', 'superadmin', 'coordinador_datos', 'tecnico_administrativo']) {
      expect(cargasDeSesion({ role }), role).toEqual({ rutaBitacora: true, eventos: true, avisos: true });
    }
  });
});
