# Arquitectura de NOCTUA

## Modelo de procesos

```
+---------------------------------------------------------------+
| Proceso principal (Node.js, confianza total)                  |
|  - IPC handlers: fs, ai, tools, analyze, plugins, terminal    |
|  - AIAgent (Mistral API / Ollama local)                        |
|  - PluginLoader (fork utilityProcess por plugin, permisos)                        |
|  - runAnalysis(): contrato zod, detectores, worker_threads     |
|  - TerminalManager (PTYs, maxSessions, coalescing 16KiB/16ms)  |
|  - DebuggerManager (GDB/MI: sesiones, watchdog 10 s, coalesc.) |
|  - runTool(): spawn de rizin, yara, gdb... (timeout 60 s)      |
+------------------------------+--------------------------------+
                               | MessagePorts: un utilityProcess por plugin
+------------------------------+--------------------------------+
| utilityProcess (Node.js, uno por plugin)                      |
|  - plugin-worker.js: ctx restringido, permisos re-validados   |
|  - capacidades fs/tools/ai solo por RPC (call/callres)       |
|  - grant() explícito del proceso principal + timeout          |
+------------------------------+--------------------------------+
                               | IPC (invoke/send/event, contextIsolation)
+------------------------------+--------------------------------+
| Renderer (Chromium, sandbox: true, sin Node)                   |
|  - Monaco editor (self-host en renderer/vendor, sin CDN)      |
|  - Árbol de proyectos (tree.js: lazy + drag-and-drop)         |
|  - Panel de terminal PTY (xterm.js self-hosted)               |
|  - Depuración (debugger.js: barra, breakpoints, backtrace)    |
|  - Paleta de comandos (palette.js: registro, búsqueda difusa, overlay) |
|  - UI: index.html + app.js + tree.js + palette.js + terminal.js + styles  |
|  - Acceso exclusivo vía window.noctua (contextBridge)          |
+---------------------------------------------------------------+
```

Principios:

1. El renderer nunca ve Node.js: `nodeIntegration: false`, `sandbox: true`, `contextIsolation: true`.
2. Todo privilegio cruza por IPC handlers explícitos; cada handler es auditable de forma aislada.
3. Las herramientas externas (rizin, YARA, GDB) se ejecutan con `spawn` y timeout; nunca se evalúa shell.
4. Los ficheros binarios del usuario se analizan en el proceso principal; el renderer solo recibe resultados, nunca bytes sin control.
5. El renderer no carga recursos remotos: la CSP solo permite `'self'` (más `blob:` para los workers de Monaco) y prohíbe los scripts inline; Monaco y xterm se sirven desde `renderer/vendor`, generado por postinstall.
6. La terminal solo escribe en la PTY que el usuario abrió: no existe canal de "ejecutar comando" ni API programática de ejecución.

## CSP del renderer (v0.2.1)

`default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'`

- `script-src` no incluye `'unsafe-inline'`: todo el JS del renderer vive en ficheros locales (`app.js`, `tree.js`, `terminal.js`, `debugger.js`, `palette.js`); ningún script remoto es cargable.
- `blob:` en `script-src`/`worker-src` existe exclusivamente para el proxy de web workers de Monaco.
- `style-src` mantiene `'unsafe-inline'` porque Monaco y xterm fijan estilos inline en el DOM: es la única relajación de la política.
- El renderer no hace peticiones de red: `connect-src 'self'`.

## Árbol de proyectos (v0.3.0)

- `renderer/tree.js`: módulo independiente. Carga diferida por carpeta mediante el IPC `fs:readDir` ya existente (no amplía la superficie de lectura: el renderer ya podía listar directorios).
- Ficheros arrastrados desde el sistema operativo: las rutas se resuelven con `webUtils.getPathForFile` en el preload, la vía sancionada por Electron en renderers con sandbox (`File.path` no existe allí).
- Iconos por tipo generados en local (glifos con clases CSS), sin fuentes de iconos remotos.
- Utilidades puras (`iconFor`, `sortEntries`, `languageFor`, `joinPath`) exportadas para `node:test`: la lógica de ordenación y mapeo es testeable sin Electron.

