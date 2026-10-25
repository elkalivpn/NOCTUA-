"use strict";
/* Informes del analisis (v0.3.6, issue #20): exportacion JSON y Markdown.
   Diseño: docs/DESIGN-findings-panel.md (D3).
   Este modulo confia en su entrada: el contrato de hallazgos
   (AnalysisResultSchema) lo aplica el llamador en el borde del IPC
   (src/main.js, findings:export) ANTES de construir el informe. Asi el
   modulo es puro y testeable sin zod.
   El informe SIEMPRE contiene el resultado completo del analisis: los
   filtros del panel son para navegar, el informe es el registro. */

const TOOL = "noctua";
const VERSION = "0.3.6";

/* Higiene Markdown: | y saltos de linea no pueden romper la tabla ni
   inyectar contenido desde titulo/detalle/refs de un hallazgo. */
function escapeCell(s) {
  return String(s ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function basenameOf(p) {
  const parts = String(p ?? "").split(/[\\/]/);
  return parts[parts.length - 1] || "fichero";
}

function truncate(s, n) {
  const t = String(s ?? "");
  return t.length > n ? t.slice(0, n) + "..." : t;
}

/* Resumen por severidad: fila para cada severidad del contrato, siempre
   en el mismo orden (tabla estable entre informes). */
function severitySummary(findings) {
  const order = ["critical", "high", "medium", "low", "info"];
  const counts = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  return order.map((s) => "| " + s + " | " + (counts[s] || 0) + " |").join("\n");
}

function buildJsonReport(result, meta) {
  const r = result || {};
  const m = meta || {};
  return JSON.stringify({
    tool: TOOL,
    version: VERSION,
    generatedAt: m.generatedAt || new Date().toISOString(),
    file: r.file,
    format: r.format,
    entropy: r.entropy,
    findings: r.findings,
    yara: r.yara,
    strings: r.strings
  }, null, 2);
}

function buildMarkdownReport(result, meta) {
  const r = result || {};
  const m = meta || {};
  const f = r.format || {};
  const s = r.strings || {};
  const lines = [];
  lines.push("# Informe de analisis — " + basenameOf((r.file || {}).path));
  lines.push("");
  lines.push("- Fichero: `" + escapeCell((r.file || {}).path) + "`");
  lines.push("- SHA-256: `" + ((r.file || {}).sha256 || "?") + "`");
  lines.push("- MD5: `" + ((r.file || {}).md5 || "?") + "`");
  lines.push("- Tamano: " + ((r.file || {}).size ?? "?") + " bytes");
  lines.push("- Formato: " + (f.type || "?") + (f.arch ? " (" + escapeCell(f.arch) + ")" : ""));
  lines.push("- Entropia global: " + ((r.entropy || {}).overall ?? "?"));
  lines.push("- Generado: " + (m.generatedAt || new Date().toISOString()) + " — " + TOOL + " v" + VERSION);
  lines.push("");
  lines.push("## Resumen por severidad");
  lines.push("");
  lines.push("| severidad | hallazgos |");
  lines.push("| --- | --- |");
  lines.push(severitySummary(r.findings || []));
  lines.push("");
  lines.push("## Hallazgos (" + (r.findings || []).length + ")");
  lines.push("");
  if ((r.findings || []).length) {
    lines.push("| severidad | id | fuente | titulo | detalle | refs | offset |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const x of r.findings) {
      lines.push("| " + escapeCell(x.severity) +
        " | `" + escapeCell(x.id) + "`" +
        " | " + escapeCell(x.source) +
        " | " + escapeCell(truncate(x.title, 160)) +
        " | " + escapeCell(truncate(x.detail, 200)) +
        " | " + escapeCell(truncate((x.refs || []).join(" ; "), 200)) +
        " | " + (typeof x.offset === "number" ? "0x" + x.offset.toString(16) : "—") +
        " |");
    }
  } else {
    lines.push("Sin hallazgos.");
  }
  lines.push("");
  lines.push("## Strings destacadas");
  lines.push("");
  const groups = [
    ["URLs", (s.urls || []).slice(0, 10)],
    ["IPs", (s.ips || []).slice(0, 10)],
    ["Sospechosas", (s.interesting || []).slice(0, 10)],
    ["UTF-16LE", (s.utf16 || []).slice(0, 5)],
    ["Embebidas", (s.embedded || []).slice(0, 5)]
  ];
  let any = false;
  for (const g of groups) {
    if (!g[1].length) continue;
    any = true;
    lines.push("- " + g[0] + ": " + escapeCell(truncate(g[1].join(" ; "), 400)));
  }
  if (!any) lines.push("Sin strings destacadas.");
  lines.push("");
  lines.push("## Nota");
  lines.push("");
  lines.push("Informe automatico de analisis estatico generado por " + TOOL + " v" + VERSION + ".");
  lines.push("Los hallazgos heuristicos requieren verificacion manual; este informe no");
  lines.push("constituye evidencia forense. Los offsets son crudos del fichero, no direcciones");
  lines.push("virtuales. El informe registra el analisis completo: no refleja los filtros del panel.");
  lines.push("");
  return lines.join("\n");
}

/* Whitelist de formatos: el borde del IPC valida, aqui tambien (defensa en
   profundidad barata y testeable). */
function buildReport(format, result, meta) {
  if (format === "json") return buildJsonReport(result, meta);
  if (format === "md") return buildMarkdownReport(result, meta);
  throw new Error("formato de informe no soportado: " + format);
}

module.exports = {
  buildReport, buildJsonReport, buildMarkdownReport,
  escapeCell, severitySummary, basenameOf, truncate, TOOL, VERSION
};
