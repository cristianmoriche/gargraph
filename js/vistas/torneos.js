// Pantalla Torneos (#/torneos, #/torneos/<id>) y las piezas que comparten con Top Teams (#/equipos-top) y Team Usage (#/uso-equipos).
// Los datos son de Limitless (datos/torneos/<formato>.json y <formato>-equipos.json). «Team Builder» crea un equipo en Equipos
// con el de un jugador; lo que el torneo no trae (el reparto, y lo que falte) sale de setParaEquipo.
import {
  cargarTorneos, cargarFormato, infoMeta, formatoActual, formatoDeTorneos, esDeTorneos, nombreDeEspecie, rutaDex, buscarId,
  nombreObjeto, nombreHabilidad, nombreMovimiento, formatoTieneTera, repartoValido, dic, aId,
} from "../meta.js";
import { TIPOS } from "../tipos.js";
import { guardar, nuevoId } from "../estado.js";
import {
  escapar, sprite, insigniaTipo, icono, cabeceraDetalle, tituloSeccion, cargando, vacio, avisar, fechaCorta, enlaceExterno,
  selectorDeFormatos, lineaActualizado, barra, porcentaje,
} from "../ui.js";
import { activar } from "../movimiento.js";
import { setParaEquipo } from "./dex.js";

const URL_LIMITLESS = "https://limitlesstcg.com";
const POR_PAGINA = 20;

// ---------------------------------------------------------------------------
// Datos: el formato de la pantalla, los torneos normalizados y los equipos

/** El formato de torneos de la pantalla: el del formato elegido o, si ese no tiene torneos (BSS, OU…), el primero que no esté cerrado. */
export function formatoDePantalla() {
  const propio = formatoDeTorneos(formatoActual());
  if (propio) return { resumen: propio, sustituto: false };
  const todos = infoMeta().formatos.filter(esDeTorneos);
  const alternativa = todos.find((f) => !f.cerrado) ?? todos[0];
  return alternativa ? { resumen: alternativa, sustituto: true } : null;
}

const nombreActual = () => infoMeta().formatos.find((f) => f.id === formatoActual())?.nombre ?? "This format";

/** Aviso de que se enseñan torneos de otro formato (el elegido no tiene). */
export const avisoSustituto = (pantalla) => (pantalla?.sustituto
  ? `<p class="nota">${escapar(nombreActual())} has no tournaments. Showing ${escapar(pantalla.resumen.nombre)}.</p>` : "");

/** «6-1-0», {w, l, t} o {wins, losses, ties} → { w, l, t }. */
export function normalizarRecord(r) {
  if (!r) return { w: 0, l: 0, t: 0 };
  if (typeof r === "string") {
    const [w = 0, l = 0, t = 0] = r.split("-").map((n) => Number(n) || 0);
    return { w, l, t };
  }
  return { w: r.w ?? r.wins ?? 0, l: r.l ?? r.losses ?? 0, t: r.t ?? r.ties ?? 0 };
}

/** «6-1» o «6-1-1» (el empate solo si lo hay). */
export const textoRecord = ({ w, l, t }) => `${w}-${l}${t ? `-${t}` : ""}`;

/** Partidas ganadas sobre las jugadas, de 0 a 1 (null si no hay partidas). */
export const tasaDeVictorias = ({ w, l, t }) => (w + l + t ? w / (w + l + t) : null);

const nombreEspecie = (nombre) => nombreDeEspecie(nombre) ?? nombre;

function normalizarMiembro(m) {
  return {
    especie: nombreEspecie(m.especie ?? m.nombre ?? ""), objeto: m.objeto ?? null, habilidad: m.habilidad ?? null,
    tera: m.tera ?? null, naturaleza: m.naturaleza ?? null, movimientos: Array.isArray(m.movimientos) ? m.movimientos : [],
  };
}

