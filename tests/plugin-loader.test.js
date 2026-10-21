const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { PluginLoader } = require("../src/plugin-loader");

async function makePlugin(dir, manifest, mainJs) {
  await fs.mkdir(path.join(dir, manifest.id), { recursive: true });
  await fs.writeFile(path.join(dir, manifest.id, "manifest.json"), JSON.stringify(manifest));
  await fs.writeFile(path.join(dir, manifest.id, "main.js"), mainJs);
}

test("carga un plugin y respeta permisos concedidos", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "noctua-"));
  await makePlugin(dir,
    { id: "p1", name: "P1", version: "1.0.0", main: "main.js", permissions: ["events", "commands"] },
    `module.exports.register = (ctx) => {
       ctx.registerCommand("saludar", () => "hola");
       ctx.on("prueba", () => {});
     };`);
  const loader = new PluginLoader(dir);
  await loader.loadAll();
  const list = loader.list();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, "p1");
  assert.deepStrictEqual(list[0].permissions, ["events", "commands"]);
});

test("un plugin sin permiso lanza error al usar la capacidad", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "noctua-"));
  await makePlugin(dir,
    { id: "p2", name: "P2", version: "1.0.0", main: "main.js", permissions: [] },
    `module.exports.register = (ctx) => { ctx.registerCommand("x", () => {}); };`);
  const loader = new PluginLoader(dir);
  // El error de permisos ocurre dentro de register: el plugin falla al cargar,
  // no corrompe el loader.
  await loader.loadAll();
  assert.strictEqual(loader.list().length, 0); // p2 falló y quedó descartado
});

test("permisos desconocidos son rechazados", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "noctua-"));
  await makePlugin(dir,
    { id: "p3", name: "P3", version: "1.0.0", main: "main.js", permissions: ["rootkit"] },
    `module.exports.register = () => {};`);
  const loader = new PluginLoader(dir);
  await loader.loadAll();
  assert.strictEqual(loader.list().length, 0); // rechazado por permiso inválido
});
