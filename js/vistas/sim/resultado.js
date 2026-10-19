// Simulador · el análisis del combate (#/simulador/resultado). Diseño simple: tarjetas planas y una gráfica de línea.
// Trabaja con sesion.combate.resumen (forma en disenos/implementacion/CONTRATO-SIMULADOR.md); con ?ejemplo usa el combate de ejemplo.
import { escapar, sprite, barra, icono, cabeceraDetalle, tituloSeccion, avisar } from "../../ui.js";
import { resumenFormato } from "../../meta.js";
import { leer, guardar, nuevoId } from "../../estado.js";
import { activar } from "../../movimiento.js";
import { seccionQuienJuega } from "./quien-juega.js";
import { sesion, simular, elegir, AVISO_INDIVIDUAL, TOTAL_SERIE as TOTAL_CIEN, escucharSerie, serieEnCurso, seguirSerie, pararSerie } from "../../sim/index.js";

const turnosTexto = (n) => `${n} ${n === 1 ? "turn" : "turns"}`;
const usosTexto = (n) => `${n} ${n === 1 ? "use" : "uses"}`;

export async function pintar(vista, { consulta, vigente }) {
  const ejemplo = consulta.has("ejemplo");
  // Con ?ejemplo, simular() devuelve el combate de ejemplo (sin guardarlo en la sesión)
  const combate = ejemplo ? await simular() : sesion.combate;
  if (!vigente()) return;
  const r = combate?.resumen;
  if (!r) {
    location.replace("#/simulador"); // sin combate no hay nada que analizar
    return;
  }

  const sufijo = ejemplo ? "?ejemplo" : ""; // se conserva ?ejemplo en los enlaces
  // A la jugada de la IA se va con ?desde=analisis: así su botón de vuelta trae aquí, no al combate (N5)
  const aDecision = (turno) => `#/simulador/decision/${turno}?desde=analisis${ejemplo ? "&ejemplo" : ""}`;
  const prob = combate.prob ?? [];
  const victoria = r.gana === "yo";
  const momentos = [...(r.momentos ?? [])].sort((a, b) => a.turno - b.turno);
  // El formato es el del combate (con el que se simuló), no el que haya elegido ahora la persona en la app
  const formatoId = combate.formato ?? null;
  const formato = combate.formatoNombre ?? (formatoId ? resumenFormato(formatoId)?.nombre : "") ?? "";
  const pocos = (lista) => lista ?? [];

  const luchador = (nombre) => [...combate.yo.equipo, ...combate.rival.equipo].find((p) => p.nombre === nombre);
  const miniatura = (nombre, clase = "") => sprite(nombre, { id: luchador(nombre)?.id, clase });
  const pasos = (n) => `${n > 0 ? "+" : "−"}${Math.abs(n)} pts`;
  const cifra = (n) => `${n}%`;

  // ---- Piezas
  const equipo = (lado) => pocos(r.final?.[lado]).map(([nombre, ps]) => `
    <li class="pk${ps ? "" : " ko"}">
      ${miniatura(nombre)}
      <div class="pk-texto"><p class="pk-nombre">${escapar(nombre)}</p>${barra(ps / 100)}</div>
      <span class="pk-dato">${ps ? cifra(ps) : "KO"}</span>
    </li>`).join("");

  const listaMomentos = momentos.map((m, i) => `
    <li><a class="fila" href="${aDecision(m.turno)}" aria-label="See turn ${m.turno} in the AI's move">
      <span class="insignia acento">${i + 1}</span>
      <div class="fila-texto">
        <p class="nota">Turn ${m.turno}</p>
        <p class="fila-titulo">${escapar(m.titulo)}</p>
        <p class="fila-sub">${escapar(m.txt)}</p>
      </div>
      <span class="insignia ${m.delta < 0 ? "error" : "exito"}">${pasos(m.delta)}</span>
    </a></li>`).join("");

  const destacado = (dato, etiqueta) => (dato ? `
    <li class="fila destacado">
      ${miniatura(dato.p, "grande con-fondo")}
      <div class="fila-texto">
        <p class="nota">${etiqueta}</p>
        <p class="fila-titulo">${escapar(dato.p)}</p>
        <p class="fila-sub">${escapar(dato.porque)}</p>
      </div>
    </li>` : "");

  // Rendimiento: daño hecho y recibido (% de PS) y PS finales de cada uno de mis Pokémon
  const psFinal = new Map(pocos(r.final?.yo));
  const maximoDano = Math.max(100, ...pocos(r.rendimiento).map((f) => f[2]));
  const rendimiento = pocos(r.rendimiento).map(([nombre, ko, dano, recibido]) => {
    const ps = psFinal.get(nombre);
    const salio = ko || dano || recibido || (ps != null && ps < 100);
    const insigniaPs = ps == null ? "" : ps === 0
      ? `<span class="insignia error">Fainted</span>`
      : `<span class="insignia ${ps > 50 ? "exito" : ""}">${cifra(ps)} HP</span>`;
    return `
    <li class="rd">
      <div class="rd-cabeza">
        ${miniatura(nombre)}
        <div class="fila-texto"><p class="fila-titulo">${escapar(nombre)}</p><p class="fila-sub">${salio ? `${ko} ${ko === 1 ? "KO" : "KOs"}` : "Did not play"}</p></div>
        ${insigniaPs}
      </div>
      ${salio ? `
      <div class="rd-barra"><span class="nota">Damage dealt</span>${barra(Math.min(dano / maximoDano, 1))}<span class="rd-cifra">${cifra(dano)}</span></div>
      <div class="rd-barra"><span class="nota">Damage taken</span>${barra(Math.min(recibido / 100, 1))}<span class="rd-cifra">${cifra(recibido)}</span></div>` : ""}
    </li>`;
  }).join("");

  // Lo medido de un objeto o una habilidad (veces que se activó, PS quitados, PS recuperados). Sin notas de 0 a 100.
  // El combate de ejemplo trae ahí un número suelto: no es un hecho y no se enseña.
  const hechos = (h) => {
    if (!h || typeof h !== "object") return "";
    const piezas = [
      h.veces ? `${h.veces} ${h.veces === 1 ? "activation" : "activations"}` : "",
      h.dano ? `${cifra(h.dano)} damage` : "",
      h.curado ? `${cifra(h.curado)} HP recovered` : "",
    ].filter(Boolean);
    return piezas.length ? `<div class="hechos">${piezas.map((p) => `<span class="insignia">${escapar(p)}</span>`).join("")}</div>` : "";
  };

  const notas = (lista) => pocos(lista).map(([nombre, de, frase, medido]) => `
    <li class="fila nt">
      <div class="fila-texto">
        <p class="fila-titulo">${escapar(nombre)} <span class="nota">${escapar(de)}</span></p>
        <p class="fila-sub">${escapar(frase)}</p>
        ${hechos(medido)}
      </div>
    </li>`).join("");

  const movimientos = pocos(r.movimientos).map(([nombre, de, usos, frase]) => `
    <li class="fila nt">
      <div class="fila-texto">
        <p class="fila-titulo">${escapar(nombre)} <span class="nota">${escapar(de)}</span></p>
        <p class="fila-sub">${escapar(frase)}</p>
      </div>
      <span class="fila-valor">${usosTexto(usos)}</span>
    </li>`).join("");

  const consejos = pocos(r.consejos).map((c, i) => `
    <li class="fila nt"><span class="insignia acento">${i + 1}</span><p class="fila-texto">${escapar(c)}</p></li>`).join("");

  // La gráfica: x reparte los turnos, y va del mínimo (o 40) al 100. 326 px de ancho: el interior de la tarjeta en un móvil de 390.
  function grafica() {
    const W = 326;
    const H = 168;
    const m = 20;
    const n = Math.max(1, prob.length - 1);
    const bajo = Math.min(40, ...prob);
    const X = (i) => m + (i * (W - 2 * m)) / n;
    const Y = (v) => H - m - ((v - bajo) / (100 - bajo)) * (H - 2 * m);
    const trazo = prob.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
    const marcas = momentos.map((mo, i) => `
      <a class="mk" href="${aDecision(mo.turno)}" aria-label="Key moment ${i + 1}: ${escapar(mo.titulo)}, turn ${mo.turno}" transform="translate(${X(mo.turno).toFixed(1)},${Y(prob[mo.turno] ?? 0).toFixed(1)})">
        <circle class="toque" r="22"/><circle class="punto" r="10"/><text y="4" text-anchor="middle">${i + 1}</text>
      </a>`).join("");
    return `
      <svg class="grafica" viewBox="0 0 ${W} ${H}" role="group" aria-label="AI win estimate by turn: from ${prob[0]}% to ${prob[n]}%">
        <line class="gd" x1="${m}" x2="${W - m}" y1="${Y(50)}" y2="${Y(50)}"/><text class="ax" x="${W - m}" y="${Y(50) - 5}" text-anchor="end">50%</text>
        <text class="ax" x="${m}" y="${H - 2}">Start</text><text class="ax" x="${W - m}" y="${H - 2}" text-anchor="end">Turn ${n}</text>
        <path class="area" d="${trazo}L${X(n)},${H - m}L${X(0)},${H - m}Z"/><path class="linea" d="${trazo}"/>
        ${marcas}<circle class="fin" cx="${X(n)}" cy="${Y(prob[n] ?? 0)}" r="4"/>
      </svg>`;
  }

  const guardado = Boolean(combate.guardadoId && leer().combates.some((c) => c.id === combate.guardadoId));
  const sinFormato = !formatoId; // una sesión vieja: no se sabe en qué formato se jugó
  const subtitulo = [formato, "Simulated"].filter(Boolean).map(escapar).join(" · ");

  let botonGuardar = "";
  if (!ejemplo) {
    botonGuardar = `
      <button type="button" class="boton secundario" data-accion="guardar"${guardado || sinFormato ? " disabled" : ""}>${guardado ? `${icono("hecho")} Saved to Matches` : "Save to Matches"}</button>`;
  }

  const secundarias = (titulo, lista) => (lista ? `<section class="seccion">${tituloSeccion(titulo)}<ul class="tarjeta sin-relleno lista">${lista}</ul></section>` : "");

  vista.innerHTML = `
    <div class="v-sim-resultado">
      ${cabeceraDetalle({ titulo: "Battle analysis", subtitulo, volver: `#/simulador/combate${sufijo}` })}

      <section class="seccion">
        <div class="tarjeta resultado">
          <p class="resultado-titulo ${victoria ? "gana" : "pierde"}">${victoria ? "Victory" : "Defeat"} ${escapar(r.marcador)} in ${turnosTexto(r.turnos)}</p>
          <p class="resultado-rival">vs. ${escapar(combate.rival.nombre)}</p>
          ${combate.previa?.prob != null ? `<p class="nota">Estimated win probability before the battle: ${combate.previa.prob}%</p>` : ""}
          ${combate.comoIndividual ? `<p class="como-individual"><span class="insignia acento">${AVISO_INDIVIDUAL}</span> <span class="nota">${escapar(formato || "This format")} is a doubles format; the simulator plays one against one.</span></p>` : ""}
        </div>
      </section>

      <section class="seccion">
        ${tituloSeccion("AI win estimate")}
        <div class="tarjeta">
          ${grafica()}
          <p class="nota">The AI's own estimate of who is ahead each turn, from Pokémon left, HP and matchups. It is not a measured probability.</p>
          ${momentos.length ? `<p class="nota">Tap a number to see that turn in the AI's move.</p>` : ""}
        </div>
        ${listaMomentos ? `<ul class="tarjeta sin-relleno lista momentos">${listaMomentos}</ul>` : ""}
      </section>

      ${r.mvp || r.cierre ? `
      <section class="seccion">
        ${tituloSeccion("Player of the match")}
        <ul class="tarjeta sin-relleno lista">${destacado(r.mvp, "Best of the battle")}${destacado(r.cierre, "Closed it out")}</ul>
      </section>` : ""}

      <section class="seccion">
        ${tituloSeccion("Team performance")}
        <ul class="tarjeta sin-relleno lista">${rendimiento}</ul>
        <p class="nota">${escapar(combate.rival.nombre)} (opponent), final HP</p>
        <ul class="tarjeta sin-relleno lista equipo">${equipo("rival")}</ul>
      </section>

      ${consejos ? `<section class="seccion">${tituloSeccion("Tips")}<ol class="tarjeta sin-relleno lista">${consejos}</ol></section>` : ""}

      ${seccionQuienJuega(combate) ? `<section class="seccion">${seccionQuienJuega(combate)}</section>` : ""}

      ${secundarias("Items", r.objetos?.length ? notas(r.objetos) : "")}
      ${secundarias("Abilities", r.habilidades?.length ? notas(r.habilidades) : "")}
      ${secundarias("Moves", r.movimientos?.length ? movimientos : "")}

      <section class="seccion cien" hidden>${tituloSeccion("100 battles")}<div class="tarjeta" data-zona="cien"></div></section>

      <section class="seccion acciones">
        <div class="botones-fila">
          <a class="boton" href="#/simulador/combate${sufijo}" data-accion="repetir">Replay</a>
          <a class="boton secundario" href="#/simulador/rival${sufijo}">Change opponent</a>
          ${botonGuardar}
        </div>
        ${sinFormato && !guardado && !ejemplo ? `<p class="nota">This battle has no format (it comes from an old session). Replay it to be able to save it to Matches.</p>` : ""}
      </section>
    </div>`;

  activar(vista);

  // ---- Botones
  // Repetir: sin combate en la sesión, la pantalla del combate juega uno nuevo. Con ?ejemplo la sesión no se toca (N3)
  vista.querySelector('[data-accion="repetir"]').addEventListener("click", () => {
    if (!ejemplo) elegir({ combate: null });
  }); // el enlace sigue su camino
  let guardando = false;
  vista.querySelector('[data-accion="guardar"]')?.addEventListener("click", (evento) => {
    const boton = evento.currentTarget;
    if (guardando || boton.disabled || !formatoId) return;
    if (combate.guardadoId && leer().combates.some((c) => c.id === combate.guardadoId)) return;
    guardando = true;
    boton.disabled = true; // un doble toque no guarda dos veces
    const id = nuevoId();
    const nombres = (lado) => combate[lado].equipo.map((p) => p.nombre);
    guardar((e) => e.combates.push({
      id,
      fecha: Date.now(),
      resultado: victoria ? "victoria" : "derrota",
      formato: formatoId,
      formatoNombre: formato,
      rival: combate.rival.nombre,
      miEquipo: nombres("yo"),
      equipoRival: nombres("rival"),
      equipoId: combate.equipoId ?? null,
      notas: `Simulated · ${r.marcador} in ${turnosTexto(r.turnos)}`,
      repeticion: null,
      rating: null,
      simulado: true,
    }));
    combate.guardadoId = id; // así este mismo combate no se guarda dos veces
    elegir({ combate });
    boton.innerHTML = `${icono("hecho")} Saved to Matches`;
    avisar("Battle saved to Matches"); // se queda en el análisis, con el botón marcado
  });

  if (!ejemplo) cienCombates();

  // ---- 100 combates: los otros 99 los juega js/sim/index.js en segundo plano desde que se simula el primero
  // (con la IA completa, no los rápidos de la previsión). Aquí se ve por dónde van y se pueden parar o seguir.
  function cienCombates() {
    const seccion = vista.querySelector(".cien");
    const zona = vista.querySelector('[data-zona="cien"]');
    seguirSerie(combate); // con la opción «100 combates» la empieza si no estaba; si se recargó la página, sigue
    if (!combate.cien) return;
    seccion.hidden = false;
    const cien = combate.cien;

    function pintarCien() {
      const enMarcha = serieEnCurso(combate);
      const jugados = cien.ganados.length;
      const ganas = cien.ganados.filter(Boolean).length;
      const minimo = Math.min(...cien.duraciones);
      const maximo = Math.max(...cien.duraciones);
      const ancho = Math.max(1, Math.ceil((maximo - minimo + 1) / 6));
      const cubos = new Map();
      for (const d of cien.duraciones) {
        const cubo = minimo + Math.floor((d - minimo) / ancho) * ancho;
        cubos.set(cubo, (cubos.get(cubo) ?? 0) + 1);
      }
      const mayor = Math.max(...cubos.values());
      const barras = [...cubos].sort((a, b) => a[0] - b[0]).map(([desde, cuantos]) => `
        <li><span class="nota">${ancho === 1 ? turnosTexto(desde) : `${desde}–${desde + ancho - 1} turns`}</span>${barra(cuantos / mayor)}<span class="rd-cifra">${cuantos}</span></li>`).join("");
      const acabado = jugados >= TOTAL_CIEN;
      const estado = acabado ? "Complete" : enMarcha ? "Simulating…" : cien.fallo ? "Interrupted" : "Stopped";
      zona.innerHTML = `
        <p class="cien-cifra">You won <b>${ganas}</b> of ${jugados} · ${Math.round((100 * ganas) / jugados)}%</p>
        <div class="cien-progreso" role="progressbar" aria-label="Simulated battles" aria-valuemin="0" aria-valuemax="${TOTAL_CIEN}" aria-valuenow="${jugados}">${barra(jugados / TOTAL_CIEN)}</div>
        <div class="cien-estado"><span class="nota">${estado} ${jugados}/${TOTAL_CIEN}</span>${acabado ? "" : `<button type="button" class="boton secundario pequeno" data-accion="${enMarcha ? "parar" : "seguir"}">${enMarcha ? "Stop" : "Continue"}</button>`}</div>
        <ul class="reparto" aria-label="Turns distribution">${barras}</ul>
        <p class="nota">Full battles with the same AI as the one you saw; the first is that one.</p>
        ${cien.fallo ? `<p class="cien-aviso">Not all the battles could be simulated.</p>` : ""}`;
      activar(zona);
    }

    const dejar = escucharSerie((cual) => {
      if (!vigente() || !zona.isConnected) return dejar();
      if (cual === combate) pintarCien();
    });

    zona.addEventListener("click", (evento) => {
      const accion = evento.target.closest("[data-accion]")?.dataset.accion;
      if (accion === "parar") pararSerie(combate); // el combate que está a medias termina y ahí se queda
      if (accion === "seguir") seguirSerie(combate, true);
      pintarCien();
    });

    pintarCien();
  }
}
