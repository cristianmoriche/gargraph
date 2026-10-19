// Pantalla Dex: el buscador (#/dex) y la ficha de un Pokémon (#/dex/<pokemon>, PokeAPI) con sus datos competitivos (Smogon)
import { buscarPokemon, NoEncontrado } from "../pokeapi.js";
import {
  cargarFormato, infoMeta, infoFuente, esDeTorneos, formatoActual, claveDeBusqueda, nombreDeClave, nombreDesdeClave, entradaParaDex, especie, rutaDex,
  tierDeUso, estadisticasReales, valoresDeSpread, cargarHistorico,
  setMasUsado, setDeRespaldo, TIERS_DE_USO, nombresDeEspecies, dic, maximoPorEstadistica, maximoTotal, formatoTieneTera, aId, repartoValido,
} from "../meta.js";
import { calcularDanoRecibido, agruparPorMultiplicador, superefectivoContra, nombreTipo } from "../tipos.js";
import { leer, guardar, apuntarReciente, esFavorito, cambiarFavorito, nuevoId } from "../estado.js";
import {
  escapar, numeroPokedex, insigniaTipo, listaTipos, sprite, cabeceraDetalle, tituloSeccion,
  cargando, aviso, vacio, avisar, rellenarLista, icono, barra, notaDeTorneos,
} from "../ui.js";
import { activar, rebotar } from "../movimiento.js";

const ESTADISTICAS = ["HP", "Attack", "Defense", "Sp. Atk", "Sp. Def", "Speed"];
const ABREVIATURAS_EN = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"];
const ESTADISTICA_MAXIMA = 150; // la barra se llena entera con 150 de base; más de eso se queda llena
const ULTIMO_NUMERO = 1025;     // último número de la Pokédex nacional
const unir = new Intl.ListFormat("en", { type: "conjunction" });

