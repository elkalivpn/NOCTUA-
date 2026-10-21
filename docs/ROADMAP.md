# NOCTUA — Hoja de ruta

## v0.1 (actual)
- [x] Esqueleto Electron con IPC seguro (contextIsolation + sandbox)
- [x] Editor Monaco con tema propio
- [x] Agente IA configurable (API Mistral / Ollama local)
- [x] Análisis básico de binarios (PE/ELF, entropía, SHA-256)
- [x] Puentes a rizin y YARA
- [x] Sistema de plugins (contrato noctua.plugin.v1)

## v0.2 — Edición
- [ ] Árbol de proyectos completo (crear/borrar/mover ficheros)
- [ ] Terminal integrada real (node-pty)
- [ ] Paleta de comandos (Ctrl+P)

## v0.3 — Depuración
- [ ] Debugger GDB/MI integrado con puntos de ruptura en el editor
- [ ] Instrumentación dinámica con Frida (spawn/attach)

## v0.4 — Ingeniería inversa y malware
- [ ] Ghidra headless bridge (desensamblado en panel)
- [ ] Reglas CAPA y mapeo MITRE ATT&CK
- [ ] Ejecución en sandbox (VM dedicada, snapshots)

## v0.5 — Caza de 0-days
- [ ] Fuzzing dirigido por cobertura (integración AFL++ / libFuzzer)
- [ ] Triaje automático de crashes (deduplicación por stack hash)

## v1.0 — Distribución Kali Linux
- [ ] AppImage + paquete .deb firmado
- [ ] Instalador que detecta herramientas del sistema (rizin, yara, gdb, frida, afl++)
- [ ] Documentación de despliegue seguro
