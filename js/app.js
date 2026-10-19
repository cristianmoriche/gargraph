// Gargraph · versión 2 de la Pokémon App: una app web para el móvil que se instala como app (PWA).
// Este fichero arranca la app y decide qué pantalla se ve según la dirección (#/inicio, #/dex/dragapult…).
import { cargarMeta, cargarFormato, formatoActual, resumenFormato, dic, infoMeta, FORMATO_POR_DEFECTO } from "./meta.js";
import { usarTablaDeTipos } from "./tipos.js";
import { leer, guardar } from "./estado.js";
import { aviso, avisar, escapar, aplicarTema } from "./ui.js";
import { entrarPantalla } from "./movimiento.js";
import * as inicio from "./vistas/inicio.js";
import * as dex from "./vistas/dex.js";
import * as tierlist from "./vistas/tierlist.js";
import * as equipos from "./vistas/equipos.js";
import * as matches from "./vistas/matches.js";
import * as perfil from "./vistas/perfil.js";
import * as simulador from "./vistas/simulador.js";
import * as velocidades from "./vistas/velocidades.js";
import * as calc from "./vistas/calc.js";
import * as quiz from "./vistas/quiz.js";
import * as torneos from "./vistas/torneos.js";
import * as equiposTop from "./vistas/equipos-top.js";
import * as usoEquipos from "./vistas/uso-equipos.js";

const PANTALLAS = { inicio, dex, tierlist, equipos, matches, perfil, simulador, velocidades, calc, quiz, torneos, "equipos-top": equiposTop, "uso-equipos": usoEquipos };
// Pestaña de la barra inferior que se ilumina en cada pantalla
const PESTANA = { inicio: "inicio", tierlist: "inicio", dex: "dex", equipos: "equipos", matches: "matches", perfil: "perfil", simulador: "equipos", velocidades: "dex", calc: "dex", quiz: "dex", torneos: "inicio", "equipos-top": "inicio", "uso-equipos": "inicio" };

// El tema elegido en Perfil, lo primero de todo: así la primera pantalla ya sale con sus colores
aplicarTema(leer().perfil.tema);

const vista = document.querySelector("#vista");
let turno = 0; // para descartar pantallas que terminan de cargar cuando ya se ha ido a otra

// Historial (History API). Cada entrada guarda en history.state:
//   profundidad: pasos desde la primera pantalla abierta. La flecha de volver solo usa «atrás» si hay
//                una pantalla de la app detrás (así no se sale de la app).
//   ficha:       true si es una ficha de la Dex (#/dex/<pokemon>).
//   origen:      en las fichas, la profundidad de la pantalla desde la que se entró a la Dex (Inicio,
//                Clasificación, un equipo…): la flecha de volver va ahí de un salto, no ficha por ficha.
let actual = { profundidad: 0, ficha: false, origen: null };
let cima = 0;           // profundidad de la última entrada del historial (por encima no hay nada)
let largo = 0;          // history.length la última vez que se apuntó una entrada
let reemplazo = false;  // la última navegación ha sido un location.replace (Navigation API, si la hay)
let formatoBueno = null; // último formato que sí se cargó entero: al que se ofrece volver si el actual falla
let ultimaPantalla = ""; // sección y parámetros de la última pantalla pintada: repintar la misma no lleva transición

arrancar();

async function arrancar() {
  // Los enlaces de la primera versión (?p=887) siguen funcionando
  const antiguo = new URLSearchParams(location.search).get("p");
  if (antiguo) history.replaceState(history.state, "", `${location.pathname}#/dex/${encodeURIComponent(antiguo)}`);

  try {
    await cargarMeta();
  } catch (error) {
    console.error(error);
    vista.innerHTML = aviso("Could not load app data.", "Check your connection and open it again.");
    return;
  }
  usarTablaDeTipos(dic().tabla);
  conectarEventosGlobales();
  apuntarEntrada(null);
  // Navigation API: dice si una navegación es un location.replace. Sin ella, se deduce en apuntarEntrada
  window.navigation?.addEventListener("navigate", (evento) => {
    reemplazo = evento.navigationType === "replace";
  });
  window.addEventListener("hashchange", () => {
    apuntarEntrada(actual);
    enrutar();
  });
  await enrutar();
  registrarServiceWorker();
}

function esFicha() {
  const { seccion, parametros } = leerRuta();
  return seccion === "dex" && parametros.length > 0;
}

