// Pantalla Top Teams (#/equipos-top): los mejores equipos de torneos recientes del formato, con filtro por Pokémon y por arquetipo.
import { nombreDeEspecie, nombresDeEspecies } from "../meta.js";
import {
  escapar, icono, cabeceraDetalle, cargando, vacio, avisar, selectorDeFormatos, lineaActualizado, rellenarLista,
} from "../ui.js";
import { activar } from "../movimiento.js";
import { formatoDePantalla, avisoSustituto, cargarEquiposTop, listaPaginada, ARQUETIPOS, pieLimitless, SIN_CONEXION } from "./torneos.js";

let requeridos = []; // Pokémon que tiene que llevar cada equipo; se conservan mientras la app esté abierta
let arquetipo = "";  // "" = todos

// Un equipo cumple si lleva a cada Pokémon pedido (la forma Mega cuenta como el mismo Pokémon)
const lleva = (e, nombre) => e.equipo.some((m) => m.especie === nombre || m.especie.startsWith(`${nombre}-Mega`));

export async function pintar(vista, { vigente }) {
  const pantalla = formatoDePantalla();
  const cabecera = (sub = "") => cabeceraDetalle({ titulo: "Top Teams", subtitulo: sub, volver: "#/inicio" });
  vista.innerHTML = `<div class="v-torneos">${cabecera()}${cargando("Loading teams…")}</div>`;
  const datos = pantalla ? await cargarEquiposTop(pantalla.resumen) : null;
  if (!vigente()) return;
  if (!pantalla || !datos?.equipos.length) {
    vista.innerHTML = `<div class="v-torneos">${cabecera()}${selectorDeFormatos()}${vacio(...(navigator.onLine === false ? SIN_CONEXION
      : ["No teams yet", "There are no tournament teams for this format yet. They are updated every day."]))}</div>`;
    return;
  }

  vista.innerHTML = `
    <div class="v-torneos">
      ${cabecera(escapar(pantalla.resumen.nombre))}
      <p class="torneos-intro">The best teams from recent tournaments, by record. Add Pokémon to require on each team, or pick an archetype.</p>
      ${selectorDeFormatos()}
      ${avisoSustituto(pantalla)}
      ${datos.actualizado ? lineaActualizado(datos.actualizado) : ""}
      <form class="torneos-filtro" id="requerir" role="search">
        <label class="buscador">
          ${icono("buscar")}
          <input id="requerido" type="search" list="lista-pokemon" placeholder="Add Pokémon to require on each team"
            aria-label="Add Pokémon to require on each team" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="done">
        </label>
      </form>
      <div class="recientes torneos-chips" id="chips"></div>
      <div class="segmentado torneos-arquetipos" role="group" aria-label="Archetype">
        ${["", ...ARQUETIPOS].map((a) => `<button type="button" class="segmento" data-arquetipo="${escapar(a)}" aria-pressed="${a === arquetipo}">${a || "All"}</button>`).join("")}
      </div>
      <p class="nota" id="cuenta"></p>
      <div class="torneo-equipos" id="equipos"></div>
      <p class="nota">Archetypes are worked out from each team's Pokémon, abilities and moves (for example Drought or Sunny Day: Sun).
        Tournament teams have no EV spreads.</p>
      ${pieLimitless()}
    </div>`;
  rellenarLista("lista-pokemon", nombresDeEspecies());

  const lista = vista.querySelector("#equipos");
  const chips = vista.querySelector("#chips");
  const repintar = () => {
    const visibles = datos.equipos.filter((e) => requeridos.every((r) => lleva(e, r)) && (!arquetipo || e.arquetipos.includes(arquetipo)));
    chips.innerHTML = requeridos.map((r) => `<button type="button" class="chip" data-quitar="${escapar(r)}" aria-label="Remove ${escapar(r)}"><span>${escapar(r)}</span>${icono("cerrar")}</button>`).join("");
    vista.querySelector("#cuenta").textContent = `${visibles.length} of ${datos.equipos.length} teams`;
    if (visibles.length) listaPaginada(lista, visibles, pantalla.resumen, { torneoNombre: true });
    else lista.innerHTML = vacio("No teams match", "Remove a Pokémon or pick another archetype.");
    activar(lista);
  };
  repintar();

  const campo = vista.querySelector("#requerido");
  const anadir = () => {
    const texto = campo.value.trim();
    if (!texto) return;
    const nombre = nombreDeEspecie(texto);
    if (!nombre) {
      avisar("Pokémon not found");
      return;
    }
    campo.value = "";
    if (!requeridos.includes(nombre)) requeridos.push(nombre);
    repintar();
  };
  vista.querySelector("#requerir").addEventListener("submit", (evento) => {
    evento.preventDefault();
    anadir();
    campo.blur();
  });
  campo.addEventListener("change", anadir); // al elegir una sugerencia de la lista
  chips.addEventListener("click", (evento) => {
    const quitar = evento.target.closest("[data-quitar]");
    if (!quitar) return;
    requeridos = requeridos.filter((r) => r !== quitar.dataset.quitar);
    repintar();
  });
  vista.querySelectorAll("[data-arquetipo]").forEach((boton) => boton.addEventListener("click", () => {
    arquetipo = boton.dataset.arquetipo;
    vista.querySelectorAll("[data-arquetipo]").forEach((b) => b.setAttribute("aria-pressed", String(b === boton)));
    repintar();
  }));
}
