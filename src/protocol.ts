// Protocolo postMessage v1, lado de la página que embebe. La otra mitad es
// utils/identityEmbed.ts de la web; test/parity.test.ts compara las dos listas.
// Por acá no pasa ningún dato personal: ids, pasos y estados.

import type { IdentityFallbackReason, IdentityHintStatus } from "./identity.d.ts";
import { getCrypto } from "./env.ts";

export const SOURCE = "raya-identity";
export const PROTOCOL_VERSION = 1;
export const FRAME_TYPES = ["hello", "ready", "step", "completed", "fallback", "close"] as const;
export const PARENT_TYPES = ["init", "close"] as const;
export const STEPS = ["intro", "front", "back", "liveness", "processing", "done", "unavailable"] as const;
export const COMPLETED_STATUSES = ["processing", "verified", "declined"] as const;
export const FALLBACK_REASONS = ["camera_blocked", "storage_blocked", "unsupported"] as const;
export const ID_RE = /^idv_[0-9A-Za-z]{24}$/;
// step y reason: nunca texto libre.
export const TOKEN_RE = /^[a-z][a-z_]{0,31}$/;

export type FrameFallbackReason = Extract<IdentityFallbackReason, (typeof FALLBACK_REASONS)[number]>;

export interface MessageLike {
  origin: unknown;
  source: unknown;
  data: unknown;
}

export interface Expected {
  origin: string;
  frame: unknown;
  id: string;
  nonce: string;
}

export type FrameMessage =
  | { type: "hello" }
  | { type: "ready" }
  | { type: "close" }
  | { type: "step"; step: string }
  | { type: "completed"; status: IdentityHintStatus }
  | { type: "fallback"; reason: FrameFallbackReason };

export interface RandomSource {
  getRandomValues(array: Uint8Array): unknown;
}

// Objeto literal (también de otro realm, como lo que llega por postMessage).
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Object.prototype.toString.call(value) !== "[object Object]") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || Object.getPrototypeOf(proto) === null;
}

function isCompletedStatus(value: unknown): value is IdentityHintStatus {
  return typeof value === "string" && (COMPLETED_STATUSES as readonly string[]).indexOf(value) >= 0;
}

function isFallbackReason(value: string): value is FrameFallbackReason {
  return (FALLBACK_REASONS as readonly string[]).indexOf(value) >= 0;
}

// El nonce correlaciona los mensajes con este open(): no es un secreto frente a
// la página que embebe, por eso Math.random alcanza donde no hay crypto.
export function createNonce(source: RandomSource | null | undefined = getCrypto()): string {
  const bytes = new Uint8Array(16);
  if (source) {
    source.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += ((bytes[i] as number) + 256).toString(16).slice(1);
  return out;
}

export function buildInit(id: string, nonce: string): Record<string, unknown> {
  return { source: SOURCE, v: PROTOCOL_VERSION, type: "init", id, nonce };
}

export function buildClose(id: string, nonce: string): Record<string, unknown> {
  return { source: SOURCE, v: PROTOCOL_VERSION, type: "close", id, nonce };
}

// Devuelve un objeto nuevo con las claves conocidas: lo demás que traiga el
// mensaje no llega ni al controller ni al integrador. El origen y la ventana son
// la frontera de seguridad (solo el documento cargado en nuestro iframe, mientras
// esté en el origen de Raya); id y nonce descartan un handshake viejo. Lo que no
// pasa se ignora en silencio: otros scripts de la página también postean.
export function readFrameMessage(event: MessageLike, expected: Expected): FrameMessage | null {
  // Comparación exacta: "null" nunca coincide con un origen validado.
  if (event.origin !== expected.origin) return null;
  if (expected.frame === null || expected.frame === undefined || event.source !== expected.frame) return null;
  const data = event.data;
  if (!isPlainObject(data) || data.source !== SOURCE || data.v !== PROTOCOL_VERSION) return null;
  const type = data.type;
  if (typeof type !== "string" || (FRAME_TYPES as readonly string[]).indexOf(type) < 0) return null;
  if (data.id !== expected.id) return null;
  if (type === "hello") return { type: "hello" };
  if (typeof data.nonce !== "string" || data.nonce !== expected.nonce) return null;
  if (type === "ready") return { type: "ready" };
  if (type === "close") return { type: "close" };
  if (type === "step") return typeof data.step === "string" && TOKEN_RE.test(data.step) ? { type: "step", step: data.step } : null;
  if (type === "completed") return isCompletedStatus(data.status) ? { type: "completed", status: data.status } : null;
  // fallback. Un motivo nuevo de una página más nueva no deja varada a esta versión.
  if (typeof data.reason !== "string" || !TOKEN_RE.test(data.reason)) return null;
  return { type: "fallback", reason: isFallbackReason(data.reason) ? data.reason : "unsupported" };
}
