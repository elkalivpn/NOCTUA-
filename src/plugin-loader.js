const fs = require("fs/promises");
const path = require("path");
const { EventEmitter } = require("events");

/* Contrato noctua.plugin.v1 */
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
    const { register } = require(path.join(pluginDir, manifest.main || "main.js"));
    const ctx = this.#makeCtx(manifest);
    register(ctx);
    this.loaded.set(manifest.id, { manifest, ctx, enabled: true });
    console.log(`[plugins] ${manifest.name} v${manifest.version} cargado`);
  }
  #makeCtx(manifest) {
    const bus = this;
    const commands = new Map();
    return {
      id: manifest.id,
      bus,
      on: (ev, cb) => bus.on(`plugin:${manifest.id}:${ev}`, cb),
      emit: (ev, payload) => bus.emit(ev, { from: manifest.id, payload }),
      registerCommand: (id, fn) => commands.set(`${manifest.id}:${id}`, fn),
      runCommand: (id, ...args) => commands.get(`${manifest.id}:${id}`)?.(...args)
    };
  }
  list() {
    return [...this.loaded.values()].map((p) => ({
      id: p.manifest.id, name: p.manifest.name,
      version: p.manifest.version, enabled: p.enabled
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

module.exports = { PluginLoader };
