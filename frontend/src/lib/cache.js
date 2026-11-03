// Caché local en IndexedDB. Es un respaldo: si falla, la aplicación sigue funcionando. Los datos vencidos no se
// descartan sino que se marcan como stale para usarlos si la red falla.
import { CACHE_DURATION } from './config';

const DB_NAME = 'bitacora_db';
const DB_STORE = 'cache';

function openDB() {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB bloqueada'));
  });
}

function withTimeout(p, ms, fallback) {
  return Promise.race([
    p,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// Devuelve los datos, su momento y si están vencidos, o null.
export function getCached(key = 'beneficiarios') {
  return withTimeout(getCachedRaw(key), 3000, null);
}

function getCachedRaw(key) {
  return openDB()
    .then((db) => new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => {
        const r = req.result;
        if (r && r.data && r.data.length) {
          resolve({
            data: r.data,
            time: r.time,
            stale: Date.now() - r.time >= CACHE_DURATION,
          });
        } else resolve(null);
      };
      req.onerror = () => resolve(null);
    }))
    .catch(() => null);
}

// Guarda datos en la caché.
export function setCache(data, key = 'beneficiarios') {
  return openDB()
    .then((db) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put({ data, time: Date.now() }, key);
    })
    .catch(() => {});
}

// Borra toda la caché, lo que se usa al cerrar sesión, y nunca lanza error.
export function borrarCache() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch { resolve(); }
  });
}
