// Piezas de interfaz que comparten todas las pantallas. El HTML que devuelven y sus clases están
// explicados, con ejemplos, en disenos/gemini/implementacion/COMPONENTES.md.
import { nombreTipo, ETIQUETAS } from "./tipos.js";
import { especie, infoMeta, formatoActual, esDeTorneos, infoFuente } from "./meta.js";

const URL_SPRITES = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/";

// ---------------------------------------------------------------------------
// Iconos de línea: 20 × 20 px, dibujados en una cuadrícula de 24 (trazo de 1,8 en 24 = 1,5 px a 20 px)

const TRAZOS = {
  inicio: `<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v10.5a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9"/>`,
  equipos: `<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M15.5 4.7a3.5 3.5 0 0 1 0 6.6"/><path d="M18 14.3a6.5 6.5 0 0 1 3.5 5.7"/>`,
  dex: `<path d="M12 6.5C10.3 5 7.8 4.2 3.5 4.2v13.6c4.3 0 6.8.8 8.5 2.3 1.7-1.5 4.2-2.3 8.5-2.3V4.2c-4.3 0-6.8.8-8.5 2.3z"/><path d="M12 6.5v13.6"/>`,
  matches: `<path d="M14.5 17.5 3.5 6.5v-3h3l11 11"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/><path d="M9.5 6.5 6.5 3.5"/><path d="M14.5 6.5l3-3h3v3l-3 3"/><path d="m11 13-5 5"/><path d="m5 14 4 4"/><path d="m3.5 19.5 2 2"/>`,
  perfil: `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.4 18.3a6.5 6.5 0 0 1 11.2 0"/>`,
  buscar: `<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>`,
  azar: `<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/>`,
  volver: `<path d="M19.5 12h-15"/><path d="m10.5 6-6 6 6 6"/>`,
  cerrar: `<path d="m6 6 12 12"/><path d="M18 6 6 18"/>`,
  "añadir": `<path d="M12 5v14"/><path d="M5 12h14"/>`,
  borrar: `<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="m6 7 1 12.5a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7"/><path d="M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7"/>`,
  exportar: `<path d="M12 15V3.5"/><path d="m7.5 8 4.5-4.5L16.5 8"/><path d="M4.5 13v6a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-6"/>`,
  importar: `<path d="M12 3.5V15"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4.5 15v4a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-4"/>`,
  compartir: `<path d="M4.5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-6.5"/><path d="M8.5 14c0-4.4 3-7.5 8-7.5"/><path d="m13.5 3.5 3 3-3 3"/>`,
  externo: `<path d="M14 4h6v6"/><path d="m20 4-9 9"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>`,
  copiar: `<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5"/>`,
  estrella: `<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>`,
  "estrella-llena": `<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor"/>`,
  sonido: `<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>`,
  "flecha-derecha": `<path d="m9 5.5 6.5 6.5L9 18.5"/>`,
  "flecha-abajo": `<path d="M5.5 9 12 15.5 18.5 9"/>`,
  editar: `<path d="M4 20h4L18.8 9.2a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="m13.5 7.5 3 3"/>`,
  pausa: `<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>`,
  reproducir: `<path d="M7.5 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L8.7 4.5a.8.8 0 0 0-1.2.7z"/>`,
  anterior: `<path d="M18 5.5v13L8.5 12z"/><path d="M6 5.5v13"/>`,
  siguiente: `<path d="M6 5.5v13l9.5-6.5z"/><path d="M18 5.5v13"/>`,
  fin: `<path d="m4.5 6 6 6-6 6"/><path d="m11.5 6 6 6-6 6"/><path d="M20 5.5v13"/>`,
  ajustes: `<path d="M4 7h9"/><path d="M17 7h3"/><circle cx="15" cy="7" r="2"/><path d="M4 17h3"/><path d="M11 17h9"/><circle cx="9" cy="17" r="2"/>`,
  alerta: `<path d="M10.3 4.2 2.8 17.5a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4"/><path d="M12 17h.01"/>`,
  info: `<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.5h.01"/>`,
  hecho: `<path d="m5 12.5 4.5 4.5L19 7.5"/>`,
};

