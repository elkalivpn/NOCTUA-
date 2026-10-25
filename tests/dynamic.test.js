"use strict";

/**
 * Tests para Análisis Dinámico (v0.4.0, issue #11)
 * 
 * Tests de parsers y orquestador con FakeContainerRunner
 */

const test = require("node:test");
const assert = require("node:assert");

const { 
  parseNetworkTrace, 
  parseSyscallSummary, 
  parseContainerDiff,
  parseConnection,
  generateFindings 
} = require("../src/main/dynamic/parse");

const { 
  ContainerRunner, 
  FakeContainerRunner, 
  DYNAMIC_ERRORS 
} = require("../src/main/dynamic/runner");

const { 
  DynamicAnalyzer, 
  FakeDynamicAnalyzer 
} = require("../src/main/dynamic/index");

// Fixture: traza de strace de red
const STACE_NETWORK_TRACE = `
1234 connect(3, {sa_family=AF_INET, sin_port=htons(80), sin_addr=inet_addr("93.184.216.34")}, 16) = 0
1234 connect(3, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("185.23.4.11")}, 16) = 0
1234 sendto(3, "GET / HTTP/1.1\\r\\n", 16, 0, {sa_family=AF_INET, sin_port=htons(80), sin_addr=inet_addr("93.184.216.34")}, 16) = 16
1235 accept(4, {sa_family=AF_INET, sin_port=htons(8080), sin_addr=inet_addr("0.0.0.0")}, [16]) = 5
`;

// Fixture: traza de strace completa
const STACE_FULL_TRACE = `
1234 open("/etc/passwd", O_RDONLY) = 3
1234 read(3, "root:x:0:0...", 4096) = 4096
1234 close(3) = 0
1234 connect(3, {sa_family=AF_INET, sin_port=htons(80), sin_addr=inet_addr("93.184.216.34")}, 16) = 0
1234 write(1, "Hello", 5) = 5
1234 write(1, "World", 5) = 5
1234 open("/tmp/output.txt", O_WRONLY|O_CREAT, 0644) = 4
1234 write(4, "test", 4) = 4
1234 connect(3, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("185.23.4.11")}, 16) = 0
`;

// Fixture: diff del contenedor
const CONTAINER_DIFF = `
C /tmp/config.ini
A /tmp/output.txt
D /tmp/tempfile.tmp
`;

test("parseNetworkTrace: detecta conexiones de red", () => {
  const connections = parseNetworkTrace(STACE_NETWORK_TRACE);
  
  assert.strictEqual(connections.length, 4, "Debe detectar 4 conexiones");
  
  const firstConn = connections[0];
  assert.strictEqual(firstConn.host, "93.184.216.34", "Debe parsear IP correctamente");
  assert.strictEqual(firstConn.port, 80, "Debe parsear puerto correctamente");
  assert.strictEqual(firstConn.proto, "tcp", "Debe parsear protocolo correctamente");
  assert.strictEqual(firstConn.syscall, "connect", "Debe incluir syscall");
  
  // Verificar que detecta todos los tipos de syscalls de red
  const syscalls = connections.map(c => c.syscall);
  assert.ok(syscalls.includes("connect"), "Debe incluir connect");
  assert.ok(syscalls.includes("sendto"), "Debe incluir sendto");
  assert.ok(syscalls.includes("accept"), "Debe incluir accept");
});

test("parseSyscallSummary: cuenta syscalls", () => {
  const summary = parseSyscallSummary(STACE_FULL_TRACE);
  
  assert.ok(summary.open !== undefined, "Debe contar open");
  assert.ok(summary.read !== undefined, "Debe contar read");
  assert.ok(summary.close !== undefined, "Debe contar close");
  assert.ok(summary.write !== undefined, "Debe contar write");
  assert.ok(summary.connect !== undefined, "Debe contar connect");
  
  assert.strictEqual(summary.open, 2, "Debe contar 2 llamadas a open");
  assert.strictEqual(summary.write, 3, "Debe contar 3 llamadas a write");
  assert.strictEqual(summary.connect, 2, "Debe contar 2 llamadas a connect");
});

