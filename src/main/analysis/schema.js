const { z } = require("zod");

/* Contrato del hallazgo: el parser lo produce, el panel lo pinta,
   el agente lo consume. Un unico formato = cero acoplamiento. */
const FindingSchema = z.object({
  id: z.string(),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  title: z.string(),
  detail: z.string(),
  source: z.string(),
  refs: z.array(z.string()).default([]),
  /* offset crudo opcional (v0.3.6, issue #20): localizacion del hallazgo
     cuando el detector la conoce (navegacion del panel). NO es una VA. */
  offset: z.number().int().min(0).optional()
});

const AnalysisResultSchema = z.object({
  file: z.object({
    path: z.string(),
    sha256: z.string(),
    md5: z.string(),
    size: z.number()
  }),
  format: z.object({
    type: z.string(),
    arch: z.string().optional(),
    bits: z.number().optional(),
    subsystem: z.string().optional()
  }),
  entropy: z.object({
    overall: z.number(),
    sections: z.array(z.object({
      name: z.string(),
      size: z.number(),
      entropy: z.number()
    }))
  }),
  findings: z.array(FindingSchema),
  yara: z.array(z.object({
    rule: z.string(),
    namespace: z.string().optional()
  })).default([]),
  strings: z.object({
    interesting: z.array(z.string()),
    urls: z.array(z.string()),
    ips: z.array(z.string()),
    utf16: z.array(z.string()).default([]),
    embedded: z.array(z.string()).default([])
  })
});

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function sortFindings(findings) {
  return [...findings].sort((a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
}

module.exports = { FindingSchema, AnalysisResultSchema, validateResult: (r) => AnalysisResultSchema.parse(r), sortFindings, SEVERITY_ORDER };
