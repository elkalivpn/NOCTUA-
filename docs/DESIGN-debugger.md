# Diseño — Debugger integrado (issue #2)

Estado: propuesta en revisión, previa a cualquier código. Este documento es el requisito que el propio issue #2 impone.

## 1. Objetivo y alcance

Depuración interactiva de binarios nativos (ELF en Kali como objetivo primario) desde NOCTUA: arrancar bajo debugger, breakpoints visibles en Monaco, pausar, reanudar, paso a paso e inspección mínima del marco actual.

Fuera de alcance de la fase 1: depuración remota (gdbserver en VM), watchpoints, vista de desensamblado y de memoria, hilos. Están en la fase 2 y se listan al final.

## 2. Requisitos

- R1 La UI jamás se congela: ninguna operación de depuración bloquea el hilo del renderer ni espera de forma síncrona a que el inferior termine.
- R2 Eventos asíncronos de primera clase: un breakpoint alcanzado o una señal recibida deben llegar a la UI aunque nadie haya preguntado.
- R3 Estados explícitos: la UI es función pura del estado de la sesión (máquina de estados observable); nada de inferencias por consola.
- R4 Testeable sin gdb: los tests inyectan un FakeMiProcess con transcripciones de MI; la CI no instala gdb.
- R5 Sin superficies de inyección: gdb se lanza con argv array y sin shell; las cadenas con datos del usuario se escapan según la gramática MI.
- R6 Advertencia de ejecución: iniciar una sesión ejecuta el inferior con los privilegios del usuario; exige confirmación explícita y configurable.
- R7 Degradable y auditable: sin símbolos de depuración, el marco sin fichero/línea se muestra por dirección; nunca se adivina.

## 3. Protocolo: GDB/MI frente a rzpipe

| Criterio | GDB/MI (--interpreter=mi2) | rzpipe (rizin) |
|---|---|---|
| Modelo de eventos | Asíncrono real: registros exec (*stopped, *running) y notificaciones (=breakpoint-modified, =thread-group-exited) llegan sin que nadie pregunte | Petición/respuesta: el transport es request-response; el punto de parada no genera un evento push, exige sondeo |
| Madurez en depuración | Referencia del sector; es la base de MIEngine y de los adapters de VS Code | Modo debug de rizin útil para reversing, menos probado en escenarios multihilo y de excepciones |
| Depuración remota | gdbserver: mismo protocolo, inferior en VM (encaja con v0.4) | No equivalente estable |
| Ecosistema Kali | pwndbg/gef/peda son capa de gdb (aunque orientadas a CLI) | El propio rizin ya integrado en NOCTUA como motor de análisis |
| Coste de parseo | Gramática declarada y estable; verbosidad media | Salida de comandos textual, cambios entre versiones |
| Encaje con v0.2 | Ninguna dependencia nueva: gdb ya es requisito documentado del README | rizin ya está integrado para análisis estático |

Decisión: GDB/MI como protocolo de integración de la fase 1. rzpipe queda como consumidor de análisis (ya lo es hoy para imports) y como vía futura para el fallback de desensamblado, no como transporte de depuración: su ausencia de eventos push obligaría a sondeo, lo que contradice R2 y complica R1. Alternativa descartada de plano: spawn con pipes sin debugger (sin introspección).

## 4. Protocolo de integración: GDB/MI

Lanzamiento: `gdb --interpreter=mi2 --nx --quiet ./binary` (con argv array). Cada comando MI lleva un token numérico; la respuesta lleva el mismo token.

Gramática que NOCTUA parsea (una línea por registro):

- Result records: `token^done`, `token^running`, `token^error,code="..",msg=".."` — correlación comando/respuesta por token.
- Exec async records: `*running,thread-id="all"` y `*stopped,reason="breakpoint-hit",bkptno="1",frame={addr="0x..",func="main",args=[],file="main.c",fullname="/ruta/main.c",line="10"}` — eventos push del inferior; otros motivos: `signal-received`, `end-stepping-range`, `exited-normally`.
- Notify async records: `=breakpoint-modified`, `=thread-group-started`, `=thread-group-exited`.
- Stream records: `~"consola
"`, `@"salida del inferior"`, `&"log de gdb"` — se coalescen (16 KiB / 16 ms, misma política que la terminal) hacia la pestaña de salida.

Comandos de la fase 1: `-file-exec-and-symbols`, `-exec-run`, `-exec-continue`, `-exec-interrupt`, `-exec-next / -exec-step / -exec-finish`, `-break-insert --source FILE --line N`, `-break-delete N`, `-stack-list-variables --simple-values`, `-gdb-exit`.

El parser es un módulo puro (`src/main/debugger/mi-parser.js`): línea → registro tipado. Toda cadena con datos del usuario (rutas) se serializa con el escapado de la gramática MI (comillas y barras), nunca por concatenación cruda (R5).

## 5. Estados asíncronos

Máquina de estados de `src/main/debugger/controller.js` (cada transición emite un evento dbg:state; transiciones no declaradas se ignoran y se loguean, defensa ante rarezas de MI):

| Estado | Significado | Transiciones de salida |
|---|---|---|
| idle | Sin sesión | launch → launching |
| launching | gdb arrancado, símbolos cargándose | ^running → running; ^error → idle |
| running | Inferior en ejecución; la UI muestra "en ejecución" y deshabilita continue/step | *stopped → stopped (con frame); *stopped,reason=exited-* → exited |
| stopped | Inferior detenido; único estado donde se permiten continue, step, locals, inspección | continue/step (^running) → running; kill → exited; detach → idle |
| exited | Inferior terminado, gdb vivo; se puede relanzar (reload) | relaunch → launching; quit → closed |
| closed | gdb terminado, sesión finiquitada; killAll garantizado en will-quit | — |

