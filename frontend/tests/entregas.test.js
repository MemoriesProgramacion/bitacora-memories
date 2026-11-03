import { describe, it, expect } from 'vitest';
import {
  horaDeExcel, horaInput, horaLegible, horaParaGuardar, fechaProgramada, estadoEntrega,
  editablePorGestor, semaforoEntrega, semaforoDocumentos, listaParaEntrega, progresoLista,
  sumarDias, inicioSemana, inicioMes, finMes, enLapso, validarActa, rechazoVigente, porDia,
} from '../src/lib/entregas';

describe('horaDeExcel', () => {
  it.each([
    ['6:00 AM', '06:00'],
    ['10:00 a. m', '10:00'],
    ['5:00 pm.', '17:00'],
    ['7.30', '07:30'],
    ['7 00 pm', '19:00'],
    ['07:00:00', '07:00'],
    ['2.30 - 5:00', '14:30'],
    ['11:00 p. m.', '23:00'],
    ['12:00 p. m.', '12:00'],
    ['12:00 a. m.', '00:00'],
    ['01:00', '13:00'],
    ['9:30', '09:30'],
    ['15:45', '15:45'],
  ])('%s → %s', (texto, hora) => {
    expect(horaDeExcel(texto)).toBe(hora);
  });

  it.each(['', null, 'por confirmar', '1899-12-30', '25:00', '7:75'])('sin hora reconocible: %s', (texto) => {
    expect(horaDeExcel(texto)).toBe('');
  });
});

describe('horaInput, horaLegible y horaParaGuardar', () => {
  it('una hora ya guardada en 24 horas no se vuelve a deducir', () => {
    expect(horaInput('13:00')).toBe('13:00');
    expect(horaInput('01:00')).toBe('01:00');
  });

  it('lo que no viene en HH:MM se interpreta como el Excel', () => {
    expect(horaInput('2:30')).toBe('14:30');
  });

  it.each([
    ['09:30', '9:30 a. m.'],
    ['12:00', '12:00 p. m.'],
    ['15:00', '3:00 p. m.'],
    ['00:15', '12:15 a. m.'],
  ])('horaLegible(%s) → %s', (hhmm, legible) => {
    expect(horaLegible(hhmm)).toBe(legible);
  });

  it('horaLegible y horaParaGuardar devuelven tal cual lo que no es hora', () => {
    expect(horaLegible('en la tarde')).toBe('en la tarde');
    expect(horaParaGuardar('en la tarde')).toBe('en la tarde');
    expect(horaParaGuardar('3 pm')).toBe('15:00');
  });
});

describe('fechaProgramada', () => {
  it('manda la efectiva, luego la vigente, la reprogramada y la programada', () => {
    const doc = {
      excel_fecha_programada: '2026-10-01',
      excel_fecha_reprogramada: '2026-10-05',
      excel_fecha_entrega_vigente: '2026-10-07T00:00:00Z',
    };
    expect(fechaProgramada(doc)).toBe('2026-10-07');
    expect(fechaProgramada({ ...doc, excel_fecha_entrega_efectiva: '2026-10-09' })).toBe('2026-10-09');
    expect(fechaProgramada({ excel_fecha_programada: '2026-10-01' })).toBe('2026-10-01');
  });

  it('ignora lo que no es fecha', () => {
    expect(fechaProgramada({ excel_fecha_programada: 'Sin datos asignados' })).toBe('');
    expect(fechaProgramada()).toBe('');
  });
});

