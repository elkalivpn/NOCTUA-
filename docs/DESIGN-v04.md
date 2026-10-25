# NOCTUA — Diseño v0.4: Ingeniería inversa y sandbox

Estado: diseño aprobado para desarrollo. Issues: #8 (Ghidra headless), #9 (CAPA + ATT&CK), #10 (gdbserver en VM).
Principio heredado: un único flujo vertical completo antes de ampliar módulos. v0.4 amplía el flujo existente
(abrir binario → análisis → hallazgos → agente) con tres módulos que no ejecutan la muestra en el host.

## Objetivos y no objetivos

Objetivos:

1. Enriquecer el triaje estático con ingeniería inversa real (funciones, xrefs) vía Ghidra headless.
2. Atribuir comportamiento con reglas CAPA y exponerlo como técnicas MITRE ATT&CK en el panel de hallazgos.
3. Ofrecer la vía segura de depuración prometida en la fase 2 del depurador: gdbserver con el inferior dentro de una VM.

No objetivos (declarados):

- No reimplementar desensambladores ni motores de firmas: NOCTUA orquesta herramientas maduras.
- No ejecutar la muestra en el host bajo ningún módulo de v0.4.
- No gestionar el ciclo de vida de la VM: crear/restaurar la VM y sus snapshots es responsabilidad del analista, documentada.

## Módulo A — Puente Ghidra headless (issue #8)

- Ejecución: analyzeHeadless con un proyecto temporal desechable y un postScript propio (Java) que exporta JSON:
  funciones (nombre, dirección, tamaño, tipo), llamadas directas, xrefs relevantes y strings etiquetadas por Ghidra.
- Seguridad: análisis estático puro; la muestra no se ejecuta. argv array sin shell, timeout configurable (por defecto 300 s:
  Ghidra tarda minutos, no milisegundos). El proyecto temporal se borra al terminar, con borrado tolerante a fallos.
- Configuración: ruta de instalación de Ghidra en noctua.json (ghidra.path) con detección por defecto en rutas habituales;
  si no está instalado, el detector se desactiva con aviso, igual que rabin2 y YARA hoy.
- Integración: un detector más del orquestador (gating idéntico), seleccionable desde la paleta; los hallazgos usan el
  contrato existente (nueva fuente "ghidra"); el JSON completo queda disponible para el agente de triaje.
- Plan de tests: parser puro del JSON exportado (fixtures sintéticos) + gating; CI sin Ghidra.

## Módulo B — Reglas CAPA y mapeo MITRE ATT&CK (issue #9)

- Ejecución: capa -j sobre el binario, argv array sin shell, timeout. Reglas estándar de CAPA; reglas custom solo por
  configuración explícita del usuario y documentadas como no auditadas.
- Contrato: el Finding existente gana un campo opcional "mitre" con identificador y nombre de técnica (por ejemplo,
  T1055 con su nombre canónico), validado por zod como extensión opt-in: los consumidores que no lo conocen lo ignoran
  y el contrato v1 no se rompe.
- UI: técnicas ATT&CK en el detalle del hallazgo, agrupadas por táctica, y como filtro por fuente. El agente de triaje
  recibe el JSON ampliado y sigue las reglas de atribución conservadora: sin regla CAPA que lo respalde, no se atribuye
  comportamiento ni familia.
- Degradación: sin CAPA instalado, el detector se desactiva con aviso.
- Plan de tests: mapeo JSON de CAPA → hallazgos con el campo mitre (fixtures sintéticos) + validación zod.

## Módulo C — Depuración remota gdbserver en VM (issue #10)

- Base: el backend GDB/MI existente (mi-parser, controller, manager) no cambia; se añade una variante de arranque que
  lanza gdb con "target remote host:port" en lugar de "run". El inferior corre dentro de la VM; el host solo habla MI.
- Configuración: bloque debugger.remote en noctua.json (host, puerto, confirmación propia). La confirmación explícita
  se mantiene: cada sesión remota exige confirmación visible, y la UI marca la sesión como remota.
- Honestidad sobre la VM: NOCTUA no crea ni restaura la VM. El analista restaura el snapshot antes de la sesión; la
  documentación del módulo lo exige como paso obligatorio del procedimiento.
- Sin VM configurada, la depuración local sigue existiendo con su advertencia actual; no se mezclan modos en una misma sesión.
- Plan de tests: arranque remoto con FakeMiProcess (transcripciones con =thread-group-added y ^connected), máquina de
  estados sin cambios de comportamiento local; CI sin gdb ni red.

## Riesgos y honestidad

- Ghidra headless es pesado (minutos por binario) y su export puede fallar en muestras corruptas: el detector debe
  fallar a un hallazgo informativo, nunca tumbar el análisis completo.
- CAPA hereda los falsos positivos de sus reglas: el campo mitre es evidencia de técnica, no atribución de familia.
- La VM reduce, no elimina, el riesgo: un entorno de análisis comprometido sigue siendo un incidente. La restauración
  de snapshot previa a cada sesión es obligatoria y NOCTUA no la automatiza en esta versión.
- Ninguna de las herramientas nuevas se añade a la whitelist de la paleta como ejecutor genérico: cada integración es
  código auditado con su propio gating.

## Decisiones abiertas (pendientes del maintainer)

1. Ghidra: ¿detectar la instalación automáticamente en rutas habituales de Kali o exigir ghidra.path explícito?
2. CAPA: ¿permitir un directorio de reglas custom opt-in aunque no estén auditadas, o solo reglas estándar?
3. VM: ¿documentar un perfil recomendado (VirtualBox/QEMU + Kali) o dejar la elección del hipervisor fuera del repo?
4. ¿Publicar el postScript de Ghidra dentro del repo (scripts/ghidra/) o cargarlo desde la instalación del usuario?

## Plan de entregas (patrón del proyecto)

Por módulo y en este orden: commit de núcleo con tests (CI sin dependencias externas), commit de integración
(gating, paleta, IPC) y commit de documentación; cierre del issue correspondiente con comentario técnico y validación
honesta de lo probado en sandbox y lo que queda pendiente de probar en Kali real.
