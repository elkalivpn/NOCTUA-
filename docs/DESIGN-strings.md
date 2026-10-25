# Diseño — Análisis de strings contextual (v0.3.5, issue #15)

Estado: implementado en v0.3.5. Este documento recoge las decisiones adoptadas y los límites honestos del extractor de strings mejorado del análisis estático.

## Motivación

El detector de la v0.2 extraía cadenas ASCII y aplicaba regex plano sobre el resultado (URLs, IPs, palabras sospechosas). Los binarios reales contienen más: cadenas UTF-16LE, configuraciones embebidas como JSON o XML, blobs base64 y regiones densas de cadenas (tablas). El objetivo de esta mejora es extraer con contexto, no ampliar la regex.

## Decisiones adoptadas

1. Dos pasadas de extracción: ASCII (>= 5 caracteres imprimibles consecutivos) y UTF-16LE en ambas alineaciones (par e impar), porque Windows usa UTF-16LE de forma dominante y sin desensamblar no se puede garantizar la alineación de la tabla. Las URL, IPs y sospechosas se computan sobre la unión de ambas pasadas.
2. Contexto de bloques: las cadenas ASCII se agrupan por proximidad; un hueco de >= 64 bytes no imprimibles abre un bloque nuevo. El hallazgo strings.blocks (severidad info) señala los offsets del bloque más denso: primera aproximación a "dónde está la tabla de configuración" sin desensamblar.
3. JSON embebido: escaneo de candidatos balanceados ({ } o [ ]) con manejo de cadenas y escapes; un documento solo se acepta si JSON.parse lo valida, tiene al menos una clave (o dos elementos si es array) y 16 caracteres. Severidad medium: posible configuración (C2, persistencia).
4. XML embebido: heurística — etiqueta raíz de apertura con su cierre presente, o prólogo <?xml; longitud mínima 32. Severidad low y título marcado como heurístico: se pide verificación manual porque las marcas de documentos pueden generar falsos positivos.
5. Base64: runs de >= 40 caracteres del alfabeto; decodificador interno (sin Buffer: el módulo es testeable con Uint8Array); solo se acepta si el contenido decodificado tiene >= 24 bytes y >= 85% imprimible. Severidad low con extracto decodificado en refs.
6. Contrato: los hallazgos usan FindingSchema tal cual (id, severity, title, detail, source "strings", refs). El objeto strings del AnalysisResult se amplía con strings.utf16 y strings.embedded (arrays de extractos etiquetados json:/xml:/base64:), con default [] para compatibilidad con resultados previos. El panel del renderer no requiere cambios: ya agrupa por severidad (incluida info) y filtra por fuente.

## Límites honestos

- El contexto de bloques no distingue código de datos: sin desensamblado, un bloque denso puede ser .rdata, una tabla de errores de un compilador o una configuración real. El hallazgo lo enuncia como indicador de región, no como evidencia.
- El XML es heurístico y puede generar falsos positivos; por eso severidad low y verificación manual.
- Un JSON validado con JSON.parse es evidencia fuerte de estructura embebida, pero no prueba intención maliciosa por sí mismo.
- UTF-16BE no se extrae en esta fase (raro en malware de Windows); puede añadirse después con el mismo patrón de pasadas.
- Los offsets reportados son sobre el fichero crudo: en PE con secciones comprimidas no corresponden a la dirección virtual.
- Los extractos se acotan (refs a 120 caracteres, embedded a 160, hallazgo de bloques a 5 bloques) para que un binario grande no sature el panel.

## Tests

tests/strings-advanced.test.js: fixtures sintéticos generados en runtime con Uint8Array (portables, sin binarios en el repo, sin Buffer): JSON válido e inválido, XML heurístico, UTF-16LE con URL, base64 decodificable, bloques de contexto y regresión del comportamiento v0.2 (URLs, IPs, sospechosas y el contrato previo de extractStrings).
