/* Entropia de Shannon por byte. 0 = uniforme, 8 = aleatoria.
   > 7.5 en una seccion sugiere payload cifrado/comprimido (packer). */
function shannonEntropy(buf) {
  if (!buf.length) return 0;
  const freq = new Array(256).fill(0);
  for (let i = 0; i < buf.length; i++) freq[buf[i]]++;
  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (!freq[i]) continue;
    const p = freq[i] / buf.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/* Detector puro: { overall, sections } -> Finding[] */
function detectEntropy(input, threshold = 7.5) {
  const findings = [];
  for (const s of input.sections || []) {
    if (s.entropy > threshold) {
      findings.push({
        id: "packer.high-entropy-section",
        severity: "high",
        title: "Seccion " + s.name + " con entropia " + s.entropy.toFixed(2),
        detail: "Entropia > " + threshold + " sugiere payload cifrado/comprimido (posible packer).",
        source: "entropy",
        refs: [s.name]
      });
    }
  }
  if (input.overall > threshold) {
    findings.push({
      id: "packer.high-overall-entropy",
      severity: "medium",
      title: "Entropia global alta (" + input.overall.toFixed(2) + ")",
      detail: "El fichero completo supera " + threshold + " bits/byte; probable empaquetado o cifrado global.",
      source: "entropy",
      refs: []
    });
  }
  return findings;
}

module.exports = { shannonEntropy, detectEntropy };
