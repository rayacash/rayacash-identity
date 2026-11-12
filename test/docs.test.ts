// El README y el CHANGELOG: la versión al día, las dos formas de cargar la librería
// (npm y el <script> del CDN de Raya, con el CDN_BASE de build.mjs), la CSP de cada
// una, sin la copia a los estáticos ni CDNs de terceros, y el código de los ejemplos
// con sintaxis válida: cada bloque ```js (node --check, como módulo) y cada <script>
// inline de los bloques ```html (como script clásico).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

function read(name: string): string {
  return readFileSync(path.join(ROOT, name), "utf8");
}

const VERSION: string = JSON.parse(read("package.json")).version;
const MAJOR = VERSION.split(".")[0];
const README = read("README.md");
const CHANGELOG = read("CHANGELOG.md");
const DOCS = [
  ["README.md", README],
  ["CHANGELOG.md", CHANGELOG],
] as const;

// El host del CDN vive solo en build.mjs: los docs tienen que seguirlo.
const CDN_BASE = /^const CDN_BASE = "([^"]+)";$/m.exec(read("build.mjs"))?.[1] ?? "";
const CDN_ORIGIN = CDN_BASE ? new URL(CDN_BASE).origin : "";
const LATEST = `${CDN_BASE}/v${MAJOR}/identity.js`;
const PINNED = `${CDN_BASE}/v${VERSION}/identity.js`;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Los bloques de un lenguaje, también los que van adentro de una lista (con sangría).
function fencedBlocks(markdown: string, language: string): string[] {
  const blocks: string[] = [];
  const fence = new RegExp(`^( *)\`\`\`${escapeRegExp(language)}\\n([\\s\\S]*?)^\\1\`\`\`$`, "gm");
  for (const match of markdown.matchAll(fence)) {
    const indent = (match[1] ?? "").length;
    const body = match[2] ?? "";
    blocks.push(body.split("\n").map((line) => line.slice(Math.min(indent, line.length - line.trimStart().length))).join("\n"));
  }
  return blocks;
}

// node --check de cada pedazo de código, en archivos temporales con su extensión.
function checkSyntax(blocks: string[], extension: ".mjs" | ".cjs", what: string): void {
  const dir = mkdtempSync(path.join(tmpdir(), "rayacash-identity-readme-"));
  try {
    blocks.forEach((code, index) => {
      const file = path.join(dir, `bloque-${index + 1}${extension}`);
      writeFileSync(file, code);
      try {
        execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
      } catch (error) {
        const stderr = String((error as { stderr?: unknown }).stderr ?? error);
        assert.fail(`${what} ${index + 1} del README no compila:\n${code}\n${stderr}`);
      }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("documentación", () => {
  test("la versión de package.json es la del README y la primera del CHANGELOG", () => {
    assert.match(README, new RegExp(`^Versión ${escapeRegExp(VERSION)}\\.`, "m"));
    assert.equal(/^## (\d+\.\d+\.\d+\S*)/m.exec(CHANGELOG)?.[1], VERSION);
  });

  test("se instala con npm y se importa por nombre", () => {
    assert.ok(README.includes("npm install rayacash-identity"));
    assert.ok(README.includes('import { RayaIdentity } from "rayacash-identity";'));
    assert.ok(README.includes('const { RayaIdentity } = require("rayacash-identity");'));
    // npm va primero: el <script> aparece recién después del primer import.
    assert.ok(README.indexOf("npm install rayacash-identity") < README.indexOf(`<script src="${LATEST}">`));
  });

  test("el <script> del CDN apunta a CDN_BASE/v<mayor>/identity.js, y la versión fija lleva integrity", () => {
    assert.match(CDN_BASE, /^https:\/\/[^/]+\/\S+[^/]$/, "no encuentro CDN_BASE en build.mjs");
    for (const [name, text] of DOCS) {
      assert.ok(text.includes(`<script src="${LATEST}"></script>`), `${name}: falta el <script> de ${LATEST}`);
    }
    const pinned = new RegExp(`<script\\s+src="${escapeRegExp(PINNED)}"\\s+integrity="sha384-[^"]+"\\s+crossorigin="anonymous"\\s*></script>`);
    assert.match(README, pinned, "falta la versión fija con integrity y crossorigin");
    // v<mayor> cambia con cada versión: un integrity ahí rompe la página al publicar otra.
    assert.doesNotMatch(README, new RegExp(`${escapeRegExp(LATEST)}"\\s+integrity`));
    for (const [name, text] of DOCS) {
      for (const match of text.matchAll(new RegExp(`${escapeRegExp(CDN_ORIGIN)}[^\\s"'\`)<>;,]*`, "g"))) {
        assert.ok([CDN_ORIGIN, LATEST, PINNED].includes(match[0]), `${name}: URL del CDN inesperada: ${match[0]}`);
      }
      for (const match of text.matchAll(/<script\s+src="([^"]*)"/g)) {
        assert.ok([LATEST, PINNED].includes(match[1] ?? ""), `${name}: <script> fuera del CDN de Raya: ${match[1]}`);
      }
    }
  });

  test("la CSP: frame-src siempre y script-src con el CDN solo para el <script>", () => {
    assert.ok(README.includes("frame-src https://raya.cash;"));
    assert.ok(README.includes(`script-src 'self' ${CDN_ORIGIN};`));
    assert.ok(README.includes("Con npm, Identity.js va adentro de tu bundle: `script-src` no cambia."));
    assert.ok(CHANGELOG.includes("`frame-src https://raya.cash`"));
    assert.ok(CHANGELOG.includes(`\`script-src ${CDN_ORIGIN}\``));
  });

  test("sin la copia a los estáticos ni CDNs de terceros", () => {
    const banned = [
      /unpkg/i,
      /jsdelivr/i,
      /esm\.sh/i,
      /skypack/i,
      /cdnjs/i,
      /archivos estáticos|tus estáticos/i,
      /node_modules\/rayacash-identity\/dist/,
      /^## Sin bundler/m,
    ];
    for (const [name, text] of DOCS) {
      for (const pattern of banned) assert.doesNotMatch(text, pattern, `${name} menciona ${pattern}`);
    }
  });

  test("los bloques js del README tienen sintaxis válida", () => {
    const blocks = fencedBlocks(README, "js");
    assert.ok(blocks.length >= 4, `encontré ${blocks.length} bloques js`);
    checkSyntax(blocks, ".mjs", "el bloque js");
  });

  test("los <script> inline de los bloques html del README tienen sintaxis válida", () => {
    const scripts = fencedBlocks(README, "html").flatMap((html) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? ""));
    assert.ok(scripts.length >= 2, `encontré ${scripts.length} <script> inline`);
    assert.ok(scripts.every((code) => code.includes("RayaIdentity()")), "cada <script> usa el global RayaIdentity()");
    checkSyntax(scripts, ".cjs", "el <script>");
  });
});
