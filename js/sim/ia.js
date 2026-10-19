// IA del simulador de combates: elige la jugada de cada lado, la explica y estima quién va ganando.
// No usa el DOM ni Math.random, así que se prueba con Node: node herramientas/probar-sim.mjs
// El contrato está en disenos/implementacion/CONTRATO-SIMULADOR.md.
//
//   elegir(estado, lado, { rapida }?) → { accion, jugada }   // accion: una de opciones(estado, lado)
//   relevo(estado, lado)              → indice               // a quién sacar tras un debilitado
//   probabilidad(estado)              → 0…100                // probabilidad de victoria de «yo»
//
// Cómo decide:
//   1. Tasa «a ojo» lo que puede hacer cada lado, con calcularDano y sin jugar nada: cuánto quita cada
//      ataque, qué cambia cada movimiento de estado y cómo queda cada cambio.
//   2. Se queda con las mejores respuestas del rival y juega cada opción propia contra cada una, sobre
//      copias del estado (clonar + resolverTurno), varias veces con azares distintos.
//   3. Puntúa cómo queda cada copia (valorar): Pokémon en pie, PS, problemas de estado, trampas,
//      mejoras de características y quién amenaza a quién. La nota de 0 a 100 sale de ahí.
//   4. Explica la jugada con plantillas, a partir de lo calculado. Lo que no sale de un cálculo no se dice.
// Con { rapida: true } se queda en el paso 1 y no explica nada: es lo que usan los combates de la previsión.
//
// Las dos IA ven los dos equipos enteros. Las copias juegan con otro azar que el combate de verdad:
// la IA no sabe si su próximo golpe va a fallar. Aquí se cambia el estado solo de forma pasajera
// (comoSi, conPs, conTera) y siempre se deja como estaba. De un turno para otro la IA solo recuerda
// cuánto lleva atascado el combate (atasco), y lo guarda fuera del estado.
import { dic, nombreHabilidad, nombreMovimiento, nombreObjeto } from "../meta.js";
import { ETIQUETAS, factor, nombreTipo } from "../tipos.js";
import { datosDeCombate } from "./datos.js";
import { calcularDano, clonar, opciones, resolverTurno, velocidad } from "./motor.js";

const MUESTRAS = 3;        // veces que se juega cada pareja de jugadas, con azares distintos
const RESPUESTAS = 3;      // respuestas del rival contra las que se prueba cada opción
const SAL = [0x1b873593, 0x7f4a7c15, 0x2c1b3c6d, 0x5bd1e995];   // un azar distinto para cada muestra
const VIVO = 70;           // puntos por cada Pokémon en pie; sus PS valen hasta 100 más
const TERA = 30;           // lo que vale tener la teracristalización sin gastar
const GANAR = 2000;        // un combate ganado vale más que cualquier ventaja

const CAPAS = { stealthrock: 1, spikes: 3, toxicspikes: 2, stickyweb: 1 };          // las que admite cada trampa
const PESO_TRAMPA = { stealthrock: 7, spikes: 4, toxicspikes: 3, stickyweb: 4 };    // puntos por rival en el banco
const PANTALLAS = ["reflect", "lightscreen", "auroraveil"];
const PROTECCIONES = ["protect", "banefulbunker", "spikyshield", "kingsshield", "burningbulwark", "silktrap"];
const QUITA_TRAMPAS = ["defog", "rapidspin", "mortalspin", "tidyup"];
const SI_EL_RIVAL_ATACA = ["suckerpunch", "thunderclap"];
const SOLO_AL_ENTRAR = ["fakeout", "firstimpression"];
const CON_RETRASO = ["futuresight", "doomdesire"];
const ELECCION = ["choiceband", "choicespecs", "choicescarf"];
const COSTE_ESTADO = { brn: 12, par: 16, psn: 12, tox: 22, slp: 30, frz: 35 };      // lo que resta tenerlo
const VALOR_ESTADO = { brn: 18, par: 18, psn: 12, tox: 20, slp: 32, frz: 30 };      // lo que vale ponérselo al rival
const SUFRE = { brn: "burned", par: "paralyzed", psn: "poisoned", tox: "badly poisoned", slp: "asleep", frz: "frozen" };
const CARACTERISTICA = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed", accuracy: "Accuracy", evasion: "Evasion" };

// ---------------------------------------------------------------------------
// Utilidades

const otro = (lado) => (lado === "yo" ? "rival" : "yo");
const limitar = (n, min, max) => Math.min(max, Math.max(min, n));
const enCampo = (e, lado) => e.lados[lado].equipo[e.lados[lado].activo];
const psDe = (p) => (p.ps * 100) / p.ficha.est[0];                 // PS que le quedan, en %
const banco = (e, lado) => e.lados[lado].equipo.filter((p) => p.ps > 0 && p.indice !== e.lados[lado].activo);
const tiposDe = (p) => (p.tera && p.tera !== "stellar" ? [p.tera] : p.tipos);
const enumerar = (nombres) => (nombres.length > 1 ? `${nombres.slice(0, -1).join(", ")} and ${nombres.at(-1)}` : nombres[0] ?? "");
const etiqueta = (ef) => ETIQUETAS[ef] ?? `${ef}×`;
const rango = (d) => (Math.round(d.min) === Math.round(d.max) ? `${Math.round(d.max)}%` : `${Math.round(d.min)}–${Math.round(d.max)}%`);
/** Lo que le hace un golpe a quien le quedan «ps» (en %): «KOs it», «can KO it» o «deals…». */
const leHace = (d, ps) => (d.min >= ps ? "KOs it" : d.max >= ps ? "can KO it" : `deals ${entre(d)}`);
const entre = (d) => (Math.round(d.min) === Math.round(d.max) ? `${Math.round(d.max)}%` : `${Math.round(d.min)}–${Math.round(d.max)}%`);

const fichas = new Map();

/** Lo que la IA necesita saber de un movimiento: el diccionario y datos/combate.json. */
function mov(id) {
  let m = fichas.get(id);
  if (m) return m;
  const d = dic().movimientos[id] ?? {};
  const k = datosDeCombate().movimientos[id] ?? {};
  m = {
    id, n: nombreMovimiento(id), clase: d.clase ?? "Estado", precision: d.precision ?? null, prioridad: 0, objetivo: "rival", ...k,
    marcas: Object.fromEntries((k.marcas ?? []).map((marca) => [marca, true])),
  };
  fichas.set(id, m);
  return m;
}

/** Hace la cuenta como si en el campo de «lado» estuviera el Pokémon «indice», y lo deja como estaba. */
function comoSi(e, lado, indice, cuenta) {
  const L = e.lados[lado];
  const real = L.activo;
  L.activo = indice;
  try {
    return cuenta(L.equipo[indice]);
  } finally {
    L.activo = real;
  }
}

