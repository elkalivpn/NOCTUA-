# Arquitectura de NOCTUA

## Modelo de procesos

```
+---------------------------------------------------------------+
| Proceso principal (Node.js, confianza total)                  |
|  - IPC handlers: fs, ai, tools, analyze, plugins               |
|  - AIAgent (Mistral API / Ollama local)                        |
|  - PluginLoader (permisos por manifest)                        |
|  - runTool(): spawn de rizin, yara, gdb... (timeout 60 s)      |
+------------------------------+--------------------------------+
                               | IPC (invoke/handle, contextIsolation)
+------------------------------+--------------------------------+
| Renderer (Chromium, sandbox: true, sin Node)                   |
|  - Monaco editor                                              |
|  - UI (index.html)                                            |
|  - Acceso exclusivo vía window.noctua (contextBridge)          |
+---------------------------------------------------------------+
```

Principios:

1. El renderer nunca ve Node.js: `nodeIntegration: false`, `sandbox: true`, `contextIsolation: true`.
2. Todo privilegio cruza por IPC handlers explícitos; cada handler es auditable de forma aislada.
3. Las herramientas externas (rizin, YARA, GDB) se ejecutan con `spawn` y timeout; nunca se evalúa shell.
4. Los ficheros binarios del usuario se analizan en proceso principal; el renderer solo recibe resultados, nunca bytes sin control.

## Modelo de amenazas y mitigaciones

| Amenaza | Mitigación actual | Trabajo pendiente |
|---|---|---|
| Renderer comprometido (XSS en un informe, markdown malicioso) | Sandbox de Chromium, sin Node, API reducida | CSP estricta en renderer |
| Plugin malicioso (RCE por diseño) | Permisos declarativos por manifest, denegados por defecto; fallo de permiso = plugin descartado | Aislar plugins en utilityProcess (fuera de roadmap v0.x) |
| Binario analizado ejecuta código | Solo análisis estático: lectura de bytes, hashes, entropía. Nada se ejecuta | Sandbox de VM dedicada antes de cualquier análisis dinámico (v0.4) |
| Exfiltración de muestras a la nube | Proveedor Ollama local configurable; Mistral solo recibe texto que el usuario envía al agente | Etiquetado de datos sensibles antes de llamar a la API |
| Inyección de comandos en runTool | Argumentos como array (sin shell), timeout fijo | Lista de herramientas permitidas por config |
| Token de API filtrado | noctua.json fuera del repo (.gitignore), nunca se loguea | Keychain del SO (electron safeStorage) |

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

- Los plugins se ejecutan hoy en el proceso principal: el modelo de permisos limita la superficie, pero el aislamiento real (utilityProcess) es un objetivo posterior.
- No existe análisis dinámico: ninguna muestra se ejecuta. La ejecución controlada requiere una VM dedicada y está pospuesta a v0.4 a propósito.
- La depuración en tiempo real (v0.3) exige un documento de diseño del backend (GDB/MI vs rz-pipe) antes de escribir código; ver issues.
