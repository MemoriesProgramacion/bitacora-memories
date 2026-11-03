// Historial de cambios. El servidor guarda cada escritura en actividad como módulo.acción con quién, cuándo y
// los campos cambiados como antes y después. Aquí se traduce a lo que se lee en el historial de la unidad y en
// la actividad de la consola.
// Nombre del módulo de cada prefijo de acción, que es el primer tramo de módulo.acción.
export const MODULOS = {
  unidad: 'Datos de la unidad', up: 'Unidad en el programa', asociados: 'Asociados', diagnostico: 'Diagnóstico',
  evaluacion: 'Evaluación de salida', visitas: 'Visitas', agenda: 'Agenda', talleres: 'Talleres', carrito: 'Plan de capitalización',
  comite: 'Comité', compras: 'Compras', entrega: 'Entregas', factura: 'Facturas', inventario: 'Inventario', kit: 'Kits',
  kit_defectuoso: 'Elementos defectuosos', kit_novedad: 'Novedades de kits', alistamiento: 'Alistamiento', revision: 'Revisión de entregas', validador: 'Validador', cargue: 'Cargues',
  archivos: 'Archivos', soporte: 'Expediente', caso: 'Casos de éxito', comercial: 'Gestión comercial', novedades: 'Novedades',
  tickets: 'Tickets', eventos: 'Eventos', avisos: 'Avisos', metas: 'Metas', informe: 'Informes', kokan: 'KOKAN',
  config: 'Configuración', catalogo: 'Catálogo', proveedores: 'Proveedores',
};

// Nombre de las acciones más frecuentes; las demás se nombran con su módulo.
export const ACCIONES = {
  'compras.guardar': 'Compras y logística',
  'entrega.contacto': 'Datos de contacto',
  'entrega.confirmar': 'Entrega confirmada',
  'entrega.solicitar_reagendamiento': 'Reagendamiento solicitado',
  'entrega.acta_aprobar': 'Acta de reagendamiento aprobada',
  'entrega.acta_rechazar': 'Acta de reagendamiento rechazada',
  'unidad.editar': 'Datos de la unidad editados',
  'carrito.linea': 'Activo del plan', 'carrito.estado': 'Cambio de estado del plan', 'carrito.plan_negocio': 'Plan de negocio',
  'carrito.cotizacion': 'Cotización agregada', 'carrito.cotizacion_elegir': 'Cotización elegida', 'carrito.cotizacion_quitar': 'Cotización quitada',
  'carrito.firma': 'Plan firmado', 'carrito.viabilidad': 'Viabilidad de la interventoría', 'carrito.ficha_tecnica': 'Ficha técnica',
  'carrito.ficha_aprobada': 'Ficha técnica aprobada', 'carrito.recomendaciones': 'Recomendaciones de uso', 'carrito.acta_recibido': 'Acta de recibido',
  'caso.registrar': 'Caso de éxito registrado', 'comercial.registrar': 'Gestión comercial registrada', 'soporte.verificar': 'Soporte verificado',
};

// Devuelve el prefijo de la acción, por ejemplo carrito de carrito.estado.
export const prefijoDe = (accion) => String(accion || '').split('.')[0];

// Devuelve el nombre del módulo de la acción, por ejemplo Plan de capitalización.
export function moduloDe(accion) {
  const p = prefijoDe(accion);
  return MODULOS[p] || (p ? p.charAt(0).toUpperCase() + p.slice(1).replace(/_/g, ' ') : 'Otro');
}

// Devuelve el nombre de la acción para mostrar: el conocido o el módulo con el resto.
export function nombreAccion(accion) {
  if (ACCIONES[accion]) return ACCIONES[accion];
  const resto = String(accion || '').split('.').slice(1).join(' ').replace(/_/g, ' ');
  return resto ? `${moduloDe(accion)} · ${resto}` : moduloDe(accion);
}

