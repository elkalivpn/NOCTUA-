"use strict";
/* TerminalManager — sesiones PTY del proceso principal (issue #3).
   Diseño: docs/DESIGN-terminal.md. La fábrica de PTY se inyecta: solo la
   fábrica real (src/main.js) conoce node-pty; los tests inyectan FakePty
   y npm test nunca carga el módulo nativo (requisito R5 del diseño). */

const DEFAULT_SHELL = process.platform === "win32" ? "powershell.exe" : "/bin/bash";
const FLUSH_BYTES = 16 * 1024; // umbral de flush inmediato (coalescing)
const FLUSH_MS = 16;           // ventana de coalescing

class TerminalManager {
  constructor({ ptyFactory, maxSessions = 3, onOutput, onExit } = {}) {
    if (typeof ptyFactory !== "function") {
      throw new Error("TerminalManager requiere una ptyFactory inyectada");
    }
    this.ptyFactory = ptyFactory;
    this.maxSessions = maxSessions;
    this.onOutput = onOutput;
    this.onExit = onExit;
    this._sessions = new Map();
    this._nextId = 1;
  }

  get size() { return this._sessions.size; }

  create({ cols = 80, rows = 24, cwd, shell, env } = {}) {
    if (this._sessions.size >= this.maxSessions) {
      const err = new Error("límite de sesiones alcanzado (" + this.maxSessions + ")");
      err.code = "MAX_SESSIONS";
      throw err;
    }
    const opts = {
      cols,
      rows,
      cwd: cwd || undefined,
      shell: shell || process.env.SHELL || DEFAULT_SHELL,
      env: env || process.env
    };
    let pty;
    try {
      pty = this.ptyFactory(opts);
    } catch (e) {
      const err = new Error("terminal no disponible: " + (e && e.message ? e.message : e));
      err.code = "PTY_UNAVAILABLE";
      throw err;
    }
    const id = this._nextId++;
    const session = { id, pty, buf: "", timer: null, closed: false };
    this._sessions.set(id, session);
    pty.onData((data) => this._queueOutput(id, data));
    pty.onExit((info) => this._handleExit(id, info));
    return { id };
  }

  _queueOutput(id, data) {
    const s = this._sessions.get(id);
    if (!s) return;
    s.buf += data;
    if (s.buf.length >= FLUSH_BYTES) {
      this._flush(id);
    } else if (!s.timer) {
      s.timer = setTimeout(() => this._flush(id), FLUSH_MS);
    }
  }

  _flush(id) {
    const s = this._sessions.get(id);
    if (!s || !s.buf) return;
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    const data = s.buf;
    s.buf = "";
    if (this.onOutput) this.onOutput({ id, data });
  }

  write(id, data) {
    const s = this._sessions.get(id);
    if (!s || s.closed) {
      const err = new Error("sesión " + id + " inexistente o cerrada");
      err.code = "NO_SESSION";
      throw err;
    }
    s.pty.write(data);
  }

  resize(id, cols, rows) {
    const s = this._sessions.get(id);
    if (!s || s.closed) return; // un resize tardío no debe romper nada
    s.pty.resize(cols, rows);
  }

  kill(id) {
    const s = this._sessions.get(id);
    if (!s) return { ok: false };
    s.closed = true;
    try { s.pty.kill(); } catch (e) { /* la PTY ya podía estar muerta */ }
    return { ok: true };
  }

  _handleExit(id, info) {
    const s = this._sessions.get(id);
    if (!s) return;
    s.closed = true;
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    this._flush(id); // entregar los bytes restantes ANTES del evento de exit
    this._sessions.delete(id);
    if (this.onExit) {
      this.onExit({
        id,
        exitCode: info && info.exitCode !== undefined ? info.exitCode : null,
        signal: (info && info.signal) || null
      });
    }
  }

  killAll() {
    const n = this._sessions.size;
    for (const s of [...this._sessions.values()]) {
      try { s.pty.kill(); } catch (e) { /* igual que kill */ }
    }
    return n;
  }
}

module.exports = { TerminalManager, DEFAULT_SHELL };
