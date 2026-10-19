// Movimiento de la app: sobrio, como el de una app nativa. Solo transform, opacity y colores, de 150 a 300 ms.
// Nada depende de que una animación termine: todas son Web Animations con fill «backwards» (el contenido ya
// está en su sitio y la animación solo parte de otro punto) y con «reducir movimiento» no se lanza ninguna.
// Lo que va en CSS (pulsar, plegables, hojas, avisos, tema) está en css/estilos.css. Ver COMPONENTES.md.

const reducido = window.matchMedia("(prefers-reduced-motion: reduce)");
const DURACION = { barra: 300, pantalla: 220, elemento: 180, aparicion: 220, rebote: 280 };
const SALIDA = "ease-in";
const ENTRADA = "ease-out";
const ESCALONADOS = ".lista > li, .torneos-lista > *, .nucleos > *, .recientes > *, .dex-favoritos > *, .eq-equipos > *, .rivales > *";
const MAXIMO_ESCALONADOS = 10; // solo los primeros: lo que está más abajo no se ve entrar
const PASO_ESCALONADO = 25;    // ms entre un elemento y el siguiente
const VENTANA_ESCALONADO = 4000; // ms tras entrar en una pantalla durante los que aún se escalona su primera lista

/** true si el móvil tiene activado «reducir movimiento». */
export function sinMovimiento() {
  return reducido.matches;
}

// Lanza una animación que parte de «desde» y acaba en el estado normal del elemento (el fotograma final es el implícito)
function lanzar(el, desde, opciones) {
  if (sinMovimiento() || !el?.animate) return null;
  return el.animate([desde], { easing: ENTRADA, fill: "backwards", ...opciones });
}

// ---------------------------------------------------------------------------
// Barras (data-llenar)

// data-llenar="0.62": fracción de 0 a 1 a la que se queda el relleno de una barra
function fraccion(el) {
  return Math.min(1, Math.max(0, Number(el.dataset.llenar) || 0));
}

const activados = new WeakSet(); // para que llamar dos veces a activar() no repita el llenado

/**
 * Llena las barras marcadas con data-llenar dentro de «raiz» (y la propia raíz). Se llama después de
 * escribir el HTML; se puede llamar otra vez tras repintar un trozo. Con «reducir movimiento», sin animar.
 */
export function activar(raiz = document.body) {
  const selector = "[data-llenar]";
  const barras = [...(raiz.matches?.(selector) ? [raiz] : []), ...raiz.querySelectorAll(selector)]
    .filter((el) => !activados.has(el));
  for (const el of barras) {
    activados.add(el);
    el.style.transformOrigin = "0 50%";
    el.style.transform = `scaleX(${fraccion(el)})`;
    if (!sinMovimiento() && el.animate) {
      el.animate([{ transform: "scaleX(0)" }], { duration: DURACION.barra, easing: ENTRADA, fill: "backwards" });
    }
  }
}

// ---------------------------------------------------------------------------
// Piezas sueltas para las pantallas

/** Un elemento que acaba de aparecer (un miembro nuevo del equipo): sube desde un poco más pequeño. */
export function entrar(el, retraso = 0) {
  lanzar(el, { opacity: 0, transform: "scale(0.9)" }, { duration: DURACION.aparicion, delay: retraso });
}

/** Un elemento que va a desaparecer: se encoge y se desvanece. Devuelve una promesa que se cumple al acabar. */
export function salir(el) {
  if (sinMovimiento() || !el?.animate) return Promise.resolve();
  const animacion = el.animate(
    [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.9)" }],
    { duration: DURACION.elemento, easing: SALIDA, fill: "forwards" },
  );
  // Si la animación no llegara a terminar (pestaña en segundo plano), la promesa se cumple igualmente
  return Promise.race([animacion.finished.catch(() => {}), new Promise((ok) => setTimeout(ok, DURACION.elemento + 120))]);
}

/** Pequeño rebote del icono de la estrella al marcar un favorito. */
export function rebotar(el) {
  if (sinMovimiento() || !el?.animate) return;
  el.animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.3)", offset: 0.4 }, { transform: "scale(1)" }],
    { duration: DURACION.rebote, easing: ENTRADA },
  );
}