// Nombre con tildes y eñes de las claves internas más frecuentes de los cambios.
export const ETIQUETAS = {
  lote: 'Del cargue masivo n.º', tamano: 'Tamaño', justificacion: 'Justificación', observacion: 'Observación', observaciones: 'Observaciones',
  descripcion: 'Descripción', numero: 'Número', retirada_dps: 'Retirada por el DPS', telefono: 'Teléfono', direccion: 'Dirección',
  region: 'Región', categoria: 'Categoría', categoria_label: 'Categoría', tipo_label: 'Tipo', codigo: 'Código',
  codigo_barras: 'Código de barras', codigo_proveedor: 'Código del proveedor', unspsc: 'Código UNSPSC', proveedor_id: 'Proveedor',
  principal_id: 'Bodega principal', coordinador_sub: 'Coordinador', duracion_min: 'Duración (minutos)', id_unico: 'ID único',
  modulo: 'Módulo', sesion: 'Sesión', minimo: 'Mínimo', tipologia: 'Tipología', iva: 'IVA', no_financiable: 'No financiable',
  fecha_lectura: 'Fecha de lectura', fecha_visita: 'Fecha de la visita', tipo_visita: 'Tipo de visita', comite: 'Comité',
  capacitacion: 'Capacitación', fecha_instalacion: 'Fecha de instalación', aviso_coordinacion: 'Aviso a la coordinación',
  articulos: 'Artículos', lineas: 'Líneas', reemplaza_a: 'Reemplaza a', correo_gestor: 'Correo del gestor', email: 'Correo',
  valor_unitario: 'Valor unitario', fecha_despacho: 'Fecha de despacho', aprobada_por: 'Aprobada por', es_representante: 'Representante',
  sin_cambios: 'Sin cambios', no_encontrados: 'No encontrados', invalidos: 'Inválidos', cedula: 'Cédula', n: 'Cantidad',
  ids: 'Identificadores', seccion: 'Sección', titulo: 'Título', ubicacion: 'Ubicación', despues: 'Después',
};

// Devuelve el nombre legible de un campo sin etiqueta propia, por ejemplo fecha_entrega pasa a Fecha entrega.
export const nombreCampo = (k) => {
  if (Object.prototype.hasOwnProperty.call(ETIQUETAS, k)) return ETIQUETAS[k];
  const t = String(k).replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

// Devuelve un valor del historial como texto corto.
export function valorTexto(v) {
  if (v === null || v === undefined || v === '') return '(vacío)';
  if (v === true) return 'Sí';
  if (v === false) return 'No';
  if (Array.isArray(v)) return v.length ? v.map(valorTexto).join(', ') : '(vacío)';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// Claves que algunas filas viejas guardan fuera de los campos como par antes y después.
export const PARES_SUELTOS = [
  'habilitada', 'activos', 'documentado', 'estado', 'total', 'metas', 'nodo', 'precio', 'justificacion', 'reporte', 'verificado',
  'retirada_dps', 'cantidad', 'unspsc',
];
// Claves que guardan un objeto antes y otro después, que se comparan campo a campo.
export const PARES_DE_OBJETOS = ['cambios'];

const MAX_TEXTO = 300;
const corto = (v) => valorTexto(v).slice(0, MAX_TEXTO);
const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Devuelve las diferencias campo a campo entre dos objetos; los que no son objetos cuentan como vacíos.
export function compararObjetos(antes, despues) {
  const a = esObjeto(antes) ? antes : {};
  const d = esObjeto(despues) ? despues : {};
  const claves = [...new Set([...Object.keys(a), ...Object.keys(d)])];
  return claves.filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(d[k] ?? null))
    .map((k) => ({ campo: nombreCampo(k), antes: corto(a[k] ?? null), despues: corto(d[k] ?? null), conAntes: true }));
}

// Devuelve las filas campo, antes y después de los cambios sin etiqueta propia, y los datos sueltos que no son
// campos.
export function filasGenericas(cambios = {}, { conocidos = {}, omitir = [] } = {}) {
  const out = [];
  Object.entries(cambios.campos || {}).forEach(([k, par]) => {
    if (conocidos[k]) return;
    if (Array.isArray(par) && par.length === 2) out.push({ campo: nombreCampo(k), antes: corto(par[0]), despues: corto(par[1]), conAntes: true });
    else out.push({ campo: nombreCampo(k), despues: corto(par) });
  });
  const comparaAntesDespues = ['antes', 'despues'].every((k) => k in cambios && !omitir.includes(k))
    && [cambios.antes, cambios.despues].every((v) => v === null || esObjeto(v));
  if (comparaAntesDespues) out.push(...compararObjetos(cambios.antes, cambios.despues));
  Object.entries(cambios).forEach(([k, v]) => {
    if (k === 'campos' || omitir.includes(k)) return;
    if (comparaAntesDespues && (k === 'antes' || k === 'despues')) return;
    if (PARES_SUELTOS.includes(k) && Array.isArray(v) && v.length === 2) {
      out.push({ campo: nombreCampo(k), antes: corto(v[0]), despues: corto(v[1]), conAntes: true });
    } else if (PARES_DE_OBJETOS.includes(k) && Array.isArray(v) && v.length === 2 && v.every((x) => x === null || esObjeto(x))) {
      out.push(...compararObjetos(v[0], v[1]));
    } else if (esObjeto(v)) {
      Object.entries(v).forEach(([sub, x]) => out.push({ campo: `${nombreCampo(k)} · ${nombreCampo(sub)}`, despues: corto(x) }));
    } else {
      out.push({ campo: nombreCampo(k), despues: corto(v) });
    }
  });
  return out;
}
