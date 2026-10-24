"use strict";
/* NOCTUA — tests del controlador y del gestor de depuración (docs/DESIGN-debugger.md, §9).
   FakeMiProcess con guiones de transcripción MI y temporizadores inyectados:
   la CI no instala gdb (R4) y nada depende de un reloj real. */
const test = require("node:test");
const assert = require("node:assert");
const { DebugSession, StreamCoalescer, TRANSITIONS, dbgError } = require("../src/main/debugger/controller");
const { DebuggerManager, buildGdbArgs } = require("../src/main/debugger/manager");

/* ---------- temporizadores falsos ---------- */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const tasks = new Map();
  return {
    setTimer: (cb, ms) => { seq += 1; tasks.set(seq, { cb: cb, at: now + ms }); return seq; },
    clearTimer: (id) => { tasks.delete(id); },
    pending: () => tasks.size,
    advance: async (ms) => {
      const deadline = now + ms;
      for (;;) {
        let nextId = null;
        let next = null;
        for (const entry of tasks) {
          const id = entry[0];
          const task = entry[1];
          if (task.at <= deadline && (next === null || task.at < next.at)) { next = task; nextId = id; }
        }
        if (next === null) { now = deadline; return; }
        now = next.at;
        tasks.delete(nextId);
        next.cb();
        for (let k = 0; k < 6; k++) await Promise.resolve();
      }
    }
  };
}

const drain = async () => { for (let k = 0; k < 12; k++) await Promise.resolve(); };

/* ---------- FakeMiProcess: dobla a gdb con un guion por comando ---------- */
function makeFakeGdb(script) {
  const listeners = { stdout: [], exit: [], error: [] };
  let killed = false;
  const writes = [];
  function emit(data) { for (const cb of listeners.stdout) cb(data); }
  const adapter = {
    write: (s) => {
      writes.push(s);
      const linesIn = s.split("\n");
      for (const raw of linesIn) {
        const line = raw.replace(/\r$/, "");
        if (!line) continue;
        const m = line.match(/^(\d+)([^\n]*)/);
        if (!m) continue;
        const tok = m[1];
        const cmd = m[2];
        const entry = script.find((row) => cmd.indexOf(row[0]) === 0);
        const lines = entry ? entry[1] : ['%T^error,msg="comando no scriptado: ' + cmd + '"'];
        Promise.resolve().then(() => {
          if (killed) return;
          if (lines) {
            for (const l of lines) emit(l.split("%T").join(tok) + "\n");
            if (cmd.indexOf("-gdb-exit") === 0) {
              killed = true;
              for (const cb of listeners.exit) cb(0);
            }
          }
        });
      }
    },
    kill: () => {
      if (killed) return;
      killed = true;
      Promise.resolve().then(() => { for (const cb of listeners.exit) cb(137); });
    },
    on: (ev, cb) => { (listeners[ev] = listeners[ev] || []).push(cb); return adapter; }
  };
  return { adapter, writes, emit, wasKilled: () => killed };
}

const BP_STOP = '*stopped,reason="breakpoint-hit",bkptno="1",frame={addr="0x4011a6",func="main",args=[],file="main.c",fullname="/tmp/main.c",line="10"}\n';

/* El doble debe responder a TODOS los comandos que la sesión puede enviar. */
const SCRIPT = [
  ["-file-exec-and-symbols", ["%T^done"]],
  ["-break-insert", ["%T^done,bkpt={number=\"1\",addr=\"0x00401000\",file=\"main.c\",fullname=\"/tmp/main.c\",line=\"10\"}"]],
  ["-exec-arguments", ["%T^done"]],
  ["-exec-run", ["%T^running", "*running,thread-id=\"all\""]],
  ["-exec-continue", ["%T^running", "*running,thread-id=\"all\""]],
  ["-exec-interrupt", ["%T^done"]],
  ["-exec-next", ["%T^running"]],
  ["-exec-step", ["%T^running"]],
  ["-exec-finish", ["%T^running"]],
  ["-break-delete", ["%T^done"]],
  ["-stack-list-variables", ["%T^done,variables=[{name=\"x\",value=\"2\",arg=\"1\"}]"]],
  ["-stack-list-frames", ["%T^done,stack=[frame={level=\"0\",addr=\"0x4011a6\",func=\"main\",file=\"main.c\",fullname=\"/tmp/main.c\",line=\"10\"},frame={level=\"1\",addr=\"0x401050\",func=\"__libc_start_main\"}]"]],
  ["-interpreter-exec console", ["%T^done"]],
  ["-gdb-exit", ["%T^exit"]]
];

