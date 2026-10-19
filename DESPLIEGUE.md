# Desplegar Gargraph e instalarla como app (iPhone y Android)

Gargraph es una **app web instalable (PWA)**. Su dirección es:

```text
https://cristianmoriche.github.io/gargraph/
```

La forma de tenerla en el móvil, gratis y hoy mismo, tiene dos pasos:

1. **Publicarla en Internet con GitHub Pages**, que es gratis y no necesita Git: se hace desde el navegador.
2. **Instalarla desde el navegador**: *Añadir a pantalla de inicio* en Safari (iPhone) o *Instalar app* en Chrome (Android). Se instala como una app: con su icono, a pantalla completa y funcionando sin conexión.

Las tiendas son otra historia. **Google Play** (con una TWA hecha con Bubblewrap) y la **App Store** (con Mac, Xcode y una cuenta de 99 $ al año) piden trabajo y dinero, y las dos tienen un riesgo de propiedad intelectual por los Pokémon. Está explicado en el [apartado 4](#4-y-por-las-tiendas-google-play-y-app-store).

---

## 1. Antes de empezar

- [ ] Tu cuenta de GitHub, la de la práctica.
- [ ] La carpeta de la app (`index.html`, `sw.js`, `manifest.webmanifest`, `.nojekyll` y las carpetas `css`, `js`, `datos`, `img`, `herramientas` y `.github`). **No subas `disenos/`** (pesa unos 64 MB de bocetos y capturas que la app no usa): mira el [apartado 2.4](#24-qué-no-conviene-publicar).
- [ ] Un iPhone con **iOS 16.4 o posterior** (la app usa funciones de Safari que llegaron en esa versión) o un móvil Android con **Chrome**.

## 2. Publicarla con GitHub Pages (unos 10 minutos)

### 2.1 Crear el repositorio

1. En [github.com](https://github.com), botón **+** (arriba a la derecha) → **New repository**.
2. **Repository name:** `gargraph`. El nombre importa: va en la dirección de la web (`https://cristianmoriche.github.io/gargraph/`).
3. Elige **Public**. Con una cuenta gratuita, GitHub Pages solo publica repositorios públicos.
4. No marques **Add a README file**: la carpeta ya trae uno.
5. Pulsa **Create repository**.

### 2.2 Subir los ficheros desde el navegador

1. En el repositorio vacío, pulsa el enlace **uploading an existing file**.
2. Abre la carpeta de la app en el Explorador de Windows, selecciona **todo menos `disenos`** (y `.git`, si la ves) y arrástralo a la página de GitHub.
   - Arrastra **el contenido** de la carpeta, no la carpeta que lo contiene. Así `index.html` queda en la raíz del repositorio; si queda dentro de otra carpeta, la web da error 404.
   - Edge y Chrome mantienen las carpetas al arrastrar. Si alguna no sube, entra en el repositorio y arrástrala sola.
   - Comprueba que han subido los ficheros y carpetas que empiezan por punto: `.nojekyll` evita que GitHub Pages procese la web con Jekyll, y `.github/workflows/update-data.yml` es la tarea diaria de datos. Si falta alguno, créalo con **Add file → Create new file** y copia su contenido.
3. Abajo, en **Commit changes**, escribe un mensaje que explique el cambio. Por ejemplo:
   `Versión 2: Gargraph, app web instalable con datos de Smogon, Limitless, PokeAPI y Showdown`
4. Pulsa **Commit changes** y comprueba que en el repositorio se ven `index.html`, `sw.js`, `manifest.webmanifest` y las carpetas `.github`, `css`, `datos`, `herramientas`, `img` y `js`.

### 2.3 Activar GitHub Pages

1. En el repositorio, **Settings** → **Pages** (menú de la izquierda).
2. En **Build and deployment** → **Source**, elige **Deploy from a branch**.
3. En **Branch**, elige **main** y la carpeta **/ (root)**. Pulsa **Save**.
4. Espera uno o dos minutos. En la pestaña **Actions** verás el proceso *pages build and deployment*; cuando se ponga en verde, la web ya está publicada.
5. Vuelve a **Settings → Pages**: arriba aparece **Your site is live at…** con tu dirección, que será esta:

   ```text
   https://cristianmoriche.github.io/gargraph/
   ```

6. Ábrela en el ordenador para comprobar que sale la pantalla Home con el formato VGC 2026 Reg M-C y sus Pokémon más usados.
7. Pon la dirección en el repositorio: en la página principal, el engranaje junto a **About** → **Website**. Ya está en el `README.md`, en la línea **Pruébala**.
8. En **Settings → Actions → General → Workflow permissions**, comprueba que está **Read and write permissions** (lo necesita la [tarea diaria](#53-cada-día-sin-hacer-nada)).

La app funciona en una subcarpeta (`/gargraph/`) porque todas sus rutas son relativas: ni `index.html`, ni `manifest.webmanifest` (`start_url` y `scope` son `./`), ni `sw.js` usan una ruta que empiece por `/`. Si algún día la publicas con otro nombre o en un dominio propio, no hay que cambiar nada.

### 2.4 Qué no conviene publicar

GitHub Pages sirve **todo** lo que haya en el repositorio. El móvil solo descarga lo que lista `ARCHIVOS` en `sw.js` (más los datos de cada formato), pero cualquiera puede pedir el resto por su dirección. Para que nada pesado se sirva por error:

| Carpeta | Qué es | Recomendación |
|---|---|---|
| `disenos/` | Bocetos, capturas, encargos y la herramienta `nav.mjs` del rediseño (unos 64 MB, 33 MB de ellos vídeos) | **No subirla** |
| `media/` | Vídeos del diseño anterior (no existe ya en esta copia) | No subirla si reaparece |
| `.git/` | El historial local | No se sube nunca; Git la maneja aparte |
| `herramientas/` | Los scripts de datos y las pruebas (unos 90 KB) | Subirla: la tarea diaria necesita `generar-datos.mjs` y `subir-version.mjs` |
| `datos/` | Los datos de la app | Subirla entera. `datos/avisos.json` y `datos/sim-ejemplo.json` no se usan en el uso normal, pero pesan muy poco |

Si usas Git, pon `disenos/` en un `.gitignore` en vez de arrastrar ficheros uno a uno.

## 3. Instalarla en el móvil

### 3.1 iPhone (Safari)

1. Abre **Safari** (tiene que ser Safari: Chrome y los demás no instalan apps web en iOS) y escribe la dirección (`https://cristianmoriche.github.io/gargraph/`).
2. Espera a que cargue la pantalla Home.
3. Toca el botón **Compartir**, el cuadrado con una flecha hacia arriba. En iOS 26, si la barra de Safari está en modo compacto, toca primero **···** y después **Compartir**.
4. Baja y toca **Añadir a pantalla de inicio**.
5. Deja activado **Abrir como app web** (en iOS 26) y comprueba que el nombre es **Gargraph**.
6. Toca **Añadir**.

Ya está. El icono de Gargraph aparece en la pantalla de inicio y la app se abre a pantalla completa, sin la barra de Safari. La app trae las etiquetas que iOS necesita (`apple-touch-icon` de 180 px, `apple-mobile-web-app-capable`, título y barra de estado).

### 3.2 Android (Chrome)

1. Abre la dirección en **Chrome**.
2. Toca el menú **⋮** (arriba a la derecha) y elige **Instalar app** (o **Añadir a pantalla de inicio**). Chrome también puede ofrecerlo solo, con una barra abajo.
3. Confirma con **Instalar**.

Gargraph aparece en el cajón de aplicaciones y en la pantalla de inicio, con su icono (hay uno «maskable», que Android recorta al estilo de cada móvil), a pantalla completa y sin la barra del navegador. Chrome la considera instalable porque el manifiesto (`manifest.webmanifest`) trae nombre, `start_url`, `scope`, `display: standalone` e iconos de 192 y 512 px, y porque tiene un service worker. En Samsung Internet y Edge el menú se llama parecido.

### 3.3 Qué funciona sin conexión

Al instalar, el móvil guarda la app entera y los datos del formato por defecto (VGC 2026 Reg M-C: uso, histórico y últimos 7 días), así que **abre sin conexión desde la primera vez**.

- **Sin conexión:** abrir la app, Home, Rankings, Dex (las fichas que ya hayas visto), Speed tiers, Damage calc, Quiz, Equipos, el simulador, Matches y Perfil con tus datos, y el formato por defecto.
- **Sin conexión, solo lo que ya hayas abierto una vez con conexión:** los demás formatos, los torneos (Torneos, Top Teams y Team Usage) y los últimos 7 días de cada formato. Si eliges uno que no está guardado, la app lo dice y se queda con el anterior.
- **Necesita Internet:** fichas nuevas (PokeAPI), la repetición destacada, tu Elo y tus repeticiones (Showdown).

**Dónde quedan tus datos (equipos, combates, perfil y favoritos):**
- Se guardan solo en el móvil, dentro de la app instalada. No van a ningún servidor.
- La app instalada y el navegador guardan cada uno sus datos por separado. Si ya la usabas en el navegador, pásalos con **Perfil → Copia de seguridad**: *Descargar copia* en el navegador y *Restaurar copia* en la app.
- Si desinstalas la app, se borran sus datos: descarga antes una copia.

## 4. ¿Y por las tiendas? (Google Play y App Store)

No puedo subir la app a ninguna tienda por ti: hace falta tu propia cuenta de desarrollador y publicar en tu nombre te corresponde a ti. Además, tienen un riesgo común, que está justo debajo.

### 4.1 El riesgo de propiedad intelectual (las dos tiendas)

Gargraph enseña los nombres de los Pokémon, sus ilustraciones oficiales (las de la PokeAPI) y datos de juegos de Nintendo, Creatures, GAME FREAK y The Pokémon Company, y no tenemos su permiso. Esto no es un problema para una web (nadie la revisa antes de verla), pero sí en una tienda:

- **App Store, norma 5.2.1** (propiedad intelectual): no se puede usar material protegido de otros, como marcas u obras con derechos de autor, sin permiso.
- **Google Play, políticas de propiedad intelectual y de suplantación:** Google retira apps que usan marcas o contenido protegido sin permiso, a menudo después de publicarlas y tras la queja del titular. Una queja puede costar la ficha de la app e incluso penalizar la cuenta de desarrollador.

Lo que se podría reducir (nombre sin «Pokémon», aviso de «no oficial», icono propio) no quita el problema de fondo, que son los nombres y las ilustraciones. Por eso la PWA, que no pasa por ninguna revisión, es la opción segura.

### 4.2 Google Play con una TWA (Bubblewrap)

> No lo he podido probar: hacen falta una cuenta de Google Play y un móvil Android. Son los pasos de la documentación de Bubblewrap; conviene comprobar los requisitos vigentes de Google Play antes de empezar.

Una **TWA** (*Trusted Web Activity*) es una app de Android que solo abre una PWA en Chrome a pantalla completa, sin código nativo. **Bubblewrap** es la herramienta de Google que la genera.

| Qué hace falta | Detalle |
|---|---|
| **Cuenta de Google Play Console** | Pago único de 25 $. Las cuentas personales nuevas deben pasar además por una fase de pruebas cerradas con varios probadores durante unas semanas antes de publicar. |
| **Ordenador con Node.js, JDK 17 y el SDK de Android** | Bubblewrap los descarga y los configura la primera vez. Sirve Windows: no hace falta Mac. |
| **La PWA, en HTTPS y con su manifiesto** | Ya cumplida: `manifest.webmanifest` válido, iconos de 192 y 512 px y service worker. |
| **Enlace de activos digitales** (`/.well-known/assetlinks.json`) | Demuestra que la web y la app son del mismo dueño; sin él, la app se abre con la barra del navegador. Tiene que estar en la **raíz del dominio**: `cristianmoriche.github.io/.well-known/assetlinks.json`. Con una *project page* (`/gargraph/`) eso significa crear además un repositorio `cristianmoriche.github.io` solo para ese fichero, o usar un dominio propio. |
| **Ficha en Play Console** | Descripción, capturas, icono de 512 px, política de privacidad (en una dirección web) y cuestionario de contenido. |

Pasos:

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest=https://cristianmoriche.github.io/gargraph/manifest.webmanifest
bubblewrap build          # crea el .aab (para Play) y un .apk para probar
```

1. `init` pregunta el nombre, el identificador del paquete (por ejemplo `io.github.cristianmoriche.gargraph`) y crea la **clave de firma**: guárdala (y su contraseña) fuera del repositorio; sin ella no se pueden subir actualizaciones.
2. `build` genera `app-release-bundle.aab` y `app-release-signed.apk`. Instala el `.apk` en un Android para probarlo.
3. `bubblewrap fingerprint` da la huella de la clave: va en `assetlinks.json`.
4. En Play Console: crea la app, sube el `.aab` a una pista de pruebas, completa la ficha y envía a revisión.

Las actualizaciones de la web llegan solas a la TWA (es la misma web); solo hay que volver a subir un `.aab` si cambia el icono, el nombre o el manifiesto.

### 4.3 App Store (iPhone)

| Requisito | Qué supone |
|---|---|
| **Apple Developer Program** | 99 $ al año. Se da de alta con tu Apple ID y lo pagas tú. |
| **Un Mac con Xcode** | Las apps de iPhone se compilan y se firman con Xcode, que solo existe para macOS. Capacitor 8, la herramienta para convertir una web en una app de iPhone, pide Xcode 26 o posterior. Hay servicios que compilan en la nube, pero son de pago o tienen pocos minutos gratis, y también necesitan tu cuenta de Apple. |
| **Empaquetar la web** | Con Capacitor: la misma web, metida dentro de una app nativa. |
| **La ficha en App Store Connect** | Nombre, descripción, capturas de pantalla, icono de 1024 px, política de privacidad y clasificación por edades. |
| **La revisión de Apple** | Personas de Apple prueban la app y deciden si la aceptan. |

Por qué la rechazarían casi seguro:

- **Norma 5.2.1, propiedad intelectual** (ver el [apartado 4.1](#41-el-riesgo-de-propiedad-intelectual-las-dos-tiendas)).
- **Norma 4.2, funcionalidad mínima.** Una app tiene que ofrecer algo más que una web empaquetada, y Gargraph dentro de Capacitor sería justo eso.

Es decir: pagarías 99 $ para que, con mucha probabilidad, no la aceptaran.

Si aun así quieres tenerla como app nativa en tu iPhone:

- **Gratis, si tienes un Mac:** con Xcode y tu Apple ID normal («Personal Team») puedes instalarla por cable en tu propio iPhone. Caduca a los 7 días y hay que volver a instalarla.
- **Con la cuenta de 99 $, usando TestFlight:** subes la app a App Store Connect y la instalas con la app TestFlight, sin que salga en la App Store pública. Cada versión dura 90 días. Apple revisa la primera versión que se envía a probadores externos.

Pasos con Capacitor (para cuando tengas Mac y cuenta; no los he podido probar, son los pasos oficiales de Capacitor 8):

1. En el Mac, instala [Node.js](https://nodejs.org) y Xcode 26 (desde la Mac App Store).
2. En una carpeta nueva, ejecuta:

   ```bash
   npm init -y
   npm install @capacitor/core @capacitor/cli @capacitor/ios
   npx cap init "Gargraph" com.tunombre.gargraph --web-dir www
   ```

3. Crea la carpeta `www` y copia en ella `index.html`, `manifest.webmanifest`, `sw.js` y las carpetas `css`, `js`, `datos` e `img`.
4. Genera el proyecto de iPhone y ábrelo en Xcode:

   ```bash
   npx cap add ios
   npx cap open ios
   ```

5. En Xcode: **Signing & Capabilities** → **Team**: tu cuenta. Pon el icono de 1024 px en **Assets → AppIcon**.
6. **Product → Archive** → **Distribute App** → **App Store Connect** → **Upload**.
7. En [App Store Connect](https://appstoreconnect.apple.com) → tu app → **TestFlight**: añádete como probador e instálala desde la app TestFlight del iPhone.

### 4.4 Lo que te recomiendo

Quédate con la PWA de GitHub Pages:
- es gratis y ya funciona en iPhone y en Android;
- se instala en segundos y se actualiza sola;
- no depende de que una tienda la acepte o la retire;
- la puedes enseñar en clase con su enlace.

Desde la pantalla de inicio se comporta como una app más. Si algún día la quieres en Google Play, la TWA es la vía barata (25 $, sin Mac), pero asume el riesgo del apartado 4.1.

## 5. Actualizar la app

### 5.1 Cuando cambies el código

1. Abre `sw.js` y sube la versión. Por ejemplo, cambia `const VERSION = "3.4.0";` por `const VERSION = "3.4.1";` (o ejecuta `node herramientas/subir-version.mjs`). Si no la cambias, los móviles no se enteran de que hay versión nueva.
2. En GitHub, en el repositorio: **Add file** → **Upload files**. Arrastra otra vez el contenido de la carpeta de la app (sin `disenos`): los ficheros con el mismo nombre se sustituyen.
3. Escribe un mensaje de commit que diga qué ha cambiado y pulsa **Commit changes**.
4. En uno o dos minutos está publicada. En el iPhone, al abrir la app aparece **«A new version of Gargraph is available»**: toca **Update**.

### 5.2 Los datos: qué se actualiza y cuándo

| Datos | Fuente | Cuándo cambian |
|---|---|---|
| Mes de Smogon (uso, sets, compañeros, counters, núcleos, histórico) | [smogon.com/stats](https://www.smogon.com/stats/) | Una vez al mes: Smogon publica en los primeros días del mes siguiente, y la tarea lo detecta sola ese mismo día |
| Últimos 7 días (uso de cada Pokémon) | Repeticiones públicas de Pokémon Showdown | Cada día |
| Torneos (uso, torneos, mejores equipos, equipos agrupados) | [Limitless](https://play.limitlesstcg.com) | Cada día |

Los «últimos 7 días» son una **muestra** (hasta 400 partidas por formato, las de rating más alto de entre las repeticiones públicas de la semana): cuentan el % de equipos que llevan cada Pokémon. No son todas las partidas de Showdown ni se calculan igual que las de Smogon, y la app lo dice. Si hay menos de 100 partidas, el fichero se guarda con `muestraPequena` y la app avisa.

### 5.3 Cada día, sin hacer nada

`.github/workflows/update-data.yml` es una tarea de GitHub Actions que se ejecuta **todos los días a las 05:17 UTC** y también a mano. Cada vez:

1. Ejecuta `node herramientas/generar-datos.mjs` (Node 22).
2. El generador mira si Smogon ha publicado un mes más reciente para cada formato (mismo formato y mismo corte de rating). Si lo hay, regenera todo lo mensual; si no, **no toca** los datos de Smogon. Después, siempre, pide a Limitless los torneos de VGC que faltan (`datos/torneos/` y los formatos de torneos), calcula los últimos 7 días (`datos/recientes/<formato>.json`) y anota en `datos/meta.json` qué capas tiene cada formato.
3. Si `datos/` ha cambiado, sube en uno la `VERSION` de `sw.js` (`herramientas/subir-version.mjs`), hace commit (`Update data AAAA-MM-DD`) y push, y pide a GitHub Pages que republique. En el móvil, los «últimos 7 días» se piden primero a Internet, así que se ven al abrir la app sin esperar a actualizarla.
4. Si no hay cambios, no hace commit.

**Lanzarla a mano:** en el repositorio, pestaña **Actions** → **Update data** (a la izquierda) → **Run workflow** → rama `main` → **Run workflow**. Tarda unos 10 a 20 minutos (hace cientos de peticiones, con pausas, para no cargar los servidores de Showdown y Limitless; Limitless admite 50 peticiones cada 5 minutos, así que los torneos nuevos se bajan por tandas y una ejecución con la caché vacía puede tardar varios días en completarlos). Cuando se ponga en verde, la web se republica en uno o dos minutos. Si falla, abre la ejecución y mira el paso **Generate data**.

**Avisos que requieren una decisión:** si Smogon cambia algo que la app no debe cambiar sola (por ejemplo, publica la regulación siguiente de VGC o BSS, o un formato desaparece), el generador lo escribe en consola y en `datos/avisos.json` (la app no lo muestra). Para pasar a la regulación nueva: `node herramientas/generar-datos.mjs --adoptar-regulacion` en el ordenador, y sube `datos/` y `sw.js`. Esto cambia el formato en la app, así que los equipos guardados con el formato viejo pasan al formato por defecto.

**En el ordenador** (necesita Node.js 18 o posterior), dentro de la carpeta de la app:

```bash
node herramientas/generar-datos.mjs                  # lo mismo que hace la tarea diaria
node herramientas/generar-datos.mjs --solo-recientes # solo los últimos 7 días (unos minutos)
node herramientas/generar-datos.mjs --solo-torneos   # solo los torneos de Limitless
node herramientas/generar-datos.mjs --solo-capas     # solo anota en meta.json qué capas tiene cada formato (sin conexión)
node herramientas/generar-datos.mjs --todo           # regenera también lo mensual, aunque no haya mes nuevo
node herramientas/generar-datos.mjs 2026-09          # fuerza un mes concreto de Smogon
```

## 6. Problemas frecuentes

| Problema | Solución |
|---|---|
| Error 404 en `github.io` | `index.html` no está en la raíz del repositorio o Pages no está activado (**Settings → Pages**). Después de activarlo, espera dos minutos. |
| La página sale en blanco o sin diseño | Falta alguna carpeta en el repositorio (`css`, `js`, `datos` o `img`). |
| «No se han podido cargar los datos de la app» | Falta `datos/meta.json`, `datos/diccionario.json` o la carpeta `datos/formatos`. |
| La tarea «Update data» falla al hacer push | **Settings → Actions → General → Workflow permissions** debe estar en **Read and write permissions**. |
| La tarea sube los datos pero la web no cambia | Mira la pestaña **Actions**: debe haber un *pages build and deployment* nuevo. Si no, lanza **Update data** otra vez o pulsa **Re-run** en el último *pages build and deployment*. |
| No sale el selector «Last 7 days» | El formato aún no tiene `datos/recientes/<formato>.json`: lanza **Update data** a mano. |
| El móvil no muestra la versión nueva | Cambia `VERSION` en `sw.js` y súbelo. Después cierra la app del todo y vuelve a abrirla. |
| En Android no sale «Instalar app» | Usa Chrome (no un navegador integrado de otra app), abre la dirección `https://` y espera a que cargue entera. Si ya está instalada, el menú dice «Abrir». |
| Sin conexión, un formato dice «Could not load…» | Ese formato no se había abierto antes con conexión. Ábrelo una vez con Internet y quedará guardado. |
| No encuentro «Añadir a pantalla de inicio» | Usa Safari: está en el menú **Compartir**, más abajo. Si no sale, toca **Editar acciones** al final de ese menú. |
| En el ordenador no abre con doble clic | Es normal: necesita un servidor. Mira «Cómo abrirla en el ordenador» en el `README.md`. |

## 7. Privacidad

- Gargraph no recoge datos ni tiene servidor propio. Todo lo que guardas se queda en tu móvil.
- La app solo pide información pública a la PokeAPI, a Pokémon Showdown y a Google Fonts (la tipografía). Los datos de Smogon y de Limitless los descarga el generador, no el móvil.
- Si escribes tu usuario de Showdown, la app se lo manda a Showdown para leer tu Elo y tus repeticiones públicas. No te pide ninguna contraseña.
