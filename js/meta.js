// Datos competitivos: las estadísticas de uso de Smogon que prepara herramientas/generar-datos.mjs,
// y el diccionario con especies, movimientos, objetos, habilidades, naturalezas y tabla de tipos.
// Son ficheros de la propia app (datos/), así que funcionan sin conexión cuando ya están guardados.
import { leer } from "./estado.js";
import { claveDeNombreEspanol } from "./pokeapi.js";

let meta = null;
let diccionario = null;
const formatos = new Map();         // id del formato → promesa con sus datos
const nombrePorClave = new Map();   // clave de PokeAPI («landorus-therian») → nombre de Showdown («Landorus-Therian»)
const clavePorId = new Map();       // «landorustherian» → «landorus-therian», para las búsquedas
const nombrePorId = new Map();      // «landorustherian» → «Landorus-Therian»

// Formato que se usa si no se ha elegido ninguno: el actual de Pokémon Champions
export const FORMATO_POR_DEFECTO = "gen9championsvgc2026regmc";

export const ABREVIATURAS = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"];

// Grupos por puesto de uso (no son los tiers oficiales de Smogon): S son los 6 más usados del formato, A del 7 al 15, etc.
export const TIERS_DE_USO = [
  { tier: "S", hasta: 6 },
  { tier: "A", hasta: 15 },
  { tier: "B", hasta: 30 },
  { tier: "C", hasta: 50 },
  { tier: "D", hasta: Infinity },
];

