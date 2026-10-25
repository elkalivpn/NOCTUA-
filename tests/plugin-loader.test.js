'use strict';

/* Tests del contrato de plugins (v0.3.3, issue #6).
 * Se usa un fork en bucle: el worker real (src/utility/plugin-worker.js)
 * conectado mediante un par de puertos en memoria con la misma forma de
 * mensajería que un utilityProcess de Electron. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { PluginLoader } = require('../src/plugin-loader');
const worker = require('../src/utility/plugin-worker');

function loopbackFork(workerMod) {
  return function fork() {
    const mainCbs = { message: [], exit: [] };
    const workerCbs = { message: [] };
    const deliver = function (cbs, arg) {
      return Promise.resolve().then(function () {
        for (const cb of cbs) cb(arg);
      });
    };
    const child = {
      postMessage: function (m) { deliver(workerCbs.message, { data: m }); },
      on: function (ev, cb) { (mainCbs[ev] = mainCbs[ev] || []).push(cb); return child; },
      kill: function () { if (!child.killed) { child.killed = true; deliver(mainCbs.exit, 0); } }
    };
    const workerPort = {
      postMessage: function (m) { deliver(mainCbs.message, m); },
      on: function (ev, cb) { (workerCbs[ev] = workerCbs[ev] || []).push(cb); return workerPort; }
    };
    workerMod.createWorker(workerPort);
    return child;
  };
}

async function makePlugin(dir, manifest, mainJs) {
  await fs.mkdir(path.join(dir, manifest.id), { recursive: true });
  await fs.writeFile(path.join(dir, manifest.id, 'manifest.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(dir, manifest.id, manifest.main || 'main.js'), mainJs);
}

test('carga un plugin en un proceso aislado y ejecuta un comando', async function () {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noctua-'));
  await makePlugin(dir,
    { id: 'p1', name: 'P1', version: '1.0.0', main: 'main.js', permissions: ['events', 'commands'] },
    "module.exports.register = function (ctx) {\n" +
    "  ctx.registerCommand('saludar', function () { return 'hola'; });\n" +
    "  ctx.on('prueba', function () {});\n" +
    "};\n");
  const loader = new PluginLoader(dir, { fork: loopbackFork(worker) });
  await loader.loadAll();
  const list = loader.list();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, 'p1');
  assert.deepStrictEqual(list[0].permissions, ['events', 'commands']);
  assert.strictEqual(await loader.runCommand('p1', 'saludar', []), 'hola');
  loader.killAll();
});

test('un plugin sin permiso falla al registrar la capacidad y queda descartado', async function () {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noctua-'));
  await makePlugin(dir,
    { id: 'p2', name: 'P2', version: '1.0.0', main: 'main.js', permissions: [] },
    "module.exports.register = function (ctx) { ctx.registerCommand('x', function () {}); };\n");
  const loader = new PluginLoader(dir, { fork: loopbackFork(worker) });
  await loader.loadAll();
  assert.strictEqual(loader.list().length, 0); /* p2 falló y quedó descartado */
  await assert.rejects(function () { return loader.runCommand('p2', 'x', []); }, /no encontrado/);
});

test('permisos desconocidos se rechazan antes de forkear el proceso', async function () {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noctua-'));
  await makePlugin(dir,
    { id: 'p3', name: 'P3', version: '1.0.0', main: 'main.js', permissions: ['rootkit'] },
    "module.exports.register = function () {};\n");
  const baseFork = loopbackFork(worker);
  const forks = [];
  const spyFork = function () { forks.push(1); return baseFork(); };
  const loader = new PluginLoader(dir, { fork: spyFork });
  await loader.loadAll();
  assert.strictEqual(forks.length, 0); /* validado en el proceso principal, sin fork */
  assert.strictEqual(loader.list().length, 0);
});
