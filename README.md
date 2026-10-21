# NOCTUA — Grey Hat IDE

IDE de escritorio para investigación de seguridad: análisis de ficheros y malware, desarrollo y depuración de exploits, fuzzing, sistema de plugins y agente de IA especializado en código. Diseñado para Kali Linux.

## Arquitectura

```
NOCTUA-/
├── src/
│   ├── main.js          Proceso principal (IPC, análisis, herramientas)
│   ├── preload.js       Puente seguro (contextBridge)
│   ├── ai-agent.js      Agente IA: API Mistral u Ollama local
│   └── plugin-loader.js Sistema de plugins (noctua.plugin.v1)
├── renderer/
│   └── index.html       UI: Monaco editor, agente, terminal
├── plugins/             Plugins de ejemplo
└── docs/ROADMAP.md      Hoja de ruta hasta v1.0
```

## Instalación en Kali Linux

```bash
sudo apt update
sudo apt install -y rizin yara gdb python3-pip
pipx install frida-tools
sudo apt install -y afl++
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
git clone https://github.com/elkalivpn/NOCTUA-.git
cd NOCTUA-
npm install
npm start
```

## Configuración del agente IA

Cree `~/.config/noctua/noctua.json`:

```json
{
  "provider": "mistral",
  "mistral": { "apiKey": "SU_API_KEY", "model": "mistral-large-latest" },
  "ollama": { "url": "http://127.0.0.1:11434", "model": "qwen2.5-coder:32b" }
}
```

Modo local: `curl -fsSL https://ollama.com/install.sh | sh && ollama pull qwen2.5-coder:32b`

## Aviso legal

NOCTUA es una herramienta para investigación de seguridad autorizada, CTF y análisis defensivo. Úsela únicamente sobre sistemas para los que posea permiso explícito.
