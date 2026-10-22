const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const { spawn } = require("child_process");
const { AIAgent } = require("./ai-agent");
const { PluginLoader } = require("./plugin-loader");
const { analyzeBasic } = require("./analyze");
const { runAnalysis } = require("./main/analysis");
const { TerminalManager } = require("./main/terminal");

let win;
const agent = new AIAgent(loadConfig());
const plugins = new PluginLoader(path.join(app.getPath("userData"), "plugins"));

function loadConfig() {
  const cfgPath = path.join(app.getPath("userData"), "noctua.json");
  try {
    return JSON.parse(require("fs").readFileSync(cfgPath, "utf8"));
  } catch {
    return {
      provider: "mistral",
      mistral: { apiKey: "", model: "mistral-large-latest" },
      ollama: { url: "http://127.0.0.1:11434", model: "qwen2.5-coder:32b" }
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
    onProgress: (s) => win?.webContents.send("analyze:progress", s)
  }));
ipcMain.handle("analyze:basic", (_e, filePath) => analyzeBasic(filePath));

/* ---------- IPC: terminal (issue #3) ---------- */
ipcMain.handle("terminal:create", async (_e, opts = {}) => terminal.create(opts));
ipcMain.on("terminal:write", (_e, { id, data } = {}) => {
  try { terminal.write(id, data); } catch (e) { console.error("[terminal] write:", e.message); }
});
ipcMain.on("terminal:resize", (_e, { id, cols, rows } = {}) => {
  try { terminal.resize(id, cols, rows); } catch (e) { console.error("[terminal] resize:", e.message); }
});
ipcMain.handle("terminal:kill", (_e, { id } = {}) => terminal.kill(id));

/* ---------- IPC: herramientas directas ---------- */
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

app.whenReady().then(async () => {
  await plugins.loadAll();
  createWindow();
});
app.on("window-all-closed", () => {
  terminal.killAll();
  if (process.platform !== "darwin") app.quit();
});
app.on("will-quit", () => { terminal.killAll(); });