function makeSession(fake, T, events, id) {
  return new DebugSession({
    id: id || "dbg-test",
    gdb: fake.adapter,
    onEvent: (ev) => events.push(ev),
    setTimer: T.setTimer,
    clearTimer: T.clearTimer,
    watchdogMs: 1000
  });
}

/* ---------- máquina de estados ---------- */

test("TRANSITIONS: tabla declarada de la máquina de estados", () => {
  assert.deepEqual(Object.keys(TRANSITIONS), ["idle", "launching", "running", "stopped", "exited", "closed"]);
  assert.equal(TRANSITIONS.stopped.run, "running");
  assert.equal(TRANSITIONS.launching.exit, "exited"); /* inferior que muere antes del primer ^running */
});

test("dbgError: marca el código en la excepción", () => {
  const e = dbgError("NO_SESSION", "prueba");
  assert.ok(e instanceof Error);
  assert.equal(e.code, "NO_SESSION");
  assert.equal(e.message, "prueba");
});

test("máquina de estados: *stopped en idle se ignora (transición no declarada)", async () => {
  const T = fakeTimers();
  const fake = makeFakeGdb(SCRIPT);
  const events = [];
  const s = makeSession(fake, T, events);
  fake.emit(BP_STOP);
  await drain();
  assert.equal(s.state, "idle");
  assert.equal(events.filter((ev) => ev.type === "stopped").length, 0);
});

test("máquina de estados: continue solo en stopped (BAD_STATE)", async () => {
  const T = fakeTimers();
  const fake = makeFakeGdb(SCRIPT);
  const s = makeSession(fake, T, []);
  await s.launch({ binary: "/tmp/vuln" });
  await assert.rejects(() => s.continue(), { code: "BAD_STATE" });
});

/* ---------- coalescing ---------- */

test("coalescer: acumula hasta el plazo o el tamaño máximo", async () => {
  const T = fakeTimers();
  const got = [];
  const c = new StreamCoalescer({
    onFlush: (s, d) => got.push([s, d]),
    setTimer: T.setTimer,
    clearTimer: T.clearTimer,
    maxBytes: 10
  });
  c.push("console", "uno ");
  c.push("console", "dos");
  assert.equal(got.length, 0);
  await T.advance(16);
  assert.equal(got.length, 1);
  assert.equal(got[0][1], "uno dos");
  c.push("target", "xyz");
  assert.equal(got.length, 1);
  c.push("target", "0123456789");
  assert.equal(got.length, 2);
  assert.equal(got[1][0], "target");
  assert.equal(got[1][1], "xyz0123456789");
});

/* ---------- sesión ---------- */

test("sesión: ciclo completo launch→bp→locals/backtrace→continue→exited→relaunch→quit", async () => {
  const T = fakeTimers();
  const fake = makeFakeGdb(SCRIPT);
  const events = [];
  const s = makeSession(fake, T, events);
  assert.equal(fake.writes.length, 0);
  const res = await s.launch({ binary: "/tmp/vuln", args: ["-o", "dos palabras"], breakpoints: [{ file: "/tmp/main.c", line: 10 }] });
  assert.equal(res.state, "running");
  assert.equal(fake.writes[0], '1-file-exec-and-symbols "/tmp/vuln"\n');
  assert.ok(fake.writes.some((w) => w.indexOf('-exec-arguments "-o" "dos palabras"') !== -1), "miArg cita los argumentos (R5)");
  assert.ok(fake.writes.some((w) => w.indexOf('2-break-insert --source "/tmp/main.c" --line 10') !== -1), "breakpoint inicial serializado");
  fake.emit(BP_STOP);
  await drain();
  assert.equal(s.state, "stopped");
  const st = events.find((ev) => ev.type === "stopped");
  assert.ok(st, "debe emitir evento stopped");
  assert.equal(st.frame.line, "10");
  assert.equal(st.sessionId, "dbg-test");
  const vars = await s.locals();
  assert.equal(vars[0].name, "x");
  assert.equal(vars[0].value, "2");
  assert.equal(vars[0].arg, true);
  const frames = await s.backtrace();
  assert.equal(frames.length, 2);
  assert.equal(frames[0].func, "main");
  assert.equal(frames[0].line, 10);
  assert.equal(frames[0].file, "/tmp/main.c");
  assert.equal(frames[1].file, null);
  const rc = await s.continue();
  assert.equal(rc.state, "running");
  fake.emit('*stopped,reason="exited-normally"\n');
  await drain();
  assert.equal(s.state, "exited");
  const rr = await s.relaunch();
  assert.equal(rr.state, "running");
  fake.emit('*stopped,reason="exited-normally"\n');
  await drain();
  assert.equal(s.state, "exited");
  const rq = await s.quit();
  await drain();
  assert.equal(rq.state, "closed");
  assert.equal(s.state, "closed");
  assert.ok(events.some((ev) => ev.type === "exit" && ev.code === 0));
  assert.equal(
    events.filter((ev) => ev.type === "state" && !ev.error).map((ev) => ev.state).join(","),
    "launching,running,stopped,running,exited,launching,running,exited,closed"
  );
  assert.equal(T.pending(), 0, "sin temporizadores colgantes");
});

