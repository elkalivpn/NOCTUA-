const test = require("node:test");
const assert = require("node:assert");
const { shannonEntropy, detectType } = require("../src/analyze");

test("entropía de un buffer uniforme es 0", () => {
  const buf = Buffer.alloc(1024, 0x41);
  assert.strictEqual(shannonEntropy(buf), 0);
});

test("entropía de bytes aleatorios se acerca a 8", () => {
  const buf = Buffer.alloc(4096);
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 7 + 13) & 0xff; // pseudoaleatorio determinista
  const e = shannonEntropy(buf);
  assert.ok(e > 6, `entropía esperada > 6, obtenida ${e}`);
});

test("detecta PE, ELF, shebang y desconocido", () => {
  assert.strictEqual(detectType(Buffer.from("MZ\x00\x00", "latin1")), "PE/EXE");
  assert.strictEqual(detectType(Buffer.from("7f454c46", "hex")), "ELF");
  assert.strictEqual(detectType(Buffer.from("#!/bin/sh", "latin1")), "Script");
  assert.strictEqual(detectType(Buffer.from("\x01\x02\x03\x04", "latin1")), "desconocido");
});
