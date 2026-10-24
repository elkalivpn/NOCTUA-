"use strict";
/* Paleta de comandos (v0.3.2): fuzzyScore, filterCommands y createRegistry.
   Sin DOM, sin Electron: la CI solo necesita node --test. */
const test = require("node:test");
const assert = require("node:assert");
const { fuzzyScore, filterCommands, createRegistry } = require("../renderer/palette.js");

test("fuzzyScore: subsecuencia con puntuación", () => {
  assert.equal(fuzzyScore("", "cualquier texto"), 0);
  assert.notEqual(fuzzyScore("anal", "Análisis: detector de entropía"), null, "debe tolerar acentos ausentes");
  assert.equal(fuzzyScore("zzz", "Análisis: detector de entropía"), null, "sin coincidencia → null");
  assert.ok(fuzzyScore("abc", "abc") > fuzzyScore("abc", "axbxc"), "consecutivo puntúa más que disperso");
  assert.notEqual(fuzzyScore("det", "Análisis: detector de entropía"), null);
});

test("filterCommands: orden por relevancia; sin query devuelve todos", () => {
  const cmds = [
    { id: "a", category: "Archivo", title: "abrir fichero" },
    { id: "b", category: "Análisis", title: "ejecutar todos los detectores" },
    { id: "c", category: "Hallazgos", title: "siguiente hallazgo" }
  ];
  assert.equal(filterCommands(cmds, "").length, 3);
  const r = filterCommands(cmds, "detectores");
  assert.equal(r[0].command.id, "b", "el título debe primar");
  const r2 = filterCommands(cmds, "hallazgo");
  assert.equal(r2[0].command.id, "c");
  for (const it of r2) assert.ok(it.score >= 0);
});

test("createRegistry: validación, duplicados y filtro when", () => {
  const r = createRegistry();
  assert.equal(r.size(), 0);
  r.register({ id: "an:all", category: "Análisis", title: "ejecutar todos los detectores", run: () => 1 });
  r.register({ id: "hv:next", category: "Hallazgos", title: "siguiente hallazgo", when: () => false, run: () => 2 });
  assert.equal(r.size(), 2);
  assert.throws(() => r.register({ id: "an:all", run: () => 3 }), /duplicado/);
  assert.throws(() => r.register({ id: "", run: () => 3 }), /id/);
  assert.throws(() => r.register({ id: "x", title: "sin run" }), /run/);
  assert.equal(r.list().length, 1, "when() false excluye el comando");
  assert.equal(r.list()[0].id, "an:all");
  assert.equal(r.get("nope"), null);
  assert.equal(r.get("hv:next").category, "Hallazgos");
});
