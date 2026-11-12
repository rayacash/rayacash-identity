import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildClose, buildInit, createNonce, FRAME_TYPES, ID_RE, readFrameMessage, STEPS } from "./_src.ts";
import { ID, ORIGIN, OTHER_ID } from "./_dom.ts";

const NONCE = "0123456789abcdef0123456789abcdef";
const FRAME = { frame: true };
const EXPECTED = { origin: ORIGIN, frame: FRAME, id: ID, nonce: NONCE };

function event(data: unknown, overrides: { origin?: unknown; source?: unknown } = {}) {
  return { origin: ORIGIN, source: FRAME, data, ...overrides };
}

function frameData(type: string, extra: Record<string, unknown> = {}) {
  return { source: "raya-identity", v: 1, type, id: ID, nonce: NONCE, ...extra };
}

describe("readFrameMessage", () => {
  test("acepta los seis tipos y devuelve solo las claves documentadas", () => {
    const cases: [Record<string, unknown>, Record<string, unknown>][] = [
      [frameData("hello", { nonce: undefined }), { type: "hello" }],
      [frameData("ready"), { type: "ready" }],
      [frameData("close"), { type: "close" }],
      [frameData("step", { step: "front" }), { type: "step", step: "front" }],
      [frameData("completed", { status: "verified" }), { type: "completed", status: "verified" }],
      [frameData("fallback", { reason: "camera_blocked" }), { type: "fallback", reason: "camera_blocked" }],
    ];
    assert.equal(cases.length, FRAME_TYPES.length);
    for (const [data, expected] of cases) {
      assert.deepEqual(readFrameMessage(event({ ...data, person: { name: "x" } }), EXPECTED), expected);
    }
  });

  test("step unavailable se acepta como token", () => {
    assert.deepEqual(readFrameMessage(event(frameData("step", { step: "unavailable" })), EXPECTED), { type: "step", step: "unavailable" });
    assert.ok((STEPS as readonly string[]).includes("unavailable"));
  });

  test("un step desconocido pasa como token opaco", () => {
    assert.deepEqual(readFrameMessage(event(frameData("step", { step: "nuevo_paso" })), EXPECTED), { type: "step", step: "nuevo_paso" });
  });

  for (const origin of ["https://raya.cash.evil.com", "https://evil.com/?https://raya.cash", "https://raya.cash:444", "http://raya.cash", "null", "", 5, null, undefined]) {
    test(`origen falsificado: ${String(origin)}`, () => {
      assert.equal(readFrameMessage(event(frameData("ready"), { origin }), EXPECTED), null);
    });
  }

  test("otra ventana como source", () => {
    for (const source of [null, undefined, {}, { frame: true }, globalThis]) {
      assert.equal(readFrameMessage(event(frameData("ready"), { source }), EXPECTED), null);
    }
  });

  test("con el iframe sacado del documento (frame null) no pasa nada, ni con source null", () => {
    assert.equal(readFrameMessage(event(frameData("ready"), { source: null }), { ...EXPECTED, frame: null }), null);
    assert.equal(readFrameMessage(event(frameData("ready"), { source: undefined }), { ...EXPECTED, frame: undefined }), null);
  });

  test("data con otra forma", () => {
    class Custom {
      source = "raya-identity";
      v = 1;
      type = "ready";
      id = ID;
      nonce = NONCE;
    }
    const bad: unknown[] = [
      "hola",
      ["ready"],
      null,
      undefined,
      new Custom(),
      frameData("ready", { source: "otra" }),
      frameData("ready", { v: "1" }),
      frameData("ready", { v: 2 }),
      frameData("nuevo"),
      frameData("init"),
      frameData("ready", { type: 5 }),
    ];
    for (const data of bad) assert.equal(readFrameMessage(event(data), EXPECTED), null);
  });

  test("otro id, id en minúsculas", () => {
    assert.equal(readFrameMessage(event(frameData("ready", { id: OTHER_ID })), EXPECTED), null);
    assert.equal(readFrameMessage(event(frameData("ready", { id: ID.toLowerCase() })), EXPECTED), null);
    assert.equal(readFrameMessage(event(frameData("hello", { id: OTHER_ID })), EXPECTED), null);
  });

  test("nonce faltante, otro, número o de una sesión anterior", () => {
    for (const nonce of [undefined, "otro", 5, "ffffffffffffffffffffffffffffffff"]) {
      assert.equal(readFrameMessage(event(frameData("ready", { nonce })), EXPECTED), null);
    }
  });

  test("hello no necesita nonce", () => {
    assert.deepEqual(readFrameMessage(event(frameData("hello", { nonce: "cualquiera" })), EXPECTED), { type: "hello" });
  });

  test("step fuera del charset", () => {
    for (const step of ["Front", "1front", "", "front-side", "a".repeat(33), 5, null, "<b>x</b>"]) {
      assert.equal(readFrameMessage(event(frameData("step", { step })), EXPECTED), null);
    }
  });

  test("completed con un estado desconocido se descarta", () => {
    for (const status of ["pending", "VERIFIED", 1, null, undefined]) {
      assert.equal(readFrameMessage(event(frameData("completed", { status })), EXPECTED), null);
    }
  });

  test("un reason desconocido pasa a unsupported; uno que no es token se descarta", () => {
    assert.deepEqual(readFrameMessage(event(frameData("fallback", { reason: "algo_nuevo" })), EXPECTED), { type: "fallback", reason: "unsupported" });
    for (const reason of [5, null, undefined, "Algo", "un motivo libre"]) {
      assert.equal(readFrameMessage(event(frameData("fallback", { reason })), EXPECTED), null);
    }
  });

  test("timeout y frame_blocked son de la librería: si los manda el iframe valen unsupported", () => {
    for (const reason of ["timeout", "frame_blocked"]) {
      assert.deepEqual(readFrameMessage(event(frameData("fallback", { reason })), EXPECTED), { type: "fallback", reason: "unsupported" });
    }
  });
});

describe("builders y nonce", () => {
  test("init y close tienen exactamente las claves del protocolo", () => {
    assert.deepEqual(buildInit(ID, NONCE), { source: "raya-identity", v: 1, type: "init", id: ID, nonce: NONCE });
    assert.deepEqual(buildClose(ID, NONCE), { source: "raya-identity", v: 1, type: "close", id: ID, nonce: NONCE });
  });

  test("createNonce: 32 hex y cambia entre llamadas", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const nonce = createNonce();
      assert.match(nonce, /^[0-9a-f]{32}$/);
      seen.add(nonce);
    }
    assert.equal(seen.size, 50);
  });

  test("createNonce funciona sin crypto", () => {
    assert.match(createNonce(null), /^[0-9a-f]{32}$/);
    assert.notEqual(createNonce(null), createNonce(null));
  });

  test("createNonce usa la fuente recibida", () => {
    const zero = createNonce({
      getRandomValues(array) {
        array.fill(10);
        return array;
      },
    });
    assert.equal(zero, "0a".repeat(16));
  });

  test("ID_RE es exacta", () => {
    assert.ok(ID_RE.test(ID));
    assert.ok(!ID_RE.test(ID + "x"));
    assert.ok(!ID_RE.test(" " + ID));
  });
});
