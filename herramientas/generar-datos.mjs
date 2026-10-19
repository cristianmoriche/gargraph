// Gargraph · generador de datos competitivos
//
// Prepara los datos que la app no puede pedir directamente desde el navegador.
// Se ejecuta en el ordenador o, cada día, en GitHub (.github/workflows/update-data.yml), con Node.js 18 o superior:
//
//   node herramientas/generar-datos.mjs           → lo normal: mira si Smogon ha publicado un mes nuevo (si lo hay, regenera
//                                                   los datos mensuales) y actualiza siempre los «últimos 7 días» de Showdown
//   node herramientas/generar-datos.mjs 2026-09   → fuerza un mes concreto de Smogon en todos los formatos
//   node herramientas/generar-datos.mjs --todo    → regenera todo con el último mes de cada formato, aunque no haya mes nuevo
//   node herramientas/generar-datos.mjs --historico   → solo datos/historico/, con los datos que ya hay en datos/
//   node herramientas/generar-datos.mjs --solo-recientes   → solo datos/recientes/
//   node herramientas/generar-datos.mjs --sin-recientes    → todo menos datos/recientes/
//   node herramientas/generar-datos.mjs --adoptar-regulacion   → si Smogon ya publica la regulación siguiente de un formato
//                                                   (regmc → la que venga), la adopta. Sin esta opción solo se avisa.
//   node herramientas/generar-datos.mjs --solo-torneos     → solo los torneos de Limitless (datos/formatos/*-torneos.json y datos/torneos/)
//   node herramientas/generar-datos.mjs --sin-torneos      → todo menos los torneos de Limitless
//   node herramientas/generar-datos.mjs --solo-capas       → solo anota en meta.json qué capas (histórico, últimos 7 días) tiene cada formato
//
// Escribe:
//   datos/meta.json                → mes y formatos disponibles (formatos[]: id, nombre, grupo, modo, fuente «smogon» o «limitless», cerrado…)
//   datos/diccionario.json         → especies, movimientos, objetos, habilidades, naturalezas y tabla de tipos
//   datos/formatos/<formato>.json  → uso, sets, compañeros, counters y núcleos de cada formato
//   datos/historico/<formato>.json → uso y puesto de cada Pokémon en los últimos 6 meses de Smogon (hasta el mes de meta.json)
//   datos/recientes/<formato>.json → uso de cada Pokémon en las repeticiones públicas de Showdown de los últimos 7 días (solo los
//                                    formatos de Smogon que siguen abiertos)
//   datos/torneos/<formato>.json   → los 30 torneos más recientes de VGC de Limitless con su estado, su top 8 y sus equipos (ver herramientas/limitless.mjs)
//   datos/torneos/<formato>-equipos.json → los 200 mejores equipos de esos torneos y los equipos agrupados por sus 6 Pokémon, con récord
//   datos/avisos.json              → cambios en Smogon que requieren una decisión (regulación nueva, formato desaparecido…); la app no lo enseña
//   datos/combate.json             → lo que el simulador de combates necesita de cada movimiento y de cada Megaevolución
//   datos/sets-respaldo.json       → un set publicado (objeto, habilidad, naturaleza, reparto y 4 movimientos) por especie, para cuando
//                                    ningún formato de la app trae datos de uso de ella
// y, cuando regenera lo mensual, cambia la versión de los datos en sw.js para que los móviles descarguen los nuevos.
//
// APIs y fuentes de datos (públicas y gratuitas):
//   - Smogon, estadísticas de uso: https://www.smogon.com/stats/
//     No admite CORS (un navegador no puede pedírselas a otra web), por eso se descargan aquí.
//   - Limitless, torneos de VGC de Pokémon Champions: https://play.limitlesstcg.com/api (herramientas/limitless.mjs explica sus
//     condiciones de uso y cómo se respeta el límite de peticiones).
//   - Pokémon Showdown, datos del simulador: https://play.pokemonshowdown.com/data/
//   - Pokémon Showdown, repeticiones públicas: https://replay.pokemonshowdown.com/ (ver generarRecientes)
//   - Sets publicados de Smogon y de Random Battle de Showdown, a través de https://data.pkmn.cc/ (ver crearSetsDeRespaldo).
//     Showdown no publica un sets.json de Gen 9 (da 404); pkmn.cc ofrece esos mismos datos en un formato estable.
//   - PokeAPI, CSV de su base de datos en GitHub: https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv
//     Se usan los CSV en lugar de la API para no lanzar cientos de peticiones a un servicio gratuito.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMATOS_DE_TORNEOS, contarTorneos, torneosDeFormato } from "./limitless.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const URL_SMOGON = "https://www.smogon.com/stats/";
const URL_SHOWDOWN = "https://play.pokemonshowdown.com/data/";
const URL_CSV = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/";

// Carpeta opcional para guardar las descargas y no repetirlas mientras se hacen pruebas:
//   APEX_CACHE=carpeta node herramientas/generar-datos.mjs
const CACHE = process.env.APEX_CACHE;

// Formatos de Smogon de la app, en el orden en que se enseñan (el primero se abre por defecto). Cada uno lleva:
//   corte    rating mínimo de las partidas que se cuentan: un número o «max» (el más alto que Smogon publique de ese formato).
//            Los tres formatos que ya existían conservan su corte para que sus cifras no cambien.
//   cerrado  la regulación ya terminó: se queda con su último mes de Smogon y no lleva «últimos 7 días».
//            (Además, un formato que Smogon deja de publicar se marca cerrado aunque aquí no lo diga; ver resolverFormatos.)
//   patron   solo en los formatos vivos de Pokémon Champions: sirve para detectar que Smogon publica la regulación siguiente.
// Cada formato se mira en el último mes en que Smogon lo publicó (ver resolverFormatos).
const CHAMPIONS = { juego: "Pokémon Champions", grupo: "Pokémon Champions" };
const ESCARLATA = { juego: "Scarlet & Violet", grupo: "Scarlet & Violet" };
const FORMATOS = [
  { id: "gen9championsvgc2026regmc", patron: /^gen9championsvgc\d{4}reg[a-z]+$/, corte: 1630, modo: "Doubles", ...CHAMPIONS },
  { id: "gen9championsvgc2026regmcbo3", corte: "max", modo: "Doubles", ...CHAMPIONS },
  { id: "gen9championsbssregmc", patron: /^gen9championsbssreg[a-z]+$/, corte: 1630, modo: "Singles", ...CHAMPIONS },
  { id: "gen9championsou", corte: "max", modo: "Singles", ...CHAMPIONS },
  { id: "gen9championsvgc2026regmb", corte: "max", modo: "Doubles", cerrado: true, ...CHAMPIONS },
  { id: "gen9championsvgc2026regmbbo3", corte: "max", modo: "Doubles", cerrado: true, ...CHAMPIONS },
  { id: "gen9championsbssregmb", corte: "max", modo: "Singles", cerrado: true, ...CHAMPIONS },
  { id: "gen9championsvgc2026regma", corte: "max", modo: "Doubles", cerrado: true, ...CHAMPIONS },
  { id: "gen9championsvgc2026regmabo3", corte: "max", modo: "Doubles", cerrado: true, ...CHAMPIONS },
  { id: "gen9championsbssregma", corte: "max", modo: "Singles", cerrado: true, ...CHAMPIONS },
  { id: "gen9ou", corte: 1695, modo: "Singles", ...ESCARLATA, juego: "Smogon" },
  { id: "gen9vgc2026regi", corte: "max", modo: "Doubles", cerrado: true, ...ESCARLATA },
  { id: "gen9vgc2026regibo3", corte: "max", modo: "Doubles", cerrado: true, ...ESCARLATA },
  { id: "gen9vgc2026regf", corte: "max", modo: "Doubles", cerrado: true, ...ESCARLATA },
  { id: "gen9vgc2026regfbo3", corte: "max", modo: "Doubles", cerrado: true, ...ESCARLATA },
  { id: "gen9vgc2025regh", corte: "max", modo: "Doubles", cerrado: true, ...ESCARLATA },
  { id: "gen9vgc2025reghbo3", corte: "max", modo: "Doubles", cerrado: true, ...ESCARLATA },
  { id: "gen9vgc2025regj", corte: "max", modo: "Doubles", cerrado: true, ...ESCARLATA },
  { id: "gen9vgc2025regg", corte: "max", modo: "Doubles", cerrado: true, ...ESCARLATA },
  { id: "gen9vgc2025reggbo3", corte: "max", modo: "Doubles", cerrado: true, ...ESCARLATA },
  { id: "gen9vgc2025regi", corte: "max", modo: "Doubles", cerrado: true, ...ESCARLATA },
  { id: "gen9vgc2025regibo3", corte: "max", modo: "Doubles", cerrado: true, ...ESCARLATA },
];   // sin gen9vgc2025regjbo3: Smogon no lo publica
// Dónde va cada formato de torneos (Limitless): justo después del formato de Smogon de su misma regulación
const ORDEN_DE_FORMATOS = FORMATOS.flatMap((f) => [f.id, ...FORMATOS_DE_TORNEOS.filter((t) => t.id.startsWith(`${f.id}-`)).map((t) => t.id)]);
const MESES_HACIA_ATRAS = 24;   // hasta dónde se busca el último mes de un formato que Smogon ya no publica
const USO_MINIMO = 0.5;      // en %: los Pokémon que se usan menos no se incluyen
const POKEMON_MAXIMOS = 200;
const ESPANOL = "7";         // identificadores de idioma en languages.csv de PokeAPI
const INGLES = "9";
const ESTADISTICAS = ["hp", "atk", "def", "spa", "spd", "spe"];

// Nombres de Showdown que no se pueden emparejar solos con los de PokeAPI
const EXCEPCIONES = {
  "necrozma-dusk-mane": "necrozma-dusk",
  "necrozma-dawn-wings": "necrozma-dawn",
  "greninja-bond": "greninja-battle-bond",
  "minior-meteor": "minior-red-meteor",
  "maushold-four": "maushold-family-of-four",
};
// Objetos con otro identificador en PokeAPI (el puerro se llamaba «stick» en inglés)
const OBJETOS_RENOMBRADOS = { stick: "leek" };

