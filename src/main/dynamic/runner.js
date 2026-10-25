"use strict";

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");

/**
 * NOCTUA Dynamic Analysis Runner (v0.4.0, issue #11)
 * 
 * Ejecuta muestras en contenedores efímeros (Docker/Podman) con:
 * - Tiempo acotado
 * - Recursos limitados
 * - Recolección de evidencia: red, syscalls, hashes
 * - Cleanup garantizado
 */

const DEFAULT_TIMEOUT = 30; // segundos
const DEFAULT_MEMORY = "512m"; // memoria
const DEFAULT_CPU = 1; // CPUs

/**
 * Errores estables para el módulo de análisis dinámico
 */
const DYNAMIC_ERRORS = {
  UNAVAILABLE: "DYNAMIC_UNAVAILABLE",
  DISABLED: "DYNAMIC_DISABLED",
  TIMEOUT: "DYNAMIC_TIMEOUT",
  CONTAINER_FAILED: "CONTAINER_FAILED",
  CLEANUP_FAILED: "CLEANUP_FAILED",
  RUNTIME_NOT_FOUND: "RUNTIME_NOT_FOUND"
};

/**
 * Clase ContainerRunner para manejar la ejecución en contenedores
 */
class ContainerRunner {
  constructor(options = {}) {
    this.runtime = options.runtime || this.#detectRuntime();
    this.timeout = options.timeout || DEFAULT_TIMEOUT;
    this.memory = options.memory || DEFAULT_MEMORY;
    this.cpu = options.cpu || DEFAULT_CPU;
    this.network = options.network || "none";
    this.image = options.image || "kalilinux/rolling";
    this.verbose = options.verbose || false;
  }

