// Build de Raya Identity.js (el paquete rayacash-identity) con el esbuild y el
// TypeScript de este paquete: los resuelve en su propio node_modules (npm install).
//
//   node build.mjs           dist/ y los chequeos:
//                              identity.mjs + identity.d.mts  ESM (import), sin efectos al importar
//                              identity.cjs + identity.d.cts  CommonJS (require), sin efectos
//                              identity.js + identity.d.ts    IIFE: el que se sube al CDN de Raya
//                                                             (CDN_BASE) para cargarlo con un
//                                                             <script>; deja RayaIdentity en window
//                              identity.debug.js + .map       el IIFE sin minificar
//                            Al final imprime el <script> del CDN: el de v<mayor> y el de la
//                            versión exacta con su integrity, más el integrity de identity.mjs.
//   node build.mjs --release lo mismo, y además la entrada de la versión en el CHANGELOG tiene que
//                            estar lista para publicar: sin «sin publicar» y con el integrity
//                            de identity.js (el que fijan los sitios en el <script> del CDN).
//                            Lo corre release.yml antes de publicar en npm.
//   node build.mjs --serve   lo mismo, y después watch + la demo en
//                            http://127.0.0.1:${IDENTITY_JS_DEMO_PORT || 5051}/demo/
//
// Cualquier chequeo que falla corta el build con exit 1. El banner no lleva
// fecha: el mismo código da los mismos bytes y el mismo integrity.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { gzipSync } from "node:zlib";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");
const PACKAGE_NAME = "rayacash-identity";
const EXPECTED_ESBUILD = "0.25.9";
const EXPECTED_TYPESCRIPT = "5.9.2";
// El host del CDN está acá y en un solo lugar: cambiarlo es esta línea + rebuild.
// dist/identity.js se sirve en CDN_BASE/v<X.Y.Z>/ (inmutable) y en CDN_BASE/v<mayor>/
// (la última de esa mayor). test/docs.test.ts lee esta línea.
const CDN_BASE = "https://js.raya.cash/identity";
const MAX_GZIP_BYTES = 8 * 1024;

function fail(message) {
  console.error(`${PACKAGE_NAME} build: ${message}`);
  process.exit(1);
}

// esbuild y typescript salen siempre de ROOT/node_modules: nunca de una carpeta de
// más arriba que por casualidad los tenga.
const requireHere = createRequire(path.join(ROOT, "package.json"));

function localDependency(name) {
  let file = "";
  try {
    file = requireHere.resolve(name);
  } catch {
    fail(`no encuentro ${name}: corré npm install en ${ROOT}.`);
  }
  if (!file.startsWith(path.join(ROOT, "node_modules") + path.sep)) {
    fail(`${name} se resolvió fuera de este paquete (${file}): corré npm install en ${ROOT}.`);
  }
  return requireHere(file);
}

const esbuild = localDependency("esbuild");
const ts = localDependency("typescript");

const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const VERSION = pkg.version;
const MAJOR = VERSION.split(".")[0];
const BANNER = `/*! Raya Identity.js v${VERSION} | ${PACKAGE_NAME} | https://raya.cash */`;

// Los comentarios en castellano de identity.d.ts pasan a ASCII en dist: toda la
// salida es ASCII, así se puede servir con cualquier charset. El código JS no
// necesita esto: esbuild escapa los strings con charset "ascii".
const ASCII_FOLD = {
  "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ü": "u", "ñ": "n",
  "Á": "A", "É": "E", "Í": "I", "Ó": "O", "Ú": "U", "Ü": "U", "Ñ": "N",
  "¿": "", "¡": "", "›": ">", "…": "...", "—": "-", "–": "-", "“": '"', "”": '"', "‘": "'", "’": "'",
  " ": " ", "·": "-", "±": "+/-",
  "«": '"', "»": '"', "→": "->", "×": "x",
};

// dist/identity.d.ts es la del <script>: dist/identity.js deja RayaIdentity en
// window, así que suma el global (si no, `RayaIdentity(...)` no compila sin
// import). identity.d.mts e identity.d.cts quedan como módulos: identity.mjs e
// identity.cjs no tocan window.
const SCRIPT_GLOBAL = `
// <script> (dist/identity.js): RayaIdentity es un global.
declare global {
  var RayaIdentity: RayaIdentityStatic;
}
`;

