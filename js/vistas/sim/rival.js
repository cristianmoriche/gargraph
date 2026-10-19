// Simulador · elegir el rival (#/simulador/rival).
// Los equipos se agrupan por origen: meta, rivales habituales, tus equipos y el pegado de Showdown.
// Este fichero también guarda lo que comparte con la pantalla de preparar: cómo se arman los equipos y el aviso de formato.
import { escapar, decimal, sprite, selectorDeFormatos, cabeceraDetalle, tituloSeccion, vacio, avisar, icono } from "../../ui.js";
import { cargarFormato, infoMeta, setMasUsado, repartoValido, aId } from "../../meta.js";
import { leer, ordenarCombates } from "../../estado.js";
import { importarEquipo } from "../../showdown.js";
import { sesion, elegir, prevision, disponible, formatoDe } from "../../sim/index.js";

const GRUPOS = [
  ["meta", "Meta Teams"],
  ["hab", "Frequent Opponents"],
  ["mio", "Your Teams"],
  ["pegado", "Pasted from Showdown"],
];
const ORIGENES = { meta: "Meta team", hab: "Frequent opponent", mio: "One of your teams", pegado: "Pasted team" };
const MAXIMO_HABITUALES = 5;

let pegado = null; // el último equipo leído de Showdown: se queda mientras dure la sesión

/** La previsión es una cuenta rápida, no un resultado: se dice así en las dos pantallas que la enseñan. */
export const NOTA_PREVISION = "Estimate based on 20 quick battles: gives an idea of who's favored, though the full battle may play out differently.";

// ---------------------------------------------------------------------------
// Equipos: lo que usan las dos pantallas

/** Un equipo guardado en la app, con la forma que pide el simulador. El formato es el suyo (null si no lo trae). */
export function equipoDeApp(equipo) {
  return { clave: `mio:${equipo.id}`, id: equipo.id, nombre: equipo.nombre, formato: equipo.formato ?? null, origen: "One of your teams", miembros: equipo.miembros };
}

/** Tus equipos con algún Pokémon, en el orden en que están guardados. */
export function misEquipos() {
  return leer().equipos.filter((e) => e.miembros?.length).map(equipoDeApp);
}

/** El equipo con el que se juega: el de la sesión (si sigue existiendo), el activo o el primero. */
export function equipoYo(equipos = misEquipos()) {
  const estado = leer();
  return equipos.find((e) => e.id === sesion.yo?.id) ?? equipos.find((e) => e.id === estado.equipoActivo) ?? equipos[0] ?? null;
}

/** De dónde sale un equipo, en pocas palabras: "Meta team", "Frequent opponent"… */
export function etiquetaOrigen(equipo) {
  return ORIGENES[String(equipo?.clave).split(":")[0]] ?? equipo?.origen ?? "";
}

// Un equipo pegado no lleva formato: sus repartos (EVs o puntos de Champions) solo valen en formatos de su misma escala
function valeElPegado(equipo, formato) {
  if (equipo?.clave !== "pegado") return true;
  return Boolean(equipo.champions) === Boolean(formato.champions) && equipo.miembros.every((m) => repartoValido(m.valores, formato));
}

/**
 * El rival con el que se queda la sesión para este formato y este equipo: el que ya había, si sigue valiendo
 * (es del mismo formato, no es tu propio equipo y, si es uno tuyo, sigue guardado tal como está); si no, el
 * primer equipo del meta. null si no hay ninguno.
 */
export function rivalPara(formato, yo, propios) {
  let rival = sesion.rival;
  if (rival?.formato && rival.formato !== formato.id) rival = null;
  if (!valeElPegado(rival, formato)) rival = null;
  if (rival?.id) {
    const vivo = rival.id === yo?.id ? null : propios.find((e) => e.id === rival.id);
    rival = vivo && formatoDe(vivo) === formato.id ? vivo : null;
  }
  return rival ?? equiposDelMeta(formato)[0] ?? null;
}