// Textos en inglés: números con punto decimal y nombres oficiales (los del diccionario traen también el español)
const pct = (n) => `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
const dec = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nombreMovimiento = (id) => dic().movimientos[id]?.en ?? id;
const nombreObjeto = (id) => dic().objetos[id]?.en ?? id;
const nombreHabilidad = (id) => dic().habilidades[id]?.en ?? id;
const nombreMes = (mes, estilo = "long") => {
  const [anio, numero] = mes.split("-").map(Number);
  return new Date(anio, numero - 1, 1).toLocaleDateString("en-US", { month: estilo, year: estilo === "long" ? "numeric" : undefined });
};
const textoReparto = (naturaleza, valores) => {
  const partes = valores.map((v, i) => (v ? `${v} ${ABREVIATURAS_EN[i]}` : null)).filter(Boolean);
  return `${partes.join(" / ") || "No investment"} (${naturaleza})`;
};
/** Grupos de uso en inglés, leídos de TIERS_DE_USO: «top 6», «ranks 7 to 15»… */
function explicacionGrupos(usoMinimo) {
  let desde = 1;
  return TIERS_DE_USO.map(({ tier, hasta }) => {
    const texto = hasta === Infinity ? `the rest${usoMinimo ? `, with at least ${usoMinimo}% usage` : ""}`
      : desde === 1 ? `top ${hasta}` : `ranks ${desde} to ${hasta}`;
    desde = hasta + 1;
    return { tier, texto };
  });
}

export async function pintar(vista, parametros) {
  if (!parametros.clave) return pintarBuscador(vista, parametros.vigente);
  return pintarFicha(vista, parametros);
}

/** ♀ y ♂ no se pueden escribir en una dirección ni en la PokeAPI: «Nidoran♀» → «Nidoran-f». */
function limpiarBusqueda(texto) {
  return texto.replaceAll("♀", "-f").replaceAll("♂", "-m");
}

// ---------------------------------------------------------------------------
// El buscador

// Abrir #/dex no apunta nada en «Recientes»: solo se apunta lo que se abre de verdad (en pintarFicha)
async function pintarBuscador(vista, vigente) {
  const { favoritos, recientes } = leer();
  // El uso en el formato elegido para las filas de recientes; sin datos, las filas salen sin porcentaje
  let formato = null;
  try {
    formato = await cargarFormato();
  } catch {
    formato = null;
  }
  // Quién sube y quién baja: sale del histórico (cargarHistorico no falla: sin fichero devuelve null)
  const tendencia = formato ? calcularTendencia(await cargarHistorico(formato.id)) : null;
  if (!vigente()) return;
  vista.innerHTML = `
    <div class="v-dex">
      <header class="cabecera grande"><div class="cabecera-texto"><h1 class="cabecera-titulo">Dex</h1></div></header>
      <form class="dex-buscar" role="search" id="buscador">
        <label class="buscador">
          ${icono("buscar")}
          <input id="busqueda" type="search" list="lista-pokemon" placeholder="Search a Pokémon"
            aria-label="Search a Pokémon by name or Pokédex number" autocomplete="off" autocapitalize="none"
            spellcheck="false" enterkeyhint="search">
        </label>
        <button type="button" class="boton-icono borde" id="aleatorio" aria-label="Random Pokémon" title="Random Pokémon">${icono("azar")}</button>
      </form>
      ${favoritos.length ? `
        <section class="seccion">
          ${tituloSeccion("Favorites")}
          <div class="dex-favoritos">${favoritos.map(tarjetaFavorito).join("")}</div>
        </section>` : ""}
      ${recientes.length ? `
        <section class="seccion">
          ${tituloSeccion("Recently viewed")}
          <ul class="tarjeta sin-relleno lista">${recientes.map((clave) => filaReciente(clave, formato)).join("")}</ul>
        </section>` : ""}
      ${!favoritos.length && !recientes.length ? vacio("Nothing searched yet", "Type a name or a Pokédex number, or tap the dice for a random one. Your favorites and recent searches will show up here.") : ""}
      ${tendencia ? bloqueTendencia(tendencia, formato) : ""}
      <section class="seccion">
        ${tituloSeccion("Tools")}
        <ul class="tarjeta sin-relleno lista">
          ${[["#/torneos", "Tournaments", "Live and recent events, top 8 and team lists"], ["#/equipos-top", "Top Teams", "The best tournament teams, by archetype"], ["#/uso-equipos", "Team Usage", "Win rate of each 6-Pokémon team"], ["#/velocidades", "Speed tiers", "Who outspeeds whom in this format"], ["#/quiz", "Quiz", "Test what you know about the meta"],
            ["#/calc", "Damage calc", "How much damage a move does"]].map(([ruta, titulo, sub]) => `
          <li><a class="fila" href="${ruta}">
            <div class="fila-texto"><p class="fila-titulo">${titulo}</p><p class="fila-sub">${sub}</p></div>
            ${icono("flecha-derecha")}
          </a></li>`).join("")}
        </ul>
      </section>
    </div>`;
  rellenarLista("lista-pokemon", nombresDeEspecies());
  conectarBuscador(vista);
}

function tarjetaFavorito(clave) {
  const nombre = nombreDesdeClave(clave);
  return `<a class="dex-favorito" href="#/dex/${encodeURIComponent(clave)}">${sprite(nombre, { clase: "mediano" })}<span>${escapar(nombre)}</span></a>`;
}

const mesSiguiente = (mes) => {
  const [anio, numero] = mes.split("-").map(Number);
  return numero === 12 ? `${anio + 1}-01` : `${anio}-${String(numero + 1).padStart(2, "0")}`;
};

/**
 * Los 3 que más suben y los 3 que más bajan de uso respecto al mes anterior (diferencia en puntos porcentuales).
 * null si no hay histórico, si no hay un mes anterior justo antes del último o si nadie cambia.
 */
function calcularTendencia(historico) {
  const meses = historico?.meses ?? [];
  const [anterior, actual] = meses.slice(-2);
  if (!anterior || mesSiguiente(anterior) !== actual) return null;
  const cambios = [];
  for (const [nombre, entradas] of Object.entries(historico.pokemon)) {
    const ahora = entradas.find((e) => e.mes === actual);
    const antes = entradas.find((e) => e.mes === anterior);
    if (ahora && antes) cambios.push({ nombre, cambio: Math.round((ahora.uso - antes.uso) * 1000) / 10 });
  }
  const suben = cambios.filter((c) => c.cambio > 0).sort((a, b) => b.cambio - a.cambio).slice(0, 3);
  const bajan = cambios.filter((c) => c.cambio < 0).sort((a, b) => a.cambio - b.cambio).slice(0, 3);
  return suben.length || bajan.length ? { actual, anterior, suben, bajan } : null;
}

function bloqueTendencia({ actual, anterior, suben, bajan }, formato) {
  const grupo = (titulo, lista, clase) => lista.length ? `
    <p class="dex-tendencia-titulo">${titulo}</p>
    <ul class="lista">${lista.map(({ nombre, cambio }) => `
      <li><a class="fila-pokemon" href="${rutaDex(nombre)}">
        ${sprite(nombre)}
        <span class="fila-pokemon-texto"><span class="fila-pokemon-nombre">${escapar(nombre)}</span></span>
        <span class="fila-pokemon-dato dex-cambio ${clase}">${cambio > 0 ? "+" : "−"}${pct(Math.abs(cambio))}</span>
      </a></li>`).join("")}</ul>` : "";
  return `
    <section class="seccion">
      ${tituloSeccion("Trending this month")}
      <div class="tarjeta sin-relleno dex-tendencia">
        ${grupo("Rising", suben, "sube")}
        ${grupo("Falling", bajan, "baja")}
      </div>
      <p class="nota dex-nota">${escapar(formato.nombre)}: usage in ${nombreMes(actual)} compared with ${nombreMes(anterior)}, in percentage points.</p>
    </section>`;
}

// Recientes: el más reciente arriba. El porcentaje es el uso en el formato elegido, si hay datos
function filaReciente(clave, formato) {
  const nombre = nombreDesdeClave(clave);
  const nombreShowdown = nombreDeClave(clave);
  const tipos = especie(nombreShowdown ?? "")?.tipos ?? [];
  const uso = formato && nombreShowdown ? entradaParaDex(formato, nombreShowdown).elegida?.uso : null;
  return `
    <li><a class="fila-pokemon" href="#/dex/${encodeURIComponent(clave)}">
      ${sprite(nombre)}
      <span class="fila-pokemon-texto">
        <span class="fila-pokemon-nombre">${escapar(nombre)}</span>
        ${tipos.length ? `<span class="tipos">${listaTipos(tipos)}</span>` : ""}
      </span>
      ${uso != null ? `<span class="fila-pokemon-dato">${pct(uso)}</span>` : ""}
    </a></li>`;
}

function conectarBuscador(vista) {
  const formulario = vista.querySelector("#buscador");
  const campo = vista.querySelector("#busqueda");
  formulario.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const texto = campo.value.trim();
    if (!texto) {
      avisar("Type a Pokémon's name or number");
      return;
    }
    campo.blur(); // cierra el teclado del móvil
    location.hash = `#/dex/${encodeURIComponent(claveDeBusqueda(limpiarBusqueda(texto)))}`;
  });
  vista.querySelector("#aleatorio").addEventListener("click", () => {
    location.hash = `#/dex/${1 + Math.floor(Math.random() * ULTIMO_NUMERO)}`;
  });
}

// ---------------------------------------------------------------------------
// La ficha

