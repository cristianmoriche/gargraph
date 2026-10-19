// Pantalla Damage calc (#/calc): atacante, defensor, movimiento y campo; el daño lo calcula calcularDano() del motor
// del simulador (js/sim/motor.js). Con #/calc?a=<pokemon>&d=<pokemon> se abre con esos dos.
import {
  buscarId, cargarFormato, cargarMeta, dic, especie, formatoActual, formatoTieneTera, infoMeta, maximoPorEstadistica, maximoTotal,
  nombreDeEspecie, nombresDeEspecies, repartoValido,
} from "../meta.js";
import { TIPOS } from "../tipos.js";
import { cargarDatos, datosDeCombate } from "../sim/datos.js";
import { calcularDano, crearCombate, sinEfecto } from "../sim/motor.js";
import { avisar, aviso, cabeceraDetalle, cargando, escapar, icono, listaTipos, selectorDeFormatos, sprite } from "../ui.js";
import { setParaEquipo } from "./dex.js";

const ESTADISTICAS = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"];
const CLIMAS = [["", "None"], ["sunnyday", "Sun"], ["raindance", "Rain"], ["sandstorm", "Sand"], ["snowscape", "Snow"]];
const TERRENOS = [["", "None"], ["electricterrain", "Electric"], ["grassyterrain", "Grassy"], ["psychicterrain", "Psychic"], ["mistyterrain", "Misty"]];
const PANTALLAS = [["reflect", "Reflect"], ["lightscreen", "Light Screen"], ["auroraveil", "Aurora Veil"]];
const ROLES = { a: "Attacker", d: "Defender" };
const CLASES = { Físico: "Physical", Especial: "Special", Estado: "Status" };

// Nombre en inglés (el de los juegos y Showdown) de un id del diccionario
const nombreEn = (tabla, id) => dic()[tabla][id]?.en ?? id;
const mayuscula = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);
const conMod = (valor, mod) => Math.floor(mod >= 0 ? (valor * (2 + mod)) / 2 : (valor * 2) / (2 - mod));
const formatoPct = (n) => `${n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const signo = (n) => (n > 0 ? `+${n}` : n < 0 ? `-${-n}` : "+0");
const opciones = (nombres) => [...new Set(nombres)].sort().map((n) => `<option value="${escapar(n)}"></option>`).join("");

const ICONO_INTERCAMBIO = `<svg class="icono" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 20V4M7 4 4 7M7 4l3 3M17 4v16M17 20l-3-3M17 20l3-3"/></svg>`;

