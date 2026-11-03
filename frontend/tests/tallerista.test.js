import { describe, it, expect } from 'vitest';
import { puedeVer, seccionInicial } from '../src/lib/permisos';

describe('acceso del Tallerista', () => {
  const session = { role: 'tallerista', region: 'Región 1' };
  it('abre Talleres y Novedades; Eventos queda dentro del calendario de Talleres', () => {
    expect(seccionInicial(session)).toBe('talleres');
    for (const s of ['talleres', 'novedades']) expect(puedeVer(s, session)).toBe(true);
    expect(puedeVer('eventos', session)).toBe(false);
  });
  it('no abre las pantallas de unidades, compras, inventario o administración', () => {
    for (const s of ['bitacora', 'agenda', 'visitas', 'capitalizacion', 'entregas', 'kardex', 'saldos', 'proveedores', 'carguedatos', 'datoscargados', 'revisionentregas']) expect(puedeVer(s, session)).toBe(false);
  });
  it('la coordinación consulta talleres; gestor y técnico no adquieren acceso', () => {
    for (const role of ['coordinador', 'superadmin', 'coordinador_datos']) expect(puedeVer('talleres', { role })).toBe(true);
    for (const role of ['gestor', 'tecnico_administrativo', 'coordinador_compras', 'bodeguero']) expect(puedeVer('talleres', { role })).toBe(false);
  });
});
