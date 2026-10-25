/* Detector de strings — extraccion contextual (v0.3.5, issue #15).
   Mejoras sobre el regex plano del v0.2:
   - Extraccion ASCII y UTF-16LE (codificacion dominante en malware de Windows);
     URLs, IPs y sospechosas se computan sobre la union de ambas.
   - Contexto de bloques: las cadenas ASCII se agrupan por proximidad (hueco >= 64
     bytes); el hallazgo strings.blocks senala los offsets del bloque mas denso.
   - Estructuras embebidas: JSON validado con JSON.parse, XML con heuristica de
     etiqueta raiz balanceada y blobs base64 con contenido decodificable.
   Detector puro (CPU-bound: corre en worker_threads): { buffer } -> { strings, findings }.
   Los hallazgos usan el contrato FindingSchema; el objeto strings del contrato se
   amplia con strings.utf16 y strings.embedded (src/main/analysis/schema.js). */

const URL_RE = /(https?:\/\/[A-Za-z0-9._~:\/?#@!$&'()*+,;=%-]+)/g;
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const B64_RE = /[A-Za-z0-9+/]{40,}={0,2}/g;
const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const SUSPICIOUS = [
  "cmd.exe", "powershell", "/c ", "/k ", "CurrentVersion\\Run", "schtasks",
  "vssadmin", "bcdedit", "reg add", "taskkill", "rundll32",
  "VirtualAlloc", "CreateRemoteThread", "IsDebuggerPresent",
  "svchost.exe", "lsass", "ransom", "bitcoin", "wallet", "onion", "gate.php"
];

const MIN_LEN = 5;
const GAP_BYTES = 64;
const MAX_EMBEDDED = 25;

function isPrintable(c) {
  return c >= 0x20 && c < 0x7f;
}

/* latin1 puro: el modulo no usa Buffer y es testeable con Uint8Array. */
function latin1Of(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const end = Math.min(i + 4096, bytes.length);
    out += String.fromCharCode.apply(null, bytes.subarray(i, end));
    i = end;
  }
  return out;
}

/* Entradas con offset: el contexto (donde esta la cadena) es parte del hallazgo. */
function extractEntries(buf, minLen) {
  const entries = [];
  let start = -1;
  for (let i = 0; i <= buf.length; i++) {
    const c = i < buf.length ? buf[i] : 0;
    if (isPrintable(c)) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      if (i - start >= minLen) entries.push({ text: latin1Of(buf.subarray(start, i)), start, end: i, block: 0 });
      start = -1;
    }
  }
  return entries;
}

/* UTF-16LE en ambas alineaciones (par e impar): sin desensamblado no hay
   garantia de alineacion de la tabla. */
function extractUtf16Entries(buf, minLen, odd) {
  const entries = [];
  const n = buf.length;
  let start = -1;
  for (let i = odd; i <= n + 1; i += 2) {
    const hasPair = i + 1 < n;
    const printable = hasPair && buf[i + 1] === 0 && isPrintable(buf[i]);
    if (printable) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      if ((i - start) / 2 >= minLen) {
        let text = "";
        for (let j = start; j < i; j += 2) text += String.fromCharCode(buf[j]);
        entries.push({ text, start, end: i, block: 0 });
      }
      start = -1;
    }
  }
  return entries;
}

/* Bloques de contexto: un hueco >= GAP_BYTES abre bloque nuevo. */
function buildBlocks(entries) {
  const blocks = [];
  let cur = null;
  for (const e of entries) {
    if (!cur || e.start - cur.end >= GAP_BYTES) {
      cur = { index: blocks.length, start: e.start, end: e.end, count: 0 };
      blocks.push(cur);
    }
    if (e.end > cur.end) cur.end = e.end;
    cur.count++;
    e.block = cur.index;
  }
  return blocks;
}

/* JSON embebido: candidato balanceado que JSON.parse valida. Se exige >= 1 clave
   (objeto) o >= 2 elementos (array) y >= 16 caracteres: un "{...}" trivial de un
   log de compilador no es configuracion. */
