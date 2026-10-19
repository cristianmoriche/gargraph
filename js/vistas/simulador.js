// Simulador de combates: reparte entre sus pantallas según el primer parámetro de la dirección.
//   #/simulador → preparar · #/simulador/rival · #/simulador/combate · #/simulador/decision/8 · #/simulador/resultado
// Cada pantalla recibe el mismo contexto que las demás: en «decision/8», parametros es ["decision", "8"].
// Una subruta que no existe (#/simulador/loquesea) lleva a #/simulador sin dejar rastro en el historial.
import * as preparar from "./sim/preparar.js";
import * as rival from "./sim/rival.js";
import * as combate from "./sim/combate.js";
import * as decision from "./sim/decision.js";
import * as resultado from "./sim/resultado.js";

const PASOS = { rival, combate, decision, resultado };

export async function pintar(vista, contexto) {
  const paso = contexto.parametros[0]?.toLowerCase();
  if (paso === undefined) return preparar.pintar(vista, contexto);
  if (!Object.hasOwn(PASOS, paso)) {
    location.replace("#/simulador");
    return;
  }
  return PASOS[paso].pintar(vista, contexto);
}