/** Identificador de Showdown: minúsculas sin espacios ni signos («Mr. Mime» → «mrmime»). */
export function aId(texto) {
  return String(texto).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// API del navegador: Fetch API, para leer los ficheros de datos de la app
async function leerJson(ruta) {
  const respuesta = await fetch(ruta);
  if (!respuesta.ok) throw new Error(`Could not load ${ruta} (code ${respuesta.status})`);
  return respuesta.json();
}

export async function cargarMeta() {
  [meta, diccionario] = await Promise.all([leerJson("datos/meta.json"), leerJson("datos/diccionario.json")]);
  // Campos que algunas pantallas leen y que un formato puede no traer: se deducen del grupo y del id
  for (const f of meta.formatos) {
    f.champions ??= (f.grupo ?? f.juego) === "Pokémon Champions" || /champions/.test(f.id);
    f.corto ??= f.nombre;
    f.usoMinimo ??= 0.5;
  }
  for (const [nombre, especie] of Object.entries(diccionario.especies)) {
    if (!especie.aproximada && !nombrePorClave.has(especie.clave)) nombrePorClave.set(especie.clave, nombre);
    if (!clavePorId.has(aId(nombre))) clavePorId.set(aId(nombre), especie.clave);
    if (!nombrePorId.has(aId(nombre))) nombrePorId.set(aId(nombre), nombre);
  }
}

export function infoMeta() {
  return meta;
}

export function dic() {
  return diccionario;
}

export function formatoActual() {
  const elegido = leer().perfil.formato;
  if (meta.formatos.some((f) => f.id === elegido)) return elegido;
  return meta.formatos.some((f) => f.id === FORMATO_POR_DEFECTO) ? FORMATO_POR_DEFECTO : meta.formatos[0].id;
}

export function resumenFormato(id = formatoActual()) {
  return meta.formatos.find((f) => f.id === id);
}

/** true si el formato sale de equipos de torneo (Limitless) y no de partidas de Showdown (Smogon). «formato»: su resumen o su JSON. */
export function esDeTorneos(formato) {
  return (formato?.fuente ?? resumenFormato(formato?.id)?.fuente) === "limitless";
}

/**
 * Lo que se sabe de dónde salen los datos de un formato, juntando su resumen (meta.json) y su JSON:
 * { torneos: bool, nTorneos, actualizado, mes, partidas, corte, cerrado }.
 */
export function infoFuente(formato) {
  const f = { ...resumenFormato(formato?.id), ...formato };
  return {
    torneos: esDeTorneos(f), nTorneos: f.torneos ?? null, actualizado: f.actualizado ?? null,
    mes: f.mes ?? null, partidas: f.partidas ?? null, corte: f.corte ?? null, cerrado: Boolean(f.cerrado),
  };
}

/**
 * El formato de Smogon que hace de respaldo de repartos para uno de torneos (Limitless no da EVs): el de su misma
 * regulación y modo, es decir, aquel cuyo id es el principio del id del formato de torneos (el más largo). null si no hay.
 */
export function formatoDeRepartos(formato) {
  const id = formato?.id ?? "";
  const modo = resumenFormato(id)?.modo ?? formato?.modo;
  return meta.formatos
    .filter((f) => !esDeTorneos(f) && f.id !== id && id.startsWith(f.id) && f.modo === modo)
    .sort((a, b) => b.id.length - a.id.length)[0] ?? null;
}

/** El formato de torneos que corresponde a uno de partidas (VGC M-C de Smogon → VGC M-C de torneos). null si no hay. */
export function formatoDeTorneos(id = formatoActual()) {
  if (esDeTorneos(resumenFormato(id))) return resumenFormato(id);
  return meta.formatos.filter((f) => esDeTorneos(f) && f.id.startsWith(id)).sort((a, b) => a.id.length - b.id.length)[0] ?? null;
}

export function cargarFormato(id = formatoActual()) {
  if (!formatos.has(id)) {
    const promesa = leerJson(`datos/formatos/${id}.json`).then(async (datos) => {
      datos.porNombre = new Map(datos.pokemon.map((p) => [p.nombre, p]));
      // Lo que el JSON no repita de su resumen de meta.json (reglas del formato) se toma de allí
      for (const [clave, valor] of Object.entries(resumenFormato(id) ?? {})) datos[clave] ??= valor;
      datos.nucleos ??= [];
      // Torneos: sin repartos propios. Se guardan aparte (spreadsRespaldo) los del formato de Smogon de la misma regulación,
      // para el simulador, los equipos y las velocidades; «spreads» queda como venga, así la Dex no los enseña como suyos.
      if (esDeTorneos(datos)) {
        const hermano = formatoDeRepartos(datos);
        const base = hermano ? await cargarFormato(hermano.id).catch(() => null) : null;
        if (base) {
          datos.respaldoRepartos = { id: base.id, nombre: base.nombre };
          for (const p of datos.pokemon) p.spreadsRespaldo = base.porNombre.get(p.nombre)?.spreads ?? [];
        }
      }
      return datos;
    });
    promesa.catch(() => formatos.delete(id)); // si falla, se puede volver a intentar
    formatos.set(id, promesa);
  }
  return formatos.get(id);
}

/**
 * Histórico de uso de un formato (datos/historico/<id>.json): { formato, meses: ["2026-04", …], pokemon: { "Great Tusk":
 * [{ mes, uso, puesto }] } }. «uso» es una fracción (0,3315 = 33,15 %), «meses» va del más antiguo al más reciente y un
 * Pokémon sin entrada en un mes no aparecía en él. Devuelve null si no hay fichero.
 */
const historicos = new Map();       // id del formato → promesa con su histórico (o null)
export function cargarHistorico(id = formatoActual()) {
  // meta.json dice qué capas tiene cada formato («capas»): si dice que no hay, no se pide (sería un 404 en la consola)
  if (resumenFormato(id)?.capas?.historico === false) return Promise.resolve(null);
  // Si falla (sin conexión y sin copia guardada) no se recuerda el fallo: al volver la conexión se puede pedir otra vez
  if (!historicos.has(id)) historicos.set(id, leerJson(`datos/historico/${id}.json`).catch(() => { historicos.delete(id); return null; }));
  return historicos.get(id);
}

/**
 * Últimos 7 días de un formato (datos/recientes/<id>.json, de las repeticiones públicas de Showdown): { generado, desde, hasta,
 * partidas, ratingMinimo, muestraPequena, pokemon: [{ nombre, puesto, uso, equipos }] }. «uso» es un % (48,2 = 48,2 %), como en el
 * fichero del formato. Devuelve null si el formato no tiene esa capa (la app no enseña entonces el selector de periodo).
 */
const recientes = new Map();        // id del formato → promesa con sus últimos 7 días (o null)
export function cargarRecientes(id = formatoActual()) {
  if (resumenFormato(id)?.capas?.recientes === false) return Promise.resolve(null);
  if (!recientes.has(id)) {
    const promesa = leerJson(`datos/recientes/${id}.json`)
      .then((datos) => (datos?.pokemon?.length ? datos : null))
      .catch(() => { recientes.delete(id); return null; }); // sin conexión: se podrá pedir otra vez
    recientes.set(id, promesa);
  }
  return recientes.get(id);
}

/**
 * Torneos recientes de un formato de torneos (datos/torneos/<id>.json): { actualizado, torneos: [{ id, nombre, fecha, jugadores,
 * url, top: [{ puesto, jugador, record, equipo: [{ especie, objeto, habilidad, tera, movimientos }] }] }] }. Null si no hay fichero.
 */
const torneos = new Map();          // id del formato → promesa con sus torneos (o null)
export function cargarTorneos(id) {
  if (!torneos.has(id)) {
    torneos.set(id, leerJson(`datos/torneos/${id}.json`).then((d) => (Array.isArray(d?.torneos) ? d : null)).catch(() => { torneos.delete(id); return null; }));
  }
  return torneos.get(id);
}

// Qué periodo se enseña en Inicio y en Clasificación: "mes" (Smogon, por defecto) o "semana" (Showdown). Vale mientras la app esté abierta.
let periodo = "mes";
export function periodoActual() {
  return periodo;
}
export function fijarPeriodo(nuevo) {
  periodo = nuevo === "semana" ? "semana" : "mes";
}

// ---------------------------------------------------------------------------
// Especies

export function especie(nombre) {
  return diccionario.especies[nombre];
}

export function nombresDeEspecies() {
  return Object.keys(diccionario.especies);
}

export function nombreDeClave(clave) {
  return nombrePorClave.get(clave) ?? null;
}

/** Nombre de Showdown a partir de lo que escribe el usuario («great tusk» → «Great Tusk»). */
export function nombreDeEspecie(texto) {
  return nombrePorId.get(aId(texto)) ?? nombreDeClave(claveDeBusqueda(texto));
}

/** Nombre para mostrar de una clave de PokeAPI: el de Showdown o, si no tiene, «iron-valiant» → «Iron-Valiant». */
export function nombreDesdeClave(clave) {
  return nombreDeClave(clave) ?? clave.split("-").map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1)).join("-");
}

