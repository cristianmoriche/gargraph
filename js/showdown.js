// API web: Pokémon Showdown. Repeticiones, ladder y perfiles de jugador.
// Son públicas, no necesitan clave y admiten CORS, así que la app las pide directamente.
//   - Buscar repeticiones: https://replay.pokemonshowdown.com/search.json?user=…&format=…
//   - Una repetición:      https://replay.pokemonshowdown.com/{id}.json
//   - Perfil de jugador:   https://pokemonshowdown.com/users/{usuario}.json
//   - Ladder de un formato: https://pokemonshowdown.com/ladder/{formato}.json
import { aId, dic, especie, nombreDeEspecie } from "./meta.js";

const URL_REPETICIONES = "https://replay.pokemonshowdown.com/";
const URL_WEB = "https://pokemonshowdown.com/";
const ESPERA_MAXIMA_MS = 10_000;
const ESTADISTICAS_EN = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"];

export class SinDatos extends Error {}

// «leer404»: algunas direcciones responden 404 pero traen los datos igual (los perfiles de jugadores sin registrar)
async function pedir(url, { leer404 = false } = {}) {
  const respuesta = await fetch(url, { signal: AbortSignal.timeout(ESPERA_MAXIMA_MS) });
  if (respuesta.status === 404) {
    if (!leer404) throw new SinDatos(url);
    try {
      return await respuesta.json();
    } catch {
      throw new SinDatos(url); // un 404 sin JSON: no hay nada
    }
  }
  if (!respuesta.ok) throw new Error(`Showdown responded with code ${respuesta.status}`);
  return respuesta.json();
}

export function urlRepeticion(id) {
  return `${URL_REPETICIONES}${id}`;
}

export function urlPerfil(usuario) {
  return `${URL_WEB}users/${aId(usuario)}`;
}

/** Las 51 repeticiones más recientes de un jugador o de un formato. */
export async function buscarRepeticiones({ usuario, formato } = {}) {
  const parametros = new URLSearchParams();
  if (usuario) parametros.set("user", aId(usuario));
  if (formato) parametros.set("format", formato);
  const lista = await pedir(`${URL_REPETICIONES}search.json?${parametros}`);
  return Array.isArray(lista) ? lista : [];
}

