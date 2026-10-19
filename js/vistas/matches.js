// Pantalla Matches: tu historial de combates, importado de Pokémon Showdown o apuntado a mano
import { infoMeta, formatoActual, resumenFormato, nombreDeEspecie, nombresDeEspecies, rutaDex, aId } from "../meta.js";
import { leer, guardar, nuevoId, resumenCombates, ordenarCombates } from "../estado.js";
import { buscarRepeticiones, leerRepeticion, urlRepeticion, SinDatos } from "../showdown.js";
import {
  icono, escapar, sprite, tituloSeccion, avisar, cargando, aviso, vacio, fechaCorta, haceCuanto, enlaceExterno,
  rellenarLista,
} from "../ui.js";

const LETRA = { victoria: "W", derrota: "L", empate: "T" };
const NOMBRE = { victoria: "Victory", derrota: "Defeat", empate: "Tie" };
let rivalesNuevos = []; // Pokémon del rival que se van añadiendo en el formulario manual
let vistaPrevia = null; // repetición leída, pendiente de guardar

export async function pintar(vista, { vigente }) {
  rellenarLista("lista-pokemon", nombresDeEspecies());
  const { combates, perfil, equipos } = leer();
  const ordenados = ordenarCombates(combates);
  // Los simulados se guardan y se ven en el historial, pero no cuentan en ninguna cifra
  const reales = ordenados.filter((c) => c.simulado !== true);
  const simulados = combates.length - reales.length;
  const resumen = resumenCombates();
  vistaPrevia = null;

  vista.innerHTML = `<div class="v-matches">
    <header class="cabecera grande">
      <div class="cabecera-texto"><h1 class="cabecera-titulo">Matches</h1></div>
      <div class="cabecera-acciones">
        <button type="button" class="boton-icono" data-accion="ir-registrar" aria-label="Log a battle manually">${icono("añadir")}</button>
      </div>
    </header>

    ${tarjetaResumen(resumen, reales, simulados)}
    ${rivalesFrecuentes(reales)}

    <section class="seccion">
      ${tituloSeccion("Import Showdown Battle")}
      <form id="importar-repeticion" class="en-linea" novalidate>
        <input name="enlace" type="url" inputmode="url" placeholder="Paste replay link…" aria-label="Replay link" autocomplete="off" autocapitalize="none" spellcheck="false">
        <button type="submit" class="boton secundario">Import</button>
      </form>
      <div id="vista-previa"></div>

      ${perfil.showdown
        ? `<div id="mis-repeticiones" class="repeticiones-bloque">${tituloSeccion(`Replays for ${escapar(perfil.showdown)}`)}${cargando("Searching Showdown…")}</div>`
        : `<div class="tarjeta repeticiones-bloque">
            <p class="nota">Set your Showdown username in Profile to see your public replays here and import them with one tap.</p>
            <a class="boton texto" href="#/perfil">Go to Profile</a>
          </div>`}
    </section>

    ${formularioManual(equipos)}

    <section class="seccion">
      ${tituloSeccion("Battle History", ordenados.length ? `<span class="insignia">${ordenados.length}</span>` : "")}
      ${ordenados.length
        ? `<ul class="tarjeta sin-relleno lista">${ordenados.map(filaCombate).join("")}</ul>`
        : vacio("No battles yet", "Import a Showdown replay or log them manually.")}
    </section>

    <dialog class="hoja" id="hoja" aria-label="Battle details">
      <header class="hoja-cabecera">
        <h2 class="hoja-titulo">Battle</h2>
        <button type="button" class="boton-icono" data-cerrar aria-label="Close">${icono("cerrar")}</button>
      </header>
      <div id="hoja-info"></div>
    </dialog>
  </div>`;

  conectar(vista, vigente, ordenados);
  if (perfil.showdown) cargarMisRepeticiones(vista, perfil.showdown, vigente);
}

