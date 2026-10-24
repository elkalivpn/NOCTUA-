"use strict";
/* Subselección de detectores (v0.3.2, paleta de comandos): normalizeDetectors.
   No ejecuta análisis, workers ni herramientas externas: solo la validación pura. */
const test = require("node:test");
const assert = require("node:assert");
const { normalizeDetectors, ALL_DETECTORS } = require("../src/main/analysis/index.js");

test("normalizeDetectors: sin selección devuelve null (todos); subconjunto devuelve Set", () => {
  assert.equal(normalizeDetectors(null), null);
  assert.equal(normalizeDetectors(undefined), null);
  assert.equal(normalizeDetectors([]), null);
  const sel = normalizeDetectors(["strings", "yara"]);
  assert.ok(sel instanceof Set);
  assert.equal(sel.size, 2);
  assert.ok(sel.has("strings") && sel.has("yara"));
});

test("normalizeDetectors: detector desconocido produce error explícito", () => {
  assert.throws(() => normalizeDetectors(["noexiste"]), /desconocido/);
});

test("ALL_DETECTORS cubre los seis detectores de v0.2", () => {
  assert.deepEqual([...ALL_DETECTORS].sort(), ["entropy", "format", "imports", "mitigations", "strings", "yara"]);
});