// Simulador de combates: marcas de los movimientos de Showdown que usa el motor (js/sim/motor.js)
const MARCAS_DE_COMBATE = {
  contact: "contacto", sound: "sonido", punch: "puno", bite: "mordisco", slicing: "corte", bullet: "bala",
  wind: "viento", powder: "polvo", pulse: "pulso", dance: "baile", reflectable: "reflejable",
  bypasssub: "saltaSustituto", charge: "carga", recharge: "recarga", defrost: "descongela", heal: "cura",
};
// A quién va el movimiento, visto desde un combate individual
const OBJETIVOS_DE_COMBATE = {
  self: "propio", adjacentAllyOrSelf: "propio", adjacentAlly: "propio", allies: "propio",
  allySide: "bandoPropio", allyTeam: "bandoPropio", foeSide: "bandoRival", all: "campo",
};

// Roles que se deducen de las habilidades, los objetos y los movimientos más usados
const ROLES = [
  { nombre: "Rain", habilidades: ["drizzle"] },
  { nombre: "Sun", habilidades: ["drought", "orichalcumpulse"] },
  { nombre: "Sand", habilidades: ["sandstream"] },
  { nombre: "Snow", habilidades: ["snowwarning"] },
  { nombre: "Psychic Terrain", habilidades: ["psychicsurge"] },
  { nombre: "Grassy Terrain", habilidades: ["grassysurge"] },
  { nombre: "Electric Terrain", habilidades: ["electricsurge", "hadronengine"] },
  { nombre: "Misty Terrain", habilidades: ["mistysurge"] },
  { nombre: "Trick Room", movimientos: ["trickroom"] },
  { nombre: "Tailwind", movimientos: ["tailwind"] },
  { nombre: "Fast", velocidad: 110 },
  { nombre: "Choice", objetos: ["choicescarf", "choicespecs", "choiceband"] },
  { nombre: "Setup", movimientos: ["swordsdance", "dragondance", "nastyplot", "calmmind", "quiverdance", "bulkup", "shellsmash", "bellydrum", "victorydance", "shiftgear", "coil", "tailglow", "geomancy", "filletaway", "clangoroussoul", "noretreat", "curse", "agility", "tidyup"] },
  { nombre: "Pivot", movimientos: ["uturn", "voltswitch", "flipturn", "partingshot", "teleport", "chillyreception", "shedtail"] },
  { nombre: "Fake Out", movimientos: ["fakeout"] },
  { nombre: "Redirection", movimientos: ["followme", "ragepowder"] },
  { nombre: "Hazards", movimientos: ["stealthrock", "spikes", "toxicspikes", "stickyweb", "ceaselessedge", "stoneaxe"] },
  { nombre: "Hazard Removal", movimientos: ["defog", "rapidspin", "mortalspin", "courtchange"] },
  { nombre: "Priority", movimientos: ["extremespeed", "suckerpunch", "aquajet", "iceshard", "machpunch", "bulletpunch", "shadowsneak", "firstimpression", "jetpunch", "grassyglide", "vacuumwave", "accelerock", "thunderclap", "upperhand"] },
  { nombre: "Recovery", movimientos: ["recover", "roost", "slackoff", "softboiled", "moonlight", "morningsun", "synthesis", "shoreup", "strengthsap", "wish", "milkdrink", "junglehealing", "lifedew", "rest", "lunarblessing", "healorder"] },
  { nombre: "Status", movimientos: ["willowisp", "toxic", "thunderwave", "spore", "sleeppowder", "glare", "nuzzle", "yawn", "hypnosis", "stunspore"] },
];
const ROLES_DE_EQUIPO = ["Rain", "Sun", "Sand", "Snow", "Psychic Terrain", "Grassy Terrain", "Electric Terrain", "Misty Terrain", "Trick Room", "Tailwind"];

async function principal() {
  const opcion = (nombre) => process.argv.includes(`--${nombre}`);
  const argumento = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const metaActual = existsSync(join(RAIZ, "datos", "meta.json")) ? await leerJson("datos/meta.json") : null;
  if (opcion("solo-capas")) return anotarCapas();
  if (opcion("historico")) return generarHistorico(metaActual, await leerJson("datos/diccionario.json")).then(anotarCapas);
  if (opcion("solo-recientes")) return generarRecientes(metaActual).then(anotarCapas);
  if (opcion("solo-torneos")) return generarTorneos().then(anotarCapas);

  // 1. Smogon: ¿hay un mes nuevo? Solo entonces se regenera lo mensual (el resto de días no se toca)
  let avisos = null;   // null: no se ha mirado y datos/avisos.json se queda como está
  let formatos = null;
  if (argumento) {
    console.log(`Estadísticas de Smogon de ${argumento}`);
    formatos = await resolverFormatos(argumento);
  } else if (!metaActual) {
    const mes = await ultimoMes();
    console.log(`Primera ejecución: estadísticas de Smogon de ${mes}`);
    formatos = await resolverFormatos(mes);
  } else {
    const novedades = await buscarNovedades(metaActual, opcion("adoptar-regulacion"));
    avisos = novedades.avisos;
    for (const aviso of avisos) console.warn(`  AVISO (${aviso.formato}): ${aviso.mensaje}`);
    if (novedades.hayNuevo || opcion("todo")) formatos = novedades.formatos;
    else console.log(`Smogon: sin mes nuevo (los datos mensuales siguen en ${metaActual.mes}); no se toca nada de lo mensual`);
  }
  if (formatos) await generarSmogon(formatos);
  if (avisos) await escribirAvisos(avisos);

  // 2. Limitless: torneos de VGC de Champions, cada vez que se ejecuta (solo se piden los torneos que faltan)
  if (!opcion("sin-torneos")) await generarTorneos();

  // 3. Showdown: últimos 7 días, cada vez que se ejecuta
  if (!opcion("sin-recientes")) await generarRecientes(await leerJson("datos/meta.json"));

  // 4. meta.json dice qué capas tiene cada formato, para que la app no pida (y no dé 404) las que no existen
  await anotarCapas();
}

// Añade a cada formato de meta.json «capas: { historico, recientes }» según los ficheros que hay en datos/historico y datos/recientes.
// Sin conexión y al momento: se puede lanzar sola con --solo-capas.
async function anotarCapas() {
  if (!existsSync(join(RAIZ, "datos", "meta.json"))) return;
  const meta = await leerJson("datos/meta.json");
  for (const formato of meta.formatos) {
    formato.capas = {
      historico: existsSync(join(RAIZ, "datos", "historico", `${formato.id}.json`)),
      recientes: existsSync(join(RAIZ, "datos", "recientes", `${formato.id}.json`)),
    };
  }
  await escribir("datos/meta.json", meta);
  console.log(`meta.json: capas anotadas en ${meta.formatos.length} formatos`);
}

const leerJson = async (ruta) => JSON.parse(await readFile(join(RAIZ, ruta), "utf8"));

// Regenera lo mensual con estos formatos (cada uno con su «id», su «corte» y su «mes»)
async function generarSmogon(formatos) {
  const fuentes = await descargarFuentes();
  const diccionario = crearDiccionario(fuentes);
  const megas = crearMegas(fuentes, diccionario);
  if (!formatos.length) throw new Error("Smogon no tiene datos de ningún formato de la app en ese mes");
  const meta = { mes: "", generado: new Date().toISOString().slice(0, 10), formatos: [] };
  // Los de Limitless no salen de Smogon: se conservan tal cual hasta que generarTorneos los actualice
  const deTorneos = existsSync(join(RAIZ, "datos", "meta.json")) ? (await leerJson("datos/meta.json")).formatos.filter((x) => x.fuente === "limitless") : [];
  const mesReciente = formatos.map((x) => x.mes).sort().at(-1);

  await mkdir(join(RAIZ, "datos", "formatos"), { recursive: true });
  const enUso = [];   // los Pokémon de todos los formatos: de ellos salen los movimientos de datos/combate.json
  for (const formato of formatos) {
    // API de Smogon: estadísticas «chaos» (las más completas) de un formato y un corte
    let chaos;
    try {
      chaos = await descargarChaos(formato, formato.mes);
    } catch (error) {
      // Mes recién publicado y a medias: se sigue con el mes que ya funcionaba, y mañana se vuelve a intentar
      if (!formato.mesAnterior) throw error;
      console.warn(`  Aviso: ${error.message}; ${formato.id} sigue en ${formato.mesAnterior}`);
      formato.mes = formato.mesAnterior;
      chaos = await descargarChaos(formato, formato.mes);
    }
    // Cerrado: la regulación terminó o Smogon lleva dos meses o más sin publicarlo
    formato.cerrado = Boolean(formato.cerrado) || mesesDeDiferencia(formato.mes, mesReciente) >= 2;
    const datos = procesarFormato(formato, chaos, diccionario, formato.mes, megas);
    await escribir(`datos/formatos/${formato.id}.json`, datos);
    const { pokemon, nucleos, ...resumen } = datos;
    meta.formatos.push(resumen);
    enUso.push(...pokemon);
    console.log(`  ${datos.nombre}: ${pokemon.length} Pokémon, ${datos.partidas.toLocaleString("es-ES")} partidas · ` +
      pokemon.slice(0, 5).map((p) => `${p.nombre} ${p.uso} %`).join(", "));
  }

  const combate = { ...crearDatosDeCombate(fuentes, enUso, diccionario), megas };
  await escribir("datos/diccionario.json", diccionario);
  await escribir("datos/combate.json", combate);
  await escribir("datos/sets-respaldo.json", await crearSetsDeRespaldo(diccionario));
  meta.mes = mesReciente;   // el más reciente (un formato puede ir un mes por detrás o ya no publicarse)
  meta.formatos = ordenarFormatos([...meta.formatos, ...deTorneos]);
  await escribir("datos/meta.json", meta);
  await generarHistorico(meta, diccionario);
  await actualizarServiceWorker(meta.mes);
  console.log(`Listo: ${Object.keys(diccionario.especies).length} especies, ${Object.keys(diccionario.movimientos).length} movimientos, ` +
    `${Object.keys(diccionario.objetos).length} objetos y ${Object.keys(diccionario.habilidades).length} habilidades. ` +
    `Para el simulador: ${Object.keys(combate.movimientos).length} movimientos, ${Object.keys(combate.pesos).length} pesos y ${Object.keys(megas).length} Megaevoluciones.`);
}