function extractEmbeddedJson(entries) {
  const found = [];
  for (const e of entries) {
    const s = e.text;
    for (let i = 0; i < s.length && found.length < MAX_EMBEDDED; i++) {
      const open = s[i];
      if (open !== "{" && open !== "[") continue;
      const close = open === "{" ? "}" : "]";
      let depth = 0, inStr = false, esc = false, end = -1;
      for (let j = i; j < s.length; j++) {
        const ch = s[j];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === "\\") esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === open) depth++;
        else if (ch === close) { depth--; if (depth === 0) { end = j; break; } }
      }
      if (end === -1) continue;
      const slice = s.slice(i, end + 1);
      if (slice.length < 16) continue;
      let parsed;
      try { parsed = JSON.parse(slice); } catch (err) { continue; }
      const meaningful = parsed && typeof parsed === "object" &&
        (Array.isArray(parsed) ? parsed.length >= 2 : Object.keys(parsed).length >= 1);
      if (!meaningful) continue;
      found.push({
        excerpt: slice.length > 200 ? slice.slice(0, 200) + "..." : slice,
        keys: Array.isArray(parsed) ? null : Object.keys(parsed).slice(0, 8),
        offset: e.start + i
      });
      i = end;
    }
  }
  return found;
}

const XML_TAG_RE = /^<([A-Za-z][A-Za-z0-9_.:-]*)((\s[^>]*)?)>/;

/* XML embebido: HEURISTICA (severidad low). Etiqueta raiz de apertura con su
   cierre presente, o prologo <?xml. Puede dar falsos positivos con marcas de
   documentos: el titulo del hallazgo lo declara y pide verificacion manual. */
function extractEmbeddedXml(entries) {
  const found = [];
  for (const e of entries) {
    if (found.length >= MAX_EMBEDDED) break;
    const s = e.text;
    if (s.length < 32) continue;
    if (s.indexOf("<?xml") !== -1) {
      found.push({ excerpt: s.slice(0, 200), offset: e.start });
      continue;
    }
    const m = XML_TAG_RE.exec(s);
    if (!m) continue;
    const close = "</" + m[1] + ">";
    const closeIdx = s.lastIndexOf(close);
    if (closeIdx === -1 || closeIdx <= m[0].length) continue;
    const doc = s.slice(0, closeIdx + close.length);
    if (doc.length < 32) continue;
    found.push({ excerpt: doc.slice(0, 200), offset: e.start });
  }
  return found;
}

/* Decodificador base64 interno (sin Buffer): testeable con Uint8Array. */
function b64Decode(s) {
  const clean = s.replace(/=+$/, "");
  let acc = 0, bits = 0;
  const out = [];
  for (let i = 0; i < clean.length; i++) {
    const v = B64_ALPHABET.indexOf(clean[i]);
    if (v < 0) return null;
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); }
  }
  return out;
}

/* Blobs base64 con contenido decodificable: >= 24 bytes y >= 85% imprimible. */
function extractBase64(entries) {
  const found = [];
  const seen = new Set();
  for (const e of entries) {
    B64_RE.lastIndex = 0;
    let m;
    while (found.length < MAX_EMBEDDED && (m = B64_RE.exec(e.text)) !== null) {
      if (seen.has(m[0])) continue;
      seen.add(m[0]);
      const bytes = b64Decode(m[0]);
      if (!bytes || bytes.length < 24) continue;
      let printable = 0;
      for (const b of bytes) {
        if (b === 9 || b === 10 || b === 13 || (b >= 0x20 && b < 0x7f)) printable++;
      }
      if (printable / bytes.length < 0.85) continue;
      let text = "";
      for (const b of bytes.slice(0, 120)) text += String.fromCharCode(b);
      found.push({ excerpt: text, offset: e.start + m.index });
    }
  }
  return found;
}

