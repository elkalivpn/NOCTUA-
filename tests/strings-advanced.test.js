const test = require("node:test");
const assert = require("node:assert");
const { detectStrings, extractStrings } = require("../src/main/analysis/detectors/strings");

/* Fixtures sinteticos con Uint8Array: sin binarios en el repo y sin Buffer,
   para que el arnes de desarrollo tambien pueda ejecutarlos. */
function latin1Bytes(s) {
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
  return u;
}
function utf16leBytes(s) {
  const u = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    u[2 * i] = c & 0xff;
    u[2 * i + 1] = (c >> 8) & 0xff;
  }
  return u;
}
function concatBytes() {
  let n = 0;
  for (const a of arguments) n += a.length;
  const u = new Uint8Array(n);
  let o = 0;
  for (const a of arguments) { u.set(a, o); o += a.length; }
  return u;
}
const Z = (n) => new Uint8Array(n);

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function encodeB64(s) {
  let out = "";
  for (let i = 0; i < s.length; i += 3) {
    const has1 = i + 1 < s.length, has2 = i + 2 < s.length;
    const b0 = s.charCodeAt(i);
    const b1 = has1 ? s.charCodeAt(i + 1) : 0;
    const b2 = has2 ? s.charCodeAt(i + 2) : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += has1 ? B64[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += has2 ? B64[b2 & 63] : "=";
  }
  return out;
}

test("JSON embebido valido genera hallazgo medium con claves", () => {
  const json = '{"c2":"http://185.23.4.11/gate.php","sleep":300}';
  const buf = concatBytes(Z(16), latin1Bytes(json), Z(16));
  const res = detectStrings({ buffer: buf });
  const f = res.findings.find((x) => x.id === "strings.embedded-json");
  assert.ok(f, "debe existir el hallazgo de JSON embebido");
  assert.strictEqual(f.severity, "medium");
  assert.ok(f.detail.indexOf("c2") !== -1, "el detalle menciona las claves");
  assert.ok(res.strings.embedded.some((s) => s.indexOf("json:") === 0));
});

test("JSON invalido o trivial no genera hallazgo", () => {
  const buf = concatBytes(Z(8), latin1Bytes("{invalido}"), Z(8), latin1Bytes('{"a":}'), Z(8));
  const res = detectStrings({ buffer: buf });
  assert.ok(!res.findings.some((x) => x.id === "strings.embedded-json"));
});

test("XML embebido detectado con heuristica de etiqueta balanceada", () => {
  const xml = "<config><server>evil.example</server><port>4444</port></config>";
  const buf = concatBytes(Z(16), latin1Bytes(xml), Z(16));
  const res = detectStrings({ buffer: buf });
  const f = res.findings.find((x) => x.id === "strings.embedded-xml");
  assert.ok(f, "debe existir el hallazgo de XML embebido");
  assert.strictEqual(f.severity, "low");
  assert.ok(f.refs[0].indexOf("<config>") === 0);
});

test("UTF-16LE: la URL en utf16 queda en urls y genera hallazgo propio", () => {
  const buf = concatBytes(utf16leBytes("http://evil.example/gate"), Z(32));
  const res = detectStrings({ buffer: buf });
  assert.ok(res.strings.urls.some((u) => u.indexOf("evil.example") !== -1));
  const f = res.findings.find((x) => x.id === "strings.utf16le");
  assert.ok(f, "debe existir el hallazgo utf16le");
  assert.strictEqual(f.severity, "low");
  assert.ok(res.strings.utf16.some((s) => s.indexOf("evil.example") !== -1));
});

test("base64 con contenido decodificable genera hallazgo con extracto", () => {
  const payload = "hello world from noctua detector";
  const b64 = encodeB64(payload);
  const buf = concatBytes(Z(8), latin1Bytes(b64), Z(8));
  const res = detectStrings({ buffer: buf });
  const f = res.findings.find((x) => x.id === "strings.base64");
  assert.ok(f, "debe existir el hallazgo base64");
  assert.strictEqual(f.severity, "low");
  assert.ok(f.refs[0].indexOf(payload) !== -1, "el ref muestra el contenido decodificado");
});

test("bloques: hallazgo strings.blocks cuando hay varios bloques densos", () => {
  const parts = [];
  for (let g = 0; g < 3; g++) {
    for (let s = 0; s < 4; s++) { parts.push(latin1Bytes("config-string-" + (g * 4 + s))); parts.push(Z(2)); }
    parts.push(Z(100));
  }
  const buf = concatBytes.apply(null, parts);
  const res = detectStrings({ buffer: buf });
  const f = res.findings.find((x) => x.id === "strings.blocks");
  assert.ok(f, "debe existir el hallazgo de bloques");
  assert.strictEqual(f.severity, "info");
  assert.ok(f.title.indexOf("3") !== -1);
  assert.ok(f.refs[0].indexOf("bloque 0:") === 0);
});

test("regresion v0.2: URLs, IPs y sospechosas en ASCII siguen intactas", () => {
  const buf = latin1Bytes("AAAAhttp://185.23.4.11/gate.php AAAA 10.0.0.1 AAAA cmd.exe /c whoami");
  const res = detectStrings({ buffer: buf });
  assert.ok(res.strings.urls.some((u) => u.indexOf("gate.php") !== -1));
  assert.ok(res.strings.ips.includes("185.23.4.11"));
  assert.ok(res.strings.interesting.length > 0);
  assert.ok(res.findings.some((x) => x.id === "strings.urls"));
});

test("extractStrings mantiene el contrato previo: array de cadenas", () => {
  const strs = extractStrings(latin1Bytes("abcdef"));
  assert.ok(Array.isArray(strs));
  assert.deepStrictEqual(strs, ["abcdef"]);
});
