# Diseño — Terminal integrada (issue #3)

Estado: propuesta en revisión. Sin código de terminal todavía: este documento es requisito previo, con el mismo criterio que el issue #2 impone al debugger.

## 1. Objetivo

Sustituir la terminal simulada (solo lectura, mensajes de la app) por una terminal real interactiva en el panel inferior: PTY completa con TTY real, shell del usuario, redimensionado y salida en streaming.

## 2. Requisitos

- R1 Interactividad completa: readline, colores ANSI, programas de pantalla completa (vim, gdb -tui, nmap con barra de progreso).
- R2 TTY real: los programas deben ver `isatty() == true`; nada de pipes sin terminal.
- R3 La UI no se bloquea: streaming de salida por eventos, sin polling.
- R4 Sin CDN: xterm.js self-hosted, mismo criterio que Monaco (issue #5).
- R5 Testeable en CI sin módulos nativos: `npm test` nunca carga node-pty.
- R6 Teardown garantizado: ninguna PTY viva al cerrar la ventana o la aplicación.
- R7 Degradable: si node-pty no carga, NOCTUA arranca igual con la terminal deshabilitada y aviso visible.

## 3. Alternativas consideradas

| Opción | Veredicto | Motivo |
|---|---|---|
| `child_process.spawn` con pipes | Descartada | Sin TTY: `isatty()` falso, readline y colores rotos, vim/gdb inutilizables. |
| node-pty en el proceso principal | Elegida (fase 1) | TTY real, API mínima, madurez probada (VS Code usa node-pty en producción). |
| node-pty en `utilityProcess` | Pospuesta (fase 2) | Aislamiento superior y coherente con el issue #6, pero duplica la superficie de IPC. La fase 1 se diseña con inyección de dependencias para que la migración no rompa el contrato IPC. |

## 4. Arquitectura

```
+---------------------------------------------+
| Renderer (sandbox, sin Node)                |
|  xterm.js (vendor local) + FitAddon         |
|   teclas -> api.terminal.write(id, data)    |
|   api.terminal.onData -> term.write(chunk)  |
+--------------------+------------------------+
                     | IPC (invoke / send / event)
+--------------------v------------------------+
| Proceso principal                           |
|  TerminalManager                            |
|   - ptyFactory: require("node-pty")        |
|   - sesiones: id, shell, coalescing         |
|   - maxSessions, killAll() en cierre       |
+--------------------+------------------------+
                     | PTY (TTY real)
                     v
              $SHELL del usuario
```

Módulo `src/main/terminal.js`:

```js
class TerminalManager {
  constructor({ ptyFactory, maxSessions, onOutput, onExit }) {}
  create({ cols, rows, cwd, shell }) {} // -> { id }
  write(id, data) {}
  resize(id, cols, rows) {}
  kill(id) {}        // -> emite exit
  killAll() {}       // teardown en window-all-closed y will-quit
}
```

Decisiones:

- Inyección de dependencias: solo la fábrica real conoce node-pty. Los tests inyectan un `FakePty` (requisito R5).
- Shell: `process.env.SHELL || "/bin/bash"`; override vía `noctua.json` (`terminal.shell`).
- Cwd inicial: directorio home; override `terminal.cwd`.
- Env: heredado del proceso principal, sin filtrado adicional. Documentado en el modelo de amenazas.
- Coalescing de salida: acumular bytes por sesión y hacer flush cada 16 ms o al superar 16 KiB; `cat` de un binario grande no genera miles de eventos IPC.

## 5. Contrato IPC

| Canal | Dirección | Mecanismo | Payload | Respuesta |
|---|---|---|---|---|
| `terminal:create` | R → M | invoke | `{ cols, rows, cwd? }` | `{ id }` o error |
| `terminal:write` | R → M | send | `{ id, data }` | — (send, no invoke: latencia de teclas) |
| `terminal:resize` | R → M | send | `{ id, cols, rows }` | — |
| `terminal:kill` | R → M | invoke | `{ id }` | `{ ok }` |
| `terminal:data` | M → R | event | `{ id, data }` | — |
| `terminal:exit` | M → R | event | `{ id, exitCode, signal }` | — |

Superficie en preload (`contextBridge`, sin exponer `ipcRenderer`):

```js
terminal: {
  create: (opts) => ipcRenderer.invoke("terminal:create", opts),
  write: (id, data) => ipcRenderer.send("terminal:write", { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send("terminal:resize", { id, cols, rows }),
  kill: (id) => ipcRenderer.invoke("terminal:kill", { id }),
  onData: (cb) => ipcRenderer.on("terminal:data", (_e, m) => cb(m)),
  onExit: (cb) => ipcRenderer.on("terminal:exit", (_e, m) => cb(m))
}
```

Nota de diseño: no existe un canal "ejecutar comando". La única vía es escribir en la PTY que el usuario abrió explícitamente: la terminal no añade una API de ejecución programática.

## 6. Frontend (xterm.js self-hosted)

- Dependencias (devDependencies, igual que monaco-editor): `@xterm/xterm@^5.5.0`, `@xterm/addon-fit@^0.10.0`.
- `scripts/postinstall.js` (reestructurado) ejecuta `copy-monaco.js` y el nuevo `copy-xterm.js`, que copia `xterm.js`, `xterm.css` y `addon-fit.js` a `renderer/vendor/xterm` (en .gitignore).
- `renderer/terminal.js`: instancia xterm con tema NOCTUA (`#0b0e14`), FitAddon, `term.onData -> api.terminal.write`, `api.terminal.onData -> term.write`, y ResizeObserver hacia `terminal:resize`.
- UI: botón "+ Terminal" junto a las pestañas inferiores. La pestaña actual de logs pasa a llamarse SALIDA y conserva los mensajes de análisis; la PTY ocupa la pestaña nueva. Una única sesión en fase 1.
- CSP: sin cambios; xterm se sirve de `renderer/vendor` (`script-src 'self'` ya lo permite) y su CSS se enlaza con `<link>` (`style-src 'self'`).

## 7. Módulo nativo: node-pty

- `node-pty@^1.0.0` en `dependencies` (es runtime real).
- El ABI de Node y Electron difieren: el binario `.node` debe compilarse contra los headers de Electron 33 con `@electron/rebuild` (devDependency).
- Scripts:
  - `"postinstall": "node scripts/postinstall.js"`: copia los vendors y, salvo `NOCTUA_SKIP_REBUILD=1`, ejecuta `electron-rebuild -f -o node-pty`.
  - La CI de tests exporta `NOCTUA_SKIP_REBUILD=1`: los tests usan FakePty y no cargan node-pty (R5), así la CI no paga el toolchain.
  - `npm run rebuild` documentado para recompilar tras actualizar Electron.
- Requisito del sistema documentado en README: `build-essential` y `python3` (Kali/Debian).
- Empaquetado (electron-builder): `"asarUnpack": ["**/node_modules/node-pty/**"]` para que el binario sea cargable desde el asar.
- Degradación (R7): `require("node-pty")` dentro de try/catch en la fábrica real; si falla, `terminal:create` devuelve error y la UI muestra "Terminal no disponible: ejecute npm run rebuild".

## 8. Modelo de amenazas (adiciones)

| Amenaza | Mitigación |
|---|---|
| Renderer comprometido usa la terminal como canal de ejecución | Es el propósito declarado del módulo; se acota: maxSessions (3, configurable), sesiones creadas por acción explícita del usuario, y sin API de "ejecutar comando": solo escritura en la PTY abierta |
| Flood de IPC (salida masiva) | Coalescing 16 KiB / 16 ms por sesión |
| PTY huérfanas al cerrar | `killAll()` en `window-all-closed` y `will-quit` |
| Compilación nativa rota tras actualizar Electron | `npm run rebuild` documentado + degradación visible (R7) |
| Exfiltración de historial | No se persiste nada en disco: scrollback solo en memoria del renderer |

Fase 2 (alineada con el issue #6): migrar TerminalManager a `utilityProcess` con handshake por sesión; el contrato IPC de esta fase se conserva intacto.

## 9. Plan de pruebas

- `tests/terminal.test.js` con FakePty inyectado: create devuelve ids incrementales; maxSessions rechaza la cuarta sesión; write/resize llegan al FakePty; el coalescing agrupa escrituras; kill emite exit y libera hueco; killAll cierra todo.
- `tests/renderer-csp.test.js` ampliado: xterm servido desde renderer/vendor, sin CDN.
- Fuera de alcance: e2e con PTY real en CI (coste alto, beneficio bajo en esta fase).

## 10. Orden de implementación

1. `scripts/postinstall.js` + `copy-xterm.js` + dependencias (@xterm, node-pty, @electron/rebuild).
2. `src/main/terminal.js` + `tests/terminal.test.js` con FakePty (TDD: los tests se escriben antes que la implementación).
3. IPC en `src/main.js` y preload.
4. `renderer/terminal.js` + botón de UI + renombrado de la pestaña a SALIDA.
5. Config de build (asarUnpack), README, ARCHITECTURE, ROADMAP.

## 11. Decisiones abiertas para el revisor

1. ¿Una sesión única en fase 1 (propuesta) o multi-pestaña desde el inicio?
2. ¿Rebuild de node-pty dentro de postinstall con `NOCTUA_SKIP_REBUILD` (propuesta) o comando manual explícito?
3. ¿Persistir scrollback o cwd entre sesiones? Propuesta: no (privacidad y simplicidad).
