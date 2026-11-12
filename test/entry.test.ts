import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

type Globals = Record<string, unknown>;
const globals = globalThis as unknown as Globals;

function restore(): void {
  delete globals.window;
  delete globals.document;
}

afterEach(restore);

let reloads = 0;

async function loadGlobal(win: Record<string, unknown>): Promise<void> {
  globals.window = win;
  reloads++;
  const url: string = "../src/global.ts?n=" + reloads;
  await import(url);
}

async function factory() {
  return (await import("../src/index.ts")).default;
}

describe("entrada ESM", () => {
  test("importar y crear una instancia no toca window ni document", async () => {
    let windowReads = 0;
    let documentReads = 0;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      get() {
        windowReads++;
        return undefined;
      },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      get() {
        documentReads++;
        return undefined;
      },
    });
    const RayaIdentity = (await import("../src/index.ts?fresh=1" as string)).default;
    const instance = RayaIdentity();
    const otro = new RayaIdentity({ baseUrl: "https://otro.raya.cash" });
    assert.equal(windowReads, 0);
    assert.equal(documentReads, 0);
    assert.ok(Object.isFrozen(instance));
    assert.deepEqual(Object.keys(instance).sort(), Object.keys(otro).sort());
    assert.deepEqual(Object.keys(instance).sort(), ["close", "open", "version"]);
  });

  test("version e IntegrationError son estáticos enumerables", async () => {
    const RayaIdentity = await factory();
    assert.equal(RayaIdentity.version, "0.0.0-dev");
    assert.deepEqual(Object.keys(RayaIdentity).sort(), ["IntegrationError", "version"]);
    assert.equal(new RayaIdentity.IntegrationError("x").name, "IntegrationError");
  });

  test("close() sin navegador no tira", async () => {
    const RayaIdentity = await factory();
    assert.equal(RayaIdentity().close(), undefined);
  });
});

describe("entrada IIFE (global.ts)", () => {
  function collectWarnings(): { list: string[]; stop(): void } {
    const list: string[] = [];
    const original = console.warn;
    console.warn = (message: string) => void list.push(message);
    return {
      list,
      stop() {
        console.warn = original;
      },
    };
  }

  test("define RayaIdentity en una ventana vacía", async () => {
    const win: Record<string, unknown> = {};
    await loadGlobal(win);
    assert.equal(win.RayaIdentity, await factory());
  });

  test("mantiene en silencio una función existente con la misma versión", async () => {
    const existing = Object.assign(() => undefined, { version: "0.0.0-dev" });
    const win: Record<string, unknown> = { RayaIdentity: existing };
    const warnings = collectWarnings();
    await loadGlobal(win);
    warnings.stop();
    assert.equal(win.RayaIdentity, existing);
    assert.deepEqual(warnings.list, []);
  });

  test("mantiene una función con otra versión y avisa una vez", async () => {
    const existing = Object.assign(() => undefined, { version: "9.9.9" });
    const win: Record<string, unknown> = { RayaIdentity: existing };
    const warnings = collectWarnings();
    await loadGlobal(win);
    warnings.stop();
    assert.equal(win.RayaIdentity, existing);
    assert.equal(warnings.list.length, 1);
    assert.match(String(warnings.list[0]), /ya cargó la v9\.9\.9; se usa esa y se ignora la v0\.0\.0-dev/);
  });

  test('pisa un valor que no es la librería (el <div id="RayaIdentity">)', async () => {
    for (const value of [{ tagName: "DIV" }, 5, () => undefined]) {
      const win: Record<string, unknown> = { RayaIdentity: value };
      await loadGlobal(win);
      assert.equal(win.RayaIdentity, await factory());
    }
  });
});
