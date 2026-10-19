// Pantalla Inicio: resumen del mes, lo más usado, tus combates, accesos rápidos, núcleos, repetición destacada y búsquedas recientes
import * as meta from "../meta.js";
import { cargarFormato, cargarRecientes, periodoActual, fijarPeriodo, infoMeta, infoFuente, especie, rutaDex, tierDeUso, nombreDesdeClave, nombreDeClave } from "../meta.js";
import { leer, resumenCombates } from "../estado.js";
import { buscarRepeticiones, urlRepeticion } from "../showdown.js";
import { icono, escapar, sprite, enlaceExterno, selectorDeFormatos, notaDeTorneos, selectorDePeriodo, conectarPeriodo, lineaActualizado, rangoDeFechas, tituloSeccion } from "../ui.js";

// Cifras en inglés: «48.2%». Los usos de los datos vienen ya en % (48.2 = 48,2 %)
const cifra = (n, decimales = 1) => `${n.toLocaleString("en-US", { maximumFractionDigits: decimales })}%`;
const mesEnIngles = (mes) => {
  const [anio, numero] = mes.split("-").map(Number);
  return new Date(anio, numero - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
};
const lugares = (n) => `${n} ${n === 1 ? "place" : "places"}`;

// Iconos de los accesos rápidos que no están en icono(): mismo estilo (línea, 20 px, currentColor)
const svg = (trazos) => `<svg class="icono" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${trazos}</svg>`;
const iconoVelocidad = svg(`<path d="M4.9 19a9 9 0 1 1 14.2 0"/><path d="M12 14l4-4"/>`);
const iconoCalculadora = svg(`<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>`);
const iconoPregunta = svg(`<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>`);

export async function pintar(vista, { vigente }) {
  const formato = await cargarFormato();
  const historico = await leerHistorico(formato.id);
  const reciente = await cargarRecientes(formato.id);   // null: este formato no tiene la capa de los últimos 7 días
  if (!vigente()) return;
  const { perfil, recientes } = leer();
  const fuente = infoFuente(formato);
  const mes = fuente.mes ? mesEnIngles(fuente.mes) : "";

  vista.innerHTML = `
    <div class="v-inicio">
      ${cabecera(perfil)}
      ${selectorDeFormatos()}

      <section class="seccion" id="resumen"></section>

      <section class="seccion" id="mas-usado"></section>

      ${resumenDeCombates()}

      <section class="seccion">
        ${tituloSeccion("Quick tools")}
        <div class="tarjeta sin-relleno herramientas">
          <a class="herramienta" href="#/velocidades">${iconoVelocidad}<span>Speed tiers</span></a>
          <a class="herramienta" href="#/calc">${iconoCalculadora}<span>Damage calc</span></a>
          <a class="herramienta" href="#/quiz">${iconoPregunta}<span>Quiz</span></a>
        </div>
      </section>

      <section class="seccion">
        ${tituloSeccion("Tournaments")}
        <ul class="tarjeta sin-relleno lista">
          <li><a class="fila" href="#/torneos">
            <div class="fila-texto"><p class="fila-titulo">Tournaments</p><p class="fila-sub">Live and recent events, top 8 and team lists</p></div>
            ${icono("flecha-derecha")}
          </a></li>
          <li><a class="fila" href="#/equipos-top">
            <div class="fila-texto"><p class="fila-titulo">Top Teams</p><p class="fila-sub">The best tournament teams, by archetype</p></div>
            ${icono("flecha-derecha")}
          </a></li>
          <li><a class="fila" href="#/uso-equipos">
            <div class="fila-texto"><p class="fila-titulo">Team Usage</p><p class="fila-sub">Win rate of each 6-Pokémon team</p></div>
            ${icono("flecha-derecha")}
          </a></li>
        </ul>
      </section>

      <section class="seccion" id="nucleos"></section>

      <section class="seccion" id="repeticion" aria-label="Featured replay">
        ${tituloSeccion("Featured replay")}
        <div class="tarjeta"><p class="nota">Looking for battles…</p></div>
      </section>

      ${recientes.length ? `
        <section class="seccion">
          ${tituloSeccion("Recent searches")}
          <div class="recientes">
            ${recientes.map((clave) => {
              const nombre = nombreDesdeClave(clave);
              const nombreShowdown = nombreDeClave(clave) ?? nombre;
              return `<a class="chip" href="#/dex/${encodeURIComponent(clave)}">${sprite(nombreShowdown, { id: especie(nombreShowdown)?.id })}<span>${escapar(nombre)}</span></a>`;
            }).join("")}
          </div>
        </section>` : ""}

      <p class="nota pie">
        Usage: ${fuente.torneos
          ? `Limitless (${fuente.nTorneos != null ? `${fuente.nTorneos.toLocaleString("en-US")} tournaments` : "tournaments"}, teams only: no spreads)`
          : `Smogon (${escapar(mes)}, games with a rating of ${formato.corte} or higher)`} · Pokédex: PokeAPI ·
        Battles: Pokémon Showdown. Gargraph is an unofficial educational project.
      </p>
    </div>`;

  // «Most used» se repinta solo al cambiar de periodo, para que la pantalla no salte
  const masUsado = vista.querySelector("#mas-usado");
  const pintarMasUsado = () => {
    const semana = Boolean(reciente) && periodoActual() === "semana";
    // L8: la frase de arriba y los núcleos siguen el periodo elegido (los núcleos solo existen del mes: se rotulan así)
    vista.querySelector("#resumen").innerHTML = seccionResumen(formato, historico, reciente, fuente, semana);
    vista.querySelector("#nucleos").innerHTML = seccionNucleos(formato, semana);
    masUsado.innerHTML = seccionMasUsado(formato, reciente, mes, fuente);
    conectarPeriodo(masUsado, fijarPeriodo, pintarMasUsado);
  };
  pintarMasUsado();

  // Las repeticiones son de partidas de Showdown: un formato de torneos no las tiene
  if (fuente.torneos) vista.querySelector("#repeticion").remove();
  else repeticionDestacada(vista.querySelector("#repeticion"), formato, vigente);
}

// El resumen de arriba: el del mes (con su histórico) o, con «Last 7 days», lo que dicen las repeticiones de esa semana
function seccionResumen(formato, historico, reciente, fuente, semana) {
  if (!semana) {
    return `${tituloSeccion(fuente.torneos ? `Tournament meta in ${escapar(formato.nombre)}` : `Latest month in ${escapar(formato.nombre)}${fuente.mes ? ` (${escapar(mesEnIngles(fuente.mes))})` : ""}`)}
        ${resumenDelMes(formato, historico)}`;
  }
  const primero = reciente.pokemon[0];
  return `${tituloSeccion(`Last 7 days in ${escapar(formato.nombre)}`)}
        <div class="tarjeta mes">
          <ul class="mes-frases"><li>${escapar(`${primero.nombre} is #1 on ${cifra(primero.uso)} of teams in ${reciente.partidas.toLocaleString("en-US")} public Showdown replays.`)}</li></ul>
          ${sprite(primero.nombre, { clase: "grande" })}
        </div>`;
}

function seccionNucleos(formato, semana) {
  const nucleos = formato.nucleos ?? [];
  if (!nucleos.length) return "";
  return `${tituloSeccion(semana ? "Cores this month" : "Cores")}
        <div class="nucleos">${nucleos.map(tarjetaNucleo).join("")}</div>
        <p class="nota">The trios that appear together most often in ${escapar(formato.corto ?? formato.nombre)}${semana ? " this month (Smogon); there is no weekly data for trios" : ""}.${nucleos.some((n) => n.cota) ? " The percentage is that of the least frequent pair in each trio, so the trio is never above it." : " The percentage is the share of teams that carry all three."}</p>`;
}

// Los 4 Pokémon más usados: del mes de Smogon o, si el formato tiene esa capa y se elige, de los últimos 7 días de Showdown
function seccionMasUsado(formato, reciente, mes, fuente) {
  const semana = Boolean(reciente) && periodoActual() === "semana";
  const lista = semana ? reciente.pokemon : formato.pokemon;
  const grupos = "The letters are groups by usage rank, not official tiers.";
  const nota = semana
    ? `${escapar(formato.nombre)}: share of teams with each Pokémon in ${reciente.partidas.toLocaleString("en-US")} public Showdown replays
       (${escapar(rangoDeFechas(reciente.desde, reciente.hasta))}${reciente.ratingMinimo ? `, rated ${reciente.ratingMinimo}+` : ""}).
       ${reciente.muestraPequena ? "Small sample: with so few battles the ranking can change a lot. " : ""}${grupos}`
    : fuente.torneos ? `${escapar(formato.nombre)}: share of tournament teams with each Pokémon. ${grupos}`
    : `${escapar(formato.nombre)} usage in ${escapar(mes)}. ${grupos}`;
  return `
    ${tituloSeccion("Most used", `<a class="boton texto" href="#/tierlist">View full rankings</a>`)}
    ${reciente ? selectorDePeriodo(semana ? "semana" : "mes") : ""}
    ${lineaActualizado(semana ? reciente.generado : (fuente.actualizado ?? infoMeta().generado))}
    <ul class="tarjeta sin-relleno lista">${lista.slice(0, 4).map(filaUso).join("")}</ul>
    <p class="nota">${nota}</p>
    ${semana ? "" : notaDeTorneos(formato)}`;
}

// El histórico lo escribe otro agente: sin la función o sin fichero, la pantalla sigue con lo del mes actual
async function leerHistorico(id) {
  if (typeof meta.cargarHistorico !== "function") return null;
  try {
    return (await meta.cargarHistorico(id)) ?? null;
  } catch {
    return null;
  }
}

function cabecera(perfil) {
  const avatar = perfil.avatar && especie(perfil.avatar) ? sprite(perfil.avatar) : icono("perfil");
  return `
    <header class="cabecera grande">
      <div class="cabecera-texto"><h1 class="cabecera-titulo">Gargraph</h1></div>
      <div class="cabecera-acciones">
        <a class="boton-icono" href="#/dex" aria-label="Search a Pokémon">${icono("buscar")}</a>
        <a class="boton-icono" href="#/perfil" aria-label="Profile">${avatar}</a>
      </div>
    </header>`;
}

// «This month in…»: frases con plantillas a partir del uso actual y del histórico
function resumenDelMes(formato, historico) {
  const torneos = infoFuente(formato).torneos;
  const primero = formato.pokemon[0];
  const frases = [];
  const anterior = mesAnterior(formato, historico);

  if (primero) {
    const antes = anterior && [...anterior.puestos].find(([, puesto]) => puesto === 1)?.[0];
    const usoAntes = anterior?.usos.get(primero.nombre);
    if (!anterior || antes == null) {
      frases.push(torneos ? `${primero.nombre} is #1: it is on ${cifra(primero.uso)} of tournament teams.` : `${primero.nombre} is #1 at ${cifra(primero.uso)} usage.`);
    } else if (antes === primero.nombre) {
      const cambio = usoAntes != null ? Math.round((primero.uso - usoAntes) * 10) / 10 : 0;
      const detalle = cambio === 0 ? "" : `, ${cambio > 0 ? "up" : "down"} ${Math.abs(cambio).toLocaleString("en-US")} percentage points from last month`;
      frases.push(`${primero.nombre} is still #1 at ${cifra(primero.uso)} usage${detalle}.`);
    } else {
      frases.push(`${primero.nombre} took #1 from ${antes} with ${cifra(primero.uso)} usage.`);
    }
  }

  if (anterior) {
    // Solo cuentan los que estaban los dos meses: si no, no se sabe cuántos puestos han cambiado
    const cambios = formato.pokemon
      .filter((p) => anterior.puestos.has(p.nombre))
      .map((p) => ({ nombre: p.nombre, ahora: p.puesto, delta: anterior.puestos.get(p.nombre) - p.puesto }));
    const sube = cambios.filter((c) => c.delta > 0).sort((a, b) => b.delta - a.delta || a.ahora - b.ahora)[0];
    const baja = cambios.filter((c) => c.delta < 0).sort((a, b) => a.delta - b.delta || a.ahora - b.ahora)[0];
    if (sube) frases.push(`${sube.nombre} climbed ${lugares(sube.delta)}, to #${sube.ahora}.`);
    if (baja) frases.push(`${baja.nombre} dropped ${lugares(-baja.delta)}, to #${baja.ahora}.`);
  }

  // Del núcleo solo se sabe el mes actual: el histórico guarda el uso de cada Pokémon, no las parejas
  const nucleo = formato.nucleos?.[0];
  if (nucleo) {
    // «cota»: el dato es el de la pareja menos frecuente, un máximo; sin «cota» (torneos) es el % real de equipos con los tres
    frases.push(nucleo.cota
      ? `The most common core is ${nucleo.miembros.join(" + ")}; no more than ${cifra(nucleo.juntos)} of teams carry all three.`
      : `The most common core is ${nucleo.miembros.join(" + ")}, on ${cifra(nucleo.juntos)} of teams.`);
  }

  return `
    <div class="tarjeta mes">
      <ul class="mes-frases">${frases.map((f) => `<li>${escapar(f)}</li>`).join("")}</ul>
      ${primero ? sprite(primero.nombre, { clase: "grande" }) : ""}
    </div>
    ${anterior || torneos ? "" : `<p class="nota">There is no earlier month to compare with yet, so this is only what is known about the current month.</p>`}`;
}

