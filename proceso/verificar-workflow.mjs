// Comprueba la sintaxis de un script de la herramienta `workflow`, que no es un módulo
// ejecutable: el harness lo envuelve en una función con `agent`, `parallel`, `phase`,
// `log` y `args` en el ámbito. Por eso `node --check` falla por el `return` de nivel
// superior y aquí se compila dentro de una función asíncrona.
//
// Uso: node proceso/verificar-workflow.mjs [ruta]

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ruta = resolve(process.argv[2] ?? new URL("./workflow.mjs", import.meta.url).pathname);
const cuerpo = readFileSync(ruta, "utf8");

try {
  // Compila sin ejecutar: valida paréntesis, bloques, await y return de nivel superior.
  new Function(`return (async () => {\n${cuerpo}\n});`);
  console.log(`ok ${ruta}`);
} catch (error) {
  console.error(`FALLA ${ruta}\n${error.message}`);
  process.exit(1);
}