// ---------------------------------------------------------------------------
// Histórico de uso
//
// Para cada formato de Smogon de meta.json (mismo id y mismo corte de rating), el uso y el puesto de cada Pokémon en cada uno de los
// últimos MESES_DE_HISTORICO meses publicados por Smogon hasta el del propio formato (el de meta.json, salvo en los cerrados). Si un formato no existe en un mes (los de
// Champions son recientes, o cambian de regulación), ese mes no aparece. Un Pokémon con menos de USO_MINIMO % o fuera de los
// POKEMON_MAXIMOS primeros no lleva entrada ese mes. «uso» es una fracción (0,4812 = 48,12 %) y «puesto» cuenta desde 1,
// con el mismo criterio que datos/formatos/<formato>.json, así que el último mes coincide con ese fichero.
const MESES_DE_HISTORICO = 6;

async function generarHistorico(meta, diccionario) {
  const indice = await descargar(URL_SMOGON);
  const todos = [...indice.matchAll(/href="(\d{4}-\d{2})\/"/g)].map((m) => m[1]).sort();
  const porId = new Map(Object.keys(diccionario.especies).map((nombre) => [aId(nombre), nombre]));
  await mkdir(join(RAIZ, "datos", "historico"), { recursive: true });
  for (const formato of deSmogon(meta)) {
    const meses = [];
    const pokemon = {};
    // Los últimos meses hasta el del formato (los cerrados acaban antes que meta.mes)
    for (const mes of todos.filter((m) => m <= formato.mes).slice(-MESES_DE_HISTORICO)) {
      if (!(await ficherosDeMes(mes))?.some((x) => x.id === formato.id && x.corte === formato.corte)) continue;   // ese formato no existe ese mes
      let chaos;
      try {
        chaos = JSON.parse(await descargar(`${URL_SMOGON}${mes}/chaos/${formato.id}-${formato.corte}.json`));
      } catch {
        continue;
      }
      meses.push(mes);
      Object.entries(chaos.data)
        .map(([nombre, d]) => [porId.get(aId(nombre)) ?? nombre, d.usage])
        .sort((a, b) => b[1] - a[1])
        .map(([nombre, uso], indicePuesto) => ({ nombre, uso, puesto: indicePuesto + 1 }))
        .filter((p) => p.uso * 100 >= USO_MINIMO && p.puesto <= POKEMON_MAXIMOS)
        .forEach((p) => (pokemon[p.nombre] ??= []).push({ mes, uso: redondear(p.uso, 4), puesto: p.puesto }));
    }
    await escribir(`datos/historico/${formato.id}.json`, { formato: formato.id, meses, pokemon });
    console.log(`  Histórico de ${formato.nombre}: ${meses.join(", ") || "sin meses"} · ${Object.keys(pokemon).length} Pokémon`);
  }
}

// ---------------------------------------------------------------------------
// Sets de respaldo
//
// Los formatos de la app solo traen sets de los Pokémon que la gente usa en ellos (Xerneas o Yveltal no están en ninguno).
// Para que ningún Pokémon entre en un equipo sin movimientos, se guarda un set publicado por especie. Salen de fuentes
// reales, de la más a la menos competitiva (la primera que tenga la especie es la que se usa):
//   1. Sets de Smogon de Gen 9 (https://data.pkmn.cc/sets/gen9.json): análisis de los jugadores de Smogon.
//   2. Sets de Random Battle de Showdown de Gen 9 (individuales, dobles y bebés): los sets que genera Showdown.
//   3. Sets de Smogon de Gen 8 y de Gen 7, solo para lo que sigue sin set (Xerneas, por ejemplo, solo está ahí).
// Aparte, para los formatos de Pokémon Champions (reparto en puntos y no en EVs), sus sets de Smogon y los de su Random Battle.
// Del set solo se coge lo que la app sabe usar y existe en su diccionario; lo que no, se deja vacío, nunca se inventa.
const URL_SETS = "https://data.pkmn.cc/";
const FORMATOS_SMOGON_EXCLUIDOS = /balancedhackmons|godlygift|almostanyability|inheritance|mixandmega|stabmons|partnersincrime|cap|1v1|monotype|nc199/;
// De los formatos de Smogon se prefiere el más habitual; el resto, por orden alfabético
const FORMATOS_SMOGON_PREFERIDOS = ["ou", "ubers", "nationaldex", "nationaldexubers", "uu", "ru", "nu", "pu", "zu", "anythinggoes", "ubersuu",
  "battlestadiumsingles", "vgc2026", "vgc2025", "vgc2024", "doublesou", "lc"];
const REPARTO_POR_DEFECTO_RANDOM = 85;  // los sets de Random Battle llevan 85 EVs en todo salvo lo que digan

async function crearSetsDeRespaldo(diccionario) {
  const idAEspecie = new Map(Object.keys(diccionario.especies).map((n) => [aId(n), n]));
  const idDe = (tabla, id) => (diccionario[tabla][id] ? id : null);
  const primero = (valor) => (Array.isArray(valor) ? valor.find((v) => !Array.isArray(v)) ?? valor[0] : valor);

  // Un set de Smogon o de Random Battle → { objeto, habilidad, tera, naturaleza, valores, movimientos } con ids de la app
  const crearSet = (nombre, bruto, escala) => {
    const movimientos = [];
    for (const entrada of bruto.moves ?? []) {
      const opciones = Array.isArray(entrada) ? entrada : [entrada];
      const id = opciones.map(aId).find((i) => diccionario.movimientos[i] && !movimientos.includes(i));
      if (id) movimientos.push(id);
      if (movimientos.length === 4) break;
    }
    if (!movimientos.length) return null;
    const habilidad = idDe("habilidades", aId(primero(bruto.ability) ?? ""));
    const objeto = idDe("objetos", aId(primero(bruto.item) ?? ""));
    const tipoTera = aId(primero(bruto.teratypes) ?? "");
    const naturaleza = primero(bruto.nature);
    let valores = null;
    const evs = Array.isArray(bruto.evs) ? bruto.evs[0] : bruto.evs;
    if (evs) {
      valores = ESTADISTICAS.map((e) => evs[e] ?? 0);
      const [maximo, total] = escala === "puntos" ? [32, 66] : [252, 510];
      if (valores.some((v) => v > maximo) || valores.reduce((a, b) => a + b, 0) > total) valores = null;
    }
    return {
      objeto,
      habilidad: habilidad ?? diccionario.especies[nombre].habilidades?.[0] ?? null,
      tera: diccionario.tabla[tipoTera] ? tipoTera : null,
      naturaleza: diccionario.naturalezas[naturaleza] ? naturaleza : null,
      valores,
      movimientos,
    };
  };

  // Cada escala (EVs o puntos de Champions) guarda, por especie, el primer candidato que llega: las fuentes se leen por prioridad
  const porEscala = { evs: new Map(), puntos: new Map() };
  const guardar = (escala, nombre, fuente, set) => {
    if (set && !porEscala[escala].has(nombre)) porEscala[escala].set(nombre, { fuente, ...set });
  };
  const bajar = async (ruta) => {
    try {
      return JSON.parse(await descargar(URL_SETS + ruta));
    } catch (error) {
      console.warn(`  Aviso: sin ${ruta} (${error.message}); se sigue sin esa fuente`);
      return null;
    }
  };

  // Sets de Smogon (especie → formato → nombre del set)
  const deSmogon = (datos, escala, etiqueta) => {
    for (const [clave, porFormato] of Object.entries(datos ?? {})) {
      const nombre = idAEspecie.get(aId(clave));
      if (!nombre) continue;
      const formatos = Object.keys(porFormato).filter((f) => !FORMATOS_SMOGON_EXCLUIDOS.test(f));
      formatos.sort((a, b) => {
        const pa = FORMATOS_SMOGON_PREFERIDOS.indexOf(a), pb = FORMATOS_SMOGON_PREFERIDOS.indexOf(b);
        return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb) || a.localeCompare(b);
      });
      for (const formato of formatos) {
        const [nombreSet, bruto] = Object.entries(porFormato[formato])[0] ?? [];
        const set = bruto && crearSet(nombre, bruto, escala);
        if (set) {
          guardar(escala, nombre, `${etiqueta} · ${formato.toUpperCase()} · ${nombreSet}`, set);
          break;
        }
      }
    }
  };
  // Sets de Random Battle (especie → roles): se coge el primer rol, con sus movimientos, objeto y habilidad
  const deRandom = (datos, escala, etiqueta) => {
    for (const [clave, bruto] of Object.entries(datos ?? {})) {
      const nombre = idAEspecie.get(aId(clave));
      if (!nombre) continue;
      const [rol, datosRol] = Object.entries(bruto.roles ?? {})[0] ?? [];
      if (!datosRol) continue;
      const evs = escala === "evs" ? Object.fromEntries(ESTADISTICAS.map((e) => [e, datosRol.evs?.[e] ?? bruto.evs?.[e] ?? REPARTO_POR_DEFECTO_RANDOM])) : null;
      const set = crearSet(nombre, {
        moves: datosRol.moves, ability: datosRol.abilities, item: datosRol.items, teratypes: datosRol.teraTypes, evs,
      }, escala);
      guardar(escala, nombre, `${etiqueta} · ${rol}`, set);
    }
  };

  const [smogon9, champions, randomIndividual, randomDobles, randomBebes, randomChampions, randomChampionsDobles, smogon8, smogon7] = await Promise.all(
    ["sets/gen9.json", "sets/champions.json", "randbats/gen9randombattle.json", "randbats/gen9randomdoublesbattle.json",
      "randbats/gen9babyrandombattle.json", "randbats/gen9championsrandombattle.json", "randbats/gen9championsrandomdoublesbattle.json",
      "sets/gen8.json", "sets/gen7.json"].map(bajar));

  // Reparto en puntos (Champions)
  deSmogon(champions, "puntos", "Smogon · Pokémon Champions");
  deRandom(randomChampions, "puntos", "Showdown · Champions Random Battle");
  deRandom(randomChampionsDobles, "puntos", "Showdown · Champions Random Battle (doubles)");
  // Reparto en EVs
  deSmogon(smogon9, "evs", "Smogon · Gen 9");
  deRandom(randomIndividual, "evs", "Showdown · Gen 9 Random Battle");
  deRandom(randomDobles, "evs", "Showdown · Gen 9 Random Battle (doubles)");
  deRandom(randomBebes, "evs", "Showdown · Gen 9 Baby Random Battle");
  deSmogon(smogon8, "evs", "Smogon · Gen 8");
  deSmogon(smogon7, "evs", "Smogon · Gen 7");

  const especies = {};
  for (const nombre of Object.keys(diccionario.especies)) {
    const lista = ["evs", "puntos"].filter((e) => porEscala[e].has(nombre)).map((e) => ({ escala: e, ...porEscala[e].get(nombre) }));
    if (lista.length) especies[nombre] = lista;
  }
  const sinSet = Object.keys(diccionario.especies).length - Object.keys(especies).length;
  console.log(`  Sets de respaldo: ${Object.keys(especies).length} especies con set, ${sinSet} sin set en ninguna fuente`);
  return { generado: new Date().toISOString().slice(0, 10), especies };
}