/* Detector puro (CPU-bound: corre en worker): { buffer } -> { strings, findings } */
function detectStrings(input) {
  const buf = input.buffer;
  const ascii = extractEntries(buf, MIN_LEN);
  const utf16 = extractUtf16Entries(buf, MIN_LEN, 0).concat(extractUtf16Entries(buf, MIN_LEN, 1));
  const blocks = buildBlocks(ascii);
  const all = ascii.concat(utf16);
  const joined = all.map((e) => e.text).join("\n");
  const urls = [...new Set(joined.match(URL_RE) || [])].slice(0, 50);
  const ips = [...new Set(joined.match(IP_RE) || [])].slice(0, 50);
  const interesting = all
    .filter((e) => SUSPICIOUS.some((k) => e.text.toLowerCase().includes(k.toLowerCase())))
    .map((e) => e.text)
    .slice(0, 50);
  const jsonDocs = extractEmbeddedJson(ascii);
  const xmlDocs = extractEmbeddedXml(ascii);
  const b64Docs = extractBase64(ascii);

  const findings = [];
  if (urls.length)
    findings.push({ id: "strings.urls", severity: "low", title: urls.length + " URL(s) embebidas", detail: "Posibles C2 o servidores de descarga: " + urls.slice(0, 3).join(", "), source: "strings", refs: urls.slice(0, 5) });
  if (ips.length)
    findings.push({ id: "strings.ips", severity: "low", title: ips.length + " IP(s) embebidas", detail: ips.slice(0, 3).join(", "), source: "strings", refs: ips.slice(0, 5) });
  if (interesting.length)
    findings.push({ id: "strings.suspicious", severity: "medium", title: "Cadenas sospechosas", detail: "Cadenas compatibles con ejecucion de comandos, persistencia o analisis-deteccion: " + interesting.slice(0, 4).join(" | "), source: "strings", refs: interesting.slice(0, 10) });
  if (utf16.length) {
    const ex = utf16.slice(0, 3).map((e) => e.text.slice(0, 80));
    findings.push({ id: "strings.utf16le", severity: "low", title: utf16.length + " cadena(s) UTF-16LE embebidas", detail: "Codificacion dominante en malware de Windows; URLs y sospechosas en UTF-16LE ya estan incluidas arriba. Ejemplos: " + ex.join(" | "), source: "strings", refs: utf16.slice(0, 10).map((e) => e.text.slice(0, 80)) });
  }
  if (jsonDocs.length)
    findings.push({ id: "strings.embedded-json", severity: "medium", title: jsonDocs.length + " documento(s) JSON embebido(s)", detail: "JSON valido dentro del binario (posible configuracion). Claves del primero: " + (jsonDocs[0].keys ? jsonDocs[0].keys.join(", ") : "(array)") + ". Extracto: " + jsonDocs[0].excerpt, source: "strings", refs: jsonDocs.slice(0, 5).map((d) => d.excerpt.slice(0, 120)) });
  if (xmlDocs.length)
    findings.push({ id: "strings.embedded-xml", severity: "low", title: xmlDocs.length + " documento(s) XML embebido(s) (heuristico)", detail: "Etiqueta raiz cerrada dentro del binario; verificar manualmente. Extracto: " + xmlDocs[0].excerpt, source: "strings", refs: xmlDocs.slice(0, 5).map((d) => d.excerpt.slice(0, 120)) });
  if (b64Docs.length)
    findings.push({ id: "strings.base64", severity: "low", title: b64Docs.length + " blob(s) base64 con contenido decodificable", detail: "Contenido mayormente imprimible tras decodificar (posible payload o configuracion). Extracto: " + b64Docs[0].excerpt, source: "strings", refs: b64Docs.slice(0, 5).map((d) => d.excerpt.slice(0, 120)) });
  if (ascii.length >= 10 && blocks.length >= 2) {
    const densest = blocks.reduce((a, b) => (b.count > a.count ? b : a), blocks[0]);
    findings.push({ id: "strings.blocks", severity: "info", title: "Cadenas agrupadas en " + blocks.length + " bloques", detail: "El bloque mas denso (offsets 0x" + densest.start.toString(16) + "-0x" + densest.end.toString(16) + ") concentra " + densest.count + " de " + ascii.length + " cadenas: posible region de configuracion o tabla de strings (sin desensamblar es un indicador de region, no evidencia).", source: "strings", refs: blocks.slice(0, 5).map((b) => "bloque " + b.index + ": 0x" + b.start.toString(16) + "-0x" + b.end.toString(16) + " (" + b.count + ")") });
  }

  const embedded = [];
  for (const d of jsonDocs) embedded.push("json: " + d.excerpt.slice(0, 160));
  for (const d of xmlDocs) embedded.push("xml: " + d.excerpt.slice(0, 160));
  for (const d of b64Docs) embedded.push("base64: " + d.excerpt.slice(0, 160));

  return {
    strings: { interesting, urls, ips, utf16: utf16.map((e) => e.text).slice(0, 50), embedded: embedded.slice(0, 50) },
    findings
  };
}

/* Contrato previo intacto: array de cadenas ASCII. */
function extractStrings(buf, minLen) {
  return extractEntries(buf, minLen || MIN_LEN).map((e) => e.text);
}

module.exports = { detectStrings, extractStrings, extractEntries, extractUtf16Entries, buildBlocks };