// Puestos y usos del mes anterior al actual según el histórico; null si no hay histórico o mes anterior
function mesAnterior(formato, historico) {
  const meses = historico?.meses ?? [];
  const posicion = meses.indexOf(formato.mes);
  if (posicion < 1) return null;
  const anterior = meses[posicion - 1];
  const puestos = new Map();
  const usos = new Map();
  for (const [nombre, serie] of Object.entries(historico.pokemon ?? {})) {
    const entrada = serie.find((e) => e.mes === anterior);
    if (!entrada) continue;
    puestos.set(nombre, entrada.puesto);
    usos.set(nombre, entrada.uso * 100); // en el histórico el uso es una fracción (0,48); en el formato, un % (48)
  }
  return puestos.size ? { puestos, usos } : null;
}

function filaUso(p) {
  return `
    <li><a class="fila-pokemon" href="${rutaDex(p.nombre)}">
      ${sprite(p.nombre)}
      <span class="fila-pokemon-texto"><span class="fila-pokemon-nombre">${escapar(p.nombre)}</span></span>
      <span class="insignia" title="Group by usage rank">${tierDeUso(p.puesto)}</span>
      <span class="fila-pokemon-dato">${cifra(p.uso)}</span>
    </a></li>`;
}

function tarjetaNucleo(nucleo) {
  return `
    <div class="tarjeta nucleo">
      <div class="nucleo-trio">
        ${nucleo.miembros.map((m) => `
          <a href="${rutaDex(m)}" aria-label="${escapar(m)}">${sprite(m, { clase: "mediano" })}</a>`).join("")}
      </div>
      <p class="nucleo-dato">${nucleo.cota ? "Up to " : ""}${cifra(nucleo.juntos)} of teams</p>
    </div>`;
}

