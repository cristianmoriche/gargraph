// Resumen del combate simulado: la previa, la curva de probabilidad y el análisis del final.
// Todo sale de los eventos de los turnos jugados y del estado del motor; no decide nada ni usa el DOM.
// El contrato está en disenos/implementacion/CONTRATO-SIMULADOR.md.
//
//   previa(estado, prob)              → { prob, notas, velocidad }   // con el estado recién creado
//   curva(estaticas, prob, gana)      → [prob antes de empezar, prob al acabar el turno 1, …]
//   resumir(combate, estado, trampas) → Resumen                      // y marca los turnos clave
//
// Objetos y habilidades: [nombre, de quién, frase, hechos]. «hechos» es lo medido ({ veces, dano, curado }) o null;
// no hay notas de 0 a 100. Las pantallas que reciban un número en ese cuarto lugar (el combate de ejemplo) lo ignoran.
import { nombreHabilidad, nombreObjeto } from "../meta.js";
import { ETIQUETAS, nombreTipo } from "../tipos.js";
import { enfrentar, primeraFrase, velocidadDe } from "./ia.js";

const LADOS = ["yo", "rival"];
const ELECCION = ["choiceband", "choicespecs", "choicescarf"];
// Objetos que dejan un evento cada vez que actúan: si no hay ninguno, es que no llegaron a activarse
const SE_NOTAN = [
  "rockyhelmet", "leftovers", "blacksludge", "lifeorb", "redcard", "ejectbutton", "focussash", "powerherb", "custapberry",
  "toxicorb", "flameorb", "stickybarb", "boosterenergy", "grassyseed", "electricseed", "psychicseed", "mistyseed",
];
const NUMEROS = ["zero", "one", "two", "three", "four", "five", "six"];

const limitar = (n, min, max) => Math.min(max, Math.max(min, n));
const enumerar = (nombres) => (nombres.length > 1 ? `${nombres.slice(0, -1).join(", ")} and ${nombres.at(-1)}` : nombres[0] ?? "");
const mayuscula = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);
const etiqueta = (ef) => (ef !== undefined && ef !== 1 ? ` (${ETIQUETAS[ef] ?? `${ef}×`})` : "");

/** Los nombres que están en los dos equipos se distinguen: «your Kingambit» y «opposing Kingambit». */
function nombrador(mios, suyos) {
  const repetidos = new Set(mios.filter((nombre) => suyos.includes(nombre)));
  return (lado, nombre) => (repetidos.has(nombre) ? (lado === "yo" ? `your ${nombre}` : `opposing ${nombre}`) : nombre);
}

// ---------------------------------------------------------------------------
// Antes de empezar

/**
 * La previa, con el estado recién creado: la probabilidad que se le pasa, las notas a favor y en contra
 * (el duelo de líderes, quién gana más unos contra uno y quién es el más rápido) y la lista de velocidades.
 */
