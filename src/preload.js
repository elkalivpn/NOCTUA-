const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("noctua", {
  fs: {
    readFile: (p) => ipcRenderer.invoke("fs:readFile", p),
    readBinary: (p) => ipcRenderer.invoke("fs:readBinary", p),
    writeFile: (p, d) => ipcRenderer.invoke("fs:writeFile", p, d),
    readDir: (p) => ipcRenderer.invoke("fs:readDir", p),
    pickFile: () => ipcRenderer.invoke("fs:pickFile"),
    pickDir: () => ipcRenderer.invoke("fs:pickDir"),
    // v0.3.6 (issue #20): volcado hex acotado alrededor del offset de un hallazgo
    hexWindow: (p, offset) => ipcRenderer.invoke("fs:hexWindow", { path: p, offset }),
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
  findings: {
    // v0.3.6 (issue #20): exportación del informe (json|md) desde el panel
    export: (format, result) => ipcRenderer.invoke("findings:export", { format, result })
  },
  terminal: {
    create: (opts) => ipcRenderer.invoke("terminal:create", opts),
    write: (id, data) => ipcRenderer.send("terminal:write", { id, data }),
    resize: (id, cols, rows) => ipcRenderer.send("terminal:resize", { id, cols, rows }),
    kill: (id) => ipcRenderer.invoke("terminal:kill", { id }),
    onData: (cb) => ipcRenderer.on("terminal:data", (_e, m) => cb(m)),
    onExit: (cb) => ipcRenderer.on("terminal:exit", (_e, m) => cb(m))
  },
  debugger: {
    config: () => ipcRenderer.invoke("dbg:config"),
    start: (opts) => ipcRenderer.invoke("dbg:start", opts),
    continue: (sessionId) => ipcRenderer.invoke("dbg:continue", { sessionId }),
    interrupt: (sessionId) => ipcRenderer.invoke("dbg:interrupt", { sessionId }),
    step: (sessionId, kind) => ipcRenderer.invoke("dbg:step", { sessionId, kind }),
    setBreakpoint: (sessionId, file, line) => ipcRenderer.invoke("dbg:setBreakpoint", { sessionId, file, line }),
    removeBreakpoint: (sessionId, bkptId) => ipcRenderer.invoke("dbg:removeBreakpoint", { sessionId, bkptId }),
    locals: (sessionId) => ipcRenderer.invoke("dbg:locals", { sessionId }),
    backtrace: (sessionId) => ipcRenderer.invoke("dbg:backtrace", { sessionId }),
    relaunch: (sessionId) => ipcRenderer.invoke("dbg:relaunch", { sessionId }),
    quit: (sessionId) => ipcRenderer.invoke("dbg:quit", { sessionId }),
    onState: (cb) => ipcRenderer.on("dbg:state", (_e, ev) => cb(ev)),
    onStopped: (cb) => ipcRenderer.on("dbg:stopped", (_e, ev) => cb(ev)),
    onConsole: (cb) => ipcRenderer.on("dbg:console", (_e, ev) => cb(ev)),
    onExit: (cb) => ipcRenderer.on("dbg:exit", (_e, ev) => cb(ev))
  },
  tools: {
    run: (tool, file) => ipcRenderer.invoke("tool:run", { tool, file }),
    rz: (file, cmd) => ipcRenderer.invoke("tool:rz", { file, cmd }),
    yara: (rules, file) => ipcRenderer.invoke("tool:yara", { rules, file }),
    onStream: (cb) => ipcRenderer.on("tool:stream", (_e, data) => cb(data))
  },
  plugins: {
    list: () => ipcRenderer.invoke("plugins:list"),
    toggle: (id) => ipcRenderer.invoke("plugins:toggle", id),
    run: (id, cmd, args) => ipcRenderer.invoke("plugins:runCommand", { id, cmd, args }),
    onToggled: (cb) => ipcRenderer.on("plugin:toggled", (_e, ev) => cb(ev))
  }
});

