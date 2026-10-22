"use strict";
/* NOCTUA renderer — lógica de UI (app.js).
   La CSP del index.html prohíbe scripts inline: todo el JS del renderer vive en ficheros locales. */

/* ---------- Monaco: self-host desde renderer/vendor (sin CDN) ---------- */
const base = location.href.replace(/[^/]*$/, ""); // directorio renderer/
window.MonacoEnvironment = {
  getWorkerUrl: () => URL.createObjectURL(new Blob([
    "self.MonacoEnvironment={baseUrl:'" + base + "vendor/monaco/vs/'};" +
    "importScripts('" + base + "vendor/monaco/vs/base/worker/workerMain.js');"
  ], { type: "text/javascript" }))
};
require.config({ paths: { vs: "vendor/monaco/vs" } });
require(["vs/editor/editor.main"], function () {
  window.editor = monaco.editor.create(document.getElementById("editor"), {
    value: "// Bienvenido a NOCTUA. Abra un fichero y pulse Analizar para el flujo v0.2.",
    language: "python", theme: "vs-dark", automaticLayout: true,
    fontFamily: "'JetBrains Mono', monospace", fontSize: 13
  });
  monaco.editor.defineTheme("noctua", { base: "vs-dark", inherit: true, rules: [], colors: { "editor.background": "#0b0e14" } });
  monaco.editor.setTheme("noctua");
});

const term = (text, cls) => {
  const el = document.getElementById("output");
  const p = document.createElement("div");
  if (cls) p.className = cls;
  p.textContent = text;
  el.appendChild(p);
  el.scrollTop = el.scrollHeight;
};

const api = window.noctua;
let activeFile = null;
let lastResult = null;
let sourceFilter = null;

async function refreshProvider(desc) {
  document.getElementById("provider-badge").textContent = desc || await api.ai.describe();
}
async function loadPlugins() {
  const list = await api.plugins.list();
  const el = document.getElementById("pluginlist");
  el.innerHTML = "";
  for (const p of list) {
    const b = document.createElement("button");
    b.className = "file" + (p.enabled ? " active" : "");
    b.textContent = p.name + " v" + p.version + (p.enabled ? " [ON]" : "");
    b.onclick = async () => { const on = await api.plugins.toggle(p.id); b.classList.toggle("active", on); b.textContent = p.name + " v" + p.version + (on ? " [ON]" : ""); };
    el.appendChild(b);
  }
  if (!list.length) el.innerHTML = "<p style='color:#475569;font-size:11px;padding:4px 10px;'>Sin plugins instalados</p>";
}

document.getElementById("btn-open").onclick = async () => {
  const p = await api.fs.pickFile();
  if (!p) return;
  activeFile = p;
  try {
    const content = await api.fs.readFile(p);
    if (window.editor) {
      window.editor.setValue(content);
      const lang = p.endsWith(".py") ? "python" : p.endsWith(".js") ? "javascript" : p.endsWith(".md") ? "markdown" : "plaintext";
      monaco.editor.setModelLanguage(window.editor.getModel(), lang);
    }
  } catch (e) { term("binario o no-UTF8: solo análisis (" + e.message + ")", "err"); }
  term("abierto: " + p, "info");
};

/* ---------- Flujo vertical v0.2 ---------- */
api.analysis.onProgress((s) => {
  const bar = document.querySelector("#an-progress div");
  bar.style.width = s.pct + "%";
  term("[analyze] " + s.stage + " " + s.pct + "%", "info");
});

document.getElementById("btn-analyze").onclick = async () => {
  if (!activeFile) return term("abra primero un fichero", "err");
  const panel = document.getElementById("analysis");
  panel.classList.add("open");
  document.getElementById("an-name").textContent = activeFile.split("/").pop();
  document.getElementById("an-sha").textContent = "calculando…";
  document.getElementById("an-list").innerHTML = "";
  document.getElementById("an-detail").textContent = "Ejecutando detectores…";
  document.getElementById("explain-box").style.display = "none";
  document.getElementById("btn-explain").disabled = true;
  try {
    lastResult = await api.analysis.run(activeFile);
    renderAnalysis(lastResult);
    document.getElementById("btn-explain").disabled = false;
    term("análisis completado: " + lastResult.findings.length + " hallazgos", "ok");
  } catch (e) {
    term("error de análisis: " + e, "err");
    document.getElementById("an-detail").textContent = "Error: " + e;
  }
};

