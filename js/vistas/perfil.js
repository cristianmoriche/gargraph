// Pantalla Perfil: tus datos, tema, tu Elo en Showdown, favoritos, instalación, copia de seguridad y créditos.
// Con aspecto de la pantalla de ajustes de una app nativa. Tiene que abrir siempre, aunque los datos
// guardados estén mal: desde aquí se pueden borrar.
import {
  infoMeta, formatoActual, resumenFormato, especie, nombreDeEspecie, nombresDeEspecies, nombreDeClave, nombreDesdeClave,
} from "../meta.js";
import { leer, guardar, resumenCombates, exportar, importar, borrarTodo } from "../estado.js";
import { perfilDeJugador, urlPerfil, SinDatos } from "../showdown.js";
import {
  icono, escapar, decimal, sprite, tituloSeccion, avisar, cargando, aviso, nombreMes, enlaceExterno, rellenarLista,
  fechaCorta, aplicarTema,
} from "../ui.js";

// La versión de la app es la VERSION de sw.js (la tarea diaria de datos la sube sola): se lee de ahí para que no se desfase
async function versionDeLaApp() {
  try {
    const codigo = await (await fetch("sw.js")).text();
    return /const VERSION = "([^"]+)"/.exec(codigo)?.[1] ?? null;
  } catch {
    return null;
  }
}

const TEMAS = [
  ["auto", "Automatic"],
  ["claro", "Light"],
  ["oscuro", "Dark"],
];

export async function pintar(vista, { vigente }) {
  try {
    pintarPerfil(vista);
  } catch (error) {
    // Datos que no cuadran: al menos se puede borrar todo y volver a empezar
    console.error(error);
    pintarSoloBorrar(vista, error);
  }
  conectar(vista, vigente);
  versionDeLaApp().then((version) => {
    const campo = vista.querySelector("#version-app");
    if (campo && vigente()) campo.textContent = version ?? "unknown";
  });
  const { showdown } = leer().perfil;
  if (showdown && vista.querySelector("#elo")) cargarElo(vista, showdown, vigente);
}

