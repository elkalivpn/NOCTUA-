# NOCTUA — Diseño: análisis dinámico básico (issue #11)

Estado: diseño publicado para revisión del maintainer; sin implementación todavía.

## Objetivo y no objetivos

Objetivo: ejecutar la muestra dentro de un contenedor efímero (Docker o Podman) durante un tiempo acotado y recolectar evidencia observable — conexiones de red, llamadas al sistema relevantes y hashes de los ficheros que la muestra crea o modifica en runtime — publicándola como un NUEVO tipo de finding (source "dynamic") dentro del contrato de hallazgos existente.

No objetivos (declarados):

- No sustituir a una sandbox de análisis seria (VM con snapshots, Cuckoo): un contenedor comparte kernel con el host y no protege frente a escapes de sandbox.
- No capturar paquetes completos ni payload de red en esta versión: se registran destinos, puertos y protocolo por syscall, no contenido.
- No automatizar la creación ni la restauración de la imagen/VM: responsabilidad del analista, documentada.

## Seguridad y gating

- Primera vez que NOCTUA ejecuta una muestra: confirmación explícita obligatoria por ejecución (herencia de R6 del depurador) y flag dynamic.enabled en noctua.json (por defecto, false).
- Contenedor efímero: --rm, sin privilegios (capabilities reducidas), límites de CPU y memoria, red configurable (dynamic.network: "none" por defecto, "bridge" opt-in), timeout duro configurable (dynamic.timeoutSeconds, por defecto 30).
- La muestra se monta read-only en el contenedor; el directorio de trabajo del contenedor es volátil y se descarta al terminar.
- Cleanup tolerante a fallos: el contenedor se elimina incluso si la recolección de artefactos falla a medias.
- Detección de runtime: docker o podman (CLI compatibles), configurable con dynamic.runtime; degradación elegante si no hay ninguno instalado (el detector se desactiva con aviso, igual que rabin2 y YARA hoy).

## Arquitectura

- src/main/dynamic/runner.js: interfaz containerRunner inyectable; solo src/main.js conoce el spawn real de docker/podman. Misma filosofía que ptyFactory (terminal) y spawnGdb (depurador): los tests jamás ejecutan contenedores.
- src/main/dynamic/parse.js: parsers PUROS y testeables sin Docker:
  - traza de red (strace -f -e trace=network) → conexiones { host, port, proto, syscall } a partir de connect/bind/sendto/recvfrom;
  - resumen de syscalls con recuento, acotado a N entradas;
  - diff del contenedor (docker diff / podman diff) → rutas creadas o modificadas, con hash de cada fichero accesible (hashes en runtime).
- src/main/dynamic/index.js: orquestador: crear contenedor → ejecutar bajo strace con timeout → recolectar diff y hashes → destruir contenedor; progreso por etapas; errores estables (RUNTIME_UNAVAILABLE, DYNAMIC_DISABLED, TIMEOUT).
- Contrato de hallazgos: extensión opt-in del schema zod con la fuente "dynamic": dynamic.network-connection (medium por defecto), dynamic.file-write con hash (medium), dynamic.syscall-summary (info). El agente de triaje recibe el JSON ampliado con las reglas de atribución conservadora habituales: sin evidencia dinámica que lo respalde, no se atribuye comportamiento.

## Tests y CI

Tests de los parsers y del orquestador con un FakeRunner inyectable (transcripciones de strace y diff como fixtures sintéticos), CI sin Docker; misma filosofía que FakePty y FakeMiProcess.

## Decisiones abiertas (pendientes del maintainer)

1. Runtime preferido cuando ambos existen: ¿docker por defecto con override a podman, o podman primero (sin demonio root, más seguro por defecto)?
2. Imagen base del contenedor: ¿kalilinux/rolling oficial o una imagen mínima documentada (debian-slim con tooling estricto)?
3. ¿Incluir captura de consultas DNS del contenedor en esta versión o posponerla?
4. Punto de entrada en la UI: ¿paleta de comandos, botón en el panel de análisis, o ambos?

## Honestidad declarada

- Un contenedor comparte kernel con el host: frente a malware con escapada de sandbox la protección es limitada. Para análisis serio, la VM con snapshots sigue siendo la vía recomendada (issue #10 y siguientes).
- La ausencia de hallazgos dinámicos no es prueba de inocencia: muestras con gating temporal, detección de contenedor o dependencia de entorno pueden no mostrar comportamiento.

## Plan de entregas (patrón del proyecto)

Núcleo con tests (parsers + orquestador con FakeRunner) → integración (gating, confirmación, paleta/panel) → documentación (README/ARCHITECTURE/ROADMAP) → cierre del issue con comentario técnico y validación honesta.
