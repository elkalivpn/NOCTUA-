"use strict";
/* Tests de los filtros y navegacion del panel (v0.3.6, issue #20):
   renderer/findings.js. Funciones puras: sin DOM (patron tree.test.js). */
const test = require("node:test");
const assert = require("node:assert");
const { SEVERITIES, severityCounts, filterFindings, locateOffset } = require("../renderer/findings");

function fixtureFindings() {
  return [
    { id: "a", severity: "high", title: "seccion alta entropia", detail: "empaquetado posible", source: "entropy", refs: [] },
    { id: "b", severity: "low", title: "URL embebida", detail: "http://c2.example/gate", source: "strings", refs: ["http://c2.example/gate"] },
    { id: "c", severity: "medium", title: "imports categorizados", detail: "keylogging: GetAsyncKeyState", source: "imports", refs: [] },
    { id: "d", severity: "info", title: "bloques de strings", detail: "region de configuracion", source: "strings", refs: ["bloque 0: 0x10-0x20"] }
  ];
}

test("SEVERITIES cubre el contrato de severidad en orden", () => {
  assert.deepStrictEqual(SEVERITIES, ["critical", "high", "medium", "low", "info"]);
});

test("severityCounts: siempre las cinco claves, con ceros incluidos", () => {
  const c = severityCounts(fixtureFindings());
  assert.deepStrictEqual(c, { critical: 0, high: 1, medium: 1, low: 1, info: 1 });
  assert.deepStrictEqual(severityCounts([]), { critical: 0, high: 0, medium: 0, low: 0, info: 0 });
});

test("filterFindings: ejes ausentes (null) muestran todo", () => {
  const f = fixtureFindings();
  assert.strictEqual(filterFindings(f, {}).length, 4);
  assert.strictEqual(filterFindings(f, null).length, 4);
  assert.strictEqual(filterFindings(f, { severities: null, sources: null, query: "" }).length, 4);
});

test("filterFindings: filtro por severidad exige pertenencia", () => {
  const f = fixtureFindings();
  const only = filterFindings(f, { severities: new Set(["high", "medium"]) });
  assert.deepStrictEqual(only.map((x) => x.id), ["a", "c"]);
  // conjunto vacio presente = nada visible (sin negacion vacia)
  assert.strictEqual(filterFindings(f, { severities: new Set() }).length, 0);
});

test("filterFindings: filtro por fuente y combinacion con query", () => {
  const f = fixtureFindings();
  const stringsOnly = filterFindings(f, { sources: new Set(["strings"]) });
  assert.deepStrictEqual(stringsOnly.map((x) => x.id), ["b", "d"]);
  const q = filterFindings(f, { sources: new Set(["strings"]), query: "URL" });
  assert.deepStrictEqual(q.map((x) => x.id), ["b"]);
  const both = filterFindings(f, { severities: new Set(["low", "info"]), sources: new Set(["strings"]) });
  assert.strictEqual(both.length, 2);
});

test("filterFindings: la busqueda insensible a mayusculas cubre titulo, detalle y refs", () => {
  const f = fixtureFindings();
  assert.strictEqual(filterFindings(f, { query: "GATE" }).length, 1);
  assert.strictEqual(filterFindings(f, { query: "bloque 0" }).length, 1, "busca en refs");
  assert.strictEqual(filterFindings(f, { query: "inexistente" }).length, 0);
});

test("locateOffset: linea y columna 1-based", () => {
  assert.deepStrictEqual(locateOffset("hola\nmundo", 5), { line: 2, column: 1 });
  assert.deepStrictEqual(locateOffset("hola\nmundo", 0), { line: 1, column: 1 });
  assert.deepStrictEqual(locateOffset("hola\nmundo", 7), { line: 2, column: 3 });
  // offset mas alla del final se acota
  assert.deepStrictEqual(locateOffset("abc", 1000), { line: 1, column: 4 });
  // tres lineas: el offset cae en la tercera
  assert.deepStrictEqual(locateOffset("a\nb\nc", 4), { line: 3, column: 1 });
});
