/* Detector puro de mitigaciones de compilacion (ASLR/DEP/CFG en PE;
   canary en ELF via __stack_chk_fail). Ausencia = superficie de explotacion. */
function detectMitigations(buf, format, imports) {
  const findings = [];
  const names = (imports || []).map((im) => im.name);

  if (format.type && format.type.startsWith("PE") && format.dllCharacteristicsOffset) {
    const dllChar = buf.readUInt16LE(format.dllCharacteristicsOffset);
    if (!(dllChar & 0x0040))
      findings.push({ id: "mitigations.aslr-disabled", severity: "medium", title: "ASLR deshabilitado", detail: "DllCharacteristics sin DYNAMIC_BASE (0x0040): direcciones predecibles.", source: "mitigations", refs: [] });
    if (!(dllChar & 0x0100))
      findings.push({ id: "mitigations.dep-disabled", severity: "high", title: "DEP/NX deshabilitado", detail: "DllCharacteristics sin NX_COMPAT (0x0100): posibles paginas ejecutables de datos.", source: "mitigations", refs: [] });
    if (!(dllChar & 0x4000))
      findings.push({ id: "mitigations.cfg-disabled", severity: "low", title: "Control Flow Guard ausente", detail: "DllChararacteristics sin GUARD_CF (0x4000).", source: "mitigations", refs: [] });
  }

  if (format.type === "ELF32" || format.type === "ELF64") {
    if (!names.includes("__stack_chk_fail"))
      findings.push({ id: "mitigations.canary-missing", severity: "low", title: "Stack canary ausente", detail: "Sin __stack_chk_fail en simbolos dinamicos: compilado probablemente sin -fstack-protector.", source: "mitigations", refs: [] });
  }
  return findings;
}

module.exports = { detectMitigations };
