const crypto = require("crypto");
const fs = require("fs/promises");

/* Entropía de Shannon sobre los bytes del buffer (0 = uniforme, 8 = aleatoria).
   Alto valor sugiere empaquetado o cifrado. */
function shannonEntropy(buf) {
  const freq = new Array(256).fill(0);
  for (const b of buf) freq[b]++;
  let entropy = 0;
  for (const f of freq) {
    if (!f) continue;
    const p = f / buf.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function detectType(buf) {
  const magic2 = buf.subarray(0, 2).toString("latin1");
  const magic4 = buf.subarray(0, 4).toString("hex");
  if (magic2 === "MZ") return "PE/EXE";
  if (magic4 === "7f454c46") return "ELF";
  if (magic4 === "cafebabe") return "Mach-O/Java";
  if (magic2 === "#!") return "Script";
  if (magic4 === "504b0304") return "ZIP/APK/JAR";
  return "desconocido";
}

/* Análisis estático básico sin dependencias externas. */
async function analyzeBasic(filePath) {
  const buf = await fs.readFile(filePath);
  const entropy = shannonEntropy(buf);
  return {
    file: filePath,
    size: buf.length,
    type: detectType(buf),
    entropy: Number(entropy.toFixed(3)),
    packed: entropy > 7.2,
    sha256: crypto.createHash("sha256").update(buf).digest("hex"),
    md5: crypto.createHash("md5").update(buf).digest("hex")
  };
}

module.exports = { analyzeBasic, shannonEntropy, detectType };
