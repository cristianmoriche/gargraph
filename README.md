# Gargraph

Versión 2 de la Pokémon App de la Clase 1 de Entornos de Desarrollo (1.º DAM): una **Pokédex competitiva para el móvil**, con un diseño simple y plano, en tema claro y oscuro. La interfaz está en inglés.

Es una **app web instalable (PWA)**:
- se abre en el navegador;
- se instala desde el navegador en la pantalla de inicio del iPhone (Safari) y de Android (Chrome), y funciona como una app, también sin conexión.

La versión 1, el programa de consola en Java, es la práctica de clase y está en `pokemon-app/`.

**Pruébala:** https://cristianmoriche.github.io/gargraph/ (cómo se publica, se instala y se actualiza: [DESPLIEGUE.md](DESPLIEGUE.md))

## Formatos y fuentes de datos

Toda cifra de la app sale de una fuente real: nada está escrito a mano. Hay 25 formatos, en tres grupos:

| Grupo | Formatos | Fuente |
|---|---|---|
| **Pokémon Champions** | VGC 2026 Reg M-C (el de por defecto), su Bo3, BSS Reg M-C y Champions OU; y, ya cerrados, las regulaciones M-B y M-A | Estadísticas mensuales de **Smogon** (partidas de Showdown) y, en los abiertos, los últimos 7 días de **Showdown** |
| **Scarlet & Violet** | Gen 9 OU; VGC 2026 Reg I y Reg F, VGC 2025 Reg H, J, G e I (y sus Bo3), todos cerrados salvo OU | Estadísticas mensuales de **Smogon** |
| **Torneos** (Champions) | VGC 2026 Tournaments Reg M-C, M-B y M-A | **Limitless**: equipos de torneos de VGC con su top 8 y su récord |

Los formatos de Smogon traen repartos de estadísticas; los de torneos no (Limitless no da EVs): donde hace falta uno (simulador, velocidades, Team Builder) se usa el del formato de Smogon de la misma regulación, y la app lo dice.

**Qué tiene cada formato** (histórico mensual y últimos 7 días) lo anota el generador en `datos/meta.json` (`capas`), para que la app no pida lo que no existe.

## Pantallas

- **Home**
  - El selector de formato (hoja con los 25, agrupados) y, con el periodo «This month (Smogon)» o «Last 7 days (Showdown replays)», un resumen y los 4 Pokémon más usados.
  - Los núcleos de equipo: los tríos que más se repiten. En Smogon la cifra es un tope (la de la pareja menos frecuente) y la app dice «no más de»; en torneos es el porcentaje real de equipos con los tres.
  - Accesos a Speed tiers, Damage calc, Quiz y Torneos; tus combates, la repetición destacada de Showdown y tus búsquedas recientes.
- **Rankings** (Tier list): todos los Pokémon del formato, en los grupos S, A, B, C y D según su puesto de uso (no son los tiers oficiales y la app lo dice).
- **Dex**, el buscador y la ficha de un Pokémon con los datos de la PokeAPI y su análisis competitivo:
  - puesto en el formato, roles y evolución del uso en los últimos meses;
  - estadísticas base y reales con el reparto más usado;
  - eficacia de tipos, compañeros, movimientos, objetos, habilidades y teratipos (donde los hay), *checks & counters*;
  - favorito, **+ Equipo** y grito del Pokémon.
- **Speed tiers**: la velocidad real de cada Pokémon del formato, con filtro «My team».
- **Damage calc**: calculadora de daño con el motor del simulador (atacante, defensor, movimiento y campo).
- **Quiz**: «¿Cuál es más rápido?» (velocidad real) y eficacia de tipos, con racha.
- **Tournaments**, **Top Teams** y **Team Usage** (formatos de torneos): los 30 torneos más recientes, con su estado (en curso, terminado o con los resultados pendientes), el top 8 y los equipos publicados; los mejores equipos con filtro por Pokémon y arquetipo; y los equipos agrupados por sus 6 Pokémon, con su win rate real. **Team Builder** crea un equipo en Equipos a partir del de un jugador.
- **Equipos**
  - Equipos de hasta 6 Pokémon, con su formato (se elige en la misma hoja de formatos).
  - Editor de sets y análisis del equipo: debilidades, cobertura y orden de velocidad.
  - Importar y exportar en el formato de Showdown.
  - **Simulate battle**, que abre el simulador con ese equipo.
