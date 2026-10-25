# NOCTUA — IDE de investigación de seguridad

IDE de escritorio para análisis de seguridad autorizada en Kali Linux.
Estado actual: **v0.3.6 — plugins aislados, strings contextuales y panel de hallazgos mejorado**: flujo vertical de análisis (v0.2), terminal PTY real, árbol de proyectos, depuración interactiva de binarios nativos con breakpoints en el editor (v0.3.1), paleta de comandos tipo VS Code (Ctrl+Shift+P) (v0.3.2) y plugins que se ejecutan cada uno en su propio utilityProcess con permisos validados en ambos extremos (v0.3.3) y hardening del sandboxing: validación de origen y estructura del manifest y permisos explícitos aplicados también en el renderer (v0.3.4), y panel de hallazgos mejorado: filtros multiselección, contexto hex alrededor del offset, salto al editor y exportación de informes JSON/Markdown (v0.3.6). Con esto, v0.3 queda completado; v0.4 (ingeniería inversa y sandbox de VM) es el siguiente bloque.

## Qué hace hoy (v0.3.6)

- Depuración interactiva de binarios nativos (GDB/MI): arranque bajo gdb con confirmación explícita, breakpoints con un clic en el margen del editor (Monaco), pausar, reanudar, paso a paso, panel con variables locales, backtrace y consola de depuración, relanzamiento del inferior con un clic. Requiere `gdb`. Advertencia honesta: el inferior se ejecuta con sus privilegios de usuario; la vía segura (gdbserver con inferior en VM) es fase 2 del diseño (docs/DESIGN-debugger.md).
- Paleta de comandos tipo VS Code (Ctrl+Shift+P, o botón en la barra): búsqueda difusa insensible a acentos sobre un registro de 31 comandos. Ejecuta detectores sueltos o el análisis completo, abre herramientas externas limitadas a una whitelist fija (file, sha256sum, strings, readelf, rabin2) con la salida en la pestaña SALIDA, navega los hallazgos (siguiente/anterior con resaltado) y cubre acciones de fichero, depuración y vista. Ningún comando pasa texto libre a una shell.
- Árbol de proyectos: explorador del workspace con carga diferida por carpeta (lazy), iconos por tipo de fichero, click que abre en el editor y drag-and-drop en ambos sentidos (del árbol al editor y del sistema al árbol).
- Terminal integrada real (PTY): node-pty + xterm.js self-hosted, shell del usuario, sesión única en esta fase. Degradación elegante: si node-pty no compila, la aplicación arranca igual con la terminal deshabilitada y aviso visible.
- Editor de código (Monaco 0.52 servido en local desde `renderer/vendor`, sin CDN).
- Análisis estático con contrato de hallazgos JSON validado (zod):
  - formato PE/ELF/script/ZIP, secciones PE, hashes SHA-256/MD5;
  - entropía global y por sección (umbral 7.5 → indicador de packer/cifrado);
  - imports categorizados por taxonomía: injection, keylogging, persistence, anti-debug, network, crypto (requiere rabin2);
  - strings contextuales (v0.3.5): URLs, IPs y cadenas sospechosas en ASCII y UTF-16LE, JSON embebido validado con JSON.parse, XML embebido (heurístico), blobs base64 decodificados y bloques de contexto con offsets (dónde se concentran las cadenas);
  - reglas YARA (hallazgo high solo con firma explícita);
  - mitigaciones: ASLR/DEP/CFG en PE, canary en ELF.
- Detectores pesados en `worker_threads` con progreso por etapas: la UI no se bloquea.
- Panel de hallazgos (v0.3.6): agrupados por severidad con chips de filtro multiselección (severidad, con recuento por severidad, y fuente), contador N/M de hallazgos visibles, búsqueda unificada en título, detalle y referencias, SHA-256 copiable y badge de riesgo agregado. Cada hallazgo con offset permite ver su contexto con @0x (volcado hex de 256 bytes alrededor, IPC fs:hexWindow), saltar en el editor a la línea del offset (locateOffset) y exportar informes JSON/Markdown del análisis completo (findings:export). Advertencia honesta: los offsets son crudos del fichero, no direcciones virtuales, y locateOffset es aproximado en ficheros UTF-8 multibyte.
- Triaje del agente IA: recibe solo el JSON del análisis y responde en JSON estructurado (riesgo, resumen, comportamiento probable, siguientes pasos, IOC, unknowns). Sin firma YARA explícita no se atribuyen familias.
- CSP estricta en el renderer: sin scripts inline ni remotos.
- Sistema de plugins con permisos declarativos, denegados por defecto; cada plugin se ejecuta en su propio utilityProcess (v0.3.3): si muere o se compromete, el proceso principal sobrevive y sus mensajes se validan contra el manifest, no contra lo que el hijo declare; el manifest se valida de origen y estructura (id estricto, directorio nombrado como el id, main relativo, origin declarado) y los comandos del plugin aparecen en la paleta solo si está habilitado y declara commands (v0.3.4).
- Agente IA configurable: API de Mistral o modelo local vía Ollama.

## Qué no hace (honestidad sobre el alcance)