// ---------------------------------------------------------------------------
// Torneos de VGC (Limitless)
//
// Para cada formato de FORMATOS_DE_TORNEOS (herramientas/limitless.mjs): datos/formatos/<id>.json, con el uso sacado de los equipos
// de los torneos (qué % de los equipos lleva a cada Pokémon, con sus objetos, habilidades, teratipos, movimientos y compañeros), y
// datos/torneos/<id>.json, con los 30 torneos más recientes (estado, top 8 y todos sus equipos publicados), y datos/torneos/<id>-equipos.json,
// con los mejores equipos de esos torneos y los equipos agrupados por sus 6 Pokémon con su récord total (W-L-T). Los repartos no existen (Limitless no da EVs): «spreads» va vacío.
// Si la caché se ha perdido y esta ejecución no ha podido volver a bajar todos los torneos, se conservan los ficheros anteriores en lugar
// de sustituirlos por unos con menos torneos.
async function generarTorneos() {
  if (!existsSync(join(RAIZ, "datos", "meta.json"))) return console.warn("  Aviso: no hay datos/meta.json; no se generan los torneos");
  const meta = await leerJson("datos/meta.json");
  const diccionario = await leerJson("datos/diccionario.json");
  const megas = (await leerJson("datos/combate.json")).megas ?? {};
  await mkdir(join(RAIZ, "datos", "torneos"), { recursive: true });
  const hoy = new Date().toISOString().slice(0, 10);
  console.log("Torneos de VGC de Limitless");
  let cambiado = false;
  for (const formato of FORMATOS_DE_TORNEOS) {
    try {
      const { torneos, pendientes, total } = await torneosDeFormato(formato.limitless);
      const conteo = contarTorneos(torneos, diccionario, megas);
      const anterior = meta.formatos.find((x) => x.id === formato.id);
      if (!conteo.equipos || conteo.torneosConEquipos < (anterior?.torneos ?? 0)) {
        console.warn(`  Aviso: ${formato.nombre}: solo ${conteo.torneosConEquipos} torneos con equipos (había ${anterior?.torneos ?? 0}); ${pendientes} sin bajar todavía. Se quedan los ficheros anteriores`);
        continue;
      }
      const datos = procesarTorneos(formato, conteo, diccionario, megas, hoy);
      await escribir(`datos/formatos/${formato.id}.json`, datos);
      await escribir(`datos/torneos/${formato.id}.json`, { actualizado: hoy, torneos: conteo.recientes });
      await escribir(`datos/torneos/${formato.id}-equipos.json`, { actualizado: hoy, formato: formato.id, torneos: datos.torneos, equipos: conteo.equiposTop, grupos: conteo.grupos });
      const { pokemon, nucleos, ...resumen } = datos;
      meta.formatos = ordenarFormatos([...meta.formatos.filter((x) => x.id !== formato.id), resumen]);
      cambiado = true;
      console.log(`  ${datos.nombre}: ${datos.torneos} torneos (de ${total} con ${8}+ jugadores; ${pendientes} sin bajar aún), ${datos.equipos} equipos · ` +
        pokemon.slice(0, 5).map((p) => `${p.nombre} ${p.uso} %`).join(", "));
      if (conteo.sinPareja.size) console.warn(`    Especies sin pareja en la app (${conteo.sinPareja.size}): ${[...conteo.sinPareja].map(([n, c]) => `${n} ×${c}`).slice(0, 20).join(", ")}`);
      for (const [tabla, perdidos] of Object.entries(conteo.sinId)) {
        if (perdidos.size) console.warn(`    ${tabla} sin id en la app (${perdidos.size}): ${[...perdidos].map(([n, c]) => `${n} ×${c}`).slice(0, 15).join(", ")}`);
      }
    } catch (error) {
      console.warn(`  Aviso: ${formato.nombre}: ${error.message}; se quedan los ficheros anteriores, si los hay`);
    }
  }
  if (cambiado) await escribir("datos/meta.json", meta);
}

// El JSON de un formato de torneos, con la misma estructura que el de uno de Smogon pero sin repartos ni contrarios
function procesarTorneos(formato, conteo, diccionario, megas, actualizado) {
  const total = (d) => d.equipos;
  const porcentaje = (cuantos, d) => redondear((cuantos / d.equipos) * 100, 1);
  const mejores = (mapa, d, cuantos) => [...mapa].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, cuantos)
    .map(([clave, n]) => [clave, porcentaje(n, d)]);
  const entradas = [...conteo.uso]
    .map(([nombre, u]) => [nombre, { ...u, Teammates: Object.fromEntries(u.companeros) }])
    .sort((a, b) => b[1].equipos - a[1].equipos || a[0].localeCompare(b[0]));
  const conTera = false;   // Pokémon Champions no tiene teracristalización: ni el campo «tera» ni teratipos en estos formatos
  const nombresTop = new Set(entradas.slice(0, 30).map(([nombre]) => nombre));
  const triosReales = [...conteo.trios]
    .map(([clave, n]) => ({ miembros: clave.split("|"), juntos: (n / conteo.equipos) * 100 }))
    .filter((t) => t.miembros.every((m) => nombresTop.has(m)))
    .sort((a, b) => b.juntos - a.juntos);
  const pokemon = entradas
    .filter(([, d]) => (d.equipos / conteo.equipos) * 100 >= USO_MINIMO)
    .slice(0, POKEMON_MAXIMOS)
    .map(([nombre, d], indice) => {
      const habilidades = mejores(d.habilidades, d, 3);
      const objetos = mejores(d.objetos, d, 6);
      const movimientos = mejores(d.movimientos, d, 10);
      return {
        nombre,
        puesto: indice + 1,
        uso: redondear((d.equipos / conteo.equipos) * 100, 2),
        habilidades,
        objetos,
        movimientos,
        ...(conTera ? { tera: mejores(d.tera, d, 4) } : {}),
        spreads: [],
        companeros: mejores(d.companeros, d, 8),
        counters: [],
        roles: calcularRoles(diccionario.especies[nombre], habilidades, objetos, movimientos),
      };
    });
  return {
    id: formato.id, nombre: formato.nombre, corto: formato.corto, juego: "Pokémon Champions", grupo: "Pokémon Champions", modo: "Doubles",
    fuente: "limitless", cerrado: formato.cerrado, nivel: 50, ivs: null, usoMinimo: USO_MINIMO, champions: true, tera: conTera,
    mega: pokemon.some((p) => megas[p.nombre]),
    torneos: conteo.torneosConEquipos, equipos: conteo.equipos, actualizado,
    pokemon,
    nucleos: calcularNucleos(entradas.slice(0, 30), pokemon, total, triosReales),
  };
}

// ---------------------------------------------------------------------------
// Últimos 7 días (repeticiones públicas de Pokémon Showdown)
//
// Smogon publica una vez al mes. Para tener algo más fresco, se cuentan los equipos de las repeticiones públicas que los
// jugadores han subido a Showdown en los últimos DIAS_RECIENTES días. Es una muestra, no el total de partidas:
//   - Solo están las repeticiones que el jugador decidió guardar como públicas.
//   - search.json solo da 51 repeticiones por petición, y en un formato con mucho tráfico (OU) 51 repeticiones son media hora.
//     Por eso se pregunta por tramos repartidos por toda la semana (parámetro «before») y se juntan.
//   - De las encontradas se eligen las TOPE_PARTIDAS de rating más alto (si la repetición trae rating), y solo de esas se
//     descarga el registro. «ratingMinimo» dice el rating de la última elegida.
// «uso» es el % de equipos de la muestra que llevan al Pokémon (cada partida son 2 equipos). Se lee de las líneas |poke| de la
// vista previa de equipos, así que cuenta los 6 del equipo, no solo los que salen al campo. Un Pokémon que hace la Megaevolución
// en el combate cuenta como su forma Mega.
// Respeto al servidor: una petición a la vez, con una pausa entre peticiones y un tope de partidas por formato.
const URL_REPETICIONES = "https://replay.pokemonshowdown.com/";
const DIAS_RECIENTES = 7;
const TOPE_PARTIDAS = 400;          // registros que se descargan por formato
const MUESTRA_PEQUENA = 100;        // por debajo de estas partidas, el fichero lleva muestraPequena: true
const PASO_DE_BUSQUEDA_HORAS = 2;   // cada cuántas horas de la semana se pide una página de búsqueda
const PAUSA_ENTRE_PETICIONES = 300; // ms
const FALLOS_SEGUIDOS_MAXIMOS = 8;  // si el servidor falla tantas veces seguidas, se para ese formato

const pausa = () => new Promise((resolver) => setTimeout(resolver, PAUSA_ENTRE_PETICIONES));

async function generarRecientes(meta) {
  if (!meta?.formatos?.length) return console.warn("  Aviso: no hay datos/meta.json; no se generan los últimos 7 días");
  const diccionario = await leerJson("datos/diccionario.json");
  const porId = new Map(Object.keys(diccionario.especies).map((nombre) => [aId(nombre), nombre]));
  const ahora = Math.floor(Date.now() / 1000);
  await mkdir(join(RAIZ, "datos", "recientes"), { recursive: true });
  console.log(`Últimos ${DIAS_RECIENTES} días de repeticiones de Showdown`);
  // Los cerrados no tienen partidas nuevas, y los de Limitless no son de Showdown
  for (const formato of deSmogon(meta).filter((x) => !x.cerrado)) {
    try {
      const datos = await recientesDeFormato(formato, porId, ahora);
      if (!datos) continue;
      await escribir(`datos/recientes/${formato.id}.json`, datos);
      console.log(`  ${formato.nombre}: ${datos.partidas} partidas (de ${datos.encontradas} encontradas), rating ${datos.ratingMinimo ?? "?"}+` +
        `${datos.muestraPequena ? ", MUESTRA PEQUEÑA" : ""} · ` + datos.pokemon.slice(0, 5).map((p) => `${p.nombre} ${p.uso} %`).join(", "));
    } catch (error) {
      console.warn(`  Aviso: ${formato.nombre}: ${error.message}; se queda el fichero anterior, si lo hay`);
    }
  }
}

