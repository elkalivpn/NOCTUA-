const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { detectFormat, parseSections } = require("../src/main/analysis/detectors/format");
const { shannonEntropy, detectEntropy } = require("../src/main/analysis/detectors/entropy");
const { detectImports } = require("../src/main/analysis/detectors/imports");
const { detectStrings } = require("../src/main/analysis/detectors/strings");
const { parseYara } = require("../src/main/analysis/detectors/yara");
const { detectMitigations } = require("../src/main/analysis/detectors/mitigations");
const { validateResult, sortFindings } = require("../src/main/analysis/schema");

/* Fixture PE sintetico generado en runtime (sin binarios en el repo):
   header de 0x200 bytes + N secciones de 0x1000. */
function buildPE(opts = {}) {
  const nSections = 2;
  const buf = Buffer.alloc(0x200 + nSections * 0x1000, 0);
  buf.write("MZ", 0, "latin1");
  buf.writeUInt32LE(0x80, 0x3c);            // e_lfanew
  buf.write("PE\u0000\u0000", 0x80, "latin1");
  buf.writeUInt16LE(0x8664, 0x84);          // machine x86-64
  buf.writeUInt16LE(nSections, 0x86);      // NumberOfSections
  buf.writeUInt16LE(0xf0, 0x94);            // SizeOfOptionalHeader at peOffset+20
  const optHeader = 0x80 + 24;             // OptionalHeader offset (0x98)
  buf.writeUInt16LE(0x20b, optHeader);     // PE32+ magic at 0x98
  buf.writeUInt16LE(opts.subsystem ?? 3, optHeader + 0x44);     // CUI at 0xDC
  buf.writeUInt16LE(opts.dllChar ?? 0x0100, optHeader + 0x46); // NX por defecto at 0xDE
  const table = optHeader + 0xf0;          // Section table at 0x188
  const names = [".text", ".rdata"];
  for (let i = 0; i < nSections; i++) {
    const e = table + i * 40;
    buf.write(names[i], e, "latin1");
    buf.writeUInt32LE(0x1000, e + 16);      // SizeOfRawData
    buf.writeUInt32LE(0x200 + i * 0x1000, e + 20); // PointerToRawData
  }
  // .text: baja entropia (uniforme); .rdata: alta (pseudoaleatoria determinista)
  for (let i = 0x200; i < 0x1200; i++) buf[i] = 0x41;
  for (let i = 0x1200; i < 0x2200; i++) buf[i] = (i * 31 + 7) & 0xff;
  return buf;
}

test("formato PE32+ detectado desde el buffer", () => {
  const f = detectFormat(buildPE());
  assert.strictEqual(f.type, "PE32+");
  assert.strictEqual(f.arch, "x86-64");
  assert.strictEqual(f.bits, 64);
  assert.strictEqual(f.subsystem, "WINDOWS_CUI");
});

test("tabla de secciones parseada: .text y .rdata", () => {
  const buf = buildPE();
  const f = detectFormat(buf);
  const secs = parseSections(buf, f);
  assert.deepStrictEqual(secs.map((s) => s.name), [".text", ".rdata"]);
  assert.strictEqual(secs[0].size, 0x1000);
});

test("hallazgo de seccion con alta entropia (posible packer)", () => {
  const buf = buildPE();
  const f = detectFormat(buf);
  const sections = parseSections(buf, f).map((s) => ({
    name: s.name, size: s.size,
    entropy: Number(shannonEntropy(buf.subarray(s.offset, s.offset + s.size)).toFixed(2))
  }));
  const findings = detectEntropy({ overall: 6.1, sections });
  const high = findings.find((x) => x.id === "packer.high-entropy-section");
  assert.ok(high, "debe existir el hallazgo de entropia alta");
  assert.strictEqual(high.severity, "high");
  assert.deepStrictEqual(high.refs, [".rdata"]);
});