/** Saca el identificador de un enlace («https://replay.pokemonshowdown.com/gen9ou-123» → «gen9ou-123»). */
export function idDeRepeticion(texto) {
  const encontrado = String(texto).trim().toLowerCase().match(/([a-z0-9]+-\d+(?:-[a-z0-9]+pw)?)(?:\.json|\.log)?\/?(?:[?#].*)?$/);
  return encontrado?.[1] ?? null;
}

export async function leerRepeticion(enlaceOId) {
  const id = idDeRepeticion(enlaceOId);
  if (!id) throw new SinDatos(enlaceOId);
  return analizarRepeticion(await pedir(`${URL_REPETICIONES}${id}.json`));
}

/**
 * El registro (log) de una partida es texto con una acción por línea, separada por barras:
 *   |player|p1|Nombre|…    |poke|p1|Dragapult, L50, M|    |win|Nombre
 */
export function analizarRepeticion(repeticion) {
  const jugadores = { p1: repeticion.players?.[0] ?? "", p2: repeticion.players?.[1] ?? "" };
  const equipos = { p1: [], p2: [] };
  const salieron = { p1: [], p2: [] };
  let ganador = null;
  for (const linea of repeticion.log.split("\n")) {
    const partes = linea.split("|");
    const accion = partes[1];
    if (accion === "player" && partes[3]) {
      jugadores[partes[2]] = partes[3];
    } else if (accion === "poke" && equipos[partes[2]]) {
      equipos[partes[2]].push(limpiarEspecie(partes[3]));
    } else if ((accion === "switch" || accion === "drag") && partes[2]) {
      const lado = partes[2].slice(0, 2);
      const nombre = limpiarEspecie(partes[3]);
      if (salieron[lado] && !salieron[lado].includes(nombre)) salieron[lado].push(nombre);
    } else if (accion === "win") {
      ganador = partes[2];
    } else if (accion === "tie") {
      ganador = "";
    }
  }
  // Sin vista previa de equipos (algunos formatos), se usan los Pokémon que salieron al campo
  for (const lado of ["p1", "p2"]) {
    if (equipos[lado].length === 0) equipos[lado] = salieron[lado];
    // En la vista previa algunas formas salen sin concretar («Urshifu-*»): se cambia por la que salió
    equipos[lado] = equipos[lado].map((nombre) => salieron[lado].find((s) => s.split("-")[0] === nombre) ?? nombre);
  }
  return {
    id: repeticion.id,
    formato: repeticion.format,
    formatoId: repeticion.formatid,
    fecha: repeticion.uploadtime * 1000,
    rating: repeticion.rating || null,
    jugadores: [jugadores.p1, jugadores.p2],
    equipos: [equipos.p1, equipos.p2],
    ganador,
  };
}

function limpiarEspecie(texto = "") {
  return texto.split(",")[0].replace(/-\*$/, "").trim();
}

/**
 * Perfil público de un jugador: su Elo y su GXE en cada formato en el que ha jugado.
 * Showdown responde 404 a los usuarios sin registrar aunque tengan partidas, con sus datos dentro:
 * solo se da por inexistente (SinDatos) si la respuesta no trae «ratings», o si es de un usuario sin registrar
 * (registertime 0) con «ratings» vacío: es lo que Showdown contesta a cualquier nombre que no existe.
 */
export async function perfilDeJugador(usuario) {
  const perfil = await pedir(`${URL_WEB}users/${aId(usuario)}.json`, { leer404: true });
  const sinPartidas = !perfil?.ratings || typeof perfil.ratings !== "object" || Object.keys(perfil.ratings).length === 0;
  if (!perfil || typeof perfil !== "object" || (sinPartidas && !perfil.registertime)) throw new SinDatos(usuario);
  const valoraciones = Object.entries(perfil.ratings ?? {})
    .map(([formato, r]) => ({ formato, elo: Math.round(r.elo), gxe: r.gxe, victorias: r.w, derrotas: r.l }))
    .sort((a, b) => b.elo - a.elo);
  return { nombre: perfil.username, registro: perfil.registertime * 1000, valoraciones };
}

/** Los mejores jugadores de un formato. */
export async function ladder(formato) {
  const datos = await pedir(`${URL_WEB}ladder/${formato}.json`);
  return (datos.toplist ?? []).map((j) => ({ nombre: j.username, elo: Math.round(j.elo), gxe: j.gxe, victorias: j.w, derrotas: j.l }));
}

// ---------------------------------------------------------------------------
// Formato de equipos de Showdown (botones Import / Export del Teambuilder):
//
//   Dragapult @ Choice Specs
//   Ability: Infiltrator
//   Tera Type: Ghost
//   EVs: 252 SpA / 4 SpD / 252 Spe
//   Timid Nature
//   - Draco Meteor

/**
 * Texto de Showdown → lista de sets (como mucho 6). Solo entran las especies que están en el diccionario,
 * con su nombre de Showdown («great tusk» → «Great Tusk»). La lista lleva además la propiedad
 * «descartados»: los nombres que no se han reconocido, «sobrantes»: cuántos pasaban de 6 y «cabecera»: { formato, nombre }
 * de la línea «=== [formato] Carpeta/Nombre ===» si la trae (null si no). La pantalla avisa con ellos.
 *   const sets = importarEquipo(texto); // un array normal; sets.descartados → ["hola mundo"]
 */
export function importarEquipo(texto) {
  let cabecera = null;
  const bloques = String(texto ?? "").replace(/\r/g, "").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).map((bloque) => {
    // L4: la cabecera de una exportación («=== [gen9ou] Carpeta/Mi equipo ===») no es un Pokémon
    const lineas = bloque.split("\n");
    const datos = lineas[0].trim().match(/^===\s*(?:\[([^\]]*)\])?\s*(.*?)\s*===$/);
    if (!datos) return bloque;
    cabecera ??= { formato: datos[1] || null, nombre: datos[2].split("/").pop().trim() || null };
    return lineas.slice(1).join("\n").trim();
  }).filter(Boolean);
  const sets = [];
  const descartados = [];
  for (const set of bloques.map(leerBloque)) {
    if (!set.especie) continue;
    const nombre = especie(set.especie) ? set.especie : nombreDeEspecie(set.especie);
    if (nombre) sets.push({ ...set, especie: megaPorPiedra(nombre, set.objeto) });
    else descartados.push(set.especie);
  }
  // L3: de más de 6 solo entran 6; «sobrantes» dice cuántos se han quedado fuera
  return Object.assign(sets.slice(0, 6), { descartados, sobrantes: Math.max(0, sets.length - 6), cabecera });
}

/**
 * L1: Showdown apunta la mega con su especie base y su piedra («Charizard @ Charizardite Y»). Devuelve la mega que
 * corresponde a esa piedra (Charizard-Mega-Y) o, si el objeto no es la piedra de una mega, el mismo nombre.
 */
function megaPorPiedra(nombre, objeto) {
  const en = dic().objetos[objeto]?.en;
  if (!en || especie(nombre)?.especie) return nombre;
  const piedra = en.match(/ite(?: ([XYZ]))?$/);
  if (!piedra || !aId(en).startsWith(aId(nombre).slice(0, 5))) return nombre; // Latiosite no es de Latias
  const mega = `${nombre}-Mega${piedra[1] ? `-${piedra[1]}` : ""}`;
  return especie(mega)?.especie === nombre ? mega : nombre;
}

function leerBloque(bloque) {
  const [primera, ...resto] = bloque.split("\n").map((linea) => linea.trim());
  const [nombres, objeto] = primera.split(" @ ");
  const sinGenero = nombres.replace(/\s\((M|F)\)\s*$/, "").trim();
  const conApodo = sinGenero.match(/^.*\(([^()]+)\)$/); // «Apodo (Especie)»
  const set = {
    especie: (conApodo ? conApodo[1] : sinGenero).trim(),
    objeto: objeto ? aId(objeto) : null,
    habilidad: null,
    tera: null,
    naturaleza: null,
    valores: [0, 0, 0, 0, 0, 0],
    movimientos: [],
  };
  for (const linea of resto) {
    if (linea.startsWith("Ability:")) {
      set.habilidad = aId(linea.slice(8));
    } else if (linea.startsWith("Tera Type:")) {
      set.tera = linea.slice(10).trim().toLowerCase();
    } else if (linea.startsWith("EVs:")) {
      for (const parte of linea.slice(4).split("/")) {
        const [cantidad, estadistica] = parte.trim().split(/\s+/);
        const indice = ESTADISTICAS_EN.indexOf(estadistica);
        if (indice >= 0) set.valores[indice] = Number(cantidad) || 0;
      }
    } else if (/ Nature$/.test(linea)) {
      set.naturaleza = linea.replace(/ Nature$/, "").trim();
    } else if (linea.startsWith("-") && set.movimientos.length < 4) {
      set.movimientos.push(aId(linea.slice(1).replace(/\[.*\]/, "")));
    }
  }
  return set;
}

/** Equipo de la app → texto para pegar en Showdown. Necesita el diccionario para los nombres en inglés. */
export function exportarEquipo(miembros, diccionario) {
  return miembros.map((m) => {
    // Las megas y las formas primigenias se apuntan con su especie base: evolucionan en combate con su objeto.
    // Solo si el objeto es su piedra (L1: al importar se vuelve a deducir la mega); si no, se conserva la forma
    const base = diccionario.especies[m.especie]?.especie;
    const especie = base && /-(Mega(-[XYZ])?|Primal)$/.test(m.especie) && (!/-Mega/.test(m.especie) || megaPorPiedra(base, m.objeto) === m.especie) ? base : m.especie;
    const lineas = [m.objeto ? `${especie} @ ${diccionario.objetos[m.objeto]?.en ?? m.objeto}` : especie];
    if (m.habilidad) lineas.push(`Ability: ${diccionario.habilidades[m.habilidad]?.en ?? m.habilidad}`);
    if (m.tera) lineas.push(`Tera Type: ${m.tera.charAt(0).toUpperCase()}${m.tera.slice(1)}`);
    const valores = m.valores.map((v, i) => (v ? `${v} ${ESTADISTICAS_EN[i]}` : null)).filter(Boolean);
    if (valores.length) lineas.push(`EVs: ${valores.join(" / ")}`);
    if (m.naturaleza) lineas.push(`${m.naturaleza} Nature`);
    for (const movimiento of m.movimientos) lineas.push(`- ${diccionario.movimientos[movimiento]?.en ?? movimiento}`);
    return lineas.join("\n");
  }).join("\n\n");
}
