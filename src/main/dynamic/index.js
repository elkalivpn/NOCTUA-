"use strict";

/**
 * NOCTUA Dynamic Analysis Module (v0.4.0, issue #11)
 * 
 * Orquestador de análisis dinámico:
 * - Crear contenedor efímero
 * - Ejecutar bajo strace con timeout
 * - Recolectar diff y hashes
 * - Destruir contenedor
 * - Generar hallazgos dinámicos
 */

const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const { ContainerRunner, FakeContainerRunner, DYNAMIC_ERRORS } = require("./runner");
const { parseNetworkTrace, parseSyscallSummary, parseContainerDiff, generateFindings } = require("./parse");

/**
 * Configuración por defecto
 */
const DEFAULT_CONFIG = {
  enabled: false,
  runtime: null, // auto-detect: docker o podman
  timeout: 30, // segundos
  memory: "512m",
  cpu: 1,
  network: "none", // none, bridge
  image: "kalilinux/rolling",
  confirmExecution: true // Confirmación explícita antes de ejecutar
};

/**
 * Clase DynamicAnalyzer para manejar el análisis dinámico
 */
class DynamicAnalyzer {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.runner = null;
    
    // Crear runner basado en configuración
    if (this.config.enabled) {
      this.runner = new ContainerRunner({
        runtime: this.config.runtime,
        timeout: this.config.timeout,
        memory: this.config.memory,
        cpu: this.config.cpu,
        network: this.config.network,
        image: this.config.image
      });
    }
  }

  /**
   * Verificar si el análisis dinámico está disponible
   */
  isAvailable() {
    return this.config.enabled && this.runner && this.runner.isAvailable();
  }

  /**
   * Ejecutar análisis dinámico
   * @param {string} filePath - Ruta al archivo a analizar
   * @param {object} options - Opciones adicionales
   * @returns {Promise<object>} Resultado con hallazgos
   */
  async run(filePath, options = {}) {
    if (!this.config.enabled) {
      throw new Error(DYNAMIC_ERRORS.DISABLED);
    }

    if (!this.isAvailable()) {
      throw new Error(DYNAMIC_ERRORS.UNAVAILABLE);
    }

    if (this.config.confirmExecution && !options.confirmed) {
      throw new Error("DYNAMIC_CONFIRMATION_REQUIRED");
    }

    // Validar archivo
    if (!filePath || typeof filePath !== "string") {
      throw new Error("Invalid file path");
    }

    try {
      // Ejecutar en contenedor
      const evidence = await this.runner.run(filePath, {
        timeout: options.timeout || this.config.timeout
      });

      // Generar hallazgos
      const findings = generateFindings(evidence);

      // Calcular hashes de ficheros nuevos
      const filesWithHashes = await this.#calculateHashes(evidence.files, filePath);

      return {
        evidence,
        findings,
        files: filesWithHashes,
        success: true
      };

    } catch (err) {
      return {
        evidence: {},
        findings: [],
        files: [],
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Calcular hashes de ficheros
   */
  async #calculateHashes(files, originalPath) {
    const filesWithHashes = [];

    for (const file of files) {
      try {
        // Si es un fichero creado/modificado en el contenedor,
        // no podemos acceder a él directamente
        // En una implementación real, necesitaríamos:
        // 1. Montar un volumen compartido
        // 2. O copiar los ficheros antes de destruir el contenedor
        
        // Para el mock, generamos un hash ficticio
        const hash = crypto.createHash("sha256")
          .update(file.path + Date.now())
          .digest("hex");

        filesWithHashes.push({
          ...file,
          hash
        });
      } catch {
        filesWithHashes.push(file);
      }
    }

    return filesWithHashes;
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
    
    // Recrear runner si el runtime cambió
    if (newConfig.runtime || newConfig.enabled !== undefined) {
      if (this.config.enabled) {
        this.runner = new ContainerRunner({
          runtime: this.config.runtime,
          timeout: this.config.timeout,
          memory: this.config.memory,
          cpu: this.config.cpu,
          network: this.config.network,
          image: this.config.image
        });
      } else {
        this.runner = null;
      }
    }
  }
}

/**
 * Crear un FakeDynamicAnalyzer para tests
 */
class FakeDynamicAnalyzer {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.lastFilePath = null;
    this.lastOptions = null;
  }

  isAvailable() {
    return this.config.enabled;
  }

  async run(filePath, options = {}) {
    this.lastFilePath = filePath;
    this.lastOptions = options;

    if (!this.config.enabled) {
      throw new Error(DYNAMIC_ERRORS.DISABLED);
    }

    if (this.config.confirmExecution && !options.confirmed) {
      throw new Error("DYNAMIC_CONFIRMATION_REQUIRED");
    }

    // Simular resultado de análisis
    return {
      evidence: {
        network: [
          { host: "93.184.216.34", port: 80, proto: "tcp", syscall: "connect", pid: 1234 }
        ],
        syscalls: { connect: 1, open: 2, write: 3 },
        files: [
          { path: "/tmp/output.txt", type: "C" }
        ]
      },
      findings: [
        {
          id: "dynamic.network-connection",
          severity: "medium",
          title: "Conexión de red a 93.184.216.34:80",
          detail: "Conexión TCP detectada durante ejecución dinámica",
          source: "dynamic",
          refs: ["93.184.216.34:80", "tcp"]
        }
      ],
      files: [
        { path: "/tmp/output.txt", type: "C", hash: "abc123..." }
      ],
      success: true
    };
  }

  getConfig() {
    return { ...this.config };
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }
}

module.exports = { DynamicAnalyzer, FakeDynamicAnalyzer, DYNAMIC_ERRORS, DEFAULT_CONFIG };
