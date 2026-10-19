// Puerta de entrada del simulador de combates: es lo único que importan las pantallas.
// El contrato está en disenos/implementacion/CONTRATO-SIMULADOR.md.
// simular() juega el combate de verdad con el motor (./motor.js) y la IA (./ia.js), que se cargan la
// primera vez que hacen falta. Con «?ejemplo» en la dirección se devuelve el combate de ejemplo, sin guardarlo en ningún sitio.
// En BSS y VGC la IA elige antes quién juega (3 o 4 de 6, ./seleccion.js): el combate, la previsión y los 100
// combates se juegan con esa selección; en Gen 9 OU juegan los 6.
import { dic, formatoActual, infoMeta, repartoValido, nombreHabilidad, nombreMovimiento, nombreObjeto } from "../meta.js";
import { leer } from "../estado.js";
import { cupoDe } from "./cupo.js";

const CLAVE = "apex-dex-simulador";
const OPCIONES = { velocidad: 1, verIA: true, combates: 1 };
const TURNOS_MAXIMOS = 200;          // un combate que no acaba antes se da por atascado
const COMBATES_DE_PREVISION = 20;
const RESPIRO = 12;                  // ms seguidos de cálculo antes de dejar respirar a la pantalla
export const TOTAL_SERIE = 100;      // con la opción «100 combates»: el que se ve y 99 más

// Con qué formato, equipo y rival se jugó el combate guardado (ver huellaActual)
let combateGuardado = null;
let huellaDelCombate = null;

/**
 * Lo que se está simulando: { yo, rival, opciones, combate }. «yo» y «rival» son equipos de la app
 * ({ nombre, origen, miembros }; los propios llevan además id y formato). Se guarda en sessionStorage:
 * dura lo que dura la pestaña.
 *
 * «combate» solo se lee si sigue valiendo: se invalida solo cuando cambia el formato, el equipo o el rival,
 * o cuando el equipo se edita o se borra en Equipos. Sin combate válido vale null, y las pantallas que lo
 * necesitan vuelven a #/simulador. El combate lleva `formato` (id), `formatoNombre` y `equipoId`.
 */
export const sesion = recuperar();

function recuperar() {
  let guardada = null;
  try {
    guardada = JSON.parse(sessionStorage.getItem(CLAVE));
  } catch {
    // sin sessionStorage (o con algo ilegible) se empieza una sesión nueva
  }
  const { cinematicas, ...opciones } = guardada?.opciones ?? {}; // ya no hay cinemáticas: se descarta lo que dejó una sesión anterior
  combateGuardado = guardada?.combate ?? null;
  huellaDelCombate = guardada?.huella ?? null;
  return {
    yo: guardada?.yo ?? null,
    rival: guardada?.rival ?? null,
    opciones: { ...OPCIONES, ...opciones },
    get combate() {
      if (combateGuardado && huellaDelCombate !== huellaActual()) {
        combateGuardado = null;
        huellaDelCombate = null;
        recordar();
      }
      return combateGuardado;
    },
    set combate(valor) {
      combateGuardado = valor ?? null;
      huellaDelCombate = valor ? huellaActual() : null;
      recordar();
    },
  };
}

function recordar() {
  try {
    // Se escribe a mano: JSON.stringify(sesion) pasaría por el getter de «combate»
    const { yo, rival, opciones } = sesion;
    sessionStorage.setItem(CLAVE, JSON.stringify({ yo, rival, opciones, combate: combateGuardado, huella: huellaDelCombate }));
  } catch {
    // sin sitio o sin permiso: la sesión sigue en memoria hasta que se recargue la página
  }
}

/**
 * El formato en el que se juega con un equipo: el suyo (S4) o, si no lo trae o ya no existe, el elegido en la app.
 * Devuelve el id.
 */
export function formatoDe(equipo) {
  return infoMeta().formatos.some((f) => f.id === equipo?.formato) ? equipo.formato : formatoActual();
}

