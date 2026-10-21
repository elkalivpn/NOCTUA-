# NOCTUA — IDE de investigación de seguridad

IDE de escritorio para análisis de seguridad autorizada en Kali Linux. Estado actual: **v0.1, esqueleto funcional** — no es todavía un IDE de uso diario.

## Qué hace hoy (v0.1)

- Editor de código (Monaco) con apertura de ficheros.
- Análisis estático básico de cualquier fichero: tipo (PE/ELF/script/ZIP), entropía de Shannon (indicador de empaquetado/cifrado), SHA-256 y MD5.
- Puentes a herramientas del sistema: rizin (`rz-bin`) y YARA, si están instaladas.
- Agente de IA de código configurable: API de Mistral o modelo local vía Ollama.
- Sistema de plugins con permisos declarativos.

## Qué no hace (honestidad sobre el alcance)

- No analiza malware en ejecución: nada se ejecuta, solo lectura estática.
- No depura en tiempo real todavía: el backend (GDB/MI) está en fase de diseño (v0.3).
- No "encuentra 0-days": la contribution realista aquí es **orquestación de fuzzing** (AFL++, boofuzz) con triaje y deduplicación de crashes, planificada en v0.5.
- No es un sustituto de Ghidra, IDA ni Cuckoo: NOCTUA orquesta herramientas maduras, no las reimplementa.

## Arquitectura

Ver `ARCHITECTURE.md` para el modelo de procesos, el modelo de amenazas y el contrato de plugins.

```
src/main.js          Proceso principal (IPC, análisis, herramientas)
src/preload.js       Puente seguro (contextBridge)
src/ai-agent.js      Agente IA: API Mistral u Ollama local
src/analyze.js       Análisis estático básico (testeable)
src/plugin-loader.js Cargador de plugins con permisos
renderer/index.html  UI: Monaco, panel del agente, terminal
```

## Instalación en Kali Linux

```bash
sudo apt update
sudo apt install -y rizin yara gdb
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
git clone https://github.com/elkalivpn/NOCTUA-.git
cd NOCTUA-
npm install
npm start        # ejecutar
npm test         # tests unitarios
```

## Agente IA

Cree `~/.config/noctua/noctua.json`:

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
