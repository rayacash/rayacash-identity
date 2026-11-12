// El ciclo de vida de una verificación abierta. Hay un solo flujo por página
// (`active`, compartido por todas las instancias de esta copia de la librería).
// Cada handler corre entero y mira primero que su sesión siga abierta.

import { EMBED_QUERY, HANDSHAKE_TIMEOUT_MS, IDENTITY_PATH } from "./constants.ts";
import { getDocument, getWindow, hooks, logError } from "./env.ts";
import { integrationError } from "./errors.ts";
import type {
  IdentityEvent,
  IdentityFallbackReason,
  IdentityHintStatus,
  IdentityOpenOptions,
  IdentityResult,
  RayaIdentityInstance,
  RayaIdentityOptions,
} from "./identity.d.ts";
import type { Modal } from "./modal.ts";
import { createModal } from "./modal.ts";
import { buildClose, buildInit, createNonce, readFrameMessage } from "./protocol.ts";
import { parseVerification, validateFactoryOptions, validateOpenOptions } from "./validate.ts";
import { VERSION } from "./version.ts";

type Phase = "loading" | "active" | "fallback" | "new_tab" | "closed";

const CAPTURE_STEPS = ["front", "back", "liveness"];
const UNAVAILABLE_STEP = "unavailable";

interface Session {
  id: string;
  origin: string;
  nonce: string;
  phase: Phase;
  reason: IdentityFallbackReason | null;
  ready: boolean;
  lastStep: string | null;
  unavailable: boolean;
  confirming: boolean;
  hint: IdentityHintStatus | null;
  onEvent: ((event: IdentityEvent) => void) | null;
  modal: Modal;
  timer: ReturnType<typeof setTimeout> | null;
  promise: Promise<IdentityResult>;
  resolve: (result: IdentityResult) => void;
  removeListeners: () => void;
}

let active: Session | null = null;

function clearTimer(session: Session): void {
  if (session.timer !== null) clearTimeout(session.timer);
  session.timer = null;
}

function result(id: string, hint: IdentityHintStatus | null): IdentityResult {
  return hint ? { status: "completed", verification: { id, status: hint } } : { status: "closed", verification: { id, status: null } };
}

function post(session: Session, data: Record<string, unknown>): void {
  try {
    const target = session.modal.iframe.contentWindow;
    if (target) target.postMessage(data, session.origin);
  } catch (_) {
    // Un iframe que ya no responde no corta el cierre.
  }
}

function finish(session: Session): void {
  if (session.phase === "closed") return;
  session.phase = "closed";
  if (active === session) active = null;
  clearTimer(session);
  session.removeListeners();
  post(session, buildClose(session.id, session.nonce));
  session.modal.destroy();
  session.resolve(result(session.id, session.hint));
}

// Solo eventos armados acá, congelados: nada de lo que manda el iframe pasa tal cual.
function emit(session: Session, event: IdentityEvent): void {
  if (session.phase === "closed" || !session.onEvent) return;
  Object.freeze(event.verification);
  Object.freeze(event);
  try {
    session.onEvent(event);
  } catch (error) {
    hooks.reportError(error);
  }
}

function hint(session: Session): { id: string; status: IdentityHintStatus | null } {
  return { id: session.id, status: session.hint };
}

function render(session: Session): void {
  if (session.phase === "closed") return;
  if (session.unavailable) session.modal.show("panel", { link: false });
  else if (session.phase === "loading") session.modal.show("loading");
  else if (session.phase === "active") session.modal.show("frame");
  else {
    session.modal.show("panel", {
      link: true,
      reason: session.reason as IdentityFallbackReason,
      opened: session.phase === "new_tab",
      bridge: session.ready,
    });
  }
}

function enterFallback(session: Session, reason: IdentityFallbackReason): void {
  session.phase = "fallback";
  session.reason = reason;
  render(session);
  emit(session, { type: "fallback", reason, verification: hint(session) });
}

function dismissConfirm(session: Session): void {
  if (!session.confirming) return;
  session.confirming = false;
  session.modal.confirmExit(false);
}

// X y Escape. En plena captura la primera vez pregunta: un toque de más perdería
// la sesión en curso. close() del integrador no pasa por acá.
function requestClose(session: Session): void {
  if (session.phase === "closed") return;
  if (!session.confirming && session.lastStep !== null && CAPTURE_STEPS.indexOf(session.lastStep) >= 0) {
    session.confirming = true;
    session.modal.confirmExit(true);
    return;
  }
  finish(session);
}

function onReady(session: Session): void {
  if (session.ready) return;
  session.ready = true;
  clearTimer(session);
  if (session.phase === "loading" || (session.phase === "fallback" && (session.reason === "timeout" || session.reason === "frame_blocked"))) {
    session.phase = "active";
  }
  render(session);
  emit(session, { type: "ready", verification: hint(session) });
}

function onStep(session: Session, step: string): void {
  if (!session.ready || step === session.lastStep) return;
  session.lastStep = step;
  const unavailable = step === UNAVAILABLE_STEP;
  if (unavailable !== session.unavailable) {
    session.unavailable = unavailable;
    render(session);
  }
  if (CAPTURE_STEPS.indexOf(step) < 0) dismissConfirm(session);
  emit(session, { type: "step", step, verification: hint(session) });
}

