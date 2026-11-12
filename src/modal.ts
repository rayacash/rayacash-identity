// La ventana sobre la página del integrador. Solo CSSOM: elementos con
// createElement, texto con textContent y estilos con setProperty. Nunca innerHTML,
// un <style>, el atributo style ni clases: así funciona bajo una CSP sin
// 'unsafe-inline' y no hay sink de Trusted Types. Nada toca window ni document al
// importar: createModal los recibe.

import {
  BAR_HEIGHT,
  CARD_HEIGHT,
  CARD_MARGIN,
  CARD_WIDTH,
  COMPACT_MAX_HEIGHT,
  COMPACT_MAX_WIDTH,
  IFRAME_ALLOW,
  IFRAME_REFERRER_POLICY,
  Z_INDEX,
} from "./constants.ts";
import type { IdentityFallbackReason } from "./identity.d.ts";

export type ModalView = "loading" | "frame" | "panel";

export type PanelState = { link: false } | { link: true; reason: IdentityFallbackReason; opened: boolean; bridge: boolean };

export interface Modal {
  readonly iframe: HTMLIFrameElement;
  mount(): void;
  show(view: ModalView, panel?: PanelState): void;
  confirmExit(open: boolean): void;
  layout(): void;
  contains(node: unknown): boolean;
  isConnected(): boolean;
  focusFirst(): void;
  destroy(): void;
}

export interface ModalConfig {
  frameUrl: string;
  tabUrl: string;
  onClose(): void;
  onTabLink(): void;
  onStay(): void;
  onLeave(): void;
}

const DIALOG_LABEL = "Verificación de identidad";
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const WHITE = "#ffffff";
const BACKDROP = "rgba(17, 24, 39, 0.6)";

const REASON_COPY: Record<IdentityFallbackReason, { title: string; text: string }> = {
  timeout: { title: "Está tardando más de lo normal", text: "Podés esperar un momento o abrir la verificación en una pestaña nueva." },
  frame_blocked: { title: "No pudimos cargar la verificación acá", text: "Abrila en una pestaña nueva para continuar." },
  camera_blocked: { title: "Seguí en una pestaña nueva", text: "Desde acá no podemos usar la cámara." },
  storage_blocked: { title: "Seguí en una pestaña nueva", text: "Tu navegador no nos deja continuar la verificación acá." },
  unsupported: {
    title: "Seguí en una pestaña nueva",
    text: "Desde acá no podemos verificar tu identidad. Si estás dentro de una app, abrí el link en Chrome o Safari.",
  },
};

interface PanelCopy {
  title: string;
  text: string;
  hint: string;
  link: string;
}

// Qué dice el panel según por qué está abierto. Un motivo de la librería (timeout,
// frame_blocked) no sugiere que la otra pestaña ya exista.
function panelCopy(state: PanelState): PanelCopy {
  if (!state.link) return { title: "Este link ya no está disponible", text: "Pedile uno nuevo a quien te lo envió.", hint: "", link: "" };
  if (state.opened) {
    return {
      title: "Seguí en la pestaña nueva",
      text: "",
      hint: state.bridge ? "Cuando termines, volvé a esta pestaña: se actualiza sola." : "Cuando termines, volvé a esta pestaña y cerrá esta ventana.",
      link: "Abrir de nuevo",
    };
  }
  const copy = REASON_COPY[state.reason];
  const fromFrame = state.reason !== "timeout" && state.reason !== "frame_blocked";
  return { title: copy.title, text: copy.text, hint: fromFrame ? "Si ya la abriste, terminá ahí: esta ventana se actualiza sola." : "", link: "Abrir en una pestaña nueva" };
}

function put(element: HTMLElement, name: string, value: string): void {
  element.style.setProperty(name, value, "important");
}

// `all: initial` y después lo propio, todo con !important: una regla de la página
// (un reset, `button {}`) no le gana a un inline important.
function css(element: HTMLElement, declarations: Record<string, string>): void {
  put(element, "all", "initial");
  put(element, "box-sizing", "border-box");
  put(element, "font-family", FONT);
  put(element, "font-size", "14px");
  put(element, "line-height", "1.4");
  put(element, "color", INK);
  for (const name of Object.keys(declarations)) put(element, name, declarations[name] as string);
}

const FILL: Record<string, string> = { position: "absolute", top: "0", right: "0", bottom: "0", left: "0" };

const BUTTON: Record<string, string> = {
  display: "inline-block",
  cursor: "pointer",
  background: "transparent",
  "border-radius": "8px",
  "text-align": "center",
  "white-space": "nowrap",
};

// `all: initial` también saca el anillo de foco del navegador, y un estilo inline
// no puede usar :focus-visible: se dibuja a mano solo cuando el navegador lo mostraría.
function focusRing(element: HTMLElement): void {
  element.addEventListener("focus", () => {
    let visible = true;
    try {
      visible = element.matches(":focus-visible");
    } catch (_) {
      visible = true;
    }
    put(element, "outline", visible ? `2px solid ${INK}` : "none");
  });
  element.addEventListener("blur", () => put(element, "outline", "none"));
}