// Cómo usa los tipos un integrador: con el <script> (identity.d.ts y el global),
// como módulo (import, identity.d.mts) y con require (identity.d.cts). Cada
// ejemplo compila en su propio programa, al lado de dist/ y en memoria.
const BUNDLER = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
const NODE16 = { module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16 };
const TYPE_SAMPLES = {
  "script-usage.ts": {
    options: BUNDLER,
    text: [
      '/// <reference path="./identity.d.ts" />',
      "const identity = RayaIdentity();",
      'const fromWindow = new window.RayaIdentity({ baseUrl: "https://otro.raya.cash" });',
      "const versions: string[] = [RayaIdentity.version, identity.version, fromWindow.version];",
      'identity.open("idv_x", { onEvent: (event) => (event.type === "step" ? event.step : event.verification.id) })',
      '  .then((result) => (result.status === "completed" ? result.verification.status : result.verification.id));',
      "identity.close();",
    ],
  },
  "module-usage.ts": {
    options: BUNDLER,
    text: [
      'import RayaIdentity, { RayaIdentity as Named, type IdentityEvent, type IdentityResult } from "./identity.mjs";',
      "const seen: IdentityEvent[] = [];",
      'export const done: Promise<IdentityResult> = RayaIdentity().open("idv_x", { onEvent: (event) => void seen.push(event) });',
      "export const same: boolean = Named === RayaIdentity && Named.version === new Named().version;",
    ],
  },
  "require-usage.cts": {
    options: NODE16,
    text: [
      'import identity = require("./identity.cjs");',
      'import type { IdentityEvent, IdentityResult } from "./identity.cjs";',
      "const { RayaIdentity } = identity;",
      "const seen: IdentityEvent[] = [];",
      'export const done: Promise<IdentityResult> = RayaIdentity({ baseUrl: "https://otro.raya.cash" }).open("idv_x", {',
      "  onEvent: (event) => void seen.push(event),",
      "});",
      "export const same: boolean = identity.default === RayaIdentity && typeof RayaIdentity.IntegrationError === 'function';",
    ],
  },
};

function shared() {
  return {
    absWorkingDir: ROOT,
    bundle: true,
    platform: "browser",
    target: ["es2017"],
    charset: "ascii",
    legalComments: "none",
    treeShaking: true,
    tsconfig: path.join(ROOT, "tsconfig.json"),
    define: { __RAYA_VERSION__: JSON.stringify(VERSION) },
    banner: { js: BANNER },
    logLevel: "warning",
  };
}

// El IIFE va sin globalName: expondría { default } en vez de la función.
const OUTPUTS = {
  min: { ...shared(), entryPoints: [path.join(ROOT, "src/global.ts")], outfile: path.join(DIST, "identity.js"), format: "iife", minify: true },
  debug: {
    ...shared(),
    entryPoints: [path.join(ROOT, "src/global.ts")],
    outfile: path.join(DIST, "identity.debug.js"),
    format: "iife",
    minify: false,
    sourcemap: "linked",
    sourcesContent: true,
  },
  esm: { ...shared(), entryPoints: [path.join(ROOT, "src/index.ts")], outfile: path.join(DIST, "identity.mjs"), format: "esm", minify: true },
  // El footer es la anotación que esbuild agrega solo con platform "node": le dice
  // al cjs-module-lexer de Node qué nombres exporta el archivo (nunca se ejecuta).
  cjs: {
    ...shared(),
    entryPoints: [path.join(ROOT, "src/index.ts")],
    outfile: path.join(DIST, "identity.cjs"),
    format: "cjs",
    minify: true,
    footer: { js: "0&&(module.exports={RayaIdentity});" },
  },
};

