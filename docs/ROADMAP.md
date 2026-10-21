# NOCTUA — Hoja de ruta

Principio de priorización: un único flujo vertical completo antes de ampliar módulos.
Flujo vertical objetivo: **abrir binario → análisis estático → hallazgos en panel → sugerencia del agente IA**.

## v0.1 (actual)
- [x] Esqueleto Electron con IPC seguro (contextIsolation + sandbox)
- [x] Editor Monaco
- [x] Agente IA configurable (API Mistral / Ollama local)
- [x] Análisis básico testeable (PE/ELF, entropía, hashes) — `src/analyze.js`
- [x] Puentes a rizin y YARA
- [x] Plugins con permisos declarativos (noctua.plugin.v1)
- [x] CI (GitHub Actions): tests en cada push, AppImage por etiqueta
- [x] Licencia MIT, ARCHITECTURE.md con modelo de amenazas

## v0.2 — Flujo vertical de análisis (prioridad única)
- [ ] Panel de hallazgos estructurado (severidad, MITRE) alimentado por analyze.js + rizin + YARA
- [ ] Integración del panel con el agente IA (contexto de hallazgos)
- [ ] Árbol de proyectos y terminal integrada (node-pty)
- [ ] CSP estricta en el renderer

## v0.3 — Depuración (diseño antes que código)
- [ ] Documento de diseño: GDB/MI vs rz-pipe (estados asíncronos, modelo de eventos)
- [ ] Backend de depuración con puntos de ruptura reflejados en el editor

## v0.4 — Ingeniería inversa y sandbox
- [ ] Ghidra headless bridge (desensamblado en panel)
- [ ] Reglas CAPA y mapeo MITRE ATT&CK
- [ ] VM dedicada con snapshots para análisis dinámico

## v0.5 — Orquestación de fuzzing
- [ ] Integración AFL++ / boofuzz: campañas, cobertura, triaje de crashes
- [ ] Deduplicación por stack hash y clasificación

## v1.0 — Distribución Kali Linux
- [ ] AppImage + .deb firmado (desde CI)
- [ ] Instalador que detecta herramientas del sistema
- [ ] Documentación de despliegue seguro

## Fuera de alcance declarado
- Reimplementar desensambladores, motores de firmas o emuladores: NOCTUA orquesta herramientas maduras.
- "Buscar 0-days" como feature: se formula como orquestación de fuzzing + triaje (v0.5).
