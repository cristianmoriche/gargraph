// Pantalla Equipos: la lista de equipos y el editor de uno (hasta 6 Pokémon, su resumen y el paso de ida y vuelta a Showdown)
import {
  cargarFormato, infoMeta, formatoActual, resumenFormato, especie, rutaDex, dic, nombreDeEspecie, nombresDeEspecies,
  nombreObjeto, nombreHabilidad, nombreMovimiento, nombreNaturaleza, buscarId, estadisticasReales, setMasUsado,
  maximoPorEstadistica, maximoTotal, repartoValido, formatoTieneTera, aId, ABREVIATURAS,
} from "../meta.js";
import { TIPOS, analizarDefensa, coberturaOfensiva, nombreTipo } from "../tipos.js";
import { leer, guardar, nuevoId, equipo as buscarEquipo } from "../estado.js";
import { importarEquipo, exportarEquipo } from "../showdown.js";
import {
  icono, escapar, sprite, barra, insigniaTipo, listaTipos, aviso, vacio, avisar, copiar, rellenarLista,
  fechaCorta, haceCuanto, tituloSeccion, cabeceraDetalle, selectorDeFormatos,
} from "../ui.js";
import { activar, entrar, salir } from "../movimiento.js";
import { elegir } from "../sim/index.js";
import { equipoDeApp } from "./sim/rival.js";
import { setParaEquipo, origenDelSet, completarEquipo } from "./dex.js";

const MAXIMO_MIEMBROS = 6;
const MAXIMO_RESULTADOS = 40;
const MAS_USADOS = 30; // Pokémon que se ofrecen al abrir el buscador, antes de escribir nada
const PAUSA_QUITAR = 700; // ms durante los que se ignoran más toques en «Quitar» tras quitar un miembro (L8)

let seleccion = 0; // miembro cuya ficha se ve
let equipoVisto = null; // para empezar de cero al entrar en otro equipo
let abiertos = new Set(); // plegables abiertos del miembro elegido, para no cerrarlos al repintar
let avisosEditor = { id: null, lista: [] }; // avisos de una importación o de un cambio de formato, mientras se esté en ese equipo
let contexto = null; // { vista, id, formato, vigente } del editor que está en pantalla
let sinQuitarHasta = 0;

export async function pintar(vista, { id, vigente }) {
  if (id) {
    if (id !== equipoVisto) {
      seleccion = 0;
      abiertos = new Set();
      if (avisosEditor.id !== id) avisosEditor = { id, lista: [] };
    }
    equipoVisto = id;
    await pintarEditor(vista, id, vigente);
  } else {
    equipoVisto = null;
    avisosEditor = { id: null, lista: [] };
    pintarLista(vista, vigente);
  }
}

const plural = (cantidad, uno, varios) => `${cantidad} ${cantidad === 1 ? uno : varios}`;
const enumerar = (lista) => lista.map(escapar).join(", ");

const avisoInfo = ({ titulo, detalle }) => `
  <div class="aviso info" role="status">
    ${icono("info")}
    <div class="aviso-texto"><p class="aviso-titulo">${escapar(titulo)}</p>${detalle ? `<p class="aviso-detalle">${detalle}</p>` : ""}</div>
  </div>`;

// ---------------------------------------------------------------------------
// Hoja inferior con un texto de Showdown: para importar o para exportar

function hojaTexto({ id, titulo, texto, soloLectura, boton, accion, marcador = "" }) {
  return `
    <dialog class="hoja" id="${id}" aria-labelledby="${id}-titulo">
      <header class="hoja-cabecera">
        <h2 class="hoja-titulo" id="${id}-titulo">${titulo}</h2>
        <button type="button" class="boton-icono" data-cerrar aria-label="Close">${icono("cerrar")}</button>
      </header>
      <div class="formulario">
        <textarea rows="10" spellcheck="false" autocapitalize="none" aria-label="Team in Showdown format"
          placeholder="${marcador}"${soloLectura ? " readonly" : ""}>${escapar(texto)}</textarea>
        <div data-aviso></div>
        <div class="botones-fila">
          <button type="button" class="boton secundario" data-cerrar>Cancel</button>
          <button type="button" class="boton" data-accion="${accion}">${boton}</button>
        </div>
      </div>
    </dialog>`;
}

// ---------------------------------------------------------------------------
// Datos de un equipo

/** «Modified today», «Modified 3 days ago», «Modified on Oct 12, 2026». */
function textoModificado(milisegundos) {
  if (!milisegundos) return "";
  if (new Date(milisegundos).toDateString() === new Date().toDateString()) return "Modified today";
  const tiempo = haceCuanto(milisegundos);
  return `Modified ${/^(just now|.*ago$)/.test(tiempo) ? tiempo : `on ${tiempo}`}`;
}

function crearEquipo(nombre, miembros = [], formato = formatoActual()) {
  const nuevo = { id: nuevoId(), nombre, formato, miembros, creado: Date.now(), editado: Date.now() };
  guardar((e) => {
    e.equipos.unshift(nuevo);
    e.equipoActivo = nuevo.id;
  });
  return nuevo;
}

/** Pone el nombre de la especie como en el diccionario («great tusk» → «Great Tusk»). */
function normalizarMiembro(set) {
  return {
    ...set,
    especie: nombreDeEspecie(set.especie) ?? set.especie,
    tera: set.tera && TIPOS[set.tera] ? set.tera : null,
    naturaleza: set.naturaleza && dic().naturalezas[set.naturaleza] ? set.naturaleza : "Serious",
  };
}

/** La especie base de una forma («Charizard-Mega-Y» → «Charizard»); la misma si ya es la base. */
function especieBase(nombre) {
  return especie(nombre)?.especie ?? nombre;
}