/** Hace la cuenta como si «p» hubiera perdido ya ese porcentaje de sus PS. */
function conPs(p, pct, cuenta) {
  const real = p.ps;
  p.ps = Math.max(1, Math.round(p.ps - (pct * p.ficha.est[0]) / 100));
  try {
    return cuenta();
  } finally {
    p.ps = real;
  }
}

/** Hace la cuenta como si «p» ya se hubiera teracristalizado. */
function conTera(p, cuenta) {
  const real = p.tera;
  p.tera = p.ficha.tera;
  try {
    return cuenta();
  } finally {
    p.tera = real;
  }
}

/** La Velocidad de un Pokémon en el campo: la cuenta es la del motor, que es quien ordena el turno. */
export const velocidadDe = velocidad;

// ---------------------------------------------------------------------------
// El uno contra uno de los dos Pokémon en campo

/** Con qué frecuencia hace un ataque lo que promete: precisión y condiciones para que funcione. */
function fiable(m, p) {
  if (SOLO_AL_ENTRAR.includes(m.id) && p.v.actuo) return 0;
  if (m.fulminante) return 0.3;
  let f = (m.precision ?? 100) / 100;
  if (SI_EL_RIVAL_ATACA.includes(m.id)) f *= 0.7;
  if (CON_RETRASO.includes(m.id) || (m.marcas.carga && p.objeto !== "powerherb")) f *= 0.5;
  if (m.marcas.recarga) f *= 0.6;
  if (m.autodestruccion) f *= 0.4;
  return f;
}

/** Los ataques que puede usar ahora el Pokémon en campo de «lado», del que más quita al que menos. */
function golpes(e, lado) {
  const p = enCampo(e, lado);
  const lista = [];
  for (const o of opciones(e, lado)) {
    if (o.tipo !== "mov" || o.tera) continue;
    const m = mov(o.id);
    if (m.clase === "Estado") continue;
    const d = calcularDano(e, lado, o.id);
    lista.push({ id: o.id, m, n: m.n, min: d.min, max: d.max, media: d.media, ef: d.ef, vale: d.media * fiable(m, p) });
  }
  return lista.sort((a, b) => b.vale - a.vale);
}

/** Probabilidad de que un golpe debilite a quien le quedan «ps» (en %), sin contar si acierta. */
function probKO(d, ps) {
  if (!d || d.max < ps) return 0;
  if (d.min >= ps) return 1;
  return limitar((d.max - ps) / (d.max - d.min || 1), 0.1, 0.9);
}

/**
 * Quién gana si los dos Pokémon en campo se quedan a pegarse: los puntos son para «lado» (negativos si
 * pierde) y pesan más cuanto antes se resuelve y más PS conserva quien gana. Devuelve también los
 * ataques de cada uno y quién se mueve antes a igualdad de prioridad.
 */
function careo(e, lado) {
  const a = enCampo(e, lado);
  const b = enCampo(e, otro(lado));
  if (a.ps <= 0 || b.ps <= 0) return { puntos: 0, mios: [], suyos: [], antes: false };
  const mios = golpes(e, lado);
  const suyos = golpes(e, otro(lado));
  const psA = psDe(a);
  const psB = psDe(b);
  const diferencia = (velocidadDe(e, a) - velocidadDe(e, b)) * (e.espacioRaro ? -1 : 1);
  let orden = Math.sign(diferencia) / 2;                // medio turno de ventaja para quien pega antes
  const turnos = (lista, ps) => (lista[0]?.vale > 0 ? Math.min(9, Math.ceil(ps / lista[0].vale)) : 9);
  let tA = turnos(mios, psB);
  let tB = turnos(suyos, psA);
  // Un golpe con prioridad que debilita se adelanta a la velocidad
  const remata = (lista, ps) => lista.some((g) => g.m.prioridad > 0 && g.vale > 0 && g.min >= ps);
  const rA = remata(mios, psB);
  const rB = remata(suyos, psA);
  if (rA) tA = 1;
  if (rB) tB = 1;
  if (rA !== rB) orden = rA ? 0.5 : -0.5;

  const ventaja = tB - tA + orden;
  let puntos = 0;
  if ((tA < 9 || tB < 9) && ventaja !== 0) {
    const gano = ventaja > 0;
    const t = gano ? tA : tB;                           // turnos que tarda quien gana
    const encaja = Math.max(0, t - 0.5 - orden * (gano ? 1 : -1));   // golpes que se lleva mientras tanto
    const resto = Math.max(1, (gano ? psA : psB) - encaja * ((gano ? suyos : mios)[0]?.vale ?? 0));
    puntos = (15 + 0.25 * resto) * (t <= 2 ? 1 : 2 / t) * (gano ? 1 : -1);
  }
  return { puntos, mios, suyos, antes: diferencia > 0 };
}

const resumenDeGolpe = (g) => (g ? { n: g.n, min: g.min, max: g.max, ef: g.ef } : null);

/**
 * El uno contra uno entre el Pokémon «i» de «yo» y el «j» del rival tal como están ahora:
 * { puntos (a favor de «yo» si son positivos), mio, suyo }, con el mejor ataque de cada uno.
 */
export function enfrentar(estado, i, j) {
  return comoSi(estado, "yo", i, () => comoSi(estado, "rival", j, () => {
    const c = careo(estado, "yo");
    return { puntos: c.puntos, mio: resumenDeGolpe(c.mios[0]), suyo: resumenDeGolpe(c.suyos[0]) };
  }));
}

// ---------------------------------------------------------------------------
// Cómo está el combate

/** PS que pierde un Pokémon al entrar con las trampas que tiene su lado, en %. */
function entrada(e, p) {
  const t = e.lados[p.lado].trampas;
  if (p.objeto === "heavydutyboots") return 0;
  const tipos = tiposDe(p);
  const suelo = !tipos.includes("flying") && p.habilidad !== "levitate" && p.objeto !== "airballoon";
  let pct = 0;
  if (p.habilidad !== "magicguard") {
    if (t.stealthrock) pct += 12.5 * tipos.reduce((total, tipo) => total * factor("rock", tipo), 1);
    if (t.spikes && suelo) pct += [12.5, 16.7, 25][t.spikes - 1];
  }
  if (t.toxicspikes && suelo && !p.estado && !tipos.includes("poison") && !tipos.includes("steel")) pct += 8;
  if (t.stickyweb && suelo) pct += 5;
  return pct;
}

const cargaDeTrampas = (e, lado) => banco(e, lado).reduce((total, p) => total + entrada(e, p), 0);