function pintarPerfil(vista) {
  rellenarLista("lista-pokemon", nombresDeEspecies());
  const datos = leer();
  const { perfil } = datos;
  const resumen = resumenCombates();
  const simulados = datos.combates.filter((c) => c.simulado === true).length;
  const meta = infoMeta();
  // En el iPhone, navigator.standalone dice si se ha abierto desde el icono de la pantalla de inicio
  // Los pasos de instalación son los de Safari en iOS: solo se enseñan allí (en iPadOS, Safari se anuncia como Mac con pantalla táctil)
  const esAndroid = /Android/.test(navigator.userAgent);
  const esIos = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const instalada = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const avatar = perfil.avatar && especie(perfil.avatar)
    ? sprite(perfil.avatar, { clase: "grande con-fondo" })
    : `<span class="sprite grande sin" data-iniciales="${escapar((perfil.nombre || "?").charAt(0).toUpperCase())}" aria-hidden="true"></span>`;

  vista.innerHTML = `<div class="v-perfil">
    <header class="cabecera grande">
      <div class="cabecera-texto">
        <h1 class="cabecera-titulo">Profile</h1>
        <p class="cabecera-sub">${instalada ? "App installed on this device" : "Opened in browser"}</p>
      </div>
    </header>

    <section class="tarjeta v-perfil-entrenador">
      ${avatar}
      <div class="v-perfil-entrenador-texto">
        <p class="v-perfil-nombre">${escapar(perfil.nombre || "Trainer")}</p>
        <p class="v-perfil-dato">${perfil.showdown ? `Showdown: ${escapar(perfil.showdown)}` : "No Showdown username"}</p>
        <p class="v-perfil-dato">Format: ${escapar(resumenFormato()?.nombre ?? "")}</p>
      </div>
    </section>

    <section class="tarjeta v-perfil-cifras" aria-label="Summary">
      <div><strong>${datos.equipos.length}</strong><span>Teams</span></div>
      <div><strong>${resumen.total}</strong><span>Battles</span></div>
      <div><strong>${resumen.porcentaje ?? "–"}${resumen.porcentaje !== null ? "%" : ""}</strong><span>Won</span></div>
      <div><strong>${datos.favoritos.length}</strong><span>Favorites</span></div>
    </section>
    ${simulados ? `<p class="nota v-perfil-nota-cifras">Excluding ${simulados === 1 ? "1 simulated battle" : `${simulados} simulated battles`}.</p>` : ""}

    <section class="seccion">
      ${tituloSeccion("Appearance")}
      <div class="tarjeta">
        <p class="campo-etiqueta" id="tema-titulo">Theme</p>
        <div class="segmentado v-perfil-tema" role="group" aria-labelledby="tema-titulo">
          ${TEMAS.map(([valor, texto]) => `
            <button type="button" class="segmento" data-tema="${valor}" aria-pressed="${perfil.tema === valor}">${texto}</button>`).join("")}
        </div>
        <p class="nota v-perfil-nota">"Automatic" follows your device's system setting.</p>
      </div>
    </section>

    <section class="seccion">
      ${tituloSeccion("Your details")}
      <form id="perfil" class="tarjeta formulario">
        <label class="campo"><span class="campo-etiqueta">Name</span>
          <input name="nombre" value="${escapar(perfil.nombre)}" maxlength="24" autocomplete="nickname">
        </label>
        <label class="campo"><span class="campo-etiqueta">Pokémon Showdown username</span>
          <input name="showdown" value="${escapar(perfil.showdown)}" maxlength="18" autocomplete="off" autocapitalize="none" spellcheck="false">
        </label>
        <label class="campo"><span class="campo-etiqueta">Favorite format</span>
          <select name="formato">
            ${meta.formatos.map((f) => `<option value="${escapar(f.id)}"${f.id === formatoActual() ? " selected" : ""}>${escapar(f.nombre)} · ${escapar(f.modo)}</option>`).join("")}
          </select>
        </label>
        <label class="campo"><span class="campo-etiqueta">Avatar Pokémon</span>
          <input name="avatar" list="lista-pokemon" value="${escapar(perfil.avatar ?? "")}" placeholder="E.g. Dragapult" autocomplete="off" autocapitalize="none" spellcheck="false">
        </label>
        <button type="submit" class="boton bloque">Save</button>
        <p class="nota">Your Showdown username is used to check your Elo and import your replays in Matches. No password needed: only public data is read.</p>
      </form>
    </section>

    ${perfil.showdown ? `
      <section class="seccion" id="elo">
        ${tituloSeccion("Your Showdown Elo")}
        <div class="tarjeta">${cargando("Checking Showdown…")}</div>
      </section>` : ""}

    <section class="seccion">
      ${tituloSeccion("Favorites", `<span class="insignia">${datos.favoritos.length}</span>`)}
      ${datos.favoritos.length ? `
        <div class="v-perfil-favoritos">
          ${datos.favoritos.map((clave) => {
            const nombre = nombreDeClave(clave);
            return `<a class="chip" href="#/dex/${encodeURIComponent(clave)}">${sprite(nombre ?? clave, { id: especie(nombre)?.id })}<span>${escapar(nombreDesdeClave(clave))}</span></a>`;
          }).join("")}
        </div>` : `<p class="nada">Star Pokémon on their Dex entry and they will appear here.</p>`}
    </section>

    ${instalada || !esIos ? "" : `
      <section class="seccion">
        ${tituloSeccion("Install on your iPhone")}
        <ol class="tarjeta v-perfil-pasos">
          <li>Open this page in <strong>Safari</strong>.</li>
          <li>Tap <strong>Share</strong> ${icono("exportar")} (in iOS 26, it is inside the <strong>···</strong> button in the bar).</li>
          <li>Select <strong>Add to Home Screen</strong> and keep <strong>Open as Web App</strong> enabled.</li>
          <li>Tap <strong>Add</strong>. You will have Gargraph with its icon, full screen, and working offline.</li>
        </ol>
      </section>`}

    ${instalada || !esAndroid ? "" : `
      <section class="seccion">
        ${tituloSeccion("Install on your Android")}
        <ol class="tarjeta v-perfil-pasos">
          <li>Open this page in <strong>Chrome</strong>.</li>
          <li>Tap the three-dot menu in the top right corner.</li>
          <li>Select <strong>Install app</strong> (or <strong>Add to Home screen</strong>) and confirm.</li>
          <li>Gargraph appears in your app drawer, full screen and working offline.</li>
        </ol>
      </section>`}

    ${seccionCopia()}

    <section class="seccion">
      ${tituloSeccion("About Gargraph")}
      <div class="tarjeta v-perfil-acerca">
        <p>Version <span id="version-app">…</span> · Usage data from ${nombreMes(meta.mes)}, built on ${fechaCorta(new Date(`${meta.generado}T12:00:00`).getTime())}.</p>
        <h3 class="v-perfil-subtitulo">APIs & data sources</h3>
        <ul class="v-perfil-apis">
          <li><strong>PokeAPI</strong> (Web API): live entries, sprites, and descriptions.</li>
          <li><strong>Smogon</strong> (usage stats): monthly usage, sets, teammates, and counters.</li>
          <li><strong>Limitless</strong> (tournament data): tournaments, top teams, and team usage.</li>
          <li><strong>Pokémon Showdown</strong> (Web API): live replays and Elo, plus simulator data (tiers, moves, and items).</li>
          <li><strong>Browser APIs</strong>: Fetch, Web Storage, Service Worker, Cache Storage, Clipboard, and History.</li>
          <li><strong>Google Fonts</strong>: Inter typeface.</li>
        </ul>
        <p class="nota">
          Gargraph is an unofficial, non-profit educational project from a first-year DAM course. It is not affiliated with
          Nintendo, Creatures, GAME FREAK, The Pokémon Company, Smogon, or Pokémon Showdown. Pokémon and Pokémon character
          names are trademarks of their respective owners.
        </p>
      </div>
    </section>
  </div>`;
}

