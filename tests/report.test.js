"use strict";
/* Tests de los informes (v0.3.6, issue #20): src/main/report.js.
   report.js confia en su entrada: el contrato de hallazgos lo aplica el
   borde del IPC (mira tests/analysis.test.js para el contrato en si). */
const test = require("node:test");
const assert = require("node:assert");
const { buildReport, buildJsonReport, buildMarkdownReport, escapeCell, severitySummary } = require("../src/main/report");

function fixtureResult() {
  return {
    file: { path: "/data/samples/evil.bin", sha256: "a".repeat(64), md5: "b".repeat(32), size: 1024 },
    format: { type: "PE", arch: "x86", bits: 32 },
    entropy: { overall: 7.91, sections: [{ name: ".text", size: 512, entropy: 7.9 }] },
    findings: [
      { id: "strings.urls", severity: "low", title: "2 URL(s) embebidas", detail: "Posibles C2: a|b", source: "strings", refs: ["http://a.example", "http://b.example"] },
      { id: "packer.high-entropy-section", severity: "high", title: "seccion .text", detail: "linea1\nlinea2", source: "entropy", refs: [] },
      { id: "strings.embedded-json", severity: "medium", title: "1 documento(s) JSON", detail: '{"k":1}', source: "strings", refs: ['{"k"...}'], offset: 16 }
    ],
    yara: [],
    strings: { interesting: ["cmd.exe"], urls: ["http://a.example"], ips: ["10.0.0.1"], utf16: [], embedded: [] }
  };
}

test("buildJsonReport: JSON valido con tool, version y fecha de generacion", () => {
  const out = JSON.parse(buildJsonReport(fixtureResult(), { generatedAt: "2026-10-25T00:00:00.000Z" }));
  assert.strictEqual(out.tool, "noctua");
  assert.strictEqual(out.version, "0.3.6");
  assert.strictEqual(out.generatedAt, "2026-10-25T00:00:00.000Z");
  assert.strictEqual(out.findings.length, 3);
  assert.strictEqual(out.file.sha256, "a".repeat(64));
  assert.strictEqual(out.findings[2].offset, 16);
});

test("buildMarkdownReport: secciones completas y resumen por severidad", () => {
  const md = buildMarkdownReport(fixtureResult(), { generatedAt: "2026-10-25T00:00:00.000Z" });
  assert.ok(md.indexOf("# Informe de analisis — evil.bin") === 0);
  assert.ok(md.indexOf("## Resumen por severidad") !== -1);
  assert.ok(md.indexOf("| high | 1 |") !== -1);
  assert.ok(md.indexOf("| medium | 1 |") !== -1);
  assert.ok(md.indexOf("| low | 1 |") !== -1);
  assert.ok(md.indexOf("| info | 0 |") !== -1, "todas las severidades del contrato aparecen");
  assert.ok(md.indexOf("## Hallazgos (3)") !== -1);
  assert.ok(md.indexOf("0x10") !== -1, "el offset del hallazgo aparece en hexadecimal");
  assert.ok(md.indexOf("## Strings destacadas") !== -1);
  assert.ok(md.indexOf("## Nota") !== -1);
  assert.ok(md.indexOf("no") !== -1 && md.indexOf("evidencia forense") !== -1, "nota honesta presente");
  assert.ok(md.indexOf("a".repeat(64)) !== -1, "sha256 completo en la cabecera");
});

test("escapeCell: pipes y saltos de linea no rompen la tabla", () => {
  assert.strictEqual(escapeCell("a|b"), "a\\|b");
  assert.strictEqual(escapeCell("linea1\nlinea2"), "linea1 linea2");
  assert.strictEqual(escapeCell(null), "");
  const md = buildMarkdownReport(fixtureResult());
  assert.ok(md.indexOf("a\\|b") !== -1, "el pipe del titulo queda escapado");
  assert.ok(md.indexOf("linea1 linea2") !== -1, "el salto de linea del detalle queda plano");
  // el invariant real: cada fila de la tabla de hallazgos tiene exactamente
  // los mismos pipes NO escapados que su encabezado (7 columnas = 8 pipes);
  // los pipes del contenido quedan escapados y no cuentan como celdas
  const lines = md.split("\n");
  const headIdx = lines.findIndex((l) => l.indexOf("| severidad | id | fuente") === 0);
  assert.ok(headIdx !== -1, "encabezado de la tabla de hallazgos presente");
  const headCells = (lines[headIdx].match(/(?<!\\)\|/g) || []).length;
  assert.strictEqual(headCells, 8, "7 columnas = 8 pipes en el encabezado");
  for (let i = headIdx + 2; i < lines.length && lines[i].charAt(0) === "|"; i++) {
    const cells = (lines[i].match(/(?<!\\)\|/g) || []).length;
    assert.strictEqual(cells, headCells, "fila de tabla con pipes balanceados: " + lines[i].slice(0, 60));
  }
});

test("severitySummary: una fila por severidad del contrato, en orden", () => {
  const s = severitySummary(fixtureResult().findings);
  const rows = s.split("\n");
  assert.strictEqual(rows.length, 5);
  assert.strictEqual(rows[0], "| critical | 0 |");
  assert.strictEqual(rows[1], "| high | 1 |");
  assert.strictEqual(rows[3], "| low | 1 |");
});

test("buildReport: whitelist de formatos json y md", () => {
  assert.strictEqual(typeof buildReport("json", fixtureResult()), "string");
  assert.strictEqual(typeof buildReport("md", fixtureResult()), "string");
  assert.throws(() => buildReport("pdf", fixtureResult()), /formato de informe no soportado/);
  assert.throws(() => buildReport("", fixtureResult()), /formato de informe no soportado/);
});