/** Lo que tiene un lado: Pokémon en pie, PS, problemas de estado, mejoras, trampas que le esperan y la tera sin gastar. */
function material(e, lado) {
  const L = e.lados[lado];
  let total = 0;
  for (const p of L.equipo) {
    if (p.ps <= 0) continue;
    const ps = p.ps / p.ficha.est[0];
    const fisico = p.ficha.est[1] >= p.ficha.est[3];
    let v = VIVO + 100 * ps;
    if (p.estado) v -= (p.estado === "brn" && fisico ? 25 : COSTE_ESTADO[p.estado] ?? 0) * (0.4 + 0.6 * ps);
    if (p.indice === L.activo) {
      const mejoras = p.mods[1] * (fisico ? 8 : 1) + p.mods[3] * (fisico ? 1 : 8) + p.mods[5] * 5 + (p.mods[2] + p.mods[4]) * 3;
      v += limitar(mejoras, -30, 45) * (0.3 + 0.7 * ps);
      if (p.v.sustituto) v += 15;
      if (p.v.drenadoras) v -= 10;
    } else v -= 0.7 * Math.min(entrada(e, p), 100 * ps);
    total += v;
  }
  if (e.conTera && !L.teraUsada) total += TERA;
  for (const id of PANTALLAS) total += 2 * L.pantallas[id];
  total += 2 * L.vientoAfin;
  return total;
}

/** Cómo le va a «lado»: lo que tiene él menos lo que tiene el rival, más quién gana el uno contra uno en campo. */
function valorar(e, lado) {
  if (e.ganador) return e.ganador === lado ? GANAR : -GANAR;
  return material(e, lado) - material(e, otro(lado)) + careo(e, lado).puntos;
}

/** Probabilidad de victoria de «yo», de 0 a 100. Solo es 100 o 0 con el combate terminado. */
export function probabilidad(estado) {
  if (estado.ganador) return estado.ganador === "yo" ? 100 : 0;
  const mio = material(estado, "yo");
  const suyo = material(estado, "rival");
  // La misma ventaja pesa más cuanto menos queda en pie
  const x = (mio - suyo + careo(estado, "yo").puntos) / (30 + 0.085 * (mio + suyo));
  return limitar(Math.round(100 / (1 + Math.exp(-x))), 1, 99);
}

/** A quién sacar cuando cae un Pokémon (o tras Ida y Vuelta): el que mejor queda ante el rival en campo. */
export function relevo(estado, lado) {
  let mejor = -1;
  let nota = -Infinity;
  for (const p of banco(estado, lado)) {
    const valor = comoSi(estado, lado, p.indice, () => {
      const coste = entrada(estado, p);
      if (coste >= psDe(p)) return -VIVO;
      return conPs(p, coste, () => careo(estado, lado).puntos) - 0.5 * coste + 0.05 * psDe(p);
    });
    if (valor > nota) { nota = valor; mejor = p.indice; }
  }
  return mejor;
}

// ---------------------------------------------------------------------------
// Tasar «a ojo» lo que puede hacer un lado

/** Lo que hay en el campo visto desde «lado»: los dos Pokémon, sus PS, sus ataques y el golpe que más teme. */
function situacion(e, lado) {
  const yo = enCampo(e, lado);
  const el = enCampo(e, otro(lado));
  const c = careo(e, lado);
  return { lado, yo, el, psYo: psDe(yo), psEl: psDe(el), ...c, golpe: c.suyos[0] ?? null };
}

/** ¿Le puede entrar ese problema de estado? (lo que impiden las habilidades lo dice calcularDano con ef 0) */
function puedeSufrir(p, estado) {
  if (p.estado || p.v.sustituto) return false;
  const tipos = tiposDe(p);
  if (estado === "brn") return !tipos.includes("fire");
  if (estado === "par") return !tipos.includes("electric");
  if (estado === "psn" || estado === "tox") return !tipos.includes("poison") && !tipos.includes("steel");
  if (estado === "frz") return !tipos.includes("ice");
  return true;
}

/** Lo que vale usar ahora un movimiento de estado. Negativo si no haría nada. */
function valorDeEstado(e, s, m) {
  const { yo, el, golpe } = s;
  const L = e.lados[s.lado];
  const R = e.lados[otro(s.lado)];
  const aguanto = !golpe || golpe.max < s.psYo;          // el rival no me debilita este turno
  const tranquilo = !golpe || golpe.media < 35;
  let v = 2;
  if (CAPAS[m.bando]) v = R.trampas[m.bando] < CAPAS[m.bando] ? PESO_TRAMPA[m.bando] * banco(e, otro(s.lado)).length : -5;
  else if (PANTALLAS.includes(m.bando)) v = L.pantallas[m.bando] || (m.bando === "auroraveil" && e.clima?.id !== "snowscape") ? -5 : 18;
  else if (m.bando === "tailwind") v = L.vientoAfin ? -5 : 12;
  else if (m.objetivo === "propio" && m.cambios) {
    const sube = Object.values(m.cambios).reduce((total, n) => total + Math.max(0, n), 0);
    const ya = Math.max(yo.mods[1], yo.mods[3], yo.mods[5]);
    v = ya >= 6 ? -5 : (tranquilo ? 9 : aguanto ? 3 : 0) * sube * (ya >= 2 ? 0.4 : 1);
  } else if (m.cura) {
    const cura = Math.min(100 - s.psYo, (100 * m.cura[0]) / m.cura[1]);
    v = cura < 10 ? -5 : golpe && golpe.media >= cura ? 0.15 * cura : 0.8 * cura;
  } else if (m.estado) {
    const afecta = puedeSufrir(el, m.estado) && calcularDano(e, s.lado, m.id).ef !== 0;
    v = afecta ? VALOR_ESTADO[m.estado] * ((m.precision ?? 100) / 100) : -5;
    if (afecta && m.estado === "brn" && golpe?.m.clase === "Físico") v += 12;
    if (afecta && m.estado === "par" && !s.antes) v += 8;
  } else if (PROTECCIONES.includes(m.volatil)) v = yo.v.protecciones ? -5 : el.estado === "tox" || el.estado === "psn" || el.estado === "brn" || el.v.drenadoras ? 10 : 3;
  else if (m.volatil === "substitute") v = yo.v.sustituto || s.psYo <= 25 ? -5 : tranquilo ? 14 : 4;
  else if (m.volatil === "taunt") v = el.v.mofa ? -5 : el.ficha.movimientos.some((id) => mov(id).clase === "Estado") ? 10 : 0;
  else if (m.volatil === "leechseed") v = el.v.drenadoras || el.v.sustituto || tiposDe(el).includes("grass") ? -5 : 12;
  else if (m.volatil === "yawn") v = el.estado || el.v.bostezo || el.v.sustituto ? -5 : 10;
  else if (m.volatil === "encore") v = el.v.otraVez || !el.v.ultimo ? -5 : 8;
  else if (QUITA_TRAMPAS.includes(m.id)) v = 0.7 * cargaDeTrampas(e, s.lado) - (m.id === "defog" ? 0.5 * cargaDeTrampas(e, otro(s.lado)) : 0);
  else if (m.ranura === "Wish") v = L.deseo ? -5 : 10;
  // Si el rival pega antes y debilita, lo más probable es que no llegue a usarlo
  if (v > 0 && !aguanto && !(s.antes && m.prioridad >= golpe.m.prioridad)) v *= 0.3;
  return v;
}

