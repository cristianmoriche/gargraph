// Pantalla Team Usage (#/uso-equipos): equipos con los mismos 6 Pokémon agrupados, con cuántos son y su win rate real
// (victorias sobre partidas jugadas en los torneos). El número de equipos va siempre al lado del win rate.
import { nombreDeEspecie, nombresDeEspecies } from "../meta.js";
import { escapar, cabeceraDetalle, cargando, vacio, selectorDeFormatos, lineaActualizado, rellenarLista, porcentaje } from "../ui.js";
import { activar } from "../movimiento.js";
import { formatoDePantalla, avisoSustituto, cargarEquiposTop, sprites, tasaDeVictorias, textoRecord, pieLimitless, SIN_CONEXION } from "./torneos.js";

const ORDENES = [["equipos", "Most teams"], ["tasa", "Highest win rate"], ["record", "Best record"]];
const POR_PAGINA = 20;
// Filtros que se conservan mientras la app esté abierta
const filtros = { orden: "equipos", pokemon: "", minimoEquipos: 2, minimoTasa: 0 };

const lleva = (g, nombre) => g.especies.some((e) => e === nombre || e.startsWith(`${nombre}-Mega`));

export async function pintar(vista, { vigente }) {
  const pantalla = formatoDePantalla();
  const cabecera = (sub = "") => cabeceraDetalle({ titulo: "Team Usage", subtitulo: sub, volver: "#/inicio" });
  vista.innerHTML = `<div class="v-torneos">${cabecera()}${cargando("Loading teams…")}</div>`;
  const datos = pantalla ? await cargarEquiposTop(pantalla.resumen) : null;
  if (!vigente()) return;
  if (!pantalla || !datos?.grupos.length) {
    vista.innerHTML = `<div class="v-torneos">${cabecera()}${selectorDeFormatos()}${vacio(...(navigator.onLine === false ? SIN_CONEXION
      : ["No teams yet", "There are no tournament teams for this format yet. They are updated every day."]))}</div>`;
    return;
  }
  const opciones = (lista, actual) => lista.map(([valor, texto]) => `<option value="${valor}"${String(valor) === String(actual) ? " selected" : ""}>${texto}</option>`).join("");
  vista.innerHTML = `
    <div class="v-torneos">
      ${cabecera(escapar(pantalla.resumen.nombre))}
      <p class="torneos-intro">Teams that carry the same 6 Pokémon (a Mega form counts as its own Pokémon), with their combined results in tournament games.</p>
      ${selectorDeFormatos()}
      ${avisoSustituto(pantalla)}
      ${datos.actualizado ? lineaActualizado(datos.actualizado) : ""}
      <form class="formulario torneos-filtros" onsubmit="return false">
        <label class="campo"><span class="campo-etiqueta">Sort by</span>
          <select id="orden">${opciones(ORDENES, filtros.orden)}</select></label>
        <label class="campo"><span class="campo-etiqueta">Filter by Pokémon</span>
          <input id="pokemon" type="search" list="lista-pokemon" placeholder="Any Pokémon" autocomplete="off" autocapitalize="none" spellcheck="false" value="${escapar(filtros.pokemon)}"></label>
        <label class="campo"><span class="campo-etiqueta">Minimum teams</span>
          <select id="minimo-equipos">${opciones([1, 2, 3, 5, 10].map((n) => [n, n]), filtros.minimoEquipos)}</select></label>
        <label class="campo"><span class="campo-etiqueta">Minimum win rate</span>
          <select id="minimo-tasa">${opciones([0, 40, 50, 55, 60, 65, 70].map((n) => [n, n ? `${n}%` : "Any"]), filtros.minimoTasa)}</select></label>
      </form>
      <p class="nota" id="cuenta"></p>
      <div class="torneos-lista" id="grupos"></div>
      <p class="nota">Win rate is wins over games played by these teams in Limitless tournaments (W-L-T = wins, losses, ties).
        A group with few teams can swing a lot: check the number of teams next to each win rate.</p>
      ${pieLimitless()}
    </div>`;
  rellenarLista("lista-pokemon", nombresDeEspecies());

  const contenedor = vista.querySelector("#grupos");
  let visibles = [];
  let mostrados = 0;
  const pintarMas = () => {
    contenedor.querySelector("[data-mas]")?.remove();
    const hasta = Math.min(visibles.length, mostrados + POR_PAGINA);
    contenedor.insertAdjacentHTML("beforeend", visibles.slice(mostrados, hasta).map(tarjetaGrupo).join(""));
    mostrados = hasta;
    if (mostrados < visibles.length) {
      contenedor.insertAdjacentHTML("beforeend", `<button type="button" class="boton secundario bloque" data-mas>Show more (${visibles.length - mostrados})</button>`);
    }
    activar(contenedor);
  };
  const repintar = () => {
    const nombre = filtros.pokemon ? nombreDeEspecie(filtros.pokemon) : null;
    visibles = datos.grupos
      .filter((g) => g.equipos >= filtros.minimoEquipos)
      .filter((g) => (tasaDeVictorias(g) ?? 0) * 100 >= filtros.minimoTasa)
      .filter((g) => !filtros.pokemon || (nombre && lleva(g, nombre)))
      .sort(comparar(filtros.orden));
    vista.querySelector("#cuenta").textContent = `${visibles.length} of ${datos.grupos.length} team groups`;
    contenedor.innerHTML = "";
    mostrados = 0;
    if (visibles.length) pintarMas();
    else contenedor.innerHTML = vacio("No teams match", "Lower the minimums or clear the Pokémon filter.");
  };
  repintar();

  contenedor.addEventListener("click", (evento) => {
    if (evento.target.closest("[data-mas]")) pintarMas();
  });
  vista.querySelector("#orden").addEventListener("change", (e) => { filtros.orden = e.target.value; repintar(); });
  vista.querySelector("#minimo-equipos").addEventListener("change", (e) => { filtros.minimoEquipos = Number(e.target.value); repintar(); });
  vista.querySelector("#minimo-tasa").addEventListener("change", (e) => { filtros.minimoTasa = Number(e.target.value); repintar(); });
  const campo = vista.querySelector("#pokemon");
  campo.addEventListener("input", () => { filtros.pokemon = campo.value.trim(); repintar(); });
}

function comparar(orden) {
  const tasa = (g) => tasaDeVictorias(g) ?? 0;
  if (orden === "tasa") return (a, b) => tasa(b) - tasa(a) || b.equipos - a.equipos;
  if (orden === "record") return (a, b) => (b.w - b.l) - (a.w - a.l) || b.w - a.w || tasa(b) - tasa(a);
  return (a, b) => b.equipos - a.equipos || tasa(b) - tasa(a);
}

function tarjetaGrupo(g) {
  const tasa = tasaDeVictorias(g);
  return `
    <div class="tarjeta grupo-equipo">
      ${sprites(g.especies.map((especie) => ({ especie })))}
      <p class="grupo-datos">
        <span class="grupo-tasa">${tasa != null ? porcentaje(Math.round(tasa * 1000) / 10) : "–"}</span>
        <span class="grupo-etiqueta">win rate</span>
        <span class="insignia acento">${g.equipos} ${g.equipos === 1 ? "team" : "teams"}</span>
      </p>
      <p class="nota">Record ${escapar(textoRecord(g))} (W-L-T)</p>
    </div>`;
}