/** Un equipo publicado con la forma que usan las pantallas: { puesto, jugador, record, url, equipo, torneo, arquetipos }. */
export function normalizarEquipo(e, torneo) {
  const equipo = (e.equipo ?? []).map(normalizarMiembro);
  return {
    puesto: Number.isInteger(e.puesto) ? e.puesto : null, jugador: e.jugador ?? "", record: normalizarRecord(e.record),
    url: e.url ?? e.torneo?.url ?? torneo?.url ?? null, equipo,
    torneo: { id: e.torneo?.id ?? torneo?.id, nombre: e.torneo?.nombre ?? torneo?.nombre ?? "" },
    arquetipos: arquetiposDe(equipo),
  };
}

/** Un torneo con su estado ("live", "finished" o "pending") y todos sus equipos publicados (si no hay lista entera, el top 8). */
export function normalizarTorneo(t) {
  const lista = Array.isArray(t.equipos) && t.equipos.length ? t.equipos : (t.top ?? []);
  const equipos = lista.map((e) => normalizarEquipo(e, t)).filter((e) => e.equipo.length)
    .sort((a, b) => (a.puesto ?? 9999) - (b.puesto ?? 9999));
  const estado = t.estado ?? (lista.length ? "finished" : "pending");
  return { ...t, estado, equipos };
}

/** Los torneos de un formato de torneos, normalizados (null si no hay fichero). */
export async function cargarTorneosNormalizados(resumen) {
  const datos = await cargarTorneos(resumen.id);
  if (!datos) return null;
  return { actualizado: datos.actualizado ?? null, torneos: datos.torneos.map(normalizarTorneo) };
}

/**
 * Los equipos top y los grupos de «Team Usage». Si datos/torneos/<formato>-equipos.json existe, se lee de allí
 * ({ equipos: [{ torneo, puesto, jugador, record, equipo }], grupos: [{ especies, equipos, w, l, t }] }); si no, se calculan
 * con los torneos. Devuelve { equipos, grupos, actualizado } o null si no hay nada.
 */
const topCache = new Map();
export function cargarEquiposTop(resumen) {
  if (!topCache.has(resumen.id)) {
    topCache.set(resumen.id, (async () => {
      let fichero = null;
      try {
        const respuesta = await fetch(`datos/torneos/${resumen.id}-equipos.json`);
        if (respuesta.ok) fichero = await respuesta.json();
      } catch {
        fichero = null;
      }
      const datos = await cargarTorneosNormalizados(resumen);
      const propios = datos?.torneos.flatMap((t) => t.equipos) ?? [];
      const equipos = (fichero?.equipos?.length ? fichero.equipos.map((e) => normalizarEquipo(e)) : mejoresEquipos(propios));
      const grupos = fichero?.grupos?.length
        ? fichero.grupos.map((g) => ({ especies: g.especies.map(nombreEspecie), equipos: g.equipos, w: g.w ?? 0, l: g.l ?? 0, t: g.t ?? 0 }))
        : gruposDeEquipos(propios);
      if (!equipos.length && !grupos.length) {
        topCache.delete(resumen.id); // sin datos (por ejemplo, sin conexión): se podrá pedir otra vez
        return null;
      }
      return { equipos, grupos, actualizado: fichero?.actualizado ?? datos?.actualizado ?? null };
    })());
  }
  return topCache.get(resumen.id);
}

/** Los 200 equipos con mejor récord (más victorias sobre partidas) y, a igualdad, mejor puesto. */
function mejoresEquipos(equipos) {
  return [...equipos]
    .filter((e) => e.record.w + e.record.l + e.record.t > 0)
    .sort((a, b) => (tasaDeVictorias(b.record) - tasaDeVictorias(a.record)) || (b.record.w - a.record.w) || ((a.puesto ?? 9999) - (b.puesto ?? 9999)))
    .slice(0, 200);
}

/** Equipos con los mismos 6 Pokémon (cada forma Mega cuenta como distinta) → [{ especies, equipos, w, l, t }]. */
function gruposDeEquipos(equipos) {
  const grupos = new Map();
  for (const e of equipos) {
    const especies = e.equipo.map((m) => m.especie).sort();
    if (especies.length < 6) continue;
    const clave = especies.join("|");
    const g = grupos.get(clave) ?? { especies, equipos: 0, w: 0, l: 0, t: 0 };
    g.equipos++;
    g.w += e.record.w;
    g.l += e.record.l;
    g.t += e.record.t;
    grupos.set(clave, g);
  }
  return [...grupos.values()];
}