// Victorias, derrotas, % y racha, y los últimos 10 resultados como puntos (el más reciente, a la derecha)
function tarjetaResumen(resumen, reales, simulados) {
  const racha = resumen.racha;
  const empates = resumen.total - resumen.victorias - resumen.derrotas; // L11: los empates también cuentan
  const clase = racha?.tipo === "victoria" ? "exito" : "error";
  const puntos = reales.slice(0, 10).reverse()
    .map((c) => `<span class="punto ${c.resultado}" title="${NOMBRE[c.resultado]}"></span>`).join("");
  return `
    <div class="tarjeta resumen">
      <div class="resumen-fila">
        <p class="resumen-cifras">
          <span class="exito">${resumen.victorias} W</span> <span class="separador">·</span>
          <span class="error">${resumen.derrotas} L</span> <span class="separador">·</span>
          ${empates ? `<span>${empates} T</span> <span class="separador">·</span>` : ""}
          <span>${resumen.porcentaje !== null ? `${resumen.porcentaje}%` : "–"}</span>
        </p>
        <p class="resumen-racha">Streak: ${racha ? `<b class="${clase}">${racha.cuantos} ${racha.tipo === "victoria" ? "W" : "L"}</b>` : "<b>–</b>"}</p>
      </div>
      <div class="resumen-fila">
        <span class="nota">Last 10</span>
        ${puntos ? `<span class="puntos" role="img" aria-label="Last ${reales.slice(0, 10).length} results, from oldest to newest">${puntos}</span>` : `<span class="nada">No battles</span>`}
      </div>
      ${simulados ? `<p class="nota resumen-sim">${simulados} saved simulated ${simulados === 1 ? "battle does not count" : "battles do not count"} toward these stats.</p>` : ""}
    </div>`;
}

function formularioManual(equipos) {
  // Fecha de hoy en la hora del móvil (toISOString usa la hora universal y de noche daría el día anterior)
  const ahora = new Date();
  const hoy = new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return `
    <section class="seccion">
      <details class="plegable" id="registrar">
        <summary>Log manually ${icono("flecha-derecha")}</summary>
        <div class="plegable-contenido">
          <form id="manual" class="formulario">
            <fieldset class="opciones">
              <legend class="campo-etiqueta">Result</legend>
              <label><input type="radio" name="resultado" value="victoria" checked> Victory</label>
              <label><input type="radio" name="resultado" value="derrota"> Defeat</label>
              <label><input type="radio" name="resultado" value="empate"> Tie</label>
            </fieldset>
            <div class="dos-columnas">
              <label class="campo"><span class="campo-etiqueta">Format</span>
                <select name="formato">
                  ${infoMeta().formatos.map((f) => `<option value="${f.id}"${f.id === formatoActual() ? " selected" : ""}>${escapar(f.nombre)}</option>`).join("")}
                  <option value="otro">Other</option>
                </select>
              </label>
              <label class="campo"><span class="campo-etiqueta">Date</span><input type="date" name="fecha" value="${hoy}" max="${hoy}"></label>
            </div>
            <label class="campo"><span class="campo-etiqueta">Your team</span>
              <select name="equipo">
                <option value="">No team</option>
                ${equipos.map((e) => `<option value="${e.id}"${e.id === leer().equipoActivo ? " selected" : ""}>${escapar(e.nombre)}</option>`).join("")}
              </select>
            </label>
            <label class="campo"><span class="campo-etiqueta">Opponent</span><input name="rival" placeholder="Opponent's name" maxlength="40" autocomplete="off"></label>
            <div class="en-linea">
              <label class="campo crece"><span class="campo-etiqueta">Opponent's Pokémon</span>
                <input id="rival-pokemon" list="lista-pokemon" placeholder="E.g. Incineroar" autocomplete="off" autocapitalize="none" spellcheck="false">
              </label>
              <button type="button" class="boton secundario" data-accion="anadir-rival">Add</button>
            </div>
            <div class="chips-rival" id="chips-rival">${chipsRival()}</div>
            <label class="campo"><span class="campo-etiqueta">Notes</span><textarea name="notas" rows="3" maxlength="500" placeholder="What worked, what didn't…"></textarea></label>
            <button type="submit" class="boton bloque">Save battle</button>
          </form>
        </div>
      </details>
    </section>`;
}

function chipsRival() {
  if (!rivalesNuevos.length) return `<p class="nada">Add up to 6 Pokémon.</p>`;
  return rivalesNuevos.map((nombre, i) => `
    <span class="chip">${sprite(nombre)}${escapar(nombre)}
      <button type="button" class="quitar" data-accion="quitar-rival" data-indice="${i}" aria-label="Remove ${escapar(nombre)}">${icono("cerrar")}</button>
    </span>`).join("");
}

// Los 4 Pokémon que más veces llevó el rival en tus combates reales
function rivalesFrecuentes(reales) {
  const cuenta = new Map();
  for (const c of reales) {
    for (const nombre of new Set(c.equipoRival)) cuenta.set(nombre, (cuenta.get(nombre) ?? 0) + 1);
  }
  const top = [...cuenta].sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (!top.length) return "";
  return `
    <section class="seccion">
      ${tituloSeccion("Most Seen Opponents")}
      <div class="rivales">
        ${top.map(([nombre, veces]) => `
          <a class="tarjeta rival" href="${rutaDex(nombre)}">
            ${sprite(nombre, { clase: "mediano" })}
            <span class="rival-nombre">${escapar(nombre)}</span>
            <span class="nota">${veces} ${veces === 1 ? "time" : "times"}</span>
          </a>`).join("")}
      </div>
    </section>`;
}