test("parseContainerDiff: detecta cambios en ficheros", () => {
  const files = parseContainerDiff(CONTAINER_DIFF);
  
  assert.strictEqual(files.length, 3, "Debe detectar 3 cambios");
  
  const modified = files.find(f => f.type === "C");
  assert.ok(modified, "Debe encontrar fichero modificado");
  assert.strictEqual(modified.path, "/tmp/config.ini", "Debe parsear path correctamente");
  
  const added = files.find(f => f.type === "A");
  assert.ok(added, "Debe encontrar fichero añadido");
  assert.strictEqual(added.path, "/tmp/output.txt", "Debe parsear path correctamente");
  
  const deleted = files.find(f => f.type === "D");
  assert.ok(deleted, "Debe encontrar fichero eliminado");
  assert.strictEqual(deleted.path, "/tmp/tempfile.tmp", "Debe parsear path correctamente");
});

test("parseConnection: parsea conexión individual", () => {
  const args = "3, {sa_family=AF_INET, sin_port=htons(80), sin_addr=inet_addr(\"93.184.216.34\")}, 16";
  const conn = parseConnection(args, "connect");
  
  assert.ok(conn, "Debe parsear conexión");
  assert.strictEqual(conn.host, "93.184.216.34", "Debe parsear IP");
  assert.strictEqual(conn.port, 80, "Debe parsear puerto");
  assert.strictEqual(conn.proto, "tcp", "Debe parsear protocolo");
});

test("parseConnection: devuelve null para formato inválido", () => {
  const conn = parseConnection("invalid args", "connect");
  assert.strictEqual(conn, null, "Debe devolver null para formato inválido");
});

test("generateFindings: genera hallazgos de red", () => {
  const evidence = {
    network: [
      { host: "93.184.216.34", port: 80, proto: "tcp" },
      { host: "185.23.4.11", port: 443, proto: "tcp" }
    ],
    syscalls: {},
    files: []
  };
  
  const findings = generateFindings(evidence);
  
  assert.strictEqual(findings.length, 2, "Debe generar 2 hallazgos de red");
  
  const firstFinding = findings[0];
  assert.strictEqual(firstFinding.id, "dynamic.network-connection", "Debe ser hallazgo de conexión de red");
  assert.strictEqual(firstFinding.severity, "medium", "Debe tener severidad medium");
  assert.strictEqual(firstFinding.source, "dynamic", "Debe tener fuente dynamic");
});

test("generateFindings: genera hallazgos de ficheros", () => {
  const evidence = {
    network: [],
    syscalls: {},
    files: [
      { path: "/tmp/output.txt", type: "C" },
      { path: "/tmp/newfile.txt", type: "A" },
      { path: "/tmp/oldfile.txt", type: "D" }
    ]
  };
  
  const findings = generateFindings(evidence);
  
  const fileFindings = findings.filter(f => f.id === "dynamic.file-write");
  assert.strictEqual(fileFindings.length, 2, "Debe generar 2 hallazgos de ficheros (C y A)");
  
  // Verificar que D no genera hallazgo
  const deleteFindings = findings.filter(f => f.id === "dynamic.file-write" && f.title.includes("eliminado"));
  assert.strictEqual(deleteFindings.length, 0, "No debe generar hallazgo para ficheros eliminados");
});

test("generateFindings: genera hallazgo de resumen de syscalls", () => {
  const evidence = {
    network: [],
    syscalls: {
      connect: 5,
      open: 10,
      write: 15,
      read: 20
    },
    files: []
  };
  
  const findings = generateFindings(evidence);
  
  const summaryFinding = findings.find(f => f.id === "dynamic.syscall-summary");
  assert.ok(summaryFinding, "Debe generar hallazgo de resumen");
  assert.strictEqual(summaryFinding.severity, "info", "Debe tener severidad info");
  assert.ok(summaryFinding.detail.includes("read"), "Debe mencionar syscall más frecuente");
});