function setVacio(nombre) {
  return {
    especie: nombre, objeto: null, habilidad: especie(nombre)?.habilidades[0] ?? null, tera: null,
    naturaleza: "Serious", valores: [0, 0, 0, 0, 0, 0], movimientos: [],
  };
}

/**
 * Deja los miembros listos para un formato (L3 y L4): un reparto que no vale allí se cambia por la naturaleza y el
 * reparto del set más usado de ese formato, y se quita el teratipo si el formato no lo usa. Un Pokémon sin datos de
 * uso en el formato se queda como está. No toca nada más ni cambia los miembros que recibe: devuelve copias.
 * L2: «cambiaEscala» es true al pasar de Champions (puntos de 0 a 32) a otro formato (EVs de 0 a 252) o al revés: los
 * puntos no se convierten en EVs, así que ningún reparto vale aunque quepa en los máximos; sin set de uso, queda a cero.
 */
function adaptarAlFormato(miembros, formato, cambiaEscala = false) {
  const cambios = { repartos: [], teras: [], sinDatos: [], vaciados: [] };
  const tera = formatoTieneTera(formato);
  const resultado = miembros.map((miembro) => {
    let nuevo = miembro;
    const sinInversion = miembro.valores.every((v) => !v); // a cero vale en las dos escalas
    if ((cambiaEscala && !sinInversion) || !repartoValido(miembro.valores, formato)) {
      const entrada = formato.porNombre.get(miembro.especie);
      const usado = entrada?.spreads?.[0] ? setMasUsado(entrada, formato) : null;
      if (usado && repartoValido(usado.valores, formato)) {
        nuevo = { ...nuevo, naturaleza: usado.naturaleza, valores: usado.valores };
        cambios.repartos.push(miembro.especie);
      } else if (cambiaEscala) {
        nuevo = { ...nuevo, valores: [0, 0, 0, 0, 0, 0] };
        cambios.vaciados.push(miembro.especie);
      } else {
        cambios.sinDatos.push(miembro.especie);
      }
    }
    if (!tera && nuevo.tera) {
      nuevo = { ...nuevo, tera: null };
      cambios.teras.push(miembro.especie);
    }
    return nuevo;
  });
  cambios.cambiados = new Set([...cambios.repartos, ...cambios.vaciados, ...cambios.teras]).size;
  return { miembros: resultado, cambios };
}

/** Los avisos de completarEquipo: qué Pokémon sin movimientos se han completado y con qué set, y cuáles no tienen set. */
function avisosDeCompletado({ cambios, sinSet }) {
  const lista = cambios.map(({ especie, texto }) => ({
    completado: true,
    titulo: `${especie}: set completed`,
    detalle: `It had no moves and was completed ${escapar(texto)}.`,
  }));
  if (sinSet.length) {
    lista.push({
      completado: true,
      titulo: "No moves and no set",
      detalle: `${enumerar(sinSet)}: no format in the app nor the published sets from Smogon and Showdown have a set for it. Add its moves manually.`,
    });
  }
  return lista;
}

/** Los avisos que explican lo que ha cambiado adaptarAlFormato. */
function avisosDeCambios(cambios, formato) {
  const lista = [];
  if (cambios.repartos.length) {
    lista.push({
      titulo: `Spread updated on ${plural(cambios.repartos.length, "Pokémon", "Pokémon")}`,
      detalle: `Invalid in ${escapar(formato.nombre)}: ${enumerar(cambios.repartos)}. Updated to the nature and spread from their most common set.`,
    });
  }
  if (cambios.teras.length) {
    lista.push({ titulo: "Tera Type removed", detalle: `${escapar(formato.nombre)} does not use Tera Types: ${enumerar(cambios.teras)}.` });
  }
  if (cambios.vaciados.length) {
    lista.push({
      titulo: `Spread cleared on ${plural(cambios.vaciados.length, "Pokémon", "Pokémon")}`,
      detalle: `${enumerar(cambios.vaciados)}: Champions stat points and EVs are not converted into each other and ${escapar(formato.nombre)} has no usage data for them. Set their spread manually.`,
    });
  }
  if (cambios.sinDatos.length) {
    lista.push({
      titulo: "Invalid spread and no data to replace it",
      detalle: `No usage data for ${enumerar(cambios.sinDatos)} in ${escapar(formato.nombre)}: left unchanged. Edit their spread manually.`,
    });
  }
  return lista;
}

// ---------------------------------------------------------------------------
// Lista de equipos

function pintarLista(vista, vigente) {
  const { equipos, equipoActivo } = leer();
  vista.innerHTML = `
    <div class="v-equipos">
      <header class="cabecera grande">
        <div class="cabecera-texto"><h1 class="cabecera-titulo">Teams</h1></div>
      </header>

      <div class="botones-fila eq-acciones-lista">
        <button type="button" class="boton" id="nuevo">${icono("añadir")} New</button>
        <button type="button" class="boton secundario" data-accion="importar">${icono("importar")} Import from Showdown</button>
      </div>

      <section class="seccion">
        ${equipos.length
          ? `<div class="eq-equipos">${equipos.map((e) => tarjetaEquipo(e, e.id === equipoActivo)).join("")}</div>`
          : vacio("No teams yet", "Create one with \"New\", import one from Showdown, or add Pokémon from their Dex entry.")}
      </section>

      <p class="nota eq-nota">To import: in Showdown's Teambuilder, open the team and click Import/Export. Copy the text and paste it in "Import from Showdown".</p>
      ${hojaTexto({
        id: "hoja-importar", titulo: "Import Team", texto: "", soloLectura: false, boton: "Import", accion: "aceptar-importar",
        marcador: "Dragapult @ Choice Specs&#10;Ability: Infiltrator&#10;Tera Type: Ghost&#10;…",
      })}
    </div>`;

  const raiz = vista.querySelector(".v-equipos");
  const hoja = raiz.querySelector("#hoja-importar");
  const campo = hoja.querySelector("textarea");
  const zonaAviso = hoja.querySelector("[data-aviso]");
  campo.addEventListener("input", () => { zonaAviso.innerHTML = ""; });

  raiz.querySelector("#nuevo").addEventListener("click", (evento) => {
    evento.currentTarget.disabled = true; // un doble toque no crea dos equipos (L15)
    const nuevo = crearEquipo(`Team ${leer().equipos.length + 1}`);
    location.hash = `#/equipos/${nuevo.id}`;
  });

  raiz.addEventListener("click", async (evento) => {
    const boton = evento.target.closest("[data-accion]");
    if (!boton) return;
    if (boton.dataset.accion === "importar") {
      zonaAviso.innerHTML = "";
      hoja.showModal();
      campo.focus();
    } else if (boton.dataset.accion === "aceptar-importar") {
      boton.disabled = true; // mientras se importa, un segundo toque no crea otro equipo
      try {
        const nuevo = await importarTexto(campo.value, zonaAviso);
        if (nuevo && vigente()) {
          hoja.close();
          location.hash = `#/equipos/${nuevo.id}`;
        }
      } catch (error) {
        console.error(error);
        zonaAviso.innerHTML = aviso("Could not import team", escapar(error.message));
      } finally {
        boton.disabled = false;
      }
    }
  });
}

