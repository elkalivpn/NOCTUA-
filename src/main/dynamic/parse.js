"use strict";

/**
 * NOCTUA Dynamic Analysis Parsers (v0.4.0, issue #11)
 * 
 * Parsers PUROS y testeables sin Docker:
 * - traza de red (strace) → conexiones { host, port, proto, syscall }
 * - resumen de syscalls con recuento
 * - diff del contenedor → rutas creadas o modificadas
 */

/**
 * Parsear traza de red desde strace
 * @param {string} straceOutput - Salida de strace -e trace=network
 * @returns {Array} Array de conexiones { host, port, proto, syscall }
 */
function parseNetworkTrace(straceOutput) {
  const connections = [];
  const lines = straceOutput.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;

    // Formato: pid syscall(args) = result
    // Usar regex no-greedy para manejar paréntesis en args
    const syscallMatch = line.match(/^(\d+)\s+(\w+)\((.*)\)\s*=\s*([^\s]+)/);
    if (!syscallMatch) continue;

    const [, pid, syscall, args] = syscallMatch;

    // Solo procesar syscalls de red
    if (!["connect", "bind", "sendto", "recvfrom", "accept"].includes(syscall)) {
      continue;
    }

    const connection = parseConnection(args, syscall);
    if (connection) {
      connections.push({
        ...connection,
        syscall,
        pid: parseInt(pid)
      });
    }
  }

  return connections;
}

/**
 * Parsear conexión de red desde argumentos de syscall
 */
function parseConnection(args, syscall) {
  // Formato: connect(sockfd, {sa_family=AF_INET, sin_port=htons(80), sin_addr=inet_addr("93.184.216.34")}, addrlen)
  const ipMatch = args.match(/sin_addr=inet_addr\("([^"]+)"\)|sin_addr={sa_data=([^}]+)}/);
  const portMatch = args.match(/sin_port=htons\((\d+)\)|port=(\d+)/);

  if (!ipMatch || !portMatch) return null;

  const host = ipMatch[1] || ipMatch[2];
  const port = parseInt(portMatch[1] || portMatch[2]);

  if (!host || !port) return null;

  // Determinar protocolo
  let proto = "tcp";
  if (syscall === "sendto" || syscall === "recvfrom") {
    proto = args.includes("SOCK_DGRAM") ? "udp" : "tcp";
  }

  return { host, port, proto };
}

/**
 * Parsear resumen de syscalls
 * @param {string} straceOutput - Salida completa de strace
 * @returns {Object} Objeto con conteo de syscalls { syscall: count }
 */
function parseSyscallSummary(straceOutput) {
  const summary = {};
  const lines = straceOutput.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;

    const syscallMatch = line.match(/^(\d+)\s+(\w+)\s*\(/);
    if (syscallMatch) {
      const syscall = syscallMatch[2];
      summary[syscall] = (summary[syscall] || 0) + 1;
    }
  }

  return summary;
}

/**
 * Parsear diff del contenedor
 * @param {string} diffOutput - Salida de docker diff / podman diff
 * @returns {Array} Array de { path, type, hash? }
 */
function parseContainerDiff(diffOutput) {
  const files = [];
  const lines = diffOutput.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;

    // Formato: C /path/to/file
    // Formato: A /path/to/newfile
    // Formato: D /path/to/deleted
    const changeMatch = line.match(/^(C|A|D)\s+(\S+)/);
    if (changeMatch) {
      const [, type, filePath] = changeMatch;
      files.push({ path: filePath, type });
    }
  }

  return files;
}

/**
 * Parsear lista de ficheros con hashes
 * @param {string} output - Salida con lista de ficheros
 * @returns {Array} Array de { path, hash }
 */
function parseFileHashes(output) {
  const files = [];
  const lines = output.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;

    // Formato: hash  path
    const hashMatch = line.match(/^([a-f0-9]{64})\s+(\S+)/);
    if (hashMatch) {
      files.push({
        path: hashMatch[2],
        hash: hashMatch[1]
      });
    }
  }

  return files;
}

/**
 * Generar hallazgos dinámicos desde evidencia
 * @param {object} evidence - Evidencia recolectada
 * @returns {Array} Array de hallazgos
 */
function generateFindings(evidence) {
  const findings = [];

  // Hallazgos de red
  if (evidence.network && evidence.network.length > 0) {
    for (const conn of evidence.network) {
      findings.push({
        id: "dynamic.network-connection",
        severity: "medium",
        title: `Conexión de red a ${conn.host}:${conn.port}`,
        detail: `Conexión ${conn.proto.toUpperCase()} detectada durante ejecución dinámica`,
        source: "dynamic",
        refs: [`${conn.host}:${conn.port}`, conn.proto]
      });
    }
  }

  // Hallazgos de ficheros
  if (evidence.files && evidence.files.length > 0) {
    for (const file of evidence.files) {
      if (file.type === "C" || file.type === "A") {
        findings.push({
          id: "dynamic.file-write",
          severity: "medium",
          title: `Fichero ${file.type === "C" ? "modificado" : "creado"}: ${file.path}`,
          detail: `Fichero ${file.type === "C" ? "modificado" : "creado"} durante ejecución dinámica`,
          source: "dynamic",
          refs: [file.path, file.hash || "(hash no disponible)"]
        });
      }
    }
  }

  // Hallazgo de resumen de syscalls
  if (evidence.syscalls && Object.keys(evidence.syscalls).length > 0) {
    const syscallList = Object.entries(evidence.syscalls)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => `${name}(${count})`)
      .join(", ");

    findings.push({
      id: "dynamic.syscall-summary",
      severity: "info",
      title: "Resumen de syscalls",
      detail: `Syscalls más frecuentes: ${syscallList}`,
      source: "dynamic",
      refs: Object.keys(evidence.syscalls)
    });
  }

  return findings;
}

module.exports = {
  parseNetworkTrace,
  parseSyscallSummary,
  parseContainerDiff,
  parseFileHashes,
  parseConnection,
  generateFindings
};
