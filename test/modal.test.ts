import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { createModal, IFRAME_ALLOW } from "./_src.ts";
import type { Modal, ModalConfig, PanelState } from "./_src.ts";
import { createEnv, FakeElement, ID, ORIGIN } from "./_dom.ts";
import type { Env } from "./_dom.ts";

const TAB_URL = `${ORIGIN}/identity/${ID}`;
const FRAME_URL = `${TAB_URL}?embed=1`;

let env: Env;

interface Calls {
  close: number;
  link: number;
  stay: number;
  leave: number;
}

function build(target: Env = env, overrides: Partial<ModalConfig> = {}): { modal: Modal; calls: Calls } {
  const calls: Calls = { close: 0, link: 0, stay: 0, leave: 0 };
  const modal = createModal(target.window as unknown as Window, target.document as unknown as Document, {
    frameUrl: FRAME_URL,
    tabUrl: TAB_URL,
    onClose: () => calls.close++,
    onTabLink: () => calls.link++,
    onStay: () => calls.stay++,
    onLeave: () => calls.leave++,
    ...overrides,
  });
  return { modal, calls };
}

function descendants(node: FakeElement): FakeElement[] {
  return node.children.reduce<FakeElement[]>((all, child) => all.concat(child, descendants(child)), []);
}

function style(name: string, property: string): string {
  return env.need(name).style.getPropertyValue(property);
}

beforeEach(() => {
  env = createEnv();
});

afterEach(() => {
  env.uninstall();
});

describe("construcción", () => {
  test("todo estilo va con !important y empieza con all: initial", () => {
    build().modal.mount();
    const overlay = env.need("overlay");
    for (const element of [overlay, ...descendants(overlay)]) {
      const calls = element.style.calls;
      assert.ok(calls.length > 0, element.name);
      assert.equal(calls[0]?.name, "all", element.name);
      assert.equal(calls[0]?.value, "initial", element.name);
      for (const call of calls) assert.equal(call.priority, "important", `${element.name} ${call.name}`);
    }
  });

  test("iframe: atributos exactos y orden allow -> src -> append", () => {
    build().modal.mount();
    const iframe = env.frame();
    assert.equal(iframe.getAttribute("allow"), "camera; fullscreen; clipboard-write");
    assert.equal(IFRAME_ALLOW, "camera; fullscreen; clipboard-write");
    assert.ok(!iframe.getAttribute("allow")?.includes("microphone"));
    assert.equal(iframe.getAttribute("title"), "Verificación de identidad");
    assert.equal(iframe.getAttribute("referrerpolicy"), "strict-origin");
    assert.equal(iframe.getAttribute("sandbox"), null);
    assert.equal(iframe.getAttribute("name"), null);
    assert.equal(iframe.src, FRAME_URL);
    const allowAt = env.log.indexOf("attr:frame:allow");
    const srcAt = env.log.indexOf("attr:frame:src");
    const appendAt = env.log.indexOf("append:body:frame");
    assert.ok(allowAt >= 0 && allowAt < srcAt, "allow antes de src");
    assert.ok(srcAt < appendAt, "src antes del append");
  });

  test("atributos del diálogo y del botón de cerrar", () => {
    build().modal.mount();
    const overlay = env.need("overlay");
    assert.equal(overlay.getAttribute("role"), "dialog");
    assert.equal(overlay.getAttribute("aria-modal"), "true");
    assert.equal(overlay.getAttribute("aria-label"), "Verificación de identidad");
    const close = env.need("close");
    assert.equal(close.getAttribute("type"), "button");
    assert.equal(close.getAttribute("aria-label"), "Cerrar");
    assert.equal(close.textContent, "×");
  });

  test("el link del panel no lleva embed y abre en otra pestaña", () => {
    build().modal.mount();
    const link = env.need("panel-link");
    assert.equal(link.getAttribute("href"), TAB_URL);
    assert.equal(link.getAttribute("target"), "_blank");
    assert.ok(link.getAttribute("rel")?.includes("noopener"));
  });

  test('role="status" solo en panel-text (y en el cargando)', () => {
    build().modal.mount();
    assert.equal(env.need("panel").getAttribute("role"), null);
    assert.equal(env.need("panel-text").getAttribute("role"), "status");
    assert.equal(env.need("panel-title").getAttribute("role"), "heading");
    assert.equal(env.need("panel-title").getAttribute("aria-level"), "2");
    assert.equal(env.need("loading").getAttribute("role"), "status");
  });

  test("no usa id ni class en ningún nodo", () => {
    build().modal.mount();
    for (const element of descendants(env.document.body)) {
      assert.equal(element.getAttribute("id"), null);
      assert.equal(element.getAttribute("class"), null);
    }
  });

  test("el overlay queda último en el body", () => {
    env.document.body.appendChild(env.document.createElement("div"));
    build().modal.mount();
    const children = env.document.body.children;
    assert.equal(children[children.length - 1], env.need("overlay"));
    assert.equal(style("overlay", "z-index"), "2147483647");
    assert.equal(style("overlay", "position"), "fixed");
  });
});

