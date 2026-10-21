const SYSTEM_PROMPT = `Eres el agente de código de NOCTUA, un IDE de investigación de seguridad para analistas autorizados (pentesting con permiso, CTF, investigación de malware en sandbox). Dominas: explotación de memoria, ROP, análisis estático/dinámico, fuzzing dirigido por cobertura, ingeniería inversa, YARA/CAPA/MITRE ATT&CK y desarrollo de exploits éticos. Reglas: trabajas solo en entornos controlados y con autorización explícita; explicas cada paso; produces código ejecutable y comentado; señalas riesgos.`;

const TRIAGE_SYSTEM_PROMPT = `Eres analista de malware senior. Recibes el resultado de triaje estático de un binario generado en NOCTUA. No afirmes familia concreta de malware salvo firma YARA explícita presente en el input. Responde SIEMPRE en JSON, sin texto fuera del JSON, con esta forma:
{"risk":"low|medium|high|critical","confidence":0-100,
 "summary":"2-3 frases","likely_behavior":["..."],
 "next_steps":[{"action":"...","tool":"rizin|ghidra|sandbox|fuzzing","why":"..."}],
 "ioc_candidates":["..."],
 "unknowns":["evidencia que falta y por qué no se concluye"]}
Restricción obligatoria: basa cada afirmación SOLO en campos presentes en el input JSON. Si falta evidencia para algo, dilo en "unknowns" en lugar de especular.`;

class AIAgent {
  constructor(cfg) { this.cfg = cfg; this.provider = cfg.provider || "mistral"; }
  setProvider(p) { this.provider = p; }
  describe() {
    return this.provider === "mistral"
      ? "API Mistral · " + this.cfg.mistral.model
      : "Ollama local · " + this.cfg.ollama.model;
  }
  buildContext(context = {}) {
    const parts = [];
    if (context.activeFile) parts.push("Fichero activo: " + context.activeFile);
    if (context.code) parts.push("Código:\n" + context.code);
    if (context.diagnostics?.length)
      parts.push("Diagnósticos: " + context.diagnostics.map((d) => d.message).join("; "));
    if (context.findings?.length)
      parts.push("Hallazgos de análisis: " + context.findings.join("; "));
    return parts.join("\n\n");
  }

  async complete(prompt, context) {
    return this.#dispatch([
      { role: "system", content: SYSTEM_PROMPT },
      ...(context ? [{ role: "system", content: "Contexto del IDE:\n" + context }] : []),
      { role: "user", content: prompt }
    ]);
  }

  /* Triaje: no se envia el fichero, solo el JSON del contrato de hallazgos. */
  async explain(result) {
    const compact = JSON.stringify(result);
    const raw = await this.#dispatch([
      { role: "system", content: TRIAGE_SYSTEM_PROMPT },
      { role: "user", content: "Resultado de triaje estático (JSON):\n" + compact }
    ]);
    return this.#parseJSON(raw);
  }

  #parseJSON(raw) {
    let t = String(raw).trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) t = fence[1].trim();
    const first = t.indexOf("{"), last = t.lastIndexOf("}");
    if (first >= 0 && last > first) t = t.slice(first, last + 1);
    try { return JSON.parse(t); }
    catch { return { parse_error: true, raw: String(raw).slice(0, 2000) }; }
  }

  async #dispatch(messages) {
    return this.provider === "mistral"
      ? this.#callMistral(messages)
      : this.#callOllama(messages);
  }

  async #callMistral(messages) {
    const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + this.cfg.mistral.apiKey },
      body: JSON.stringify({ model: this.cfg.mistral.model, messages, temperature: 0.2 })
    });
    if (!res.ok) throw new Error("Mistral API " + res.status);
    const data = await res.json();
    return data.choices[0].message.content;
  }

  async #callOllama(messages) {
    const res = await fetch(this.cfg.ollama.url + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.cfg.ollama.model, messages, stream: false })
    });
    if (!res.ok) throw new Error("Ollama " + res.status + " — ¿está el servicio activo? (systemctl start ollama)");
    const data = await res.json();
    return data.message.content;
  }
}

module.exports = { AIAgent };
