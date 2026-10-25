'use strict';

/* NOCTUA — src/utility/plugin-worker.js (issue #6, v0.3.3)
 *
 * Este módulo se ejecuta DENTRO de un utilityProcess de Electron, fuera del
 * proceso principal. El loader (src/plugin-loader.js) le envía "init" con el
 * manifest y la ruta de entrada; a partir de ahí el plugin se registra sobre
 * un contexto restringido.
 *
 * Contrato noctua.plugin.v1 — cambios en v0.3.3:
 *   - ctx.bus ELIMINADO: el plugin ya no recibe el bus de eventos del proceso
 *     principal. Los eventos se usan mediante ctx.on/ctx.emit, que se
 *     traducen a mensajes del protocolo y se validan OTRA VEZ en el proceso
 *     principal (defensa en profundidad).
 *   - Las capacidades (ctx.fs, ctx.tools, ctx.ai) son proxies asíncronos:
 *     cada método devuelve una Promise que se resuelve mediante RPC con el
 *     proceso principal (mensajes "call"/"callres") con timeout de llamada.
 *   - Los permisos se comprueban aquí ANTES de emitir cada mensaje: un plugin
 *     no puede solicitar más de lo declarado en su manifest.json.
 *
 * Protocolo (mensajes planos serializables):
 *   main -> hijo: init | cmd | evt | callres | dispose
 *   hijo -> main: ready | initerr | regcmd | sub | emit | call | res | log | bye
 */

const ALL_PERMISSIONS = ['events', 'commands', 'fs', 'tools', 'ai'];
const CALL_TIMEOUT_MS = 15000;

