"use strict";
/* NOCTUA renderer — paleta de comandos (v0.3.2).
   Registro de comandos + filtrado difuso (utilidades puras, testeables con
   node:test sin DOM bajo el guard de module) + overlay CommandPalette.
   Ctrl+Shift+P abre/cierra; flechas navegan; Enter ejecuta; Esc cierra.
   La superficie de seguridad no cambia: cada comando llama a APIs ya
   existentes; las herramientas externas pasan por la whitelist del
   proceso principal (PALETTE_TOOLS en src/main.js), nunca por shell. */

/* ---------- utilidades puras (testeables sin DOM) ---------- */

function normalizeText(s) {
  /* minúsculas y sin diacríticos: "Análisis" equivale a "analisis" en el filtrado */
  return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function fuzzyScore(query, text) {
  /* Subsecuencia: null si algún carácter de query no aparece en orden.
     Bonifica coincidencias consecutivas y límites de palabra. */
  if (!query) return 0;
  const q = normalizeText(query).replace(/\s+/g, "");
  if (!q) return 0;
  const t = normalizeText(text);
  let score = 0, ti = 0, prev = -2, streak = 0;
  for (const ch of q) {
    const idx = t.indexOf(ch, ti);
    if (idx === -1) return null;
    streak = idx === prev + 1 ? streak + 1 : 0;
    const boundary = idx === 0 || " :(-[".includes(t[idx - 1]);
    score += 1 + streak * 2 + (boundary ? 3 : 0);
    prev = idx;
    ti = idx + 1;
  }
  return score;
}

function filterCommands(commands, query) {
  /* Devuelve [{ command, score }] ordenado por relevancia; sin query, todos. */
  const byTitle = (a, b) => (a.command.title < b.command.title ? -1 : a.command.title > b.command.title ? 1 : 0);
  if (!query) return commands.map((c) => ({ command: c, score: 0 })).sort(byTitle);
  const out = [];
  for (const c of commands) {
    const s = fuzzyScore(query, c.category + " " + c.title);
    if (s === null) continue;
    const t = fuzzyScore(query, c.title);
    out.push({ command: c, score: s + (t !== null ? 8 + t : 0) });
  }
  return out.sort((a, b) => b.score - a.score || byTitle(a, b));
}

function createRegistry() {
  /* Registro: { id, category, title, when?, run }.
     - id único y no vacío, run función: BAD_ARGS en caso contrario.
     - when (opcional) se evalúa al listar: filtra comandos sin sentido en el
       estado actual (p.ej. navegar hallazgos sin análisis previo). */
  const commands = new Map();
  return {
    register(cmd) {
      if (!cmd || typeof cmd !== "object") throw new Error("BAD_ARGS: comando inválido");
      if (typeof cmd.id !== "string" || !cmd.id.trim()) throw new Error("BAD_ARGS: comando sin id");
      if (typeof cmd.run !== "function") throw new Error("BAD_ARGS: run debe ser una función");
      if (commands.has(cmd.id)) throw new Error("BAD_ARGS: id duplicado: " + cmd.id);
      commands.set(cmd.id, {
        id: cmd.id,
        category: typeof cmd.category === "string" && cmd.category ? cmd.category : "General",
        title: typeof cmd.title === "string" && cmd.title ? cmd.title : cmd.id,
        when: typeof cmd.when === "function" ? cmd.when : null,
        run: cmd.run
      });
      return cmd.id;
    },
    get: (id) => commands.get(id) || null,
    list() {
      return [...commands.values()].filter((c) => !c.when || c.when());
    },
    size: () => commands.size
  };
}

/* ---------- overlay UI (IIFE; sin acceso a Node ni a red) ---------- */
const CommandPalette = (function () {
  let overlay = null, input = null, listEl = null;
  let registry = null, items = [], sel = 0;
  const MAX = 60;

  function ensureDom() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.id = "palette-overlay";
    const box = document.createElement("div");
    box.id = "palette";
    input = document.createElement("input");
    input.id = "palette-input";
    input.placeholder = "escriba un comando…  ↑↓ navegar · Enter ejecutar · Esc cerrar";
    input.autocomplete = "off";
    input.spellcheck = false;
    listEl = document.createElement("div");
    listEl.className = "pal-list";
    box.appendChild(input);
    box.appendChild(listEl);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
    input.addEventListener("input", () => render(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") { e.preventDefault(); execSel(); }
    });
  }

  function render(query) {
    listEl.textContent = "";
    items = filterCommands(registry.list(), query).slice(0, MAX);
    sel = 0;
    if (!items.length) {
      const p = document.createElement("div");
      p.className = "pal-empty";
      p.textContent = "Sin comandos que coincidan.";
      listEl.appendChild(p);
      return;
    }
    items.forEach((it, i) => {
      const d = document.createElement("div");
      d.className = "pal-item" + (i === sel ? " sel" : "");
      const cat = document.createElement("span");
      cat.className = "cat";
      cat.textContent = it.command.category;
      const t = document.createElement("span");
      t.textContent = it.command.title;
      d.appendChild(cat);
      d.appendChild(t);
      d.onclick = () => { sel = i; execSel(); };
      listEl.appendChild(d);
    });
  }

  function move(dir) {
    if (!items.length) return;
    sel = (sel + dir + items.length) % items.length;
    const els = listEl.querySelectorAll(".pal-item");
    els.forEach((el, i) => el.classList.toggle("sel", i === sel));
    els[sel].scrollIntoView({ block: "nearest" });
  }

  function execSel() {
    const it = items[sel];
    if (!it) return;
    const run = it.command.run;
    close();
    try {
      const r = run();
      if (r && typeof r.catch === "function") r.catch((e) => console.error("[palette]", e));
    } catch (e) {
      console.error("[palette]", e);
    }
  }

  function open() {
    if (!registry) return;
    ensureDom();
    overlay.classList.add("open");
    input.value = "";
    render("");
    input.focus();
  }
  function close() { if (overlay) overlay.classList.remove("open"); }
  function isOpen() { return !!overlay && overlay.classList.contains("open"); }
  function toggle() { if (isOpen()) close(); else open(); }

  function init(opts) {
    registry = opts && opts.registry ? opts.registry : registry;
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "P" || e.key === "p")) {
        e.preventDefault();
        toggle();
      }
    });
  }

  return { init, open, close, toggle, isOpen };
})();

if (typeof window !== "undefined" && window) window.CommandPalette = CommandPalette;

/* Exportación para node:test (mismo patrón que tree.js). */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { normalizeText, fuzzyScore, filterCommands, createRegistry };
}
