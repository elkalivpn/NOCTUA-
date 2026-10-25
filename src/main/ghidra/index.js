"use strict";

/**
 * NOCTUA Ghidra Headless Integration (v0.4.0, issue #8)
 * 
 * Integración con Ghidra headless para análisis estático avanzado:
 * - Ejecución de analyzeHeadless con proyecto temporal
 * - Exportación de funciones, xrefs, strings
 * - Generación de hallazgos con fuente "ghidra"
 */

const { spawn } = require("child_process");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");

const GHIDRA_ERRORS = {
  NOT_FOUND: "GHIDRA_NOT_FOUND",
  TIMEOUT: "GHIDRA_TIMEOUT",
  PARSE_ERROR: "GHIDRA_PARSE_ERROR",
  DISABLED: "GHIDRA_DISABLED"
};

const DEFAULT_TIMEOUT = 300; // segundos (5 minutos)

/**
 * Clase GhidraAnalyzer para manejar el análisis con Ghidra
 */
class GhidraAnalyzer {
  constructor(config = {}) {
    this.config = {
      enabled: config.enabled !== undefined ? config.enabled : true,
      path: config.path || this.#detectGhidraPath(),
      timeout: config.timeout || DEFAULT_TIMEOUT,
      confirmExecution: config.confirmExecution !== undefined ? config.confirmExecution : true
    };
  }

  /**
   * Detectar ruta de Ghidra
   */
  #detectGhidraPath() {
    const commonPaths = [
      "/opt/ghidra",
      "/usr/local/ghidra",
      path.join(os.homedir(), "ghidra"),
      "/Applications/ghidra",
      "C:\\Program Files\\ghidra"
    ];

    for (const p of commonPaths) {
      try {
        const analyzeHeadless = path.join(p, "support", "analyzeHeadless");
        fs.accessSync(analyzeHeadless, fs.constants.X_OK);
        return p;
      } catch {
        // Continuar con el siguiente path
      }
    }

