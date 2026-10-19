// Quiz: «Which one is faster?» (Velocidad real con el reparto más usado) y eficacia de tipos
import { cargarFormato, especie } from "../meta.js";
import { leer, guardar } from "../estado.js";
import { TIPOS, calcularDanoRecibido } from "../tipos.js";
import { escapar, sprite, cabeceraDetalle, vacio, variableTipo } from "../ui.js";
import { calcularVelocidades, conRepartos, textoReparto } from "./velocidades.js";

let modo = "speed"; // se conserva al cambiar de formato

const OPCIONES = [0, 0.25, 0.5, 1, 2, 4];
const ETIQUETA = { 0: "0×", 0.25: "¼×", 0.5: "½×", 1: "1×", 2: "2×", 4: "4×" };
const azar = (lista) => lista[Math.floor(Math.random() * lista.length)];
const ingles = (tipo) => tipo.charAt(0).toUpperCase() + tipo.slice(1);
const insignia = (tipo) => `<span class="tipo" style="--color-tipo: ${variableTipo(tipo)}">${ingles(tipo)}</span>`;

/** Racha actual y mejor racha guardadas en el perfil (perfil.quiz). */
function rachas() {
  const q = leer().perfil.quiz;
  const entero = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  return { racha: entero(q?.racha), mejor: entero(q?.mejor) };
}

/** Anota un acierto (+1) o un fallo (racha a 0) y guarda las rachas nuevas. */
function anotar(acierto) {
  const { racha, mejor } = rachas();
  const nueva = acierto ? racha + 1 : 0;
  guardar((e) => { e.perfil.quiz = { racha: nueva, mejor: Math.max(mejor, nueva) }; });
}

// Dos Pokémon con Velocidad distinta: los empates no se preguntan
function preguntaVelocidad(filas) {
  // L14: sin dos velocidades distintas no hay pregunta posible (y el bucle no terminaría)
  if (new Set(filas.map((f) => f.velocidad)).size < 2) return null;
  let a, b;
  do {
    a = azar(filas);
    b = azar(filas);
  } while (a === b || a.velocidad === b.velocidad);
  return { opciones: [a, b], correcta: a.velocidad > b.velocidad ? 0 : 1 };
}

function preguntaTipos(formato) {
  const candidatos = formato.pokemon.filter((p) => especie(p.nombre)?.tipos?.length);
  const defensor = azar(candidatos).nombre;
  const tipos = especie(defensor).tipos;
  const ataque = azar(Object.keys(TIPOS));
  return { defensor, tipos, ataque, correcta: calcularDanoRecibido(tipos)[ataque] };
}

