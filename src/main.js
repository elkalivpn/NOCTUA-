const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const { spawn } = require("child_process");
const { AIAgent } = require("./ai-agent");
const { PluginLoader } = require("./plugin-loader");
const { analyzeBasic } = require("./analyze");
const { runAnalysis } = require("./main/analysis");
const { TerminalManager } = require("./main/terminal");
const { DebuggerManager, buildGdbArgs } = require("./main/debugger/manager");
const { readHexWindow } = require("./hexdump");
const { buildReport } = require("./report");
const { validateResult } = require("./main/analysis/schema");

let win;
const config = loadConfig();
const agent = new AIAgent(config);
const plugins = new PluginLoader(path.join(app.getPath("userData"), "plugins"));

function loadConfig() {
  const cfgPath = path.join(app.getPath("userData"), "noctua.json");
  try {
    return JSON.parse(require("fs").readFileSync(cfgPath, "utf8"));
  } catch {
    return {
      provider: "mistral",
      mistral: { apiKey: "", model: "mistral-large-latest" },
      ollama: { url: "http://127.0.0.1:11434", model: "qwen2.5-coder:32b" },
      debugger: { enabled: true, confirmStart: true, loadUserInit: false }
    };
  }
}

/* ---------- Terminal PTY (issue #3, diseño docs/DESIGN-terminal.md) ---------- */
function createPtyFactory() {
  let nodePty = null;
  let loadError = null;
  try {
    nodePty = require("node-pty");
  } catch (e) {
    loadError = e;
  }
  return ({ cols, rows, cwd, shell, env }) => {
    if (!nodePty) {
      throw new Error("node-pty no disponible (falta compilación: npm run rebuild) — " +
        (loadError && loadError.message ? loadError.message : "dependencia no instalada"));
    }
    return nodePty.spawn(shell, [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: cwd || undefined,
      env: env || process.env
    });
  };
}

const terminal = new TerminalManager({
  ptyFactory: createPtyFactory(),
  maxSessions: 3,
  onOutput: (m) => win?.webContents.send("terminal:data", m),
  onExit: (m) => win?.webContents.send("terminal:exit", m)
});

/* ---------- Depurador GDB/MI (issue #2, diseño docs/DESIGN-debugger.md) ---------- */
const dbgDefaults = { enabled: true, confirmStart: true, loadUserInit: false };
const dbgConfig = Object.assign({}, dbgDefaults, config.debugger || {});

/* Adaptador del proceso gdb: argv array sin shell (R5). gdb se lanza con -nx
   salvo opt-in del usuario (debugger.loadUserInit). */
function spawnGdbAdapter({ binary, loadUserInit }) {
  const p = spawn("gdb", buildGdbArgs({ binary, loadUserInit }), { stdio: ["pipe", "pipe", "pipe"] });
  const listeners = { stdout: [], exit: [], error: [] };
  const adapter = {
    write: (s) => { p.stdin.write(s); },
    kill: () => { try { p.stdin.end(); } catch (e) {} p.kill("SIGKILL"); },
    on: (ev, cb) => { (listeners[ev] = listeners[ev] || []).push(cb); return adapter; }
  };
  p.stdout.on("data", (d) => { for (const cb of listeners.stdout) cb(d.toString("utf8")); });
  p.on("exit", (code) => { for (const cb of listeners.exit) cb(code); });
  p.on("error", (err) => { for (const cb of listeners.error) cb(err); });
  return adapter;
}

const debuggerManager = new DebuggerManager({
  spawnGdb: spawnGdbAdapter,
  maxSessions: 2,
  onEvent: (ev) => win?.webContents.send("dbg:" + ev.type, ev)
});

async function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 1000, backgroundColor: "#0b0e14",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, "../renderer/index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
}

/* ---------- IPC: sistema de archivos ---------- */
ipcMain.handle("fs:readFile", async (_e, p) => fs.readFile(p, "utf8"));
ipcMain.handle("fs:readBinary", async (_e, p) => (await fs.readFile(p)).toString("base64"));
ipcMain.handle("fs:writeFile", async (_e, p, data) => fs.writeFile(p, data, "utf8"));
ipcMain.handle("fs:readDir", async (_e, p) => {
  const entries = await fs.readdir(p, { withFileTypes: true });
  return entries.map((x) => ({ name: x.name, dir: x.isDirectory() }));
});
ipcMain.handle("fs:pickFile", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openFile"] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("fs:pickDir", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
  return r.canceled ? null : r.filePaths[0];
});