// Victorias, derrotas, porcentaje y racha de los combates reales (los simulados no cuentan)
function resumenDeCombates() {
  const r = resumenCombates();
  let contenido;
  if (!r.total) {
    contenido = `
      <a class="fila" href="#/matches">
        <div class="fila-texto">
          <p class="fila-titulo">No battles yet</p>
          <p class="fila-sub">Log your first battle in Matches.</p>
        </div>
        ${icono("flecha-derecha")}
      </a>`;
  } else {
    const racha = r.racha && r.racha.cuantos >= 2
      ? `<span class="insignia ${r.racha.tipo === "victoria" ? "exito" : "error"}">${r.racha.cuantos}${r.racha.tipo === "victoria" ? "W" : "L"} streak</span>`
      : "";
    contenido = `
      <a class="fila combates" href="#/matches">
        <div class="fila-texto">
          <p class="fila-titulo">${r.victorias}W – ${r.derrotas}L${r.total > r.victorias + r.derrotas ? ` – ${r.total - r.victorias - r.derrotas}T` : ""}${r.porcentaje !== null ? ` · ${r.porcentaje}% win rate` : ""}</p>
        </div>
        ${racha}
        ${icono("flecha-derecha")}
      </a>`;
  }
  return `
    <section class="seccion">
      ${tituloSeccion("Your battles")}
      <div class="tarjeta sin-relleno">${contenido}</div>
    </section>`;
}