describe("layout", () => {
  const cases: [number, number, string, string, string][] = [
    [390, 844, "100%", "100dvh", "0"],
    [1440, 900, "480px", "764px", "16px"],
    [1280, 700, "480px", "652px", "16px"],
    [1280, 600, "100%", "100dvh", "0"],
    [639, 900, "100%", "100dvh", "0"],
    [640, 620, "480px", "572px", "16px"],
  ];
  for (const [width, height, cardWidth, cardHeight, radius] of cases) {
    test(`${width}x${height}`, () => {
      env = createEnv({ innerWidth: width, innerHeight: height });
      build().modal.mount();
      assert.equal(style("card", "width"), cardWidth);
      assert.equal(style("card", "height"), cardHeight);
      assert.equal(style("card", "border-radius"), radius);
    });
  }

  test("compacto escribe 100% antes de 100dvh y usa safe-area", () => {
    env = createEnv({ innerWidth: 390, innerHeight: 844 });
    build().modal.mount();
    const heights = env.need("card").style.calls.filter((call) => call.name === "height").map((call) => call.value);
    assert.deepEqual(heights.slice(-2), ["100%", "100dvh"]);
    assert.match(style("card", "padding"), /safe-area-inset-top/);
  });

  test("layout() recalcula después de un resize", () => {
    const { modal } = build();
    modal.mount();
    assert.equal(style("card", "width"), "480px");
    env.window.innerWidth = 400;
    modal.layout();
    assert.equal(style("card", "width"), "100%");
    env.window.innerWidth = 1440;
    modal.layout();
    assert.equal(style("card", "width"), "480px");
    assert.equal(style("card", "height"), "764px");
    assert.equal(style("card", "padding"), "0");
  });
});