function equipoHtml(nombres) {
  if (!nombres.length) return `<span class="nada">–</span>`;
  return nombres.map((n) => `<a class="chip" href="${rutaDex(n)}">${sprite(n)}<span>${escapar(n)}</span></a>`).join("");
}

function filaCombate(c) {
  const formato = resumenFormato(c.formato)?.nombre ?? c.formatoNombre ?? c.formato;
  const rival = c.rival || "Unnamed opponent";
  const clase = { victoria: "v", derrota: "d", empate: "e" }[c.resultado];
  return `
    <li class="combate">
      <button type="button" class="fila" data-accion="abrir-repeticion" data-id="${escapar(c.id)}" aria-label="Open battle vs. ${escapar(rival)}: ${NOMBRE[c.resultado].toLowerCase()}">
        <span class="res ${clase}">${LETRA[c.resultado]}</span>
        <span class="fila-texto">
          <span class="fila-titulo linea-titulo"><span class="rival-texto">${escapar(rival)}</span>${c.simulado ? `<span class="insignia acento">Simulated</span>` : ""}</span>
          <span class="fila-sub linea">${escapar(formato)} · ${fechaCorta(c.fecha)}${c.rating ? ` · Rating ${c.rating}` : ""}</span>
          ${c.notas ? `<span class="fila-sub linea">${escapar(c.notas)}</span>` : ""}
        </span>
      </button>
      <button type="button" class="boton-icono borrar" data-accion="borrar-combate" data-id="${escapar(c.id)}" aria-label="Delete battle vs. ${escapar(rival)}">${icono("borrar")}</button>
    </li>`;
}

// Lo que se sabe de un combate guardado. De una repetición de Showdown solo se guarda el resultado y los
// equipos: lo demás se ve en Showdown con el enlace.
function infoCombate(c) {
  const rival = c.rival || "Unnamed opponent";
  const formato = resumenFormato(c.formato)?.nombre ?? c.formatoNombre ?? c.formato;
  const clase = { victoria: "v", derrota: "d", empate: "e" }[c.resultado];
  return `
    <div class="hoja-resultado">
      <span class="res ${clase}">${LETRA[c.resultado]}</span>
      <div class="fila-texto">
        <p class="fila-titulo">${NOMBRE[c.resultado]} vs. ${escapar(rival)}</p>
        <p class="fila-sub">${escapar(formato)} · ${fechaCorta(c.fecha)}${c.rating ? ` · Rating ${c.rating}` : ""}</p>
      </div>
      ${c.simulado ? `<span class="insignia acento">Simulated</span>` : ""}
    </div>
    <p class="campo-etiqueta">Your team</p>
    <div class="equipo">${equipoHtml(c.miEquipo)}</div>
    <p class="campo-etiqueta">Opponent's team</p>
    <div class="equipo">${equipoHtml(c.equipoRival)}</div>
    ${c.notas ? `<p class="campo-etiqueta">Notes</p><p class="hoja-notas">${escapar(c.notas)}</p>` : ""}
    <div class="hoja-acciones">
      ${c.repeticion ? enlaceExterno(urlRepeticion(c.repeticion), `${icono("externo")} Watch replay on Showdown`, "boton secundario bloque") : ""}
      ${c.simulado ? `<a class="boton bloque" href="#/simulador">Simulate again</a>` : ""}
    </div>`;
}

// ---------------------------------------------------------------------------
// Repeticiones de Showdown