- **Simulador de combates** (todos los formatos; los de dobles se juegan como combate individual y la app lo avisa), en cinco pasos:
  - **Preparar** (`#/simulador`): tu equipo, el rival, una previsión estimada, el orden de velocidad y las opciones (velocidad, ver la jugada de la IA y 1 o 100 combates).
  - **Elegir rival** (`#/simulador/rival`): equipos montados con los núcleos del meta, tus rivales habituales de Matches, otro de tus equipos o uno pegado en el formato de Showdown.
  - **Combate** (`#/simulador/combate`): la IA juega por los dos lados, turno a turno, con pausa, velocidad, saltos de turno y registro.
  - **¿Por qué?** (`#/simulador/decision/8`): en cada turno, las tres mejores jugadas con su nota y el motivo.
  - **Análisis** (`#/simulador/resultado`): curva de valoración, momentos clave, rendimiento de cada Pokémon y consejos. Se puede guardar en Matches; con «100 combates», juega otros 99 y cuenta cuántos ganas.
- **Matches**
  - Historial de combates: importados de repeticiones de Showdown, apuntados a mano o guardados desde el simulador (con la etiqueta «Simulado»).
  - Victorias, derrotas, porcentaje y racha; los rivales que más te encuentras.
- **Perfil**
  - Nombre, avatar, formato favorito y tema (automático, claro u oscuro).
  - Tu usuario de Showdown y tu Elo; favoritos.
  - Cómo instalarla (iPhone o Android, según el móvil), copia de seguridad y créditos.

## APIs utilizadas

