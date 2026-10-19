// Motor del simulador de combates: las reglas de un combate individual (6 contra 6 en Gen 9 OU; en BSS y VGC
// juegan los que elige la IA, ver seleccion.js) con su nivel, sus puntos de estadística y su Megaevolución en los
// formatos de Pokémon Champions.
// No pinta nada y no decide jugadas (eso es de la IA): recibe dos acciones y resuelve el turno.
// No usa el DOM ni Math.random, así que se prueba con Node: node herramientas/probar-sim.mjs
// El contrato está en disenos/implementacion/CONTRATO-SIMULADOR.md.
//
// Antes de crear un combate hay que esperar a cargarDatos() de ./datos.js. Después todo es inmediato:
//
//   crearCombate(equipoYo, equipoRival, { formato, semilla }) → estado
//   opciones(estado, lado)                        → [{ tipo: "mov", id, tera? } | { tipo: "cambio", a }]
//   resolverTurno(estado, accionYo, accionRival, { relevo }?) → [Evento]
//   elegirRelevo(estado, lado, indice)            → [Evento]
//   calcularDano(estado, lado, idMovimiento, { tera }) → { min, max, media, ef }
//   velocidad(estado, pokemon)                    → la Velocidad con la que se ordena el turno
//   ganador(estado) · clonar(estado) · sinEfecto()
//
// Quién entra cuando hay que sacar a otro (tras un debilitado, o al usar Ida y Vuelta). Hay tres maneras:
//   1. Pasar a resolverTurno la función «relevo(estado, lado) → indice» (la de la IA vale tal cual):
//      el turno sale completo, con las entradas incluidas. No debe cambiar el estado que recibe.
//   2. Sin esa función, los lados que tienen que sacar a otro quedan en estado.pendientes: se llama a
//      elegirRelevo(estado, lado, indice), que devuelve los eventos de la entrada para añadirlos al turno.
//      Llamada antes de tiempo, deja elegido a quien saldrá la próxima vez que ese lado tenga que cambiar.
//   3. Si no se hace ni lo uno ni lo otro, opciones() de ese lado solo ofrece cambios; el siguiente
//      resolverTurno con uno de ellos hace solo las entradas, y con otra cosa elige el motor.
//   Un movimiento que cambia a quien lo usa admite también «a» en su acción: { tipo: "mov", id: "uturn", a: 3 }.
//
// Los eventos salen una sola vez, los devuelva quien los devuelva. Los de la salida de los dos primeros
// Pokémon van delante de los del turno 1. Lo que no es de un movimiento, una habilidad ni un objeto
// (clima, retroceso, drenaje, Deseo, confusión) sale como «estado», con su nombre en «n».
// Trampas: el evento «rocas» lleva en «n» cuál hace el daño (Trampa Rocas o Púas). Y cuando las trampas de
// algún lado cambian (se ponen, se quitan, se absorben), el último evento de ese momento lleva además
// «trampas»: { yo: [[nombre, capas]], rival: […] }, lo que hay en el campo de cada lado después de él.
//
// El estado es un objeto sin funciones: { nivel, turno, rng, lados: { yo, rival }, clima, campo,
// espacioRaro, gravedad, pendientes, ganador }. Cada lado: { equipo, activo, teraUsada, megaUsada, trampas,
// pantallas, vientoAfin, caidos }. Cada Pokémon: { nombre, lado, indice, ficha (lo que no cambia: id,
// tipos, est, movimientos, tera, peso), ps, pct, estado, mods, tipos, tera, habilidad, objeto, pp, caido, v }.
//
// Megaevolución (formatos con «mega» en sus datos): un Pokémon de forma Mega que lleva su megapiedra sale
// al campo con su forma base y megaevoluciona al empezar el primer turno en que ataca, uno por equipo.
// Sale como evento «obj» de su megapiedra con «mega: true». Hasta entonces no tiene habilidad: las
// estadísticas de uso solo dan la de la forma Mega, y la de la forma base no se inventa.
import { dic, especie, estadisticasReales, nombreHabilidad, nombreMovimiento, nombreObjeto } from "../meta.js";
import { factor, nombreTipo } from "../tipos.js";
import { datosDeCombate, formatoCargado } from "./datos.js";

const LADOS = ["yo", "rival"];
const CARACTERISTICAS = ["HP", "Attack", "Defense", "Sp. Atk", "Sp. Def", "Speed", "Accuracy", "Evasiveness"];
const INDICE = { atk: 1, def: 2, spa: 3, spd: 4, spe: 5, accuracy: 6, evasion: 7 };   // nombres de Showdown
const ESTADOS = {
  brn: { n: "Burn", pone: "was burned", dano: "was hurt by its burn" },
  par: { n: "Paralysis", pone: "is paralyzed! It may be unable to move" },
  psn: { n: "Poison", pone: "was poisoned", dano: "was hurt by poison" },
  tox: { n: "Bad Poison", pone: "was badly poisoned", dano: "was hurt by poison" },
  slp: { n: "Sleep", pone: "fell asleep" },
  frz: { n: "Freeze", pone: "was frozen solid" },
};
const CLIMAS = {
  sandstorm: { n: "Sandstorm", empieza: "A sandstorm kicked up!", acaba: "The sandstorm subsided." },
  raindance: { n: "Rain", empieza: "It started to rain!", acaba: "The rain stopped." },
  sunnyday: { n: "Sun", empieza: "The sunlight turned harsh!", acaba: "The sunlight faded." },
  snowscape: { n: "Snow", empieza: "It started to snow!", acaba: "The snow stopped." },
};
const CAMPOS = {
  electricterrain: { n: "Electric Terrain", tipo: "electric" },
  grassyterrain: { n: "Grassy Terrain", tipo: "grass" },
  psychicterrain: { n: "Psychic Terrain", tipo: "psychic" },
  mistyterrain: { n: "Misty Terrain", tipo: null },
};
const TRAMPAS = { stealthrock: 1, spikes: 3, toxicspikes: 2, stickyweb: 1 };   // capas que admite cada una
const PANTALLAS = ["reflect", "lightscreen", "auroraveil"];
const PROTECCIONES = ["protect", "banefulbunker", "spikyshield", "kingsshield", "burningbulwark", "silktrap"];
const MASCARAS = { wellspringmask: "water", hearthflamemask: "fire", cornerstonemask: "rock" };
const NADA = {};           // habilidad u objeto que no hace nada
const AJENO = { v: {} };   // autor de lo que no viene de un Pokémon concreto (Red Viscosa)

let alRelevar = null;      // la función «relevo» de resolverTurno, mientras dura la llamada
const pendientes = new Map();   // lo que ha aparecido y no tiene efecto programado: «clase|id» → veces

// ---------------------------------------------------------------------------
// Utilidades

const otro = (lado) => (lado === "yo" ? "rival" : "yo");
const limitar = (n, min, max) => Math.min(max, Math.max(min, n));
const redondear = (n) => Math.ceil(n - 0.5);          // como el juego: redondea y, si queda en medio, hacia abajo
const psMax = (p) => p.ficha.est[0];
const fraccion = (p, num, den) => Math.max(1, Math.floor((psMax(p) * num) / den));
const activo = (c, lado) => c.lados[lado].equipo[c.lados[lado].activo];
const rivalDe = (c, p) => activo(c, otro(p.lado));
const pctDe = (p) => (p.ps <= 0 ? 0 : Math.max(1, Math.round((p.ps * 100) / psMax(p))));   // con PS, nunca un 0 %
const aId = (texto) => String(texto).toLowerCase().replace(/[^a-z0-9]+/g, "");
const climaEs = (c, id) => c.clima?.id === id;
const lista = (nombres) => (nombres.length > 1 ? `${nombres.slice(0, -1).join(", ")} and ${nombres.at(-1)}` : nombres[0] ?? "");

/** Índices de los Pokémon del lado que pueden entrar. */
function banquillo(c, lado) {
  const L = c.lados[lado];
  return L.equipo.filter((p) => p.ps > 0 && p.indice !== L.activo).map((p) => p.indice);
}

function tipos(p) {
  if (p.tera && p.tera !== "stellar") return [p.tera];
  return p.v.posado ? p.tipos.filter((t) => t !== "flying") : p.tipos;
}
const tiene = (p, tipo) => tipos(p).includes(tipo);

function apuntar(clase, id) {
  const clave = `${clase}|${id}`;
  pendientes.set(clave, (pendientes.get(clave) ?? 0) + 1);
}

