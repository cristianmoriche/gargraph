// Apex Dex · pruebas del motor del simulador de combates (js/sim/motor.js)
//
//   node herramientas/probar-sim.mjs
//
// Comprueba cálculos de daño hechos a mano, reglas sueltas, 200 combates completos jugados al azar
// entre equipos de Gen 9 OU y que la misma semilla da el mismo combate. Al final escribe lo que ha
// aparecido en esos combates y no tiene efecto programado. Termina con código 1 si algo falla.

import { validar } from "../disenos/herramientas/validar-combate.mjs";
import { especie, nombreMovimiento, setMasUsado } from "../js/meta.js";
import { cargarDatos } from "../js/sim/datos.js";
import { calcularDano, clonar, crearCombate, elegirRelevo, ganador, opciones, resolverTurno, sinEfecto } from "../js/sim/motor.js";

const COMBATES = 200;
const TURNOS_MAXIMOS = 300;
const LADOS = ["yo", "rival"];

const { formato } = await cargarDatos("gen9ou");
let fallos = 0;

function comprobar(nombre, bien, detalle = "") {
  if (!bien) fallos++;
  console.log(`  ${bien ? "bien " : "FALLA"}  ${nombre}${detalle ? ` (${detalle})` : ""}`);
}

/** El set más usado de una especie, con los cambios que pida la prueba. */
function miembro(nombre, cambios = {}) {
  const entrada = formato.porNombre.get(nombre);
  if (!entrada) throw new Error(`${nombre} no está en ${formato.nombre}`);
  return { ...setMasUsado(entrada, formato), ...cambios };
}

const combate = (yo, rival, semilla = 1) => crearCombate(yo, rival, { formato, semilla });
const mov = (id, extra = {}) => ({ tipo: "mov", id, ...extra });
const cambio = (a) => ({ tipo: "cambio", a });
const en = (estado, lado) => estado.lados[lado].equipo[estado.lados[lado].activo];

// ---------------------------------------------------------------------------
console.log("Cálculos conocidos");

{
  // 252 Atq Alegre con el Ataque a −1 (por la Intimidación) contra 252 PS y 252 Def con naturaleza que sube la Defensa
  const estado = combate(
    [miembro("Great Tusk", { objeto: null, naturaleza: "Jolly", valores: [0, 252, 4, 0, 0, 252], movimientos: ["icespinner", "headlongrush"] })],
    [miembro("Landorus-Therian", { objeto: null, habilidad: "intimidate", naturaleza: "Impish", valores: [252, 0, 252, 0, 0, 4] })]);
  const d = calcularDano(estado, "yo", "icespinner");
  comprobar("Pirueta Helada de Great Tusk a −1 contra Landorus-Therian: entre un 48 y un 57 %",
    en(estado, "yo").mods[1] === -1 && d.ef === 4 && d.min >= 46 && d.min <= 50 && d.max >= 55 && d.max <= 59, `${d.min} – ${d.max} %, x${d.ef}`);
}
{
  const estado = combate(
    [miembro("Gholdengo", { objeto: null, naturaleza: "Timid", valores: [0, 0, 0, 252, 4, 252], movimientos: ["makeitrain", "shadowball"] })],
    [miembro("Raging Bolt", { objeto: null, naturaleza: "Modest", valores: [0, 0, 0, 252, 4, 252] })]);
  const d = calcularDano(estado, "yo", "makeitrain");
  comprobar("Fiebre Dorada de Gholdengo contra Raging Bolt: entre un 28 y un 33 %",
    d.ef === 0.5 && d.min >= 26 && d.min <= 30 && d.max >= 31 && d.max <= 35, `${d.min} – ${d.max} %, x${d.ef}`);
}
{
  const yo = [miembro("Dragonite", { objeto: null, tera: "normal", naturaleza: "Adamant", valores: [0, 252, 0, 0, 4, 252], movimientos: ["extremespeed", "earthquake"] })];
  const rival = [miembro("Iron Valiant", { objeto: null, naturaleza: "Timid", valores: [0, 0, 0, 252, 4, 252], movimientos: ["calmmind", "moonblast"] })];
  const estado = combate(yo, rival);
  const d = calcularDano(estado, "yo", "extremespeed", { tera: true });
  const sinTera = calcularDano(estado, "yo", "extremespeed");
  comprobar("Velocidad Extrema de Dragonite con Tera Normal contra Iron Valiant: entre un 56 y un 66 %",
    d.min >= 54 && d.min <= 58 && d.max >= 64 && d.max <= 68 && sinTera.max < d.min && !en(estado, "yo").tera, `${d.min} – ${d.max} %; sin tera, ${sinTera.min} – ${sinTera.max} %`);
  // Y jugado de verdad: el daño del turno cae dentro de lo calculado (si no sale golpe crítico)
  const eventos = resolverTurno(estado, mov("extremespeed", { tera: true }), mov("calmmind"));
  const golpe = eventos.find((e) => e.t === "mov" && e.lado === "yo");
  const quitado = golpe.da[2] - golpe.da[3];
  comprobar("El turno jugado hace el daño calculado y saca el evento de la teracristalización",
    eventos.some((e) => e.t === "tera" && e.tipo === "normal") && (/critical/i.test(golpe.txt ?? "") || (quitado >= Math.floor(d.min) && quitado <= Math.ceil(d.max))), `${quitado} %`);
}

// ---------------------------------------------------------------------------
console.log("Reglas sueltas");