async function pintarFicha(vista, { clave, forma, vigente }) {
  const busqueda = claveDeBusqueda(limpiarBusqueda(clave));
  const resumen = infoMeta().formatos.find((f) => f.id === formatoActual());

  vista.innerHTML = `
    <div class="v-dex">
      ${cabeceraDetalle({ titulo: "Pokémon", subtitulo: escapar(resumen.nombre), volver: "#/dex" })}
      <div id="dex-contenido">${cargando("Searching the Pokédex…")}</div>
    </div>`;

  const contenido = vista.querySelector("#dex-contenido");
  if (!/^[a-z0-9-]+$/.test(busqueda)) {
    contenido.innerHTML = aviso("Use only letters, numbers or hyphens (example: mr-mime).");
    return;
  }

  let pokemon;
  let formato;
  try {
    [pokemon, formato] = await Promise.all([buscarPokemon(busqueda), cargarFormato()]);
  } catch (error) {
    if (!vigente()) return;
    if (error instanceof NoEncontrado) {
      contenido.innerHTML = aviso(`No Pokémon matches the name or number "${busqueda}".`,
        "Try its English name (e.g. iron-valiant) or its Pokédex number.");
    } else {
      // Si lo que falla es el formato (sin conexión y nunca abierto), lo explica app.js con la salida al anterior
      if (await cargarFormato().then(() => false, () => true)) throw error;
      console.error(error);
      contenido.innerHTML = aviso("Could not reach PokeAPI. Check your Internet connection.");
    }
    return;
  }
  if (!vigente()) return;

  // Si se buscó por número (716) o por el nombre en español, la dirección pasa a llevar la clave (#/dex/xerneas)
  if (pokemon.clave !== clave) {
    history.replaceState(history.state, "", `#/dex/${pokemon.clave}${forma ? `?forma=${encodeURIComponent(forma)}` : ""}`);
  }
  apuntarReciente(pokemon.clave);

  // Formas que la PokeAPI aún no tiene (Arceus-Fuego, Genesect con disco…): tipos y estadísticas de Showdown
  const formaAproximada = forma && especie(forma)?.aproximada ? especie(forma) : null;
  if (formaAproximada) {
    pokemon.tipos = formaAproximada.tipos;
    pokemon.estadisticas = pokemon.estadisticas.map((s, i) => ({ ...s, valor: formaAproximada.base[i] }));
    pokemon.esFormaBase = false;
  }

  const nombreShowdown = forma ?? nombreDeClave(pokemon.clave);
  const { formas, elegida } = entradaParaDex(formato, nombreShowdown);
  const historico = await cargarHistorico(formato.id);
  if (!vigente()) return;
  const estado = { pokemon, formato, nombreShowdown, formas, elegida, historico, aproximada: Boolean(formaAproximada) };

  contenido.innerHTML = ficha(estado);
  conectarFicha(vista, estado);
  activar(contenido);
  if (!elegida) buscarEnOtrosFormatos(vista, estado, vigente);
}

function ficha(estado) {
  const { pokemon } = estado;
  const sePuedeOir = pokemon.grito && document.createElement("audio").canPlayType('audio/ogg; codecs="vorbis"');
  const favorito = esFavorito(pokemon.clave);
  return `
    ${cabeceraFicha(estado)}
    <div class="botones-fila dex-acciones">
      <button type="button" id="favorito" class="boton secundario" aria-pressed="${favorito}">${icono(favorito ? "estrella-llena" : "estrella")}<span>Favorite</span></button>
      <button type="button" id="al-equipo" class="boton secundario">${icono("añadir")}<span>Add to team</span></button>
      ${sePuedeOir ? `<button type="button" id="grito" class="boton secundario">${icono("sonido")}<span>Cry</span></button>` : ""}
    </div>
    <a class="boton bloque dex-calc" href="#/calc?a=${encodeURIComponent(estado.elegida?.nombre ?? estado.nombreShowdown ?? nombreDesdeClave(pokemon.clave))}">Damage calc</a>
    <section class="seccion">${tituloSeccion("Base stats")}${tarjetaEstadisticas(estado)}</section>
    <section class="seccion">${tituloSeccion("Type matchups")}${tarjetaEficacia(estado)}</section>
    <div id="competitivo">${competitivo(estado)}</div>`;
}

function cabeceraFicha({ pokemon, formato, elegida, nombreShowdown }) {
  const e = especie(nombreShowdown);
  const nombre = nombreShowdown ?? nombreDesdeClave(pokemon.clave);
  // El tier de Smogon es el de la ladder de Gen 9 individual: solo significa algo en Gen 9 OU (L18)
  const tier = formato.id === "gen9ou"
    ? (e?.tier ? `Smogon Gen 9 tier: ${e.tier}` : e?.tierNatDex ? `Smogon National Dex tier: ${e.tierNatDex}` : "")
    : "";
  const etiquetas = [...(elegida?.roles ?? []), tier].filter(Boolean);
  return `
    <section class="tarjeta dex-ficha">
      <div class="dex-ficha-fila">
        <span class="dex-arte">${pokemon.imagen
          ? `<img src="${escapar(pokemon.imagen)}" alt="Official artwork of ${escapar(nombre)}" width="475" height="475" crossorigin="anonymous">`
          : sprite(nombre, { clase: "enorme" })}</span>
        <div class="dex-ficha-texto">
          <h2 class="dex-nombre">${escapar(nombre)} <span class="dex-numero">${escapar(numeroPokedex(pokemon.numero))}</span></h2>
          <span class="tipos">${listaTipos(pokemon.tipos)}</span>
        </div>
      </div>
      ${elegida ? `
        <div class="dex-uso">
          <p class="dex-uso-linea">Rank #${elegida.puesto} · ${infoFuente(formato).torneos ? `On ${pct(elegida.uso)} of tournament teams` : `Usage ${pct(elegida.uso)}`} · Group ${tierDeUso(elegida.puesto)}</p>
          <p class="nota">Group by usage rank, not an official tier.${elegida.nombre !== nombre ? ` Usage is that of ${escapar(elegida.nombre)}.` : ""}</p>
        </div>` : ""}
      ${etiquetas.length ? `<div class="dex-etiquetas">${etiquetas.map((t) => `<span class="insignia">${escapar(t)}</span>`).join("")}</div>` : ""}
    </section>`;
}

