# Arquitectura de NOCTUA

## Modelo de procesos

```
+---------------------------------------------------------------+
| Proceso principal (Node.js, confianza total)                  |
|  - IPC handlers: fs, ai, tools, analyze, plugins               |
|  - AIAgent (Mistral API / Ollama local)                        |
|  - PluginLoader (permisos por manifest)                        |
|  - runAnalysis(): contrato zod, detectores, worker_threads     |
|  - runTool(): spawn de rizin, yara, gdb... (timeout 60 s)      |
+------------------------------+--------------------------------+
                               | IPC (invoke/handle, contextIsolation)
+------------------------------+--------------------------------+
| Renderer (Chromium, sandbox: true, sin Node)                   |
|  - Monaco editor (self-host en renderer/vendor, sin CDN)      |
|  - UI: index.html + app.js + styles.css (CSP estricta)        |
|  - Acceso exclusivo vía window.noctua (contextBridge)          |
+---------------------------------------------------------------+
```

Principios:

1. El renderer nunca ve Node.js: `nodeIntegration: false`, `sandbox: true`, `contextIsolation: true`.
2. Todo privilegio cruza por IPC handlers explícitos; cada handler es auditable de forma aislada.
3. Las herramientas externas (rizin, YARA, GDB) se ejecutan con `spawn` y timeout; nunca se evalúa shell.
4. Los ficheros binarios del usuario se analizan en el proceso principal; el renderer solo recibe resultados, nunca bytes sin control.
5. El renderer no carga recursos remotos: la CSP solo permite `'self'` (más `blob:` para los workers de Monaco) y prohíbe los scripts inline; Monaco se sirve desde `renderer/vendor`, generado por postinstall.

## CSP del renderer (v0.2.1)

`default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'`

- `script-src` no incluye `'unsafe-inline'`: todo el JS del renderer vive en `renderer/app.js`; ningún script remoto es cargable.
- `blob:` en `script-src`/`worker-src` existe exclusivamente para el proxy de web workers de Monaco (`MonacoEnvironment.getWorkerUrl` genera un blob que importa `workerMain.js` local). Si el worker se bloquea, el editor degrada a tokenización en el hilo principal.
- `style-src` mantiene `'unsafe-inline'` porque Monaco fija estilos inline en el DOM: es la única relajación de la política y está documentada.
- El renderer no hace peticiones de red: `connect-src 'self'`; el tráfico del agente IA sale del proceso principal, no del renderer.

## Modelo de amenazas y mitigaciones

| Amenaza | Mitigación actual | Trabajo pendiente |
|---|---|---|
| Renderer comprometido (XSS en un informe, markdown malicioso) | Sandbox de Chromium, sin Node, API reducida; CSP estricta sin scripts inline ni remotos; salida del agente escapada antes de innerHTML | Eliminar `style-src 'unsafe-inline'` si Monaco lo permite |
| Plugin malicioso (RCE por diseño) | Permisos declarativos por manifest, denegados por defecto; fallo de permiso = plugin descartado | Aislar plugins en utilityProcess (issue #6) |
| Binario analizado ejecuta código | Solo análisis estático: lectura de bytes, hashes, entropía. Nada se ejecuta | Sandbox de VM dedicada antes de cualquier análisis dinámico (v0.4) |
| Exfiltración de muestras a la nube | Proveedor Ollama local configurable; Mistral solo recibe el JSON de triaje que el usuario envía al agente | Etiquetado de datos sensibles antes de llamar a la API |
| Inyección de comandos en runTool | Argumentos como array (sin shell), timeout fijo | Lista de herramientas permitidas por config |
| Token de API filtrado | noctua.json fuera del repo (.gitignore), nunca se loguea | Keychain del SO (electron safeStorage) |
| Dependencia de un CDN comprometido | Monaco se sirve desde renderer/vendor (self-host, postinstall); la CSP bloquea cualquier script remoto | — |

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
- No existe análisis dinámico: ninguna muestra se ejecuta. La ejecución controlada requiere una VM dedicada y está pospuesta a v0.4 a propósito.
- La depuración en tiempo real (v0.3) exige un documento de diseño del backend (GDB/MI vs rz-pipe) antes de escribir código (issue #2).