| API o fuente | Tipo | Cuándo se usa | Para qué |
|---|---|---|---|
| PokeAPI (https://pokeapi.co/docs/v2) | API web (REST, JSON) | En directo, desde el móvil | Datos, descripción e ilustración de cada Pokémon |
| Imágenes de la PokeAPI (https://github.com/PokeAPI/sprites) | Ficheros en GitHub | En directo | Miniaturas e ilustraciones oficiales |
| Pokémon Showdown: repeticiones (https://replay.pokemonshowdown.com) | API web (JSON) | En directo | Repetición destacada, tus repeticiones e importar combates |
| Pokémon Showdown: repeticiones públicas, paginadas con `before` (`search.json` y `<id>.log`) | API web (JSON y texto) | Con el generador, cada día | Uso de cada Pokémon en los últimos 7 días |
| Pokémon Showdown: jugadores (https://pokemonshowdown.com/users/) | API web (JSON) | En directo | Tu Elo y tu GXE |
| Smogon: estadísticas de uso (https://www.smogon.com/stats/) | Ficheros JSON mensuales | Con el generador, cuando hay mes nuevo | Uso, sets, compañeros y counters de cada formato |
| Limitless: torneos de VGC (https://play.limitlesstcg.com/api) | API web (JSON) | Con el generador, cada día | Torneos, su top 8, los equipos publicados y su récord (formatos de torneos) |
| Pokémon Showdown: datos del simulador (https://play.pokemonshowdown.com/data/) | Ficheros JSON y JS | Con el generador | Tipos, estadísticas, tiers, movimientos, objetos y habilidades |
| PokeAPI: CSV de su base de datos (https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv) | Ficheros CSV | Con el generador | Nombres en español y tabla de tipos |
| Google Fonts (https://fonts.google.com) | API web | Al abrir la app (y se guarda) | Tipografía Inter |
| APIs del navegador | Fetch, Web Storage (`localStorage`), Service Worker y Cache Storage, Web App Manifest, History, Clipboard e `Intl` | Siempre | Hacer peticiones, guardar tus datos en el móvil, funcionar sin conexión, instalarse, la flecha de volver, copiar el equipo y escribir números y fechas en español |

Peticiones que hace la app en directo:

- `GET https://pokeapi.co/api/v2/pokemon/{nombre o número}`: datos básicos, estadísticas, tipos, habilidades, imagen y grito.
- `GET https://pokeapi.co/api/v2/pokemon-species/{número}`: nombre, categoría y descripción en español.
- `GET https://replay.pokemonshowdown.com/search.json?format={formato}` (o `?user={usuario}`): las 51 repeticiones más recientes.
- `GET https://replay.pokemonshowdown.com/{id}.json`: una repetición, con los equipos y el ganador.
- `GET https://pokemonshowdown.com/users/{usuario}.json`: el Elo de un jugador en cada formato.

Cada ficha nueva son 2 peticiones a la PokeAPI. La versión 1 hacía 3 o 4, pero aquí la tabla de tipos y los nombres de las habilidades vienen en el diccionario. Las respuestas se guardan en el móvil y no se vuelven a pedir.

Las estadísticas de Smogon no se pueden pedir desde el navegador, porque Smogon no admite CORS. Por eso las descarga el programa `herramientas/generar-datos.mjs` y las guarda, ya preparadas, en `datos/`. Smogon publica una vez al mes; los «últimos 7 días» de Showdown se recalculan cada día.

## Cómo abrirla en el ordenador

Los módulos de JavaScript y el service worker necesitan un servidor web, así que **no funciona con doble clic** en `index.html`. Hay dos formas de abrirla:

- **Con Python**, dentro de la carpeta de la app:

  ```text
  python -m http.server 8080 --bind 127.0.0.1
  ```

  Después abre http://localhost:8080 en el navegador. Para ir directo a un Pokémon: http://localhost:8080/#/dex/dragapult

- **Desde IntelliJ IDEA:** clic derecho en `index.html` → *Open In* → *Browser*.

## Publicarla e instalarla en el móvil

Los pasos están en [DESPLIEGUE.md](DESPLIEGUE.md):
- publicarla gratis con GitHub Pages (https://cristianmoriche.github.io/gargraph/);
- instalarla como app web en el iPhone (Safari) y en Android (Chrome);
- actualizarla;
- lo que haría falta para Google Play (TWA con Bubblewrap) y para la App Store, y el riesgo de propiedad intelectual de las dos tiendas.

## Cómo se actualizan los datos

Hay tres capas, y las tres las prepara `herramientas/generar-datos.mjs`:

| Capa | Fuente | Cuándo |
|---|---|---|
| **This month (Smogon)**: uso, sets, compañeros, counters, núcleos e histórico | Estadísticas de Smogon | Cuando Smogon publica un mes nuevo (a principios de mes) |
| **Last 7 days (Showdown replays)**: uso de cada Pokémon | Repeticiones públicas de Showdown | Cada día, en los formatos abiertos |
| **Tournaments**: uso, torneos, mejores equipos y equipos agrupados | Limitless | Cada día (solo pide los torneos nuevos) |

Los «últimos 7 días» son una muestra: hasta 400 partidas por formato, las de rating más alto entre las repeticiones públicas de la semana. Cuentan el % de equipos que llevan cada Pokémon, no se calculan igual que en Smogon, y la app enseña cuántas partidas son, de qué fechas y con qué rating. Con menos de 100 partidas se marcan como muestra pequeña. Los datos de Smogon solo cambian si hay mes nuevo.

**Automático:** la tarea `.github/workflows/update-data.yml` ejecuta el generador todos los días en GitHub y, si `datos/` cambia, sube la versión de `sw.js` y hace commit y push. Cómo funciona y cómo lanzarla a mano: [DESPLIEGUE.md](DESPLIEGUE.md#53-cada-día-sin-hacer-nada).

**En el ordenador**, con Node.js 18 o posterior, dentro de la carpeta de la app:

```text
node herramientas/generar-datos.mjs                       (lo mismo que la tarea diaria)
node herramientas/generar-datos.mjs --solo-recientes      (solo los últimos 7 días)
node herramientas/generar-datos.mjs --solo-torneos        (solo los torneos de Limitless)
node herramientas/generar-datos.mjs --solo-capas          (solo anota en meta.json qué capas tiene cada formato; sin conexión)
node herramientas/generar-datos.mjs --todo                (regenera también lo mensual aunque no haya mes nuevo)
node herramientas/generar-datos.mjs 2026-09               (un mes concreto de Smogon)
node herramientas/generar-datos.mjs --adoptar-regulacion  (pasa a la regulación nueva de VGC o BSS)
```

El programa:
1. busca, para cada formato, un mes de Smogon más reciente que el actual (mismo formato y mismo corte de rating);
2. si lo hay, descarga las estadísticas y los datos de Showdown y de la PokeAPI, escribe `datos/` y cambia la versión de los datos en `sw.js`, para que los móviles se actualicen;
3. pide a Limitless los torneos de VGC de Champions que faltan (con pausas, dentro de su límite de peticiones) y escribe sus formatos y `datos/torneos/`;
4. calcula los últimos 7 días y escribe `datos/recientes/`, con una pausa entre peticiones y un tope de partidas;
5. anota en `datos/meta.json` qué capas tiene cada formato;
6. **no cambia de regulación solo**: si Smogon ya publica la siguiente (`regmc` → …) o un formato desaparece, lo avisa en la consola y lo anota en `datos/avisos.json` (la app no lo enseña).

## Estructura

| Fichero o carpeta | Qué contiene |
|---|---|
| `index.html` | La página: pantalla de carga, barra inferior, aviso de versión nueva y metadatos para instalarla |
| `manifest.webmanifest` | El manifiesto de la app instalable: nombre, iconos, colores y pantalla completa |
| `sw.js` | El service worker: guarda la app en el móvil para que abra al momento y funcione sin conexión |
| `css/estilos.css` | Los estilos comunes: colores, tipografías, botones, formularios, barra inferior y la pantalla de Perfil |
| `css/vistas/` | Los estilos de cada pantalla, un fichero por pantalla (`inicio`, `tierlist`, `dex`, `velocidades`, `calc`, `quiz`, `torneos`, `equipos`, `matches`, `perfil`) y tres para el simulador (`sim-entrada`, `sim-combate` y `sim-analisis`) |
| `js/app.js` | Arranca la app y decide qué pantalla se ve según la dirección (`#/dex/dragapult`…) |
| `js/movimiento.js` | Las animaciones comunes: el llenado de las barras |
| `js/vistas/` | Una pantalla por fichero: `inicio`, `tierlist`, `dex`, `velocidades`, `calc`, `quiz`, `torneos` (con `equipos-top` y `uso-equipos`), `equipos`, `matches` y `perfil`; `simulador` reparte entre las cinco de `js/vistas/sim/` (`preparar`, `rival`, `combate`, `decision` y `resultado`) |
| `js/sim/index.js` | La puerta de entrada del simulador: guarda lo que se está simulando, juega el combate y calcula la previsión |
| `js/sim/motor.js` | Las reglas del combate: daño, orden, problemas de estado, trampas, clima, campos, teracristalización, habilidades y objetos. No usa el navegador |
| `js/sim/ia.js` | La IA: elige la jugada de cada lado, la explica y estima quién va ganando |
| `js/sim/resumen.js` | La previa, la curva de probabilidad y el análisis del final |
| `js/sim/datos.js` | Carga los datos que necesita el motor |
| `js/pokeapi.js` | Las peticiones a la PokeAPI |
| `js/showdown.js` | Las peticiones a Showdown y el formato de equipos de Showdown (importar y exportar) |
| `js/meta.js` | Los datos competitivos: formatos, especies, traducciones y cálculo de estadísticas reales |
| `js/tipos.js` | Los 18 tipos, la tabla de tipos y el análisis de equipos |
| `js/estado.js` | Lo que se guarda en el móvil: perfil, equipos, combates, favoritos y búsquedas recientes |
| `js/ui.js` | Piezas comunes: iconos, insignias de tipo, miniaturas y avisos |
| `datos/` | Datos generados: `meta.json` (los formatos y qué capas tiene cada uno), `diccionario.json`, `combate.json` (lo que el motor necesita de cada movimiento), un fichero por formato en `formatos/`, el histórico en `historico/`, los últimos 7 días de Showdown en `recientes/`, los torneos de Limitless en `torneos/` y `avisos.json` (cambios de Smogon que piden una decisión; la app no lo lee). `sim-ejemplo.json` es un combate de ejemplo escrito a mano: solo se ve si se añade `?ejemplo` a la dirección |
| `img/` | Iconos de la app: 192 y 512 px, uno «maskable» de 512 y el `apple-touch-icon` de 180 |
| `herramientas/generar-datos.mjs` | El generador de datos (mes de Smogon, últimos 7 días de Showdown, torneos de Limitless y capas de `meta.json`) |
| `herramientas/limitless.mjs` | La parte del generador que habla con la API de Limitless (límite de peticiones, caché de torneos terminados y estado en directo) |
| `herramientas/subir-version.mjs` | Sube en uno la `VERSION` de `sw.js`; lo usa la tarea diaria |
| `.github/workflows/update-data.yml` | La tarea diaria de GitHub que actualiza los datos |
| `.nojekyll` | Le dice a GitHub Pages que sirva la carpeta tal cual |
| `disenos/` | Bocetos y herramientas del rediseño: pesan mucho y no se publican (ver [DESPLIEGUE.md](DESPLIEGUE.md#24-qué-no-conviene-publicar)) |
| `herramientas/probar-sim.mjs` | Las pruebas del motor y de la IA: `node herramientas/probar-sim.mjs` |

## Decisiones técnicas

- **Sin frameworks:** HTML, CSS y JavaScript con módulos (`import` y `export`). Así cada línea es mía y la puedo explicar. No hace falta instalar nada para usar la app.
- **Rutas con `#`** (`#/dex/dragapult`): GitHub Pages solo sirve ficheros, y así cada pantalla tiene su propia dirección sin necesitar un servidor propio.
- **Tier list propia por puesto de uso:** S son los 6 más usados, A del 7.º al 15.º, B del 16.º al 30.º, C del 31.º al 50.º y D el resto. No es la tier list oficial de Smogon, y así lo pone la app.
- **Estadísticas reales:** con las fórmulas de los juegos, 31 IVs y el nivel del formato (100 en OU y 50 en VGC y BSS). En Pokémon Champions no hay EVs, sino puntos de estadística (como mucho 32 por estadística y 66 en total). La fórmula es la del simulador de Showdown (`data/mods/champions/scripts.ts`): PS = base + puntos + 75; el resto = (base + puntos + 20) × naturaleza.
- **Núcleos:** Smogon solo dice qué porcentaje de los equipos de A lleva a B. La fuerza de una pareja es la media de los dos sentidos (media geométrica), y la de un trío, la de su pareja más débil: es un tope, no el porcentaje real (el núcleo lleva `cota: true` y la app dice «no más de»). En los formatos de torneos se cuentan los equipos que llevan los tres, así que la cifra es real y no lleva `cota`. Para que haya variedad, nadie sale en más de dos núcleos.
- **Sinergias explicadas con la tabla de tipos:** un compañero «aguanta» las debilidades del Pokémon que él resiste, y al revés.
- **Roles** (Rápido, Pivote, Trampas, Espacio Raro…): se deducen de las habilidades, los objetos y los movimientos que más usa cada Pokémon.
- **La tabla de tipos, con la misma lógica que la versión 1:** se empieza en x1 y se multiplica por el factor de cada tipo.
- **Tus datos se quedan en tu móvil**, en `localStorage`. La copia de seguridad es un fichero JSON.
- **Cómo decide la IA del simulador:** primero tasa con el cálculo de daño lo que puede hacer cada lado (cuánto quita cada ataque, qué cambia cada movimiento de estado, cómo queda cada cambio). Después juega cada opción propia contra las tres mejores respuestas del rival, sobre copias del combate y tres veces con azares distintos, y puntúa cómo queda cada copia: Pokémon en pie, PS, problemas de estado, trampas, mejoras de características y quién amenaza a quién. De esa puntuación sale la nota de 0 a 100, y la explicación se escribe con plantillas a partir de lo calculado. Las dos IA ven los dos equipos enteros.
- **La previsión es una estimación:** sale de 20 combates rápidos en los que la IA decide solo con el primer paso. Acierta quién es el favorito, pero puede separarse unos 15 puntos de lo que gana después la IA completa; por eso la app la llama estimación.
- **Lo que el motor deja fuera** (`sinEfecto()` en `js/sim/motor.js` da la lista de lo que aparece en un combate y no tiene efecto): tiene programadas las habilidades y los objetos que lleva con un 10 % de uso o más algún Pokémon con un 3 % de uso o más en Gen 9 OU. El resto se juega como si no hiciera nada: entre las más usadas, las habilidades Experto, Agallas, Ignífugo, Polvo Escudo, Impulso, Justiciero y Bromista, y los objetos Baya Acardo, Capa Furtiva, Baya Dillo, Seguro Debilidad, Baya Ziuela, Hierba Mental, Lupa y Mochila Escape. Tampoco están la Tera Astral, el sexo de los Pokémon (ni Gran Encanto, que depende de él) ni 37 movimientos con efecto propio (Intercambio, Plegaria Vital, Transformación, Paliza…), que se usan solo con lo que digan sus datos. Los movimientos que no usa ningún Pokémon de los tres formatos funcionan con sus datos (prioridad, problemas de estado, cambios de características), pero no están repasados uno a uno.

## Pruebas

Hechas el 19/10/2026 con un móvil simulado de 390 px (Microsoft Edge sin ventana, controlado con el protocolo de DevTools):

| Prueba | Resultado |
|---|---|
| Todas las pantallas (Home, Rankings, Dex y una ficha, Speed tiers, Damage calc, Quiz, Tournaments y un torneo, Top Teams, Team Usage, Equipos y su editor, Matches, Perfil y el simulador) en VGC 2026 Reg M-C, VGC 2026 Tournaments Reg M-C y Gen 9 OU, en claro y oscuro, con el almacenamiento vacío y con datos (y, solo en las pantallas de datos, otros cuatro formatos: M-B, torneos M-A, Reg I y BSS M-C) | Sin errores de JavaScript, sin errores de consola (ni 404), sin scroll horizontal, sin `undefined` ni `NaN`, zonas táctiles de 44 px como mínimo y contraste de 4,5 : 1 como mínimo |
| Recorrido completo: Team Builder desde un torneo → Equipos → Simulate battle → combate → análisis → Save to Matches | Pasa; el combate guardado aparece en Matches |
| Un torneo «en directo» de prueba (ronda 3 de 8, otro recién empezado sin equipos y uno con resultados pendientes) | Las tres pantallas de torneos lo enseñan bien |
| `node herramientas/probar-sim.mjs` (el motor y la IA del simulador) | «Todo bien» |
| Service worker: se instala, guarda el formato por defecto y la app abre sin conexión (con el servidor apagado) | Pasa |
| Manifest e instalabilidad (iconos de 192 y 512 px, «maskable», `display`, `start_url`, `scope`, `apple-touch-icon`) | Sin errores de instalabilidad en Edge |
| Elegir sin conexión un formato nunca abierto | Avisa y se queda con el anterior |

Lo que **no** se ha podido probar: la instalación real en un iPhone o en un Android, y el comportamiento de las tiendas.

## Limitaciones

- Los datos de uso de Smogon son mensuales, y solo incluyen los Pokémon con al menos un 0,5 % de uso en cada formato.
- Los «últimos 7 días» son una muestra de las repeticiones públicas de Showdown (hasta 400 partidas por formato, las de rating más alto), no todas las partidas, y solo existen en los formatos abiertos de Smogon.
- Los formatos de torneos no tienen repartos de EVs (Limitless no los da): se usan los de Smogon de la misma regulación.
- Showdown solo da las repeticiones que se han subido como públicas.
- El simulador juega los formatos de dobles como combates individuales (1 contra 1), y la app lo avisa.
- El simulador es una versión 1: no todas las habilidades, objetos y movimientos tienen su efecto (ver «Decisiones técnicas»). La valoración de «Win Prob.» es una estimación de la IA, no una probabilidad medida.
- Algunas formas muy nuevas aún no están en la PokeAPI. En ese caso, la ficha usa la imagen de la forma base, y los tipos y las estadísticas de Showdown (la app lo avisa).
- Sin conexión, solo abren los formatos y los torneos que se hayan visto antes con conexión (y el formato por defecto, que se guarda al instalar).
- Las tiendas (Google Play y App Store) no son recomendables para este proyecto (marcas de Pokémon y requisitos de cada tienda): se explica en [DESPLIEGUE.md](DESPLIEGUE.md#4-y-por-las-tiendas-google-play-y-app-store).

## Créditos y aviso legal

Gargraph es un proyecto educativo de 1.º de DAM, sin ánimo de lucro y no oficial. No está afiliado a Nintendo, Creatures, GAME FREAK, The Pokémon Company, Smogon, Limitless ni Pokémon Showdown. Pokémon y los nombres de los Pokémon son marcas de sus respectivos propietarios.

Datos de la [PokeAPI](https://pokeapi.co), de las [estadísticas de uso de Smogon](https://www.smogon.com/stats/), de [Pokémon Showdown](https://pokemonshowdown.com) y de los torneos de [Limitless](https://limitlesstcg.com).
