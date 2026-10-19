// Simulador · el combate, turno a turno (#/simulador/combate).
// Reproduce cualquier combate que cumpla disenos/implementacion/CONTRATO-SIMULADOR.md, evento a evento.
// El estado de cada momento (activos, PS, trampas, tera y debilitados) se calcula aplicando los eventos
// desde el principio: por eso se puede saltar a cualquier turno. Si se sale de la pantalla y se vuelve
// (por ejemplo, a ver una jugada en «¿Por qué?»), el combate sigue en el turno en que se dejó.
// Cada evento cambia el campo, escribe su línea en el registro y espera un poco. Las animaciones son cortas y de
// solo transform y opacity (css/vistas/sim-combate.css): entrada, avance del atacante, sacudida de quien recibe,
// caída al debilitarse, destello al megaevolucionar o teracristalizar y rótulos. Su duración sigue la velocidad (--ritmo).
import { cargarFormato, especie, infoMeta, nombreMovimiento } from "../../meta.js";
import { sinMovimiento } from "../../movimiento.js";
import { AVISO_INDIVIDUAL, TOTAL_SERIE, elegir, escucharSerie, serieEnCurso, seguirSerie, sesion, simular } from "../../sim/index.js";
import { nombreTipo } from "../../tipos.js";
import { aviso, cabeceraDetalle, cargando, escapar, icono, insigniaTipo, sprite, urlIlustracion, urlSprite, urlSpriteAnimado, variableTipo } from "../../ui.js";
import { seccionQuienJuega } from "./quien-juega.js";

const RITMO = 0.7; // los tiempos de abajo se acortan un poco: el combate va algo más vivo
const LADOS = ["yo", "rival"];
const VELOCIDADES = [1, 2, 4];
const CANCELADO = Symbol("cancelado"); // lo que se lanza cuando se salta de turno o se sale de la pantalla
const QUIEN = { yo: "You", rival: "Opponent" };
const ROTULO = { hab: "Ability", obj: "Item" };
const EFICACIA = { 4: "4× · Doubly super effective", 2: "2× · Super effective", 0.5: "½× · Not very effective", 0.25: "¼× · Doubly resisted" };
// Cuánto se queda cada tipo de evento en pantalla (ms, antes de aplicar la velocidad)
const PAUSA = { entra: 700, cambio: 800, mov: 900, hab: 1500, obj: 1500, estado: 800, rocas: 800, tera: 1200, ko: 900, otro: 800 };
// Cómo se enseña cada trampa en la placa del Pokémon, por el id de su movimiento
const URL_PS = "https://play.pokemonshowdown.com/sprites/"; // segunda fuente de imágenes, por si falla la de PokeAPI
const PLAZO_IMAGEN = 5000; // ms sin respuesta de una imagen antes de probar la siguiente
const AVANCE = 200; // ms que tarda el avance del atacante en llegar al contacto: el golpe se nota ahí
// Las clases de animación de la figura (se quitan todas al saltar de turno)
const ANIMACIONES = ["anim-entra", "anim-ataca", "anim-prepara", "anim-golpe", "anim-cae", "anim-transforma"];
const SELLO_TRAMPA = { stealthrock: "Rocks", spikes: "Spikes", toxicspikes: "T-Spikes", stickyweb: "Web" };

// Dónde se dejó el último combate visto: { combate, hechos, enPausa }. Vale mientras no se recargue la página
// y solo para ese mismo combate: uno nuevo empieza desde el principio.
let recuerdo = null;

const otro = (lado) => (lado === "yo" ? "rival" : "yo");
const nivel = (ps) => (ps < 25 ? "bajo" : "ok"); // por debajo del 25% la barra se pone en --error
/** Lanza una animación de CSS sobre un elemento (la repite si ya estaba) y la quita al acabar. Con «reducir movimiento», nada. */
function animar(el, clase) {
  if (!el || sinMovimiento()) return;
  el.classList.remove(clase);
  void el.offsetWidth; // para que vuelva a empezar
  el.classList.add(clase);
  el.addEventListener("animationend", (evento) => {
    if (evento.target === el && evento.animationName.startsWith(clase)) el.classList.remove(clase);
  }, { once: true });
}
const dormir = (ms) => new Promise((cumplir) => setTimeout(cumplir, ms));
const turnos = (n) => `${n} ${n === 1 ? "turn" : "turns"}`;

