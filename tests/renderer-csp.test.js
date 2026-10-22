"use strict";
/* Regresión de seguridad del renderer (issues #3, #4 y #5):
   CSP estricta, cero recursos remotos, sin scripts/estilos inline. */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const rendererDir = path.join(__dirname, "..", "renderer");
const html = fs.readFileSync(path.join(rendererDir, "index.html"), "utf8");
const appJs = fs.readFileSync(path.join(rendererDir, "app.js"), "utf8");
const termJs = fs.readFileSync(path.join(rendererDir, "terminal.js"), "utf8");
const treeJs = fs.readFileSync(path.join(rendererDir, "tree.js"), "utf8");

test("CSP estricta declarada en el renderer", () => {
  const m = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  assert.ok(m, "index.html debe declarar la CSP vía <meta>");
  const csp = m[1];
  const directives = Object.fromEntries(
    csp.split(";").map((d) => {
      const parts = d.trim().split(/\s+/);
      return [parts[0], parts.slice(1).join(" ")];
    })
  );
  assert.equal(directives["default-src"], "'self'");
  assert.ok(directives["script-src"].includes("'self'"));
  assert.ok(!directives["script-src"].includes("'unsafe-inline'"), "script-src no debe permitir inline");
  assert.ok(!directives["script-src"].includes("data:"), "script-src no debe permitir data:");
  assert.equal(directives["object-src"], "'none'");
  assert.equal(directives["base-uri"], "'none'");
  assert.equal(directives["form-action"], "'none'");
  for (const d of csp.split(";")) {
    assert.ok(!/https?:/.test(d), "ninguna directiva debe abrir http(s): " + d);
  }
});

test("sin recursos remotos ni código inline en el renderer", () => {
  assert.ok(!/<script[^>]+src=["']https?:/.test(html), "ningún <script> remoto");
  assert.ok(!/<script(?![^>]*src=)[^>]*>/.test(html), "sin bloques <script> inline");
  assert.ok(!/<style/.test(html), "sin <style> inline");
  assert.ok(!/jsdelivr|unpkg|cdnjs|googleapis/.test(html + appJs + termJs + treeJs), "sin referencias a CDNs");
  assert.match(html, /<link rel="stylesheet" href="styles.css">/);
  assert.ok(fs.existsSync(path.join(rendererDir, "styles.css")), "styles.css debe existir");
});

test("Monaco se sirve en local (self-host, issue #5)", () => {
  assert.match(html, /<script src="vendor\/monaco\/vs\/loader\.js"><\/script>/);
  assert.match(appJs, /paths:\s*\{\s*vs:\s*"vendor\/monaco\/vs"/);
  assert.match(appJs, /getWorkerUrl/, "debe definir el proxy de workers de Monaco");
});

test("xterm se sirve en local (self-host, issue #3)", () => {
  assert.match(html, /<link rel="stylesheet" href="vendor\/xterm\/xterm\.css">/);
  assert.match(html, /<script src="vendor\/xterm\/xterm\.js"><\/script>/);
  assert.match(html, /<script src="vendor\/xterm\/addon-fit\/addon-fit\.js"><\/script>/);
  assert.ok(!/https?:/.test(termJs), "terminal.js no debe referenciar remotos");
});

test("árbol de proyectos cargado como módulo local", () => {
  assert.match(html, /<script src="tree\.js"><\/script>/);
  assert.ok(!/https?:/.test(treeJs), "tree.js no debe referenciar remotos");
});

test("vendors generados por postinstall; node-pty opcional y no versionado", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.equal(pkg.scripts.postinstall, "node scripts/postinstall.js");
  assert.ok(pkg.scripts.rebuild && pkg.scripts.rebuild.includes("electron-rebuild"), "debe existir npm run rebuild");
  assert.ok(pkg.optionalDependencies["node-pty"], "node-pty debe ser optionalDependency (degradación elegante)");
  assert.ok(pkg.devDependencies["@xterm/xterm"], "@xterm/xterm debe ser devDependency");
  const gitignore = fs.readFileSync(path.join(__dirname, "..", ".gitignore"), "utf8");
  assert.match(gitignore, /renderer\/vendor\//);
});

test("la salida del agente se escapa antes de innerHTML (higiene XSS)", () => {
  assert.match(appJs, /function esc\(/);
});