/**
 * Lo que escribe el usuario → clave para la PokeAPI («Urshifu» → «urshifu-single-strike», «mr mime» → «mr-mime»).
 * También acepta el nombre en español de las fichas ya abiertas en esta sesión («Melenaleteo» → «flutter-mane»):
 * los datos de la app no traen los nombres en español del resto.
 */
export function claveDeBusqueda(texto) {
  const limpio = texto.trim().toLowerCase();
  return clavePorId.get(aId(limpio)) ?? claveDeNombreEspanol(limpio) ?? limpio.replace(/\s+/g, "-");
}

/** Enlace a la ficha de una especie de Showdown. Si la PokeAPI no tiene esa forma, la de su especie base. */
export function rutaDex(nombre) {
  const e = especie(nombre);
  if (!e) return `#/dex/${encodeURIComponent(claveDeBusqueda(nombre))}`;
  return e.aproximada ? `#/dex/${e.clave}?forma=${encodeURIComponent(nombre)}` : `#/dex/${e.clave}`;
}

/** Entradas del formato que son de la misma especie (Salamence y Salamence-Mega, las formas de Rotom…). */
export function formasEnFormato(formato, nombre) {
  const base = especie(nombre)?.especie ?? nombre;
  return formato.pokemon.filter((p) => p.nombre === base || especie(p.nombre)?.especie === base);
}

/**
 * Datos de uso que corresponden a la ficha. Si se busca la especie base (Salamence) y en el formato
 * solo se usa otra forma (Salamence-Mega), se muestra esa; si se busca una forma concreta, solo esa.
 */
export function entradaParaDex(formato, nombre) {
  if (!nombre) return { formas: [], elegida: null };
  const formas = formasEnFormato(formato, nombre);
  const esBase = !especie(nombre)?.especie;
  const elegida = formas.find((p) => p.nombre === nombre) ?? (esBase ? formas[0] : null) ?? null;
  return { formas, elegida };
}