async function recientesDeFormato(formato, porId, ahora) {
  const inicio = ahora - DIAS_RECIENTES * 86400;
  const encontradas = await buscarRepeticiones(formato.id, inicio, ahora);
  if (!encontradas.length) {
    console.warn(`  Aviso: ${formato.nombre}: ninguna repetición pública en ${DIAS_RECIENTES} días`);
    return null;
  }
  // Rating alto: las de más rating (las que no lo traen solo entran si ninguna lo trae)
  const conRating = encontradas.filter((r) => r.rating);
  const elegidas = (conRating.length ? conRating : encontradas)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.uploadtime - a.uploadtime).slice(0, TOPE_PARTIDAS);

  const usos = new Map();
  let partidas = 0, equipos = 0, fallos = 0, desde = Infinity, hasta = 0;
  for (const repeticion of elegidas) {
    let log;
    try {
      log = await descargar(`${URL_REPETICIONES}${repeticion.id}.log`, 2);
      fallos = 0;
    } catch {
      if (++fallos >= FALLOS_SEGUIDOS_MAXIMOS) throw new Error("el servidor de repeticiones falla demasiado; se para aquí");
      continue;
    } finally {
      await pausa();
    }
    const lados = equiposDeRegistro(log, porId);
    if (!lados.length) continue;
    partidas++;
    desde = Math.min(desde, repeticion.uploadtime);
    hasta = Math.max(hasta, repeticion.uploadtime);
    for (const equipo of lados) {
      equipos++;
      for (const nombre of equipo) usos.set(nombre, (usos.get(nombre) ?? 0) + 1);
    }
  }
  if (!partidas) throw new Error("no se ha podido leer ninguna repetición");

  const pokemon = [...usos].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([nombre, cuantos]) => ({ nombre, uso: redondear((cuantos / equipos) * 100, 2), equipos: cuantos }))
    .filter((p) => p.uso >= USO_MINIMO).slice(0, POKEMON_MAXIMOS)
    .map((p, indice) => ({ nombre: p.nombre, puesto: indice + 1, uso: p.uso, equipos: p.equipos }));
  const conRatingElegidas = elegidas.filter((r) => r.rating);
  return {
    formato: formato.id,
    generado: new Date().toISOString(),
    dias: DIAS_RECIENTES,
    desde: new Date(desde * 1000).toISOString(),
    hasta: new Date(hasta * 1000).toISOString(),
    partidas,
    equipos,
    encontradas: encontradas.length,
    ratingMinimo: conRatingElegidas.length ? conRatingElegidas.at(-1).rating : null,
    muestraPequena: partidas < MUESTRA_PEQUENA,
    pokemon,
  };
}

// Repeticiones públicas del formato subidas entre «inicio» y «fin» (segundos Unix), repartidas por todo el periodo.
// search.json devuelve las 51 anteriores a «before». Se pide cada PASO_DE_BUSQUEDA_HORAS horas; si una página llega más atrás que
// el paso (formato con poco tráfico), se continúa desde donde acaba, así no se deja ningún hueco.
async function buscarRepeticiones(id, inicio, fin) {
  const encontradas = new Map();
  const paso = PASO_DE_BUSQUEDA_HORAS * 3600;
  let antes = fin + 1;
  let fallos = 0;
  while (antes > inicio) {
    let lista;
    try {
      lista = JSON.parse(await descargar(`${URL_REPETICIONES}search.json?format=${id}&before=${antes}`, 2));
      if (!Array.isArray(lista)) throw new Error("respuesta inesperada");
      fallos = 0;
    } catch (error) {
      if (++fallos >= FALLOS_SEGUIDOS_MAXIMOS) throw new Error(`la búsqueda de repeticiones falla (${error.message})`);
      antes -= paso;
      await pausa();
      continue;
    }
    for (const r of lista) {
      if (!r.private && r.uploadtime >= inicio && r.uploadtime <= fin) encontradas.set(r.id, r);
    }
    await pausa();
    if (!lista.length) break;
    antes = Math.min(antes - paso, lista.at(-1).uploadtime);
  }
  return [...encontradas.values()];
}

// Los dos equipos de un registro (|poke|p1|Slowking-Galar, F|): nombres de la app, sin sexo ni «-*» (forma oculta en la vista previa).
// La vista previa solo trae la especie base; si el Pokémon hizo la Megaevolución en el combate (|detailschange|p1a: X|Charizard-Mega-X|),
// cuenta como su forma Mega, que es como la cuenta Smogon (Salamence-Mega, no Salamence).
function equiposDeRegistro(log, porId) {
  const equipos = { p1: new Set(), p2: new Set() };
  const canonico = (nombre) => porId.get(aId(nombre)) ?? nombre;
  for (const linea of log.split("\n")) {
    if (linea.startsWith("|poke|")) {
      const [, , lado, detalles] = linea.split("|");
      if (equipos[lado] && detalles) equipos[lado].add(canonico(detalles.split(",")[0].replace(/-\*$/, "").trim()));
    } else if (linea.startsWith("|detailschange|")) {
      const [, , quien, detalles] = linea.split("|");
      const nombre = detalles?.split(",")[0].trim();
      const base = nombre?.replace(/-Mega(-[XYZ])?$/, "");
      const equipo = equipos[quien?.slice(0, 2)];
      if (equipo && nombre !== base && equipo.delete(canonico(base))) equipo.add(canonico(nombre));
    }
  }
  return Object.values(equipos).filter((e) => e.size > 0).map((e) => [...e]);
}

// ---------------------------------------------------------------------------
// Descargas

async function descargar(url, intentosMaximos = 3) {
  const archivoCache = CACHE && join(CACHE, url.replace(/^https?:\/\//, "").replace(/[^\w.-]+/g, "_"));
  if (archivoCache && existsSync(archivoCache)) return readFile(archivoCache, "utf8");
  for (let intento = 1; ; intento++) {
    try {
      const respuesta = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!respuesta.ok) throw new Error(`código ${respuesta.status}`);
      const texto = await respuesta.text();
      if (archivoCache) {
        await mkdir(CACHE, { recursive: true });
        await writeFile(archivoCache, texto);
      }
      return texto;
    } catch (error) {
      if (intento >= intentosMaximos || /código 404/.test(error.message)) throw new Error(`No se ha podido descargar ${url} (${error.message})`);
      await new Promise((resolver) => setTimeout(resolver, 2000 * intento));
    }
  }
}

// El índice de Smogon es una página con una carpeta por mes: 2026-08/, 2026-09/…
async function ultimoMes() {
  const indice = await descargar(URL_SMOGON);
  const meses = [...indice.matchAll(/href="(\d{4}-\d{2})\/"/g)].map((m) => m[1]).sort();
  return meses.at(-1);
}

// Para cada formato de la lista, el último mes (hasta «mesTope») en que Smogon lo publicó y su corte: el fijo o, con «max», el más alto
// que haya ese mes. Un formato que Smogon no publica en ninguno de los últimos MESES_HACIA_ATRAS meses se avisa y se salta.
async function resolverFormatos(mesTope, configuraciones = FORMATOS) {
  const indice = await descargar(URL_SMOGON);
  const meses = [...indice.matchAll(/href="(\d{4}-\d{2})\/"/g)].map((m) => m[1]).filter((m) => m <= mesTope).sort().reverse().slice(0, MESES_HACIA_ATRAS);
  const elegidos = [];
  for (const configuracion of configuraciones) {
    let elegido = null;
    for (const mes of meses) {
      const propios = ((await ficherosDeMes(mes)) ?? []).filter((x) => x.id === configuracion.id);
      if (!propios.length) continue;
      const corte = configuracion.corte === "max" ? Math.max(...propios.map((x) => x.corte)) : configuracion.corte;
      if (propios.some((x) => x.corte === corte)) elegido = { ...configuracion, corte, mes };
      else console.warn(`  Aviso: ${configuracion.id} no tiene datos con corte ${corte} en ${mes}`);
      break;
    }
    if (elegido) elegidos.push(elegido);
    else console.warn(`  Aviso: Smogon no publica ${configuracion.id} (hasta ${mesTope}); no se incluye`);
  }
  return elegidos;
}

// Estadísticas «chaos» de un formato y un mes; falla si el fichero no es un JSON de Smogon completo (mes a medio subir)
async function descargarChaos(formato, mes) {
  const url = `${URL_SMOGON}${mes}/chaos/${formato.id}-${formato.corte}.json`;
  const chaos = JSON.parse(await descargar(url));
  if (!chaos?.data || !(chaos.info?.["number of battles"] > 0)) throw new Error(`${url} no tiene estadísticas`);
  return chaos;
}

// Los ficheros de estadísticas que Smogon ha publicado en un mes: [{ id, corte }]; null si el mes aún no tiene carpeta «chaos»
// (cada mes se pide una sola vez por ejecución)
const listadosDeMes = new Map();
async function ficherosDeMes(mes) {
  if (!listadosDeMes.has(mes)) {
    let lista = null;
    try {
      const indice = await descargar(`${URL_SMOGON}${mes}/chaos/`, 1);
      lista = [...indice.matchAll(/href="([a-z0-9]+)-(\d+)\.json"/g)].map((m) => ({ id: m[1], corte: Number(m[2]) }));
    } catch {
      lista = null;
    }
    listadosDeMes.set(mes, lista);
  }
  return listadosDeMes.get(mes);
}

// Los formatos de Smogon de meta.json (los de Limitless, con fuente «limitless», no entran). Un meta antiguo no traía «fuente».
const deSmogon = (meta) => (meta?.formatos ?? []).filter((x) => (x.fuente ?? "smogon") === "smogon");
// La configuración de FORMATOS de un formato de meta.json: la suya o, si adoptó la regulación siguiente, la de su familia
const configuracionDe = (id) => FORMATOS.find((x) => x.id === id) ?? FORMATOS.find((x) => x.patron?.test(id));
const ordenarFormatos = (lista) => [...lista].sort((a, b) => {
  const pa = ORDEN_DE_FORMATOS.indexOf(a.id), pb = ORDEN_DE_FORMATOS.indexOf(b.id);
  return (pa < 0 ? 999 : pa) - (pb < 0 ? 999 : pb);
});
const mesesDeDiferencia = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5)) - Number(a.slice(5));