function createWorker(port) {
  const commands = new Map();   // id de comando -> función
  const subs = new Map();      // evento -> Set de callbacks
  const pending = new Map();   // cid -> { timer, resolve, reject }
  let nextCid = 1;
  let disposed = false;

  function post(msg) {
    if (disposed) return;
    try { port.postMessage(msg); } catch (e) { /* puerto cerrado: ignorar */ }
  }

  const ctx = {
    id: null,
    permissions: null,
    bus: null, /* eliminado del contrato en v0.3.3; se conserva null por compatibilidad */
    on: function (event, cb) {
      if (!ctx.permissions || !ctx.permissions.has('events'))
        throw new Error('permiso "events" no concedido al plugin ' + ctx.id);
      if (typeof cb !== 'function') throw new Error('ctx.on exige una función callback');
      if (!subs.has(event)) subs.set(event, new Set());
      subs.get(event).add(cb);
      post({ t: 'sub', ev: event });
      return function () {
        const set = subs.get(event);
        if (set) set.delete(cb);
      };
    },
    emit: function (event, payload) {
      if (!ctx.permissions || !ctx.permissions.has('events'))
        throw new Error('permiso "events" no concedido al plugin ' + ctx.id);
      post({ t: 'emit', ev: event, payload: payload === undefined ? null : payload });
    },
    registerCommand: function (id, fn) {
      if (!ctx.permissions || !ctx.permissions.has('commands'))
        throw new Error('permiso "commands" no concedido al plugin ' + ctx.id);
      if (typeof id !== 'string' || !id) throw new Error('registerCommand exige un id de comando');
      if (typeof fn !== 'function') throw new Error('registerCommand exige una función');
      commands.set(id, fn);
      post({ t: 'regcmd', id: id });
    },
    runCommand: function (id) {
      const fn = commands.get(id);
      if (!fn) return Promise.reject(new Error('comando no registrado: ' + id));
      const args = Array.prototype.slice.call(arguments, 1);
      return Promise.resolve().then(function () { return fn.apply(null, args); });
    }
  };

  function makeCapability(cap) {
    return new Proxy({}, {
      get: function (_target, method) {
        return function () {
          if (!ctx.permissions || !ctx.permissions.has(cap))
            return Promise.reject(new Error('capacidad "' + cap + '" no concedida al plugin ' + ctx.id));
          if (typeof method !== 'string' || !method)
            return Promise.reject(new Error('método de capacidad no válido'));
          const args = Array.prototype.slice.call(arguments);
          return new Promise(function (resolve, reject) {
            const cid = nextCid++;
            const timer = setTimeout(function () {
              pending.delete(cid);
              reject(new Error('CALL_TIMEOUT'));
            }, CALL_TIMEOUT_MS);
            pending.set(cid, { timer: timer, resolve: resolve, reject: reject });
            post({ t: 'call', cap: cap, method: method, args: args, cid: cid });
          });
        };
      }
    });
  }

  ctx.fs = makeCapability('fs');
  ctx.tools = makeCapability('tools');
  ctx.ai = makeCapability('ai');

  function handle(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'init': {
        const manifest = msg.manifest;
        if (!manifest || typeof manifest.id !== 'string' || !manifest.id) {
          post({ t: 'initerr', error: 'manifest sin id válido' });
          return;
        }
        const perms = new Set();
        const declared = manifest.permissions || [];
        for (let i = 0; i < declared.length; i++) {
          if (ALL_PERMISSIONS.indexOf(declared[i]) === -1) {
            post({ t: 'initerr', error: 'permiso desconocido: ' + declared[i] });
            return;
          }
          perms.add(declared[i]);
        }
        ctx.id = manifest.id;
        ctx.permissions = perms;
        let mod;
        try {
          mod = require(msg.entryPath);
        } catch (e) {
          post({ t: 'initerr', error: 'fallo al cargar el plugin: ' + (e && e.message ? e.message : String(e)) });
          return;
        }
        if (!mod || typeof mod.register !== 'function') {
          post({ t: 'initerr', error: 'el plugin no exporta register(ctx)' });
          return;
        }
        try {
          mod.register(ctx);
        } catch (e) {
          post({ t: 'initerr', error: 'error en register: ' + (e && e.message ? e.message : String(e)) });
          return;
        }
        const cmds = [];
        commands.forEach(function (_fn, id) { cmds.push(id); });
        const evs = [];
        subs.forEach(function (_set, ev) { evs.push(ev); });
        post({ t: 'ready', commands: cmds, subs: evs });
        return;
      }
      case 'cmd': {
        const fn = commands.get(msg.id);
        if (!fn) {
          post({ t: 'res', cid: msg.cid, ok: false, error: 'comando no registrado: ' + msg.id });
          return;
        }
        Promise.resolve().then(function () {
          return fn.apply(null, Array.isArray(msg.args) ? msg.args : []);
        }).then(function (result) {
          post({ t: 'res', cid: msg.cid, ok: true, result: result === undefined ? null : result });
        }).catch(function (e) {
          post({ t: 'res', cid: msg.cid, ok: false, error: (e && e.message) ? e.message : String(e) });
        });
        return;
      }
      case 'evt': {
        const set = subs.get(msg.ev);
        if (!set) return;
        set.forEach(function (cb) {
          try { cb(msg.payload); }
          catch (e) {
            post({ t: 'log', level: 'error', msg: 'error en suscriptor de "' + msg.ev + '": ' + (e && e.message ? e.message : String(e)) });
          }
        });
        return;
      }
      case 'callres': {
        const p = pending.get(msg.cid);
        if (!p) return;
        pending.delete(msg.cid);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.result === undefined ? null : msg.result);
        else p.reject(new Error(msg.error || 'error en la llamada de capacidad'));
        return;
      }
      case 'dispose': {
        disposed = true;
        post({ t: 'bye' });
        if (process.parentPort && typeof process.exit === 'function') process.exit(0);
        return;
      }
      default:
        return;
    }
  }

  /* El puerto del utilityProcess entrega eventos con { data }; los puertos de
   * los tests entregan el mensaje directo: se aceptan ambas formas. */
  port.on('message', function (ev) {
    handle(ev && typeof ev === 'object' && ev.data !== undefined ? ev.data : ev);
  });
}

/* En un utilityProcess real, process.parentPort existe y conecta con el
 * proceso principal. En tests (node:test) se instancia createWorker a mano
 * con un puerto en bucle. */
if (process.parentPort) {
  createWorker(process.parentPort);
}

module.exports = { createWorker: createWorker, ALL_PERMISSIONS: ALL_PERMISSIONS, CALL_TIMEOUT_MS: CALL_TIMEOUT_MS };
