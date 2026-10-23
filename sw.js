// Service worker de Gargraph: guarda una copia de la app en el móvil para que abra al momento
// y funcione sin conexión. APIs del navegador: Service Worker y Cache Storage.
//
// Cuando subas cambios de código, cambia VERSION (por ejemplo, de "2.0.0" a "2.0.1"); la tarea diaria de GitHub
// (.github/workflows/update-data.yml) la sube sola cuando cambian los datos.
// Cuando regeneres los datos mensuales, herramientas/generar-datos.mjs cambia DATOS él solo.
// Así el móvil detecta que hay una versión nueva y la app ofrece actualizarse.
// Los «últimos 7 días» (datos/recientes/) y los torneos de Limitless (datos/torneos/ y datos/formatos/*-torneos.json) cambian cada día
// y se piden primero a Internet (ver redPrimero), para no avisar a diario.
// Los ficheros de cada formato (datos/formatos/ y datos/historico/) son muchos y no se guardan todos al instalar: solo los del formato por
// defecto (Champions VGC M-C), para que la app abra sin conexión la primera vez; los demás se guardan la primera vez que se abren (ver guardarAlAbrir).
const VERSION = "3.4.5";
const DATOS = "2026-09·2026-10-19";

const CACHE_APP = `apex-dex-app-${VERSION}-${DATOS}`;
const CACHE_POKEAPI = "apex-dex-pokeapi";
const CACHE_IMAGENES = "apex-dex-imagenes";
const CACHE_FUENTES = "apex-dex-fuentes";
const MAXIMO_DE_ENTRADAS = { [CACHE_POKEAPI]: 300, [CACHE_IMAGENES]: 800, [CACHE_FUENTES]: 30 };

// Los vídeos de media/ ya no se usan en ninguna pantalla: ni van aquí ni se guardan en el móvil.
// Al activarse esta versión se borra la caché de vídeos de las anteriores («apex-dex-videos»).
const ARCHIVOS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/estilos.css",
  "css/vistas/inicio.css",
  "css/vistas/tierlist.css",
  "css/vistas/dex.css",
  "css/vistas/equipos.css",
  "css/vistas/matches.css",
  "css/vistas/perfil.css",
  "css/vistas/sim-entrada.css",
  "css/vistas/sim-combate.css",
  "css/vistas/sim-analisis.css",
  "js/app.js",
  "js/estado.js",
  "js/meta.js",
  "js/movimiento.js",
  "js/pokeapi.js",
  "js/showdown.js",
  "js/tipos.js",
  "js/ui.js",
  "js/vistas/inicio.js",
  "js/vistas/dex.js",
  "js/vistas/tierlist.js",
  "js/vistas/equipos.js",
  "js/vistas/matches.js",
  "js/vistas/perfil.js",
  "js/vistas/simulador.js",
  "js/vistas/sim/preparar.js",
  "js/vistas/sim/rival.js",
  "js/vistas/sim/combate.js",
  "js/vistas/sim/decision.js",
  "js/vistas/sim/resultado.js",
  "js/vistas/sim/quien-juega.js",
  "js/vistas/velocidades.js",
  "js/vistas/calc.js",
  "js/vistas/quiz.js",
  "js/vistas/torneos.js",
  "js/vistas/equipos-top.js",
  "js/vistas/uso-equipos.js",
  "css/vistas/torneos.css",
  "css/vistas/velocidades.css",
  "css/vistas/calc.css",
  "css/vistas/quiz.css",
  "js/sim/index.js",
  "js/sim/datos.js",
  "js/sim/motor.js",
  "js/sim/ia.js",
  "js/sim/resumen.js",
  "js/sim/seleccion.js",
  "js/sim/cupo.js",
  "datos/meta.json",
  "datos/diccionario.json",
  "datos/combate.json",
  "datos/sets-respaldo.json",
  "datos/sim-ejemplo.json",
  "img/icono-192.png",
  "img/icono-512.png",
  "img/icono-maskable-512.png",
  "img/apple-touch-icon.png",
];
// Datos del formato por defecto (FORMATO_POR_DEFECTO de js/meta.js): uso, histórico y últimos 7 días. Van aparte de ARCHIVOS porque
// si la regulación cambia y un fichero deja de existir, la instalación no debe fallar por eso.
const FORMATO_POR_DEFECTO = ["datos/formatos/gen9championsvgc2026regmc.json", "datos/historico/gen9championsvgc2026regmc.json", "datos/recientes/gen9championsvgc2026regmc.json"];
// API web: Google Fonts, tipografía Inter (la misma dirección que en index.html)
const FUENTES = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap";

// Instalación: se descarga la app entera, datos/meta.json y los datos del formato por defecto; los de los demás formatos se guardan cuando se abren
self.addEventListener("install", (evento) => {
  evento.waitUntil((async () => {
    const cache = await caches.open(CACHE_APP);
    // cache: "reload" evita copiar ficheros viejos que el navegador tuviera guardados
    await cache.addAll(ARCHIVOS.map((ruta) => new Request(ruta, { cache: "reload" })));
    await Promise.all(FORMATO_POR_DEFECTO.map(async (ruta) => {
      const respuesta = await fetch(new Request(ruta, { cache: "reload" })).catch(() => null);
      if (respuesta?.ok) await cache.put(ruta, respuesta);
    }));
    await guardarFuentes().catch(() => {}); // sin tipografías la app funciona igual, con las del sistema
  })());
});