/**
 * ¿Cambia la teracristalización el resultado del turno? Devuelve { asegura } si el golpe pasa a debilitar
 * seguro, { evita } si el rival deja de poder debilitar, o null: entonces no se plantea.
 */
function motivoDeTera(e, s, m) {
  const { yo } = s;
  if (m.clase !== "Estado") {
    const sin = calcularDano(e, s.lado, m.id);
    const con = calcularDano(e, s.lado, m.id, { tera: true });
    if (sin.min < s.psEl && con.min >= s.psEl) return { asegura: sin };
  }
  if (m.cambioTras) return null;                         // quien se va a retirar no gasta la tera en aguantar
  if (s.evita === undefined) {
    // El golpe que hoy la debilita, y lo más que le podría quitar el rival con ella ya teracristalizada
    s.evita = null;
    if (s.golpe && s.golpe.max >= s.psYo) {
      const peor = conTera(yo, () => golpes(e, otro(s.lado)).reduce((maximo, g) => Math.max(maximo, g.max), 0));
      if (peor < s.psYo) s.evita = { n: s.golpe.n, max: peor };
    }
  }
  return s.evita ? { evita: s.evita } : null;
}

function ojoDeMovimiento(e, s, accion, tera = null) {
  const m = mov(accion.id);
  const pagar = tera ? (tera.evita ? 0.6 * VIVO : 0) - TERA : 0;
  if (m.clase === "Estado") return { m, ojo: valorDeEstado(e, s, m) + pagar };
  const d = accion.tera ? calcularDano(e, s.lado, m.id, { tera: true }) : s.mios.find((g) => g.id === m.id) ?? calcularDano(e, s.lado, m.id);
  let ojo = (Math.min(d.media, s.psEl) + probKO(d, s.psEl) * VIVO) * fiable(m, s.yo);
  // Si el rival pega antes y debilita, el golpe no llega a salir
  const golpe = s.golpe;
  const meAdelanta = golpe && (golpe.m.prioridad > m.prioridad || (golpe.m.prioridad === m.prioridad && !s.antes));
  if (meAdelanta && !tera?.evita) ojo *= 1 - 0.8 * probKO(golpe, s.psYo);
  if (m.cambioTras && banco(e, s.lado).length) ojo += s.puntos < 0 ? 10 : 3;
  if (QUITA_TRAMPAS.includes(m.id)) ojo += 0.7 * cargaDeTrampas(e, s.lado);
  return { m, d, ojo: ojo + pagar + 0.01 * d.media };    // a igualdad, el golpe más fuerte
}

/**
 * Un cambio: quien entra se lleva las trampas y el golpe que el rival tenía para quien se va, y queda en
 * su uno contra uno. Sin «conValor» devuelve solo lo que le cuesta entrar (el valor lo darán las pruebas).
 */
function ojoDeCambio(e, s, indice, conValor) {
  return comoSi(e, s.lado, indice, (entra) => {
    const trampas = entrada(e, entra);
    const recibe = s.golpe ? calcularDano(e, otro(s.lado), s.golpe.id) : null;
    const coste = trampas + (recibe?.media ?? 0);
    if (!conValor) return { entra, coste, ojo: 0 };
    if (coste >= psDe(entra)) return { entra, coste, ojo: -VIVO - psDe(entra) };
    const puntos = conPs(entra, coste, () => careo(e, s.lado).puntos);
    // Irse salva, de momento, a quien iba a caer; cambiar cuesta el turno, y más si acaba de entrar
    const salva = 0.4 * probKO(s.golpe, s.psYo) * (VIVO + s.psYo);
    return { entra, coste, ojo: puntos - s.puntos - 0.9 * coste + salva - (s.yo.v.actuo ? 5 : 15) };
  });
}

const INDICE_MODS = { atk: 1, def: 2, spa: 3, spd: 4, spe: 5, accuracy: 6, evasion: 7 }; // posición en p.mods (como en el motor)

/** true si el movimiento no puede hacer nada ahora: Sorpresa fuera del primer turno, Protección seguida o subidas ya al máximo. */
function inutil(p, accion) {
  if (accion.tipo !== "mov") return false;
  const m = mov(accion.id);
  if (SOLO_AL_ENTRAR.includes(m.id)) return Boolean(p.v.actuo);
  if (m.clase !== "Estado") return false;
  if (PROTECCIONES.includes(m.volatil) || PROTECCIONES.includes(m.id)) return Boolean(p.v.protecciones);
  if (m.objetivo === "propio" && m.cambios) {
    return Object.entries(m.cambios).every(([clave, n]) => (n > 0 ? p.mods[INDICE_MODS[clave]] >= 6 : n < 0 ? p.mods[INDICE_MODS[clave]] <= -6 : true));
  }
  return false;
}

/** Las opciones de un lado sin las jugadas que no sirven para nada; si no queda otra, todas. */
function utiles(e, lado) {
  const todas = opciones(e, lado);
  const p = enCampo(e, lado);
  const buenas = todas.filter((accion) => !inutil(p, accion));
  return buenas.length ? buenas : todas;
}

/**
 * Las opciones de un lado con su valor «a ojo» y los datos que lo explican. La tera, solo si cambia el
 * turno. Los cambios: "todos" con su valor, "sin valor" (lo darán las pruebas) o "si conviene", que los
 * deja fuera cuando quien está en campo gana su uno contra uno y nada lo debilita este turno.
 */
function tasar(e, s, cambios = "todos") {
  const lista = [];
  const sobran = cambios === "si conviene" && s.puntos > 0 && probKO(s.golpe, s.psYo) === 0;
  for (const accion of utiles(e, s.lado)) {
    if (accion.tipo === "cambio") {
      if (!sobran) lista.push({ accion, ...ojoDeCambio(e, s, accion.a, cambios !== "sin valor") });
    } else if (!accion.tera) lista.push({ accion, ...ojoDeMovimiento(e, s, accion) });
    else {
      const tera = motivoDeTera(e, s, mov(accion.id));
      if (tera) lista.push({ accion, tera, ...ojoDeMovimiento(e, s, accion, tera) });
    }
  }
  return lista;
}

// ---------------------------------------------------------------------------
// Probar las jugadas sobre copias

/** Las mejores respuestas del rival, con el peso de cada una: cuanto mejor es «a ojo», más se cuenta con ella. */
function respuestas(lista) {
  const mejores = [...lista].sort((a, b) => b.ojo - a.ojo).slice(0, RESPUESTAS);
  for (const o of mejores) o.peso = Math.exp((o.ojo - mejores[0].ojo) / 12);
  const creibles = mejores.filter((o) => o.peso >= 0.08);
  const total = creibles.reduce((suma, o) => suma + o.peso, 0);
  for (const o of creibles) o.peso /= total;
  return creibles;
}

/**
 * Juega el turno sobre una copia, con el azar de la muestra «k», y apunta en la prueba cómo queda «lado».
 * La prueba guarda la media de sus muestras (valor) y la copia y los eventos de la primera.
 */