// Un Pokémon con el set más usado del formato. Si el formato no lo trae no hay set real que ponerle: null
function setDe(nombre, formato) {
  const entrada = formato.porNombre.get(nombre);
  return entrada ? setMasUsado(entrada, formato) : null;
}

/** Un equipo del meta por cada núcleo: sus tres Pokémon y los tres compañeros más usados que no estén ya. */
export function equiposDelMeta(formato) {
  return formato.nucleos.map((nucleo, i) => {
    const nombres = [...nucleo.miembros];
    const suma = new Map();
    for (const nombre of nucleo.miembros) {
      for (const [companero, uso] of formato.porNombre.get(nombre)?.companeros ?? []) {
        if (!nombres.includes(companero) && formato.porNombre.has(companero)) suma.set(companero, (suma.get(companero) ?? 0) + uso);
      }
    }
    const companeros = [...suma].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([nombre]) => nombre);
    // Si faltan compañeros (datos pobres), se completa con los más usados del formato
    for (const p of formato.pokemon) {
      if (nombres.length + companeros.length >= 6) break;
      if (!nombres.includes(p.nombre) && !companeros.includes(p.nombre)) companeros.push(p.nombre);
    }
    const lista = nucleo.miembros.join(" + ");
    const hasta = nucleo.cota ? "at most " : ""; // sin «cota» (torneos) la cifra es la real
    return {
      clave: `meta:${i}`,
      formato: formato.id,
      nombre: `${nucleo.miembros.slice(0, 2).join(" + ")} Core`,
      origen: `Meta team · core ${lista} (${hasta}${decimal(nucleo.juntos)}% of teams)`,
      detalle: `${lista} · together on ${hasta}${decimal(nucleo.juntos)}% of teams`,
      miembros: [...nombres, ...companeros].map((nombre) => setDe(nombre, formato)).filter(Boolean),
    };
  }).filter((equipo) => equipo.miembros.length);
}

/**
 * Los rivales que más se repiten en tus combates reales de este formato (los simulados no cuentan: serían
 * rivales que tú mismo has elegido), con el equipo de su último combate. De cada Pokémon solo se sabe la
 * especie: juega con el set más usado del formato. Los que ya no están en el formato se quedan fuera
 * (no hay set que ponerles) y la tarjeta lo dice.
 */
export function rivalesHabituales(formato) {
  const porRival = new Map();
  // Del más reciente al más antiguo: el primer combate de cada rival es el último que jugaste
  for (const c of ordenarCombates(leer().combates)) {
    const nombre = String(c.rival ?? "").trim();
    if (c.simulado || !nombre || c.formato !== formato.id || !c.equipoRival?.length) continue;
    const clave = nombre.toLowerCase();
    const fila = porRival.get(clave) ?? { nombre, combates: [], victorias: 0, derrotas: 0 };
    fila.combates.push(c);
    if (c.resultado === "victoria") fila.victorias++;
    if (c.resultado === "derrota") fila.derrotas++;
    porRival.set(clave, fila);
  }
  return [...porRival.values()]
    .filter((f) => f.combates.length >= 2)
    .sort((a, b) => b.combates.length - a.combates.length)
    .slice(0, MAXIMO_HABITUALES)
    .map((f) => {
      const historial = `${f.victorias}–${f.derrotas} in your history`;
      const nombres = f.combates[0].equipoRival.slice(0, 6);
      const miembros = nombres.map((nombre) => setDe(nombre, formato)).filter(Boolean);
      const fuera = nombres.length - miembros.length;
      const sinDatos = fuera ? ` · ${fuera} of their Pokémon ${fuera === 1 ? "is not" : "are not"} in ${formato.nombre} this month` : "";
      return {
        clave: `hab:${aId(f.nombre)}`,
        formato: formato.id,
        nombre: f.nombre,
        origen: `Frequent opponent · ${f.nombre} (${historial})${sinDatos}`,
        detalle: `${historial}${sinDatos}`,
        miembros,
      };
    })
    .filter((equipo) => equipo.miembros.length);
}