/**
 * Crea un equipo a partir de un texto de Showdown. Si no se reconoce ningún Pokémon (L2) no crea nada y lo dice en la hoja.
 * Devuelve el equipo nuevo, o null.
 */
async function importarTexto(texto, zonaAviso) {
  const leidos = importarEquipo(texto);
  const descartados = [...(leidos.descartados ?? [])];
  const vistos = new Set();
  const sets = [];
  for (const set of leidos) {
    const miembro = normalizarMiembro(set);
    const base = especieBase(miembro.especie); // L6: Charizard y Charizard-Mega-X son el mismo Pokémon
    if (vistos.has(base)) {
      descartados.push(`${miembro.especie} (duplicate)`);
      continue;
    }
    vistos.add(base);
    sets.push(miembro);
  }
  if (!sets.length) {
    zonaAviso.innerHTML = aviso(
      "No recognizable Pokémon in the text",
      descartados.length ? `Unrecognized: ${enumerar(descartados)}.` : "Paste the team exactly as exported from Showdown's Import/Export.",
    );
    return null;
  }

  const idFormato = formatoActual();
  const formato = await cargarFormato(idFormato);
  const { miembros, cambios } = adaptarAlFormato(sets, formato);
  const nuevo = crearEquipo(leidos.cabecera?.nombre ?? `Imported ${fechaCorta(Date.now())}`, miembros, idFormato);

  const lista = [];
  if (leidos.sobrantes) {
    lista.push({ titulo: `${plural(leidos.sobrantes, "Pokémon", "Pokémon")} left out`, detalle: "A team has at most 6 Pokémon: only the first 6 were imported." });
  }
  if (descartados.length) {
    lista.push({ titulo: descartados.length === 1 ? "1 name was not recognized" : `${descartados.length} names were not recognized`, detalle: enumerar(descartados) });
  }
  lista.push(...avisosDeCambios(cambios, formato));
  avisosEditor = { id: nuevo.id, lista };
  avisar(`Team imported with ${plural(miembros.length, "Pokémon", "Pokémon")}${lista.length ? ": check the notices" : ""}`);
  return nuevo;
}

function tarjetaEquipo(e, activo) {
  const formato = resumenFormato(e.formato);
  const modificado = textoModificado(e.editado);
  return `
    <a class="tarjeta eq-tarjeta${activo ? " activa" : ""}" href="#/equipos/${escapar(e.id)}">
      <div class="eq-tarjeta-cab">
        <h2 class="eq-tarjeta-nombre">${escapar(e.nombre)}</h2>
        <span class="insignia">${escapar(formato?.nombre ?? e.formato)}</span>
        ${activo ? `<span class="insignia acento eq-activo-marca">Active</span>` : ""}
      </div>
      <div class="eq-casillas">
        ${Array.from({ length: MAXIMO_MIEMBROS }, (_, i) => (e.miembros[i]
          ? `<span class="eq-casilla" title="${escapar(e.miembros[i].especie)}">${sprite(e.miembros[i].especie)}</span>`
          : `<span class="eq-casilla vacia" aria-hidden="true"></span>`)).join("")}
      </div>
      <p class="nota">${e.miembros.length}/${MAXIMO_MIEMBROS} Pokémon${modificado ? ` · ${modificado}` : ""}</p>
    </a>`;
}

// ---------------------------------------------------------------------------
// Editor de un equipo

/** Carga lo que hace falta y pinta. */
async function pintarEditor(vista, id, vigente) {
  const eq = buscarEquipo(id);
  if (!eq) {
    vista.innerHTML = `<div class="v-equipos">${cabeceraDetalle({ titulo: "Team", volver: "#/equipos" })}${aviso("This team no longer exists.")}</div>`;
    return;
  }
  const idFormato = infoMeta().formatos.some((f) => f.id === eq.formato) ? eq.formato : formatoActual();
  const formato = await cargarFormato(idFormato);
  if (!vigente()) return;
  rellenarLista("lista-movimientos", Object.values(dic().movimientos).map((m) => m.en));
  rellenarLista("lista-objetos", Object.values(dic().objetos).map((o) => o.en));
  // Los Pokémon guardados sin movimientos se completan solos con su set, y se avisa
  const completado = await completarEquipo(id);
  if (!vigente()) return;
  avisosEditor.lista = [...avisosEditor.lista.filter((a) => !a.completado), ...avisosDeCompletado(completado)];
  contexto = { vista, id, formato, vigente };
  pintados = null; // la primera vez que se pinta el equipo no entra ningún miembro suelto: entra la pantalla
  dibujar();
}