function probar(estado, lado, mia, suya, k, prueba = { suma: 0, muestras: 0, valor: 0 }) {
  const copia = clonar(estado);
  copia.rng.s = Math.imul(estado.rng.s ^ SAL[k], 0x9e3779b1) | 0;
  const eventos = lado === "yo" ? resolverTurno(copia, mia, suya, { relevo }) : resolverTurno(copia, suya, mia, { relevo });
  prueba.suma += valorar(copia, lado);
  prueba.valor = prueba.suma / ++prueba.muestras;
  if (k === 0) Object.assign(prueba, { copia, eventos });
  return prueba;
}

/** Lo que vale una opción con sus pruebas: se cuenta con la respuesta más probable, y un poco más con la que peor le viene. */
function valorDe(mia, suyas) {
  const media = mia.pruebas.reduce((total, prueba, i) => total + prueba.valor * suyas[i].peso, 0);
  const peor = Math.min(...mia.pruebas.map((prueba) => prueba.valor));
  return 0.75 * media + 0.25 * peor - mia.resta;
}

/**
 * A quién se guarda cada Pokémon de «lado»: si es el único del equipo que gana el uno contra uno a un
 * rival que espera en el banco, índice → nombre de ese rival.
 */
function reservas(e, lado) {
  const guardados = new Map();
  const mios = e.lados[lado].equipo.filter((p) => p.ps > 0);
  if (mios.length < 2) return guardados;
  for (const rival of banco(e, otro(lado))) {
    const ganan = mios.filter((p) => comoSi(e, lado, p.indice, () => comoSi(e, otro(lado), rival.indice, () => careo(e, lado).puntos > 0)));
    if (ganan.length === 1 && !guardados.has(ganan[0].indice)) guardados.set(ganan[0].indice, apodo(e, rival));
  }
  return guardados;
}

// ---------------------------------------------------------------------------
// Combates atascados

const memoria = new WeakMap();   // estado del combate → { turno, marca, quieto, caidos, sinKO }

/**
 * ¿Está atascado el combate? Lo está si en 6 turnos nadie ha caído ni han bajado, entre todos, 5 puntos
 * de PS desde la última vez que lo hicieron (curarse no cuenta) o si, pasado el turno 60, no cae nadie en
 * 10 turnos. Devuelve la frase que lo cuenta, o null. Es lo único que la IA recuerda de un turno para
 * otro, y lo guarda fuera del estado.
 */
function atasco(e) {
  let total = 0;
  for (const lado of ["yo", "rival"]) for (const p of e.lados[lado].equipo) total += Math.max(0, psDe(p));
  const caidos = e.lados.yo.caidos + e.lados.rival.caidos;
  let m = memoria.get(e);
  if (!m) memoria.set(e, m = { turno: e.turno, marca: total, quieto: 0, caidos, sinKO: 0 });
  else if (m.turno !== e.turno) {
    const pasan = e.turno - m.turno;
    if (total <= m.marca - 5) Object.assign(m, { marca: total, quieto: 0 });
    else m.quieto += pasan;
    if (caidos !== m.caidos) Object.assign(m, { caidos, sinKO: 0 });
    else m.sinKO += pasan;
    m.turno = e.turno;
  }
  if (m.quieto >= 6) return `No one has lost net HP for ${m.quieto} turns`;
  if (e.turno > 60 && m.sinKO >= 10) return `No Pokémon has fainted for ${m.sinKO} turns`;
  return null;
}

/**
 * Con el combate atascado, quien puede hacer daño solo elige entre sus ataques: así no se eterniza un
 * duelo de curas y cambios. Quien no puede hacerlo sigue eligiendo entre todo (obligarle a cambiar sería
 * regalar Pokémon cuando lo que toca es esperar a que al otro se le acaben los PP).
 */
function directas(lista) {
  const pegan = lista.filter((o) => o.accion.tipo === "mov" && o.d?.media >= 10);
  return pegan.length ? pegan : lista;
}

// ---------------------------------------------------------------------------
// Elegir

/** La nota de 0 a 100 de una opción: lo que mejora el combate con ella y, a medias, lo que saca a las otras dos mejores. */
const nota = (ganancia, ventaja) => limitar(Math.round(100 / (1 + Math.exp(-(ganancia + 10 + 0.5 * ventaja) / 30))), 1, 99);

/**
 * La jugada de «lado» para este turno: { accion, jugada }. La acción es una de opciones(estado, lado);
 * la jugada, la del contrato ({ elige, porque, opciones }). Con { rapida: true } decide «a ojo», sin
 * probar nada sobre copias, y la jugada va a null.
 */
export function elegir(estado, lado, { rapida = false } = {}) {
  const legales = opciones(estado, lado);
  if (!legales.length) return { accion: null, jugada: null };
  const yo = enCampo(estado, lado);
  if (yo.ps <= 0) {
    // Tiene que sacar a otro: es un relevo, no una jugada
    const accion = { tipo: "cambio", a: relevo(estado, lado) };
    const entra = estado.lados[lado].equipo[accion.a];
    return { accion, jugada: rapida ? null : unica(`Switch to ${entra.nombre}`, pulir(`${apodo(estado, yo)} fainted and ${apodo(estado, entra)} has the best matchup on the field.`)) };
  }
  const s = situacion(estado, lado);
  const atascado = atasco(estado);
  if (rapida) {
    const lista = atascado ? directas(tasar(estado, s, "todos")) : tasar(estado, s, "si conviene");
    return { accion: lista.reduce((mejor, o) => (o.ojo > mejor.ojo ? o : mejor)).accion, jugada: null };
  }
  const todas = tasar(estado, s, "sin valor");
  if (todas.length === 1) return { accion: todas[0].accion, jugada: unica(texto(estado, lado, todas[0].accion), sinAlternativa(estado, s, todas[0])) };
  const mias = atascado ? directas(todas) : todas;

  const suyas = respuestas(tasar(estado, situacion(estado, otro(lado)), "si conviene"));
  const guardados = reservas(estado, lado);
  const antes = valorar(estado, lado);
  for (const mia of mias) {
    mia.resta = 0;
    if (mia.accion.tipo === "cambio") {
      mia.resta = yo.v.actuo ? 6 : 14;                   // cambiar cuesta el turno: que no entre y salga sin hacer nada
      // Quien es la única respuesta a un rival del banco no entra a recibir golpes
      if (guardados.has(mia.accion.a) && mia.coste > 5) {
        mia.guardado = guardados.get(mia.accion.a);
        mia.resta += 0.3 * Math.min(mia.coste, 60);
      }
    }
    mia.pruebas = suyas.map((suya) => probar(estado, lado, mia.accion, suya.accion, 0));
    mia.valor = valorDe(mia, suyas);
  }
  // Las demás muestras, solo para las opciones que siguen cerca de la mejor
  const corte = Math.max(...mias.map((mia) => mia.valor)) - 30;
  for (const mia of mias) {
    if (mia.valor < corte) continue;
    for (let k = 1; k < MUESTRAS; k++) suyas.forEach((suya, i) => probar(estado, lado, mia.accion, suya.accion, k, mia.pruebas[i]));
    mia.valor = valorDe(mia, suyas);
  }
  mias.sort((a, b) => b.valor - a.valor);
  const mejores = mias.slice(0, 3);
  const media = mejores.reduce((total, o) => total + o.valor, 0) / mejores.length;
  const ctx = contexto(estado, s, suyas[0], atascado);
  return {
    accion: mias[0].accion,
    jugada: {
      elige: texto(estado, lado, mias[0].accion),
      porque: porque(ctx, mias[0]),
      opciones: mejores.map((o, i) => [texto(estado, lado, o.accion), nota(o.valor - antes, o.valor - media), motivo(ctx, o, i === 0)]),
    },
  };
}

