"use strict";
/* Tests del árbol de proyectos (v0.3.0): funciones puras de renderer/tree.js. */
const test = require("node:test");
const assert = require("node:assert");
const { iconFor, sortEntries, languageFor, joinPath } = require("../renderer/tree");

test("iconFor: directorios y glifos por tipo de fichero", () => {
  assert.deepStrictEqual(iconFor("cualquier", true), { glyph: "▤", cls: "ico-dir" });
  assert.strictEqual(iconFor("a.py").glyph, "PY");
  assert.strictEqual(iconFor("a.JS").cls, "ico-js"); // extensión insensible a mayúsculas
  assert.strictEqual(iconFor("a.bin").cls, "ico-bin");
  assert.strictEqual(iconFor("a.png").glyph, "img");
  assert.strictEqual(iconFor("a.json").glyph, "{}");
  assert.strictEqual(iconFor("sinext").glyph, "·");
  assert.strictEqual(iconFor("sinext").cls, "ico-other");
});

test("sortEntries: directorios primero y orden natural (numérico)", () => {
  const entries = [
    { name: "b.txt", dir: false },
    { name: "a10", dir: true },
    { name: "a2", dir: true },
    { name: "a1.txt", dir: false }
  ];
  assert.deepStrictEqual(sortEntries(entries).map((e) => e.name), ["a2", "a10", "a1.txt", "b.txt"]);
});

test("languageFor: mapeo de extensiones a Monaco", () => {
  assert.strictEqual(languageFor("x.py"), "python");
  assert.strictEqual(languageFor("x.mjs"), "javascript");
  assert.strictEqual(languageFor("x.json"), "json");
  assert.strictEqual(languageFor("x.cpp"), "cpp");
  assert.strictEqual(languageFor("x.h"), "c");
  assert.strictEqual(languageFor("x.sh"), "shell");
  assert.strictEqual(languageFor("x.unknownext"), "plaintext");
});

test("joinPath: no duplica separadores", () => {
  assert.strictEqual(joinPath("/home/user", "file.py"), "/home/user/file.py");
  assert.strictEqual(joinPath("/home/user/", "file.py"), "/home/user/file.py");
});
