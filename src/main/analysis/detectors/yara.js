/* Detector puro: salida de "yara -r rules dir fichero" -> { yara, findings }.
   Formato por linea: <namespace>:<regla> <fichero>  |  <regla> <fichero>  [meta] */
function parseYara(raw) {
  const matches = [];
  if (!raw) return { yara: matches, findings: [] };
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("[")) continue;
    const parts = t.split(/\s+/);
    let rule = parts[0], namespace = "default";
    if (rule.includes(":")) { const seg = rule.split(":"); namespace = seg[0]; rule = seg[1]; }
    if (!rule || rule === "yara") continue;
    matches.push({ rule, namespace });
    // Solo con firma YARA explicita se permite hablar de familia (ver prompt del agente).
  }
  const findings = matches.map((m) => ({
    id: "yara.match:" + m.rule,
    severity: "high",
    title: "Coincidencia YARA: " + m.rule,
    detail: "Regla '" + m.rule + "' (namespace " + m.namespace + ") coincide con el fichero.",
    source: "yara",
    refs: [m.rule]
  }));
  return { yara: matches, findings };
}

module.exports = { parseYara };
