const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { Worker } = require("worker_threads");
const { spawn } = require("child_process");

const { validateResult, sortFindings } = require("./schema");
const { detectFormat, parseSections, formatFindings } = require("./detectors/format");
const { shannonEntropy, detectEntropy } = require("./detectors/entropy");
const { detectMitigations } = require("./detectors/mitigations");

/* Criterio de ubicacion (ver ARCHITECTURE.md):
   - Inline: una pasada O(n) sobre el buffer (lectura, hashes, formato, entropia).
   - worker_threads: parseo pesado y CPU-bound (strings sobre binarios de 200 MB,
     tabla de imports grande). Nunca en el hilo principal de Electron. */

function runTool(cmd, args, timeout = 60000) {
  return new Promise((resolve) => {
    let out = "", err = "";
    let p;
    try { p = spawn(cmd, args, { timeout }); } catch (e) {
      return resolve({ code: 127, out: "", err: e.message });
    }
    p.stdout && p.stdout.on("data", (d) => { out += d; });
    p.stderr && p.stderr.on("data", (d) => { err += d; });
    p.on("error", () => resolve({ code: 127, out: "", err: "herramienta no disponible" }));
    p.on("close", (code) => resolve({ code: code === null ? 124 : code, out, err }));
  });
}

function runDetectorInWorker(name, input) {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, "worker.js"), { workerData: { name, input } });
    w.on("message", (m) => { w.terminate(); resolve(m); });
    w.on("error", (e) => { reject(e); });
    w.on("exit", (code) => { if (code !== 0 && code !== null && code !== 1) reject(new Error("worker exit " + code)); });
  });
}

async function runAnalysis(filePath, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const yaraRules = opts.yaraRules || null; // p.ej. "/usr/share/yara" o un fichero de reglas

  onProgress({ stage: "reading", pct: 5 });
  const buf = await fs.readFile(filePath);
  const file = {
    path: filePath,
    size: buf.length,
    sha256: crypto.createHash("sha256").update(buf).digest("hex"),
    md5: crypto.createHash("md5").update(buf).digest("hex")
  };

  onProgress({ stage: "static", pct: 25 });
  const format = detectFormat(buf);
  const sections = parseSections(buf, format).map((s) => ({
    name: s.name, size: s.size,
    entropy: Number(shannonEntropy(buf.subarray(s.offset, s.offset + s.size)).toFixed(2))
  }));
  const overall = Number(shannonEntropy(buf).toFixed(3));

  onProgress({ stage: "tools", pct: 45 });
  // Herramientas externas en paralelo (spawn: no bloquea el event loop).
  const [rabinOut, yaraOut] = await Promise.all([
    runTool("rabin2", ["-i", filePath]),
    yaraRules
      ? runTool("yara", ["-r", yaraRules, filePath])
      : Promise.resolve({ code: 127, out: "", err: "sin reglas configuradas" })
  ]);

  onProgress({ stage: "detectors", pct: 65 });
  // Detectores pesados en workers; ligeros inline (funciones puras).
  const [stringsRes, importsRes, yaraRes] = await Promise.all([
    runDetectorInWorker("strings", { buffer: buf }),
    runDetectorInWorker("imports", { raw: rabinOut.code === 0 ? rabinOut.out : null }),
    runDetectorInWorker("yara", { raw: yaraOut.code === 0 ? yaraOut.out : null })
  ]);

  onProgress({ stage: "assemble", pct: 90 });
  const findings = [
    ...formatFindings(format),
    ...detectEntropy({ overall, sections }),
    ...importsRes.findings,
    ...stringsRes.findings,
    ...yaraRes.findings,
    ...detectMitigations(buf, format, importsRes.imports)
  ];

  const result = {
    file, format,
    entropy: { overall, sections },
    findings: sortFindings(findings),
    yara: yaraRes.yara,
    strings: stringsRes.strings
  };

  const validated = validateResult(result);
  onProgress({ stage: "done", pct: 100 });
  return validated;
}

module.exports = { runAnalysis };