document.getElementById("btn-close-analysis").onclick = () =>
  document.getElementById("analysis").classList.remove("open");

function maxSeverity(findings) {
  const order = ["critical", "high", "medium", "low", "info"];
  for (const s of order) if (findings.some((f) => f.severity === s)) return s;
  return "info";
}

function renderAnalysis(r) {
  document.getElementById("an-type").textContent = r.format.type + (r.format.arch ? " · " + r.format.arch : "");
  document.getElementById("an-sha").textContent = r.file.sha256.slice(0, 24) + "…";
  document.getElementById("an-sha").onclick = () => {
    navigator.clipboard.writeText(r.file.sha256).then(() => term("sha256 copiado", "ok"));
  };
  const risk = maxSeverity(r.findings);
  document.getElementById("an-risk").innerHTML =
    '<span class="sev ' + risk + '">RIESGO AGREGADO: ' + risk.toUpperCase() + "</span>";

  const sources = [...new Set(r.findings.map((f) => f.source))];
  const chips = document.getElementById("an-chips");
  chips.innerHTML = "";
  sourceFilter = null;
  for (const s of sources) {
    const c = document.createElement("button");
    c.className = "chip";
    c.textContent = s;
    c.onclick = () => {
      sourceFilter = sourceFilter === s ? null : s;
      [...chips.children].forEach((x) => x.classList.toggle("on", x.textContent === sourceFilter));
      renderFindings(r);
    };
    chips.appendChild(c);
  }
  document.getElementById("an-search").oninput = () => renderFindings(r);
  renderFindings(r);
}

function renderFindings(r) {
  const q = document.getElementById("an-search").value.toLowerCase();
  const list = document.getElementById("an-list");
  list.innerHTML = "";
  const filtered = r.findings.filter((f) =>
    (!sourceFilter || f.source === sourceFilter) &&
    (!q || (f.title + " " + f.detail + " " + f.refs.join(" ")).toLowerCase().includes(q)));

  const groups = ["critical", "high", "medium", "low", "info"];
  for (const g of groups) {
    const items = filtered.filter((f) => f.severity === g);
    if (!items.length) continue;
    const h = document.createElement("p");
    h.className = "sev-group";
    h.textContent = g + " (" + items.length + ")";
    list.appendChild(h);
    for (const f of items) list.appendChild(renderFinding(f));
  }
  if (!filtered.length) {
    const p = document.createElement("p");
    p.style.color = "#475569";
    p.textContent = "Sin hallazgos con este filtro.";
    list.appendChild(p);
  }
}

function renderFinding(f) {
  const d = document.createElement("div");
  d.className = "finding";
  const sev = document.createElement("span");
  sev.className = "sev " + f.severity;
  sev.textContent = f.severity.toUpperCase();
  const t = document.createElement("div");
  t.className = "t";
  t.appendChild(sev);
  t.appendChild(document.createTextNode(" " + f.title));
  const det = document.createElement("div");
  det.className = "d";
  det.textContent = f.detail;
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = "id: " + f.id + " · source: " + f.source + (f.refs.length ? " · refs: " + f.refs.slice(0, 4).join(", ") : "");
  d.appendChild(t); d.appendChild(det); d.appendChild(meta);
  d.onclick = () => {
    document.getElementById("an-detail").textContent =
      f.title + " — " + f.detail + " | referencias: " + (f.refs.join(", ") || "ninguna");
  };
  return d;
}