async function cargarMisRepeticiones(vista, usuario, vigente) {
  const contenedor = vista.querySelector("#mis-repeticiones");
  try {
    const lista = await buscarRepeticiones({ usuario });
    if (!vigente()) return;
    const importadas = new Set(leer().combates.map((c) => c.repeticion).filter(Boolean));
    contenedor.innerHTML = `
      ${tituloSeccion(`Replays for ${escapar(usuario)}`, `<span class="insignia">${lista.length}</span>`)}
      ${lista.length ? `
        <ul class="tarjeta sin-relleno lista">
          ${lista.slice(0, 15).map((r) => `
            <li class="fila">
              <div class="fila-texto">
                <p class="fila-titulo">${escapar(r.players.join(" vs. "))}</p>
                <p class="fila-sub">${escapar(r.format)} · ${haceCuanto(r.uploadtime * 1000)}${r.rating ? ` · Rating ${r.rating}` : ""}</p>
              </div>
              ${importadas.has(r.id)
                ? `<span class="insignia exito">Imported</span>`
                : `<button type="button" class="boton secundario pequeno" data-accion="importar-de-lista" data-id="${escapar(r.id)}">Import</button>`}
            </li>`).join("")}
        </ul>`
        : `<p class="nada">No public replays for ${escapar(usuario)}. In Showdown, click "Upload and share replay" after a battle.</p>`}`;
  } catch {
    if (!vigente()) return;
    contenedor.innerHTML = `${tituloSeccion(`Replays for ${escapar(usuario)}`)}${aviso("Could not connect to Pokémon Showdown.")}`;
  }
}

function ladoDelJugador(repeticion) {
  const yo = aId(leer().perfil.showdown);
  return yo ? repeticion.jugadores.findIndex((j) => aId(j) === yo) : -1;
}

function combateDesdeRepeticion(repeticion, lado) {
  const resultado = repeticion.ganador === "" ? "empate"
    : aId(repeticion.ganador) === aId(repeticion.jugadores[lado]) ? "victoria" : "derrota";
  const nombres = (lista) => lista.map((n) => nombreDeEspecie(n) ?? n);
  return {
    id: nuevoId(),
    fecha: repeticion.fecha,
    resultado,
    formato: repeticion.formatoId,
    formatoNombre: repeticion.formato,
    rival: repeticion.jugadores[1 - lado],
    miEquipo: nombres(repeticion.equipos[lado]),
    equipoRival: nombres(repeticion.equipos[1 - lado]),
    equipoId: null,
    notas: "",
    repeticion: repeticion.id,
    rating: repeticion.rating,
  };
}

function guardarRepeticion(repeticion, lado) {
  if (repeticion.ganador === null) {
    avisar("That battle did not finish");
    return false;
  }
  if (leer().combates.some((c) => c.repeticion === repeticion.id)) {
    avisar("That battle is already in your history");
    return false;
  }
  const combate = combateDesdeRepeticion(repeticion, lado);
  guardar((e) => e.combates.push(combate));
  avisar(`Saved: ${NOMBRE[combate.resultado]} vs. ${combate.rival}`);
  return true;
}

