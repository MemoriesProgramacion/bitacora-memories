// Tema claro y oscuro. El tema se guarda en el atributo data-theme de html, que deja listo public/tema.js al
// cargar. Aquí se cambia, se recuerda la elección de la persona y se avisa a los componentes que lo muestran;
// mientras no haya elegido nada se sigue el tema del sistema operativo, incluso si cambia con la página
// abierta.
import { useSyncExternalStore } from 'react';

const CLAVE = 'tema';
const oyentes = new Set();

// Colores de la barra del navegador en el celular, que coinciden con la cabecera.
const COLOR_BARRA = { claro: '#3D3A78', oscuro: '#1E1C3D' };

export const temaActual = () =>
  (document.documentElement.getAttribute('data-theme') === 'dark' ? 'oscuro' : 'claro');

function aplicar(tema) {
  document.documentElement.setAttribute('data-theme', tema === 'oscuro' ? 'dark' : 'light');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLOR_BARRA[tema]);
  oyentes.forEach((avisar) => avisar());
}

// Cambia el tema y lo recuerda; los colores se funden en vez de saltar.
export function fijarTema(tema) {
  const html = document.documentElement;
  html.classList.add('cambiando-tema');
  aplicar(tema);
  try { localStorage.setItem(CLAVE, tema); } catch { }
  setTimeout(() => html.classList.remove('cambiando-tema'), 450);
}

export const alternarTema = () => fijarTema(temaActual() === 'oscuro' ? 'claro' : 'oscuro');

if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    let guardado = null;
    try { guardado = localStorage.getItem(CLAVE); } catch { }
    if (!guardado) aplicar(e.matches ? 'oscuro' : 'claro');
  });
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLOR_BARRA[temaActual()]);
}

const suscribir = (avisar) => {
  oyentes.add(avisar);
  return () => oyentes.delete(avisar);
};

// Hook que devuelve el tema actual, claro u oscuro, y vuelve a dibujar cuando cambia.
export const useTema = () => useSyncExternalStore(suscribir, temaActual, () => 'claro');
