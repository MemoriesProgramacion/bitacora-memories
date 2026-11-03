// Errores HTTP de la aplicación. Las respuestas de error siguen el formato { ok: false, error } con el código
// HTTP correspondiente.
// Error con código HTTP que el manejador de errores convierte en respuesta JSON.
export class HttpError extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

// Crea un error 401.
export const noAutorizado = (m = 'Sesión no válida o vencida.') => new HttpError(401, m);
// Crea un error 403.
export const prohibido = (m = 'No tienes permiso para esta acción.') => new HttpError(403, m);
// Crea un error 404.
export const noEncontrado = (m = 'No encontrado.') => new HttpError(404, m);
// Crea un error 400.
export const solicitudInvalida = (m = 'Solicitud inválida.') => new HttpError(400, m);