function vistaPreviaHtml(repeticion) {
  const lado = ladoDelJugador(repeticion);
  return `
    <div class="tarjeta previa">
      <p class="nota">${escapar(repeticion.formato)} · ${fechaCorta(repeticion.fecha)}${repeticion.rating ? ` · Rating ${repeticion.rating}` : ""}</p>
      <p>Winner: <strong>${repeticion.ganador === "" ? "tie" : escapar(repeticion.ganador ?? "unfinished")}</strong></p>
      <fieldset class="opciones">
        <legend class="campo-etiqueta">Which player were you?</legend>
        ${repeticion.jugadores.map((j, i) => `<label><input type="radio" name="yo" value="${i}"${i === lado ? " checked" : ""}> ${escapar(j)}</label>`).join("")}
      </fieldset>
      ${repeticion.jugadores.map((j, i) => `
        <p class="nota">${escapar(j)}</p>
        <div class="sprites">${repeticion.equipos[i].map((n) => sprite(nombreDeEspecie(n) ?? n)).join("")}</div>`).join("")}
      <button type="button" class="boton bloque" data-accion="guardar-repeticion">Save battle</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// Botones y formularios

function conectar(vista, vigente, ordenados) {
  const pantalla = vista.querySelector(".v-matches");
  const hoja = pantalla.querySelector("#hoja");
  const repintar = () => {
    const posicion = window.scrollY;
    pintar(vista, { vigente }).then(() => window.scrollTo(0, posicion));
  };
  const anadirRival = () => {
    const campo = pantalla.querySelector("#rival-pokemon");
    const nombre = nombreDeEspecie(campo.value);
    if (!nombre) {
      avisar(campo.value.trim() ? `Could not find "${campo.value.trim()}"` : "Enter a Pokémon");
      return;
    }
    if (rivalesNuevos.length >= 6) {
      avisar("Up to 6 Pokémon max");
      return;
    }
    rivalesNuevos.push(nombre);
    campo.value = "";
    pantalla.querySelector("#chips-rival").innerHTML = chipsRival();
  };

  pantalla.querySelector("#importar-repeticion").addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const enlace = new FormData(evento.target).get("enlace").trim();
    const destino = pantalla.querySelector("#vista-previa");
    const enviar = evento.target.querySelector("[type=submit]");
    if (!enlace) {
      avisar("Paste a replay link");
      return;
    }
    enviar.disabled = true;
    destino.innerHTML = cargando("Reading replay…");
    try {
      vistaPrevia = await leerRepeticion(enlace);
      destino.innerHTML = vistaPreviaHtml(vistaPrevia);
    } catch (error) {
      destino.innerHTML = aviso(error instanceof SinDatos
        ? "Replay not found. Check the link (if it's private, copy the full URL)."
        : "Could not connect to Pokémon Showdown.");
    } finally {
      enviar.disabled = false;
    }
  });

  pantalla.querySelector("#rival-pokemon").addEventListener("keydown", (evento) => {
    if (evento.key === "Enter") {
      evento.preventDefault();
      anadirRival();
    }
  });

  pantalla.querySelector("#manual").addEventListener("submit", (evento) => {
    evento.preventDefault();
    const enviar = evento.target.querySelector("[type=submit]");
    if (enviar.disabled) return;
    enviar.disabled = true;
    const datos = new FormData(evento.target);
    const equipo = leer().equipos.find((e) => e.id === datos.get("equipo"));
    const formato = datos.get("formato");
    // L6: el día elegido, con la hora real del momento en que se registra. Así dos combates del mismo
    // día quedan en orden de registro.
    const ahora = new Date();
    const [anio, mes, dia] = String(datos.get("fecha") || "").split("-").map(Number);
    const fecha = anio
      ? new Date(anio, mes - 1, dia, ahora.getHours(), ahora.getMinutes(), ahora.getSeconds(), ahora.getMilliseconds()).getTime()
      : ahora.getTime();
    const combate = {
      id: nuevoId(),
      fecha,
      resultado: datos.get("resultado"),
      formato,
      formatoNombre: formato === "otro" ? "Other format" : resumenFormato(formato)?.nombre,
      rival: datos.get("rival").trim(),
      miEquipo: equipo ? equipo.miembros.map((m) => m.especie) : [],
      equipoRival: [...rivalesNuevos],
      equipoId: equipo?.id ?? null,
      notas: datos.get("notas").trim(),
      repeticion: null,
      rating: null,
    };
    guardar((e) => e.combates.push(combate));
    rivalesNuevos = [];
    avisar("Battle saved");
    repintar();
  });

  pantalla.addEventListener("click", async (evento) => {
    const boton = evento.target.closest("[data-accion]");
    if (!boton) return;
    switch (boton.dataset.accion) {
      case "ir-registrar": {
        const registro = pantalla.querySelector("#registrar");
        registro.open = true;
        registro.scrollIntoView({ behavior: "smooth", block: "start" });
        break;
      }
      case "anadir-rival":
        anadirRival();
        break;
      case "quitar-rival":
        rivalesNuevos.splice(Number(boton.dataset.indice), 1);
        pantalla.querySelector("#chips-rival").innerHTML = chipsRival();
        break;
      case "guardar-repeticion": {
        const elegido = pantalla.querySelector("input[name=yo]:checked");
        if (!elegido) {
          avisar("Select which player you were");
          return;
        }
        if (!vistaPrevia) return;
        boton.disabled = true;
        if (guardarRepeticion(vistaPrevia, Number(elegido.value))) repintar();
        else boton.disabled = false;
        break;
      }
      case "importar-de-lista": {
        boton.disabled = true;
        try {
          const repeticion = await leerRepeticion(boton.dataset.id);
          const lado = ladoDelJugador(repeticion);
          if (lado < 0) {
            vistaPrevia = repeticion;
            pantalla.querySelector("#vista-previa").innerHTML = vistaPreviaHtml(repeticion);
            pantalla.querySelector("#vista-previa").scrollIntoView({ behavior: "smooth", block: "center" });
          } else if (guardarRepeticion(repeticion, lado)) {
            repintar();
          }
        } catch {
          avisar("Could not read replay");
        } finally {
          boton.disabled = false;
        }
        break;
      }
      case "abrir-repeticion": {
        const combate = ordenados.find((c) => c.id === boton.dataset.id);
        if (!combate) return;
        pantalla.querySelector("#hoja-info").innerHTML = infoCombate(combate);
        hoja.showModal();
        break;
      }
      case "borrar-combate":
        if (!confirm("Delete this battle from history?")) return;
        guardar((e) => { e.combates = e.combates.filter((c) => c.id !== boton.dataset.id); });
        avisar("Battle deleted");
        repintar();
        break;
    }
  });
}