let pintados = null; // { id, especies } del equipo en la última pasada de dibujar(): para animar al que acaba de entrar

/** Vuelve a escribir la pantalla entera con los datos guardados. */
function dibujar() {
  const { vista, id, formato } = contexto;
  const eq = buscarEquipo(id);
  if (!eq) return;
  const posicion = window.scrollY;
  seleccion = Math.max(0, Math.min(seleccion, eq.miembros.length - 1));
  const activo = leer().equipoActivo === eq.id;
  const miembro = eq.miembros[seleccion];
  const sinMiembros = eq.miembros.length === 0;
  const avisos = avisosEditor.id === eq.id ? avisosEditor.lista : [];

  vista.innerHTML = `
    <div class="v-equipos">
      <header class="cabecera">
        <a class="boton-icono" href="#/equipos" data-volver aria-label="Back">${icono("volver")}</a>
        <div class="cabecera-texto">
          <label class="eq-nombre-caja">
            <input class="eq-nombre" name="nombre" value="${escapar(eq.nombre)}" maxlength="40" autocomplete="off" aria-label="Team name (tap to edit)">
            ${icono("editar")}
          </label>
        </div>
        <div class="cabecera-acciones">
          <button type="button" class="boton-icono" data-accion="exportar" aria-label="Export to Showdown"${sinMiembros ? " disabled" : ""}>${icono("exportar")}</button>
          <button type="button" class="boton-icono peligro" data-accion="borrar" aria-label="Delete team">${icono("borrar")}</button>
        </div>
      </header>

      ${avisos.length ? `<div class="eq-avisos">${avisos.map(avisoInfo).join("")}</div>` : ""}

      ${selectorDeFormatos({ actual: formato.id, atributo: "data-formato-equipo" })}

      <div class="eq-botones-equipo">
        <button type="button" class="boton bloque" data-accion="simular"${sinMiembros ? " disabled" : ""}>Simulate battle</button>
        ${activo
          ? `<p class="nota"><span class="insignia acento">Active team</span> Pokémon added from Dex entries go to this team.</p>`
          : `<button type="button" class="boton secundario bloque" data-accion="activar">Set as active team</button>`}
      </div>

      <section class="seccion">
        <div class="eq-miembros">
          ${eq.miembros.map((m, i) => botonMiembro(m, i)).join("")}
          ${Array.from({ length: MAXIMO_MIEMBROS - eq.miembros.length }, () => `
            <button type="button" class="eq-miembro libre" data-accion="hueco" aria-label="Add a Pokémon">${icono("añadir")}<span>Add</span></button>`).join("")}
        </div>
      </section>

      ${miembro ? seccionMiembro(miembro, formato) : ""}
      ${sinMiembros ? `<p class="nada eq-vacio">Tap an empty slot to add the first Pokémon.</p>` : seccionResumen(eq, formato)}

      ${hojaTexto({ id: "hoja-exportar", titulo: "Export Team", texto: exportarEquipo(eq.miembros, dic()), soloLectura: true, boton: "Copy", accion: "copiar" })}
      ${hojaAnadir(formato)}
    </div>`;

  conectarEditor(vista.querySelector(".v-equipos"));
  activar(vista);
  // Un miembro que no estaba en la pasada anterior entra con una transición corta
  if (pintados?.id === eq.id) {
    vista.querySelectorAll(".eq-miembro[data-miembro]").forEach((boton, i) => {
      if (!pintados.especies.includes(eq.miembros[i].especie)) entrar(boton);
    });
  }
  pintados = { id: eq.id, especies: eq.miembros.map((m) => m.especie) };
  window.scrollTo(0, posicion);
}

function botonMiembro(m, i) {
  return `
    <button type="button" class="eq-miembro" data-miembro="${i}" aria-pressed="${i === seleccion}">
      ${sprite(m.especie, { clase: "grande" })}
      <span class="eq-miembro-nombre">${escapar(m.especie)}</span>
    </button>`;
}

/** Texto del reparto: «252 Atk / 4 Def / 252 Spe», o «Uninvested». */
function textoReparto(valores) {
  const partes = valores.map((v, i) => (v ? `${v} ${ABREVIATURAS[i]}` : null)).filter(Boolean);
  return partes.join(" / ") || "Uninvested";
}

