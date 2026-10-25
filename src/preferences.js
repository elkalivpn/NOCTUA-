"use strict";

const path = require("path");
const fs = require("fs");
const { app } = require("electron");

/**
 * NOCTUA Preferences System (v0.4.0, issue #22)
 * 
 * Sistema de preferencias centralizado con:
 * - Carga y guardado automático desde ~/.config/noctua/noctua.json
 * - Valores por defecto sensatos
 * - Validación de tipos
 * - Notificación de cambios a los consumidores
 */

const DEFAULT_PREFERENCES = {
  // Configuración del agente IA
  provider: "none",
  mistral: { apiKey: "", model: "mistral-large-latest" },
  ollama: { url: "http://127.0.0.1:11434", model: "qwen2.5-coder:32b" },
  
  // Configuración del depurador
  debugger: {
    enabled: true,
    confirmStart: true,
    loadUserInit: false,
    maxSessions: 2
  },
  
  // Configuración de la terminal
  terminal: {
    enabled: true,
    maxSessions: 3,
    shell: "/bin/bash",
    fontSize: 14,
    fontFamily: "Consolas, 'Courier New', monospace"
  },
  
  // Preferencias de UI
  ui: {
    theme: "dark",
    fontSize: 14,
    language: "es",
    wordWrap: false,
    minimap: true,
    renderWhitespace: "none",
    bracketMatching: true,
    autoClosingBrackets: true,
    autoIndentation: true
  },
  
  // Paths de herramientas externas
  toolPaths: {
    rizin: "/usr/bin/rizin",
    radare2: "/usr/bin/radare2",
    yara: "/usr/bin/yara",
    gdb: "/usr/bin/gdb",
    strings: "/usr/bin/strings",
    file: "/usr/bin/file",
    sha256sum: "/usr/bin/sha256sum",
    readelf: "/usr/bin/readelf",
    rabin2: "/usr/bin/rabin2"
  },
  
  // Configuración de análisis
  analysis: {
    defaultDetectors: ["format", "entropy", "imports", "strings", "mitigations"],
    yaraRulesPath: path.join(app.getPath("userData"), "yara-rules"),
    maxFileSize: 100 * 1024 * 1024, // 100 MB
    timeout: 60000, // 60 segundos
    autoAnalyzeOnOpen: false
  },
  
  // Configuración de plugins
  plugins: {
    enabled: true,
    autoLoad: true,
    permissions: {
      default: [],
      whitelist: []
    }
  },
  
  // Configuración de notificaciones
  notifications: {
    enabled: true,
    criticalFindings: true,
    progressUpdates: true,
    sound: false
  },
  
  // Configuración de logging
  logging: {
    level: "info",
    file: path.join(app.getPath("userData"), "logs", "noctua.log"),
    maxSize: 10 * 1024 * 1024, // 10 MB
    maxFiles: 5
  },
  
  // Configuración de backups
  backups: {
    enabled: true,
    interval: 300000, // 5 minutos
    maxBackups: 10,
    directory: path.join(app.getPath("userData"), "backups")
  }
};

const SCHEMA = {
  provider: { type: "string", enum: ["none", "mistral", "ollama"] },
  mistral: {
    type: "object",
    properties: {
      apiKey: { type: "string" },
      model: { type: "string" }
    },
    required: []
  },
  ollama: {
    type: "object",
    properties: {
      url: { type: "string" },
      model: { type: "string" }
    },
    required: []
  },
  debugger: {
    type: "object",
    properties: {
      enabled: { type: "boolean" },
      confirmStart: { type: "boolean" },
      loadUserInit: { type: "boolean" },
      maxSessions: { type: "number", minimum: 1, maximum: 10 }
    },
    required: []
  },
  terminal: {
    type: "object",
    properties: {
      enabled: { type: "boolean" },
      maxSessions: { type: "number", minimum: 1, maximum: 10 },
      shell: { type: "string" },
      fontSize: { type: "number", minimum: 8, maximum: 32 },
      fontFamily: { type: "string" }
    },
    required: []
  },
  ui: {
    type: "object",
    properties: {
      theme: { type: "string", enum: ["dark", "light", "system"] },
      fontSize: { type: "number", minimum: 8, maximum: 32 },
      language: { type: "string" },
      wordWrap: { type: "boolean" },
      minimap: { type: "boolean" },
      renderWhitespace: { type: "string", enum: ["none", "boundary", "all"] },
      bracketMatching: { type: "boolean" },
      autoClosingBrackets: { type: "boolean" },
      autoIndentation: { type: "boolean" }
    },
    required: []
  },
  toolPaths: {
    type: "object",
    additionalProperties: { type: "string" }
  },
  analysis: {
    type: "object",
    properties: {
      defaultDetectors: { type: "array", items: { type: "string" } },
      yaraRulesPath: { type: "string" },
      maxFileSize: { type: "number", minimum: 0 },
      timeout: { type: "number", minimum: 0 },
      autoAnalyzeOnOpen: { type: "boolean" }
    },
    required: []
  },
  plugins: {
    type: "object",
    properties: {
      enabled: { type: "boolean" },
      autoLoad: { type: "boolean" },
      permissions: {
        type: "object",
        properties: {
          default: { type: "array", items: { type: "string" } },
          whitelist: { type: "array", items: { type: "string" } }
        },
        required: []
      }
    },
    required: []
  },
  notifications: {
    type: "object",
    properties: {
      enabled: { type: "boolean" },
      criticalFindings: { type: "boolean" },
      progressUpdates: { type: "boolean" },
      sound: { type: "boolean" }
    },
    required: []
  },
  logging: {
    type: "object",
    properties: {
      level: { type: "string", enum: ["debug", "info", "warn", "error"] },
      file: { type: "string" },
      maxSize: { type: "number", minimum: 0 },
      maxFiles: { type: "number", minimum: 1, maximum: 20 }
    },
    required: []
  },
  backups: {
    type: "object",
    properties: {
      enabled: { type: "boolean" },
      interval: { type: "number", minimum: 0 },
      maxBackups: { type: "number", minimum: 1, maximum: 50 },
      directory: { type: "string" }
    },
    required: []
  }
};