{
  // Dragonite es más lento que Iron Valiant, pero Velocidad Extrema tiene prioridad +2
  const estado = combate(
    [miembro("Dragonite", { objeto: null, naturaleza: "Adamant", valores: [252, 252, 0, 0, 4, 0], movimientos: ["extremespeed", "earthquake"] })],
    [miembro("Iron Valiant", { objeto: null, movimientos: ["moonblast", "calmmind"] })]);
  const conPrioridad = resolverTurno(clonar(estado), mov("extremespeed"), mov("moonblast")).filter((e) => e.t === "mov").map((e) => e.lado);
  const sinPrioridad = resolverTurno(clonar(estado), mov("earthquake"), mov("moonblast")).filter((e) => e.t === "mov").map((e) => e.lado);
  comprobar("La prioridad gana a la velocidad", conPrioridad[0] === "yo" && sinPrioridad[0] === "rival", `con prioridad empieza «${conPrioridad[0]}»; sin ella, «${sinPrioridad[0]}»`);
}
{
  const estado = combate(
    [miembro("Raging Bolt", { objeto: null, movimientos: ["thunderbolt", "dracometeor"] })],
    [miembro("Great Tusk", { objeto: null, movimientos: ["bulkup", "headlongrush"] })]);
  const previsto = calcularDano(estado, "yo", "thunderbolt");
  const rayo = resolverTurno(estado, mov("thunderbolt"), mov("bulkup")).find((e) => e.t === "mov" && e.lado === "yo");
  comprobar("Un tipo Tierra es inmune a Eléctrico", previsto.ef === 0 && previsto.max === 0 && rayo.ef === 0 && !rayo.da && en(estado, "rival").pct === 100, rayo.txt);
}
{
  const jugar = (objeto) => {
    const estado = combate(
      [miembro("Great Tusk", { objeto: null, movimientos: ["stealthrock", "bulkup"] })],
      [miembro("Gholdengo", { objeto: null, movimientos: ["nastyplot"] }), miembro("Dragonite", { objeto, movimientos: ["roost"] })]);
    resolverTurno(estado, mov("stealthrock"), mov("nastyplot"));
    return resolverTurno(estado, mov("bulkup"), cambio(1)).filter((e) => e.t === "rocas");
  };
  const [rocas] = jugar(null);
  comprobar("Trampa Rocas quita un 25 % a un Pokémon débil a Roca", rocas?.ef === 2 && rocas.da[2] === 100 && rocas.da[3] === 75, rocas ? `${rocas.p}: ${rocas.da[2]} → ${rocas.da[3]} %` : "sin evento");
  comprobar("Botas Gruesas lo evita", jugar("heavydutyboots").length === 0);
}
{
  const estado = combate(
    [miembro("Kyurem", { objeto: null, movimientos: ["icebeam"] })],
    [miembro("Dragonite", { objeto: null, habilidad: "multiscale" })]);
  const entero = calcularDano(estado, "yo", "icebeam");
  en(estado, "rival").ps -= 1;
  const tocado = calcularDano(estado, "yo", "icebeam");
  comprobar("Multiescamas reduce el daño a la mitad con los PS al máximo", Math.abs(tocado.max / entero.max - 2) < 0.05, `${entero.max} % con todos los PS y ${tocado.max} % sin ellos`);
}
{
  const estado = combate(
    [miembro("Great Tusk", { objeto: null })],
    [miembro("Landorus-Therian", { objeto: null, habilidad: "intimidate", movimientos: ["earthquake"] })]);
  const eventos = resolverTurno(estado, mov(en(estado, "yo").ficha.movimientos[0]), mov("earthquake"));
  const aviso = eventos.find((e) => e.t === "hab" && e.lado === "rival");
  comprobar("Intimidación baja el Ataque", en(estado, "yo").mods[1] === -1 && /Attack/.test(aviso?.txt ?? ""), aviso ? `${aviso.n}: ${aviso.txt}` : "sin evento");
}
{
  const estado = combate(
    [miembro("Dragonite", { objeto: "choiceband", movimientos: ["extremespeed", "earthquake", "outrage", "firepunch"] }), miembro("Gholdengo")],
    [miembro("Great Tusk", { objeto: null, movimientos: ["bulkup"] })]);
  const movimientos = (lado) => opciones(estado, lado).filter((o) => o.tipo === "mov" && !o.tera).map((o) => o.id);
  const antes = movimientos("yo").length;
  resolverTurno(estado, mov("earthquake"), mov("bulkup"));
  const bloqueado = movimientos("yo");
  resolverTurno(estado, cambio(1), mov("bulkup"));
  resolverTurno(estado, cambio(0), mov("bulkup"));
  comprobar("Un objeto Elección bloquea el movimiento hasta que el Pokémon se cambia",
    antes === 4 && bloqueado.length === 1 && bloqueado[0] === "earthquake" && movimientos("yo").length === 4, `antes ${antes}, después ${bloqueado.join()}, al volver ${movimientos("yo").length}`);
}
{
  const estado = combate(
    [miembro("Kingambit", { objeto: null, movimientos: ["suckerpunch", "swordsdance"] })],
    [miembro("Great Tusk", { objeto: null, movimientos: ["bulkup", "headlongrush"] })]);
  const golpe = (accionRival) => resolverTurno(clonar(estado), mov("suckerpunch"), mov(accionRival)).find((e) => e.t === "mov" && e.lado === "yo");
  const contraEstado = golpe("bulkup");
  const contraAtaque = golpe("headlongrush");
  comprobar("Golpe Bajo falla si el rival no ataca", !contraEstado.da && contraEstado.txt === "Fails" && Boolean(contraAtaque.da), `contra Corpulencia: ${contraEstado.txt}; contra un ataque quita ${contraAtaque.da?.[2] - contraAtaque.da?.[3]} %`);
}

// ---------------------------------------------------------------------------
console.log(`${COMBATES} combates completos al azar`);

// Equipos: cada núcleo del formato con los compañeros más habituales de sus miembros, y los pares de núcleos que no repiten especie
function equiposDePrueba() {
  const base = (nombre) => nombre.split("-")[0];
  const completar = (nombres) => {
    const equipo = [...nombres];
    const candidatos = nombres.flatMap((nombre) => formato.porNombre.get(nombre).companeros).sort((a, b) => b[1] - a[1]);
    for (const [nombre] of candidatos) {
      if (equipo.length === 6) break;
      if (formato.porNombre.has(nombre) && !equipo.some((otro) => base(otro) === base(nombre))) equipo.push(nombre);
    }
    return equipo;
  };
  const equipos = formato.nucleos.map((nucleo) => completar(nucleo.miembros));
  formato.nucleos.forEach((a, i) => formato.nucleos.slice(i + 1).forEach((b) => {
    if (!a.miembros.some((nombre) => b.miembros.includes(nombre))) equipos.push([...a.miembros, ...b.miembros]);
  }));
  return equipos.map((nombres) => ({ nombre: nombres.join(" / "), miembros: nombres.map((nombre) => miembro(nombre)) }));
}

// Azar de la prueba, también con semilla: así un combate que falle se puede repetir
function dado(semilla) {
  let s = semilla >>> 0;
  return (n) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return Math.floor((s / 4294967296) * n);
  };
}

