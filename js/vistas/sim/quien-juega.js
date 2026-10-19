// Simulador · qué Pokémon eligió la IA de cada lado y por qué. Lo enseñan el combate y el análisis.
// Lo que enseña viene de combate.yo.seleccion y combate.rival.seleccion (js/sim/seleccion.js); un combate sin
// selección (Gen 9 OU juega los 6, y el combate de ejemplo) no pinta nada.
import { escapar, sprite } from "../../ui.js";

const LADOS = [["yo", "Your team"], ["rival", "Opponent"]];

/** La sección «Quién juega» con los elegidos de cada lado, el que sale primero y los que se quedan en el banco. "" si no hay selección. */
export function seccionQuienJuega(combate) {
  if (!LADOS.some(([lado]) => combate[lado]?.seleccion)) return "";
  const juegan = combate.yo.seleccion?.juegan ?? combate.rival.seleccion.juegan;
  const de = combate.yo.seleccion?.de ?? combate.rival.seleccion.de;
  return `
    <section class="seleccion" aria-label="Brought to Battle">
      <h2 class="seleccion-titulo">Brought to Battle</h2>
      <p class="nota">With both teams visible (Team Preview), the AI picks ${juegan} of ${de} for each side and which one leads. Reasons are based on calculated damage between both teams' Pokémon.</p>
      ${LADOS.map(([lado, titulo]) => bloque(combate, lado, titulo)).join("")}
    </section>`;
}

function bloque(combate, lado, titulo) {
  const { seleccion } = combate[lado];
  if (!seleccion) return "";
  const ids = new Map((combate[lado].completo ?? combate[lado].equipo).map((p) => [p.nombre, p.id]));
  const imagen = (nombre) => sprite(nombre, { id: ids.get(nombre), clase: "mediano" });
  const elegidos = seleccion.elegidos.map((p) => {
    const sale = p.nombre === seleccion.sale;
    return `
      <li class="sel-pokemon">
        ${imagen(p.nombre)}
        <div class="sel-texto">
          <p class="sel-nombre"><b>${escapar(p.nombre)}</b>${sale ? ` <span class="insignia acento">Lead</span>` : ""}</p>
          <p class="sel-porque">${escapar(p.porque)}</p>
          ${sale ? `<p class="sel-porque">${escapar(seleccion.porqueSale)}</p>` : ""}
        </div>
      </li>`;
  }).join("");
  const banco = seleccion.banco.map((p) => `
      <li class="sel-pokemon sel-banco">
        ${imagen(p.nombre)}
        <div class="sel-texto">
          <p class="sel-nombre"><b>${escapar(p.nombre)}</b></p>
          <p class="sel-porque">${escapar(p.porque)}</p>
        </div>
      </li>`).join("");
  return `
    <div class="sel-lado" data-lado="${lado}">
      <h3 class="sel-lado-titulo">${titulo} · ${seleccion.elegidos.length === seleccion.de ? `all ${seleccion.de} play` : `${seleccion.elegidos.length} of ${seleccion.de}`}</h3>
      <ul class="tarjeta sin-relleno lista">${elegidos}</ul>
      ${banco ? `<p class="nota sel-banco-titulo">Left on the bench</p><ul class="tarjeta sin-relleno lista">${banco}</ul>` : ""}
    </div>`;
}
