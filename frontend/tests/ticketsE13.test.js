// E13 · Tickets: etapas del servidor, lo que falta para radicar, archivos, la cadena de salidas y los filtros de la bandeja.
// Las reglas son del servidor (backend/src/servicios/tickets.js); las etapas deben ser las mismas.
import { describe, expect, it } from 'vitest';
import {
  ETAPAS_TICKET, MAX_ARCHIVOS_TICKET, cadenaTicket, claveAsignado, faltasTicket, fechaLargaTicket, filtrarTickets,
  filtroInicial, mensajeVacio, opcionesAsignado, personalDeTicket, problemasArchivos, requiereAccion, textoPersonal,
} from '../src/lib/tickets';
import { ETAPAS, MAX_ARCHIVOS } from '../../backend/src/servicios/tickets.js';

const MB = 1024 * 1024;
const pdf = (n = 'a.pdf', size = MB) => ({ name: n, size });

describe('radicar (TK-01)', () => {
  it('las etapas y el tope de archivos son los del servidor', () => {
    expect(ETAPAS_TICKET).toEqual(ETAPAS);
    expect(MAX_ARCHIVOS_TICKET).toBe(MAX_ARCHIVOS);
  });
  it('lo que falta y los archivos', () => {
    expect(faltasTicket({ titulo: 'x', etapa: 'capitalizacion', descripcion: 'y' }, [pdf()])).toEqual([]);
    expect(faltasTicket({ titulo: ' ', etapa: 'otra', descripcion: '' })).toEqual(['Escribe el título.', 'Elige la etapa del proceso.', 'Describe la novedad.']);
    expect(problemasArchivos([pdf('a.docx')])).toEqual(['«a.docx» debe ser PDF, JPG o PNG.']);
    expect(problemasArchivos([pdf('g.pdf', 16 * MB), { name: 'f.png', size: 6 * MB }])).toEqual(['«g.pdf» supera los 15 MB.', '«f.png» supera los 5 MB.']);
    expect(problemasArchivos(Array(6).fill(pdf()))).toEqual(['Máximo 5 archivos.']);
  });
});

describe('salidas del ticket (TK-05)', () => {
  const base = { creado_en: '2026-10-20T15:00:00Z', historial: [{ accion: 'crear', cuando: '2026-10-20T15:00:00Z' }], adjuntos: [] };
  it('radicado → respondido con anexos → solucionado', () => {
    expect(cadenaTicket({ ...base, estado: 'abierto' }).map((p) => p.hecho)).toEqual([true, false, false]);
    const resp = { ...base, estado: 'respondido', adjuntos: [{ clase: 'respuesta' }, { clase: 'respuesta' }, { clase: 'radicacion' }],
      historial: [...base.historial, { accion: 'resolver', cuando: '2026-10-21T15:00:00Z' }] };
    const c = cadenaTicket(resp);
    expect([c[1].nombre, c[1].cuando, c[2].hecho]).toEqual(['Respondido con 2 anexos', '2026-10-21T15:00:00Z', false]);
    const auto = cadenaTicket({ ...resp, estado: 'resuelto', historial: [...resp.historial, { accion: 'solucionado_auto', cuando: '2026-10-29T15:00:00Z' }] });
    expect([auto[2].nombre, auto[2].hecho, auto[2].cuando]).toEqual(['Solucionado (sin confirmación)', true, '2026-10-29T15:00:00Z']);
    expect(cadenaTicket({ ...base, estado: 'resuelto', historial: [...base.historial, { accion: 'resolver', cuando: 'x' }, { accion: 'confirmar', cuando: 'y' }] })[2].nombre).toBe('Solucionado');
  });
  it('pide acción a quien atiende y al solicitante con respuesta', () => {
    expect([requiereAccion({ puede: { tomar: true } }), requiereAccion({ puede: { confirmar: true } }), requiereAccion({ puede: {} })]).toEqual([true, true, false]);
  });
});