function checkSetup() {
  if (pkg.name !== PACKAGE_NAME) fail(`package.json no es el de ${PACKAGE_NAME} (es ${pkg.name})`);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(VERSION)) fail(`la versión de package.json no es semver: ${VERSION}`);
  if (!/^https:\/\/[a-z0-9.-]+(?:\/[a-z0-9._-]+)*$/.test(CDN_BASE)) fail(`CDN_BASE tiene que ser https y sin barra al final (es ${CDN_BASE})`);
  if (esbuild.version !== EXPECTED_ESBUILD) console.warn(`${PACKAGE_NAME} build: esbuild ${esbuild.version} (se probó con ${EXPECTED_ESBUILD}); revisá el integrity.`);
  if (ts.version !== EXPECTED_TYPESCRIPT) console.warn(`${PACKAGE_NAME} build: TypeScript ${ts.version} (se probó con ${EXPECTED_TYPESCRIPT}).`);
}

// Solo se borra ROOT/dist, y nunca si es un symlink.
function cleanDist() {
  assert.equal(DIST, path.join(ROOT, "dist"));
  let stat = null;
  try {
    stat = lstatSync(DIST);
  } catch {
    stat = null;
  }
  if (stat && stat.isSymbolicLink()) fail(`${DIST} es un symlink: no lo borro`);
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST);
}

function toAscii(text, file) {
  const folded = text.replace(/[^\x00-\x7f]/g, (char) => {
    if (Object.prototype.hasOwnProperty.call(ASCII_FOLD, char)) return ASCII_FOLD[char];
    fail(`${file}: "${char}" (U+${char.codePointAt(0).toString(16).toUpperCase()}) no tiene equivalente ASCII en ASCII_FOLD`);
    return char;
  });
  return folded;
}

// El source map trae sourcesContent con el TS original (con tildes): se
// escapan como \uXXXX dentro de los strings del JSON, que es equivalente.
function asciiSourceMap(file) {
  const text = readFileSync(file, "utf8");
  JSON.parse(text);
  const escaped = text.replace(/[^\x00-\x7f]/g, (char) => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"));
  assert.deepEqual(JSON.parse(escaped), JSON.parse(text));
  writeFileSync(file, escaped);
}

function writeTypes() {
  const source = readFileSync(path.join(ROOT, "src/identity.d.ts"), "utf8");
  if (!source.includes("__RAYA_VERSION__")) fail("src/identity.d.ts no tiene __RAYA_VERSION__ en el banner");
  const text = toAscii(source.split("__RAYA_VERSION__").join(VERSION), "src/identity.d.ts");
  writeFileSync(path.join(DIST, "identity.d.ts"), text + SCRIPT_GLOBAL);
  // Los dos módulos exportan lo mismo (default y RayaIdentity): identity.cjs
  // también, como exports.default y exports.RayaIdentity.
  writeFileSync(path.join(DIST, "identity.d.mts"), text);
  writeFileSync(path.join(DIST, "identity.d.cts"), text);
}

// Los ejemplos de TYPE_SAMPLES, en memoria al lado de dist/ (no se escriben).
function checkTypes() {
  const formatHost = { getCanonicalFileName: (file) => file, getCurrentDirectory: () => DIST, getNewLine: () => "\n" };
  for (const [name, sample] of Object.entries(TYPE_SAMPLES)) {
    const options = {
      target: ts.ScriptTarget.ES2017,
      lib: ["lib.es2017.d.ts", "lib.dom.d.ts"],
      strict: true,
      noEmit: true,
      types: [],
      skipDefaultLibCheck: true,
      ...sample.options,
    };
    const file = path.join(DIST, name);
    const text = sample.text.join("\n");
    const host = ts.createCompilerHost(options);
    const { fileExists, readFile, getSourceFile } = host;
    host.fileExists = (candidate) => candidate === file || fileExists.call(host, candidate);
    host.readFile = (candidate) => (candidate === file ? text : readFile.call(host, candidate));
    host.getSourceFile = (candidate, language, ...rest) =>
      candidate === file ? ts.createSourceFile(candidate, text, language, true) : getSourceFile.call(host, candidate, language, ...rest);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([file], options, host));
    if (diagnostics.length) fail(`los tipos no compilan (${name}):\n${ts.formatDiagnostics(diagnostics, formatHost)}`);
  }
}

function checkAscii() {
  for (const name of readdirSync(DIST)) {
    const bytes = readFileSync(path.join(DIST, name));
    const index = bytes.findIndex((byte) => byte > 0x7f);
    if (index >= 0) fail(`dist/${name} no es ASCII (byte ${index})`);
  }
}

