# Contribuir a NOCTUA

1. Haga fork y cree una rama: `git checkout -b feat/mi-modulo`.
2. Los tests deben pasar: `npm test` (node:test, sin dependencias extra).
3. Todo cambio de seguridad (IPC, plugins, ejecución de herramientas) debe actualizarse en `ARCHITECTURE.md`.
4. Los plugins nuevos deben declarar permisos explícitos en `manifest.json`; no se aceptan plugins con permisos ampliados sin justificación en el PR.
5. No se aceptan pull requests que añadan ejecución dinámica de muestras fuera de un entorno de VM documentado.

Puntos de entrada: issues etiquetados `good first issue`.