// ---------------------------------------------------------------------------
// Arquetipos, deducidos de los Pokémon, las habilidades y los movimientos del equipo

export const ARQUETIPOS = ["Sun", "Rain", "Sand", "Snow", "Trick Room", "Tailwind", "Perish Trap"];

const HABILIDADES = {
  Sun: ["drought", "orichalcumpulse", "desolateland"], Rain: ["drizzle", "primordialsea"],
  Sand: ["sandstream", "sandspit"], Snow: ["snowwarning"],
};
const MOVIMIENTOS = { Sun: ["sunnyday"], Rain: ["raindance"], Sand: ["sandstorm"], Snow: ["snowscape", "chillyreception"], "Trick Room": ["trickroom"], Tailwind: ["tailwind"] };
// Formas Mega que ponen el clima al salir aunque la lista traiga la habilidad de la forma normal
const MEGAS = { "Charizard-Mega-Y": "Sun", "Tyranitar-Mega": "Sand", "Abomasnow-Mega": "Snow" };
const ATRAPAR = ["shadowtag", "arenatrap", "magnetpull", "meanlook", "block", "spiritshackle", "anchorshot", "thousandwaves", "jawlock"];

export function arquetiposDe(equipo) {
  const habilidades = new Set(equipo.map((m) => aId(m.habilidad)));
  const movimientos = new Set(equipo.flatMap((m) => m.movimientos.map(aId)));
  const encontrados = new Set(equipo.map((m) => MEGAS[m.especie]).filter(Boolean));
  for (const [nombre, lista] of Object.entries(HABILIDADES)) if (lista.some((a) => habilidades.has(a))) encontrados.add(nombre);
  for (const [nombre, lista] of Object.entries(MOVIMIENTOS)) if (lista.some((m) => movimientos.has(m))) encontrados.add(nombre);
  if (movimientos.has("perishsong") && ATRAPAR.some((x) => habilidades.has(x) || movimientos.has(x))) encontrados.add("Perish Trap");
  return ARQUETIPOS.filter((a) => encontrados.has(a));
}

// ---------------------------------------------------------------------------
// Piezas

/** Título y texto de «no hay datos» sin conexión: los datos de torneos solo se guardan en el móvil la primera vez que se abren con conexión. */
export const SIN_CONEXION = ["No connection", "Tournament data is saved on this device the first time you open it with an internet connection."];

const jugadores = (n) => (n != null ? `${n.toLocaleString("en-US")} players` : "");
const pie = () => `<p class="nota pie">Data: ${enlaceExterno(URL_LIMITLESS, "Limitless", "enlace")}. Players enter their own teams; Gargraph is an unofficial project.</p>`;
export { pie as pieLimitless };

/** «2026-10-17» o una fecha ISO completa → «Oct 17, 2026». */
function textoFecha(fecha) {
  if (!fecha) return "";
  const ms = Date.parse(`${String(fecha).slice(0, 10)}T12:00:00`);
  return Number.isNaN(ms) ? "" : fechaCorta(ms);
}

function idDe(tabla, valor) {
  return valor ? buscarId(tabla, String(valor)) : null;
}
function textoDe(tabla, valor, nombre) {
  if (!valor) return "";
  const id = idDe(tabla, valor);
  return id ? nombre(id) : String(valor);
}
const tipoDeTera = (tera) => {
  const tipo = String(tera ?? "").toLowerCase();
  return TIPOS[tipo] ? tipo : null;
};

export function sprites(equipo, clase = "mediano") {
  return `<span class="torneo-sprites">${equipo.map((m) => sprite(m.especie, { clase })).join("")}</span>`;
}

