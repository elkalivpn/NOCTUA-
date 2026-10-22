# NOCTUA — IDE de investigación de seguridad

IDE de escritorio para análisis de seguridad autorizada en Kali Linux.
Estado actual: **v0.3.0 — inicio de v0.3 (workspace)**: flujo vertical de análisis (v0.2), terminal PTY real y árbol de proyectos. La depuración interactiva está diseñada (docs/DESIGN-debugger.md) pero aún no implementada.

## Qué hace hoy (v0.3.0)

- Árbol de proyectos: explorador del workspace con carga diferida por carpeta (lazy), iconos por tipo de fichero, click que abre en el editor y drag-and-drop en ambos sentidos (del árbol al editor y del sistema al árbol).
- Terminal integrada real (PTY): node-pty + xterm.js self-hosted, shell del usuario, sesión única en esta fase. Degradación elegante: si node-pty no compila, la aplicación arranca igual con la terminal deshabilitada y aviso visible.
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
- CSP estricta en el renderer: sin scripts inline ni remotos.
- Sistema de plugins con permisos declarativos, denegados por defecto.
- Agente IA configurable: API de Mistral o modelo local vía Ollama.

## Qué no hace (honestidad sobre el alcance)

- No analiza malware en ejecución: nada se ejecuta, solo lectura estática. La terminal PTY ejecuta lo que usted escriba: es una shell real con sus privilegios, no una sandbox.
- No depura en tiempo real todavía: el diseño está publicado en `docs/DESIGN-debugger.md` (GDB/MI) y es el siguiente gran bloque de v0.3.
- El árbol no muestra todos los directorios de golpe (lazy) ni persiste su estado entre sesiones.
- La terminal es de sesión única; multi-pestaña y aislamiento en utilityProcess están pospuestos (fase 2 del diseño e issue #6).
- No "encuentra 0-days": la contribution realista aquí es **orquestación de fuzzing** (AFL++, boofuzz) con triaje y deduplicación de crashes, planificada en v0.5.
- No es un sustituto de Ghidra, IDA ni Cuckoo: NOCTUA orquesta herramientas maduras, no las reimplementa.

## Arquitectura

Ver `ARCHITECTURE.md` para el modelo de procesos, el modelo de amenazas y el contrato de plugins.

```
src/main.js                 Proceso principal (IPC, análisis, herramientas)
src/main/analysis/          Orquestador v0.2: contrato zod, detectores puros, worker_threads
src/main/terminal.js         TerminalManager: sesiones PTY con ptyFactory inyectable
src/preload.js              Puente seguro (contextBridge + webUtils)
src/ai-agent.js             Agente IA: API Mistral u Ollama local
src/analyze.js              Análisis estático básico (v0.1, testeable)
src/plugin-loader.js        Cargador de plugins con permisos
renderer/index.html         UI con CSP estricta (sin scripts inline)
renderer/app.js             Lógica del renderer (apertura compartida de ficheros)
renderer/tree.js            Árbol de proyectos (módulo independiente, lazy + drag-and-drop)
renderer/terminal.js        Panel de terminal PTY (xterm.js self-hosted)
renderer/styles.css          Estilos
renderer/vendor/            Monaco y xterm self-hosted (generados por npm install; fuera del repo)
scripts/postinstall.js      Vendors + rebuild de node-pty (omitible con NOCTUA_SKIP_REBUILD=1)
scripts/copy-monaco.js      Copia Monaco a renderer/vendor
scripts/copy-xterm.js       Copia xterm.js a renderer/vendor
tests/                      node:test: análisis, plugins, terminal (FakePty), árbol, CSP
```

## Instalación en Kali Linux

```bash
sudo apt update
sudo apt install -y rizin radare2 yara gdb build-essential python3
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
git clone https://github.com/elkalivpn/NOCTUA-.git
cd NOCTUA-
npm install      # dependencias + vendors locales (Monaco, xterm) + rebuild de node-pty para Electron
npm start        # ejecutar
npm test         # tests unitarios (nunca cargan módulos nativos)
```

Notas de red y compilación:

- `npm install` descarga dependencias una única vez; la aplicación no carga ningún recurso remoto (CSP: `'self'`). Solo el proveedor de IA genera tráfico, y con Ollama local nada sale de la máquina.
- La terminal real requiere que node-pty compile para Electron: `npm install` lo intenta automáticamente. Si falla, la instalación continúa (dependencia opcional) y la aplicación arranca con la terminal deshabilitada y un aviso. Instale `build-essential` y `python3` y ejecute `npm run rebuild`.
- La CI de tests usa `NOCTUA_SKIP_REBUILD=1` porque los tests inyectan un FakePty.

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
