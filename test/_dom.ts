// DOM falso para los tests: lo justo que usa la librería, un log ordenado de cada
// mutación y trampas que tiran si el código toca algo prohibido (innerHTML, cssText,
// clases, <style>, window.open, storage, fetch). Cada test que abre un modal hace
// cumplir así "solo CSSOM", "sin fetch" y "sin storage".

export const ORIGIN = "https://raya.cash";
export const ID = "idv_" + "Ab3".repeat(8);
export const OTHER_ID = "idv_" + "Zz9".repeat(8);

function tripwire(what: string): never {
  throw new Error("tripwire: " + what);
}

export function last<T>(items: readonly T[]): T {
  if (!items.length) throw new Error("lista vacía");
  return items[items.length - 1] as T;
}

type Listener = (event: any) => void;

class FakeTarget {
  listeners: { type: string; fn: Listener; capture: boolean }[] = [];
  log: string[] = [];
  logName = "target";

  addEventListener(type: string, fn: Listener, capture?: boolean): void {
    this.log.push(`listen:${this.logName}:${type}`);
    this.listeners.push({ type, fn, capture: !!capture });
  }

  removeEventListener(type: string, fn: Listener, capture?: boolean): void {
    this.listeners = this.listeners.filter((entry) => !(entry.type === type && entry.fn === fn && entry.capture === !!capture));
  }

  listenerCount(type?: string): number {
    return this.listeners.filter((entry) => type === undefined || entry.type === type).length;
  }

  dispatch(type: string, event: Record<string, unknown> = {}): Record<string, unknown> {
    const full = { type, target: this, defaultPrevented: false, preventDefault() { full.defaultPrevented = true; }, ...event };
    for (const entry of this.listeners.slice()) {
      if (entry.type === type) entry.fn(full);
    }
    return full;
  }
}

export class FakeStyle {
  values = new Map<string, { value: string; priority: string }>();
  calls: { name: string; value: string; priority: string }[] = [];

  setProperty(name: string, value: string, priority = ""): void {
    this.calls.push({ name, value, priority });
    this.values.set(name, { value, priority });
  }

  getPropertyValue(name: string): string {
    return this.values.get(name)?.value ?? "";
  }

  getPropertyPriority(name: string): string {
    return this.values.get(name)?.priority ?? "";
  }

  removeProperty(name: string): string {
    const value = this.getPropertyValue(name);
    this.values.delete(name);
    return value;
  }

  get cssText(): string {
    return tripwire("style.cssText");
  }

  set cssText(_value: string) {
    tripwire("style.cssText");
  }
}

export class FakeElement extends FakeTarget {
  tagName: string;
  doc: FakeDocument;
  attributes = new Map<string, string>();
  style = new FakeStyle();
  children: FakeElement[] = [];
  parentNode: FakeElement | FakeDocument | null = null;
  ownText = "";
  focusVisible = true;
  focusCount = 0;

  constructor(tagName: string, doc: FakeDocument) {
    super();
    this.tagName = tagName.toUpperCase();
    this.doc = doc;
    this.log = doc.log;
    this.logName = tagName;
  }

  get name(): string {
    return this.attributes.get("data-raya-identity") ?? this.tagName.toLowerCase();
  }

  setAttribute(name: string, value: string): void {
    if (name === "style" || name === "class") tripwire("setAttribute " + name);
    this.log.push(`attr:${this.name}:${name}`);
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child: FakeElement): FakeElement {
    if (this.doc.failAppend && this === this.doc.body) throw new Error("appendChild falló");
    this.log.push(`append:${this.name}:${child.name}`);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: FakeElement): FakeElement {
    this.log.push(`remove:${this.name}:${child.name}`);
    this.children = this.children.filter((entry) => entry !== child);
    child.parentNode = null;
    return child;
  }

  remove(): void {
    const parent = this.parentNode;
    if (parent instanceof FakeElement) parent.removeChild(this);
  }

  contains(node: unknown): boolean {
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }

  get isConnected(): boolean {
    let node: FakeElement | FakeDocument | null = this;
    while (node instanceof FakeElement) node = node.parentNode;
    return node === this.doc;
  }

  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    this.children = [];
    this.ownText = value;
  }

  matches(_selector: string): boolean {
    return this.focusVisible;
  }

  focus(): void {
    this.focusCount++;
    const previous = this.doc.activeElement;
    if (previous instanceof FakeElement && previous !== this) previous.dispatch("blur");
    this.doc.activeElement = this;
    this.log.push(`focus:${this.name}`);
    this.dispatch("focus");
    this.doc.dispatch("focusin", { target: this });
  }

  click(): Record<string, unknown> {
    return this.dispatch("click");
  }

  get visibleStyle(): { display: string; visibility: string } {
    return { display: this.style.getPropertyValue("display"), visibility: this.style.getPropertyValue("visibility") };
  }

  get innerHTML(): string {
    return tripwire("innerHTML");
  }

  set innerHTML(_value: string) {
    tripwire("innerHTML");
  }

  get outerHTML(): string {
    return tripwire("outerHTML");
  }

  set outerHTML(_value: string) {
    tripwire("outerHTML");
  }

  insertAdjacentHTML(): void {
    tripwire("insertAdjacentHTML");
  }

  get className(): string {
    return tripwire("className");
  }

  set className(_value: string) {
    tripwire("className");
  }

  get classList(): unknown {
    return tripwire("classList");
  }
}

