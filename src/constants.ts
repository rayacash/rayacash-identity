// Todos los números y textos fijos de la librería. Un navegador no tiene env:
// lo que cambia entre entornos llega por la opción baseUrl.

export const DEFAULT_BASE_URL = "https://raya.cash";
export const RAYA_HOSTNAME = "raya.cash";

// La página alojada: origen + IDENTITY_PATH + id + EMBED_QUERY. El link de la
// pestaña nueva es la misma URL sin el query.
export const IDENTITY_PATH = "/identity/";
export const EMBED_QUERY = "?embed=1";

// Sin microphone: el detector de la prueba de vida no usa audio.
export const IFRAME_ALLOW = "camera; fullscreen; clipboard-write";
export const IFRAME_REFERRER_POLICY = "strict-origin";

// La página alojada repite su hello hasta los 3 s y tarda lo que tarde la red:
// a los 20 s se ofrece la pestaña nueva, sin cerrar nada (un ready tardío vuelve
// al iframe).
export const HANDSHAKE_TIMEOUT_MS = 20000;

export const Z_INDEX = "2147483647";
export const COMPACT_MAX_WIDTH = 640;
export const COMPACT_MAX_HEIGHT = 620;
export const CARD_WIDTH = 480;
export const CARD_HEIGHT = 764;
export const CARD_MARGIN = 24;
export const BAR_HEIGHT = 44;

export const SECRET_KEY_PREFIX = "raya_sk_";
export const PUBLISHABLE_KEY_PREFIX = "raya_pk_";
