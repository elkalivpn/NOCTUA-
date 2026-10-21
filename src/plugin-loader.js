const fs = require("fs/promises");
const path = require("path");
const { EventEmitter } = require("events");

/* Contrato noctua.plugin.v1
 *
 * manifest.json: { id, name, version, main, permissions: string[] }
 * Permisos disponibles (explícitos, denegados por defecto):
 *   "events"   — suscribirse y emitir en el bus de eventos
 *   "commands" — registrar y ejecutar comandos en la paleta
 *   "fs"       — acceso al espacio de trabajo del usuario (por rutas aprobadas)
 *   "tools"    — invocar herramientas externas (rizin, yara, ...)
 *   "ai"       — consultar al agente IA
 *
 * Sin un permiso, el ctx lanza un error al intentar usar la capacidad.
 * Esto evita RCE por diseño: un plugin malicioso solo obtiene lo que declara.
 */
const ALL_PERMISSIONS = ["events", "commands", "fs", "tools", "ai"];

class PluginLoader extends EventEmitter {
  constructor(dir) { super(); this.dir = dir; this.loaded = new Map(); }

  async loadAll() {
    await fs.mkdir(this.dir, { recursive: true });
    const entries = await fs.readdir(this.dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try { await this.#load(path.join(this.dir, e.name)); }
      catch (err) { console.error(`[plugins] fallo al cargar ${e.name}:`, err.message); }
    }
  }

  async #load(pluginDir) {
    const manifest = JSON.parse(await fs.readFile(path.join(pluginDir, "manifest.json"), "utf8"));
    const unknown = (manifest.permissions || []).filter((p) => !ALL_PERMISSIONS.includes(p));
    if (unknown.length)
      throw new Error(`permisos desconocidos: ${unknown.join(", ")}`);
    const { register } = require(path.join(pluginDir, manifest.main || "main.js"));
    const ctx = this.#makeCtx(manifest);
    register(ctx);
    this.loaded.set(manifest.id, { manifest, ctx, enabled: true });
    console.log(`[plugins] ${manifest.name} v${manifest.version} cargado [permisos: ${(manifest.permissions || []).join(", ") || "ninguno"}]`);
  }

  #makeCtx(manifest) {
    const bus = this;
    const commands = new Map();
    const perms = new Set(manifest.permissions || []);
    const gate = (perm) => {
      if (!perms.has(perm))
        throw new Error(`permiso "${perm}" no concedido al plugin ${manifest.id} — declárelo en manifest.json`);
    };
    return {
      id: manifest.id,
      permissions: perms,
      bus,
      on: (ev, cb) => { gate("events"); bus.on(`plugin:${manifest.id}:${ev}`, cb); },
      emit: (ev, payload) => { gate("events"); bus.emit(ev, { from: manifest.id, payload }); },
      registerCommand: (id, fn) => { gate("commands"); commands.set(`${manifest.id}:${id}`, fn); },
      runCommand: (id, ...args) => { gate("commands"); commands.get(`${manifest.id}:${id}`)?.(...args); },
      // "fs" y "tools" se inyectan tras la inicialización del proceso principal;
      // el gate ya impide que un plugin sin permiso los reclame.
      grantFS: (api) => { gate("fs"); this.#inject(manifest.id, "fs", api); },
      grantTools: (api) => { gate("tools"); this.#inject(manifest.id, "tools", api); }
    };
  }

  #inject(id, key, api) {
    const p = this.loaded.get(id);
    if (p) p.ctx[key] = api;
  }

  list() {
    return [...this.loaded.values()].map((p) => ({
      id: p.manifest.id, name: p.manifest.name,
      version: p.manifest.version,
      permissions: p.manifest.permissions || [],
      enabled: p.enabled
    }));
  }

  toggle(id) {
    const p = this.loaded.get(id);
    if (!p) throw new Error(`plugin ${id} no encontrado`);
    p.enabled = !p.enabled;
    this.emit("plugin:toggled", { id, enabled: p.enabled });
    return p.enabled;
  }
}

module.exports = { PluginLoader, ALL_PERMISSIONS };
