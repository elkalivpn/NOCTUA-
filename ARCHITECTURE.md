# Arquitectura de NOCTUA

## Modelo de procesos

```
+---------------------------------------------------------------+
| Proceso principal (Node.js, confianza total)                  |
|  - IPC handlers: fs, ai, tools, analyze, plugins, terminal    |
|  - AIAgent (Mistral API / Ollama local)                        |
|  - PluginLoader (permisos por manifest)                        |
|  - runAnalysis(): contrato zod, detectores, worker_threads     |
|  - TerminalManager (PTYs, maxSessions, coalescing 16KiB/16ms)  |
|  - runTool(): spawn de rizin, yara, gdb... (timeout 60 s)      |
+------------------------------+--------------------------------+
                               | IPC (invoke/send/event, contextIsolation)
+------------------------------+--------------------------------+
| Renderer (Chromium, sandbox: true, sin Node)                   |
|  - Monaco editor (self-host en renderer/vendor, sin CDN)      |
|  - Panel de terminal PTY (xterm.js self-hosted)               |
|  - UI: index.html + app.js + terminal.js + styles.css (CSP)   |
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

- `script-src` no incluye `'unsafe-inline'`: todo el JS del renderer vive en ficheros locales (`app.js`, `terminal.js`); ningún script remoto es cargable.
- `blob:` en `script-src`/`worker-src` existe exclusivamente para el proxy de web workers de Monaco.
- `style-src` mantiene `'unsafe-inline'` porque Monaco y xterm fijan estilos inline en el DOM: es la única relajación de la política.
- El renderer no hace peticiones de red: `connect-src 'self'`.

## Terminal (issue #3, diseño docs/DESIGN-terminal.md)

- `src/main/terminal.js`: TerminalManager con `ptyFactory` inyectada; solo `src/main.js` conoce node-pty. Coalescing de salida (16 KiB / 16 ms), límite de sesiones, `killAll()` en `window-all-closed` y `will-quit`.
- Degradación elegante: node-pty es `optionalDependency`; si no compila, `require` falla en la fábrica, `terminal:create` devuelve un error claro y la aplicación funciona con la terminal deshabilitada y aviso visible. `npm run rebuild` la reactiva.

## Modelo de amenazas y mitigaciones

| Amenaza | Mitigación actual | Trabajo pendiente |
|---|---|---|
| Renderer comprometido (XSS en un informe, markdown malicioso) | Sandbox de Chromium, sin Node, API reducida; CSP estricta sin scripts inline ni remotos; salida del agente escapada antes de innerHTML | Eliminar `style-src 'unsafe-inline'` si Monaco lo permite |
| Terminal usada como canal de ejecución desde el renderer | Sesiones creadas por acción explícita del usuario, maxSessions configurable, sin canal de "ejecutar comando": solo escritura en la PTY abierta; teardown garantizado | utilityProcess en fase 2 (issue #6) |
| node-pty no compila en el equipo del usuario | optionalDependency + require en try/catch: la app arranca con terminal deshabilitada y aviso; npm run rebuild documentado | CI de smoke con PTY real (opcional) |
| Plugin malicioso (RCE por diseño) | Permisos declarativos por manifest, denegados por defecto; fallo de permiso = plugin descartado | Aislar plugins en utilityProcess (issue #6) |
| Binario analizado ejecuta código | Solo análisis estático: lectura de bytes, hashes, entropía. Nada se ejecuta | Sandbox de VM dedicada antes de cualquier análisis dinámico (v0.4) |
| Exfiltración de muestras a la nube | Proveedor Ollama local configurable; Mistral solo recibe el JSON de triaje que el usuario envía al agente | Etiquetado de datos sensibles antes de llamar a la API |
| Inyección de comandos en runTool | Argumentos como array (sin shell), timeout fijo | Lista de herramientas permitidas por config |
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

Permisos: `events`, `commands`, `fs`, `tools`, `ai`. Denegados por defecto; el cargador lanza error si el plugin usa una capacidad no declarada y lo descarta sin afectar al resto.

## Límites de diseño conocidos

- Los plugins se ejecutan hoy en el proceso principal: el modelo de permisos limita la superficie, pero el aislamiento real (utilityProcess) es el issue #6.
- La PTY ejecuta con los privilegios del usuario: es una shell real, sin sandboxing. El aislamiento por utilityProcess y perfiles es la fase 2 del diseño de la terminal.
- No existe análisis dinámico: ninguna muestra se ejecuta. La ejecución controlada requiere una VM dedicada y está pospuesta a v0.4 a propósito.
- La depuración en tiempo real (v0.3) sigue el diseño de `docs/DESIGN-debugger.md` (GDB/MI); su implementación aún no ha comenzado.
