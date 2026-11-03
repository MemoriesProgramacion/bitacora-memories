# Frontend — Bitácora Memories (React + Vite + Tailwind CSS)

```bash
cp .env.example .env
npm install
npm run dev      # http://localhost:5173 — /api se redirige al backend (vite.config.js)
npm run build    # compila a dist/ (el backend lo sirve en producción)
```

## Configuración

Todo vive en `src/lib/config.js` y en `.env`:

- `VITE_API_URL` — base de la API. Vacía = `/api` en el mismo dominio.
- `VITE_API_PROXY` — backend al que Vite reenvía `/api` en desarrollo.
- `VITE_CARRITO_URL` — enlace a la aplicación del carrito (sección Capitalización).

## Estructura

```
src/
  lib/          config, API (fetchApi, urlArchivo), adaptadores y lógica de negocio
  hooks/        sesión única (cookie + token CSRF) y carga de datos
  components/   marco de la app (fondo animado, cabecera, pestañas), login, ficha de UP, visor de PDF
  sections/     Bitácora, Visitas, Eventos, Novedades, Entregas, Cargue de datos
  inventario/   módulo de inventario: páginas, componentes de interfaz y cliente de /api/inv
  admin/        consola del Coordinador general: usuarios, accesos, sesiones y cambios de clave
public/
  herramientas/ generador de registro fotográfico (HTML independiente)
```

## Roles

El login es único y el servidor decide qué módulos abre cada rol. Los de
Bitácora (abajo) entran a la Bitácora; `admin` y `bodeguero` (Profesional de logística y compra) solo al inventario
(el profesional de logística y compra ve Recepción y Kit UP); el `superadmin` ve Bitácora, Inventario y
Administración, y cambia de uno a otro desde las pastillas de la cabecera.

El login es único y el servidor decide qué módulos abre cada rol. Los de
Bitácora (abajo) entran a la Bitácora; `admin` y `bodeguero` (Profesional de logística y compra) solo al inventario
(el profesional de logística y compra ve Recepción y Kit UP); el **Coordinador general** (`superadmin`) ve
Bitácora, Inventario y Administración, y cambia de uno a otro desde las pastillas
de la cabecera.

- **Coordinador general** (`superadmin`) — ve todo, de todo el territorio, y administra usuarios.
- **Coordinador regional** (`coordinador`) — todas las pestañas de la Bitácora (menos
  Cargue de datos), sin inventario, pero solo con lo de su región, departamento,
  modalidad y nodo: el servidor le entrega únicamente eso.
- **Técnico administrativo** (`tecnico_administrativo`) — lo mismo que el Coordinador regional
  (mismo territorio) pero solo consulta: sin Visitas, sin crear ni editar nada; el servidor
  rechaza cualquier escritura.
- **Coordinador de compras** — solo Entregas.
- **Profesional de seguimiento e información** (`coordinador_datos`) — Bitácora, Cargue de datos
  (sube la BASE MASTER) y Datos cargados (ver, modificar y eliminar lo que cargó, unidad por unidad).
- **Gestor** — usuario = su nodo, contraseña = su cédula (o la clave que se le
  asigne). Solo ve las unidades de su nodo; el servidor lo hace cumplir.