test("mitigaciones: PE sin NX genera hallazgo DEP deshabilitado", () => {
  const buf = buildPE({ dllChar: 0x0000 });
  const f = detectFormat(buf);
  const findings = detectMitigations(buf, f, []);
  assert.ok(findings.some((x) => x.id === "mitigations.dep-disabled" && x.severity === "high"));
  assert.ok(findings.some((x) => x.id === "mitigations.aslr-disabled"));
});

test("imports: salida rabin2 con APIs de inyeccion produce hallazgo categorizado", () => {
  const raw = "[Imports]\nordinal=1 name=VirtualAlloc dll=KERNEL32.dll\nordinal=2 name=CreateRemoteThread dll=KERNEL32.dll\nordinal=3 name=RegCreateKeyExW dll=ADVAPI32.dll";
  const res = detectImports({ raw });
  const inj = res.findings.find((x) => x.id === "api.process-injection");
  assert.ok(inj, "debe categorizar inyeccion de proceso");
  assert.strictEqual(inj.severity, "high");
  assert.ok(inj.refs.includes("KERNEL32.dll!VirtualAlloc"));
  assert.ok(res.findings.some((x) => x.id === "api.persistence"));
});

test("imports: sin rabin2 disponible no hay hallazgos ni crash", () => {
  const res = detectImports({ raw: null });
  assert.deepStrictEqual(res.findings, []);
  assert.deepStrictEqual(res.imports, []);
});

test("strings: extrae URL e IP embebidas y genera hallazgos", () => {
  const buf = Buffer.from("AAAAhttp://185.23.4.11/gate.php AAAA 10.0.0.1 AAAA cmd.exe /c whoami", "latin1");
  const res = detectStrings({ buffer: buf });
  assert.ok(res.strings.urls.some((u) => u.includes("gate.php")));
  assert.ok(res.strings.ips.includes("185.23.4.11"));
  assert.ok(res.strings.interesting.length > 0);
  assert.ok(res.findings.some((x) => x.id === "strings.urls"));
});

test("yara: parseo de coincidencias con namespace", () => {
  const res = parseYara("default:Win32_Packer_Generic /tmp/mal.exe\nsecond:MzHead /tmp/mal.exe\n");
  assert.deepStrictEqual(res.yara.map((m) => m.rule), ["Win32_Packer_Generic", "MzHead"]);
  assert.strictEqual(res.yara[0].namespace, "default");
  assert.ok(res.findings.every((f) => f.severity === "high"));
});

test("el AnalysisResult ensamblado valida contra el contrato", () => {
  const buf = buildPE();
  const f = detectFormat(buf);
  const sections = parseSections(buf, f).map((s) => ({ name: s.name, size: s.size, entropy: 7.98 }));
  const result = {
    file: { path: "/tmp/x.exe", sha256: "a".repeat(64), md5: "b".repeat(32), size: buf.length },
    format: f,
    entropy: { overall: 7.91, sections },
    findings: sortFindings([
      { id: "packer.high-entropy-section", severity: "high", title: "x", detail: "y", source: "entropy", refs: [".rdata"] },
      { id: "strings.urls", severity: "low", title: "x", detail: "y", source: "strings", refs: [] }
    ]),
    yara: [{ rule: "Win32_Packer_Generic", namespace: "default" }],
    strings: { interesting: ["cmd.exe /c"], urls: [], ips: [] }
  };
  const v = validateResult(result);
  assert.strictEqual(v.findings[0].severity, "high"); // ordenado por severidad
  assert.strictEqual(v.findings[1].severity, "low");
});

test("runAnalysis integra el flujo completo sobre un fixture PE real en disco", async () => {
  const { runAnalysis } = require("../src/main/analysis");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "noctua-an-"));
  const fp = path.join(dir, "sample.exe");
  await fs.writeFile(fp, buildPE());
  const stages = [];
  const r = await runAnalysis(fp, { onProgress: (s) => stages.push(s.stage) });
  assert.ok(r.file.sha256.length === 64);
  assert.strictEqual(r.format.type, "PE32+");
  assert.ok(r.findings.some((x) => x.id === "packer.high-entropy-section"));
  assert.ok(stages.includes("done"));
});