// Mira, para cada formato de Smogon de datos/meta.json, si Smogon ha publicado un mes más reciente que el suyo (con el mismo id y el mismo
// corte de rating). No cambia de regulación por su cuenta: si Smogon ya publica la siguiente (regmc → …), lo anota en «avisos»,
// salvo con --adoptar-regulacion. Los formatos de FORMATOS que aún no están en meta.json se añaden. Devuelve { hayNuevo, formatos, avisos };
// «formatos» sirve para generarSmogon.
async function buscarNovedades(meta, adoptar) {
  const indice = await descargar(URL_SMOGON);
  const meses = [...indice.matchAll(/href="(\d{4}-\d{2})\/"/g)].map((m) => m[1]).sort().reverse();
  let ultimoMesConDatos = null;   // el mes más reciente que ya tiene ficheros: de él salen los avisos
  for (const mes of meses) {
    if (await ficherosDeMes(mes)) { ultimoMesConDatos = mes; break; }
  }

  const avisos = [];
  const formatos = [];
  let hayNuevo = false;
  for (const actual of deSmogon(meta)) {
    const configuracion = configuracionDe(actual.id) ?? actual;
    let elegido = { ...configuracion, id: actual.id, corte: actual.corte, mes: actual.mes };
    // Mes nuevo del mismo formato: el más reciente que tenga su fichero
    for (const mes of meses.filter((m) => m > actual.mes)) {
      if ((await ficherosDeMes(mes))?.some((x) => x.id === actual.id && x.corte === actual.corte)) {
        elegido = { ...elegido, mes, mesAnterior: actual.mes };
        hayNuevo = true;
        break;
      }
    }
    // Avisos, mirando el mes más reciente de Smogon (los formatos cerrados ya no se esperan ahí)
    const lista = ultimoMesConDatos && !configuracion.cerrado && (await ficherosDeMes(ultimoMesConDatos));
    if (lista) {
      const propios = lista.filter((x) => x.id === actual.id);
      const nuevo = (tipo, mensaje) => avisos.push({ tipo, formato: actual.id, mes: ultimoMesConDatos, mensaje });
      if (!propios.length && ultimoMesConDatos > actual.mes) {
        nuevo("formato-sin-datos", `${actual.nombre} no aparece en las estadísticas de Smogon de ${ultimoMesConDatos}. Puede estar a medio publicar, haber desaparecido o haber cambiado de regulación.`);
      } else if (propios.length && !propios.some((x) => x.corte === actual.corte)) {
        nuevo("corte-cambiado", `${actual.nombre} ya no se publica con corte ${actual.corte} en ${ultimoMesConDatos}; hay cortes ${propios.map((x) => x.corte).join(", ")}.`);
      }
      const siguiente = configuracion.patron && lista.filter((x) => configuracion.patron.test(x.id) && x.corte === actual.corte).map((x) => x.id).sort().at(-1);
      if (siguiente && siguiente > actual.id) {
        if (adoptar) {
          elegido = { ...elegido, id: siguiente, mes: ultimoMesConDatos, mesAnterior: undefined };
          hayNuevo = true;
          console.log(`  Regulación nueva adoptada: ${actual.id} → ${siguiente}`);
        } else {
          nuevo("regulacion-nueva", `Smogon ya publica ${siguiente} en ${ultimoMesConDatos} y la app sigue en ${actual.id}. Para pasar a ella: node herramientas/generar-datos.mjs --adoptar-regulacion (cambia el formato en la app, sus equipos guardados y el simulador, así que se decide a mano).`);
        }
      }
    }
    formatos.push(elegido);
  }
  // Formatos nuevos en FORMATOS (o que faltan en meta.json): se buscan en Smogon y se añaden
  const faltan = FORMATOS.filter((x) => !formatos.some((y) => y.id === x.id || x.patron?.test(y.id)));
  if (faltan.length && ultimoMesConDatos) {
    const nuevos = await resolverFormatos(ultimoMesConDatos, faltan);
    if (nuevos.length) {
      console.log(`  Formatos nuevos para la app: ${nuevos.map((x) => x.id).join(", ")}`);
      formatos.push(...nuevos);
      hayNuevo = true;
    }
  }
  return { hayNuevo, formatos, avisos };
}

// datos/avisos.json: los avisos de la última comprobación. La app no lo lee; es para quien mantiene los datos.
// «detectado» conserva la fecha en que se vio el aviso por primera vez.
async function escribirAvisos(avisos) {
  const anteriores = existsSync(join(RAIZ, "datos", "avisos.json")) ? (await leerJson("datos/avisos.json")).avisos ?? [] : [];
  const hoy = new Date().toISOString().slice(0, 10);
  const lista = avisos.map((a) => ({
    ...a,
    detectado: anteriores.find((x) => x.tipo === a.tipo && x.formato === a.formato && x.mes === a.mes)?.detectado ?? hoy,
  }));
  await escribir("datos/avisos.json", { avisos: lista });
  console.log(lista.length ? `  datos/avisos.json: ${lista.length} aviso(s)` : "  Sin avisos de Smogon");
}

async function descargarFuentes() {
  const csv = async (nombre) => leerCsv(await descargar(`${URL_CSV}${nombre}.csv`));
  // API de Pokémon Showdown: datos del simulador (Pokédex, movimientos, objetos, habilidades y tiers)
  const showdown = async (nombre) => {
    const texto = await descargar(`${URL_SHOWDOWN}${nombre}`);
    return nombre.endsWith(".json") ? JSON.parse(texto) : leerObjetoJs(texto);
  };
  const [pokedex, movimientos, objetos, habilidades, tiers] = await Promise.all(
    ["pokedex.json", "moves.json", "items.js", "abilities.js", "formats-data.js"].map(showdown));
  const nombres = ["pokemon", "moves", "move_names", "items", "item_names", "abilities", "ability_names",
    "natures", "nature_names", "types", "type_efficacy"];
  const tablas = Object.fromEntries(await Promise.all(nombres.map(async (n) => [n, await csv(n)])));
  return { pokedex, movimientos, objetos, habilidades, tiers, ...tablas };
}

// ---------------------------------------------------------------------------
// Lectura de formatos

function leerCsv(texto) {
  const filas = [];
  let fila = [];
  let campo = "";
  let entreComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') entreComillas = false;
      else campo += c;
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === ",") {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else {
      campo += c;
    }
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  const [cabecera, ...resto] = filas;
  return resto.filter((f) => f.length > 1).map((f) => Object.fromEntries(cabecera.map((c, i) => [c, f[i] ?? ""])));
}

// Los ficheros .js de Showdown son objetos de JavaScript, no JSON. En lugar de ejecutar código
// descargado de Internet, se leen con este pequeño analizador (objetos, listas, textos y números).
function leerObjetoJs(texto) {
  let i = texto.indexOf("{");
  const saltarEspacios = () => { while (i < texto.length && /\s/.test(texto[i])) i++; };
  const leerTexto = () => {
    const comilla = texto[i++];
    let resultado = "";
    while (texto[i] !== comilla) {
      if (texto[i] === "\\") {
        const siguiente = texto[i + 1];
        if (siguiente === "u") { resultado += String.fromCharCode(parseInt(texto.slice(i + 2, i + 6), 16)); i += 6; }
        else { resultado += siguiente === "n" ? "\n" : siguiente; i += 2; }
      } else {
        resultado += texto[i++];
      }
    }
    i++;
    return resultado;
  };
  const leerValor = () => {
    saltarEspacios();
    const c = texto[i];
    if (c === "{" || c === "[") {
      const esObjeto = c === "{";
      const cierre = esObjeto ? "}" : "]";
      const valor = esObjeto ? {} : [];
      i++;
      for (;;) {
        saltarEspacios();
        if (texto[i] === cierre) { i++; return valor; }
        if (esObjeto) {
          let clave;
          if (texto[i] === '"' || texto[i] === "'") {
            clave = leerTexto();
          } else {
            clave = /^[\w$]+/.exec(texto.slice(i, i + 80))[0];
            i += clave.length;
          }
          saltarEspacios();
          i++; // los dos puntos
          valor[clave] = leerValor();
        } else {
          valor.push(leerValor());
        }
        saltarEspacios();
        if (texto[i] === ",") i++;
      }
    }
    if (c === '"' || c === "'") return leerTexto();
    const literal = /^(-?\d+(\.\d+)?(e[+-]?\d+)?|true|false|null|undefined)/i.exec(texto.slice(i, i + 40));
    if (!literal) throw new Error(`Valor inesperado en la posición ${i}: ${texto.slice(i, i + 30)}`);
    i += literal[0].length;
    if (literal[0] === "true") return true;
    if (literal[0] === "false") return false;
    if (literal[0] === "null" || literal[0] === "undefined") return null;
    return Number(literal[0]);
  };
  return leerValor();
}

// ---------------------------------------------------------------------------
// Diccionario: todo lo que la app necesita para traducir y calcular

// Identificador de Showdown: minúsculas, sin espacios ni signos («Choice Specs» → «choicespecs»)
const aId = (texto) => texto.toLowerCase().replace(/[^a-z0-9]+/g, "");

function nombresPorIdioma(filas, campoId) {
  const nombres = new Map();
  for (const fila of filas) {
    const idioma = fila.local_language_id === ESPANOL ? "es" : fila.local_language_id === INGLES ? "en" : null;
    if (!idioma) continue;
    nombres.set(fila[campoId], { ...nombres.get(fila[campoId]), [idioma]: fila.name });
  }
  return nombres;
}

// Español de PokeAPI para cada identificador de Showdown («draco-meteor» → «dracometeor» → «Cometa Draco»)
function traducciones(filas, nombres, campoId, renombrados = {}) {
  const porId = nombresPorIdioma(nombres, campoId);
  return new Map(filas.map((f) => [renombrados[f.identifier] ?? aId(f.identifier), porId.get(f.id)?.es]).filter(([, es]) => es));
}

