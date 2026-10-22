"use strict";
/* Postinstall de NOCTUA (issue #3, docs/DESIGN-terminal.md sección 7):
   1) copia los vendors del renderer (Monaco y xterm) — servido local, sin CDN;
   2) reconstruye node-pty contra los headers de Electron, salvo NOCTUA_SKIP_REBUILD=1 (CI de tests).
   Si el rebuild falla, la instalación CONTINÚA: la app arranca con la terminal deshabilitada (R7). */
const { spawnSync } = require("child_process");
const path = require("path");
const root = path.join(__dirname, "..");

require("./copy-monaco.js");
require("./copy-xterm.js");

if (process.env.NOCTUA_SKIP_REBUILD === "1") {
  console.log("[postinstall] rebuild de node-pty omitido (NOCTUA_SKIP_REBUILD=1)");
  process.exit(0);
}

const bin = path.join(root, "node_modules", ".bin", "electron-rebuild");
console.log("[postinstall] reconstruyendo node-pty para Electron…");
const r = spawnSync(bin, ["-f", "-o", "node-pty"], { stdio: "inherit", cwd: root });
if (!r || r.status !== 0) {
  console.error("[postinstall] electron-rebuild falló. La terminal quedará deshabilitada hasta ejecutar: npm run rebuild");
} else {
  console.log("[postinstall] node-pty reconstruido para Electron");
}
