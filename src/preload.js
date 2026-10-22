const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("noctua", {
  fs: {
    readFile: (p) => ipcRenderer.invoke("fs:readFile", p),
    readBinary: (p) => ipcRenderer.invoke("fs:readBinary", p),
    writeFile: (p, d) => ipcRenderer.invoke("fs:writeFile", p, d),
    readDir: (p) => ipcRenderer.invoke("fs:readDir", p),
    pickFile: () => ipcRenderer.invoke("fs:pickFile"),
    pickDir: () => ipcRenderer.invoke("fs:pickDir"),
    // sandbox: File.path no existe; webUtils es la vía sancionada por Electron
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  ai: {
    chat: (prompt, context) => ipcRenderer.invoke("ai:chat", { prompt, context }),
    describe: () => ipcRenderer.invoke("ai:describe"),
    switchProvider: (provider) => ipcRenderer.invoke("ai:switchProvider", provider),
    explain: (result) => ipcRenderer.invoke("ai:explain", result)
  },
  analysis: {
    run: (p, opts) => ipcRenderer.invoke("analyze:run", p, opts),
    basic: (p) => ipcRenderer.invoke("analyze:basic", p),
    onProgress: (cb) => ipcRenderer.on("analyze:progress", (_e, s) => cb(s))
  },
  terminal: {
    create: (opts) => ipcRenderer.invoke("terminal:create", opts),
    write: (id, data) => ipcRenderer.send("terminal:write", { id, data }),
    resize: (id, cols, rows) => ipcRenderer.send("terminal:resize", { id, cols, rows }),
    kill: (id) => ipcRenderer.invoke("terminal:kill", { id }),
    onData: (cb) => ipcRenderer.on("terminal:data", (_e, m) => cb(m)),
    onExit: (cb) => ipcRenderer.on("terminal:exit", (_e, m) => cb(m))
  },
  tools: {
    rz: (file, cmd) => ipcRenderer.invoke("tool:rz", { file, cmd }),
    yara: (rules, file) => ipcRenderer.invoke("tool:yara", { rules, file }),
    onStream: (cb) => ipcRenderer.on("tool:stream", (_e, data) => cb(data))
  },
  plugins: {
    list: () => ipcRenderer.invoke("plugins:list"),
    toggle: (id) => ipcRenderer.invoke("plugins:toggle", id)
  }
});