/**
 * Si el simulador no vale para el formato en que se juega: la explicación y la salida. Si el equipo trae su
 * propio formato, cambiar el del perfil no sirve de nada: se manda a Equipos. Si no, botones para cambiar de formato.
 * Si vale, "".
 */
export function avisoNoDisponible(formato, equipo = null) {
  if (disponible(formato)) return "";
  const validos = infoMeta().formatos.filter((f) => disponible(f)).map((f) => f.nombre).join(" and ") || "other formats";
  const tipo = `${/^(dobles|doubles)$/i.test(formato.modo) ? "doubles" : "singles"}${formato.champions ? " Pokémon Champions" : ""}`;
  const delEquipo = equipo?.formato && equipo.formato === formato.id;
  const detalle = delEquipo
    ? `"${escapar(equipo.nombre)}" is a ${escapar(formato.nombre)} team, a ${escapar(tipo)} format that cannot be simulated yet. Pick another team or create one for ${escapar(validos)}.`
    : `${escapar(formato.nombre)} is a ${escapar(tipo)} format and cannot be simulated yet. Switch formats to continue.`;
  return `
    <section class="seccion no-disponible" aria-live="polite">
      <div class="aviso info" role="status">${icono("info")}<div class="aviso-texto"><p class="aviso-titulo">Simulator available for ${escapar(validos)}</p><p class="aviso-detalle">${detalle}</p></div></div>
      <div class="no-disponible-salida">${delEquipo ? `<a class="boton secundario" href="#/equipos">Go to Teams</a>` : selectorDeFormatos()}</div>
    </section>`;
}

// ---------------------------------------------------------------------------
// Pantalla

