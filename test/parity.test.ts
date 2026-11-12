// Las dos mitades del protocolo tienen que coincidir: esta librería y
// utils/identityEmbed.ts de la web (raya-web). La web se busca en RAYA_WEB_DIR o,
// si no está, en la carpeta hermana ../../raya-web desde la raíz del paquete. Se
// saltea solo si ese archivo no existe (por ejemplo, en el CI de este repo): ahí
// corre protocol-snapshot.test.ts, que compara la librería con el registro del
// protocolo (protocol.snapshot.json), y acá se compara la web con el mismo archivo.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
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
} from "./_src.ts";
import { ID, ORIGIN } from "./_dom.ts";
import { SNAPSHOT } from "./_snapshot.ts";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const WEB_DIR = process.env.RAYA_WEB_DIR ? path.resolve(process.env.RAYA_WEB_DIR) : path.resolve(PACKAGE_ROOT, "../../raya-web");
const WEB_MODULE = path.join(WEB_DIR, "utils", "identityEmbed.ts");
const skip = existsSync(WEB_MODULE) ? false : `no existe ${WEB_MODULE} (definí RAYA_WEB_DIR con la carpeta de raya-web)`;

// Import no literal: tsc no tiene que resolver un archivo de la app.
async function web(): Promise<any> {
  const href: string = pathToFileURL(WEB_MODULE).href;
  return import(href);
}

const NONCE = "0123456789abcdef0123456789abcdef";
const PARENT = { parent: true };
const FRAME = { frame: true };

describe("paridad con utils/identityEmbed.ts", { skip }, () => {
  test("constantes idénticas, en el mismo orden", async () => {
    const embed = await web();
    assert.equal(SOURCE, embed.IDENTITY_EMBED_SOURCE);
    assert.equal(PROTOCOL_VERSION, embed.IDENTITY_EMBED_VERSION);
    assert.deepEqual([...FRAME_TYPES], [...embed.IDENTITY_EMBED_FRAME_TYPES]);
    assert.deepEqual([...PARENT_TYPES], [...embed.IDENTITY_EMBED_PARENT_TYPES]);
    assert.deepEqual([...STEPS], [...embed.IDENTITY_EMBED_STEPS]);
    assert.deepEqual([...COMPLETED_STATUSES], [...embed.IDENTITY_EMBED_COMPLETED]);
    assert.deepEqual([...FALLBACK_REASONS], [...embed.IDENTITY_EMBED_FALLBACKS]);
    assert.equal(STEPS.length, 7);
  });

  test("createNonce cumple la regex del iframe", async () => {
    const embed = await web();
    for (let i = 0; i < 100; i++) assert.match(createNonce(), embed.IDENTITY_EMBED_NONCE_RE);
    assert.match(createNonce(null), embed.IDENTITY_EMBED_NONCE_RE);
  });

  test("el iframe acepta init y, después, close de la librería", async () => {
    const embed = await web();
    const parentOrigin = "https://comercio.example";
    const init = embed.identityEmbedReadParent(
      { data: buildInit(ID, NONCE), origin: parentOrigin, source: PARENT },
      { parent: PARENT, id: ID, origin: null, nonce: null },
    );
    assert.deepEqual(init, { type: "init", origin: parentOrigin, nonce: NONCE });
    const close = embed.identityEmbedReadParent(
      { data: buildClose(ID, NONCE), origin: parentOrigin, source: PARENT },
      { parent: PARENT, id: ID, origin: parentOrigin, nonce: NONCE },
    );
    assert.deepEqual(close, { type: "close" });
  });

  test("la librería acepta todo lo que arma identityEmbedMessage", async () => {
    const embed = await web();
    const expected = { origin: ORIGIN, frame: FRAME, id: ID, nonce: NONCE };
    function read(type: string, nonce: string | null, extra?: Record<string, string>) {
      return readFrameMessage({ origin: ORIGIN, source: FRAME, data: embed.identityEmbedMessage(type, ID, nonce, extra) }, expected);
    }
    assert.deepEqual(read("hello", null), { type: "hello" });
    assert.deepEqual(read("ready", NONCE), { type: "ready" });
    assert.deepEqual(read("close", NONCE), { type: "close" });
    for (const step of STEPS) assert.deepEqual(read("step", NONCE, { step }), { type: "step", step });
    for (const status of COMPLETED_STATUSES) assert.deepEqual(read("completed", NONCE, { status }), { type: "completed", status });
    for (const reason of FALLBACK_REASONS) assert.deepEqual(read("fallback", NONCE, { reason }), { type: "fallback", reason });
  });

  test("hello nunca lleva nonce", async () => {
    const embed = await web();
    assert.equal("nonce" in embed.identityEmbedMessage("hello", ID, NONCE), false);
  });

  test("la web habla lo que registra protocol.snapshot.json", async () => {
    const embed = await web();
    assert.deepEqual(
      {
        source: embed.IDENTITY_EMBED_SOURCE,
        version: embed.IDENTITY_EMBED_VERSION,
        frameTypes: [...embed.IDENTITY_EMBED_FRAME_TYPES],
        parentTypes: [...embed.IDENTITY_EMBED_PARENT_TYPES],
        steps: [...embed.IDENTITY_EMBED_STEPS],
        completed: [...embed.IDENTITY_EMBED_COMPLETED],
        fallbacks: [...embed.IDENTITY_EMBED_FALLBACKS],
        tokenRe: embed.IDENTITY_EMBED_TOKEN_RE.source,
      },
      {
        source: SNAPSHOT.constants.source,
        version: SNAPSHOT.constants.version,
        frameTypes: SNAPSHOT.constants.frameTypes,
        parentTypes: SNAPSHOT.constants.parentTypes,
        steps: SNAPSHOT.constants.steps,
        completed: SNAPSHOT.constants.completed,
        fallbacks: SNAPSHOT.constants.fallbacks,
        tokenRe: SNAPSHOT.constants.tokenRe,
      },
    );
    assert.equal(embed.IDENTITY_EMBED_NONCE_RE.source, SNAPSHOT.nonceRe);
    const { id, nonce, parentOrigin } = SNAPSHOT.sample;
    for (const item of SNAPSHOT.frame) {
      assert.deepEqual({ ...embed.identityEmbedMessage(item.type, id, item.nonce, item.extra ?? undefined) }, item.message);
    }
    const [init, close] = SNAPSHOT.parent;
    assert.deepEqual(
      embed.identityEmbedReadParent({ data: init?.message, origin: parentOrigin, source: PARENT }, { parent: PARENT, id, origin: null, nonce: null }),
      init?.read,
    );
    assert.deepEqual(
      embed.identityEmbedReadParent({ data: close?.message, origin: parentOrigin, source: PARENT }, { parent: PARENT, id, origin: parentOrigin, nonce }),
      close?.read,
    );
    assert.equal(embed.identityEmbedIsHostedPath(new URL(SNAPSHOT.hosted.frameUrl).pathname), SNAPSHOT.hosted.isHostedPath);
    assert.equal(embed.identityEmbedTopUrl(SNAPSHOT.hosted.frameUrl), SNAPSHOT.hosted.topUrl);
  });

  test("la URL del iframe es una ruta alojada y su versión top es el link de la pestaña", async () => {
    const embed = await web();
    const tabUrl = ORIGIN + IDENTITY_PATH + ID;
    const frameUrl = tabUrl + EMBED_QUERY;
    assert.equal(embed.identityEmbedIsHostedPath(new URL(frameUrl).pathname), true);
    assert.equal(embed.identityEmbedTopUrl(frameUrl), tabUrl);
  });
});
