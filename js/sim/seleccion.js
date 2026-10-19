// Quién juega: en BSS cada lado elige 3 de sus 6 Pokémon y en VGC 4 de 6 (Gen 9 OU juega los 6).
// Elige la IA, para los dos lados, tras ver los dos equipos enteros. No usa el DOM ni Math.random.
//
//   (cupoDe, de ./cupo.js: 3 en BSS, 4 en VGC y 6 en el resto)
//   seleccionar(yo, rival, formato, { semilla }?)  → null | { yo, rival }        // null: se juegan los 6
//     cada lado: { miembros, seleccion }
//     miembros: los que juegan, con el que sale primero en cabeza (es lo que se pasa a crearCombate)
//     seleccion: { juegan, de, elegidos: [{ nombre, porque }], banco: [{ nombre, porque }], sale, porqueSale }
//
// Cómo elige:
//   1. Hace el uno contra uno de cada Pokémon propio con cada uno del rival (enfrentar, de ia.js: daño con
//      calcularDano, eficacia de tipos y quién pega antes). Cada duelo vale de −1 (pierde de sobra) a +1.
//   2. Pesa más a los rivales que ganan a más Pokémon propios: son las amenazas.
//   3. Elige uno a uno al que más cobertura añade: cuanto mejor cubre a las amenazas que sus compañeros aún
//      no cubren, mejor; a igualdad, el que mejor queda en general.
//   4. Saca primero al que mejor queda contra los seis rivales.
// Las frases salen de esos cálculos: lo que no sale de un dato no se dice. Los dos lados eligen a la vez, sin
// saber qué ha elegido el otro: cada uno solo ve el equipo completo del contrario.
import { ETIQUETAS } from "../tipos.js";
import { enfrentar, velocidadDe } from "./ia.js";
import { cupoDe } from "./cupo.js";
import { crearCombate } from "./motor.js";

const MAXIMO = 6;
const ESCALA = 40;            // los puntos de un duelo que cuentan como una victoria o una derrota de sobra
const PESO_GENERAL = 0.35;    // lo que pesa quedar bien en general frente a cubrir amenazas

const limitar = (n, min, max) => Math.min(max, Math.max(min, n));
const entre = (g) => (Math.round(g.min) === Math.round(g.max) ? `${Math.round(g.max)}%` : `${Math.round(g.min)}–${Math.round(g.max)}%`);

const miembrosDe = (equipo) => (Array.isArray(equipo) ? equipo : equipo?.miembros ?? []).filter((m) => m?.especie).slice(0, MAXIMO);

/**
 * Elige quién juega por los dos lados. Devuelve null si el formato juega los 6. Con equipos de tantos
 * Pokémon como el cupo o menos juegan todos, pero la IA sigue eligiendo cuál sale primero.
 */
export function seleccionar(yo, rival, formato, { semilla = 0 } = {}) {
  const cupo = cupoDe(formato);
  if (cupo >= MAXIMO) return null;
  const propios = miembrosDe(yo);
  const ajenos = miembrosDe(rival);
  if (!propios.length || !ajenos.length) return null;
  // Un combate de papel: nadie sale al campo (así ninguna habilidad de entrada toca a nadie) y solo se hacen cuentas
  const estado = crearCombate(propios, ajenos, { formato, semilla, sinSalir: true });
  const equipo = (lado) => estado.lados[lado].equipo;
  const duelos = equipo("yo").map((a) => equipo("rival").map((b) => enfrentar(estado, a.indice, b.indice)));
  const velocidades = (lado) => equipo(lado).map((p) => velocidadDe(estado, p));
  const repetidos = new Set(propios.map((m) => m.especie).filter((nombre) => ajenos.some((m) => m.especie === nombre)));
  const nombrar = (lado, nombre) => (repetidos.has(nombre) ? (lado === "yo" ? `your ${nombre}` : `opposing ${nombre}`) : nombre);

  const vista = (lado) => {
    const mio = lado === "yo";
    const n = mio ? propios.length : ajenos.length;
    const m = mio ? ajenos.length : propios.length;
    const nombres = (mio ? propios : ajenos).map((x) => x.especie);
    const suyos = (mio ? ajenos : propios).map((x) => x.especie);
    // valor[a][b]: cómo le va al Pokémon «a» de este lado contra el «b» del otro, de −1 a 1
    const valor = Array.from({ length: n }, (_, a) => Array.from({ length: m }, (__, b) => {
      const d = mio ? duelos[a][b] : duelos[b][a];
      return limitar((mio ? d.puntos : -d.puntos) / ESCALA, -1, 1);
    }));
    // el golpe con el que «a» ataca a «b»
    const golpe = (a, b) => (mio ? duelos[a][b].mio : duelos[b][a].suyo);
    return elegirLado({
      lado, cupo, n, m, nombres, suyos, valor, golpe, nombrar,
      velocidad: velocidades(lado), velocidadSuya: velocidades(mio ? "rival" : "yo"),
    });
  };
  const hechos = { yo: vista("yo"), rival: vista("rival") };
  const resultado = {};
  for (const [lado, lista] of [["yo", propios], ["rival", ajenos]]) {
    const { seleccion, orden } = hechos[lado];
    resultado[lado] = { miembros: orden.map((i) => lista[i]), seleccion };
  }
  return resultado;
}