export function previa(estado, prob) {
  const mios = estado.lados.yo.equipo;
  const suyos = estado.lados.rival.equipo;
  const nombrar = nombrador(mios.map((p) => p.nombre), suyos.map((p) => p.nombre));
  const aFavor = [];
  const enContra = [];
  const duelos = mios.map((a) => suyos.map((b) => enfrentar(estado, a.indice, b.indice)));
  const golpe = (g) => `${g.n} deals ${Math.round(g.min)}–${Math.round(g.max)}%${etiqueta(g.ef)}`;

  const lideres = duelos[0][0];
  if (lideres.puntos > 0 && lideres.mio) aFavor.push(`${mayuscula(nombrar("yo", mios[0].nombre))} has the lead advantage against ${nombrar("rival", suyos[0].nombre)}: ${golpe(lideres.mio)}.`);
  else if (lideres.puntos < 0 && lideres.suyo) enContra.push(`${mayuscula(nombrar("rival", suyos[0].nombre))} has the lead advantage against ${nombrar("yo", mios[0].nombre)}: ${golpe(lideres.suyo)}.`);

  // Quién gana más unos contra uno, según el daño que hace cada uno y quién pega antes
  const mias = mios.map((p, i) => ({ p, gana: duelos[i].filter((d) => d.puntos > 0).length })).sort((a, b) => b.gana - a.gana)[0];
  const tuyas = suyos.map((p, j) => ({ p, gana: duelos.filter((fila) => fila[j].puntos < 0).length })).sort((a, b) => b.gana - a.gana)[0];
  if (mias.gana === suyos.length && suyos.length > 1) aFavor.push(`No Pokémon on the opposing team beats ${nombrar("yo", mias.p.nombre)} 1v1.`);
  else if (mias.gana * 2 > suyos.length) aFavor.push(`${mayuscula(nombrar("yo", mias.p.nombre))} wins the 1v1 against ${mias.gana} of the ${suyos.length} opposing Pokémon.`);
  if (tuyas.gana === mios.length && mios.length > 1) enContra.push(`No Pokémon on your team beats ${nombrar("rival", tuyas.p.nombre)} 1v1.`);
  else if (tuyas.gana * 2 > mios.length) enContra.push(`${mayuscula(nombrar("rival", tuyas.p.nombre))} wins the 1v1 against ${tuyas.gana} of your ${mios.length} Pokémon.`);

  const velocidad = [...mios, ...suyos].map((p) => [p.nombre, p.lado, velocidadDe(estado, p)]).sort((a, b) => b[2] - a[2]);
  const [rapido, segundo] = velocidad;
  if (segundo && rapido[2] > segundo[2]) {
    if (rapido[1] === "yo") aFavor.push(`${mayuscula(nombrar("yo", rapido[0]))} is the fastest Pokémon in the battle (${rapido[2]} Speed).`);
    else enContra.push(`${mayuscula(nombrar("rival", rapido[0]))} is the fastest Pokémon in the battle (${rapido[2]} Speed), outspeeding your entire team.`);
  }
  return {
    prob,
    notas: [...aFavor.slice(0, 2).map((texto) => ["In favor", texto]), ...enContra.slice(0, 2).map((texto) => ["Against", texto])],
    velocidad,
  };
}

/**
 * La curva de probabilidad de victoria. «estaticas» son las de probabilidad() antes de empezar y al
 * acabar cada turno; «prob», la de antes de empezar (la previsión de varios combates, si la hay). Lo que
 * separa a las dos se va apagando con los turnos: al principio manda la previsión y después, el combate.
 * El último valor es 100 o 0 según quién gane.
 */
export function curva(estaticas, prob, gana) {
  const desfase = prob - estaticas[0];
  const valores = estaticas.map((valor, n) => limitar(Math.round(valor + desfase * 0.85 ** n), 1, 99));
  valores[0] = prob;
  if (gana) valores[valores.length - 1] = gana === "yo" ? 100 : 0;
  return valores;
}

// ---------------------------------------------------------------------------
// Al terminar

/**
 * El resumen del contrato. «combate» trae ya yo, rival, turnos y prob; «estado» es el del motor al
 * terminar; «trampas[n − 1]» dice si el lado de «yo» tenía trampas al empezar el turno n.
 * Marca con clave: true los turnos donde más cambia la probabilidad.
 */
