// Configuración del frontend. Todo sale de la API propia (backend en Node.js y Express con PostgreSQL). Aquí
// están las direcciones de cada servicio, que son el único lugar a cambiar si la API vive en otro dominio.
// Base de la API; por defecto /api en el mismo dominio del frontend, y en desarrollo Vite la redirige al
// backend.
export const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');

export const LOGIN_URL      = `${API_BASE}/auth/login`;
export const UNIDADES_URL   = `${API_BASE}/unidades`;
export const UNIDAD_URL     = `${API_BASE}/unidades/detalle`;
export const PROVEEDORES_URL = `${API_BASE}/proveedores`;
export const UNIDAD_EDITAR_URL = `${API_BASE}/unidades/editar`;
export const GESTORES_URL   = `${API_BASE}/gestores`;
export const DOCUMENTOS_URL = `${API_BASE}/documentos`;
export const DOCUMENTO_URL  = `${API_BASE}/documentos/detalle`;

// Direcciones del cargue de datos, el histórico de la base maestra y la consulta, edición y eliminación de lo
// cargado.
export const CARGUE_URL     = `${API_BASE}/cargue`;
export const CARGUE_DOCUMENTOS_URL = `${API_BASE}/cargue/documentos`;
export const CARGUE_RIT_URL = `${API_BASE}/cargue/rit`;
export const CARGUE_DATOS_URL    = `${API_BASE}/cargue/datos`;
export const CARGUE_EDITAR_URL   = `${API_BASE}/cargue/editar`;
export const CARGUE_ELIMINAR_URL = `${API_BASE}/cargue/eliminar`;
export const CARGUE_HISTORIAL_URL         = `${API_BASE}/cargue/historial`;
export const CARGUE_HISTORIAL_CAMBIOS_URL = `${API_BASE}/cargue/historial/cambios`;
export const CARGUE_HISTORIAL_ARCHIVO_URL = `${API_BASE}/cargue/historial/archivo`;

// Direcciones de visitas, eventos, avisos y tickets.
export const VISITAS_URL          = `${API_BASE}/visitas`;
export const VISITA_URL           = `${API_BASE}/visitas`;
export const VISITA_ARCHIVO_URL   = `${API_BASE}/visitas/archivo`;
export const VISITA_FORMATOS_URL  = `${API_BASE}/visitas/formatos`;
export const EVENTOS_URL          = `${API_BASE}/eventos`;
export const EVENTO_URL           = `${API_BASE}/eventos`;
export const EVENTO_RESPUESTA_URL = `${API_BASE}/eventos/respuesta`;
export const AVISOS_URL           = `${API_BASE}/avisos`;
export const AVISO_LECTURA_URL    = `${API_BASE}/avisos/lectura`;
export const TICKETS_URL          = `${API_BASE}/tickets`;
export const TICKET_GESTION_URL   = `${API_BASE}/tickets/gestion`;

// Direcciones de la lista de compras y el cronograma de entregas.
export const ITEMS_UPS_URL       = `${API_BASE}/items-ups`;
export const ITEM_UP_URL         = `${API_BASE}/items-ups/detalle`;
export const CARGUE_COMPRAS_URL  = `${API_BASE}/cargue/compras`;
export const CARGUE_ENTREGAS_URL = `${API_BASE}/cargue/entregas`;
export const ENTREGAS_URL        = `${API_BASE}/entregas`;
export const ENTREGA_URL         = `${API_BASE}/entregas`;
export const ENTREGA_REVISION_URL = `${API_BASE}/entregas/revision`;
export const ENTREGA_ACTA_URL    = `${API_BASE}/entregas/acta`;
export const ESTADOS_ENTREGA_URL = `${API_BASE}/estados-entrega`;

export const CONFIG_URL = `${API_BASE}/config`;

export const ACTIVIDAD_URL = `${API_BASE}/actividad`;

export const REVISION_ENTREGAS_URL = `${API_BASE}/revision-entregas`;
export const REVISION_ENTREGA_URL  = `${API_BASE}/revision-entregas`;
export const REVISION_ARCHIVO_URL  = `${API_BASE}/revision-entregas/archivo`;

// Texto con el que los generadores rellenaban las celdas vacías; es un marcador y no un dato, y los adaptadores
// lo convierten en vacío.
export const SIN_DATOS = 'Sin datos asignados';

// Visor de archivos del PDF del carrito, los soportes de entrega y los formatos de visitas; exige sesión.
export const VISOR_API_URL = `${API_BASE}/archivos`;

export const VISOR_ID_KEYS = ['unidad_doc', 'integrante_doc_inicial', 'codigo_iniciativa'];

// Validador de documentos de entrega, que recibe peticiones multipart con una acción.
export const VALIDADOR_API_URL = `${API_BASE}/validador`;

// Enlace de la aplicación externa del carrito, definido en frontend/.env con VITE_CARRITO_URL; si está vacío,
// el enlace no se muestra.
export const CARRITO_URL = import.meta.env.VITE_CARRITO_URL || '';

// Campo por el que se cruza la unidad con su documentación.
export const AUDIT_JOIN_KEY = 'ID_unico';

export const CACHE_DURATION = 15 * 60 * 1000;
// Tiempo máximo de espera de una petición, 15 minutos.
export const FETCH_TIMEOUT = 50000;