- No analiza malware en ejecución: el análisis es solo lectura estática. La terminal PTY ejecuta lo que usted escriba y el depurador ejecuta el binario que usted depure: ambos corren con sus privilegios de usuario, no en una sandbox. La ejecución controlada en VM (gdbserver, análisis dinámico) es fase 2 del diseño del depurador y v0.4 de la hoja de ruta.
- El depurador no ofrece watchpoints, vista de desensamblado, de memoria ni de hilos: fase 2 del diseño (docs/DESIGN-debugger.md).
- La paleta de comandos no es un ejecutor arbitrario: las herramientas externas se limitan a la whitelist fija `PALETTE_TOOLS` del proceso principal (argv sin shell, timeout de 60 s, salida acotada a 50 líneas); ampliarla exige código auditado, no configuración.
- El árbol no muestra todos los directorios de golpe (lazy) ni persiste su estado entre sesiones.
- La terminal es de sesión única; multi-pestaña y aislamiento por utilityProcess siguen pospuestos (fase 2 del diseño de la terminal; el issue #6 de plugins quedó resuelto en v0.3.3).
- El worker de un plugin ejecuta Node completo: el aislamiento protege el proceso principal (un plugin defectuoso o malicioso no lo arrastra), pero no restringe lo que el propio proceso del plugin hace con los permisos concedidos. Conceda `fs` y `tools` solo a plugins auditados.
- No "encuentra 0-days": la contribución realista aquí es **orquestación de fuzzing** (AFL++, boofuzz) con triaje y deduplicación de crashes, planificada en v0.5.
- No es un sustituto de Ghidra, IDA ni Cuckoo: NOCTUA orquesta herramientas maduras, no las reimplementa.

## Arquitectura

Ver `ARCHITECTURE.md` para el modelo de procesos, el modelo de amenazas y el contrato de plugins.

```
src/main.js                 Proceso principal (IPC, análisis, herramientas, depuración)
src/main/analysis/          Orquestador v0.2: contrato zod, detectores puros, worker_threads
src/main/terminal.js         TerminalManager: sesiones PTY con ptyFactory inyectable
src/main/debugger/           Depurador GDB/MI: mi-parser, controller (máquina de estados), manager
src/main/hexdump.js          Volcado hex: filas de 16 bytes y ventana acotada alrededor de un offset (v0.3.6)
src/main/report.js            Informes de análisis JSON y Markdown con whitelist de formatos (v0.3.6)
src/preload.js              Puente seguro (contextBridge + webUtils)
src/ai-agent.js             Agente IA: API Mistral u Ollama local
src/analyze.js              Análisis estático básico (v0.1, testeable)
src/plugin-loader.js        Cargador de plugins: fork de utilityProcess y validación de permisos en ambos extremos
src/utility/plugin-worker.js  Worker de plugins: ctx restringido y RPC de capacidades (uno por plugin)
renderer/index.html         UI con CSP estricta (sin scripts inline)
renderer/app.js             Lógica del renderer (apertura compartida de ficheros)
renderer/tree.js            Árbol de proyectos (módulo independiente, lazy + drag-and-drop)
renderer/terminal.js        Panel de terminal PTY (xterm.js self-hosted)
renderer/debugger.js        UI de depuración: barra, breakpoints en Monaco, locals/backtrace/consola
renderer/palette.js           Paleta de comandos: registro, búsqueda difusa y overlay (Ctrl+Shift+P)
renderer/findings.js       Filtros del panel de hallazgos: funciones puras testeables (v0.3.6)
renderer/styles.css          Estilos
renderer/vendor/            Monaco y xterm self-hosted (generados por npm install; fuera del repo)
scripts/postinstall.js      Vendors + rebuild de node-pty (omitible con NOCTUA_SKIP_REBUILD=1)
scripts/copy-monaco.js      Copia Monaco a renderer/vendor
scripts/copy-xterm.js       Copia xterm.js a renderer/vendor
tests/                      node:test: análisis, plugins, terminal (FakePty), árbol, CSP, debugger (FakeMiProcess), paleta, aislamiento de plugins (fork en bucle), strings contextuales, filtros del panel de hallazgos (v0.3.6)
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

Los permisos (`events`, `commands`, `fs`, `tools`, `ai`) son denegados por defecto; un plugin que excede su declaración falla al cargar. Desde v0.3.3 cada plugin corre en su propio utilityProcess: las capacidades `fs`/`tools`/`ai` se invocan de forma asíncrona por RPC y solo responden si el proceso principal las concedió con `grant()`.

El manifest se valida de forma estricta (issue #12): `id` con patrón `[a-z0-9][a-z0-9-]{0,63}`, directorio nombrado exactamente como el `id`, `main` como ruta relativa dentro del directorio y `origin` opcional (URL del repositorio) visible en la UI. Los comandos de plugins se exponen en la paleta solo si el plugin está habilitado y declara `commands`; el proceso principal re-valida cada invocación.

## Contribuir

Ver `CONTRIBUTING.md`. Los issues etiquetados `good first issue` son puntos de entrada recomendados.

## Aviso legal

NOCTUA es una herramienta para investigación de seguridad autorizada, CTF y análisis defensivo. Úsela únicamente sobre sistemas para los que posea permiso explícito. Los autores no se responsabilizan del uso indebido.

## Licencia

MIT — ver `LICENSE`.
