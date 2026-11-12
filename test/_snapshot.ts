// test/protocol.snapshot.json: el registro del protocolo postMessage v1 tal como lo
// habla la página alojada de Raya (raya-web, utils/identityEmbed.ts). Lo leen
// protocol-snapshot.test.ts (siempre, también en el CI de este repo) y
// parity.test.ts (cuando encuentra la web al lado).

import { readFileSync } from "node:fs";

export interface ProtocolSnapshot {
  constants: {
    source: string;
    version: number;
    frameTypes: string[];
    parentTypes: string[];
    steps: string[];
    completed: string[];
    fallbacks: string[];
    tokenRe: string;
    identityPath: string;
    embedQuery: string;
  };
  nonceRe: string;
  sample: { id: string; nonce: string; origin: string; parentOrigin: string };
  parent: { message: Record<string, unknown>; read: Record<string, unknown>; context: string }[];
  frame: {
    type: string;
    nonce: string | null;
    extra: Record<string, string> | null;
    message: Record<string, unknown>;
    read: Record<string, unknown>;
  }[];
  hosted: { frameUrl: string; isHostedPath: boolean; topUrl: string };
}

export const SNAPSHOT: ProtocolSnapshot = JSON.parse(readFileSync(new URL("./protocol.snapshot.json", import.meta.url), "utf8"));