export function tierDeUso(puesto) {
  return TIERS_DE_USO.find((t) => puesto <= t.hasta).tier;
}

/**
 * Lo que significa cada grupo, leído de TIERS_DE_USO: [{ tier, texto }] con «top 6 most used», «#7 to #15»…
 * El último grupo, «el resto», añade el uso mínimo del formato si se le pasa (formato.usoMinimo, en %).
 */
export function explicacionGruposDeUso(usoMinimo) {
  let desde = 1;
  return TIERS_DE_USO.map(({ tier, hasta }) => {
    let texto;
    if (hasta === Infinity) {
      texto = `the rest${usoMinimo ? ` with at least ${usoMinimo.toLocaleString("en-US")}% usage` : ""}`;
    } else if (desde === 1) {
      texto = `top ${hasta} most used`;
    } else {
      texto = `#${desde} to #${hasta}`;
    }
    desde = hasta + 1;
    return { tier, texto };
  });
}

// ---------------------------------------------------------------------------
// Nombres oficiales en inglés (campo «en» del diccionario). Si aún no está, el id con formato legible; nunca el «es».

/** «icespinner» → «Icespinner»; «u-turn» → «U-Turn». Solo para cuando el diccionario no trae «en». */
function nombreLegible(id) {
  return String(id).split(/[-\s]+/).map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1)).join(" ");
}

export const nombreMovimiento = (id) => diccionario.movimientos[id]?.en ?? nombreLegible(id);
export const nombreObjeto = (id) => diccionario.objetos[id]?.en ?? nombreLegible(id);
export const nombreHabilidad = (id) => diccionario.habilidades[id]?.en ?? nombreLegible(id);
// Las naturalezas ya se guardan con su nombre en inglés («Jolly»)
export const nombreNaturaleza = (naturaleza) => diccionario.naturalezas[naturaleza]?.en ?? naturaleza;