function thrownBy(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

// dist/identity.js en un contexto aislado de node:vm, como lo cargaría un
// <script>, y sin document: prueba que no lo busca antes de tiempo.
function smokeTestIife(code) {
  const warnings = [];
  let documentReads = 0;
  const sandbox = {
    console: { warn: (...args) => warnings.push(args.join(" ")), error() {}, log() {} },
    URL,
  };
  sandbox.window = sandbox;
  Object.defineProperty(sandbox, "document", {
    get() {
      documentReads++;
      return undefined;
    },
    configurable: true,
  });
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "identity.js" });

  const RayaIdentity = sandbox.RayaIdentity;
  assert.equal(typeof RayaIdentity, "function", "window.RayaIdentity no es una función");
  assert.equal(RayaIdentity.version, VERSION, "RayaIdentity.version no coincide con package.json");
  assert.equal(typeof RayaIdentity.IntegrationError, "function", "falta RayaIdentity.IntegrationError");

  const instance = RayaIdentity();
  const otro = new RayaIdentity({ baseUrl: "https://otro.raya.cash" });
  for (const created of [instance, otro]) {
    assert.ok(Object.isFrozen(created), "la instancia no está congelada");
    assert.equal(typeof created.open, "function", "falta open");
    assert.equal(typeof created.close, "function", "falta close");
    assert.equal(created.version, VERSION);
  }
  assert.equal(documentReads, 0, "crear una instancia leyó document");

  const secret = "raya_sk_live_" + "Ab3".repeat(16);
  const cases = [
    () => RayaIdentity({ baseUrl: "https://example.com" }),
    () => RayaIdentity({ baseURL: "https://raya.cash" }),
    () => RayaIdentity(secret),
    () => instance.open("idv_" + "Ab3".repeat(8)),
  ];
  for (const run of cases) {
    const thrown = thrownBy(run);
    assert.ok(thrown, "un error de integración no tiró");
    assert.equal(thrown.name, "IntegrationError");
    assert.ok(!String(thrown.message).includes(secret.slice(13)), "el mensaje incluye la clave");
  }
  instance.close();

  // Doble carga, misma versión: se queda la primera, sin aviso.
  vm.runInContext(code, sandbox, { filename: "identity.js" });
  assert.equal(sandbox.RayaIdentity, RayaIdentity, "la segunda carga reemplazó a la primera");
  assert.equal(warnings.length, 0, "la segunda carga (misma versión) avisó");

  // Otra versión: se queda la primera y avisa.
  const quoted = JSON.stringify(VERSION);
  const occurrences = code.split(quoted).length - 1;
  assert.ok(occurrences >= 1, "no encuentro la versión en dist/identity.js");
  vm.runInContext(code.split(quoted).join(JSON.stringify(VERSION + "-otra")), sandbox, { filename: "identity-otra.js" });
  assert.equal(sandbox.RayaIdentity, RayaIdentity, "otra versión reemplazó a la primera");
  assert.equal(warnings.length, 1, "otra versión no avisó");
}

// Cuenta las lecturas de window y document mientras corre `run`: importar o
// requerir los módulos y crear instancias no tiene que leer ninguno (SSR).
async function countingBrowserGlobals(run) {
  const names = ["window", "document"];
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(globalThis, name)) throw new Error(`este Node ya tiene ${name} global`);
  }
  const reads = { window: 0, document: 0 };
  for (const name of names) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        reads[name]++;
        return undefined;
      },
    });
  }
  try {
    await run();
  } finally {
    for (const name of names) delete globalThis[name];
  }
  return reads;
}

function checkModule(name, mod) {
  assert.equal(typeof mod.default, "function", `${name} no exporta una función por default`);
  assert.equal(mod.RayaIdentity, mod.default, `${name}: RayaIdentity y default no son lo mismo`);
  assert.equal(mod.default.version, VERSION, `${name}: la versión no coincide con package.json`);
  assert.equal(typeof mod.default.IntegrationError, "function", `${name}: falta IntegrationError`);
  const instance = mod.RayaIdentity();
  const otro = new mod.RayaIdentity({ baseUrl: "https://otro.raya.cash" });
  for (const created of [instance, otro]) {
    assert.ok(Object.isFrozen(created), `${name}: la instancia no está congelada`);
    assert.deepEqual(Object.keys(created).sort(), ["close", "open", "version"], `${name}: la instancia no tiene open, close y version`);
  }
  instance.close();
}