// Copia de seguridad y borrado: lo único que necesita la pantalla de emergencia
function seccionCopia() {
  return `
    <section class="seccion">
      ${tituloSeccion("Backup")}
      <div class="tarjeta v-perfil-copia">
        <p class="nota">Your teams, battles, and favorites are stored only on this device. Download a backup so you do not lose them or to move them to another device.</p>
        <div class="botones-fila">
          <button type="button" class="boton secundario" data-accion="exportar">${icono("importar")} Download backup</button>
          <label class="boton secundario">${icono("exportar")} Restore backup
            <input type="file" accept="application/json,.json" id="restaurar" class="solo-lectores">
          </label>
        </div>
        <button type="button" class="boton peligro bloque" data-accion="borrar">${icono("borrar")} Delete all my data</button>
      </div>
    </section>`;
}

function pintarSoloBorrar(vista, error) {
  vista.innerHTML = `<div class="v-perfil">
    <header class="cabecera grande"><div class="cabecera-texto"><h1 class="cabecera-titulo">Profile</h1></div></header>
    ${aviso("Some saved data on this device could not be read.", `Restore a backup or delete the data to start fresh. (${escapar(error?.message ?? "")})`)}
    ${seccionCopia()}
  </div>`;
}

async function cargarElo(vista, usuario, vigente) {
  const contenedor = vista.querySelector("#elo");
  const titulo = tituloSeccion("Your Showdown Elo", enlaceExterno(urlPerfil(usuario), `${icono("externo")}<span class="solo-lectores">View profile on Showdown</span>`, "boton-icono"));
  try {
    const jugador = await perfilDeJugador(usuario);
    if (!vigente() || !contenedor.isConnected) return;
    // Los formatos sin partidas (0–0) no dicen nada: Showdown les pone 1000 de Elo por defecto
    const filas = jugador.valoraciones.filter((v) => (v.victorias ?? 0) + (v.derrotas ?? 0) > 0).slice(0, 12);
    contenedor.innerHTML = `
      ${titulo}
      ${filas.length ? `
        <ul class="tarjeta sin-relleno lista">
          ${filas.map((v) => `
            <li class="fila">
              <div class="fila-texto">
                <p class="fila-titulo">${escapar(nombreDeFormatoShowdown(v.formato))}</p>
                <p class="fila-sub">${v.victorias ?? 0} W · ${v.derrotas ?? 0} L${Number.isFinite(v.gxe) ? ` · GXE ${decimal(v.gxe)}%` : ""}</p>
              </div>
              <span class="fila-valor"><span class="solo-lectores">Elo </span>${v.elo.toLocaleString("en-US")}</span>
            </li>`).join("")}
        </ul>`
        : `<p class="nada">${escapar(jugador.nombre)} has no rated battles yet.</p>`}
      <p class="nota v-perfil-nota">The number on the right is Elo. GXE: estimated chance of winning against a random ladder opponent.</p>`;
  } catch (error) {
    if (!vigente() || !contenedor.isConnected) return;
    contenedor.innerHTML = `${titulo}${aviso(error instanceof SinDatos
      ? `User "${usuario}" does not exist on Pokémon Showdown or has not played any battles yet.`
      : "Could not connect to Pokémon Showdown.")}`;
  }
}

// Trozos de los ids de formato de Showdown, de más largo a más corto («randombattle» antes que «random»)
const TROZOS_FORMATO = Object.entries({
  randomdoublesbattle: "Random Doubles Battle", randombattle: "Random Battle", battlestadiumsingles: "Battle Stadium Singles",
  battlestadiumdoubles: "Battle Stadium Doubles", almostanyability: "Almost Any Ability", balancedhackmons: "Balanced Hackmons",
  purehackmons: "Pure Hackmons", hackmons: "Hackmons", nationaldex: "National Dex", anythinggoes: "Anything Goes",
  challengecup: "Challenge Cup", customgame: "Custom Game", battlefactory: "Battle Factory", mixandmega: "Mix and Mega",
  partnersincrime: "Partners in Crime", sharedpower: "Shared Power", godlygift: "Godly Gift", inheritance: "Inheritance",
  stabmons: "STABmons", monotype: "Monotype", champions: "Champions", doubles: "Doubles", freeforall: "Free-For-All",
  unrated: "Unrated", factory: "Factory", ubers: "Ubers", random: "Random", battle: "Battle", draft: "Draft",
  vgc: "VGC", bss: "BSS", cap: "CAP", reg: "Reg", lc: "LC", ou: "OU", uu: "UU", ru: "RU", nu: "NU", pu: "PU",
  zu: "ZU", ag: "AG", "1v1": "1v1", "2v2": "2v2",
}).sort(([a], [b]) => b.length - a.length);

