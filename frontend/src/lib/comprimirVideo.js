// Compresión de video en el navegador con WebCodecs y Mediabunny. Los videos de celular pesan entre 60 y 130 MB
// por minuto; antes de subirlos se recodifican a MP4 H.264 720p, de unos 10 a 12 MB por minuto. Nunca bloquea
// al usuario: si el navegador no puede, se sube el original.
// Lado largo máximo del video de salida, 720p.
const LADO_MAX = 1280;
const VIDEO_BPS = 1_500_000;
const AUDIO_BPS = 96_000;
// Si el original ya viene por debajo de esta tasa de bits no se toca, porque recodificarlo ahorraría poco y
// gastaría batería y tiempo.
const BPS_YA_LIVIANO = 2_500_000;
// Ahorro mínimo que debe lograr el resultado para reemplazar al original.
const AHORRO_MINIMO = 0.9;

// Tope del archivo original que se intenta comprimir, para que un celular no se quede sin memoria; el tope real
// de subida se aplica después.
export const MAX_VIDEO_ENTRADA_MB = 1500;

const EXT_VIDEO = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.3gp', '.m4v'];

export function esArchivoVideo(file) {
  if (!file) return false;
  const nombre = (file.name || '').toLowerCase();
  return (file.type || '').startsWith('video/') || EXT_VIDEO.some((e) => nombre.endsWith(e));
}

export class CompresionCancelada extends Error {
  constructor() { super('Compresión cancelada'); this.name = 'CompresionCancelada'; }
}

// Hace la comprobación barata de si el navegador tiene WebCodecs; aun así puede fallar con un códec raro.
export function hayWebCodecs() {
  return typeof window !== 'undefined' &&
    typeof window.VideoEncoder === 'function' &&
    typeof window.VideoDecoder === 'function';
}

let mbPromesa = null;
function cargarMediabunny() {
  if (!mbPromesa) mbPromesa = import('mediabunny');
  return mbPromesa;
}

// Duración máxima de todo video que se sube, revisada antes de optimizar para no hacer esperar la conversión de
// uno que se va a rechazar.
export const MAX_VIDEO_SEG = 180;

// Lee la duración en segundos de un video local con el reproductor del navegador; devuelve NaN si no puede leer
// el códec.
export function leerDuracionVideo(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    const fin = (d) => { URL.revokeObjectURL(url); resolve(d); };
    v.preload = 'metadata';
    v.onloadedmetadata = () => fin(v.duration);
    v.onerror = () => fin(NaN);
    setTimeout(() => fin(NaN), 10000);
    v.src = url;
  });
}

// Lee la duración del contenedor con Mediabunny sin decodificar, así sirve también con HEVC; si no reconoce el
// formato, prueba con el reproductor.
export async function duracionVideo(file) {
  let input = null;
  try {
    const mb = await cargarMediabunny();
    input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    if (await input.canRead()) {
      const dur = (await input.getDurationFromMetadata()) || (await input.computeDuration());
      if (Number.isFinite(dur) && dur > 0) return dur;
    }
  } catch { } finally {
    input?.dispose?.();
  }
  return leerDuracionVideo(file);
}

// Devuelve vacío si el video dura hasta el máximo, o el mensaje de error; si no se puede leer la duración no se
// bloquea.
export async function validarDuracionMaxima(file, nombre) {
  const dur = await duracionVideo(file);
  if (!Number.isFinite(dur) || Math.round(dur) <= MAX_VIDEO_SEG) return '';
  const m = Math.floor(Math.round(dur) / 60);
  const s = String(Math.round(dur) % 60).padStart(2, '0');
  return `"${nombre}" dura ${m}:${s} y el máximo es ${MAX_VIDEO_SEG / 60} minutos. ` +
    'Recórtalo y vuelve a seleccionarlo.';
}

// Evita que el celular apague la pantalla a mitad de la conversión, porque el navegador suspendería la pestaña.
async function pedirPantallaActiva() {
  try { return await navigator.wakeLock?.request('screen'); } catch { return null; }
}

// Calcula las dimensiones de salida: lado largo hasta el máximo y valores pares, que exige H.264.
function dimensiones(ancho, alto) {
  const escala = Math.min(1, LADO_MAX / Math.max(ancho, alto));
  const par = (n) => Math.max(2, Math.round((n * escala) / 2) * 2);
  return { width: par(ancho), height: par(alto) };
}

