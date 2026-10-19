// Gargraph · sube en uno el último número de VERSION en sw.js ("3.1.0" → "3.1.1").
// Lo usa la tarea diaria de GitHub cuando cambian los datos: así los móviles ven un sw.js distinto y ofrecen actualizar.
//
//   node herramientas/subir-version.mjs

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ruta = join(dirname(fileURLToPath(import.meta.url)), "..", "sw.js");
const codigo = await readFile(ruta, "utf8");
const encontrada = /const VERSION = "(\d+)\.(\d+)\.(\d+)";/.exec(codigo);
if (!encontrada) throw new Error("No se encuentra la línea const VERSION = \"x.y.z\"; en sw.js");
const [, mayor, menor, parche] = encontrada;
const nueva = `${mayor}.${menor}.${Number(parche) + 1}`;
await writeFile(ruta, codigo.replace(encontrada[0], `const VERSION = "${nueva}";`));
console.log(`VERSION de sw.js: ${mayor}.${menor}.${parche} → ${nueva}`);