function seccionMiembro(m, formato) {
  const e = especie(m.especie);
  const entrada = formato.porNombre.get(m.especie);
  const repartoBueno = repartoValido(m.valores, formato);
  const calculadas = e && repartoBueno ? estadisticasReales(e.base, m.naturaleza, m.valores, formato) : null;
  const reales = calculadas?.every((valor) => valor !== null) ? calculadas : null; // sin los IVs del formato no se calculan
  const tera = formatoTieneTera(formato);
  const unidad = formato.champions ? "Points" : "EVs";
  const plegable = (clave, titulo, contenido) => `
    <details class="plegable" data-plegable="${clave}"${abiertos.has(clave) ? " open" : ""}>
      <summary>${titulo}${icono("flecha-derecha")}</summary>
      <div class="plegable-contenido">${contenido}</div>
    </details>`;

  return `
    <section class="seccion">
      ${tituloSeccion(
        `Edit ${escapar(m.especie)}`,
        entrada ? `<button type="button" class="boton secundario pequeno" data-accion="set-usado">Use most common set</button>` : "",
      )}
      <div class="tarjeta eq-ficha">
        <div class="eq-ficha-cab">
          <span class="tipos">${listaTipos(e?.tipos ?? [])}</span>
          <a class="boton texto pequeno" href="${rutaDex(m.especie)}">View in Dex</a>
        </div>
        <dl class="eq-datos">
          <div><dt>Item</dt><dd>${m.objeto ? escapar(nombreObjeto(m.objeto)) : "No item"}</dd></div>
          <div><dt>Nature</dt><dd>${escapar(nombreNaturaleza(m.naturaleza))}</dd></div>
          <div><dt>Ability</dt><dd>${m.habilidad ? escapar(nombreHabilidad(m.habilidad)) : "—"}</dd></div>
          ${tera ? `<div><dt>Tera Type</dt><dd>${m.tera ? insigniaTipo(m.tera) : "No Tera Type"}</dd></div>` : ""}
          <div class="completo"><dt>${unidad}</dt><dd>${escapar(textoReparto(m.valores))}</dd></div>
        </dl>
        ${repartoBueno ? "" : aviso(
          `Spread is invalid in ${formato.nombre}`,
          `Max ${maximoPorEstadistica(formato)} per stat and ${maximoTotal(formato)} total. Edit it or use the most common set.`,
        )}
        ${m.movimientos.length
          ? `<ul class="eq-movs">${m.movimientos.map((id) => `<li>${escapar(nombreMovimiento(id))}</li>`).join("")}</ul>`
          : `<p class="nada">No moves</p>`}
        <div class="eq-plegables">
          ${reales ? plegable("stats", `Actual stats (level ${formato.nivel})`, `
            <div class="eq-stats">
              ${reales.map((valor, j) => `
                <div class="eq-stat">
                  <span class="eq-stat-nombre">${ABREVIATURAS[j]}</span>
                  ${barra(Math.min(1, e.base[j] / 160))}
                  <span class="eq-stat-valor">${valor}</span>
                </div>`).join("")}
            </div>`) : ""}
          ${plegable("set", "Edit full set", formularioSet(m, formato, entrada))}
        </div>
        <button type="button" class="boton peligro bloque" data-accion="quitar">${icono("borrar")} Remove ${escapar(m.especie)} from team</button>
      </div>
    </section>`;
}

function formularioSet(m, formato, entrada) {
  const habilidades = [...new Set([
    ...(especie(m.especie)?.habilidades ?? []),
    ...(entrada?.habilidades.map(([id]) => id) ?? []),
    ...(m.habilidad ? [m.habilidad] : []),
  ])];
  const maximo = maximoPorEstadistica(formato);
  const sugerencia = (lista, j) => (lista?.[j] ? escapar(nombreMovimiento(lista[j][0])) : `Move ${j + 1}`);
  return `
    <form class="formulario eq-set">
      <label class="campo"><span class="campo-etiqueta">Item</span>
        <input name="objeto" list="lista-objetos" value="${escapar(m.objeto ? nombreObjeto(m.objeto) : "")}" autocomplete="off"
          placeholder="${entrada?.objetos[0] ? escapar(nombreObjeto(entrada.objetos[0][0])) : "No item"}">
      </label>
      <label class="campo"><span class="campo-etiqueta">Ability</span>
        <select name="habilidad">
          ${habilidades.map((id) => `<option value="${escapar(id)}"${id === m.habilidad ? " selected" : ""}>${escapar(nombreHabilidad(id))}</option>`).join("")}
        </select>
      </label>
      ${formatoTieneTera(formato) ? `
        <label class="campo"><span class="campo-etiqueta">Tera Type</span>
          <select name="tera">
            <option value="">No Tera Type</option>
            ${Object.keys(TIPOS).map((t) => `<option value="${t}"${t === m.tera ? " selected" : ""}>${escapar(nombreTipo(t))}</option>`).join("")}
          </select>
        </label>` : ""}
      <label class="campo"><span class="campo-etiqueta">Nature</span>
        <select name="naturaleza">
          ${Object.entries(dic().naturalezas).map(([n, d]) => `
            <option value="${escapar(n)}"${n === m.naturaleza ? " selected" : ""}>${escapar(n)}${d.sube !== undefined ? ` (+${ABREVIATURAS[d.sube]} −${ABREVIATURAS[d.baja]})` : ""}</option>`).join("")}
        </select>
      </label>
      <fieldset class="eq-grupo">
        <legend class="campo-etiqueta">${formato.champions ? "Stat points" : "EVs"} (max ${maximo} each and ${maximoTotal(formato)} total)</legend>
        <div class="eq-valores">
          ${ABREVIATURAS.map((abreviatura, j) => `
            <label class="campo"><span class="campo-etiqueta">${abreviatura}</span>
              <input name="valor${j}" type="number" inputmode="numeric" min="0" max="${maximo}" step="1" value="${m.valores[j]}">
            </label>`).join("")}
        </div>
      </fieldset>
      <fieldset class="eq-grupo">
        <legend class="campo-etiqueta">Moves</legend>
        <div class="eq-movimientos">
          ${[0, 1, 2, 3].map((j) => `
            <input name="mov${j}" list="lista-movimientos" aria-label="Move ${j + 1}" autocomplete="off" autocapitalize="none"
              value="${escapar(m.movimientos[j] ? nombreMovimiento(m.movimientos[j]) : "")}" placeholder="${sugerencia(entrada?.movimientos, j)}">`).join("")}
        </div>
      </fieldset>
      <button type="submit" class="boton bloque">Save set</button>
    </form>`;
}

// ---------------------------------------------------------------------------
// Resumen del equipo: debilidades, cobertura y orden de velocidad

