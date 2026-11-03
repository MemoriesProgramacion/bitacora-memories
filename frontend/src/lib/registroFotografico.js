// Herramienta de registro fotográfico. La plantilla pública no lleva datos personales: abierta desde la
// Bitácora pide la base a la API con la sesión, y para usarla sin conexión la Bitácora descarga una copia con
// la base incrustada, solo con las unidades del alcance de quien la descarga.
import { API_BASE } from './config';

export const ARCHIVO_REGISTRO = '/herramientas/registro-fotografico.html';
export const NOMBRE_DESCARGA_REGISTRO = 'registro-fotografico.html';
export const URL_DATOS_REGISTRO = `${API_BASE}/registro-fotografico`;

// Línea de la plantilla que se reemplaza por la base.
export const MARCA_DATOS = 'window.DATOS_EP = null; /*DATOS_EP*/';

// Devuelve el enlace para abrir la herramienta en el navegador, indicándole dónde está la API si es del mismo
// sitio.
export function enlaceRegistro(apiBase = API_BASE) {
  const mismoSitio = apiBase.startsWith('/') && !apiBase.startsWith('//') && !apiBase.startsWith('/\\');
  return mismoSitio ?`${ARCHIVO_REGISTRO}?api=${encodeURIComponent(apiBase)}` : ARCHIVO_REGISTRO;
}

// Devuelve una copia de la plantilla con la base incrustada; el JSON va dentro de un script y se escapan el
// símbolo menor que y los separadores de línea para que ningún nombre pueda cerrar la etiqueta.
export function incrustarDatos(plantilla, datos) {
  if (!String(plantilla).includes(MARCA_DATOS)) {
    throw new Error('La plantilla del registro fotográfico no tiene la marca de datos.');
  }
  const base = {
    gestores: Array.isArray(datos?.gestores) ? datos.gestores : [],
    ups: datos?.ups && typeof datos.ups === 'object' ? datos.ups : {},
  };
  const json = JSON.stringify(base)
    .replaceAll('<', '\\u003c')
    .replaceAll(String.fromCharCode(0x2028), '\\u2028')
    .replaceAll(String.fromCharCode(0x2029), '\\u2029');
  return String(plantilla).replace(MARCA_DATOS, () => `window.DATOS_EP = ${json};`);
}
