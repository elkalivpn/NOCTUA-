// Copia xterm.js y el addon fit desde node_modules a renderer/vendor/xterm
// para servir la terminal siempre en local (issue #3: sin CDN).
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "node_modules", "@xterm");
const dest = path.join(root, "renderer", "vendor", "xterm");

const files = [
  [path.join(src, "xterm", "lib", "xterm.js"), path.join(dest, "xterm.js")],
  [path.join(src, "xterm", "css", "xterm.css"), path.join(dest, "xterm.css")],
  [path.join(src, "addon-fit", "lib", "addon-fit.js"), path.join(dest, "addon-fit", "addon-fit.js")]
];

for (const [from] of files) {
  if (!fs.existsSync(from)) {
    console.error("xterm no está instalado en " + from + ". Ejecute: npm install");
    process.exit(1);
  }
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(path.join(dest, "addon-fit"), { recursive: true });
for (const [from, to] of files) fs.copyFileSync(from, to);
console.log("xterm copiado a renderer/vendor/xterm (self-host, sin CDN)");