    return null;
  }

  /**
   * Verificar si Ghidra está disponible
   */
  isAvailable() {
    return this.config.enabled && !!this.config.path;
  }

  /**
   * Ejecutar análisis con Ghidra headless
   * @param {string} filePath - Ruta al archivo a analizar
   * @param {object} options - Opciones adicionales
   * @returns {Promise<object>} Resultado con hallazgos
   */
  async run(filePath, options = {}) {
    if (!this.config.enabled) {
      throw new Error(GHIDRA_ERRORS.DISABLED);
    }

    if (!this.isAvailable()) {
      throw new Error(GHIDRA_ERRORS.NOT_FOUND);
    }

    if (this.config.confirmExecution && !options.confirmed) {
      throw new Error("GHIDRA_CONFIRMATION_REQUIRED");
    }

    // Validar archivo
    if (!filePath || typeof filePath !== "string") {
      throw new Error("Invalid file path");
    }

    try {
      // Crear proyecto temporal
      const projectDir = await this.#createTempProject();
      const projectName = path.basename(filePath, path.extname(filePath));
      
      // Ejecutar Ghidra headless
      const result = await this.#runGhidraHeadless(filePath, projectDir, projectName, options);

      // Limpiar proyecto temporal
      await this.#cleanupProject(projectDir).catch(() => {});

      return result;

    } catch (err) {
      return {
        success: false,
        error: err.message,
        findings: [],
        functions: [],
        strings: []
      };
    }
  }

  /**
   * Crear proyecto temporal
   */
  async #createTempProject() {
    const tempDir = path.join(os.tmpdir(), `noctua-ghidra-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    return tempDir;
  }

  /**
   * Ejecutar Ghidra headless
   */
  async #runGhidraHeadless(filePath, projectDir, projectName, options) {
    const analyzeHeadless = path.join(this.config.path, "support", "analyzeHeadless");
    const scriptPath = path.join(__dirname, "ghidra-script.js");

    // Argumentos para analyzeHeadless
    const args = [
      projectDir,
      projectName,
      filePath,
      "-scriptPath",
      scriptPath,
      "-postScript",
      "ghidra.GhidraScript",
      "-noanalysis"
    ];

    // Añadir opciones adicionales
    if (options.importPath) {
      args.push("-import", options.importPath);
    }

    // Ejecutar con timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout * 1000);

    try {
      const result = await spawn(analyzeHeadless, args, {
        stdio: "pipe",
        timeout: this.config.timeout * 1000,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // Parsear salida
      return await this.#parseOutput(result.stdout || "", result.stderr || "");

    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  /**
   * Parsear salida de Ghidra
   */
  async #parseOutput(stdout, stderr) {
    try {
      // Intentar parsear JSON de stdout
      const result = JSON.parse(stdout);
      return this.#processResult(result);
    } catch {
      // Intentar leer archivo de salida
      try {
        const outputFile = path.join(os.tmpdir(), "noctua-ghidra-output.json");
        const data = await fs.readFile(outputFile, "utf8");
        const result = JSON.parse(data);
        await fs.unlink(outputFile).catch(() => {});
        return this.#processResult(result);
      } catch {
        throw new Error(GHIDRA_ERRORS.PARSE_ERROR);
      }
    }
  }

  /**
   * Procesar resultado de Ghidra
   */
  #processResult(result) {
    const findings = [];
    const functions = [];
    const strings = [];

    // Procesar funciones
    if (result.functions) {
      for (const func of result.functions) {
        functions.push({
          name: func.name,
          address: func.address,
          size: func.size,
          returnType: func.returnType,
          parameters: func.parameters || []
        });

        // Generar hallazgo para funciones sospechosas
        if (this.#isSuspiciousFunction(func)) {
          findings.push({
            id: "ghidra.suspicious-function",
            severity: "medium",
            title: `Función sospechosa: ${func.name}`,
            detail: `Función en ${func.address} con características sospechosas`,
            source: "ghidra",
            refs: [func.name, func.address]
          });
        }
      }
    }

    // Procesar strings
    if (result.strings) {
      for (const str of result.strings) {
        strings.push(str);

        // Generar hallazgo para strings sospechosas
        if (this.#isSuspiciousString(str)) {
          findings.push({
            id: "ghidra.suspicious-string",
            severity: "low",
            title: `String sospechosa: ${str.slice(0, 50)}`,
            detail: `String detectada en análisis con Ghidra`,
            source: "ghidra",
            refs: [str]
          });
        }
      }
    }

    // Procesar xrefs
    if (result.xrefs) {
      for (const xref of result.xrefs) {
        findings.push({
          id: "ghidra.xref",
          severity: "info",
          title: `XREF: ${xref.from} → ${xref.to}`,
          detail: `Referencia cruzada detectada`,
          source: "ghidra",
          refs: [xref.from, xref.to]
        });
      }
    }

    return {
      success: true,
      findings,
      functions,
      strings,
      xrefs: result.xrefs || [],
      summary: result.summary || {}
    };
  }

  /**
   * Verificar si una función es sospechosa
   */
  #isSuspiciousFunction(func) {
    const suspiciousNames = [
      "main", "WinMain", "DllMain", "start",
      "VirtualAlloc", "CreateRemoteThread", "WriteProcessMemory",
      "IsDebuggerPresent", "CheckRemoteDebuggerPresent",
      "CreateProcess", "ShellExecute", "WinExec",
      "LoadLibrary", "GetProcAddress", "CreateFile",
      "InternetConnect", "HttpSendRequest", "recv", "send"
    ];

    return suspiciousNames.some(name => 
      func.name && func.name.toLowerCase().includes(name.toLowerCase())
    );
  }

  /**
   * Verificar si una string es sospechosa
   */
  #isSuspiciousString(str) {
    const suspiciousPatterns = [
      "http://", "https://", "ftp://",
      "cmd.exe", "powershell", "sh", "bash",
      "regsvr32", "rundll32", "mshta",
      "\\\\", "C:\\", "/bin/", "/usr/bin/"
    ];

    return suspiciousPatterns.some(pattern => 
      str && str.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  /**
   * Limpiar proyecto temporal
   */
  async #cleanupProject(projectDir) {
    try {
      await fs.rm(projectDir, { recursive: true, force: true });
    } catch {
      // Ignorar errores de cleanup
    }
  }

  /**
   * Obtener configuración
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Actualizar configuración
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    
    // Si se deshabilita, limpiar path
    if (newConfig.enabled === false) {
      this.config.path = null;
    }
  }
}

/**
 * Crear un FakeGhidraAnalyzer para tests
 */
class FakeGhidraAnalyzer {
  constructor(config = {}) {
    this.config = {
      enabled: config.enabled !== undefined ? config.enabled : true,
      path: config.path || "/fake/ghidra",
      confirmExecution: config.confirmExecution !== undefined ? config.confirmExecution : true
    };
    this.lastFilePath = null;
    this.lastOptions = null;
  }

  isAvailable() {
    return this.config.enabled && !!this.config.path;
  }
  
  #checkAvailable() {
    if (!this.isAvailable()) {
      throw new Error(GHIDRA_ERRORS.NOT_FOUND);
    }
  }

  async run(filePath, options = {}) {
    this.lastFilePath = filePath;
    this.lastOptions = options;

    if (!this.config.enabled) {
      throw new Error(GHIDRA_ERRORS.DISABLED);
    }

    this.#checkAvailable();

    if (this.config.confirmExecution && !options.confirmed) {
      throw new Error("GHIDRA_CONFIRMATION_REQUIRED");
    }

    // Simular resultado de Ghidra
    return {
      success: true,
      findings: [
        {
          id: "ghidra.suspicious-function",
          severity: "medium",
          title: "Función sospechosa: main",
          detail: "Función principal detectada",
          source: "ghidra",
          refs: ["main", "0x401000"]
        }
      ],
      functions: [
        { name: "main", address: "0x401000", size: 100, returnType: "void", parameters: [] }
      ],
      strings: ["http://example.com", "Hello World"],
      xrefs: [
        { from: "main", to: "printf" }
      ],
      summary: { totalFunctions: 1, totalStrings: 2 }
    };
  }

  getConfig() {
    return { ...this.config };
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }
}

module.exports = { GhidraAnalyzer, FakeGhidraAnalyzer, GHIDRA_ERRORS, DEFAULT_TIMEOUT };