test("sesión: interrupt resuelve en ^done y *stopped llega por evento", async () => {
  const T = fakeTimers();
  const fake = makeFakeGdb(SCRIPT);
  const events = [];
  const s = makeSession(fake, T, events);
  await s.launch({ binary: "/tmp/vuln" });
  const ri = await s.interrupt();
  assert.equal(ri.state, "running", "interrupt no cambia el estado: espera *stopped");
  fake.emit('*stopped,reason="signal-received",signal-name="SIGINT",frame={addr="0x4011a9",func="main",args=[],file="main.c",fullname="/tmp/main.c",line="12"}\n');
  await drain();
  assert.equal(s.state, "stopped");
  assert.ok(events.some((ev) => ev.type === "stopped" && ev.frame.func === "main"));
});

test("watchdog: comando sin respuesta rechaza TIMEOUT y emite error de estado", async () => {
  const T = fakeTimers();
  const fake = makeFakeGdb([["-nunca", null]]);
  const events = [];
  const s = makeSession(fake, T, events, "dbg-wd");
  /* primero se envía (queda el watchdog pendiente), después se avanza el reloj */
  const sent = s.send("-nunca test");
  const check = assert.rejects(sent, { code: "TIMEOUT" });
  await T.advance(1001);
  await check;
  assert.ok(events.some((ev) => ev.type === "state" && ev.error && ev.error.indexOf("watchdog") !== -1));
  assert.equal(s.state, "idle", "la sesión queda recuperable");
});

test("sesión: kill del inferior y coalescing de streams de consola", async () => {
  const T = fakeTimers();
  const fake = makeFakeGdb(SCRIPT);
  const events = [];
  const s = makeSession(fake, T, events);
  await s.launch({ binary: "/tmp/vuln" });
  fake.emit(BP_STOP);
  await drain();
  const rk = await s.kill();
  assert.equal(rk.state, "exited");
  fake.emit('~"linea 1\\n"\n');
  fake.emit('~"linea 2\\n"\n');
  await drain();
  assert.equal(events.filter((ev) => ev.type === "console").length, 0, "aún sin flush");
  await T.advance(16);
  const cons = events.filter((ev) => ev.type === "console");
  assert.equal(cons.length, 1);
  assert.equal(cons[0].data, "linea 1\nlinea 2\n");
  assert.equal(cons[0].stream, "console");
  assert.equal(cons[0].sessionId, "dbg-test");
});

test("sesión: inferior que termina de inmediato (^done tras *stopped exited)", async () => {
  const T = fakeTimers();
  const fake = makeFakeGdb([
    ["-file-exec-and-symbols", ["%T^done"]],
    ["-exec-run", ['*stopped,reason="exited-normally"', "%T^done"]]
  ]);
  const s = makeSession(fake, T, [], "dbg-fast");
  const res = await s.launch({ binary: "/tmp/rapido" });
  assert.equal(res.state, "exited");
  assert.equal(s.state, "exited");
});

test("sesión: step over en stopped y validación de kind", async () => {
  const T = fakeTimers();
  const fake = makeFakeGdb(SCRIPT);
  const s = makeSession(fake, T, []);
  await s.launch({ binary: "/tmp/vuln" });
  fake.emit(BP_STOP);
  await drain();
  const r = await s.step("over");
  assert.equal(r.state, "running");
  fake.emit('*stopped,reason="end-stepping-range",frame={addr="0x4011ab",func="main",args=[],file="main.c",fullname="/tmp/main.c",line="11"}\n');
  await drain();
  assert.equal(s.state, "stopped");
  await assert.rejects(() => s.step("diagonal"), { code: "BAD_ARGS" });
});