/** Juega un combate entero eligiendo al azar entre las opciones legales. Devuelve el combate mínimo que pide validar(). */
function jugar(equipoYo, equipoRival, semilla) {
  const tirar = dado(semilla * 7919 + 13);
  const alAzar = (lista) => lista[tirar(lista.length)];
  const estado = crearCombate(equipoYo, equipoRival, { formato, semilla });
  // Los combates pares pasan la función «relevo»; los impares usan elegirRelevo() después de cada turno
  const conFuncion = semilla % 2 === 0;
  const relevo = (e, lado) => alAzar(opciones(e, lado).filter((o) => o.tipo === "cambio"))?.a ?? -1;
  const turnos = [];
  const avisos = [];
  while (!ganador(estado)) {
    if (turnos.length >= TURNOS_MAXIMOS) { avisos.push(`no termina en ${TURNOS_MAXIMOS} turnos`); break; }
    const elegidas = LADOS.map((lado) => alAzar(opciones(estado, lado)));
    if (elegidas.some((accion) => !accion)) { avisos.push(`turno ${turnos.length + 1}: un lado se queda sin opciones`); break; }
    const eventos = resolverTurno(estado, elegidas[0], elegidas[1], conFuncion ? { relevo } : undefined);
    while (!conFuncion && estado.pendientes.length && !ganador(estado)) {
      const lado = estado.pendientes[0];
      eventos.push(...elegirRelevo(estado, lado, alAzar(opciones(estado, lado)).a));
    }
    const enPie = LADOS.map((lado) => estado.lados[lado].equipo.filter((p) => !p.caido).length);
    turnos.push({
      n: turnos.length + 1, marcador: enPie, eventos,
      ia: { yo: { elige: "Al azar", porque: "Prueba del motor", opciones: [["Al azar", 50, "Prueba"]] }, rival: { elige: "Al azar", porque: "Prueba del motor" } },
    });
    // Los PS que se enseñan salen de los reales, y con PS reales nunca se enseña un 0 %
    for (const lado of LADOS) for (const p of estado.lados[lado].equipo) {
      const pct = p.ps <= 0 ? 0 : Math.max(1, Math.round((p.ps * 100) / p.ficha.est[0]));
      if (p.pct !== pct || p.ps < 0 || p.ps > p.ficha.est[0]) avisos.push(`turno ${turnos.length}: ${p.nombre} tiene ${p.ps} PS y se enseña al ${p.pct} %`);
    }
    if (estado.pendientes.length && !ganador(estado)) avisos.push(`turno ${turnos.length}: «${estado.pendientes.join()}» se queda sin sacar a nadie`);
  }
  const gana = ganador(estado);
  const luchadores = (lado) => estado.lados[lado].equipo.map((p) => ({
    nombre: p.nombre, id: p.ficha.id, tipos: p.ficha.tipos, habilidad: p.ficha.habilidad, objeto: p.ficha.objeto, tera: p.ficha.tera,
    movimientos: p.ficha.movimientos.map(nombreMovimiento),
  }));
  return {
    avisos,
    estado,
    combate: {
      yo: { jugador: "Prueba", nombre: equipoYo.nombre, equipo: luchadores("yo") },
      rival: { jugador: "Prueba", nombre: equipoRival.nombre, origen: "Prueba", equipo: luchadores("rival") },
      prob: [...turnos.map(() => 50), gana === "yo" ? 100 : 0],
      turnos,
      resumen: { gana, marcador: "", turnos: turnos.length, final: {}, mvp: {}, cierre: {}, rendimiento: [], momentos: [], objetos: [], habilidades: [], movimientos: [], consejos: [] },
    },
  };
}

{
  const equipos = equiposDePrueba();
  const problemas = [];
  let errores = 0;
  let largos = 0;
  let noValidos = 0;
  let turnosTotales = 0;
  let masLargo = 0;
  let eventosTotales = 0;
  const victorias = { yo: 0, rival: 0 };
  const inicio = performance.now();
  for (let n = 1; n <= COMBATES; n++) {
    const yo = equipos[n % equipos.length];
    const rival = equipos[Math.floor(n / equipos.length + n * 3) % equipos.length];
    try {
      const { combate: jugado, avisos } = jugar(yo, rival, n);
      const fallosDeContrato = jugado.resumen.gana ? validar(jugado) : [];
      if (jugado.turnos.length >= TURNOS_MAXIMOS || !jugado.resumen.gana) largos++;
      if (fallosDeContrato.length || avisos.length) {
        noValidos++;
        if (problemas.length < 12) problemas.push(`combate ${n}: ${[...avisos, ...fallosDeContrato].slice(0, 3).join(" · ")}`);
      }
      turnosTotales += jugado.turnos.length;
      masLargo = Math.max(masLargo, jugado.turnos.length);
      eventosTotales += jugado.turnos.reduce((total, turno) => total + turno.eventos.length, 0);
      if (jugado.resumen.gana) victorias[jugado.resumen.gana]++;
    } catch (error) {
      errores++;
      if (problemas.length < 12) problemas.push(`combate ${n}: ${error.stack.split("\n").slice(0, 3).join(" ")}`);
    }
  }
  const ms = performance.now() - inicio;
  comprobar("Ninguno lanza un error", errores === 0, `${errores} con error`);
  comprobar(`Todos terminan en menos de ${TURNOS_MAXIMOS} turnos`, largos === 0, `media de ${(turnosTotales / COMBATES).toFixed(1)} turnos; el más largo, ${masLargo}`);
  comprobar("Los eventos de todos pasan validar() y los PS mostrados cuadran con los reales", noValidos === 0, `${eventosTotales} eventos; gana «yo» ${victorias.yo} veces y «rival» ${victorias.rival}`);
  for (const problema of problemas) console.log(`         ${problema}`);
  console.log(`         ${equipos.length} equipos, ${(ms / COMBATES).toFixed(1)} ms por combate y ${((ms * 1000) / Math.max(1, turnosTotales)).toFixed(0)} µs por turno`);

  // -------------------------------------------------------------------------
  console.log("La misma semilla da el mismo combate");
  const uno = JSON.stringify(jugar(equipos[0], equipos[4], 2026).combate.turnos);
  const dos = JSON.stringify(jugar(equipos[0], equipos[4], 2026).combate.turnos);
  const otro = JSON.stringify(jugar(equipos[0], equipos[4], 2027).combate.turnos);
  comprobar("Dos combates con la misma semilla son iguales evento por evento", uno === dos);
  comprobar("Con otra semilla sale un combate distinto", uno !== otro);

  // Una copia es independiente: jugar sobre ella no cambia el original, y las dos siguen igual desde el mismo punto
  const original = crearCombate(equipos[1], equipos[2], { formato, semilla: 7 });
  resolverTurno(original, opciones(original, "yo")[0], opciones(original, "rival")[0], { relevo: () => -1 });
  const foto = JSON.stringify(original);
  const copia = clonar(original);
  const accionYo = opciones(copia, "yo")[0];
  const accionRival = opciones(copia, "rival")[0];
  const enLaCopia = JSON.stringify(resolverTurno(copia, accionYo, accionRival, { relevo: () => -1 }));
  comprobar("Jugar sobre una copia no cambia el original", JSON.stringify(original) === foto);
  comprobar("El original sigue igual que la copia desde el mismo punto", JSON.stringify(resolverTurno(original, accionYo, accionRival, { relevo: () => -1 })) === enLaCopia);
}