/**
 * Clase Preferences para manejar la configuración de NOCTUA
 */
class Preferences {
  constructor() {
    this.config = { ...DEFAULT_PREFERENCES };
    this.listeners = new Set();
    this.loaded = false;
    this.path = path.join(app.getPath("userData"), "noctua.json");
  }

  /**
   * Cargar preferencias desde el archivo de configuración
   */
  load() {
    try {
      const data = fs.readFileSync(this.path, "utf8");
      const loaded = JSON.parse(data);
      this.config = this.#mergeDeep(this.config, loaded);
      this.loaded = true;
    } catch (err) {
      // Archivo no existe o es inválido, usar valores por defecto
      if (err.code !== "ENOENT") {
        console.warn("[preferences] Error al cargar configuración:", err.message);
      }
      this.#save(); // Crear archivo con valores por defecto
      this.loaded = true;
    }
    return this.config;
  }

  /**
   * Guardar preferencias en el archivo de configuración
   */
  save() {
    this.#save();
    this.#notify();
  }

  /**
   * Obtener una preferencia específica
   * @param {string} key - Clave de la preferencia (usando notación de punto)
   * @param {*} defaultValue - Valor por defecto si no existe
   * @returns {*} Valor de la preferencia
   */
  get(key, defaultValue = undefined) {
    if (!this.loaded) this.load();
    
    if (!key) return this.config;
    
    const keys = key.split(".");
    let current = this.config;
    
    for (const k of keys) {
      if (current && typeof current === "object" && k in current) {
        current = current[k];
      } else {
        return defaultValue;
      }
    }
    
    return current;
  }

  /**
   * Establecer una preferencia específica
   * @param {string} key - Clave de la preferencia (usando notación de punto)
   * @param {*} value - Valor a establecer
   */
  set(key, value) {
    if (!this.loaded) this.load();
    
    const keys = key.split(".");
    let current = this.config;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!current[k] || typeof current[k] !== "object") {
        current[k] = {};
      }
      current = current[k];
    }
    
    current[keys[keys.length - 1]] = value;
    this.#save();
    this.#notify();
  }

  /**
   * Validar una configuración contra el esquema
   * @param {object} config - Configuración a validar
   * @returns {boolean} Verdadero si es válida
   */
  validate(config = this.config) {
    return this.#validate(config, SCHEMA);
  }

  /**
   * Suscribirse a cambios en las preferencias
   * @param {Function} callback - Función a llamar cuando cambien las preferencias
   * @returns {Function} Función para desuscribirse
   */
  onChange(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Obtener todas las preferencias
   */
  getAll() {
    if (!this.loaded) this.load();
    return { ...this.config };
  }

  /**
   * Restablecer preferencias a valores por defecto
   */
  reset() {
    this.config = { ...DEFAULT_PREFERENCES };
    this.#save();
    this.#notify();
  }

  /**
   * Mergar objetos de forma profunda
   */
  #mergeDeep(target, source) {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] && typeof source[key] === "object" && 
          target[key] && typeof target[key] === "object" &&
          !Array.isArray(source[key]) && !Array.isArray(target[key])) {
        result[key] = this.#mergeDeep(target[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }

  /**
   * Guardar configuración en el archivo
   */
  #save() {
    try {
      const dir = path.dirname(this.path);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.path, JSON.stringify(this.config, null, 2), "utf8");
    } catch (err) {
      console.error("[preferences] Error al guardar configuración:", err.message);
    }
  }

  /**
   * Notificar a los suscriptores sobre cambios
   */
  #notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.config);
      } catch (err) {
        console.error("[preferences] Error en listener:", err.message);
      }
    }
  }

  /**
   * Validar un valor contra un esquema
   */
  #validate(value, schema) {
    if (!schema) return true;
    
    if (schema.type === "object") {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
      }
      
      for (const [key, propSchema] of Object.entries(schema.properties || {})) {
        if (key in value && !this.#validate(value[key], propSchema)) {
          return false;
        }
      }
      
      for (const key of schema.required || []) {
        if (!(key in value)) return false;
      }
      
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!(key in (schema.properties || {}))) return false;
        }
      }
      
      return true;
    }
    
    if (schema.type === "array") {
      if (!Array.isArray(value)) return false;
      if (schema.items) {
        return value.every(item => this.#validate(item, schema.items));
      }
      return true;
    }
    
    if (schema.enum && !schema.enum.includes(value)) return false;
    if (schema.type && typeof value !== schema.type) return false;
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
    
    return true;
  }
}

// Singleton
const preferences = new Preferences();

module.exports = { preferences, DEFAULT_PREFERENCES, SCHEMA, Preferences };
