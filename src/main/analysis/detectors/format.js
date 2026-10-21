const MACHINES = { 0x014c: "x86", 0x8664: "x86-64", 0xaa64: "arm64", 0x01c0: "arm", 0x0200: "ia-64" };
const SUBSYSTEMS = { 1: "NATIVE", 2: "WINDOWS_GUI", 3: "WINDOWS_CUI", 5: "OS2_CUI", 7: "POSIX_CUI", 9: "WINDOWS_CE_GUI", 10: "EFI_APPLICATION", 16: "XBOX" };

/* Detector puro: buffer -> formato. Sin IO, sin estado. */
function detectFormat(buf) {
  const magic2 = buf.subarray(0, 2).toString("latin1");
  const magic4 = buf.subarray(0, 4).toString("hex");

  if (magic2 === "MZ") {
    const format = { type: "PE32", arch: "x86", bits: 32, subsystem: "UNKNOWN", peOffset: -1 };
    try {
      const peOff = buf.readUInt32LE(0x3c);
      if (buf.subarray(peOff, peOff + 4).toString("latin1") === "PE\u0000\u0000") {
        format.peOffset = peOff;
        const machine = buf.readUInt16LE(peOff + 4);
        format.arch = MACHINES[machine] || "desconocido";
        format.bits = (machine === 0x8664 || machine === 0xaa64) ? 64 : 32;
        format.type = format.bits === 64 ? "PE32+" : "PE32";
        const optHeader = peOff + 24;
        const optMagic = buf.readUInt16LE(optHeader);
        if (optMagic === 0x20b || optMagic === 0x10b) {
          format.subsystem = SUBSYSTEMS[buf.readUInt16LE(optHeader + 0x44)] || "UNKNOWN";
          format.dllCharacteristicsOffset = optHeader + 0x46;
        }
      }
    } catch { /* cabecera truncada: datos parciales */ }
    return format;
  }

  if (magic4 === "7f454c46") {
    const bits = buf[4] === 2 ? 64 : 32;
    const machine = buf.readUInt16LE(18);
    return { type: bits === 64 ? "ELF64" : "ELF32", arch: MACHINES[machine] || "desconocido", bits, peOffset: -1 };
  }

  if (magic2 === "#!") return { type: "Script", arch: "-", bits: 0, peOffset: -1 };
  if (magic4 === "504b0304") return { type: "ZIP/APK/JAR", arch: "-", bits: 0, peOffset: -1 };
  return { type: "desconocido", arch: "-", bits: 0, peOffset: -1 };
}

/* Tabla de secciones PE (nombre, tamano, offset en fichero). ELF: lista vacia por ahora. */
function parseSections(buf, format) {
  if (format.peOffset < 0 || format.type.indexOf("PE") !== 0) return [];
  try {
    const num = buf.readUInt16LE(format.peOffset + 6);
    const optSize = buf.readUInt16LE(format.peOffset + 20);
    const table = format.peOffset + 24 + optSize;
    const sections = [];
    for (let i = 0; i < num && i < 96; i++) {
      const e = table + i * 40;
      const name = buf.subarray(e, e + 8).toString("latin1").replace(/\0+$/, "");
      const size = buf.readUInt32LE(e + 16);
      const offset = buf.readUInt32LE(e + 20);
      if (name && size > 0 && offset + size <= buf.length) sections.push({ name, size, offset });
    }
    return sections;
  } catch { return []; }
}

function formatFindings(format) {
  const findings = [];
  if (format.type === "desconocido")
    findings.push({ id: "format.unknown", severity: "low", title: "Formato no reconocido", detail: "La cabecera no coincide con PE, ELF, script ni ZIP. Posible binario mutilado, cargador de boot o formato propio de malware.", source: "format", refs: [] });
  return findings;
}

module.exports = { detectFormat, parseSections, formatFindings };
