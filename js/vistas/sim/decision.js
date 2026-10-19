// Simulador · la jugada de la IA, turno a turno (#/simulador/decision/8). Diseño simple: tarjetas planas.
// Trabaja con sesion.combate (forma en disenos/implementacion/CONTRATO-SIMULADOR.md); con ?ejemplo usa el combate de ejemplo.
import { escapar, sprite, barra, icono, listaTipos, insigniaTipo, cabeceraDetalle, tituloSeccion } from "../../ui.js";
import { nombreTipo, ETIQUETAS } from "../../tipos.js";
import { activar } from "../../movimiento.js";
import { sesion, simular } from "../../sim/index.js";

// La clase del movimiento viene del diccionario (en español o en inglés): siempre se enseña en inglés
const CLASES = { Físico: "Physical", Especial: "Special", Estado: "Status" };

export async function pintar(vista, { parametros, consulta, vigente }) {
  // Con ?ejemplo, simular() devuelve el combate de ejemplo (sin guardarlo en la sesión)
  const combate = consulta.has("ejemplo") ? await simular() : sesion.combate;
  if (!vigente()) return;
  if (!combate?.turnos?.length) {
    location.replace("#/simulador"); // sin combate no hay nada que explicar
    return;
  }

  const turnos = combate.turnos;
  const total = turnos.length;
  const prob = combate.prob ?? [];
  const sufijo = consulta.has("ejemplo") ? "?ejemplo" : ""; // se conserva ?ejemplo en los enlaces
  // Desde el análisis se entra con ?desde=analisis: la vuelta (data-volver) lleva al análisis, no al combate (N5)
  const desdeAnalisis = consulta.get("desde") === "analisis";
  const consultaPropia = location.hash.includes("?") ? `?${location.hash.split("?")[1]}` : ""; // la de esta dirección, tal cual
  const pedido = Number.parseInt(parametros[1], 10);
  let actual = pedido >= 1 && pedido <= total ? pedido : (turnos.find((t) => t.clave)?.n ?? 1);

  const luchador = (lado, nombre) => combate[lado].equipo.find((p) => p.nombre === nombre) ?? { nombre, id: null, tipos: [] };

  // Los PS y los activos al empezar y al acabar el turno n, rehaciendo los eventos de los turnos anteriores
  function estado(n) {
    const hp = { yo: {}, rival: {} };
    const activo = {};
    for (const lado of ["yo", "rival"]) {
      for (const p of combate[lado].equipo) hp[lado][p.nombre] = 100;
    }
    const aplicar = (e) => {
      if (e.da) hp[e.da[0]][e.da[1]] = e.da[3];
      if (e.t === "entra") activo[e.lado] = e.p;
      if (e.t === "cambio") activo[e.lado] = e.entra;
    };
    for (let i = 0; i < n - 1; i++) turnos[i].eventos.forEach(aplicar);
    const eventos = turnos[n - 1].eventos;
    let k = 0;
    while (eventos[k]?.t === "entra") aplicar(eventos[k++]); // los que salen al campo antes de que nadie actúe
    const inicio = structuredClone({ hp, activo });
    eventos.slice(k).forEach(aplicar);
    for (const lado of ["yo", "rival"]) inicio.activo[lado] ??= combate[lado].equipo[0]?.nombre;
    return { inicio, fin: { hp, activo } };
  }

  // Un evento convertido en texto: { cabecera, etiqueta?, nota?, meta?, ko? }
  function describir(e) {
    const P = (nombre) => `<b>${escapar(nombre)}</b>`;
    const dano = e.da ? `${e.da[1]} ${e.da[2]} → ${e.da[3]}%` : ""; // texto sin escapar: se escapa al usarlo
    const ef = e.ef === undefined ? "" : (ETIQUETAS[e.ef] ?? "");
    switch (e.t) {
      case "entra": return { cabecera: `${P(e.p)} enters the field` };
      case "cambio": return { cabecera: `${P(e.sale)} switches out · ${P(e.entra)} switches in` };
      case "mov": return {
        cabecera: `${P(e.p)} uses ${escapar(e.n)}`,
        nota: e.txt,
        meta: [CLASES[e.clase] ?? e.clase, e.tipo ? nombreTipo(e.tipo) : "", e.ef === 0 ? "Doesn't affect" : ef, dano].filter(Boolean).map(escapar).join(" · "),
      };
      case "hab": case "obj": return {
        cabecera: P(e.p),
        etiqueta: { tipo: e.t === "hab" ? "Ability" : "Item", texto: `<b>${escapar(e.n)}</b> · ${escapar(e.txt)}` },
        meta: escapar(dano),
      };
      case "estado": return { cabecera: `${P(e.p)}: ${escapar(e.n)}`, nota: e.txt, meta: escapar(dano) };
      case "rocas": return { cabecera: `${escapar(e.n ?? "Stealth Rock")} hurts ${P(e.p)}`, meta: [ef, dano].filter(Boolean).map(escapar).join(" · ") };
      case "tera": return { cabecera: `${P(e.p)} Terastallizes into ${insigniaTipo(e.tipo)}` };
      case "ko": return { cabecera: `${P(e.p)} faints`, ko: true };
      case "fin": return { cabecera: `${e.gana === "yo" ? "Your team wins" : "Opponent wins"}`, lado: e.gana };
      default: return { cabecera: escapar(e.txt ?? e.t) }; // un evento que no conozco: una línea de texto y a seguir
    }
  }

  // ---- La curva de la tira: x reparte los turnos (0 es antes de empezar); y va según la probabilidad
  const W = 326; // el interior de la tarjeta en un móvil de 390 px
  const H = 72;
  const m = 8;
  const minimo = Math.min(...prob);
  const maximo = Math.max(...prob);
  const rango = Math.max(maximo - minimo, 20);
  const base = minimo - (rango - (maximo - minimo)) / 2;
  const X = (n) => m + (n * (W - 2 * m)) / total;
  const Y = (p) => H - m - ((p - base) / rango) * (H - 2 * m);

  const trazo = prob.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p).toFixed(1)}`).join("");
  const claves = turnos.filter((t) => t.clave).map((t) => `<circle class="kl" cx="${X(t.n).toFixed(1)}" cy="${Y(prob[t.n] ?? 0).toFixed(1)}" r="4"/>`).join("");
  const celdas = turnos.map((t) => `
    <button type="button" data-n="${t.n}" class="celda${t.clave ? " clave" : ""}" aria-label="Turn ${t.n}, ${prob[t.n]}%${t.clave ? ", key moment" : ""}">
      <b>${t.n}</b><small>${prob[t.n]}%</small>
    </button>`).join("");

  // ---- Esqueleto fijo: la cabecera, la tira y los botones no se repintan al cambiar de turno
  const cabecera = cabeceraDetalle({
    titulo: "AI Decision",
    subtitulo: `<span data-zona="subtitulo"></span>`,
    volver: desdeAnalisis ? `#/simulador/resultado${sufijo}` : `#/simulador/combate${sufijo}`,
    acciones: `
      <button type="button" class="boton-icono" id="anterior" aria-label="Previous turn">${icono("anterior")}</button>
      <button type="button" class="boton-icono" id="siguiente" aria-label="Next turn">${icono("siguiente")}</button>`,
  });

  vista.innerHTML = `
    <div class="v-sim-decision">
      ${cabecera}
      <section class="seccion" data-zona="situacion" aria-label="Turn state" aria-live="polite"></section>
      <section class="seccion">
        ${tituloSeccion("Evaluated Options")}
        <p class="nota">AI score from 0 to 100 for each option.</p>
        <ol class="opciones" data-zona="opciones"></ol>
      </section>
      <section class="seccion" data-zona="porque"></section>
      <section class="seccion">
        ${tituloSeccion("What Happened This Turn")}
        <ol class="tarjeta sin-relleno lista" data-zona="eventos"></ol>
      </section>
      <section class="seccion">
        ${tituloSeccion(total === 1 ? "The Only Turn" : `All ${total} Turns`)}
        <div class="tarjeta">
          <svg class="curva" viewBox="0 0 ${W} ${H}" role="img" aria-label="Turn-by-turn AI win estimate, from ${prob[0]}% to ${prob[total]}%">
            <path class="curva-linea" d="${trazo}"/>${claves}<circle class="cur" r="5"/>
          </svg>
          <p class="nota">Line: the AI's estimate of your chances. Hollow dots and marked cells are key moments.</p>
        </div>
        <div class="celdas">${celdas}</div>
      </section>
      <section class="seccion pie-sim">
        <div class="botones-fila">
          ${desdeAnalisis
            ? `<a class="boton secundario" href="#/simulador/resultado${sufijo}" data-volver>Back to analysis</a>`
            : `<a class="boton secundario" href="#/simulador/combate${sufijo}" data-volver>Back to battle</a>
          <a class="boton" href="#/simulador/resultado${sufijo}">See analysis</a>`}
        </div>
      </section>
    </div>`;

  const zona = (nombre) => vista.querySelector(`[data-zona="${nombre}"]`);
  const botones = [...vista.querySelectorAll(".celda")];
  const cursor = vista.querySelector(".cur");
  const curva = vista.querySelector(".curva");

  // ---- Los bloques que cambian con el turno
  function bloqueEquipo(lado, E) {
    const nombre = E.inicio.activo[lado];
    const p = luchador(lado, nombre);
    const antes = E.inicio.hp[lado][nombre] ?? 100;
    const despues = E.fin.hp[lado][nombre] ?? antes;
    return `
      <div class="tarjeta activo">
        <p class="nota">${lado === "yo" ? "Your team" : "Opponent"}</p>
        ${sprite(p.nombre, { id: p.id, clase: "grande con-fondo" })}
        <p class="fila-titulo">${escapar(p.nombre)}</p>
        <span class="tipos">${listaTipos(p.tipos)}</span>
        <div class="activo-ps"><span class="fila-valor">${despues}%</span>${barra(despues / 100)}</div>
        <p class="nota">${antes === despues ? "No damage this turn" : `Before: ${antes}%`}</p>
      </div>`;
  }

  function pintarTurno(n) {
    const t = turnos[n - 1];
    const E = estado(n);
    const jugada = t.ia?.yo ?? {};
    const opciones = jugada.opciones ?? [];
    const rival = t.ia?.rival;
    const cambio = (prob[n] ?? 0) - (prob[n - 1] ?? prob[n] ?? 0);
    const marcador = t.marcador ?? [0, 0];
    const elegida = Math.max(0, opciones.findIndex(([texto]) => texto === jugada.elige));

    zona("subtitulo").textContent = `Turn ${n} of ${total}${t.clave ? " · key moment" : ""}`;

    zona("situacion").innerHTML = `
      <div class="activos">
        ${bloqueEquipo("yo", E)}
        ${bloqueEquipo("rival", E)}
      </div>
      <div class="tarjeta prob">
        <div class="prob-cabeza">
          <span class="nota">AI win estimate</span>
          <span class="fila-valor">${prob[n] ?? 0}% <span class="insignia ${cambio < 0 ? "error" : "exito"}">${cambio < 0 ? "−" : "+"}${Math.abs(cambio)} pts</span></span>
        </div>
        ${barra((prob[n] ?? 0) / 100)}
        <p class="nota">At the end of the turn, ${marcador[0]} of your Pokémon and ${marcador[1]} of the opponent's remain.</p>
      </div>`;

    zona("opciones").innerHTML = opciones.length ? opciones.map(([texto, nota, motivo], i) => `
      <li class="tarjeta op${i === elegida ? " sel" : ""}">
        <div class="op-cabeza">
          <span class="insignia${i === elegida ? " acento" : ""}">${i + 1}</span>
          <p class="fila-titulo">${escapar(texto)}</p>
          <span class="fila-valor">${nota}</span>
        </div>
        ${barra(nota / 100)}
        <p class="fila-sub">${i === elegida ? "Chosen · " : ""}${escapar(motivo)}</p>
      </li>`).join("") : `<li><p class="nada">The AI did not save options for this turn.</p></li>`;

    zona("porque").innerHTML = `
      <div class="tarjeta porque">
        <p class="nota">AI picks</p>
        <p class="elige">${escapar(jugada.elige ?? "—")}</p>
        <p>${escapar(jugada.porque ?? "")}</p>
      </div>
      ${rival ? `
      <div class="tarjeta porque">
        <p class="nota">Opponent expected</p>
        <p class="elige">${escapar(rival.elige)}</p>
        <p>${escapar(rival.porque ?? "")}</p>
      </div>` : ""}`;

    zona("eventos").innerHTML = t.eventos.map((e) => {
      const x = describir(e);
      const lado = x.lado ?? e.lado;
      return `
        <li class="ev">
          <span class="insignia${lado === "yo" ? " acento" : ""}">${lado === "yo" ? "You" : lado === "rival" ? "Opponent" : "—"}</span>
          <div class="ev-texto">
            <p${x.ko ? ` class="ko"` : ""}>${x.cabecera}</p>
            ${x.etiqueta ? `<p class="fila-sub"><span class="insignia">${x.etiqueta.tipo}</span> ${x.etiqueta.texto}</p>` : ""}
            ${x.nota ? `<p class="fila-sub">${escapar(x.nota)}</p>` : ""}
            ${x.meta ? `<p class="nota">${x.meta}</p>` : ""}
          </div>
        </li>`;
    }).join("");

    for (const b of botones) {
      const activa = Number(b.dataset.n) === n;
      b.setAttribute("aria-pressed", String(activa));
      if (activa) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    }
    vista.querySelector("#anterior").disabled = n === 1;
    vista.querySelector("#siguiente").disabled = n === total;
    cursor.setAttribute("cx", X(n).toFixed(1));
    cursor.setAttribute("cy", Y(prob[n] ?? 0).toFixed(1));
    activar(vista);
    history.replaceState(history.state, "", `#/simulador/decision/${n}${consultaPropia}`); // la dirección cambia sin repintar
  }

  let pintado = false;
  function ir(n) {
    n = Math.max(1, Math.min(total, n));
    if (n === actual && pintado) return;
    actual = n;
    pintado = true;
    pintarTurno(n);
  }

  vista.querySelector("#anterior").addEventListener("click", () => ir(actual - 1));
  vista.querySelector("#siguiente").addEventListener("click", () => ir(actual + 1));
  vista.querySelector(".celdas").addEventListener("click", (evento) => {
    const boton = evento.target.closest("button[data-n]");
    if (boton) ir(Number(boton.dataset.n));
  });
  curva.addEventListener("click", (evento) => {
    const caja = curva.getBoundingClientRect();
    const x = ((evento.clientX - caja.left) / caja.width) * W; // en las unidades del dibujo
    ir(Math.round(((x - m) / (W - 2 * m)) * total));
  });

  ir(actual);
}
