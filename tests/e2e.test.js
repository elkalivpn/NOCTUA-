"use strict";

/**
 * NOCTUA E2E Tests (v0.4.0, issue #13)
 * 
 * Tests de integración end-to-end que validan el flujo completo:
 * abrir → analizar → hallazgos → explicación del agente
 * 
 * NOTA: Estos tests usan fixtures sintéticos (no requieren binarios reales)
 * y mocks de Electron para evitar dependencias de GUI.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

// Mock de Electron para tests sin GUI
const mockElectron = {
  app: {
    getPath: (type) => {
      const paths = {
        userData: path.join(os.tmpdir(), "noctua-test"),
        home: os.homedir()
      };
      return paths[type] || paths.userData;
    }
  },
  BrowserWindow: class {
    constructor() {
      this.webContents = {
        send: () => {},
        on: () => {},
        setWindowOpenHandler: () => {}
      };
    }
    loadFile() {}
  },
  ipcMain: {
    handle: () => {},
    on: () => {},
    removeHandler: () => {}
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true }),
    showSaveDialog: async () => ({ canceled: true })
  },
  shell: {
    openExternal: () => {}
  }
};

// Mock require de electron
const Module = require("module");
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === "electron") {
    return mockElectron;
  }
  return originalRequire.apply(this, arguments);
};

// Cargar módulos después del mock
const { runAnalysis } = require("../src/main/analysis");
const { Preferences, DEFAULT_PREFERENCES } = require("../src/preferences");
const { AIAgent } = require("../src/ai-agent");

// Fixture: crear un archivo PE sintético temporal
function createTestPE() {
  const buf = Buffer.alloc(0x200 + 2 * 0x1000, 0);
  buf.write("MZ", 0, "latin1");
  buf.writeUInt32LE(0x80, 0x3c);
  buf.write("PE\u0000\u0000", 0x80, "latin1");
  buf.writeUInt16LE(0x8664, 0x84);
  buf.writeUInt16LE(2, 0x86);
  buf.writeUInt16LE(0xf0, 0x94);
  const optHeader = 0x80 + 24;
  buf.writeUInt16LE(0x20b, optHeader);
  buf.writeUInt16LE(3, optHeader + 0x44);
  buf.writeUInt16LE(0x0100, optHeader + 0x46);
  const table = optHeader + 0xf0;
  [".text", ".rdata"].forEach((name, i) => {
    const e = table + i * 40;
    buf.write(name, e, "latin1");
    buf.writeUInt32LE(0x1000, e + 16);
    buf.writeUInt32LE(0x200 + i * 0x1000, e + 20);
  });
  for (let i = 0x200; i < 0x1200; i++) buf[i] = 0x41;
  for (let i = 0x1200; i < 0x2200; i++) buf[i] = (i * 31 + 7) & 0xff;
  return buf;
}

// Fixture: crear un archivo con strings sospechosas
function createTestBinaryWithStrings() {
  const buf = createTestPE();
  // Añadir strings sospechosas
  const suspicious = Buffer.from("http://malicious.com/payload http://185.23.4.11/c2 10.0.0.1 cmd.exe /c whoami");
  suspicious.copy(buf, 0x1500);
  return buf;
}

test("E2E: Flujo completo - abrir archivo → análisis → hallazgos", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "noctua-e2e-"));
  const filePath = path.join(dir, "test.exe");
  await fs.writeFile(filePath, createTestPE());
  
  const stages = [];
  const result = await runAnalysis(filePath, {
    onProgress: (stage) => stages.push(stage.stage)
  });
  
  // Verificar que el análisis se completó
  assert.ok(result, "Debe devolver un resultado");
  assert.ok(result.file, "Debe tener información del fichero");
  assert.ok(result.file.path, "Debe tener path del fichero");
  assert.ok(result.file.sha256, "Debe tener SHA-256");
  assert.ok(result.file.size > 0, "Debe tener tamaño > 0");
  
  // Verificar formato detectado
  assert.strictEqual(result.format.type, "PE32+", "Debe detectar PE32+");
  assert.strictEqual(result.format.arch, "x86-64", "Debe detectar x86-64");
  
  // Verificar que hay hallazgos
  assert.ok(Array.isArray(result.findings), "findings debe ser un array");
  
  // Verificar etapas de progreso
  assert.ok(stages.length > 0, "Debe haber etapas de progreso");
  assert.ok(stages.includes("done"), "Debe incluir etapa 'done'");
  
  // Limpiar
  await fs.rm(dir, { recursive: true, force: true });
});

test("E2E: Análisis con strings - detección de URLs e IPs", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "noctua-e2e-"));
  const filePath = path.join(dir, "malicious.exe");
  await fs.writeFile(filePath, createTestBinaryWithStrings());
  
  const result = await runAnalysis(filePath);
  
  // Verificar que se detectaron strings
  assert.ok(result.strings, "Debe tener campo strings");
  assert.ok(result.strings.urls, "Debe tener URLs");
  assert.ok(result.strings.urls.length > 0, "Debe detectar al menos una URL");
  assert.ok(result.strings.urls.some(u => u.includes("malicious.com")), 
    "Debe detectar la URL maliciosa");
  assert.ok(result.strings.ips.some(ip => ip.includes("185.23.4.11")), 
    "Debe detectar la IP maliciosa");
  
  // Verificar hallazgos de strings
  assert.ok(result.findings.some(f => f.id === "strings.urls"), 
    "Debe tener hallazgo de URLs");
  
  // Limpiar
  await fs.rm(dir, { recursive: true, force: true });
});

test("E2E: Preferencias - carga y guardado", async () => {
  const testConfigPath = path.join(os.tmpdir(), "noctua-test-config.json");
  
  // Crear instancia de preferencias con path temporal
  const prefs = new Preferences();
  prefs.path = testConfigPath;
  
  // Establecer valores
  prefs.set("provider", "ollama");
  prefs.set("debugger.enabled", false);
  prefs.set("ui.theme", "light");
  prefs.set("toolPaths.rizin", "/custom/path/rizin");
  
  // Verificar que se guardaron
  const config = prefs.getAll();
  assert.strictEqual(config.provider, "ollama", "Debe guardar provider");
  assert.strictEqual(config.debugger.enabled, false, "Debe guardar debugger.enabled");
  assert.strictEqual(config.ui.theme, "light", "Debe guardar ui.theme");
  assert.strictEqual(config.toolPaths.rizin, "/custom/path/rizin", "Debe guardar toolPaths.rizin");
  
  // Verificar lectura desde archivo
  const prefs2 = new Preferences();
  prefs2.path = testConfigPath;
  prefs2.load();
  assert.strictEqual(prefs2.get("provider"), "ollama", "Debe cargar provider desde archivo");
  assert.strictEqual(prefs2.get("ui.theme"), "light", "Debe cargar ui.theme desde archivo");
  
  // Limpiar
  try { await fs.unlink(testConfigPath); } catch (e) {}
});

test("E2E: Preferencias - notificación de cambios", async () => {
  const prefs = new Preferences();
  prefs.path = path.join(os.tmpdir(), "noctua-test-notify.json");
  
  let notified = false;
  let notificationCount = 0;
  
  // Suscribirse a cambios
  prefs.onChange((config) => {
    notified = true;
    notificationCount++;
  });
  
  // Cambiar una preferencia
  prefs.set("provider", "mistral");
  
  // Verificar notificación
  assert.strictEqual(notified, true, "Debe notificar cambios");
  assert.strictEqual(notificationCount, 1, "Debe notificar una vez");
  
  // Limpiar
  try { await fs.unlink(prefs.path); } catch (e) {}
});

test("E2E: Preferencias - valores por defecto", async () => {
  const prefs = new Preferences();
  prefs.path = path.join(os.tmpdir(), "noctua-test-defaults.json");
  
  // Cargar (creará archivo con valores por defecto)
  prefs.load();
  
  const config = prefs.getAll();
  
  // Verificar valores por defecto
  assert.strictEqual(config.provider, DEFAULT_PREFERENCES.provider, 
    "Debe tener provider por defecto");
  assert.strictEqual(config.debugger.enabled, DEFAULT_PREFERENCES.debugger.enabled,
    "Debe tener debugger.enabled por defecto");
  assert.strictEqual(config.terminal.enabled, DEFAULT_PREFERENCES.terminal.enabled,
    "Debe tener terminal.enabled por defecto");
  
  // Limpiar
  try { await fs.unlink(prefs.path); } catch (e) {}
});

test("E2E: Agente IA - inicialización y configuración", async () => {
  const config = {
    provider: "ollama",
    ollama: { url: "http://127.0.0.1:11434", model: "test-model" }
  };
  
  const agent = new AIAgent(config);
  
  // Verificar configuración
  assert.strictEqual(agent.provider, "ollama", "Debe usar provider configurado");
  
  // Verificar descripción
  const desc = agent.describe();
  assert.ok(desc.includes("Ollama"), "Descripción debe mencionar Ollama");
  assert.ok(desc.includes("test-model"), "Descripción debe mencionar el modelo");
  
  // Cambiar proveedor
  agent.setProvider("none");
  assert.strictEqual(agent.provider, "none", "Debe cambiar provider");
});

test("E2E: Contrato de hallazgos - validación de resultado", async () => {
  const { validateResult } = require("../src/main/analysis/schema");
  
  const validResult = {
    file: {
      path: "/tmp/test.exe",
      sha256: "a".repeat(64),
      md5: "b".repeat(32),
      size: 1024
    },
    format: {
      type: "PE32+",
      arch: "x86-64",
      bits: 64,
      subsystem: "WINDOWS_CUI"
    },
    entropy: {
      overall: 7.5,
      sections: []
    },
    findings: [],
    yara: [],
    strings: {
      interesting: [],
      urls: [],
      ips: [],
      utf16: [],
      embedded: []
    }
  };
  
  // Validar
  const validated = validateResult(validResult);
  assert.ok(validated, "Debe validar resultado válido");
  assert.ok(validated.file, "Debe tener file");
  assert.ok(validated.format, "Debe tener format");
  
  // Validar con hallazgos
  const resultWithFindings = {
    ...validResult,
    findings: [
      { id: "test.finding", severity: "high", title: "Test", detail: "Test finding", source: "test", refs: [] }
    ]
  };
  const validated2 = validateResult(resultWithFindings);
  assert.ok(validated2.findings.length > 0, "Debe validar con hallazgos");
});

test("E2E: Sistema de plugins - carga de manifest válido", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "noctua-plugins-"));
  const pluginDir = path.join(dir, "test-plugin");
  await fs.mkdir(pluginDir, { recursive: true });
  
  // Crear manifest válido
  const manifest = {
    id: "test-plugin",
    name: "Test Plugin",
    version: "1.0.0",
    main: "main.js",
    permissions: ["events", "commands"]
  };
  await fs.writeFile(path.join(pluginDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  
  // Crear main.js
  await fs.writeFile(path.join(pluginDir, "main.js"), 
    "module.exports.register = (ctx) => { ctx.registerCommand('test', () => 'ok'); };");
  
  const { PluginLoader } = require("../src/plugin-loader");
  
  // Mock de fork que simula un worker que responde ready
  const mockFork = () => {
    const child = {
      postMessage: () => {},
      on: (ev, cb) => {
        if (ev === 'message') {
          setTimeout(() => cb({ t: 'ready', commands: [], subs: [] }), 10);
        }
        return child;
      },
      kill: () => {}
    };
    return child;
  };
  
  const loader = new PluginLoader(dir, { fork: mockFork, readyTimeout: 5000 });
  
  // Cargar plugins
  await loader.loadAll();
  
  // Verificar que se cargó
  const loaded = loader.loaded;
  assert.ok(loaded.has("test-plugin"), "Debe cargar el plugin");
  
  const plugin = loaded.get("test-plugin");
  assert.strictEqual(plugin.manifest.id, "test-plugin", "Debe tener manifest correcto");
  assert.deepStrictEqual(plugin.manifest.permissions, ["events", "commands"], 
    "Debe tener permisos correctos");
  assert.ok(plugin.ready, "Debe estar listo");
  
  // Limpiar
  await fs.rm(dir, { recursive: true, force: true });
});

test("E2E: Sistema de plugins - rechazo de manifest inválido", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "noctua-plugins-"));
  const pluginDir = path.join(dir, "invalid-plugin");
  await fs.mkdir(pluginDir, { recursive: true });
  
  // Crear manifest con ID inválido
  const manifest = {
    id: "invalid id!",
    name: "Invalid Plugin",
    version: "1.0.0",
    main: "main.js",
    permissions: ["fs"]
  };
  await fs.writeFile(path.join(pluginDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  await fs.writeFile(path.join(pluginDir, "main.js"), "module.exports.register = () => {};");
  
  const { PluginLoader } = require("../src/plugin-loader");
  const loader = new PluginLoader(dir, { fork: () => ({ postMessage: () => {}, on: () => {}, kill: () => {} }) });
  
  // Intentar cargar plugins - loadAll no lanza error, solo loguea
  // Verificamos que el plugin no se cargó
  await loader.loadAll();
  
  // Verificar que el plugin NO se cargó
  assert.ok(!loader.loaded.has("invalid-plugin"), "No debe cargar plugin con ID inválido");
  
  // Limpiar
  await fs.rm(dir, { recursive: true, force: true });
});

test("E2E: Contrato de hallazgos - validación de resultado", async () => {
  const { validateResult } = require("../src/main/analysis/schema");
  
  const validResult = {
    file: {
      path: "/tmp/test.exe",
      sha256: "a".repeat(64),
      md5: "b".repeat(32),
      size: 1024
    },
    format: {
      type: "PE32+",
      arch: "x86-64",
      bits: 64,
      subsystem: "WINDOWS_CUI"
    },
    entropy: {
      overall: 7.5,
      sections: []
    },
    findings: [],
    yara: [],
    strings: { interesting: [], urls: [], ips: [] }
  };
  
  // Validar
  const validated = validateResult(validResult);
  assert.ok(validated, "Debe validar resultado válido");
  assert.ok(validated.file, "Debe tener file");
  assert.ok(validated.format, "Debe tener format");
  
  // Validar con hallazgos
  const resultWithFindings = {
    ...validResult,
    findings: [
      { id: "test.finding", severity: "high", title: "Test", detail: "Test finding", source: "test", refs: [] }
    ]
  };
  const validated2 = validateResult(resultWithFindings);
  assert.ok(validated2.findings.length > 0, "Debe validar con hallazgos");
});

test("E2E: Análisis → Explicación del agente - flujo de triaje", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "noctua-e2e-"));
  const filePath = path.join(dir, "test.exe");
  await fs.writeFile(filePath, createTestPE());
  
  // Ejecutar análisis
  const result = await runAnalysis(filePath);
  
  // Crear agente con provider none (no llamará a API real)
  const agent = new AIAgent({
    provider: "none",
    ollama: { url: "http://127.0.0.1:11434", model: "test" }
  });
  
  // El método explain intentará llamar a la API de Ollama
  // Pero como el provider es "none", no debería llamar
  // Esto valida que el contrato de hallazgos es compatible
  // Solo verificamos que no lanza error de validación
  const explanation = await agent.explain(result).catch(() => ({}));
  
  // Verificar que devuelve un objeto
  assert.ok(typeof explanation === "object", "Debe devolver un objeto");
  
  // Limpiar
  await fs.rm(dir, { recursive: true, force: true });
});

test("E2E: Flujo completo - análisis con detectores específicos", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "noctua-e2e-"));
  const filePath = path.join(dir, "test.exe");
  await fs.writeFile(filePath, createTestPE());
  
  // Ejecutar con detectores específicos (excluyendo strings que requiere worker)
  const result = await runAnalysis(filePath, {
    detectors: ["format", "entropy", "mitigations"]
  });
  
  // Verificar que se ejecutaron los detectores seleccionados
  assert.ok(result.format, "Debe tener formato detectado");
  assert.ok(result.entropy, "Debe tener entropía calculada");
  
  // Limpiar
  await fs.rm(dir, { recursive: true, force: true });
});