/** Busca un movimiento, objeto o habilidad por su nombre en inglés o en español, o por su id. */
export function buscarId(tabla, texto) {
  const buscado = aId(texto);
  if (!buscado) return null;
  if (diccionario[tabla][buscado]) return buscado;
  const encontrado = Object.entries(diccionario[tabla]).find(([, d]) => aId(d.es) === buscado || aId(d.en) === buscado);
  return encontrado?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// Estadísticas reales

export function maximoPorEstadistica(formato) {
  return formato.champions ? 32 : 252;
}

export function maximoTotal(formato) {
  return formato.champions ? 66 : 510;
}

/**
 * true si un reparto se puede usar en el formato: seis enteros de 0 en adelante, ninguno por encima de
 * maximoPorEstadistica(formato) y la suma sin pasar de maximoTotal(formato).
 * Champions: puntos de estadística (32 y 66). El resto: EVs (252 y 510). No convierte EVs en puntos.
 */
export function repartoValido(valores, formato) {
  if (!Array.isArray(valores) || valores.length !== 6) return false;
  if (!valores.every((v) => Number.isInteger(v) && v >= 0 && v <= maximoPorEstadistica(formato))) return false;
  return valores.reduce((suma, v) => suma + v, 0) <= maximoTotal(formato);
}

/** true si el formato usa teratipos (campo «tera» de su JSON; en Champions no hay). */
export function formatoTieneTera(formato) {
  return formato?.tera === true;
}

export function valoresDeSpread(texto) {
  return texto.split("/").map(Number);
}

/**
 * Estadísticas reales con una naturaleza y un reparto.
 * - Juegos principales: las fórmulas de siempre con EVs (de 0 a 252), el nivel y los IVs del formato
 *   (campos «nivel» e «ivs» de su JSON). Si el formato no trae «ivs», no se calcula y cada estadística es null.
 * - Pokémon Champions: nivel 50 y puntos de estadística (de 0 a 32) en lugar de EVs. Fórmula sacada
 *   del simulador de Showdown (data/mods/champions/scripts.ts): PS = base + puntos + 75 y el resto,
 *   (base + puntos + 20) por la naturaleza.
 */
export function estadisticasReales(base, naturaleza, valores, formato) {
  // Champions no usa IVs; en el resto, sin el dato del formato no se inventa uno
  if (!formato.champions && !Number.isInteger(formato.ivs)) return base.map(() => null);
  const efecto = diccionario.naturalezas[naturaleza] ?? {};
  return base.map((b, i) => {
    if (i === 0 && b === 1) return 1; // Shedinja siempre tiene 1 PS
    const porNaturaleza = (valor) => {
      if (efecto.sube === i) return Math.floor((valor * 110) / 100);
      if (efecto.baja === i) return Math.floor((valor * 90) / 100);
      return valor;
    };
    if (formato.champions) {
      return i === 0 ? b + valores[i] + 75 : porNaturaleza(b + valores[i] + 20);
    }
    const nivel = formato.nivel;
    const parcial = Math.floor(((2 * b + formato.ivs + Math.floor(valores[i] / 4)) * nivel) / 100);
    return i === 0 ? parcial + nivel + 10 : porNaturaleza(parcial + 5);
  });
}

export function textoSpread(naturaleza, valores) {
  const partes = valores.map((v, i) => (v ? `${v} ${ABREVIATURAS[i]}` : null)).filter(Boolean);
  return `${partes.join(" / ") || "Uninvested"} (${nombreNaturaleza(naturaleza)})`;
}

/** El set más habitual: el objeto, la habilidad, la tera y el spread más usados y los 4 movimientos más usados. */
export function setMasUsado(entrada, formato) {
  // En los formatos de torneos no hay repartos: se usa el del formato de Smogon de respaldo, si lo hay
  const [naturaleza, valores] = entrada.spreads?.[0] ?? entrada.spreadsRespaldo?.[0] ?? ["Serious", "0/0/0/0/0/0"];
  return {
    especie: entrada.nombre,
    objeto: entrada.objetos?.[0]?.[0] ?? null,
    habilidad: entrada.habilidades?.[0]?.[0] ?? null,
    tera: formato.tera ? (entrada.tera?.[0]?.[0] ?? null) : null,
    naturaleza,
    valores: valoresDeSpread(valores),
    movimientos: (entrada.movimientos ?? []).slice(0, 4).map(([id]) => id),
  };
}

// ---------------------------------------------------------------------------
// Sets de respaldo (datos/sets-respaldo.json)

let respaldo = null; // promesa con { especies: { nombre: [{ escala, fuente, objeto, habilidad, tera, naturaleza, valores, movimientos }] } }

/**
 * Un set publicado (Smogon o Random Battle de Showdown) de una especie, para cuando ningún formato de la app tiene datos
 * de uso de ella. Se prefiere el que reparte en la misma escala que el formato (EVs, o puntos en Champions); si solo hay
 * del otro tipo, o el set no trae reparto, se coge todo menos el reparto (queda a cero y «sinReparto» es true).
 * Devuelve { set, fuente, sinReparto } con la forma de setMasUsado, o null si ninguna fuente tiene set de esa especie.
 */
export async function setDeRespaldo(nombre, formato) {
  respaldo ??= leerJson("datos/sets-respaldo.json");
  let datos;
  try {
    datos = await respaldo;
  } catch {
    respaldo = null; // sin el fichero y sin conexión: se puede volver a intentar
    return null;
  }
  const candidatos = datos.especies[nombre];
  if (!candidatos?.length) return null;
  const escala = formato.champions ? "puntos" : "evs";
  const elegido = candidatos.find((c) => c.escala === escala) ?? candidatos[0];
  const valido = elegido.escala === escala && elegido.valores && repartoValido(elegido.valores, formato);
  return {
    set: {
      especie: nombre,
      objeto: elegido.objeto,
      habilidad: elegido.habilidad,
      tera: formatoTieneTera(formato) ? elegido.tera : null,
      naturaleza: elegido.naturaleza ?? "Serious",
      valores: valido ? [...elegido.valores] : [0, 0, 0, 0, 0, 0],
      movimientos: [...elegido.movimientos],
    },
    fuente: elegido.fuente,
    sinReparto: !valido,
  };
}