/**
 * Lo que tiene que seguir igual para que el combate guardado valga: el formato, y el equipo y el rival tal como
 * están ahora (un equipo tuyo se mira en Equipos, no en su copia de la sesión). null si alguno ya no existe.
 */
function huellaActual() {
  const yo = vivo(sesion.yo);
  const rival = vivo(sesion.rival);
  if (!yo || !rival) return null;
  return `${formatoDe(yo)}|${firma(yo)}|${rival.clave ?? ""}|${firma(rival)}`;
}

/** Un equipo tuyo tal como está ahora en Equipos (null si se ha borrado); uno que no es tuyo, tal cual. */
function vivo(equipo) {
  if (!equipo?.id) return equipo;
  const guardado = leer().equipos.find((e) => e.id === equipo.id);
  return guardado ? { ...equipo, nombre: guardado.nombre, formato: guardado.formato ?? null, miembros: guardado.miembros } : null;
}

/** Mezcla cambios en la sesión y la guarda: elegir({ rival }) o elegir({ opciones: { velocidad: 2 } }). */
export function elegir(cambios) {
  const { opciones, ...resto } = cambios;
  Object.assign(sesion, resto);
  if (opciones) sesion.opciones = { ...sesion.opciones, ...opciones };
  recordar();
  return sesion;
}

/** true si la dirección lleva «?ejemplo»: entonces todo sale del combate de ejemplo. */
const esEjemplo = () => typeof location !== "undefined" && /[?&]ejemplo(?:[=&]|$)/.test(location.hash);

/**
 * Juega el combate de sesion.yo contra sesion.rival con el formato del equipo, lo deja en sesion.combate y lo
 * devuelve. Con «?ejemplo» devuelve el combate de ejemplo sin tocar la sesión. Si algún Pokémon no existe o no
 * tiene movimientos, no juega y el error dice cuál.
 */
export async function simular() {
  if (esEjemplo()) return combateDeEjemplo();
  // Se juega con los equipos tal como están ahora: si uno tuyo se ha editado desde que se eligió, cuenta la edición
  const yo = vivo(sesion.yo);
  const rival = vivo(sesion.rival);
  if (sesion.yo && !yo) throw new Error("Your team no longer exists: pick another one in the simulator.");
  if (sesion.rival && !rival) throw new Error("The opposing team no longer exists: pick another opponent.");
  if (!yo?.miembros?.length || !rival?.miembros?.length) throw new Error("Your team or the opponent's team is missing.");
  const formato = formatoDe(yo);
  const problemas = revisarEquipos(yo, rival, formato);
  if (problemas.length) throw new Error(problemas.map((p) => p.texto).join(" "));
  if (!disponible(formato)) throw new Error("The simulator does not know this team's format.");
  const huella = huellaActual(); // la de ahora: si algo cambia mientras se juega, el combate nace ya invalidado
  // La previsión suele estar ya calculada (la pide la pantalla de preparar): es el punto de partida de la curva
  const prob = await prevision(yo, rival, formato);
  const combate = await jugar(yo, rival, { formato, prob });
  combateGuardado = combate;
  huellaDelCombate = huella;
  recordar();
  seguirSerie(combate); // con «100 combates», los otros 99 se juegan ya, mientras se ve este
  return combate;
}

/**
 * Lo que impide simular con estos dos equipos: un Pokémon que el simulador no conoce o que no tiene movimientos.
 * y, si se dice el formato (id o ficha), un reparto de EVs o puntos que ahí no existe (252 EVs en Champions).
 * Cada problema es { lado: "yo" | "rival", pokemon, texto }. Sin problemas, [].
 */
