const URL_RE = /(https?:\/\/[A-Za-z0-9._~:\/?#@!$&'()*+,;=%-]+)/g;
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const SUSPICIOUS = [
  "cmd.exe", "powershell", "/c ", "/k ", "CurrentVersion\\Run", "schtasks",
  "vssadmin", "bcdedit", "reg add", "taskkill", "rundll32",
  "VirtualAlloc", "CreateRemoteThread", "IsDebuggerPresent",
  "svchost.exe", "lsass", "ransom", "bitcoin", "wallet", "onion", "gate.php"
];

/* Extraccion ASCII pura (min. 5 chars imprimibles consecutivos). */
function extractStrings(buf, minLen = 5) {
  const strings = [];
  let start = -1;
  for (let i = 0; i <= buf.length; i++) {
    const c = i < buf.length ? buf[i] : 0;
    const printable = c >= 0x20 && c < 0x7f;
    if (printable && start === -1) start = i;
    if (!printable && start !== -1) {
      if (i - start >= minLen) strings.push(buf.subarray(start, i).toString("latin1"));
      start = -1;
    }
  }
  return strings;
}

/* Detector puro (CPU-bound: corre en worker): { buffer } -> { strings, findings } */
function detectStrings(input) {
  const all = extractStrings(input.buffer);
  const urls = [...new Set(all.join("\n").match(URL_RE) || [])].slice(0, 50);
  const ips = [...new Set(all.join("\n").match(IP_RE) || [])].slice(0, 50);
  const interesting = all.filter((s) =>
    SUSPICIOUS.some((k) => s.toLowerCase().includes(k.toLowerCase()))).slice(0, 50);

  const findings = [];
  if (urls.length)
    findings.push({ id: "strings.urls", severity: "low", title: urls.length + " URL(s) embebidas", detail: "Posibles C2 o servidores de descarga: " + urls.slice(0, 3).join(", "), source: "strings", refs: urls.slice(0, 5) });
  if (ips.length)
    findings.push({ id: "strings.ips", severity: "low", title: ips.length + " IP(s) embebidas", detail: ips.slice(0, 3).join(", "), source: "strings", refs: ips.slice(0, 5) });
  if (interesting.length)
    findings.push({ id: "strings.suspicious", severity: "medium", title: "Cadenas sospechosas", detail: "Cadenas compatibles con ejecucion de comandos, persistencia o analisis-deteccion: " + interesting.slice(0, 4).join(" | "), source: "strings", refs: interesting.slice(0, 10) });
  return { strings: { interesting, urls, ips }, findings };
}

module.exports = { detectStrings, extractStrings };
