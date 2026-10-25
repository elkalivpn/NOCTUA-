# Instalación de NOCTUA

NOCTUA es un IDE de investigación de seguridad diseñado para Kali Linux. Esta guía cubre los requisitos, instalación, configuración inicial y resolución de problemas.

## Requisitos del Sistema

### Sistema Operativo
- **Kali Linux** (recomendado: 2024.1 o superior)
- **Debian** 12+ (Bookworm)
- **Ubuntu** 22.04+ (Jammy)

### Hardware
- **CPU:** x86-64 (requerido para Electron)
- **RAM:** 4 GB mínimo (8 GB recomendado para análisis de binarios grandes)
- **Espacio en disco:** 2 GB (incluye dependencias y vendors)

### Dependencias Obligatorias

#### Herramientas de análisis estático
```bash
# Instalar herramientas básicas de análisis
sudo apt update
sudo apt install -y \
    rizin \
    radare2 \
    yara \
    gdb \
    build-essential \
    python3 \
    python3-pip
```

#### Dependencias de Node.js
```bash
# Node.js 22.x (requerido)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

#### Verificar instalación
```bash
node --version  # Debe mostrar v22.x.x
npm --version   # Debe mostrar 10.x.x o superior
gdb --version   # Debe mostrar GDB 13.x o superior
rizin -v        # Debe mostrar rizin 0.5.x o superior
yara -V         # Debe mostrar YARA 4.x o superior
```

## Instalación de NOCTUA

### Desde el repositorio oficial

```bash
# Clonar el repositorio
git clone https://github.com/elkalivpn/NOCTUA-.git
cd NOCTUA-

# Instalar dependencias (esto puede tardar varios minutos)
npm install
```

### ¿Qué hace `npm install`?
1. Descarga todas las dependencias de npm
2. Copia Monaco Editor a `renderer/vendor/monaco/` (self-hosted, sin CDN)
3. Copia xterm.js a `renderer/vendor/xterm/` (self-hosted, sin CDN)
4. Recompila `node-pty` para Electron (requiere `build-essential` y `python3`)

### Si node-pty falla al compilar

La compilación de `node-pty` puede fallar en algunos sistemas. Esto **no bloquea** la instalación:

```bash
# Opción 1: Saltar la recompilación (la terminal estará deshabilitada)
NOCTUA_SKIP_REBUILD=1 npm install

# Opción 2: Instalar dependencias adicionales y recompilar manualmente
sudo apt install -y python3-dev python3-pip
npm run rebuild
```

Si la terminal no funciona, verá un mensaje de advertencia al iniciar NOCTUA.

## Configuración Inicial

### Configuración del Agente IA

Cree el archivo de configuración:

```bash
mkdir -p ~/.config/noctua
nano ~/.config/noctua/noctua.json
```

#### Opción A: Mistral API (nube)
```json
{
  "provider": "mistral",
  "mistral": {
    "apiKey": "SU_API_KEY_AQUI",
    "model": "mistral-large-latest"
  }
}
```

#### Opción B: Ollama Local (recomendado para privacidad)
```bash
# Instalar Ollama (siga las instrucciones en https://ollama.ai)
curl -fsSL https://ollama.ai/install.sh | sh

# Descargar un modelo (ejemplo: qwen2.5-coder)
ollama pull qwen2.5-coder:32b
```

Luego configure NOCTUA:
```json
{
  "provider": "ollama",
  "ollama": {
    "url": "http://127.0.0.1:11434",
    "model": "qwen2.5-coder:32b"
  }
}
```

#### Opción C: Sin IA
```json
{
  "provider": "none"
}
```

### Configuración del Depurador

```json
{
  "debugger": {
    "enabled": true,
    "confirmStart": true,
    "loadUserInit": false
  }
}
```

- `confirmStart`: Si es `true`, pedirá confirmación antes de ejecutar el binario
- `loadUserInit`: Si es `true`, cargará su `~/.gdbinit` (puede afectar la salida MI)

### Configuración de Preferencias (v0.4+)

```json
{
  "preferences": {
    "theme": "dark",
    "fontSize": 14,
    "toolPaths": {
      "rizin": "/usr/bin/rizin",
      "yara": "/usr/bin/yara",
      "gdb": "/usr/bin/gdb"
    }
  }
}
```

## Ejecución

### Iniciar NOCTUA
```bash
npm start
```

### Modo desarrollo
```bash
npm run dev
```

### Ejecutar tests
```bash
npm test
```

## Resolución de Problemas

### Error: "Cannot find module 'node-pty'"

```bash
# Recompilar node-pty manualmente
npm run rebuild