export async function pintar(vista, { vigente }) {
  const formato = await cargarFormato();
  if (!vigente()) return;
  const { filas } = calcularVelocidades(conRepartos(formato).formato);

  vista.innerHTML = `
    <div class="v-quiz">
      ${cabeceraDetalle({ titulo: "Quiz", subtitulo: escapar(formato.nombre), volver: "#/dex" })}
      <div class="segmentado modo" role="group" aria-label="Quiz type">
        <button type="button" class="segmento" data-modo="speed" aria-pressed="${modo === "speed"}">Speed</button>
        <button type="button" class="segmento" data-modo="types" aria-pressed="${modo === "types"}">Types</button>
      </div>
      <div id="quiz-pregunta"></div>
      <div class="tarjeta marcador" aria-live="polite">
        <span>Streak: <strong id="quiz-racha"></strong></span>
        <span>Best: <strong id="quiz-mejor"></strong></span>
      </div>
      <button type="button" class="boton bloque" id="quiz-siguiente" hidden>Next question</button>
    </div>`;

  const zona = vista.querySelector("#quiz-pregunta");
  const siguiente = vista.querySelector("#quiz-siguiente");
  const pintarMarcador = () => {
    const { racha, mejor } = rachas();
    vista.querySelector("#quiz-racha").textContent = racha;
    vista.querySelector("#quiz-mejor").textContent = mejor;
  };

  const nueva = () => {
    siguiente.hidden = true;
    if (modo === "speed") nuevaVelocidad();
    else nuevaTipos();
  };

  // Al contestar: se guarda la racha y aparece «Next question»
  const contestar = (acierto) => {
    anotar(acierto);
    pintarMarcador();
    siguiente.hidden = false;
  };

  function nuevaVelocidad() {
    const pregunta = filas.length < 2 ? null : preguntaVelocidad(filas);
    if (!pregunta) {
      zona.innerHTML = vacio("Not enough data", `${escapar(formato.nombre)} has no spreads to compare.`);
      return;
    }
    const { opciones, correcta } = pregunta;
    zona.innerHTML = `
      <h2 class="pregunta">Which one is faster?</h2>
      <p class="nota">Real Speed with each Pokémon's most used spread in ${escapar(formato.respaldoRepartos?.nombre ?? formato.nombre)}${formato.respaldoRepartos ? ` (tournament data has no spreads)` : ""}.</p>
      <div class="cartas">
        ${opciones.map((f, i) => `
          <button type="button" class="carta" data-i="${i}">
            ${sprite(f.nombre, { clase: "grande" })}
            <span class="carta-nombre">${escapar(f.nombre)}</span>
            <span class="carta-dato" hidden>${f.velocidad} Spe · ${escapar(textoReparto(f))}</span>
            <span class="carta-veredicto" hidden></span>
          </button>`).join("")}
      </div>`;
    const botones = [...zona.querySelectorAll(".carta")];
    botones.forEach((boton) => boton.addEventListener("click", () => {
      const elegida = Number(boton.dataset.i);
      const acierto = elegida === correcta;
      botones.forEach((b, i) => {
        b.disabled = true;
        b.querySelector(".carta-dato").hidden = false;
        if (i === correcta) b.classList.add("correcta");
      });
      if (!acierto) boton.classList.add("incorrecta");
      const veredicto = boton.querySelector(".carta-veredicto");
      veredicto.textContent = `${acierto ? "Correct" : "Incorrect"} · ${opciones[elegida].velocidad} vs ${opciones[1 - elegida].velocidad}`;
      veredicto.hidden = false;
      contestar(acierto);
    }));
  }

  function nuevaTipos() {
    const { defensor, tipos, ataque, correcta } = preguntaTipos(formato);
    zona.innerHTML = `
      <h2 class="pregunta">How effective is ${insignia(ataque)} against ${escapar(defensor)}?</h2>
      <p class="nota">Type chart only: abilities, items and Terastallization are ignored.</p>
      <div class="tarjeta objetivo">
        ${sprite(defensor, { clase: "grande con-fondo" })}
        <span class="objetivo-texto">
          <strong>${escapar(defensor)}</strong>
          <span class="tipos">${tipos.map(insignia).join("")}</span>
        </span>
      </div>
      <div class="opciones">
        ${OPCIONES.map((m) => `<button type="button" class="boton secundario opcion" data-m="${m}">${ETIQUETA[m]}</button>`).join("")}
      </div>
      <p class="nota veredicto" role="status" hidden></p>`;
    const botones = [...zona.querySelectorAll(".opcion")];
    botones.forEach((boton) => boton.addEventListener("click", () => {
      const elegida = Number(boton.dataset.m);
      const acierto = elegida === correcta;
      botones.forEach((b) => {
        b.disabled = true;
        if (Number(b.dataset.m) === correcta) b.classList.add("correcta");
      });
      if (!acierto) boton.classList.add("incorrecta");
      const veredicto = zona.querySelector(".veredicto");
      veredicto.textContent = acierto ? `Correct · ${ETIQUETA[correcta]}` : `Incorrect · it is ${ETIQUETA[correcta]}`;
      veredicto.hidden = false;
      contestar(acierto);
    }));
  }

  vista.querySelectorAll("[data-modo]").forEach((b) => b.addEventListener("click", () => {
    modo = b.dataset.modo;
    vista.querySelectorAll("[data-modo]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    nueva();
  }));
  siguiente.addEventListener("click", nueva);

  pintarMarcador();
  nueva();
}
