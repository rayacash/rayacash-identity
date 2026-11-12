import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { createInstance, hooks } from "./_src.ts";
import type { IdentityEvent, IdentityResult } from "./_src.ts";
import { createEnv, ID, last, ORIGIN } from "./_dom.ts";
import type { Env } from "./_dom.ts";

let env: Env;
let events: IdentityEvent[];
const originalReport = hooks.reportError;
const identity = createInstance();

function open(): Promise<IdentityResult> {
  return identity.open(ID, { onEvent: (event) => void events.push(event) });
}

function types(): string[] {
  return events.map((event) => event.type);
}

function panelVisible(): boolean {
  return env.need("panel").style.getPropertyValue("display") === "flex";
}

function title(): string {
  return env.need("panel-title").textContent;
}

function hint(): string {
  return env.need("panel-hint").textContent;
}

function frameVisible(): boolean {
  return env.need("frame").style.getPropertyValue("visibility") === "visible";
}

const BLOCK = { disposition: "enforce", effectiveDirective: "frame-src", blockedURI: ORIGIN };

beforeEach(() => {
  env = createEnv();
  env.install();
  events = [];
  hooks.reportError = (error) => {
    throw error;
  };
});

afterEach(() => {
  identity.close();
  env.uninstall();
  hooks.reportError = originalReport;
});

describe("timeout", () => {
  test("a los 19 999 ms nada; a los 20 000 ms panel y un evento", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    void open();
    t.mock.timers.tick(19999);
    assert.equal(panelVisible(), false);
    assert.deepEqual(types(), []);
    t.mock.timers.tick(1);
    assert.equal(panelVisible(), true);
    assert.equal(title(), "Está tardando más de lo normal");
    assert.deepEqual(events, [{ type: "fallback", reason: "timeout", verification: { id: ID, status: null } }]);
    assert.equal(env.document.activeElement, env.need("panel-link"));
  });

  test("hello y ready tardíos vuelven al iframe y emiten ready", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    void open();
    t.mock.timers.tick(20000);
    env.handshake();
    assert.equal(panelVisible(), false);
    assert.equal(frameVisible(), true);
    assert.deepEqual(types(), ["fallback", "ready"]);
  });

  test("la X en el panel resuelve closed", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const promise = open();
    t.mock.timers.tick(20000);
    env.need("close").click();
    assert.deepEqual(await promise, { status: "closed", verification: { id: ID, status: null } });
  });
});

describe("violación de CSP", () => {
  for (const blockedURI of [ORIGIN, `${ORIGIN}/identity/${ID}?embed=1`]) {
    test(`frame_blocked al instante con blockedURI ${blockedURI}`, (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      void open();
      env.violation({ ...BLOCK, blockedURI });
      assert.equal(panelVisible(), true);
      assert.equal(title(), "No pudimos cargar la verificación acá");
      assert.deepEqual(events, [{ type: "fallback", reason: "frame_blocked", verification: { id: ID, status: null } }]);
      t.mock.timers.tick(60000);
      assert.deepEqual(types(), ["fallback"]);
    });
  }

  test("también con violatedDirective, child-src y default-src", () => {
    for (const fields of [
      { effectiveDirective: "", violatedDirective: "frame-src 'none'" },
      { effectiveDirective: "child-src" },
      { effectiveDirective: "default-src" },
    ]) {
      events = [];
      void open();
      env.violation({ ...BLOCK, ...fields });
      assert.deepEqual(types(), ["fallback"]);
      identity.close();
    }
  });

  const ignored: [string, Record<string, unknown>][] = [
    ["script-src", { effectiveDirective: "script-src" }],
    ["otro blockedURI", { blockedURI: "https://evil.com" }],
    ["un host que empieza igual", { blockedURI: "https://raya.cash.evil.com/x" }],
    ["disposition report", { disposition: "report" }],
  ];
  for (const [name, fields] of ignored) {
    test(`ignora ${name}`, () => {
      void open();
      env.violation({ ...BLOCK, ...fields });
      assert.deepEqual(types(), []);
      assert.equal(panelVisible(), false);
    });
  }

  test("ignora una violación después de ready", () => {
    void open();
    env.handshake();
    env.violation(BLOCK);
    assert.deepEqual(types(), ["ready"]);
    assert.equal(panelVisible(), false);
  });

  test("un ready tardío después de frame_blocked vuelve al iframe", () => {
    void open();
    env.violation(BLOCK);
    env.handshake();
    assert.equal(frameVisible(), true);
    assert.deepEqual(types(), ["fallback", "ready"]);
  });
});

