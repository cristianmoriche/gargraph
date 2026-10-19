// Gargraph · torneos de VGC de Limitless
//
// Módulo de herramientas/generar-datos.mjs (no se ejecuta solo salvo con --rellenar). Baja de la API pública de Limitless
// (https://play.limitlesstcg.com/api, documentación en https://docs.limitlesstcg.com/developer.html) los torneos de VGC de
// Pokémon Champions con sus clasificaciones y equipos, y los deja listos para contar.
//
//   node herramientas/limitless.mjs --rellenar     → solo baja y guarda en la caché los torneos que falten (sin escribir datos/)
//
// Condiciones de uso (leídas en la documentación el 2026-10-18):
//   - Los torneos, clasificaciones y equipos se piden sin clave. La clave solo es para /games/decks y para subir el límite, y solo
//     se da a proyectos públicos con un uso legítimo; aquí no se usa ninguna.
//   - Límite de peticiones: 50 cada 5 minutos ("RateLimit: 50-in-5min"). Se respeta con una pausa fija entre peticiones, leyendo
//     las cabeceras RateLimit de cada respuesta (si quedan pocas, se espera lo que dicen) y con un tope de peticiones por ejecución.
//   - Para no repetir peticiones, cada torneo ya terminado se guarda en una caché y no se vuelve a pedir.
//   - La app cita a Limitless y enlaza a cada torneo (campo «url» de datos/torneos/<id>.json).
// Variables de entorno:
//   LIMITLESS_CACHE   carpeta de la caché (por defecto, una carpeta del sistema)
//   LIMITLESS_MAXIMO  peticiones de clasificaciones por ejecución (por defecto 250: unos 25 minutos como mucho)
// Torneos en directo: los de las últimas 24 horas cuestan 3 peticiones cada uno (clasificación, emparejamientos y detalles, para saber
// la ronda por la que van y si han terminado); no se guardan en la caché y se vuelven a pedir en cada ejecución.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const URL_API = "https://play.limitlesstcg.com/api";
export const URL_TORNEO = "https://play.limitlesstcg.com/tournament/";
const CARPETA = process.env.LIMITLESS_CACHE ?? join(tmpdir(), "gargraph-limitless");
const MAXIMO_POR_EJECUCION = Number(process.env.LIMITLESS_MAXIMO ?? 250);
const PAUSA_ENTRE_PETICIONES = 1500;   // ms: 40 peticiones por minuto como mucho, y el límite es de 10 por minuto de media
const MINIMO_DE_JUGADORES = 8;         // los torneos más pequeños son demasiado ruido para contar equipos
const HORAS_EN_DIRECTO = 24;           // un torneo de hace menos horas puede seguir en juego: se mira su ronda
const DIAS_PARA_DAR_POR_PENDIENTE = 7; // sin clasificación pasados estos días, se deja de esperar y se guarda en la caché
const AGENTE = "Gargraph-datos (app web publica de estadisticas de Pokemon; datos de torneos de Limitless)";

// Los torneos de VGC de Champions: un formato de Limitless por regulación. «base» es el id del formato de Smogon de la misma
// regulación (js/meta.js busca el formato de repartos de respaldo por el principio del id).
export const FORMATOS_DE_TORNEOS = [
  { limitless: "M-C", id: "gen9championsvgc2026regmc-torneos", nombre: "VGC 2026 Tournaments Reg M-C", corto: "Tournaments M-C", cerrado: false },
  { limitless: "M-B", id: "gen9championsvgc2026regmb-torneos", nombre: "VGC 2026 Tournaments Reg M-B", corto: "Tournaments M-B", cerrado: true },
  { limitless: "M-A", id: "gen9championsvgc2026regma-torneos", nombre: "VGC 2026 Tournaments Reg M-A", corto: "Tournaments M-A", cerrado: true },
];

const MAXIMO_DE_TORNEOS = 30;       // torneos recientes que se publican, con todos sus equipos
const MAXIMO_DE_EQUIPOS_TOP = 200;
const MAXIMO_DE_GRUPOS = 600;       // grupos de equipos con los mismos 6 Pokémon que se publican (los que más equipos tienen)
const textoDeRecord = ({ w, l, t }) => `${w}-${l}${t ? `-${t}` : ""}`;

