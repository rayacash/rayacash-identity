# Changelog

Los cambios de cada versión de `rayacash-identity` (Raya Identity.js), la misma en [npm](https://www.npmjs.com/package/rayacash-identity) y en el CDN de Raya. Sigue [semver](https://semver.org/lang/es/): los cambios incompatibles solo llegan en una versión mayor (`2.0.0`), y los anotamos acá.

En el CDN, cada versión es inmutable en su carpeta (`https://js.raya.cash/identity/v1.0.0/identity.js`) y `https://js.raya.cash/identity/v1/identity.js` sirve siempre la última 1.x. Para fijar una versión con `integrity`, usá el hash que figura en su entrada.

## 1.0.0 (sin publicar)

Primera versión.

- Dos formas de cargarla, con el mismo código:
  - `npm install rayacash-identity`: ESM (`import { RayaIdentity } from "rayacash-identity"`, también por default) y CommonJS (`const { RayaIdentity } = require("rayacash-identity")`), con sus tipos de TypeScript. Sin dependencias y sin efectos al importar: sirve en código que corre en el servidor (SSR).
  - Un `<script>` desde el CDN de Raya: `<script src="https://js.raya.cash/identity/v1/identity.js"></script>` deja `RayaIdentity` en `window` (es el `dist/identity.js` del paquete, con sus tipos en `dist/identity.d.ts`). Para fijar esta versión, `v1.0.0` con su `integrity` y `crossorigin="anonymous"`.
- `RayaIdentity({ baseUrl })`: sin claves, solo orígenes de Raya o localhost.
- `identity.open(id o url, { onEvent })`: abre la verificación en una ventana sobre la página; la promesa se resuelve cuando la ventana se cierra y nunca se rechaza. Un solo flujo por página.
- Eventos `ready`, `step`, `completed` y `fallback`.
- `identity.close()`: cierra el flujo abierto de la página.
- Panel para seguir en una pestaña nueva cuando la cámara no se puede usar acá o el iframe no carga.
- CSP: `frame-src https://raya.cash` siempre, más `script-src https://js.raya.cash` con el `<script>` del CDN. Si tu sitio manda `Permissions-Policy`, `camera=(self "https://raya.cash")`.
- `integrity` de `v1.0.0/identity.js` en el CDN: se completa al subirla.
