"use strict";
/* Tests del TerminalManager (issue #3, diseño docs/DESIGN-terminal.md sección 9).
   FakePty inyectado: npm test nunca carga node-pty. */
const test = require("node:test");
const assert = require("node:assert");
const { TerminalManager } = require("../src/main/terminal");

function fakePtyFactory() {
  const created = [];
  const factory = (opts) => {
    const pty = {
      opts,
      writes: [],
      resizes: [],
      kills: 0,
      _dataCb: null,
      _exitCb: null,
      onData(cb) { this._dataCb = cb; },
      onExit(cb) { this._exitCb = cb; },
      write(d) { this.writes.push(d); },
      resize(c, r) { this.resizes.push([c, r]); },
      kill() { this.kills++; if (this._exitCb) this._exitCb({ exitCode: 0, signal: "SIGHUP" }); },
      emitData(d) { if (this._dataCb) this._dataCb(d); }
    };
    created.push(pty);
    return pty;
  };
  return { factory, created };
}

function newManager() {
  const { factory, created } = fakePtyFactory();
  const events = { output: [], exits: [] };
  const mgr = new TerminalManager({
    ptyFactory: factory,
    maxSessions: 3,
    onOutput: (m) => events.output.push(m),
    onExit: (m) => events.exits.push(m)
  });
  return { mgr, created, events };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("constructor exige una ptyFactory inyectada", () => {
  assert.throws(() => new TerminalManager({}), /ptyFactory/);
});

test("create devuelve ids incrementales y pasa opciones a la fábrica", () => {
  const { mgr, created } = newManager();
  assert.equal(mgr.create().id, 1);
  assert.equal(mgr.create({ cols: 120, rows: 40, shell: "/bin/zsh", cwd: "/tmp" }).id, 2);
  assert.equal(created[0].opts.cols, 80); // default
  assert.equal(created[1].opts.cols, 120);
  assert.equal(created[1].opts.rows, 40);
  assert.equal(created[1].opts.shell, "/bin/zsh");
  assert.equal(created[1].opts.cwd, "/tmp");
  assert.equal(mgr.size, 2);
});

test("maxSessions rechaza la sesión adicional con código de error", () => {
  const { mgr } = newManager();
  mgr.create(); mgr.create(); mgr.create();
  assert.throws(() => mgr.create(), (e) => e.code === "MAX_SESSIONS");
});

test("fallo de la fábrica se traduce en PTY_UNAVAILABLE (degradación R7)", () => {
  const mgr = new TerminalManager({ ptyFactory: () => { throw new Error("módulo nativo ausente"); } });
  assert.throws(() => mgr.create(), (e) => e.code === "PTY_UNAVAILABLE");
});

test("write y resize llegan a la PTY; ids inválidos se rechazan", () => {
  const { mgr, created } = newManager();
  const { id } = mgr.create();
  mgr.write(id, "ls\n");
  mgr.resize(id, 100, 30);
  assert.deepStrictEqual(created[0].writes, ["ls\n"]);
  assert.deepStrictEqual(created[0].resizes, [[100, 30]]);
  assert.throws(() => mgr.write(999, "x"), (e) => e.code === "NO_SESSION");
});

test("coalescing de salida: agrupa ráfagas en un solo evento", async () => {
  const { mgr, created, events } = newManager();
  const { id } = mgr.create();
  created[0].emitData("hola ");
  created[0].emitData("mundo");
  await sleep(30);
  assert.equal(events.output.length, 1);
  assert.equal(events.output[0].data, "hola mundo");
  assert.equal(events.output[0].id, id);
});

test("flush inmediato al superar 16 KiB", () => {
  const { mgr, created, events } = newManager();
  mgr.create();
  created[0].emitData("x".repeat(20000));
  assert.equal(events.output.length, 1);
  assert.equal(events.output[0].data.length, 20000);
});

test("los bytes restantes se entregan antes del evento de exit", () => {
  const { mgr, created, events } = newManager();
  const { id } = mgr.create();
  created[0].emitData("cola final");
  created[0].kill();
  assert.ok(events.output.some((m) => m.data === "cola final"), "el buffer se entrega antes del exit");
  assert.deepStrictEqual(events.exits, [{ id, exitCode: 0, signal: "SIGHUP" }]);
});

test("kill libera la sesión y permite crear otra (id no se reutiliza)", () => {
  const { mgr, events } = newManager();
  const { id } = mgr.create();
  assert.deepStrictEqual(mgr.kill(id), { ok: true });
  assert.equal(mgr.size, 0);
  assert.equal(events.exits.length, 1);
  assert.equal(mgr.create().id, 2);
  assert.equal(mgr.size, 1);
  assert.deepStrictEqual(mgr.kill(999), { ok: false }); // id inexistente
});

test("killAll cierra todas las sesiones", () => {
  const { mgr, events } = newManager();
  mgr.create(); mgr.create();
  const n = mgr.killAll();
  assert.equal(n, 2);
  assert.equal(mgr.size, 0);
  assert.equal(events.exits.length, 2);
});