/* ---------- Explicación del agente (prompt de triaje) ---------- */
document.getElementById("btn-explain").onclick = async () => {
  if (!lastResult) return;
  const box = document.getElementById("explain-box");
  box.style.display = "block";
  box.textContent = "Consultando al agente…";
  term("[agent] triaje → JSON de hallazgos enviado", "info");
  try {
    const ex = await api.ai.explain(lastResult);
    if (ex.parse_error) {
      box.textContent = "El agente no devolvió JSON válido. Respuesta bruta:\n" + ex.raw;
      return;
    }
    let html = "";
    html += '<span class="sev ' + (ex.risk || "info") + '">RIESGO: ' + (ex.risk || "?").toUpperCase() + "</span>";
    html += ' <span style="color:#64748b">confianza: ' + (ex.confidence ?? "?") + "%</span>";
    html += '<p style="margin-top:6px;color:#e2e8f0">' + esc(ex.summary || "") + "</p>";
    if (ex.likely_behavior?.length) html += "<p style='color:#fbbf24'>Comportamiento probable: " + esc(ex.likely_behavior.join("; ")) + "</p>";
    if (ex.next_steps?.length) {
      html += "<p style='color:#22d3ee'>Siguientes pasos:</p><ul style='margin:2px 0 4px 18px;color:#94a3b8'>";
      for (const s of ex.next_steps) html += "<li>" + esc(s.action) + " <span style='color:#64748b'>[" + esc(s.tool || "") + "]</span> <span style='color:#475569'>" + esc(s.why || "") + "</span></li>";
      html += "</ul>";
    }
    if (ex.ioc_candidates?.length) html += "<p style='color:#f87171'>IOC candidatos: " + esc(ex.ioc_candidates.join(", ")) + "</p>";
    if (ex.unknowns?.length) html += "<p style='color:#64748b'>Evidencia insuficiente para: " + esc(ex.unknowns.join("; ")) + "</p>";
    box.innerHTML = html;
  } catch (e) {
    box.textContent = "Error del agente: " + e;
  }
};

function esc(s) { const d = document.createElement("div"); d.textContent = String(s); return d.innerHTML; }

/* ---------- Terminal real (PTY, issue #3) ---------- */
const tabOut = document.getElementById("tab-output");
const tabTerm = document.getElementById("tab-term");
const outputEl = document.getElementById("output");
const realtermEl = document.getElementById("realterm");

function switchTab(which) {
  const real = which === "term";
  tabOut.classList.toggle("active", !real);
  tabTerm.classList.toggle("active", real);
  outputEl.style.display = real ? "none" : "block";
  realtermEl.classList.toggle("open", real);
}

tabOut.onclick = () => switchTab("out");
tabTerm.onclick = async () => {
  switchTab("term");
  if (TerminalPanel.isActive()) return;
  realtermEl.textContent = "abriendo PTY…";
  try {
    await TerminalPanel.start(realtermEl);
    term("terminal PTY iniciada", "ok");
  } catch (e) {
    realtermEl.textContent = "Terminal no disponible: " + e;
    term("terminal no disponible: " + e, "err");
  }
};

/* ---------- Chat del agente ---------- */
function addMsg(text, who) {
  const c = document.getElementById("chat");
  const d = document.createElement("div");
  d.className = "msg " + who;
  d.textContent = text;
  c.appendChild(d);
  c.scrollTop = c.scrollHeight;
}
async function askAgent(prompt) {
  addMsg(prompt, "user");
  try {
    const ctx = { activeFile, code: window.editor ? window.editor.getValue().slice(0, 8000) : null };
    const reply = await api.ai.chat(prompt, ctx);
    addMsg(reply, "bot");
  } catch (e) { addMsg("Error del agente: " + e, "bot"); }
}
document.getElementById("send").onclick = () => askAgent(document.getElementById("prompt").value);
document.getElementById("prompt").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.ctrlKey) askAgent(e.target.value);
});
document.getElementById("p-mistral").onclick = async () => {
  await api.ai.switchProvider("mistral"); await refreshProvider();
  document.getElementById("p-mistral").classList.add("active");
  document.getElementById("p-ollama").classList.remove("active");
};
document.getElementById("p-ollama").onclick = async () => {
  await api.ai.switchProvider("ollama"); await refreshProvider();
  document.getElementById("p-ollama").classList.add("active");
  document.getElementById("p-mistral").classList.remove("active");
};
api.tools.onStream((data) => term("[stream] " + data.split("\n").pop(), "info"));
refreshProvider().then(loadPlugins);
addMsg("Sesión iniciada. Flujo v0.2: abra un binario y pulse Analizar. La pestaña ＋ TERMINAL abre una PTY real de su shell.", "bot");
