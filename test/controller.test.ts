import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { createInstance, hooks, IntegrationError, RayaIdentity } from "./_src.ts";
import type { IdentityEvent, IdentityResult } from "./_src.ts";
import { createEnv, ID, last, ORIGIN, OTHER_ID } from "./_dom.ts";
import type { Env } from "./_dom.ts";

let env: Env;
let events: IdentityEvent[];
let reported: unknown[];
const originalReport = hooks.reportError;
const identity = createInstance();

function open(target: string = ID): Promise<IdentityResult> {
  return identity.open(target, { onEvent: (event) => void events.push(event) });
}

function types(): string[] {
  return events.map((event) => event.type);
}

beforeEach(() => {
  env = createEnv();
  env.install();
  events = [];
  reported = [];
  hooks.reportError = (error) => void reported.push(error);
});

afterEach(() => {
  identity.close();
  env.uninstall();
  hooks.reportError = originalReport;
});

describe("handshake", () => {
  test("el listener de message se registra antes de que el iframe entre al documento", () => {
    void open();
    const listenAt = env.log.indexOf("listen:window:message");
    const appendAt = env.log.indexOf("append:body:overlay");
    assert.ok(listenAt >= 0);
    assert.ok(appendAt > listenAt);
  });

  test("hello responde exactamente un init al contentWindow con el origen exacto", () => {
    void open();
    env.post("hello");
    const posted = env.frame().frameWindow.posted;
    assert.equal(posted.length, 1);
    assert.equal(posted[0]?.targetOrigin, "https://raya.cash");
    assert.deepEqual(Object.keys(posted[0]?.data ?? {}).sort(), ["id", "nonce", "source", "type", "v"]);
    assert.equal(posted[0]?.data.type, "init");
    assert.equal(posted[0]?.data.id, ID);
    assert.match(String(posted[0]?.data.nonce), /^[0-9a-f]{32}$/);
  });

  test("ready muestra el iframe y emite un ready; 60 s después no hay panel", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    void open();
    env.handshake();
    assert.equal(env.need("frame").style.getPropertyValue("visibility"), "visible");
    assert.equal(env.document.activeElement, env.frame());
    assert.deepEqual(types(), ["ready"]);
    t.mock.timers.tick(60000);
    assert.equal(env.need("panel").style.getPropertyValue("display"), "none");
    assert.deepEqual(types(), ["ready"]);
  });

  test("hello con otro origen, otra ventana u otro id no recibe nada", () => {
    void open();
    env.deliver(env.message({ origin: "https://evil.com", data: { type: "hello" } }));
    env.deliver(env.message({ source: {}, data: { type: "hello" } }));
    env.deliver(env.message({ data: { type: "hello", id: OTHER_ID } }));
    assert.equal(env.frame().frameWindow.posted.length, 0);
  });

  test("ready con nonce incorrecto se ignora y el timer sigue", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    void open();
    env.post("hello");
    env.post("ready", { nonce: "f".repeat(32) });
    assert.equal(env.need("loading").style.getPropertyValue("display"), "flex");
    t.mock.timers.tick(20000);
    assert.deepEqual(types(), ["fallback"]);
  });

  test("step y completed antes de ready se ignoran", () => {
    void open();
    env.post("hello");
    env.post("step", { step: "front" });
    env.post("completed", { status: "verified" });
    env.post("close");
    assert.deepEqual(types(), []);
    assert.ok(env.find("overlay"));
  });
});