function tarjetaEstadisticas({ pokemon, formato, elegida, nombreShowdown }) {
  const base = pokemon.estadisticas.map((s) => s.valor);
  const total = base.reduce((suma, valor) => suma + valor, 0);
  // Las estadísticas reales solo se calculan si los datos de uso son de esta misma forma
  const mismaForma = elegida && elegida.nombre === (nombreShowdown ?? "") && elegida.spreads?.length;
  const [naturaleza, valoresTexto, uso] = mismaForma ? elegida.spreads[0] : [];
  const valores = mismaForma ? valoresDeSpread(valoresTexto) : null;
  const calculadas = mismaForma ? estadisticasReales(base, naturaleza, valores, formato) : null;
  const reales = calculadas?.every((v) => v !== null) ? calculadas : null; // sin los IVs del formato no se calcula
  const efecto = mismaForma ? dic().naturalezas[naturaleza] : null;

  return `
    <div class="tarjeta">
      <ul class="dex-stats${reales ? " con-reales" : ""}">
        ${reales ? `
          <li class="dex-stat dex-stat-cab" aria-hidden="true">
            <span></span><span>Base</span><span></span><span>${formato.champions ? "Pts" : "EVs"}</span><span>Actual</span>
          </li>` : ""}
        ${ESTADISTICAS.map((nombre, i) => {
          const marca = efecto?.sube === i ? "+" : efecto?.baja === i ? "−" : "";
          return `
          <li class="dex-stat">
            <span class="dex-stat-nombre">${nombre}</span>
            <span class="dex-stat-base">${base[i]}</span>
            ${barra(Math.min(1, base[i] / ESTADISTICA_MAXIMA))}
            ${reales ? `<span class="dex-stat-ev">${valores[i]}</span>
            <span class="dex-stat-real" title="Actual stat">${reales[i]}${marca ? `<small class="${marca === "+" ? "sube" : "baja"}">${marca}</small>` : ""}</span>` : ""}
          </li>`;
        }).join("")}
        <li class="dex-stat dex-stat-total">
          <span class="dex-stat-nombre">Total</span>
          <span class="dex-stat-suma">${total}</span>
        </li>
      </ul>
    </div>
    ${mismaForma ? `
      <p class="nota dex-nota">Most used spread (${pct(uso)}): <b>${escapar(textoReparto(naturaleza, valores))}</b></p>
      ${reales ? `<p class="nota dex-nota">${formato.champions
        ? `Pokémon Champions: level ${formato.nivel} and stat points (max ${maximoPorEstadistica(formato)} per stat and ${maximoTotal(formato)} in total).`
        : `Actual stats at level ${formato.nivel}, with the most used EV spread and ${formato.ivs} IVs.`}</p>` : ""}`
    : infoFuente(formato).torneos ? `<p class="nota dex-nota">Tournament data has no EV spreads, so actual stats are not shown here. Pick a Showdown format to see them.</p>` : ""}`;
}

function tarjetaEficacia({ pokemon }) {
  const grupos = agruparPorMultiplicador(calcularDanoRecibido(pokemon.tipos));
  const con = (multiplicadores) => multiplicadores.flatMap((m) => grupos[m].map((tipo) => insigniaTipo(tipo, m))).join("");
  const filas = [["Weak to", con([4, 2])], ["Resists", con([0.5, 0.25])], ["Immune to", con([0])]];
  return `
    <div class="tarjeta">
      ${filas.map(([etiqueta, insignias]) => `
        <div class="dex-ef"><p class="dex-ef-etiqueta">${etiqueta}</p><div class="tipos">${insignias || `<span class="nada">None</span>`}</div></div>`).join("")}
      <p class="nota dex-ef-titulo">Its STAB moves are super effective against</p>
      ${pokemon.tipos.map((tipo) => `
        <div class="dex-ef"><div class="tipos">${insigniaTipo(tipo)}</div><div class="tipos">${listaTipos(superefectivoContra(tipo))}</div></div>`).join("")}
    </div>`;
}

// ---------------------------------------------------------------------------
// Datos competitivos (Smogon)

// Un apartado plegable: el título se ve siempre, el cuerpo se abre al tocar
function plegable(titulo, cuerpo, abierto = false) {
  return `
    <details class="plegable"${abierto ? " open" : ""}>
      <summary>${titulo}${icono("flecha-derecha")}</summary>
      <div class="plegable-contenido">${cuerpo}</div>
    </details>`;
}

function competitivo(estado) {
  const { formato, elegida, formas } = estado;
  if (!elegida) {
    return `
      <section class="seccion">
        ${tituloSeccion("Competitive")}
        <div class="tarjeta">
          <p>Not in ${escapar(formato.nombre)} ${infoFuente(formato).torneos ? "tournament teams" : "this month"}${formas.length || !formato.usoMinimo ? "" : ` (or used in under ${formato.usoMinimo}% of teams)`}.</p>
          ${formas.length ? `<p class="nota dex-nota">Used in another form:</p>${chipsDeFormas(estado)}` : ""}
          <div id="otros-formatos"></div>
        </div>
      </section>
      <section class="seccion plegables">${plegable("Pokédex", cuerpoPokedex(estado))}</section>`;
  }

  const nombre = elegida.nombre;
  const tiposPropios = especie(nombre)?.tipos ?? estado.pokemon.tipos;
  const movimientos = (elegida.movimientos ?? []).slice(0, 8);
  const objetos = (elegida.objetos ?? []).slice(0, 4);
  const companeros = (elegida.companeros ?? []).filter(([c]) => especie(c)).slice(0, 4); // L13: «empty» y otros nombres que no son especies fuera
  const counters = (elegida.counters ?? []).slice(0, 6);
  return `
    ${formas.length > 1 ? `<section class="seccion">${tituloSeccion("Forms in the meta")}${chipsDeFormas(estado)}</section>` : ""}
    ${historialDeUso(estado)}
    ${parejasComunes(estado)}
    ${enLaClasificacion(estado)}
    <section class="seccion plegables">
      ${plegable("Moves", listaDeUso(movimientos.map(([id, valor]) => {
        const m = dic().movimientos[id];
        return { titulo: escapar(nombreMovimiento(id)), sub: m ? detalleMovimiento(m) : "", pct: valor };
      })), true)}
      ${plegable("Teammates", lista(companeros.map(([companero, valor]) => filaCompanero(nombre, tiposPropios, companero, valor, formato))))}
      ${plegable("Items", listaDeUso(objetos.map(([id, valor]) => ({ titulo: escapar(nombreObjeto(id)), pct: valor }))))}
      ${plegable("Abilities", listaDeUso((elegida.habilidades ?? []).map(([id, valor]) => ({ titulo: escapar(nombreHabilidad(id)), pct: valor }))))}
      ${formatoTieneTera(formato) && elegida.tera?.length
        ? plegable("Tera types", listaDeUso(elegida.tera.map(([tipo, valor]) => ({ titulo: insigniaTipo(tipo), pct: valor }))))
        : ""}
      ${counters.length ? plegable("Checks and counters", `
        <p class="nota dex-nota">Share of matchups in which ${escapar(nombre)} fainted or had to switch out.</p>
        ${lista(counters.map(([rival, valor]) => filaPokemon(rival, "", pct(valor))))}`) : ""}
      ${plegable("Pokédex", cuerpoPokedex(estado))}
    </section>
    <p class="nota dex-fuente">
      Group ${tierDeUso(elegida.puesto)}: by usage rank in this format, not an official tier (${explicacionGrupos(formato.usoMinimo).map((g) => `${g.tier}: ${g.texto}`).join(" · ")}).<br>
      ${infoFuente(formato).torneos
        ? `Limitless data: ${escapar(formato.nombre)}, ${infoFuente(formato).nTorneos != null ? `${infoFuente(formato).nTorneos.toLocaleString("en-US")} tournaments` : "tournaments"}. Usage is the share of tournament teams, not of battles. No EV spreads.`
        : `Smogon data: ${escapar(formato.nombre)}, ${escapar(nombreMes(formato.mes))}, games rated ${formato.corte} or higher.`}
      ${escapar(nombre)} ranks #${elegida.puesto} in usage (${pct(elegida.uso)} of teams).
    </p>`;
}

