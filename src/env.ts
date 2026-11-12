// Acceso perezoso al entorno del navegador: nada se lee al importar, así el
// build ESM se puede importar durante el render del servidor (SSR).

export function getWindow(): Window | undefined {
  return typeof window !== "undefined" ? window : undefined;
}

export function getDocument(): Document | undefined {
  return typeof document !== "undefined" ? document : undefined;
}

export function getCrypto(): Crypto | undefined {
  return typeof crypto !== "undefined" ? crypto : undefined;
}

export function warn(message: string): void {
  if (typeof console !== "undefined" && typeof console.warn === "function") console.warn(message);
}

export function logError(message: string, error: unknown): void {
  if (typeof console !== "undefined" && typeof console.error === "function") console.error(message, error);
}

// Un onEvent del integrador que tira una excepción no corta el flujo: se vuelve
// a tirar fuera del handler, así aparece en la consola y en window.onerror. Los
// tests lo reemplazan.
export const hooks = {
  reportError(error: unknown): void {
    setTimeout(() => {
      throw error;
    }, 0);
  },
};