describe('estadoEntrega', () => {
  const F = '2026-10-10';

  it('parcial y no entregada salen del Excel, con o sin tildes', () => {
    expect(estadoEntrega({ excel_estado_entrega: 'Entrega PARCIAL' }, F)).toBe('parcial');
    expect(estadoEntrega({ excel_estado_programacion: 'NO ENTREGADA' }, F)).toBe('no_entregada');
  });

  it('entregada por estado o por fecha efectiva', () => {
    expect(estadoEntrega({ excel_estado_programacion: 'ENTREGADA' }, F)).toBe('entregada');
    expect(estadoEntrega({ excel_estado_entrega: 'Completa' }, F)).toBe('entregada');
    expect(estadoEntrega({ excel_fecha_entrega_efectiva: '2026-10-09' }, F)).toBe('entregada');
  });

  it('una solicitud con acta en revisión todavía no es reagendamiento', () => {
    expect(estadoEntrega({ solicitud_en: 'x', solicitud_acta_estado: 'en_revision' }, F)).toBe('acta_revision');
    expect(estadoEntrega({ solicitud_en: 'x', solicitud_acta_estado: 'aprobada' }, F)).toBe('solicitud');
  });

  it('sin fecha, programada, confirmada y reagendada', () => {
    expect(estadoEntrega({}, '')).toBe('sin_fecha');
    expect(estadoEntrega({}, F)).toBe('programada');
    expect(estadoEntrega({ gestor_confirmada_fecha: F }, F)).toBe('confirmada');
    expect(estadoEntrega({ gestor_confirmada_fecha: '2026-10-01' }, F)).toBe('programada');
    expect(estadoEntrega({ historial: [{ accion: 'reagendada', fecha_nueva: F }] }, F)).toBe('reagendada');
  });
});

describe('editablePorGestor', () => {
  it('solo con fecha, sin reagendamiento pendiente y sin entregar', () => {
    for (const e of ['programada', 'confirmada', 'reagendada']) {
      expect(editablePorGestor({ estado_hora: e })).toBe(true);
    }
    for (const e of ['solicitud', 'acta_revision', 'entregada', 'parcial', 'sin_fecha']) {
      expect(editablePorGestor({ estado_hora: e })).toBe(false);
    }
    expect(editablePorGestor(null)).toBe(false);
  });
});

describe('progresoLista', () => {
  it('cuenta ítems comprados de la lista completa', () => {
    const lista = { items: [{ comprado: true }, { comprado: false }, { comprado: true }, {}] };
    expect(progresoLista(lista)).toEqual({ hechos: 2, total: 4, pct: 50 });
  });

  it('usa los totales del resumen cuando no hay ítems', () => {
    expect(progresoLista({ total_items: 3, items_comprados: 1 })).toEqual({ hechos: 1, total: 3, pct: 33 });
  });

  it('lista vacía o ausente: 0', () => {
    expect(progresoLista(null)).toEqual({ hechos: 0, total: 0, pct: 0 });
    expect(progresoLista({ items: [] })).toEqual({ hechos: 0, total: 0, pct: 0 });
  });
});

describe('semáforos', () => {
  const lista = (comprados, total) => ({ total_items: total, items_comprados: comprados });

  it('semaforoEntrega sigue el avance de compras sin entrega', () => {
    expect(semaforoEntrega(null, null).label).toBe('Sin iniciar');
    expect(semaforoEntrega(lista(0, 4), null).label).toBe('Sin comprar');
    expect(semaforoEntrega(lista(2, 4), null).label).toBe('Comprando 2/4');
    expect(semaforoEntrega(lista(4, 4), null).label).toBe('Lista completa');
  });

  it('semaforoEntrega: la entrega manda sobre las compras', () => {
    expect(semaforoEntrega(lista(1, 4), { fecha_programada: '2026-10-10' }).label).toBe('Entrega programada');
    expect(semaforoEntrega(lista(1, 4), { estado_hora: 'confirmada' }).label).toBe('Entrega confirmada');
    expect(semaforoEntrega({ ...lista(4, 4), logistica: { despachado: true } }, null).label).toBe('Despachada');
    expect(semaforoEntrega({ ...lista(4, 4), logistica: { entregado: true } }, null).label).toBe('Entregada');
  });

  it('semaforoDocumentos', () => {
    expect(semaforoDocumentos('validado').tono).toBe('bueno');
    expect(semaforoDocumentos('correcciones').tono).toBe('malo');
    expect(semaforoDocumentos('pendiente').tono).toBe('espera');
    expect(semaforoDocumentos(undefined).label).toBe('Sin cargar');
  });

  it('listaParaEntrega', () => {
    expect(listaParaEntrega(null, { fecha_programada: '2026-10-10' })).toBe(true);
    expect(listaParaEntrega({ logistica: { despachado: true } }, null)).toBe(true);
    expect(listaParaEntrega(lista(1, 4), { estado_hora: 'sin_fecha' })).toBe(false);
  });
});