export async function pintar(vista, { consulta, vigente }) {
  const ejemplo = consulta.has("ejemplo"); // con «?ejemplo» se ve el combate de ejemplo aunque no haya equipos elegidos
  const cola = ejemplo ? "?ejemplo" : "";
  const hayEquipos = Boolean(sesion.yo?.miembros?.length && sesion.rival?.miembros?.length);
  if (!ejemplo && !hayEquipos && !combateValido(sesion.combate)) {
    location.replace("#/simulador");
    return;
  }

  vista.innerHTML = `<div class="v-sim-combate">${cabeceraDetalle({ titulo: "Simulated Battle", volver: `#/simulador${cola}` })}${cargando("Simulating…")}</div>`;

  let combate;
  try {
    await cargarFormato().catch(() => {}); // solo hace falta para el diccionario (imágenes y nombres): sin él se sigue
    combate = (ejemplo ? null : sesion.combate) ?? (await simular());
    if (!combateValido(combate)) throw new Error("Battle data is empty.");
  } catch (error) {
    if (!vigente()) return;
    console.error(error);
    vista.innerHTML = `
      <div class="v-sim-combate">
        ${cabeceraDetalle({ titulo: "Simulated Battle", volver: `#/simulador${cola}` })}
        ${aviso("Could not simulate the battle", "Go back to setup and try again.")}
        <p class="fallo-accion"><a class="boton" href="#/simulador${cola}">Set up simulation</a></p>
      </div>`;
    return;
  }
  if (!vigente()) return;

  vista.innerHTML = plantilla(combate, cola);
  reproductor(vista.querySelector(".v-sim-combate"), combate, { vigente, cola });
  if (!ejemplo) progresoDeSerie(vista.querySelector(".serie"), combate, vigente);
}

/** «100 combates»: cómo va la serie que se juega en segundo plano mientras se ve este combate. */
function progresoDeSerie(linea, combate, vigente) {
  const pintarSerie = () => {
    const cien = combate.cien;
    linea.hidden = !cien;
    if (!cien) return;
    const jugados = cien.ganados.length;
    const ganados = cien.ganados.filter(Boolean).length;
    const estado = jugados >= TOTAL_SERIE ? "complete" : serieEnCurso(combate) ? "simulating…" : cien.fallo ? "interrupted" : "stopped";
    linea.textContent = `${TOTAL_SERIE} battles, ${estado}: ${jugados} of ${TOTAL_SERIE} played, won ${ganados}. Full results in the analysis.`;
  };
  const dejar = escucharSerie((cual) => {
    if (!vigente() || !linea.isConnected) return dejar();
    if (cual === combate) pintarSerie();
  });
  seguirSerie(combate); // si se recargó la página a medias, sigue donde iba
  pintarSerie();
}

const combateValido = (combate) => Boolean(combate?.turnos?.length && LADOS.every((lado) => combate[lado]?.equipo?.length));

// ---------------------------------------------------------------------------
// El HTML

function plantilla(combate, cola) {
  const total = combate.turnos.length;
  const subtitulo = [combate.formatoNombre, `${combate.yo.nombre} vs. ${combate.rival.nombre}`].filter(Boolean).join(" · ");
  // Un formato de dobles se juega uno contra uno: se dice siempre, arriba del todo
  const individual = combate.comoIndividual
    ? `<p class="como-individual">${icono("info")}<span><b>${AVISO_INDIVIDUAL}</b>. ${escapar(combate.formatoNombre ?? "This format")} is a doubles format; the simulator plays singles (1v1).</span></p>`
    : "";

  const luchador = (lado, etiqueta) => `
    <section class="luchador sin-salir" data-lado="${lado}" aria-label="${etiqueta}">
      <div class="figura" role="img"></div>
      <div class="rotulos"></div>
      <div class="placa">
        <div class="placa-linea"><b class="placa-nombre"></b><span class="placa-nivel"></span></div>
        <div class="placa-tipos"></div>
        <div class="ps"><span class="ps-etiqueta">HP</span><span class="barra-ps" data-nivel="ok"><i></i></span><b class="ps-valor">100%</b></div>
      </div>
    </section>`;

  const banco = (lado, titulo) => `
    <div class="banco">
      <h2 class="banco-titulo">${titulo}</h2>
      <ul data-banco="${lado}" style="--plazas: ${combate[lado].equipo.length}">
        ${combate[lado].equipo.map((miembro) => `
          <li class="plaza" title="${escapar(miembro.nombre)}">
            ${sprite(miembro.nombre, { id: idImagen(miembro) ?? 0 })}
            <span class="plaza-barra"><i></i></span>
            <b class="plaza-ps">100%</b>
          </li>`).join("")}
      </ul>
    </div>`;

  return `
    <div class="v-sim-combate">
      ${cabeceraDetalle({ titulo: "Simulated Battle", subtitulo: escapar(subtitulo), volver: `#/simulador${cola}` })}
      ${individual}

      <section class="resumen" aria-label="Battle status">
        <div class="resumen-celda">
          <p class="resumen-etiqueta">Turn</p>
          <p class="resumen-valor"><span class="reloj">1</span><span class="resumen-de"> of ${total}</span></p>
        </div>
        <div class="resumen-celda marcador" aria-label="Remaining Pokémon">
          <p class="resumen-etiqueta">Remaining</p>
          <p class="resumen-valor">You <b data-marcador="yo">${combate.yo.equipo.length}</b> – <b data-marcador="rival">${combate.rival.equipo.length}</b> Opp.</p>
        </div>
        <div class="resumen-celda prob">
          <p class="resumen-etiqueta">AI Estimate</p>
          <p class="resumen-valor prob-valor">–</p>
        </div>
      </section>

      <section class="escenario" aria-label="Battlefield">
        <div class="campo" aria-hidden="true"><i class="plataforma rival"></i><i class="plataforma yo"></i></div>
        ${luchador("rival", "Opponent's Pokémon")}
        ${luchador("yo", "Your Pokémon")}
      </section>

      <div class="final" hidden>
        <div class="final-texto"><b></b><span class="final-sub"></span></div>
        <a class="boton" href="#/simulador/resultado${cola}">See analysis</a>
      </div>
      <p class="nota serie" aria-live="polite" hidden></p>

      <aside class="franja" data-lado="yo" aria-live="polite" hidden>
        <div class="franja-texto">
          <p class="nota quien">Your AI picks</p>
          <p class="franja-jugada"></p>
          <p class="franja-porque"></p>
        </div>
        <a class="boton secundario pequeno por-que" href="#/simulador/decision/1${cola}">Why?</a>
      </aside>

      <section class="registro" aria-label="Turn log">
        <h2 class="registro-titulo">Turn <span class="registro-n">1</span> log</h2>
        <ol aria-live="polite"></ol>
      </section>

      <div class="controles" role="group" aria-label="Battle controls">
        <button type="button" class="boton secundario" data-control="anterior" aria-label="Previous turn">${icono("anterior")}<span>Prev</span></button>
        <button type="button" class="boton secundario" data-control="pausa"></button>
        <button type="button" class="boton" data-control="siguiente" aria-label="Next turn">${icono("siguiente")}<span>Next</span></button>
        <button type="button" class="boton secundario" data-control="velocidad" aria-label="Playback speed"><b>x1</b><span>Speed</span></button>
        <button type="button" class="boton secundario" data-control="final" aria-label="Skip to end">${icono("fin")}<span>End</span></button>
      </div>

      <section class="bancos" aria-label="Both teams">
        ${banco("yo", combate.yo.seleccion ? `Your team · ${combate.yo.equipo.length} of ${combate.yo.seleccion.de} brought` : "Your team")}
        ${banco("rival", combate.rival.seleccion ? `Opponent · ${combate.rival.equipo.length} of ${combate.rival.seleccion.de} brought` : "Opponent")}
      </section>
      ${seccionQuienJuega(combate)}
    </div>`;
}

// ---------------------------------------------------------------------------
// Imágenes

/** El número de la especie para las imágenes: el del diccionario y, si no está, el que trae el combate. */
function idImagen(miembro) {
  try {
    return especie(miembro.nombre)?.id ?? miembro.id;
  } catch {
    return miembro.id; // el diccionario no ha llegado a cargarse
  }
}

/** El nivel de los Pokémon, el del formato del combate. El combate de ejemplo no trae formato: sin nivel. */
function nivelDelFormato(combate) {
  try {
    return infoMeta().formatos.find((formato) => formato.id === combate.formato)?.nivel ?? null;
  } catch {
    return null;
  }
}

/** El nombre de los ficheros de imágenes de Showdown: «Charizard-Mega-X» → «charizard-megax», «Great Tusk» → «greattusk». */
function idShowdown(nombre) {
  const aId = (texto) => String(texto).toLowerCase().replace(/[^a-z0-9]+/g, "");
  let base = null;
  try {
    base = especie(nombre)?.especie;
  } catch {
    // el diccionario no ha llegado a cargarse: se usa el nombre tal cual
  }
  if (!base) return aId(nombre) || null;
  const forma = aId(nombre.slice(base.length));
  return forma ? `${aId(base)}-${forma}` : aId(base);
}

/**
 * Cambia la imagen del campo por una nueva: así no se ve al Pokémon anterior mientras llega la suya.
 * Cada imagen tiene una lista de direcciones de dos servidores (PokeAPI y Showdown) y se prueba la siguiente si una
 * falla o tarda demasiado; el texto alternativo va vacío (el nombre ya está en la placa y en el aria-label de la figura),
 * así nunca se ve el nombre suelto como si fuera el Pokémon.
 * Tuyo (de espaldas): sprite de espaldas de PokeAPI y de Showdown, sus GIF animados y, al final, el de frente girado.
 * Rival (de frente): sprite de PokeAPI y de Showdown, ilustración y GIF animado.
 * Si no carga ninguna, la figura queda marcada «sin-imagen» y se ve un círculo con las iniciales.
 */
function ponerImagen(figura, forma, lado) {
  const id = forma.id;
  const ps = idShowdown(forma.nombre);
  const frontal = id ? urlSprite(id) : null;
  const opciones = (lado === "yo"
    ? [
      frontal && [frontal.replace(/(\d+\.png)$/, "back/$1"), ""],
      ps && [`${URL_PS}gen5-back/${ps}.png`, ""],
      id && [urlSpriteAnimado(id, true), ""],
      ps && [`${URL_PS}ani-back/${ps}.gif`, ""],
      frontal && [frontal, "girada"],
      ps && [`${URL_PS}gen5/${ps}.png`, "girada"],
    ]
    : [
      frontal && [frontal, ""],
      ps && [`${URL_PS}gen5/${ps}.png`, ""],
      id && [urlIlustracion(id), "ilustracion"],
      ps && [`${URL_PS}ani/${ps}.gif`, ""],
    ]).filter(Boolean);

  const imagen = new Image();
  imagen.alt = "";
  imagen.decoding = "async";
  figura.classList.remove("sin-imagen");
  figura.dataset.iniciales = String(forma.nombre).replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase();
  figura.replaceChildren(imagen);
  let n = 0;
  let plazo;
  const probar = () => {
    clearTimeout(plazo);
    if (figura.firstChild !== imagen) return; // ya se ha puesto otro Pokémon en su lugar
    if (n >= opciones.length) {
      imagen.remove();
      figura.classList.add("sin-imagen");
      return;
    }
    const [url, clase] = opciones[n++];
    imagen.className = clase;
    imagen.src = url;
    plazo = setTimeout(probar, PLAZO_IMAGEN);
  };
  imagen.onload = () => clearTimeout(plazo);
  imagen.onerror = probar;
  probar();
}

/**
 * La forma que se ve de un Pokémon: la Mega que viene en el combate o, si sale con su forma base y todavía
 * no ha megaevolucionado, esa forma («antes»). { nombre, id, tipos }.
 */
function formaDe(miembro, megaevolucionado) {
  if (miembro.antes && !megaevolucionado) return { nombre: miembro.antes.nombre ?? miembro.nombre, id: miembro.antes.id, tipos: miembro.antes.tipos ?? [] };
  return { nombre: miembro.nombre, id: idImagen(miembro), tipos: miembro.tipos ?? [] };
}

// ---------------------------------------------------------------------------
// El estado del combate

function estadoInicial(combate) {
  const estado = { ps: {}, caidos: {}, tera: {}, mega: {}, activo: {}, trampas: {}, gana: null };
  for (const lado of LADOS) {
    estado.ps[lado] = Object.fromEntries(combate[lado].equipo.map((miembro) => [miembro.nombre, 100]));
    estado.caidos[lado] = {};
    estado.tera[lado] = {};
    estado.mega[lado] = {};
    estado.activo[lado] = null;
    estado.trampas[lado] = []; // [[nombre, capas]]
  }
  return estado;
}

/**
 * Las trampas de cada lado. El motor las dice en el campo «trampas» del evento en que cambian:
 * { yo: [[nombre, capas]], rival: […] }. Un combate que no trae ese campo en ningún evento (el de ejemplo)
 * solo puede deducir Stealth Rock, por el nombre del movimiento que la pone o la quita.
 * Los nombres salen del diccionario, que es de donde los saca también quien escribe el combate.
 */
function movimientosDeTrampas(combate) {
  const enIngles = (id) => {
    try {
      return nombreMovimiento(id);
    } catch {
      return null; // el diccionario no ha llegado a cargarse
    }
  };
  const nombres = (ids) => new Set(ids.map(enIngles).filter(Boolean));
  return {
    avisadas: combate.turnos.some((turno) => (turno.eventos ?? []).some((evento) => evento.trampas)),
    rocas: enIngles("stealthrock") ?? "Stealth Rock",
    sellos: new Map(Object.entries(SELLO_TRAMPA).map(([id, sello]) => [enIngles(id), sello])),
    ponen: nombres(["stealthrock"]).add("Stealth Rock"),
    limpianSuLado: nombres(["rapidspin", "mortalspin"]),
    limpianTodo: nombres(["defog", "tidyup"]),
  };
}

/** Aplica un evento al estado. Vale para cualquier tipo: de uno que no se conozca solo se usa «da». */
function aplicar(evento, estado, trampas) {
  if (Array.isArray(evento.da)) {
    const [lado, nombre, , despues] = evento.da;
    if (estado.ps[lado]) estado.ps[lado][nombre] = despues;
  }
  if (evento.t === "fin") estado.gana = evento.gana ?? null;
  const lado = evento.lado;
  if (!LADOS.includes(lado)) return;
  switch (evento.t) {
    case "entra":
      estado.activo[lado] = evento.p;
      break;
    case "cambio":
      estado.activo[lado] = evento.entra;
      break;
    case "ko":
      estado.ps[lado][evento.p] = 0;
      estado.caidos[lado][evento.p] = true;
      break;
    case "tera":
      estado.tera[lado][evento.p] = evento.tipo;
      break;
    case "obj":
      if (evento.mega) estado.mega[lado][evento.p] = true; // la megapiedra: desde aquí se ve la forma Mega
      break;
    case "rocas":
      // si le hacen daño al entrar, es que están puestas
      if (!trampas.avisadas && !estado.trampas[lado].length) estado.trampas[lado] = [[evento.n ?? trampas.rocas, 1]];
      break;
    case "mov":
      if (trampas.avisadas) break;
      if (trampas.ponen.has(evento.n)) estado.trampas[otro(lado)] = [[trampas.rocas, 1]];
      if (trampas.limpianSuLado.has(evento.n) && evento.ef !== 0) estado.trampas[lado] = [];
      if (trampas.limpianTodo.has(evento.n)) estado.trampas.yo = estado.trampas.rival = [];
      break;
  }
  // Lo que diga el motor manda sobre lo deducido
  if (evento.trampas) for (const bando of LADOS) estado.trampas[bando] = evento.trampas[bando] ?? [];
}

/** El texto de un evento para el registro (sin HTML). */
function textoDeEvento(evento, marcadorFinal, total) {
  const ps = Array.isArray(evento.da) ? ` · ${evento.da[1]} ${evento.da[2]} → ${evento.da[3]}%` : "";
  const extra = evento.txt ? ` · ${evento.txt}` : "";
  switch (evento.t) {
    case "entra":
      return evento.lado === "yo" ? `Go! ${evento.p}!` : `Sent out ${evento.p}!`;
    case "cambio":
      return evento.lado === "yo" ? `${evento.sale}, come back! Go! ${evento.entra}!` : `Withdrew ${evento.sale} and sent out ${evento.entra}!`;
    case "mov": {
      const eficacia = EFICACIA[evento.ef] ? ` (${EFICACIA[evento.ef]})` : "";
      return `${evento.p} used ${evento.n}!${eficacia}${ps}${extra}`;
    }
    case "hab":
    case "obj":
    case "estado":
      return `${evento.p}: ${evento.n}${ps}${extra}`;
    case "rocas":
      return `Pointed stones dug into ${evento.p}!${ps}`;
    case "tera":
      return `${evento.p} Terastallized into the ${nombreTipo(evento.tipo)} type!`;
    case "ko":
      return `${evento.p} fainted!`;
    case "fin":
      return evento.gana === "yo"
        ? `Battle ended: you win ${marcadorFinal} in ${turnos(total)}`
        : evento.gana === "rival"
          ? `Battle ended: you lose ${marcadorFinal} in ${turnos(total)}`
          : `Battle ended in ${turnos(total)}`;
    default:
      // un tipo de evento que esta pantalla no conoce: se enseña lo que traiga
      return ([evento.p, evento.n, evento.txt].filter(Boolean).join(" · ") || String(evento.t ?? "Event")) + ps;
  }
}

// ---------------------------------------------------------------------------
// El reproductor

function reproductor(raiz, combate, { vigente, cola }) {
  const $ = (selector, desde = raiz) => desde.querySelector(selector);
  const total = combate.turnos.length;
  const trampas = movimientosDeTrampas(combate);
  const textoNivel = nivelDelFormato(combate) ? `Lv. ${nivelDelFormato(combate)}` : "";
  const franja = $(".franja");
  const final = $(".final");
  const registro = $(".registro ol");
  const boton = Object.fromEntries([...raiz.querySelectorAll("[data-control]")].map((el) => [el.dataset.control, el]));
  const luchador = {};
  const fichas = {};
  for (const lado of LADOS) {
    luchador[lado] = $(`.luchador[data-lado="${lado}"]`);
    const elementos = raiz.querySelectorAll(`[data-banco="${lado}"] .plaza`);
    fichas[lado] = new Map(combate[lado].equipo.map((miembro, i) => [miembro.nombre, elementos[i]]));
  }

  const estadoTras = (cuantos) => {
    const estado = estadoInicial(combate);
    for (const turno of combate.turnos.slice(0, cuantos)) for (const evento of turno.eventos) aplicar(evento, estado, trampas);
    return estado;
  };
  const enPie = (estado, lado) => combate[lado].equipo.filter((miembro) => !estado.caidos[lado][miembro.nombre]).length;
  const acabado = estadoTras(total);
  const marcadorFinal = `${enPie(acabado, "yo")} – ${enPie(acabado, "rival")}`;

  let estado = estadoInicial(combate);
  let hechos = 0; // turnos ya reproducidos enteros
  let jugando = 0; // el turno que se está reproduciendo (0 si no hay ninguno a medias)
  let pase = 0; // cambia con cada salto: lo que estuviera reproduciéndose con el anterior se para
  let enMarcha = false;
  let enPausa = false;
  let velocidad = VELOCIDADES.includes(sesion.opciones?.velocidad) ? sesion.opciones.velocidad : 1;
  const verIA = sesion.opciones?.verIA !== false;
  // Si es el combate que se estaba viendo, sigue donde se dejó
  const dejado = recuerdo?.combate === combate ? recuerdo : null;
  const recordar = () => {
    recuerdo = { combate, hechos, enPausa };
  };

  // --- Tiempo -------------------------------------------------------------

  const T = (ms) => (ms * RITMO) / velocidad;
  const vivo = (mio) => mio === pase && vigente();
  const comprobar = (mio) => {
    if (!vivo(mio)) throw CANCELADO;
  };
  /** Una espera que se detiene con la pausa y se corta si se salta de turno o se sale de la pantalla. */
  async function esperar(ms, mio) {
    let pasado = 0;
    while (pasado < T(ms)) {
      await dormir(30);
      comprobar(mio);
      if (!enPausa) pasado += 30;
    }
  }
  async function paso(mio) {
    comprobar(mio);
    while (enPausa) {
      await dormir(60);
      comprobar(mio);
    }
  }

  // --- Dibujo del estado --------------------------------------------------

  const figura = (lado) => $(".figura", luchador[lado]);
  const miembro = (lado, nombre) => combate[lado].equipo.find((m) => m.nombre === nombre) ?? { nombre, tipos: [] };

  function pintarPS(el, ps) {
    $(".barra-ps i", el).style.transform = `scaleX(${ps / 100})`;
    $(".barra-ps", el).dataset.nivel = nivel(ps);
    $(".ps-valor", el).textContent = `${Math.round(ps)}%`;
  }

  function pintarFicha(lado, nombre) {
    const ficha = fichas[lado].get(nombre);
    if (!ficha) return;
    const ps = estado.ps[lado][nombre] ?? 0;
    ficha.classList.toggle("ko", Boolean(estado.caidos[lado][nombre]));
    ficha.classList.toggle("activo", estado.activo[lado] === nombre);
    $(".plaza-barra i", ficha).style.transform = `scaleX(${ps / 100})`;
    $(".plaza-ps", ficha).textContent = `${Math.round(ps)}%`;
  }

  /** Con «conMovimiento», lo que cambia en el campo se anima (entrada, megaevolución); al saltar de turno, no. */
  function render(conMovimiento = false) {
    for (const lado of LADOS) {
      const el = luchador[lado];
      const nombre = estado.activo[lado];
      el.classList.toggle("sin-salir", !nombre);
      if (nombre) {
        const datos = miembro(lado, nombre);
        const mega = Boolean(datos.antes && estado.mega[lado][nombre]);
        const forma = formaDe(datos, mega);
        const caido = Boolean(estado.caidos[lado][nombre]);
        const clave = `${nombre}|${forma.id}`; // al megaevolucionar cambia la imagen aunque sea el mismo Pokémon
        if (el.dataset.p !== clave) {
          const anterior = el.dataset.p;
          el.dataset.p = clave;
          ponerImagen($(".figura", el), forma, lado);
          // El mismo Pokémon con otra forma es una megaevolución; otro, una entrada
          if (conMovimiento) animar($(".figura", el), anterior?.split("|")[0] === nombre ? "anim-transforma" : "anim-entra");
          $(".placa-nombre", el).textContent = forma.nombre;
          $(".placa-nivel", el).textContent = textoNivel;
        }
        const tera = estado.tera[lado][nombre];
        const trampasDelLado = estado.trampas[lado]
          .map(([trampa, capas]) => `<span class="insignia error" title="${escapar(trampa)} on this side">${escapar(trampas.sellos.get(trampa) ?? trampa)}${capas > 1 ? ` ×${capas}` : ""}</span>`)
          .join("");
        const tipos = tera ? `<span class="insignia">Tera</span>${insigniaTipo(tera)}` : `${mega ? `<span class="insignia acento">Mega</span>` : ""}${forma.tipos.map((tipo) => insigniaTipo(tipo)).join("")}`;
        $(".placa-tipos", el).innerHTML = caido ? `<span class="insignia error">Fainted</span>` : tipos + trampasDelLado;
        el.classList.toggle("tera", Boolean(tera));
        el.style.setProperty("--tc", variableTipo(tera ?? forma.tipos[0]));
        pintarPS(el, estado.ps[lado][nombre] ?? 0);
        el.classList.toggle("ko", caido);
        $(".figura", el).setAttribute("aria-label", caido ? `${forma.nombre}, fainted` : forma.nombre);
      } else {
        delete el.dataset.p;
      }
      for (const m of combate[lado].equipo) pintarFicha(lado, m.nombre);
      $(`[data-marcador="${lado}"]`).textContent = enPie(estado, lado);
    }
  }

  function pintarProb(valor) {
    if (typeof valor !== "number") return;
    $(".prob-valor").textContent = `${valor}%`;
  }

  function pintarReloj(n) {
    $(".reloj").textContent = n;
  }

  function pintarIA(lado, turno, n) {
    const jugada = turno?.ia?.[lado];
    franja.hidden = !verIA || !jugada;
    if (franja.hidden) return;
    franja.dataset.lado = lado;
    $(".quien", franja).textContent = lado === "yo" ? "Your AI picks" : "Opponent's AI picks";
    $(".franja-jugada", franja).textContent = jugada.elige ?? "";
    $(".franja-porque", franja).textContent = jugada.porque ?? "";
    $(".por-que", franja).href = `#/simulador/decision/${n}${cola}`;
  }

  // --- Registro del turno -------------------------------------------------

  function abrirRegistro(n) {
    $(".registro-n").textContent = n;
    registro.replaceChildren();
  }

  function apuntar(evento) {
    const linea = document.createElement("li");
    const quien = QUIEN[evento.lado];
    linea.innerHTML = `${quien ? `<span class="insignia${evento.lado === "yo" ? " acento" : ""}">${quien}</span>` : ""}<span class="registro-texto">${escapar(textoDeEvento(evento, marcadorFinal, total))}</span>`;
    registro.append(linea);
  }

  function mostrarFinal() {
    const gana = estado.gana;
    final.dataset.resultado = gana === "yo" ? "victoria" : gana === "rival" ? "derrota" : "fin";
    $("b", final).textContent = gana === "yo" ? `Victory ${marcadorFinal}` : gana === "rival" ? `Defeat ${marcadorFinal}` : "Battle ended";
    $(".final-sub", final).textContent = `In ${turnos(total)}`;
    final.hidden = false;
    pintarBotonDePausa();
  }

  /** Quita lo que estuviera a medias: los rótulos y el cartel del final. */
  function limpiar() {
    for (const suelto of raiz.querySelectorAll(".rotulo")) suelto.remove();
    for (const lado of LADOS) figura(lado).classList.remove(...ANIMACIONES);
    final.hidden = true;
  }

  /** El rótulo de una habilidad o de un objeto que se activa, junto al Pokémon que lo usa. */
  function crearRotulo(evento) {
    const rotulo = document.createElement("div");
    rotulo.className = "rotulo";
    rotulo.innerHTML = `<small>${evento.mega ? "Mega Evolution" : ROTULO[evento.t]}</small><b>${escapar(evento.n)}</b>`;
    $(".rotulos", luchador[evento.lado]).append(rotulo);
    return rotulo;
  }

  // --- Los eventos --------------------------------------------------------

  /** Lo que se ve en el Pokémon al que le pasa el evento: sacudida si pierde PS, caída si se debilita, destello si teracristaliza. */
  function reaccionar(e) {
    if (Array.isArray(e.da)) {
      const [lado, nombre, antes, despues] = e.da;
      if (despues < antes && despues > 0 && estado.activo[lado] === nombre) animar(figura(lado), "anim-golpe");
    }
    if (e.t === "ko" && luchador[e.lado]) animar(figura(e.lado), "anim-cae");
    if (e.t === "tera" && luchador[e.lado]) animar(figura(e.lado), "anim-transforma");
  }

  async function evento(e, turno, n, mio, vistos) {
    await paso(mio);
    apuntar(e);

    // La primera vez que actúa cada lado en el turno se enseña qué ha elegido su IA
    if (verIA && luchador[e.lado] && ["mov", "cambio", "tera"].includes(e.t) && !vistos[e.lado] && turno.ia?.[e.lado]) {
      vistos[e.lado] = true;
      pintarIA(e.lado, turno, n);
      await esperar(1200, mio);
    }

    // El atacante avanza y, al llegar, el campo cambia: así el golpe se ve antes de que baje la barra
    if (e.t === "mov" && estado.activo[e.lado]) {
      animar(figura(e.lado), /^(Estado|Status)$/.test(e.clase) ? "anim-prepara" : "anim-ataca");
      await esperar(AVANCE, mio);
    }
    aplicar(e, estado, trampas);
    render(true);
    if (e.t === "fin") {
      mostrarFinal();
      return;
    }
    reaccionar(e);
    const rotulo = ROTULO[e.t] && luchador[e.lado] ? crearRotulo(e) : null;
    await esperar(PAUSA[e.t] ?? PAUSA.otro, mio);
    rotulo?.remove();
  }

  // --- Reproducción -------------------------------------------------------

  async function reproducir(mio) {
    enMarcha = true;
    pintarBotonDePausa();
    try {
      for (let n = hechos + 1; n <= total; n++) {
        const turno = combate.turnos[n - 1];
        jugando = n;
        pintarReloj(n);
        abrirRegistro(n);
        await esperar(300, mio);
        const vistos = {};
        for (const e of turno.eventos ?? []) {
          try {
            await evento(e, turno, n, mio, vistos);
          } catch (error) {
            if (error === CANCELADO) throw error;
            // un evento que no se ha podido pintar no para el combate: se aplica y se sigue
            console.error(error);
            aplicar(e, estado, trampas);
            render();
          }
        }
        hechos = n;
        jugando = 0;
        recordar();
        pintarProb(combate.prob?.[n]);
        await esperar(700, mio);
      }
    } catch (error) {
      if (error !== CANCELADO) throw error;
    }
    if (mio === pase) {
      enMarcha = false;
      pintarBotonDePausa();
    }
  }

  /**
   * Salta al final del turno n (0: antes de empezar) y, si no está en pausa, sigue desde ahí.
   * Lo que se ve es el estado que deja ese turno: sus PS, su marcador, su probabilidad y su registro.
   */
  function ir(n) {
    pase++;
    hechos = Math.min(total, Math.max(0, n));
    jugando = 0;
    enMarcha = false;
    limpiar();
    estado = estadoTras(hechos);
    render();
    const visto = Math.max(1, hechos);
    const turno = combate.turnos[visto - 1];
    pintarReloj(visto);
    pintarProb(combate.prob?.[hechos]);
    abrirRegistro(visto);
    if (hechos > 0) (turno.eventos ?? []).forEach(apuntar);
    else registro.innerHTML = `<li class="registro-vacio">The battle hasn't started yet.</li>`;
    pintarIA("yo", turno, visto);

    const ultimo = hechos > 0 ? turno.eventos?.at(-1) : null;
    if (ultimo?.t === "fin") mostrarFinal();
    // parado en un turno que acaba con una habilidad o un objeto, su rótulo se queda puesto
    else if (ultimo && ROTULO[ultimo.t] && luchador[ultimo.lado]) crearRotulo(ultimo);
    pintarBotonDePausa();
    recordar();
    if (hechos < total && !enPausa) reproducir(pase);
  }

  // --- Controles ----------------------------------------------------------

  const terminado = () => !enMarcha && hechos >= total;

  /**
   * Los botones según el momento: con el combate acabado, «Siguiente» lleva al análisis y «Pausa» lo repite;
   * al principio no hay «Anterior» y al final no hay «Final». Así nunca queda un botón que no hace nada.
   */
  function pintarBotonDePausa() {
    const [nombreIcono, texto] = terminado() ? ["reproducir", "Replay"] : enPausa ? ["reproducir", "Resume"] : ["pausa", "Pause"];
    boton.pausa.innerHTML = `${icono(nombreIcono)}<span>${texto}</span>`;
    boton.pausa.setAttribute("aria-label", terminado() ? "Replay battle from the start" : enPausa ? "Resume" : "Pause");
    const alAnalisis = terminado();
    boton.siguiente.innerHTML = alAnalisis ? `${icono("flecha-derecha")}<span>Analysis</span>` : `${icono("siguiente")}<span>Next</span>`;
    boton.siguiente.setAttribute("aria-label", alAnalisis ? "See analysis" : "Next turn");
    boton.anterior.disabled = hechos <= 0 && !jugando;
    boton.final.disabled = hechos >= total;
  }

  boton.pausa.addEventListener("click", () => {
    if (terminado()) {
      // con el combate acabado, el botón lo repite desde el principio
      enPausa = false;
      ir(0);
    } else if (enPausa && !enMarcha) {
      // estaba parado en un turno: sigue con el siguiente
      enPausa = false;
      ir(hechos);
    } else {
      enPausa = !enPausa;
      pintarBotonDePausa();
      recordar();
    }
  });

  // «Anterior» y «Siguiente» van turno a turno: dejan el combate en pausa en el turno al que llevan (si no,
  // al volver atrás se seguiría reproduciendo hasta el final y parecería que no ha pasado nada).
  // En pausa y a mitad de un turno, «anterior» deshace lo que iba de turno; si no, vuelve un turno entero.
  boton.anterior.addEventListener("click", () => {
    const destino = enPausa && jugando ? hechos : hechos - 1;
    enPausa = true;
    ir(destino);
  });
  boton.siguiente.addEventListener("click", () => {
    if (terminado()) {
      location.hash = `#/simulador/resultado${cola}`;
      return;
    }
    enPausa = true;
    ir(hechos + 1);
  });
  boton.final.addEventListener("click", () => {
    enPausa = false;
    ir(total);
  });

  const pintarVelocidad = () => {
    $("b", boton.velocidad).textContent = `x${velocidad}`;
    raiz.style.setProperty("--ritmo", String(RITMO / velocidad)); // las animaciones de CSS duran lo mismo que las esperas
  };
  pintarVelocidad();
  boton.velocidad.addEventListener("click", () => {
    velocidad = VELOCIDADES[(VELOCIDADES.indexOf(velocidad) + 1) % VELOCIDADES.length];
    pintarVelocidad();
    elegir({ opciones: { velocidad } });
  });

  if (dejado) enPausa = dejado.enPausa;
  ir(dejado?.hechos ?? 0);
}