test("sesión: setBreakpoint/removeBreakpoint con id devuelto por gdb", async () => {
  const T = fakeTimers();
  const fake = makeFakeGdb(SCRIPT);
  const s = makeSession(fake, T, []);
  await s.launch({ binary: "/tmp/vuln" });
  fake.emit(BP_STOP);
  await drain();
  const bp = await s.setBreakpoint("/tmp/main.c", 42);
  assert.equal(bp.bkptId, 1);
  assert.ok(fake.writes.some((w) => w.indexOf('break-insert --source "/tmp/main.c" --line 42') !== -1));
  const rm = await s.removeBreakpoint(1);
  assert.equal(rm.ok, true);
  await assert.rejects(() => s.setBreakpoint("/tmp/main.c", 0), { code: "BAD_ARGS" });
});

/* ---------- gestor ---------- */

test("manager: start, NO_SESSION síncrono, MAX_SESSIONS, quit libera hueco", async () => {
  const T = fakeTimers();
  const events = [];
  const mgr = new DebuggerManager({
    spawnGdb: () => makeFakeGdb(SCRIPT).adapter,
    maxSessions: 1,
    onEvent: (ev) => events.push(ev),
    setTimer: T.setTimer,
    clearTimer: T.clearTimer,
    watchdogMs: 1000
  });
  const res = await mgr.start({ binary: "/tmp/vuln" });
  assert.equal(res.state, "running");
  assert.ok(res.sessionId.indexOf("dbg-") === 0);
  assert.ok(events.length > 0 && events.every((ev) => ev.sessionId === res.sessionId), "todo evento lleva sessionId");
  assert.ok(events.some((ev) => ev.type === "state" && ev.state === "running"));
  /* NO_SESSION: los métodos del gestor no son async, lanzan síncronamente */
  assert.throws(() => mgr.continue("dbg-inexistente"), { code: "NO_SESSION" });
  await assert.rejects(() => mgr.start({ binary: "/tmp/otro" }), { code: "MAX_SESSIONS" });
  await mgr.quit(res.sessionId);
  await drain();
  assert.equal(mgr.list().length, 0, "la sesión cerrada libera el hueco");
  const again = await mgr.start({ binary: "/tmp/vuln" });
  assert.equal(again.state, "running");
  await mgr.quit(again.sessionId);
  await drain();
  assert.equal(mgr.list().length, 0);
});

test("manager: arranque fallido limpia la sesión y mata gdb", async () => {
  const T = fakeTimers();
  const fake = makeFakeGdb([["-file-exec-and-symbols", ['%T^error,msg="No such file or directory"']]]);
  const mgr = new DebuggerManager({
    spawnGdb: () => fake.adapter,
    maxSessions: 2,
    onEvent: () => {},
    setTimer: T.setTimer,
    clearTimer: T.clearTimer,
    watchdogMs: 1000
  });
  await assert.rejects(() => mgr.start({ binary: "/no-existe" }), { code: "LAUNCH_FAILED" });
  assert.equal(mgr.list().length, 0);
  assert.ok(fake.wasKilled(), "gdb recibe kill");
});

test("manager: killAll mata todas las sesiones", async () => {
  const T = fakeTimers();
  const fakes = [makeFakeGdb(SCRIPT), makeFakeGdb(SCRIPT)];
  let idx = 0;
  const mgr = new DebuggerManager({
    spawnGdb: () => fakes[idx++].adapter,
    maxSessions: 3,
    onEvent: () => {},
    setTimer: T.setTimer,
    clearTimer: T.clearTimer,
    watchdogMs: 1000
  });
  await mgr.start({ binary: "/tmp/a" });
  await mgr.start({ binary: "/tmp/b" });
  assert.equal(mgr.list().length, 2);
  mgr.killAll();
  await drain();
  assert.equal(mgr.list().length, 0);
  assert.ok(fakes[0].wasKilled() && fakes[1].wasKilled());
});

test("buildGdbArgs: -nx por defecto; init del usuario solo con opt-in", () => {
  assert.equal(buildGdbArgs({ binary: "/tmp/v" }).join(" "), "--interpreter=mi2 --quiet -nx /tmp/v");
  assert.equal(buildGdbArgs({ binary: "/tmp/v", loadUserInit: true }).join(" "), "--interpreter=mi2 --quiet /tmp/v");
});