export class FakeFrameWindow {
  posted: { data: Record<string, unknown>; targetOrigin: string }[] = [];

  postMessage(data: Record<string, unknown>, targetOrigin: string): void {
    this.posted.push({ data, targetOrigin });
  }
}

export class FakeIframe extends FakeElement {
  frameWindow = new FakeFrameWindow();
  srcValue = "";

  get src(): string {
    return this.srcValue;
  }

  set src(value: string) {
    this.log.push("attr:frame:src");
    this.srcValue = value;
  }

  get contentWindow(): FakeFrameWindow | null {
    return this.isConnected ? this.frameWindow : null;
  }
}

export class FakeDocument extends FakeTarget {
  log: string[] = [];
  logName = "document";
  body: FakeElement;
  documentElement: FakeElement;
  activeElement: FakeElement | null = null;
  iframes: FakeIframe[] = [];
  failAppend = false;

  constructor() {
    super();
    this.documentElement = new FakeElement("html", this);
    this.documentElement.parentNode = this;
    this.body = new FakeElement("body", this);
    this.body.parentNode = this.documentElement;
    this.documentElement.children.push(this.body);
    this.activeElement = this.body;
  }

  createElement(tagName: string): FakeElement {
    if (tagName === "style" || tagName === "script" || tagName === "link") tripwire("createElement " + tagName);
    if (tagName === "iframe") {
      const iframe = new FakeIframe(tagName, this);
      this.iframes.push(iframe);
      return iframe;
    }
    return new FakeElement(tagName, this);
  }

  createTextNode(text: string): FakeElement {
    const node = new FakeElement("#text", this);
    node.ownText = text;
    return node;
  }

  write(): void {
    tripwire("document.write");
  }

  get cookie(): string {
    return tripwire("document.cookie");
  }

  set cookie(_value: string) {
    tripwire("document.cookie");
  }
}

export class FakeWindow extends FakeTarget {
  logName = "window";
  innerWidth: number;
  innerHeight: number;

  constructor(innerWidth: number, innerHeight: number) {
    super();
    this.innerWidth = innerWidth;
    this.innerHeight = innerHeight;
  }

  open(): void {
    tripwire("window.open");
  }

  get localStorage(): unknown {
    return tripwire("localStorage");
  }

  get sessionStorage(): unknown {
    return tripwire("sessionStorage");
  }
}

export interface EnvOptions {
  innerWidth?: number;
  innerHeight?: number;
}

export function createEnv(options: EnvOptions = {}) {
  const doc = new FakeDocument();
  const win = new FakeWindow(options.innerWidth ?? 1440, options.innerHeight ?? 900);
  win.log = doc.log;
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, PropertyDescriptor | undefined> = {};
  const GLOBAL_NAMES = ["window", "document", "fetch", "XMLHttpRequest"];

  function find(name: string, node: FakeElement = doc.body): FakeElement | null {
    if (node.getAttribute("data-raya-identity") === name) return node;
    for (const child of node.children) {
      const found = find(name, child);
      if (found) return found;
    }
    return null;
  }

  function need(name: string): FakeElement {
    const element = find(name);
    if (!element) throw new Error("no está en el DOM: " + name);
    return element;
  }

  function frame(): FakeIframe {
    return last(doc.iframes);
  }

  function inits(): Record<string, unknown>[] {
    return frame().frameWindow.posted.filter((entry) => entry.data.type === "init").map((entry) => entry.data);
  }

  function nonce(): string {
    const all = inits();
    return all.length ? String(last(all).nonce) : "";
  }

  function message(overrides: { origin?: unknown; source?: unknown; data?: Record<string, unknown> } = {}) {
    return {
      origin: "origin" in overrides ? overrides.origin : ORIGIN,
      source: "source" in overrides ? overrides.source : frame().frameWindow,
      data: { source: "raya-identity", v: 1, id: ID, nonce: nonce(), ...overrides.data },
    };
  }

  function deliver(event: { origin: unknown; source: unknown; data: unknown }): void {
    win.dispatch("message", event);
  }

  function post(type: string, extra: Record<string, unknown> = {}): void {
    deliver(message({ data: { type, ...extra } }));
  }

  // hello + ready: el handshake completo.
  function handshake(): void {
    post("hello");
    post("ready");
  }

  return {
    window: win,
    document: doc,
    log: doc.log,
    find,
    need,
    frame,
    inits,
    nonce,
    message,
    deliver,
    post,
    handshake,
    install(): void {
      for (const name of GLOBAL_NAMES) saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
      globals.window = win;
      globals.document = doc;
      globals.fetch = () => tripwire("fetch");
      globals.XMLHttpRequest = function () {
        tripwire("XMLHttpRequest");
      };
    },
    uninstall(): void {
      for (const name of GLOBAL_NAMES) {
        const descriptor = saved[name];
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globals[name];
      }
    },
    key(name: string): void {
      doc.dispatch("keydown", { key: name });
    },
    violation(fields: Record<string, unknown>): void {
      doc.dispatch("securitypolicyviolation", fields);
    },
    resize(width: number, height: number): void {
      win.innerWidth = width;
      win.innerHeight = height;
      win.dispatch("resize");
    },
  };
}

export type Env = ReturnType<typeof createEnv>;
