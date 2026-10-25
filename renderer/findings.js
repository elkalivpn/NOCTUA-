"use strict";
/* Filtros y navegacion del panel de hallazgos (v0.3.6, issue #20).
   Diseño: docs/DESIGN-findings-panel.md (D1 y D2).
   Funciones PURAS: sin DOM, testeables con node:test bajo la guarda de
   module (mismo patron que tree.js y palette.js). El DOM vive en app.js. */

const SEVERITIES = ["critical", "high", "medium", "low", "info"];

/* Conteo por severidad: siempre las cinco claves del contrato (facilita
   pintar chips con contador sin casos especiales). */
function severityCounts(findings) {
  const counts = {};
  for (const s of SEVERITIES) counts[s] = 0;
  for (const f of findings || []) {
    if (counts[f.severity] !== undefined) counts[f.severity]++;
  }
  return counts;
}

/* Estado esperado: { severities: Set|null, sources: Set|null, query: string }.
   Eje ausente (null/undefined) = sin filtro por ese eje. Un conjunto
   PRESENTE exige pertenencia: conjunto vacio = nada visible (sin negacion
   vacia: el usuario desactiva chips explicitamente). */
function filterFindings(findings, state) {
  const st = state || {};
  const sevs = st.severities || null;
  const srcs = st.sources || null;
  const q = (st.query || "").toLowerCase();
  return (findings || []).filter((f) =>
    (!sevs || sevs.has(f.severity)) &&
    (!srcs || srcs.has(f.source)) &&
    (!q || (f.title + " " + f.detail + " " + (f.refs || []).join(" ")).toLowerCase().includes(q)));
}

/* Linea (1-based) y columna (1-based) de un offset de byte en un texto.
   EXACTO para ASCII/Latin-1; aproximado para UTF-8 multibyte: los indices
   de string JS cuentan unidades UTF-16, no bytes (limite declarado en el
   diseño D2). El offset se acota al texto. */
function locateOffset(text, byteOffset) {
  const s = String(text ?? "");
  const idx = Math.max(0, Math.min(Math.floor(byteOffset || 0), s.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < idx; i++) {
    if (s.charCodeAt(i) === 10) { line++; lineStart = i + 1; }
  }
  return { line, column: idx - lineStart + 1 };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { SEVERITIES, severityCounts, filterFindings, locateOffset };
}