export function revisarEquipos(yo, rival, formato) {
  const ficha = formato ? fichaDe(formato) : null;
  const especies = dic()?.especies;
  if (!especies) return []; // sin diccionario no se puede juzgar
  const problemas = [];
  for (const [lado, equipo, quien] of [["yo", yo, "Your team"], ["rival", rival, "The opponent"]]) {
    for (const miembro of equipo?.miembros ?? []) {
      const nombre = String(miembro?.especie ?? "");
      if (!especies[nombre]) problemas.push({ lado, pokemon: nombre, texto: `${quien}: "${nombre}" is not a Pokémon the simulator knows.` });
      else if (!miembro.movimientos?.some(Boolean)) problemas.push({ lado, pokemon: nombre, texto: `${quien}: ${nombre} has no moves.` });
      else if (ficha && Array.isArray(miembro.valores) && !repartoValido(miembro.valores, ficha)) {
        problemas.push({ lado, pokemon: nombre, texto: `${quien}: ${nombre}'s stat spread is not valid in ${ficha.nombre}.` });
      }
    }
  }
  return problemas;
}

/**
 * Probabilidad de victoria de «yo» contra «rival», de 0 a 100, o null si no se puede calcular. Sale de
 * 20 combates rápidos (la IA decide «a ojo», sin probar jugadas): es una estimación, no un resultado.
 * Cada pareja de equipos se calcula una vez. «formato» es el id del formato; si no se pasa, el del equipo «yo».
 */
export async function prevision(yo, rival, formato) {
  try {
    if (esEjemplo()) return (await combateDeEjemplo()).previa?.prob ?? null;
    formato ??= formatoDe(yo);
    if (!yo?.miembros?.length || !rival?.miembros?.length || !disponible(formato)) return null;
    const clave = `${formato}|${firma(yo)}|${firma(rival)}`;
    if (!previsiones.has(clave)) previsiones.set(clave, prever(yo, rival, formato, clave));
    return await previsiones.get(clave);
  } catch {
    return null;
  }
}

const fichaDe = (formato) => (typeof formato === "string" ? infoMeta().formatos.find((f) => f.id === formato) : formato);

/** Cuántos Pokémon juega cada lado en un formato (su id o su ficha): 3 en BSS, 4 en VGC y 6 en el resto. */
export const cuantosJuegan = (formato) => cupoDe(fichaDe(formato) ?? formato);

/**
 * true si el simulador vale para ese formato (su id o su ficha de meta.json): vale para todos los de la app.
 * Los de Pokémon Champions se juegan con sus reglas (nivel 50, puntos de estadística, sin IVs ni tera, con
 * Megaevolución); los de dobles, como combate individual (ver comoIndividual).
 */
export function disponible(formato) {
  return Boolean(fichaDe(formato));
}

/** true si el formato no es de individuales: el motor es de uno contra uno y lo simula como combate individual. */
export function comoIndividual(formato) {
  const ficha = fichaDe(formato);
  return Boolean(ficha) && !/^(individual|singles)$/i.test(ficha.modo);
}

/** Lo que dicen las pantallas cuando un formato de dobles se simula como individual. */
export const AVISO_INDIVIDUAL = "Simulated as a singles battle";

// ---------------------------------------------------------------------------
// El combate de verdad

// El motor, sus datos, la IA y el resumen se piden una sola vez, cuando hace falta jugar
let piezas;
function cargarSimulador() {
  piezas ??= Promise.all([import("./datos.js"), import("./motor.js"), import("./ia.js"), import("./resumen.js"), import("./seleccion.js")])
    .then(([datos, motor, ia, resumen, seleccion]) => ({ datos, motor, ia, resumen, seleccion }))
    .catch((error) => {
      piezas = undefined; // la próxima vez se vuelve a intentar
      throw error;
    });
  return piezas;
}

const respiro = () => new Promise((seguir) => setTimeout(seguir));
const nuevaSemilla = () => Math.floor(Math.random() * 4294967296);
const enPie = (estado, lado) => estado.lados[lado].equipo.filter((p) => !p.caido).length;

// Lo que la IA ha elegido para cada pareja de equipos: siempre sale lo mismo, así que se calcula una vez
const selecciones = new Map();

/** Quién juega con estos equipos: null si el formato juega los 6, o { yo, rival } con { miembros, seleccion } de cada lado. */
function quienJuega({ seleccion }, yo, rival, datosDelFormato, formato) {
  const clave = `${formato}|${firma(yo)}|${firma(rival)}`;
  if (!selecciones.has(clave)) selecciones.set(clave, seleccion.seleccionar(yo, rival, datosDelFormato));
  return selecciones.get(clave);
}