export function resumir(combate, estado, trampas = []) {
  const { turnos, prob } = combate;
  const gana = estado.ganador;
  const nombrar = nombrador(combate.yo.equipo.map((p) => p.nombre), combate.rival.equipo.map((p) => p.nombre));
  const clave = (lado, nombre) => `${lado}|${nombre}`;

  // Lo que hizo cada Pokémon, cada movimiento, cada objeto y cada habilidad, leído de los eventos
  const fichas = new Map();
  for (const lado of LADOS) {
    for (const p of estado.lados[lado].equipo) {
      fichas.set(clave(lado, p.nombre), { lado, nombre: p.nombre, p, ko: 0, dado: 0, recibido: 0, salio: false, caeEn: null, entradas: [] });
    }
  }
  const movimientos = new Map();     // «lado|Pokémon|movimiento» → { lado, de, n, usos, dano, ko, txt }
  const activaciones = new Map();    // «hab u obj|lado|Pokémon|nombre» → { veces, dano, curado, txt }
  const porTrampas = new Map();      // «lado que las sufre|trampa» → { dano, entradas }
  const ultimoGolpe = new Map();     // «lado|Pokémon» → { autor, evento }: lo último que le quitó PS
  const kos = [];                    // { turno, lado, nombre, autor, evento }
  const apuntar = (mapa, id, nuevo) => { if (!mapa.has(id)) mapa.set(id, nuevo); return mapa.get(id); };

  for (const turno of turnos) {
    for (const e of turno.eventos) {
      if (e.t === "fin") continue;
      const entra = e.t === "entra" ? e.p : e.t === "cambio" ? e.entra : null;
      if (entra) {
        const f = fichas.get(clave(e.lado, entra));
        f.salio = true;
        f.entradas.push(turno.n);
      }
      const mov = e.t === "mov" ? apuntar(movimientos, `${e.lado}|${e.p}|${e.n}`, { lado: e.lado, de: e.p, n: e.n, usos: 0, dano: 0, ko: 0, txt: "" }) : null;
      if (mov) {
        mov.usos++;
        if (e.txt) mov.txt = e.txt;
      }
      const activa = e.t === "hab" || e.t === "obj" ? apuntar(activaciones, `${e.t}|${e.lado}|${e.p}|${e.n}`, { veces: 0, dano: 0, curado: 0, txt: "" }) : null;
      if (activa) {
        activa.veces++;
        if (e.txt) activa.txt = e.txt;
      }
      if (e.da) {
        const [lado, nombre, antes, despues] = e.da;
        const baja = antes - despues;
        if (baja > 0) {
          // El daño es de quien actúa si va contra el otro lado; las trampas y el daño residual no son de nadie
          const autor = e.lado !== lado && e.p && e.t !== "rocas" ? fichas.get(clave(e.lado, e.p)) : null;
          fichas.get(clave(lado, nombre)).recibido += baja;
          if (autor) autor.dado += baja;
          if (mov && autor) mov.dano += baja;
          if (activa && autor) activa.dano += baja;
          if (e.t === "rocas") {
            const t = apuntar(porTrampas, `${lado}|${e.n}`, { dano: 0, entradas: 0 });
            t.dano += baja;
            t.entradas++;
          }
          ultimoGolpe.set(clave(lado, nombre), { autor, evento: e });
        } else if (baja < 0 && activa && e.lado === lado) activa.curado -= baja;
      }
      if (e.t === "ko") {
        const golpe = ultimoGolpe.get(clave(e.lado, e.p));
        fichas.get(clave(e.lado, e.p)).caeEn = turno.n;
        if (golpe?.autor) {
          golpe.autor.ko++;
          if (golpe.evento.t === "mov") movimientos.get(`${golpe.evento.lado}|${golpe.evento.p}|${golpe.evento.n}`).ko++;
        }
        kos.push({ turno: turno.n, lado: e.lado, nombre: e.p, autor: golpe?.autor ?? null, evento: golpe?.evento ?? null });
      }
    }
  }

  const deLado = (lado) => [...fichas.values()].filter((f) => f.lado === lado);
  const merito = (f) => f.ko * 60 + f.dado - 0.2 * f.recibido;
  const mios = deLado("yo");
  const enPie = (lado) => deLado(lado).filter((f) => f.caeEn === null).length;
  const comoAcaba = (f) => (!f.salio ? "Did not play" : f.caeEn !== null ? `Fainted on turn ${f.caeEn}` : `${f.p.pct}% HP`);

  // ---- El mejor del combate y quién lo cierra: del lado que gana
  const mejor = deLado(gana ?? "yo").sort((a, b) => merito(b) - merito(a))[0];
  const hizo = [mejor.ko ? `${mejor.ko} ${mejor.ko === 1 ? "KO" : "KOs"}` : "", `${mejor.dado}% damage dealt`].filter(Boolean).join(" and ");
  const mvp = {
    p: mejor.nombre,
    porque: `${mejor.lado === "rival" ? "From the opposing team: " : ""}${mayuscula(hizo)}; ${mejor.caeEn !== null ? `fainted on turn ${mejor.caeEn}` : `finished with ${mejor.p.pct}% HP`}.`,
  };

  const ultimo = kos.at(-1);
  let cierre = null;
  if (ultimo && gana) {
    const victima = nombrar(ultimo.lado, ultimo.nombre);
    if (ultimo.autor) {
      const seguidos = kos.filter((k) => k.autor === ultimo.autor && k.turno > turnos.length - 3).length;
      cierre = {
        p: ultimo.autor.nombre,
        porque: `KO'd ${victima} with ${ultimo.evento.n} on turn ${ultimo.turno}${seguidos > 1 ? `: ${seguidos} KOs in the last three turns` : ""}.`,
      };
    } else {
      const enCampo = estado.lados[gana].equipo[estado.lados[gana].activo];
      cierre = { p: enCampo.nombre, porque: `Was on the field when ${victima} fainted from ${ultimo.evento?.n ?? "accumulated damage"} on turn ${ultimo.turno}.` };
    }
  }

  // ---- Momentos clave: los turnos donde más cambia la probabilidad
  const saltos = turnos.map((turno, i) => ({ turno, delta: prob[i + 1] - prob[i] })).filter((s) => s.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const momentos = saltos.filter((s, i) => i < 2 || Math.abs(s.delta) >= 3).slice(0, 4)
    .map((s) => ({ turno: s.turno.n, ...contar(s.turno, s.delta, kos, nombrar), delta: s.delta }));
  for (const s of saltos.slice(0, 3)) s.turno.clave = true;

  // ---- Objetos y habilidades de tu equipo
  // Cada fila es [nombre, de quién, frase, hechos]; «peso» solo sirve para ordenar y no se enseña
  const conObjeto = [];
  const conHabilidad = [];
  for (const f of mios) {
    const { objeto, habilidad } = f.p.ficha;
    if (objeto) {
      const hecho = hechosDeObjeto(f, objeto, activaciones.get(`obj|yo|${f.nombre}|${nombreObjeto(objeto)}`), trampas);
      if (hecho) conObjeto.push({ peso: hecho.peso, fila: [nombreObjeto(objeto), f.nombre, hecho.frase, hecho.hechos] });
    }
    const activa = habilidad ? activaciones.get(`hab|yo|${f.nombre}|${nombreHabilidad(habilidad)}`) : null;
    if (activa) conHabilidad.push({ peso: pesoDeActivacion(activa), fila: [nombreHabilidad(habilidad), f.nombre, fraseDeActivacion(activa), hechosDeActivacion(activa)] });
  }
  const ordenar = (lista) => lista.sort((a, b) => b.peso - a.peso).map(({ fila }) => fila);
  const objetos = ordenar(conObjeto);
  const habilidades = ordenar(conHabilidad);

  // ---- Los movimientos de tu equipo que más rindieron
  const misMovimientos = [...movimientos.values()].filter((m) => m.lado === "yo").map((m) => {
    const trampa = porTrampas.get(`rival|${m.n}`);        // el daño de las trampas que puso este movimiento
    const partes = [m.dano ? `${m.dano}% damage` : "", m.ko ? `${m.ko} ${m.ko === 1 ? "KO" : "KOs"}` : ""].filter(Boolean);
    if (trampa) partes.push(`${trampa.dano}% total hazard damage across ${trampa.entradas} ${trampa.entradas === 1 ? "switch-in" : "switch-ins"}`);
    return { m, peso: m.dano + 60 * m.ko + (trampa?.dano ?? 0) + m.usos, frase: partes.join(" · ") || m.txt || "No recorded effect" };
  }).sort((a, b) => b.peso - a.peso).slice(0, 4).map(({ m, frase }) => [m.n, m.de, m.usos, frase]);

  // ---- Consejos: solo lo que se ve en el combate
  const consejos = [];
  const sinSalir = mios.filter((f) => !f.salio).map((f) => f.nombre);
  if (gana === "yo" && sinSalir.length) {
    consejos.push(`${enumerar(sinSalir)} never entered the battle: your team won using ${NUMEROS[mios.length - sinSalir.length] ?? mios.length}.`);
  }
  const verdugo = deLado("rival").sort((a, b) => merito(b) - merito(a))[0];
  if (verdugo.ko >= 2) {
    const final = verdugo.caeEn === null ? ` and finished standing at ${verdugo.p.pct}% HP` : "";
    consejos.push(`${mayuscula(nombrar("rival", verdugo.nombre))} KO'd ${verdugo.ko} of your Pokémon${final}: your team lacks a reliable answer to it.`);
  }
  const inutil = objetos.find((o) => o[2] === "Never activated.");
  if (inutil) consejos.push(`${inutil[1]}'s ${inutil[0]} never activated during the battle: try another item and simulate again.`);
  const enBlanco = mios.find((f) => f.salio && f.caeEn !== null && f.dado === 0);
  if (enBlanco) consejos.push(`${enBlanco.nombre} fainted on turn ${enBlanco.caeEn} without dealing any damage.`);

  return {
    gana,
    marcador: `${enPie("yo")} – ${enPie("rival")}`,
    turnos: turnos.length,
    final: Object.fromEntries(LADOS.map((lado) => [lado, estado.lados[lado].equipo.map((p) => [p.nombre, p.pct])])),
    mvp,
    cierre,
    rendimiento: [...mios].sort((a, b) => merito(b) - merito(a)).map((f) => [f.nombre, f.ko, f.dado, f.recibido, comoAcaba(f)]),
    momentos,
    objetos: objetos.slice(0, 4),
    habilidades: habilidades.slice(0, 4),
    movimientos: misMovimientos,
    consejos: consejos.slice(0, 4),
  };
}

/** El título y el texto de un momento clave: lo que más pesa del turno para el lado al que le va bien. */
function contar(turno, delta, kos, nombrar) {
  const favor = delta > 0 ? "yo" : "rival";
  const eventos = turno.eventos;
  const critico = (e) => (/Critical hit/.test(e.txt ?? "") ? " It was a critical hit." : "");

  const ko = kos.find((k) => k.turno === turno.n && k.lado !== favor);
  if (ko) {
    const victima = nombrar(ko.lado, ko.nombre);
    const e = ko.evento;
    if (!ko.autor) return { titulo: `${victima} faints`, txt: e?.n ? `Finished off by ${e.n}.` : "Runs out of HP." };
    const baja = e.da[2] - e.da[3];
    return {
      titulo: `${mayuscula(nombrar(ko.autor.lado, ko.autor.nombre))} KOs ${victima}`,
      txt: `${e.n}${e.t === "mov" ? etiqueta(e.ef) : ""} takes the remaining ${baja}% HP.${critico(e)}`,
    };
  }
  const tera = eventos.find((e) => e.t === "tera" && e.lado === favor);
  if (tera) {
    const golpe = eventos.slice(eventos.indexOf(tera)).find((e) => e.t === "mov" && e.lado === favor && e.p === tera.p && e.da);
    return {
      titulo: `${mayuscula(nombrar(favor, tera.p))}'s ${nombreTipo(tera.tipo)} Terastallization`,
      txt: golpe ? `${golpe.n} deals ${golpe.da[2] - golpe.da[3]}% to ${nombrar(golpe.da[0], golpe.da[1])}.` : `${tera.p} becomes ${nombreTipo(tera.tipo)}-type.`,
    };
  }
  const golpes = eventos.filter((e) => e.da && e.da[0] !== favor && e.da[2] > e.da[3]).sort((a, b) => (b.da[2] - b.da[3]) - (a.da[2] - a.da[3]));
  const e = golpes[0];
  if (e) {
    const baja = e.da[2] - e.da[3];
    const victima = nombrar(e.da[0], e.da[1]);
    if (e.t === "mov" && e.lado === favor) return { titulo: `${mayuscula(nombrar(e.lado, e.p))}'s ${e.n}`, txt: `Deals ${baja}% to ${victima}${etiqueta(e.ef)}.${critico(e)}` };
    return { titulo: `${e.n ?? "Damage"} on ${victima}`, txt: `${mayuscula(victima)} loses ${baja}% HP.` };
  }
  // Sin daño que contar: la jugada de quien sale ganando
  const jugada = turno.ia[favor];
  return { titulo: `${jugada.elige}${favor === "rival" ? " (opponent)" : ""}`, txt: `${primeraFrase(jugada.porque)}.` };
}

/** Lo que hizo un objeto o una habilidad que dejó eventos, en una frase. */
function fraseDeActivacion(a) {
  const veces = a.veces > 1 ? ` across ${a.veces} activations` : "";
  const partes = [a.dano ? `dealt ${a.dano}% to opponents` : "", a.curado ? `recovered ${a.curado}% HP` : ""].filter(Boolean);
  if (partes.length) return `${mayuscula(partes.join(" and "))}${veces}.`;
  if (!a.txt) return `Activated ${a.veces} ${a.veces === 1 ? "time" : "times"}.`;
  const txt = /[.!?]$/.test(a.txt) ? a.txt : `${a.txt}.`; // «…Mega Evolved into X!» ya acaba en signo
  return a.veces > 1 ? `Activated ${a.veces} times. ${txt}` : txt;
}

/** Lo medido de un objeto o una habilidad que dejó eventos: veces que se activó, PS quitados a los rivales y PS recuperados. */
const hechosDeActivacion = (a) => ({ veces: a.veces, dano: a.dano, curado: a.curado });

/** Para ordenar la lista, de más a menos efecto medido (PS quitados y recuperados, y después veces). No se enseña. */
const pesoDeActivacion = (a) => a.dano + a.curado + a.veces / 100;

/**
 * La frase, lo medido y el peso para ordenar de un objeto, o null si no se puede saber qué hizo: los que no
 * dejan eventos (los que suben un tipo, Chaleco Asalto…) no entran en la lista, porque decir que no sirvieron
 * sería inventar. Sin notas de 0 a 100: solo hechos.
 */
function hechosDeObjeto(f, objeto, activa, trampas) {
  if (activa) return { frase: fraseDeActivacion(activa), hechos: hechosDeActivacion(activa), peso: pesoDeActivacion(activa) };
  if (!f.salio) return null;
  if (objeto === "heavydutyboots") {
    const veces = f.entradas.filter((n) => trampas[n - 1]).length;
    return veces
      ? { frase: `Switched in ${veces} ${veces === 1 ? "time" : "times"} with entry hazards on its side without losing HP.`, hechos: null, peso: veces }
      : { frase: "Never switched in while entry hazards were on its side.", hechos: null, peso: -1 };
  }
  if (ELECCION.includes(objeto)) return { frase: `${f.nombre} dealt ${f.dado}% damage while holding it.`, hechos: null, peso: f.dado };
  if (SE_NOTAN.includes(objeto)) return { frase: "Never activated.", hechos: null, peso: -1 };
  return null;
}