export async function pintar(vista, { vigente }) {
  const propios = misEquipos();
  const yo = equipoYo(propios);
  if (!yo) {
    vista.innerHTML = `<div class="v-sim-rival">${cabeceraDetalle({ titulo: "Choose Opponent", volver: "#/simulador" })}${vacio(
      "No teams yet",
      "You need a team of your own to simulate a battle.",
      `<a class="boton" href="#/equipos">Create a team</a>`,
    )}</div>`;
    return;
  }
  const formato = await cargarFormato(formatoDe(yo));
  if (!vigente()) return;
  const cabecera = cabeceraDetalle({ titulo: "Choose Opponent", subtitulo: escapar(formato.nombre), volver: "#/simulador" });

  if (!disponible(formato)) {
    vista.innerHTML = `<div class="v-sim-rival">${cabecera}${avisoNoDisponible(formato, yo)}</div>`;
    return;
  }

  const catalogo = [
    ...equiposDelMeta(formato).map((e) => ({ ...e, grupo: "meta" })),
    ...rivalesHabituales(formato).map((e) => ({ ...e, grupo: "hab" })),
    // Solo equipos del mismo formato: la previsión y el combate se juegan con uno solo
    ...propios.filter((e) => e.id !== yo.id && formatoDe(e) === formato.id).map((e) => ({ ...e, grupo: "mio" })),
  ];
  const guardado = pegado ?? (sesion.rival?.clave === "pegado" ? sesion.rival : null);
  if (guardado && valeElPegado(guardado, formato)) catalogo.push({ ...guardado, grupo: "pegado" });

  // Se parte del rival que ya hay en la sesión y, si no vale para este formato (o no hay), del primero del meta
  const inicial = rivalPara(formato, yo, propios);
  let elegido = catalogo.find((e) => e.clave === inicial?.clave) ?? null;
  const previsiones = new Map(); // clave → promesa con la previsión
  const resultados = new Map();  // clave → la previsión ya calculada (o null si no se pudo)

  vista.innerHTML = `
    <div class="v-sim-rival">
      ${cabecera}
      <p class="nota">Estimated matchup for "${escapar(yo.nombre)}" against each team. ${escapar(NOTA_PREVISION)}</p>
      <div id="grupos"></div>
      <section class="seccion">
        ${tituloSeccion("Paste a Team")}
        <details class="plegable" id="pegar">
          <summary>Team in Showdown format ${icono("flecha-derecha")}</summary>
          <div class="plegable-contenido pegar-contenido">
            <textarea id="pegado" aria-label="Team in Showdown format" placeholder="Great Tusk @ Booster Energy&#10;Ability: Protosynthesis&#10;Tera Type: Steel&#10;- Headlong Rush&#10;- Ice Spinner&#10;..." autocapitalize="none" spellcheck="false"></textarea>
            <button type="button" class="boton secundario" id="leer">Read team</button>
            <p class="nota" id="aviso-pegado" aria-live="polite">Detects up to 6 Pokémon and creates the "Pasted team" opponent.</p>
          </div>
        </details>
      </section>
      <div class="barra-accion">
        <button type="button" class="boton bloque" id="usar"${elegido ? "" : " disabled"}>Use this opponent</button>
      </div>
    </div>`;

  const raiz = vista.querySelector(".v-sim-rival");
  const $ = (selector) => raiz.querySelector(selector);

  // Las tarjetas se escriben de nuevo cuando se pega un equipo
  function pintarGrupos() {
    $("#grupos").innerHTML = GRUPOS.map(([grupo, titulo]) => {
      const equipos = catalogo.filter((e) => e.grupo === grupo);
      if (!equipos.length) return "";
      return `
        <section class="seccion">
          ${tituloSeccion(escapar(titulo), `<span class="insignia">${equipos.length}</span>`)}
          <div class="rivales" role="radiogroup" aria-label="${escapar(titulo)}">${equipos.map((e) => tarjeta(e, e.clave === elegido?.clave, resultados)).join("")}</div>
        </section>`;
    }).join("");
  }

  // La previsión se calcula de una en una, empezando por el equipo elegido: cada tarjeta se rellena al terminar la suya
  let calculando = false;
  async function calcularPrevisiones() {
    if (calculando) return;
    calculando = true;
    try {
      for (;;) {
        const equipo = [elegido, ...catalogo].find((e) => e && !resultados.has(e.clave));
        if (!equipo) return;
        if (!previsiones.has(equipo.clave)) previsiones.set(equipo.clave, prevision(yo, equipo, formato.id).catch(() => null));
        const p = await previsiones.get(equipo.clave);
        if (!raiz.isConnected || !vigente()) return;
        resultados.set(equipo.clave, p);
        const carta = raiz.querySelector(`.rival-opcion[data-clave="${CSS.escape(equipo.clave)}"]`);
        if (carta) ponerPrevision(carta, p);
      }
    } finally {
      calculando = false;
    }
  }

  function elegirEquipo(equipo) {
    if (!equipo) return;
    elegido = equipo;
    for (const carta of raiz.querySelectorAll(".rival-opcion")) carta.setAttribute("aria-checked", carta.dataset.clave === equipo.clave);
    $("#usar").disabled = false;
  }

  pintarGrupos();
  calcularPrevisiones();

  raiz.addEventListener("click", (evento) => {
    const carta = evento.target.closest(".rival-opcion");
    if (carta) elegirEquipo(catalogo.find((e) => e.clave === carta.dataset.clave));
  });

  $("#usar").addEventListener("click", (evento) => {
    if (!elegido) {
      avisar("Select an opponent first");
      return;
    }
    evento.currentTarget.disabled = true; // un segundo toque no repite el cambio
    const { grupo, ...rival } = elegido;
    elegir({ rival });
    location.hash = "#/simulador";
  });

  $("#leer").addEventListener("click", () => {
    const resultado = leerShowdown($("#pegado").value, formato);
    const aviso = $("#aviso-pegado");
    aviso.textContent = resultado.mensaje;
    aviso.style.color = resultado.error ? "var(--error)" : "";
    if (resultado.error) return;
    pegado = resultado.equipo;
    const nuevo = { ...pegado, grupo: "pegado" };
    const previo = catalogo.findIndex((e) => e.grupo === "pegado");
    if (previo >= 0) catalogo.splice(previo, 1);
    previsiones.delete("pegado");
    resultados.delete("pegado");
    catalogo.push(nuevo);
    elegido = nuevo;
    pintarGrupos();
    $("#usar").disabled = false;
    calcularPrevisiones();
    raiz.querySelector(`.rival-opcion[data-clave="pegado"]`)?.scrollIntoView({ block: "center" });
  });
}

