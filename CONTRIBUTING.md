# Contribuir a NOCTUA

¡Gracias por tu interés en contribuir a NOCTUA! Este documento describe cómo puedes ayudar a mejorar el proyecto.

## Código de Conducta

Al contribuir a este proyecto, aceptas seguir nuestro [Código de Conducta](CODE_OF_CONDUCT.md). Sé respetuoso con todos los contribuidores y mantenedores.

## Cómo Contribuir

### Reportando Issues

Antes de abrir un nuevo issue:

1. **Busca issues existentes** para evitar duplicados
2. **Verifica que el problema se reproduzca** en la última versión de `main`
3. **Proporciona la siguiente información:**
   - Versión de NOCTUA (desde `package.json`)
   - Sistema operativo y versión
   - Versión de Node.js (`node --version`)
   - Pasos detallados para reproducir
   - Comportamiento esperado vs. actual
   - Captura de pantalla o logs si aplica

### Tipos de Issues

| Etiqueta | Descripción | Requerimientos |
|---------|-------------|---------------|
| `bug` | Error en el funcionamiento | Pasos para reproducir |
| `enhancement` | Nueva funcionalidad | Descripción detallada |
| `documentation` | Mejora en docs | Ubicación y contenido |
| `good first issue` | Para nuevos contribuidores | Bien definido, alcance limitado |
| `security` | Vulnerabilidad de seguridad | Reportar en privado |

### Pull Requests

#### Antes de Empezar

1. **Fork el repositorio** y crea una rama desde `main`
   ```bash
   git clone https://github.com/elkalivpn/NOCTUA-.git
   cd NOCTUA-
   git checkout -b feat/mi-nueva-funcionalidad
   ```

2. **Nombra tu rama** siguiendo la convención:
   - `feat/xxx` - Nueva funcionalidad
   - `fix/xxx` - Corrección de bug
   - `docs/xxx` - Mejoras en documentación
   - `refactor/xxx` - Reestructuración de código
   - `test/xxx` - Mejoras en tests
   - `chore/xxx` - Tareas de mantenimiento

3. **Instala dependencias:**
   ```bash
   npm install
   ```

#### Requisitos para Pull Requests

✅ **Todos los tests deben pasar:**
```bash
npm test
```

✅ **El código debe seguir el estilo existente:**
- Sin comentarios innecesarios
- Nombres descriptivos
- Funciones puras donde sea posible
- Validación de entradas

✅ **Documentación actualizada:**
- Actualiza `ARCHITECTURE.md` si cambias la arquitectura
- Actualiza `README.md` si añades funcionalidad visible
- Documenta nuevas APIs o contratos

✅ **Mensaje de commit claro:**
```
tipo(ámbito): descripción breve

Cuerpo del mensaje (opcional):
- Explicación detallada
- Motivo del cambio
- Issues relacionados

Ejemplo:
fix(debugger): corrige parseo de respuesta *stopped

El parser no manejaba correctamente las respuestas
con multiple threads. Esto causaba que el backtrace
mostrara información incorrecta.

Closes #123
```

#### Revisión de Pull Requests

1. **Al menos un mantenedor** debe aprobar el PR
2. **Todos los checks de CI** deben pasar
3. **No hay conflictos** con la rama `main`
4. **El PR puede ser squashed** si tiene muchos commits pequeños

### Desarrollo Local

#### Estructura del Proyecto

```
NOCTUA-
├── src/                    # Proceso principal (Node.js)
│   ├── main.js             # Punto de entrada
│   ├── analysis/           # Detectores de análisis estático
│   ├── debugger/           # Depurador GDB/MI
│   ├── terminal.js         # Gestor de terminal PTY
│   └── ...
├── renderer/               # Frontend (Chromium)
│   ├── index.html          # HTML principal
│   ├── app.js              # Lógica de la aplicación
│   ├── tree.js             # Árbol de proyectos
│   └── ...
├── tests/                  # Tests unitarios
├── docs/                   # Documentación de diseño
└── scripts/                # Scripts de soporte
```

#### Ejecutar en Modo Desarrollo

```bash
npm run dev
```

Esto inicia NOCTUA con herramientas de desarrollo de Electron.