function nombreMp4(nombre) {
  const base = (nombre || 'video').replace(/\.[^.]+$/, '');
  return `${base}.mp4`;
}

// Comprime el video y devuelve el archivo, si se comprimió, el tamaño antes y después y el motivo; el archivo
// es el MP4 nuevo o el original si no convenía o no se pudo.
export async function comprimirVideo(file, { onProgreso, signal } = {}) {
  const antes = file.size;
  const original = (motivo) => {
    console.info('[bitacora][video] se sube el original:', motivo);
    return { archivo: file, comprimido: false, antes, despues: antes, motivo };
  };

  if (!hayWebCodecs()) return original('Este navegador no permite optimizar el video.');
  if (antes > MAX_VIDEO_ENTRADA_MB * 1024 * 1024) {
    return original(`El video supera ${MAX_VIDEO_ENTRADA_MB} MB y no se puede optimizar en el navegador.`);
  }
  if (signal?.aborted) throw new CompresionCancelada();

  const t0 = performance.now();
  let input = null;
  let conversion = null;
  let wakeLock = null;
  const alAbortar = () => { conversion?.cancel(); };

  try {
    const mb = await cargarMediabunny();
    input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    if (!(await input.canRead())) return original('No se reconoce el formato del video.');

    const pista = await input.getPrimaryVideoTrack();
    if (!pista) return original('El archivo no tiene pista de video.');

    const dur = (await input.getDurationFromMetadata()) || (await input.computeDuration());
    if (dur > 0 && (antes * 8) / dur < BPS_YA_LIVIANO) {
      return original('El video ya es liviano.');
    }

    const salida = dimensiones(pista.displayWidth, pista.displayHeight);
    if (!(await mb.canEncodeVideo('avc', { ...salida, bitrate: VIDEO_BPS }))) {
      return original('Este navegador no puede codificar H.264.');
    }
    const codecAudio = await mb.getFirstEncodableAudioCodec(['aac', 'opus'], { bitrate: AUDIO_BPS });

    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new mb.BufferTarget(),
    });
    conversion = await mb.Conversion.init({
      input,
      output,
      tracks: 'primary',
      video: {
        ...salida,
        fit: 'contain',
        codec: 'avc',
        quality: new mb.Quality({ bitrate: VIDEO_BPS }),
        forceTranscode: true,
      },
      audio: codecAudio
        ? { codec: codecAudio, quality: new mb.Quality({ bitrate: AUDIO_BPS }) }
        : { discard: true },
      showWarnings: false,
    });
    const conVideo = conversion.utilizedTracks.some((t) => t.isVideoTrack());
    if (!conversion.isValid || !conVideo) {
      const motivos = conversion.discardedTracks.map((d) => d.reason).join(', ');
      console.warn('[bitacora][video] conversión no válida:', motivos);
      return original('Este navegador no puede leer el formato del video; se subirá el original.');
    }

    if (onProgreso) conversion.onProgress = (p) => onProgreso(Math.min(1, p));
    signal?.addEventListener('abort', alAbortar, { once: true });
    wakeLock = await pedirPantallaActiva();
    await conversion.execute();

    const buffer = output.target.buffer;
    const despues = buffer?.byteLength || 0;
    console.info('[bitacora][video]', {
      antes, despues, seg: Math.round(dur), ms: Math.round(performance.now() - t0),
      salida, audio: codecAudio || 'sin audio',
    });
    if (!despues || despues > antes * AHORRO_MINIMO) {
      return original('Optimizarlo no reducía el peso.');
    }
    const archivo = new File([buffer], nombreMp4(file.name), {
      type: 'video/mp4', lastModified: file.lastModified,
    });
    return { archivo, comprimido: true, antes, despues, motivo: '' };
  } catch (e) {
    if (signal?.aborted || e?.name === 'ConversionCanceledError') throw new CompresionCancelada();
    console.warn('[bitacora][video] no se pudo comprimir, se usa el original:', e);
    return original('No se pudo optimizar el video; se subirá el original.');
  } finally {
    signal?.removeEventListener('abort', alAbortar);
    wakeLock?.release?.().catch(() => {});
    input?.dispose?.();
  }
}
