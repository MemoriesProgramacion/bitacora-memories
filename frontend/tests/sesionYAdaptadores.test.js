// Token CSRF en memoria y los adaptadores de Eventos y Avisos (LIT-h-02): qué documento viaja al servidor.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('token CSRF', () => {
  it('vive en memoria, viaja en la cabecera y se renueva con el servidor', async () => {
    const csrf = await import('../src/lib/csrf');
    expect(csrf.tokenCsrf()).toBeNull();
    expect(csrf.cabecerasSesion()).toEqual({});
    csrf.fijarCsrf('');                       // un token vacío no borra ni reemplaza
    expect(csrf.tokenCsrf()).toBeNull();
    csrf.fijarCsrf('t-1');
    expect(csrf.cabecerasSesion()).toEqual({ 'X-CSRF-Token': 't-1' });

    const fetch = vi.fn(async () => new Response(JSON.stringify({ token: 't-2' }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    expect(await csrf.renovarCsrf()).toBe('t-2');
    expect(fetch.mock.calls[0][0]).toBe('/api/auth/csrf');
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
    // Si el servidor no entrega token, se conserva el que había.
    fetch.mockImplementationOnce(async () => new Response('no es json'));
    expect(await csrf.renovarCsrf()).toBe('t-2');
  });

  it('nunca se guarda en el almacenamiento del navegador', async () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { setItem });
    vi.stubGlobal('sessionStorage', { setItem });
    const csrf = await import('../src/lib/csrf');
    csrf.fijarCsrf('secreto');
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe('documentos de Eventos y Avisos', () => {
  it('el evento lleva como destinatarios los nodos convocados y quién convoca', async () => {
    const { prepararEvento } = await import('../src/lib/eventos');
    const e = prepararEvento({ id: 7, tipo: 'capacitacion', respuestas: { ATLAN1: {}, BOLIV1: {} } }, { role: 'coordinador', correo: 'clr@x.co' });
    expect(e).toMatchObject({ id: '7', tipo_label: 'Capacitación', destinatarios: ['ATLAN1', 'BOLIV1'], convocado_por: { usuario: 'clr@x.co', nodo: null }, recordado: null });
    expect(typeof e.creado_en).toBe('string');
    const g = prepararEvento({ id: 'x', tipo: 'otro' }, { role: 'gestor', nodo: 'ATLAN1', nombre: 'Gestora' });
    expect(g.tipo_label).toBe('Sin datos asignados');
    expect(g.convocado_por).toEqual({ usuario: 'Gestora', nodo: 'ATLAN1' });
    // Al editar se conservan la creación y quién lo convocó.
    const editado = prepararEvento({ ...e, creado_en: '2026-10-01T00:00:00Z' }, { role: 'coordinador', correo: 'otro@x.co' });
    expect(editado.creado_en).toBe('2026-10-01T00:00:00Z');
    expect(editado.convocado_por.usuario).toBe('clr@x.co');
  });

  it('el aviso lleva su categoría y quién lo publica', async () => {
    const { prepararNovedad } = await import('../src/lib/avisos');
    const n = prepararNovedad({ id: 3, categoria: 'urgente', editada: 1 }, { role: 'tecnico_administrativo', nombre: 'Técnica' });
    expect(n).toMatchObject({ id: '3', categoria_label: 'Urgente', editada: true, publicado_por: { usuario: 'Técnica', nodo: null } });
    expect(prepararNovedad({ id: 4, categoria: 'nada' }, null).categoria_label).toBe('Sin datos asignados');
  });
});