// ---------------------------------------------------------------------------
// Piezas

// Una tarjeta: nombre, previsión, de dónde sale y sus seis Pokémon
function tarjeta(equipo, marcada, resultados) {
  const piezas = equipo.miembros.map((m) => `<span title="${escapar(m.especie)}">${sprite(m.especie)}</span>`).join("");
  return `
    <button type="button" class="rival-opcion" role="radio" aria-checked="${marcada}" data-clave="${escapar(equipo.clave)}">
      <span class="rival-cabecera">
        <span class="rival-nombre">${escapar(equipo.nombre)}</span>
        <span class="rival-prevision" data-prev>${textoPrevision(resultados.get(equipo.clave))}</span>
      </span>
      <span class="nota rival-detalle">${escapar(equipo.detalle ?? `${equipo.miembros.length} Pokémon`)}</span>
      <span class="rival-equipo">${piezas}</span>
    </button>`;
}

// «Calculating…» mientras no hay resultado (undefined); con él, la cifra (verde si va por delante, roja si va por detrás)
function textoPrevision(p) {
  if (p === undefined) return `<span class="nada">Calculating…</span>`;
  if (p === null) return `<span class="nada">No estimate</span>`;
  const valor = Math.round(p);
  return `<b class="${valor >= 55 ? "gana" : valor < 45 ? "pierde" : ""}">${valor}%</b>`;
}

function ponerPrevision(carta, p) {
  carta.querySelector("[data-prev]").innerHTML = textoPrevision(p);
  const nombre = carta.querySelector(".rival-nombre").textContent;
  carta.setAttribute("aria-label", p == null ? `${nombre}, no estimate` : `${nombre}, estimated win rate ${Math.round(p)}%`);
}

// Un equipo en formato Showdown → equipo de la app, o el motivo por el que no vale
function leerShowdown(texto, formato) {
  const bloques = texto.replace(/\r/g, "").split(/\n\s*\n/).filter((b) => b.trim());
  if (bloques.length > 6) {
    return { error: true, mensaje: `Found ${bloques.length} Pokémon (max 6). Remove ${bloques.length - 6} and read again.` };
  }
  const leidos = importarEquipo(texto); // solo especies conocidas; los nombres que no reconoce van en .descartados
  const miembros = leidos.filter((set) => repartoValido(set.valores, formato)).map((set) => ({ ...set, naturaleza: set.naturaleza ?? "Serious" }));
  if (!miembros.length) {
    return {
      error: true,
      mensaje: leidos.length
        ? `Those Pokémon's stat spreads are invalid in ${formato.nombre}: check their EVs.`
        : "No recognizable Pokémon found: each block starts with the name followed by Ability:, Tera Type:, and moves starting with \"- \".",
    };
  }
  const sinRepartoValido = leidos.length - miembros.length;
  const descartados = leidos.descartados ?? [];
  const notas = [
    descartados.length ? ` Unrecognized: ${descartados.join(", ")}.` : "",
    sinRepartoValido ? ` Removed ${sinRepartoValido} due to invalid stat spreads.` : "",
  ].join("");
  return {
    mensaje: `Team read: ${miembros.length} Pokémon, selected as opponent.${notas}`,
    equipo: {
      clave: "pegado",
      champions: Boolean(formato.champions),
      nombre: "Pasted team",
      origen: "Team pasted from Showdown",
      detalle: `${miembros.length} Pokémon read from Showdown`,
      miembros,
    },
  };
}