export function createModal(win: Window, doc: Document, config: ModalConfig): Modal {
  function div(name: string, declarations: Record<string, string>): HTMLElement {
    const element = doc.createElement("div");
    element.setAttribute("data-raya-identity", name);
    css(element, declarations);
    return element;
  }

  function button(name: string, text: string, declarations: Record<string, string>, onClick: () => void): HTMLButtonElement {
    const element = doc.createElement("button");
    element.setAttribute("data-raya-identity", name);
    element.setAttribute("type", "button");
    css(element, { ...BUTTON, ...declarations });
    element.textContent = text;
    element.addEventListener("click", onClick);
    focusRing(element);
    return element;
  }

  const overlay = div("overlay", {
    position: "fixed",
    top: "0",
    right: "0",
    bottom: "0",
    left: "0",
    display: "flex",
    "align-items": "center",
    "justify-content": "center",
    background: BACKDROP,
    "z-index": Z_INDEX,
    "overscroll-behavior": "contain",
  });
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", DIALOG_LABEL);

  const guardStart = div("guard-start", { display: "block", width: "0", height: "0" });
  const guardEnd = div("guard-end", { display: "block", width: "0", height: "0" });
  guardStart.setAttribute("tabindex", "0");
  guardEnd.setAttribute("tabindex", "0");

  const card = div("card", { position: "relative", display: "flex", "flex-direction": "column", background: WHITE, overflow: "hidden" });

  const bar = div("bar", {
    display: "flex",
    "align-items": "center",
    "justify-content": "space-between",
    flex: `0 0 ${BAR_HEIGHT}px`,
    height: `${BAR_HEIGHT}px`,
    padding: "0 6px 0 16px",
    "border-bottom": `1px solid ${LINE}`,
  });
  const title = doc.createElement("span");
  css(title, { display: "block", "font-weight": "600", overflow: "hidden", "white-space": "nowrap", "text-overflow": "ellipsis" });
  title.textContent = DIALOG_LABEL;

  const confirmRow = div("confirm", { display: "none", "align-items": "center", "min-width": "0" });
  const confirmText = doc.createElement("span");
  css(confirmText, { display: "block", "font-weight": "600", "white-space": "nowrap", "margin-right": "8px" });
  confirmText.textContent = "¿Salir de la verificación?";
  const stayButton = button("confirm-stay", "Seguir", { padding: "4px 10px", background: INK, color: WHITE }, config.onStay);
  const leaveButton = button("confirm-leave", "Salir", { padding: "4px 10px", "margin-left": "4px" }, config.onLeave);
  confirmRow.appendChild(confirmText);
  confirmRow.appendChild(stayButton);
  confirmRow.appendChild(leaveButton);

  const closeButton = button("close", "×", { width: "32px", height: "32px", "font-size": "20px", "line-height": "32px", flex: "0 0 32px" }, config.onClose);
  closeButton.setAttribute("aria-label", "Cerrar");
  bar.appendChild(title);
  bar.appendChild(confirmRow);
  bar.appendChild(closeButton);

  const body = div("body", { position: "relative", display: "block", flex: "1 1 auto", "min-height": "0", background: WHITE });

  const loading = div("loading", { ...FILL, display: "flex", "align-items": "center", "justify-content": "center", color: MUTED });
  loading.setAttribute("role", "status");
  loading.textContent = "Cargando…";

  const iframe = doc.createElement("iframe");
  iframe.setAttribute("data-raya-identity", "frame");
  // allow antes que src: la delegación de la cámara se decide al navegar.
  iframe.setAttribute("allow", IFRAME_ALLOW);
  iframe.setAttribute("title", DIALOG_LABEL);
  // Una política floja de la página no le manda a Raya su ruta ni su query.
  iframe.setAttribute("referrerpolicy", IFRAME_REFERRER_POLICY);
  iframe.src = config.frameUrl;
  // Oculto es visibility, nunca display none ni sacarlo: la página alojada mide su
  // viewport al arrancar y después de un fallback es el puente que avisa el final.
  css(iframe, { ...FILL, display: "block", width: "100%", height: "100%", border: "0", background: WHITE, "color-scheme": "light", visibility: "hidden" });

  const panel = div("panel", {
    ...FILL,
    display: "none",
    "flex-direction": "column",
    "align-items": "center",
    "justify-content": "center",
    padding: "24px",
    "text-align": "center",
  });
  const panelTitle = div("panel-title", { display: "block", "font-size": "18px", "font-weight": "600" });
  panelTitle.setAttribute("role", "heading");
  panelTitle.setAttribute("aria-level", "2");
  const panelText = div("panel-text", { display: "block", "margin-top": "8px", color: MUTED });
  panelText.setAttribute("role", "status");
  const panelLink = doc.createElement("a");
  panelLink.setAttribute("data-raya-identity", "panel-link");
  panelLink.setAttribute("href", config.tabUrl);
  panelLink.setAttribute("target", "_blank");
  panelLink.setAttribute("rel", "noopener noreferrer");
  css(panelLink, { display: "inline-block", "margin-top": "16px", padding: "10px 16px", "border-radius": "8px", background: INK, color: WHITE, cursor: "pointer" });
  panelLink.addEventListener("click", config.onTabLink);
  focusRing(panelLink);
  const panelHint = div("panel-hint", { display: "block", "margin-top": "12px", "font-size": "13px", color: MUTED });
  panel.appendChild(panelTitle);
  panel.appendChild(panelText);
  panel.appendChild(panelLink);
  panel.appendChild(panelHint);

  body.appendChild(loading);
  body.appendChild(iframe);
  body.appendChild(panel);
  card.appendChild(bar);
  card.appendChild(body);
  overlay.appendChild(guardStart);
  overlay.appendChild(card);
  overlay.appendChild(guardEnd);

  let view: ModalView = "loading";
  let panelLinked = false;
  let confirming = false;
  let mounted = false;
  let destroyed = false;
  let previousFocus: Element | null = null;
  let scrollValue = "";
  let scrollPriority = "";

  function focusElement(element: { focus(): void }): void {
    try {
      element.focus();
    } catch (_) {
      // Un elemento que no se puede enfocar no corta el flujo.
    }
  }

  // Lo último del recorrido con Tab, y adonde vuelve el foco al descartar la confirmación.
  function focusContent(): void {
    if (view === "frame") focusElement(iframe);
    else if (view === "panel" && panelLinked) focusElement(panelLink);
    else focusElement(closeButton);
  }

  guardStart.addEventListener("focus", focusContent);
  guardEnd.addEventListener("focus", () => focusElement(closeButton));

  function layout(): void {
    const width = win.innerWidth;
    const height = win.innerHeight;
    if (width < COMPACT_MAX_WIDTH || height < COMPACT_MAX_HEIGHT) {
      put(card, "width", "100%");
      put(card, "height", "100%");
      // Después de 100%: un navegador sin dvh ignora esta declaración.
      put(card, "height", "100dvh");
      put(card, "border-radius", "0");
      put(card, "padding", "env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)");
      return;
    }
    put(card, "width", `${CARD_WIDTH}px`);
    put(card, "height", `${Math.min(CARD_HEIGHT, height - CARD_MARGIN * 2)}px`);
    put(card, "border-radius", "16px");
    put(card, "padding", "0");
  }

  function fillPanel(state: PanelState): void {
    const copy = panelCopy(state);
    panelTitle.textContent = copy.title;
    panelText.textContent = copy.text;
    panelHint.textContent = copy.hint;
    panelLink.textContent = copy.link;
    put(panelText, "display", copy.text ? "block" : "none");
    put(panelHint, "display", copy.hint ? "block" : "none");
    put(panelLink, "display", copy.link ? "inline-block" : "none");
  }

  return {
    iframe,

    mount() {
      doc.body.appendChild(overlay);
      mounted = true;
      const rootStyle = doc.documentElement.style;
      scrollValue = rootStyle.getPropertyValue("overflow");
      scrollPriority = rootStyle.getPropertyPriority("overflow");
      rootStyle.setProperty("overflow", "hidden", "important");
      previousFocus = doc.activeElement;
      layout();
      focusElement(closeButton);
    },

    show(next, state) {
      const linked = next === "panel" && !!state && state.link;
      const changed = next !== view || linked !== panelLinked;
      view = next;
      panelLinked = linked;
      put(loading, "display", next === "loading" ? "flex" : "none");
      put(iframe, "visibility", next === "frame" ? "visible" : "hidden");
      put(panel, "display", next === "panel" ? "flex" : "none");
      if (next === "panel" && state) fillPanel(state);
      // Refrescar el mismo panel no le saca el foco a nadie.
      if (changed && !confirming) focusContent();
    },

    confirmExit(open) {
      if (open === confirming) return;
      confirming = open;
      put(title, "display", open ? "none" : "block");
      put(confirmRow, "display", open ? "flex" : "none");
      if (open) focusElement(stayButton);
      else focusContent();
    },

    layout,

    contains(node) {
      return overlay.contains(node as Node | null);
    },

    isConnected() {
      return overlay.isConnected;
    },

    focusFirst() {
      focusElement(closeButton);
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (!mounted) return;
      const rootStyle = doc.documentElement.style;
      if (scrollValue) rootStyle.setProperty("overflow", scrollValue, scrollPriority);
      else rootStyle.removeProperty("overflow");
      const focusBack = previousFocus as (Element & { focus?: unknown }) | null;
      if (focusBack && focusBack.isConnected && typeof focusBack.focus === "function") focusElement(focusBack as unknown as HTMLElement);
    },
  };
}
