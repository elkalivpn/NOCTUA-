const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const { spawn } = require("child_process");
const crypto = require("crypto");
const { AIAgent } = require("./ai-agent");
const { PluginLoader } = require("./plugin-loader");

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

/* ---------- IPC: agente IA ---------- */
ipcMain.handle("ai:chat", async (_e, { prompt, context }) =>
  agent.complete(prompt, agent.buildContext(context)));
ipcMain.handle("ai:describe", () => agent.describe());
ipcMain.handle("ai:switchProvider", (_e, provider) => { agent.setProvider(provider); return agent.describe(); });

/* ---------- IPC: herramientas de análisis ---------- */
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

// Análisis estático con rizin (apt install rizin)
ipcMain.handle("tool:rz", (_e, { file, cmd }) => runTool("rz-bin", ["-q", "-c", cmd, file]));
// Escaneo YARA (apt install yara)
ipcMain.handle("tool:yara", (_e, { rules, file }) => runTool("yara", [rules, file]));

// Análisis básico sin dependencias: cabeceras, entropía de Shannon, hashes
ipcMain.handle("analyze:basic", async (_e, filePath) => {
  const buf = await fs.readFile(filePath);
  const isPE = buf.subarray(0, 2).toString("latin1") === "MZ";
  const isELF = buf.subarray(0, 4).toString("hex") === "7f454c46";
  const isScript = buf.subarray(0, 2).toString("latin1") === "#!";
  const freq = new Array(256).fill(0);
  for (const b of buf) freq[b]++;
  let entropy = 0;
  for (const f of freq) { if (!f) continue; const p = f / buf.length; entropy -= p * Math.log2(p); }
  return {
    size: buf.length,
    type: isPE ? "PE/EXE" : isELF ? "ELF" : isScript ? "Script" : "desconocido",
    entropy: Number(entropy.toFixed(3)),
    packed: entropy > 7.2,
    sha256: crypto.createHash("sha256").update(buf).digest("hex"),
    md5: crypto.createHash("md5").update(buf).digest("hex")
  };
});

/* ---------- IPC: plugins ---------- */
ipcMain.handle("plugins:list", () => plugins.list());
ipcMain.handle("plugins:toggle", (_e, id) => plugins.toggle(id));

app.whenReady().then(async () => {
  await plugins.loadAll();
  createWindow();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