describe("fallback del iframe", () => {
  test("camera_blocked: panel con su copy, iframe adjunto y oculto, un evento", () => {
    void open();
    env.handshake();
    env.post("fallback", { reason: "camera_blocked" });
    assert.equal(panelVisible(), true);
    assert.equal(title(), "Seguí en una pestaña nueva");
    assert.equal(env.need("panel-text").textContent, "Desde acá no podemos usar la cámara.");
    assert.ok(env.frame().isConnected);
    assert.equal(frameVisible(), false);
    assert.deepEqual(last(events), { type: "fallback", reason: "camera_blocked", verification: { id: ID, status: null } });
    assert.equal(env.document.activeElement, env.need("panel-link"));
  });

  test("antes de ready se ignora", () => {
    void open();
    env.post("hello");
    env.post("fallback", { reason: "camera_blocked" });
    assert.equal(panelVisible(), false);
    assert.deepEqual(types(), []);
  });

  test("después de completed se ignora", () => {
    void open();
    env.handshake();
    env.post("completed", { status: "processing" });
    env.post("fallback", { reason: "camera_blocked" });
    assert.equal(panelVisible(), false);
    assert.deepEqual(types(), ["ready", "completed"]);
  });

  test("un segundo fallback se ignora", () => {
    void open();
    env.handshake();
    env.post("fallback", { reason: "camera_blocked" });
    env.post("fallback", { reason: "storage_blocked" });
    assert.equal(env.need("panel-text").textContent, "Desde acá no podemos usar la cámara.");
    assert.deepEqual(types(), ["ready", "fallback"]);
  });

  test("un reason desconocido llega como unsupported", () => {
    void open();
    env.handshake();
    env.post("fallback", { reason: "algo_nuevo" });
    assert.deepEqual(last(events), { type: "fallback", reason: "unsupported", verification: { id: ID, status: null } });
  });

  test("hint de un motivo del iframe antes del clic", () => {
    void open();
    env.handshake();
    env.post("fallback", { reason: "storage_blocked" });
    assert.equal(hint(), "Si ya la abriste, terminá ahí: esta ventana se actualiza sola.");
  });
});

describe("pestaña nueva", () => {
  test("el clic no previene nada, no llama window.open y cambia el texto (puente vivo)", () => {
    void open();
    env.handshake();
    env.post("fallback", { reason: "camera_blocked" });
    const click = env.need("panel-link").click();
    assert.equal(click.defaultPrevented, false);
    assert.equal(title(), "Seguí en la pestaña nueva");
    assert.equal(hint(), "Cuando termines, volvé a esta pestaña: se actualiza sola.");
    assert.equal(env.need("panel-link").textContent, "Abrir de nuevo");
  });

  test("puente muerto: pide cerrar la ventana", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    void open();
    t.mock.timers.tick(20000);
    env.need("panel-link").click();
    assert.equal(hint(), "Cuando termines, volvé a esta pestaña y cerrá esta ventana.");
  });

  test("timeout + clic + ready tardío: el panel se queda, y completed resuelve", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const promise = open();
    t.mock.timers.tick(20000);
    env.need("panel-link").click();
    env.handshake();
    assert.equal(panelVisible(), true);
    assert.equal(frameVisible(), false);
    assert.equal(hint(), "Cuando termines, volvé a esta pestaña: se actualiza sola.");
    env.post("completed", { status: "processing" });
    assert.deepEqual(await promise, { status: "completed", verification: { id: ID, status: "processing" } });
    assert.equal(env.find("overlay"), null);
  });

  test("completed en fallback cierra sola la ventana", async () => {
    const promise = open();
    env.handshake();
    env.post("fallback", { reason: "camera_blocked" });
    env.post("completed", { status: "verified" });
    assert.deepEqual(await promise, { status: "completed", verification: { id: ID, status: "verified" } });
    assert.deepEqual(types(), ["ready", "fallback", "completed"]);
  });

  test("completed en new_tab cierra sola la ventana", async () => {
    const promise = open();
    env.handshake();
    env.post("fallback", { reason: "unsupported" });
    env.need("panel-link").click();
    env.post("completed", { status: "declined" });
    assert.deepEqual(await promise, { status: "completed", verification: { id: ID, status: "declined" } });
  });

  test("un segundo clic no cambia la fase", () => {
    void open();
    env.handshake();
    env.post("fallback", { reason: "camera_blocked" });
    env.need("panel-link").click();
    env.need("panel-link").click();
    assert.equal(title(), "Seguí en la pestaña nueva");
  });
});

describe("link no disponible", () => {
  test("panel sin link, foco en cerrar, un evento step, X resuelve closed", async () => {
    const promise = open();
    env.handshake();
    env.post("step", { step: "unavailable" });
    assert.equal(panelVisible(), true);
    assert.equal(title(), "Este link ya no está disponible");
    assert.equal(env.need("panel-text").textContent, "Pedile uno nuevo a quien te lo envió.");
    assert.equal(env.need("panel-link").style.getPropertyValue("display"), "none");
    assert.equal(hint(), "");
    assert.equal(env.document.activeElement, env.need("close"));
    assert.deepEqual(last(events), { type: "step", step: "unavailable", verification: { id: ID, status: null } });
    env.need("close").click();
    assert.deepEqual(await promise, { status: "closed", verification: { id: ID, status: null } });
  });

  test("Escape y close() también resuelven closed", async () => {
    let promise = open();
    env.handshake();
    env.post("step", { step: "unavailable" });
    env.key("Escape");
    assert.equal((await promise).status, "closed");

    promise = open();
    env.handshake();
    env.post("step", { step: "unavailable" });
    identity.close();
    assert.equal((await promise).status, "closed");
  });

  test("otro step posterior (se recuperó) vuelve a mostrar el iframe", () => {
    void open();
    env.handshake();
    env.post("step", { step: "unavailable" });
    env.post("step", { step: "intro" });
    assert.equal(panelVisible(), false);
    assert.equal(frameVisible(), true);
    assert.equal(env.document.activeElement, env.frame());
  });

  test("en pestaña nueva: unavailable muestra el panel sin link y al recuperarse vuelve el de la pestaña", () => {
    void open();
    env.handshake();
    env.post("fallback", { reason: "camera_blocked" });
    env.need("panel-link").click();
    env.post("step", { step: "unavailable" });
    assert.equal(title(), "Este link ya no está disponible");
    env.post("step", { step: "front" });
    assert.equal(title(), "Seguí en la pestaña nueva");
    assert.equal(env.need("panel-link").style.getPropertyValue("display"), "inline-block");
  });
});