## Terminal (issue #3, diseño docs/DESIGN-terminal.md)

- `src/main/terminal.js`: TerminalManager con `ptyFactory` inyectada; solo `src/main.js` conoce node-pty. Coalescing de salida (16 KiB / 16 ms), límite de sesiones, `killAll()` en `window-all-closed` y `will-quit`.
- Degradación elegante: node-pty es `optionalDependency`; si no compila, `require` falla en la fábrica, `terminal:create` devuelve un error claro y la aplicación funciona con la terminal deshabilitada y aviso visible. `npm run rebuild` la reactiva.

## Depurador (issue #2, diseño docs/DESIGN-debugger.md, v0.3.1)

- `src/main/debugger/mi-parser.js`: parser puro de la gramática GDB/MI (línea → registro tipado, correlación por token); toda cadena con contenido del usuario se serializa con el escapado MI (R5), nunca por concatenación cruda.
- `src/main/debugger/controller.js`: máquina de estados por sesión (idle → launching → running → stopped → exited → closed, más launching → exited para un inferior que muere antes del primer ^running). Transiciones no declaradas se ignoran y se loguean. Watchdog de 10 s por token: el comando sin respuesta se rechaza con TIMEOUT y la sesión queda recuperable; la UI nunca se bloquea (R1).
- `src/main/debugger/manager.js`: registro de sesiones con `miProcessFactory` inyectada; solo `src/main.js` conoce el spawn real de gdb (`--interpreter=mi2 --quiet [-nx] binario`, argv array sin shell). `killAll()` en `window-all-closed` y `will-quit`.
- Coalescing de stream records (16 KiB / 16 ms por sesión) hacia la consola de depuración.
- `-nx` por defecto; `debugger.loadUserInit` opt-in en noctua.json. Confirmación de ejecución (R6) configurable con `debugger.confirmStart` (por defecto, true) y habilitación global con `debugger.enabled`.
- UI (`renderer/debugger.js`): barra de depuración, breakpoints con clic en el margen de Monaco (decoración dbg-bp), línea actual resaltada (dbg-current-line), panel con variables locales, backtrace y consola; renderizado función pura del estado de la sesión (R3).

## Paleta de comandos (v0.3.2)

- `renderer/palette.js`: dos capas separadas. Utilidades puras (`normalizeText`, `fuzzyScore`, `filterCommands`, `createRegistry`) exportadas para `node:test`; el overlay DOM (Ctrl+Shift+P, flechas, Enter, Esc) vive en un IIFE que solo se activa en el navegador, igual que el resto de módulos del renderer.
- Búsqueda difusa por subsecuencia, insensible a acentos y mayúsculas, sin dependencias externas; los comandos se agrupan por categoría.
- Los comandos no añaden privilegios: cada uno invoca APIs ya existentes del renderer (ficheros, análisis, depuración, navegación de hallazgos) o el nuevo IPC `tool:run`.
- `tool:run` (proceso principal) solo acepta una whitelist fija (`PALETTE_TOOLS`: file, sha256sum, strings -n 8, readelf -h, rabin2 -I, rabin2 -i); argv como array sin shell, timeout de 60 s, salida acotada a 50 líneas en la pestaña SALIDA. Ampliar la whitelist exige modificar código auditado; no es configurable desde el renderer.
- Subselección de detectores: `analyze:run` acepta una lista `detectors` validada contra `ALL_DETECTORS` (`src/main/analysis/index.js`), con el mismo gating y el mismo contrato de hallazgos que el análisis completo.

## Análisis de strings contextual (v0.3.5, issue #15)