// ---------------------------------------------------------------------------
// Entrada de pantalla

const estado = { entrada: false, escalonar: false, hasta: 0 };
let observador = null;

/**
 * La llama app.js al ir a una pantalla, antes de pintarla. «animar» es false cuando se repinta la misma
 * pantalla (cambio de formato) y en el simulador. Cuando la pantalla escribe su HTML en la vista:
 *  - la pantalla entra con un desplazamiento pequeño y opacidad;
 *  - la primera lista o rejilla que aparezca (hasta 4 s después) entra de forma escalonada;
 *  - lo que sustituye a un «cargando» entra con un fundido corto.
 * Con «reducir movimiento» no hace nada, y sin animación todo se ve desde el principio.
 */
export function entrarPantalla(vista, { animar = true } = {}) {
  vigilarTema();
  estado.entrada = animar;
  estado.escalonar = animar;
  estado.hasta = performance.now() + VENTANA_ESCALONADO;
  if (!observador) {
    observador = new MutationObserver((registros) => alPintar(vista, registros));
    observador.observe(vista, { childList: true, subtree: true });
  }
}

function alPintar(vista, registros) {
  if (sinMovimiento()) return;
  for (const registro of registros) {
    const nuevos = [...registro.addedNodes].filter((nodo) => nodo.nodeType === 1);
    if (!nuevos.length) continue;
    if (registro.target === vista) {
      if (estado.entrada) {
        estado.entrada = false;
        lanzar(nuevos[0], { opacity: 0, transform: "translateY(8px)" }, { duration: DURACION.pantalla });
      }
    } else if ([...registro.removedNodes].some((nodo) => nodo.matches?.(".cargando"))) {
      for (const nodo of nuevos) lanzar(nodo, { opacity: 0, transform: "translateY(6px)" }, { duration: DURACION.aparicion });
    }
  }
  if (estado.escalonar && performance.now() < estado.hasta && escalonar(vista)) estado.escalonar = false;
}

// Hace entrar uno tras otro los primeros elementos visibles de las listas; devuelve true si había alguno
function escalonar(raiz) {
  const visibles = [...raiz.querySelectorAll(ESCALONADOS)].filter((el) => {
    const caja = el.getBoundingClientRect();
    return caja.height > 0 && caja.top < window.innerHeight;
  }).slice(0, MAXIMO_ESCALONADOS);
  visibles.forEach((el, i) => lanzar(el, { opacity: 0, transform: "translateY(6px)" }, { duration: DURACION.elemento, delay: i * PASO_ESCALONADO }));
  return visibles.length > 0;
}

// ---------------------------------------------------------------------------
// Cambio de tema: durante un momento, los colores pasan de uno a otro (la regla está en estilos.css)

let vigilandoTema = false;
let temporizadorTema = 0;

// Se activa en la primera pantalla, ya aplicado el tema guardado: así al abrir la app no hay transición
function vigilarTema() {
  if (vigilandoTema) return;
  vigilandoTema = true;
  const raiz = document.documentElement;
  new MutationObserver(() => {
    if (sinMovimiento()) return;
    raiz.classList.add("cambia-tema");
    clearTimeout(temporizadorTema);
    temporizadorTema = setTimeout(() => raiz.classList.remove("cambia-tema"), 300);
  }).observe(raiz, { attributes: true, attributeFilter: ["data-theme"] });
}

// ---------------------------------------------------------------------------
// Plegables: al abrirse con un toque, el contenido aparece con un fundido corto (al cerrarse, de golpe, como en el
// navegador). Solo cuando abre el usuario: un <details open> recién pintado no se anima.

let plegableTocado = null;

document.addEventListener("click", (evento) => {
  plegableTocado = evento.target.closest?.("details.plegable > summary")?.parentElement ?? null;
}, true);

document.addEventListener("toggle", (evento) => {
  const plegable = evento.target;
  if (plegable !== plegableTocado || !plegable.open) return;
  plegableTocado = null;
  for (const hijo of plegable.children) {
    if (hijo.tagName !== "SUMMARY") lanzar(hijo, { opacity: 0, transform: "translateY(-6px)" }, { duration: DURACION.elemento });
  }
}, true);