// Showdown no tiene partidas «en directo» públicas por API, pero sí las repeticiones recientes:
// se elige la de rating más alto entre las últimas que se han subido del formato.
async function repeticionDestacada(contenedor, formato, vigente) {
  const tarjeta = contenedor.querySelector(".tarjeta");
  try {
    const lista = await buscarRepeticiones({ formato: formato.id });
    if (!vigente()) return;
    const elegida = [...lista].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
    if (!elegida) {
      contenedor.remove();
      return;
    }
    const [uno, dos] = elegida.players ?? [];
    const datos = [elegida.rating ? `Rating ${elegida.rating}` : "", formato.nombre, hace(elegida.uploadtime * 1000)]
      .filter(Boolean).join(" · ");
    tarjeta.innerHTML = `
      <p class="repeticion-jugadores">${escapar(uno ?? "?")} vs. ${escapar(dos ?? "?")}</p>
      <div class="repeticion-pie">
        <p class="nota">${escapar(datos)}</p>
        ${enlaceExterno(urlRepeticion(elegida.id), "Watch replay", "boton secundario pequeno")}
      </div>`;
  } catch {
    if (!vigente()) return;
    tarjeta.innerHTML = `<p class="nota">The featured Pokémon Showdown replay will appear when you are back online.</p>`;
  }
}

function hace(milisegundos) {
  const minutos = Math.round((Date.now() - milisegundos) / 60_000);
  if (minutos < 1) return "just now";
  if (minutos < 60) return `${minutos} min ago`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `${horas} h ago`;
  const dias = Math.round(horas / 24);
  if (dias < 30) return `${dias} ${dias === 1 ? "day" : "days"} ago`;
  return new Date(milisegundos).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}
