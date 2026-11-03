import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FormTaller from '../src/sections/talleres/FormTaller';
import Calendario from '../src/sections/talleres/Calendario';

afterEach(() => vi.useRealTimers());
describe('programación y calendario de grupos de UP', () => {
  const grupo = {id:1,nombre:'Grupo Norte',region:'Región 1',ups:[{id_up:8,id_unico:'UP-008',nombre:'Panadería del Norte',nodo:'NORTE1'}]};
  it('programa con un grupo existente y carga el contenido de su región y encuentro', () => {
    const html = renderToStaticMarkup(createElement(FormTaller, {
      grupoInicial:grupo, session:{role:'tallerista',nombre:'Tallerista de prueba'},
      datos:{grupos:[grupo],talleristas:[{sub:'coordinador:7',nombre:'Tallerista de prueba',region:'Región 1'}],
        nodos:[{nodo:'NORTE1',region:'Región 1'}],contenidos:[
          {id:1,region:'Región 1',modulo:1,titulo:'Contenido correcto',texto:'Instrucciones del primer encuentro',actualizado_en:'2026-10-22T12:00:00Z'},
          {id:2,region:'Región 2',modulo:1,titulo:'Contenido otra región',actualizado_en:'2026-10-22T12:00:00Z'},
          {id:3,region:'Región 1',modulo:2,titulo:'Contenido segundo encuentro',actualizado_en:'2026-10-22T12:00:00Z'},
        ]},onGuardar:()=>{},onCancelar:()=>{},ocupado:false,
    }));
    expect(html).toContain('Grupo Norte');
    expect(html).toContain('UP-008');
    expect(html).toContain('Panadería del Norte');
    expect(html).toContain('Contenido correcto');
    expect(html).not.toContain('Contenido otra región');
    expect(html).not.toContain('Contenido segundo encuentro');
    expect(html).not.toContain('Agregar participante');
  });
  it('muestra los tres módulos y las convocatorias en el calendario del mismo mes', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-22T15:00:00Z'));
    const html = renderToStaticMarkup(createElement(Calendario, {
      talleres:[{id:1,nombre:'Taller del grupo',grupo_nombre:'Grupo Norte',lugar:'Salón',encuentros:[1,2,3].map((modulo)=>({id:modulo,modulo,inicio:`2026-10-${20+modulo}T14:00:00Z`}))}],
      convocatorias:[{id:'coord-1',titulo:'Reunión regional',fecha:'2026-10-24',hora:'09:00',lugar:'Sede'}],onSeleccionar:()=>{},
    }));
    expect(html).toContain('M1 · ');
    expect(html).toContain('M2 · ');
    expect(html).toContain('M3 · ');
    expect(html).toContain('Reunión regional');
    expect(html).toContain('Abrir módulo y contenido');
    expect(html).toContain('Próximos (3)');
    expect(html).toContain('Pasados (1)');
    expect(html).toContain('2026-10-22, 1 eventos');
  });
});