- src/main/analysis/detectors/strings.js: extractor contextual. Dos pasadas de extracción (ASCII >= 5 imprimibles; UTF-16LE en ambas alineaciones); URLs, IPs y sospechosas se computan sobre la unión de ambas.
- Bloques de contexto: agrupación por proximidad (hueco >= 64 bytes); el hallazgo strings.blocks (severidad info) señala los offsets del bloque más denso. Límite honesto: sin desensamblado, un bloque denso puede ser .rdata, una tabla de errores del compilador o una configuración real; es un indicador de región, no evidencia.
- Estructuras embebidas: JSON validado con JSON.parse (balanceo con manejo de cadenas y escapes; severidad medium), XML heurístico (etiqueta raíz balanceada o prólogo; severidad low, marcado como heurístico) y base64 (decodificador interno sin Buffer; se exigen >= 24 bytes y >= 85% imprimible; severidad low).
- Contrato: hallazgos con FindingSchema existente y fuente strings; strings.utf16 y strings.embedded amplían el objeto strings del contrato (schema.js). El renderer no cambia: el panel ya agrupa por severidad (incluida info) y filtra por fuente.
- Mismo detector puro ejecutado en worker_threads: sin nueva superficie de IPC ni de procesos.

## Modelo de amenazas y mitigaciones

