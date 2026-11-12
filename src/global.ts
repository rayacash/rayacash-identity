// Entrada IIFE (dist/identity.js, el que se sube al CDN de Raya para cargarlo con un
// <script>, sin bundler): deja RayaIdentity en window. Si el script se carga dos
// veces se queda el primero; con otra versión, avisa.

import RayaIdentity from "./index.ts";
import { getWindow, warn } from "./env.ts";

const win = getWindow();
if (win) {
  const existing: unknown = win.RayaIdentity;
  // Solo cuenta como otra copia algo con pinta de la librería (una función con su
  // versión). Cualquier otra cosa se pisa: con <div id="RayaIdentity">,
  // window.RayaIdentity es ese elemento (named access del HTML).
  const version = typeof existing === "function" ? (existing as Function & { version?: unknown }).version : undefined;
  if (typeof version !== "string") {
    win.RayaIdentity = RayaIdentity;
  } else if (existing !== RayaIdentity && version !== RayaIdentity.version) {
    warn("Raya Identity: la página ya cargó la v" + version + "; se usa esa y se ignora la v" + RayaIdentity.version + ". Cargá el script una sola vez.");
  }
}
