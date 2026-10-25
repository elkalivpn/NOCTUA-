'use strict';

const fs = require('fs/promises');
const path = require('path');
const { EventEmitter } = require('events');

/* NOCTUA — src/plugin-loader.js (issue #6, v0.3.3)
 *
 * Contrato noctua.plugin.v1 — aislamiento en utilityProcess:
 *   manifest.json: { id, name, version, main, permissions: string[] }
 *   Permisos (explícitos, denegados por defecto):
 *     "events"   — suscribirse y emitir eventos
 *     "commands" — registrar y ejecutar comandos
 *     "fs"       — sistema de archivos (APIs concedidas con grant)
 *     "tools"    — herramientas externas (concedidas con grant)
 *     "ai"       — agente IA (concedido con grant)
 *
 * Cada plugin se ejecuta en su PROPIO utilityProcess
 * (src/utility/plugin-worker.js). Este loader NUNCA carga código del plugin
 * en el proceso principal: se limita a forkear el worker, enviarle el
 * manifest y validar cada mensaje que regresa.
 *
 * Defensa en profundidad: los permisos se comprueban ANTES de forkear
 * (manifest), dentro del worker (ctx) y OTRA VEZ aquí para cada mensaje del
 * hijo (regcmd/sub/emit/call). Un hijo comprometido que mienta sobre sus
 * permisos queda limitado por el manifest leído por el proceso principal.
 *
 * Errores estables (tests y renderer dependen de ellos):
 *   PROCESO_PLUGIN_MUERTO — el utilityProcess terminó
 *   PLUGIN_NO_LISTO       — handshake ready sin completar
 *   CALL_TIMEOUT          — comando/capacidad sin respuesta a tiempo
 *
 * v0.3.4 (issue #12): validación de origen y estructura del manifest (id con
 * patrón estricto, directorio nombrado como el id, main relativo sin
 * componentes de escape, origin declarado) y exposición de permisos y
 * comandos para el renderer, que solo construye affordances para plugins
 * habilitados con permiso commands.
 */

const ALL_PERMISSIONS = ['events', 'commands', 'fs', 'tools', 'ai'];
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const GRANTABLE = ['fs', 'tools', 'ai'];
const READY_TIMEOUT_MS = 10000;
const CALL_TIMEOUT_MS = 15000;
const WORKER_PATH = path.join(__dirname, 'utility', 'plugin-worker.js');

function defaultFork(opts) {
  const { utilityProcess } = require('electron');
  return utilityProcess.fork(WORKER_PATH, [], opts);
}

class PluginLoader extends EventEmitter {
  constructor(dir, opts) {
    super();
    this.dir = dir;
    this.loaded = new Map();
    this.fork = (opts && opts.fork) || defaultFork;
    this.readyTimeout = (opts && opts.readyTimeout) || READY_TIMEOUT_MS;
    this.callTimeout = (opts && opts.callTimeout) || CALL_TIMEOUT_MS;
    this._nextCid = 1;
  }