// ---------------------------------------------------------------------------
// Explicar la jugada. Cada frase sale de un dato calculado: si el dato no está, la frase no se escribe.
// Los textos no dicen «el rival»: valen igual para la jugada de «yo» que para la de la IA rival.

const unica = (elige, razon) => ({ elige, porque: razon, opciones: [[elige, 50, "No other option"]] });

/** El nombre con el que se cita a un Pokémon: si su especie está en los dos equipos, «tu X» o «X rival». */
function apodo(e, p) {
  if (!e.lados[otro(p.lado)].equipo.some((q) => q.nombre === p.nombre)) return p.nombre;
  return p.lado === "yo" ? `your ${p.nombre}` : `opposing ${p.nombre}`;
}

// Fin de frase: «. » salvo en la abreviatura «Sp.» de Sp. Atk y Sp. Def
const FIN_DE_FRASE = /(?<!(?:^|\s)Sp)\. /;

/** La primera frase de un texto, sin el punto final: no se parte en «Sp. Def». */
export const primeraFrase = (texto) => String(texto).split(FIN_DE_FRASE)[0].replace(/\.$/, "");

/** true si el texto tiene más de una frase. */
const variasFrases = (texto) => FIN_DE_FRASE.test(texto);

/** Pone la mayúscula a los «your X» y «opposing X» que han quedado al empezar una frase. */
const pulir = (frase) => frase.replace(/(^|\. )(your|opposing) /g, (todo, antes, palabra) => `${antes}${palabra[0].toUpperCase()}${palabra.slice(1)} `);

/** El texto de una acción: «Ice Spinner», «Switch to Gholdengo», «Tera Normal + Extreme Speed». */
function texto(e, lado, accion) {
  if (accion.tipo === "cambio") return `Switch to ${e.lados[lado].equipo[accion.a].nombre}`;
  const n = mov(accion.id).n;
  return accion.tera ? `Tera ${nombreTipo(enCampo(e, lado).ficha.tera)} + ${n}` : n;
}

/** El movimiento en el que está bloqueado un Pokémon por su objeto Elección, o null. */
const bloqueo = (p) => (ELECCION.includes(p.objeto) && p.v.bloqueo ? mov(p.v.bloqueo) : null);

function sinAlternativa(e, s, o) {
  const yo = apodo(e, s.yo);
  if (o.accion.tipo === "cambio") return `${yo} cannot use any moves: forced to switch.`;
  if (s.yo.v.recarga) return `${yo} must recharge after ${o.m.n}.`;
  if (s.yo.v.carga || s.yo.v.encerrado) return `${yo} already started ${o.m.n} and must finish it.`;
  if (bloqueo(s.yo)) return `${yo} is locked into ${o.m.n} by ${nombreObjeto(s.yo.objeto)} and has no teammates left on the bench.`;
  if (o.accion.id === "struggle") return `${yo} has no moves left to use.`;
  return `${yo} cannot do anything else this turn.`;
}

/** Lo que se espera del contrario (su respuesta con más peso), con los datos que hacen falta para contarlo. */
function contexto(e, s, prevista, atascado) {
  const suMov = prevista.accion.tipo === "mov" ? prevista.m : null;
  return {
    e, s, atascado,
    yo: apodo(e, s.yo),
    el: apodo(e, s.el),
    suMov,
    suDano: suMov && prevista.d?.max > 0 ? prevista.d : null,              // lo que le quita a quien está en campo
    suTera: Boolean(prevista.accion.tera),
    suEntra: prevista.accion.tipo === "cambio" ? prevista.entra : null,
    suBloqueo: bloqueo(s.el),
  };
}

/** Lo que pasa en la prueba de una opción contra la respuesta prevista. */
function leer(ctx, o) {
  const { lado, yo } = ctx.s;
  const { eventos, copia } = o.pruebas[0];
  const mio = eventos.findIndex((x) => x.t === "mov" && x.lado === lado);
  const suyo = eventos.findIndex((x) => x.t === "mov" && x.lado !== lado);
  const caigo = eventos.some((x) => x.t === "ko" && x.lado === lado && x.p === yo.nombre);
  return { mio: eventos[mio], suyo: eventos[suyo], antes: mio >= 0 && (suyo < 0 || mio < suyo), sinActuar: mio < 0 && caigo, copia };
}

/** Lo que le quita a quien entraría (índice «a») el movimiento que se espera del contrario. */
function golpeAlQueEntra(ctx, a) {
  const { e, s } = ctx;
  return comoSi(e, s.lado, a, () => calcularDano(e, otro(s.lado), ctx.suMov.id, { tera: ctx.suTera }));
}

/**
 * El objeto o la habilidad que cambia la cuenta de un ataque: se repite el cálculo sin cada uno y, si el
 * daño cambia en un 18% o más, se cuenta el que más pesa. Devuelve la frase o "".
 */
function loQueCambiaLaCuenta(ctx, o) {
  const { e, s } = ctx;
  let mayor = null;
  for (const [p, campo] of [[s.yo, "objeto"], [s.yo, "habilidad"], [s.el, "objeto"], [s.el, "habilidad"]]) {
    if (!p[campo]) continue;
    const copia = clonar(e);
    enCampo(copia, p.lado)[campo] = null;
    const sin = calcularDano(copia, s.lado, o.m.id, { tera: o.accion.tera });
    const peso = sin.media > 0 && o.d.media > 0 ? Math.abs(Math.log(o.d.media / sin.media)) : sin.media !== o.d.media ? 9 : 0;
    if (peso >= Math.log(1.18) && (!mayor || peso > mayor.peso)) mayor = { p, campo, sin, peso };
  }
  if (!mayor) return "";
  const { p, campo, sin } = mayor;
  const nombre = campo === "objeto" ? nombreObjeto(p.objeto) : nombreHabilidad(p.habilidad);
  if (p === s.yo) {
    if (sin.max <= 0) return `Without ${nombre}, it wouldn't affect it.`;
    return sin.media < o.d.media ? `Without ${nombre}, it would deal ${entre(sin)}.` : "";
  }
  if (o.d.max <= 0 || sin.media <= o.d.media) return "";
  return `${ctx.el}'s ${nombre} weakens it: without ${campo === "objeto" ? "that item" : "that ability"} it would deal ${entre(sin)}.`;
}