La UI es función pura de (estado, último frame): no hay heurísticas sobre texto de consola (R3).

## 6. Pausar y reanudar sin congelar la UI

El principio: gdb es un proceso hijo del proceso principal; el renderer solo habla por IPC y nunca espera al inferior.

- Reanudar: `dbg:continue` es invoke que resuelve en cuanto llega `^running` (milisegundos), no cuando el inferior termina. El evento posterior `*stopped` llega por el canal de eventos `dbg:stopped` cuando el breakpoint se alcanza, minutos después si hace falta.
- Pausar: `dbg:interrupt` envía `-exec-interrupt`, que resuelve con `^done` en cuanto gdb acepta la petición; la detención efectiva se confirma luego con `*stopped,reason="signal-received",signal-name="SIGINT"` por el canal de eventos. La UI pasa a "interrumpiendo…" (estado intermedio del indicador) y a stopped al confirmar.
- Nunca hay invoke que espere al inferior: la lista de canales lo garantiza por construcción (R1, R2).
- Watchdog por token: si un comando no recibe su registro de resultado en 10 s, se emite `dbg:state` con error y la sesión pasa a un estado recuperable (el usuario puede reintentar o cerrar); la app sigue respondiendo.
- Backpressure: los stream records se coalescen; un inferior que imprime sin parar no satura el IPC.

Contrato IPC:

| Canal | Dirección | Mecanismo | Payload | Resuelve en |
|---|---|---|---|---|
| dbg:start | R → M | invoke | { binary, args?, breakpoints? } | ^running o ^error → { sessionId } |
| dbg:continue / dbg:interrupt | R → M | invoke | { sessionId } | ^running / ^done |
| dbg:step | R → M | invoke | { sessionId, kind: over/into/out } | ^running |
| dbg:setBreakpoint | R → M | invoke | { sessionId, file, line } | ^done con bkpt → { bkptId } |
| dbg:removeBreakpoint | R → M | invoke | { sessionId, bkptId } | ^done |
| dbg:locals | R → M | invoke | { sessionId } | ^done con variables (solo en stopped) |
| dbg:quit | R → M | invoke | { sessionId } | gdb terminado |
| dbg:state | M → R | event | { sessionId, state, error? } | — |
| dbg:stopped | M → R | event | { sessionId, frame } | — |
| dbg:console | M → R | event | { sessionId, stream, data } | — |
| dbg:exit | M → R | event | { sessionId, code } | — |

Preload: `api.debugger.*` con invoke/event, idéntico patrón al de terminal y análisis; sin exponer ipcRenderer.

## 7. Integración con Monaco

- Glyph margin: clic en el margen → dbg:setBreakpoint; decoración de punto rojo vía clase CSS.
- Al llegar `*stopped` con frame con file/line: abrir el fichero y resaltar la línea actual con decoración efímera.
- Marco sin file/line (binario sin símbolos): mostrar dirección y nota "sin símbolos de depuración"; el fallback de desensamblado con rizin es fase 2 (R7: no se adivina).
- Las decoraciones son por sesión: al cerrar la sesión se limpian.

## 8. Modelo de amenazas (adiciones)

| Amenaza | Mitigación |
|---|---|
| El inferior es malware y se ejecuta en la máquina del analista | Confirmación explícita en cada dbg:start con texto claro ("el binario se ejecutará con sus privilegios de usuario"); flags `debugger.confirmStart` (default true) y `debugger.enabled` en noctua.json; la vía segura documentada es gdbserver en VM (fase 2) |
| Inyección en comandos MI | argv array sin shell; escapado MI para cualquier cadena con contenido del usuario (R5) |
| gdb/init files no deterministas | Se lanza con `-nx`; init del usuario (pwndbg, etc.) fuera de fase 1 y documentado como limitación |
| Sesiones huérfanas | dbg:quit mata inferior y gdb; killAll en window-all-closed y will-quit |
| Flood de consola | Coalescing 16 KiB / 16 ms por sesión |

## 9. Plan de pruebas

- `tests/mi-parser.test.js`: transcripciones MI reales como fixtures inline; tokens, registros exec/notify/stream, errores, frames anidados.
- `tests/debugger.test.js`: FakeMiProcess con guiones de transcripción; máquina de estados (transiciones válidas, rechazo de inválidas), watchdog, correlación por token, ciclo completo run → breakpoint-hit → continue → exit.
- CI sin gdb (R4), mismo criterio que FakePty en la terminal.

## 10. Orden de implementación

1. `src/main/debugger/mi-parser.js` + tests (TDD).
2. `controller.js` + tests con FakeMiProcess.
3. IPC + preload.
4. UI: barra de depuración, glyph margin, línea actual, confirmación de inicio, pestaña de consola de depuración.
5. README, ARCHITECTURE (modelo de amenazas), ROADMAP.

## 11. Fase 2 (pospuesto deliberadamente)

gdbserver en VM (mismo MI por target remote), watchpoints, vista de desensamblado vía rizin, memoria/hex, hilos, mapeo de rutas para binarios compilados fuera del host.

## 12. Decisiones abiertas para el revisor

1. ¿Alcance de inspección en fase 1: solo marco actual y locals (propuesta) o también backtrace completo (-stack-list-frames)?
2. ¿Relanzamiento del inferior en estado exited con un solo clic (propuesta) o exigir sesión nueva?
3. ¿Respetar un flag para cargar init del usuario (pwndbg) aceptando MI no determinista? Propuesta: no en fase 1.
4. ¿Evaluar Debug Adapter Protocol como capa futura sobre MI en v0.4+? Propuesta: postergar la evaluación; MI directo es más simple y suficiente para el flujo vertical.
