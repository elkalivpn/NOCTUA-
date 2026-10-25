"use strict";
/* Volcado hex (v0.3.6, issue #20): contexto alrededor del offset de un hallazgo.
   Diseño: docs/DESIGN-findings-panel.md (D2).
   Puro y sin Buffer para testabilidad con Uint8Array (mismo criterio que
   detectors/strings.js). Los offsets son crudos del fichero, NO direcciones
   virtuales: sin desensamblado no hay mapeo RVA (futuro: issue #8). */

const ROW_BYTES = 16;

/* Rellena un numero hexadecimal a ancho fijo (offset 8, byte 2). */
function pad(n, width) {
  let s = n.toString(16);
  while (s.length < width) s = "0" + s;
  return s;
}

/* Volcado clasico: filas de 16 bytes, columna de offset y columna ASCII.
   start es absoluto dentro de bytes; length se recorta al final del fichero. */
function hexDump(bytes, start, length) {
  const begin = Math.max(0, Math.floor(start));
  const end = Math.min(begin + Math.max(0, Math.floor(length || 0)), bytes.length);
  const rows = [];
  for (let i = begin; i < end; i += ROW_BYTES) {
    let hexPart = "";
    let asciiPart = "";
    for (let j = 0; j < ROW_BYTES; j++) {
      const idx = i + j;
      if (idx < end) {
        const b = bytes[idx];
        hexPart += pad(b, 2) + " ";
        asciiPart += (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".";
      } else {
        hexPart += "   ";
        asciiPart += " ";
      }
    }
    rows.push("0x" + pad(i, 8) + "  " + hexPart + " |" + asciiPart + "|");
  }
  return rows.join("\n");
}

/* Ventana centrada en offset: hasta opts.before bytes antes y opts.length en
   total (por defecto 64/256). El offset se acota al fichero: un offset mas
   alla del EOF se clava al ultimo byte. Devuelve {offset, start, hex}. */
function readHexWindow(bytes, offset, opts) {
  const o = opts || {};
  const before = Math.max(0, Math.floor(o.before ?? 64));
  const length = Math.max(1, Math.floor(o.length ?? 256));
  const last = Math.max(0, bytes.length - 1);
  const off = Math.min(Math.max(0, Math.floor(offset)), last);
  const start = Math.max(0, off - before);
  return { offset: off, start, hex: hexDump(bytes, start, length) };
}

module.exports = { hexDump, readHexWindow, ROW_BYTES };
