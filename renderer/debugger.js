"use strict";
/* NOCTUA — panel de depuración (renderer/debugger.js).
   Módulo independiente: no toca la terminal ni el árbol. La UI es función pura
   del estado de la sesión (R3) y todo el diálogo con gdb pasa por IPC. */

var DebuggerUI = (function () {
  var api = null;
  var openFileRef = null;
  var termRef = null;
  var getActiveFile = null;
  var switchTabRef = null;
  var editor = null;

  var sessionId = null;
  var state = null; /* idle|launching|running|stopped|exited|closed */
  var interrupting = false;
  var breakpoints = {}; /* "file|line" → bkptId|null (pendiente hasta iniciar sesión) */
  var bpCollection = null;
  var lineCollection = null;

  var LABEL = {
    idle: "sin sesión", launching: "arrancando…", running: "en ejecución",
    stopped: "detenido", exited: "inferior terminado", closed: "sesión cerrada"
  };
  /* Botones activos por estado: tabla declarativa, sin heurísticas (R3) */
  var ENABLED = {
    "dbg-continue": ["stopped"],
    "dbg-interrupt": ["running"],
    "dbg-step-over": ["stopped"],
    "dbg-step-into": ["stopped"],
    "dbg-step-out": ["stopped"],
    "dbg-relaunch": ["exited"],
    "dbg-quit": ["launching", "running", "stopped", "exited"]
  };

  function el(id) { return document.getElementById(id); }
  function term(text, cls) { if (termRef) termRef("[dbg] " + text, cls); }

  function updateControls() {
    var box = el("dbg-state");
    if (!box) return;
    box.textContent = interrupting ? "interrumpiendo…" : (LABEL[state] || "sin sesión");
    box.className = state === "running" ? "running" : (state === "stopped" ? "stopped" : "");
    var ids = Object.keys(ENABLED);
    for (var i = 0; i < ids.length; i++) {
      var b = el(ids[i]);
      if (b) b.disabled = !(sessionId && ENABLED[ids[i]].indexOf(state) !== -1);
    }
    var start = el("btn-debug");
    if (start) start.textContent = sessionId ? "Depuración activa" : "Depurar";
  }

  function requestStart() {
    api.debugger.config().then(function (cfg) {
      if (!cfg.enabled) return term("depurador deshabilitado en noctua.json (debugger.enabled)", "err");
      var binary = getActiveFile();
      if (!binary) return term("abra primero el binario en el editor", "err");
      if (cfg.confirmStart) {
        el("dbg-confirm-target").textContent = binary;
        el("dbg-confirm").classList.add("open");
      } else {
        doStart(binary);
      }
    });
  }

  function doStart(binary) {
    term("iniciando sesión bajo gdb…", "info");
    var bps = [];
    var keys = Object.keys(breakpoints);
    for (var i = 0; i < keys.length; i++) {
      var parts = keys[i].split("|");
      bps.push({ file: parts[0], line: parseInt(parts[1], 10) });
    }
    api.debugger.start({ binary: binary, breakpoints: bps }).then(function (res) {
      sessionId = res.sessionId;
      state = res.state;
      interrupting = false;
      term("sesión " + res.sessionId + " (" + res.state + ")", "ok");
      if (switchTabRef) switchTabRef("dbg");
      updateControls();
    }).catch(function (e) {
      term("no se pudo iniciar la sesión: " + e, "err");
      sessionId = null;
      state = null;
      updateControls();
    });
  }

  function clearCurrentLine() {
    if (lineCollection) lineCollection.set([]);
  }

  function showFrame(frame) {
    var box = el("dbg-frame");
    if (!frame) { box.textContent = "sin marco actual"; return; }
    var file = frame.fullname || frame.file;
    if (file && frame.line) {
      box.textContent = frame.func + " — " + file + ":" + frame.line;
      openFileRef(file).then(function () {
        if (!lineCollection) return;
        var line = parseInt(frame.line, 10);
        lineCollection.set([{
          range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
          options: { isWholeLine: true, className: "dbg-current-line" }
        }]);
      });
    } else {
      /* R7: sin símbolos se muestra la dirección; nunca se adivina el fuente */
      box.textContent = (frame.func || "?") + " — " + (frame.addr || "sin dirección") + " (sin símbolos de depuración)";
      clearCurrentLine();
    }
  }

  function renderFrame() {
    if (!sessionId || state !== "stopped") return;
    api.debugger.locals(sessionId).then(function (vars) {
      var box = el("dbg-locals").querySelector(".dbg-body");
      box.textContent = "";
      if (!vars.length) box.textContent = "(sin variables simples en el marco)";
      for (var i = 0; i < vars.length; i++) {
        var row = document.createElement("div");
        row.className = "dbg-var";
        var n = document.createElement("span");
        n.className = "n";
        n.textContent = vars[i].name;
        var v = document.createElement("span");
        v.className = "v";
        v.textContent = "= " + vars[i].value;
        row.appendChild(n);
        row.appendChild(v);
        box.appendChild(row);
      }
    }).catch(function (e) { term("locals: " + e, "err"); });
    api.debugger.backtrace(sessionId).then(function (frames) {
      var box = el("dbg-backtrace").querySelector(".dbg-body");
      box.textContent = "";
      for (var i = 0; i < frames.length; i++) {
        var f = frames[i];
        var row = document.createElement("div");
        row.className = "dbg-fr" + (f.level === 0 ? " current" : "");
        row.textContent = "#" + f.level + " " + f.func +
          (f.file ? " (" + f.file.split("/").pop() + (f.line ? ":" + f.line : "") + ")" : " @ " + f.addr);
        box.appendChild(row);
      }
    }).catch(function (e) { term("backtrace: " + e, "err"); });
  }

  function toggleBreakpoint(file, line) {
    var key = file + "|" + line;
    if (breakpoints[key] !== undefined) {
      var id = breakpoints[key];
      delete breakpoints[key];
      if (id && sessionId) {
        api.debugger.removeBreakpoint(sessionId, id).catch(function (e) { term("removeBreakpoint: " + e, "err"); });
      }
    } else {
      breakpoints[key] = null; /* pendiente hasta que exista sesión */
      if (sessionId && (state === "stopped" || state === "exited")) {
        api.debugger.setBreakpoint(sessionId, file, line).then(function (res) {
          breakpoints[key] = res.bkptId;
        }).catch(function (e) {
          delete breakpoints[key];
          term("setBreakpoint: " + e, "err");
        });
      } else {
        term("breakpoint pendiente: se aplicará al iniciar la sesión", "info");
      }
    }
    renderBreakpoints();
  }

  function renderBreakpoints() {
    if (!editor || !bpCollection) return;
    var active = getActiveFile ? getActiveFile() : null;
    var decos = [];
    var keys = Object.keys(breakpoints);
    for (var i = 0; i < keys.length; i++) {
      var parts = keys[i].split("|");
      if (parts[0] !== active) continue;
      var line = parseInt(parts[1], 10);
      decos.push({
        range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
        options: { glyphMarginClassName: "dbg-bp" }
      });
    }
    bpCollection.set(decos);
  }

  function attachEditor(ed) {
    editor = ed;
    ed.updateOptions({ glyphMargin: true });
    bpCollection = ed.createDecorationsCollection([]);
    lineCollection = ed.createDecorationsCollection([]);
    ed.onMouseDown(function (e) {
      if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
      var file = getActiveFile ? getActiveFile() : null;
      if (file) toggleBreakpoint(file, e.target.position.lineNumber);
    });
    renderBreakpoints();
  }

  function step(kind) {
    api.debugger.step(sessionId, kind).then(function (r) {
      state = r.state;
      updateControls();
    }).catch(function (e) { term("step " + kind + ": " + e, "err"); });
  }

  function init(opts) {
    api = opts.api;
    openFileRef = opts.openFile;
    termRef = opts.term;
    getActiveFile = opts.getActiveFile;
    switchTabRef = opts.switchTab;

    el("btn-debug").onclick = function () {
      if (sessionId) { if (switchTabRef) switchTabRef("dbg"); return; }
      requestStart();
    };
    el("dbg-confirm-no").onclick = function () { el("dbg-confirm").classList.remove("open"); };
    el("dbg-confirm-yes").onclick = function () {
      el("dbg-confirm").classList.remove("open");
      doStart(el("dbg-confirm-target").textContent);
    };
    el("dbg-continue").onclick = function () {
      api.debugger.continue(sessionId).then(function (r) { state = r.state; updateControls(); })
        .catch(function (e) { term("continue: " + e, "err"); });
    };
    el("dbg-interrupt").onclick = function () {
      interrupting = true;
      updateControls();
      api.debugger.interrupt(sessionId).catch(function (e) {
        interrupting = false;
        term("interrupt: " + e, "err");
        updateControls();
      });
    };
    el("dbg-step-over").onclick = function () { step("over"); };
    el("dbg-step-into").onclick = function () { step("into"); };
    el("dbg-step-out").onclick = function () { step("out"); };
    el("dbg-relaunch").onclick = function () {
      api.debugger.relaunch(sessionId).then(function (r) {
        state = r.state;
        term("inferior relanzado (" + r.state + ")", "ok");
        updateControls();
      }).catch(function (e) { term("relaunch: " + e, "err"); });
    };
    el("dbg-quit").onclick = function () {
      api.debugger.quit(sessionId).then(function (r) { state = r.state; updateControls(); })
        .catch(function (e) { term("quit: " + e, "err"); });
    };

    api.debugger.onState(function (ev) {
      state = ev.state;
      if (ev.error) term(ev.error, "err");
      updateControls();
    });
    api.debugger.onStopped(function (ev) {
      interrupting = false;
      state = "stopped";
      updateControls();
      showFrame(ev.frame);
      renderFrame();
    });
    api.debugger.onConsole(function (ev) {
      var box = el("dbg-console").querySelector(".dbg-body");
      var p = document.createElement("div");
      p.className = "dbg-line" + (ev.stream === "target" ? " tgt" : (ev.stream === "log" ? " log" : ""));
      p.textContent = ev.data;
      box.appendChild(p);
      box.scrollTop = box.scrollHeight;
    });
    api.debugger.onExit(function (ev) {
      term("gdb terminó (código " + ev.code + ")", "ok");
      sessionId = null;
      state = null;
      interrupting = false;
      clearCurrentLine();
      el("dbg-frame").textContent = "sin marco: inicie una sesión y deténgase en un breakpoint";
      updateControls();
    });
    updateControls();
  }

  return { init: init, attachEditor: attachEditor, renderBreakpoints: renderBreakpoints };
})();

window.DebuggerUI = DebuggerUI;
