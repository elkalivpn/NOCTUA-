"use strict";
/* NOCTUA — gestor de sesiones de depuración GDB/MI (docs/DESIGN-debugger.md, §6).
   Límite de sesiones, factory de proceso gdb inyectable (tests sin gdb, R4),
   limpieza garantizada: la sesión se elimina cuando gdb muere y killAll()
   se invoca en window-all-closed y will-quit. */
const { DebugSession, dbgError } = require("./controller");

/* gdb con -nx salvo opt-in explícito del usuario (decisión del revisor, §12.3):
   sin init del usuario la salida MI es determinista; pwndbg/gef la rompen. */
function buildGdbArgs(opts) {
  const args = ["--interpreter=mi2", "--quiet"];
  if (!opts.loadUserInit) args.push("-nx");
  args.push(opts.binary);
  return args;
}

class DebuggerManager {
  constructor(opts) {
    opts = opts || {};
    if (!opts.spawnGdb) throw dbgError("BAD_ARGS", "DebuggerManager exige spawnGdb");
    this.spawnGdb = opts.spawnGdb;
    this.maxSessions = opts.maxSessions || 2;
    this.watchdogMs = opts.watchdogMs;
    this.userOnEvent = opts.onEvent || function () {};
    this.setTimer = opts.setTimer || setTimeout;
    this.clearTimer = opts.clearTimer || clearTimeout;
    this.sessions = new Map();
    this.counter = 0;
  }

  _handleEvent(ev) {
    if (ev.type === "exit") this.sessions.delete(ev.sessionId);
    this.userOnEvent(ev);
  }

  get(id) {
    const s = this.sessions.get(id);
    if (!s) throw dbgError("NO_SESSION", "no existe la sesión de depuración: " + id);
    return s;
  }

  list() { return Array.from(this.sessions.keys()); }

  async start(opts) {
    const o = opts || {};
    if (!o.binary || typeof o.binary !== "string") throw dbgError("BAD_ARGS", "dbg:start exige la ruta del binario");
    if (this.sessions.size >= this.maxSessions) throw dbgError("MAX_SESSIONS", "límite de sesiones simultáneas: " + this.maxSessions);
    const id = "dbg-" + (this.counter += 1);
    let gdb;
    try {
      gdb = this.spawnGdb({ binary: o.binary, loadUserInit: !!o.loadUserInit });
    } catch (e) {
      throw dbgError("LAUNCH_FAILED", "no se pudo lanzar gdb: " + (e && e.message));
    }
    const session = new DebugSession({
      id: id,
      gdb: gdb,
      onEvent: (ev) => this._handleEvent(ev),
      setTimer: this.setTimer,
      clearTimer: this.clearTimer,
      watchdogMs: this.watchdogMs
    });
    this.sessions.set(id, session);
    try {
      const res = await session.launch(o);
      return { sessionId: id, state: res.state };
    } catch (e) {
      this.sessions.delete(id);
      try { gdb.kill(); } catch (e2) {}
      throw e;
    }
  }

  /* Métodos no async a propósito: una sesión inexistente lanza de forma
     síncrona (NO_SESSION) y no deja promesas sueltas en el renderer. */
  continue(id) { return this.get(id).continue(); }
  interrupt(id) { return this.get(id).interrupt(); }
  step(id, kind) { return this.get(id).step(kind); }
  setBreakpoint(id, file, line) { return this.get(id).setBreakpoint(file, line); }
  removeBreakpoint(id, bkptId) { return this.get(id).removeBreakpoint(bkptId); }
  locals(id) { return this.get(id).locals(); }
  backtrace(id) { return this.get(id).backtrace(); }
  relaunch(id) { return this.get(id).relaunch(); }
  quit(id) { return this.get(id).quit(); }
  kill(id) { return this.get(id).kill(); }

  killAll() {
    for (const s of Array.from(this.sessions.values())) s.gdbKill();
    this.sessions.clear();
  }
}

module.exports = { DebuggerManager, buildGdbArgs };
