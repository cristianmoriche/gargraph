// Simulador · preparar el combate (#/simulador): tu equipo, el rival, la previsión y las opciones.
// Se juega con el formato del equipo (no con el del perfil): si cambias de equipo, puede cambiar el formato y el rival.
import { escapar, sprite, vacio, aviso, avisar, cabeceraDetalle, tituloSeccion, decimal, icono } from "../../ui.js";
import { cargarFormato, especie, estadisticasReales } from "../../meta.js";
import { sesion, elegir, simular, prevision, disponible, formatoDe, revisarEquipos, comoIndividual, cuantosJuegan, AVISO_INDIVIDUAL } from "../../sim/index.js";
import { completarEquipo } from "../dex.js";
import { misEquipos, equipoYo, rivalPara, etiquetaOrigen, avisoNoDisponible, NOTA_PREVISION } from "./rival.js";

const VELOCIDADES = [[1, "x1"], [2, "x2"], [4, "x4"]];
const NUMEROS_DE_COMBATES = [[1, "1 battle"], [100, "100 battles"]];

export async function pintar(vista, contexto) {
  const { vigente } = contexto;
  const cabecera = cabeceraDetalle({ titulo: "Simulator", volver: "#/equipos" });

  let propios = misEquipos();
  if (!propios.length) {
    vista.innerHTML = `<div class="v-sim-preparar">${cabecera}${vacio(
      "No teams yet",
      "You need a team of your own to simulate a battle.",
      `<a class="boton" href="#/equipos">Create a team</a>`,
    )}</div>`;
    return;
  }

  // Los Pokémon guardados sin movimientos se completan solos con su set, y se avisa (abajo)
  const completados = new Map();
  for (const equipo of propios) {
    const hecho = await completarEquipo(equipo.id).catch(() => null);
    if (hecho && (hecho.cambios.length || hecho.sinSet.length)) completados.set(equipo.id, hecho);
  }
  if (!vigente()) return;
  if (completados.size) propios = misEquipos(); // con los miembros ya completos

  const yo = equipoYo(propios);
  const formato = await cargarFormato(formatoDe(yo));
  if (!vigente()) return;
  elegir({ yo });

  const juegan = cuantosJuegan(formato); // 3 en BSS, 4 en VGC y 6 en Gen 9 OU
  const selectorDeEquipo = propios.length > 1
    ? `<div class="segmentado" id="selEq" role="group" aria-label="Select team">${propios.map((e) => `<button type="button" class="segmento" aria-pressed="${e.id === yo.id}" data-id="${escapar(e.id)}">${escapar(e.nombre)}</button>`).join("")}</div>`
    : "";
  const seccionTuEquipo = `
    <section class="seccion primera">
      ${tituloSeccion("Your Team")}
      ${selectorDeEquipo}
      ${tarjetaDeEquipo(yo, `<span class="insignia">${escapar(formato.nombre)}</span>`)}
      ${comoIndividual(formato) ? `<p class="como-individual">${icono("info")}<span><b>${AVISO_INDIVIDUAL}</b>. ${escapar(formato.nombre)} is a doubles format; the simulator plays singles (1v1), with one Pokémon on each side of the field.</span></p>` : ""}
      ${juegan < 6 ? `<p class="como-individual">${icono("info")}<span>The AI will pick <b>${juegan} of the 6</b> Pokémon from each team (yours and the opponent's) and which one leads. You'll see this in the battle and in the analysis.</span></p>` : ""}
    </section>`;

  // El simulador no vale para este formato: se enseña el equipo (para poder cambiarlo) y el aviso
  if (!disponible(formato)) {
    vista.innerHTML = `<div class="v-sim-preparar">${cabecera}${seccionTuEquipo}${avisoNoDisponible(formato, yo)}</div>`;
    conectarSelectorDeEquipo(vista, propios, yo, contexto);
    return;
  }

  // El rival de la sesión solo se queda si sigue valiendo en este formato; si no, el primero del meta
  const rival = rivalPara(formato, yo, propios);
  if (rival !== sesion.rival) elegir({ rival });
  const opciones = sesion.opciones;
  const problemas = revisarEquipos(yo, rival, formato.id); // un Pokémon que no existe o sin movimientos: no se simula

  const seccionRival = `
    <section class="seccion">
      ${tituloSeccion("Opponent", `<a class="boton secundario cambiar" href="#/simulador/rival">Change opponent</a>`)}
      ${rival
        ? `${tarjetaDeEquipo(rival, `<span class="insignia">${escapar(etiquetaOrigen(rival))}</span>`)}${rival.detalle ? `<p class="nota detalle-rival">${escapar(rival.detalle)}</p>` : ""}`
        : `<div class="tarjeta"><p class="nada">No opponent selected yet: pick one.</p></div>`}
    </section>`;

  const seccionCompletado = avisoDeCompletado([yo, rival].map((e) => completados.get(e?.id)));
  const seccionProblemas = problemas.length
    ? `<section class="seccion">${aviso("Cannot simulate this battle", `${problemas.map((p) => escapar(p.texto)).join("<br>")}<br>${salidaDeProblemas(problemas)}`)}</section>`
    : "";

  vista.innerHTML = `
    <div class="v-sim-preparar">
      ${cabecera}
      ${seccionTuEquipo}
      ${seccionRival}
      ${seccionCompletado}
      ${seccionProblemas}
      <section class="seccion">
        ${tituloSeccion("Estimated Matchup")}
        <div id="prevision" aria-live="polite"></div>
      </section>
      <section class="seccion">
        ${tituloSeccion("Speed Tiers")}
        <div class="tarjeta">
          <ol class="velocidad" id="velocidad"></ol>
          <p class="nota leyenda"><span class="marca yo"></span>Your team <span class="marca rival"></span>Opponent · fastest to slowest, with their nature and spread, excluding items and abilities.</p>
        </div>
      </section>
      <section class="seccion">
        ${tituloSeccion("Options")}
        <ul class="tarjeta sin-relleno lista">
          <li class="fila">
            <span class="fila-texto"><span class="fila-titulo">Speed</span><span class="fila-sub">On-screen battle speed</span></span>
            <div class="segmentado" id="sVel" role="group" aria-label="Battle speed">${segmento(VELOCIDADES, opciones.velocidad)}</div>
          </li>
          <li>
            <label class="fila fila-interruptor">
              <span class="fila-texto"><span class="fila-titulo">Show AI decision</span><span class="fila-sub">What each side picks and why</span></span>
              <input type="checkbox" class="interruptor" role="switch" id="sIa"${opciones.verIA ? " checked" : ""}>
            </label>
          </li>
          <li class="fila">
            <span class="fila-texto"><span class="fila-titulo">Number of battles</span></span>
            <div class="segmentado" id="sN" role="group" aria-label="Number of battles">${segmento(NUMEROS_DE_COMBATES, opciones.combates)}</div>
          </li>
        </ul>
        <p class="nota" id="notaCombates"></p>
      </section>
      <section class="seccion">
        <button type="button" class="boton bloque" id="ir"${rival && !problemas.length ? "" : " disabled"}>Simulate battle</button>
      </section>
    </div>`;

  const raiz = vista.querySelector(".v-sim-preparar");
  const $ = (selector) => raiz.querySelector(selector);

  pintarVelocidad();
  if (rival && !problemas.length) pintarPrevision();
  else $("#prevision").innerHTML = `<p class="nada">${rival ? "Matchup estimate unavailable while Pokémon have issues." : "Select an opponent to see the matchup estimate."}</p>`;
  notaCombates();
  conectarSelectorDeEquipo(vista, propios, yo, contexto);

  // Velocidad real de los 12 con su naturaleza y su reparto, de más rápido a más lento
  function pintarVelocidad() {
    const todos = [["yo", yo.miembros], ["rival", rival?.miembros ?? []]].flatMap(([lado, miembros]) => miembros.map((m) => {
      const base = especie(m.especie)?.base;
      return base ? { nombre: m.especie, lado, velocidad: estadisticasReales(base, m.naturaleza ?? "Serious", m.valores ?? [0, 0, 0, 0, 0, 0], formato)[5] } : null;
    })).filter((p) => Number.isFinite(p?.velocidad)).sort((a, b) => b.velocidad - a.velocidad); // sin los IVs del formato no hay velocidad
    $("#velocidad").innerHTML = todos.map((p) => `
      <li class="${p.lado}" title="${escapar(`${p.nombre} · ${p.lado === "yo" ? "your team" : "opponent"}`)}">${sprite(p.nombre)}<b>${p.velocidad}</b></li>`).join("");
  }

  // La previsión llega después de pintar: así la pantalla no espera al cálculo
  async function pintarPrevision() {
    $("#prevision").innerHTML = `<p class="nada">Calculating…</p>`;
    const p = await prevision(yo, rival, formato.id).catch(() => null);
    if (!raiz.isConnected || !vigente()) return;
    if (p == null) {
      $("#prevision").innerHTML = `<p class="nada">No estimate: calculated when simulating.</p><p class="nota">${escapar(NOTA_PREVISION)}</p>`;
      return;
    }
    const tu = Math.round(p);
    $("#prevision").innerHTML = `
      <p class="cifra ${tu >= 55 ? "gana" : tu < 45 ? "pierde" : ""}">${decimal(tu, 0)}% win rate</p>
      <p class="nota">${escapar(NOTA_PREVISION)}${juegan < 6 ? ` Based on the ${juegan} Pokémon the AI picks for each team.` : ""}</p>`;
  }

  function notaCombates() {
    $("#notaCombates").textContent = sesion.opciones.combates === 100
      ? "The first battle plays out; the other 99 run in the background while you watch, and the 100-battle results are shown in the analysis."
      : "One full battle to watch turn by turn.";
  }

  // Opciones
  $("#sVel").addEventListener("click", (evento) => cambiarSegmento(evento, "#sVel", (v) => elegir({ opciones: { velocidad: v } })));
  $("#sN").addEventListener("click", (evento) => cambiarSegmento(evento, "#sN", (v) => { elegir({ opciones: { combates: v } }); notaCombates(); }));
  $("#sIa").addEventListener("change", (evento) => elegir({ opciones: { verIA: evento.target.checked } }));
  function cambiarSegmento(evento, selector, cambiar) {
    const boton = evento.target.closest("button");
    if (!boton) return;
    for (const b of $(selector).querySelectorAll("button")) b.setAttribute("aria-pressed", b === boton);
    cambiar(Number(boton.dataset.v));
  }

  // Simular: el botón avisa y, al acabar el cálculo, se pasa al combate
  let lanzado = false;
  $("#ir").addEventListener("click", async (evento) => {
    if (lanzado) return;
    lanzado = true;
    const boton = evento.currentTarget;
    boton.disabled = true;
    boton.textContent = "Simulating…";
    try {
      await simular();
    } catch (error) {
      console.error(error);
      lanzado = false;
      boton.disabled = false;
      boton.textContent = "Simulate battle";
      avisar("Could not simulate the battle");
      return;
    }
    if (!vigente()) return;
    location.hash = "#/simulador/combate";
  });
}

// ---------------------------------------------------------------------------
// Piezas

// Cambiar de equipo puede cambiar de formato y de rival: se pinta la pantalla otra vez
function conectarSelectorDeEquipo(vista, propios, yo, contexto) {
  vista.querySelector("#selEq")?.addEventListener("click", (evento) => {
    const nuevo = propios.find((e) => e.id === evento.target.closest("button")?.dataset.id);
    if (!nuevo || nuevo.id === yo.id) return;
    elegir({ yo: nuevo });
    pintar(vista, contexto);
  });
}

// Un equipo: nombre y etiqueta a la izquierda, sus Pokémon a la derecha
function tarjetaDeEquipo(equipo, etiqueta) {
  const nombres = equipo.miembros.map((m) => m.especie).join(", ");
  return `
    <div class="tarjeta equipo">
      <div class="equipo-texto"><p class="equipo-nombre">${escapar(equipo.nombre)}</p>${etiqueta}</div>
      <div class="equipo-pokemon" role="img" aria-label="${escapar(nombres)}">${equipo.miembros.map((m) => sprite(m.especie)).join("")}</div>
    </div>`;
}

// Lo que se ha completado solo en tu equipo o en el rival (si es uno tuyo): de dónde sale cada set
function avisoDeCompletado(resultados) {
  const cambios = resultados.flatMap((r) => r?.cambios ?? []);
  if (!cambios.length) return "";
  const detalle = cambios.map(({ especie, texto }) => `${escapar(especie)}: ${escapar(texto)}`).join("<br>");
  return `<section class="seccion"><div class="aviso info" role="status">${icono("info")}<div class="aviso-texto"><p class="aviso-titulo">Sets completed</p><p class="aviso-detalle">These Pokémon were missing moves and have been completed and saved to their team.<br>${detalle}</p></div></div></section>`;
}

// Qué hacer con los problemas: los de tu equipo se corrigen en Equipos; los del rival, eligiendo otro
function salidaDeProblemas(problemas) {
  const tuyos = problemas.some((p) => p.lado === "yo");
  const delRival = problemas.some((p) => p.lado === "rival");
  if (tuyos && delRival) return "Fix your team in Teams and pick another opponent.";
  return tuyos ? "Fix it in Teams or pick another one of your teams." : "Pick another opponent.";
}

// Botones de un selector de una opción entre varias
function segmento(valores, actual) {
  return valores.map(([v, texto]) => `<button type="button" class="segmento" aria-pressed="${v === actual}" data-v="${v}">${texto}</button>`).join("");
}