/**
 * Apunta en history.state lo que hace falta para volver. «anterior» es la entrada de la que se viene
 * (null al arrancar). Si la entrada ya tenía sus datos (se ha vuelto atrás o adelante, o se ha recargado), se leen.
 */
function apuntarEntrada(anterior) {
  const guardado = history.state;
  if (typeof guardado?.profundidad === "number") {
    actual = { profundidad: guardado.profundidad, ficha: Boolean(guardado.ficha), origen: guardado.origen ?? null };
    cima = Math.max(cima, actual.profundidad);
    largo = history.length;
    return;
  }
  const ficha = esFicha();
  if (!anterior) {
    actual = { profundidad: 0, ficha, origen: null };
  } else if (esReemplazo(anterior)) {
    // location.replace: la entrada es la misma, no se suma ningún paso (N1)
    actual = { profundidad: anterior.profundidad, ficha, origen: ficha ? anterior.origen : null };
  } else {
    const profundidad = anterior.profundidad + 1;
    const origen = ficha ? (anterior.ficha ? anterior.origen : anterior.profundidad) : null;
    actual = { profundidad, ficha, origen };
    cima = profundidad; // al ir a una pantalla nueva se pierde lo que hubiera «hacia delante»
  }
  reemplazo = false;
  largo = history.length;
  history.replaceState({ ...actual }, "");
}

// Sin Navigation API: si el historial no ha crecido y se estaba en la última entrada, ha sido un reemplazo
function esReemplazo(anterior) {
  if (window.navigation) return reemplazo;
  return history.length === largo && anterior.profundidad >= cima;
}

