# Raya Identity.js

Sumá la verificación de identidad de Raya a tu sitio: Identity.js la abre en una ventana sobre tu página, te avisa cómo avanza y te devuelve el control cuando la persona termina. Sin claves en el navegador.

```bash
npm install rayacash-identity
```

```js
import { RayaIdentity } from "rayacash-identity";

const identity = RayaIdentity();
const result = await identity.open(id); // el id que te devolvió tu servidor
```

O, sin bundler, con un `<script>` desde el CDN de Raya:

```html
<script src="https://js.raya.cash/identity/v1/identity.js"></script>
<script>
  RayaIdentity().open(id); // el id que te devolvió tu servidor
</script>
```

> El resultado que ves en el navegador es solo para la pantalla: confirmalo siempre en tu servidor, con el webhook o con un GET.

Versión 1.0.0. Los cambios de cada versión están en [CHANGELOG.md](CHANGELOG.md). La guía completa de Identidad, con la API y los webhooks, está en https://raya.cash/api/identity.

## Contenido

- [Antes de empezar](#antes-de-empezar)
- [Instalación](#instalación)
- [Con un `<script>` (CDN)](#con-un-script-cdn)
- [Inicio rápido](#inicio-rápido)
- [Frameworks](#frameworks)
- [Content-Security-Policy y Permissions-Policy](#content-security-policy-y-permissions-policy)
- [Seguridad](#seguridad)
- [Referencia](#referencia)
- [Cuando no se puede usar la cámara en tu página](#cuando-no-se-puede-usar-la-cámara-en-tu-página)
- [Errores](#errores)
- [Navegadores y SSR](#navegadores-y-ssr)
- [Preguntas frecuentes](#preguntas-frecuentes)
- [Versionado](#versionado)
- [Demo](#demo)
- [Desarrollo](#desarrollo)

## Antes de empezar

1. **La verificación se crea en tu servidor**, con tu clave secreta, o en el dashboard. Con el SDK `rayacash` 1.2.0 o más nuevo (Node.js, Python o PHP):

   ```js
   import { RayaClient } from "rayacash";

   const client = new RayaClient(process.env.RAYA_SECRET_KEY);
   const verification = await client.identity.verifications.create({
     type: "document",
     external_reference: "cliente-8812",
   });
   // A tu página mandale solo verification.id.
   ```

   Lo mismo con cURL, Python y PHP: https://raya.cash/api/identity.

2. **Recibí el resultado en tu servidor**: creá un endpoint de webhooks para los eventos `identity.verification.*`.
3. **Tu página tiene que estar en https.** `http://localhost` funciona para desarrollar.
4. Sumá el viewport, si no lo tenés: `<meta name="viewport" content="width=device-width, initial-scale=1">`.

## Instalación

```bash
npm install rayacash-identity
# o
pnpm add rayacash-identity
# o
yarn add rayacash-identity
```

No tiene dependencias. Trae ESM y CommonJS, los dos con sus tipos de TypeScript:

```js
import { RayaIdentity } from "rayacash-identity"; // también: import RayaIdentity from "rayacash-identity"
// const { RayaIdentity } = require("rayacash-identity"); // CommonJS
```

Importarlo no tiene efectos: no toca la página ni `window`, así que se puede importar en código que también corre en el servidor (SSR). `open()` se llama solo en el navegador. Si tu sitio no usa bundler, cargalo con un `<script>` desde el CDN de Raya: [Con un `<script>` (CDN)](#con-un-script-cdn).

## Con un `<script>` (CDN)

Sin bundler, cargá Identity.js desde el CDN de Raya. Deja `RayaIdentity` en `window`:

```html
<button id="verificar" type="button">Verificar mi identidad</button>

<script src="https://js.raya.cash/identity/v1/identity.js"></script>
<script>
  const identity = RayaIdentity();
  document.querySelector("#verificar").addEventListener("click", async () => {
    // Tu servidor crea la verificación y te devuelve el id.
    const response = await fetch("/api/crear-verificacion", { method: "POST" });
    const { id } = await response.json();
    const result = await identity.open(id);
  });
</script>
```

- Es el mismo código que el paquete de npm (el `dist/identity.js` de cada versión, sin cambios): la [referencia](#referencia), los eventos y los [errores](#errores) valen igual, sin el `import`.
- Tu `<script>` va después del botón (por ejemplo, al final del `<body>`): busca `#verificar` apenas corre, y en el `<head>` todavía no existe.
- `v1` sirve siempre la última 1.x: te llegan los arreglos sin tocar nada y nunca un cambio incompatible (eso sería `v2`). No le pongas `integrity` a esa URL: el archivo cambia con cada 1.x y el navegador lo bloquearía.
- Para fijar una versión exacta, cambiá `v1` por `v1.0.0` y sumá su `integrity`, el hash que publica el [CHANGELOG](CHANGELOG.md) para esa versión, con `crossorigin="anonymous"`. El navegador corre el archivo solo si es exactamente ese:

  ```html
  <script
    src="https://js.raya.cash/identity/v1.0.0/identity.js"
    integrity="sha384-…"
    crossorigin="anonymous"
  ></script>
  ```

  Con una versión fija no te llegan los arreglos: para actualizar, cambiá la versión de la URL y el hash.
- Cargalo una sola vez. Si la página lo carga dos veces, se queda el primero; si el segundo es otra versión, lo ignora y avisa en la consola.
- Usá una sola de las dos formas en cada página: el `<script>` y el paquete de npm son dos copias de la librería y no se ven entre sí.
- Si tu sitio manda una CSP, sumá el CDN a `script-src` (ver [Content-Security-Policy y Permissions-Policy](#content-security-policy-y-permissions-policy)). Sin `'unsafe-inline'`, un `<script>` inline como el de arriba no corre: poné ese código en un archivo de tu sitio o dale el nonce de tu página.
- Si monitoreás los errores de la página (`window.onerror` o una herramienta de errores), sumá `crossorigin="anonymous"` también al `<script>` de `v1`, sin `integrity`: sin eso, el navegador te los muestra como «Script error.», sin el mensaje. El CDN manda `Access-Control-Allow-Origin: *`.
- Cargalo siempre desde `js.raya.cash`, nunca desde un CDN de terceros que sirva paquetes de npm.
- Los tipos del global están en `identity.d.ts`, en la misma carpeta del CDN y en `dist/` del paquete. `identity.debug.js` es lo mismo sin minificar, para depurar.

## Inicio rápido

```js
import { RayaIdentity } from "rayacash-identity";

const identity = RayaIdentity();
document.querySelector("#verificar").addEventListener("click", async () => {
  // Tu servidor crea la verificación y te devuelve el id.
  const response = await fetch("/api/crear-verificacion", { method: "POST" });
  const { id } = await response.json();
  const result = await identity.open(id, {
    onEvent(event) {
      if (event.type === "step") console.log("Paso:", event.step);
    },
  });
  if (result.status === "completed") {
    // La persona terminó: mostrá "estamos revisando" y esperá el webhook.
  } else {
    // La ventana se cerró sin que este navegador viera el final: consultá el estado en tu
    // servidor. Si no terminó, puede retomar con el mismo id.
  }
});
```

`result` es solo para la pantalla. Lo que vale es lo que ve tu servidor: el webhook (`identity.verification.verified` o `identity.verification.declined`) o un GET a la verificación (`client.identity.verifications.retrieve(id)`).

## Frameworks

### React y Next.js

En el App Router de Next.js, el componente que abre la verificación lleva `"use client"`. Llamá a `open()` en un evento, como el clic de un botón, o en un `useEffect`: nunca durante el render.

```jsx
"use client";

import { RayaIdentity } from "rayacash-identity";
import { useEffect, useState } from "react";

const identity = RayaIdentity();

export function VerificarIdentidad() {
  const [mensaje, setMensaje] = useState("");

  // Si la persona se va de la página con la ventana abierta, se cierra.
  useEffect(() => () => identity.close(), []);

  async function verificar() {
    const response = await fetch("/api/crear-verificacion", { method: "POST" });
    const { id } = await response.json();
    const result = await identity.open(id);
    if (result.status === "completed") setMensaje("Estamos revisando tus datos.");
  }

  return (
    <>
      <button type="button" onClick={verificar}>
        Verificar mi identidad
      </button>
      <p>{mensaje}</p>
    </>
  );
}
```

Crear la instancia afuera del componente es seguro también en el servidor: `RayaIdentity()` no toca la página.

### Vue y Nuxt

Abrí la verificación en `onMounted` (o en un evento, como el clic de un botón): en Nuxt, el `setup` también corre en el servidor, y ahí `open()` tira un error. No hace falta `<ClientOnly>` ni un plugin `.client`, porque importar la librería no tiene efectos.

```vue
<script setup>
import { RayaIdentity } from "rayacash-identity";
import { onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps({ verificationId: { type: String, required: true } });
const mensaje = ref("");
const identity = RayaIdentity();

onMounted(async () => {
  const result = await identity.open(props.verificationId);
  mensaje.value = result.status === "completed" ? "Estamos revisando tus datos." : "Podés retomar la verificación más tarde.";
});
onBeforeUnmount(() => identity.close());
</script>

<template>
  <p>{{ mensaje }}</p>
</template>
```

## Content-Security-Policy y Permissions-Policy

Si tu sitio manda una CSP, dejá enmarcar el origen de Raya, con npm o con el `<script>`:

```
frame-src https://raya.cash;
```

Con el `<script>` del CDN, sumá también el CDN a `script-src`, junto a lo que ya tenga (como `'self'`):

```
script-src 'self' https://js.raya.cash;
```

Con npm, Identity.js va adentro de tu bundle: `script-src` no cambia.

Con esa CSP, el código de tu página no puede ir en un `<script>` inline como el de [Con un `<script>` (CDN)](#con-un-script-cdn): ponelo en un archivo de tu sitio, que cubre `'self'`, o dale al `<script>` inline el nonce de tu página (`script-src 'self' 'nonce-…' https://js.raya.cash`).

- Sin `frame-src`, el navegador usa `child-src` o `default-src`; sin `script-src`, `default-src`: sumá la directiva o agregá el origen ahí. Si pasás otro origen de Raya en `baseUrl`, sumalo también a `frame-src`.
- Si tu `script-src` usa `'strict-dynamic'`, la lista de hosts no cuenta: poné el nonce de tu página en el `<script>` de Identity.js.
- La ventana no necesita `unsafe-inline`: arma sus estilos sin elementos `<style>`.
- Si la CSP bloquea el iframe, la ventana ofrece al instante seguir en una pestaña nueva (ver [Cuando no se puede usar la cámara en tu página](#cuando-no-se-puede-usar-la-cámara-en-tu-página)).

Si tu sitio manda `Permissions-Policy`, habilitá la cámara para Raya:

```
Permissions-Policy: camera=(self "https://raya.cash")
```

Si tu página vive adentro de otro iframe, ese iframe necesita `allow="camera"`.

## Seguridad

- El resultado que devuelve la librería es solo para la pantalla: lo que vale es el webhook o un GET desde tu servidor.
- Ningún dato personal cruza la ventana: los datos de la persona los pedís desde tu servidor, con un GET a la verificación. El webhook te avisa cuando la verificación termina (`verified`, `declined`, `expired` o `canceled`), con `person` en `null`.
- Nunca pongas la clave secreta en el navegador: vive en tu servidor, con el SDK `rayacash`. `RayaIdentity()` no usa ninguna clave, tampoco la pública.
- El `id` abre la verificación para quien lo tenga: dáselo solo a la persona que tiene que verificarse.
- La librería solo enmarca orígenes de Raya (`raya.cash` y sus subdominios, en https) o localhost, para desarrollar. El origen sale de `baseUrl`, nunca de la URL que le pases.
- Instalala con npm o cargala con el `<script>` de `js.raya.cash`, nunca desde un CDN de terceros. Con una versión fija y su `integrity`, el navegador solo corre ese archivo exacto.

## Referencia

### `RayaIdentity(options?)`

Crea una instancia, con o sin `new`. No hace ningún pedido ni toca la página.

| Opción | Tipo | Descripción |
|---|---|---|
| `baseUrl` | `string` | Origen de la página alojada. Por defecto `https://raya.cash`. Tiene que ser `raya.cash` o un subdominio, en https, o localhost. Solo el origen: sin ruta, query ni hash. |

### `identity.open(verification, options?)`

Abre la ventana y carga la verificación. `verification` es el `id` (`idv_…`) o la `url` que devolvió la API, del mismo origen que `baseUrl`.

| Opción | Tipo | Descripción |
|---|---|---|
| `onEvent` | `(event) => void` | Avisa cómo avanza. Una excepción acá no corta el flujo. |

Devuelve una promesa que se resuelve **cuando la ventana se cierra**, nunca antes, y que nunca se rechaza. Los errores de programación tiran un `IntegrationError` sincrónico.

| `result.status` | `result.verification` | Qué significa |
|---|---|---|
| `completed` | `{ id, status: "processing" \| "verified" \| "declined" }` | La persona terminó. `status` es el último estado que vio la ventana. |
| `closed` | `{ id, status: null }` | La ventana se cerró sin que este navegador viera el final. |

Con `completed` la ventana no se cierra sola: la persona ve la pantalla final y aprieta «Cerrar». Si querés recuperar el control enseguida, llamá a `identity.close()` dentro de `onEvent` cuando llegue `completed`. Si la persona siguió en una pestaña nueva, en cambio, la ventana se cierra sola cuando llega `completed`.

Hay un solo flujo por página: abrir la misma verificación dos veces devuelve la misma promesa (un doble clic no abre dos ventanas); abrir otra mientras hay una abierta tira un `IntegrationError`. Cerrar no cancela la verificación: si se vuelve a abrir el mismo `id` en la misma pestaña, sigue donde estaba (si el navegador no deja guardar datos en el iframe, como Chrome en incógnito, la captura vuelve a empezar).

Mientras la persona está sacando las fotos o haciendo la prueba de vida, la X pregunta antes de salir (también `Escape`, si el foco está en la barra de la ventana). `identity.close()` cierra siempre de una.

### `identity.close()`

Cierra el flujo abierto en la página, lo haya abierto la instancia que sea. Sin flujo abierto, no hace nada.

### Eventos

Cada evento es un objeto congelado con `verification: { id, status }`.

| `event.type` | Campos | Cuándo |
|---|---|---|
| `ready` | | La página cargó adentro de la ventana. Una vez por flujo. |
| `step` | `step` | Cambió el paso: `intro`, `front`, `back`, `liveness`, `processing`, `done` o `unavailable` (el link ya no se puede usar). |
| `completed` | | La persona terminó. Puede llegar dos veces: `processing` y después `verified` o `declined`. |
| `fallback` | `reason` | No se puede seguir acá y se ofrece una pestaña nueva: `timeout`, `frame_blocked`, `camera_blocked`, `storage_blocked` o `unsupported`. |

### `RayaIdentity.version` y `RayaIdentity.IntegrationError`

La versión de la librería y la clase de los errores de programación.

### TypeScript

Los tipos vienen en el paquete: `identity.d.mts` para `import`, `identity.d.cts` para `require` e `identity.d.ts` para el `<script>` (con el global). Además de `RayaIdentity`, exporta los tipos `RayaIdentityOptions`, `RayaIdentityInstance`, `RayaIdentityStatic`, `IdentityOpenOptions`, `IdentityResult`, `IdentityEvent`, `IdentityStep`, `IdentityFallbackReason`, `IdentityHintStatus`, `IdentityVerificationHint`, `IntegrationError` e `IntegrationErrorConstructor`.

```ts
import { RayaIdentity, type IdentityEvent, type IdentityResult } from "rayacash-identity";
```

## Cuando no se puede usar la cámara en tu página

Hay sitios donde la verificación no puede correr embebida: una política que bloquea la cámara o el iframe, un navegador sin almacenamiento o el navegador interno de una app. En esos casos la ventana ofrece abrir la verificación en una pestaña nueva y la de tu sitio queda esperando.

`closed` no quiere decir que no se verificó: si la persona siguió en otra pestaña, pudo haber terminado. Consultá el estado desde tu servidor. Cuando la persona termina en la otra pestaña, lo más común es que el estado que llega acá sea `processing`: confirmá el resultado en tu servidor.

En apps híbridas y WebViews (Capacitor, por ejemplo), abrí `verification.url` en el navegador del sistema: los esquemas propios no pueden embeber la verificación.

## Errores

Todos son `IntegrationError` y se tiran sincrónicos: para reconocerlos, `error instanceof RayaIdentity.IntegrationError` (o `error.name === "IntegrationError"`). Ninguno repite el id, la URL ni la clave que recibió.

| Mensaje (empieza con `Raya Identity:`) | Qué hacer |
|---|---|
| `RayaIdentity() no lleva clave…` | Sacá la clave. Si era la secreta y quedó publicada, rotala en Developers › API Keys. |
| `… no acepta la opción "x"…` | Revisá el nombre de la opción. |
| `… las opciones tienen que ser un objeto.` | Pasá un objeto, o nada. |
| `baseUrl …` | Usá un origen de Raya en https, o localhost. |
| `open espera el id de la verificación…` | Pasá un string. |
| `el id de la verificación no tiene el formato esperado…` | Pasá el `id` o la `url` que devolvió la API. |
| `la url de la verificación es de otro origen que baseUrl…` | Pasá el `id`, o la `url` tal como la devolvió la API. |
| `la url de la verificación no tiene la forma esperada…` | Pasá la `url` sin cambios, sin query ni hash. |
| `open: onEvent tiene que ser una función.` | Pasá una función, o nada. |
| `open necesita un navegador…` | Llamalo en el cliente (`onMounted`, `useEffect`, un clic), no durante el render del servidor. |
| `open necesita el <body> de la página…` | Llamalo después de que cargue, por ejemplo en el clic de un botón. |
| `ya hay una verificación abierta en esta página…` | Cerrala con `close()` antes de abrir otra. |

## Navegadores y SSR

La librería funciona en Chrome 66+, Edge 79+, Firefox 60+ y Safari 12+ (sale compilada a ES2017); los pasos con cámara necesitan un navegador actual. Importarla, con `import` o con `require`, no tiene efectos: se puede importar en el servidor durante el SSR. `open()` se llama solo en el navegador.

Si `body` tiene un `transform`, `filter` o `contain`, la ventana se posiciona respecto de `body` y puede quedar corrida.

## Preguntas frecuentes

**¿Puedo no usar la librería?** Sí: llevá a la persona a `verification.url` en la misma pestaña y usá `return_url` para que vuelva.

**¿npm o el `<script>`?** Si tu sitio usa un bundler (Vite, webpack, Next.js, Nuxt), npm: la versión queda en tu `package.json`, con los tipos, y tu CSP solo suma el iframe. Si no, el `<script>` de `js.raya.cash` ([Con un `<script>` (CDN)](#con-un-script-cdn)). Es el mismo código.

**¿Necesito el SDK `rayacash` en el navegador?** No. `rayacash` va en tu servidor, con la clave secreta; en el navegador solo va `rayacash-identity`, que no usa claves.

**¿Puedo escribir el iframe a mano?** No está soportado: el protocolo entre la ventana y la página es interno y puede cambiar.

**¿Cómo sé el resultado?** Con el webhook o con un GET a la verificación desde tu servidor.

**¿Puedo cambiar cómo se ve?** Sí, en Dashboard › Identidad › Diseño. El marco de la ventana es neutro y no se personaliza.

**¿Funciona en un sitio http?** Solo en `localhost` o `127.0.0.1`. Desarrollo local: usá `localhost` / `127.0.0.1` o https; desde un host de tu red local por http el iframe queda bloqueado y solo vas a ver el panel de la pestaña nueva.

**¿Tiene tipos de TypeScript?** Sí, vienen en el paquete: tu editor los encuentra solo (ver [TypeScript](#typescript)).

## Versionado

- Sigue [semver](https://semver.org/lang/es/): los cambios incompatibles solo llegan en una versión mayor (`2.0.0`). Las menores (`1.1.0`) suman cosas sin romper nada y las de parche (`1.0.1`) corrigen errores. Todo queda anotado en el [CHANGELOG](CHANGELOG.md).
- Con npm, dejá el rango `^1` que guarda `npm install` (`"rayacash-identity": "^1.0.0"`): recibís las correcciones y las novedades de la 1.x sin cambios incompatibles.
- Con el `<script>`, `v1` es siempre la última 1.x. Cada versión exacta (`v1.0.0`) es inmutable en el CDN: sus bytes y su `integrity` no cambian nunca.

## Demo

`npm run demo` y abrí `http://127.0.0.1:5051/demo/` (el puerto cambia con `IDENTITY_JS_DEMO_PORT`). Sirve una página de prueba y una página alojada falsa que habla el protocolo real, en `localhost`, otro sitio que `127.0.0.1`, así que los chequeos de origen corren de verdad.

| Página | Para qué |
|---|---|
| `/demo/` | Controles y log de eventos. Con `?min` carga el archivo minificado. |
| `/demo/csp.html` | CSP estricta sin `unsafe-inline`: la ventana tiene que verse igual. |
| `/demo/csp-blocked.html` | `frame-src 'none'`: el panel tiene que aparecer al instante. |
| `/demo/nested.html` | La demo adentro de un iframe sin `allow`. |

Escenarios de la página falsa: `ok`, `declined`, `camera`, `storage`, `unsupported`, `unavailable`, `silent`, `slow`, `reload` y `hostile`. El entorno de producción pide confirmación: una verificación aprobada se cobra.

## Desarrollo

Necesita Node.js 22.6 o más nuevo (los tests corren el TypeScript sin compilar).

```bash
npm ci                 # dependencias de desarrollo (no hay de runtime)
npm test               # tests con node:test y un DOM falso: nunca abren un navegador ni van a la red
npm run typecheck      # tsc de src/ y de src/ + test/
npm run build          # dist/ y sus chequeos
npm run check          # typecheck, tests y build
npm run check:package  # build, publint y attw: el paquete con import, require y sus tipos
npm run demo           # build, watch y la demo
```

| `dist/` | Qué es |
|---|---|
| `identity.mjs` + `identity.d.mts` | ESM minificado (`import`), sin efectos al importar. |
| `identity.cjs` + `identity.d.cts` | CommonJS minificado (`require`), sin efectos. |
| `identity.js` + `identity.d.ts` | IIFE minificado: el que se sirve en el CDN para el `<script>`. Deja `RayaIdentity` en `window`. |
| `identity.debug.js` (+ `.map`) | El IIFE sin minificar. |

El build usa el esbuild y el TypeScript de las dependencias de desarrollo y falla si: `dist/` no es ASCII, el smoke test de `identity.js` (`node:vm`, sin `document`), de `identity.mjs` (`import`) o de `identity.cjs` (`require`) no pasa, cargar los módulos o crear una instancia lee `window` o `document`, los tipos no compilan (`<script>`, `import` y `require`), `identity.js` supera 8 KB en gzip, o el CHANGELOG ya anotó un `integrity` para esta versión y no es el de estos archivos. Al final imprime el `<script>` del CDN: el de `v1` y el de la versión exacta con su `integrity`. El banner no lleva fecha: el mismo código da los mismos bytes y el mismo `integrity`.

**Tests.** Viven en `test/` y corren con `npm test`: `node:test` y un DOM falso que tira si el código usa `innerHTML`, `fetch`, storage o `window.open`. `test/protocol-snapshot.test.ts` compara el protocolo con `test/protocol.snapshot.json`, el registro de lo que habla la página alojada de Raya, y corre siempre. `test/parity.test.ts` compara además ese registro con el código de la página alojada, que no es público: si no lo encuentra, se saltea. Un cambio de protocolo se hace en los dos lados y en el snapshot.

**Publicar una versión:** subila con `npm version patch|minor|major --no-git-tag-version`, actualizá el CHANGELOG con el `integrity` que imprime el build, corré `npm run check`, `npm run check:package` y `node build.mjs --release` (falla si la entrada todavía dice «sin publicar» o no anota el `integrity` de `identity.js`), subí el mismo `dist/` al CDN (en `vX.Y.Z/`, que nunca se pisa, y en `v1/`, con cache corto) y verificá que las dos carpetas den ese `integrity` y respondan `Access-Control-Allow-Origin: *` (sin ese header, la versión fija con `crossorigin` no carga). Recién ahí creá un release `vX.Y.Z` en GitHub: el workflow `release.yml` corre los chequeos, también `--release`, y publica en npm con Trusted Publishing. La primera versión se publica a mano con `npm publish`, porque npm no deja configurar Trusted Publishing en un paquete que todavía no existe (ver el comentario de `release.yml`); el workflow de ese release la saltea porque ya está en npm.

---

Guía de Identidad: https://raya.cash/api/identity · Soporte: soporte@raya.cash

Raya Cash S.A