export async function pintar(vista, { consulta, vigente }) {
  vista.innerHTML = `<div class="v-calc">${cargando("Loading calculator…")}</div>`;
  let formato;
  try {
    if (!infoMeta()) await cargarMeta();
    ({ formato } = await cargarDatos(formatoActual()));
  } catch (error) {
    // Si el formato no carga, lo explica app.js con la salida al formato anterior
    if (vigente() && infoMeta() && await cargarFormato(formatoActual()).then(() => false, () => true)) throw error;
    if (vigente()) vista.innerHTML = `<div class="v-calc">${aviso("Couldn't load the data", escapar(error.message))}</div>`;
    return;
  }
  if (!vigente()) return;

  const conTera = formatoTieneTera(formato);
  const porUso = [...formato.pokemon].sort((x, y) => x.puesto - y.puesto).map((p) => p.nombre);
  const pedido = (clave) => nombreDeEspecie(consulta?.get(clave) ?? "");
  const nombres = [pedido("a") ?? porUso[0], pedido("d") ?? porUso[1] ?? porUso[0]];
  let lados;
  try {
    lados = await Promise.all(nombres.map((n) => cargarLado(n, formato)));
  } catch (error) {
    if (vigente()) vista.innerHTML = `<div class="v-calc">${aviso("Couldn't load the Pokémon", escapar(error.message))}</div>`;
    return;
  }
  if (!vigente()) return;

  const estado = {
    a: lados[0],
    d: lados[1],
    movimiento: null,
    extra: null,                                   // movimiento elegido en el buscador que no es del set
    clima: "", terreno: "", pantallas: { reflect: false, lightscreen: false, auroraveil: false },
    avisoReparto: { a: "", d: "" },
  };
  estado.movimiento = primerMovimientoDeDano(estado.a);

  vista.innerHTML = `
    <div class="v-calc">
      ${cabeceraDetalle({ titulo: "Damage calc", subtitulo: escapar(formato.nombre), volver: "#/dex" })}
      ${selectorDeFormatos()}

      <div data-sitio="a"></div>
      <button type="button" class="boton secundario bloque" data-intercambiar>${ICONO_INTERCAMBIO} Swap attacker and defender</button>
      <div data-sitio="d"></div>

      <section class="tarjeta calc-movimiento">
        <h2 class="calc-rol">Move</h2>
        <div class="segmentado calc-movimientos" role="group" aria-label="Attacker move" data-movimientos></div>
        <label class="campo">
          <span class="campo-etiqueta">Any other move</span>
          <input type="search" list="calc-movs" placeholder="Search a move" autocomplete="off" data-otro-mov>
        </label>
      </section>

      <section class="tarjeta calc-resultado" aria-live="polite">
        <h2 class="calc-rol">Result</h2>
        <p class="calc-ko" data-ko></p>
        <span class="calc-barra" aria-hidden="true"><span class="calc-barra-min" data-barra-min></span><span class="calc-barra-rango" data-barra-rango></span></span>
        <p class="calc-rango" data-rango></p>
        <p class="nota" data-detalle></p>
        <ul class="calc-notas nota" data-notas></ul>
      </section>

      <details class="plegable calc-campo">
        <summary>Field ${icono("flecha-derecha")}</summary>
        <div class="plegable-contenido">
          <p class="campo-etiqueta">Weather</p>
          <div class="segmentado" role="group" aria-label="Weather">
            ${CLIMAS.map(([id, texto]) => `<button type="button" class="segmento" data-clima="${id}" aria-pressed="${id === ""}">${texto}</button>`).join("")}
          </div>
          <p class="campo-etiqueta">Terrain</p>
          <div class="segmentado" role="group" aria-label="Terrain">
            ${TERRENOS.map(([id, texto]) => `<button type="button" class="segmento" data-terreno="${id}" aria-pressed="${id === ""}">${texto}</button>`).join("")}
          </div>
          <p class="campo-etiqueta">Screens on the defender's side</p>
          ${PANTALLAS.map(([id, texto]) => `<label class="fila-interruptor"><span>${texto}</span><input type="checkbox" class="interruptor" role="switch" data-pantalla="${id}"></label>`).join("")}
          <p class="nota">Critical hits aren't available: the simulator's damage calculation doesn't include them. Abilities that set weather or terrain when they enter don't trigger here: pick it above.</p>
        </div>
      </details>

      <datalist id="calc-especies">${opciones(nombresDeEspecies())}</datalist>
      <datalist id="calc-objetos">${opciones(Object.values(dic().objetos).map((o) => o.en))}</datalist>
      <datalist id="calc-habilidades">${opciones(Object.values(dic().habilidades).map((h) => h.en))}</datalist>
      <datalist id="calc-movs">${opciones(Object.values(dic().movimientos).map((m) => m.en))}</datalist>
    </div>`;

  const raiz = vista.querySelector(".v-calc");
  const sitio = (rol) => raiz.querySelector(`[data-sitio="${rol}"]`);

  // ---------------------------------------------------------------------------
  // Tarjetas

  function pintarTarjeta(rol) {
    const l = estado[rol];
    const e = especie(l.nombre);
    const naturalezas = Object.entries(dic().naturalezas).sort(([x], [y]) => x.localeCompare(y));
    const maximo = maximoPorEstadistica(formato);
    sitio(rol).innerHTML = `
      <section class="tarjeta calc-tarjeta" data-lado="${rol}">
        <h2 class="calc-rol">${ROLES[rol]}</h2>
        <div class="calc-cabeza">
          ${sprite(l.nombre, { clase: "grande con-fondo" })}
          <div class="calc-cabeza-texto">
            <input type="search" class="calc-especie" list="calc-especies" value="${escapar(l.nombre)}" aria-label="${ROLES[rol]} Pokémon" autocomplete="off" data-campo="especie">
            <span class="tipos">${listaTipos(e?.tipos ?? [])}</span>
          </div>
        </div>
        <p class="nota">${escapar(l.nota)}</p>
        <div class="calc-rejilla">
          <label class="campo"><span class="campo-etiqueta">Item</span>
            <input type="search" list="calc-objetos" placeholder="None" value="${escapar(l.objeto ? nombreEn("objetos", l.objeto) : "")}" autocomplete="off" data-campo="objeto"></label>
          <label class="campo"><span class="campo-etiqueta">Ability</span>
            <input type="search" list="calc-habilidades" placeholder="None" value="${escapar(l.habilidad ? nombreEn("habilidades", l.habilidad) : "")}" autocomplete="off" data-campo="habilidad"></label>
          <label class="campo"><span class="campo-etiqueta">Nature</span>
            <select data-campo="naturaleza">
              ${naturalezas.map(([n]) => `<option value="${n}"${n === l.naturaleza ? " selected" : ""}>${n}</option>`).join("")}
            </select></label>
          ${conTera ? `<label class="campo"><span class="campo-etiqueta">Tera type</span>
            <select data-campo="tera">
              <option value="">None</option>
              ${Object.keys(TIPOS).map((t) => `<option value="${t}"${t === l.tera ? " selected" : ""}>${mayuscula(t)}</option>`).join("")}
            </select></label>` : ""}
        </div>
        <p class="campo-etiqueta calc-reparto-titulo">${formato.champions ? "Stat points" : "EVs"}</p>
        <div class="calc-reparto">
          ${ESTADISTICAS.map((nombre, i) => `
            <label class="calc-celda"><span>${nombre}</span>
              <input type="number" inputmode="numeric" min="0" max="${maximo}" value="${l.valores[i]}" data-valor="${i}" aria-label="${nombre} ${formato.champions ? "points" : "EVs"}"></label>`).join("")}
        </div>
        <p class="nota calc-total" data-total></p>
        <div class="calc-subidas" data-subidas></div>
      </section>`;
    pintarTotal(rol);
    pintarSubidas(rol);
  }

  function pintarTotal(rol) {
    const l = estado[rol];
    const total = l.valores.reduce((suma, v) => suma + v, 0);
    const texto = sitio(rol).querySelector("[data-total]");
    texto.textContent = estado.avisoReparto[rol] || `Total ${total} / ${maximoTotal(formato)} ${formato.champions ? "points" : "EVs"}`;
    texto.classList.toggle("error", Boolean(estado.avisoReparto[rol]));
  }

  // Las subidas son de la estadística que el movimiento usa: Atq o AtEsp del atacante, Def o DefEsp del defensor
  function pintarSubidas(rol) {
    const l = estado[rol];
    const toca = estadisticasQueToca(estado.movimiento);
    const lista = !toca ? [] : rol === "a" ? (toca.delRival ? [] : [toca.ca]) : [toca.cd, ...(toca.delRival ? [toca.ca] : [])];
    sitio(rol).querySelector("[data-subidas]").innerHTML = lista.map((i) => `
      <div class="calc-subida" data-est="${i}">
        <span class="calc-subida-etiqueta">${ESTADISTICAS[i]} boost</span>
        <div class="calc-subida-botones">
          <button type="button" class="boton secundario" data-subida="-6">-6</button>
          <button type="button" class="boton secundario" data-subida="-1" aria-label="Lower ${ESTADISTICAS[i]} boost by 1">−</button>
          <button type="button" class="boton secundario calc-subida-valor" data-subida="0" aria-label="Reset ${ESTADISTICAS[i]} boost">${signo(l.boosts[i])}</button>
          <button type="button" class="boton secundario" data-subida="1" aria-label="Raise ${ESTADISTICAS[i]} boost by 1">+</button>
          <button type="button" class="boton secundario" data-subida="6">+6</button>
        </div>
      </div>`).join("");
  }

  function pintarMovimientos() {
    const lista = [...new Set([...estado.a.movimientos, estado.extra].filter(Boolean))];
    raiz.querySelector("[data-movimientos]").innerHTML = lista.length
      ? lista.map((id) => `<button type="button" class="segmento" data-mov="${id}" aria-pressed="${id === estado.movimiento}">${escapar(nombreEn("movimientos", id))}</button>`).join("")
      : `<span class="nada">This Pokémon has no moves in its set: search one below.</span>`;
  }

  // ---------------------------------------------------------------------------
  // Resultado

  function actualizarResultado() {
    const ko = raiz.querySelector("[data-ko]");
    const rango = raiz.querySelector("[data-rango]");
    const detalle = raiz.querySelector("[data-detalle]");
    const notas = [];
    const poner = (textoKo, min, max, textoRango, textoDetalle) => {
      ko.textContent = textoKo;
      raiz.querySelector("[data-barra-min]").style.width = `${Math.min(100, min)}%`;
      raiz.querySelector("[data-barra-rango]").style.width = `${Math.max(0, Math.min(100, max) - Math.min(100, min))}%`;
      rango.textContent = textoRango;
      detalle.textContent = textoDetalle;
    };
    const mostrarNotas = () => {
      raiz.querySelector("[data-notas]").innerHTML = notas.map((n) => `<li>${escapar(n)}</li>`).join("");
    };

    if (!estado.movimiento) {
      poner("Pick a move", 0, 0, "", "");
      mostrarNotas();
      return;
    }
    let resultado;
    try {
      resultado = calcular(estado, formato);
    } catch (error) {
      poner("Couldn't calculate", 0, 0, "", error.message);
      mostrarNotas();
      return;
    }
    const { dano, psMaximos, sinProgramar, paradoja } = resultado;
    const m = dic().movimientos[estado.movimiento];
    const descripcion = `${nombreEn("movimientos", estado.movimiento)} · ${mayuscula(m?.tipo ?? "")} · ${CLASES[m?.clase] ?? ""}`;

    if (m?.clase === "Estado") {
      poner("Status move", 0, 0, "It deals no direct damage.", descripcion);
    } else if (dano.ef === 0) {
      poner("Immune", 0, 0, "No damage.", descripcion);
    } else {
      const hp = (pct) => Math.round((pct * psMaximos) / 100);
      poner(
        textoKO(dano.min, dano.max) ?? "No KO",
        dano.min, dano.max,
        `${hp(dano.min)} – ${hp(dano.max)} HP (${formatoPct(dano.min)} – ${formatoPct(dano.max)})`,
        `${descripcion} · x${dano.ef} · average ${formatoPct(dano.media)} of ${psMaximos} HP`,
      );
    }

    if (paradoja.length) notas.push(...paradoja);
    if (sinProgramar.length) notas.push(`Not modeled by the simulator, so ignored: ${sinProgramar.join(", ")}.`);
    if (m?.clase !== "Estado" && dano.ef !== 0) notas.push("KO chances assume the damage rolls are evenly spaced between the minimum and the maximum.");
    if (formato.modo === "Doubles") notas.push("Single-target calculation: the spread-move reduction and allies' effects aren't included.");
    notas.push("Abilities that trigger on entry (Intimidate, Drought…) don't run here: use the boosts and the Field.");
    for (const rol of ["a", "d"]) if (estado.avisoReparto[rol]) notas.push(`${ROLES[rol]}: the invalid spread is ignored; the last valid one is used.`);
    mostrarNotas();
  }

  function repintarTodo() {
    pintarTarjeta("a");
    pintarTarjeta("d");
    pintarMovimientos();
    actualizarResultado();
  }

  // ---------------------------------------------------------------------------
  // Eventos

  let ocupado = false;   // mientras se carga un set, un segundo cambio no lo pisa
  async function cambiarEspecie(rol, nombre) {
    if (ocupado) return;
    ocupado = true;
    try {
      estado[rol] = await cargarLado(nombre, formato);
      estado.avisoReparto[rol] = "";
      if (!vigente()) return;
      if (rol === "a") {
        estado.extra = null;
        estado.movimiento = primerMovimientoDeDano(estado.a);
        pintarMovimientos();
        pintarSubidas("d");
      }
      pintarTarjeta(rol);
      actualizarResultado();
    } catch (error) {
      avisar(`Couldn't load ${nombre}`);
    } finally {
      ocupado = false;
    }
  }

  raiz.addEventListener("focusin", (e) => {
    if (e.target.matches("input[type=search], input[type=number]")) e.target.select();
  });

  raiz.addEventListener("change", (e) => {
    const campo = e.target.dataset.campo;
    const rol = e.target.closest("[data-lado]")?.dataset.lado;
    if (e.target.matches("[data-otro-mov]")) {
      const id = buscarId("movimientos", e.target.value);
      if (!id) { if (e.target.value.trim()) avisar("Unknown move"); return; }
      estado.extra = estado.a.movimientos.includes(id) ? null : id;
      estado.movimiento = id;
      e.target.value = "";
      pintarMovimientos();
      pintarSubidas("a");
      pintarSubidas("d");
      actualizarResultado();
      return;
    }
    if (!rol || !campo) return;
    const l = estado[rol];
    if (campo === "especie") {
      const nombre = nombreDeEspecie(e.target.value);
      if (!nombre) { avisar("Unknown Pokémon"); e.target.value = l.nombre; return; }
      if (nombre !== l.nombre) cambiarEspecie(rol, nombre);
    } else if (campo === "objeto" || campo === "habilidad") {
      const tabla = campo === "objeto" ? "objetos" : "habilidades";
      if (!e.target.value.trim()) l[campo] = null;
      else {
        const id = buscarId(tabla, e.target.value);
        if (!id) { avisar(campo === "objeto" ? "Unknown item" : "Unknown ability"); e.target.value = l[campo] ? nombreEn(tabla, l[campo]) : ""; return; }
        l[campo] = id;
        e.target.value = nombreEn(tabla, id);
      }
      actualizarResultado();
    } else if (campo === "naturaleza") {
      l.naturaleza = e.target.value;
      actualizarResultado();
    } else if (campo === "tera") {
      l.tera = e.target.value || null;
      actualizarResultado();
    }
  });

  raiz.addEventListener("input", (e) => {
    const celda = e.target.closest("[data-valor]");
    const rol = e.target.closest("[data-lado]")?.dataset.lado;
    if (!celda || !rol) return;
    const valores = [...sitio(rol).querySelectorAll("[data-valor]")].map((c) => (c.value === "" ? 0 : Number(c.value)));
    if (repartoValido(valores, formato)) {
      estado[rol].valores = valores;
      estado.avisoReparto[rol] = "";
    } else {
      estado.avisoReparto[rol] = `Invalid spread: at most ${maximoPorEstadistica(formato)} per stat and ${maximoTotal(formato)} in total.`;
    }
    pintarTotal(rol);
    actualizarResultado();
  });

  raiz.addEventListener("click", (e) => {
    const boton = e.target.closest("button");
    if (!boton) return;
    const rol = boton.closest("[data-lado]")?.dataset.lado;
    if (boton.dataset.subida !== undefined && rol) {
      const i = Number(boton.closest("[data-est]").dataset.est);
      const l = estado[rol];
      const paso = Number(boton.dataset.subida);
      const nuevo = Math.abs(paso) === 6 ? paso : paso === 0 ? 0 : l.boosts[i] + paso;
      l.boosts[i] = Math.max(-6, Math.min(6, nuevo));
      pintarSubidas(rol);
      actualizarResultado();
    } else if (boton.dataset.mov) {
      estado.movimiento = boton.dataset.mov;
      pintarMovimientos();
      pintarSubidas("a");
      pintarSubidas("d");
      actualizarResultado();
    } else if (boton.matches("[data-intercambiar]")) {
      [estado.a, estado.d] = [estado.d, estado.a];
      [estado.avisoReparto.a, estado.avisoReparto.d] = [estado.avisoReparto.d, estado.avisoReparto.a];
      estado.extra = null;
      estado.movimiento = primerMovimientoDeDano(estado.a);
      repintarTodo();
    } else if (boton.dataset.clima !== undefined || boton.dataset.terreno !== undefined) {
      const clave = boton.dataset.clima !== undefined ? "clima" : "terreno";
      estado[clave] = boton.dataset[clave];
      boton.parentElement.querySelectorAll(".segmento").forEach((b) => b.setAttribute("aria-pressed", String(b === boton)));
      actualizarResultado();
    }
  });

  raiz.querySelectorAll("[data-pantalla]").forEach((interruptor) => interruptor.addEventListener("change", () => {
    estado.pantallas[interruptor.dataset.pantalla] = interruptor.checked;
    actualizarResultado();
  }));

  repintarTodo();
}

