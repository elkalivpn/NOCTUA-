"use strict";
/* NOCTUA — controlador de sesión GDB/MI (docs/DESIGN-debugger.md, §5 y §6).
   Máquina de estados observable (R3), correlación comando/respuesta por token con
   watchdog (R1), eventos asíncronos de primera clase (R2) y coalescing de streams.
   Sin Electron ni I/O propia: el proceso gdb entra por el adaptador { write, kill, on }
   y los temporizadores se inyectan, así que los tests no necesitan reloj real (R4). */
const { parseMiLine, miPath, miArg } = require("./mi-parser");

function dbgError(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

/* Transiciones declaradas; cualquier otra se ignora y se loguea (R3).
   launching→exited cubre el inferior que termina antes del primer ^running. */
const TRANSITIONS = {
  idle: { launch: "launching" },
  launching: { run: "running", exit: "exited", fail: "idle" },
  running: { stop: "stopped", exit: "exited" },
  stopped: { run: "running", exit: "exited", kill: "exited" },
  exited: { relaunch: "launching", close: "closed" },
  closed: {}
};

/* Coalescing de stream records (~ @ &): 16 KiB o 16 ms, misma política que la terminal. */
class StreamCoalescer {
  constructor(opts) {
    this.onFlush = opts.onFlush;
    this.maxBytes = opts.maxBytes || 16384;
    this.flushMs = opts.flushMs !== undefined ? opts.flushMs : 16;
    this.setTimer = opts.setTimer || setTimeout;
    this.clearTimer = opts.clearTimer || clearTimeout;
    this.bufs = {};
    this.timer = null;
  }
  push(stream, data) {
    this.bufs[stream] = (this.bufs[stream] || "") + data;
    if (this.bufs[stream].length >= this.maxBytes) { this.flush(); return; }
    if (!this.timer) this.timer = this.setTimer(() => this.flush(), this.flushMs);
  }
  flush() {
    if (this.timer) { this.clearTimer(this.timer); this.timer = null; }
    const bufs = this.bufs;
    this.bufs = {};
    for (const stream of Object.keys(bufs)) {
      if (bufs[stream]) this.onFlush(stream, bufs[stream]);
    }
  }
}

class DebugSession {
  constructor(opts) {
    this.id = opts.id;
    this.gdb = opts.gdb;
    this.onEvent = opts.onEvent || function () {};
    this.setTimer = opts.setTimer || setTimeout;
    this.clearTimer = opts.clearTimer || clearTimeout;
    this.watchdogMs = opts.watchdogMs || 10000;
    this.quitKillMs = opts.quitKillMs || 2000;
    this.state = "idle";
    this.frame = null;
    this.token = 0;
    this.pending = new Map(); /* token → { command, resolve, reject, timer } */
    this.buffer = "";
    this.killTimer = null;
    this.coalescer = new StreamCoalescer({
      onFlush: (stream, data) => this.emit({ type: "console", stream, data }),
      setTimer: this.setTimer,
      clearTimer: this.clearTimer
    });
    this.gdb.on("stdout", (data) => this.onStdout(data));
    this.gdb.on("exit", (code) => this.onGdbExit(code));
    this.gdb.on("error", (err) => this.onGdbError(err));
  }

  emit(ev) {
    ev.sessionId = this.id;
    this.onEvent(ev);
  }

  /* Transición declarada o aviso en stderr; nunca una excepción (R3). */
  transition(event) {
    const to = TRANSITIONS[this.state] && TRANSITIONS[this.state][event];
    if (!to) {
      console.error("[dbg:" + this.id + "] transición ignorada: " + this.state + " -> " + event);
      return false;
    }
    this.state = to;
    this.emit({ type: "state", state: to });
    return true;
  }

  assertIn(states, msg) {
    if (states.indexOf(this.state) === -1) {
      throw dbgError("BAD_STATE", (msg || "operación no permitida en estado ") + this.state);
    }
  }

  /* Comando MI con token; el watchdog rechaza a los 10 s si gdb no responde (R1). */
  send(command) {
    return new Promise((resolve, reject) => {
      this.token += 1;
      const tok = this.token;
      const entry = { command: command, resolve: resolve, reject: reject, timer: null };
      entry.timer = this.setTimer(() => {
        this.pending.delete(tok);
        this.emit({ type: "state", state: this.state, error: "watchdog sin respuesta: " + command });
        reject(dbgError("TIMEOUT", "sin respuesta de gdb en " + this.watchdogMs + " ms: " + command));
      }, this.watchdogMs);
      this.pending.set(tok, entry);
      this.gdb.write(tok + command + "\n");
    });
  }

  onStdout(data) {
    this.buffer += data;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      this.handleLine(line);
    }
  }

  handleLine(line) {
    if (!line) return;
    const rec = parseMiLine(line);
    if (rec.type === "stream") this.coalescer.push(rec.stream, rec.data);
    else if (rec.type === "result") this.onResult(rec);
    else if (rec.type === "exec") this.onExec(rec);
    /* ready y notify: informativos, sin acción en fase 1 */
  }

  onResult(rec) {
    const entry = rec.token !== null ? this.pending.get(rec.token) : null;
    if (entry) { this.clearTimer(entry.timer); this.pending.delete(rec.token); }
    /* efecto de estado antes de resolver: quien espera ya ve el estado final */
    if (rec.resultClass === "running") {
      if (this.state === "launching" || this.state === "stopped") this.transition("run");
    }
    if (entry) {
      if (rec.resultClass === "error") {
        entry.reject(dbgError("MI_ERROR", (rec.results && (rec.results.msg || rec.results.code)) || "error de gdb"));
      } else {
        entry.resolve(rec);
      }
    }
  }

  onExec(rec) {
    if (rec.asyncClass !== "stopped") return; /* *running es informativo: la transición la marca ^running */
    const r = rec.results || {};
    const reason = r.reason || "";
    if (String(reason).indexOf("exited") === 0) {
      this.frame = null;
      this.transition("exit");
      return;
    }
    if (!r.frame) {
      console.error("[dbg:" + this.id + "] *stopped sin frame ni exit: ignorado");
      return;
    }
    this.frame = r.frame;
    if (this.transition("stop")) {
      this.emit({ type: "stopped", reason: reason || null, frame: this.frame });
    }
  }

  closeDown() {
    if (this.killTimer) { this.clearTimer(this.killTimer); this.killTimer = null; }
    this.coalescer.flush();
    for (const entry of Array.from(this.pending.values())) {
      this.clearTimer(entry.timer);
      entry.reject(dbgError("GDB_EXITED", "gdb terminó antes de responder: " + entry.command));
    }
    this.pending.clear();
    this.frame = null;
    if (this.state !== "closed") {
      this.state = "closed";
      this.emit({ type: "state", state: "closed" });
    }
  }

  onGdbExit(code) {
    this.closeDown();
    this.emit({ type: "exit", code: code === null || code === undefined ? 0 : code });
  }

  onGdbError(err) {
    const msg = (err && err.message) || String(err);
    this.emit({ type: "state", state: this.state, error: "gdb: " + msg });
    this.closeDown();
  }

  /* ---------- comandos de fase 1 ---------- */

  async launch(opts) {
    const o = opts || {};
    if (this.state !== "idle") throw dbgError("BAD_STATE", "la sesión ya está en marcha");
    this.transition("launch"); /* idle → launching */
    try {
      await this.send("-file-exec-and-symbols " + miPath(o.binary));
      if (Array.isArray(o.breakpoints)) {
        for (const bp of o.breakpoints) {
          await this.send("-break-insert --source " + miPath(bp.file) + " --line " + parseInt(bp.line, 10));
        }
      }
      if (Array.isArray(o.args) && o.args.length) {
        await this.send("-exec-arguments " + miArg(o.args));
      }
      await this.send("-exec-run"); /* ^running → running; ^done tras *stopped exited → exited */
      return { state: this.state };
    } catch (e) {
      if (this.state === "launching") this.transition("fail");
      try { this.gdb.kill(); } catch (e2) {}
      throw (e && e.code === "MI_ERROR") ? dbgError("LAUNCH_FAILED", e.message) : e;
    }
  }

  async continue() {
    this.assertIn(["stopped"]);
    await this.send("-exec-continue");
    return { state: this.state };
  }

  async interrupt() {
    this.assertIn(["running"]);
    await this.send("-exec-interrupt"); /* ^done: gdb aceptó; la detención real llega por *stopped */
    return { state: this.state };
  }

  async step(kind) {
    this.assertIn(["stopped"]);
    const cmd = { over: "-exec-next", into: "-exec-step", out: "-exec-finish" }[kind];
    if (!cmd) throw dbgError("BAD_ARGS", "step desconocido: " + kind);
    await this.send(cmd);
    return { state: this.state };
  }

  async setBreakpoint(file, line) {
    const n = parseInt(line, 10);
    if (!file || !n) throw dbgError("BAD_ARGS", "setBreakpoint exige file y line");
    const rec = await this.send("-break-insert --source " + miPath(file) + " --line " + n);
    const num = rec.results && rec.results.bkpt && parseInt(rec.results.bkpt.number, 10);
    if (!num) throw dbgError("MI_ERROR", "gdb no devolvió número de breakpoint");
    return { bkptId: num };
  }

  async removeBreakpoint(bkptId) {
    const n = parseInt(bkptId, 10);
    if (!n) throw dbgError("BAD_ARGS", "removeBreakpoint exige bkptId");
    await this.send("-break-delete " + n);
    return { ok: true };
  }

  async locals() {
    this.assertIn(["stopped"]);
    const rec = await this.send("-stack-list-variables --simple-values");
    const vars = (rec.results && rec.results.variables) || [];
    return vars.map((v) => ({ name: v.name, value: v.value !== undefined ? v.value : "", arg: v.arg === "1" }));
  }

  async backtrace() {
    this.assertIn(["stopped"]);
    const rec = await this.send("-stack-list-frames");
    const stack = (rec.results && rec.results.stack) || [];
    return stack.map((el) => {
      const f = el.frame || el;
      return {
        level: parseInt(f.level, 10) || 0,
        func: f.func || "?",
        file: f.fullname || f.file || null,
        line: f.line ? parseInt(f.line, 10) : null,
        addr: f.addr || null
      };
    });
  }

  async relaunch() {
    this.assertIn(["exited"]);
    this.transition("relaunch"); /* exited → launching */
    try {
      await this.send("-exec-run"); /* los breakpoints persisten dentro de gdb */
    } catch (e) {
      if (this.state === "launching") this.transition("fail");
      throw e;
    }
    return { state: this.state };
  }

  async kill() {
    this.assertIn(["stopped"]);
    await this.send("-interpreter-exec console " + miPath("kill"));
    this.transition("kill"); /* stopped → exited */
    return { state: this.state };
  }

  async quit() {
    if (this.state === "closed") return { state: "closed" };
    try { await this.send("-gdb-exit"); }
    catch (e) { /* TIMEOUT/GDB_EXITED/MI_ERROR: cae al kill de respaldo */ }
    if (this.state === "closed") return { state: "closed" };
    this.killTimer = this.setTimer(() => {
      try { this.gdb.kill(); } catch (e) {}
    }, this.quitKillMs);
    return { state: this.state };
  }

  /* Cierre forzado (killAll en will-quit): mata gdb; onGdbExit cierra el estado. */
  gdbKill() {
    try { this.gdb.kill(); } catch (e) {}
  }
}

module.exports = { DebugSession, StreamCoalescer, TRANSITIONS, dbgError };
