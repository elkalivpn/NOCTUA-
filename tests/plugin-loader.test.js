'use strict';

/* Tests del contrato de plugins (issues #6 y #12, v0.3.3/v0.3.4).
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

function spyFork(workerMod, forks) {
  const base = loopbackFork(workerMod);
  return function () { forks.push(1); return base(); };
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
  assert.strictEqual(loader.list().length, 0);
  await assert.rejects(function () { return loader.runCommand('p2', 'x', []); }, /no encontrado/);
});

test('permisos desconocidos se rechazan antes de forkear el proceso', async function () {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noctua-'));
  await makePlugin(dir,
    { id: 'p3', name: 'P3', version: '1.0.0', main: 'main.js', permissions: ['rootkit'] },
    "module.exports.register = function () {};\n");
  const forks = [];
  const loader = new PluginLoader(dir, { fork: spyFork(worker, forks) });
  await loader.loadAll();
  assert.strictEqual(forks.length, 0);
  assert.strictEqual(loader.list().length, 0);
});

test('manifest.id fuera del patrón se rechaza antes de forkear (issue #12)', async function () {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noctua-'));
  await makePlugin(dir,
    { id: 'Mi Plugin', name: 'MP', version: '1.0.0', main: 'main.js', permissions: [] },
    "module.exports.register = function () {};\n");
  const forks = [];
  const loader = new PluginLoader(dir, { fork: spyFork(worker, forks) });
  await loader.loadAll();
  assert.strictEqual(forks.length, 0);
  assert.strictEqual(loader.list().length, 0);
});

test('manifest.main con ruta de escape se rechaza (issue #12)', async function () {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noctua-'));
  await makePlugin(dir,
    { id: 'p4', name: 'P4', version: '1.0.0', main: '../evil.js', permissions: [] },
    "module.exports.register = function () {};\n");
  const forks = [];
  const loader = new PluginLoader(dir, { fork: spyFork(worker, forks) });
  await loader.loadAll();
  assert.strictEqual(forks.length, 0);
  assert.strictEqual(loader.list().length, 0);
});

test('el directorio del plugin debe llamarse como su id (issue #12)', async function () {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noctua-'));
  await fs.mkdir(path.join(dir, 'otro'), { recursive: true });
  await fs.writeFile(path.join(dir, 'otro', 'manifest.json'),
    JSON.stringify({ id: 'p9', name: 'P9', version: '1.0.0', main: 'main.js', permissions: [] }));
  await fs.writeFile(path.join(dir, 'otro', 'main.js'), "module.exports.register = function () {};\n");
  const forks = [];
  const loader = new PluginLoader(dir, { fork: spyFork(worker, forks) });
  await loader.loadAll();
  assert.strictEqual(forks.length, 0);
  assert.strictEqual(loader.list().length, 0);
});

test('cargar dos veces no duplica plugins ni forkea de nuevo (issue #12)', async function () {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noctua-'));
  await makePlugin(dir,
    { id: 'p5', name: 'P5', version: '1.0.0', main: 'main.js', permissions: [] },
    "module.exports.register = function () {};\n");
  const forks = [];
  const loader = new PluginLoader(dir, { fork: spyFork(worker, forks) });
  await loader.loadAll();
  await loader.loadAll();
  assert.strictEqual(forks.length, 1);
  assert.strictEqual(loader.list().length, 1);
});

test('origin declarado y comandos quedan visibles en la lista (issue #12)', async function () {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noctua-'));
  await makePlugin(dir,
    { id: 'p6', name: 'P6', version: '1.0.0', main: 'main.js', permissions: ['commands'], origin: 'https://example.com/p6' },
    "module.exports.register = function (ctx) {\n" +
    "  ctx.registerCommand('saludar2', function () { return 'SI'; });\n" +
    "};\n");
  const loader = new PluginLoader(dir, { fork: loopbackFork(worker) });
  await loader.loadAll();
  const list = loader.list();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].origin, 'https://example.com/p6');
  assert.deepStrictEqual(list[0].commands, ['saludar2']);
  loader.killAll();
});