// ---------------------------------------------------------------------------
// Datos de un lado

/** Un Pokémon listo para la calculadora: su set más usado en el formato (o el de respaldo de setParaEquipo). */
async function cargarLado(nombre, formato) {
  const e = especie(nombre);
  if (!e) throw new Error(`Unknown Pokémon: ${nombre}`);
  const r = await setParaEquipo(nombre, formato);
  const set = r.set ?? { objeto: null, habilidad: e.habilidades?.[0] ?? null, tera: null, naturaleza: "Serious", valores: [0, 0, 0, 0, 0, 0], movimientos: [] };
  let nota;
  if (!r.set) nota = "No usage data for this Pokémon: empty set.";
  else {
    nota = r.fuente ? `Published set (${r.fuente})` : r.origen ? `Most used set in ${r.origen.nombre} (no data in ${formato.nombre})` : `Most used set in ${formato.nombre}`;
    if (r.sinReparto) nota += ", spread left empty (EVs and Champions points aren't converted)";
    nota += ".";
  }
  return {
    nombre, objeto: set.objeto ?? null, habilidad: set.habilidad ?? null, naturaleza: set.naturaleza ?? "Serious",
    valores: [...set.valores], tera: null,   // el teratipo se elige a mano: con uno puesto, el Pokémon ya está teracristalizado
    movimientos: [...set.movimientos], boosts: [0, 0, 0, 0, 0, 0], nota,
  };
}