| Amenaza | Mitigación actual | Trabajo pendiente |
|---|---|---|
| Renderer comprometido (XSS en un informe, markdown malicioso) | Sandbox de Chromium, sin Node, API reducida; CSP estricta sin scripts inline ni remotos; salida del agente escapada antes de innerHTML | Eliminar `style-src 'unsafe-inline'` si Monaco lo permite |
| Terminal usada como canal de ejecución desde el renderer | Sesiones creadas por acción explícita del usuario, maxSessions configurable, sin canal de "ejecutar comando": solo escritura en la PTY abierta; teardown garantizado | utilityProcess en fase 2 (issue #6) |
| node-pty no compila en el equipo del usuario | optionalDependency + require en try/catch: la app arranca con terminal deshabilitada y aviso; npm run rebuild documentado | CI de smoke con PTY real (opcional) |
| Plugin malicioso (RCE por diseño) | Permisos declarativos por manifest, validados en ambos extremos; cada plugin en su propio utilityProcess (v0.3.3): un hijo comprometido no escala permisos ni arrastra al proceso principal; validación de origen y estructura del manifest y permisos aplicados también en el renderer (v0.3.4): la paleta solo expone comandos de plugins habilitados con permiso commands y el proceso principal re-valida cada invocación | API de grant más fina por plugin |
| Binario analizado ejecuta código | El análisis es estático: lectura de bytes, hashes, entropía; nada se ejecuta. La única ejecución es la depuración, que exige confirmación explícita (R6) | Sandbox de VM dedicada antes de cualquier análisis dinámico (v0.4) |
| Inferior depurado se ejecuta con los privilegios del analista | Confirmación explícita por sesión (`debugger.confirmStart`, por defecto true), `debugger.enabled` en noctua.json, gdb con `-nx` por defecto, escapado MI (R5), spawn sin shell | gdbserver con inferior en VM (fase 2 del diseño del depurador) |
| Exfiltración de muestras a la nube | Proveedor Ollama local configurable; Mistral solo recibe el JSON de triaje que el usuario envía al agente | Etiquetado de datos sensibles antes de llamar a la API |
| Inyección de comandos en runTool / tool:run | Argumentos como array (sin shell), timeout fijo; tool:run restringido a la whitelist fija PALETTE_TOOLS, ids fuera de lista rechazados | Lista de herramientas permitidas por config |
| Token de API filtrado | noctua.json fuera del repo (.gitignore), nunca se loguea | Keychain del SO (electron safeStorage) |
| Dependencia de un CDN comprometido | Monaco y xterm self-hosted desde renderer/vendor; la CSP bloquea cualquier script remoto | — |

## Contrato de plugins (noctua.plugin.v1)

`manifest.json`:

```json
{
  "id": "mi-plugin",
  "name": "Mi Plugin",
  "version": "1.0.0",
  "main": "main.js",
  "permissions": ["events", "commands"]
}
```

Permisos: `events`, `commands`, `fs`, `tools`, `ai`. Denegados por defecto; un plugin que excede su declaración falla al cargar.

Desde v0.3.3 (issue #6) el aislamiento es real:

- Cada plugin se ejecuta en su propio `utilityProcess` (`src/utility/plugin-worker.js`); el loader (`src/plugin-loader.js`) nunca carga código del plugin en el proceso principal.
- Protocolo plano de mensajería: `init`/`ready` (handshake con timeout), `cmd`/`res` (comandos con CALL_TIMEOUT), `sub`/`emit`/`evt` (eventos), `call`/`callres` (capacidades), `dispose`/`bye` (apagado).
- Defensa en profundidad: los permisos se comprueban en el loader antes de forkear, dentro del worker antes de cada operación y de nuevo en el loader para cada mensaje que regresa del hijo. Un proceso hijo comprometido que mienta sobre sus permisos no escala (tests/plugin-isolation.test.js).
- Las capacidades `fs`/`tools`/`ai` no se inyectan como objetos: el ctx expone proxies asíncronos y cada método viaja como RPC; solo responden si el proceso principal concedió la capacidad con `grant(id, cap, api)`.
- `ctx.bus` se eliminó del contrato: los eventos cruzan el perímetro como mensajes validados.
- La muerte inesperada de un utilityProcess emite `plugin:crashed` y bloquea sus comandos con `PROCESO_PLUGIN_MUERTO`; el proceso principal sobrevive.
- Apagado ordenado: `killAll()` (dispose + kill) en `window-all-closed` y `will-quit`.
- `utilityProcess.fork` exige una ruta real del sistema de ficheros: `src/utility/**` se desempaqueta del asar (`asarUnpack` en package.json).

Límite honesto: el utilityProcess ejecuta Node completo. El aislamiento protege el proceso principal (fallo, cuelgue o compromiso del plugin no lo afectan), pero no restringe lo que el propio proceso del plugin hace dentro de sus permisos concedidos; conceda `fs`/`tools` solo a plugins auditados.

Validación de origen y estructura (v0.3.4, issue #12):

- manifest.id debe cumplir el patrón [a-z0-9][a-z0-9-]{0,63}; el directorio del plugin debe llamarse exactamente como su id (lo declarado coincide con lo instalado) y los ids duplicados se rechazan.
- manifest.main debe ser una ruta relativa terminada en .js, sin componentes de escape: el punto de entrada no puede salir del directorio del plugin.
- manifest.origin (opcional) es la URL declarada del repositorio del plugin y queda visible en la lista de plugins; sin origen declarado, la UI lo etiqueta como local.
- Permisos en el renderer (dos capas): la paleta solo registra comandos de plugins habilitados que declaran commands; cada invocación pasa por el IPC plugins:runCommand, re-validado en el proceso principal (permiso, estado, proceso vivo y timeout). El renderer nunca construye affordances para capacidades no concedidas y reacciona a plugin:toggled para refrescar la superficie disponible.

## Límites de diseño conocidos

- Los plugins se ejecutan aislados en utilityProcess (v0.3.3), pero el worker corre Node completo: el aislamiento protege el proceso principal, no restringe lo que el propio plugin puede hacer con sus permisos. Conceda fs/tools solo a plugins auditados. El desempaquetado asar del worker está configurado, pero el AppImage no se ha probado en Electron real todavía.
- La PTY ejecuta con los privilegios del usuario: es una shell real, sin sandboxing. El aislamiento por utilityProcess y perfiles es la fase 2 del diseño de la terminal.
- El árbol de proyectos no persiste su estado (raíces, expansiones) entre sesiones y carga los hijos por carperta al expandir, nunca de golpe.
- No existe análisis dinámico: ninguna muestra se ejecuta desde el análisis. La ejecución controlada requiere una VM dedicada y está pospuesta a v0.4 a propósito.
- La depuración (v0.3.1) ejecuta el inferior con los privilegios del usuario tras confirmación explícita: la vía segura (gdbserver con inferior en VM) sigue siendo fase 2 del diseño. No hay watchpoints, desensamblado, vista de memoria ni hilos.
- La paleta de comandos (v0.3.2) no es un ejecutor arbitrario: la whitelist de herramientas externas es fija en el proceso principal y su salida se acota (50 líneas); no existen comandos configurables por el usuario sin tocar código auditado.