function seccionResumen(eq, formato) {
  const defensa = analizarDefensa(eq.miembros.map((m) => especie(m.especie)?.tipos ?? []));
  // Solo los tipos que pillan a dos o más: con uno solo no hay nada que vigilar
  const debiles = defensa.filter((d) => d.debiles >= 2).sort((a, b) => b.debiles - a.debiles || a.resisten + a.inmunes - (b.resisten + b.inmunes));
  const puntosDebiles = defensa.filter((d) => d.puntoDebil);

  // Tipos con los que ataca cada uno: los de sus movimientos de daño o, si aún no tiene movimientos, los suyos
  const tiposDeAtaque = (m) => {
    const deDano = m.movimientos.map((id) => dic().movimientos[id]).filter((mov) => mov && mov.clase !== "Estado" && mov.potencia).map((mov) => mov.tipo);
    return deDano.length ? deDano : (especie(m.especie)?.tipos ?? []);
  };
  const cubiertos = new Set(eq.miembros.flatMap((m) => coberturaOfensiva(tiposDeAtaque(m)).cubiertos));
  const sinCubrir = Object.keys(TIPOS).filter((tipo) => !cubiertos.has(tipo));

  // Un reparto que no vale en el formato daría una velocidad falsa: ese Pokémon no entra en el orden
  const sinCalcular = eq.miembros.filter((m) => !repartoValido(m.valores, formato)).map((m) => m.especie);
  const velocidades = eq.miembros
    .filter((m) => repartoValido(m.valores, formato) && especie(m.especie))
    .map((m) => ({ nombre: m.especie, valor: estadisticasReales(especie(m.especie).base, m.naturaleza, m.valores, formato)[5] }))
    .filter((v) => v.valor)
    .sort((a, b) => b.valor - a.valor);

  return `
    <section class="seccion">
      ${tituloSeccion("Team Summary")}
      <div class="tarjeta eq-resumen">
        <div class="eq-bloque">
          <h3 class="eq-bloque-titulo">Type Weaknesses</h3>
          ${debiles.length ? `
            <ul class="eq-debilidades">
              ${debiles.map((d) => `
                <li${d.puntoDebil ? ` class="punto"` : ""}>
                  ${insigniaTipo(d.tipo)}
                  <span class="nota">${d.debiles} weak · ${d.resisten + d.inmunes} res.</span>
                </li>`).join("")}
            </ul>
            <p class="nota">${puntosDebiles.length
              ? `Unresisted weakness (3+ weak and none resist): ${enumerar(puntosDebiles.map((d) => nombreTipo(d.tipo)))}.`
              : "No type hits three or more without a resist."} Only types that two or more team members are weak to are shown.</p>`
            : `<p class="nada">No type hits more than one Pokémon on the team super effectively.</p>`}
        </div>
        <div class="eq-bloque">
          <h3 class="eq-bloque-titulo">Offensive Coverage</h3>
          <p>${cubiertos.size} of ${Object.keys(TIPOS).length} types</p>
          ${sinCubrir.length ? `<p class="nota">Uncovered: ${enumerar(sinCubrir.map(nombreTipo))}.</p>` : ""}
        </div>
        <div class="eq-bloque">
          <h3 class="eq-bloque-titulo">Speed Tiers</h3>
          ${velocidades.length ? `
            <ol class="eq-velocidad">
              ${velocidades.map((v) => `
                <li aria-label="${escapar(v.nombre)}: ${v.valor}" title="${escapar(v.nombre)}">${sprite(v.nombre)}<span>${v.valor}</span></li>`).join("")}
            </ol>
            <p class="nota">Fastest to slowest at level ${formato.nivel}, with each set's nature and spread.</p>`
            : `<p class="nada">No speeds to calculate in this format.</p>`}
          ${sinCalcular.length ? `<p class="nota">Not calculated due to an invalid spread for this format: ${enumerar(sinCalcular)}.</p>` : ""}
        </div>
      </div>
    </section>`;
}

// ---------------------------------------------------------------------------
// Alta de un Pokémon con buscador

function hojaAnadir() {
  return `
    <dialog class="hoja" id="hoja-anadir" aria-labelledby="hoja-anadir-titulo">
      <header class="hoja-cabecera">
        <h2 class="hoja-titulo" id="hoja-anadir-titulo">Add Pokémon</h2>
        <button type="button" class="boton-icono" data-cerrar aria-label="Close">${icono("cerrar")}</button>
      </header>
      <div class="formulario">
        <label class="buscador">
          ${icono("buscar")}
          <input type="search" placeholder="Search Pokémon" aria-label="Search Pokémon" autocomplete="off" autocapitalize="none" spellcheck="false">
        </label>
        <p class="nota" data-nota></p>
        <ul class="tarjeta sin-relleno lista" data-resultados></ul>
      </div>
    </dialog>`;
}

/** Nombres que enseña el buscador: lo escrito, y sin escribir nada los más usados del formato. */
function buscarEspecies(texto, formato) {
  const buscado = aId(texto);
  if (!buscado) return formato.pokemon.map((p) => p.nombre).filter((nombre) => especie(nombre)).slice(0, MAS_USADOS);
  const encontrados = nombresDeEspecies().filter((nombre) => aId(nombre).includes(buscado));
  const empiezan = encontrados.filter((nombre) => aId(nombre).startsWith(buscado));
  return [...empiezan, ...encontrados.filter((nombre) => !empiezan.includes(nombre))].slice(0, MAXIMO_RESULTADOS);
}

// ---------------------------------------------------------------------------
// Eventos del editor

function conectarEditor(raiz) {
  const { id, formato, vigente } = contexto;
  const actual = () => buscarEquipo(id);
  const cambiar = (cambio) => {
    guardar((e) => {
      const destino = e.equipos.find((x) => x.id === id);
      if (!destino) return;
      cambio(destino);
      destino.editado = Date.now();
    });
  };

  // Nombre del equipo (L14): uno vacío vuelve al anterior y se avisa
  const campoNombre = raiz.querySelector("[name=nombre]");
  campoNombre.addEventListener("change", () => {
    const nombre = campoNombre.value.trim();
    const anterior = actual().nombre;
    if (!nombre) {
      campoNombre.value = anterior;
      avisar(`Name cannot be empty: kept as "${anterior}"`);
      return;
    }
    campoNombre.value = nombre;
    if (nombre !== anterior) cambiar((destino) => { destino.nombre = nombre; });
  });
  campoNombre.addEventListener("keydown", (evento) => {
    if (evento.key === "Enter") campoNombre.blur();
  });

  raiz.querySelectorAll("[data-formato-equipo]").forEach((boton) => boton.addEventListener("click", () => {
    boton.closest("dialog").close();
    cambiarFormato(boton.dataset.formatoEquipo);
  }));

  // Buscador del alta (L9: lo que ya está en el equipo se ve y no se puede elegir)
  const hojaBusqueda = raiz.querySelector("#hoja-anadir");
  const campoBusqueda = hojaBusqueda.querySelector("input");
  const pintarResultados = () => {
    const texto = campoBusqueda.value.trim();
    const nombres = buscarEspecies(texto, formato);
    const ya = new Set(actual().miembros.map((m) => m.especie));
    hojaBusqueda.querySelector("[data-nota]").textContent = !texto ? `Most used in ${formato.nombre}`
      : nombres.length ? plural(nombres.length, "result", "results") : `No results for "${texto}"`;
    hojaBusqueda.querySelector("[data-resultados]").innerHTML = nombres.map((nombre) => `
      <li><button type="button" class="fila-pokemon eq-resultado" data-especie="${escapar(nombre)}"${ya.has(nombre) ? " disabled" : ""}>
        ${sprite(nombre)}
        <span class="fila-pokemon-texto">
          <span class="fila-pokemon-nombre">${escapar(nombre)}</span>
          <span class="tipos">${listaTipos(especie(nombre)?.tipos ?? [])}</span>
        </span>
        ${ya.has(nombre) ? `<span class="insignia">On team</span>` : ""}
      </button></li>`).join("");
  };
  campoBusqueda.addEventListener("input", pintarResultados);
  campoBusqueda.addEventListener("keydown", (evento) => {
    if (evento.key !== "Enter") return;
    evento.preventDefault();
    hojaBusqueda.querySelector(".eq-resultado:not(:disabled)")?.click();
  });

  // Cada plegable recuerda si estaba abierto
  raiz.addEventListener("toggle", (evento) => {
    const clave = evento.target.dataset?.plegable;
    if (!clave) return;
    if (evento.target.open) abiertos.add(clave);
    else abiertos.delete(clave);
  }, true);

  raiz.addEventListener("submit", (evento) => {
    const formulario = evento.target.closest("form.eq-set");
    if (!formulario) return;
    evento.preventDefault();
    const nuevo = leerSet(new FormData(formulario), formato);
    if (!nuevo) return;
    formulario.querySelector("[type=submit]").disabled = true;
    cambiar((destino) => Object.assign(destino.miembros[seleccion], nuevo));
    avisar("Set saved");
    dibujar();
  });

  raiz.addEventListener("click", async (evento) => {
    const miembro = evento.target.closest("[data-miembro]");
    if (miembro) {
      seleccion = Number(miembro.dataset.miembro);
      abiertos = new Set();
      dibujar();
      return;
    }
    const resultado = evento.target.closest("[data-especie]");
    if (resultado) {
      hojaBusqueda.close();
      anadir(resultado.dataset.especie);
      return;
    }
    const boton = evento.target.closest("[data-accion]");
    if (!boton) return;
    const eq = actual();
    if (!eq) return;
    switch (boton.dataset.accion) {
      case "borrar":
        if (!confirm(`Delete team "${eq.nombre}"? This cannot be undone.`)) return;
        guardar((e) => {
          e.equipos = e.equipos.filter((x) => x.id !== eq.id);
          if (e.equipoActivo === eq.id) e.equipoActivo = e.equipos[0]?.id ?? null;
        });
        avisar("Team deleted");
        location.replace("#/equipos"); // sin dejar en el historial la dirección de un equipo que ya no existe (N4)
        break;
      case "activar":
        guardar((e) => { e.equipoActivo = eq.id; });
        avisar("Set as your active team");
        dibujar();
        break;
      case "simular":
        // Se simula con el equipo abierto: pasa a ser el equipo activo y el elegido en el simulador
        // (si no, el simulador seguiría con el equipo que tuviera de antes en la sesión)
        boton.disabled = true;
        guardar((e) => { e.equipoActivo = eq.id; });
        elegir({ yo: equipoDeApp(eq) });
        location.hash = "#/simulador";
        break;
      case "quitar": {
        // Con confirmación y con una pausa después: un doble toque no quita dos Pokémon (L8)
        const nombre = eq.miembros[seleccion]?.especie;
        if (!nombre || Date.now() < sinQuitarHasta) return;
        if (!confirm(`Remove ${nombre} from the team?`)) return;
        sinQuitarHasta = Date.now() + PAUSA_QUITAR;
        const casilla = raiz.querySelector(`.eq-miembro[data-miembro="${seleccion}"]`);
        cambiar((destino) => destino.miembros.splice(seleccion, 1));
        abiertos = new Set();
        avisar(`${nombre} removed from the team`);
        salir(casilla).then(() => { if (contexto.vigente()) dibujar(); }); // se encoge y luego se repinta (si sigue en esta pantalla)
        break;
      }
      case "set-usado": {
        const entrada = formato.porNombre.get(eq.miembros[seleccion]?.especie);
        if (!entrada) return;
        cambiar((destino) => Object.assign(destino.miembros[seleccion], setMasUsado(entrada, formato)));
        avisar("Most common set applied");
        dibujar();
        break;
      }
      case "hueco":
        campoBusqueda.value = "";
        pintarResultados();
        hojaBusqueda.showModal();
        campoBusqueda.focus();
        break;
      case "exportar":
        raiz.querySelector("#hoja-exportar").showModal();
        break;
      case "copiar": {
        // N3: la hoja solo se cierra si se ha copiado; si no, el texto queda seleccionado para copiarlo a mano
        const texto = raiz.querySelector("#hoja-exportar textarea");
        if (await copiar(texto.value)) raiz.querySelector("#hoja-exportar").close();
        else texto.select();
        break;
      }
    }
  });
}

let anadiendo = false; // mientras se buscan datos en otros formatos, un segundo toque no añade otro Pokémon

/**
 * Añade una especie con su set más usado en el formato del equipo; si ese formato no tiene datos de ella, el de otro
 * formato de la app (se avisa de cuál). Sin datos en ninguno, entra sin set. No admite una especie que ya esté en el
 * equipo (L9) ni pasar de 6.
 */
async function anadir(nombre) {
  if (anadiendo) return;
  const { id, formato, vigente } = contexto;
  const eq = buscarEquipo(id);
  if (!eq) return;
  if (eq.miembros.length >= MAXIMO_MIEMBROS) {
    avisar(`The team already has ${MAXIMO_MIEMBROS} Pokémon`);
    return;
  }
  if (eq.miembros.some((m) => especieBase(m.especie) === especieBase(nombre))) { // L5/L6: por especie base, como la Dex
    avisar(`${nombre} is already on the team`);
    return;
  }
  anadiendo = true;
  let resultado;
  try {
    resultado = await setParaEquipo(nombre, formato);
  } finally {
    anadiendo = false;
  }
  if (!vigente()) return;
  const { set } = resultado;
  const actual = buscarEquipo(id);
  if (!actual || actual.miembros.length >= MAXIMO_MIEMBROS || actual.miembros.some((m) => especieBase(m.especie) === especieBase(set?.especie ?? nombre))) {
    avisar("The team changed in the meantime; please try again");
    return;
  }
  guardar((e) => {
    const destino = e.equipos.find((x) => x.id === id);
    destino.miembros.push(set ?? setVacio(nombre));
    destino.editado = Date.now();
  });
  seleccion = buscarEquipo(id).miembros.length - 1;
  abiertos = new Set();
  avisar(!set ? `${nombre} added with no moves: no set found in any source (neither usage data nor published sets)`
    : `${nombre} added ${origenDelSet(formato, resultado)}`);
  dibujar();
}

/** Cambia el formato del equipo (L3): pide confirmación y adapta los repartos y los teratipos al formato nuevo. */
async function cambiarFormato(idNuevo) {
  const { vista, id, vigente } = contexto;
  const eq = buscarEquipo(id);
  if (!eq || idNuevo === eq.formato) return;
  try {
    const formatoNuevo = await cargarFormato(idNuevo);
    if (!vigente()) return;
    const formatoAntes = resumenFormato(eq.formato);
    const cambiaEscala = Boolean(formatoAntes?.champions) !== Boolean(formatoNuevo.champions);
    const { miembros, cambios } = adaptarAlFormato(eq.miembros, formatoNuevo, cambiaEscala);
    if (eq.miembros.length) {
      const resumen = cambios.cambiados
        ? `${plural(cambios.cambiados, "Pokémon", "Pokémon")} of ${eq.miembros.length} will be updated: invalid spreads (and any spread when switching between Champions points and EVs) will be replaced with the most common set's spread, and Tera Types will be removed if the format does not use them.`
        : "No Pokémon need changes.";
      if (!confirm(`Switch "${eq.nombre}" to ${formatoNuevo.nombre}?\n\n${resumen}`)) {
        dibujar(); // vuelve a enseñar el formato de antes
        return;
      }
    }
    guardar((e) => {
      const destino = e.equipos.find((x) => x.id === id);
      destino.formato = idNuevo;
      destino.miembros = miembros;
      destino.editado = Date.now();
    });
    avisosEditor = { id, lista: avisosDeCambios(cambios, formatoNuevo) };
    avisar(`Format changed to ${formatoNuevo.nombre}${cambios.cambiados ? `: ${plural(cambios.cambiados, "Pokémon updated", "Pokémon updated")}` : ""}`);
    await pintarEditor(vista, id, vigente);
  } catch (error) {
    console.error(error);
    avisar("Could not load data for that format");
    dibujar();
  }
}