/**
 * Nombre legible de un formato de Showdown. Los de la app, con su nombre; el resto, a partir de su id:
 * «gen9randombattle» → «Gen 9 Random Battle», «gen9vgc2025regi» → «Gen 9 VGC 2025 Reg I».
 */
function nombreDeFormatoShowdown(id) {
  const conocido = resumenFormato(id)?.nombre;
  if (conocido) return conocido;
  const partes = String(id).match(/^gen(\d+)(.*)$/);
  let resto = partes ? partes[2] : String(id);
  const palabras = [];
  let suelto = ""; // letras que no forman ningún trozo conocido
  const soltar = () => {
    if (suelto) palabras.push(suelto.length <= 2 ? suelto.toUpperCase() : suelto.charAt(0).toUpperCase() + suelto.slice(1));
    suelto = "";
  };
  while (resto) {
    const trozo = TROZOS_FORMATO.find(([clave]) => resto.startsWith(clave));
    const cifras = resto.match(/^\d+/)?.[0];
    if (trozo) {
      soltar();
      palabras.push(trozo[1]);
      resto = resto.slice(trozo[0].length);
    } else if (cifras) {
      soltar();
      palabras.push(cifras);
      resto = resto.slice(cifras.length);
    } else {
      suelto += resto[0];
      resto = resto.slice(1);
    }
  }
  soltar();
  return [partes ? `Gen ${partes[1]}` : "", ...palabras].filter(Boolean).join(" ");
}

function conectar(vista, vigente) {
  const pantalla = vista.querySelector(".v-perfil");
  const repintar = () => pintar(vista, { vigente });

  pantalla.querySelector("#perfil")?.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const boton = evento.target.querySelector('[type="submit"]');
    if (boton.disabled) return; // un doble toque no guarda dos veces
    const datos = new FormData(evento.target);
    const textoAvatar = datos.get("avatar").trim();
    const avatar = textoAvatar ? nombreDeEspecie(textoAvatar) : null;
    if (textoAvatar && !avatar) {
      avisar(`Could not find "${textoAvatar}"`);
      return;
    }
    boton.disabled = true;
    guardar((e) => {
      e.perfil.nombre = datos.get("nombre").trim();
      e.perfil.showdown = datos.get("showdown").trim();
      e.perfil.formato = datos.get("formato");
      e.perfil.avatar = avatar;
    });
    avisar("Profile saved");
    repintar();
  });

  pantalla.querySelector("#restaurar").addEventListener("change", async (evento) => {
    const fichero = evento.target.files[0];
    evento.target.value = ""; // así se puede elegir otra vez el mismo fichero
    if (!fichero) return;
    if (!confirm("The backup will replace all data on this device. Continue?")) return;
    try {
      const { descartados } = importar(await fichero.text());
      aplicarTema(leer().perfil.tema);
      avisar(descartados
        ? `Backup restored. Discarded ${descartados} invalid ${descartados === 1 ? "item" : "items"}`
        : "Backup restored");
      repintar();
    } catch (error) {
      avisar((error.message.includes("Gargraph") || error.message.includes("backup")) ? error.message : "That file is not a valid backup");
    }
  });

  pantalla.addEventListener("click", (evento) => {
    const tema = evento.target.closest("[data-tema]");
    if (tema) {
      guardar((e) => { e.perfil.tema = tema.dataset.tema; });
      aplicarTema(tema.dataset.tema);
      for (const boton of pantalla.querySelectorAll("[data-tema]")) boton.setAttribute("aria-pressed", String(boton === tema));
      return;
    }
    const boton = evento.target.closest("[data-accion]");
    if (!boton) return;
    if (boton.dataset.accion === "exportar") {
      descargar(exportar(), `gargraph-backup-${new Date().toISOString().slice(0, 10)}.json`);
      avisar("Backup downloaded");
    } else if (boton.dataset.accion === "borrar") {
      if (!confirm("Delete your profile, teams, battles, and favorites from this device? This cannot be undone.")) return;
      borrarTodo();
      aplicarTema(leer().perfil.tema);
      avisar("Data deleted");
      repintar();
    }
  });
}

/** Descarga un texto como fichero (en el iPhone se abre la hoja para guardarlo en Archivos). */
function descargar(texto, nombre) {
  const url = URL.createObjectURL(new Blob([texto], { type: "application/json" }));
  const enlace = Object.assign(document.createElement("a"), { href: url, download: nombre });
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