/**
 * Los Pokémon de un lado como los pide el contrato: nombres en español, tipos en inglés y el id de las imágenes.
 * Una forma Mega que sale con su forma base lleva además «antes»: { nombre, id, tipos } de esa forma, la que
 * se ve en el campo hasta el evento de su megapiedra con «mega: true».
 */
function luchadores(estado, lado) {
  return estado.lados[lado].equipo.map((p) => {
    const { mega } = p.ficha;
    return {
      nombre: p.nombre,
      id: mega?.id ?? p.ficha.id,
      tipos: mega?.tipos ?? p.ficha.tipos,
      habilidad: p.ficha.habilidad ? nombreHabilidad(p.ficha.habilidad) : null,
      objeto: p.ficha.objeto ? nombreObjeto(p.ficha.objeto) : null,
      tera: p.ficha.tera,
      movimientos: p.ficha.movimientos.map(nombreMovimiento),
      ...(mega ? { antes: { nombre: p.ficha.base, id: p.ficha.id, tipos: p.ficha.tipos } } : {}),
    };
  });
}

/**
 * Lo que añade a un lado la selección de la IA: { seleccion, completo }. «equipo» del combate lleva solo a los que
 * juegan (con el primero en cabeza); «completo», los seis, para enseñar también a los que se quedan en el banco.
 * Sin selección (Gen 9 OU), nada.
 */
function elegidos(motor, juegan, lado, yo, rival, datosDelFormato) {
  if (!juegan) return {};
  const entero = motor.crearCombate(yo, rival, { formato: datosDelFormato, sinSalir: true });
  return { seleccion: juegan[lado].seleccion, completo: luchadores(entero, lado) };
}

/**
 * Juega un combate entero entre dos equipos de la app y lo devuelve con la forma del contrato: la IA
 * elige por los dos lados, el motor resuelve cada turno y al final se montan la curva y el resumen.
 * «formato» es el id del formato (por defecto, el del equipo «yo»); «semilla», la del azar del combate;
 * «prob», la previsión con la que empieza la curva (sin ella, la que da la IA antes del primer turno).
 */
export async function jugar(yo, rival, { formato = formatoDe(yo), semilla = nuevaSemilla(), prob = null } = {}) {
  const piezas = await cargarSimulador();
  const { datos, motor, ia, resumen } = piezas;
  const { formato: datosDelFormato } = await datos.cargarDatos(formato);
  const juegan = quienJuega(piezas, yo, rival, datosDelFormato, formato);
  const estado = motor.crearCombate(juegan?.yo.miembros ?? yo, juegan?.rival.miembros ?? rival, { formato: datosDelFormato, semilla });
  const estaticas = [ia.probabilidad(estado)];   // la probabilidad antes de empezar y al acabar cada turno
  const combate = {
    formato,                                     // el formato y el equipo propio con los que se jugó
    formatoNombre: infoMeta().formatos.find((f) => f.id === formato)?.nombre ?? formato,
    ...(comoIndividual(formato) ? { comoIndividual: true } : {}),   // un formato de dobles jugado uno contra uno
    equipoId: yo.id ?? null,
    yo: { jugador: "You", nombre: yo.nombre ?? "Your team", equipo: luchadores(estado, "yo"), ...elegidos(motor, juegan, "yo", yo, rival, datosDelFormato) },
    rival: { jugador: "Opponent AI", nombre: rival.nombre ?? "Opposing team", origen: rival.origen ?? "", equipo: luchadores(estado, "rival"), ...elegidos(motor, juegan, "rival", yo, rival, datosDelFormato) },
    previa: resumen.previa(estado, prob ?? estaticas[0]),
    prob: [],
    turnos: [],
    resumen: null,
  };
  const trampas = [];                            // si mi lado tenía trampas al empezar cada turno
  let pausa = performance.now();
  // Cada decisión de la IA puede pasar de 12 ms en un móvil: se mira el reloj después de cada una
  const respirar = async () => {
    if (performance.now() - pausa <= RESPIRO) return;
    await respiro();
    pausa = performance.now();
  };
  while (!motor.ganador(estado)) {
    if (combate.turnos.length >= TURNOS_MAXIMOS) throw new Error(`The battle did not finish within ${TURNOS_MAXIMOS} turns.`);
    trampas.push(Object.values(estado.lados.yo.trampas).some(Boolean));
    const mia = ia.elegir(estado, "yo");
    await respirar();
    const suya = ia.elegir(estado, "rival");
    // Con la función «relevo», el turno sale entero: incluye las entradas tras un debilitado
    const eventos = motor.resolverTurno(estado, mia.accion, suya.accion, { relevo: ia.relevo });
    combate.turnos.push({
      n: combate.turnos.length + 1,
      marcador: [enPie(estado, "yo"), enPie(estado, "rival")],
      ia: { yo: mia.jugada, rival: suya.jugada },
      eventos,
    });
    estaticas.push(ia.probabilidad(estado));
    await respirar();
  }
  combate.prob = resumen.curva(estaticas, combate.previa.prob, motor.ganador(estado));
  combate.resumen = resumen.resumir(combate, estado, trampas);
  return combate;
}

