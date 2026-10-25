# NOCTUA — Hoja de ruta

Principio de priorización: un único flujo vertical completo antes de ampliar módulos.
Flujo vertical objetivo: **abrir binario → análisis estático → hallazgos en panel → sugerencia del agente IA**.

## v0.3 — completado (v0.3.4) — Depuración, workspace, paleta y plugins aislados (hardening)
- [x] Documento de diseño del debugger: docs/DESIGN-debugger.md — GDB/MI elegido sobre rzpipe por eventos push asíncronos y gdbserver (issue #2)
- [x] Backend de depuración GDB/MI con breakpoints reflejados en el editor (v0.3.1) — diseño: docs/DESIGN-debugger.md; máquina de estados, watchdog, locals, backtrace, consola y relanzamiento; tests con FakeMiProcess, CI sin gdb
- [x] Árbol de proyectos: lazy loading, iconos por tipo, click abre en Monaco y drag-and-drop en ambos sentidos (v0.3.0)
- [x] Paleta de comandos (Ctrl+Shift+P): registro con búsqueda difusa insensible a acentos, ejecución de detectores sueltos, herramientas externas con whitelist fija y navegación de hallazgos (v0.3.2)
- [x] Aislamiento de plugins en utilityProcess (issue #6, v0.3.3): worker propio por plugin, protocolo RPC con permisos validados en ambos extremos, grant explícito de capacidades fs/tools/ai, detección de caídas (plugin:crashed) y tests de aislamiento con fork en bucle
- [x] Hardening del sandboxing de plugins (issue #12, v0.3.4): validación de origen y estructura del manifest (id estricto, directorio = id, main relativo, origin declarado, duplicados rechazados) y permisos explícitos en el renderer (comandos de plugins en la paleta solo si están habilitados y declaran commands, con re-validación en el proceso principal)

## v0.2 — completado (v0.2.2)
- [x] Contrato de hallazgos con validación de esquema (zod) — `src/main/analysis/schema.js`
- [x] Detectores puros: formato PE/ELF, entropía global y por sección, imports categorizados (taxonomía), strings/URLs/IPs, YARA, mitigaciones (ASLR/DEP/CFG/canary)
- [x] Orquestador con detectores pesados en worker_threads + progreso por etapas
- [x] Panel de hallazgos: cabecera con SHA-256 copiable, lista agrupada por severidad con filtro por fuente y búsqueda
- [x] Prompt de triaje del agente: JSON estructurado, afirmaciones solo con evidencia del input, campo unknowns
- [x] Tests con fixtures generados en runtime (PE sintético limpio/packer/injection)
- [x] CSP estricta en el renderer: default-src 'self', sin scripts inline ni remotos, object-src 'none' (issue #4)
- [x] Self-host de Monaco: servido desde renderer/vendor/monaco, copiado por postinstall, fuera del repo (issue #5)
- [x] Terminal integrada (node-pty + xterm.js self-hosted, degradable si el módulo nativo no compila) — issue #3 — diseño: docs/DESIGN-terminal.md

## v0.1 — completado
- [x] Esqueleto Electron con IPC seguro, editor Monaco, agente IA configurable, análisis básico, puentes rizin/YARA, plugins con permisos, CI, MIT, ARCHITECTURE.md

## v0.4 (en diseño — docs/DESIGN-v04.md) — Ingeniería inversa y sandbox
- [ ] Puente Ghidra headless con export JSON (funciones, xrefs, strings) — issue #8
- [ ] Reglas CAPA y mapeo MITRE ATT&CK en el contrato de hallazgos (campo mitre opt-in) — issue #9
- [ ] gdbserver con inferior en VM (fase 2 del diseño del depurador): depuración sin ejecutar la muestra en el host — issue #10
- [ ] VM dedicada con snapshots: perfil y restauración documentados como responsabilidad del analista
- [ ] Análisis dinámico básico en Docker/Podman: red, syscalls y hashes en runtime como nuevo tipo de finding — issue #11 (diseño: docs/DESIGN-dynamic.md)

## v0.5 — Orquestación de fuzzing
- [ ] Integración AFL++ / boofuzz: campañas, cobertura, triaje de crashes
- [ ] Deduplicación por stack hash y clasificación

## v1.0 — Distribución Kali Linux
- [ ] AppImage + .deb firmado (desde CI), detección de herramientas del sistema, documentación de despliegue seguro

## Fuera de alcance declarado
- Reimplementar desensambladores, motores de firmas o emuladores: NOCTUA orquesta herramientas maduras.
- "Buscar 0-days" como feature: se formula como orquestación de fuzzing + triaje (v0.5).