describe('fechas y lapsos', () => {
  it('sumarDias cruza meses y años', () => {
    expect(sumarDias('2026-02-28', 1)).toBe('2026-03-01');
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2026-10-08', -8)).toBe('2026-09-30');
  });

  it('inicioSemana es el lunes', () => {
    expect(inicioSemana('2026-10-08')).toBe('2026-10-05'); // jueves
    expect(inicioSemana('2026-10-05')).toBe('2026-10-05'); // lunes
    expect(inicioSemana('2026-10-11')).toBe('2026-10-05'); // domingo
  });

  it('inicioMes y finMes (con bisiesto)', () => {
    expect(inicioMes('2026-10-08')).toBe('2026-10-01');
    expect(finMes('2026-10-08')).toBe('2026-10-31');
    expect(finMes('2028-02-10')).toBe('2028-02-29');
  });

  it('enLapso incluye los dos límites', () => {
    const lapso = { desde: '2026-10-01', hasta: '2026-10-31' };
    expect(enLapso('2026-10-01', lapso)).toBe(true);
    expect(enLapso('2026-10-31T10:00:00Z', lapso)).toBe(true);
    expect(enLapso('2026-11-01', lapso)).toBe(false);
    expect(enLapso('2026-10-08', { desde: null, hasta: '2026-10-07' })).toBe(false);
    expect(enLapso('', lapso)).toBe(true);
  });
});

describe('validarActa', () => {
  it('exige un PDF de máximo 10 MB', () => {
    expect(validarActa(null)).toMatch(/Adjunta/);
    expect(validarActa({ name: 'acta.jpg', type: 'image/jpeg', size: 100 })).toMatch(/PDF/);
    expect(validarActa({ name: 'acta.pdf', type: 'application/pdf', size: 11 * 1024 * 1024 })).toMatch(/10 MB/);
    expect(validarActa({ name: 'ACTA.PDF', type: '', size: 1024 })).toBe('');
  });
});

describe('rechazoVigente', () => {
  const rechazo = { accion: 'acta_rechazada', motivo: 'ilegible' };

  it('devuelve el último rechazo si no hubo nada después', () => {
    expect(rechazoVigente({ historial: [{ accion: 'solicitar_reagendamiento' }, rechazo] })).toBe(rechazo);
  });

  it('nada si después hubo otra acción o hay una solicitud abierta', () => {
    expect(rechazoVigente({ historial: [rechazo, { accion: 'confirmar' }] })).toBeNull();
    expect(rechazoVigente({ historial: [rechazo], solicitud_reagendamiento: {} })).toBeNull();
    expect(rechazoVigente(null)).toBeNull();
  });
});

describe('porDia', () => {
  it('agrupa por fecha y ordena por hora; sin hora al final', () => {
    const entregas = [
      { unidad_nombre: 'C', fecha_programada: '2026-10-10', hora: '' },
      { unidad_nombre: 'B', fecha_programada: '2026-10-10', hora: '14:00' },
      { unidad_nombre: 'A', fecha_programada: '2026-10-10', hora_excel: '8:00 am' },
      { unidad_nombre: 'D', fecha_programada: '2026-10-11T00:00:00Z', hora: '09:00' },
      { unidad_nombre: 'E', fecha_programada: '' },
    ];
    const mapa = porDia(entregas);
    expect(Object.keys(mapa).sort()).toEqual(['2026-10-10', '2026-10-11']);
    expect(mapa['2026-10-10'].map((e) => e.unidad_nombre)).toEqual(['A', 'B', 'C']);
  });
});
