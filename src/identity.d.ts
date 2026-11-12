/*! Raya Identity.js v__RAYA_VERSION__ | rayacash-identity | https://raya.cash */
// Tipos públicos de Raya Identity.js, escritos a mano: son la única fuente de
// verdad. El código de src/ los importa con `import type`, así que tsc avisa si
// se desalinean. build.mjs los copia con la versión a dist/identity.d.mts
// (import), dist/identity.d.cts (require) y dist/identity.d.ts (el <script>,
// con el global).

export interface RayaIdentityOptions {
  /** Origen de la página alojada. Por defecto https://raya.cash. Solo orígenes de Raya o localhost. */
  baseUrl?: string;
}

export type IdentityHintStatus = "processing" | "verified" | "declined";

/**
 * Lo que devuelve open() cuando la ventana se cierra. Es solo para la pantalla:
 * confirmá el resultado en tu servidor, con el webhook o con un GET.
 */
export type IdentityResult =
  | { status: "completed"; verification: { id: string; status: IdentityHintStatus } }
  | { status: "closed"; verification: { id: string; status: null } };

/** En qué parte del flujo está la persona. "unavailable": el link ya no se puede usar. */
export type IdentityStep = "intro" | "front" | "back" | "liveness" | "processing" | "done" | "unavailable" | (string & {});

export type IdentityFallbackReason = "timeout" | "frame_blocked" | "camera_blocked" | "storage_blocked" | "unsupported";

export interface IdentityVerificationHint {
  id: string;
  status: IdentityHintStatus | null;
}

export type IdentityEvent =
  | { type: "ready"; verification: IdentityVerificationHint }
  | { type: "step"; step: IdentityStep; verification: IdentityVerificationHint }
  | { type: "completed"; verification: { id: string; status: IdentityHintStatus } }
  | { type: "fallback"; reason: IdentityFallbackReason; verification: IdentityVerificationHint };

export interface IdentityOpenOptions {
  /** Avisa cómo avanza el flujo. Una excepción acá no corta el flujo. */
  onEvent?: ((event: IdentityEvent) => void) | null;
}

export interface RayaIdentityInstance {
  /**
   * Abre la verificación en una ventana sobre la página. Recibe el id ("idv_…")
   * o la url que devolvió la API. La promesa se resuelve cuando la ventana se
   * cierra y nunca se rechaza. Hay un solo flujo por página: abrir la misma
   * verificación dos veces devuelve la misma promesa.
   */
  open(verification: string, options?: IdentityOpenOptions): Promise<IdentityResult>;
  /** Cierra el flujo abierto en la página. Sin flujo abierto, no hace nada. */
  close(): void;
  readonly version: string;
}

export interface IntegrationError extends Error {
  name: "IntegrationError";
}

export interface IntegrationErrorConstructor {
  new (message: string): IntegrationError;
  readonly prototype: IntegrationError;
}

export interface RayaIdentityStatic {
  (options?: RayaIdentityOptions): RayaIdentityInstance;
  new (options?: RayaIdentityOptions): RayaIdentityInstance;
  readonly version: string;
  /** Lo que tira Raya Identity.js ante un error de programación. */
  readonly IntegrationError: IntegrationErrorConstructor;
}

declare const RayaIdentity: RayaIdentityStatic;
export default RayaIdentity;
export { RayaIdentity };

declare global {
  interface Window {
    RayaIdentity?: RayaIdentityStatic;
  }
}