// ---------------------------------------------------------------------------
// Histórico de uso (datos/historico/<formato>.json), parejas comunes y vecinos de la clasificación

const GRAFICA = { ancho: 320, alto: 168, izq: 40, der: 12, arriba: 12, abajo: 26 };

// Gráfica de línea del uso por mes, en --acento. Un mes sin dato corta la línea.
function graficaDeUso(meses, entradas) {
  const { ancho, alto, izq, der, arriba, abajo } = GRAFICA;
  const usos = entradas.map((e) => e.uso * 100);
  const holgura = Math.max((Math.max(...usos) - Math.min(...usos)) * 0.25, 0.5);
  const minimo = Math.max(0, Math.min(...usos) - holgura);
  const maximo = Math.max(...usos) + holgura;
  const x = (i) => (meses.length === 1 ? izq + (ancho - izq - der) / 2 : izq + ((ancho - izq - der) * i) / (meses.length - 1));
  const y = (valor) => arriba + (alto - arriba - abajo) * (1 - (valor - minimo) / (maximo - minimo));
  const punto = (mes) => {
    const entrada = entradas.find((e) => e.mes === mes);
    return entrada ? [x(meses.indexOf(mes)), y(entrada.uso * 100)] : null;
  };
  const puntos = meses.map(punto);
  // Tramos seguidos de meses con dato
  const tramos = [];
  for (const p of puntos) {
    if (!p) { tramos.push([]); continue; }
    if (!tramos.length) tramos.push([]);
    tramos.at(-1).push(p);
  }
  const lineas = [minimo, (minimo + maximo) / 2, maximo];
  return `
    <svg class="dex-grafica" viewBox="0 0 ${ancho} ${alto}" role="img"
      aria-label="Usage by month: ${entradas.map((e) => `${nombreMes(e.mes, "short")} ${pct(e.uso * 100)}`).join(", ")}">
      ${lineas.map((valor) => `
        <line class="dex-grafica-guia" x1="${izq}" x2="${ancho - der}" y1="${y(valor).toFixed(1)}" y2="${y(valor).toFixed(1)}"></line>
        <text class="dex-grafica-texto" x="${izq - 6}" y="${(y(valor) + 4).toFixed(1)}" text-anchor="end">${pct(valor)}</text>`).join("")}
      ${meses.map((mes, i) => `
        <text class="dex-grafica-texto" x="${x(i).toFixed(1)}" y="${alto - 6}" text-anchor="${i === 0 && meses.length > 1 ? "start" : i === meses.length - 1 && meses.length > 1 ? "end" : "middle"}">${nombreMes(mes, "short")}</text>`).join("")}
      ${tramos.filter((t) => t.length > 1).map((t) => `<polyline class="dex-grafica-linea" points="${t.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ")}"></polyline>`).join("")}
      ${puntos.filter(Boolean).map(([px, py], i, todos) => `<circle class="dex-grafica-punto${i === todos.length - 1 ? " actual" : ""}" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${i === todos.length - 1 ? 4.5 : 3}"></circle>`).join("")}
    </svg>`;
}

// «Usage history»: puesto y uso del último mes, diferencia con el mes anterior y la gráfica
function historialDeUso({ historico, elegida }) {
  const entradas = historico?.pokemon[elegida.nombre];
  if (!entradas?.length) return "";
  const ultima = entradas.at(-1);
  const anterior = historico.meses.at(historico.meses.indexOf(ultima.mes) - 1);
  const previa = ultima.mes === historico.meses.at(-1) && anterior && mesSiguiente(anterior) === ultima.mes
    ? entradas.find((e) => e.mes === anterior) : null;
  let cambio = "";
  if (previa) {
    const puntos = Math.round((ultima.uso - previa.uso) * 1000) / 10;
    const clase = puntos > 0 ? "sube" : puntos < 0 ? "baja" : "";
    cambio = `<span class="dex-historial-cambio ${clase}">${puntos === 0 ? "No change vs last month"
      : `${puntos > 0 ? "▲ +" : "▼ −"}${pct(Math.abs(puntos))} vs last month`}</span>`;
  }
  const meses = historico.meses;
  return `
    <section class="seccion">
      ${tituloSeccion("Usage history")}
      <div class="tarjeta">
        <div class="dex-historial-cabecera">
          <p class="dex-historial-dato">Rank #${ultima.puesto} · ${pct(ultima.uso * 100)}</p>
          ${cambio}
        </div>
        ${graficaDeUso(meses, entradas)}
        <p class="nota">Share of teams with this Pokémon in ${meses.length > 1 ? `${nombreMes(meses[0])} to ${nombreMes(meses.at(-1))}` : nombreMes(meses[0])}, from Smogon.${
          entradas.length < meses.length ? " Months without a point: under the minimum usage." : ""}</p>
      </div>
    </section>`;
}

// «Common pairs»: los 3 compañeros más habituales (dato «companeros» del formato)
function parejasComunes({ elegida }) {
  const parejas = (elegida.companeros ?? []).filter(([c]) => especie(c)).slice(0, 3);
  if (!parejas.length) return "";
  return `
    <section class="seccion">
      ${tituloSeccion("Common pairs")}
      <ul class="tarjeta sin-relleno lista dex-parejas">
        ${parejas.map(([companero, valor]) => `
        <li><a class="fila-pokemon" href="${rutaDex(companero)}">
          <span class="dex-pareja-sprites">${sprite(elegida.nombre)}${sprite(companero)}</span>
          <span class="fila-pokemon-texto"><span class="fila-pokemon-nombre">${escapar(elegida.nombre)} + ${escapar(companero)}</span></span>
          <span class="fila-pokemon-dato">${pct(valor)}</span>
        </a></li>`).join("")}
      </ul>
      <p class="nota dex-nota">The percentage is the share of teams with ${escapar(elegida.nombre)} that also carry the partner, in Smogon's ranked games.</p>
    </section>`;
}

// «In the rankings»: el anterior y el siguiente por puesto de uso
function enLaClasificacion({ formato, elegida }) {
  const indice = formato.pokemon.findIndex((p) => p.nombre === elegida.nombre);
  const carta = (p, clase, flecha) => p ? `
    <a class="tarjeta dex-vecino ${clase}" href="${rutaDex(p.nombre)}">
      ${flecha === "anterior" ? icono("volver") : ""}
      <span class="dex-vecino-texto"><span class="dex-vecino-puesto">#${p.puesto}</span><span class="dex-vecino-nombre">${escapar(p.nombre)}</span></span>
      ${sprite(p.nombre, { clase: "mediano" })}
      ${flecha === "siguiente" ? icono("flecha-derecha") : ""}
    </a>` : "";
  const anterior = formato.pokemon[indice - 1];
  const siguiente = formato.pokemon[indice + 1];
  if (indice < 0 || (!anterior && !siguiente)) return "";
  return `
    <section class="seccion">
      ${tituloSeccion("In the rankings")}
      <div class="dex-vecinos">${carta(anterior, "anterior", "anterior")}${carta(siguiente, "siguiente", "siguiente")}</div>
    </section>`;
}

function cuerpoPokedex({ pokemon, nombreShowdown, aproximada }) {
  return `
    <dl class="dex-datos">
      <div><dt>Height</dt><dd>${dec(pokemon.altura)} m</dd></div>
      <div><dt>Weight</dt><dd>${dec(pokemon.peso)} kg</dd></div>
    </dl>
    <p class="dex-texto">Abilities: ${pokemon.habilidades.map((h) => `${escapar(nombreHabilidad(h.id))}${h.oculta ? " <small>(hidden)</small>" : ""}`).join(" · ")}</p>
    ${aproximada ? `<p class="nota">PokeAPI does not have the ${escapar(nombreShowdown)} form yet: the image is of its base form, and the types and stats come from Pokémon Showdown.</p>` : ""}`;
}

function detalleMovimiento(m) {
  const clase = { "Físico": "Physical", "Especial": "Special", "Estado": "Status" }[m.clase] ?? m.clase;
  const texto = [clase, m.potencia ? `${m.potencia} BP` : null, m.precision ? `${m.precision}% Acc` : null].filter(Boolean).join(" · ");
  return `<span class="dex-movimiento">${insigniaTipo(m.tipo)}${escapar(texto)}</span>`;
}

const lista = (filas) => `<ul class="tarjeta sin-relleno lista">${filas.join("")}</ul>`;

// Filas con nombre, porcentaje y barra; la barra más larga es la de mayor uso. «titulo» y «sub» son HTML ya escapado.
function listaDeUso(filas) {
  const maximo = Math.max(...filas.map((f) => f.pct), 1);
  return lista(filas.map(({ titulo, sub, pct: valor }) => `
    <li class="fila">
      <div class="fila-texto">
        <p class="fila-titulo">${titulo}</p>
        ${sub ? `<p class="fila-sub">${sub}</p>` : ""}
        ${barra(valor / maximo)}
      </div>
      <span class="fila-valor">${pct(valor)}</span>
    </li>`));
}

// Fila de Pokémon con enlace a su ficha; «detalle» es HTML ya escapado
function filaPokemon(nombre, detalle, dato) {
  return `
    <li><a class="fila-pokemon" href="${rutaDex(nombre)}">
      ${sprite(nombre)}
      <span class="fila-pokemon-texto">
        <span class="fila-pokemon-nombre">${escapar(nombre)}</span>
        ${detalle}
      </span>
      <span class="fila-pokemon-dato">${dato}</span>
    </a></li>`;
}

function filaCompanero(nombre, tiposPropios, companero, valor, formato) {
  const suEntrada = formato.porNombre.get(companero);
  const set = suEntrada
    ? [nombreHabilidad(suEntrada.habilidades?.[0]?.[0] ?? ""), nombreObjeto(suEntrada.objetos?.[0]?.[0] ?? "")].filter(Boolean).join(" · ")
    : "";
  const explicacion = explicarSinergia(nombre, tiposPropios, companero);
  const detalle = [set, explicacion].filter(Boolean).map((texto) => `<span class="nota">${escapar(texto)}</span>`).join("");
  return filaPokemon(companero, detalle, pct(valor));
}

function chipsDeFormas({ formas, elegida }) {
  return `
    <div class="segmentado dex-formas" role="group" aria-label="Form">
      ${formas.map((f) => `
        <button type="button" class="segmento" data-forma="${escapar(f.nombre)}" aria-pressed="${f === elegida}">${escapar(f.nombre)} ${pct(f.uso)}</button>`).join("")}
    </div>`;
}

/** Explica con la tabla de tipos por qué dos Pokémon se complementan. */
export function explicarSinergia(nombre, tiposPropios, companero) {
  const tiposCompanero = especie(companero)?.tipos;
  if (!tiposCompanero) return "";
  const recibePropio = calcularDanoRecibido(tiposPropios);
  const recibeCompanero = calcularDanoRecibido(tiposCompanero);
  const leCubre = Object.keys(recibePropio).filter((t) => recibePropio[t] > 1 && recibeCompanero[t] < 1);
  const loCubre = Object.keys(recibeCompanero).filter((t) => recibeCompanero[t] > 1 && recibePropio[t] < 1);
  const partes = [];
  if (leCubre.length) {
    partes.push(`Resists ${unir.format(leCubre.map(nombreTipo))}, ${leCubre.length === 1 ? "a weakness" : "weaknesses"} of ${nombre}.`);
  }
  if (loCubre.length) partes.push(`${nombre} covers its ${unir.format(loCubre.map(nombreTipo))} weakness.`);
  return partes.join(" ") || "No type weaknesses covered: they pair up for team strategy.";
}

// Si no se usa en el formato elegido, se mira si aparece en los otros
async function buscarEnOtrosFormatos(vista, estado, vigente) {
  const otros = infoMeta().formatos.filter((f) => f.id !== estado.formato.id);
  const encontrados = [];
  for (const resumen of otros) {
    try {
      const formato = await cargarFormato(resumen.id);
      const { elegida } = entradaParaDex(formato, estado.nombreShowdown);
      if (elegida) encontrados.push({ resumen, elegida });
    } catch {
      // sin ese formato guardado y sin conexión: se omite
    }
  }
  const destino = vista.querySelector("#otros-formatos");
  if (!vigente() || !destino || !encontrados.length) return;
  destino.innerHTML = `
    <p class="nota dex-nota">It does appear in:</p>
    ${encontrados.map(({ resumen, elegida }) => `
      <button type="button" class="boton texto" data-formato="${escapar(resumen.id)}">${escapar(resumen.nombre)} (#${elegida.puesto}, ${pct(elegida.uso)})</button>`).join("")}`;
}

// ---------------------------------------------------------------------------
// Botones

function conectarFicha(vista, estado) {
  vista.querySelector("#favorito").addEventListener("click", (evento) => {
    const ahora = cambiarFavorito(estado.pokemon.clave);
    const boton = evento.currentTarget;
    boton.setAttribute("aria-pressed", String(ahora));
    boton.innerHTML = `${icono(ahora ? "estrella-llena" : "estrella")}<span>Favorite</span>`;
    if (ahora) rebotar(boton.querySelector("svg"));
    avisar(ahora ? "Added to favorites" : "Removed from favorites");
  });

  vista.querySelector("#al-equipo").addEventListener("click", (evento) => anadirAlEquipo(estado, evento.currentTarget));

  vista.querySelector("#grito")?.addEventListener("click", () => {
    new Audio(estado.pokemon.grito).play().catch(() => avisar("Could not play the cry"));
  });

  vista.querySelector("#competitivo").addEventListener("click", (evento) => {
    const boton = evento.target.closest("[data-forma]");
    if (!boton) return;
    estado.elegida = estado.formas.find((f) => f.nombre === boton.dataset.forma) ?? estado.elegida;
    const zona = vista.querySelector("#competitivo");
    zona.innerHTML = competitivo(estado);
    activar(zona);
  });
}

// Un set sirve para añadirlo si trae objeto, habilidad, reparto y al menos un movimiento
// (en los formatos de torneos, el reparto sale del formato de Smogon de respaldo: spreadsRespaldo)
const tieneSetCompleto = (entrada) => Boolean(entrada.objetos?.[0] && entrada.habilidades?.[0] && (entrada.spreads?.[0] || entrada.spreadsRespaldo?.[0]) && entrada.movimientos?.length);

/**
 * El set más usado de una especie para un equipo de «formato». Si ese formato no tiene datos completos de ella, se
 * busca en los demás formatos de la app (cargándolos), en los del mismo tipo de reparto (EVs o puntos de
 * Champions) y con preferencia por los que usan teratipos si el del equipo también los usa. Si solo lo tiene un
 * formato con otro tipo de reparto, se coge todo menos el reparto (queda a cero y "sinReparto" es true).
 * Si ningún formato tiene datos de uso, se usa un set publicado (datos/sets-respaldo.json: Smogon o Random Battle de
 * Showdown), que cubre a casi todas las especies; "sinReparto" es true si no trae un reparto válido para el formato.
 * Devuelve { set, origen, sinReparto, fuente }: «origen» es el formato de donde sale el set (null si es el del equipo),
 * «fuente» dice de dónde sale un set publicado (no existe si es de uso) y «set» es null si ninguna fuente tiene la
 * especie. Se usa también desde Equipos y desde el Simulador.
 */
export async function setParaEquipo(nombre, formato) {
  const conTera = formatoTieneTera(formato);
  const propia = entradaParaDex(formato, nombre).elegida;
  if (propia && tieneSetCompleto(propia)) return { set: setMasUsado(propia, formato), origen: null };

  let alternativa = null;
  let sinReparto = null;
  // Primero los de su misma escala de reparto (EVs o puntos de Champions) y de partidas; los de torneos, al final
  const orden = (r) => (Boolean(r.champions) === Boolean(formato.champions) ? 0 : 2) + (esDeTorneos(r) ? 1 : 0);
  for (const resumen of [...infoMeta().formatos].sort((a, b) => orden(a) - orden(b))) {
    if (resumen.id === formato.id) continue;
    let otro;
    try {
      otro = await cargarFormato(resumen.id);
    } catch {
      continue; // sin ese formato guardado y sin conexión: se omite
    }
    const entrada = entradaParaDex(otro, nombre).elegida;
    if (!entrada || !tieneSetCompleto(entrada)) continue;
    const set = setMasUsado(entrada, otro);
    if (!conTera) set.tera = null;
    // EVs y puntos de Champions no se convierten: de ese formato se coge todo menos el reparto
    if (Boolean(otro.champions) !== Boolean(formato.champions) || !repartoValido(set.valores, formato)) {
      set.valores = [0, 0, 0, 0, 0, 0];
      sinReparto ??= { set, origen: otro, sinReparto: true };
      continue;
    }
    const candidato = { set, origen: otro };
    if (conTera === formatoTieneTera(otro)) return candidato;
    alternativa ??= candidato;
  }
  if (alternativa) return alternativa;
  if (sinReparto) return sinReparto;
  const publicado = await setDeRespaldo(nombre, formato);
  if (publicado) return { set: publicado.set, origen: null, sinReparto: publicado.sinReparto, fuente: publicado.fuente };
  // Datos incompletos del propio formato: mejor lo que haya, que es real, que nada
  return propia ? { set: setMasUsado(propia, formato), origen: null } : { set: null, origen: null };
}

const SIN_REPARTO = ", with no spread: spreads are not converted between EVs and Champions stat points";

/** Frase (en inglés) que dice de dónde sale el set que devolvió setParaEquipo (la usan Dex, Equipos y el Simulador). */
export function origenDelSet(formato, { origen, sinReparto, fuente }) {
  if (fuente) return `with a published set (${fuente}), because no format in the app has usage data for it${sinReparto ? SIN_REPARTO : ""}`;
  if (origen) return `with its most used set in ${origen.nombre} (no data in ${formato.nombre})${sinReparto ? SIN_REPARTO : ""}`;
  return `with its most used set in ${formato.nombre}`;
}

const hayMovimientos = (m) => Array.isArray(m.movimientos) && m.movimientos.some(Boolean);
// L7: un miembro con movimientos y sin objeto lo dejó así el usuario («No item» a propósito, o «sinObjeto» en el editor);
// solo el que no tiene set (ni movimientos) recibe también el objeto
const necesitaObjeto = (m) => !m.objeto && !m.sinObjeto && !hayMovimientos(m);
const necesitaCompletar = (m) => !hayMovimientos(m) || necesitaObjeto(m);

/**
 * Completa los miembros de un equipo guardado que no tienen set (sin movimientos), con su set (setParaEquipo:
 * el más usado o, si no hay datos de uso, el publicado). Solo rellena lo que falta: movimientos, objeto y habilidad
 * (el objeto solo si el miembro no tenía movimientos: un objeto quitado a propósito se respeta);
 * si el reparto está a cero, también el reparto y la naturaleza; y el teratipo si el formato lo usa. Guarda el equipo
 * si algo cambia. Devuelve { cambios: [{ especie, texto }], sinSet: [especies] }: sinSet son las que no tienen set
 * en ninguna fuente.
 */
export async function completarEquipo(idEquipo) {
  const resultado = { cambios: [], sinSet: [] };
  const equipo = leer().equipos.find((e) => e.id === idEquipo);
  if (!equipo) return resultado;
  const pendientes = equipo.miembros.filter(necesitaCompletar);
  if (!pendientes.length) return resultado;
  const formato = await cargarFormato(infoMeta().formatos.some((f) => f.id === equipo.formato) ? equipo.formato : formatoActual());

  const nuevos = new Map(); // especie → { set, texto }
  for (const miembro of pendientes) {
    const encontrado = await setParaEquipo(miembro.especie, formato);
    if (encontrado.set && hayMovimientos(encontrado.set)) nuevos.set(miembro.especie, { set: encontrado.set, texto: origenDelSet(formato, encontrado) });
    else if (!hayMovimientos(miembro)) resultado.sinSet.push(miembro.especie);
  }
  if (!nuevos.size) return resultado;

  // Se vuelve a leer el equipo dentro de guardar: durante la búsqueda ha podido cambiar
  guardar((e) => {
    const destino = e.equipos.find((x) => x.id === idEquipo);
    if (!destino) return;
    for (const miembro of destino.miembros) {
      const nuevo = nuevos.get(miembro.especie);
      if (!nuevo || !necesitaCompletar(miembro)) continue;
      const { set } = nuevo;
      if (necesitaObjeto(miembro)) miembro.objeto = set.objeto;
      if (!hayMovimientos(miembro)) miembro.movimientos = [...set.movimientos];
      if (!miembro.habilidad) miembro.habilidad = set.habilidad;
      if (!Array.isArray(miembro.valores) || miembro.valores.every((v) => !v)) {
        miembro.valores = [...set.valores];
        miembro.naturaleza = set.naturaleza;
      }
      if (!miembro.tera && formatoTieneTera(formato)) miembro.tera = set.tera;
      resultado.cambios.push({ especie: miembro.especie, texto: nuevo.texto });
    }
    if (resultado.cambios.length) destino.editado = Date.now();
  });
  return resultado;
}

// El equipo donde se añade: el activo o, si no hay, el primero
function equipoDestino() {
  const datos = leer();
  return datos.equipos.find((e) => e.id === datos.equipoActivo) ?? datos.equipos[0];
}

// L5: el set sale del formato del equipo (no del de la pantalla), sin repetir especie y sin duplicar con un doble toque
async function anadirAlEquipo(estado, boton) {
  if (boton.disabled) return;
  boton.disabled = true; // antes del primer await: un segundo toque ya no hace nada
  try {
    const { pokemon, nombreShowdown } = estado;
    const buscado = estado.elegida?.nombre ?? nombreShowdown ?? pokemon.nombre;
    let formato = estado.formato;
    const previo = equipoDestino();
    if (previo?.formato && previo.formato !== formato.id && infoMeta().formatos.some((f) => f.id === previo.formato)) {
      try {
        formato = await cargarFormato(previo.formato);
      } catch {
        avisar("Could not load the data for the team's format");
        return;
      }
    }
    // Se vuelve a leer: durante la espera el equipo puede haber cambiado
    const activo = equipoDestino();
    const { elegida } = entradaParaDex(formato, buscado);
    const nombre = elegida?.nombre ?? buscado;

    if (activo) {
      const especieBase = (n) => especie(n)?.especie ?? n;
      if (activo.miembros.some((m) => especieBase(m.especie) === especieBase(nombre))) {
        avisar(`${nombre} is already in "${activo.nombre}"`);
        return;
      }
      if (activo.miembros.length >= 6) {
        avisar(`"${activo.nombre}" already has 6 Pokémon`);
        return;
      }
    }

    const encontrado = await setParaEquipo(nombre, formato);
    const { set } = encontrado;
    // Se vuelve a mirar: durante la búsqueda en otros formatos el equipo puede haber cambiado
    const ahora = equipoDestino();
    if (ahora?.id !== activo?.id || (ahora && ahora.miembros.length !== activo.miembros.length)) {
      avisar("The team changed in the meantime: try again");
      return;
    }
    const miembro = set ?? {
      especie: nombre, objeto: null, habilidad: pokemon.habilidades[0]?.id ?? null, tera: null,
      naturaleza: "Serious", valores: [0, 0, 0, 0, 0, 0], movimientos: [],
    };
    let destino;
    guardar((e) => {
      destino = activo ? e.equipos.find((x) => x.id === activo.id) : null;
      if (!destino) {
        destino = { id: nuevoId(), nombre: "My team", formato: formato.id, miembros: [], creado: Date.now() };
        e.equipos.push(destino);
      }
      destino.miembros.push(miembro);
      destino.editado = Date.now();
      e.equipoActivo = destino.id;
    });
    avisar(!set ? `${nombre} has no set in any source (no usage data or published sets): added to "${destino.nombre}" without moves`
      : `${nombre} added to "${destino.nombre}" ${origenDelSet(formato, encontrado)}`);
  } finally {
    boton.disabled = false;
  }
}