// ---------------------------------------------------------------------------
// La IA (js/sim/ia.js), el resumen (js/sim/resumen.js) y la puerta de entrada (js/sim/index.js).
// Se cargan aquí y no arriba para no tocar las pruebas del motor.
{
  const ia = await import("../js/sim/ia.js");
  const sim = await import("../js/sim/index.js");
  const COMBATES_DE_IA = 50;
  const equipos = equiposDePrueba();
  const textoDe = (jugada) => [jugada.elige, jugada.porque, ...jugada.opciones.map((o) => `${o[0]} [${o[1]}] ${o[2]}`)].join(" · ");

  console.log("La IA elige lo evidente");
  {
    // Pirueta Helada (x4) debilita a un Dragonite al 50 %; lo demás no le hace nada o le hace cosquillas
    const estado = combate(
      [miembro("Great Tusk", { movimientos: ["headlongrush", "icespinner", "rapidspin", "stealthrock"] }), miembro("Gholdengo")],
      [miembro("Dragonite", { movimientos: ["dragondance", "earthquake", "extremespeed", "roost"] }), miembro("Landorus-Therian")]);
    en(estado, "rival").ps = Math.floor(en(estado, "rival").ficha.est[0] / 2);
    const { accion, jugada } = ia.elegir(estado, "yo");
    comprobar("Usa el movimiento que debilita cuando hay uno", accion.tipo === "mov" && accion.id === "icespinner" && /KOs/.test(jugada.porque), textoDe(jugada));
  }
  {
    // Raging Bolt debilita a un Gholdengo al 50 % con cualquiera de sus dos golpes eléctricos, y Great Tusk es inmune
    const estado = combate(
      [miembro("Gholdengo", { objeto: null }), miembro("Dragonite"), miembro("Great Tusk")],
      [miembro("Raging Bolt", { movimientos: ["thunderclap", "thunderbolt", "calmmind"] }), miembro("Kingambit")]);
    en(estado, "yo").ps = Math.floor(en(estado, "yo").ficha.est[0] / 2);
    const golpe = calcularDano(estado, "rival", "thunderclap");
    const { accion, jugada } = ia.elegir(estado, "yo");
    comprobar("Cambia al inmune cuando el golpe rival la debilita", golpe.min >= 50 && accion.tipo === "cambio" && accion.a === 2 && /immune/i.test(jugada.porque), textoDe(jugada));
  }
  {
    // Contra Gholdengo, Golpe Bajo (x2) es el ataque que más quita a Kingambit… si Gholdengo ataca
    const kingambit = miembro("Kingambit", { movimientos: ["suckerpunch", "ironhead", "swordsdance"] });
    const pasivo = combate([kingambit], [miembro("Gholdengo", { objeto: null, movimientos: ["nastyplot", "recover", "thunderwave"] })]);
    const ofensivo = combate([kingambit], [miembro("Gholdengo", { objeto: null, movimientos: ["shadowball", "makeitrain"] })]);
    const fuerte = calcularDano(pasivo, "yo", "suckerpunch").media > calcularDano(pasivo, "yo", "ironhead").media;
    const contraPasivo = ia.elegir(pasivo, "yo");
    const contraOfensivo = ia.elegir(ofensivo, "yo");
    comprobar("No usa Golpe Bajo contra un rival que solo tiene movimientos de estado", fuerte && contraPasivo.accion.id !== "suckerpunch",
      `${textoDe(contraPasivo.jugada)} — y contra uno que ataca elige ${contraOfensivo.jugada.elige}`);
  }
  {
    const estado = combate(equipos[0].miembros, equipos[1].miembros);
    const foto = JSON.stringify(estado);
    ia.elegir(estado, "yo");
    ia.elegir(estado, "rival");
    ia.relevo(estado, "yo");
    ia.probabilidad(estado);
    comprobar("Decidir no cambia el estado del combate", JSON.stringify(estado) === foto);
    const p = ia.probabilidad(estado);
    comprobar("La probabilidad antes de empezar es un número entre 1 y 99", Number.isInteger(p) && p >= 1 && p <= 99, `${p} %`);
  }

  // -------------------------------------------------------------------------
  console.log(`${COMBATES_DE_IA} combates completos de IA contra IA`);
  {
    const problemas = [];
    let noValidos = 0;
    let errores = 0;
    let masLargo = 0;
    let masLento = 0;
    let turnosTotales = 0;
    const victorias = { yo: 0, rival: 0 };
    const inicio = performance.now();
    for (let n = 1; n <= COMBATES_DE_IA; n++) {
      const yo = equipos[n % equipos.length];
      const rival = equipos[(n * 3 + 1) % equipos.length];
      try {
        const antes = performance.now();
        const jugado = await sim.jugar(yo, { ...rival, origen: "Equipo del meta" }, { formato: "gen9ou", semilla: n });
        masLento = Math.max(masLento, performance.now() - antes);
        const fallosDeContrato = validar(jugado);
        // Lo que validar() no mira: la previa, la curva, las jugadas y el resumen completos
        const r = jugado.resumen;
        if (!(jugado.previa?.notas?.length && jugado.previa.velocidad?.length === yo.miembros.length + rival.miembros.length && jugado.previa.prob === jugado.prob[0])) fallosDeContrato.push("la previa está incompleta");
        if (!(r.mvp?.p && r.mvp.porque && r.cierre?.p && r.cierre.porque && r.rendimiento.length === yo.miembros.length && r.movimientos.length && r.momentos.length)) fallosDeContrato.push("el resumen está incompleto");
        if (!jugado.turnos.some((turno) => turno.clave)) fallosDeContrato.push("no hay turnos clave");
        for (const turno of jugado.turnos) for (const lado of LADOS) {
          const j = turno.ia[lado];
          const notas = j.opciones.map((o) => o[1]);
          const bien = j.opciones.length <= 3 && j.opciones[0][0] === j.elige && j.opciones.every((o) => o[2]) && notas.every((x, i) => Number.isInteger(x) && x >= 0 && x <= 100 && (i === 0 || x <= notas[i - 1])) && !/undefined|NaN|null/.test(textoDe(j));
          if (!bien) fallosDeContrato.push(`turno ${turno.n}: la jugada de «${lado}» no cuadra (${textoDe(j)})`);
        }
        if (fallosDeContrato.length) {
          noValidos++;
          if (problemas.length < 12) problemas.push(`combate ${n}: ${fallosDeContrato.slice(0, 3).join(" · ")}`);
        }
        masLargo = Math.max(masLargo, jugado.turnos.length);
        turnosTotales += jugado.turnos.length;
        victorias[r.gana]++;
      } catch (error) {
        errores++;
        if (problemas.length < 12) problemas.push(`combate ${n}: ${error.stack.split("\n").slice(0, 3).join(" ")}`);
      }
    }
    const ms = performance.now() - inicio;
    comprobar("Ninguno lanza un error", errores === 0, `${errores} con error`);
    comprobar("Todos pasan validar() enteros, con su previa, su curva y su resumen", noValidos === 0, `gana «yo» ${victorias.yo} veces y «rival» ${victorias.rival}`);
    comprobar("Ninguno pasa de 100 turnos", masLargo <= 100, `media de ${(turnosTotales / COMBATES_DE_IA).toFixed(1)} turnos; el más largo, ${masLargo}`);
    comprobar("Un combate entero tarda menos de 3 s", masLento < 3000, `media de ${(ms / COMBATES_DE_IA).toFixed(0)} ms; el más lento, ${masLento.toFixed(0)} ms`);
    for (const problema of problemas) console.log(`         ${problema}`);
  }

  // -------------------------------------------------------------------------
  console.log(`${COMBATES_DE_IA} combates de la IA contra un rival que elige al azar, con el mismo equipo`);
  {
    let ganados = 0;
    let decisiones = 0;
    let tiempo = 0;
    let masLenta = 0;
    for (let n = 1; n <= COMBATES_DE_IA; n++) {
      const equipo = equipos[n % equipos.length];
      const tirar = dado(n * 104729 + 7);
      const alAzar = (lista) => lista[tirar(lista.length)];
      const estado = crearCombate(equipo, equipo, { formato, semilla: n + 1000 });
      const sacar = (e, lado) => (lado === "yo" ? ia.relevo(e, lado) : alAzar(opciones(e, lado).filter((o) => o.tipo === "cambio"))?.a ?? -1);
      for (let turno = 0; turno < TURNOS_MAXIMOS && !ganador(estado); turno++) {
        const antes = performance.now();
        const { accion } = ia.elegir(estado, "yo");
        const ms = performance.now() - antes;
        decisiones++;
        tiempo += ms;
        masLenta = Math.max(masLenta, ms);
        resolverTurno(estado, accion, alAzar(opciones(estado, "rival")), { relevo: sacar });
      }
      if (ganador(estado) === "yo") ganados++;
    }
    comprobar("La IA gana al menos 40", ganados >= 40, `gana ${ganados} de ${COMBATES_DE_IA}`);
    comprobar("Una decisión tarda menos de 150 ms", masLenta < 150, `${decisiones} decisiones: media de ${(tiempo / decisiones).toFixed(1)} ms; la más lenta, ${masLenta.toFixed(0)} ms`);
  }

  // -------------------------------------------------------------------------
  console.log("La previsión");
  {
    const antes = performance.now();
    const primera = await sim.prevision(equipos[0], equipos[1], "gen9ou");
    const ms = performance.now() - antes;
    const despues = performance.now();
    const segunda = await sim.prevision(equipos[0], equipos[1], "gen9ou");
    const repetida = performance.now() - despues;
    comprobar("Da un porcentaje de 0 a 100 con 20 combates rápidos", Number.isInteger(primera) && primera >= 0 && primera <= 100, `${primera} % en ${ms.toFixed(0)} ms`);
    comprobar("La misma pareja de equipos no se vuelve a calcular", segunda === primera && repetida < ms / 10, `${repetida.toFixed(1)} ms la segunda vez`);
    comprobar("Sin equipo no hay previsión", (await sim.prevision(equipos[0], { miembros: [] }, "gen9ou")) === null);
    comprobar("El simulador vale para todos los formatos de la app, y los de dobles se juegan como individuales",
      sim.disponible("gen9ou") && sim.disponible("gen9championsbssregmc") && sim.disponible("gen9championsvgc2026regmc") && !sim.disponible("noexiste") &&
      !sim.comoIndividual("gen9ou") && !sim.comoIndividual("gen9championsbssregmc") && sim.comoIndividual("gen9championsvgc2026regmc"));
  }

  // -------------------------------------------------------------------------
  // Pokémon Champions: nivel 50, puntos de estadística, sin IVs ni tera, y Megaevolución
  console.log("Pokémon Champions");
  const { formato: bss } = await cargarDatos("gen9championsbssregmc");
  const { formato: vgc } = await cargarDatos("gen9championsvgc2026regmc");
  // Formatos añadidos después: Champions OU (individuales, como BSS pero con los 6) y un formato de torneos de Limitless (sin repartos propios)
  const { formato: championsOu } = await cargarDatos("gen9championsou");
  const { formato: torneosMc } = await cargarDatos("gen9championsvgc2026regmc-torneos");
  const setDe = (f, nombre, cambios = {}) => ({ ...setMasUsado(f.porNombre.get(nombre), f), ...cambios });
  {
    // Salamence-Mega con Salamencita: sale como Salamence y megaevoluciona al atacar en el primer turno
    const salamence = setDe(bss, "Salamence-Mega", { movimientos: ["doubleedge", "earthquake"] });
    const estado = crearCombate([salamence, setDe(bss, "Golisopod-Mega")], [setDe(bss, "Gholdengo")], { formato: bss, semilla: 3 });
    const p = en(estado, "yo");
    const antes = { tipos: p.tipos.join("/"), habilidad: p.habilidad, ataque: p.ficha.est[1], ps: p.ficha.est[0] };
    // Puntos de estadística: PS = base + puntos + 75; el resto, (base + puntos + 20) por la naturaleza
    const ps = 95 + salamence.valores[0] + 75;
    comprobar("Se juega a nivel 50, sin tera y con las estadísticas de Champions", estado.nivel === 50 && !estado.conTera && antes.ps === ps && !opciones(estado, "yo").some((o) => o.tera), `nivel ${estado.nivel}, ${antes.ps} PS (se esperaban ${ps})`);
    comprobar("Una forma Mega con su megapiedra sale con su forma base", p.nombre === "Salamence-Mega" && p.ficha.id === especie("Salamence").id && antes.habilidad === null, `${antes.tipos}, id ${p.ficha.id}`);
    const eventos = resolverTurno(estado, mov("doubleedge"), mov(en(estado, "rival").ficha.movimientos[0]), { relevo: () => -1 });
    const aviso = eventos.find((e) => e.t === "obj" && e.mega);
    const golpe = eventos.findIndex((e) => e.t === "mov" && e.lado === "yo");
    comprobar("Megaevoluciona al empezar el turno en que ataca, antes de moverse",
      Boolean(aviso) && aviso.p === "Salamence-Mega" && eventos.indexOf(aviso) < golpe && p.habilidad === "aerilate" && p.ficha.id === especie("Salamence-Mega").id && p.ficha.est[1] > antes.ataque,
      aviso ? `${aviso.n}: ${aviso.txt}` : "sin evento");
    const cambio1 = resolverTurno(estado, cambio(1), mov(en(estado, "rival").ficha.movimientos[0]), { relevo: () => -1 });
    const otra = resolverTurno(estado, mov(en(estado, "yo").ficha.movimientos[0]), mov(en(estado, "rival").ficha.movimientos[0]), { relevo: () => -1 });
    const golisopod = estado.lados.yo.equipo[1];
    comprobar("Solo megaevoluciona uno por equipo", !cambio1.some((e) => e.mega) && !otra.some((e) => e.mega) && golisopod.ficha.mega && golisopod.ficha.id === especie("Golisopod").id);
    const sinPiedra = crearCombate([setDe(bss, "Salamence-Mega", { objeto: "leftovers" })], [setDe(bss, "Gholdengo")], { formato: bss, semilla: 3 });
    const enOu = crearCombate([setDe(bss, "Salamence-Mega")], [miembro("Gholdengo")], { formato, semilla: 3 });
    comprobar("Sin su megapiedra, o en un formato sin Megaevolución, juega con la forma tal cual",
      !en(sinPiedra, "yo").ficha.mega && en(sinPiedra, "yo").ficha.id === especie("Salamence-Mega").id && !en(enOu, "yo").ficha.mega);
  }
  const delFormato = {};   // los equipos de cada formato de Champions, para las pruebas de la selección
  for (const [f, nombre] of [[bss, "BSS Reg M-C"], [vgc, "VGC 2026 Reg M-C (como individual)"], [championsOu, "Champions OU"],
    [torneosMc, "VGC 2026 Tournaments Reg M-C (Limitless, como individual)"]]) {
    const COMBATES_CHAMPIONS = 20;
    // Equipos del formato: cada núcleo con los compañeros más habituales (como equiposDePrueba, pero de este formato)
    const equipos = f.nucleos.map((nucleo) => {
      const nombres = [...nucleo.miembros];
      for (const [companero] of nucleo.miembros.flatMap((n) => f.porNombre.get(n).companeros).sort((a, b) => b[1] - a[1])) {
        if (nombres.length === 6) break;
        if (f.porNombre.has(companero) && !nombres.some((n) => n.split("-")[0] === companero.split("-")[0])) nombres.push(companero);
      }
      return { nombre: nombres.join(" / "), miembros: nombres.map((n) => setDe(f, n)) };
    });
    delFormato[f.id] = equipos;
    const problemas = [];
    let errores = 0;
    let megas = 0;
    let individual = true;
    for (let n = 1; n <= COMBATES_CHAMPIONS; n++) {
      try {
        const jugado = await sim.jugar(equipos[n % equipos.length], { ...equipos[(n * 3 + 1) % equipos.length], origen: "Equipo del meta" }, { formato: f.id, semilla: n });
        const fallosDeContrato = validar(jugado);
        if (fallosDeContrato.length && problemas.length < 6) problemas.push(`combate ${n}: ${fallosDeContrato.slice(0, 2).join(" · ")}`);
        if (fallosDeContrato.length) errores++;
        megas += jugado.turnos.flatMap((t) => t.eventos).filter((e) => e.mega).length;
        if (Boolean(jugado.comoIndividual) !== (f.modo !== "Singles")) individual = false;
      } catch (error) {
        errores++;
        if (problemas.length < 6) problemas.push(`combate ${n}: ${error.stack.split("\n").slice(0, 2).join(" ")}`);
      }
    }
    comprobar(`${COMBATES_CHAMPIONS} combates de IA contra IA en ${nombre} terminan y pasan validar()`, errores === 0, `${errores} con fallos; ${megas} Megaevoluciones`);
    if (f === championsOu) {
      const jugado = await sim.jugar(equipos[0], { ...equipos[1], origen: "Equipo del meta" }, { formato: f.id, semilla: 11 });
      comprobar("En Champions OU se juega a nivel 50, sin selección, 6 contra 6 y como individuales",
        sim.disponible(f.id) && !sim.comoIndividual(f.id) && sim.cuantosJuegan(f.id) === 6 && f.nivel === 50 && f.champions && !jugado.comoIndividual &&
        jugado.yo.equipo.length === equipos[0].miembros.length && !jugado.yo.seleccion && validar(jugado).length === 0,
        `${jugado.yo.equipo.length} contra ${jugado.rival.equipo.length}, ${jugado.turnos.length} turnos`);
    }
    if (f === torneosMc) {
      comprobar("Un formato de torneos se simula como VGC: individual, 4 de 6, y su fichero no trae repartos propios",
        sim.disponible(f.id) && sim.comoIndividual(f.id) && sim.cuantosJuegan(f.id) === 4 && f.fuente === "limitless" && f.pokemon.every((p) => p.spreads.length === 0));
    }
    comprobar(`En ${nombre} hay Megaevoluciones y el combate dice si se ha jugado como individual`, megas > 0 && individual);
    for (const problema of problemas) console.log(`         ${problema}`);
  }

  // -------------------------------------------------------------------------
  // Quién juega: la IA elige 3 de 6 en BSS y 4 de 6 en VGC; Gen 9 OU juega los 6
  console.log("Quién juega");
  {
    const { seleccionar } = await import("../js/sim/seleccion.js");
    const { cupoDe } = await import("../js/sim/cupo.js");
    comprobar("El cupo es 3 en BSS, 4 en VGC y 6 en Gen 9 OU", cupoDe("gen9championsbssregmc") === 3 && cupoDe(vgc) === 4 && cupoDe("gen9ou") === 6 && sim.cuantosJuegan("gen9championsvgc2026regmc") === 4);
    const textos = (sel) => JSON.stringify(sel);
    for (const [f, cupo, nombre] of [[bss, 3, "BSS"], [vgc, 4, "VGC"]]) {
      const equipos = delFormato[f.id];
      let parejas = 0;
      const mal = [];
      for (let n = 0; n < 16; n++) {
        const yo = equipos[n % equipos.length];
        const rival = equipos[(n * 3 + 1) % equipos.length];
        if (yo.miembros.length < 6 || rival.miembros.length < 6) continue;
        parejas++;
        const dos = seleccionar(yo, rival, f);
        for (const [lado, equipo] of [["yo", yo], ["rival", rival]]) {
          const { miembros, seleccion } = dos[lado];
          const especies = miembros.map((m) => m.especie);
          const propias = equipo.miembros.map((m) => m.especie);
          if (miembros.length !== cupo) mal.push(`${lado} ${n}: ${miembros.length} elegidos`);
          if (new Set(especies).size !== especies.length) mal.push(`${lado} ${n}: repetidos`);
          if (!especies.every((e) => propias.includes(e))) mal.push(`${lado} ${n}: uno no es del equipo`);
          if (seleccion.sale !== especies[0] || seleccion.elegidos.length !== cupo || seleccion.banco.length !== 6 - cupo) mal.push(`${lado} ${n}: la selección no cuadra`);
          if (/undefined|NaN|null/.test(textos(seleccion)) || ![...seleccion.elegidos, ...seleccion.banco].every((p) => p.porque.length > 10) || !seleccion.porqueSale) mal.push(`${lado} ${n}: frases vacías o rotas`);
        }
        if (textos(dos) !== textos(seleccionar(yo, rival, f, { semilla: 99 }))) mal.push(`${n}: depende de la semilla`);
      }
      comprobar(`En ${nombre} la IA elige ${cupo} de 6 por lado, sin repetir, del equipo y con el que sale primero en cabeza`, parejas >= 5 && mal.length === 0, `${parejas} parejas${mal.length ? `: ${mal.slice(0, 3).join(" · ")}` : ""}`);

      // El combate de verdad se juega con esa selección: cupo contra cupo, el marcador y el análisis también
      const yo = equipos[2 % equipos.length];
      const rival = { ...equipos[5 % equipos.length], origen: "Equipo del meta" };
      const a = await sim.jugar(yo, rival, { formato: f.id, semilla: 1 });
      const b = await sim.jugar(yo, rival, { formato: f.id, semilla: 2 });
      const elegida = seleccionar(yo, rival, f);
      const marcador = a.turnos[0].marcador;
      const finalYo = a.resumen.final.yo.length;
      comprobar(`En ${nombre} el combate se juega ${cupo} contra ${cupo}`,
        a.yo.equipo.length === cupo && a.rival.equipo.length === cupo && a.yo.completo.length === 6 && marcador[0] <= cupo && marcador[1] <= cupo &&
        finalYo === cupo && a.resumen.rendimiento.length === cupo && /^[0-3] – [0-3]$|^[0-4] – [0-4]$/.test(a.resumen.marcador) && validar(a).length === 0,
        `marcador final ${a.resumen.marcador}, ${a.turnos.length} turnos`);
      comprobar(`En ${nombre} el combate usa la selección de seleccionar() y no cambia con la semilla`,
        a.yo.equipo.map((p) => p.nombre).join() === elegida.yo.miembros.map((m) => m.especie).join() &&
        a.rival.equipo.map((p) => p.nombre).join() === elegida.rival.miembros.map((m) => m.especie).join() &&
        textos(a.yo.seleccion) === textos(b.yo.seleccion) && a.yo.equipo.map((p) => p.nombre).join() === b.yo.equipo.map((p) => p.nombre).join() &&
        a.yo.seleccion.sale === a.yo.equipo[0].nombre && a.rival.seleccion.sale === a.rival.equipo[0].nombre);
      const primero = a.turnos[0].eventos.filter((e) => e.t === "entra").map((e) => e.p);
      comprobar(`En ${nombre} salen al campo los que la IA pone primero`, primero[0] === a.yo.seleccion.sale && primero[1] === a.rival.seleccion.sale, primero.join(" y "));
    }
    // Menos Pokémon que el cupo: juegan todos, y el que sale primero lo sigue eligiendo la IA
    {
      const yo = { ...delFormato[bss.id][0], miembros: delFormato[bss.id][0].miembros.slice(0, 2) };
      const rival = { ...delFormato[bss.id][3], miembros: delFormato[bss.id][3].miembros.slice(0, 5) };
      const dos = seleccionar(yo, rival, bss);
      comprobar("Con 2 Pokémon en BSS juegan los 2; con 5, 3 de 5",
        dos.yo.miembros.length === 2 && dos.yo.seleccion.banco.length === 0 && dos.rival.miembros.length === 3 && dos.rival.seleccion.banco.length === 2);
    }
    // Gen 9 OU: los 6 contra los 6, sin selección
    {
      const ou = equiposDePrueba();
      const jugado = await sim.jugar(ou[0], { ...ou[1], origen: "Equipo del meta" }, { formato: "gen9ou", semilla: 5 });
      comprobar("En Gen 9 OU se juegan los 6 y no hay selección",
        seleccionar(ou[0], ou[1], formato) === null && jugado.yo.equipo.length === ou[0].miembros.length && jugado.rival.equipo.length === ou[1].miembros.length && !jugado.yo.seleccion && !jugado.yo.completo,
        `${jugado.yo.equipo.length} contra ${jugado.rival.equipo.length}`);
    }
  }

  // -------------------------------------------------------------------------
  console.log("100 combates");
  {
    // La serie se juega sola en segundo plano: el primero es el que se ve y los otros 99 se van sumando
    sim.elegir({ yo: { ...equipos[0], formato: "gen9ou" }, rival: { ...equipos[1], origen: "Equipo del meta" }, opciones: { combates: sim.TOTAL_SERIE } });
    const inicio = performance.now();
    const combate100 = await sim.simular();
    let avisos = 0;
    const dejar = sim.escucharSerie(() => avisos++);
    while (sim.serieEnCurso(combate100) && performance.now() - inicio < 600_000) await new Promise((seguir) => setTimeout(seguir, 50));
    dejar();
    const cien = combate100.cien;
    comprobar("Con «100 combates» se juegan los 100 sin que nadie lo pida", cien?.ganados.length === sim.TOTAL_SERIE && cien.duraciones.length === sim.TOTAL_SERIE && !cien.fallo && avisos >= 99,
      cien ? `${cien.ganados.length} jugados, ${cien.ganados.filter(Boolean).length} ganados, en ${((performance.now() - inicio) / 1000).toFixed(1)} s` : "sin serie");
    sim.elegir({ opciones: { combates: 1 } });
    const uno = await sim.simular();
    comprobar("Con «1 combate» no hay serie", !uno.cien && !sim.serieEnCurso(uno));
  }

  // -------------------------------------------------------------------------
  console.log("Arreglos de la revisión (S1-S5)");
  {
    // S2: el corte de frases no parte «Sp. Def»
    comprobar("La primera frase no se corta en «Sp.»", ia.primeraFrase("Kingambit's Attack and Sp. Def fell. Next") === "Kingambit's Attack and Sp. Def fell" && ia.primeraFrase("Sp. Atk rose.") === "Sp. Atk rose");

    // S1: un reparto de 252 EVs no vale en Champions (puntos de 0 a 32), y sí en Gen 9 OU
    const vgcEquipos = delFormato[vgc.id];
    const conEvs = { ...vgcEquipos[1], miembros: vgcEquipos[1].miembros.map((m) => ({ ...m, valores: [4, 252, 0, 0, 0, 252] })) };
    const problemasChampions = sim.revisarEquipos(vgcEquipos[0], conEvs, vgc.id);
    comprobar("Un rival con 252 EVs no vale en un formato de Champions", problemasChampions.length === conEvs.miembros.length && problemasChampions.every((p) => p.lado === "rival"), problemasChampions[0]?.texto ?? "sin problemas");
    comprobar("Los equipos con repartos de su formato no dan problemas", sim.revisarEquipos(vgcEquipos[0], vgcEquipos[1], vgc.id).length === 0 && sim.revisarEquipos(equipos[0], equipos[1], "gen9ou").length === 0);
    comprobar("Con repartos imposibles no hay previsión", (await sim.prevision(vgcEquipos[0], conEvs, vgc.id)) === null);

    // S4: fallar por precisión se anota como «Missed», no como «Fails»
    let fallados = 0;
    let sinEfectoPorFallo = 0;
    for (let semilla = 1; semilla <= 60; semilla++) {
      const estado = crearCombate([miembro("Kingambit", { objeto: null, movimientos: ["focusblast"] })], [miembro("Great Tusk", { objeto: null, movimientos: ["bulkup"] })], { formato, semilla });
      const golpe = resolverTurno(estado, mov("focusblast"), mov("bulkup")).find((e) => e.t === "mov" && e.lado === "yo");
      if (golpe.txt === "Missed") fallados++;
      else if (!golpe.da) sinEfectoPorFallo++;
    }
    comprobar("Un golpe que falla por precisión dice «Missed»", fallados > 0 && sinEfectoPorFallo === 0, `${fallados} de 60 (Focus Blast, 70 %); otros sin daño: ${sinEfectoPorFallo}`);

    // S5: la IA no elige jugadas que no pueden hacer nada
    const elegidas = (miembroYo, ajustar) => {
      const vistas = new Set();
      for (let semilla = 1; semilla <= 12; semilla++) {
        const estado = crearCombate([miembroYo, miembro("Gholdengo")], [miembro("Great Tusk", { objeto: null, movimientos: ["bulkup"] })], { formato, semilla });
        ajustar(en(estado, "yo"));
        for (const rapida of [true, false]) vistas.add(ia.elegir(estado, "yo", { rapida }).accion.id);
      }
      return vistas;
    };
    const sorpresa = elegidas(miembro("Dragonite", { objeto: null, movimientos: ["fakeout", "earthquake"] }), (p) => { p.v.actuo = true; });
    comprobar("Fake Out no se elige fuera del primer turno", !sorpresa.has("fakeout") && sorpresa.has("earthquake"));
    const seguida = elegidas(miembro("Kingambit", { objeto: null, movimientos: ["protect", "suckerpunch"] }), (p) => { p.v.protecciones = 1; });
    comprobar("Protect no se elige dos veces seguidas", !seguida.has("protect"));
    const maximo = elegidas(miembro("Dragonite", { objeto: null, movimientos: ["dragondance", "earthquake"] }), (p) => { p.mods[1] = 6; p.mods[5] = 6; });
    comprobar("Dragon Dance no se elige con Ataque y Velocidad al máximo", !maximo.has("dragondance"));
    // Sin banquillo y con Protect como único movimiento, no hay otra jugada: se juega
    const solo = crearCombate([miembro("Kingambit", { objeto: null, movimientos: ["protect"] })], [miembro("Great Tusk", { objeto: null, movimientos: ["bulkup"] })], { formato, semilla: 1 });
    en(solo, "yo").v.protecciones = 1;
    comprobar("Si solo queda una jugada inútil, se juega", ia.elegir(solo, "yo", { rapida: true }).accion?.id === "protect" && ia.elegir(solo, "yo").accion?.id === "protect");

    // S3: una frase que acaba en «!» no lleva un punto detrás (megaevolución)
    const mega = await sim.jugar(delFormato[bss.id][0], { ...delFormato[bss.id][3], origen: "Equipo del meta" }, { formato: bss.id, semilla: 5 });
    const textosDelResumen = JSON.stringify([mega.resumen.objetos, mega.resumen.habilidades, mega.resumen.momentos]);
    comprobar("El análisis no deja «!.» ni «..» en sus frases", !/[!?]\.|\.\./.test(textosDelResumen));
  }
}

// ---------------------------------------------------------------------------
const lista = sinEfecto();
console.log(`Lo que ha aparecido y no tiene efecto programado (${lista.length})`);
for (const clase of [...new Set(lista.map((e) => e.clase))]) {
  console.log(`  ${clase}: ${lista.filter((e) => e.clase === clase).map((e) => `${e.nombre} [${e.id}] ×${e.veces}`).join(", ")}`);
}
if (!lista.length) console.log("  Nada");

console.log(fallos ? `\n${fallos} comprobaciones han fallado` : "\nTodo bien");
process.exit(fallos ? 1 : 0);