test("FakeContainerRunner: simula ejecución exitosa", async () => {
  const runner = new FakeContainerRunner();
  
  assert.ok(runner.isAvailable(), "Debe estar disponible");
  
  const result = await runner.run("/tmp/test.exe");
  
  assert.ok(result.success !== false, "Debe simular ejecución exitosa");
  assert.ok(result.network, "Debe devolver datos de red");
  assert.ok(result.syscalls, "Debe devolver datos de syscalls");
  assert.ok(result.files, "Debe devolver datos de ficheros");
});

test("FakeContainerRunner: simula error cuando no está disponible", async () => {
  const runner = new FakeContainerRunner();
  runner.setAvailable(false);
  
  assert.ok(!runner.isAvailable(), "No debe estar disponible");
  
  await assert.rejects(async () => {
    await runner.run("/tmp/test.exe");
  }, /RUNTIME_NOT_FOUND/);
});

test("FakeDynamicAnalyzer: simula análisis dinámico", async () => {
  const analyzer = new FakeDynamicAnalyzer({ enabled: true, confirmExecution: false });
  
  assert.ok(analyzer.isAvailable(), "Debe estar disponible");
  
  const result = await analyzer.run("/tmp/test.exe", { confirmed: true });
  
  assert.ok(result.success, "Debe simular análisis exitoso");
  assert.ok(result.findings, "Debe devolver hallazgos");
  assert.ok(result.findings.length > 0, "Debe devolver al menos un hallazgo");
  assert.strictEqual(result.findings[0].source, "dynamic", "Hallazgos deben tener fuente dynamic");
});

test("FakeDynamicAnalyzer: rechaza cuando no está habilitado", async () => {
  const analyzer = new FakeDynamicAnalyzer({ enabled: false });
  
  assert.ok(!analyzer.isAvailable(), "No debe estar disponible");
  
  await assert.rejects(async () => {
    await analyzer.run("/tmp/test.exe");
  }, /DYNAMIC_DISABLED/);
});

test("FakeDynamicAnalyzer: rechaza sin confirmación", async () => {
  const analyzer = new FakeDynamicAnalyzer({ enabled: true, confirmExecution: true });
  
  assert.ok(analyzer.isAvailable(), "Debe estar disponible");
  
  await assert.rejects(async () => {
    await analyzer.run("/tmp/test.exe");
  }, /DYNAMIC_CONFIRMATION_REQUIRED/);
});

test("FakeDynamicAnalyzer: acepta con confirmación", async () => {
  const analyzer = new FakeDynamicAnalyzer({ enabled: true, confirmExecution: true });
  
  const result = await analyzer.run("/tmp/test.exe", { confirmed: true });
  
  assert.ok(result.success, "Debe aceptar con confirmación");
});

test("DynamicAnalyzer: actualiza configuración", () => {
  const analyzer = new FakeDynamicAnalyzer({ enabled: false });
  
  assert.ok(!analyzer.isAvailable(), "No debe estar disponible inicialmente");
  
  analyzer.updateConfig({ enabled: true, confirmExecution: false });
  
  assert.ok(analyzer.isAvailable(), "Debe estar disponible después de actualizar");
});

test("DYNAMIC_ERRORS: constantes definidas", () => {
  assert.ok(DYNAMIC_ERRORS.UNAVAILABLE, "Debe tener error UNAVAILABLE");
  assert.ok(DYNAMIC_ERRORS.DISABLED, "Debe tener error DISABLED");
  assert.ok(DYNAMIC_ERRORS.TIMEOUT, "Debe tener error TIMEOUT");
  assert.ok(DYNAMIC_ERRORS.CONTAINER_FAILED, "Debe tener error CONTAINER_FAILED");
  assert.ok(DYNAMIC_ERRORS.CLEANUP_FAILED, "Debe tener error CLEANUP_FAILED");
  assert.ok(DYNAMIC_ERRORS.RUNTIME_NOT_FOUND, "Debe tener error RUNTIME_NOT_FOUND");
});