// ---------------------------------------------------------------------------
// «100 combates»: los otros 99 se juegan enteros (con la IA completa, no los rápidos de la previsión), en
// segundo plano y de uno en uno, sea cual sea la pantalla que se esté viendo. Lo jugado se guarda en
// combate.cien = { ganados: [true | false], duraciones: [turnos], parado, fallo, ms }; el primero es el que
// se ve. Se para si se pide, si el combate deja de valer (otro equipo, otro rival, «Repetir») o si falla.

let serieEnMarcha = null;            // el combate cuya serie se está jugando
const oyentesDeSerie = new Set();

/** fn(combate) cada vez que la serie avanza, se para o termina. Devuelve la función que deja de escuchar. */
export function escucharSerie(fn) {
  oyentesDeSerie.add(fn);
  return () => oyentesDeSerie.delete(fn);
}

function avisarDeSerie(combate) {
  for (const fn of oyentesDeSerie) {
    try {
      fn(combate);
    } catch (error) {
      console.error(error);
    }
  }
}

/** true si la serie de ese combate se está jugando ahora mismo. */
export function serieEnCurso(combate) {
  return Boolean(combate) && serieEnMarcha === combate;
}

/**
 * Juega en segundo plano los combates que le faltan a la serie de «combate» (por defecto, el de la sesión).
 * Sin la opción «100 combates» y sin serie empezada no hace nada; una serie que se paró a mano solo sigue
 * con «aunqueParada» (el botón «Seguir»). No espera a que acabe.
 */
export function seguirSerie(combate = sesion.combate, aunqueParada = false) {
  if (!combate?.resumen || esEjemplo() || combate !== combateGuardado) return;
  if (!combate.cien) {
    if (sesion.opciones.combates !== TOTAL_SERIE) return;
    combate.cien = { ganados: [combate.resumen.gana === "yo"], duraciones: [combate.resumen.turnos ?? combate.turnos.length], parado: false, fallo: false, ms: 0 };
  }
  if (serieEnMarcha === combate || combate.cien.ganados.length >= TOTAL_SERIE) return;
  if (combate.cien.parado && !aunqueParada) return;
  jugarSerie(combate);
}

/** Para la serie: el combate que está a medias termina y ahí se queda hasta seguirSerie(). */
export function pararSerie(combate = sesion.combate) {
  if (combate?.cien) combate.cien.parado = true;
}

