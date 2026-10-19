// Speed tiers: Velocidad real de cada Pokémon del formato con su reparto y naturaleza más usados
import { cargarFormato, dic, especie, estadisticasReales, valoresDeSpread, rutaDex, esDeTorneos } from "../meta.js";
import { leer } from "../estado.js";
import { escapar, sprite, selectorDeFormatos, notaDeTorneos, cabeceraDetalle, vacio } from "../ui.js";

let soloEquipo = false; // «My team»; se conserva al cambiar de formato

/**
 * Los datos de un formato listos para calcular velocidades. Los de torneos no tienen repartos: se usan los más usados del
 * formato de Smogon de la misma regulación (spreadsRespaldo, ver cargarFormato). Devuelve { formato, respaldo }, donde
 * «respaldo» es { id, nombre } del formato de donde salen, o null si los repartos son los del propio formato.
 */
export function conRepartos(formato) {
  if (!esDeTorneos(formato)) return { formato, respaldo: null };
  const respaldo = formato.respaldoRepartos ?? null;
  const pokemon = formato.pokemon.map((p) => ({ ...p, spreads: p.spreadsRespaldo ?? [] }));
  return { formato: { ...formato, pokemon }, respaldo };
}

/**
 * Velocidad real de cada Pokémon del formato con su reparto más usado, de mayor a menor.
 * Los que no tienen reparto (o cuya especie no está en el diccionario) van aparte, en «sinReparto».
 */
export function calcularVelocidades(formato) {
  const filas = [];
  let sinReparto = 0;
  for (const p of formato.pokemon) {
    const base = especie(p.nombre)?.base;
    const [naturaleza, texto] = p.spreads?.[0] ?? [];
    const valores = texto ? valoresDeSpread(texto) : null;
    const velocidad = base && valores ? estadisticasReales(base, naturaleza, valores, formato)[5] : null;
    if (!Number.isInteger(velocidad)) {
      sinReparto++;
      continue;
    }
    filas.push({ nombre: p.nombre, velocidad, naturaleza, valor: valores[5] });
  }
  filas.sort((a, b) => b.velocidad - a.velocidad || a.nombre.localeCompare(b.nombre));
  return { filas, sinReparto };
}

// «252+ Spe Jolly»: el + o el - es el efecto de la naturaleza en la Velocidad
export function textoReparto({ valor, naturaleza }) {
  const efecto = dic().naturalezas[naturaleza] ?? {};
  const signo = efecto.sube === 5 ? "+" : efecto.baja === 5 ? "-" : "";
  return `${valor}${signo} Spe ${naturaleza}`;
}

// Tramos de 100 (o de 20 en los formatos a nivel 50, donde la Velocidad no pasa de 200 o 250)
function tramo(velocidad, paso) {
  if (paso === 100 && velocidad >= 400) return { desde: 400, etiqueta: "400+" }; // un solo tramo abierto arriba
  const desde = Math.floor(velocidad / paso) * paso;
  const etiqueta = `${desde}–${desde + paso - 1}`;
  return { desde, etiqueta };
}

export async function pintar(vista, { vigente }) {
  const formato = await cargarFormato();
  if (!vigente()) return;
  const { formato: calculable, respaldo } = conRepartos(formato);
  const { filas, sinReparto } = calcularVelocidades(calculable);
  const estado = leer();
  const equipo = estado.equipos.find((e) => e.id === estado.equipoActivo) ?? null;
  // L15: por especie base, así Charizard del equipo marca a Charizard-Mega-Y
  const base = (nombre) => especie(nombre)?.especie ?? nombre;
  const delEquipo = new Set(equipo?.miembros.map((m) => base(m.especie)) ?? []);
  const paso = Math.max(...filas.map((f) => f.velocidad), 0) >= 300 ? 100 : 20;

  vista.innerHTML = `
    <div class="v-velocidades">
      ${cabeceraDetalle({ titulo: "Speed tiers", subtitulo: escapar(formato.nombre), volver: "#/dex" })}
      ${selectorDeFormatos()}
      <div class="segmentado filtro" role="group" aria-label="Filter">
        <button type="button" class="segmento" data-filtro="todos" aria-pressed="${!soloEquipo}">All</button>
        <button type="button" class="segmento" data-filtro="equipo" aria-pressed="${soloEquipo}">My team</button>
      </div>
      <p class="nota explicacion">
        Real Speed at level ${formato.nivel} with the most used ${formato.champions ? "stat points" : "EVs"} and nature of each Pokémon
        (${formato.champions ? "no IVs" : `${formato.ivs} IVs`}). A + or − after the number is the nature's effect on Speed.
      </p>
      ${notaDeTorneos(formato, respaldo ? `Speeds use the most used spread in ${respaldo.nombre} (Showdown) for the same Pokémon.` : "No spread is available, so speeds cannot be calculated.")}
      <div id="velocidades-lista"></div>
      ${sinReparto
        ? `<p class="nota pie">${sinReparto} Pokémon left out: no spread data in this format.</p>`
        : ""}
    </div>`;

  const lista = vista.querySelector("#velocidades-lista");
  const pintarLista = () => {
    const visibles = soloEquipo ? filas.filter((f) => delEquipo.has(base(f.nombre))) : filas;
    if (!visibles.length) {
      lista.innerHTML = vacio(
        soloEquipo && !equipo ? "No active team" : soloEquipo ? "None of your team is listed" : "No data",
        soloEquipo && !equipo ? "Pick an active team in Teams to see it here."
          : soloEquipo ? `None of the Pokémon of ${escapar(equipo.nombre)} has a spread in ${escapar(formato.nombre)}.` : "",
      );
      return;
    }
    const tramos = [];
    for (const f of visibles) {
      const t = tramo(f.velocidad, paso);
      if (tramos.at(-1)?.desde !== t.desde) tramos.push({ ...t, filas: [] });
      tramos.at(-1).filas.push(f);
    }
    lista.innerHTML = tramos.map((t) => `
      <section class="seccion tramo">
        <h2 class="tramo-titulo">${t.etiqueta}</h2>
        <ul class="tarjeta sin-relleno lista">
          ${t.filas.map((f) => `
            <li><a class="fila-pokemon" href="${rutaDex(f.nombre)}">
              <span class="velocidad">${f.velocidad}</span>
              ${sprite(f.nombre)}
              <span class="fila-pokemon-texto">
                <span class="fila-pokemon-nombre">${escapar(f.nombre)}</span>
                <span class="reparto">${escapar(textoReparto(f))}</span>
              </span>
              ${delEquipo.has(base(f.nombre)) ? `<span class="insignia acento">Team</span>` : ""}
            </a></li>`).join("")}
        </ul>
      </section>`).join("");
  };
  pintarLista();

  vista.querySelectorAll("[data-filtro]").forEach((b) => b.addEventListener("click", () => {
    soloEquipo = b.dataset.filtro === "equipo";
    vista.querySelectorAll("[data-filtro]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    pintarLista();
  }));
}