/** Nombres de los iconos que existen, para comprobarlo: ICONOS_DISPONIBLES.includes("azar"). */
export const ICONOS_DISPONIBLES = Object.keys(TRAZOS);

/** <svg> de línea de 20 × 20 px en currentColor, oculto a los lectores de pantalla. Un nombre que no existe da "". */
export function icono(nombre) {
  const trazos = TRAZOS[nombre];
  if (!trazos) return "";
  return `<svg class="icono" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${trazos}</svg>`;
}

// ---------------------------------------------------------------------------
// Textos y números

/** Evita que un texto que llega de fuera se interprete como HTML. */
export function escapar(texto) {
  return String(texto ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function decimal(numero, decimales = 1) {
  return numero.toLocaleString("en-US", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}

export function porcentaje(numero) {
  return `${numero.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

export function numeroPokedex(numero) {
  return `#${String(numero).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Tipos

// Nombre de la variable de color de cada tipo (ESTILO.md): fire → --tipo-fuego
const VARIABLE_TIPO = {
  normal: "normal", fire: "fuego", water: "agua", grass: "planta", electric: "electrico", ice: "hielo",
  fighting: "lucha", poison: "veneno", ground: "tierra", flying: "volador", psychic: "psiquico", bug: "bicho",
  rock: "roca", ghost: "fantasma", dragon: "dragon", dark: "siniestro", steel: "acero", fairy: "hada",
};

/** Color de un tipo para el CSS: variableTipo("fire") → "var(--tipo-fuego)". Un tipo desconocido, gris. */
export function variableTipo(tipo) {
  return VARIABLE_TIPO[tipo] ? `var(--tipo-${VARIABLE_TIPO[tipo]})` : "var(--texto-suave)";
}

/** Insignia de un tipo: texto blanco sobre su color. Con multiplicador, lo añade («Fire 2×»). */
export function insigniaTipo(tipo, multiplicador) {
  const etiqueta = multiplicador === undefined ? "" : ` <small>${ETIQUETAS[multiplicador]}</small>`;
  const clase = multiplicador === 4 ? " x4" : multiplicador === 0 ? " x0" : "";
  return `<span class="tipo${clase}" style="--color-tipo: ${variableTipo(tipo)}">${escapar(nombreTipo(tipo))}${etiqueta}</span>`;
}

/** Las insignias de varios tipos seguidas (sin contenedor: ponlo tú, p. ej. <span class="tipos">). */
export function listaTipos(tipos) {
  if (!tipos?.length) return `<span class="nada">None</span>`;
  return tipos.map((tipo) => insigniaTipo(tipo)).join("");
}

// ---------------------------------------------------------------------------
// Imágenes

export function urlSprite(id) {
  return id ? `${URL_SPRITES}${id}.png` : null;
}

export function urlIlustracion(id) {
  return id ? `${URL_SPRITES}other/official-artwork/${id}.png` : null;
}

/** El sprite animado de los combates (un GIF), de frente o de espaldas. No todas las especies lo tienen. */
export function urlSpriteAnimado(id, deEspaldas = false) {
  return id ? `${URL_SPRITES}other/showdown/${deEspaldas ? "back/" : ""}${id}.gif` : null;
}

/**
 * Miniatura de una especie de Showdown (o de un id de PokeAPI). Si no hay imagen, sus iniciales.
 * Tamaños con «clase»: (nada) 32 px, "mediano" 40, "grande" 56, "enorme" 96; "con-fondo" le pone recuadro.
 */
export function sprite(nombre, { id, clase = "" } = {}) {
  const idImagen = id ?? especie(nombre)?.id;
  const iniciales = escapar(String(nombre ?? "").replace(/[^A-Za-zÀ-ÿ ]/g, " ").split(/\s+/).filter(Boolean).map((p) => p[0]).join("").slice(0, 2).toUpperCase());
  const clases = `sprite${clase ? ` ${escapar(clase)}` : ""}`;
  if (!idImagen) return `<span class="${clases} sin" data-iniciales="${iniciales}" aria-hidden="true"></span>`;
  // API web: imágenes de la PokeAPI, alojadas en GitHub (admiten CORS, así el service worker puede guardarlas)
  return `<span class="${clases}"><img src="${urlSprite(idImagen)}" alt="" loading="lazy" decoding="async" crossorigin="anonymous" width="96" height="96" onerror="this.parentElement.classList.add('sin'); this.parentElement.dataset.iniciales='${iniciales}'; this.remove()"></span>`;
}

export function enlaceExterno(url, texto, clase = "") {
  return `<a class="${clase}" href="${escapar(url)}" target="_blank" rel="noopener noreferrer">${texto}</a>`;
}

// ---------------------------------------------------------------------------
// Fechas

export function fechaCorta(milisegundos) {
  return new Date(milisegundos).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function haceCuanto(milisegundos) {
  const minutos = Math.round((Date.now() - milisegundos) / 60_000);
  if (minutos < 1) return "just now";
  if (minutos < 60) return `${minutos}m ago`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `${horas}h ago`;
  const dias = Math.round(horas / 24);
  if (dias < 30) return `${dias} ${dias === 1 ? "day" : "days"} ago`;
  return fechaCorta(milisegundos);
}

/** «2026-09» → «September 2026» (o «Sep 2026» con estilo "short"). */
export function nombreMes(mes, estilo = "long") {
  const [anio, numero] = mes.split("-").map(Number);
  return new Date(anio, numero - 1, 1).toLocaleDateString("en-US", { month: estilo, year: "numeric" });
}

// ---------------------------------------------------------------------------
// Bloques de pantalla

export function cargando(texto = "Loading…") {
  return `<div class="cargando" role="status"><span class="cargando-giro" aria-hidden="true"></span><p>${escapar(texto)}</p></div>`;
}

/** Aviso de error. «detalle» es HTML: escápalo si viene de fuera. */
export function aviso(mensaje, detalle = "") {
  return `<div class="aviso" role="alert">${icono("alerta")}<div class="aviso-texto"><p class="aviso-titulo">${escapar(mensaje)}</p>${detalle ? `<p class="aviso-detalle">${detalle}</p>` : ""}</div></div>`;
}

/** «No hay nada». «texto» y «accion» son HTML (la acción suele ser un botón o un enlace). */
export function vacio(titulo, texto, accion = "") {
  return `<div class="vacio"><p class="vacio-titulo">${escapar(titulo)}</p><p class="vacio-texto">${texto}</p>${accion ? `<div class="vacio-accion">${accion}</div>` : ""}</div>`;
}

/** Título de un bloque, con algo opcional a la derecha («Ver todo»…). El tercer parámetro ya no se usa. */
export function tituloSeccion(titulo, extra = "", _color = "") {
  return `<header class="seccion-cabecera"><h2 class="seccion-titulo">${titulo}</h2>${extra}</header>`;
}

/** Cabecera de las pantallas con flecha para volver, título, subtítulo y botones a la derecha. */
export function cabeceraDetalle({ titulo, subtitulo = "", volver = "#/inicio", acciones = "" }) {
  return `
    <header class="cabecera">
      <a class="boton-icono" href="${volver}" data-volver aria-label="Back">${icono("volver")}</a>
      <div class="cabecera-texto">
        <h1 class="cabecera-titulo">${titulo}</h1>
        ${subtitulo ? `<p class="cabecera-sub">${subtitulo}</p>` : ""}
      </div>
      ${acciones ? `<div class="cabecera-acciones">${acciones}</div>` : ""}
    </header>`;
}

// Grupos de la hoja de formatos, en este orden; un grupo que no esté aquí va detrás
const GRUPOS_FORMATO = ["Pokémon Champions", "Scarlet & Violet"];
const NOMBRE_GRUPO = { "Pokémon Champions": "Pokémon Champions", "Scarlet & Violet": "Scarlet & Violet" };

/** Fuente y fecha de un formato en una línea: «Smogon · Sep 2026» o «Limitless · 266 tournaments». «f»: resumen de meta.json. */
export function lineaFuente(f) {
  const info = infoFuente(f);
  if (info.torneos) return `Limitless · ${info.nTorneos != null ? `${info.nTorneos.toLocaleString("en-US")} tournaments` : "tournaments"}`;
  return `Smogon${info.mes ? ` · ${nombreMes(info.mes, "short")}` : ""}`;
}

/** Una fila de la hoja de formatos: nombre, fuente y fecha, y una marca en el elegido. */
function opcionDeFormato(f, actual, atributo = "data-formato") {
  const elegido = f.id === actual;
  return `
    <li><button type="button" class="fila formato-opcion" ${atributo}="${escapar(f.id)}" aria-pressed="${elegido}">
      <span class="fila-texto">
        <span class="fila-titulo">${escapar(f.nombre)}</span>
        <span class="fila-sub">${escapar(lineaFuente(f))}</span>
      </span>
      ${f.cerrado ? `<span class="insignia">Closed</span>` : ""}
      <span class="formato-marca">${elegido ? icono("hecho") : ""}</span>
    </button></li>`;
}

/**
 * Selector de formato: un botón compacto con el formato elegido que abre una hoja inferior con todos, agrupados como en
 * Pikalytics (Pokémon Champions, Scarlet & Violet; dentro, Showdown, torneos y cerrados). Abrir la hoja lo atiende app.js
 * (data-abrir-formatos) y elegir uno, también (data-formato: guarda y repinta).
 */
export function selectorDeFormatos({ actual = formatoActual(), atributo = "data-formato" } = {}) {
  const formatos = infoMeta().formatos;
  const elegido = formatos.find((f) => f.id === actual);
  const nombresDeGrupo = [...new Set(formatos.map((f) => f.grupo ?? f.juego ?? "Other"))]
    .sort((a, b) => (GRUPOS_FORMATO.indexOf(a) + 1 || 99) - (GRUPOS_FORMATO.indexOf(b) + 1 || 99));
  const secciones = (grupo) => {
    const delGrupo = formatos.filter((f) => (f.grupo ?? f.juego ?? "Other") === grupo);
    return [
      ["Showdown", delGrupo.filter((f) => !f.cerrado && !esDeTorneos(f))],
      ["Tournaments", delGrupo.filter((f) => !f.cerrado && esDeTorneos(f))],
      ["Closed", delGrupo.filter((f) => f.cerrado)],
    ].filter(([, lista]) => lista.length);
  };
  return `
    <div class="selector-formato">
      <button type="button" class="selector-formato-boton" data-abrir-formatos aria-haspopup="dialog">
        <span class="selector-formato-texto">
          <span class="selector-formato-etiqueta">Format</span>
          <span class="selector-formato-nombre">${escapar(elegido?.nombre ?? "")}</span>
        </span>
        ${icono("flecha-abajo")}
      </button>
      <dialog class="hoja hoja-formatos" aria-label="Choose a format">
        <header class="hoja-cabecera">
          <h2 class="hoja-titulo">Format</h2>
          <button type="button" class="boton-icono" data-cerrar aria-label="Close">${icono("cerrar")}</button>
        </header>
        ${nombresDeGrupo.map((grupo) => `
          <section class="formatos-grupo">
            <h3 class="formatos-grupo-titulo">${escapar(NOMBRE_GRUPO[grupo] ?? grupo)}</h3>
            ${secciones(grupo).map(([titulo, lista]) => `
              <p class="formatos-subtitulo">${titulo}</p>
              <ul class="tarjeta sin-relleno lista">${lista.map((f) => opcionDeFormato(f, actual, atributo)).join("")}</ul>`).join("")}
          </section>`).join("")}
      </dialog>
    </div>`;
}

/**
 * Aviso de que el uso de un formato de torneos sale de equipos de torneo y no tiene repartos. «cuando» dice qué hace la pantalla
 * sin ellos (por ejemplo «Speeds use the most used spread from Smogon»). HTML de una nota; "" si el formato no es de torneos.
 */
export function notaDeTorneos(formato, cuando = "") {
  const info = infoFuente(formato);
  if (!info.torneos) return "";
  const cuantos = info.nTorneos != null ? `${info.nTorneos.toLocaleString("en-US")} Limitless tournaments` : "Limitless tournaments";
  return `<p class="nota nota-torneos">Usage is the share of tournament teams that carry each Pokémon, from ${cuantos}. Tournament data has no EV spreads. ${escapar(cuando)}</p>`;
}

/**
 * Selector «This month (Smogon)» / «Last 7 days (Showdown replays)» de Inicio y Clasificación. Los botones llevan
 * data-periodo ("mes" o "semana"); conectarPeriodo() los atiende. Solo se pinta si el formato tiene datos de los últimos 7 días:
 * hay que comprobarlo antes (cargarRecientes() devuelve null si no).
 */
export function selectorDePeriodo(periodo) {
  const boton = (id, texto) => `<button type="button" class="segmento" data-periodo="${id}" aria-pressed="${periodo === id}">${texto}</button>`;
  return `
    <div class="segmentado periodos" role="group" aria-label="Period">
      ${boton("mes", "This month (Smogon)")}${boton("semana", "Last 7 days (Showdown replays)")}
    </div>`;
}

/** Atiende los botones de selectorDePeriodo(): guarda el periodo y llama a «repintar». */
export function conectarPeriodo(vista, fijar, repintar) {
  vista.querySelectorAll("[data-periodo]").forEach((boton) => boton.addEventListener("click", () => {
    if (boton.getAttribute("aria-pressed") === "true") return;
    fijar(boton.dataset.periodo);
    repintar();
  }));
}

/** «Updated Oct 16, 2026». «fecha»: "2026-10-16" o una fecha ISO completa. */
export function lineaActualizado(fecha) {
  const ms = Date.parse(fecha.length === 10 ? `${fecha}T12:00:00` : fecha);
  return `<p class="nota actualizado">Updated ${escapar(fechaCorta(ms))}</p>`;
}

/** «Oct 11 to Oct 18» con las fechas ISO de la primera y la última repetición de datos/recientes. */
export function rangoDeFechas(desde, hasta) {
  const dia = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${dia(desde)} to ${dia(hasta)}`;
}

/** Barra de estadística de 6 px en --acento. «fraccion», de 0 a 1. Se llena al llamar a activar() de movimiento.js. */
export function barra(fraccion) {
  const valor = Math.min(1, Math.max(0, Number(fraccion) || 0));
  const texto = String(Math.round(valor * 1000) / 1000);
  return `<span class="barra" aria-hidden="true"><span class="barra-relleno" data-llenar="${texto}" style="--llenado: ${texto}"></span></span>`;
}

let temporizadorAviso;
/** Notificación breve abajo, encima de la barra de pestañas. */
export function avisar(mensaje) {
  const elemento = document.querySelector("#aviso-flotante");
  if (!elemento) return;
  elemento.textContent = mensaje;
  elemento.classList.add("visible");
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => elemento.classList.remove("visible"), 2400);
}

/** Copia un texto al portapapeles (API del navegador: Clipboard API). */
export async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    avisar("Copied to clipboard");
    return true;
  } catch {
    avisar("Could not copy: select the text and copy it manually");
    return false;
  }
}

/** Sugerencias de un campo de texto (elementos <datalist> de index.html). Se rellenan la primera vez. */
export function rellenarLista(id, valores) {
  const lista = document.querySelector(`#${id}`);
  if (lista && lista.childElementCount === 0) {
    lista.innerHTML = [...new Set(valores)].map((valor) => `<option value="${escapar(valor)}"></option>`).join("");
  }
}

// ---------------------------------------------------------------------------
// Tema: "auto" (el del sistema), "claro" u "oscuro". Se guarda en perfil.tema (estado.js).

const COLOR_BARRA = { claro: "#F8F7F4", oscuro: "#111215" }; // --fondo de cada tema (ESTILO.md)

/** Pone el tema en <html data-theme> y el color de la barra del navegador. Con "auto" decide el sistema. */
export function aplicarTema(tema) {
  const raiz = document.documentElement;
  if (tema === "claro") raiz.dataset.theme = "light";
  else if (tema === "oscuro") raiz.dataset.theme = "dark";
  else delete raiz.dataset.theme;
  // Las dos <meta name="theme-color"> de index.html llevan media: con un tema elegido, las dos dicen el mismo
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const delSistema = meta.media.includes("dark") ? COLOR_BARRA.oscuro : COLOR_BARRA.claro;
    meta.content = COLOR_BARRA[tema] ?? delSistema;
  }
}