/** La segunda frase de un ataque: lo primero que haya que contar del turno. */
function contextoDeAtaque(ctx, o, v) {
  const { e, s, yo, el } = ctx;
  const opcion = { tera: o.accion.tera };
  if (ctx.suEntra) {
    // El golpe se lo lleva quien entra: la misma cuenta, con él en el campo
    const r = comoSi(e, otro(s.lado), ctx.suEntra.indice, () => calcularDano(e, s.lado, o.m.id, opcion));
    const entra = apodo(e, ctx.suEntra);
    return r.max > 0
      ? `${el} is expected to switch out for ${entra}, which would take the hit: ${entre(r)}.`
      : `${el} is expected to switch out for ${entra}, which is immune to it.`;
  }
  if (ctx.suTera && o.d.max > 0) {
    const r = conTera(s.el, () => calcularDano(e, s.lado, o.m.id, opcion));
    if (Math.abs(r.media - o.d.media) >= 0.15 * o.d.media) {
      return `If ${el} Terastallizes into ${nombreTipo(s.el.ficha.tera)} as expected, ${r.max > 0 ? `it deals ${entre(r)}` : "it doesn't affect it"}.`;
    }
  }
  if (v.antes && v.mio?.da && o.m.prioridad > 0 && !s.antes) return `Has priority: moves first even though ${el} is faster.`;
  if (v.antes && v.mio?.da && o.d.min >= s.psEl && (o.m.precision ?? 100) >= 100) return `${yo} attacks first, so ${el} doesn't get to move.`;
  const cuenta = loQueCambiaLaCuenta(ctx, o);
  if (cuenta) return cuenta;
  if (ctx.suBloqueo) return `${el} is locked into ${ctx.suBloqueo.n} by ${nombreObjeto(s.el.objeto)}.`;
  if (ctx.suDano && v.suyo?.da && v.mio) {
    const aguanta = ctx.suDano.max < s.psYo ? `: ${yo} survives it` : "";
    return v.antes
      ? `${yo} attacks before ${el} uses ${ctx.suMov.n}, which ${leHace(ctx.suDano, s.psYo)}.`
      : `${el} attacks first with ${ctx.suMov.n}, which ${leHace(ctx.suDano, s.psYo)}${aguanta}.`;
  }
  if (o.m.precision !== null && o.m.precision < 100) return `Has ${o.m.precision}% accuracy.`;
  if (ctx.suMov && !ctx.suDano) return `${el} is expected to use ${ctx.suMov.n}, which deals no damage.`;
  return "";
}

/** La frase de la teracristalización que evita un KO, o "". */
function fraseDeTera(ctx, o) {
  if (!o.tera?.evita) return "";
  return `Without Terastallizing, ${ctx.el}'s ${o.tera.evita.n} can KO ${ctx.yo}; with Tera ${nombreTipo(ctx.s.yo.ficha.tera)}, the most ${ctx.el} deals is ${Math.round(o.tera.evita.max)}%.`;
}

function porqueDeAtaque(ctx, o) {
  const { s, el } = ctx;
  const n = o.m.n;
  const d = o.d;
  const queda = Math.max(1, Math.round(s.psEl));
  const minimo = d.min >= 100 ? "over 100%" : `at least ${Math.round(d.min)}%`;
  const frases = [];
  if (o.tera?.asegura) {
    frases.push(`With Tera ${nombreTipo(s.yo.ficha.tera)}, ${n} goes from dealing ${entre(o.tera.asegura)} to ${minimo}: KOs ${el}, currently at ${queda}% HP.`);
  } else {
    frases.push(fraseDeTera(ctx, o));
    if (d.max <= 0) frases.push(ctx.suEntra ? `${n} doesn't affect ${el}.` : `${n} doesn't affect ${el}, but it's the best play this turn.`);
    else if (d.min >= s.psEl) frases.push(`${n} KOs ${el}, currently at ${queda}% HP: the hit deals ${minimo}.`);
    else if (d.max >= s.psEl) frases.push(`${n} can KO ${el}, currently at ${queda}% HP: deals ${entre(d)}.`);
    else if (d.ef > 1) frases.push(`${n} hits ${el} super effectively (${etiqueta(d.ef)}) and deals ${entre(d)}.`);
    else if (d.ef < 1) frases.push(`${el} resists ${n} (${etiqueta(d.ef)}), which still deals ${entre(d)}.`);
    else frases.push(`${n} deals ${entre(d)} to ${el}.`);
  }
  if (ctx.atascado) frases.push(`${ctx.atascado}: time to attack to break the stalemate.`);
  if (frases.filter(Boolean).length < 2) frases.push(contextoDeAtaque(ctx, o, leer(ctx, o)));
  return frases.filter(Boolean).slice(0, 2).join(" ");
}

/** Lo que se espera del contrario este turno, contado desde quien usa un movimiento de estado. */
function loQueViene(ctx) {
  const { e, s, yo, el } = ctx;
  if (ctx.suEntra) return `${el} is expected to switch out for ${apodo(e, ctx.suEntra)}, so ${yo} takes no hits this turn.`;
  if (ctx.suDano) return `${el}'s ${ctx.suMov.n} ${leHace(ctx.suDano, s.psYo)}${ctx.suDano.max < s.psYo ? ` and ${yo} survives it` : ""}.`;
  if (ctx.suMov) return `${el} is expected to use ${ctx.suMov.n}, which deals no damage.`;
  return "";
}

function porqueDeEstado(ctx, o) {
  const { e, s, yo, el } = ctx;
  const m = o.m;
  const v = leer(ctx, o);
  let primera;
  if (CAPAS[m.bando]) {
    const quedan = banco(e, otro(s.lado)).length;
    primera = `${m.n} sets entry hazards on the opposing side, hurting every Pokémon that switches in${quedan ? ` (${quedan} left on their bench)` : ""}.`;
  } else if (m.objetivo === "propio" && m.cambios) {
    const suben = Object.keys(m.cambios).filter((clave) => m.cambios[clave] > 0).map((clave) => CARACTERISTICA[clave]).filter(Boolean);
    primera = suben.length ? `${m.n} boosts ${yo}'s ${enumerar(suben)}.` : "";
  } else if (m.cura) {
    const parte = Math.round((100 * m.cura[0]) / m.cura[1]);
    primera = `${yo} is at ${Math.round(s.psYo)}% HP and ${m.n} restores up to ${parte === 50 ? "half its HP" : `${parte}% HP`}.`;
  } else if (m.estado && SUFRE[m.estado] && puedeSufrir(s.el, m.estado)) {
    primera = `${m.n} leaves ${el} ${SUFRE[m.estado]}.`;
    if (m.estado === "brn" && s.golpe?.m.clase === "Físico") primera += ` Its best attack, ${s.golpe.n}, is physical: the burn halves its damage.`;
    else if (m.estado === "par" && !s.antes && s.puntos !== 0) primera += ` ${el} is faster, and paralysis halves its Speed.`;
  }
  // Lo que no tiene plantilla se cuenta con lo que hace en la prueba
  if (!primera) primera = v.mio?.txt && v.mio.txt !== "Fails" && v.mio.txt !== "Missed" ? `${m.n}: ${v.mio.txt.replace(/[.!]$/, "")}.` : `${m.n} is the option that leaves the best position this turn.`;
  const tera = fraseDeTera(ctx, o);
  if (tera) return `${tera} ${primeraFrase(primera)}.`;
  return variasFrases(primera) ? primera : [primera, loQueViene(ctx)].filter(Boolean).join(" ");
}