// Guarda la hoja de estilos de Google Fonts y los ficheros de letra que enlaza, para tenerlas sin conexión
async function guardarFuentes() {
  const cache = await caches.open(CACHE_FUENTES);
  const respuesta = await fetch(FUENTES, { mode: "cors" });
  if (!respuesta.ok) return;
  await cache.put(FUENTES, respuesta.clone());
  const css = await respuesta.text();
  const ficheros = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]);
  await Promise.all(ficheros.map(async (url) => {
    const letra = await fetch(url, { mode: "cors" });
    if (letra.ok) await cache.put(url, letra);
  }));
}

// Activación: se borran las copias de versiones anteriores (y la caché de vídeos, que ya no se usa)
self.addEventListener("activate", (evento) => {
  evento.waitUntil((async () => {
    const actuales = [CACHE_APP, CACHE_POKEAPI, CACHE_IMAGENES, CACHE_FUENTES];
    for (const nombre of await caches.keys()) {
      if (nombre.startsWith("apex-dex-") && !actuales.includes(nombre)) await caches.delete(nombre);
    }
    await self.clients.claim();
  })());
});

// La app avisa de que hay versión nueva y, si se pulsa «Actualizar», manda este mensaje
self.addEventListener("message", (evento) => {
  if (evento.data === "actualizar") self.skipWaiting();
});

self.addEventListener("fetch", (evento) => {
  const peticion = evento.request;
  if (peticion.method !== "GET") return;
  const url = new URL(peticion.url);

  if (url.origin === self.location.origin && url.pathname.includes("/media/")) {
    return; // vídeos antiguos: directos de Internet, sin guardarlos
  } else if (url.origin === self.location.origin && /\/datos\/(recientes\/|torneos\/|formatos\/[^/]*-torneos\.json)/.test(url.pathname)) {
    evento.respondWith(redPrimero(peticion));
  } else if (url.origin === self.location.origin && /\/datos\/(formatos|historico)\//.test(url.pathname)) {
    evento.respondWith(guardarAlAbrir(peticion));
  } else if (url.origin === self.location.origin) {
    evento.respondWith(desdeLaApp(peticion));
  } else if (url.hostname === "pokeapi.co") {
    evento.respondWith(primeroGuardado(peticion, CACHE_POKEAPI));
  } else if (url.hostname === "raw.githubusercontent.com") {
    evento.respondWith(primeroGuardado(peticion, CACHE_IMAGENES));
  } else if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    evento.respondWith(primeroGuardado(peticion, CACHE_FUENTES));
  }
  // Lo demás (Pokémon Showdown) va siempre a Internet: son datos en directo
});

// Ficheros de la app: la copia guardada; las páginas, siempre index.html (la app decide la pantalla)
async function desdeLaApp(peticion) {
  const cache = await caches.open(CACHE_APP);
  if (peticion.mode === "navigate") {
    return (await cache.match("index.html")) ?? fetch(peticion);
  }
  return (await cache.match(peticion)) ?? fetch(peticion);
}

// Datos de un formato: la copia guardada si ya se abrió; si no, se pide a Internet y se guarda para la próxima vez (y sin conexión)
async function guardarAlAbrir(peticion) {
  const cache = await caches.open(CACHE_APP);
  const guardada = await cache.match(peticion);
  if (guardada) return guardada;
  const respuesta = await fetch(peticion);
  if (respuesta.ok) await cache.put(peticion, respuesta.clone());
  return respuesta;
}

// Datos que cambian cada día: primero Internet (y se guarda la copia); sin conexión, la última copia guardada
async function redPrimero(peticion) {
  const cache = await caches.open(CACHE_APP);
  try {
    const respuesta = await fetch(peticion, { cache: "no-cache" });
    if (respuesta.ok) await cache.put(peticion, respuesta.clone());
    return respuesta;
  } catch (error) {
    const guardada = await cache.match(peticion);
    if (guardada) return guardada;
    throw error;
  }
}

// PokeAPI, imágenes y fuentes no cambian: si ya están guardadas no hace falta pedirlas otra vez
async function primeroGuardado(peticion, nombreCache) {
  const cache = await caches.open(nombreCache);
  // ignoreVary: estas respuestas no cambian según las cabeceras de la petición
  const guardada = await cache.match(peticion, { ignoreVary: true });
  if (guardada) return guardada;
  const respuesta = await fetch(peticion);
  if (respuesta.ok) {
    await cache.put(peticion, respuesta.clone());
    recortar(cache, MAXIMO_DE_ENTRADAS[nombreCache]);
  }
  return respuesta;
}

// Para no llenar el móvil: si hay demasiadas entradas, se borran las más antiguas
async function recortar(cache, maximo) {
  const claves = await cache.keys();
  for (const clave of claves.slice(0, Math.max(0, claves.length - maximo))) {
    await cache.delete(clave);
  }
}