/* ---------- IPC: contexto hex de un hallazgo (v0.3.6, issue #20, diseño D2) ----------
   El renderer ya puede leer cualquier fichero vía fs:readBinary; aquí se devuelve
   un volcado acotado (256 bytes) alrededor del offset, validando la entrada. */
ipcMain.handle("fs:hexWindow", async (_e, { path: p, offset } = {}) => {
  if (typeof p !== "string" || !p) throw new Error("fs:hexWindow exige la ruta del fichero");
  if (!Number.isInteger(offset) || offset < 0) throw new Error("fs:hexWindow exige un offset entero >= 0");
  const bytes = await fs.readFile(p);
  return readHexWindow(bytes, offset);
});

/* ---------- IPC: agente IA ---------- */
ipcMain.handle("ai:chat", async (_e, { prompt, context }) =>
  agent.complete(prompt, agent.buildContext(context)));
ipcMain.handle("ai:describe", () => agent.describe());
ipcMain.handle("ai:switchProvider", (_e, provider) => { agent.setProvider(provider); return agent.describe(); });
ipcMain.handle("ai:explain", (_e, result) => agent.explain(result));

/* ---------- IPC: análisis ---------- */
ipcMain.handle("analyze:run", async (_e, p, opts) =>
  runAnalysis(p, {
    yaraRules: opts?.yaraRules || null,
    detectors: Array.isArray(opts?.detectors) ? opts.detectors : null,
    onProgress: (s) => win?.webContents.send("analyze:progress", s)
  }));
ipcMain.handle("analyze:basic", (_e, filePath) => analyzeBasic(filePath));

/* ---------- IPC: exportación de informes (v0.3.6, issue #20, diseño D3) ----------
   Validación en el borde: formato con whitelist {json, md} y resultado con el
   contrato AnalysisResultSchema ANTES de construir el informe. El informe
   SIEMPRE contiene el análisis completo; los filtros del panel no se aplican. */
ipcMain.handle("findings:export", async (_e, { format, result } = {}) => {
  if (format !== "json" && format !== "md") throw new Error("formato de informe no soportado (whitelist): " + format);
  const valid = validateResult(result);
  const ext = format === "json" ? "json" : "md";
  const base = String(valid.file.path).split(/[\\/]/).pop().replace(/\.[^.]*$/, "") || "analisis";
  const r = await dialog.showSaveDialog(win, { defaultPath: "informe-" + base + "." + ext });
  if (r.canceled || !r.filePath) return { canceled: true };
  await fs.writeFile(r.filePath, buildReport(format, valid), "utf8");
  return { canceled: false, path: r.filePath };
});

/* ---------- IPC: terminal (issue #3) ---------- */
ipcMain.handle("terminal:create", async (_e, opts = {}) => terminal.create(opts));
ipcMain.on("terminal:write", (_e, { id, data } = {}) => {
  try { terminal.write(id, data); } catch (e) { console.error("[terminal] write:", e.message); }
});
ipcMain.on("terminal:resize", (_e, { id, cols, rows } = {}) => {
  try { terminal.resize(id, cols, rows); } catch (e) { console.error("[terminal] resize:", e.message); }
});
ipcMain.handle("terminal:kill", (_e, { id } = {}) => terminal.kill(id));

