// Copia monaco-editor (build min) desde node_modules a renderer/vendor/monaco
// para que el editor se sirva siempre en local (issue #5: self-host, sin CDN).
// Se ejecuta como postinstall de npm install.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "node_modules", "monaco-editor", "min", "vs");
const dest = path.join(root, "renderer", "vendor", "monaco", "vs");

if (!fs.existsSync(src)) {
  console.error("monaco-editor no está instalado. Ejecute: npm install");
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log("Monaco copiado a renderer/vendor/monaco/vs (self-host, sin CDN)");