// identity.mjs con import() e identity.cjs con el require de Node, como los
// cargaría un servidor durante el SSR: sin efectos al cargarlos ni al crear una
// instancia, y open() fuera del navegador tira un IntegrationError.
async function smokeTestModules() {
  const cjsFile = path.join(DIST, "identity.cjs");
  const loaded = {};
  const reads = await countingBrowserGlobals(async () => {
    loaded.esm = await import(`${pathToFileURL(path.join(DIST, "identity.mjs")).href}?check=${Date.now()}`);
    delete requireHere.cache[cjsFile];
    loaded.cjs = requireHere(cjsFile);
    checkModule("identity.mjs", loaded.esm);
    checkModule("identity.cjs", loaded.cjs);
  });
  assert.deepEqual(reads, { window: 0, document: 0 }, "cargar los módulos o crear una instancia leyó window o document");
  assert.equal(Object.prototype.hasOwnProperty.call(globalThis, "RayaIdentity"), false, "cargar los módulos dejó RayaIdentity global");
  // import() de identity.cjs (Node lo lee con cjs-module-lexer) también ve el nombre.
  const cjsFromEsm = await import(pathToFileURL(cjsFile).href);
  assert.equal(cjsFromEsm.RayaIdentity, loaded.cjs.RayaIdentity, "import() de identity.cjs no ve RayaIdentity");
  for (const [name, mod] of [["identity.mjs", loaded.esm], ["identity.cjs", loaded.cjs]]) {
    const thrown = thrownBy(() => mod.RayaIdentity().open("idv_" + "Ab3".repeat(8)));
    assert.ok(thrown && thrown.name === "IntegrationError", `${name}: open() fuera del navegador no tiró IntegrationError`);
    assert.ok(thrown instanceof mod.RayaIdentity.IntegrationError, `${name}: el error no es de su IntegrationError`);
  }
}

// El integrity (SRI) de un archivo, como va en el atributo del <script>.
function sri(bytes) {
  return "sha384-" + createHash("sha384").update(bytes).digest("base64");
}

// El integrity de cada versión se anota en su entrada del CHANGELOG antes de
// publicarla. Si la entrada de esta versión ya tiene uno, tiene que ser el de estos
// bytes: un hash equivocado deja sin Identity.js a cada sitio que fijó la versión
// (el navegador no corre el script). Cada línea con un hash nombra su archivo. Con
// --release (release.yml), además, el de identity.js tiene que estar y la entrada
// ya no puede decir «sin publicar».
const RELEASE = process.argv.includes("--release");