/* ---------- IPC: depurador (issue #2) ---------- */
ipcMain.handle("dbg:config", () => dbgConfig);
ipcMain.handle("dbg:start", async (_e, opts = {}) => {
  if (!dbgConfig.enabled) throw new Error("depurador deshabilitado en noctua.json (debugger.enabled = false)");
  if (!opts.binary) throw new Error("dbg:start exige la ruta del binario");
  return debuggerManager.start(opts);
});
ipcMain.handle("dbg:continue", (_e, { sessionId } = {}) => debuggerManager.continue(sessionId));
ipcMain.handle("dbg:interrupt", (_e, { sessionId } = {}) => debuggerManager.interrupt(sessionId));
ipcMain.handle("dbg:step", (_e, { sessionId, kind } = {}) => debuggerManager.step(sessionId, kind));
ipcMain.handle("dbg:setBreakpoint", (_e, { sessionId, file, line } = {}) => debuggerManager.setBreakpoint(sessionId, file, line));
ipcMain.handle("dbg:removeBreakpoint", (_e, { sessionId, bkptId } = {}) => debuggerManager.removeBreakpoint(sessionId, bkptId));
ipcMain.handle("dbg:locals", (_e, { sessionId } = {}) => debuggerManager.locals(sessionId));
ipcMain.handle("dbg:backtrace", (_e, { sessionId } = {}) => debuggerManager.backtrace(sessionId));
ipcMain.handle("dbg:relaunch", (_e, { sessionId } = {}) => debuggerManager.relaunch(sessionId));
ipcMain.handle("dbg:quit", (_e, { sessionId } = {}) => debuggerManager.quit(sessionId));

/* ---------- IPC: herramientas directas ---------- */
/* Whitelist fija para la paleta de comandos (v0.3.2): el renderer pasa un id
   de esta tabla, nunca el ejecutable ni los argumentos. Sin shell, timeout 60 s. */
const PALETTE_TOOLS = {
  file: { cmd: "file", args: (f) => [f] },
  sha256: { cmd: "sha256sum", args: (f) => [f] },
  strings: { cmd: "strings", args: (f) => ["-n", "8", f] },
  readelf: { cmd: "readelf", args: (f) => ["-h", f] },
  rabin: { cmd: "rabin2", args: (f) => ["-I", f] },
  imports: { cmd: "rabin2", args: (f) => ["-i", f] }
};
ipcMain.handle("tool:run", (_e, { tool, file } = {}) => {
  const t = PALETTE_TOOLS[tool];
  if (!t) throw new Error("herramienta no permitida (whitelist): " + tool);
  if (typeof file !== "string" || !file) throw new Error("tool:run exige la ruta del fichero");
  return runTool(t.cmd, t.args(file));
});
function runTool(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { timeout: 60000, ...opts });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; win?.webContents.send("tool:stream", out); });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", (er) => resolve({ code: 127, out: "", err: er.message }));
    p.on("close", (code) => resolve({ code, out, err }));
  });
}
ipcMain.handle("tool:rz", (_e, { file, cmd }) => runTool("rz-bin", ["-q", "-c", cmd, file]));
ipcMain.handle("tool:yara", (_e, { rules, file }) => runTool("yara", [rules, file]));

/* ---------- IPC: plugins ---------- */
ipcMain.handle("plugins:list", () => plugins.list());
ipcMain.handle("plugins:toggle", (_e, id) => plugins.toggle(id));

/* Permisos explícitos en el renderer (issue #12): el renderer solo construye
   affordances a partir de la lista (permisos + estado), y el proceso
   principal re-valida CADA invocación (defensa en profundidad). */
ipcMain.handle("plugins:runCommand", (_e, pl) => {
  const payload = pl || {};
  return plugins.runCommand(String(payload.id), String(payload.cmd), Array.isArray(payload.args) ? payload.args : []);
});
plugins.on("plugin:toggled", ({ id, enabled }) => {
  win?.webContents.send("plugin:toggled", { id, enabled });
});

/* Caída de un utilityProcess de plugin (issue #6): el proceso principal
   sobrevive y el renderer puede reflejar el estado. */
plugins.on("plugin:crashed", ({ id }) => {
  console.error("[plugins] el utilityProcess de " + id + " murió de forma inesperada");
  win?.webContents.send("plugin:crashed", { id });
});

app.whenReady().then(async () => {
  await plugins.loadAll();
  createWindow();
});
app.on("window-all-closed", () => {
  terminal.killAll();
  debuggerManager.killAll();
  plugins.killAll();
  if (process.platform !== "darwin") app.quit();
});
app.on("will-quit", () => { terminal.killAll(); debuggerManager.killAll(); plugins.killAll(); });

