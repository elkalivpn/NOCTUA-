"use strict";
/* Regresión de seguridad del renderer (issues #4 y #5):
   CSP estricta, cero recursos remotos, sin scripts/estilos inline. */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const rendererDir = path.join(__dirname, "..", "renderer");
const html = fs.readFileSync(path.join(rendererDir, "index.html"), "utf8");
const appJs = fs.readFileSync(path.join(rendererDir, "app.js"), "utf8");

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
  assert.ok(!/jsdelivr|unpkg|cdnjs|googleapis/.test(html + appJs), "sin referencias a CDNs");
  assert.match(html, /<link rel="stylesheet" href="styles.css">/);
  assert.ok(fs.existsSync(path.join(rendererDir, "styles.css")), "styles.css debe existir");
});

test("Monaco se sirve en local (self-host, issue #5)", () => {
  assert.match(html, /<script src="vendor\/monaco\/vs\/loader\.js"><\/script>/);
  assert.match(appJs, /paths:\s*\{\s*vs:\s*"vendor\/monaco\/vs"/);
  assert.match(appJs, /getWorkerUrl/, "debe definir el proxy de workers de Monaco");
});

test("vendor de Monaco se genera por postinstall y no se versiona", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.ok(pkg.scripts.postinstall.includes("copy-monaco"));
  assert.ok(pkg.devDependencies["monaco-editor"], "monaco-editor debe ser devDependency");
  const gitignore = fs.readFileSync(path.join(__dirname, "..", ".gitignore"), "utf8");
  assert.match(gitignore, /renderer\/vendor\//);
});

test("la salida del agente se escapa antes de innerHTML (higiene XSS)", () => {
  assert.match(appJs, /function esc\(/);
});