describe("repeticiones", () => {
  test("tres hello: tres init con el mismo nonce", () => {
    void open();
    env.post("hello");
    env.post("hello");
    env.post("hello");
    const inits = env.inits();
    assert.equal(inits.length, 3);
    assert.equal(new Set(inits.map((entry) => entry.nonce)).size, 1);
  });

  test("hello después de ready re-inicia y conserva el estado", () => {
    void open();
    env.handshake();
    env.post("step", { step: "front" });
    env.post("hello");
    env.post("ready");
    assert.equal(env.inits().length, 2);
    assert.deepEqual(types(), ["ready", "step"]);
    assert.equal(env.need("frame").style.getPropertyValue("visibility"), "visible");
  });

  test("el mismo step dos veces: un evento", () => {
    void open();
    env.handshake();
    env.post("step", { step: "front" });
    env.post("step", { step: "front" });
    env.post("step", { step: "back" });
    assert.deepEqual(
      events.map((event) => (event.type === "step" ? event.step : event.type)),
      ["ready", "front", "back"],
    );
  });

  test("completed processing dos veces: uno", () => {
    void open();
    env.handshake();
    env.post("completed", { status: "processing" });
    env.post("completed", { status: "processing" });
    assert.deepEqual(types(), ["ready", "completed"]);
  });

  test("verified y después processing y declined: sigue verified", async () => {
    const promise = open();
    env.handshake();
    env.post("completed", { status: "verified" });
    env.post("completed", { status: "processing" });
    env.post("completed", { status: "declined" });
    assert.deepEqual(types(), ["ready", "completed"]);
    identity.close();
    assert.deepEqual(await promise, { status: "completed", verification: { id: ID, status: "verified" } });
  });

  test("processing avanza a declined", async () => {
    const promise = open();
    env.handshake();
    env.post("completed", { status: "processing" });
    env.post("completed", { status: "declined" });
    assert.deepEqual(types(), ["ready", "completed", "completed"]);
    identity.close();
    assert.deepEqual(await promise, { status: "completed", verification: { id: ID, status: "declined" } });
  });

  test("los mensajes después de close() no cambian nada", async () => {
    const promise = open();
    env.handshake();
    const stale = env.message({ data: { type: "step", step: "front" } });
    identity.close();
    await promise;
    env.deliver(stale);
    assert.deepEqual(types(), ["ready"]);
  });

  test("reabrir da otro nonce y el viejo se rechaza", async () => {
    const first = open();
    env.handshake();
    const oldNonce = env.nonce();
    identity.close();
    await first;
    events = [];
    void open();
    env.post("hello");
    assert.notEqual(env.nonce(), oldNonce);
    env.post("ready", { nonce: oldNonce });
    assert.deepEqual(types(), []);
    env.post("ready");
    assert.deepEqual(types(), ["ready"]);
  });
});

describe("resultados", () => {
  test("close del iframe antes de completed: closed", async () => {
    const promise = open();
    env.handshake();
    env.post("close");
    assert.deepEqual(await promise, { status: "closed", verification: { id: ID, status: null } });
  });

  test("processing y close del iframe: completed/processing", async () => {
    const promise = open();
    env.handshake();
    env.post("completed", { status: "processing" });
    env.post("close");
    assert.deepEqual(await promise, { status: "completed", verification: { id: ID, status: "processing" } });
  });

  test("completed no cierra la ventana mientras el iframe se ve", () => {
    void open();
    env.handshake();
    env.post("completed", { status: "verified" });
    assert.ok(env.find("overlay"));
  });

  test("la X cierra", async () => {
    const promise = open();
    env.handshake();
    env.need("close").click();
    assert.equal((await promise).status, "closed");
    assert.equal(env.find("overlay"), null);
  });

  for (const key of ["Escape", "Esc"]) {
    test(`${key} cierra`, async () => {
      const promise = open();
      env.key(key);
      assert.equal((await promise).status, "closed");
    });
  }

  test("otra tecla no cierra; un clic en el fondo tampoco", () => {
    void open();
    env.key("Enter");
    env.need("overlay").click();
    assert.ok(env.find("overlay"));
  });

  test("el close al iframe se postea con el origen exacto antes de sacarlo", async () => {
    const promise = open();
    env.handshake();
    const frameWindow = env.frame().frameWindow;
    identity.close();
    await promise;
    const closeMessage = last(frameWindow.posted);
    assert.equal(closeMessage.data.type, "close");
    assert.equal(closeMessage.targetOrigin, ORIGIN);
    assert.equal(closeMessage.data.nonce, env.nonce());
    assert.equal(env.frame().contentWindow, null);
  });

  test("los eventos están congelados y no llevan claves ajenas", () => {
    void open();
    env.handshake();
    env.deliver(env.message({ data: { type: "step", step: "front", person: "x", token: "y" } }));
    for (const event of events) {
      assert.ok(Object.isFrozen(event));
      assert.ok(Object.isFrozen(event.verification));
      assert.ok(!("person" in event));
      assert.ok(!("token" in event));
    }
    assert.deepEqual(last(events), { type: "step", step: "front", verification: { id: ID, status: null } });
  });
});

