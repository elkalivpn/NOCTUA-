"use strict";
/* Tests del volcado hex (v0.3.6, issue #20): src/main/hexdump.js.
   Fixtures Uint8Array: sin Buffer y sin binarios en el repo. */
const test = require("node:test");
const assert = require("node:assert");
const { hexDump, readHexWindow, ROW_BYTES } = require("../src/main/hexdump");

function bytesOf(s) {
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
  return u;
}

test("hexDump: filas de 16 bytes con offset y columna ASCII", () => {
  const dump = hexDump(bytesOf("ABCDEFGHIJKLMNOPQRSTUVWXYZ"), 0, 26);
  const rows = dump.split("\n");
  assert.strictEqual(rows.length, 2, "26 bytes = 2 filas de 16");
  assert.strictEqual(ROW_BYTES, 16);
  assert.ok(rows[0].indexOf("0x00000000") === 0, "primera fila con offset 0");
  assert.ok(rows[0].indexOf("41 42") !== -1, "bytes en hexadecimal");
  assert.ok(rows[0].indexOf("|ABCDEFGHIJKLMNOP|") !== -1, "columna ASCII de la primera fila");
  assert.ok(rows[1].indexOf("0x00000010") === 0, "segunda fila arranca en 0x10");
});

test("hexDump: inicio arbitrario conserva offsets absolutos", () => {
  const dump = hexDump(bytesOf("ABCDEFGHIJKLMNOPQRSTUVWXYZ"), 5, 4);
  const rows = dump.split("\n");
  assert.strictEqual(rows.length, 1);
  assert.ok(rows[0].indexOf("0x00000005") === 0);
  assert.ok(rows[0].indexOf("46 47 48 49") !== -1);
  assert.ok(rows[0].indexOf("|FGHI") !== -1, "columna ASCII rellenada hasta 16");
});

test("hexDump: length se recorta al final del fichero", () => {
  const dump = hexDump(bytesOf("ABC"), 0, 1000);
  assert.strictEqual(dump.split("\n").length, 1);
  assert.ok(dump.indexOf("41 42 43") !== -1);
  assert.ok(dump.indexOf("44") === -1, "no hay bytes mas alla del EOF");
});

test("hexDump: bytes no imprimibles como .", () => {
  const dump = hexDump(bytesOf("A\x00B\x7f"), 0, 4);
  assert.ok(dump.indexOf("|A.B.") !== -1, "bytes no imprimibles como . y columna rellenada");
});

test("readHexWindow: ventana centrada y acotada al inicio", () => {
  const u = new Uint8Array(512);
  for (let i = 0; i < u.length; i++) u[i] = i & 0xff;
  const w = readHexWindow(u, 100, { before: 64, length: 256 });
  assert.strictEqual(w.start, 36, "64 bytes antes del offset 100");
  assert.strictEqual(w.offset, 100);
  assert.ok(w.hex.indexOf("0x00000024") === 0, "36 = 0x24, primera fila absoluta");
  assert.strictEqual(w.hex.split("\n").length, 16, "256 bytes = 16 filas");
});

test("readHexWindow: offset cerca de 0 no baja de 0", () => {
  const u = new Uint8Array(512);
  for (let i = 0; i < u.length; i++) u[i] = i & 0xff;
  const w = readHexWindow(u, 10, { before: 64, length: 256 });
  assert.strictEqual(w.start, 0);
});

test("readHexWindow: offset fuera del fichero se clava al ultimo byte", () => {
  const dump = readHexWindow(bytesOf("ABCDEF"), 1000);
  assert.strictEqual(dump.offset, 5, "acotado al ultimo byte");
  assert.strictEqual(dump.start, 0, "before se recorta por el inicio del fichero");
  assert.ok(dump.hex.indexOf("46") !== -1);
});