/** «#/dex/golisopod?forma=Golisopod-Mega» → { seccion: "dex", parametros: ["golisopod"], consulta, existe } */
function leerRuta() {
  const [ruta, consulta = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const [seccion = "inicio", ...parametros] = ruta.split("/").filter(Boolean).map((parte) => {
    try {
      return decodeURIComponent(parte);
    } catch {
      return parte;
    }
  });
  return { seccion, parametros, consulta: new URLSearchParams(consulta), existe: Boolean(PANTALLAS[seccion]) };
}

async function enrutar() {
  const miTurno = ++turno;
  const { seccion, parametros, consulta, existe } = leerRuta();
  if (!existe) {
    // Una dirección que no existe lleva a Inicio sin dejar rastro en el historial (N2)
    location.replace("#/inicio");
    return;
  }
  for (const enlace of document.querySelectorAll(".barra-inferior a")) {
    if (enlace.dataset.seccion === PESTANA[seccion]) enlace.setAttribute("aria-current", "page");
    else enlace.removeAttribute("aria-current");
  }
  window.scrollTo(0, 0);
  // Transición de entrada solo al cambiar de pantalla (no al repintar por un cambio de formato) y no en el simulador
  const pantalla = [seccion, ...parametros].join("/");
  entrarPantalla(vista, { animar: pantalla !== ultimaPantalla && seccion !== "simulador" });
  ultimaPantalla = pantalla;
  try {
    const formatoDeEstaPantalla = formatoActual();
    await PANTALLAS[seccion].pintar(vista, {
      id: parametros[0],
      clave: parametros[0]?.toLowerCase(),
      forma: consulta.get("forma"),
      parametros, // la lista entera: en «#/simulador/decision/8» es ["decision", "8"]
      consulta,
      vigente: () => miTurno === turno,
    });
    if (miTurno === turno && await cargaBien(formatoDeEstaPantalla)) formatoBueno = formatoDeEstaPantalla;
  } catch (error) {
    if (miTurno !== turno) return;
    console.error(error);
    if (!(await cargaBien(formatoActual()))) {
      if (miTurno === turno) pintarFormatoSinDatos();
      return;
    }
    vista.innerHTML = aviso("Something went wrong while opening this screen.", escapar(error.message));
  }
}

/** true si los datos del formato se pueden cargar (de la red o de la caché del móvil). */
function cargaBien(id) {
  return cargarFormato(id).then(() => true, () => false);
}

/** El formato elegido no carga (sin conexión y nunca abierto): se explica y se ofrece otro que sí. */
function pintarFormatoSinDatos() {
  const nombre = (id) => resumenFormato(id)?.nombre ?? id;
  const ofertas = [];
  if (formatoBueno && formatoBueno !== formatoActual() && resumenFormato(formatoBueno)) ofertas.push({ id: formatoBueno, texto: `Back to ${nombre(formatoBueno)}` });
  if (FORMATO_POR_DEFECTO !== formatoActual() && !ofertas.some((o) => o.id === FORMATO_POR_DEFECTO) && resumenFormato(FORMATO_POR_DEFECTO)) {
    ofertas.push({ id: FORMATO_POR_DEFECTO, texto: `Use ${nombre(FORMATO_POR_DEFECTO)}` });
  }
  const botones = ofertas.map((o) => `<button type="button" class="boton secundario bloque" data-formato="${escapar(o.id)}">${escapar(o.texto)}</button>`).join("");
  vista.innerHTML = `<div class="formato-sin-datos">${aviso(`Could not load the data for ${nombre(formatoActual())}.`, "It has not been opened before and there is no connection. Try again or switch to another format.")}<button type="button" class="boton bloque" data-reintentar>Try again</button>${botones}</div>`;
  vista.querySelector("[data-reintentar]").addEventListener("click", () => enrutar());
}

// N1: el formato solo se guarda si sus datos cargan; si no (sin conexión y nunca abierto), se queda el anterior
async function cambiarFormato(formato) {
  if (formato.id !== formatoActual() && !(await cargaBien(formato.id))) {
    avisar(`Could not load ${formato.nombre}. Check your connection; the previous format stays.`);
    return;
  }
  guardar((e) => { e.perfil.formato = formato.id; });
  avisar(`Format: ${formato.nombre}`);
  enrutar();
}

function conectarEventosGlobales() {
  document.addEventListener("click", (evento) => {
    // El botón del selector de formato abre su hoja con todos los formatos
    const abrirFormatos = evento.target.closest("[data-abrir-formatos]");
    if (abrirFormatos) {
      abrirFormatos.parentElement.querySelector("dialog")?.showModal();
      return;
    }
    // Formatos de la hoja (o botones sueltos con data-formato): se guarda la elección y se repinta la pantalla
    const botonFormato = evento.target.closest("[data-formato]");
    if (botonFormato) {
      botonFormato.closest("dialog")?.close();
      const formato = infoMeta().formatos.find((f) => f.id === botonFormato.dataset.formato);
      if (!formato) return;
      cambiarFormato(formato);
      return;
    }
    // Flecha de volver: en una ficha de la Dex, a la pantalla desde la que se entró a la Dex (N6);
    // en el resto, atrás en el historial si se llegó desde otra pantalla de la app. Si no, sigue su enlace.
    const volver = evento.target.closest("[data-volver]");
    if (volver) {
      if (actual.ficha && typeof actual.origen === "number" && actual.origen < actual.profundidad) {
        evento.preventDefault();
        history.go(actual.origen - actual.profundidad);
      } else if (!actual.ficha && actual.profundidad > 0) {
        evento.preventDefault();
        history.back();
      }
      return;
    }
    // Hoja inferior (<dialog class="hoja">): se cierra al tocar fuera o un botón con data-cerrar
    const hoja = evento.target.closest("dialog.hoja");
    if (hoja && (evento.target === hoja || evento.target.closest("[data-cerrar]"))) hoja.close();
  });
}

// ---------------------------------------------------------------------------
// Service worker: guarda la app en el móvil y avisa cuando hay una versión nueva

function registrarServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const habiaVersionAnterior = Boolean(navigator.serviceWorker.controller);
  let recargando = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!habiaVersionAnterior || recargando) return;
    recargando = true;
    location.reload();
  });

  navigator.serviceWorker.register("sw.js").then((registro) => {
    const avisarSiHayNueva = () => {
      if (registro.waiting && navigator.serviceWorker.controller) mostrarActualizacion(registro.waiting);
    };
    avisarSiHayNueva();
    registro.addEventListener("updatefound", () => {
      registro.installing?.addEventListener("statechange", avisarSiHayNueva);
    });
    // Las apps de la pantalla de inicio pueden pasar días abiertas: se comprueba al volver a ellas
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") registro.update().catch(() => {});
    });
  }).catch((error) => console.warn("Could not register the service worker", error));
}

function mostrarActualizacion(trabajador) {
  const barra = document.querySelector("#actualizacion");
  barra.hidden = false;
  barra.querySelector("button").onclick = () => {
    barra.querySelector("button").disabled = true;
    trabajador.postMessage("actualizar");
  };
}