  async loadAll() {
    await fs.mkdir(this.dir, { recursive: true });
    const entries = await fs.readdir(this.dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try { await this.#load(path.join(this.dir, e.name)); }
      catch (err) { console.error('[plugins] fallo al cargar ' + e.name + ':', err.message); }
    }
  }

  async #load(pluginDir) {
    const manifest = JSON.parse(await fs.readFile(path.join(pluginDir, 'manifest.json'), 'utf8'));
    if (!manifest || typeof manifest.id !== 'string' || !manifest.id)
      throw new Error('manifest sin id válido');
    /* Validación de origen y estructura (issue #12): lo declarado debe
       coincidir con lo instalado y el punto de entrada no puede salir del
       directorio del propio plugin. */
    if (!ID_PATTERN.test(manifest.id))
      throw new Error('manifest.id no válido: se exige [a-z0-9][a-z0-9-]{0,63}');
    if (manifest.id !== path.basename(pluginDir))
      throw new Error('el directorio del plugin debe llamarse como su id');
    if (this.loaded.has(manifest.id))
      throw new Error('plugin duplicado: ' + manifest.id);
    const mainRel = manifest.main || 'main.js';
    if (typeof mainRel !== 'string' || mainRel.indexOf('..') !== -1 || path.isAbsolute(mainRel) || mainRel.slice(-3) !== '.js')
      throw new Error('manifest.main debe ser una ruta relativa terminada en .js');
    if (typeof manifest.version !== 'string' || !manifest.version)
      throw new Error('manifest.version debe ser una cadena no vacía');
    if (manifest.origin !== undefined && typeof manifest.origin !== 'string')
      throw new Error('manifest.origin debe ser una cadena con la URL del repositorio');
    const declared = Array.isArray(manifest.permissions) ? manifest.permissions : [];
    const unknown = declared.filter(function (p) { return ALL_PERMISSIONS.indexOf(p) === -1; });
    if (unknown.length)
      throw new Error('permisos desconocidos: ' + unknown.join(', '));

    /* Fork primero: si el hijo muere antes del ready, el exit handler
     * rechaza la promesa y el plugin queda descartado. */
    const child = this.fork({});
    const p = {
      manifest: manifest,
      child: child,
      enabled: true,
      ready: false,
      dead: false,
      crashed: false,
      commands: new Set(),
      subs: new Set(),
      pending: new Map(),
      grants: {}
    };
    this.loaded.set(manifest.id, p);

    p.readySettle = function (err) {
      if (p.readySettled) return;
      p.readySettled = true;
      clearTimeout(p.readyTimer);
      if (err) p.readyReject(err);
      else { p.ready = true; p.readyResolve(); }
    };

    const ready = new Promise(function (resolve, reject) {
      p.readyResolve = resolve;
      p.readyReject = reject;
    });
    p.readyTimer = setTimeout(function () { p.readySettle(new Error('READY_TIMEOUT')); }, this.readyTimeout);

    child.on('exit', (function (self) {
      return function (code) {
        const wasDead = p.dead;
        p.dead = true;
        for (const pend of p.pending.values()) {
          clearTimeout(pend.timer);
          pend.reject(new Error('PROCESO_PLUGIN_MUERTO'));
        }
        p.pending.clear();
        if (!p.ready) p.readySettle(new Error('PROCESO_PLUGIN_MUERTO'));
        else if (!wasDead && !p.crashed) {
          p.crashed = true;
          self.emit('plugin:crashed', { id: manifest.id, code: code });
        }
      };
    })(this));

    child.on('message', (function (self) {
      return function (m) { self.#onChild(manifest.id, m); };
    })(this));

    try {
      child.postMessage({ t: 'init', manifest: manifest, entryPath: path.join(pluginDir, manifest.main || 'main.js') });
      await ready;
    } catch (err) {
      this.loaded.delete(manifest.id);
      try { child.kill(); } catch (e) { /* ya muerto */ }
      throw err;
    } finally {
      clearTimeout(p.readyTimer);
    }

    console.log('[plugins] ' + manifest.name + ' v' + manifest.version + ' cargado en utilityProcess [permisos: ' + (declared.join(', ') || 'ninguno') + ']');
  }

  /* Validación de CADA mensaje que regresa del hijo: los permisos se
   * comprueban contra el manifest leído por el proceso principal, no contra
   * lo que el hijo declare. */
  #onChild(pluginId, msg) {
    const p = this.loaded.get(pluginId);
    if (!p || !msg || typeof msg !== 'object') return;
    const perms = new Set(Array.isArray(p.manifest.permissions) ? p.manifest.permissions : []);
    switch (msg.t) {
      case 'ready':
        p.readySettle();
        return;
      case 'initerr':
        p.readySettle(new Error(msg.error || 'initerr'));
        return;
      case 'regcmd':
        if (perms.has('commands') && typeof msg.id === 'string') p.commands.add(msg.id);
        return;
      case 'sub':
        if (perms.has('events') && typeof msg.ev === 'string') p.subs.add(msg.ev);
        return;
      case 'emit': {
        if (!perms.has('events')) return; /* hijo comprometido: no propagar */
        this.emit(msg.ev, { from: pluginId, payload: msg.payload });
        this.emit('plugin:' + pluginId + ':' + msg.ev, msg.payload);
        for (const entry of Array.from(this.loaded.entries())) {
          const otherId = entry[0];
          const op = entry[1];
          if (otherId === pluginId || op.dead || !op.ready) continue;
          if (op.subs.has(msg.ev)) {
            try { op.child.postMessage({ t: 'evt', ev: msg.ev, payload: msg.payload }); }
            catch (e) { /* hijo muerto: su exit handler lo notificará */ }
          }
        }
        return;
      }
      case 'res': {
        const pend = p.pending.get(msg.cid);
        if (!pend) return;
        p.pending.delete(msg.cid);
        clearTimeout(pend.timer);
        if (msg.ok) pend.resolve(msg.result === undefined ? null : msg.result);
        else pend.reject(new Error(msg.error || 'error del comando'));
        return;
      }
      case 'call':
        this.#onCall(pluginId, p, msg);
        return;
      case 'log':
        if (msg.level === 'error') console.error('[plugin ' + pluginId + '] ' + (msg.msg || ''));
        else console.log('[plugin ' + pluginId + '] ' + (msg.msg || ''));
        return;
      case 'bye':
        return;
      default:
        return;
    }
  }