describe("vistas", () => {
  test("loading: el iframe existe pero no se ve", () => {
    const { modal } = build();
    modal.mount();
    assert.equal(style("loading", "display"), "flex");
    assert.equal(style("frame", "visibility"), "hidden");
    assert.equal(style("panel", "display"), "none");
  });

  test("frame: visible y con el foco", () => {
    const { modal } = build();
    modal.mount();
    modal.show("frame");
    assert.equal(style("frame", "visibility"), "visible");
    assert.equal(style("loading", "display"), "none");
    assert.equal(env.document.activeElement, env.frame());
  });

  test("panel: el iframe oculto conserva su tamaño y sigue adjunto", () => {
    const { modal } = build();
    modal.mount();
    modal.show("frame");
    modal.show("panel", { link: true, reason: "camera_blocked", opened: false, bridge: true });
    assert.equal(style("frame", "visibility"), "hidden");
    assert.equal(style("frame", "display"), "block");
    assert.equal(style("frame", "width"), "100%");
    assert.equal(style("frame", "height"), "100%");
    assert.ok(env.frame().isConnected);
    assert.equal(style("panel", "display"), "flex");
    assert.equal(env.document.activeElement, env.need("panel-link"));
  });

  test("refrescar el mismo panel no mueve el foco", () => {
    const { modal } = build();
    modal.mount();
    const state: PanelState = { link: true, reason: "timeout", opened: true, bridge: false };
    modal.show("panel", state);
    env.need("close").focus();
    modal.show("panel", { ...state, bridge: true });
    assert.equal(env.document.activeElement, env.need("close"));
    assert.match(env.need("panel-hint").textContent, /se actualiza sola/);
  });

  const copy: [PanelState, string, string, string, string][] = [
    [{ link: true, reason: "timeout", opened: false, bridge: false }, "Está tardando más de lo normal", "Podés esperar un momento o abrir la verificación en una pestaña nueva.", "", "Abrir en una pestaña nueva"],
    [{ link: true, reason: "frame_blocked", opened: false, bridge: false }, "No pudimos cargar la verificación acá", "Abrila en una pestaña nueva para continuar.", "", "Abrir en una pestaña nueva"],
    [{ link: true, reason: "camera_blocked", opened: false, bridge: true }, "Seguí en una pestaña nueva", "Desde acá no podemos usar la cámara.", "Si ya la abriste, terminá ahí: esta ventana se actualiza sola.", "Abrir en una pestaña nueva"],
    [{ link: true, reason: "storage_blocked", opened: false, bridge: true }, "Seguí en una pestaña nueva", "Tu navegador no nos deja continuar la verificación acá.", "Si ya la abriste, terminá ahí: esta ventana se actualiza sola.", "Abrir en una pestaña nueva"],
    [{ link: true, reason: "unsupported", opened: false, bridge: true }, "Seguí en una pestaña nueva", "Desde acá no podemos verificar tu identidad. Si estás dentro de una app, abrí el link en Chrome o Safari.", "Si ya la abriste, terminá ahí: esta ventana se actualiza sola.", "Abrir en una pestaña nueva"],
    [{ link: true, reason: "timeout", opened: true, bridge: true }, "Seguí en la pestaña nueva", "", "Cuando termines, volvé a esta pestaña: se actualiza sola.", "Abrir de nuevo"],
    [{ link: true, reason: "timeout", opened: true, bridge: false }, "Seguí en la pestaña nueva", "", "Cuando termines, volvé a esta pestaña y cerrá esta ventana.", "Abrir de nuevo"],
  ];
  for (const [state, title, text, hint, link] of copy) {
    test(`copy: ${JSON.stringify(state)}`, () => {
      const { modal } = build();
      modal.mount();
      modal.show("panel", state);
      assert.equal(env.need("panel-title").textContent, title);
      assert.equal(env.need("panel-text").textContent, text);
      assert.equal(env.need("panel-hint").textContent, hint);
      assert.equal(env.need("panel-link").textContent, link);
      assert.equal(style("panel-text", "display"), text ? "block" : "none");
      assert.equal(style("panel-hint", "display"), hint ? "block" : "none");
    });
  }

  test("panel sin link: copy de link no disponible y foco en cerrar", () => {
    const { modal } = build();
    modal.mount();
    modal.show("frame");
    modal.show("panel", { link: false });
    assert.equal(env.need("panel-title").textContent, "Este link ya no está disponible");
    assert.equal(env.need("panel-text").textContent, "Pedile uno nuevo a quien te lo envió.");
    assert.equal(style("panel-link", "display"), "none");
    assert.equal(style("panel-hint", "display"), "none");
    assert.equal(env.document.activeElement, env.need("close"));
  });
});