function porqueDeCambio(ctx, o) {
  const { e, s, yo, el } = ctx;
  const entra = apodo(e, o.entra);
  // Con qué amenaza quien entra al Pokémon que tendrá delante
  const delante = ctx.suEntra ?? s.el;
  const suGolpe = comoSi(e, s.lado, o.accion.a, () => comoSi(e, otro(s.lado), delante.indice, () => golpes(e, s.lado)[0]));
  const amenaza = suGolpe?.max > 0 ? `threatens ${apodo(e, delante)} with ${suGolpe.n} (${rango(suGolpe)})` : "";
  if (ctx.suDano) {
    const n = ctx.suMov.n;
    const sujeto = ctx.suBloqueo?.id === ctx.suMov.id ? `${el} is locked into ${n}, which` : `${el}'s ${n}`;
    const aQuienSeVa = ctx.suDano.min >= s.psYo ? `KOs ${yo}` : ctx.suDano.max >= s.psYo ? `can KO ${yo}` : `deals ${entre(ctx.suDano)} to ${yo}`;
    const r = golpeAlQueEntra(ctx, o.accion.a);
    // Entrar para caer: se sacrifica a quien menos PS le quedan para que el otro siga en pie
    if (r.max + entrada(e, o.entra) >= psDe(o.entra)) return `${sujeto} ${aQuienSeVa}. ${entra} (${Math.max(1, Math.round(psDe(o.entra)))}% HP) switches in to take the hit instead.`;
    const encaja = r.ef === 0 || r.max <= 0 ? "is immune" : r.ef < 1 ? `resists it (${etiqueta(r.ef)}), taking ${entre(r)}` : `takes it better, taking ${entre(r)}`;
    return `${sujeto} ${aQuienSeVa}. ${entra} ${encaja}${amenaza ? ` and ${amenaza}` : ""}.`;
  }
  if (ctx.suEntra) return `${el} is expected to switch out for ${apodo(e, delante)}. ${amenaza ? `${entra} ${amenaza}` : `${entra} switches in without taking a hit`}.`;
  const primera = s.puntos < 0 ? `${yo} loses the 1v1 against ${el}.`
    : !(s.mios[0]?.max > 0) ? `${yo} cannot damage ${el}.`
    : s.mios[0].max < 35 ? `The most ${yo} can deal to ${el} is ${entre(s.mios[0])}.` : "";
  const gratis = ctx.suMov ? `${el} is expected to use ${ctx.suMov.n}, which deals no damage: ${entra} switches in for free` : "";
  const segunda = gratis ? `${gratis}${amenaza ? ` and ${amenaza}` : ""}.` : amenaza ? `${entra} ${amenaza}.` : "";
  return [primera, segunda].filter(Boolean).join(" ") || `${entra} has a better matchup against ${el} than ${yo}.`;
}

function porque(ctx, o) {
  if (o.accion.tipo === "cambio") return pulir(porqueDeCambio(ctx, o));
  return pulir(o.m.clase === "Estado" ? porqueDeEstado(ctx, o) : porqueDeAtaque(ctx, o));
}

/** El motivo corto de una de las tres mejores opciones. */
function motivo(ctx, o, elegida) {
  const { s, yo, el } = ctx;
  const v = leer(ctx, o);
  if (o.accion.tipo === "cambio") {
    const a = o.accion.a;
    const guardado = o.guardado && !elegida ? `, but is saved for ${o.guardado}` : "";
    if (ctx.suDano) {
      const r = golpeAlQueEntra(ctx, a);
      const n = ctx.suMov.n;
      if (r.ef === 0 || r.max <= 0) return `Immune to ${n}${guardado}`;
      if (r.max >= psDe(o.entra)) return `${n} can KO it on switch-in`;
      return `${r.ef < 1 ? `Resists ${n} (${etiqueta(r.ef)})` : `Takes ${n}`}: ${rango(r)}${guardado}`;
    }
    const pierde = Math.round(psDe(o.entra) - psDe(v.copia.lados[s.lado].equipo[a]));
    return pierde > 0 ? `Switches in and loses ${pierde}%` : "Switches in taking no damage";
  }
  if (v.sinActuar) return pulir(`${yo} faints before ${o.m.clase === "Estado" ? "using it" : "attacking"}`);
  if (o.m.clase === "Estado") {
    // Lo que hace en la prueba: los PS que recupera o el texto de su evento
    const da = v.mio?.da;
    if (da && da[3] > da[2]) return `Restores ${da[3] - da[2]}% HP`;
    const txt = v.mio?.txt ?? "";
    if (!txt) return "No immediate effect this turn";
    if (txt === "Missed") return "Could miss";
    return txt === "Fails" ? "Would have no effect" : primeraFrase(txt);
  }
  const d = o.d;
  const x = d.ef > 0 && d.ef !== 1 ? ` (${etiqueta(d.ef)})` : "";
  if (d.ef === 0 || d.max <= 0) return `Doesn't affect ${el}`;
  if (v.mio?.txt === "Fails" && SI_EL_RIVAL_ATACA.includes(o.m.id)) return `Fails if ${el} doesn't attack`;
  if (SOLO_AL_ENTRAR.includes(o.m.id) && s.yo.v.actuo) return "Only works on first turn out";
  if (ctx.suEntra) return `${rango(d)} to ${el} if it stays in${x}`;
  const preciso = (o.m.precision ?? 100) >= 100;
  if (ctx.suTera && d.max >= s.psEl && conTera(s.el, () => calcularDano(ctx.e, s.lado, o.m.id, { tera: o.accion.tera })).max < s.psEl) return `KOs ${el} if it doesn't Terastallize${x}`;
  if (d.min >= s.psEl) return preciso ? `Guaranteed KO on ${el}${x}` : `KOs ${el} if it hits (${o.m.precision}%)${x}`;
  if (d.max >= s.psEl) return `Likely KO on ${el}: ${rango(d)}${x}`;
  return `${rango(d)} to ${el}${x}`;
}