  /**
   * Detectar runtime disponible (docker o podman)
   */
  #detectRuntime() {
    try {
      const { stdout } = spawn("docker", ["--version"], { stdio: "pipe" });
      return "docker";
    } catch {
      try {
        const { stdout } = spawn("podman", ["--version"], { stdio: "pipe" });
        return "podman";
      } catch {
        return null;
      }
    }
  }

  /**
   * Verificar si el runtime está disponible
   */
  isAvailable() {
    return !!this.runtime;
  }

  /**
   * Ejecutar análisis dinámico
   * @param {string} filePath - Ruta al archivo a analizar
   * @param {object} options - Opciones adicionales
   * @returns {Promise<object>} Resultado del análisis
   */
  async run(filePath, options = {}) {
    if (!this.isAvailable()) {
      throw new Error(DYNAMIC_ERRORS.RUNTIME_NOT_FOUND);
    }

    const containerId = this.#generateId();
    const workDir = "/workdir";
    const sampleName = path.basename(filePath);
    const mountedPath = path.join(workDir, sampleName);

    try {
      // Crear contenedor
      const createArgs = this.#buildCreateArgs(containerId, filePath, mountedPath);
      await this.#exec(this.runtime, ["create", ...createArgs]);

      // Iniciar traza de sistema
      const straceLog = path.join(this.#getTempDir(), `${containerId}-strace.log`);
      const straceCmd = this.#buildStraceCommand(containerId, straceLog);

      // Ejecutar el contenedor con strace
      const runArgs = this.#buildRunArgs(containerId);
      const runProcess = spawn(this.runtime, ["start", "-a", ...runArgs], {
        stdio: "pipe",
        timeout: this.timeout * 1000
      });

      // Esperar a que termine o timeout
      await new Promise((resolve, reject) => {
        runProcess.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Container exited with code ${code}`));
        });
        runProcess.on("error", (err) => reject(err));
        
        setTimeout(() => {
          runProcess.kill();
          reject(new Error(DYNAMIC_ERRORS.TIMEOUT));
        }, this.timeout * 1000);
      });

      // Recolectar evidencia
      const evidence = await this.#collectEvidence(containerId, filePath, straceLog);

      return evidence;

    } catch (err) {
      // Cleanup en caso de error
      await this.#cleanup(containerId).catch(() => {});
      throw err;
    } finally {
      // Cleanup final
      await this.#cleanup(containerId).catch(() => {});
    }
  }

  /**
   * Generar ID único para el contenedor
   */
  #generateId() {
    return `noctua-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Obtener directorio temporal
   */
  #getTempDir() {
    return process.env.NOCTUA_TEMP_DIR || require("os").tmpdir();
  }

  /**
   * Construir argumentos para crear el contenedor
   */
  #buildCreateArgs(containerId, filePath, mountedPath) {
    const args = [
      "--name", containerId,
      "--rm",
      "--memory", this.memory,
      "--cpus", String(this.cpu),
      "--network", this.network,
      "--read-only",
      "-v", `${filePath}:${mountedPath}:ro`,
      "-w", workDir,
      this.image,
      "sleep", "infinity"
    ];

    // Añadir opciones específicas del runtime
    if (this.runtime === "podman") {
      args.unshift("--rm");
    }

    return args;
  }

  /**
   * Construir comando strace
   */
  #buildStraceCommand(containerId, logPath) {
    return [
      "strace",
      "-f",
      "-e", "trace=network,file",
      "-o", logPath,
      "-p", containerId
    ];
  }

  /**
   * Construir argumentos para ejecutar el contenedor
   */
  #buildRunArgs(containerId) {
    return [
      "-d",
      containerId
    ];
  }

  /**
   * Ejecutar un comando
   */
  async #exec(cmd, args) {
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { stdio: "pipe" });
      let stdout = "";
      let stderr = "";

      p.stdout.on("data", (d) => { stdout += d; });
      p.stderr.on("data", (d) => { stderr += d; });

      p.on("close", (code) => {
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(`${cmd} failed: ${stderr || stdout}`));
      });

      p.on("error", (err) => reject(err));
    });
  }

  /**
   * Recolectar evidencia del contenedor
   */
  async #collectEvidence(containerId, filePath, straceLog) {
    const evidence = {
      network: [],
      syscalls: {},
      files: [],
      errors: []
    };

    try {
      // Parsear traza de sistema
      const straceData = await this.#parseStraceLog(straceLog);
      evidence.network = straceData.network;
      evidence.syscalls = straceData.syscalls;
      evidence.files = straceData.files;

      // Obtener diff del contenedor
      const diff = await this.#getContainerDiff(containerId);
      evidence.files = evidence.files.concat(diff.files);

    } catch (err) {
      evidence.errors.push(`Failed to collect evidence: ${err.message}`);
    }

    return evidence;
  }

  /**
   * Parsear log de strace
   */
  async #parseStraceLog(logPath) {
    try {
      const log = await fs.readFile(logPath, "utf8");
      return this.#parseStraceOutput(log);
    } catch {
      return { network: [], syscalls: {}, files: [] };
    }
  }

  /**
   * Parsear salida de strace
   */
  #parseStraceOutput(output) {
    const network = [];
    const syscalls = {};
    const files = [];

    const lines = output.split("\n");

    for (const line of lines) {
      if (!line.trim()) continue;

      // Parsear syscall: pid syscall(args) = result
      const syscallMatch = line.match(/^(\d+)\s+(\w+)\(([^)]*)\)\s*=\s*([^\s]+)/);
      if (syscallMatch) {
        const [, pid, syscall, args, result] = syscallMatch;
        
        // Contar syscalls
        syscalls[syscall] = (syscalls[syscall] || 0) + 1;

        // Parsear conexiones de red
        if (syscall === "connect" || syscall === "sendto") {
          const connection = this.#parseNetworkConnection(args);
          if (connection) network.push(connection);
        }

        // Parsear operaciones de fichero
        if (syscall === "open" || syscall === "creat" || syscall === "write") {
          const fileOp = this.#parseFileOperation(args, syscall, result);
          if (fileOp) files.push(fileOp);
        }
      }
    }

    return { network, syscalls, files };
  }

  /**
   * Parsear conexión de red
   */
  #parseNetworkConnection(args) {
    // Formato: connect(sockfd, {sa_family=AF_INET, sin_port=htons(80), sin_addr=inet_addr("93.184.216.34")}, addrlen)
    const ipMatch = args.match(/sin_addr=inet_addr\("([^"]+)"\)/);
    const portMatch = args.match(/sin_port=htons\((\d+)\)/);

    if (ipMatch && portMatch) {
      return {
        host: ipMatch[1],
        port: parseInt(portMatch[1]),
        proto: "tcp"
      };
    }

    return null;
  }

  /**
   * Parsear operación de fichero
   */
  #parseFileOperation(args, syscall, result) {
    // Formato: open("/path/to/file", O_RDONLY)
    const pathMatch = args.match(/"([^"]+)"/);
    if (!pathMatch) return null;

    const filePath = pathMatch[1];
    const resultCode = parseInt(result);

    return {
      path: filePath,
      operation: syscall,
      success: resultCode >= 0
    };
  }

  /**
   * Obtener diff del contenedor
   */
  async #getContainerDiff(containerId) {
    try {
      const { stdout } = await this.#exec(this.runtime, ["diff", containerId]);
      return this.#parseDiffOutput(stdout);
    } catch {
      return { files: [] };
    }
  }

  /**
   * Parsear salida de diff
   */
  #parseDiffOutput(output) {
    const files = [];
    const lines = output.split("\n");

    for (const line of lines) {
      if (!line.trim()) continue;

      // Formato: C /path/to/file
      const changeMatch = line.match(/^(C|A|D)\s+(\S+)/);
      if (changeMatch) {
        const [, type, filePath] = changeMatch;
        files.push({ path: filePath, type });
      }
    }

    return { files };
  }

  /**
   * Limpiar contenedor
   */
  async #cleanup(containerId) {
    try {
      // Detener contenedor
      await this.#exec(this.runtime, ["stop", containerId]).catch(() => {});
      // Eliminar contenedor
      await this.#exec(this.runtime, ["rm", "-f", containerId]).catch(() => {});
    } catch {
      // Ignorar errores de cleanup
    }
  }
}

/**
 * Crear un FakeContainerRunner para tests
 */
class FakeContainerRunner {
  constructor() {
    this.lastFilePath = null;
    this.lastOptions = null;
    this.availability = true;
  }

  isAvailable() {
    return this.availability;
  }

  setAvailable(available) {
    this.availability = available;
  }

  async run(filePath, options = {}) {
    this.lastFilePath = filePath;
    this.lastOptions = options;

    if (!this.availability) {
      throw new Error(DYNAMIC_ERRORS.RUNTIME_NOT_FOUND);
    }

    // Simular resultado de análisis
    return {
      network: [
        { host: "93.184.216.34", port: 80, proto: "tcp" },
        { host: "185.23.4.11", port: 443, proto: "tcp" }
      ],
      syscalls: {
        connect: 2,
        open: 5,
        write: 3,
        read: 10
      },
      files: [
        { path: "/tmp/malware_output", type: "C" },
        { path: "/tmp/config.ini", type: "A" }
      ],
      errors: []
    };
  }
}

module.exports = { ContainerRunner, FakeContainerRunner, DYNAMIC_ERRORS };