/** La elección de un lado a partir de sus duelos. Devuelve { orden: índices en el orden de salida, seleccion }. */
function elegirLado({ lado, cupo, n, m, nombres, suyos, valor, golpe, nombrar, velocidad, velocidadSuya }) {
  const juegan = Math.min(cupo, n);
  // Amenazas: los rivales que ganan a más Pokémon de este lado pesan hasta el doble
  const peso = Array.from({ length: m }, (_, b) => 1 + valor.filter((fila) => fila[b] < 0).length / n);
  const total = peso.reduce((suma, p) => suma + p, 0);
  const general = valor.map((fila) => fila.reduce((suma, v, b) => suma + peso[b] * v, 0) / total);

  // Se elige de uno en uno el que más cobertura añade (lo mejor que tiene el grupo contra cada rival)
  const mejor = Array(m).fill(-1);
  const grupo = [];
  while (grupo.length < juegan) {
    let elegido = -1;
    let nota = -Infinity;
    for (let a = 0; a < n; a++) {
      if (grupo.includes(a)) continue;
      let gana = 0;
      for (let b = 0; b < m; b++) gana += peso[b] * (Math.max(mejor[b], valor[a][b]) - mejor[b]);
      const puntos = gana / total + PESO_GENERAL * general[a] + 1e-6 * velocidad[a];   // a igualdad, el más rápido
      if (puntos > nota) { nota = puntos; elegido = a; }
    }
    grupo.push(elegido);
    for (let b = 0; b < m; b++) mejor[b] = Math.max(mejor[b], valor[elegido][b]);
  }

  // El que sale primero: el que mejor queda contra los seis rivales
  const sale = grupo.reduce((primero, a) => (general[a] > general[primero] + 1e-9 || (Math.abs(general[a] - general[primero]) <= 1e-9 && velocidad[a] > velocidad[primero]) ? a : primero), grupo[0]);
  const orden = [sale, ...grupo.filter((a) => a !== sale)];

  // ---- Las frases
  const gana = (a) => valor[a].filter((v) => v > 0).length;
  const pierde = (a) => valor[a].filter((v) => v < 0).length;
  const de = (b) => nombrar(lado === "yo" ? "rival" : "yo", suyos[b]);
  const golpeA = (a, b) => {
    const g = golpe(a, b);
    if (!g || g.max <= 0) return "";
    const ef = g.ef !== undefined && g.ef !== 1 ? ` (${ETIQUETAS[g.ef] ?? `${g.ef}×`})` : "";
    if (g.min >= 100) return `${g.n}${ef} KOs it in one hit`;
    if (g.max >= 100) return `${g.n}${ef} can KO it in one hit (up to 100%)`;
    return `${g.n}${ef} deals ${entre(g)}`;
  };
  const masRapido = (a) => (velocidad[a] > Math.max(...velocidadSuya) ? ` Outspeeds all ${m} opposing Pokémon (${velocidad[a]} Speed).` : "");

  const razon = (a) => {
    // La única respuesta del grupo a un rival al que gana: la razón más fuerte para llevarlo
    const unicas = [];
    for (let b = 0; b < m; b++) {
      if (valor[a][b] > 0 && grupo.every((otro) => otro === a || valor[otro][b] <= 0)) unicas.push(b);
    }
    if (unicas.length) {
      const b = unicas.sort((x, y) => peso[y] * valor[a][y] - peso[x] * valor[a][x])[0];
      const golpeo = golpeA(a, b);
      return `The only one in the group that beats ${de(b)}${golpeo ? `: ${golpeo}` : ""}.${masRapido(a)}`;
    }
    if (gana(a) > 0) {
      const b = valor[a].indexOf(Math.max(...valor[a]));
      const golpeo = golpeA(a, b);
      return `Wins the 1v1 against ${gana(a)} of the ${m} opposing Pokémon${golpeo ? `; against ${de(b)}, ${golpeo}` : ""}.${masRapido(a)}`;
    }
    const b = valor[a].indexOf(Math.max(...valor[a]));
    return `Beats no one on its own, but is the best of the remaining Pokémon at holding off ${de(b)}.${masRapido(a)}`;
  };
  const razonDeBanco = (a) => (gana(a) === 0
    ? `Wins the 1v1 against none of the ${m} opposing Pokémon.`
    : `Beats ${gana(a)} of ${m} opposing Pokémon and loses to ${pierde(a)}, but the chosen Pokémon cover the threats better.`);

  const porqueSale = `Leads: wins the 1v1 against ${gana(sale)} of the ${m} opposing Pokémon${pierde(sale) ? ` and loses to ${pierde(sale)}` : ""}, the best balance of the chosen Pokémon.`;
  const resto = Array.from({ length: n }, (_, a) => a).filter((a) => !grupo.includes(a));
  return {
    orden,
    seleccion: {
      juegan,
      de: n,
      elegidos: orden.map((a) => ({ nombre: nombres[a], porque: razon(a) })),
      banco: resto.map((a) => ({ nombre: nombres[a], porque: razonDeBanco(a) })),
      sale: nombres[sale],
      porqueSale,
    },
  };
}
