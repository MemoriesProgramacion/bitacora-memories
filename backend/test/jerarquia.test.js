// Jerarquía de la consola de Administración: no necesita base de datos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actorDe, puedeGestionar, puedeAsignarRol, puedeAdministrar } from '../src/acceso/jerarquia.js';

const general = actorDe({ rol: 'superadmin', perfil: {} });
const regional = actorDe({ rol: 'coordinador', perfil: { region: 'Región 1' } });
const regionalAtlantico = actorDe({ rol: 'coordinador', perfil: { region: 'Región 1', departamento: 'Atlántico' } });
const tecnico = actorDe({ rol: 'tecnico_administrativo', perfil: { region: 'Región 1' } });

const cuenta = (rol, extra = {}) => ({ rol, nodo: null, region: '', departamento: null, modalidad: '', ...extra });

test('entra a Administración el Coordinador general y el local regional, nadie más', () => {
  assert.equal(puedeAdministrar(general), true);
  assert.equal(puedeAdministrar(regional), true);
  assert.equal(puedeAdministrar(tecnico), false);
  assert.equal(puedeAdministrar(actorDe({ rol: 'gestor', perfil: {} })), false);
});

test('el regional no ve ni toca al Coordinador general ni a otro regional', () => {
  assert.equal(puedeGestionar(regional, cuenta('superadmin')), false);
  assert.equal(puedeGestionar(regional, cuenta('coordinador', { region: 'Región 1' })), false);
  assert.equal(puedeGestionar(general, cuenta('superadmin')), true);
});

test('el regional administra los roles de debajo; los de territorio, solo dentro del suyo', () => {
  for (const rol of ['coordinador_compras', 'coordinador_datos', 'bodeguero']) {
    assert.equal(puedeGestionar(regional, cuenta(rol)), true, rol);
  }
  assert.equal(puedeGestionar(regional, cuenta('gestor', { nodo: 'ATLAN1', region: 'Región 1', departamento: 'Atlántico' })), true);
  assert.equal(puedeGestionar(regional, cuenta('gestor', { nodo: 'BOLIV1', region: 'Región 2', departamento: 'Bolívar' })), false);
  assert.equal(puedeGestionar(regional, cuenta('tecnico_administrativo', { region: 'región 1' })), true);
  assert.equal(puedeGestionar(regional, cuenta('tecnico_administrativo', { region: 'Región 2' })), false);
  assert.equal(puedeGestionar(regional, cuenta('tallerista', { region: 'Región 1' })), true);
  assert.equal(puedeGestionar(regional, cuenta('tallerista', { region: 'Región 2' })), false);
  assert.equal(puedeAdministrar(actorDe({ rol: 'tallerista', perfil: { region: 'Región 1' } })), false);
  // Un técnico con territorio más amplio que el del regional queda fuera.
  assert.equal(puedeGestionar(regionalAtlantico, cuenta('tecnico_administrativo', { region: 'Región 1' })), false);
  assert.equal(puedeGestionar(regionalAtlantico, cuenta('tecnico_administrativo', { region: 'Región 1', departamento: 'ATLANTICO' })), true);
});

test('el Profesional alianzas y conexión de mercados solo administra a los bodegueros', () => {
  const logistica = actorDe({ rol: 'coordinador_compras', perfil: {} });
  assert.equal(puedeAdministrar(logistica), true);
  assert.equal(puedeGestionar(logistica, cuenta('bodeguero')), true);
  for (const rol of ['superadmin', 'coordinador', 'tecnico_administrativo', 'coordinador_compras', 'coordinador_datos', 'gestor']) {
    assert.equal(puedeGestionar(logistica, cuenta(rol)), false, rol);
  }
  assert.equal(puedeAsignarRol(logistica, 'bodeguero'), true);
  assert.equal(puedeAsignarRol(logistica, 'coordinador_compras'), false);
});

test('el regional solo puede asignar roles de debajo', () => {
  assert.equal(puedeAsignarRol(regional, 'gestor'), true);
  assert.equal(puedeAsignarRol(regional, 'tecnico_administrativo'), true);
  assert.equal(puedeAsignarRol(regional, 'coordinador'), false);
  assert.equal(puedeAsignarRol(regional, 'superadmin'), false);
  assert.equal(puedeAsignarRol(general, 'superadmin'), true);
});