function crearDiccionario(fuentes) {
  const tipos = new Map(fuentes.types.filter((t) => Number(t.id) <= 18).map((t) => [t.id, t.identifier]));
  const tabla = {};
  for (const fila of fuentes.type_efficacy) {
    const factor = Number(fila.damage_factor) / 100;
    const ataque = tipos.get(fila.damage_type_id);
    const defensa = tipos.get(fila.target_type_id);
    if (ataque && defensa && factor !== 1) (tabla[ataque] ??= {})[defensa] = factor;
  }

  const movimientosEs = traducciones(fuentes.moves, fuentes.move_names, "move_id");
  const movimientos = {};
  for (const [id, m] of Object.entries(fuentes.movimientos)) {
    if (m.num <= 0 || m.isZ || m.isMax || ["CAP", "Custom"].includes(m.isNonstandard)) continue;
    movimientos[id] = {
      en: m.name, es: movimientosEs.get(id) ?? m.name, tipo: m.type.toLowerCase(),
      clase: { Physical: "Físico", Special: "Especial", Status: "Estado" }[m.category],
      potencia: m.basePower || null, precision: m.accuracy === true ? null : m.accuracy,
    };
  }

  const objetosEs = traducciones(fuentes.items, fuentes.item_names, "item_id", OBJETOS_RENOMBRADOS);
  const objetos = {};
  for (const [id, o] of Object.entries(fuentes.objetos)) {
    if (!o.name || o.num <= 0 || ["CAP", "Custom"].includes(o.isNonstandard)) continue;
    objetos[id] = { en: o.name, es: objetosEs.get(id) ?? o.name };
  }

  const habilidadesEs = traducciones(fuentes.abilities, fuentes.ability_names, "ability_id");
  const habilidades = {};
  for (const [id, h] of Object.entries(fuentes.habilidades)) {
    if (!h.name || h.num <= 0 || ["CAP", "Custom"].includes(h.isNonstandard)) continue;
    // Showdown separa en cuatro la habilidad de Ogerpon («Embody Aspect (Teal)»…); PokeAPI tiene una sola
    const sinParentesis = aId(h.name.replace(/\s*\(.*\)$/, ""));
    habilidades[id] = { en: h.name, es: habilidadesEs.get(id) ?? habilidadesEs.get(sinParentesis) ?? h.name };
  }

  const naturalezasEs = nombresPorIdioma(fuentes.nature_names, "nature_id");
  const naturalezas = {};
  for (const n of fuentes.natures) {
    const nombre = n.identifier[0].toUpperCase() + n.identifier.slice(1);
    const sube = Number(n.increased_stat_id) - 1;
    const baja = Number(n.decreased_stat_id) - 1;
    naturalezas[nombre] = { en: nombre, es: naturalezasEs.get(n.id)?.es ?? nombre, ...(sube !== baja ? { sube, baja } : {}) };
  }

  const idsPokeapi = new Map(fuentes.pokemon.map((p) => [p.identifier, Number(p.id)]));
  const especies = {};
  const sinPareja = [];
  for (const [id, e] of Object.entries(fuentes.pokedex)) {
    const tiers = fuentes.tiers[id] ?? {};
    // Las formas solo estéticas (Gastrodon-East…) no traen datos: son iguales que su especie
    if (!e.types || !(e.num > 0) || ["CAP", "Custom", "LGPE"].includes(tiers.isNonstandard ?? e.isNonstandard)) continue;
    if (/-(Gmax|Totem)$/.test(e.name)) continue;
    const pareja = emparejar(e.name, idsPokeapi);
    if (!pareja) { sinPareja.push(e.name); continue; }
    especies[e.name] = {
      en: e.name,   // nombre de Showdown, el que se enseña en inglés
      clave: pareja.clave,
      id: idsPokeapi.get(pareja.clave),
      num: e.num,
      tipos: e.types.map((t) => t.toLowerCase()),
      base: ESTADISTICAS.map((s) => e.baseStats[s]),
      habilidades: Object.values(e.abilities).map(aId),
      ...(pareja.exacta ? {} : { aproximada: true }),
      ...(e.baseSpecies && e.baseSpecies !== e.name ? { especie: e.baseSpecies } : {}),
      ...(tiers.tier && tiers.tier !== "Illegal" ? { tier: tiers.tier } : {}),
      ...(tiers.natDexTier && tiers.natDexTier !== "Illegal" ? { tierNatDex: tiers.natDexTier } : {}),
    };
  }
  if (sinPareja.length) console.log(`  Sin pareja en PokeAPI (${sinPareja.length}): ${sinPareja.slice(0, 30).join(", ")}${sinPareja.length > 30 ? "…" : ""}`);
  const aproximadas = Object.entries(especies).filter(([, e]) => e.aproximada).map(([n, e]) => `${n}→${e.clave}`);
  if (aproximadas.length) console.log(`  Con la imagen de su forma base (${aproximadas.length}): ${aproximadas.slice(0, 25).join(", ")}${aproximadas.length > 25 ? "…" : ""}`);

  return { especies, movimientos, objetos, habilidades, naturalezas, tabla };
}

// ---------------------------------------------------------------------------
// Simulador de combates

// Lo que el motor del simulador necesita y el diccionario no trae: de cada movimiento del diccionario,
// sus datos de combate, y de cada Pokémon de los formatos, su peso (lo usan Patada Baja, Hierba Lazo o
// Cuerpo Pesado). Los identificadores (características, problemas de estado, condiciones de campo) son
// los de Showdown. Solo se escribe lo que no vale lo de siempre.
// Los movimientos que no usa ningún Pokémon de ningún formato llevan «sinUso»: el motor los juega con
// estos datos, pero nadie ha repasado si en el juego hacen algo más (ver SIN_PROGRAMAR en js/sim/motor.js).
function crearDatosDeCombate(fuentes, pokemon, diccionario) {
  const enUso = new Set(pokemon.flatMap((p) => p.movimientos.map(([id]) => id)));
  enUso.add("struggle");   // Forcejeo: lo que queda cuando se acaban los PP
  const ids = new Set([...enUso, ...Object.keys(diccionario.movimientos)]);
  const movimientos = {};
  for (const id of [...ids].sort()) {
    if (!fuentes.movimientos[id]) continue;
    movimientos[id] = { ...datosDeCombate(fuentes.movimientos[id]), ...(enUso.has(id) ? {} : { sinUso: true }) };
  }
  const pesos = {};
  for (const nombre of [...new Set(pokemon.map((p) => p.nombre))].sort()) {
    const peso = fuentes.pokedex[aId(nombre)]?.weightkg;
    if (peso) pesos[nombre] = peso;
  }
  return { movimientos, pesos };
}

// Las Megaevoluciones, sacadas de los objetos de Showdown (campo «megaStone» de cada megapiedra):
// { "Salamence-Mega": { base: "Salamence", piedra: "salamencite" } }. Solo las formas que están en el diccionario.
// El motor saca a la forma base y la megaevoluciona en el campo si lleva su piedra y el formato tiene Megaevolución.
function crearMegas(fuentes, diccionario) {
  const megas = {};
  for (const [id, o] of Object.entries(fuentes.objetos)) {
    if (!o.megaStone || typeof o.megaStone !== "object") continue;
    for (const [base, forma] of Object.entries(o.megaStone)) {
      if (diccionario.especies[base] && diccionario.especies[forma]) megas[forma] = { base, piedra: id };
    }
  }
  return Object.fromEntries(Object.entries(megas).sort((a, b) => a[0].localeCompare(b[0])));
}

function datosDeCombate(m) {
  const marcas = Object.keys(m.flags ?? {}).map((marca) => MARCAS_DE_COMBATE[marca]).filter(Boolean);
  const objetivo = OBJETIVOS_DE_COMBATE[m.target] ?? "rival";
  // Casi todo lo que va contra el rival lo para Protección: se apunta solo lo que no
  if (objetivo === "rival" && !m.flags?.protect) marcas.push("saltaProteccion");
  // Efectos secundarios, cada uno con su probabilidad: sobre el rival («estado», «volatil», «cambios») o sobre quien ataca («propios»)
  const efectos = (m.secondaries ?? (m.secondary ? [m.secondary] : []))
    .map((s) => sinVacios({
      prob: s.chance ?? 100, estado: s.status, volatil: s.volatileStatus, cambios: s.boosts, propios: s.self?.boosts,
    }))
    .filter((efecto) => Object.keys(efecto).length > 1);
  return sinVacios({
    pp: m.noPPBoosts ? m.pp : (m.pp * 8) / 5,        // con los PP subidos al máximo, como en competitivo
    prioridad: m.priority,
    objetivo: objetivo === "rival" ? null : objetivo,
    marcas,
    efectos,
    estado: m.status,                                 // problema de estado que pone siempre (Tóxico, Onda Trueno)
    volatil: m.volatileStatus,                        // lo que dura mientras el Pokémon siga en el campo (Mofa, Sustituto, Protección)
    propioVolatil: m.self?.volatileStatus,
    cambios: m.boosts,                                // cambios de características sobre el objetivo (en Danza Espada, uno mismo)
    propios: m.self?.boosts ?? m.selfBoost?.boosts,   // lo que le cambia a quien ataca (A Bocajarro, Cometa Draco)
    robo: m.drain,                                    // [numerador, denominador] del daño hecho
    retroceso: m.recoil,
    cura: m.heal,
    cambioTras: m.selfSwitch,                         // true, «copyvolatile» (Relevo) o «shedtail» (Autotomía Caudal)
    fuerzaCambio: m.forceSwitch,
    bando: m.sideCondition,                           // trampas y pantallas
    clima: m.weather,
    campo: m.terrain,
    seudoclima: m.pseudoWeather,                      // Espacio Raro, Gravedad
    ranura: m.slotCondition,                          // Deseo, Deseo Cura
    golpes: m.multihit,
    multiprecision: m.multiaccuracy,
    critico: m.critRatio > 1 ? m.critRatio : null,
    criticoSeguro: m.willCrit,
    danoFijo: m.damage,
    fulminante: m.ohko,
    autodestruccion: m.selfdestruct,
    choque: m.hasCrashDamage,
    rompeProteccion: m.breaksProtect,
    ignoraCambios: m.ignoreDefensive,
    ignoraHabilidad: m.ignoreAbility,
    atacaCon: m.overrideOffensiveStat,
    atacaConLaDelRival: m.overrideOffensivePokemon === "target",
    defiendeCon: m.overrideDefensiveStat,
    descongelaAlRival: m.thawsTarget,
  });
}

// Quita de un objeto lo que no dice nada: sin valor, falso, cero o lista vacía
function sinVacios(objeto) {
  return Object.fromEntries(Object.entries(objeto).filter(([, valor]) =>
    valor !== undefined && valor !== null && valor !== false && valor !== 0 && !(Array.isArray(valor) && valor.length === 0)));
}

