// Crea la aplicación Express: aplica cabeceras de seguridad, monta las rutas de acceso, administración,
// inventario y Bitácora, y sirve el frontend compilado.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { config } from './config.js';
import { HttpError } from './errores.js';
import { ErrorNegocio, error } from './inventario/util.js';
import rutas from './rutas.js';
import accesoRutas from './acceso/rutas.js';
import admin from './acceso/admin.js';
import { cargarSesion, protegerCsrf } from './acceso/sesiones.js';
import { limitador } from './acceso/limites.js';
import inventario from './inventario/rutas/inventario.js';
import bodegas from './inventario/rutas/bodegas.js';
import kits from './inventario/rutas/kits.js';
import entregasKits from './inventario/rutas/entregasKits.js';
import pedidos from './inventario/rutas/pedidos.js';
import ordenes, { evidencias } from './inventario/rutas/ordenes.js';
import codigos from './inventario/rutas/codigos.js';

const TURNSTILE = 'https://challenges.cloudflare.com';
// Política de contenido de la aplicación: solo recursos del mismo sitio y sin scripts en línea.
const CSP_APP = [
  "default-src 'self'",
  `script-src 'self' ${TURNSTILE}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  `frame-src 'self' blob: ${TURNSTILE}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(config.cookieSecure ? ['upgrade-insecure-requests'] : []),
].join('; ');

const CSP_API = "default-src 'none'; frame-ancestors 'none'";

// Política de la herramienta de registro fotográfico, que es un HTML autocontenido con scripts propios.
const CSP_HERRAMIENTAS = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(config.cookieSecure ? ['upgrade-insecure-requests'] : []),
].join('; ');

// Middleware que agrega las cabeceras de seguridad a todas las respuestas.
function cabecerasSeguridad(req, res, next) {
  const esArchivo = req.path.startsWith('/api/archivos');
  const esPdf = req.path.endsWith('/pdf');
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': esArchivo ? 'SAMEORIGIN' : 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'X-DNS-Prefetch-Control': 'off',
  });
  if (config.cookieSecure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (req.path.startsWith('/herramientas/')) {
    res.set('Content-Security-Policy', CSP_HERRAMIENTAS);
  } else if (!esPdf && !esArchivo) {
    res.set('Content-Security-Policy', req.path.startsWith('/api') ? CSP_API : CSP_APP);
  }
  next();
}

// Construye y devuelve la aplicación Express ya configurada.
export function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.confiarProxy) app.set('trust proxy', 1);

  app.use(cabecerasSeguridad);

  app.use(['/api/auth', '/api/admin', '/api/inv'], express.json({ limit: '100kb' }));
  app.use('/api/entregas', express.json({ limit: '16mb' }));
  app.use(express.json({ limit: '10mb' }));

  app.use('/api', (_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    next();
  });
  app.use('/api', limitador({ ventanaMs: 5 * 60_000, max: 3000, tipo: 'limite_general' }));
  app.use('/api/auth/login', limitador({
    ventanaMs: 60_000, max: 20, tipo: 'limite_login',
    mensaje: 'Demasiados intentos de ingreso. Espera un minuto.',
  }));
  app.use('/api', cargarSesion, protegerCsrf);

  app.use('/api/auth', accesoRutas);
  app.use('/api/admin', admin);

  const inv = express.Router();
  inv.use('/kits', kits);
  inv.use('/entregas-kits', entregasKits);
  inv.use('/pedidos', pedidos);
  inv.use('/ordenes', ordenes);
  inv.use('/evidencias', evidencias);
  inv.use('/codigos', codigos);
  inv.use('/', bodegas);
  inv.use('/', inventario);
  app.use('/api/inv', inv);

  app.use('/api', rutas);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada.')));

  const dist = process.env.FRONTEND_DIST
    || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
  const indexHtml = path.join(dist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(dist, {
      index: false,
      setHeaders(res, ruta) {
        res.set('Cache-Control', ruta.includes(`${path.sep}assets${path.sep}`)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache');
      },
    }));
    app.get(/^\/(?!api\/|herramientas\/|assets\/).*/, (_req, res) => {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.sendFile(indexHtml);
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof ErrorNegocio) return error(res, err.message, err.codigo, err.datos);
    let status = err instanceof HttpError ? err.status : 500;
    let mensaje = err instanceof HttpError ? err.message : 'Error interno del servidor.';
    if (err instanceof multer.MulterError) {
      status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      mensaje = err.code === 'LIMIT_FILE_SIZE' ? `El archivo supera el máximo de ${config.maxMbArchivo} MB.`
        : err.code === 'LIMIT_FILE_COUNT' ? 'Se enviaron más archivos de los permitidos en un solo envío.'
          : err.code === 'LIMIT_UNEXPECTED_FILE' ? `El campo de archivo «${err.field}» no se esperaba o trae más archivos de los permitidos.`
            : `Error en la carga: ${err.message}`;
    } else if (err?.type === 'entity.parse.failed') {
      status = 400; mensaje = 'El cuerpo de la petición no es JSON válido.';
    } else if (err?.type === 'entity.too.large') {
      status = 413; mensaje = 'La petición es demasiado grande.';
    }
    if (status >= 500) console.error(`[api] ${req.method} ${req.originalUrl}`, err);
    if (res.headersSent) return res.end();
    if (req.originalUrl.startsWith('/api/validador')) {
      return res.status(status).json({ exito: false, mensaje });
    }
    return res.status(status).json({ ok: false, error: mensaje });
  });

  return app;
}