// Azar con semilla (mulberry32): todo lo que hace falta para repetirlo está en estado.rng
function azar(c) {
  let t = (c.rng.s = (c.rng.s + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const entero = (c, n) => Math.floor(azar(c) * n);          // de 0 a n − 1
const suerte = (c, num, den) => azar(c) * den < num;       // «num» de cada «den» veces

function semillaDe(valor) {
  if (Number.isFinite(valor)) return valor >>> 0;
  if (typeof valor === "string") {
    let h = 2166136261;
    for (const letra of valor) h = Math.imul(h ^ letra.codePointAt(0), 16777619);
    return h >>> 0;
  }
  return Date.now() >>> 0;
}

// ---------------------------------------------------------------------------
// Eventos

function emitir(c, evento) {
  for (const campo of Object.keys(evento)) if (evento[campo] === undefined || evento[campo] === null) delete evento[campo];
  avisarDeTrampas(c);   // lo que haya cambiado hasta aquí es cosa del evento anterior
  c.ev.push(evento);
  return evento;
}

/** Las trampas de los dos lados en un solo número: sirve para saber si han cambiado. */
function codigoDeTrampas(c) {
  let codigo = 0;
  for (const lado of LADOS) for (const id of Object.keys(TRAMPAS)) codigo = codigo * 4 + (c.lados[lado].trampas[id] ?? 0);
  return codigo;
}

/**
 * Si las trampas han cambiado desde el último aviso, el último evento emitido se lleva «trampas»: lo que
 * hay en cada lado, [[nombre, capas]]. Las pantallas no tienen otra manera de saber qué trampas hay puestas.
 */
function avisarDeTrampas(c) {
  const codigo = codigoDeTrampas(c);
  if (codigo === c.trampasVistas) return;
  const ultimo = c.ev.at(-1);
  if (!ultimo) return;   // todavía no hay a quién colgárselo: lo llevará el primer evento que salga
  c.trampasVistas = codigo;
  ultimo.trampas = Object.fromEntries(LADOS.map((lado) => [lado,
    Object.keys(TRAMPAS).filter((id) => c.lados[lado].trampas[id]).map((id) => [nombreMovimiento(id), c.lados[lado].trampas[id]])]));
}

/** Añade una frase al texto de un evento que ya ha salido. */
function anotar(ev, txt) {
  if (ev && txt) ev.txt = ev.txt ? `${ev.txt}. ${txt}` : txt;
  return ev;
}

const evHab = (c, p, txt, da, id = p.habilidad) => emitir(c, { t: "hab", lado: p.lado, p: p.nombre, n: nombreHabilidad(id), txt, da });
const evObj = (c, p, txt, da, id = p.objeto) => emitir(c, { t: "obj", lado: p.lado, p: p.nombre, n: nombreObjeto(id), txt, da });
const evEfecto = (c, p, n, txt, da) => emitir(c, { t: "estado", lado: p.lado, p: p.nombre, n, txt, da });

/** Devuelve los eventos que no se han entregado todavía, con el «fin» si el combate ha terminado. */
function salida(c) {
  avisarDeTrampas(c);
  if (c.ganador && !c.cerrado) {
    c.cerrado = true;
    c.pendientes = [];
    emitir(c, { t: "fin", gana: c.ganador });
  }
  const eventos = c.ev;
  c.ev = [];
  return eventos;
}

// ---------------------------------------------------------------------------
// Habilidades y objetos: quién tiene qué

const hayGas = (c) => LADOS.some((lado) => { const p = activo(c, lado); return p.ps > 0 && p.habilidad === "neutralizinggas"; });

function hab(c, p) {
  const h = HABILIDADES[p.habilidad];
  if (!h || (p.habilidad !== "neutralizinggas" && hayGas(c))) return NADA;
  return h;
}

/** La habilidad de quien recibe un movimiento: no cuenta si quien ataca la ignora (Rompemoldes). */
function habDefensiva(c, p, autor, m) {
  if (autor && autor !== p && (m?.ignoraHabilidad || hab(c, autor).rompemoldes)) return NADA;
  return hab(c, p);
}

const obj = (c, p) => OBJETOS[p.objeto] ?? NADA;

/** El Pokémon se queda sin objeto (lo gasta o se lo quitan). Devuelve el que tenía. */
function gastarObjeto(c, p) {
  const id = p.objeto;
  p.objeto = null;
  p.v.liviano = true;   // Liviano
  return id;
}

/** Megaevoluciona al Pokémon (ya se sabe que puede): cambia de forma, de tipos, de estadísticas y de habilidad. */
function megaevolucionar(c, p) {
  const { mega, ...resto } = p.ficha;
  p.ficha = { ...resto, id: mega.id, tipos: mega.tipos.slice(), est: mega.est };   // una ficha nueva: los clones comparten la vieja
  p.tipos = mega.tipos.slice();
  p.habilidad = mega.habilidad;
  c.lados[p.lado].megaUsada = true;
  evObj(c, p, `${p.ficha.base} has Mega Evolved into ${p.nombre}!`, null, p.ficha.piedra).mega = true;
  hab(c, p).alEntrar?.(c, p);   // Sequía, Chorro Arena, Nevada… se activan al megaevolucionar
}

/** ¿Se le puede quitar el objeto? Las máscaras de Ogerpon y la Energía Potenciadora de un paradoja, no. */
function quitable(p) {
  if (!p.objeto) return false;
  if (p.ficha.piedra && p.objeto === p.ficha.piedra) return false;   // una megapiedra en su Pokémon no se quita
  if (MASCARAS[p.objeto] && p.nombre.startsWith("Ogerpon")) return false;
  if (p.objeto === "boosterenergy" && HABILIDADES[p.habilidad]?.paradoja) return false;
  return true;
}

// ---------------------------------------------------------------------------
// PS, problemas de estado y características

/** Cambia los PS y devuelve el «da» del evento que lo cuente, o null si no ha cambiado nada. */
function cambiarPS(p, delta) {
  if (p.ps <= 0) return null;
  const ps = limitar(p.ps + Math.trunc(delta), 0, psMax(p));
  if (ps === p.ps) return null;
  const antes = p.pct;
  p.ps = ps;
  p.pct = pctDe(p);
  return [p.lado, p.nombre, antes, p.pct];
}

const herir = (p, cantidad) => cambiarPS(p, -Math.max(1, cantidad));

/** Daño que no viene de un golpe (trampas, clima, veneno, retroceso): Muro Mágico lo evita. */
function herirIndirecto(c, p, cantidad) {
  return hab(c, p).sinDanoIndirecto ? null : herir(p, cantidad);
}

function curar(c, p, cantidad) {
  return p.v.sinCura ? null : cambiarPS(p, Math.max(1, cantidad));
}

function ponerEstado(c, p, id, autor = null, m = null, ev = null) {
  const no = (txt) => { anotar(ev, txt); return false; };
  if (p.ps <= 0) return false;
  if (p.estado) return no(`${p.nombre} already has a status condition`);
  const suyos = tipos(p);
  const inmune = (id === "brn" && suyos.includes("fire")) || (id === "par" && suyos.includes("electric")) ||
    ((id === "psn" || id === "tox") && (suyos.includes("poison") || suyos.includes("steel"))) || (id === "frz" && suyos.includes("ice"));
  if (inmune) return no(`It doesn't affect ${p.nombre}`);
  if (enElSuelo(c, p)) {
    if (c.campo?.id === "mistyterrain") return no(`Misty Terrain protects ${p.nombre}`);
    if (id === "slp" && c.campo?.id === "electricterrain") return no(`Electric Terrain keeps ${p.nombre} awake`);
  }
  const h = autor && autor !== p ? habDefensiva(c, p, autor, m) : hab(c, p);
  if (h.inmuneEstado?.(id)) return no(`${nombreHabilidad(p.habilidad)} protects ${p.nombre}`);
  if (id === "frz" && climaEs(c, "sunnyday")) return no("Fails");
  p.estado = id;
  p.cuenta = id === "slp" ? 2 + entero(c, 3) : 1;   // dormido, de 1 a 3 turnos; el veneno grave empieza en 1/16
  delete p.v.carga;
  delete p.v.invulnerable;
  evEfecto(c, p, ESTADOS[id].n, `${p.nombre} ${ESTADOS[id].pone}`);
  // Títere Tóxico: a quien envenena con un movimiento, además lo confunde
  if ((id === "psn" || id === "tox") && autor && autor !== p && m && hab(c, autor).titere) ponerVolatil(c, p, "confusion", autor, m, null);
  return true;
}

const conMod = (valor, n) => Math.floor(n >= 0 ? (valor * (2 + n)) / 2 : (valor * 2) / (2 - n));

/**
 * Cambia las características de p («cambios» con los nombres de Showdown: { atk: -1 }) y añade la frase
 * al evento «ev». «autor» es quien lo provoca: si no es el propio Pokémon, cuentan Cuerpo Puro y Competitivo.
 */
function cambiarCaracteristicas(c, p, cambios, autor, ev, m = null) {
  if (p.ps <= 0) return false;
  const ajeno = autor !== p;
  const h = ajeno ? habDefensiva(c, p, autor, m) : hab(c, p);
  let pedidos = Object.entries(cambios).map(([nombre, n]) => [INDICE[nombre], h.invierte ? -n : n]);
  if (ajeno && h.sinBajadas && pedidos.some(([, n]) => n < 0)) {
    pedidos = pedidos.filter(([, n]) => n > 0);
    anotar(ev, `${nombreHabilidad(p.habilidad)} prevents ${p.nombre}'s stats from being lowered`);
  }
  const hechos = new Map();   // variación → características
  let baja = false;
  for (const [i, n] of pedidos) {
    const nuevo = limitar(p.mods[i] + n, -6, 6);
    const variacion = nuevo - p.mods[i];
    if (!variacion) continue;
    p.mods[i] = nuevo;
    if (variacion < 0) baja = true;
    else p.v.subio = true;   // Voz Seductora y Envidia Ardiente miran si ha subido algo este turno
    hechos.set(variacion, [...(hechos.get(variacion) ?? []), CARACTERISTICAS[i]]);
  }
  if (!hechos.size) return false;
  for (const [variacion, nombres] of hechos) {
    const cuanto = (variacion > 0 ? ["", "", " sharply", " drastically"] : ["", "", " harshly", " severely"])[Math.min(3, Math.abs(variacion))];
    anotar(ev, `${p.nombre}'s ${lista(nombres)} ${variacion > 0 ? "rose" : "fell"}${cuanto}!`);
  }
  if (baja && ajeno) h.trasBajar?.(c, p);
  return true;
}

/** Una habilidad o un objeto que cambia las características de su dueño: su evento solo se queda si cambia algo. */
function cambiarPor(c, p, cambios, ev) {
  if (!cambiarCaracteristicas(c, p, cambios, p, ev)) c.ev.splice(c.ev.lastIndexOf(ev), 1);
}

function mejorCaracteristica(p) {
  let mejor = 1;
  for (let i = 2; i <= 5; i++) if (conMod(p.ficha.est[i], p.mods[i]) > conMod(p.ficha.est[mejor], p.mods[mejor])) mejor = i;
  return mejor;
}

/**
 * Lo que dura mientras el Pokémon siga en el campo (confusión, Mofa, Sustituto, Protección…), con los
 * nombres de Showdown. Devuelve si se ha puesto; lo que haya que contar se añade al evento «ev».
 */
function ponerVolatil(c, p, id, autor, m, ev) {
  const v = p.v;
  if (p.ps <= 0) return false;
  if (PROTECCIONES.includes(id) || id === "endure") {
    // Cada uso seguido acierta un tercio de las veces que el anterior
    const sale = !v.protecciones || azar(c) < 1 / 3 ** v.protecciones;
    v.protecciones = sale ? (v.protecciones ?? 0) + 1 : 0;
    if (!sale) return false;
    if (id === "endure") v.aguante = true;
    else v.protegido = id;
    anotar(ev, id === "endure" ? `${p.nombre} braced itself!` : `${p.nombre} protected itself!`);
    return true;
  }
  switch (id) {
    case "confusion":
      if (v.confuso || (c.campo?.id === "mistyterrain" && enElSuelo(c, p))) return false;
      v.confuso = 2 + entero(c, 4);
      evEfecto(c, p, "Confusion", `${p.nombre} became confused!`);
      return true;
    case "flinch":
      if (c.t?.[p.lado]?.hecho) return false;   // ya se ha movido: no tiene de qué retroceder
      v.amedrentado = true;
      return true;
    case "taunt":
      if (v.mofa) return false;
      v.mofa = c.t?.[p.lado]?.hecho ? 4 : 3;
      anotar(ev, `${p.nombre} can only use attacking moves`);
      return true;
    case "encore":
      if (v.otraVez || !v.ultimo || ["encore", "struggle", "sleeptalk"].includes(v.ultimo) || !p.pp[p.ficha.movimientos.indexOf(v.ultimo)]) return false;
      v.otraVez = { id: v.ultimo, turnos: 3 };
      anotar(ev, `${p.nombre} must repeat ${nombreMovimiento(v.ultimo)}`);
      return true;
    case "disable":
      if (v.anulado || !v.ultimo || v.ultimo === "struggle") return false;
      v.anulado = { id: v.ultimo, turnos: 4 };
      anotar(ev, `${p.nombre} can't use ${nombreMovimiento(v.ultimo)}`);
      return true;
    case "leechseed":
      if (tiene(p, "grass")) { anotar(ev, `It doesn't affect ${p.nombre}`); return false; }
      if (v.drenadoras) return false;
      v.drenadoras = true;
      anotar(ev, `${p.nombre} was seeded!`);
      return true;
    case "substitute": {
      const coste = Math.floor(psMax(p) / 4);
      if (v.sustituto || p.ps <= coste) return false;
      ev.da = cambiarPS(p, -coste);
      v.sustituto = coste;
      anotar(ev, `${p.nombre} made a substitute!`);
      return true;
    }
    case "yawn":
      if (p.estado || v.bostezo) return false;
      v.bostezo = 2;
      anotar(ev, `${p.nombre} grew drowsy!`);
      return true;
    case "destinybond": v.destino = true; anotar(ev, `${p.nombre} is trying to take its foe down with it!`); return true;
    case "focusenergy": if (v.foco) return false; v.foco = true; anotar(ev, `${p.nombre} is getting pumped!`); return true;
    case "magnetrise": if (v.levitando || c.gravedad) return false; v.levitando = 5; anotar(ev, `${p.nombre} levitated with electromagnetism!`); return true;
    case "partiallytrapped":
      if (!v.atrapado) { v.atrapado = { turnos: 4 + entero(c, 2), por: autor.indice }; anotar(ev, `${p.nombre} can no longer escape!`); }
      return true;
    case "saltcure": if (v.salazon) return false; v.salazon = true; anotar(ev, `${p.nombre} is being salt cured!`); return true;
    case "healblock": v.sinCura = 2; anotar(ev, `${p.nombre} can't recover HP`); return true;
    case "smackdown": v.derribado = true; delete v.levitando; return true;
    case "sparklingaria":
      if (p.estado === "brn") { p.estado = null; anotar(ev, `${p.nombre}'s burn was healed`); }
      return true;
    case "roost": v.posado = true; return true;                       // deja de ser Volador hasta el final del turno
    case "mustrecharge": v.recarga = true; return true;
    case "glaiverush": v.imprudente = true; return true;               // hasta que vuelva a moverse, todo le acierta y le hace el doble
    case "lockedmove":
      v.encerrado ??= { id: m.id, turnos: 2 + entero(c, 2) };
      return true;
    default:
      apuntar("movimiento", m.id);
      return false;
  }
}

// ---------------------------------------------------------------------------
// Clima, campos y suelo

function enElSuelo(c, p, autor, m) {
  if (c.gravedad || p.v.derribado) return true;
  if (tiene(p, "flying") || p.v.levitando || obj(c, p).flota) return false;
  return !habDefensiva(c, p, autor, m).levita;
}

function ponerClima(c, id, p) {
  if (climaEs(c, id)) return false;
  c.clima = { id, turnos: obj(c, p).alargaClima === id ? 8 : 5, lado: p.lado };
  campoCambiado(c);
  return true;
}

function ponerCampo(c, id, p) {
  if (c.campo?.id === id) return false;
  c.campo = { id, turnos: obj(c, p).alargaCampo ? 8 : 5, lado: p.lado };
  campoCambiado(c);
  return true;
}

function quitarCampo(c) {
  if (!c.campo) return null;
  const nombre = CAMPOS[c.campo.id].n;
  c.campo = null;
  campoCambiado(c);
  return nombre;
}

/** Al cambiar el clima o el campo: Paleosíntesis, Carga Cuark y las semillas. */
function campoCambiado(c) {
  for (const p of porVelocidad(c)) {
    hab(c, p).alCambiarElCampo?.(c, p);
    obj(c, p).alCambiarElCampo?.(c, p);
  }
}

/** Avisa de algo del campo. Un evento siempre es de un lado: se le pone el de quien lo trajo. */
function avisarDelCampo(c, lado, n, txt) {
  const p = [activo(c, lado), activo(c, otro(lado))].find((x) => x.ps > 0);
  if (p) evEfecto(c, p, n, txt);
}

function quitarTrampas(L) {
  const habia = Object.keys(TRAMPAS).filter((id) => L.trampas[id]);
  for (const id of habia) L.trampas[id] = 0;
  return habia.map(nombreMovimiento);
}

// ---------------------------------------------------------------------------
// Movimientos: datos

const cacheDeMovimientos = new Map();

/** Todo lo que se sabe de un movimiento: el diccionario, datos/combate.json y lo programado a mano. */
function mov(id) {
  let m = cacheDeMovimientos.get(id);
  if (m) return m;
  const d = dic().movimientos[id];
  const k = datosDeCombate().movimientos[id];
  m = {
    id, n: nombreMovimiento(id), tipo: d?.tipo ?? "normal", clase: d?.clase ?? "Estado", potencia: d?.potencia ?? 0, precision: d?.precision ?? null,
    pp: 16, prioridad: 0, objetivo: "rival", efectos: [], ...k,
    marcas: Object.fromEntries((k?.marcas ?? []).map((marca) => [marca, true])),
    x: MOVIMIENTOS[id] ?? null,
    sinDatos: !k,
  };
  cacheDeMovimientos.set(id, m);
  return m;
}

function tipoDe(c, p, m) {
  return m.x?.tipo?.(c, p) ?? hab(c, p).tipoDe?.(c, p, m) ?? m.tipo;
}

function eficacia(c, tipo, df, m, at) {
  if (m?.x?.sinTipo) return 1;
  let ef = 1;
  for (const t of tipos(df)) {
    let f = m?.x?.eficacia?.(tipo, t) ?? factor(tipo, t);
    if (f === 0 && tipo === "ground" && (c.gravedad || df.v.derribado)) f = 1;
    ef *= f;
  }
  if (tipo === "ground" && ef > 0 && !enElSuelo(c, df, at, m)) return 0;
  return ef;
}

// ---------------------------------------------------------------------------
// Cálculo del daño (fórmula de la 9.ª generación)

function stab(k) {
  const { at, tipo } = k;
  if (k.m.x?.sinTipo) return 1;
  const deOrigen = at.ficha.tipos.includes(tipo);
  if (at.tera && at.tera !== "stellar") return at.tera === tipo ? (deOrigen ? 2 : 1.5) : deOrigen ? 1.5 : 1;
  return at.tipos.includes(tipo) ? 1.5 : 1;
}

function porElCampo(k) {
  const { c, at, df, m, tipo } = k;
  if (!c.campo) return 1;
  const id = c.campo.id;
  if (CAMPOS[id].tipo === tipo && enElSuelo(c, at)) return 1.3;
  if (id === "mistyterrain" && tipo === "dragon" && enElSuelo(c, df, at, m)) return 0.5;
  if (id === "grassyterrain" && ["earthquake", "bulldoze", "magnitude"].includes(m.id) && enElSuelo(c, df, at, m)) return 0.5;
  return 1;
}

function porElClima(k) {
  const { c, m, tipo } = k;
  if (climaEs(c, "raindance")) return tipo === "water" ? 1.5 : tipo === "fire" ? 0.5 : 1;
  if (climaEs(c, "sunnyday")) return tipo === "fire" || m.id === "hydrosteam" ? 1.5 : tipo === "water" ? 0.5 : 1;
  return 1;
}

function porLasPantallas(k, ha) {
  if (k.critico || ha.atraviesa) return 1;
  const pantallas = k.c.lados[k.df.lado].pantallas;
  return pantallas.auroraveil || (k.fisico ? pantallas.reflect : pantallas.lightscreen) ? 0.5 : 1;
}

// Las cuatro habilidades «de la ruina» bajan un 25 % una característica de los demás
function porLaRuina(c, dueno, elOtro, i) {
  return hab(c, elOtro).ruina === i && hab(c, dueno).ruina !== i ? 0.75 : 1;
}

/**
 * Daño de un golpe de «at» a «df». Opciones: tipo (si ya se sabe), critico, tirada (de 0 a 15: cuánto
 * le quita el azar, en %; sin ella, el máximo) y golpe (cuál es, en los movimientos de varios golpes).
 */
function calcular(c, at, df, m, o = {}) {
  const tipo = o.tipo ?? tipoDe(c, at, m);
  const ef = eficacia(c, tipo, df, m, at);
  if (ef === 0 || m.clase === "Estado") return { dano: 0, ef };
  const k = { c, at, df, m, tipo, ef, critico: Boolean(o.critico), golpe: o.golpe ?? 1, real: o.tirada !== undefined };
  if (m.danoFijo) return { dano: m.danoFijo === "level" ? c.nivel : m.danoFijo, ef: 1 };
  if (m.fulminante) return { dano: df.ps, ef: 1 };
  if (m.x?.fijo) return { dano: Math.max(0, m.x.fijo(k)), ef: 1 };

  const ha = hab(c, at);
  const hd = habDefensiva(c, df, at, m);
  const oa = obj(c, at);
  const od = obj(c, df);
  k.fisico = m.x?.fisico ? m.x.fisico(k) : m.clase === "Físico";
  k.ca = m.atacaCon === "def" ? 2 : k.fisico ? 1 : 3;            // característica con la que se ataca
  k.cd = k.fisico || m.defiendeCon === "def" ? 2 : 4;            // y con la que se defiende

  let potencia = m.x?.potencia ? m.x.potencia(k) : m.potencia;
  // Con la teracristalización, los movimientos flojos de ese tipo suben a 60
  if (at.tera === tipo && potencia < 60 && !m.golpes && m.prioridad <= 0 && !m.x?.potencia) potencia = 60;
  potencia = Math.max(1, redondear(potencia * (m.x?.multiplica?.(k) ?? 1) * (ha.potencia?.(k) ?? 1) * (oa.potencia?.(k) ?? 1) * porElCampo(k)));

  const dueno = m.atacaConLaDelRival ? df : at;
  let subidas = dueno.mods[k.ca];
  if ((k.critico && subidas < 0) || hd.ignorante) subidas = 0;
  const ataque = Math.max(1, redondear(conMod(dueno.ficha.est[k.ca], subidas) * (ha.ataque?.(k) ?? 1) * (oa.ataque?.(k) ?? 1) * porLaRuina(c, at, df, k.ca)));

  subidas = df.mods[k.cd];
  if ((k.critico && subidas > 0) || ha.ignorante || m.ignoraCambios) subidas = 0;
  const porClima = (climaEs(c, "sandstorm") && k.cd === 4 && tiene(df, "rock")) || (climaEs(c, "snowscape") && k.cd === 2 && tiene(df, "ice")) ? 1.5 : 1;
  const defensa = Math.max(1, redondear(conMod(df.ficha.est[k.cd], subidas) * (hd.defensa?.(k) ?? 1) * (od.defensa?.(k) ?? 1) * porClima * porLaRuina(c, df, at, k.cd)));

  let d = Math.floor(Math.floor((Math.floor((2 * c.nivel) / 5) + 2) * potencia * ataque / defensa) / 50) + 2;
  d = redondear(d * porElClima(k));
  if (k.critico) d = Math.floor(d * 1.5);
  d = Math.floor((d * (100 - (o.tirada ?? 0))) / 100);
  d = redondear(d * stab(k));
  d = Math.floor(d * ef);
  if (at.estado === "brn" && k.fisico && !m.x?.sinQuemadura) d = Math.floor(d / 2);
  d = redondear(d * (ha.dano?.(k) ?? 1) * (oa.dano?.(k) ?? 1) * (hd.danoRecibido?.(k) ?? 1) * (od.danoRecibido?.(k) ?? 1) *
    porLasPantallas(k, ha) * (df.v.imprudente ? 2 : 1));
  return { dano: Math.max(1, d), ef };
}

function esCritico(c, p, m) {
  if (m.criticoSeguro) return true;
  const etapa = (m.critico ? m.critico - 1 : 0) + (obj(c, p).critico ?? 0) + (p.v.foco ? 2 : 0);
  return etapa >= 3 || azar(c) < [1 / 24, 1 / 8, 1 / 2][etapa];
}

function acierta(x) {
  const { c, p, r, m } = x;
  const precision = m.x?.precision ? m.x.precision(c, m) : m.precision;
  if (precision === null || r.v.imprudente) return true;
  if (m.fulminante) return suerte(c, 30, 100);
  const etapa = limitar((habDefensiva(c, r, p, m).ignorante ? 0 : p.mods[6]) - (hab(c, p).ignorante ? 0 : r.mods[7]), -6, 6);
  return azar(c) * 100 < precision * (etapa >= 0 ? (3 + etapa) / 3 : 3 / (3 - etapa));
}

/** Golpes de un movimiento de varios: [mínimo, máximo, media]. */
function rangoDeGolpes(c, p, m) {
  const dado = obj(c, p).dado;
  if (!m.golpes) return [1, 1, 1];
  if (!Array.isArray(m.golpes)) return dado && m.golpes === 10 ? [4, 10, 7] : [m.golpes, m.golpes, m.golpes];
  return dado ? [4, 5, 4.5] : [2, 5, 3.1];
}

function numeroDeGolpes(c, p, m) {
  const [min, max] = rangoDeGolpes(c, p, m);
  if (min === max) return min;
  if (min === 4) return 4 + entero(c, max - 3);              // Dado Trucado
  const tirada = entero(c, 20);                              // 2 o 3 golpes, un 35 % cada uno; 4 o 5, un 15 %
  return tirada < 7 ? 2 : tirada < 14 ? 3 : tirada < 17 ? 4 : 5;
}

// ---------------------------------------------------------------------------
// Orden

/** La Velocidad de un Pokémon en el campo, con todo lo que la cambia: es la que ordena el turno. */
export function velocidad(c, p) {
  let v = conMod(p.ficha.est[5], p.mods[5]);
  v = Math.floor(v * (hab(c, p).velocidad?.(c, p) ?? 1) * (obj(c, p).velocidad?.(c, p) ?? 1));
  if (p.estado === "par") v = Math.floor(v / 2);
  if (c.lados[p.lado].vientoAfin) v *= 2;
  return v;
}

/** Los Pokémon en el campo que siguen en pie, del que actúa antes al que actúa después. */
function porVelocidad(c) {
  const vivos = LADOS.map((lado) => activo(c, lado)).filter((p) => p.ps > 0);
  return vivos.sort((a, b) => (velocidad(c, b) - velocidad(c, a)) * (c.espacioRaro ? -1 : 1));
}

function prioridadDe(c, p, m) {
  return m.prioridad + (m.x?.prioridad?.(c, p) ?? 0);
}

// ---------------------------------------------------------------------------
// Entradas, salidas y debilitados

/** Pone al Pokémon en el campo: el evento, Deseo Cura y las trampas. Lo de su habilidad va después. */
function colocar(c, lado, indice, anunciar) {
  const L = c.lados[lado];
  const p = L.equipo[indice];
  L.activo = indice;
  p.v = {};
  c.pendientes = c.pendientes.filter((x) => x !== lado);
  if (!c.porActivar.includes(lado)) c.porActivar.push(lado);
  if (anunciar) emitir(c, { t: "entra", lado, p: p.nombre });
  if (L.deseoCura && (p.ps < psMax(p) || p.estado)) {
    L.deseoCura = false;
    p.estado = null;
    evEfecto(c, p, nombreMovimiento("healingwish"), `${p.nombre}'s HP was fully restored`, cambiarPS(p, psMax(p)));
  }
  if (obj(c, p).botas) return;
  const t = L.trampas;
  const suelo = enElSuelo(c, p);
  if (t.spikes && suelo) {
    const da = herirIndirecto(c, p, fraccion(p, 1, [8, 6, 4][t.spikes - 1]));
    if (da) emitir(c, { t: "rocas", lado, p: p.nombre, n: nombreMovimiento("spikes"), ef: 1, da });
  }
  if (t.stealthrock && p.ps > 0) {
    const ef = tipos(p).reduce((total, tipo) => total * factor("rock", tipo), 1);
    const da = herirIndirecto(c, p, fraccion(p, ef, 8));
    if (da) emitir(c, { t: "rocas", lado, p: p.nombre, n: nombreMovimiento("stealthrock"), ef, da });
  }
  if (t.toxicspikes && suelo && p.ps > 0) {
    if (tiene(p, "poison")) {
      t.toxicspikes = 0;
      evEfecto(c, p, nombreMovimiento("toxicspikes"), `${p.nombre} absorbed the Toxic Spikes`);
    } else ponerEstado(c, p, t.toxicspikes > 1 ? "tox" : "psn");
  }
  if (t.stickyweb && suelo && p.ps > 0) {
    const ev = evEfecto(c, p, nombreMovimiento("stickyweb"), "");
    if (!cambiarCaracteristicas(c, p, { spe: -1 }, AJENO, ev) && !ev.txt) anotar(ev, `It doesn't affect ${p.nombre}`);
  }
}

/** Las habilidades y los objetos de quienes acaban de entrar, cuando ya no falta nadie por salir. */
function activarEntradas(c) {
  if (c.pendientes.length) return;
  const lados = c.porActivar;
  c.porActivar = [];
  for (const p of porVelocidad(c)) {
    if (!lados.includes(p.lado) || p.ps <= 0) continue;
    hab(c, p).alEntrar?.(c, p);
    obj(c, p).alEntrar?.(c, p);
  }
}

/** Entran a la vez los Pokémon que se indican: [[lado, indice]]. */
function sacar(c, entradas) {
  for (const [lado, indice] of entradas) if (indice >= 0) colocar(c, lado, indice, true);
  revisarCaidos(c);
  activarEntradas(c);
  revisarCaidos(c);
}

/** Lo que pasa al dejar el campo: Regeneración, Cura Natural y se pierde todo lo temporal. */
function retirar(c, p) {
  if (p.ps > 0) hab(c, p).alSalir?.(c, p);
  const r = rivalDe(c, p);
  if (r.v.atrapado?.por === p.indice) delete r.v.atrapado;
  p.mods = [0, 0, 0, 0, 0, 0, 0, 0];
  p.tipos = p.ficha.tipos.slice();
  p.v = {};
  if (p.estado === "tox") p.cuenta = 1;
}

/** Cambio de Pokémon a mitad de combate: voluntario, por un movimiento o forzado. */
function cambiar(c, lado, indice, herencia = null) {
  const L = c.lados[lado];
  const sale = L.equipo[L.activo];
  const entra = L.equipo[indice];
  retirar(c, sale);
  emitir(c, { t: "cambio", lado, sale: sale.nombre, entra: entra.nombre });
  colocar(c, lado, indice, false);
  if (herencia) {   // Relevo y Autotomía Caudal
    if (herencia.mods) entra.mods = herencia.mods;
    if (herencia.sustituto) entra.v.sustituto = herencia.sustituto;
  }
  activarEntradas(c);
  revisarCaidos(c, lado);
}

/** Saca del campo a p y mete a otro al azar (Rugido, Cola Dragón, Tarjeta Roja). */
function expulsar(c, p) {
  const disponibles = banquillo(c, p.lado);
  if (!disponibles.length || p.ps <= 0) return false;
  cambiar(c, p.lado, disponibles[entero(c, disponibles.length)]);
  return true;
}

/** El suplente por defecto: el que mejor aguanta los tipos del rival y, a igualdad, el que mejor le pega. */
function mejorSuplente(c, lado) {
  const rival = activo(c, otro(lado));
  let mejor = -1;
  let nota = -Infinity;
  for (const indice of banquillo(c, lado)) {
    const p = c.lados[lado].equipo[indice];
    const recibe = Math.max(...rival.ficha.tipos.map((tipo) => p.ficha.tipos.reduce((total, t) => total * factor(tipo, t), 1)));
    const pega = Math.max(...p.ficha.tipos.map((tipo) => rival.ficha.tipos.reduce((total, t) => total * factor(tipo, t), 1)));
    const valor = -recibe * 10 + pega + p.ps / psMax(p);
    if (valor > nota) { nota = valor; mejor = indice; }
  }
  return mejor;
}

/** Quién entra: lo que diga la acción, lo elegido con elegirRelevo(), la función «relevo» o, si no, el motor. */
function elegirSuplente(c, lado, accion = null) {
  const disponibles = banquillo(c, lado);
  const L = c.lados[lado];
  const elegido = L.relevo;
  L.relevo = null;
  if (disponibles.includes(accion?.a)) return accion.a;
  if (disponibles.includes(elegido)) return elegido;
  if (alRelevar) {
    const indice = alRelevar(c, lado);
    if (disponibles.includes(indice)) return indice;
  }
  return mejorSuplente(c, lado);
}

/** Saca a los suplentes de los lados que lo necesitan, hasta que no falte ninguno. */
function resolverPendientes(c, acciones = null) {
  while (c.pendientes.length && !c.ganador) {
    sacar(c, c.pendientes.map((lado) => [lado, elegirSuplente(c, lado, acciones?.[lado]?.tipo === "cambio" ? acciones[lado] : null)]));
    acciones = null;
  }
}

/** Apunta los debilitados: su «ko», el marcador y, si a un lado no le queda nadie, quién gana. */
function revisarCaidos(c, primero = "yo") {
  for (const lado of [primero, otro(primero)]) {
    const L = c.lados[lado];
    const p = L.equipo[L.activo];
    if (p.ps > 0 || p.caido) continue;
    p.caido = true;
    p.estado = null;
    p.v = {};
    L.caidos++;
    emitir(c, { t: "ko", lado, p: p.nombre });
    const r = activo(c, otro(lado));
    if (r.v.atrapado?.por === p.indice) delete r.v.atrapado;
    // Si caen los dos últimos a la vez, pierde el primero en caer
    if (L.caidos === L.equipo.length) c.ganador ??= otro(lado);
    else if (!c.pendientes.includes(lado)) c.pendientes.push(lado);
  }
}

function teracristalizar(c, p) {
  p.tera = p.ficha.tera;
  c.lados[p.lado].teraUsada = true;
  emitir(c, { t: "tera", lado: p.lado, p: p.nombre, tipo: p.tera });
  if (p.tera === "stellar") apuntar("teratipo", "stellar");
  // Ogerpon cambia de habilidad al teracristalizarse
  const nueva = `embodyaspect${aId(p.nombre.split("-")[1] ?? "teal")}`;
  if (p.nombre.startsWith("Ogerpon") && HABILIDADES[nueva]) {
    p.habilidad = nueva;
    hab(c, p).alEntrar?.(c, p);
  }
}

// ---------------------------------------------------------------------------
// Usar un movimiento

function gastarPP(c, p, id, m) {
  const i = p.ficha.movimientos.indexOf(id);
  if (i < 0) return;
  const presion = m.objetivo === "rival" && hab(c, rivalDe(c, p)).presion;
  p.pp[i] = Math.max(0, p.pp[i] - (presion ? 2 : 1));
}

/** Los movimientos entre los que puede elegir (ids). Sin ninguno, Forcejeo. */
function movimientosDisponibles(c, p) {
  const o = obj(c, p);
  const v = p.v;
  const validos = p.ficha.movimientos.filter((id, i) => {
    const m = mov(id);
    if (p.pp[i] <= 0) return false;
    if (o.eleccion && v.bloqueo && id !== v.bloqueo) return false;
    if (v.otraVez && id !== v.otraVez.id) return false;
    if (v.anulado?.id === id) return false;
    if ((v.mofa || o.sinEstado) && m.clase === "Estado") return false;
    if (v.sinCura && m.marcas.cura) return false;
    return true;
  });
  return validos.length ? validos : ["struggle"];
}

/** El turno de un lado: lo que le impide moverse y, si nada lo impide, el movimiento. */
function actuar(c, lado) {
  const t = c.t[lado];
  const p = activo(c, lado);
  if (t.hecho || t.indice !== p.indice || p.ps <= 0) { t.hecho = true; return; }
  t.hecho = true;
  const v = p.v;
  const primera = !v.actuo;   // Sorpresa y Escaramuza solo valen en la primera acción desde que entró
  v.actuo = true;
  v.destino = false;
  v.imprudente = false;
  const quieto = (n, txt) => { evEfecto(c, p, n, `${p.nombre} ${txt}`); delete v.carga; delete v.invulnerable; delete v.encerrado; };
  if (v.recarga) { v.recarga = false; return quieto(mov(v.ultimo).n, "must recharge"); }
  let id = v.carga ?? v.encerrado?.id ?? t.accion.id;
  if (p.estado === "slp") {
    if (--p.cuenta <= 0) { p.estado = null; evEfecto(c, p, ESTADOS.slp.n, `${p.nombre} woke up!`); }
    else if (id !== "sleeptalk") return quieto(ESTADOS.slp.n, "is fast asleep");
  }
  if (p.estado === "frz") {
    if (!mov(id).marcas.descongela && !suerte(c, 1, 5)) return quieto(ESTADOS.frz.n, "is frozen solid!");
    p.estado = null;
    evEfecto(c, p, ESTADOS.frz.n, `${p.nombre} thawed out!`);
  }
  if (v.amedrentado) return quieto("Flinch", "flinched and couldn't move!");
  if (v.confuso) {
    if (--v.confuso <= 0) { delete v.confuso; evEfecto(c, p, "Confusion", `${p.nombre} snapped out of its confusion!`); }
    else if (suerte(c, 33, 100)) {
      // Se pega a sí mismo: un golpe físico de potencia 40 y sin tipo
      const base = Math.floor(Math.floor((Math.floor((2 * c.nivel) / 5) + 2) * 40 * conMod(p.ficha.est[1], p.mods[1]) / conMod(p.ficha.est[2], p.mods[2])) / 50) + 2;
      const da = herir(p, Math.floor((base * (100 - entero(c, 16))) / 100));
      evEfecto(c, p, "Confusion", `${p.nombre} hurt itself in its confusion!`, da);
      delete v.carga; delete v.invulnerable; delete v.encerrado;
      return;
    }
  }
  if (p.estado === "par" && suerte(c, 1, 4)) return quieto(ESTADOS.par.n, "is paralyzed! It can't move!");
  // Otra Vez y Mofa pueden haber llegado este mismo turno, después de elegir
  if (v.otraVez && id !== "struggle") id = v.otraVez.id;
  const m = mov(id);
  if ((v.mofa && m.clase === "Estado") || (v.sinCura && m.marcas.cura)) {
    emitir(c, { t: "mov", lado, p: p.nombre, n: m.n, tipo: m.tipo, clase: m.clase, txt: `${p.nombre} can't use it` });
    return;
  }
  if (!v.carga && !v.encerrado) gastarPP(c, p, id, m);
  if (obj(c, p).eleccion && id !== "struggle") v.bloqueo ??= id;
  if (!PROTECCIONES.includes(m.volatil) && m.volatil !== "endure") v.protecciones = 0;
  usar(c, p, id, { primera });
  if (p.ps > 0) p.v.ultimo = id;
}

/** Primer turno de un movimiento de dos (Rayo Solar, Rayo Meteórico). Devuelve si se queda cargando. */
function cargar(x) {
  const { c, p, m, ev } = x;
  if (!m.marcas.carga) return false;
  if (p.v.carga) { delete p.v.carga; delete p.v.invulnerable; return false; }
  m.x?.alCargar?.(x);
  if (m.x?.sinCarga?.(c)) return false;
  if (obj(c, p).hierba) {
    evObj(c, p, `${p.nombre} became fully charged!`, null, gastarObjeto(c, p));
    return false;
  }
  p.v.carga = m.id;
  if (m.x?.invulnerable) p.v.invulnerable = true;
  anotar(ev, `${p.nombre} is preparing its attack`);
  return true;
}

function usar(c, p, id, o = {}) {
  const m = mov(id);
  const L = c.lados[p.lado];
  const R = c.lados[otro(p.lado)];
  const tipo = tipoDe(c, p, m);
  hab(c, p).antesDeAtacar?.(c, p, m, tipo);
  const ev = emitir(c, { t: "mov", lado: p.lado, p: p.nombre, n: m.n, tipo, clase: m.clase });
  if (m.sinDatos || m.sinUso || SIN_PROGRAMAR.has(id)) apuntar("movimiento", id);
  // Lo que reciben las funciones de MOVIMIENTOS: quién ataca (p), a quién (r), sus lados y el evento
  const x = { c, p, r: R.equipo[R.activo], m, tipo, ev, L, R, primera: o.primera, dano: 0 };
  let hecho = false;
  if (m.x?.enVez) hecho = m.x.enVez(x) !== false;
  else {
    const falla = m.x?.falla?.(x);
    if (falla) anotar(ev, typeof falla === "string" ? falla : "Fails");
    else if (cargar(x)) return;
    else hecho = m.objetivo === "rival" ? contraRival(x) : efectoPropio(x);
  }
  if (!hecho) {
    if (!ev.txt) anotar(ev, "Fails");
    delete p.v.encerrado;
    const da = m.choque && p.ps > 0 ? herirIndirecto(c, p, Math.floor(psMax(p) / 2)) : null;
    if (da) evEfecto(c, p, m.n, `${p.nombre} kept going and crashed!`, da);
  }
  m.x?.siempre?.(x);
  if (p.ps > 0 && (m.autodestruccion === "always" || (m.autodestruccion && hecho))) {
    evEfecto(c, p, m.n, `${p.nombre} fainted`, cambiarPS(p, -p.ps));
    revisarCaidos(c, p.lado);
  }
  // Enfado y parecidos: dos o tres turnos seguidos y, al acabar, confusión
  if (p.v.encerrado && p.ps > 0 && --p.v.encerrado.turnos <= 0) {
    delete p.v.encerrado;
    ponerVolatil(c, p, "confusion", p, m, null);
  }
  revisarCaidos(c, otro(p.lado));   // el «ko» del rival, antes de que quien ataca se cambie
  if (hecho && p.ps > 0 && !c.ganador) trasElMovimiento(x);
}

/** Tarjeta Roja, Botón Escape y los movimientos que cambian a quien los usa. */
function trasElMovimiento(x) {
  const { c, p, r, m } = x;
  if (x.dano && r.ps > 0 && r === activo(c, r.lado)) {
    const o = obj(c, r);
    if (o.tarjeta && banquillo(c, p.lado).length) {
      evObj(c, r, `${p.nombre} was dragged out`, null, gastarObjeto(c, r));
      expulsar(c, p);
      return;
    }
    if (o.boton && banquillo(c, r.lado).length) {
      evObj(c, r, `${r.nombre} is switched out`, null, gastarObjeto(c, r));
      cambiar(c, r.lado, elegirSuplente(c, r.lado));
      return;   // y quien atacaba se queda sin su cambio
    }
  }
  if (m.cambioTras && !x.rebotado && p === activo(c, p.lado) && banquillo(c, p.lado).length) {
    const herencia = m.cambioTras === "copyvolatile" ? { mods: p.mods.slice(), sustituto: p.v.sustituto } : null;
    cambiar(c, p.lado, elegirSuplente(c, p.lado, c.t?.[p.lado]?.accion), herencia);
  }
}

/** Un movimiento que va contra el rival: protección, inmunidades, precisión y, si llega, el golpe o el efecto. */
function contraRival(x) {
  const { c, p, r, m, ev, tipo } = x;
  if (r.ps <= 0) { anotar(ev, "There is no target left to attack"); return false; }
  const hd = habDefensiva(c, r, p, m);
  if (m.clase === "Estado" && m.marcas.reflejable && !x.rebotado && hd.rebota) {
    anotar(ev, `${r.nombre} bounced the move back!`);
    evHab(c, r, `Bounces ${m.n} back`);
    contraRival({ ...x, p: r, r: p, L: x.R, R: x.L, rebotado: true });
    return false;
  }
  if (r.v.invulnerable) { anotar(ev, `${r.nombre} avoided the attack!`); return false; }
  const proteccion = r.v.protegido;
  const soloAtaques = ["kingsshield", "silktrap", "burningbulwark"].includes(proteccion);
  if (proteccion && !m.marcas.saltaProteccion && !(soloAtaques && m.clase === "Estado")) {
    if (m.rompeProteccion) r.v.protegido = null;
    else {
      anotar(ev, `${r.nombre} protected itself!`);
      if (m.marcas.contacto) {
        if (proteccion === "banefulbunker") ponerEstado(c, p, "psn", r);
        if (proteccion === "burningbulwark") ponerEstado(c, p, "brn", r);
        const da = proteccion === "spikyshield" ? herirIndirecto(c, p, fraccion(p, 1, 8)) : null;
        if (da) evEfecto(c, p, nombreMovimiento(proteccion), `${p.nombre} was hurt!`, da);
        if (proteccion === "kingsshield") cambiarCaracteristicas(c, p, { atk: -1 }, r, ev);
        if (proteccion === "silktrap") cambiarCaracteristicas(c, p, { spe: -1 }, r, ev);
      }
      return false;
    }
  }
  // Inmunidades: por tipo y por habilidad
  const k = { c, at: p, df: r, m, tipo };
  const ef = eficacia(c, tipo, r, m, p);
  const sinEfectoPorTipo = m.clase !== "Estado" ? ef === 0 : (m.estado === "par" && tipo === "electric" && ef === 0) || (m.marcas.polvo && tiene(r, "grass"));
  if (sinEfectoPorTipo) {
    if (m.clase !== "Estado") ev.ef = 0;
    anotar(ev, `It doesn't affect ${r.nombre}`);
    // Si la tabla de tipos no lo explica, es por estar en el aire
    if (tipo === "ground" && !tiene(r, "flying")) {
      if (hd.levita) evHab(c, r, `${r.nombre} is floating: Ground-type moves don't affect it`);
      else if (obj(c, r).flota) evObj(c, r, `${r.nombre} is floating on its Air Balloon: Ground-type moves don't affect it`);
    }
    return false;
  }
  if (hd.inmune?.(k)) {
    if (m.clase !== "Estado") ev.ef = 0;
    anotar(ev, `It doesn't affect ${r.nombre}`);
    if (!hd.alAbsorber?.(c, r, p, m)) evHab(c, r, `${m.n} has no effect`);
    return false;
  }
  if (!acierta(x)) { anotar(ev, "Missed"); return false; }
  if (m.clase === "Estado") return efectoSobreRival(x);

  m.x?.antes?.(x);
  golpear(x, ef);
  const ha = hab(c, p);
  // Efectos secundarios: los del rival no pasan del sustituto; los de quien ataca, siempre
  for (const efecto of m.efectos) {
    if (efecto.prob < 100 && azar(c) * 100 >= efecto.prob) continue;
    if (efecto.propios) cambiarCaracteristicas(c, p, efecto.propios, p, ev);
    if (!x.dano || r.ps <= 0) continue;
    if (efecto.estado) ponerEstado(c, r, efecto.estado, p, m);
    if (efecto.volatil) ponerVolatil(c, r, efecto.volatil, p, m, ev);
    if (efecto.cambios) cambiarCaracteristicas(c, r, efecto.cambios, p, ev, m);
  }
  if (m.volatil && x.dano && r.ps > 0) ponerVolatil(c, r, m.volatil, p, m, ev);
  if (m.propios) cambiarCaracteristicas(c, p, m.propios, p, ev);
  if (m.propioVolatil) ponerVolatil(c, p, m.propioVolatil, p, m, ev);
  if (m.robo && x.dano) {
    const da = curar(c, p, Math.round((x.dano * m.robo[0]) / m.robo[1]));
    if (da) evEfecto(c, p, m.n, `${p.nombre} regained HP`, da);
  }
  if (m.retroceso && x.dano) {
    const da = herirIndirecto(c, p, Math.round((x.dano * m.retroceso[0]) / m.retroceso[1]));
    if (da) evEfecto(c, p, "Recoil", `${p.nombre} was damaged by recoil!`, da);
  }
  m.x?.tras?.(x);
  if (x.dano) {
    if (r.estado === "frz" && (tipo === "fire" || m.descongelaAlRival) && r.ps > 0) { r.estado = null; evEfecto(c, r, ESTADOS.frz.n, `${r.nombre} thawed out!`); }
    ha.alGolpear?.(c, p, r, m);
    if (p.ps > 0) obj(c, p).trasAtacar?.(c, p);
    // Mismo Destino: quien lo usó se lleva por delante a quien lo debilita
    if (r.ps <= 0 && r.v.destino && p.ps > 0) evEfecto(c, p, nombreMovimiento("destinybond"), `${r.nombre} took ${p.nombre} down with it!`, cambiarPS(p, -p.ps));
    if (m.fuerzaCambio && r.ps > 0 && p.ps > 0) expulsar(c, r);
  }
  return true;
}

/** Los golpes de un movimiento de daño. Deja en x.dano los PS que ha quitado al Pokémon (no a su sustituto). */
function golpear(x, ef) {
  const { c, p, r, m, ev, tipo } = x;
  const saltaSustituto = m.marcas.sonido || m.marcas.saltaSustituto || hab(c, p).atraviesa;
  const golpes = numeroDeGolpes(c, p, m);
  const antes = r.pct;
  let dados = 0;
  let critico = false;
  let alSustituto = false;
  ev.ef = ef;
  for (let golpe = 1; golpe <= golpes && r.ps > 0 && p.ps > 0; golpe++) {
    if (golpe > 1 && m.multiprecision && !obj(c, p).dado && !acierta(x)) break;
    const esteEsCritico = esCritico(c, p, m);
    let { dano } = calcular(c, p, r, m, { tipo, critico: esteEsCritico, tirada: entero(c, 16), golpe });
    dados++;
    critico ||= esteEsCritico;
    if (r.v.sustituto && !saltaSustituto) {
      alSustituto = true;
      r.v.sustituto -= dano;
      if (r.v.sustituto <= 0) { delete r.v.sustituto; anotar(ev, `The substitute for ${r.nombre} broke!`); }
      continue;
    }
    dano = aguantar(c, r, p, m, Math.min(dano, r.ps));
    r.ps -= dano;
    x.dano += dano;
    r.golpes = (r.golpes ?? 0) + 1;                                              // para Puño Furia
    r.v.golpe = { dano: (r.v.golpe?.dano ?? 0) + dano, fisico: m.clase === "Físico" };   // para Contraataque y Manto Espejo
    hab(c, r).alRecibirGolpe?.(c, r, p, m);
    obj(c, r).alRecibirGolpe?.(c, r, p, m);
  }
  if (x.dano) {
    r.pct = pctDe(r);
    ev.da = [r.lado, r.nombre, antes, r.pct];
  }
  if (critico) anotar(ev, "Critical hit");
  if (golpes > 1) anotar(ev, `Hit ${dados} times`);
  if (alSustituto && !x.dano && r.v.sustituto) anotar(ev, `${r.nombre}'s substitute took the hit`);
}

/** Robustez, Banda Aguante y Aguante: un golpe que debilitaría deja 1 PS. */
function aguantar(c, r, p, m, dano) {
  if (dano < r.ps) return dano;
  const conTodosLosPS = r.ps === psMax(r);
  if (r.v.aguante) evEfecto(c, r, nombreMovimiento("endure"), `${r.nombre} endured the hit!`);
  else if (conTodosLosPS && habDefensiva(c, r, p, m).robusto) evHab(c, r, `${r.nombre} endured the hit!`);
  else if (conTodosLosPS && obj(c, r).banda) evObj(c, r, `${r.nombre} endured the hit!`, null, gastarObjeto(c, r));
  else return dano;
  return r.ps - 1;
}

/** Un movimiento de estado contra el rival, ya pasadas la protección, las inmunidades y la precisión. */
function efectoSobreRival(x) {
  const { c, p, r, m, ev } = x;
  if (r.v.sustituto && !m.marcas.saltaSustituto && !m.marcas.sonido && !hab(c, p).atraviesa) {
    anotar(ev, `${r.nombre}'s substitute blocked it`);
    return false;
  }
  if (m.x?.efecto) return m.x.efecto(x) !== false;
  let algo = false;
  if (m.estado) algo = ponerEstado(c, r, m.estado, p, m, ev) || algo;
  if (m.volatil) algo = ponerVolatil(c, r, m.volatil, p, m, ev) || algo;
  if (m.cambios) algo = cambiarCaracteristicas(c, r, m.cambios, p, ev, m) || algo;
  if (m.fuerzaCambio) algo = expulsar(c, r) || algo;
  return algo;
}

/** Un movimiento sobre uno mismo, sobre un lado o sobre el campo. */
function efectoPropio(x) {
  const { c, p, m, ev, L } = x;
  if (m.x?.efecto) return m.x.efecto(x) !== false;
  let algo = false;
  if (m.cambios) algo = cambiarCaracteristicas(c, p, m.cambios, p, ev) || algo;
  if (m.cura) algo = curarCon(x, m.cura[0] / m.cura[1]) || algo;
  if (m.volatil) algo = ponerVolatil(c, p, m.volatil, p, m, ev) || algo;
  if (m.propioVolatil && algo) ponerVolatil(c, p, m.propioVolatil, p, m, ev);
  if (m.bando) algo = ponerEnElBando(x) || algo;
  if (m.cambioTras) algo = banquillo(c, p.lado).length > 0 || algo;   // Relevo: basta con tener a quién dar paso
  if (m.clima) {
    const id = aId(m.clima);
    if (!CLIMAS[id]) apuntar("movimiento", m.id);   // un clima que este motor no tiene (el Granizo de antes de la 9.ª generación)
    else if (ponerClima(c, id, p)) { anotar(ev, CLIMAS[id].empieza); algo = true; }
  }
  if (m.campo && !CAMPOS[m.campo]) apuntar("movimiento", m.id);
  else if (m.campo && ponerCampo(c, m.campo, p)) { anotar(ev, `${CAMPOS[m.campo].n} spread across the battlefield!`); algo = true; }
  if (m.seudoclima === "trickroom") {
    c.espacioRaro = c.espacioRaro ? 0 : 5;
    anotar(ev, c.espacioRaro ? "The twisted dimensions: slower Pokémon move first" : "The twisted dimensions returned to normal");
    algo = true;
  } else if (m.seudoclima === "gravity") {
    if (!c.gravedad) { c.gravedad = 5; anotar(ev, "Gravity intensified! Nobody can stay in the air"); algo = true; }
  } else if (m.seudoclima) apuntar("movimiento", m.id);
  if (m.ranura === "Wish") {
    if (!L.deseo) { L.deseo = { turnos: 2, cura: Math.round(psMax(p) / 2) }; anotar(ev, `${p.nombre} made a wish`); algo = true; }
  } else if (m.ranura === "healingwish" || m.ranura === "lunardance") {
    if (banquillo(c, p.lado).length) { L.deseoCura = true; anotar(ev, `${p.nombre} is sacrificing itself to heal whoever comes in`); algo = true; }
  } else if (m.ranura) apuntar("movimiento", m.id);
  return algo;
}

function curarCon(x, parte) {
  const { c, p, ev } = x;
  const da = curar(c, p, Math.round(psMax(p) * parte));
  if (!da) { anotar(ev, p.v.sinCura ? `${p.nombre} can't recover HP` : `${p.nombre}'s HP is full`); return false; }
  ev.da = da;
  return true;
}

/** Trampas en el lado rival; pantallas y Viento Afín en el propio. */
function ponerEnElBando(x) {
  const { c, p, r, m, ev } = x;
  const id = m.bando;
  if (TRAMPAS[id]) {
    let destino = x.R;
    if (m.marcas.reflejable && r.ps > 0 && habDefensiva(c, r, p, m).rebota) {   // Espejo Mágico las devuelve
      evHab(c, r, `Bounces ${m.n} back`);
      destino = x.L;
    }
    if (destino.trampas[id] >= TRAMPAS[id]) return false;
    destino.trampas[id]++;
    anotar(ev, destino === x.R ? `${m.n} was set on the opposing side` : `${m.n} was set on its own side`);
    return true;
  }
  if (PANTALLAS.includes(id)) {
    if (x.L.pantallas[id] || (id === "auroraveil" && !climaEs(c, "snowscape"))) return false;
    x.L.pantallas[id] = obj(c, p).alargaPantallas ? 8 : 5;
    anotar(ev, `${m.n} protects its team`);
    return true;
  }
  if (id === "tailwind") {
    if (x.L.vientoAfin) return false;
    x.L.vientoAfin = 4;
    anotar(ev, "Its team's Speed doubled");
    return true;
  }
  apuntar("movimiento", m.id);
  return false;
}

// ---------------------------------------------------------------------------
// Fin del turno

function finDeTurno(c) {
  const enPie = () => porVelocidad(c);
  const dano = (p, n, txt, cantidad) => { const da = herirIndirecto(c, p, cantidad); if (da) evEfecto(c, p, n, txt, da); };

  if (c.clima) {
    const clima = CLIMAS[c.clima.id];
    if (--c.clima.turnos <= 0) {
      avisarDelCampo(c, c.clima.lado, clima.n, clima.acaba);
      c.clima = null;
      campoCambiado(c);
    } else if (c.clima.id === "sandstorm") {
      for (const p of enPie()) {
        if (["rock", "ground", "steel"].some((tipo) => tiene(p, tipo)) || hab(c, p).sinArena) continue;
        dano(p, clima.n, `The sandstorm buffets ${p.nombre}`, fraccion(p, 1, 16));
      }
    }
    revisarCaidos(c);
  }

  for (const lado of LADOS) {
    const L = c.lados[lado];
    const p = L.equipo[L.activo];
    if (L.futuro && --L.futuro.turnos <= 0) {   // Premonición: llega dos turnos después
      const { id, de, indice } = L.futuro;
      L.futuro = null;
      if (p.ps > 0) {
        const m = mov(id);
        const { dano: cuanto, ef } = calcular(c, c.lados[de].equipo[indice], p, m, { tirada: entero(c, 16) });
        if (ef === 0) evEfecto(c, p, m.n, `It doesn't affect ${p.nombre}`);
        else evEfecto(c, p, m.n, `${p.nombre} took the attack!`, cambiarPS(p, -aguantar(c, p, null, m, Math.min(cuanto, p.ps))));
      }
    }
    if (L.deseo && --L.deseo.turnos <= 0) {
      const da = p.ps > 0 ? curar(c, p, L.deseo.cura) : null;
      L.deseo = null;
      if (da) evEfecto(c, p, nombreMovimiento("wish"), `The wish came true: ${p.nombre} regained HP`, da);
    }
  }
  revisarCaidos(c);

  for (const p of enPie()) {
    if (c.campo?.id === "grassyterrain" && enElSuelo(c, p)) {
      const da = curar(c, p, fraccion(p, 1, 16));
      if (da) evEfecto(c, p, CAMPOS.grassyterrain.n, `${p.nombre} regained HP`, da);
    }
    obj(c, p).finDeTurno?.(c, p);
    if (p.ps > 0) hab(c, p).finDeTurno?.(c, p);
  }
  revisarCaidos(c);

  for (const p of enPie()) {
    const r = rivalDe(c, p);
    if (p.v.drenadoras && r.ps > 0) {
      const antes = p.ps;
      dano(p, nombreMovimiento("leechseed"), `${p.nombre}'s health was sapped by Leech Seed!`, fraccion(p, 1, 8));
      const da = antes > p.ps ? curar(c, r, antes - p.ps) : null;
      if (da) evEfecto(c, r, nombreMovimiento("leechseed"), `${r.nombre} regained HP`, da);
    }
    if (p.ps > 0 && (p.estado === "psn" || p.estado === "tox")) {
      if (hab(c, p).venenoCura) {
        const da = curar(c, p, fraccion(p, 1, 8));
        if (da) evHab(c, p, `${p.nombre} regained HP from the poison`, da);
      } else dano(p, ESTADOS[p.estado].n, `${p.nombre} ${ESTADOS[p.estado].dano}`, p.estado === "psn" ? fraccion(p, 1, 8) : fraccion(p, p.cuenta, 16));
      if (p.estado === "tox" && p.cuenta < 15) p.cuenta++;
    }
    if (p.ps > 0 && p.estado === "brn") dano(p, ESTADOS.brn.n, `${p.nombre} ${ESTADOS.brn.dano}`, fraccion(p, 1, 16));
    if (p.ps > 0 && p.v.salazon) dano(p, nombreMovimiento("saltcure"), `${p.nombre} is hurt by Salt Cure`, fraccion(p, 1, tiene(p, "water") || tiene(p, "steel") ? 4 : 8));
    if (p.ps > 0 && p.v.maldito) dano(p, nombreMovimiento("curse"), `${p.nombre} is afflicted by the curse`, fraccion(p, 1, 4));
    if (p.ps > 0 && p.v.atrapado) {
      if (--p.v.atrapado.turnos <= 0) delete p.v.atrapado;
      else dano(p, "Trapped", `${p.nombre} is still trapped and loses HP`, fraccion(p, 1, 8));
    }
  }
  revisarCaidos(c);

  // Lo que se acaba con el tiempo
  for (const p of enPie()) {
    const v = p.v;
    if (v.mofa && --v.mofa <= 0) { delete v.mofa; evEfecto(c, p, nombreMovimiento("taunt"), `${p.nombre} can use any move again`); }
    if (v.otraVez && --v.otraVez.turnos <= 0) delete v.otraVez;
    if (v.anulado && --v.anulado.turnos <= 0) delete v.anulado;
    if (v.levitando && --v.levitando <= 0) delete v.levitando;
    if (v.sinCura && --v.sinCura <= 0) delete v.sinCura;
    if (v.bostezo && --v.bostezo <= 0) { delete v.bostezo; ponerEstado(c, p, "slp"); }
    delete v.protegido; delete v.aguante; delete v.amedrentado; delete v.golpe; delete v.posado; delete v.subio;
  }
  for (const lado of LADOS) {
    const L = c.lados[lado];
    for (const id of PANTALLAS) {
      if (L.pantallas[id] && --L.pantallas[id] <= 0) avisarDelCampo(c, lado, nombreMovimiento(id), `${nombreMovimiento(id)} wore off`);
    }
    if (L.vientoAfin && --L.vientoAfin <= 0) avisarDelCampo(c, lado, nombreMovimiento("tailwind"), "The tailwind petered out");
  }
  if (c.espacioRaro && --c.espacioRaro <= 0) avisarDelCampo(c, "yo", nombreMovimiento("trickroom"), "The twisted dimensions returned to normal");
  if (c.gravedad) c.gravedad--;
  if (c.campo && --c.campo.turnos <= 0) {
    const { lado, id } = c.campo;
    c.campo = null;
    avisarDelCampo(c, lado, CAMPOS[id].n, `The ${CAMPOS[id].n} disappeared`);
    campoCambiado(c);
  }
}

// ---------------------------------------------------------------------------
// Lo que exporta el motor

/**
 * Empieza un combate. Los equipos son los de la app ({ miembros } o directamente la lista de miembros);
 * «formato», los datos del formato (nivel e IVs) o su id si ya se cargó con cargarDatos(id); «semilla», un
 * número o un texto. Salen los primeros de cada equipo: sus eventos van delante de los del primer turno.
 * Con «sinSalir: true» no sale nadie y no hay eventos: es un estado para calcular daños y nada más.
 */
export function crearCombate(equipoYo, equipoRival, { formato, semilla, sinSalir = false } = {}) {
  const datos = typeof formato === "string" ? formatoCargado(formato) : formato;
  if (!datos || !Number.isInteger(datos.nivel)) {
    throw new Error("crearCombate necesita los datos del formato: el objeto de datos/formatos o su id, ya cargado con cargarDatos(id)");
  }
  const inicial = semillaDe(semilla);
  const c = {
    nivel: datos.nivel, conTera: datos.tera !== false, conMega: datos.mega === true, turno: 0, rng: { semilla: inicial, s: inicial },
    lados: {}, clima: null, campo: null, espacioRaro: 0, gravedad: 0,
    pendientes: [], porActivar: [], ev: [], t: null, ganador: null, cerrado: false,
    trampasVistas: 0,   // las trampas de las que ya se ha avisado en un evento (ver avisarDeTrampas)
  };
  for (const [lado, equipo] of [["yo", equipoYo], ["rival", equipoRival]]) {
    const miembros = (Array.isArray(equipo) ? equipo : equipo?.miembros ?? []).filter((miembro) => miembro?.especie);
    if (!miembros.length) throw new Error(`The "${lado}" team has no Pokémon`);
    c.lados[lado] = {
      id: lado, activo: 0, teraUsada: false, megaUsada: false, caidos: 0, relevo: null,
      trampas: { stealthrock: 0, spikes: 0, toxicspikes: 0, stickyweb: 0 },
      pantallas: { reflect: 0, lightscreen: 0, auroraveil: 0 },
      vientoAfin: 0, deseo: null, futuro: null, deseoCura: false,
      equipo: miembros.slice(0, 6).map((miembro, indice) => crearLuchador(miembro, lado, indice, datos)),
    };
  }
  if (sinSalir) return c;   // solo para hacer cuentas (js/sim/seleccion.js): nadie sale al campo, sin eventos ni habilidades de entrada
  for (const lado of LADOS) colocar(c, lado, 0, true);
  activarEntradas(c);
  revisarCaidos(c);
  return c;
}

function crearLuchador(miembro, lado, indice, formato) {
  const e = especie(miembro.especie);
  if (!e) throw new Error(`The simulator does not know the species "${miembro.especie}"`);
  const calcular = (f) => estadisticasReales(f.base, miembro.naturaleza ?? "Serious", miembro.valores ?? [0, 0, 0, 0, 0, 0], formato);
  const est = calcular(e);
  if (est.some((valor) => !Number.isFinite(valor))) throw new Error(`Cannot calculate the stats of ${miembro.especie}: the format is missing the level or IVs`);
  const movimientos = (miembro.movimientos ?? []).filter(Boolean).slice(0, 4);
  const habilidad = miembro.habilidad ?? e.habilidades?.[0] ?? null;
  const objeto = miembro.objeto ?? null;
  if (habilidad && !HABILIDADES[habilidad]) apuntar("habilidad", habilidad);
  if (objeto && !OBJETOS[objeto] && !datosDeCombate().megas?.[miembro.especie]) apuntar("objeto", objeto);
  // Forma Mega con su megapiedra en un formato con Megaevolución: empieza con la forma base
  const mega = formato.mega === true ? datosDeCombate().megas?.[miembro.especie] : null;
  const base = mega && mega.piedra === objeto ? especie(mega.base) : null;
  const inicial = base ? { id: base.id, tipos: base.tipos.slice(), est: calcular(base) } : { id: e.id, tipos: e.tipos.slice(), est };
  return {
    nombre: miembro.especie, lado, indice,
    ficha: {
      ...inicial, movimientos, tera: miembro.tera ? aId(miembro.tera) : null,
      peso: datosDeCombate().pesos[miembro.especie] ?? null, habilidad, objeto,
      ...(base ? { base: mega.base, piedra: mega.piedra, mega: { id: e.id, tipos: e.tipos.slice(), est, habilidad } } : {}),
    },
    ps: inicial.est[0], pct: 100, estado: null, cuenta: 0, mods: [0, 0, 0, 0, 0, 0, 0, 0],
    tipos: inicial.tipos.slice(), tera: null, habilidad: base ? null : habilidad, objeto, pp: movimientos.map((id) => mov(id).pp), caido: false, v: {},
  };
}

/**
 * Lo que puede hacer un lado. Si tiene que sacar a otro porque el suyo se ha debilitado, solo cambios.
 * Con «tera: true», el movimiento se usa teracristalizando antes (una vez por equipo).
 */
export function opciones(c, lado) {
  if (c.ganador) return [];
  const L = c.lados[lado];
  const p = L.equipo[L.activo];
  const cambios = banquillo(c, lado).map((a) => ({ tipo: "cambio", a }));
  if (p.ps <= 0) return cambios;
  const obligado = p.v.recarga ? p.v.ultimo : p.v.carga ?? p.v.encerrado?.id;
  if (obligado) return [{ tipo: "mov", id: obligado }];
  const ids = movimientosDisponibles(c, p);
  const movimientos = ids.map((id) => ({ tipo: "mov", id }));
  if (c.conTera && !L.teraUsada && p.ficha.tera && !p.tera) movimientos.push(...ids.map((id) => ({ tipo: "mov", id, tera: true })));
  const atrapado = p.v.atrapado && !tiene(p, "ghost");
  return atrapado ? movimientos : [...movimientos, ...cambios];
}

/** Una acción que no es legal se cambia por la más parecida que sí lo sea. */
function normalizar(c, lado, accion) {
  const validas = opciones(c, lado);
  if (accion?.tipo === "cambio") return validas.find((o) => o.tipo === "cambio" && o.a === accion.a) ?? validas[0] ?? null;
  const mismas = validas.filter((o) => o.tipo === "mov" && o.id === accion?.id);
  const igual = mismas.find((o) => Boolean(o.tera) === Boolean(accion.tera)) ?? mismas[0];
  return igual ? { ...igual, a: accion.a } : validas[0] ?? null;
}

/**
 * Juega un turno y devuelve sus eventos. Con { relevo: (estado, lado) => indice } incluye las entradas
 * tras un debilitado; sin ella, los lados que tienen que sacar a otro quedan en estado.pendientes.
 */
export function resolverTurno(c, accionYo, accionRival, { relevo } = {}) {
  if (c.ganador) return salida(c);
  alRelevar = typeof relevo === "function" ? relevo : null;
  try {
    const dadas = { yo: accionYo, rival: accionRival };
    if (c.pendientes.length) {
      // Quien tenía que sacar a otro y no lo hizo con elegirRelevo(): si su acción es un cambio, es su relevo y no hay más
      const soloRelevos = c.pendientes.some((lado) => dadas[lado]?.tipo === "cambio");
      resolverPendientes(c, dadas);
      if (soloRelevos || c.ganador) return salida(c);
    }
    c.turno++;
    c.t = {};
    for (const lado of LADOS) c.t[lado] = { accion: normalizar(c, lado, dadas[lado]), indice: c.lados[lado].activo, hecho: false };
    const sorteo = { yo: azar(c), rival: azar(c) };   // para los empates de velocidad
    const antes = (a, b) => (velocidad(c, activo(c, b)) - velocidad(c, activo(c, a))) * (c.espacioRaro ? -1 : 1) || sorteo[a] - sorteo[b];

    // 1. Los cambios, antes que cualquier movimiento
    for (const lado of [...LADOS].sort(antes)) {
      const t = c.t[lado];
      if (t.accion?.tipo !== "cambio" || c.ganador || activo(c, lado).ps <= 0) continue;
      t.hecho = true;
      cambiar(c, lado, t.accion.a);
    }
    // 2. Las Megaevoluciones (solo si ataca) y las teracristalizaciones
    for (const lado of [...LADOS].sort(antes)) {
      const t = c.t[lado];
      const p = activo(c, lado);
      if (c.conMega && t.accion?.tipo === "mov" && !t.hecho && p.ps > 0 && p.ficha.mega && !c.lados[lado].megaUsada) megaevolucionar(c, p);
    }
    for (const lado of [...LADOS].sort(antes)) {
      const t = c.t[lado];
      const p = activo(c, lado);
      if (t.accion?.tipo === "mov" && t.accion.tera && !t.hecho && p.ps > 0 && !c.lados[lado].teraUsada && p.ficha.tera) teracristalizar(c, p);
    }
    // 3. Los movimientos: por prioridad y, a igualdad, por velocidad
    const turnos = LADOS.filter((lado) => c.t[lado].accion?.tipo === "mov" && !c.t[lado].hecho).map((lado) => {
      const p = activo(c, lado);
      const m = mov(p.v.carga ?? p.v.encerrado?.id ?? c.t[lado].accion.id);
      let adelanta = false;
      if (obj(c, p).adelanta && p.ps * 4 <= psMax(p)) {   // Baya Chiri: el primero dentro de su prioridad
        adelanta = true;
        evObj(c, p, `${p.nombre} moves first`, null, gastarObjeto(c, p));
      }
      return { lado, prioridad: prioridadDe(c, p, m), adelanta };
    });
    turnos.sort((a, b) => b.prioridad - a.prioridad || b.adelanta - a.adelanta || antes(a.lado, b.lado));
    for (const { lado } of turnos) {
      if (c.ganador) break;
      actuar(c, lado);
      revisarCaidos(c, otro(lado));
    }
    // 4. Lo que pasa al final del turno y 5. los relevos
    if (!c.ganador) finDeTurno(c);
    if (!c.ganador && alRelevar) resolverPendientes(c);
    return salida(c);
  } finally {
    alRelevar = null;
    c.t = null;
  }
}

/**
 * Saca al Pokémon «indice» del lado que tiene que sacar a otro (está en estado.pendientes) y devuelve
 * los eventos de su entrada. Si ese lado no tiene que sacar a nadie todavía, lo deja elegido para
 * la próxima vez que tenga que cambiar. Un índice que no vale se cambia por el suplente por defecto.
 */
export function elegirRelevo(c, lado, indice) {
  if (c.ganador) return salida(c);
  if (!c.pendientes.includes(lado)) {
    if (banquillo(c, lado).includes(indice)) c.lados[lado].relevo = indice;
    return [];
  }
  sacar(c, [[lado, banquillo(c, lado).includes(indice) ? indice : mejorSuplente(c, lado)]]);
  return salida(c);
}

/**
 * Daño del movimiento del Pokémon en campo de «lado» contra el del otro lado, en % de los PS máximos
 * del objetivo: { min, max, media, ef }. No cuenta los golpes críticos ni la precisión, y no cambia nada.
 * Con { tera: true } calcula como si se teracristalizara antes.
 */
export function calcularDano(c, lado, idMovimiento, { tera } = {}) {
  const at = activo(c, lado);
  const df = activo(c, otro(lado));
  const m = mov(idMovimiento);
  const nada = { min: 0, max: 0, media: 0, ef: 1 };
  if (at.ps <= 0 || df.ps <= 0) return nada;
  const teraReal = at.tera;
  if (tera && !at.tera && at.ficha.tera) at.tera = at.ficha.tera;
  try {
    const tipo = tipoDe(c, at, m);
    const ef = eficacia(c, tipo, df, m, at);
    const k = { c, at, df, m, tipo };
    if (habDefensiva(c, df, at, m).inmune?.(k)) return { ...nada, ef: 0 };
    if (m.clase === "Estado") return { ...nada, ef: (m.estado === "par" && tipo === "electric" && ef === 0) || (m.marcas.polvo && tiene(df, "grass")) ? 0 : 1 };
    if (ef === 0) return { ...nada, ef: 0 };
    const [minimo, maximo, medio] = rangoDeGolpes(c, at, m);
    let min = 0;
    let max = 0;
    let efFinal = ef;
    for (let golpe = 1; golpe <= maximo; golpe++) {
      const bajo = calcular(c, at, df, m, { tipo, tirada: 15, golpe });
      const alto = calcular(c, at, df, m, { tipo, golpe });
      if (golpe <= minimo) min += bajo.dano;
      max += alto.dano;
      efFinal = alto.ef;
    }
    const porGolpe = (min / minimo + max / maximo) / 2;
    const enPct = (ps) => Math.round((ps * 1000) / psMax(df)) / 10;
    return { min: enPct(min), max: enPct(max), media: enPct(porGolpe * medio), ef: efFinal };
  } finally {
    at.tera = teraReal;
  }
}

/** Quién ha ganado: "yo", "rival" o null si el combate sigue. */
export function ganador(c) {
  return c.ganador;
}

/** Copia independiente del estado: la IA prueba jugadas sobre copias. */
export function clonar(c) {
  const copiarV = (v) => {
    const copia = { ...v };
    for (const campo of Object.keys(copia)) if (copia[campo] && typeof copia[campo] === "object") copia[campo] = { ...copia[campo] };
    return copia;
  };
  const copiarLado = (L) => ({
    ...L,
    trampas: { ...L.trampas }, pantallas: { ...L.pantallas },
    deseo: L.deseo && { ...L.deseo }, futuro: L.futuro && { ...L.futuro },
    equipo: L.equipo.map((p) => ({ ...p, mods: p.mods.slice(), tipos: p.tipos.slice(), pp: p.pp.slice(), v: copiarV(p.v) })),   // la ficha no cambia: se comparte
  });
  return {
    ...c,
    rng: { ...c.rng }, clima: c.clima && { ...c.clima }, campo: c.campo && { ...c.campo },
    pendientes: c.pendientes.slice(), porActivar: c.porActivar.slice(), ev: c.ev.slice(), t: null,
    lados: { yo: copiarLado(c.lados.yo), rival: copiarLado(c.lados.rival) },
  };
}

/**
 * Lo que ha aparecido en los combates y no tiene efecto programado: [{ clase, id, nombre, veces }], con
 * clase «habilidad», «objeto», «movimiento» o «teratipo». El combate sigue como si no hiciera nada especial.
 */
export function sinEfecto() {
  const nombres = { habilidad: nombreHabilidad, objeto: nombreObjeto, movimiento: nombreMovimiento, teratipo: nombreTipo };
  return [...pendientes]
    .map(([clave, veces]) => { const [clase, id] = clave.split("|"); return { clase, id, nombre: nombres[clase](id), veces }; })
    .sort((a, b) => a.clase.localeCompare(b.clase) || b.veces - a.veces || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Habilidades
//
// Una entrada por habilidad, con una función para cada momento en que actúa. Para añadir otra basta
// con escribir su entrada. Momentos: alEntrar(c, p) · alSalir(c, p) · alCambiarElCampo(c, p) ·
// antesDeAtacar(c, p, m, tipo) · tipoDe(c, p, m) · potencia(k), ataque(k) y dano(k) al atacar ·
// defensa(k) y danoRecibido(k) al defender (k: { c, at, df, m, tipo, ca, cd, fisico, critico }; devuelven
// por cuánto se multiplica) · inmune(k) y alAbsorber(c, p, at, m) · alRecibirGolpe(c, p, at, m) ·
// alGolpear(c, p, rival, m) · finDeTurno(c, p) · velocidad(c, p) · inmuneEstado(id) · trasBajar(c, p).
// Y marcas: levita, rebota, atraviesa, ignorante, invierte, sinBajadas, sinDanoIndirecto, sinArena,
// robusto, rompemoldes, presion, venenoCura, titere, ruina, paradoja.
//
// Versión 1: las que lleva con un 10 % de uso o más algún Pokémon con un 3 % de uso o más en
// datos/formatos/gen9ou.json (septiembre de 2026). Son 45 y están hechas 44:
//   protosynthesis, supremeoverlord, goodasgold, waterabsorb, dauntlessshield, multiscale, quarkdrive,
//   pressure, regenerator, toxicdebris, blaze, libero, intimidate, sharpness, magicbounce, poisonheal,
//   infiltrator, clearbody, grassysurge, baddreams, vesselofruin, poisonpuppeteer, weakarmor, flashfire,
//   levitate, magicguard, unaware, defiant, flamebody, static, torrent, liquidvoice, roughskin, contrary,
//   unburden, neutralizinggas, magician, purifyingsalt, sandstream, sandrush, moldbreaker, sturdy,
//   waterbubble, naturalcure.
// Falta cutecharm (Gran Encanto): depende del sexo de los Pokémon, que los equipos de la app no guardan.
// De regalo, las que salen de la misma función que otra de la lista (el resto de climas, campos, ruinas…).

function paradoja(activa) {
  const revisar = (c, p) => {
    const v = p.v;
    if (activa(c)) {
      if (!v.paradoja) { v.paradoja = mejorCaracteristica(p); evHab(c, p, `${p.nombre}'s ${CARACTERISTICAS[v.paradoja]} was heightened`); }
    } else if (v.paradoja && !v.porObjeto) {
      delete v.paradoja;
      evHab(c, p, `${p.nombre}'s boost faded`);
    } else if (!v.paradoja && p.objeto === "boosterenergy") {
      v.paradoja = mejorCaracteristica(p);
      v.porObjeto = true;
      evObj(c, p, `${p.nombre}'s ${CARACTERISTICAS[v.paradoja]} was heightened`, null, gastarObjeto(c, p));
    }
  };
  return {
    paradoja: true, alEntrar: revisar, alCambiarElCampo: revisar,
    ataque: (k) => (k.at.v.paradoja === k.ca ? 1.3 : 1),
    defensa: (k) => (k.df.v.paradoja === k.cd ? 1.3 : 1),
    velocidad: (c, p) => (p.v.paradoja === 5 ? 1.5 : 1),
  };
}

const absorbe = (tipo) => ({
  inmune: (k) => k.tipo === tipo && k.m.objetivo === "rival",
  alAbsorber: (c, p) => evHab(c, p, `Absorbs the attack${p.ps < psMax(p) ? " and restores HP" : ""}`, curar(c, p, fraccion(p, 1, 4))),
});
const apuro = (tipo) => ({ ataque: (k) => (k.tipo === tipo && k.at.ps * 3 <= psMax(k.at) ? 1.5 : 1) });
const alContacto = (estado) => ({
  alRecibirGolpe: (c, p, at, m) => { if (m.marcas.contacto && at.ps > 0 && suerte(c, 3, 10) && !at.estado) { evHab(c, p, `Contact affects ${at.nombre}`); ponerEstado(c, at, estado, p); } },
});
const pincha = () => ({
  alRecibirGolpe: (c, p, at, m) => { if (m.marcas.contacto && at.ps > 0) { const da = herirIndirecto(c, at, fraccion(at, 1, 8)); if (da) evHab(c, p, `${at.nombre} was hurt by touching it`, da); } },
});
const climaAlEntrar = (id) => ({ alEntrar: (c, p) => { if (ponerClima(c, id, p)) evHab(c, p, CLIMAS[id].empieza); } });
const campoAlEntrar = (id) => ({ alEntrar: (c, p) => { if (ponerCampo(c, id, p)) evHab(c, p, `${CAMPOS[id].n} spread across the battlefield!`); } });
const velozCon = (clima, extra = {}) => ({ velocidad: (c) => (climaEs(c, clima) ? 2 : 1), ...extra });
const ruina = (i) => ({ ruina: i, alEntrar: (c, p) => evHab(c, p, `Lowers the ${CARACTERISTICAS[i]} of all other Pokémon`) });
const cambiaDeTipo = {
  antesDeAtacar: (c, p, m, tipo) => {
    if (p.v.cambioDeTipo || p.tera || m.id === "struggle" || (p.tipos.length === 1 && p.tipos[0] === tipo)) return;
    p.v.cambioDeTipo = true;   // una vez cada vez que entra
    p.tipos = [tipo];
    evHab(c, p, `${p.nombre} became ${nombreTipo(tipo)}-type`);
  },
};
const alBajarle = (cambios) => ({ trasBajar: (c, p) => { cambiarPor(c, p, cambios, evHab(c, p, "")); } });
const aspecto = (cambios) => ({
  alEntrar: (c, p) => { if (p.aspecto) return; p.aspecto = true; cambiarPor(c, p, cambios, evHab(c, p, "")); },
});

const HABILIDADES = {
  protosynthesis: paradoja((c) => climaEs(c, "sunnyday")),
  quarkdrive: paradoja((c) => c.campo?.id === "electricterrain"),
  supremeoverlord: {
    alEntrar: (c, p) => { p.v.caidos = Math.min(5, c.lados[p.lado].caidos); if (p.v.caidos) evHab(c, p, p.v.caidos === 1 ? `${p.nombre} grew stronger from its fallen ally` : `${p.nombre} grew stronger from its ${p.v.caidos} fallen allies`); },
    potencia: (k) => 1 + 0.1 * (k.at.v.caidos ?? 0),
  },
  goodasgold: { inmune: (k) => k.m.clase === "Estado" && k.m.objetivo === "rival" },
  waterabsorb: absorbe("water"),
  voltabsorb: absorbe("electric"),
  eartheater: absorbe("ground"),
  dauntlessshield: {
    alEntrar: (c, p) => { if (p.escudo) return; p.escudo = true; cambiarPor(c, p, { def: 1 }, evHab(c, p, "")); },   // una vez por combate
  },
  multiscale: { danoRecibido: (k) => (k.df.ps === psMax(k.df) ? 0.5 : 1) },
  pressure: { presion: true, alEntrar: (c, p) => evHab(c, p, `${p.nombre} is exerting its pressure: the opponent's PP drains faster`) },
  regenerator: { alSalir: (c, p) => { const da = cambiarPS(p, Math.floor(psMax(p) / 3)); if (da) evHab(c, p, `${p.nombre} regained HP on switching out`, da); } },
  naturalcure: { alSalir: (c, p) => { if (p.estado) { p.estado = null; evHab(c, p, `${p.nombre} was cured on switching out`); } } },
  toxicdebris: {
    alRecibirGolpe: (c, p, at, m) => {
      const trampas = c.lados[at.lado].trampas;
      if (m.clase !== "Físico" || trampas.toxicspikes >= TRAMPAS.toxicspikes) return;
      trampas.toxicspikes++;
      evHab(c, p, `Sets ${nombreMovimiento("toxicspikes")} on the opposing side`);
    },
  },
  blaze: apuro("fire"), torrent: apuro("water"), overgrow: apuro("grass"), swarm: apuro("bug"),
  libero: cambiaDeTipo, protean: cambiaDeTipo,
  intimidate: {
    alEntrar: (c, p) => {
      const r = rivalDe(c, p);
      if (r.ps <= 0) return;
      const ev = evHab(c, p, "");
      if (r.v.sustituto) anotar(ev, `The substitute protects ${r.nombre}`);
      else if (!cambiarCaracteristicas(c, r, { atk: -1 }, p, ev) && !ev.txt) anotar(ev, `It doesn't affect ${r.nombre}`);
    },
  },
  sharpness: { potencia: (k) => (k.m.marcas.corte ? 1.5 : 1) },
  magicbounce: { rebota: true },
  poisonheal: { venenoCura: true },
  infiltrator: { atraviesa: true },
  clearbody: { sinBajadas: true },
  grassysurge: campoAlEntrar("grassyterrain"), electricsurge: campoAlEntrar("electricterrain"),
  psychicsurge: campoAlEntrar("psychicterrain"), mistysurge: campoAlEntrar("mistyterrain"),
  baddreams: {
    finDeTurno: (c, p) => { const r = rivalDe(c, p); if (r.ps > 0 && r.estado === "slp") { const da = herirIndirecto(c, r, fraccion(r, 1, 8)); if (da) evHab(c, p, `${r.nombre} is tormented by nightmares`, da); } },
  },
  vesselofruin: ruina(3), tabletsofruin: ruina(1), swordofruin: ruina(2), beadsofruin: ruina(4),
  poisonpuppeteer: { titere: true },
  weakarmor: { alRecibirGolpe: (c, p, at, m) => { if (m.clase === "Físico" && p.ps > 0) cambiarPor(c, p, { def: -1, spe: 2 }, evHab(c, p, "")); } },
  flashfire: {
    inmune: (k) => k.tipo === "fire" && k.m.objetivo === "rival",
    alAbsorber: (c, p) => { p.v.fuego = true; return evHab(c, p, `Absorbs the fire: its Fire-type moves are boosted`); },
    ataque: (k) => (k.at.v.fuego && k.tipo === "fire" ? 1.5 : 1),
  },
  levitate: { levita: true },
  magicguard: { sinDanoIndirecto: true },
  unaware: { ignorante: true },
  defiant: alBajarle({ atk: 2 }), competitive: alBajarle({ spa: 2 }),
  flamebody: alContacto("brn"), static: alContacto("par"), poisonpoint: alContacto("psn"),
  liquidvoice: { tipoDe: (c, p, m) => (m.marcas.sonido ? "water" : null) },
  roughskin: pincha(), ironbarbs: pincha(),
  contrary: { invierte: true },
  unburden: { velocidad: (c, p) => (p.v.liviano ? 2 : 1) },
  neutralizinggas: { alEntrar: (c, p) => evHab(c, p, "Nullifies the abilities of all other Pokémon") },   // lo aplica hab()
  magician: {
    alGolpear: (c, p, r) => {
      if (p.objeto || p.ps <= 0 || !quitable(r)) return;
      p.objeto = gastarObjeto(c, r);
      evHab(c, p, `Steals ${nombreObjeto(p.objeto)} from ${r.nombre}`);
    },
  },
  purifyingsalt: { inmuneEstado: () => true, danoRecibido: (k) => (k.tipo === "ghost" ? 0.5 : 1) },
  sandstream: climaAlEntrar("sandstorm"), drizzle: climaAlEntrar("raindance"), drought: climaAlEntrar("sunnyday"), snowwarning: climaAlEntrar("snowscape"),
  sandrush: velozCon("sandstorm", { sinArena: true }), swiftswim: velozCon("raindance"), chlorophyll: velozCon("sunnyday"), slushrush: velozCon("snowscape"),
  moldbreaker: { rompemoldes: true, alEntrar: (c, p) => evHab(c, p, `${p.nombre} breaks the mold!`) },
  sturdy: { robusto: true, inmune: (k) => Boolean(k.m.fulminante) },
  waterbubble: { ataque: (k) => (k.tipo === "water" ? 2 : 1), danoRecibido: (k) => (k.tipo === "fire" ? 0.5 : 1), inmuneEstado: (id) => id === "brn" },
  // Las habilidades de Ogerpon teracristalizado: suben una característica, una vez por combate
  embodyaspectteal: aspecto({ spe: 1 }), embodyaspectwellspring: aspecto({ spd: 1 }),
  embodyaspecthearthflame: aspecto({ atk: 1 }), embodyaspectcornerstone: aspecto({ def: 1 }),
};

// ---------------------------------------------------------------------------
// Objetos
//
// Igual que las habilidades: una entrada por objeto y los mismos momentos, más trasAtacar(c, p) y las
// marcas eleccion, botas, flota, banda, hierba, dado, tarjeta, boton, adelanta, sinEstado, critico,
// alargaClima, alargaCampo y alargaPantallas.
//
// Versión 1: los que lleva con un 10 % de uso o más algún Pokémon con un 3 % de uso o más en
// datos/formatos/gen9ou.json (septiembre de 2026). Son 27 y están hechos los 27:
//   rockyhelmet, heavydutyboots, boosterenergy, leftovers, blackglasses, airballoon, choicescarf,
//   wellspringmask, lightclay, lifeorb, choicespecs, assaultvest, loadeddice, redcard, focussash,
//   powerherb, ejectbutton, toxicorb, choiceband, terrainextender, stickybarb, scopelens, mysticwater,
//   grassyseed, smoothrock, cornerstonemask, custapberry.
// De regalo, los que salen de la misma función (los que suben un tipo, las otras rocas, semillas y máscaras).

const sube = (tipo) => ({ potencia: (k) => (k.tipo === tipo ? 4915 / 4096 : 1) });
const mascara = { potencia: (k) => (k.at.nombre.startsWith("Ogerpon") ? 4915 / 4096 : 1) };
const orbe = (estado) => ({ finDeTurno: (c, p) => { if (!p.estado && p.ps > 0) { const ev = evObj(c, p, ""); if (!ponerEstado(c, p, estado, p, null, ev)) c.ev.splice(c.ev.indexOf(ev), 1); else anotar(ev, `${p.nombre} was affected by its item`); } } });
const semillaDeCampo = (campo, cambios) => {
  const probar = (c, p) => { if (c.campo?.id === campo && p.ps > 0) { cambiarPor(c, p, cambios, evObj(c, p, "", null, gastarObjeto(c, p))); } };
  return { alEntrar: probar, alCambiarElCampo: probar };
};

const OBJETOS = {
  rockyhelmet: { alRecibirGolpe: (c, p, at, m) => { if (m.marcas.contacto && at.ps > 0) { const da = herirIndirecto(c, at, fraccion(at, 1, 6)); if (da) evObj(c, p, `${at.nombre} was hurt by touching it`, da); } } },
  heavydutyboots: { botas: true },
  boosterenergy: {},   // la gasta Paleosíntesis o Carga Cuark
  leftovers: { finDeTurno: (c, p) => { const da = curar(c, p, fraccion(p, 1, 16)); if (da) evObj(c, p, `${p.nombre} regained HP`, da); } },
  blacksludge: {
    finDeTurno: (c, p) => {
      const da = tiene(p, "poison") ? curar(c, p, fraccion(p, 1, 16)) : herirIndirecto(c, p, fraccion(p, 1, 8));
      if (da) evObj(c, p, tiene(p, "poison") ? `${p.nombre} regained HP` : `${p.nombre} lost HP`, da);
    },
  },
  airballoon: {
    flota: true,
    alEntrar: (c, p) => evObj(c, p, `${p.nombre} is floating on its Air Balloon: Ground-type moves don't affect it`),
    alRecibirGolpe: (c, p) => evObj(c, p, "The Air Balloon popped!", null, gastarObjeto(c, p)),
  },
  choicescarf: { eleccion: true, velocidad: () => 1.5 },
  choiceband: { eleccion: true, ataque: (k) => (k.ca === 1 ? 1.5 : 1) },
  choicespecs: { eleccion: true, ataque: (k) => (k.ca === 3 ? 1.5 : 1) },
  wellspringmask: mascara, cornerstonemask: mascara, hearthflamemask: mascara,
  lightclay: { alargaPantallas: true },
  terrainextender: { alargaCampo: true },
  smoothrock: { alargaClima: "sandstorm" }, heatrock: { alargaClima: "sunnyday" }, damprock: { alargaClima: "raindance" }, icyrock: { alargaClima: "snowscape" },
  lifeorb: {
    dano: () => 5324 / 4096,
    trasAtacar: (c, p) => { const da = herirIndirecto(c, p, fraccion(p, 1, 10)); if (da) evObj(c, p, `${p.nombre} lost some of its HP!`, da); },
  },
  assaultvest: { sinEstado: true, defensa: (k) => (k.cd === 4 ? 1.5 : 1) },
  loadeddice: { dado: true },
  redcard: { tarjeta: true },        // lo resuelve trasElMovimiento()
  ejectbutton: { boton: true },
  focussash: { banda: true },        // lo resuelve aguantar()
  powerherb: { hierba: true },       // lo resuelve cargar()
  custapberry: { adelanta: true },   // lo resuelve resolverTurno() al ordenar
  toxicorb: orbe("tox"), flameorb: orbe("brn"),
  stickybarb: {
    finDeTurno: (c, p) => { const da = herirIndirecto(c, p, fraccion(p, 1, 8)); if (da) evObj(c, p, `${p.nombre} was hurt!`, da); },
    alRecibirGolpe: (c, p, at, m) => { if (m.marcas.contacto && !at.objeto && at.ps > 0) { at.objeto = gastarObjeto(c, p); evObj(c, at, `The Sticky Barb attached to ${at.nombre}`); } },
  },
  scopelens: { critico: 1 },
  grassyseed: semillaDeCampo("grassyterrain", { def: 1 }), electricseed: semillaDeCampo("electricterrain", { def: 1 }),
  psychicseed: semillaDeCampo("psychicterrain", { spd: 1 }), mistyseed: semillaDeCampo("mistyterrain", { spd: 1 }),
  blackglasses: sube("dark"), mysticwater: sube("water"), charcoal: sube("fire"), magnet: sube("electric"), miracleseed: sube("grass"),
  nevermeltice: sube("ice"), blackbelt: sube("fighting"), poisonbarb: sube("poison"), softsand: sube("ground"), sharpbeak: sube("flying"),
  twistedspoon: sube("psychic"), silverpowder: sube("bug"), hardstone: sube("rock"), spelltag: sube("ghost"), dragonfang: sube("dragon"),
  metalcoat: sube("steel"), fairyfeather: sube("fairy"), silkscarf: sube("normal"),
};

// ---------------------------------------------------------------------------
// Movimientos con algo propio
//
// Lo que un movimiento hace de más respecto a sus datos (datos/combate.json). x es { c, p (quien ataca),
// r (el rival), m, tipo, ev (su evento), L y R (sus lados), primera, dano }; k, lo mismo que en las habilidades.
//   falla(x) → verdadero o una frase si no se puede usar · enVez(x) → lo hace todo él · efecto(x) → el
//   efecto de un movimiento de estado · antes(x) y tras(x) → antes y después de golpear · siempre(x) →
//   acierte o no · potencia(k), multiplica(k), fijo(k), fisico(k) · tipo(c, p) · eficacia(ataque, defensa) ·
//   prioridad(c, p) · precision(c, m) · alCargar(x), sinCarga(c), invulnerable · sinTipo, sinQuemadura.
// Una entrada vacía quiere decir que el motor ya lo resuelve con sus datos.

const porPeso = (k) => {
  const kg = k.df.ficha.peso;
  if (!kg) { apuntar("movimiento", k.m.id); return 60; }
  return kg >= 200 ? 120 : kg >= 100 ? 100 : kg >= 50 ? 80 : kg >= 25 ? 60 : kg >= 10 ? 40 : 20;
};
const porPesoRelativo = (k) => {
  const veces = k.at.ficha.peso / k.df.ficha.peso;
  if (!Number.isFinite(veces)) { apuntar("movimiento", k.m.id); return 60; }
  return veces >= 5 ? 120 : veces >= 4 ? 100 : veces >= 3 ? 80 : veces >= 2 ? 60 : 40;
};
const porSubidas = { potencia: (k) => 20 + 20 * k.at.mods.reduce((total, n) => total + Math.max(0, n), 0) };
const porLosPS = { potencia: (k) => Math.max(1, Math.floor((150 * k.at.ps) / psMax(k.at))) };
const mitadDeLosPS = { fijo: (k) => Math.max(1, Math.floor(k.df.ps / 2)) };
const primerTurno = { falla: (x) => !x.primera };
// Golpe Bajo y Rayo Fugaz: solo si el rival va a atacar y todavía no lo ha hecho
const siElRivalAtaca = { falla: (x) => { const t = x.c.t?.[x.r.lado]; return !t || t.hecho || t.accion?.tipo !== "mov" || mov(t.accion.id).clase === "Estado"; } };
const segunElClima = (aciertaCon, mitadCon) => ({ precision: (c, m) => (climaEs(c, aciertaCon) ? null : mitadCon && climaEs(c, mitadCon) ? 50 : m.precision) });
const curaSegunElClima = (conArena) => ({
  efecto: (x) => curarCon(x, conArena ? (climaEs(x.c, "sandstorm") ? 2 / 3 : 1 / 2) : climaEs(x.c, "sunnyday") ? 2 / 3 : x.c.clima ? 1 / 4 : 1 / 2),
});
const devuelve = (veces, fisico) => ({   // Contraataque, Manto Espejo y Represión Metal
  falla: (x) => !x.p.v.golpe || (fisico !== null && x.p.v.golpe.fisico !== fisico),
  fijo: (k) => Math.floor((k.at.v.golpe?.dano ?? 0) * veces),
});
const conSol = { sinCarga: (c) => climaEs(c, "sunnyday"), multiplica: (k) => (k.c.clima && !climaEs(k.c, "sunnyday") ? 0.5 : 1) };
const quitaElCampo = { tras: (x) => { const nombre = quitarCampo(x.c); if (nombre) anotar(x.ev, `The ${nombre} disappeared`); } };
const dejaTrampa = (id) => ({ tras: (x) => { if (x.R.trampas[id] < TRAMPAS[id]) { x.R.trampas[id]++; anotar(x.ev, `Sets ${nombreMovimiento(id)} on the opposing side`); } } });
const giro = {   // Giro Rápido y Giro Mortal limpian el lado de quien los usa
  tras: (x) => {
    if (x.p.ps <= 0) return;
    const quitadas = quitarTrampas(x.L);
    delete x.p.v.drenadoras;
    delete x.p.v.atrapado;
    if (quitadas.length) anotar(x.ev, `Removes ${lista(quitadas)} from its side`);
  },
};
const truco = {
  efecto: ({ p, r, ev, c }) => {
    if ((!p.objeto && !r.objeto) || (p.objeto && !quitable(p)) || (r.objeto && !quitable(r))) return false;
    [p.objeto, r.objeto] = [r.objeto, p.objeto];
    p.v.liviano = !p.objeto;
    r.v.liviano = !r.objeto;
    delete p.v.bloqueo;
    anotar(ev, `${p.nombre} ends up with ${p.objeto ? nombreObjeto(p.objeto) : "nothing"} and ${r.nombre} with ${r.objeto ? nombreObjeto(r.objeto) : "nothing"}`);
    hab(c, p).alCambiarElCampo?.(c, p);
    return true;
  },
};
const curaYSana = { efecto: (x) => { const curado = curarCon(x, 1 / 4); if (x.p.estado) { x.p.estado = null; anotar(x.ev, `${x.p.nombre} was cured of its status condition`); return true; } return curado; } };
const rompePantallas = { antes: (x) => { const habia = PANTALLAS.filter((id) => x.R.pantallas[id]); for (const id of habia) x.R.pantallas[id] = 0; if (habia.length) anotar(x.ev, `Breaks ${lista(habia.map(nombreMovimiento))}`); } };
const pierdeLaMitad = { siempre: (x) => { const da = x.p.ps > 0 ? herirIndirecto(x.c, x.p, Math.ceil(psMax(x.p) / 2)) : null; if (da) evEfecto(x.c, x.p, x.m.n, `${x.p.nombre} paid half of its HP`, da); } };
const gastaSuTipo = (tipo) => ({ falla: (x) => !x.p.tipos.includes(tipo) || Boolean(x.p.tera), tras: (x) => { x.p.tipos = x.p.tipos.filter((t) => t !== tipo); } });

const MOVIMIENTOS = {
  // La potencia depende de algo
  knockoff: {
    multiplica: (k) => (quitable(k.df) ? 1.5 : 1),
    tras: (x) => { if (x.dano && x.p.ps > 0 && quitable(x.r)) anotar(x.ev, `Takes ${nombreObjeto(gastarObjeto(x.c, x.r))} from ${x.r.nombre}`); },
  },
  lowkick: { potencia: porPeso }, grassknot: { potencia: porPeso },
  heavyslam: { potencia: porPesoRelativo }, heatcrash: { potencia: porPesoRelativo },
  storedpower: porSubidas, powertrip: porSubidas,
  eruption: porLosPS, waterspout: porLosPS,
  facade: { multiplica: (k) => (k.at.estado ? 2 : 1), sinQuemadura: true },
  hex: { multiplica: (k) => (k.df.estado ? 2 : 1) },
  barbbarrage: { multiplica: (k) => (k.df.estado === "psn" || k.df.estado === "tox" ? 2 : 1) },
  acrobatics: { multiplica: (k) => (k.at.objeto ? 1 : 2) },
  payback: { multiplica: (k) => (k.c.t?.[k.df.lado]?.hecho ? 2 : 1) },
  avalanche: { multiplica: (k) => (k.at.v.golpe ? 2 : 1) },
  tripleaxel: { potencia: (k) => 20 * k.golpe },
  electroball: { potencia: (k) => { const veces = velocidad(k.c, k.at) / Math.max(1, velocidad(k.c, k.df)); return veces >= 4 ? 150 : veces >= 3 ? 120 : veces >= 2 ? 80 : veces >= 1 ? 60 : 40; } },
  lastrespects: { potencia: (k) => 50 + 50 * k.c.lados[k.at.lado].caidos },
  ragefist: { potencia: (k) => 50 + 50 * Math.min(6, k.at.golpes ?? 0) },
  ficklebeam: { multiplica: (k) => (k.real && suerte(k.c, 3, 10) ? 2 : 1) },
  expandingforce: { multiplica: (k) => (k.c.campo?.id === "psychicterrain" && enElSuelo(k.c, k.at) ? 1.5 : 1) },
  risingvoltage: { multiplica: (k) => (k.c.campo?.id === "electricterrain" && enElSuelo(k.c, k.df) ? 2 : 1) },
  mistyexplosion: { multiplica: (k) => (k.c.campo?.id === "mistyterrain" && enElSuelo(k.c, k.at) ? 1.5 : 1) },
  weatherball: {
    tipo: (c) => ({ sunnyday: "fire", raindance: "water", sandstorm: "rock", snowscape: "ice" })[c.clima?.id] ?? null,
    multiplica: (k) => (k.c.clima ? 2 : 1),
  },
  ivycudgel: { tipo: (c, p) => MASCARAS[p.objeto] ?? null },
  terablast: { tipo: (c, p) => (p.tera && p.tera !== "stellar" ? p.tera : null), fisico: (k) => Boolean(k.at.tera) && conMod(k.at.ficha.est[1], k.at.mods[1]) > conMod(k.at.ficha.est[3], k.at.mods[3]) },
  freezedry: { eficacia: (ataque, defensa) => (defensa === "water" ? 2 : undefined) },
  watershuriken: {},
  // Daño fijo
  ruination: mitadDeLosPS, superfang: mitadDeLosPS,
  endeavor: { falla: (x) => x.r.ps <= x.p.ps, fijo: (k) => k.df.ps - k.at.ps },
  finalgambit: { fijo: (k) => k.at.ps },
  counter: devuelve(2, true), mirrorcoat: devuelve(2, false), metalburst: devuelve(1.5, null),
  // Cuándo se puede usar, prioridad y precisión
  suckerpunch: siElRivalAtaca, thunderclap: siElRivalAtaca,
  upperhand: { falla: (x) => { const t = x.c.t?.[x.r.lado]; return !t || t.hecho || t.accion?.tipo !== "mov" || mov(t.accion.id).clase === "Estado" || mov(t.accion.id).prioridad <= 0; } },
  firstimpression: primerTurno, fakeout: primerTurno,
  poltergeist: { falla: (x) => !x.r.objeto },
  hyperspacefury: { falla: (x) => x.p.nombre !== "Hoopa-Unbound" },
  grassyglide: { prioridad: (c, p) => (c.campo?.id === "grassyterrain" && enElSuelo(c, p) ? 1 : 0) },
  hurricane: segunElClima("raindance", "sunnyday"), thunder: segunElClima("raindance", "sunnyday"),
  bleakwindstorm: segunElClima("raindance"), blizzard: segunElClima("snowscape"),
  // Dos turnos
  solarbeam: conSol, solarblade: conSol,
  meteorbeam: { alCargar: (x) => cambiarCaracteristicas(x.c, x.p, { spa: 1 }, x.p, x.ev) },
  electroshot: { alCargar: (x) => cambiarCaracteristicas(x.c, x.p, { spa: 1 }, x.p, x.ev), sinCarga: (c) => climaEs(c, "raindance") },
  phantomforce: { invulnerable: true },
  // Después de golpear
  rapidspin: giro, mortalspin: giro,
  icespinner: quitaElCampo,
  steelroller: { falla: (x) => !x.c.campo, ...quitaElCampo },
  ceaselessedge: dejaTrampa("spikes"), stoneaxe: dejaTrampa("stealthrock"),
  brickbreak: rompePantallas, psychicfangs: rompePantallas,
  clearsmog: { tras: (x) => { if (x.dano && x.r.ps > 0) { x.r.mods = [0, 0, 0, 0, 0, 0, 0, 0]; anotar(x.ev, `${x.r.nombre}'s stat changes were reset`); } } },
  alluringvoice: { tras: (x) => { if (x.dano && x.r.v.subio) ponerVolatil(x.c, x.r, "confusion", x.p, x.m, null); } },
  burningjealousy: { tras: (x) => { if (x.dano && x.r.v.subio) ponerEstado(x.c, x.r, "brn", x.p, x.m); } },
  direclaw: { tras: (x) => { if (x.dano && suerte(x.c, 1, 2)) ponerEstado(x.c, x.r, ["psn", "par", "slp"][entero(x.c, 3)], x.p, x.m); } },
  doubleshock: gastaSuTipo("electric"), burnup: gastaSuTipo("fire"),
  steelbeam: pierdeLaMitad,
  struggle: { sinTipo: true, tras: (x) => { if (x.p.ps > 0) evEfecto(x.c, x.p, "Recoil", `${x.p.nombre} was damaged by recoil!`, herir(x.p, Math.round(psMax(x.p) / 4))); } },
  highjumpkick: {}, supercellslam: {}, axekick: {},   // el daño al fallar va en sus datos («choque»)
  // Premonición: el ataque llega dos turnos después
  futuresight: {
    enVez: ({ p, m, ev, R }) => {
      if (R.futuro) return false;
      R.futuro = { turnos: 3, id: m.id, de: p.lado, indice: p.indice };
      anotar(ev, `${p.nombre} foresaw an attack!`);
      return true;
    },
  },
  // Curación
  moonlight: curaSegunElClima(false), morningsun: curaSegunElClima(false), synthesis: curaSegunElClima(false), shoreup: curaSegunElClima(true),
  lunarblessing: curaYSana, junglehealing: curaYSana,
  roost: {}, wish: {}, healingwish: {}, lunardance: {},
  rest: {
    efecto: ({ c, p, ev }) => {
      if (p.estado === "slp" || p.ps === psMax(p) || p.v.sinCura) return false;
      if (c.campo && ["electricterrain", "mistyterrain"].includes(c.campo.id) && enElSuelo(c, p)) return false;
      p.estado = "slp";
      p.cuenta = 3;   // dos turnos dormido
      ev.da = cambiarPS(p, psMax(p));
      anotar(ev, `${p.nombre} fell asleep and became healthy`);
      return true;
    },
  },
  strengthsap: {
    efecto: ({ c, p, r, ev, m }) => {
      if (r.mods[1] <= -6) return false;
      const ataque = conMod(r.ficha.est[1], r.mods[1]);
      cambiarCaracteristicas(c, r, { atk: -1 }, p, ev, m);
      const da = curar(c, p, ataque);
      if (da) evEfecto(c, p, m.n, `${p.nombre} regained HP`, da);
      return true;
    },
  },
  painsplit: {
    efecto: ({ c, p, r, ev, m }) => {
      const media = Math.floor((p.ps + r.ps) / 2);
      ev.da = cambiarPS(r, Math.min(media, psMax(r)) - r.ps);
      if (!ev.da) delete ev.da;
      anotar(ev, "The HP was shared");
      const da = cambiarPS(p, Math.min(media, psMax(p)) - p.ps);
      if (da) evEfecto(c, p, m.n, `${p.nombre} evened out its HP with ${r.nombre}`, da);
      return true;
    },
  },
  healbell: {
    efecto: ({ L, ev }) => { for (const aliado of L.equipo) if (aliado.ps > 0) aliado.estado = null; anotar(ev, "Cures the status conditions of its team"); return true; },
  },
  // Características
  bellydrum: {
    efecto: ({ p, ev }) => {
      if (p.ps * 2 <= psMax(p) || p.mods[1] >= 6) return false;
      ev.da = cambiarPS(p, -Math.floor(psMax(p) / 2));
      p.mods[1] = 6;
      anotar(ev, `${p.nombre} maximized its Attack by cutting its HP in half`);
      return true;
    },
  },
  clangoroussoul: {
    efecto: ({ c, p, ev }) => {
      if (p.ps * 3 <= psMax(p)) return false;
      ev.da = cambiarPS(p, -Math.floor(psMax(p) / 3));
      cambiarCaracteristicas(c, p, { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 }, p, ev);
      return true;
    },
  },
  growth: { efecto: ({ c, p, ev }) => { const n = climaEs(c, "sunnyday") ? 2 : 1; return cambiarCaracteristicas(c, p, { atk: n, spa: n }, p, ev); } },
  takeheart: { efecto: ({ c, p, ev }) => { if (p.estado) { p.estado = null; anotar(ev, `${p.nombre} was cured of its status condition`); } cambiarCaracteristicas(c, p, { spa: 1, spd: 1 }, p, ev); return true; } },
  haze: {
    efecto: ({ c, ev }) => { for (const lado of LADOS) activo(c, lado).mods = [0, 0, 0, 0, 0, 0, 0, 0]; anotar(ev, "All stat changes were reset"); return true; },
  },
  psychup: { efecto: ({ p, r, ev }) => { p.mods = r.mods.slice(); anotar(ev, `${p.nombre} copied ${r.nombre}'s stat changes`); return true; } },
  curse: {
    enVez: ({ c, p, r, ev }) => {
      if (!tiene(p, "ghost")) return cambiarCaracteristicas(c, p, { spe: -1, atk: 1, def: 1 }, p, ev);
      if (r.ps <= 0 || r.v.maldito) return false;
      r.v.maldito = true;
      ev.da = cambiarPS(p, -Math.floor(psMax(p) / 2));
      anotar(ev, `${p.nombre} cut its own HP and laid a curse on ${r.nombre}`);
      return true;
    },
  },
  partingshot: {
    efecto: ({ c, p, r, ev, m }) => { cambiarCaracteristicas(c, r, { atk: -1, spa: -1 }, p, ev, m); return true; },
  },
  // Campo y trampas
  defog: {
    efecto: ({ c, p, r, ev, m, L, R }) => {
      cambiarCaracteristicas(c, r, { evasion: -1 }, p, ev, m);
      const quitado = [...new Set([...quitarTrampas(L), ...quitarTrampas(R)])];
      for (const id of PANTALLAS) if (R.pantallas[id]) { R.pantallas[id] = 0; quitado.push(nombreMovimiento(id)); }
      const campo = quitarCampo(c);
      if (campo) quitado.push(campo);
      if (quitado.length) anotar(ev, `Clears ${lista(quitado)}`);
      return true;
    },
  },
  courtchange: {
    efecto: ({ L, R, ev }) => {
      [L.trampas, R.trampas] = [R.trampas, L.trampas];
      [L.pantallas, R.pantallas] = [R.pantallas, L.pantallas];
      [L.vientoAfin, R.vientoAfin] = [R.vientoAfin, L.vientoAfin];
      anotar(ev, "Both sides swapped their hazards and screens");
      return true;
    },
  },
  tidyup: {
    efecto: ({ c, p, ev, L, R }) => {
      const quitado = [...new Set([...quitarTrampas(L), ...quitarTrampas(R)])];
      for (const lado of LADOS) delete activo(c, lado).v.sustituto;
      if (quitado.length) anotar(ev, `Removes ${lista(quitado)}`);
      cambiarCaracteristicas(c, p, { atk: 1, spe: 1 }, p, ev);
      return true;
    },
  },
  stealthrock: {}, spikes: {}, toxicspikes: {}, stickyweb: {},
  reflect: {}, lightscreen: {}, auroraveil: {}, tailwind: {}, trickroom: {},
  mistyterrain: {}, electricterrain: {}, grassyterrain: {}, psychicterrain: {},
  chillyreception: {},   // nieve y cambio: las dos cosas van en sus datos
  batonpass: {},         // el cambio va en sus datos; quien entra hereda los cambios de características y el sustituto
  // Objetos
  trick: truco, switcheroo: truco,
  // Lo que dura mientras se siga en el campo: lo resuelve ponerVolatil()
  protect: {}, detect: {}, banefulbunker: {}, spikyshield: {}, kingsshield: {}, endure: {},
  substitute: {}, taunt: {}, encore: {}, disable: {}, leechseed: {}, yawn: {}, saltcure: {}, smackdown: {},
  destinybond: {}, focusenergy: {}, magnetrise: {}, glaiverush: {}, sparklingaria: {},
  // Autotomía Caudal: media vida a cambio de un sustituto para quien entre
  shedtail: {
    enVez: ({ c, p, ev }) => {
      if (p.ps * 2 <= psMax(p) || !banquillo(c, p.lado).length) return false;
      ev.da = cambiarPS(p, -Math.ceil(psMax(p) / 2));
      anotar(ev, `${p.nombre} left a substitute for its replacement`);
      cambiar(c, p.lado, elegirSuplente(c, p.lado, c.t?.[p.lado]?.accion), { sustituto: Math.floor(psMax(p) / 4) });
      return true;
    },
  },
  // Sonámbulo: dormido, usa al azar otro de sus movimientos
  sleeptalk: {
    enVez: ({ c, p }) => {
      const otros = p.ficha.movimientos.filter((id) => id !== "sleeptalk" && !mov(id).marcas.carga);
      if (p.estado !== "slp" || !otros.length) return false;
      usar(c, p, otros[entero(c, otros.length)]);
      return true;
    },
  },
};

// Movimientos que en el juego hacen algo más de lo que dicen sus datos y aquí todavía no: se usan con
// lo que haya en sus datos (daño, efectos secundarios) y salen en sinEfecto().
// Esta lista se hizo repasando los movimientos que usa algún Pokémon de algún formato. Los demás traen
// «sinUso» en datos/combate.json: funcionan con sus datos (prioridad, problemas de estado, cambios de
// características…), pero nadie ha mirado si hacen algo más, así que también salen en sinEfecto().
const SIN_PROGRAMAR = new Set([
  "acupressure", "afteryou", "allyswitch", "assurance", "beakblast", "beatup", "belch", "block", "bugbite", "dragoncheer",
  "fairylock", "followme", "healpulse", "helpinghand", "imprison", "magicpowder", "minimize", "octolock", "perishsong",
  "pollenpuff", "quash", "quickguard", "ragepowder", "recycle", "revivalblessing", "round", "skillswap", "soak", "speedswap",
  "stockpile", "stompingtantrum", "temperflare", "terrainpulse", "throatchop", "transform", "wideguard", "worryseed",
]);