describe("confirmación de salida", () => {
  for (const step of ["front", "back", "liveness"]) {
    test(`en ${step} la primera X pregunta y la segunda cierra`, async () => {
      const promise = open();
      env.handshake();
      env.post("step", { step });
      env.need("close").click();
      assert.ok(env.find("overlay"));
      assert.equal(env.need("confirm").style.getPropertyValue("display"), "flex");
      env.need("close").click();
      assert.equal((await promise).status, "closed");
    });
  }

  for (const step of ["intro", "processing", "done", "unavailable"]) {
    test(`en ${step} cierra de una`, async () => {
      const promise = open();
      env.handshake();
      env.post("step", { step });
      env.need("close").click();
      assert.equal((await promise).status, "closed");
    });
  }

  test("Escape dos veces en captura", async () => {
    const promise = open();
    env.handshake();
    env.post("step", { step: "liveness" });
    env.key("Escape");
    assert.ok(env.find("overlay"));
    env.key("Escape");
    assert.equal((await promise).status, "closed");
  });

  test("Salir cierra", async () => {
    const promise = open();
    env.handshake();
    env.post("step", { step: "front" });
    env.need("close").click();
    env.need("confirm-leave").click();
    assert.equal((await promise).status, "closed");
  });

  test("Seguir vuelve al iframe y la próxima X pregunta otra vez", () => {
    void open();
    env.handshake();
    env.post("step", { step: "front" });
    env.need("close").click();
    env.need("confirm-stay").click();
    assert.equal(env.need("confirm").style.getPropertyValue("display"), "none");
    assert.equal(env.document.activeElement, env.frame());
    env.need("close").click();
    assert.ok(env.find("overlay"));
    assert.equal(env.need("confirm").style.getPropertyValue("display"), "flex");
  });

  test("close() es inmediato en captura", async () => {
    const promise = open();
    env.handshake();
    env.post("step", { step: "front" });
    identity.close();
    assert.equal((await promise).status, "closed");
    assert.equal(env.find("overlay"), null);
  });

  test("el close del iframe es inmediato en captura", async () => {
    const promise = open();
    env.handshake();
    env.post("step", { step: "back" });
    env.post("close");
    assert.equal((await promise).status, "closed");
  });

  test("si el flujo sale de la captura, la pregunta se descarta", () => {
    void open();
    env.handshake();
    env.post("step", { step: "liveness" });
    env.need("close").click();
    env.post("step", { step: "processing" });
    assert.equal(env.need("confirm").style.getPropertyValue("display"), "none");
    assert.equal(env.document.activeElement, env.frame());
  });

  test("entre pasos de captura la pregunta sigue abierta", () => {
    void open();
    env.handshake();
    env.post("step", { step: "front" });
    env.need("close").click();
    env.post("step", { step: "back" });
    assert.equal(env.need("confirm").style.getPropertyValue("display"), "flex");
  });
});

describe("una sola verificación por página", () => {
  test("doble open con el mismo id: la misma promesa, un overlay, el segundo onEvent no se llama", () => {
    let second = 0;
    const first = open();
    const again = identity.open(ID, { onEvent: () => void second++ });
    assert.equal(first, again);
    assert.equal(env.document.iframes.length, 1);
    env.handshake();
    assert.equal(second, 0);
    assert.deepEqual(types(), ["ready"]);
  });

  test("otro id: IntegrationError y el primero sigue intacto", () => {
    void open();
    assert.throws(() => identity.open(OTHER_ID), IntegrationError);
    assert.ok(env.find("overlay"));
    env.handshake();
    assert.deepEqual(types(), ["ready"]);
  });

  test("otra instancia con otro baseUrl y el mismo id: IntegrationError", () => {
    void open();
    const otro = createInstance({ baseUrl: "https://otro.raya.cash" });
    assert.throws(() => otro.open(ID), IntegrationError);
  });

  test("close() de otra instancia cierra el flujo", async () => {
    const promise = open();
    createInstance().close();
    assert.equal((await promise).status, "closed");
  });

  test("overlay sacado desde afuera: el próximo open funciona y el huérfano resuelve closed", async () => {
    const orphan = open();
    env.need("overlay").remove();
    const next = identity.open(OTHER_ID);
    assert.notEqual(orphan, next);
    assert.deepEqual(await orphan, { status: "closed", verification: { id: ID, status: null } });
    assert.ok(env.find("overlay"));
    assert.equal(env.document.iframes.length, 2);
  });

  test("close() sin flujo no hace nada", () => {
    identity.close();
    assert.equal(env.find("overlay"), null);
  });

  test("la url de la API abre el mismo flujo que el id", () => {
    const first = open(`https://raya.cash/identity/${ID}`);
    assert.equal(first, open(ID));
    assert.equal(env.frame().src, `https://raya.cash/identity/${ID}?embed=1`);
  });

  test("con otro baseUrl de Raya, la URL del iframe sale de ese origen", () => {
    const otro = createInstance({ baseUrl: "https://otro.raya.cash" });
    void otro.open(`https://otro.raya.cash/identity/${ID}`);
    assert.equal(env.frame().src, `https://otro.raya.cash/identity/${ID}?embed=1`);
    assert.equal(env.need("panel-link").getAttribute("href"), `https://otro.raya.cash/identity/${ID}`);
  });
});

