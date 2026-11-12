// Versión de la librería. build.mjs la inyecta desde package.json (define
// __RAYA_VERSION__); sin build (tests con --experimental-strip-types) queda
// "0.0.0-dev".
declare const __RAYA_VERSION__: string | undefined;

export const VERSION: string = typeof __RAYA_VERSION__ === "string" ? __RAYA_VERSION__ : "0.0.0-dev";
