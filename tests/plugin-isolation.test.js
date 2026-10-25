'use strict';

/* Tests de aislamiento (v0.3.3, issue #6): defensa en profundidad entre el
 * worker del plugin y el proceso principal, con el worker real conectado
 * por un par de puertos en bucle. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { PluginLoader } = require('../src/plugin-loader');
const worker = require('../src/utility/plugin-worker');

function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function tick(n) {
  let p = Promise.resolve();
  for (let i = 0; i < n; i++) p = p.then(function () {});
  return p;
}

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

test('capacidad "fs" concedida con grant responde por RPC', async function () {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noctua-'));
  await fs.writeFile(path.join(dir, 'a.txt'), 'HOLA');
  await makePlugin(dir,
    { id: 'leer', name: 'Leer', version: '1.0.0', main: 'main.js', permissions: ['fs', 'commands'] },
    "module.exports.register = function (ctx) {\n" +
    "  ctx.registerCommand('leer', function (f) {\n" +
    "    return ctx.fs.readFile(f).then(function (c) { return 'CONTENIDO:' + c; });\n" +
    "  });\n" +
    "};\n");
  const loader = new PluginLoader(dir, { fork: loopbackFork(worker) });
  await loader.loadAll();
  loader.grant('leer', 'fs', { readFile: function (p) { return fs.readFile(p, 'utf8'); } });
  assert.strictEqual(await loader.runCommand('leer', 'leer', [path.join(dir, 'a.txt')]), 'CONTENIDO:HOLA');
  loader.killAll();
});

test('capacidad declarada sin grant es rechazada por la aplicación', async function () {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noctua-'));
  await makePlugin(dir,
    { id: 't', name: 'T', version: '1.0.0', main: 'main.js', permissions: ['tools', 'commands'] },
    "module.exports.register = function (ctx) {\n" +
    "  ctx.registerCommand('t', function () { return ctx.tools.run('yara', []); });\n" +
    "};\n");
  const loader = new PluginLoader(dir, { fork: loopbackFork(worker) });
  await loader.loadAll();
  await assert.rejects(function () { return loader.runCommand('t', 't', []); }, /no concedida por la aplicación/);
});

test('un proceso hijo comprometido no escala permisos', async function () {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noctua-'));
  await makePlugin(dir,
    { id: 'mal', name: 'Mal', version: '1.0.0', main: 'main.js', permissions: [] },
    "module.exports.register = function () {};\n");
  const mainCbs = { message: [] };
  const evilFork = function () {
    const child = {
      postMessage: function () {}, /* ignora el init real */
      on: function (ev, cb) { (mainCbs[ev] = mainCbs[ev] || []).push(cb); return child; },
      kill: function () {}
    };
    return child;
  };
  const loader = new PluginLoader(dir, { fork: evilFork });
  let evilSeen = false;
  loader.on('evil', function () { evilSeen = true; });
  const loadP = loader.loadAll();
  await tick(10); /* deja que el loader registre sus callbacks */
  for (const cb of mainCbs.message) cb({ t: 'ready', commands: ['robar'], subs: [] });
  await loadP;
  /* El hijo miente: registra comandos y emite eventos sin permiso declarado */
  for (const cb of mainCbs.message) cb({ t: 'regcmd', id: 'robar' });
  for (const cb of mainCbs.message) cb({ t: 'emit', ev: 'evil', payload: { x: 1 } });
  assert.strictEqual(evilSeen, false); /* el evento no cruzó el perímetro */
  await assert.rejects(function () { return loader.runCommand('mal', 'robar', []); }, /permiso "commands" no concedido/);
});

test('un comando colgado termina en CALL_TIMEOUT', async function () {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noctua-'));
  await makePlugin(dir,
    { id: 'lento', name: 'Lento', version: '1.0.0', main: 'main.js', permissions: ['commands'] },
    "module.exports.register = function (ctx) {\n" +
    "  ctx.registerCommand('colgado', function () { return new Promise(function () {}); });\n" +
    "};\n");
  const loader = new PluginLoader(dir, { fork: loopbackFork(worker), callTimeout: 30 });
  await loader.loadAll();
  await assert.rejects(function () { return loader.runCommand('lento', 'colgado', []); }, /CALL_TIMEOUT/);
});

test('la muerte del proceso emite plugin:crashed y bloquea comandos', async function () {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noctua-'));
  await makePlugin(dir,
    { id: 'p', name: 'P', version: '1.0.0', main: 'main.js', permissions: ['commands'] },
    "module.exports.register = function (ctx) {\n" +
    "  ctx.registerCommand('ok', function () { return 'SI'; });\n" +
    "};\n");
  const baseFork = loopbackFork(worker);
  const children = [];
  const fork = function () { const c = baseFork(); children.push(c); return c; };
  const loader = new PluginLoader(dir, { fork: fork });
  const crashed = [];
  loader.on('plugin:crashed', function (info) { crashed.push(info); });
  await loader.loadAll();
  children[0].kill(); /* el utilityProcess muere sin aviso */
  await delay(10);
  assert.strictEqual(crashed.length, 1);
  assert.strictEqual(crashed[0].id, 'p');
  await assert.rejects(function () { return loader.runCommand('p', 'ok', []); }, /PROCESO_PLUGIN_MUERTO/);
});

test('los eventos se reenvían solo a plugins suscritos con permiso', async function () {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noctua-'));
  const side = path.join(dir, 'side.txt');
  await makePlugin(dir,
    { id: 'pa', name: 'A', version: '1.0.0', main: 'main.js', permissions: ['events', 'commands'] },
    "module.exports.register = function (ctx) {\n" +
    "  ctx.registerCommand('go', function (v) { ctx.emit('ping', { v: v }); return 'OK'; });\n" +
    "};\n");
  await makePlugin(dir,
    { id: 'pb', name: 'B', version: '1.0.0', main: 'main.js', permissions: ['events'] },
    "var fs = require('fs');\n" +
    "module.exports.register = function (ctx) {\n" +
    "  ctx.on('ping', function (payload) { fs.writeFileSync('" + side + "', 'ping:' + payload.v); });\n" +
    "};\n");
  const loader = new PluginLoader(dir, { fork: loopbackFork(worker) });
  await loader.loadAll();
  assert.strictEqual(await loader.runCommand('pa', 'go', [7]), 'OK');
  await delay(50);
  assert.strictEqual(await fs.readFile(side, 'utf8'), 'ping:7');
  loader.killAll();
});
