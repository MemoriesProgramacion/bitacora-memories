// Ayudas de la agenda: fechas, colores y teléfonos. Las semanas empiezan el lunes, como en Colombia. Las fechas
// se manejan en hora local del navegador y al servidor viajan en ISO.
import { Phone, MapPin, Users } from 'lucide-react';

export const DIAS_CORTOS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

export const TIPOS = {
  llamada: { texto: 'Llamada', icono: Phone },
  visita: { texto: 'Visita', icono: MapPin },
  reunion: { texto: 'Reunión', icono: Users },
};

// Nombre y color de cada estado de cita; los fondos son translúcidos para que sirvan en modo claro y oscuro.
export const ESTADOS = {
  agendada: { texto: 'Agendada', tono: 'neutro', borde: 'var(--graf-azul)', fondo: 'rgba(61, 90, 153, 0.16)' },
  realizada: { texto: 'Realizada', tono: 'ok', borde: 'var(--color-ok)', fondo: 'rgba(56, 161, 105, 0.16)' },
  no_contesto: { texto: 'No contestó', tono: 'alerta', borde: 'var(--color-acento)', fondo: 'rgba(245, 164, 136, 0.18)' },
  cancelada: { texto: 'Cancelada', tono: 'error', borde: 'var(--color-rojo)', fondo: 'rgba(229, 62, 62, 0.12)' },
};

export const MOTIVOS = ['Primera llamada', 'Seguimiento', 'Confirmar visita', 'Confirmar entrega', 'Taller', 'Revisar documentos'];

export const DURACIONES = [15, 30, 45, 60, 90, 120];

// Devuelve el inicio del día de una fecha.
export const inicioDeDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const sumarDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const sumarMeses = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
export const mismoDia = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// Devuelve el lunes de la semana de una fecha.
export function inicioSemana(d) {
  const dia = (d.getDay() + 6) % 7;
  return inicioDeDia(sumarDias(d, -dia));
}

const dos = (n) => String(n).padStart(2, '0');

// Devuelve la fecha en hora local como 2026-11-03, que sirve de clave para agrupar por día.
export const claveDia = (d) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
export const claveHora = (d) => `${dos(d.getHours())}:${dos(d.getMinutes())}`;

export const horaTexto = (d) => d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
// Devuelve la hora sin a. m. ni p. m., para los bloques angostos del calendario.
export const horaCorta = (d) => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
// Pone la primera letra en mayúscula, porque el navegador entrega el día y el mes en minúscula.
const mayuscula = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const fechaLarga = (d) => mayuscula(d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }));
export const mesAnio = (d) => mayuscula(d.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }));

// Devuelve el título del rango que se está viendo.
export function titulo(vista, fecha) {
  if (vista === 'dia') return fechaLarga(fecha);
  if (vista === 'semana') {
    const a = inicioSemana(fecha);
    const b = sumarDias(a, 6);
    const mesA = a.toLocaleDateString('es-CO', { month: 'short' });
    const mesB = b.toLocaleDateString('es-CO', { month: 'short' });
    return mesA === mesB
      ? `${a.getDate()} – ${b.getDate()} de ${mesB} ${b.getFullYear()}`
      : `${a.getDate()} ${mesA} – ${b.getDate()} ${mesB} ${b.getFullYear()}`;
  }
  return mesAnio(fecha);
}

// Convierte una cita del servidor con sus fechas ya convertidas.
export function normalizar(c) {
  const ini = new Date(c.inicio);
  return { ...c, ini, fin: new Date(ini.getTime() + (c.duracion_min || 30) * 60_000) };
}

// Devuelve la próxima hora en punto, para proponerla al crear una cita.
export function proximaHora(desde = new Date()) {
  const d = new Date(desde);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

export const enlaceTel = (t) => `tel:${String(t).replace(/[^\d+]/g, '')}`;

// Devuelve el teléfono con espacios, como 310 123 4567, para quien llama.
export function telefonoLegible(t) {
  const s = String(t || '').replace(/\D/g, '');
  return s.length === 10 ? `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6)}` : String(t || '');
}

// Devuelve el nombre del representante a partir de una fila de la lista de iniciativas.
export const representante = (r) => [r.integrante_nombre1, r.integrante_nombre2, r.integrante_apellido1, r.integrante_apellido2]
  .filter(Boolean).join(' ');

// Acomoda las citas que se cruzan en una misma columna del día y devuelve cada cita con su columna y cuántas
// columnas tiene su grupo.
export function distribuir(citas) {
  const orden = [...citas].sort((a, b) => a.ini - b.ini || b.fin - a.fin);
  const salida = [];
  let grupo = [];
  let finGrupo = 0;

  const cerrar = () => {
    const columnas = [];
    const puestas = grupo.map((c) => {
      let col = columnas.findIndex((fin) => fin <= c.ini);
      if (col === -1) { col = columnas.length; columnas.push(0); }
      columnas[col] = c.fin;
      return { cita: c, col };
    });
    puestas.forEach((p) => salida.push({ ...p, columnas: columnas.length }));
    grupo = [];
  };

  for (const c of orden) {
    if (grupo.length && c.ini.getTime() >= finGrupo) cerrar();
    grupo.push(c);
    finGrupo = Math.max(finGrupo, c.fin.getTime());
  }
  if (grupo.length) cerrar();
  return salida;
}