describe("confirmación de salida", () => {
  test("muestra la fila en la barra, foco en Seguir; al cerrarla vuelve al iframe", () => {
    const { modal, calls } = build();
    modal.mount();
    modal.show("frame");
    assert.equal(style("confirm", "display"), "none");
    modal.confirmExit(true);
    assert.equal(style("confirm", "display"), "flex");
    assert.match(env.need("confirm").textContent, /¿Salir de la verificación\?/);
    assert.equal(env.need("confirm-stay").textContent, "Seguir");
    assert.equal(env.need("confirm-leave").textContent, "Salir");
    assert.equal(env.document.activeElement, env.need("confirm-stay"));
    env.need("confirm-stay").click();
    env.need("confirm-leave").click();
    assert.equal(calls.stay, 1);
    assert.equal(calls.leave, 1);
    modal.confirmExit(false);
    assert.equal(style("confirm", "display"), "none");
    assert.equal(env.document.activeElement, env.frame());
  });
});

describe("scroll y foco", () => {
  test("restaura un overflow previo con su prioridad", () => {
    env.document.documentElement.style.setProperty("overflow", "scroll", "important");
    const { modal } = build();
    modal.mount();
    assert.equal(env.document.documentElement.style.getPropertyValue("overflow"), "hidden");
    modal.destroy();
    assert.equal(env.document.documentElement.style.getPropertyValue("overflow"), "scroll");
    assert.equal(env.document.documentElement.style.getPropertyPriority("overflow"), "important");
  });

  test("saca la propiedad si no había", () => {
    const { modal } = build();
    modal.mount();
    modal.destroy();
    assert.equal(env.document.documentElement.style.getPropertyValue("overflow"), "");
    assert.equal(env.document.documentElement.style.values.has("overflow"), false);
  });

  test("devuelve el foco a un elemento que sigue en la página", () => {
    const opener = env.document.createElement("button");
    env.document.body.appendChild(opener);
    opener.focus();
    const { modal } = build();
    modal.mount();
    assert.equal(env.document.activeElement, env.need("close"));
    modal.destroy();
    assert.equal(env.document.activeElement, opener);
  });

  test("no le devuelve el foco a uno que ya no está", () => {
    const opener = env.document.createElement("button");
    env.document.body.appendChild(opener);
    opener.focus();
    const { modal } = build();
    modal.mount();
    env.document.body.removeChild(opener);
    const before = opener.focusCount;
    modal.destroy();
    assert.equal(opener.focusCount, before);
  });

  test("las guardas redirigen el foco", () => {
    const { modal } = build();
    modal.mount();
    env.need("guard-end").focus();
    assert.equal(env.document.activeElement, env.need("close"));
    env.need("guard-start").focus();
    assert.equal(env.document.activeElement, env.need("close"));
    modal.show("frame");
    env.need("guard-start").focus();
    assert.equal(env.document.activeElement, env.frame());
    modal.show("panel", { link: true, reason: "timeout", opened: false, bridge: false });
    env.need("guard-start").focus();
    assert.equal(env.document.activeElement, env.need("panel-link"));
  });

  test("destroy dos veces no hace nada la segunda, y saca los nodos", () => {
    const { modal } = build();
    modal.mount();
    modal.destroy();
    assert.equal(env.find("overlay"), null);
    assert.equal(modal.isConnected(), false);
    modal.destroy();
  });

  test("anillo de foco dibujado a mano", () => {
    const { modal } = build();
    modal.mount();
    const close = env.need("close");
    close.focusVisible = false;
    close.focus();
    assert.equal(close.style.getPropertyValue("outline"), "none");
    close.focusVisible = true;
    env.need("confirm-stay").focus();
    close.focus();
    assert.match(close.style.getPropertyValue("outline"), /^2px solid/);
    close.dispatch("blur");
    assert.equal(close.style.getPropertyValue("outline"), "none");
  });

  test("el botón de cerrar llama a onClose y el link a onTabLink", () => {
    const { modal, calls } = build();
    modal.mount();
    env.need("close").click();
    env.need("panel-link").click();
    assert.deepEqual(calls, { close: 1, link: 1, stay: 0, leave: 0 });
  });

  test("contains distingue adentro de afuera", () => {
    const { modal } = build();
    modal.mount();
    assert.equal(modal.contains(env.need("close")), true);
    assert.equal(modal.contains(env.document.body), false);
  });
});