async function jugarSerie(combate) {
  const cien = combate.cien;
  serieEnMarcha = combate;
  cien.parado = false;
  cien.fallo = false;
  avisarDeSerie(combate);
  const inicio = performance.now();
  const sigueValiendo = () => combateGuardado === combate && huellaDelCombate === huellaActual();
  try {
    while (cien.ganados.length < TOTAL_SERIE && !cien.parado && sigueValiendo()) {
      const otro = await jugar(vivo(sesion.yo), vivo(sesion.rival), { formato: combate.formato, prob: combate.previa?.prob ?? null });
      if (!sigueValiendo() || cien.ganados.length >= TOTAL_SERIE) break;
      cien.ganados.push(otro.resumen?.gana === "yo");
      cien.duraciones.push(otro.resumen?.turnos ?? otro.turnos.length);
      if (cien.ganados.length % 10 === 0) recordar(); // lo jugado se guarda de vez en cuando con el combate
      avisarDeSerie(combate);
    }
  } catch (error) {
    console.error(error);
    cien.fallo = true;
  }
  cien.ms += performance.now() - inicio;
  serieEnMarcha = null;
  if (combateGuardado === combate) recordar();
  avisarDeSerie(combate);
}

// ---------------------------------------------------------------------------
// La previsión

const previsiones = new Map();   // «formato|mi equipo|su equipo» → promesa con la previsión

/** Lo que distingue a un equipo de otro para el simulador. */
function firma(equipo) {
  return JSON.stringify(equipo.miembros.map((m) => [m.especie, m.objeto, m.habilidad, m.tera, m.naturaleza, m.valores, m.movimientos]));
}

/**
 * Juega los combates rápidos y devuelve el porcentaje de victorias. Las semillas salen de los equipos:
 * la misma pareja da siempre la misma previsión. Con solo 20 combates, ganarlos todos no es un 100 %:
 * se cuenta como si hubiera uno más ganado y otro perdido, y así la previsión se queda entre 5 y 95.
 */
async function prever(yo, rival, formato, clave) {
  try {
    const piezas = await cargarSimulador();
    const { datos, motor, ia } = piezas;
    const { formato: datosDelFormato } = await datos.cargarDatos(formato);
    if (revisarEquipos(yo, rival, formato).length) throw new Error("Some Pokémon are unknown to the simulator or have no moves.");
    const juegan = quienJuega(piezas, yo, rival, datosDelFormato, formato);   // la misma selección que el combate de verdad
    let ganados = 0;
    let pausa = performance.now();
    for (let n = 1; n <= COMBATES_DE_PREVISION; n++) {
      const estado = motor.crearCombate(juegan?.yo.miembros ?? yo, juegan?.rival.miembros ?? rival, { formato: datosDelFormato, semilla: `${clave}|${n}` });
      for (let turno = 0; turno < TURNOS_MAXIMOS && !motor.ganador(estado); turno++) {
        const mia = ia.elegir(estado, "yo", { rapida: true });
        const suya = ia.elegir(estado, "rival", { rapida: true });
        motor.resolverTurno(estado, mia.accion, suya.accion, { relevo: ia.relevo });
      }
      // Un combate atascado se lo lleva quien va por delante
      if (motor.ganador(estado) ? motor.ganador(estado) === "yo" : ia.probabilidad(estado) >= 50) ganados++;
      if (performance.now() - pausa > RESPIRO) {
        await respiro();
        pausa = performance.now();
      }
    }
    return Math.round((100 * (ganados + 1)) / (COMBATES_DE_PREVISION + 2));
  } catch (error) {
    previsiones.delete(clave); // la próxima vez se vuelve a intentar
    throw error;
  }
}

// ---------------------------------------------------------------------------
// El combate de ejemplo (datos/sim-ejemplo.json): se pide una sola vez

let ejemplo;
function combateDeEjemplo() {
  ejemplo ??= fetch(new URL("../../datos/sim-ejemplo.json", import.meta.url))
    .then((respuesta) => {
      if (!respuesta.ok) throw new Error("Could not load the example battle.");
      return respuesta.json();
    })
    .catch((error) => {
      ejemplo = undefined; // la próxima vez se vuelve a intentar
      throw error;
    });
  return ejemplo;
}
