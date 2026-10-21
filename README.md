# NOCTUA — IDE de investigación de seguridad

IDE de escritorio para análisis de seguridad autorizada en Kali Linux.
Estado actual: **v0.2 — flujo vertical de análisis completo** — abrir un fichero, ejecutar el análisis estático, revisar los hallazgos en el panel y pedir al agente IA que los explique. No es todavía un IDE de uso diario.

## Qué hace hoy (v0.2)

- Editor de código (Monaco 0.52 servido en local desde `renderer/vendor`, sin CDN).
- Análisis estático con contrato de hallazgos JSON validado (zod):
  - formato PE/ELF/script/ZIP, secciones PE, hashes SHA-256/MD5;
  - entropía global y por sección (umbral 7.5 → indicador de packer/cifrado);
  - imports categorizados por taxonomía: injection, keylogging, persistence, anti-debug, network, crypto (requiere rabin2);
  - strings: URLs, IPs y cadenas sospechosas;
  - reglas YARA (hallazgo high solo con firma explícita);
  - mitigaciones: ASLR/DEP/CFG en PE, canary en ELF.
- Detectores pesados en `worker_threads` con progreso por etapas: la UI no se bloquea.
- Panel de hallazgos: agrupados por severidad, filtro por fuente, búsqueda, SHA-256 copiable y badge de riesgo agregado.
- Triaje del agente IA: recibe solo el JSON del análisis y responde en JSON estructurado (riesgo, resumen, comportamiento probable, siguientes pasos, IOC, unknowns). Sin firma YARA explícita no se atribuyen familias.
- CSP estricta en el renderer: sin scripts inline ni remotos (issue #4 cerrado).
- Sistema de plugins con permisos declarativos, denegados por defecto.
- Agente IA configurable: API de Mistral o modelo local vía Ollama.

## Qué no hace (honestidad sobre el alcance)

- No analiza malware en ejecución: nada se ejecuta, solo lectura estática.
- No depura en tiempo real todavía: el backend (GDB/MI) está en fase de diseño (v0.3).
- La terminal integrada real (node-pty) está pendiente (issue #3); la actual es de solo lectura.
- No "encuentra 0-days": la contribution realista aquí es **orquestación de fuzzing** (AFL++, boofuzz) con triaje y deduplicación de crashes, planificada en v0.5.
- No es un sustituto de Ghidra, IDA ni Cuckoo: NOCTUA orquesta herramientas maduras, no las reimplementa.

## Arquitectura

Ver `ARCHITECTURE.md` para el modelo de procesos, el modelo de amenazas y el contrato de plugins.

```
src/main.js                 Proceso principal (IPC, análisis, herramientas)
src/preload.js              Puente seguro (contextBridge)
src/ai-agent.js             Agente IA: API Mistral u Ollama local
src/analyze.js              Análisis estático básico (v0.1, testeable)
src/main/analysis/          Orquestador v0.2: contrato zod, detectores puros, worker_threads
src/plugin-loader.js         Cargador de plugins con permisos
renderer/index.html         UI con CSP estricta (sin scripts inline)
renderer/app.js             Lógica del renderer (fichero local)
renderer/styles.css          Estilos
renderer/vendor/monaco/     Monaco self-hosted (generado por npm install; fuera del repo)
scripts/copy-monaco.js      Copia Monaco de node_modules a renderer/vendor (postinstall)
tests/                      node:test: análisis, plugins, CSP del renderer
```

## Instalación en Kali Linux

```bash
sudo apt update
sudo apt install -y rizin radare2 yara gdb
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
git clone https://github.com/elkalivpn/NOCTUA-.git
cd NOCTUA-
npm install      # instala dependencias y copia Monaco a renderer/vendor (postinstall)
npm start        # ejecutar
npm test         # tests unitarios
```

Nota de red: `npm install` descarga dependencias una única vez; a partir de ahí la aplicación no carga ningún recurso remoto (CSP: `'self'`). Solo el proveedor de IA genera tráfico, y con Ollama local nada sale de la máquina.

## Agente IA

Cree ```/.config/noctua/noctua.json```:

```json
{
  "provider": "mistral",
  "mistral": { "apiKey": "SU_API_KEY", "model": "mistral-large-latest" },
  "ollama": { "url": "http://127.0.0.1:11434", "model": "qwen2.5-coder:32b" }
}
```

En entornos sin conectividad o con muestras sensibles, use el proveedor Ollama local: nada sale de la máquina.

## Plugins

```json
{ "id": "mi-plugin", "name": "Mi Plugin", "version": "1.0.0", "main": "main.js", "permissions": ["events", "commands"] }
```

```js
module.exports.register = (ctx) => {
  ctx.registerCommand("mi-comando", () => console.log("hola"));
};
```

Los permisos (`events`, `commands`, `fs`, `tools`, `ai`) son denegados por defecto; un plugin que excede su declaración se descarta al cargar.

## Contribuir

Ver `CONTRIBUTING.md`. Los issues etiquetados `good first issue` son puntos de entrada recomendados.

## Aviso legal

NOCTUA es una herramienta para investigación de seguridad autorizada, CTF y análisis defensivo. Úsela únicamente sobre sistemas para los que posea permiso explícito. Los autores no se responsabilizan del uso indebido.

## Licencia

MIT — ver `LICENSE`.