describe("cerrar durante el handshake", () => {
  function assertClean(): void {
    assert.equal(env.window.listenerCount(), 0);
    assert.equal(env.document.listenerCount(), 0);
    assert.equal(env.find("overlay"), null);
    assert.equal(env.document.documentElement.style.getPropertyValue("overflow"), "");
  }

  test("close() antes del hello", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const opener = env.document.createElement("button");
    env.document.body.appendChild(opener);
    opener.focus();
    const promise = open();
    const stale = env.message({ data: { type: "hello" } });
    const frameWindow = env.frame().frameWindow;
    identity.close();
    assert.deepEqual(await promise, { status: "closed", verification: { id: ID, status: null } });
    assertClean();
    assert.equal(env.document.activeElement, opener);
    t.mock.timers.tick(60000);
    assert.deepEqual(types(), []);
    const posted = frameWindow.posted.length;
    env.deliver(stale);
    assert.equal(frameWindow.posted.length, posted);
  });

  test("close() entre init y ready", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const promise = open();
    env.post("hello");
    identity.close();
    assert.equal((await promise).status, "closed");
    assertClean();
    t.mock.timers.tick(60000);
    assert.deepEqual(types(), []);
  });
});

describe("callbacks y entorno", () => {
  test("un onEvent que tira llega a reportError y el siguiente evento igual sale", () => {
    let calls = 0;
    const boom = new Error("boom");
    void identity.open(ID, {
      onEvent: () => {
        calls++;
        throw boom;
      },
    });
    env.handshake();
    env.post("step", { step: "front" });
    assert.equal(calls, 2);
    assert.deepEqual(reported, [boom, boom]);
  });

  test("close() dentro de onEvent(completed) resuelve completed y no hay más callbacks", async () => {
    const seen: string[] = [];
    const promise = identity.open(ID, {
      onEvent: (event) => {
        seen.push(event.type);
        if (event.type === "completed") identity.close();
      },
    });
    env.handshake();
    env.post("completed", { status: "processing" });
    env.post("step", { step: "done" });
    assert.deepEqual(seen, ["ready", "completed"]);
    assert.deepEqual(await promise, { status: "completed", verification: { id: ID, status: "processing" } });
  });

  test("open de otro id dentro de onEvent se reporta y no rompe el flujo", () => {
    void identity.open(ID, {
      onEvent: () => {
        void identity.open(OTHER_ID);
      },
    });
    env.handshake();
    assert.equal(reported.length, 1);
    assert.ok(reported[0] instanceof IntegrationError);
    assert.ok(env.find("overlay"));
  });

  test("open sin window o sin document", () => {
    env.uninstall();
    assert.throws(() => identity.open(ID), /necesita un navegador/);
    env.install();
    delete (globalThis as unknown as Record<string, unknown>).document;
    assert.throws(() => identity.open(ID), /necesita un navegador/);
  });

  test("open sin body", () => {
    (env.document as unknown as { body: null }).body = null;
    assert.throws(() => identity.open(ID), /necesita el <body>/);
  });

  test("el entorno se valida antes que las opciones y las opciones antes que el id", () => {
    assert.throws(() => identity.open("malo", { onEvent: 5 as never }), /onEvent/);
    env.uninstall();
    assert.throws(() => identity.open("malo", { onEvent: 5 as never }), /necesita un navegador/);
    env.install();
  });

  test("un appendChild que tira resuelve closed y no deja nada", async () => {
    env.document.failAppend = true;
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      const result = await open();
      assert.deepEqual(result, { status: "closed", verification: { id: ID, status: null } });
    } finally {
      console.error = original;
    }
    assert.equal(logged.length, 1);
    assert.equal(logged[0]?.[0], "Raya Identity: error inesperado");
    assert.equal(env.find("overlay"), null);
    assert.equal(env.window.listenerCount(), 0);
    assert.equal(env.document.listenerCount(), 0);
    env.document.failAppend = false;
    void open();
    assert.ok(env.find("overlay"));
  });

  test("onEvent nunca se llama dentro de open()", () => {
    void open();
    assert.deepEqual(types(), []);
  });

  test("resize recalcula y focusin afuera trae el foco de vuelta", () => {
    void open();
    env.resize(400, 800);
    assert.equal(env.need("card").style.getPropertyValue("width"), "100%");
    const outside = env.document.createElement("button");
    env.document.body.appendChild(outside);
    outside.focus();
    assert.equal(env.document.activeElement, env.need("close"));
  });

  test("factory con y sin new", () => {
    const built = new RayaIdentity();
    assert.ok(Object.isFrozen(built));
    assert.equal(typeof RayaIdentity().open, "function");
  });
});
