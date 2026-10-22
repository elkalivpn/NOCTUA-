"use strict";
/* WorkspaceTree — árbol de proyectos del renderer (módulo independiente, v0.3.0).
   Carga diferida (lazy) por api.fs.readDir, iconos por tipo de fichero, click
   abre en Monaco y drag-and-drop en ambos sentidos. Sin CDN ni dependencias. */

/* ---------- utilidades puras (testeables con node:test) ---------- */
function iconFor(name, isDir) {
  if (isDir) return { glyph: "▤", cls: "ico-dir" };
  const ext = (name.toLowerCase().split(".").pop() || "").trim();
  const map = {
    js: ["JS", "ico-js"], mjs: ["JS", "ico-js"], json: ["{}", "ico-json"],
    py: ["PY", "ico-py"], sh: ["$", "ico-sh"], bash: ["$", "ico-sh"],
    md: ["M↓", "ico-md"], c: ["C", "ico-c"], h: ["H", "ico-c"],
    cpp: ["C+", "ico-c"], cc: ["C+", "ico-c"], hpp: ["H", "ico-c"],
    html: ["<>", "ico-html"], css: ["#", "ico-css"],
    png: ["img", "ico-img"], jpg: ["img", "ico-img"], jpeg: ["img", "ico-img"],
    gif: ["img", "ico-img"], svg: ["img", "ico-img"],
    bin: ["BIN", "ico-bin"], exe: ["EXE", "ico-bin"], elf: ["ELF", "ico-bin"],
    so: ["SO", "ico-bin"], dll: ["DLL", "ico-bin"], zip: ["ZIP", "ico-bin"],
    tar: ["TAR", "ico-bin"], gz: ["GZ", "ico-bin"], xz: ["XZ", "ico-bin"],
    pdf: ["PDF", "ico-bin"]
  };
  const hit = map[ext];
  return hit ? { glyph: hit[0], cls: hit[1] } : { glyph: "·", cls: "ico-other" };
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    return a.name.localeCompare(b.name, "es", { sensitivity: "base", numeric: true });
  });
}

function languageFor(path) {
  const ext = path.toLowerCase().split(".").pop();
  if (ext === "py") return "python";
  if (ext === "js" || ext === "mjs") return "javascript";
  if (ext === "json") return "json";
  if (ext === "md") return "markdown";
  if (ext === "c" || ext === "h") return "c";
  if (ext === "cpp" || ext === "hpp" || ext === "cc") return "cpp";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "css") return "css";
  if (ext === "sh" || ext === "bash") return "shell";
  return "plaintext";
}

function joinPath(dir, name) {
  return /[\\/]$/.test(dir) ? dir + name : dir + "/" + name;
}

/* ---------- árbol (DOM) ---------- */
const WorkspaceTree = (() => {
  const state = { container: null, api: null, roots: [], expanded: new Set(), onFileOpen: null };

  function init(container, { onFileOpen } = {}) {
    state.container = container;
    state.api = window.noctua;
    state.onFileOpen = onFileOpen;
    render();
  }

  async function setRoot(dirPath) {
    const root = await makeNode(dirPath, true);
    state.roots = [root];
    state.expanded = new Set([root.path]);
    await loadChildren(root);
  }

  async function addFileRoot(filePath) {
    if (state.roots.some((r) => r.path === filePath)) return;
    state.roots.push(await makeNode(filePath, false));
    render();
  }

  async function makeNode(path, isDir) {
    const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
    return { path, name, dir: isDir, children: [], loaded: !isDir, loading: false, error: false };
  }

  async function loadChildren(node) {
    if (!node.dir || node.loaded) return;
    node.loading = true;
    render();
    try {
      const entries = await state.api.fs.readDir(node.path);
      node.children = sortEntries(entries).map((e) => ({
        path: joinPath(node.path, e.name),
        name: e.name,
        dir: e.dir,
        children: [],
        loaded: !e.dir,
        loading: false,
        error: false
      }));
      node.loaded = true;
    } catch (e) {
      node.error = true;
    }
    node.loading = false;
    render();
  }

  function collapseAll() {
    state.expanded.clear();
    render();
  }

  function findNode(path, nodes = state.roots) {
    for (const n of nodes) {
      if (n.path === path) return n;
      const hit = findNode(path, n.children);
      if (hit) return hit;
    }
    return null;
  }

  function toggle(path) {
    const node = findNode(path);
    if (!node) return;
    if (state.expanded.has(path)) {
      state.expanded.delete(path);
      render();
    } else {
      state.expanded.add(path);
      if (!node.loaded) loadChildren(node);
      else render();
    }
  }

  function render() {
    const c = state.container;
    if (!c) return;
    c.innerHTML = "";
    if (!state.roots.length) {
      const p = document.createElement("p");
      p.className = "tree-empty";
      p.textContent = "Arrastre ficheros aquí o pulse Abrir carpeta.";
      c.appendChild(p);
      return;
    }
    for (const r of state.roots) c.appendChild(renderNode(r, 0));
  }

  function renderNode(node, depth) {
    const row = document.createElement("div");
    row.className = "tree-row " + (node.dir ? "tree-dir" : "tree-file");
    row.style.paddingLeft = (6 + depth * 12) + "px";
    row.title = node.path;
    if (!node.dir) row.draggable = true; // los ficheros se arrastran al editor

    if (node.dir) {
      const caret = document.createElement("span");
      caret.className = "caret";
      caret.textContent = state.expanded.has(node.path) ? "▾" : "▸";
      row.appendChild(caret);
    }
    const ico = iconFor(node.name, node.dir);
    const icoEl = document.createElement("span");
    icoEl.className = "ico " + ico.cls;
    icoEl.textContent = ico.glyph;
    row.appendChild(icoEl);
    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = node.name;
    row.appendChild(label);
    if (node.loading) {
      const l = document.createElement("span");
      l.className = "tree-loading";
      l.textContent = "…";
      row.appendChild(l);
    }
    if (node.error) {
      const l = document.createElement("span");
      l.className = "tree-loading";
      l.textContent = "(sin permisos de lectura)";
      row.appendChild(l);
    }

    row.onclick = () => {
      if (node.dir) toggle(node.path);
      else if (state.onFileOpen) state.onFileOpen(node.path);
    };
    row.ondragstart = (e) => {
      e.dataTransfer.setData("text/plain", node.path);
      e.dataTransfer.effectAllowed = "copy";
    };

    const frag = document.createDocumentFragment();
    frag.appendChild(row);
    if (node.dir && state.expanded.has(node.path) && node.loaded) {
      for (const k of node.children) frag.appendChild(renderNode(k, depth + 1));
    }
    return frag;
  }

  /* drop de ficheros del sistema operativo sobre el árbol: raíces adicionales */
  function enableExternalDrop() {
    const c = state.container;
    c.ondragover = (e) => { e.preventDefault(); c.classList.add("drop-hover"); };
    c.ondragleave = () => c.classList.remove("drop-hover");
    c.ondrop = async (e) => {
      e.preventDefault();
      c.classList.remove("drop-hover");
      if (e.dataTransfer.getData("text/plain")) return; // arrastre interno: lo gestiona el editor
      for (const f of Array.from(e.dataTransfer.files || [])) {
        const p = await state.api.fs.pathForFile(f);
        if (!p) continue;
        await addFileRoot(p);
        if (state.onFileOpen) state.onFileOpen(p);
      }
    };
  }

  return { init, setRoot, addFileRoot, collapseAll, enableExternalDrop };
})();

/* exportación para tests (node:test); en el navegador es un script simple */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { iconFor, sortEntries, languageFor, joinPath };
}
