# NOCTUA — IDE de investigación de seguridad

IDE de escritorio para análisis de seguridad autorizada en Kali Linux.
Estado actual: **v0.3.2 — paleta de comandos**: flujo vertical de análisis (v0.2), terminal PTY real, árbol de proyectos, depuración interactiva de binarios nativos con breakpoints en el editor (v0.3.1) y paleta de comandos tipo VS Code (Ctrl+Shift+P): ejecutar acciones de análisis, abrir herramientas externas con whitelist fija y navegar los hallazgos. Con esto, v0.3 queda completado; v0.4 (ingeniería inversa y sandbox de VM) es el siguiente bloque.

## Qué hace hoy (v0.3.2)

- Depuración interactiva de binarios nativos (GDB/MI): arranque bajo gdb con confirmación explícita, breakpoints con un clic en el margen del editor (Monaco), pausar, reanudar, paso a paso, panel con variables locales, backtrace y consola de depuración, relanzamiento del inferior con un clic. Requiere `gdb`. Advertencia honesta: el inferior se ejecuta con sus privilegios de usuario; la vía segura (gdbserver con inferior en VM) es fase 2 del diseño (docs/DESIGN-debugger.md).
- Paleta de comandos tipo VS Code (Ctrl+Shift+P, o botón en la barra): búsqueda difusa insensible a acentos sobre un registro de 29 comandos. Ejecuta detectores sueltos o el análisis completo, abre herramientas externas limitadas a una whitelist fija (file, sha256sum, strings, readelf, rabin2) con la salida en la pestaña SALIDA, navega los hallazgos (siguiente/anterior con resaltado) y cubre acciones de fichero, depuración y vista. Ningún comando pasa texto libre a una shell.
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

- No analiza malware en ejecución: el análisis es solo lectura estática. La terminal PTY ejecuta lo que usted escriba y el depurador ejecuta el binario que usted depure: ambos corren con sus privilegios de usuario, no en una sandbox. La ejecución controlada en VM (gdbserver, análisis dinámico) es fase 2 del diseño del depurador y v0.4 de la hoja de ruta.
- El depurador no ofrece watchpoints, vista de desensamblado, de memoria ni de hilos: fase 2 del diseño (docs/DESIGN-debugger.md).
- La paleta de comandos no es un ejecutor arbitrario: las herramientas externas se limitan a la whitelist fija `PALETTE_TOOLS` del proceso principal (argv sin shell, timeout de 60 s, salida acotada a 50 líneas); ampliarla exige código auditado, no configuración.
- El árbol no muestra todos los directorios de golpe (lazy) ni persiste su estado entre sesiones.
- La terminal es de sesión única; multi-pestaña y aislamiento en utilityProcess están pospuestos (fase 2 del diseño e issue #6).
- No "encuentra 0-days": la contribución realista aquí es **orquestación de fuzzing** (AFL++, boofuzz) con triaje y deduplicación de crashes, planificada en v0.5.
- No es un sustituto de Ghidra, IDA ni Cuckoo: NOCTUA orquesta herramientas maduras, no las reimplementa.

## Arquitectura

Ver `ARCHITECTURE.md` para el modelo de procesos, el modelo de amenazas y el contrato de plugins.

```
src/main.js                 Proceso principal (IPC, análisis, herramientas, depuración)
src/main/analysis/          Orquestador v0.2: contrato zod, detectores puros, worker_threads
src/main/terminal.js         TerminalManager: sesiones PTY con ptyFactory inyectable
src/main/debugger/           Depurador GDB/MI: mi-parser, controller (máquina de estados), manager
src/preload.js              Puente seguro (contextBridge + webUtils)
src/ai-agent.js             Agente IA: API Mistral u Ollama local
src/analyze.js              Análisis estático básico (v0.1, testeable)
src/plugin-loader.js        Cargador de plugins con permisos
renderer/index.html         UI con CSP estricta (sin scripts inline)
renderer/app.js             Lógica del renderer (apertura compartida de ficheros)
renderer/tree.js            Árbol de proyectos (módulo independiente, lazy + drag-and-drop)
renderer/terminal.js        Panel de terminal PTY (xterm.js self-hosted)
renderer/debugger.js        UI de depuración: barra, breakpoints en Monaco, locals/backtrace/consola
renderer/palette.js           Paleta de comandos: registro, búsqueda difusa y overlay (Ctrl+Shift+P)
renderer/styles.css          Estilos
renderer/vendor/            Monaco y xterm self-hosted (generados por npm install; fuera del repo)
scripts/postinstall.js      Vendors + rebuild de node-pty (omitible con NOCTUA_SKIP_REBUILD=1)
scripts/copy-monaco.js      Copia Monaco a renderer/vendor
scripts/copy-xterm.js       Copia xterm.js a renderer/vendor
tests/                      node:test: análisis, plugins, terminal (FakePty), árbol, CSP, debugger (FakeMiProcess), paleta
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
- La depuración requiere `gdb` (ya incluido en la línea de apt install). Los tests no lo necesitan: inyectan un FakeMiProcess con transcripciones de MI, igual que la terminal usa un FakePty.
- La CI de tests usa `NOCTUA_SKIP_REBUILD=1` porque los tests inyectan dobles de los módulos nativos.

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

La depuración se configura en el mismo fichero:

```json
{
  "debugger": { "enabled": true, "confirmStart": true, "loadUserInit": false }
}
```

`confirmStart` (por defecto, true) exige confirmación cada vez que se ejecuta el inferior; `loadUserInit` (por defecto, false) permite cargar el init de gdb del usuario (pwndbg/gef), asumiendo que la salida MI deja de ser determinista.

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