function primerMovimientoDeDano(l) {
  // El de más potencia entre los que dañan; si ninguno daña, el primero del set
  const potencia = (id) => (dic().movimientos[id]?.clase === "Estado" ? -1 : dic().movimientos[id]?.potencia ?? 0);
  return l.movimientos.reduce((mejor, id) => (potencia(id) > potencia(mejor) ? id : mejor), l.movimientos[0] ?? null);
}

/** Con qué estadísticas se calcula el daño de un movimiento, según el motor: ca ataca, cd defiende. */
function estadisticasQueToca(idMovimiento) {
  const clase = dic().movimientos[idMovimiento]?.clase;
  if (!idMovimiento || !clase || clase === "Estado") return null;
  const k = datosDeCombate().movimientos[idMovimiento] ?? {};
  return {
    ca: k.atacaCon === "def" ? 2 : clase === "Físico" ? 1 : 3,
    cd: clase === "Físico" || k.defiendeCon === "def" ? 2 : 4,
    delRival: Boolean(k.atacaConLaDelRival),     // Juego Sucio: usa el Ataque del defensor
  };
}

// ---------------------------------------------------------------------------
// Cálculo

/** Monta un combate sin salida al campo con lo elegido y pide el daño al motor. */
function calcular(estado, formato) {
  const miembro = (l) => ({
    especie: l.nombre, objeto: l.objeto, habilidad: l.habilidad, naturaleza: l.naturaleza, valores: l.valores,
    tera: l.tera, movimientos: l === estado.a ? [estado.movimiento] : l.movimientos,
  });
  const antes = new Map(sinEfecto().map((x) => [`${x.clase}|${x.id}`, x.veces]));
  const c = crearCombate([miembro(estado.a)], [miembro(estado.d)], { formato, semilla: 1, sinSalir: true });
  // El motor anota lo que lleva un Pokémon y no tiene efecto programado: lo nuevo es de esta llamada
  const sinProgramar = sinEfecto()
    .filter((x) => (x.clase === "habilidad" || x.clase === "objeto") && x.veces > (antes.get(`${x.clase}|${x.id}`) ?? 0))
    .map((x) => `${x.clase === "objeto" ? "item" : "ability"} ${nombreEn(x.clase === "objeto" ? "objetos" : "habilidades", x.id)}`);

  const atacante = c.lados.yo.equipo[0];
  const defensor = c.lados.rival.equipo[0];
  for (const [p, l] of [[atacante, estado.a], [defensor, estado.d]]) {
    // Sin salir al campo no hay Megaevolución: la forma Mega con su piedra se pone directamente
    if (p.ficha.mega) {
      const { mega, ...resto } = p.ficha;
      p.ficha = { ...resto, id: mega.id, tipos: mega.tipos.slice(), est: mega.est };
      p.tipos = mega.tipos.slice();
      p.habilidad = mega.habilidad;
    }
    l.boosts.forEach((b, i) => { p.mods[i] = b; });
  }
  if (estado.d.tera) defensor.tera = defensor.ficha.tera;
  if (estado.clima) c.clima = { id: estado.clima, turnos: 5, lado: "yo" };
  if (estado.terreno) c.campo = { id: estado.terreno, turnos: 5, lado: "yo" };
  for (const [id, activa] of Object.entries(estado.pantallas)) if (activa) c.lados.rival.pantallas[id] = 5;

  const paradoja = [atacante, defensor].map((p) => activarParadoja(c, p)).filter(Boolean);
  const dano = calcularDano(c, "yo", estado.movimiento, { tera: Boolean(estado.a.tera) });
  return { dano, psMaximos: defensor.ficha.est[0], sinProgramar, paradoja };
}

