// Datos del simulador de combates: datos/combate.json (lo que el motor necesita de cada movimiento y
// que el diccionario no trae; lo escribe herramientas/generar-datos.mjs) y los formatos ya cargados.
// En el navegador se piden con fetch; en Node (herramientas/probar-sim.mjs) se leen del disco.
import { cargarFormato, cargarMeta, dic } from "../meta.js";
import { usarTablaDeTipos } from "../tipos.js";

const EN_NODE = typeof document === "undefined" && typeof process !== "undefined" && Boolean(process.versions?.node);

let combate = null;
let carga = null;                // la promesa de la primera carga, para no repetirla
const formatos = new Map();      // id del formato → sus datos

async function leerDelDisco(ruta) {
  const { readFile } = await import("node:fs/promises");
  return JSON.parse(await readFile(new URL(`../../${ruta}`, import.meta.url), "utf8"));
}

// API del navegador: Fetch API, para leer los ficheros de datos de la app
async function leerJson(ruta) {
  if (EN_NODE) return leerDelDisco(ruta);
  const respuesta = await fetch(ruta);
  if (!respuesta.ok) throw new Error(`No se ha podido leer ${ruta} (código ${respuesta.status})`);
  return respuesta.json();
}

// js/meta.js pide sus ficheros con fetch y rutas de la app. El fetch de Node no las entiende, así que
// mientras dura la carga esas rutas se leen del disco; las direcciones completas siguen yendo a la red.
let fetchDeNode = null;
let cargasEnCurso = 0;

async function conDisco(tarea) {
  if (!EN_NODE) return tarea();
  if (cargasEnCurso++ === 0) {
    fetchDeNode = globalThis.fetch;
    globalThis.fetch = async (ruta, ...resto) => (/^[a-z][a-z0-9+.-]*:/i.test(String(ruta))
      ? fetchDeNode(ruta, ...resto)
      : { ok: true, status: 200, json: () => leerDelDisco(String(ruta)) });
  }
  try {
    return await tarea();
  } finally {
    if (--cargasEnCurso === 0) globalThis.fetch = fetchDeNode;
  }
}

/**
 * Deja listo lo que el motor usa sin esperar: el diccionario, la tabla de tipos y los datos de combate.
 * Con el id de un formato carga además sus datos, para poder pasarle ese id a crearCombate().
 * Devuelve { combate, formato }.
 */
export async function cargarDatos(idFormato) {
  carga ??= conDisco(async () => {
    if (!dic()) await cargarMeta();
    usarTablaDeTipos(dic().tabla);
    combate = await leerJson("datos/combate.json");
  });
  carga.catch(() => { carga = null; });   // si falla, se puede volver a intentar
  await carga;
  let formato = null;
  if (idFormato) {
    formato = await conDisco(() => cargarFormato(idFormato));
    formatos.set(idFormato, formato);
  }
  return { combate, formato };
}

/** Los datos de combate: { movimientos: { id: {…} }, pesos: { especie: kg } }. Antes hay que esperar a cargarDatos(). */
export function datosDeCombate() {
  if (!combate) throw new Error("Los datos de combate no están cargados: espera antes a cargarDatos()");
  return combate;
}

/** Los datos de un formato que ya se pidió con cargarDatos(id), o null. */
export function formatoCargado(id) {
  return formatos.get(id) ?? null;
}
