// API web: PokeAPI (documentación: https://pokeapi.co/docs/v2). Es gratuita, no necesita clave
// y permite que una página web le pida datos (CORS abierto).
const URL_API = "https://pokeapi.co/api/v2/";
const ESPERA_MAXIMA_MS = 10_000; // como en el RNF-03 de la versión 1: como mucho 10 segundos

// Respuestas ya recibidas mientras la app está abierta, para no repetir peticiones a un servicio gratuito.
// Además, el service worker (sw.js) las guarda en el móvil para la próxima vez.
const memoria = new Map();

// Nombres en inglés (el idioma de la app) de las especies ya consultadas en esta sesión («melenaleteo» → «flutter-mane»).
// La app no trae los nombres en español de todas las especies: solo se conocen los de las fichas ya abiertas.
const clavePorNombreEspanol = new Map();

/** «Melenaléteo» → «melenaleteo»: minúsculas, sin tildes ni signos, para comparar nombres. */
export function normalizarNombre(texto) {
  return String(texto).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Clave de PokeAPI de un nombre en español ya visto en esta sesión, o null. */
export function claveDeNombreEspanol(texto) {
  return clavePorNombreEspanol.get(normalizarNombre(texto)) ?? null;
}

export class NoEncontrado extends Error {}

async function consultar(url) {
  if (memoria.has(url)) {
    return memoria.get(url);
  }
  // API del navegador: Fetch API
  const respuesta = await fetch(url, { signal: AbortSignal.timeout(ESPERA_MAXIMA_MS) });
  if (respuesta.status === 404) {
    throw new NoEncontrado(url);
  }
  if (!respuesta.ok) {
    throw new Error(`The API responded with code ${respuesta.status}`);
  }
  const datos = await respuesta.json();
  memoria.set(url, datos);
  return datos;
}

/** Busca un Pokémon por nombre o número. Son 2 peticiones: la del Pokémon y la de su especie. */
export async function buscarPokemon(busqueda) {
  // API web: PokeAPI, petición /pokemon/{nombre o número}
  const pokemon = await consultar(`${URL_API}pokemon/${encodeURIComponent(busqueda)}`);
  // API web: PokeAPI, petición /pokemon-species/{número}: nombre, categoría y descripción en inglés
  const especie = await consultar(pokemon.species.url);
  const nombre = enEspanol(especie.names);
  if (nombre && pokemon.is_default) clavePorNombreEspanol.set(normalizarNombre(nombre), pokemon.name);

  return {
    clave: pokemon.name,
    id: pokemon.id,               // las formas (megas, regionales…) tienen números a partir de 10001
    numero: especie.id,           // número de la Pokédex nacional
    nombre: nombre ?? pokemon.name,
    esFormaBase: pokemon.is_default,
    categoria: enEspanol(especie.genera, "genus") ?? "",
    tipos: pokemon.types.map((t) => t.type.name),
    altura: pokemon.height / 10,  // la API da la altura en decímetros
    peso: pokemon.weight / 10,    // y el peso en hectogramos
    imagen: pokemon.sprites.other?.["official-artwork"]?.front_default ?? pokemon.sprites.front_default,
    habilidades: pokemon.abilities.map((h) => ({ id: h.ability.name.replaceAll("-", ""), clave: h.ability.name, oculta: h.is_hidden })),
    estadisticas: pokemon.stats.map((s) => ({ clave: s.stat.name, valor: s.base_stat })),
    descripcion: ultimaEnEspanol(especie.flavor_text_entries),
    grito: pokemon.cries?.latest ?? null,
  };
}

function enEspanol(lista, campo = "name") {
  return lista.find((entrada) => entrada.language.name === "en")?.[campo];
}

/** La descripción más reciente en español, sin los saltos de línea que trae la API. */
function ultimaEnEspanol(textos) {
  const enEspanolTodas = textos.filter((t) => t.language.name === "en");
  return enEspanolTodas.at(-1)?.flavor_text.replace(/\s+/g, " ").trim() ?? null;
}