  async #onCall(pluginId, p, msg) {
    const reply = function (res) {
      try { p.child.postMessage(res); } catch (e) { /* hijo muerto */ }
    };
    try {
      if (p.dead) throw new Error('PROCESO_PLUGIN_MUERTO');
      const perms = new Set(Array.isArray(p.manifest.permissions) ? p.manifest.permissions : []);
      if (typeof msg.cap !== 'string' || !perms.has(msg.cap))
        throw new Error('permiso "' + msg.cap + '" no concedido al plugin ' + pluginId);
      if (typeof msg.method !== 'string' || !Array.isArray(msg.args))
        throw new Error('llamada de capacidad malformada');
      const api = p.grants[msg.cap];
      if (!api || typeof api[msg.method] !== 'function')
        throw new Error('capacidad "' + msg.cap + '.' + msg.method + '" no concedida por la aplicación');
      const result = await api[msg.method].apply(null, msg.args);
      reply({ t: 'callres', cid: msg.cid, ok: true, result: result === undefined ? null : result });
    } catch (e) {
      reply({ t: 'callres', cid: msg.cid, ok: false, error: (e && e.message) ? e.message : String(e) });
    }
  }

  /* Concesión de capacidades (fs/tools/ai) desde el proceso principal.
   * "events" y "commands" no se conceden aquí: forman parte del contrato del
   * plugin y se validan por permiso. */
  grant(id, cap, api) {
    if (GRANTABLE.indexOf(cap) === -1)
      throw new Error('grant no admite la capacidad "' + cap + '"');
    const p = this.loaded.get(id);
    if (!p) throw new Error('plugin ' + id + ' no encontrado');
    p.grants[cap] = api;
  }

  runCommand(id, cmdId, args) {
    const self = this;
    return new Promise(function (resolve, reject) {
      const p = self.loaded.get(id);
      if (!p) return reject(new Error('plugin ' + id + ' no encontrado'));
      if (p.dead) return reject(new Error('PROCESO_PLUGIN_MUERTO'));
      if (!p.ready) return reject(new Error('PLUGIN_NO_LISTO'));
      const perms = new Set(Array.isArray(p.manifest.permissions) ? p.manifest.permissions : []);
      if (!perms.has('commands'))
        return reject(new Error('permiso "commands" no concedido al plugin ' + id));
      if (!p.enabled) return reject(new Error('plugin ' + id + ' deshabilitado'));
      if (!Array.isArray(args)) return reject(new Error('args debe ser un array JSON'));
      const cid = self._nextCid++;
      const timer = setTimeout(function () {
        p.pending.delete(cid);
        reject(new Error('CALL_TIMEOUT'));
      }, self.callTimeout);
      p.pending.set(cid, { timer: timer, resolve: resolve, reject: reject });
      try {
        p.child.postMessage({ t: 'cmd', id: cmdId, args: args, cid: cid });
      } catch (e) {
        clearTimeout(timer);
        p.pending.delete(cid);
        reject(new Error('PROCESO_PLUGIN_MUERTO'));
      }
    });
  }

  list() {
    return Array.from(this.loaded.values()).map(function (p) {
      return {
        id: p.manifest.id, name: p.manifest.name,
        version: p.manifest.version,
        permissions: p.manifest.permissions || [],
        enabled: p.enabled,
        origin: typeof p.manifest.origin === 'string' ? p.manifest.origin : null,
        commands: Array.from(p.commands)
      };
    });
  }

  toggle(id) {
    const p = this.loaded.get(id);
    if (!p) throw new Error('plugin ' + id + ' no encontrado');
    p.enabled = !p.enabled;
    this.emit('plugin:toggled', { id: id, enabled: p.enabled });
    return p.enabled;
  }

  /* Apagado ordenado: dispose + kill. Marca p.dead ANTES de matar para que
   * el exit handler no reporte plugin:crashed en un apagado normal. */
  killAll() {
    for (const p of this.loaded.values()) {
      p.dead = true;
      try { p.child.postMessage({ t: 'dispose' }); } catch (e) { /* muerto */ }
      try { p.child.kill(); } catch (e) { /* ya muerto */ }
    }
  }
}

module.exports = { PluginLoader: PluginLoader, ALL_PERMISSIONS: ALL_PERMISSIONS };