describe('bandeja (TK-06)', () => {
  const t = (id, extra) => ({ id, consecutivo: `TK-0000${id}`, titulo: `T${id}`, descripcion: '', estado: 'abierto', etapa: 'diagnostico', ...extra });
  const lista = [
    t(1, { asignado: { tipo: 'cuenta', nombre: 'Ana', nombre_rol: 'Gestor', rol: 'gestor' } }),
    t(2, { etapa: 'capitalizacion', asignado: { tipo: 'rol', rol: 'tecnico_administrativo', nombre_rol: 'Técnico administrativo regional de apoyo' } }),
    t(3, { estado: 'respondido', id_unico: 'E10-A' }),
  ];
  it('filtra por etapa, asignado, estado y texto', () => {
    expect(filtrarTickets(lista, { etapa: 'capitalizacion' }).map((x) => x.id)).toEqual([2]);
    expect(filtrarTickets(lista, { asignado: 'cuenta:Ana' }).map((x) => x.id)).toEqual([1]);
    expect(filtrarTickets(lista, { asignado: 'rol:tecnico_administrativo' }).map((x) => x.id)).toEqual([2]);
    expect(filtrarTickets(lista, { estado: 'respondido' }).map((x) => x.id)).toEqual([3]);
    expect(filtrarTickets(lista, { q: 'e10-a' }).map((x) => x.id)).toEqual([3]);
    expect(filtrarTickets(lista, { q: 'tk-00002' }).map((x) => x.id)).toEqual([2]);
  });
  it('opciones del filtro de asignado', () => {
    expect(opcionesAsignado(lista)).toEqual([['cuenta:Ana', 'Ana (Gestor)'], ['rol:tecnico_administrativo', 'Cola: Técnico administrativo regional de apoyo']]);
    expect(claveAsignado(lista[2])).toBe('');
  });
  it('el filtro inicial se decide con lo cargado: «Por atender» solo si algo pide acción', () => {
    expect(filtroInicial([t(1, { puede: {} }), t(2, { puede: { confirmar: true } })])).toBe('atender');
    expect(filtroInicial([t(1, { puede: {} }), t(2, { puede: { resolver: true } })])).toBe('atender');
    expect(filtroInicial([t(1, { puede: {} })])).toBe('todos');
    expect(filtroInicial([])).toBe('todos');
  });
  it('la bandeja vacía dice «al día» solo si no hay pendientes; si los tapan los filtros, lo dice', () => {
    expect(mensajeVacio('atender', false)).toBe('Estás al día: no tienes tickets por atender.');
    expect(mensajeVacio('atender', true)).toBe('No hay tickets por atender con estos filtros.');
    expect(mensajeVacio('todos', true)).toBe('No hay tickets con estos filtros.');
    expect(mensajeVacio('escalado', false)).toBe('No hay tickets con estos filtros.');
  });
});

describe('fechas de la tarjeta', () => {
  it('el plazo de confirmación va en español largo, como las demás fechas', () => {
    expect(fechaLargaTicket('2026-10-30')).toBe('30 de octubre de 2026');
    expect(fechaLargaTicket('2026-10-30T05:00:00.000Z')).toBe('30 de octubre de 2026');
    expect(fechaLargaTicket(null)).toBe('');
    expect(fechaLargaTicket('')).toBe('');
    expect(fechaLargaTicket('no-es-fecha')).toBe('no-es-fecha');
  });
});

describe('personal de un retiro o reemplazo asignado al ticket', () => {
  it('sale del último movimiento del historial que lo trae', () => {
    const sale = [{ nombre: 'Ana Pérez', documento: '123' }, { nombre: 'Luis Mora', documento: '456' }];
    const t = { historial: [{ accion: 'tomar' }, { accion: 'resolver', personal_sale: sale, entra: 'Rosa Gómez' }] };
    expect(personalDeTicket(t)).toEqual({ sale, entra: 'Rosa Gómez' });
    expect(textoPersonal(sale)).toBe('Ana Pérez (123), Luis Mora (456)');
    expect(personalDeTicket({ historial: [{ accion: 'tomar' }] })).toBeNull();
    expect(personalDeTicket({})).toBeNull();
  });
  it('un retiro de una unidad sin personal registrado no trae personal', () => {
    expect(personalDeTicket({ historial: [{ accion: 'resolver', personal_sale: [] }] })).toBeNull();
  });
});