function filaSet(m) {
  const tera = tipoDeTera(m.tera);
  const linea = [textoDe("objetos", m.objeto, nombreObjeto), textoDe("habilidades", m.habilidad, nombreHabilidad)].filter(Boolean);
  const movimientos = m.movimientos.filter(Boolean).map((mov) => textoDe("movimientos", mov, nombreMovimiento));
  return `
    <li class="torneo-set">
      <a class="torneo-set-cab" href="${rutaDex(m.especie)}">
        ${sprite(m.especie)}
        <span class="fila-pokemon-nombre">${escapar(m.especie)}</span>
        ${tera ? `<span class="tipos">${insigniaTipo(tera)}</span>` : ""}
      </a>
      ${linea.length ? `<p class="torneo-set-linea">${escapar(linea.join(" · "))}</p>` : ""}
      ${movimientos.length ? `<p class="nota">${escapar(movimientos.join(" · "))}</p>` : ""}
    </li>`;
}

/**
 * Tarjeta de un equipo publicado: puesto, jugador, récord, sus Pokémon y tres acciones (Team Builder, Source y Details).
 * «indice» es su posición en la lista que luego se pasa a conectarEquipos(). «torneoNombre»: si se da, se enseña de qué torneo es.
 */
export function tarjetaEquipo(e, indice, { torneoNombre = false } = {}) {
  return `
    <article class="tarjeta torneo-puesto" data-equipo="${indice}">
      <header class="torneo-puesto-cab">
        ${e.puesto != null ? `<span class="insignia ${e.puesto === 1 ? "exito" : ""}">#${e.puesto}</span>` : ""}
        <p class="torneo-jugador">${escapar(e.jugador)}</p>
        <span class="torneo-record">${escapar(textoRecord(e.record))}</span>
      </header>
      ${torneoNombre && e.torneo.nombre ? `<p class="nota">${escapar(e.torneo.nombre)}</p>` : ""}
      ${sprites(e.equipo)}
      ${e.arquetipos.length ? `<p class="torneo-arquetipos">${e.arquetipos.map((a) => `<span class="insignia">${a}</span>`).join("")}</p>` : ""}
      <div class="botones-fila torneo-acciones">
        <button type="button" class="boton pequeno" data-builder>${icono("añadir")} Team Builder</button>
        ${e.url ? enlaceExterno(e.url, `Source ${icono("externo")}`, "boton secundario pequeno") : ""}
        <button type="button" class="boton secundario pequeno" data-detalles aria-expanded="false">Details</button>
      </div>
      <ul class="lista torneo-sets" hidden></ul>
    </article>`;
}

/** Atiende los botones de las tarjetas de tarjetaEquipo(): «dameLista» devuelve los equipos en el orden de sus índices. */
export function conectarEquipos(contenedor, dameLista, resumen) {
  contenedor.addEventListener("click", (evento) => {
    const tarjeta = evento.target.closest("[data-equipo]");
    if (!tarjeta) return;
    const e = dameLista()[Number(tarjeta.dataset.equipo)];
    if (!e) return;
    const builder = evento.target.closest("[data-builder]");
    if (builder) {
      usarEquipo(e, resumen, builder);
      return;
    }
    const detalles = evento.target.closest("[data-detalles]");
    if (detalles) {
      const sets = tarjeta.querySelector(".torneo-sets");
      if (!sets.childElementCount) sets.innerHTML = e.equipo.map(filaSet).join("");
      sets.hidden = !sets.hidden;
      detalles.setAttribute("aria-expanded", String(!sets.hidden));
      detalles.textContent = sets.hidden ? "Details" : "Hide";
    }
  });
}

/** Botón «Show more» con los equipos que quedan por enseñar. */
export function botonMas(restantes) {
  return restantes > 0 ? `<button type="button" class="boton secundario bloque" data-mas>Show more (${restantes})</button>` : "";
}

/** Pinta una lista de equipos de POR_PAGINA en POR_PAGINA, con «Show more», y atiende sus botones. Se puede llamar otra vez con otra lista. */
export function listaPaginada(contenedor, lista, resumen, opciones = {}) {
  let mostrados = 0;
  const pintarMas = () => {
    const hasta = Math.min(lista.length, mostrados + POR_PAGINA);
    contenedor.querySelector("[data-mas]")?.remove();
    contenedor.insertAdjacentHTML("beforeend", lista.slice(mostrados, hasta).map((e, i) => tarjetaEquipo(e, mostrados + i, opciones)).join(""));
    mostrados = hasta;
    contenedor.insertAdjacentHTML("beforeend", botonMas(lista.length - mostrados));
    activar(contenedor);
  };
  contenedor.innerHTML = "";
  contenedor._lista = lista;
  if (!contenedor.dataset.conectado) {
    contenedor.dataset.conectado = "1";
    conectarEquipos(contenedor, () => contenedor._lista, resumen);
    contenedor.addEventListener("click", (evento) => {
      if (evento.target.closest("[data-mas]")) contenedor._mas();
    });
  }
  contenedor._mas = pintarMas;
  pintarMas();
}

// ---------------------------------------------------------------------------
// Pantalla: lista de torneos y un torneo

export async function pintar(vista, { id, vigente }) {
  const pantalla = formatoDePantalla();
  vista.innerHTML = `<div class="v-torneos">${cabeceraDetalle({ titulo: "Tournaments", volver: "#/inicio" })}${cargando("Loading tournaments…")}</div>`;
  const datos = pantalla ? await cargarTorneosNormalizados(pantalla.resumen) : null;
  if (!vigente()) return;
  if (id) return pintarTorneo(vista, id, pantalla, datos);

  let cuerpo;
  if (!pantalla) {
    cuerpo = vacio("No tournament formats", "None of the formats in the app is built from tournaments yet.");
  } else if (!datos?.torneos.length) {
    cuerpo = navigator.onLine === false
      ? vacio(...SIN_CONEXION)
      : vacio("No tournaments yet", `There is no tournament data for ${escapar(pantalla.resumen.nombre)} yet. It is updated every day.`);
  } else {
    const enDirecto = datos.torneos.filter((t) => t.estado === "live");
    const terminados = datos.torneos.filter((t) => t.estado !== "live");
    cuerpo = `
      ${enDirecto.length ? `
        <section class="seccion">
          ${tituloSeccion("In progress", `<span class="insignia">${enDirecto.length}</span>`)}
          <div class="torneos-lista">${enDirecto.map(tarjetaTorneo).join("")}</div>
        </section>` : ""}
      ${terminados.length ? `
        <section class="seccion">
          ${tituloSeccion("Recent tournaments", `<span class="insignia">${terminados.length}</span>`)}
          <div class="torneos-lista">${terminados.map(tarjetaTorneo).join("")}</div>
        </section>` : ""}`;
  }
  vista.innerHTML = `
    <div class="v-torneos">
      ${cabeceraDetalle({ titulo: "Tournaments", subtitulo: pantalla ? escapar(pantalla.resumen.nombre) : "", volver: "#/inicio" })}
      <p class="torneos-intro">Live and recent events. Open any tournament for full Pokémon usage, team lists and the winning team.</p>
      ${selectorDeFormatos()}
      ${avisoSustituto(pantalla)}
      ${datos?.actualizado ? lineaActualizado(datos.actualizado) : ""}
      ${cuerpo}
      ${pie()}
    </div>`;
  activar(vista);
}

function insigniaEstado(t) {
  // En directo: «ronda» es la actual (0 si acaba de empezar) y «rondas», las previstas (puede faltar)
  if (t.estado === "live") return `<span class="insignia">In progress</span>${t.ronda > 0 ? `<span class="insignia">${escapar(textoRonda(t))}</span>` : ""}`;
  return "";
}

/** «Round 3 of 8», o «Round 3» si no se sabe cuántas rondas hay. */
function textoRonda(t) {
  return t.rondas > 0 && t.rondas >= t.ronda ? `Round ${t.ronda} of ${t.rondas}` : `Round ${t.ronda}`;
}

function tarjetaTorneo(t) {
  const campeon = t.estado === "finished" ? t.equipos[0] : null;
  const datos = [t.estado === "live" ? "" : textoFecha(t.fecha), jugadores(t.jugadores)].filter(Boolean).join(" · ");
  let pie;
  if (campeon) {
    pie = `<p class="torneo-campeon"><span class="insignia exito">Champion</span><span class="torneo-jugador">${escapar(campeon.jugador)}</span></p>${sprites(campeon.equipo)}`;
  } else if (t.estado === "live") {
    pie = `<p class="nada">${t.equipos.length ? `${t.equipos.length} teams published so far` : "Teams not published yet"}</p>`;
  } else {
    pie = `<p class="nada">Final results pending</p>`;
  }
  return `
    <a class="tarjeta torneo" href="#/torneos/${encodeURIComponent(t.id)}">
      <div class="torneo-cab">
        <div class="torneo-titulo">
          <p class="torneo-nombre">${escapar(t.nombre)}</p>
          <p class="nota">${insigniaEstado(t)} ${escapar(datos)}</p>
        </div>
        ${icono("flecha-derecha")}
      </div>
      ${pie}
    </a>`;
}

/** Uso de cada Pokémon en un conjunto de equipos: [{ nombre, equipos, uso }] de más a menos usado (uso = % de equipos que lo llevan). */
export function usoDePokemon(equipos) {
  const cuenta = new Map();
  for (const e of equipos) for (const nombre of new Set(e.equipo.map((m) => m.especie))) cuenta.set(nombre, (cuenta.get(nombre) ?? 0) + 1);
  return [...cuenta].map(([nombre, n]) => ({ nombre, equipos: n, uso: (n / equipos.length) * 100 }))
    .sort((a, b) => b.equipos - a.equipos || a.nombre.localeCompare(b.nombre));
}

async function pintarTorneo(vista, id, pantalla, datos) {
  const torneo = datos?.torneos.find((t) => String(t.id) === String(id));
  if (!torneo) {
    vista.innerHTML = `<div class="v-torneos">${cabeceraDetalle({ titulo: "Tournament", volver: "#/torneos" })}${vacio(
      "Tournament not found",
      "It may be older than the most recent ones.",
      `<a class="boton" href="#/torneos">All tournaments</a>`,
    )}</div>`;
    return;
  }
  const equipos = torneo.equipos;
  const uso = usoDePokemon(equipos);
  const estado = torneo.estado === "live" ? "In progress" : torneo.estado === "pending" ? "Results pending" : "Finished";
  const cifras = [
    ["Status", escapar(estado)],
    ["Date", escapar(textoFecha(torneo.fecha))],
    ["Players", torneo.jugadores != null ? torneo.jugadores.toLocaleString("en-US") : "–"],
    ...(torneo.estado === "live" && torneo.ronda > 0 ? [["Round", escapar(textoRonda(torneo).replace("Round ", ""))]] : []), // sin el dato, no se enseña la fila
    ...(torneo.estado !== "live" && torneo.rondas > 0 ? [["Rounds", escapar(String(torneo.rondas))]] : []),
    ["Teams", equipos.length.toLocaleString("en-US")],
  ];
  vista.innerHTML = `
    <div class="v-torneos">
      ${cabeceraDetalle({ titulo: escapar(torneo.nombre), subtitulo: escapar(pantalla.resumen.nombre), volver: "#/torneos" })}
      <dl class="tarjeta torneo-cifras">
        ${cifras.map(([etiqueta, valor]) => `<div><dt>${etiqueta}</dt><dd>${valor}</dd></div>`).join("")}
      </dl>
      ${torneo.url ? enlaceExterno(torneo.url, `${icono("externo")} View on Limitless`, "boton secundario bloque") : ""}
      ${equipos.length ? `
        <p class="torneos-intro">${escapar(fraseDeUso(uso, equipos.length))}</p>
        <section class="seccion">
          ${tituloSeccion("Top 20 Pokémon")}
          <ul class="tarjeta sin-relleno lista">${uso.slice(0, 20).map((p, i) => filaUso(p, i, uso[0].uso)).join("")}</ul>
          <p class="nota">Share of the ${equipos.length} published teams that carry each Pokémon.</p>
        </section>
        <section class="seccion">
          ${tituloSeccion("Teams", `<span class="insignia">${equipos.length}</span>`)}
          <div class="torneo-equipos" id="equipos"></div>
        </section>` : `<section class="seccion"><p class="nada">${torneo.estado === "live" ? "No teams published yet." : "Final results pending."}</p></section>`}
      <p class="nota">Tournament teams have no EV spreads. “Team Builder” fills them in with the most used spread of the matching Showdown format.</p>
      ${pie()}
    </div>`;
  if (equipos.length) listaPaginada(vista.querySelector("#equipos"), equipos, pantalla.resumen);
  activar(vista);
}

function fraseDeUso(uso, total) {
  const [uno, dos, tres] = uso;
  const resto = [dos, tres].filter(Boolean).map((p) => p.nombre);
  return `${uno.nombre} leads usage, on ${porcentaje(uno.uso)} of the ${total} published teams${resto.length ? `, followed by ${resto.join(" and ")}` : ""}.`;
}

function filaUso(p, i, maximo) {
  return `
    <li><a class="fila-pokemon" href="${rutaDex(p.nombre)}">
      <span class="puesto">${i + 1}</span>
      ${sprite(p.nombre)}
      <span class="fila-pokemon-texto"><span class="fila-pokemon-nombre">${escapar(p.nombre)}</span></span>
      <span class="fila-pokemon-dato">${porcentaje(p.uso)}</span>
      <span class="uso-barra">${barra(p.uso / maximo)}</span>
    </a></li>`;
}

// ---------------------------------------------------------------------------
// «Team Builder»: crea un equipo en Equipos con el del jugador. Lo que el torneo no trae sale de setParaEquipo.

async function usarEquipo(e, resumen, boton) {
  if (boton.disabled) return;
  boton.disabled = true; // antes del primer await: un segundo toque no crea otro equipo
  try {
    const formato = await cargarFormato(resumen.id);
    const miembros = [];
    let fuera = 0;
    for (const m of e.equipo.slice(0, 6)) {
      if (!m.especie || !dic().especies[m.especie]) {
        fuera++;
        continue;
      }
      const { set } = await setParaEquipo(m.especie, formato).catch(() => ({ set: null }));
      const movimientos = m.movimientos.map((mov) => idDe("movimientos", mov)).filter(Boolean).slice(0, 4);
      const naturaleza = m.naturaleza && dic().naturalezas[m.naturaleza] ? m.naturaleza : null;
      miembros.push({
        especie: m.especie,
        objeto: idDe("objetos", m.objeto) ?? set?.objeto ?? null,
        habilidad: idDe("habilidades", m.habilidad) ?? set?.habilidad ?? null,
        tera: formatoTieneTera(formato) ? (tipoDeTera(m.tera) ?? set?.tera ?? null) : null,
        naturaleza: naturaleza ?? set?.naturaleza ?? "Serious",
        valores: set && repartoValido(set.valores, formato) ? [...set.valores] : [0, 0, 0, 0, 0, 0],
        movimientos: movimientos.length ? movimientos : [...(set?.movimientos ?? [])],
      });
    }
    if (!miembros.length) {
      avisar("None of these Pokémon could be added");
      boton.disabled = false;
      return;
    }
    const nombreEquipo = `${e.jugador}'s team`.slice(0, 40);
    const nuevo = { id: nuevoId(), nombre: nombreEquipo, formato: formato.id, miembros, creado: Date.now(), editado: Date.now() };
    guardar((estado) => {
      estado.equipos.unshift(nuevo);
      estado.equipoActivo = nuevo.id;
    });
    boton.outerHTML = `<a class="boton secundario pequeno" href="#/equipos/${escapar(nuevo.id)}">${icono("hecho")} Open in Teams</a>`;
    avisar(`“${nombreEquipo}” added to Teams${fuera ? ` (${fuera} Pokémon left out)` : ""}`);
  } catch (error) {
    console.error(error);
    avisar("Could not create the team");
    boton.disabled = false;
  }
}