// Nombre de Showdown → nombre de PokeAPI («Landorus-Therian» → «landorus-therian», «Urshifu» → «urshifu-single-strike»)
function emparejar(nombre, idsPokeapi) {
  const base = nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[’'.:%]/g, "").replace(/[\s_]+/g, "-").replace(/-+/g, "-");
  if (EXCEPCIONES[base] && idsPokeapi.has(EXCEPCIONES[base])) return { clave: EXCEPCIONES[base], exacta: true };
  if (idsPokeapi.has(base)) return { clave: base, exacta: true };
  const conGenero = base.replace(/-f(-|$)/, "-female$1").replace(/-m(-|$)/, "-male$1");
  if (idsPokeapi.has(conGenero)) return { clave: conGenero, exacta: true };
  // Forma por defecto con otro nombre en PokeAPI: se elige la de número más bajo
  const formas = [...idsPokeapi].filter(([clave]) => clave.startsWith(`${base}-`)).sort((a, b) => a[1] - b[1]);
  if (formas.length) return { clave: formas[0][0], exacta: true };
  // Forma que PokeAPI no tiene (megas nuevas, colores de Vivillon…): se usa la especie base
  const partes = base.split("-");
  while (partes.length > 1) {
    partes.pop();
    if (idsPokeapi.has(partes.join("-"))) return { clave: partes.join("-"), exacta: false };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Formatos

function nombreDeFormato(id) {
  const reg = id.match(/reg([a-z])([a-z]?)(bo3)?$/);
  const bo3 = reg?.[3] ? " Bo3" : "";
  const regulacion = reg ? ` Reg ${reg[1].toUpperCase()}${reg[2] ? `-${reg[2].toUpperCase()}` : ""}` : "";
  const vgc = id.match(/vgc(\d{4})/);
  if (vgc) return { nombre: `VGC ${vgc[1]}${regulacion}${bo3}`, corto: `VGC${regulacion.replace(" Reg", "")}${bo3}` };
  if (id.includes("bss")) return { nombre: `BSS${regulacion}${bo3}`, corto: `BSS${regulacion.replace(" Reg", "")}${bo3}` };
  const [, generacion, resto] = id.match(/^gen(\d+)(.*)$/);
  const tier = resto.replace(/^champions/, "").replace(/reg[a-z]+$/, "").toUpperCase();
  // Los de Pokémon Champions no son los de Gen 9: «Champions OU»
  if (resto.startsWith("champions")) return { nombre: `Champions ${tier}`, corto: `Champions ${tier}` };
  return { nombre: `Gen ${generacion} ${tier}${regulacion}`, corto: tier };
}

function procesarFormato(formato, chaos, diccionario, mes, megas = {}) {
  const champions = formato.id.includes("champions");
  // Smogon y Showdown escriben a veces distinto el mismo nombre («Sirfetch'd» y «Sirfetch’d»)
  const porId = new Map(Object.keys(diccionario.especies).map((nombre) => [aId(nombre), nombre]));
  const canonico = (nombre) => porId.get(aId(nombre)) ?? nombre;
  const renombrar = (pesos) => Object.fromEntries(Object.entries(pesos ?? {}).map(([nombre, valor]) => [canonico(nombre), valor]));
  const entradas = Object.entries(chaos.data)
    .map(([nombre, d]) => [canonico(nombre), { ...d, Teammates: renombrar(d.Teammates), "Checks and Counters": renombrar(d["Checks and Counters"]) }])
    .sort((a, b) => b[1].usage - a[1].usage);
  const total = (d) => Object.values(d.Abilities).reduce((suma, peso) => suma + peso, 0);
  const porcentaje = (peso, d) => redondear((peso / total(d)) * 100, 1);
  const mejores = (pesos, d, cuantos) => Object.entries(pesos ?? {})
    .filter(([clave]) => clave && clave !== "nothing")
    .sort((a, b) => b[1] - a[1]).slice(0, cuantos)
    .map(([clave, peso]) => [clave, porcentaje(peso, d)]);
  const conTera = entradas.some(([, d]) => Object.keys(d["Tera Types"] ?? {}).some((t) => t !== "nothing"));

  const pokemon = entradas
    .filter(([, d]) => d.usage * 100 >= USO_MINIMO)
    .slice(0, POKEMON_MAXIMOS)
    .map(([nombre, d], indice) => {
      const habilidades = mejores(d.Abilities, d, 3);
      const objetos = mejores(d.Items, d, 6);
      const movimientos = mejores(d.Moves, d, 10);
      const counters = Object.entries(d["Checks and Counters"] ?? {})
        .filter(([, c]) => c.n >= 20)
        .map(([rival, c]) => [rival, redondear(c.p * 100, 1), redondear((c.p - 4 * c.d) * 100, 1)])
        .sort((a, b) => b[2] - a[2]).slice(0, 6);
      return {
        nombre,
        puesto: indice + 1,
        uso: redondear(d.usage * 100, 2),
        habilidades,
        objetos,
        movimientos,
        ...(conTera ? { tera: mejores(d["Tera Types"], d, 4) } : {}),
        spreads: Object.entries(d.Spreads).sort((a, b) => b[1] - a[1]).slice(0, 3)
          .map(([spread, peso]) => [...spread.split(":"), porcentaje(peso, d)]),
        companeros: mejores(d.Teammates, d, 8),
        counters,
        roles: calcularRoles(diccionario.especies[nombre], habilidades, objetos, movimientos),
      };
    });

  const { nombre, corto } = nombreDeFormato(formato.id);
  return {
    id: formato.id, nombre, corto, juego: formato.juego, grupo: formato.grupo, modo: formato.modo, fuente: "smogon", cerrado: Boolean(formato.cerrado),
    nivel: champions || formato.modo === "Doubles" || formato.id.includes("bss") ? 50 : 100,
    ivs: champions ? null : 31,        // Champions no usa IVs; js/meta.js calcula las estadísticas reales con este dato
    usoMinimo: USO_MINIMO,
    champions, tera: conTera,
    mega: pokemon.some((p) => megas[p.nombre]),   // hay Megaevolución si los equipos del formato llevan formas Mega
    mes, corte: formato.corte, partidas: chaos.info["number of battles"],
    pokemon,
    nucleos: calcularNucleos(entradas.slice(0, 30), pokemon, total),
  };
}

function calcularRoles(especie, habilidades, objetos, movimientos) {
  const roles = [];
  for (const rol of ROLES) {
    const cumple =
      (rol.habilidades && habilidades.some(([id, pct]) => rol.habilidades.includes(id) && pct >= 50)) ||
      (rol.objetos && objetos.filter(([id]) => rol.objetos.includes(id)).reduce((s, [, pct]) => s + pct, 0) >= 30) ||
      (rol.movimientos && movimientos.some(([id, pct]) => rol.movimientos.includes(id) && pct >= 30)) ||
      (rol.velocidad && especie && especie.base[5] >= rol.velocidad);
    if (cumple) roles.push(rol.nombre);
  }
  return roles.slice(0, 3);
}

// Núcleos: tríos de Pokémon que aparecen juntos en muchos equipos.
// Smogon solo da parejas (qué % de los equipos de A llevan a B), así que la fuerza de una
// pareja es la media geométrica de los dos sentidos, y la de un trío, su pareja más débil. Esa cifra es una COTA: los tres juntos
// nunca son más que su pareja más débil, así que «juntos» es un máximo y el núcleo lleva «cota: true».
// Con «triosReales» (formatos de torneos, donde se ven los equipos enteros) «juntos» es el % real de equipos que llevan los tres
// y no hay «cota». triosReales: [{ miembros, juntos }].
function calcularNucleos(entradas, pokemon, total, triosReales = null) {
  const pct = new Map();
  for (const [nombre, d] of entradas) {
    for (const [companero, peso] of Object.entries(d.Teammates ?? {})) pct.set(`${nombre}|${companero}`, (peso / total(d)) * 100);
  }
  const pareja = (a, b) => Math.sqrt((pct.get(`${a}|${b}`) ?? 0) * (pct.get(`${b}|${a}`) ?? 0));
  const nombres = entradas.map(([nombre]) => nombre);
  const trios = triosReales ? [...triosReales] : [];
  for (let i = 0; !triosReales && i < nombres.length; i++) {
    for (let j = i + 1; j < nombres.length; j++) {
      for (let k = j + 1; k < nombres.length; k++) {
        const [a, b, c] = [nombres[i], nombres[j], nombres[k]];
        trios.push({ miembros: [a, b, c], juntos: Math.min(pareja(a, b), pareja(a, c), pareja(b, c)) });
      }
    }
  }
  trios.sort((x, y) => y.juntos - x.juntos);
  const elegidos = [];
  const apariciones = new Map();
  for (const trio of trios) {
    // Para que haya variedad: no se repite una pareja ya elegida y nadie sale en más de dos núcleos
    if (elegidos.some((e) => e.miembros.filter((m) => trio.miembros.includes(m)).length >= 2)) continue;
    if (trio.miembros.some((m) => (apariciones.get(m) ?? 0) >= 2)) continue;
    const roles = trio.miembros.flatMap((m) => pokemon.find((p) => p.nombre === m)?.roles ?? []);
    const estilo = ROLES_DE_EQUIPO.find((r) => roles.includes(r));
    elegidos.push({ estilo: estilo ?? null, miembros: trio.miembros, juntos: redondear(trio.juntos, 1), ...(triosReales ? {} : { cota: true }) });
    for (const m of trio.miembros) apariciones.set(m, (apariciones.get(m) ?? 0) + 1);
    if (elegidos.length === 4) break;
  }
  return elegidos;
}

// ---------------------------------------------------------------------------
// Escritura

function redondear(numero, decimales) {
  const factor = 10 ** decimales;
  return Math.round(numero * factor) / factor;
}

async function escribir(ruta, datos) {
  await writeFile(join(RAIZ, ruta), JSON.stringify(datos));
}

// El service worker guarda una copia de la app en el móvil. Al cambiar DATOS, el móvil
// detecta que hay versión nueva y descarga los ficheros otra vez.
async function actualizarServiceWorker(mes) {
  const ruta = join(RAIZ, "sw.js");
  if (!existsSync(ruta)) return;
  const codigo = await readFile(ruta, "utf8");
  const nuevo = codigo.replace(/const DATOS = "[^"]*";/, `const DATOS = "${mes}·${new Date().toISOString().slice(0, 10)}";`);
  await writeFile(ruta, nuevo);
}

await principal();
