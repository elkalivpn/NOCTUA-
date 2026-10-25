# Diseño — Panel de hallazgos mejorado (v0.3.6, issue #20)

Estado: diseñado antes de codificar (regla del proyecto). Alcance del issue #20 del
backlog ampliado: navegación al código, filtros avanzados y exportación de informes.
El panel pasa de "lista agrupada con filtro único de fuente" a una vista de trabajo:
los hallazgos que v0.3.5 multiplicó (strings contextuales) deben ser navegables y
exportables sin salir del panel.

## Objetivo y no-objetivos

- Objetivo: filtros por severidad y fuente, navegación desde el hallazgo hasta su
  localización en el fichero y exportación del análisis como informe JSON o Markdown.
- No-objetivos: desensamblado/decompilación en el panel (v0.4, issue #8), remediación
  automática, comparación entre análisis (diff de hallazgos, posible futuro).

## D1. Filtros avanzados

- Dos ejes de filtro independientes, ambos multiselección: severidad y fuente.
- El estado vive en el renderer como dos conjuntos inicializados "todo activo".
  Un chip "on" = severidad/fuente visible; clic alterna la pertenencia al conjunto.
  Si el usuario desactiva todo, la lista queda vacía con el mensaje existente
  "Sin hallazgos con este filtro." (comportamiento predecible, sin negación vacía).
- La búsqueda de texto se mantiene igual (título + detalle + refs).
- Contador "N/M hallazgos" junto a los filtros: N visibles con el filtro actual,
  M total del análisis. La navegación de la paleta (hv:next/hv:prev) ya respeta
  los hallazgos visibles; con el nuevo filtrado sigue funcionando sin cambios.
- La lógica de filtrado se extrae a funciones puras en `renderer/findings.js`
  (patrón tree.js/palette.js: exportadas bajo guarda `module` para node:test):
  `severityCounts(findings)` y `filterFindings(findings, state)`.

## D2. Navegación al código (offsets)

- Contrato: `FindingSchema` añade `offset: z.number().int().min(0).optional()`.
  Es una extensión compatible hacia atrás: hallazgos previos sin offset siguen
  siendo válidos; un hallazgo sin offset simplemente no muestra navegación.
  La validación con zod en runAnalysis PRESERVA el campo (los objetos zod
  descartan claves desconocidas: sin campo en el esquema, el offset desaparecería).
- Los detectores que conocen una localización concreta lo rellenan; los
  agregados (urls/ips/sospechosas/utf16le son conjuntos, no localizaciones) no.
  En strings (v0.3.5): embedded-json → offset del primer documento JSON,
  embedded-xml → primero XML, base64 → primero blob, blocks → inicio del
  bloque más denso.
- Contexto hex: nuevo módulo puro `src/main/hexdump.js` con `hexDump(bytes, start,
  length)` (filas de 16 bytes, columna de offset, columna ASCII; sin Buffer,
  testeable con Uint8Array) y `readHexWindow(bytes, offset, opts)` (ventana de
  256 bytes centrada en el offset: hasta 64 antes).
- IPC `fs:hexWindow {path, offset}`: el proceso principal lee el fichero y
  devuelve `{offset, hex}`. No amplía la superficie de lectura: el renderer ya
  puede leer cualquier fichero vía `fs:readBinary`; aquí solo se devuelve un
  volcado acotado (256 bytes) y el path siempre es el del análisis en curso.
- Renderer: cada hallazgo con offset muestra un botón "ver @0x…" que carga el
  volcado hex en el panel de detalle (`an-detail`), con la advertencia en línea
  de que el offset es crudo del fichero, no una dirección virtual.
- Salto en el editor: si el fichero analizado está abierto como texto en Monaco,
  se ofrece "ir en el editor (línea N)" calculando línea/columna con la función
  pura `locateOffset(text, byteOffset)` de renderer/findings.js. Límite
  declarado: exacto para ASCII/Latin-1; aproximado para UTF-8 multibyte (los
  índices de string JS cuentan unidades UTF-16, no bytes). En ficheros binarios
  no se ofrece el salto (Monaco no los carga).

## D3. Exportación de informes (JSON y Markdown)

- Nuevo módulo `src/main/report.js`: `buildJsonReport(result, meta)` (resultado
  completo + tool/versión/fecha de generación, determinista, pretty-printed) y
  `buildMarkdownReport(result, meta)` (cabecera con fichero/sha256/tamaño/formato/
  entropía, tabla resumen por severidad, tabla de hallazgos, strings destacadas
  truncadas y nota honesta).
- El informe SIEMPRE exporta el resultado completo del análisis: los filtros del
  panel son para navegar, el informe es el registro del análisis. Se declara en
  el tooltip y en la documentación.
- Higiene Markdown: `escapeCell()` escapa `|` y saltos de línea en las celdas de
  las tablas (un hallazgo con `|` o `\n` en título/detalle/refs no puede romper
  la tabla ni inyectar contenido).
- Validación en el borde del IPC: `findings:export {format, result}` valida el
  resultado con `AnalysisResultSchema.parse` ANTES de construir el informe y el
  formato con whitelist {json, md}. report.js confía en su entrada (contrato
  aplicado por el llamador) y así es testeable sin zod.
- `dialog.showSaveDialog` con defaultPath `informe-<basename>.<ext>`; cancelación
  explícita → `{canceled: true}`. El renderer informa por terminal (term()).
- El informe lleva nota honesta: análisis estático automático, los hallazgos
  heurísticos requieren verificación manual, no constituye evidencia forense,
  offsets crudos del fichero.

## D4. Superficie de cambios

- Núcleo puro: schema.js (+offset), detectors/strings.js (offsets en 4 hallazgos),
  src/main/hexdump.js, src/main/report.js, renderer/findings.js.
- Integración: IPC fs:hexWindow y findings:export (main.js), preload
  (fs.hexWindow, findings.export), index.html (chips de severidad, contador,
  botones de exportación, script findings.js, versión v0.3.6), app.js (estado de
  filtros, chips, navegación, exportación, comandos de paleta hv:export-*),
  styles.css, package.json 0.3.6.
- Tests: tests/hexdump.test.js, tests/report.test.js, tests/findings.test.js
  (nuevos), tests/strings-advanced.test.js (+offsets), tests/renderer-csp.test.js
  (+findings.js).

## D5. Límites declarados (honestidad)

- Los offsets son crudos del fichero, NO direcciones virtuales: sin parseo de
  cabeceras PE/ELF para mapear RVA (futuro con #8 Ghidra headless).
- locateOffset es exacto para ASCII/Latin-1 y aproximado para UTF-8 multibyte.
- El salto en el editor solo se ofrece si el fichero analizado está abierto como
  texto en Monaco; en binarios la vía de navegación es el volcado hex.
- La exportación no filtra: siempre exporta el resultado completo del análisis.
- Validación en arnés de desarrollo (funciones puras con Uint8Array): npm test
  en Node real, la app en Electron y la CI NO se ejecutan desde el agente.