#### Depuración

**Depurar el proceso principal:**
```bash
# En una terminal
node --inspect-brk src/main.js

# En Chrome/Edge, abre:
chrome://inspect
```

**Depurar el renderer:**
El renderer de Electron puede depurarse directamente desde Chrome DevTools.

### Tests

#### Ejecutar todos los tests
```bash
npm test
```

#### Ejecutar tests específicos
```bash
node --test tests/analysis.test.js
```

#### Tests con cobertura
```bash
# Instalar nyc (coverage)
npm install -g nyc
nyc --reporter=text node --test tests/
```

### Arquitectura y Seguridad

#### Principios de Arquitectura

1. **El renderer nunca ve Node.js**
   - `nodeIntegration: false`
   - `sandbox: true`
   - `contextIsolation: true`

2. **Todo privilegio cruza por IPC**
   - Handlers explícitos para cada operación
   - Validación en ambos extremos

3. **Plugins aislados**
   - Cada plugin en su propio utilityProcess
   - Permisos denegados por defecto
   - Validación de manifest estricta

#### Reglas de Seguridad para Contribuidores

❌ **NO hagas:**
- Ejecutar shell arbitrario desde el renderer
- Usar `eval()` o `new Function()`
- Cargar módulos nativos sin validación
- Añadir dependencias sin revisión
- Ignorar errores de permisos

✅ **SÍ haz:**
- Valida todas las entradas de usuario
- Usa el sistema de permisos existente
- Documenta implicaciones de seguridad
- Revise código de otros antes de mergear
- Reporta vulnerabilidades de forma responsable

### Documentación

#### Actualizar Documentación

Si añades o modificas funcionalidad:

1. **Actualiza `README.md`** con la nueva funcionalidad
2. **Actualiza `ARCHITECTURE.md`** si cambias la arquitectura
3. **Añade ejemplos** en la documentación relevante
4. **Mantén el changelog** (si existe)

#### Escribir Documentación de Diseño

Los documentos de diseño en `docs/` deben incluir:

- **Contexto:** ¿Por qué se necesita esta funcionalidad?
- **Objetivos:** ¿Qué problema resuelve?
- **Diseño:** ¿Cómo funciona?
- **Alternativas consideradas:** ¿Qué otras opciones se evaluaron?
- **Implementación:** Pasos para implementar
- **Testing:** ¿Cómo se prueba?

### Sistema de Plugins

#### Crear un Plugin

1. **Estructura básica:**
   ```
   plugins/mi-plugin/
   ├── manifest.json
   └── main.js
   ```

2. **manifest.json:**
   ```json
   {
     "id": "mi-plugin",
     "name": "Mi Plugin",
     "version": "1.0.0",
     "main": "main.js",
     "permissions": ["events", "commands"],
     "origin": "https://github.com/usuario/mi-plugin"
   }
   ```

3. **main.js:**
   ```javascript
   module.exports.register = (ctx) => {
     ctx.registerCommand("mi-comando", () => {
       return "Hola desde mi plugin!";
     });
   };
   ```

#### Permisos de Plugins

| Permiso | Descripción | Riesgo |
|---------|-------------|--------|
| `events` | Emitir y suscribirse a eventos | Bajo |
| `commands` | Registrar y ejecutar comandos | Medio |
| `fs` | Acceso al sistema de archivos | Alto |
| `tools` | Ejecutar herramientas externas | Alto |
| `ai` | Acceso al agente IA | Medio |

### Roadmap y Prioridades

Consulta [ROADMAP.md](docs/ROADMAP.md) para ver las prioridades del proyecto.

Los issues etiquetados como `good first issue` son ideales para nuevos contribuidores.

### Comunicación

- **Issues de GitHub:** Para reportar bugs y discutir funcionalidades
- **Pull Requests:** Para contribuir código
- **Discusiones:** Para preguntas generales

### Reconocimiento

Todos los contribuidores serán reconocidos en el archivo `CONTRIBUTORS.md` (cuando se cree).

---

**Gracias por contribuir a NOCTUA!** 🚀

Mantenedor: @elkalivpn  
Repositorio: https://github.com/elkalivpn/NOCTUA-  
Licencia: MIT
