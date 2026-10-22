# NOCTUA — Hoja de ruta

Principio de priorización: un único flujo vertical completo antes de ampliar módulos.
Flujo vertical objetivo: **abrir binario → análisis estático → hallazgos en panel → sugerencia del agente IA**.

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

## v0.3 (actual) — Depuración y workspace
- [x] Documento de diseño del debugger: docs/DESIGN-debugger.md — GDB/MI elegido sobre rzpipe por eventos push asíncronos y gdbserver (issue #2)
- [ ] Backend de depuración GDB/MI con breakpoints reflejados en el editor — diseño: docs/DESIGN-debugger.md
- [x] Árbol de proyectos: lazy loading, iconos por tipo, click abre en Monaco y drag-and-drop en ambos sentidos (v0.3.0)

## v0.4 — Ingeniería inversa y sandbox
- [ ] Ghidra headless bridge, reglas CAPA, MITRE ATT&CK, VM dedicada con snapshots

## v0.5 — Orquestación de fuzzing
- [ ] Integración AFL++ / boofuzz: campañas, cobertura, triaje de crashes
- [ ] Deduplicación por stack hash y clasificación

## v1.0 — Distribución Kali Linux
- [ ] AppImage + .deb firmado (desde CI), detección de herramientas del sistema, documentación de despliegue seguro

## Fuera de alcance declarado
- Reimplementar desensambladores, motores de firmas o emuladores: NOCTUA orquesta herramientas maduras.
- "Buscar 0-days" como feature: se formula como orquestación de fuzzing + triaje (v0.5).