const aId = (texto) => String(texto ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// ---------------------------------------------------------------------------
// Peticiones, con pausa y respetando el límite

let peticiones = 0;       // en esta ejecución
let ultima = 0;

async function pedir(ruta) {
  for (let intento = 1; ; intento++) {
    const espera = ultima + PAUSA_ENTRE_PETICIONES - Date.now();
    if (espera > 0) await dormir(espera);
    ultima = Date.now();
    peticiones++;
    let respuesta;
    try {
      respuesta = await fetch(`${URL_API}${ruta}`, { headers: { "User-Agent": AGENTE, Accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
    } catch (error) {
      if (intento >= 3) throw new Error(`Limitless: ${ruta} no responde (${error.message})`);
      await dormir(3000 * intento);
      continue;
    }
    // RateLimit: "50-in-5min"; r=40; t=136 → quedan 40 peticiones y la ventana se renueva en 136 s
    const cabecera = respuesta.headers.get("ratelimit") ?? "";
    const quedan = Number(/r=(\d+)/.exec(cabecera)?.[1] ?? NaN);
    const renueva = Number(/t=(\d+)/.exec(cabecera)?.[1] ?? NaN);
    if (respuesta.status === 429) {
      const segundos = Number(respuesta.headers.get("retry-after")) || renueva || 60;
      console.warn(`  Limitless: límite alcanzado; espera de ${segundos + 1} s`);
      await dormir((segundos + 1) * 1000);
      if (intento >= 5) throw new Error("Limitless: sigue el límite de peticiones tras esperar");
      continue;
    }
    if (!respuesta.ok) {
      if (respuesta.status >= 500 && intento < 3) { await dormir(3000 * intento); continue; }
      throw new Error(`Limitless: ${ruta} → código ${respuesta.status}`);
    }
    const datos = await respuesta.json();
    if (quedan <= 1) {
      const segundos = (Number.isFinite(renueva) ? renueva : 300) + 1;
      console.log(`  Limitless: sin peticiones disponibles; espera de ${segundos} s para que se renueve el límite`);
      await dormir(segundos * 1000);
    }
    return datos;
  }
}

// ---------------------------------------------------------------------------
// Caché: un fichero por torneo terminado, con lo que se necesita de su clasificación

const rutaDeCache = (id) => join(CARPETA, `${id}.json`);

async function deLaCache(id) {
  const ruta = rutaDeCache(id);
  if (!existsSync(ruta)) return null;
  try {
    const torneo = JSON.parse(await readFile(ruta, "utf8"));
    return torneo.v === 2 ? torneo : null;   // las copias antiguas no traen el id del jugador ni el récord en números
  } catch {
    return null;
  }
}

// Una clasificación → { puesto, jugador, jugadorId, record: { w, l, t }, equipo: [{ id, nombre, objeto, habilidad, naturaleza, tera, movimientos }] }
function resumirClasificacion(filas) {
  return filas.map((f) => ({
    puesto: Number.isInteger(f.placing) ? f.placing : null,
    jugador: f.name || f.player || "",
    jugadorId: f.player || null,
    record: { w: f.record?.wins ?? 0, l: f.record?.losses ?? 0, t: f.record?.ties ?? 0 },
    equipo: (Array.isArray(f.decklist) ? f.decklist : []).map((p) => ({
      id: p.id ?? null, nombre: p.name ?? "", objeto: p.item || null, habilidad: p.ability || null, naturaleza: p.nature || null,
      tera: p.tera || null, movimientos: Array.isArray(p.attacks) ? p.attacks.filter(Boolean) : [],
    })),
  }));
}

// Estado de un torneo de las últimas horas, mirando sus emparejamientos y su estructura:
// { estado: "live" | "finished" | "pending", ronda, rondas } (ronda: la actual contando todas las fases; rondas: las previstas)
async function estadoEnJuego(t, clasificacion, edad) {
  const conPuestos = clasificacion.some((c) => c.puesto !== null);
  const terminado = conPuestos ? "finished" : "pending";
  const [emparejamientos, detalles] = [await pedir(`/tournaments/${t.id}/pairings`), await pedir(`/tournaments/${t.id}/details`)];
  const fases = Array.isArray(detalles.phases) ? detalles.phases : [];
  const rondas = fases.reduce((suma, fase) => suma + (fase.rounds || 0), 0) || null;
  if (!Array.isArray(emparejamientos) || !emparejamientos.length) {
    // Sin emparejamientos: acaba de empezar (en directo, ronda 0) o nunca se jugó
    return edad < 6 * 3600_000 ? { estado: "live", ronda: 0, rondas } : { estado: terminado, ronda: null, rondas };
  }
  const ultimaFase = Math.max(...emparejamientos.map((p) => p.phase));
  const rondaDeLaFase = Math.max(...emparejamientos.filter((p) => p.phase === ultimaFase).map((p) => p.round));
  const previas = fases.filter((fase) => fase.phase < ultimaFase).reduce((suma, fase) => suma + (fase.rounds || 0), 0);
  const decididas = emparejamientos.filter((p) => p.phase === ultimaFase && p.round === rondaDeLaFase).every((p) => p.winner !== null && p.winner !== undefined);
  const prevista = fases.find((fase) => fase.phase === ultimaFase)?.rounds;
  const ultima = fases.length > 0 && ultimaFase >= Math.max(...fases.map((fase) => fase.phase));
  if (ultima && prevista && rondaDeLaFase >= prevista && decididas) return { estado: terminado, ronda: previas + rondaDeLaFase, rondas };
  return { estado: "live", ronda: previas + rondaDeLaFase, rondas };
}

/**
 * Los torneos de un formato de Limitless con 8 jugadores o más, del más reciente al más antiguo, cada uno con su clasificación:
 * [{ id, nombre, fecha, jugadores, estado, ronda, rondas, clasificacion }]. Pide a la red solo los que no están en la caché y, como mucho, los que
 * quepan en el tope de peticiones de la ejecución; los que se queden sin bajar se cuentan en «pendientes».
 */
export async function torneosDeFormato(formatoLimitless) {
  await mkdir(CARPETA, { recursive: true });
  const lista = await pedir(`/tournaments?game=VGC&format=${encodeURIComponent(formatoLimitless)}&limit=1000`);
  if (!Array.isArray(lista)) throw new Error(`Limitless: la lista de torneos ${formatoLimitless} no es una lista`);
  const ahora = Date.now();
  const candidatos = lista
    .filter((t) => t.players >= MINIMO_DE_JUGADORES && Date.parse(t.date) <= ahora)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const torneos = [];
  let pendientes = 0;
  for (const t of candidatos) {
    const edad = ahora - Date.parse(t.date);
    const enJuego = edad < HORAS_EN_DIRECTO * 3600_000;
    let torneo = enJuego ? null : await deLaCache(t.id);
    if (!torneo) {
      if (!enJuego && peticiones >= MAXIMO_POR_EJECUCION) { pendientes++; continue; }
      try {
        const clasificacion = resumirClasificacion(await pedir(`/tournaments/${t.id}/standings`));
        const estado = enJuego
          ? await estadoEnJuego(t, clasificacion, edad)
          : { estado: clasificacion.some((c) => c.puesto !== null) ? "finished" : "pending", ronda: null, rondas: null };
        torneo = { v: 2, id: t.id, nombre: t.name, fecha: t.date, jugadores: t.players, ...estado, clasificacion };
        // Los terminados se guardan; uno sin clasificación se sigue pidiendo unos días por si el organizador la publica
        if (!enJuego && (torneo.estado === "finished" || edad > DIAS_PARA_DAR_POR_PENDIENTE * 86400_000)) await writeFile(rutaDeCache(t.id), JSON.stringify(torneo));
      } catch (error) {
        console.warn(`  Aviso: ${error.message}; se salta ese torneo`);
        pendientes++;
        continue;
      }
    } else {
      // Nombre y número de jugadores pueden haber cambiado desde que se guardó
      torneo = { ...torneo, nombre: t.name, jugadores: t.players };
    }
    torneos.push(torneo);
  }
  return { torneos, pendientes, total: candidatos.length };
}

// ---------------------------------------------------------------------------
// Nombres: de Limitless a los de Showdown que usa la app

// Formas con otro nombre en Limitless: «Rotom (Wash)» → «Rotom-Wash», «Urshifu (Rapid Strike)» → «Urshifu-Rapid-Strike»
function variantesDeNombre(nombre) {
  const limpio = nombre.replace(/\s+/g, " ").trim();
  const entreParentesis = /^(.*?)\s*\((.*)\)$/.exec(limpio);
  const lista = [limpio];
  if (entreParentesis) lista.push(`${entreParentesis[1]}-${entreParentesis[2]}`);
  // «Alolan Raichu», «Galarian Weezing»… → «Raichu-Alola»
  const jinete = /^(Ice|Shadow) Rider Calyrex$/i.exec(limpio);   // «Ice Rider Calyrex» → «Calyrex-Ice»
  if (jinete) lista.push(`Calyrex-${jinete[1]}`);
  const regiones = { Alolan: "Alola", Galarian: "Galar", Hisuian: "Hisui", Paldean: "Paldea" };
  for (const [adjetivo, region] of Object.entries(regiones)) {
    if (limpio.startsWith(`${adjetivo} `)) lista.push(`${limpio.slice(adjetivo.length + 1)}-${region}`);
  }
  return lista;
}

/**
 * Crea la función que convierte un Pokémon de Limitless ({ id, nombre, objeto }) en el nombre de Showdown de la app, o null si no
 * hay forma de emparejarlo. Con megapiedra de su especie, el nombre es el de la forma Mega (Limitless pone «Charizard» con
 * «Charizardite Y»; la app y Smogon cuentan «Charizard-Mega-Y»).
 */
export function crearConversor(diccionario, megas) {
  const porId = new Map(Object.keys(diccionario.especies).map((nombre) => [aId(nombre), nombre]));
  const porPiedra = new Map();   // «charizard|charizarditey» → «Charizard-Mega-Y»
  for (const [forma, { base, piedra }] of Object.entries(megas)) porPiedra.set(`${base}|${piedra}`, forma);
  const sinPareja = new Map();
  const especie = (p) => {
    const candidatos = [...variantesDeNombre(p.nombre), p.id ?? ""];
    let nombre = null;
    for (const c of candidatos) {
      nombre = porId.get(aId(c)) ?? null;
      if (nombre) break;
    }
    if (!nombre) {
      sinPareja.set(p.nombre, (sinPareja.get(p.nombre) ?? 0) + 1);
      return null;
    }
    return porPiedra.get(`${nombre}|${aId(p.objeto)}`) ?? nombre;
  };
  return { especie, sinPareja };
}

// El id de la lista a una o dos letras de «id» (una si es corto), solo si es único; null si no hay o hay empate
function parecido(ids, id) {
  const maximo = id.length >= 8 ? 2 : id.length >= 5 ? 1 : 0;
  if (!maximo) return null;
  let mejor = null, distanciaMejor = maximo + 1, empate = false;
  for (const candidato of ids) {
    if (Math.abs(candidato.length - id.length) > maximo) continue;
    const d = distancia(candidato, id, maximo);
    if (d < distanciaMejor) { mejor = candidato; distanciaMejor = d; empate = false; }
    else if (d === distanciaMejor && d <= maximo) empate = true;
  }
  return distanciaMejor <= maximo && !empate ? mejor : null;
}

// Distancia de edición (inserciones, borrados y cambios); devuelve «tope + 1» en cuanto sabe que se pasa del tope
function distancia(a, b, tope) {
  let anterior = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const fila = [i];
    for (let j = 1; j <= b.length; j++) fila[j] = Math.min(anterior[j] + 1, fila[j - 1] + 1, anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...fila) > tope) return tope + 1;
    anterior = fila;
  }
  return anterior[b.length];
}

// ---------------------------------------------------------------------------
// Conteo de los equipos

/**
 * Convierte los torneos en lo que hace falta para el formato y los torneos recientes:
 *   - «equipos»: número de equipos contados y «uso»: por Pokémon, cuántos equipos lo llevan y qué objetos, habilidades, teratipos,
 *     movimientos y compañeros llevan esos equipos.
 *   - «recientes»: los 30 torneos más recientes con su estado, su top 8 y todos sus equipos publicados, con los nombres ya convertidos.
 *   - «equiposTop» y «grupos»: los mejores equipos de esos torneos y los equipos agrupados por sus 6 Pokémon con su récord total.
 * Un equipo cuenta si tiene Pokémon en su lista (los torneos sin listas de equipos no cuentan). Cada Pokémon cuenta una vez por equipo.
 */
export function contarTorneos(torneos, diccionario, megas) {
  const { especie, sinPareja } = crearConversor(diccionario, megas);
  // Los equipos los escriben los organizadores y los jugadores a mano: «Lighting Rod», «Sword Dance»… Si el nombre no existe pero
  // hay una única entrada a una o dos letras de distancia, es esa; si no, se deja sin id (nunca se inventa uno).
  const parecidos = new Map();
  const idDe = (tabla, texto) => {
    const id = aId(texto);
    if (diccionario[tabla][id]) return id;
    const clave = `${tabla}|${id}`;
    if (!parecidos.has(clave)) parecidos.set(clave, parecido(Object.keys(diccionario[tabla]), id));
    return parecidos.get(clave);
  };
  const idObjeto = (texto) => idDe("objetos", texto);
  const idHabilidad = (texto) => idDe("habilidades", texto);
  const idMovimiento = (texto) => idDe("movimientos", texto);
  const sinId = { objetos: new Map(), habilidades: new Map(), movimientos: new Map() };
  const anotar = (donde, texto) => sinId[donde].set(texto, (sinId[donde].get(texto) ?? 0) + 1);

  const convertir = (p) => {
    const nombre = especie(p);
    if (!nombre) return null;
    const sinObjeto = !p.objeto || /^(no[- ]?item|none|nothing)$/i.test(p.objeto.trim());
    const objeto = sinObjeto ? null : idObjeto(p.objeto);
    if (!sinObjeto && !objeto) anotar("objetos", p.objeto);
    const habilidad = p.habilidad ? idHabilidad(p.habilidad) : null;
    if (p.habilidad && !habilidad) anotar("habilidades", p.habilidad);
    const movimientos = p.movimientos.map((m) => {
      const id = idMovimiento(m);
      if (!id) anotar("movimientos", m);
      return id;
    }).filter(Boolean);
    const tera = null;   // en Pokémon Champions no hay teracristalización: lo que traigan las listas es un error de quien las rellenó
    const naturaleza = Object.keys(diccionario.naturalezas).find((n) => aId(n) === aId(p.naturaleza)) ?? null;
    return { especie: nombre, objeto, habilidad, naturaleza, tera, movimientos };
  };

  const uso = new Map();
  const nuevo = () => ({ equipos: 0, objetos: new Map(), habilidades: new Map(), tera: new Map(), movimientos: new Map(), companeros: new Map() });
  const sumar = (mapa, clave) => { if (clave) mapa.set(clave, (mapa.get(clave) ?? 0) + 1); };
  let equipos = 0;
  let conEquipos = 0;
  const recientes = [];
  const grupos = new Map();    // los mismos 6 Pokémon → { especies, equipos, w, l, t }
  const trios = new Map();     // «A|B|C» (en orden alfabético) → equipos que llevan los tres
  const candidatosTop = [];    // equipos de seis de los torneos recientes, para el ranking de equipos top

  for (const torneo of torneos) {
    const reciente = recientes.length < MAXIMO_DE_TORNEOS;
    let hayEquipos = false;
    const filas = torneo.clasificacion.map((fila) => ({ fila, miembros: fila.equipo.map(convertir).filter(Boolean) }));
    const publicados = [];
    for (const { fila, miembros } of filas) {
      if (!miembros.length) continue;
      hayEquipos = true;
      equipos++;
      const url = fila.jugadorId ? `${URL_TORNEO}${torneo.id}/player/${encodeURIComponent(fila.jugadorId)}/teamlist` : null;
      publicados.push({ puesto: fila.puesto, jugador: fila.jugador, record: fila.record, ...(url ? { url } : {}), equipo: miembros });
      const vistos = new Set();
      for (const m of miembros) {
        if (vistos.has(m.especie)) continue;   // dos de la misma especie en un equipo no existe en VGC; por si acaso
        vistos.add(m.especie);
        const u = uso.get(m.especie) ?? uso.set(m.especie, nuevo()).get(m.especie);
        u.equipos++;
        sumar(u.objetos, m.objeto);
        sumar(u.habilidades, m.habilidad);
        sumar(u.tera, m.tera);
        for (const mov of new Set(m.movimientos)) sumar(u.movimientos, mov);
        for (const otro of miembros) if (otro.especie !== m.especie) sumar(u.companeros, otro.especie);
      }
      const especies = [...vistos].sort();
      for (let i = 0; i < especies.length; i++) for (let j = i + 1; j < especies.length; j++) for (let k = j + 1; k < especies.length; k++) {
        const clave = `${especies[i]}|${especies[j]}|${especies[k]}`;
        trios.set(clave, (trios.get(clave) ?? 0) + 1);
      }
      if (vistos.size === 6 && miembros.length === 6) {
        const clave = [...vistos].sort().join("|");
        const g = grupos.get(clave) ?? grupos.set(clave, { especies: [...vistos].sort(), equipos: 0, w: 0, l: 0, t: 0 }).get(clave);
        g.equipos++;
        g.w += fila.record.w;
        g.l += fila.record.l;
        g.t += fila.record.t;
        if (reciente && fila.puesto !== null) {
          candidatosTop.push({
            torneo: { id: torneo.id, nombre: torneo.nombre, fecha: torneo.fecha, jugadores: torneo.jugadores, url: `${URL_TORNEO}${torneo.id}` },
            ...publicados.at(-1),
          });
        }
      }
    }
    if (hayEquipos) conEquipos++;
    if (reciente) {
      const top = publicados
        .filter((e) => e.puesto !== null && e.puesto <= 8)
        .sort((a, b) => a.puesto - b.puesto)
        .slice(0, 8)   // por si hay empates en la clasificación
        .map((e) => ({ puesto: e.puesto, jugador: e.jugador, record: textoDeRecord(e.record), equipo: e.equipo }));
      const ordenados = [...publicados].sort((a, b) => (a.puesto ?? Infinity) - (b.puesto ?? Infinity));
      recientes.push({
        id: torneo.id, nombre: torneo.nombre, fecha: torneo.fecha, jugadores: torneo.jugadores,
        url: `${URL_TORNEO}${torneo.id}`, estado: torneo.estado, ...(torneo.estado === "live" ? { ronda: torneo.ronda, rondas: torneo.rondas } : {}),
        top, publicados: ordenados.length, equipos: ordenados,
      });
    }
  }
  // Equipos top: los de mejor puesto de los torneos recientes (a igual puesto, el de más jugadores y el más reciente)
  const equiposTop = candidatosTop
    .sort((a, b) => a.puesto - b.puesto || b.torneo.jugadores - a.torneo.jugadores || Date.parse(b.torneo.fecha) - Date.parse(a.torneo.fecha))
    .slice(0, MAXIMO_DE_EQUIPOS_TOP);
  const listaDeGrupos = [...grupos.values()]
    .sort((a, b) => b.equipos - a.equipos || b.w - a.w || a.l - b.l || a.especies.join().localeCompare(b.especies.join()))
    .slice(0, MAXIMO_DE_GRUPOS);
  return { equipos, torneosConEquipos: conEquipos, uso, recientes, equiposTop, grupos: listaDeGrupos, trios, sinPareja, sinId };
}

// ---------------------------------------------------------------------------

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes("--rellenar")) {
  for (const f of FORMATOS_DE_TORNEOS) {
    const { torneos, pendientes, total } = await torneosDeFormato(f.limitless);
    console.log(`${f.nombre}: ${torneos.length} de ${total} torneos listos, ${pendientes} pendientes (${peticiones} peticiones hasta ahora)`);
  }
}
