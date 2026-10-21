const { parentPort, workerData } = require("worker_threads");

/* Ejecuta un detector en su propio worker. Cada detector es una funcion pura
   (input) => resultado; el orquestador ensambla el AnalysisResult final. */
const DETECTORS = {
  strings: require("./detectors/strings").detectStrings,
  imports: require("./detectors/imports").detectImports,
  yara: require("./detectors/yara").parseYara
};

const { name, input } = workerData;
const fn = DETECTORS[name];
if (!fn) throw new Error("detector desconocido: " + name);
parentPort.postMessage(fn(input));
