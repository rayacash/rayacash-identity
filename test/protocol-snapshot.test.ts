// La librería contra test/protocol.snapshot.json, el registro del protocolo v1 que
// habla la página alojada de Raya. Corre siempre, también en el CI de este repo, donde
// no está la web y parity.test.ts se saltea: si la librería cambia el protocolo, falla
// acá. parity.test.ts compara la web con el mismo archivo. Un cambio de protocolo se
// hace en los dos lados y en el snapshot, a propósito: v1/ en el CDN y las 1.x
// instaladas por npm siguen hablando este.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildClose,
  buildInit,
  COMPLETED_STATUSES,
  createNonce,
  EMBED_QUERY,
  FALLBACK_REASONS,
  FRAME_TYPES,
  IDENTITY_PATH,
  PARENT_TYPES,
  PROTOCOL_VERSION,
  readFrameMessage,
  SOURCE,
  STEPS,
  TOKEN_RE,
} from "./_src.ts";
import { SNAPSHOT } from "./_snapshot.ts";

const FRAME = { frame: true };
const { id, nonce, origin } = SNAPSHOT.sample;

describe("el protocolo v1 es el del snapshot", () => {
  test("las constantes, en el mismo orden", () => {
    assert.deepEqual(
      {
        source: SOURCE,
        version: PROTOCOL_VERSION,
        frameTypes: [...FRAME_TYPES],
        parentTypes: [...PARENT_TYPES],
        steps: [...STEPS],
        completed: [...COMPLETED_STATUSES],
        fallbacks: [...FALLBACK_REASONS],
        tokenRe: TOKEN_RE.source,
        identityPath: IDENTITY_PATH,
        embedQuery: EMBED_QUERY,
      },
      SNAPSHOT.constants,
    );
  });

  test("lo que la librería le manda al iframe: init y close", () => {
    const [init, close] = SNAPSHOT.parent;
    assert.deepEqual(buildInit(id, nonce), init?.message);
    assert.deepEqual(buildClose(id, nonce), close?.message);
  });

  test("cada mensaje del iframe se lee como registra el snapshot", () => {
    for (const item of SNAPSHOT.frame) {
      const read = readFrameMessage({ origin, source: FRAME, data: item.message }, { origin, frame: FRAME, id, nonce });
      assert.deepEqual(read, item.read, JSON.stringify(item.message));
    }
  });

  test("el snapshot cubre cada tipo, paso, estado y motivo", () => {
    const seen = (key: string) => SNAPSHOT.frame.flatMap((item) => (item.extra && item.extra[key] !== undefined ? [item.extra[key]] : []));
    assert.deepEqual([...new Set(SNAPSHOT.frame.map((item) => item.type))].sort(), [...FRAME_TYPES].sort());
    assert.deepEqual(seen("step"), [...STEPS]);
    assert.deepEqual(seen("status"), [...COMPLETED_STATUSES]);
    assert.deepEqual(seen("reason"), [...FALLBACK_REASONS]);
  });

  test("createNonce cumple la regex del iframe", () => {
    const nonceRe = new RegExp(SNAPSHOT.nonceRe);
    for (let i = 0; i < 100; i++) assert.match(createNonce(), nonceRe);
    assert.match(createNonce(null), nonceRe);
  });

  test("la URL del iframe y la de la pestaña nueva", () => {
    assert.equal(origin + IDENTITY_PATH + id + EMBED_QUERY, SNAPSHOT.hosted.frameUrl);
    assert.equal(origin + IDENTITY_PATH + id, SNAPSHOT.hosted.topUrl);
    assert.equal(SNAPSHOT.hosted.isHostedPath, true);
  });
});
