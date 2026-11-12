// Validación de lo que recibe la librería. Un tipo incorrecto o un valor con otra
// forma es un error de programación: IntegrationError, sincrónico. Ningún mensaje
// repite un id, una URL ni una clave.

import { DEFAULT_BASE_URL, PUBLISHABLE_KEY_PREFIX, RAYA_HOSTNAME, SECRET_KEY_PREFIX } from "./constants.ts";
import { integrationError } from "./errors.ts";
import type { IdentityOpenOptions } from "./identity.d.ts";
import { ID_RE, isPlainObject } from "./protocol.ts";

const VERIFICATION_PATH_RE = /^\/identity\/(idv_[0-9A-Za-z]{24})$/;

function quote(name: string): string {
  return JSON.stringify(name.length > 40 ? name.slice(0, 40) + "…" : name);
}

function list(names: readonly string[]): string {
  if (names.length < 2) return names.join("");
  return names.slice(0, -1).join(", ") + " y " + names[names.length - 1];
}

// undefined o null = sin opciones; un nombre desconocido tira (un typo como
// `baseURL` no se ignora en silencio).
function readOptions(value: unknown, allowed: readonly string[], where: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) throw integrationError(`${where}: las opciones tienen que ser un objeto.`);
  for (const key of Object.keys(value)) {
    if (allowed.indexOf(key) < 0) {
      const valid = allowed.length === 1 ? `La única opción válida es ${list(allowed)}.` : `Las opciones válidas son ${list(allowed)}.`;
      throw integrationError(`${where} no acepta la opción ${quote(key)}. ${valid}`);
    }
  }
  return value;
}

export function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || /\.localhost$/.test(host);
}

// El parser de URL ya pasó el host a minúsculas; un punto final no se acepta.
export function isRayaHostname(hostname: string): boolean {
  return hostname === RAYA_HOSTNAME || hostname.slice(-(RAYA_HOSTNAME.length + 1)) === "." + RAYA_HOSTNAME;
}

// baseUrl -> origen. El iframe se crea con la cámara delegada: un origen
// cualquiera es una libertad que nadie necesita.
export function validateBaseUrl(value: unknown): string {
  if (typeof value !== "string") throw integrationError('baseUrl tiene que ser un string, como "https://raya.cash".');
  const invalid = "baseUrl no es una URL válida: usá un origen como https://raya.cash.";
  // El parser recorta espacios y descarta tabs: lo crudo se mira antes.
  if (/[\s\x00-\x1f\x7f\\]/.test(value)) throw integrationError(invalid);
  let url: URL;
  try {
    url = new URL(value);
  } catch (_) {
    throw integrationError(invalid);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalHostname(url.hostname))) {
    throw integrationError("baseUrl tiene que ser https (http solo para localhost).");
  }
  if (url.username || url.password) throw integrationError("baseUrl no puede llevar usuario ni contraseña.");
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash || /[?#]/.test(value)) {
    throw integrationError("baseUrl tiene que ser solo el origen, sin ruta, query ni hash: https://raya.cash.");
  }
  if (!isRayaHostname(url.hostname) && !isLocalHostname(url.hostname)) {
    throw integrationError("baseUrl tiene que ser un origen de Raya (raya.cash o un subdominio) o localhost.");
  }
  return url.origin;
}

export function validateFactoryOptions(value: unknown): { origin: string } {
  if (typeof value === "string" && (value.indexOf(SECRET_KEY_PREFIX) === 0 || value.indexOf(PUBLISHABLE_KEY_PREFIX) === 0)) {
    throw integrationError(
      "RayaIdentity() no lleva clave: la verificación se crea en tu servidor con la clave secreta, que nunca tiene que " +
        "estar en el navegador. Si la publicaste, rotala en Developers › API Keys.",
    );
  }
  const options = readOptions(value, ["baseUrl"], "RayaIdentity()");
  return { origin: options.baseUrl === undefined ? DEFAULT_BASE_URL : validateBaseUrl(options.baseUrl) };
}

// El id o la url de la API -> el id. El origen sale siempre de baseUrl, nunca de
// la URL recibida: un dato de la página no puede apuntar el iframe a otro sitio.
export function parseVerification(value: unknown, origin: string): string {
  if (typeof value !== "string") throw integrationError('open espera el id de la verificación ("idv_…") o su url, como string.');
  const text = value.trim();
  if (ID_RE.test(text)) return text;
  if (/^https?:\/\//i.test(text)) {
    const shape = "la url de la verificación no tiene la forma esperada: pasá la url que devolvió la API, sin cambios.";
    let url: URL;
    try {
      url = new URL(text);
    } catch (_) {
      throw integrationError(shape);
    }
    if (url.origin !== origin) {
      throw integrationError("la url de la verificación es de otro origen que baseUrl: pasá el id, o la url tal como la devolvió la API.");
    }
    const match = VERIFICATION_PATH_RE.exec(url.pathname);
    if (!match || url.username || url.password || url.search || url.hash || /[?#]/.test(text)) throw integrationError(shape);
    return match[1] as string;
  }
  throw integrationError('el id de la verificación no tiene el formato esperado ("idv_" y 24 letras o números). Pasá el id o la url que devolvió la API.');
}

export function validateOpenOptions(value: unknown): { onEvent: NonNullable<IdentityOpenOptions["onEvent"]> | null } {
  const options = readOptions(value, ["onEvent"], "open");
  const onEvent = options.onEvent;
  if (onEvent === undefined || onEvent === null) return { onEvent: null };
  if (typeof onEvent !== "function") throw integrationError("open: onEvent tiene que ser una función.");
  return { onEvent: onEvent as NonNullable<IdentityOpenOptions["onEvent"]> };
}