/** Protosíntesis y Carga Cuark: el motor las activa al entrar o al cambiar el campo; aquí no entra nadie. */
function activarParadoja(c, p) {
  const delCampo = { protosynthesis: c.clima?.id === "sunnyday", quarkdrive: c.campo?.id === "electricterrain" }[p.habilidad];
  if (delCampo === undefined || (!delCampo && p.objeto !== "boosterenergy")) return null;
  let mejor = 1;
  for (let i = 2; i <= 5; i++) if (conMod(p.ficha.est[i], p.mods[i]) > conMod(p.ficha.est[mejor], p.mods[mejor])) mejor = i;
  p.v.paradoja = mejor;
  if (!delCampo) p.v.porObjeto = true;
  return `${p.nombre}: ${nombreEn("habilidades", p.habilidad)} is active (${delCampo ? "from the field" : "Booster Energy"}) and boosts ${ESTADISTICAS[mejor]}.`;
}

// ---------------------------------------------------------------------------
// Texto de KO

const golpes = (n) => (n === 1 ? "OHKO" : `${n}HKO`);

/** Probabilidad de que n golpes sumen el 100 % o más, con 16 tiradas repartidas por igual entre min y max. */
function probabilidadDeKO(min, max, n) {
  const tiradas = Array.from({ length: 16 }, (_, i) => min + ((max - min) * i) / 15);
  let sumas = [0];
  for (let k = 0; k < n; k++) sumas = sumas.flatMap((s) => tiradas.map((t) => s + t));
  return sumas.filter((s) => s >= 100 - 1e-9).length / sumas.length;
}

/** «Guaranteed 2HKO», «75% chance to OHKO»… a partir del % mínimo y máximo sobre los PS del defensor. */
function textoKO(min, max) {
  if (max <= 0) return null;
  for (let n = 1; n <= 9; n++) {
    if (min * n >= 100) return `Guaranteed ${golpes(n)}`;
    if (max * n < 100) continue;
    if (n > 4) return `Possible ${golpes(n)}`;   // más de 4 golpes: demasiadas combinaciones para contarlas
    const pct = Math.round(probabilidadDeKO(min, max, n) * 1000) / 10;
    return pct >= 0.1 ? `${pct}% chance to ${golpes(n)}` : `Possible ${golpes(n)}`;
  }
  return null;
}