/** Lee el formulario de un set y comprueba que todo existe y que el reparto es válido. */
function leerSet(datos, formato) {
  const textoObjeto = datos.get("objeto").trim();
  const objeto = textoObjeto ? buscarId("objetos", textoObjeto) : null;
  if (textoObjeto && !objeto) {
    avisar(`Item "${textoObjeto}" not found`);
    return null;
  }
  const textos = [0, 1, 2, 3].map((j) => datos.get(`mov${j}`).trim()).filter(Boolean);
  const movimientos = textos.map((texto) => buscarId("movimientos", texto));
  const desconocido = textos.find((_, k) => !movimientos[k]);
  if (desconocido) {
    avisar(`Move "${desconocido}" not found`);
    return null;
  }
  if (new Set(movimientos).size !== movimientos.length) {
    avisar("Duplicate move");
    return null;
  }
  const maximo = maximoPorEstadistica(formato);
  const valores = ABREVIATURAS.map((_, j) => Math.max(0, Math.min(maximo, Math.round(Number(datos.get(`valor${j}`)) || 0))));
  if (!repartoValido(valores, formato)) {
    avisar(`Spread totals ${valores.reduce((suma, v) => suma + v, 0)}: max is ${maximoTotal(formato)}`);
    return null;
  }
  return {
    objeto,
    sinObjeto: !objeto, // L7: «No item» elegido a propósito; completarEquipo no lo rellena
    habilidad: datos.get("habilidad") || null,
    tera: formatoTieneTera(formato) ? datos.get("tera") || null : null,
    naturaleza: datos.get("naturaleza"),
    valores,
    movimientos,
  };
}
