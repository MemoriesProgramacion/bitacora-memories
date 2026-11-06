# Backend — API de la Bitácora (Node.js + Express + PostgreSQL)

API REST de la Bitácora. Ver el README de la raíz para la
puesta en marcha completa.

```
backend/
├── db/schema.sql            Esquema relacional (traducción de crespoespin.sql a PostgreSQL + tablas nuevas)
├── scripts/
│   ├── migrar.js            npm run db:migrar  [--demo]
│   ├── crear-coordinador.js npm run usuario:crear -- <usuario> <clave> "<nombre>" [rol] [cedula] [--region=..] [--departamento=..] [--modalidad=..] [--nodo=..]
│   ├── crear-superadmin.js  npm run superadmin:crear -- <usuario> ["<nombre>"] [clave]
│   ├── importar-inventario.js  npm run inventario:importar (copia una base antigua de Smart Inventory)
│   ├── importar-catalogo.js    npm run catalogo:importar -- productos.js [--simular]
├── src/
│   ├── server.js            Punto de entrada
│   ├── app.js               Express: cabeceras de seguridad, sesión, CSRF, errores, sirve frontend/dist
│   ├── rutas.js             Rutas de la Bitácora (/api)
│   ├── rutasEncuentrosTic.js Entregas de encuentros de Niñas, Mujeres y Alfabetizadores TIC (/api/encuentros-tic)
│   ├── config.js            Variables de entorno (.env)
│   ├── db.js                Pool de PostgreSQL y transacciones (esquema public)
│   ├── auth.js              Acceso a la Bitácora por sesión + roles
│   ├── acceso/              Login único, sesiones, CSRF, límites y consola del Coordinador general (superadmin)
│   ├── inventario/          Módulo de inventario: rutas /api/inv, PDF, códigos y su esquema
│   └── servicios/           Lógica de la Bitácora (una función por endpoint)
├── storage/                 Archivos subidos (se crea solo; fuera de git)
└── test/                    Pruebas con node:test contra una base real
```

Dependencias de ejecución: `express`, `pg`, `multer`, `exceljs`, `pdfkit`, `bwip-js` y `nodemailer` (Node 20 o más).

## Pruebas

Las pruebas borran y recrean la base: se niegan a correr si su nombre no contiene `test`.

```bash
DATABASE_URL=postgres://usuario:clave@localhost:5432/bitacora_test TURNSTILE_SECRET_KEY= npm test
npm run test:cobertura   # lo mismo con cobertura y pisos (líneas 95 %, ramas 80 %, funciones 93 %); exige Node 22.8 o más
npm run carga            # prueba de carga con 6.334 unidades en una base cuyo nombre contenga «carga» y «test»
```

Las tablas de acceso (`superadmins`, `sesiones_app`, `intentos_login`,
`eventos_seguridad`, `auditoria_claves`) y las del inventario (esquema
`inventario`) se crean solas al arrancar el servidor.

## Tablas

Del esquema original (`crespoespin.sql`): `triadas`, `gestores`,
`coordinadores`, `representantes`, `unidades_productivas`, `expedientes_up`,
`etapas`, `expediente_etapas`, `ciudadanos`, `tipos_documento`,
`ciudadano_documentos`, `catalogo_productos`, `producto_especificaciones`,
`proveedores`, `carritos`, `carrito_productos`, `carrito_cotizaciones` y las
vistas `vw_unidades_productivas` y `vw_avance_expedientes`.

Añadidas para lo que el esquema original no cubría: `archivos` (antes Blob
Storage), `visitas`, `eventos` + `evento_destinatarios`, `novedades` +
`novedad_destinatarios`, `listas_compra` + `lista_compra_items`, `entregas` +
`entrega_reagendamientos`.

Entregas de encuentros TIC (se crean solas al arrancar, en `src/servicios/esquema.js`):
`encuentros_tic_grupos` (los tres grupos fijos, uno por programa),
`encuentros_tic_archivos` (consentimientos y los cuatro entregables de cada
encuentro, guardados en la base) y `encuentros_tic_entregados` (encuentros ya
guardados en la carpeta de evidencias, que quedan cerrados).

Columnas añadidas a tablas existentes: `gestores.clave_hash`,
`coordinadores.cedula`, `coordinadores.correo`, `ciudadanos.cedula`,
`ciudadanos.correo_gestor`. `coordinadores.tipo` es el rol de la sesión (`coordinador` = Coordinador local regional,
`coordinador_datos` = Profesional de seguimiento e información); en el Coordinador local regional,
`coordinadores.region/departamento/modalidad/nodo` son su territorio (ver `src/alcance.js`).