function onCompleted(session: Session, status: IdentityHintStatus): void {
  if (!session.ready) return;
  if (session.hint !== null && session.hint !== "processing") return;
  if (session.hint === status) return;
  session.hint = status;
  emit(session, { type: "completed", verification: { id: session.id, status } });
  // El final se vio en la otra pestaña: acá no queda nada que mirar.
  if (session.phase === "fallback" || session.phase === "new_tab") finish(session);
}

function onMessage(session: Session, event: MessageEvent): void {
  if (session.phase === "closed") return;
  const message = readFrameMessage(event, {
    origin: session.origin,
    frame: session.modal.iframe.contentWindow,
    id: session.id,
    nonce: session.nonce,
  });
  if (!message) return;
  if (message.type === "hello") post(session, buildInit(session.id, session.nonce));
  else if (message.type === "ready") onReady(session);
  else if (message.type === "step") onStep(session, message.step);
  else if (message.type === "completed") onCompleted(session, message.status);
  else if (message.type === "close") {
    if (session.ready) finish(session);
  } else if (session.ready && session.phase === "active" && session.hint === null) {
    enterFallback(session, message.reason);
  }
}

function onViolation(session: Session, event: SecurityPolicyViolationEvent): void {
  if (session.phase !== "loading" || event.disposition === "report") return;
  const directive = event.effectiveDirective || event.violatedDirective || "";
  if (!/^(frame-src|child-src|default-src)/.test(directive)) return;
  if (event.blockedURI !== session.origin && String(event.blockedURI).indexOf(session.origin + "/") !== 0) return;
  clearTimer(session);
  enterFallback(session, "frame_blocked");
}

function onTabLink(session: Session): void {
  if (session.phase !== "fallback") return;
  session.phase = "new_tab";
  render(session);
}

function addListeners(session: Session, win: Window, doc: Document): void {
  const message = (event: MessageEvent) => onMessage(session, event);
  const resize = () => session.modal.layout();
  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" || event.key === "Esc") requestClose(session);
  };
  const focusin = (event: FocusEvent) => {
    if (!session.modal.contains(event.target)) session.modal.focusFirst();
  };
  const violation = (event: SecurityPolicyViolationEvent) => onViolation(session, event);
  win.addEventListener("message", message);
  win.addEventListener("resize", resize);
  doc.addEventListener("keydown", keydown, true);
  doc.addEventListener("focusin", focusin);
  doc.addEventListener("securitypolicyviolation", violation);
  session.removeListeners = () => {
    win.removeEventListener("message", message);
    win.removeEventListener("resize", resize);
    doc.removeEventListener("keydown", keydown, true);
    doc.removeEventListener("focusin", focusin);
    doc.removeEventListener("securitypolicyviolation", violation);
  };
}

function openFlow(win: Window, doc: Document, id: string, origin: string, onEvent: Session["onEvent"]): Promise<IdentityResult> {
  const path = origin + IDENTITY_PATH + id;
  let resolve: Session["resolve"] = () => undefined;
  const promise = new Promise<IdentityResult>((done) => {
    resolve = done;
  });

  // Los callbacks del modal corren después de que `session` existe.
  let session: Session;
  let modal: Modal;
  try {
    modal = createModal(win, doc, {
      frameUrl: path + EMBED_QUERY,
      tabUrl: path,
      onClose: () => requestClose(session),
      onTabLink: () => onTabLink(session),
      onStay: () => dismissConfirm(session),
      onLeave: () => finish(session),
    });
  } catch (error) {
    logError("Raya Identity: error inesperado", error);
    return Promise.resolve(result(id, null));
  }

  session = {
    id,
    origin,
    nonce: createNonce(),
    phase: "loading",
    reason: null,
    ready: false,
    lastStep: null,
    unavailable: false,
    confirming: false,
    hint: null,
    onEvent,
    modal,
    timer: null,
    promise,
    resolve,
    removeListeners: () => undefined,
  };
  active = session;
  const opened = session;

  try {
    // El listener antes del iframe: su primer hello no se puede perder.
    addListeners(opened, win, doc);
    opened.modal.mount();
    opened.timer = setTimeout(() => {
      if (opened.phase === "loading") enterFallback(opened, "timeout");
    }, HANDSHAKE_TIMEOUT_MS);
  } catch (error) {
    logError("Raya Identity: error inesperado", error);
    finish(opened);
  }
  return promise;
}

export function createInstance(options?: RayaIdentityOptions): RayaIdentityInstance {
  const { origin } = validateFactoryOptions(options);

  function open(verification: string, openOptions?: IdentityOpenOptions): Promise<IdentityResult> {
    const win = getWindow();
    const doc = getDocument();
    if (!win || !doc) throw integrationError("open necesita un navegador: llamalo en el cliente (onMounted, useEffect), no durante el render del servidor.");
    if (!doc.body) throw integrationError("open necesita el <body> de la página: llamalo después de que cargue (por ejemplo, en el clic de un botón).");
    const { onEvent } = validateOpenOptions(openOptions);
    const id = parseVerification(verification, origin);

    // Un framework reemplazó el body: ese flujo ya no se ve.
    if (active && !active.modal.isConnected()) finish(active);
    if (active) {
      if (active.id === id && active.origin === origin) return active.promise;
      throw integrationError("ya hay una verificación abierta en esta página. Cerrala con close() antes de abrir otra.");
    }
    return openFlow(win, doc, id, origin, onEvent);
  }

  function close(): void {
    if (active) finish(active);
  }

  return Object.freeze({ open, close, version: VERSION });
}
