// Pantalla Clasificación: todos los Pokémon del formato, agrupados por su puesto en la tabla de uso
import { cargarFormato, cargarRecientes, periodoActual, fijarPeriodo, infoMeta, infoFuente, rutaDex, tierDeUso, TIERS_DE_USO, explicacionGruposDeUso, especie } from "../meta.js";
import { escapar, porcentaje, sprite, listaTipos, selectorDeFormatos, selectorDePeriodo, conectarPeriodo, lineaActualizado, rangoDeFechas, nombreMes, cabeceraDetalle, tituloSeccion, barra } from "../ui.js";
import { activar, sinMovimiento } from "../movimiento.js";

export async function pintar(vista, argumentos) {
  const { vigente } = argumentos;
  const formato = await cargarFormato();
  const reciente = await cargarRecientes(formato.id);   // null: este formato no tiene la capa de los últimos 7 días
  if (!vigente()) return;
  const fuente = infoFuente(formato);
  const semana = Boolean(reciente) && periodoActual() === "semana";
  const torneos = `${fuente.nTorneos != null ? fuente.nTorneos.toLocaleString("en-US") : ""} tournaments`.trim();
  const lista = semana ? reciente.pokemon : formato.pokemon;
  let desde = 1;
  const grupos = TIERS_DE_USO.map((t) => {
    const grupo = { ...t, desde, pokemon: lista.filter((p) => tierDeUso(p.puesto) === t.tier) };
    desde = t.hasta + 1;
    return grupo;
  }).filter((g) => g.pokemon.length);
  const maximo = Math.max(...lista.map((p) => p.uso), 1);

  vista.innerHTML = `
    <div class="v-tierlist">
      ${cabeceraDetalle({ titulo: "Rankings", subtitulo: `${escapar(formato.nombre)} · ${semana ? "Last 7 days" : fuente.torneos ? escapar(torneos) : escapar(nombreMes(fuente.mes))}` })}
      ${selectorDeFormatos()}
      ${reciente ? selectorDePeriodo(semana ? "semana" : "mes") : ""}
      ${lineaActualizado(semana ? reciente.generado : (fuente.actualizado ?? infoMeta().generado))}

      <nav class="grupos-nav" aria-label="Groups">
        ${grupos.map((g, i) => `<button type="button" class="boton secundario" data-ir="${g.tier}" aria-pressed="${i === 0}">${g.tier}</button>`).join("")}
      </nav>

      <p class="nota explicacion">
        ${semana ? textoSemana(reciente)
          : fuente.torneos ? `Ranked by the share of tournament teams that carry each Pokémon, across ${escapar(torneos)} from Limitless. There are no EV spreads in tournament data.`
          : `Ranked by Smogon usage across ${formato.partidas.toLocaleString("en-US")} battles (rated ${formato.corte}+).`}
        Letters are usage rank groups, not official tiers:
        ${explicacionGruposDeUso(formato.usoMinimo).map((g) => `${g.tier}: ${escapar(g.texto)}`).join(" · ")}.
      </p>

      ${grupos.map((g) => `
        <section class="seccion grupo" id="grupo-${g.tier}" data-t="${g.tier}">
          ${tituloSeccion(titulo(g, formato.pokemon.length))}
          <ul class="tarjeta sin-relleno lista">
            ${g.pokemon.map((p) => `
              <li><a class="fila-pokemon" href="${rutaDex(p.nombre)}">
                <span class="puesto">${p.puesto}</span>
                ${sprite(p.nombre)}
                <span class="fila-pokemon-texto">
                  <span class="fila-pokemon-nombre">${escapar(p.nombre)}</span>
                  <span class="tipos">${listaTipos(especie(p.nombre)?.tipos ?? [])}</span>
                </span>
                <span class="fila-pokemon-dato">${porcentaje(p.uso)}</span>
                <span class="uso-barra">${barra(p.uso / maximo)}</span>
              </a></li>`).join("")}
          </ul>
        </section>`).join("")}

      <p class="nota pie">${lista.length} Pokémon · ${fuente.torneos && !semana ? escapar(torneos) : `${(semana ? reciente.partidas : formato.partidas).toLocaleString("en-US")} battles`}</p>
    </div>`;

  conectarPeriodo(vista, fijarPeriodo, () => pintar(vista, argumentos));

  // Los botones S A B C D llevan a su grupo; el del grupo que se ve se marca
  const botones = [...vista.querySelectorAll(".grupos-nav button")];
  const marcar = (tier) => botones.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.ir === tier)));
  botones.forEach((b) => b.addEventListener("click", () => {
    marcar(b.dataset.ir);
    vista.querySelector(`#grupo-${b.dataset.ir}`)?.scrollIntoView({ behavior: sinMovimiento() ? "auto" : "smooth", block: "start" });
  }));
  if ("IntersectionObserver" in window) {
    const observador = new IntersectionObserver((entradas) => entradas.forEach((e) => {
      if (e.isIntersecting) marcar(e.target.dataset.t);
    }), { rootMargin: "-20% 0px -70% 0px" });
    vista.querySelectorAll(".grupo").forEach((s) => observador.observe(s));
  }

  activar(vista);
}

// «Group S · #1 to #6», con los cortes de TIERS_DE_USO; el último grupo llega hasta el final de la lista
function titulo(grupo, total) {
  const hasta = Math.min(grupo.hasta, total);
  return `Group ${grupo.tier} · ${grupo.desde === hasta ? `#${hasta}` : `#${grupo.desde} to #${hasta}`}`;
}

// La muestra de los últimos 7 días: cuántas partidas, de qué fechas y con qué rating, y el aviso si es pequeña
function textoSemana(reciente) {
  const rating = reciente.ratingMinimo ? `, rated ${reciente.ratingMinimo}+` : "";
  const pequena = reciente.muestraPequena ? " Small sample: with so few battles the ranking can change a lot from one day to the next." : "";
  return `Ranked by the share of teams that include each Pokémon in ${reciente.partidas.toLocaleString("en-US")} public Pokémon Showdown replays
    (${escapar(rangoDeFechas(reciente.desde, reciente.hasta))}${rating}). Only replays that players made public are counted.${pequena}`;
}