function checkChangelogIntegrity(expected) {
  const text = readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
  const quoted = VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = text.search(new RegExp(`^## ${quoted}(?:\\s|$)`, "m"));
  if (start === -1) fail(`CHANGELOG.md no tiene una entrada «## ${VERSION}»`);
  const next = text.slice(start + 3).search(/^## /m);
  const entry = next === -1 ? text.slice(start) : text.slice(start, start + 3 + next);
  const found = new Set();
  for (const line of entry.split("\n")) {
    const hashes = line.match(/sha384-[A-Za-z0-9+/]+={0,2}/g);
    if (!hashes) continue;
    const file = /identity\.mjs/.test(line) ? "identity.mjs" : /identity\.js/.test(line) ? "identity.js" : null;
    if (!file || hashes.length !== 1) fail(`CHANGELOG.md (${VERSION}): cada integrity va en su línea, con el nombre de su archivo: ${line.trim()}`);
    if (hashes[0] !== expected[file]) {
      fail(`CHANGELOG.md (${VERSION}): el integrity de ${file} no es el de dist/${file} (${expected[file]}). Una versión del CDN nunca cambia sus bytes.`);
    }
    found.add(file);
  }
  if (!RELEASE) return;
  if (/sin publicar/i.test(entry.split("\n", 1)[0])) {
    fail(`CHANGELOG.md (${VERSION}): para publicar, sacá «sin publicar» del título de la entrada.`);
  }
  if (!found.has("identity.js")) {
    fail(
      `CHANGELOG.md (${VERSION}): para publicar, anotá el integrity de identity.js en la entrada, en su propia línea: ` +
        `- \`integrity\` de \`v${VERSION}/identity.js\` en el CDN: \`${expected["identity.js"]}\``,
    );
  }
}

async function buildAll() {
  checkSetup();
  cleanDist();
  await Promise.all(Object.values(OUTPUTS).map((options) => esbuild.build(options)));
  asciiSourceMap(path.join(DIST, "identity.debug.js.map"));
  writeTypes();

  checkAscii();
  checkTypes();
  const iife = readFileSync(path.join(DIST, "identity.js"));
  for (const name of ["identity.js", "identity.debug.js", "identity.mjs", "identity.cjs"]) {
    if (!readFileSync(path.join(DIST, name), "ascii").startsWith(BANNER)) fail(`dist/${name} no empieza con el banner`);
  }
  try {
    smokeTestIife(iife.toString("ascii"));
    await smokeTestModules();
  } catch (error) {
    fail(`smoke test: ${error && error.message ? error.message : error}`);
  }

  const gzip = gzipSync(iife, { level: 9 }).length;
  if (gzip > MAX_GZIP_BYTES) fail(`dist/identity.js pesa ${gzip} B en gzip (máximo ${MAX_GZIP_BYTES})`);

  const integrity = { "identity.js": sri(iife), "identity.mjs": sri(readFileSync(path.join(DIST, "identity.mjs"))) };
  checkChangelogIntegrity(integrity);

  const rows = [];
  for (const name of readdirSync(DIST).sort()) {
    const bytes = readFileSync(path.join(DIST, name));
    const isCode = /\.(c|m)?js$/.test(name);
    rows.push(
      `  dist/${name.padEnd(24)} ${String(bytes.length).padStart(7)} B` +
        (isCode ? `  gzip ${String(gzipSync(bytes, { level: 9 }).length).padStart(6)} B` : "") +
        (integrity[name] ? `  ${integrity[name]}` : ""),
    );
  }
  console.log(`Raya Identity.js v${VERSION} (${PACKAGE_NAME}; esbuild ${esbuild.version}, TypeScript ${ts.version})`);
  console.log(rows.join("\n"));
  console.log(
    "Chequeos: ASCII, banner, smoke test de identity.js (node:vm, sin document), de identity.mjs (import) y de identity.cjs (require), " +
      "sin efectos al cargar, tipos (<script>, import y require), gzip <= 8 KB, integrity del CHANGELOG: OK",
  );
  // El <script> del CDN: el de la última de la mayor y el de esta versión, fija y con
  // su integrity (el que se anota en el CHANGELOG al subirla).
  console.log(`\nCDN (dist/ entero en v${VERSION}/, inmutable, y en v${MAJOR}/, con cache corto):`);
  console.log(`<script src="${CDN_BASE}/v${MAJOR}/identity.js"></script>`);
  console.log(`<script src="${CDN_BASE}/v${VERSION}/identity.js" integrity="${integrity["identity.js"]}" crossorigin="anonymous"></script>`);
  console.log(`ESM: ${CDN_BASE}/v${VERSION}/identity.mjs (integrity ${integrity["identity.mjs"]})`);
}

async function serve() {
  await buildAll();
  const port = Number(process.env.IDENTITY_JS_DEMO_PORT || 5051);
  const contexts = [await esbuild.context(OUTPUTS.debug), await esbuild.context(OUTPUTS.min)];
  await Promise.all(contexts.map((context) => context.watch()));
  // Sirve la carpeta del paquete entera, solo en 127.0.0.1: /demo/, /dist/ y, por
  // el fallback, la página alojada falsa en /identity/<id>.
  const result = await contexts[0].serve({ servedir: ROOT, host: "127.0.0.1", port, fallback: path.join(ROOT, "demo/frame.html") });
  console.log(`\nDemo: http://127.0.0.1:${result.port}/demo/  (Ctrl+C para cortar)`);
  console.log(`Página alojada falsa: http://localhost:${result.port}/identity/<id>`);
  const shutdown = () => {
    Promise.all(contexts.map((context) => context.dispose())).then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv.includes("--serve")) {
  await serve();
} else {
  await buildAll();
}
