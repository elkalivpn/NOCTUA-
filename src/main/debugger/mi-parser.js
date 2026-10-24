"use strict";
/* NOCTUA — parser de GDB/MI (docs/DESIGN-debugger.md, §4).
   Módulo puro: una línea MI entra, un registro tipado sale. Sin I/O, sin estado.
   Cualquier dato del usuario que viaje en un comando pasa por miPath/miArg (R5). */

const C_ESCAPES = { n: "\n", t: "\t", r: "\r", f: "\f", b: "\b", v: "\v", a: "\x07", "0": "\x00" };

function unescapeCString(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      const c = s[i + 1];
      out += Object.prototype.hasOwnProperty.call(C_ESCAPES, c) ? C_ESCAPES[c] : c;
      i++;
    } else {
      out += s[i];
    }
  }
  return out;
}

/* Escapado inverso: serialización MI de cadenas con contenido del usuario (R5). */
function miEscape(s) {
  let out = "";
  s = String(s);
  for (const ch of s) {
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else out += ch;
  }
  return out;
}

function miPath(s) {
  return '"' + miEscape(s) + '"';
}

/* Argumentos del inferior para -exec-arguments: cada elemento citado por separado. */
function miArg(list) {
  return (list || []).map((x) => '"' + miEscape(String(x)) + '"').join(" ");
}

/* --- Gramática de resultados: pares clave=valor con tuplas {} y listas [] --- */
function parseResultSequence(src) {
  let i = 0;
  const n = src.length;

  function skipWs() { while (i < n && (src[i] === " " || src[i] === "\t")) i++; }
  function readKey() {
    const start = i;
    while (i < n && "=,{}[]".indexOf(src[i]) === -1) i++;
    return src.slice(start, i);
  }
  function parseValue() {
    skipWs();
    if (src[i] === '"') {
      i++;
      let raw = "";
      while (i < n && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < n) { raw += src[i] + src[i + 1]; i += 2; }
        else { raw += src[i]; i++; }
      }
      i++; /* comilla de cierre */
      return unescapeCString(raw);
    }
    if (src[i] === "{") { i++; return parseTuple(); }
    if (src[i] === "[") { i++; return parseList(); }
    /* valor sin comillas: raro en MI, tolerado sin romper el parser */
    const start = i;
    while (i < n && ",}".indexOf(src[i]) === -1) i++;
    return src.slice(start, i);
  }
  function parseTuple() {
    const obj = {};
    for (;;) {
      skipWs();
      if (i >= n) return obj;
      if (src[i] === "}") { i++; return obj; }
      const key = readKey();
      skipWs();
      if (src[i] === "=") { i++; obj[key] = parseValue(); }
      else if (key) obj[key] = true; /* clave sin valor: tolerada */
      skipWs();
      if (src[i] === ",") { i++; continue; }
      if (src[i] === "}") { i++; return obj; }
      if (i >= n) return obj;
      i++; /* carácter inesperado: se salta para no colgar el parser */
    }
  }
  function parseList() {
    const arr = [];
    for (;;) {
      skipWs();
      if (i >= n) return arr;
      if (src[i] === "]") { i++; return arr; }
      if (src[i] === "{") { i++; arr.push(parseTuple()); }
      else {
        /* result-list: elemento clave=valor (p. ej. frame={...}) */
        const start = i;
        const key = readKey();
        skipWs();
        if (src[i] === "=") {
          i++;
          const el = {};
          el[key] = parseValue();
          arr.push(el);
        } else {
          i = start;
          arr.push(parseValue());
        }
      }
      skipWs();
      if (src[i] === ",") i++;
    }
  }
  return parseTuple();
}

const STREAM_NAMES = { "~": "console", "@": "target", "&": "log" };

/* Línea MI → registro tipado: result (^), exec (*), notify (=), stream (~@&) o ready. */
function parseMiLine(line) {
  if (typeof line !== "string") return { type: "unknown", raw: String(line) };
  line = line.replace(/\r$/, "");
  if (line === "(gdb)") return { type: "ready" };
  let m = line.match(/^([~@&])"((?:[^"\\]|\\.)*)"\s*$/);
  if (m) return { type: "stream", stream: STREAM_NAMES[m[1]], data: unescapeCString(m[2]) };
  m = line.match(/^(\d*)\^(done|running|error|connected|exit|unsupported)(?:,(.*))?$/);
  if (m) {
    const rest = m[3] || "";
    return {
      type: "result",
      token: m[1] ? parseInt(m[1], 10) : null,
      resultClass: m[2],
      results: rest ? parseResultSequence(rest) : {}
    };
  }
  m = line.match(/^\*([a-zA-Z][a-zA-Z-]*)(?:,(.*))?$/);
  if (m) return { type: "exec", asyncClass: m[1], results: m[2] ? parseResultSequence(m[2]) : {} };
  m = line.match(/^=([a-zA-Z][a-zA-Z-]*)(?:,(.*))?$/);
  if (m) return { type: "notify", asyncClass: m[1], results: m[2] ? parseResultSequence(m[2]) : {} };
  return { type: "unknown", raw: line };
}

module.exports = { parseMiLine, parseResultSequence, unescapeCString, miEscape, miPath, miArg };
