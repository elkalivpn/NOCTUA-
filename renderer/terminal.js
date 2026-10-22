"use strict";
/* TerminalPanel — PTY real en el renderer (issue #3, diseño docs/DESIGN-terminal.md).
   xterm.js self-hosted desde renderer/vendor. Fase 1: una única sesión. */

const TerminalPanel = (() => {
  let active = null; // { id, term, fit, observer }

  async function start(container) {
    if (active) return active;
    if (!window.Terminal || !window.FitAddon) {
      throw new Error("xterm.js no está en renderer/vendor (ejecute npm install)");
    }
    const api = window.noctua;
    const term = new window.Terminal({
      fontSize: 12,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      cursorBlink: true,
      scrollback: 4000,
      theme: {
        background: "#0b0e14",
        foreground: "#e2e8f0",
        cursor: "#22d3ee",
        selectionBackground: "#164e63"
      }
    });
    term.open(container);
    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    fit.fit();

    let created;
    try {
      created = await api.terminal.create({ cols: term.cols, rows: term.rows });
    } catch (e) {
      term.dispose();
      throw e;
    }
    const id = created.id;
    term.onData((data) => api.terminal.write(id, data));
    api.terminal.onData((m) => { if (m.id === id) term.write(m.data); });
    api.terminal.onExit((m) => {
      if (m.id !== id) return;
      term.write("\r\n[proceso terminado — cierre la pestaña y vuelva a abrirla para una sesión nueva]\r\n");
    });
    const observer = new ResizeObserver(() => {
      try { fit.fit(); api.terminal.resize(id, term.cols, term.rows); } catch (e) { /* sesión muerta */ }
    });
    observer.observe(container);
    active = { id, term, fit, observer };
    return active;
  }

  async function stop() {
    if (!active) return;
    const a = active;
    active = null;
    a.observer.disconnect();
    try { await window.noctua.terminal.kill(a.id); } catch (e) { /* ya estaba muerta */ }
    a.term.dispose();
  }

  return { start, stop, isActive: () => !!active };
})();