# Si persiste, instalar dependencias de compilación
sudo apt install -y python3-dev python3-pip
npm run rebuild
```

### Error: "Electron failed to install"

```bash
# Limpiar cache de npm
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### Error: "GDB not found"

```bash
sudo apt install -y gdb
```

### La terminal no aparece

Si ve un mensaje "Terminal deshabilitada: node-pty no compiló", puede:
1. Intentar recompilar: `npm run rebuild`
2. Usar NOCTUA sin terminal: todas las demás funciones trabajan
3. Usar la terminal externa de su sistema

### Error de permisos al acceder a archivos

NOCTUA respeta los permisos del sistema. Asegúrese de que su usuario tiene acceso a los archivos que quiere analizar.

## Desinstalación

```bash
# Eliminar el directorio de NOCTUA
rm -rf NOCTUA-

# Eliminar configuración
rm -rf ~/.config/noctua

# Eliminar dependencias globales (si las instaló)
sudo npm uninstall -g electron electron-builder
```

## Verificación de la Instalación

Ejecute el comando de verificación:

```bash
# Verificar que todos los binarios están accesibles
which node npm rizin yara gdb

# Verificar versión de NOCTUA
grep '"version"' package.json

# Ejecutar tests
npm test
```

Si todos los tests pasan (108/108), su instalación es correcta.

## Actualización

```bash
cd NOCTUA-
git pull origin main
npm install
npm start
```

## Notas de Seguridad

### Entorno de Ejecución
- NOCTUA **no** crea una sandbox para el análisis
- Los binarios que depure se ejecutan con **sus privilegios de usuario**
- La terminal integrada tiene acceso completo a su sistema
- **Recomendación:** Ejecute NOCTUA en un entorno controlado (VM, contenedor)

### Para Análisis de Malware
- **NO** ejecute muestras de malware directamente en NOCTUA
- Use el modo de análisis estático (sin ejecución)
- Para análisis dinámico, espere a la fase 2 (v0.4) con soporte de gdbserver en VM

### Permisos de Plugins
- Cada plugin se ejecuta en su propio proceso
- Los permisos son **denegados por defecto**
- Solo conceda permisos `fs` y `tools` a plugins de confianza
- Revise siempre el código del plugin antes de instalarlo

## Configuración Avanzada

### Variables de Entorno

| Variable | Descripción | Valor por defecto |
|----------|-------------|-------------------|
| `NOCTUA_SKIP_REBUILD` | Salta la recompilación de node-pty | `false` |
| `NOCTUA_LOG_LEVEL` | Nivel de logging (debug, info, warn, error) | `info` |
| `NOCTUA_DISABLE_AI` | Desactiva el agente IA | `false` |
| `NOCTUA_DISABLE_TERMINAL` | Desactiva la terminal | `false` |

### Ejemplo: Inicio rápido sin terminal
```bash
NOCTUA_SKIP_REBUILD=1 NOCTUA_DISABLE_TERMINAL=true npm start
```

### Ejemplo: Modo debug con logging detallado
```bash
NOCTUA_LOG_LEVEL=debug npm start
```

## Integración con Herramientas Externas

NOCTUA puede abrir archivos directamente en herramientas externas:

- **Ghidra:** Configure el path en preferencias
- **rizin:** Integrado en la paleta de comandos
- **Wireshark:** Soporte planeado para v0.4

## Contribuir

Si encuentra problemas durante la instalación:
1. Verifique que todas las dependencias están instaladas
2. Consulte los issues abiertos en GitHub
3. Abra un nuevo issue con:
   - Versión de su sistema operativo
   - Versión de Node.js
   - Pasos para reproducir el error
   - Salida del comando con `--verbose` si aplica

Ver [CONTRIBUTING.md](CONTRIBUTING.md) para más información.
