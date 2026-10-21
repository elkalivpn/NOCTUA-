const TAXONOMY = require("../taxonomy/imports.json");

/* Parsea la salida de rabin2 -i: lineas con name=<API> y dll=<DLL>. */
function parseImports(raw) {
  if (!raw) return [];
  const imports = [];
  for (const line of raw.split("\n")) {
    const nameM = line.match(/name=([^\s]+)/);
    if (!nameM) continue;
    const dllM = line.match(/dll=([^\s]+)/);
    imports.push({ name: nameM[1], dll: dllM ? dllM[1] : "" });
  }
  return imports;
}

/* Detector puro: { raw } -> { imports, findings }.
   La taxonomia categoriza APIs; el agente recibe contexto util, no APIs sueltas. */
function detectImports(input) {
  const imports = parseImports(input.raw);
  const findings = [];
  for (const [id, cat] of Object.entries(TAXONOMY)) {
    const hits = imports.filter((im) =>
      cat.apis.some((a) => im.name.toLowerCase() === a.toLowerCase()));
    if (hits.length) {
      findings.push({
        id,
        severity: cat.severity,
        title: cat.title,
        detail: hits.slice(0, 8).map((h) => (h.dll ? h.dll + "!" : "") + h.name).join(" + "),
        source: "imports",
        refs: hits.slice(0, 8).map((h) => (h.dll ? h.dll + "!" : "") + h.name)
      });
    }
  }
  return { imports, findings };
}

module.exports = { detectImports, parseImports };
