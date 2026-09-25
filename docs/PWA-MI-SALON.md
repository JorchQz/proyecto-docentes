# Mi Salón como app instalable (PWA): investigación y plan

Fecha: 2026-09-25. Rama de trabajo: `mi-salon-parte-b`. Este documento solo investiga y propone; no cambia código.
Las fuentes están al final (§8). Cada afirmación sobre navegadores lleva su fuente entre corchetes, por ejemplo [F3].

---

## 0. Recomendación en corto

1. **No mover los archivos a `/salon/`.** Moverlos toca unas 340 rutas en 43 archivos, y eso a media prueba piloto. En su lugar, **`/salon/` como ruta virtual**: una regla de Cloudflare (`_redirects`, reescritura 200) sirve en `/salon/...` los mismos archivos de la raíz. La app instalada usa `scope: "/salon/"`. Así la app no captura los enlaces de la tienda, su service worker nunca toca el checkout y el login queda dentro del scope, cosa que en iPhone es indispensable (§2.3).
2. Antes de la fase 1 hace falta **una prueba de 1 a 2 horas en un deploy de preview** para confirmar cómo reescribe Cloudflare (§6.0). Si falla, el plan B es `scope: "/"` con un service worker que ignore `/tienda/`.
3. **Fase 1:** manifest + íconos + service worker mínimo (solo una página "Sin conexión") + `start_url` a Hoy + atajos (Pasar lista, Calificar, Reportes) + detección del modo app + botón o instrucciones de "Instalar". El candado debe regresar a Hoy después del login.
4. **Fase 2:** que la app abra sin red, con el shell en caché y la estrategia "red primero". Primero hay que fijar las versiones de los CDN.
5. **Fase 2.5 (el paso seguro que más vale):** guardar la cola de Hoy en IndexedDB para que nada capturado se pierda si iOS cierra la app o la página se recarga. Se reenvía al volver.
6. **Todavía no:** captura 100 % sin conexión (fase 3), Background Sync, una segunda PWA "Jissez Tienda", mover archivos ni subdominio.

---

## 1. Instalabilidad hoy (2025-2026)

### 1.1 Qué pide cada plataforma

| Plataforma | Cómo se instala | Requisitos técnicos |
|---|---|---|
| **Chrome Android** | Menú > "Instalar app", o aviso automático o propio (`beforeinstallprompt`). Con Google Play Services se genera un **WebAPK**: aparece en el cajón de apps y en Ajustes > Apps [F4]. | HTTPS; manifest con `name` o `short_name`, `icons` de 192 y 512 px, `start_url` y `display` (`standalone`, `fullscreen` o `minimal-ui`); `prefer_related_applications` ausente o `false`. El usuario debe haber tocado la página al menos una vez y haberla visto 30 s (heurística para el aviso) [F1][F2]. |
| **Chrome escritorio / Edge** | Ícono de instalar en la barra de direcciones, o el menú [F2][F10]. | Los mismos que Android [F1][F2]. |
| **Samsung Internet** (Tab S9 FE+) | Ícono "+" en la barra ("ambient badging") o el menú; en equipos Samsung crea **WebAPK** [F4][F11]. Soporta `beforeinstallprompt` desde la v8 [F12]. | Basado en Chromium: mismos requisitos del manifest. Varias guías todavía le piden service worker [F11b], así que conviene tenerlo. |
| **Safari iOS/iPadOS 16.4 a 18** | Compartir > "Agregar a inicio". Desde 16.4 también desde Chrome, Edge y Firefox en iOS [F2][F13]. No hay `beforeinstallprompt` [F2][F12]. | Abre como app si la página tiene manifest con `display: standalone` (o el meta de Apple). Usa `id` desde 16.4 [F13]. Usa los íconos del manifest **solo si no hay `apple-touch-icon`** [F12]. |
| **Safari iOS/iPadOS 26+** | Igual, con el interruptor **"Abrir como app web"**, activado por defecto para cualquier sitio [F5][F6]. | "Cero requisitos de instalabilidad" [F5]. Si hay manifest, se usan su nombre, íconos, etc. [F5] |
| **Safari macOS 14+ (Safari 17+)** | Archivo > "Agregar al Dock", con o sin manifest [F2][F10]. | Ninguno obligatorio. Los atajos del manifest funcionan desde Safari 17.4 [F12]. |
| Firefox escritorio | No instala PWAs sin extensión [F2][F10]. | Sin impacto: no es navegador de las maestras. |

### 1.2 ¿Sigue haciendo falta un service worker con `fetch`?

- **Para instalar desde el menú: no.** Chrome quitó ese requisito en la v108 (Android) y la v112 (escritorio). Cuando el sitio no trae su propia página sin conexión, Chrome muestra una por defecto [F3]. MDN (2026) lo confirma: el service worker "no es requisito" [F2].
- **Para que Chrome ofrezca solo el aviso de instalar (el mini-infobar o `beforeinstallprompt`): todavía sí.** Chrome dice que el algoritmo del aviso "todavía requiere la presencia de un manejador `fetch()`" [F3]. Un manejador vacío no sirve: Chrome detectaba justo ese truco [F3].
- **Conclusión:** en la fase 1 va un service worker pequeño pero útil. Tiene manejador `fetch` y una página "Sin conexión" propia. Con eso el botón de instalar funciona en Chrome y Samsung Internet sin arriesgar código viejo en caché.

### 1.3 Manifest e íconos

- Campos mínimos: `name`, `short_name`, `icons` (192 y 512), `start_url` y `display` [F1][F2].
- Recomendados: `id` fijo para siempre [F7][F8], `scope`, `description`, `lang`, `theme_color`, `background_color`, `shortcuts` y `screenshots`. Con capturas y descripción, Chrome muestra un diálogo de instalación "tipo tienda de apps" (Android 94+, escritorio 108+). Las capturas `wide` son para escritorio y las demás para móvil [F14].
- Íconos:
  - `192x192` y `512x512` con `purpose: "any"`.
  - Un `512x512` con `purpose: "maskable"` aparte, **sin combinar "any maskable"**. El contenido importante va en el círculo central de radio 40 % [F15]. Se puede revisar en maskable.app [F15].
  - `apple-touch-icon` de 180×180, opaco, para iOS: iOS lo prefiere sobre el manifest [F12].
- Base disponible en el repo: `tienda/assets/jissez-icon-blue.png` (2000×2000). Falta decidir si el ícono de "Mi Salón" se distingue del de la marca Jissez (decisión de Jorge, §7).

---

## 2. Una app solo para Mi Salón en el mismo dominio

### 2.1 ¿Pueden convivir "Mi Salón" y "Jissez Tienda" en `jissez.com`?

- **Técnicamente sí.** Con `id` distintos, el navegador trata cada manifest como otra app [F7][F8].
- **Google lo desaconseja.** Mismo origen con rutas que no se traslapan: "no recomendado". Rutas anidadas (por ejemplo `/` y `/tienda/`): "fuertemente no recomendado" [F9]. En el mismo origen se comparten localStorage, IndexedDB, cookies, permisos y cuota. Desinstalar una puede borrar los datos de la otra, y con rutas anidadas se confunden los avisos de instalar y la captura de enlaces [F9].
- **Para Jissez:** que compartan almacenamiento es justo lo que queremos, porque es la misma sesión de Supabase. El problema real es el traslape. Con Mi Salón en `scope: "/"`, una futura app de la tienda en `/tienda/` quedaría anidada dentro. Con Mi Salón en `/salon/` no se traslapan.
- **Recomendación:** hoy, **una sola PWA (Mi Salón)**. Una PWA de la tienda no aporta nada mientras la tienda se compra desde anuncios y enlaces de WhatsApp.

### 2.2 El `scope` con las páginas en la raíz

Hallazgos en el repo y en producción (verificados el 2026-09-25):

- **Todo está en la raíz.** Las páginas del SaaS (21 archivos: `hoy.html`, `dashboard.html`, `portal.html`, etc.) viven junto a `index.html`, que redirige a la tienda. El `scope` es un **prefijo de ruta** [F16], así que no hay forma de decir "solo estos 21 archivos". Las opciones reales son `/` (todo el sitio, tienda incluida) o una carpeta.
- **Cloudflare quita el `.html`.** El Worker usa `html_handling: auto-trailing-slash`, el valor por defecto [F22]:
  - `https://jissez.com/hoy.html` responde **307 → `/hoy`** (comprobado con `curl -I`), y todos los enlaces internos (`"hoy.html"`, `"tienda/login.html"`) pasan por ese salto.
  - Consecuencias: `start_url` debe ser `/hoy`, sin `.html`, y el service worker nunca debe guardar en caché una respuesta que viene de una redirección (§4.4).
- **Los enlaces son relativos.** Solo `index.html` usa rutas absolutas (`/reset-password`), además de `location.origin + "/reset-password"` en `js/auth.js` y `tienda/js/login.js`. Por eso una ruta virtual `/salon/` funciona casi sin tocar código.
- **El login está fuera de las páginas del SaaS.** El candado (`js/saas-guard.js`) manda a `tienda/login.html` **sin `?next=`**, y el login lleva a `../portal.html`. Dentro de la app instalada, la maestra terminaría en el portal y no en Hoy.

**Opciones:**

| Opción | Qué es | A favor | En contra |
|---|---|---|---|
| **A. `scope: "/"`** | La app abarca todo `jissez.com`. | Cero cambios de rutas. El login queda dentro del scope. | En Android, el WebAPK **registra todas las URL del scope como suyas** [F17]: cualquier enlace a `jissez.com` desde WhatsApp o Gmail (productos, "tus planeaciones están listas") se abriría dentro de Mi Salón. En Chrome escritorio 139+, los enlaces que abren pestaña nueva también lanzan la app [F18]. El service worker controlaría también la tienda y el checkout: un error suyo podría tumbar ventas. Deja anidada cualquier PWA futura de la tienda [F9]. |
| **B1. Mover los archivos a `/salon/`** | Mover las 21 páginas (y quizá `js/`). | Es la solución "limpia" y definitiva. | Costo alto, detallado abajo. |
| **B2. `/salon/` virtual (recomendada)** | Un archivo `_redirects` con `/salon/*  /:splat  200`: Cloudflare sirve en `/salon/hoy` el mismo `hoy.html` [F21]. La app usa `scope: "/salon/"` y `start_url: "/salon/hoy?origen=app"`. | Ningún archivo se mueve. Como los enlaces son relativos, dentro de la app todo se queda bajo `/salon/`, **incluido el login** (`/salon/tienda/login`). Nadie comparte enlaces `/salon/...`, así que en Android la app no captura los de la tienda. El service worker, con scope `/salon/`, **no puede tocar** `/tienda/` ni el checkout. | Depende de cómo Cloudflare combina la reescritura con el salto `.html` → sin `.html`, y de si conserva el `?query` (hay que probarlo, §6.0). Las URL quedan duplicadas: se pone `noindex` a `/salon/*`. |
| C. Subdominio `salon.jissez.com` | El mismo Worker con otro dominio. | Aislamiento total; es lo que recomienda Google para varias apps [F9]. | Otro origen, así que otra sesión: la maestra inicia sesión dos veces. Hay que agregar la URL en Supabase Auth. Es más cambio del que hace falta hoy. |

**Costo y riesgo de mover los archivos (B1), medido en el repo:**

- 199 referencias a `js/`, `css/` y `tienda/` en los HTML de la raíz.
- 139 referencias a páginas `.html`, repartidas en 43 archivos publicados.
- Unas 35 redirecciones a `"index.html"` dentro de `js/*.js`.
- La tienda usa `../js/supabase.js` (14 veces), `../js/campos-formativos.js` y `../js/auth-mensajes.js`, así que `js/` no se puede mover sin romper la tienda.
- Los enlaces de la tienda hacia `../portal.html` y `../dashboard.html` en `tienda/js/tienda-common.js` y `tienda/js/login.js`.
- Pruebas en `pruebas/`, scripts en `.qa/` y `docs/TESTING.md`.
- Redirecciones 301 para los marcadores viejos (`/dashboard` → `/salon/dashboard`, etc.).

En total, unas 300 ediciones mecánicas más unas 40 a mano, y una regresión completa de 21 pantallas. Un enlace que se escape da un 404 en producción. **No conviene durante el piloto.**

### 2.3 ¿Qué pasa al salir del `scope` desde la app instalada?

- **Chrome y Samsung (Android y escritorio).** La página se abre en un "navegador dentro de la app": barra fija con el origen, título y menú, con el color del manifest, y botón para cerrar o abrir en el navegador [F19][F16]. Cuando la navegación vuelve a una URL del scope, ese navegador interno se cierra y la ventana de la app sigue ahí [F19b]. La navegación no se bloquea [F16].
- **iOS/iPadOS.** La página fuera del scope se abre en un `SafariViewController` **aislado del almacenamiento de la PWA** [F19].
- **Consecuencia crítica para el diseño:** si el login quedara fuera del scope, en iPhone la maestra iniciaría sesión en un almacenamiento que la app no ve y entraría en un ciclo de "inicia sesión". Por eso:
  - con la opción B2, el login debe abrirse como `/salon/tienda/login`, lo que ocurre solo porque el candado usa una ruta relativa;
  - con la opción A, el login ya está dentro del scope.
- **Tienda y Mercado Pago desde la app.** El regreso de Mercado Pago es `SITE_URL + "/tienda/mis-compras"` (`supabase/functions/crear-preferencia-mp/index.ts:324`), fuera de `/salon/`. Si una maestra compra dentro de la app, en iPhone volvería a un navegador aislado sin sesión. **En modo app, "Tienda" debe abrirse fuera de la app** (`target="_blank"` a `https://jissez.com/tienda/catalogo.html`), y eso además es lo que Jorge pidió: entrar a trabajar sin pasar por la tienda.

### 2.4 Qué es mejor para Jorge

Conviene la **B2 (`/salon/` virtual) si pasa la prueba de preview**, y si no, la **A**. La A funciona hoy mismo, pero sus efectos secundarios (captura de enlaces de la tienda y service worker sobre el checkout) pegan justo en la parte que genera ingresos. La B2 da el resultado de "instalar solo Mi Salón" sin mover archivos, y deja libre el camino a mover físicamente más adelante: el `id` fijo permite cambiar `start_url` y `scope` sin que la app instalada pierda su identidad [F7].

---

## 3. Entrar directo a trabajar

### 3.1 `start_url` a Hoy, con medición

- `"start_url": "/salon/hoy?origen=app"` (o `"/hoy?origen=app"` con la opción A). Debe ir sin `.html` para evitar el 307. Además, debe estar dentro del scope [F16].
- Un parámetro en `start_url` es la forma recomendada de medir los arranques desde el ícono [F20].
- En Jissez hoy no hay analítica en el SaaS (el portal dice "Sin Pixel de Meta"). Para medir sin terceros, una opción mínima es una columna `perfiles.ultimo_uso_app`, actualizada una vez al día cuando se abre con `origen=app`. **Es un dato nuevo: requiere decisión de Jorge y revisar el aviso de privacidad** (§7).
- El parámetro también sirve como señal fiable de "estoy en la app" en iOS: se guarda en `sessionStorage` (ver §3.4).
- **El candado debe regresar a Hoy.** Hoy `js/saas-guard.js` usa `LOGIN_URL = "tienda/login.html"` sin `?next=`, y tras el login `tienda/js/login.js` manda a `../portal.html`. Se propone agregar `?next=` con la página actual.
  - Cuidado: con el 307, `location.pathname` es `/hoy` sin `.html`, y `LoginDestino.nextSeguro` solo acepta rutas que terminan en `.html`. Hay que agregar el `.html` al construir el `next`.
  - Ese mismo detalle ya afecta a `Tienda.requireSession` (`tienda/js/tienda-common.js:398`), que arma `next` con `pathname.split("/").pop()`. Es un error menor que ya existe hoy.

### 3.2 Atajos (`shortcuts`)

Propuesta:

```json
"shortcuts": [
  { "name": "Pasar lista", "url": "/salon/hoy?origen=atajo#asistencia",
    "icons": [{ "src": "/iconos/atajo-lista-192.png", "sizes": "192x192", "type": "image/png" }] },
  { "name": "Calificar trabajos", "url": "/salon/hoy?origen=atajo#sesiones", "icons": [ ... ] },
  { "name": "Reportes", "url": "/salon/reportes?origen=atajo", "icons": [ ... ] }
]
```

- La URL de cada atajo debe estar dentro del scope [F23][F24]. Chrome Android muestra solo 3 atajos; Windows, hasta 10 [F24]. Los cambios al manifest se aplican como máximo una vez al día [F24].
- Soporte según MDN browser-compat-data [F12]:
  - Chrome Android 84+, Chrome y Edge escritorio 96+.
  - Samsung Internet: hereda de Chrome Android.
  - Safari macOS 17.4+ (menú del Dock).
  - **Safari iOS: no** (mantener presionado no muestra atajos).
- Cambio necesario: `hoy.html` no tiene `id` en sus secciones. Hay que agregar `id="asistencia"`, `id="tareas"`, `id="sesiones"` e `id="cierre"`, y que `js/hoy.js` haga scroll al `#hash` **después** de pintar, porque las listas se llenan tarde y el salto inicial queda mal.

### 3.3 La sesión de Supabase dentro de la app

- **Android y escritorio (Chrome, Samsung, Edge).** El WebAPK o la app de escritorio usan el mismo perfil del navegador, así que comparten el localStorage de `jissez.com`. Si la maestra ya inició sesión en ese navegador, entra directo. Si instaló desde Samsung Internet pero siempre usa Chrome, son dos almacenamientos: inicia sesión una vez en la app.
- **iOS/iPadOS.** El almacenamiento de una app de inicio está **aislado del de Safari** [F25][F4], y cada instalación tiene el suyo [F4]. **Sí, la maestra tiene que iniciar sesión una vez dentro de la app.** Después:
  - las apps de inicio están **exentas del tope de 7 días** de ITP para el almacenamiento escrito por scripts, y llevan su propio contador de días de uso [F25];
  - WebKit concede `navigator.storage.persist()` con más facilidad a las apps de inicio [F26];
  - la cuota es la misma que en el navegador (hasta 60 % del disco por origen) [F26].
- **Cuánto dura la sesión de Supabase.** El token de acceso dura 1 hora por defecto. El refresh token "no expira" y es de un solo uso, así que la sesión dura indefinidamente hasta cerrar sesión, salvo que el proyecto tenga límite de duración o de inactividad (planes Pro) [F27]. `getSession()` refresca solo si el token venció [F28]. **Pendiente verificar en el panel de Supabase de producción** que no haya límite de sesión activado.
- **Riesgo en el piloto: el botón "Cerrar sesión".** En el modo app, el cierre lleva a `index.html`, que redirige a la tienda (`js/section-shell.js`). Conviene que en modo app lleve a `tienda/login.html?next=../hoy.html`.

### 3.4 Detectar el modo instalado

- **CSS/JS estándar:** `matchMedia('(display-mode: standalone)')` [F20][F29].
- **Trampa en iOS:** en una app de inicio con `display: standalone`, iOS reporta **`display-mode: fullscreen`** y no `standalone` (WebKit bug 264218, en MDN browser-compat-data) [F12].
- **Regla robusta** (en un nuevo `js/app-instalada.js`) que pone la clase `html.modo-app`:

```js
var enApp = ["standalone", "fullscreen", "minimal-ui"].some(function (m) {
  return window.matchMedia("(display-mode: " + m + ")").matches;
}) || window.navigator.standalone === true
   || /[?&]origen=(app|atajo)\b/.test(location.search);
try { if (enApp) sessionStorage.setItem("modoApp", "1"); } catch (e) {}
try { enApp = enApp || sessionStorage.getItem("modoApp") === "1"; } catch (e) {}
```

- **Qué ocultar en modo app:**
  - el botón o aviso "Instalar";
  - en el nuevo selector `js/secciones.js`, la pestaña "Tienda". Si se deja, que abra en el navegador con la URL absoluta `https://jissez.com/tienda/index.html` y `target="_blank"`;
  - el portal de tres partes, que en la app sobra porque se entra directo a Hoy;
  - pies de página de marketing.
- **Coordinación con el otro constructor** (el selector ya existe en el repo: `js/secciones.js`, cargado desde `js/navbar.js`, `hoy.html` y `dashboard.html`):
  - `secciones.js` arma sus rutas a partir de su propia URL (`RAIZ = new URL("../", currentScript.src)`). Bajo `/salon/` sus enlaces se quedan en `/salon/`, lo cual es bueno para el scope. Por eso mismo, en modo app su pestaña "Tienda" debe usar la URL absoluta de arriba;
  - `secciones.js` guarda la última sección (`jissez.seccion`) y con ella decide a dónde llega el login. Con el `?next=` del candado (§3.1), la app vuelve a Hoy de todos modos;
  - `sala-maestros.html` (todavía no está en el repo) debe respetar `html.modo-app` y llevar el `<link rel="manifest">` como las demás páginas del SaaS.

---

## 4. Conexión mala en el aula

### 4.1 Qué cachear

- **Recursos de la app (el "shell"): sí, en Cache Storage.** Son HTML, `js/*.js`, CSS, logos y las librerías de CDN. Es lo que recomienda web.dev [F30].
- **Datos de Supabase: no en Cache Storage.** Son por usuaria, están protegidos por RLS, y si el service worker guardara respuestas de PostgREST habría riesgo de mostrar datos viejos o de otra cuenta en un equipo compartido. El service worker **no debe tocar** peticiones a `*.supabase.co`. Si más adelante se guardan datos (fase 3), va en IndexedDB [F30] y con decisión explícita (§4.3).
- **Dependencias externas de todas las páginas del SaaS:**
  - `cdn.tailwindcss.com`: responde 302 a `/3.4.17` **sin cabecera CORS**, así que en caché queda como respuesta opaca. Sirve para `<script>`, pero cuenta con relleno en la cuota de Chrome. Tailwind dice que el Play CDN "no está pensado para producción" [F31].
  - `cdn.jsdelivr.net/npm/@supabase/supabase-js@2`: la versión es **flotante**.
  - `unpkg.com/lucide@latest`: también **flotante** (hoy responde 302 a la 1.48.0).
- **Antes de la fase 2**, hay que **fijar versiones exactas** (`@supabase/supabase-js@2.x.y`, `lucide@1.48.0`, `cdn.tailwindcss.com/3.4.17`). Si no, el caché puede mezclar una librería vieja con otra nueva sin que nadie lo haya probado. Fijar versiones también es buena higiene sin PWA.

### 4.2 ¿Qué tan viable es capturar sin conexión en Hoy?

Hoy no es viable abrir Hoy sin red, por tres motivos:

1. El candado (`js/saas-guard.js`) llama a `sb.auth.getUser()` y lee `perfiles`, las dos por red. Sin red detiene la página con "No se pudo comprobar tu acceso".
2. `js/hoy.js` también llama a `getUser()` (línea 146) y carga grupo, alumnos, sesiones, productos, tareas y calificaciones desde Supabase.
3. Si una lectura falla, `js/lectura.js` **congela** `sb.from` y `sb.rpc`, y ninguna escritura pendiente vuelve a salir.

Para capturar 100 % sin conexión haría falta:

- el shell en caché (fase 2);
- un candado "sin red" que confíe en la sesión local (`getSession()`) y en una copia local de `activo_saas`;
- una **foto del día en IndexedDB**: alumnos, sesiones y productos de hoy, y calificaciones previas;
- una bandeja de salida persistente;
- que las pantallas lean de esa foto.

Son **varios días de trabajo sobre la pantalla más crítica** y, además, guardar en el dispositivo nombres y calificaciones de menores, lo que es una decisión de privacidad (§7).

**Background Sync** (reintentar cuando vuelve la red aunque la página esté cerrada) solo existe en Chromium: Chrome 49+, Edge y Samsung. **Safari y Firefox no lo tienen** [F12][F32]. No se puede depender de él. Además, escribir desde el service worker exigiría darle el token de Supabase. La alternativa que funciona en todas partes es reenviar desde la página al abrir y al recibir el evento `online` [F32].

### 4.3 Riesgos con las calificaciones: cómo guarda hoy `js/hoy.js`

Lo que ya está bien:

- **Cola en serie con reintento** (`procesarCola`, líneas 104-131): la interfaz no espera a la red, y un aviso en pantalla dice "Sin conexión: se guardará en cuanto vuelva la red. No cierres esta página".
- **Las escrituras son idempotentes:**
  - asistencia: `upsert` con `onConflict: grupo_id,alumno_id,fecha` (líneas 288-296);
  - cierre del día: `upsert` en `registro_diario` con `maestro_id,alumno_id,fecha` (líneas 302-335) y borrado por clave (líneas 346-350);
  - calificación: `update` por id, o `insert`. Si el insert choca con el índice único (23505, "otro dispositivo o esta pantalla abierta dos veces"), adopta la fila existente (líneas 360-406). **No hay duplicados.**
- `fecha` se fija al abrir la página (línea 25) y viaja en la tarea, y `beforeunload` avisa si hay pendientes (línea 139).

Lo que falla o es riesgoso con mala señal:

1. **La cola vive solo en memoria**, como funciones (closures). Si iOS cierra la app en segundo plano (las apps de inicio se descargan de memoria con frecuencia), si se recarga, o si `Lectura` detiene la página, **lo pendiente se pierde**. Pedir "No cierres esta página" no es realista en un celular.
2. **Reintenta para siempre ante cualquier error**, no solo de red. Un 4xx real (RLS, un `check_violation`, un producto desactivado) se queda girando con el mensaje "Sin conexión", que es falso, y bloquea todo lo que viene detrás en la cola.
3. **`evaluado_en` se calcula al enviar** (línea 382), no al capturar. Con envíos tardíos gana el **último en llegar**, no el último en capturarse. Si la tablet sin red se sincroniza horas después, puede pisar una corrección hecha desde el celular con red.
4. **Boletas cerradas.** `cerrar_boleta()` guarda una foto inmutable (`supabase/mi_salon_b8_cierre_2026-09.sql`), pero **nada impide escribir `calificaciones` después del cierre**. Una captura que se sincroniza tarde entra a la base sin cambiar la boleta cerrada, y la maestra cree que contó. Es poco probable (el cierre es trimestral), pero es silencioso.
5. **No son idempotentes y requieren red:** "Agregar producto" (`insert` en `productos_sesion`, línea 795) y "Trabajar hoy / Quitar de hoy" (`update` de `sesiones` y recarga, línea 772). En una captura sin conexión deben desactivarse, no encolarse.
6. `asistencia.js` tiene su propio autoguardado (`delete` + `upsert`). Quedaría fuera del paso mínimo.

**Paso mínimo seguro (fase 2.5), solo para Hoy:**

1. Convertir cada tarea en un **dato serializable**, `{ id, tipo, clave, datos, fecha, capturado_en, maestro_id }`, y guardarlo en **IndexedDB** antes de intentar enviarlo. Al confirmarse el envío, se borra.
2. **Juntar por clave**: `asistencia:alumno:fecha`, `calif:alumno:producto`, `registro:alumno:fecha`. Queda solo el último valor de cada alumno y producto, y se conserva el orden de llegada entre claves distintas.
3. **Reenviar** al abrir Hoy (con red y sesión) y en el evento `online`, solo si `maestro_id` coincide con la sesión actual. En un equipo compartido, lo de otra maestra no se envía ni se borra.
4. **Separar los errores:**
   - red o 5xx (ya existe `Lectura.errorDeRed`): se reintenta;
   - JWT vencido: se llama `getSession()`, que refresca [F28], y se reintenta;
   - cualquier otro 4xx: la tarea se aparta a una lista **"No se pudo guardar"** visible, con el alumno y el producto, y nunca se descarta en silencio.
5. **Calificaciones con "gana la captura más reciente":**
   - `evaluado_en = capturado_en`;
   - `update ... .eq("id", id).or("evaluado_en.is.null,evaluado_en.lte." + capturado_en)`: si en la base hay algo más nuevo, no se pisa y se avisa;
   - no cambia el esquema, porque `evaluado_en` ya existe.
6. **Capturas de días anteriores** (`fecha < hoy`): antes de enviar, consultar `boleta_esta_cerrada(alumno, ciclo, trimestre)` (ya existe). Si está cerrada, apartar y avisar en lugar de escribir.
7. **Cerrar sesión con pendientes:** avisar y no borrar la bandeja.
8. Cambiar el texto "No cierres esta página" por "Guardado en este dispositivo; se enviará cuando vuelva la señal".

Riesgo del paso mínimo: bajo. No cambia el esquema ni las reglas de calificación, solo cómo sobrevive la cola.

### 4.4 No servir código viejo después de un despliegue

- **Cómo se actualiza el service worker.** El navegador revisa `sw.js` en cada navegación dentro del scope, compara byte a byte e ignora la caché HTTP por defecto (Chrome 68+, `updateViaCache`) [F33]. La versión nueva espera a que no haya pestañas usando la vieja. `skipWaiting()` evita la espera, pero puede dejar páginas viejas con el service worker nuevo [F33].
- Cloudflare ya sirve todo con `Cache-Control: public, max-age=0, must-revalidate` y ETag (comprobado en producción) [F34].
- **Estrategia propuesta:**
  1. **"Red primero" para todo lo del mismo origen** (HTML, JS, CSS). Con red, siempre llega el código recién desplegado, y la caché solo se usa si `fetch` falla. Así, **olvidar subir la versión no sirve código viejo a quien tiene red**. Sin tiempo límite: con señal lenta tarda, pero no mezcla versiones.
  2. **"Caché primero" solo para URLs de CDN con versión fija** (§4.1).
  3. `const VERSION = "salon-AAAA-MM-DD-n"` en `sw.js` y una lista del shell. Al activarse, se borran las cachés de otra versión y se vuelve a bajar **el shell completo** para que la copia sin conexión sea coherente, no una mezcla de páginas de distintos despliegues.
  4. **Nunca recargar sola una página abierta**: Hoy puede tener capturas en la cola. Como mucho, mostrar "Hay una versión nueva; se usará la próxima vez que abras".
  5. **Redirecciones de Cloudflare.** No guardar en caché una respuesta con `redirected: true`; Chrome la rechaza al responder a una navegación. Guardar y buscar con la URL sin `.html` (`/salon/hoy`). En las navegaciones a `x.html`, el service worker puede pedir `x` directo y así ahorra el 307, un viaje de red menos con mala señal.
  6. **Plan de emergencia.** Tener listo un `sw.js` "desactivador" que borre sus cachés y se dé de baja [F35]. No usar `Clear-Site-Data: "storage"`, porque borraría también la sesión de Supabase.
  7. **El service worker no toca** `*.supabase.co`, Mercado Pago, fuentes ni `/tienda/`.
     - Con la opción B2, esto se cumple por construcción: el scope `/salon/` no incluye `/tienda/`.
     - Con la opción A, se consigue con la Static Routing API (`addRoutes`, Chrome 123+ y Safari 27) [F12][F36], o simplemente sin llamar a `respondWith`.

---

## 5. Página de presentación e invitación a instalar

**La presentación (antes de comprar).** Es una página pública, por ejemplo `tienda/mi-salon.html`, dentro de la marca de la tienda:

- una promesa concreta en una línea, del tipo "Pasa lista y califica en minutos; la boleta se arma sola";
- 3 beneficios con capturas reales de Hoy en tablet y celular: multigrado, boleta NEM y reportes para la junta;
- cómo se ve en el aula;
- privacidad en lenguaje simple, con enlace al aviso;
- preguntas frecuentes: si funciona en celular y tablet, si hay que instalar algo, qué pasa sin señal. **No prometer "funciona sin internet" hasta la fase 2.5 o 3**;
- un solo llamado a la acción: "Pedir acceso" mientras Mi Salón sea por invitación, o "Entrar";
- testimonios (Fanny) solo con permiso;
- como la usarán en tablet, las capturas del manifest deben ser las mismas, en formato `wide` y `narrow`, para el diálogo de instalación con capturas de Chrome [F14].

**Cuándo mostrar "Instalar":**

- **Solo a cuentas con Mi Salón** (`activo_saas = true`) y con sesión. Si instala alguien sin acceso, el candado lo manda al catálogo y la "app Mi Salón" se vuelve la tienda.
- **Nunca en la primera visita ni como ventana que interrumpe.** Se muestra después de un momento de logro: por ejemplo, cuando se guarda la primera lista o al segundo día de uso. Además, queda **siempre disponible** una opción discreta "Instalar Mi Salón" en el menú [F37][F38].
- **Chromium (Chrome, Edge, Samsung):**
  - escuchar `beforeinstallprompt`, llamar `preventDefault()` y guardarlo;
  - mostrar el botón solo si llegó el evento;
  - al tocarlo, `prompt()`;
  - escuchar `appinstalled` para ocultarlo [F37].
- **iOS/iPadOS (sin evento):** mostrar instrucciones solo si es iOS y **no** está en modo app [F38]:
  - 1) botón Compartir (ícono Lucide `share`);
  - 2) "Agregar a inicio";
  - 3) en iOS 26, dejar activado "Abrir como app web" [F6];
  - 4) abrir el ícono "Mi Salón" e iniciar sesión una vez.
  - Aclarar que conviene hacerlo desde la pantalla Hoy (`/salon/hoy`), no desde la tienda, porque iOS toma el manifest de la página donde se está.
- **Si la maestra dice "Ahora no":** no volver a mostrarlo en 30 días (en `localStorage`, con `try/catch`).
- Sin emojis, con iconos Lucide y botones de 44 px o más, según las reglas del proyecto.

---

## 6. Plan por fases

### 6.0 Prueba previa (1 a 2 h, en un deploy de preview, no en producción)

Objetivo: confirmar la opción B2 antes de escribir la fase 1.

1. Crear `_redirects` en la raíz, **sin agregarlo a `.assetsignore`**, porque si no Cloudflare no lo lee:
   ```
   /salon            /salon/hoy   302
   /salon/           /salon/hoy   302
   /salon/*          /:splat      200
   ```
2. Con `curl -I` y en el navegador, verificar:
   - `/salon/hoy` responde 200 con el contenido de Hoy y la barra sigue en `/salon/hoy`;
   - `/salon/js/hoy.js` responde 200 con `text/javascript`;
   - **`/salon/hoy.html`**: si responde 307 a `/hoy`, se sale del scope. En ese caso, probar antes de la regla general `/salon/:pagina.html  /salon/:pagina  301`, o una línea por página. Son unas 21 del SaaS y unas 16 de la tienda; el límite es de 2000 reglas [F21];
   - **que se conserve el `?query`** en `/salon/reporte-alumno.html?alumno=...` y en el login con `?next=`. Esto **bloquea la opción** si falla;
   - `/salon/tienda/login` entra, y tras el login `../portal.html` cae en `/salon/portal`;
   - `_headers` con `X-Robots-Tag: noindex` para `/salon/*` [F34], y ver si aplica sobre la ruta original o la reescrita.
3. Si todo pasa, seguir con B2. Si falla lo del `?query` o el `.html`, usar la opción A y aplicar desde ya la regla 7 de §4.4.

### Fase 1: instalable y entra directo a Hoy (1 a 2 días)

| Archivo | Qué |
|---|---|
| `_redirects`, `_headers` (nuevos) | Los de §6.0. `_headers` también con `Content-Type: application/manifest+json` para el manifest (verificar si Cloudflare ya lo pone) y `noindex` para `/salon/*`. |
| `salon.webmanifest` (nuevo, raíz) | `id: "/mi-salon"` (no cambiarlo nunca), `name: "Mi Salón · Jissez"`, `short_name: "Mi Salón"`, `description`, `lang: "es-MX"`, `start_url: "/salon/hoy?origen=app"`, `scope: "/salon/"`, `display: "standalone"`, `theme_color: "#1e40af"` (el `bg-blue-800` de la barra), `background_color: "#f9fafb"`, `icons` (192 y 512 "any", 512 "maskable"), `shortcuts` (§3.2). Sin `orientation`: la tablet va horizontal y el celular vertical. |
| `iconos/` (nuevo) | `mi-salon-192.png`, `mi-salon-512.png`, `mi-salon-maskable-512.png`, `apple-touch-icon-180.png`, e íconos de atajos de 192. |
| `sw.js` (nuevo, raíz; se registra como `/salon/sw.js`) | Mínimo: en `install`, guarda la página sin conexión. En `fetch`, **solo navegaciones**: red, y si falla, la página sin conexión. Todo lo demás no se toca (sin `respondWith`). En `activate`, borra las cachés viejas. Opcional: navigation preload. |
| `sin-conexion.html` (nuevo) | Página autónoma, sin CDN, con estilos en línea, texto "Sin conexión" y botón Reintentar (44 px). |
| `js/app-instalada.js` (nuevo) | Registra el service worker **solo si `location.pathname` empieza con `/salon/`**. Pone `html.modo-app` (§3.4). Guarda `beforeinstallprompt` y expone `AppInstalada.puedeInstalar()`, `.instalar()` y `.esIOS()`. |
| Las 21 páginas del SaaS (y `sala-maestros.html`) | En `<head>`: `<link rel="manifest" href="/salon.webmanifest">`, `<meta name="theme-color" content="#1e40af">`, `<link rel="apple-touch-icon" href="/iconos/apple-touch-icon-180.png">` y `<script src="js/app-instalada.js"></script>`. |
| `js/saas-guard.js` | `LOGIN_URL` con `?next=` a la página actual, con `.html` agregado (§3.1). |
| `hoy.html`, `js/hoy.js` | `id` en las 4 secciones; scroll al `#hash` después de pintar. |
| `js/navbar.js` (y `js/secciones.js`) | Opción de menú "Instalar Mi Salón" (Chromium: `prompt()`; iOS: hoja con instrucciones). En modo app, ocultarla, y "Tienda" abre fuera de la app. |
| `js/section-shell.js`, `js/navbar.js` | Al cerrar sesión en modo app, ir a `tienda/login.html?next=../hoy.html`. |
| Punto de entrada desde el navegador | En `portal.html` o `dashboard.html`, cuando la maestra usa la web normal, "Instalar Mi Salón" lleva a `/salon/hoy?instalar=1`, porque desde `/hoy` fuera de `/salon/` el manifest no corresponde a la página. |

**Riesgos de la fase 1:**

- El comportamiento de la reescritura en Cloudflare (se mitiga con §6.0).
- Un service worker con error solo afecta a `/salon/`, no a la tienda.
- En iOS, el primer login dentro de la app: comunicarlo a Fanny.
- En iPhone con la app instalada, probar la descarga del PDF de la boleta (`html2pdf`), la impresión y el "compartir por WhatsApp". En el modo app de iOS estos flujos se comportan distinto que en Safari.

**Cómo probarlo:**

- **Chrome DevTools > Application > Manifest.** Revisar la sección *Installability* (errores), la identidad (el `id` calculado), la vista previa maskable y los atajos [F39]. **Lighthouse ya no tiene categoría PWA** (se quitó en Lighthouse 12, en 2024) [F40]: usar DevTools en su lugar.
- **DevTools > Service Workers.** Casilla "Offline": navegar a `/salon/asistencia` y que aparezca "Sin conexión". Casilla "Update on reload" mientras se desarrolla [F39].
- **Android (Chrome):** instalar, confirmar que aparece en el cajón de apps, que abre en Hoy y que los 3 atajos aparecen al mantener presionado. Un enlace de producto de la tienda enviado por WhatsApp debe abrir el **navegador**, no la app.
- **Tab S9 FE+ (Samsung Internet):** ícono "+" en la barra, instalación, arranque en Hoy en horizontal, atajos.
- **iPhone real (iOS 26 y, si hay, uno 17 o 18):**
  - agregar a inicio desde `/salon/hoy` e iniciar sesión dentro de la app;
  - cerrar la app a la fuerza, reabrir y comprobar que la sesión sigue;
  - modo avión: debe aparecer la página "Sin conexión";
  - tocar "Tienda": se abre fuera de la app.
- **Producción:** `curl -I https://jissez.com/salon/hoy`, `/salon.webmanifest` y `/salon/sw.js`, para ver el código de respuesta y el `content-type`.

### Fase 2: la app abre sin conexión (el shell) (1 a 2 días)

| Archivo | Qué |
|---|---|
| Las 21 páginas + `tienda/login.html` | Fijar versiones: `@supabase/supabase-js@2.x.y`, `lucide@1.48.0`, `cdn.tailwindcss.com/3.4.17` (§4.1). |
| `sw.js` | Lista del shell: las páginas del SaaS sin `.html`, `js/*.js`, logos, `tienda/css/tienda.css` y `tienda/js/tienda-theme.js` (los usa el portal), más las 3 URLs de CDN fijadas. Estrategias de §4.4 (red primero para el mismo origen, caché primero para CDN con versión). Refresco completo del shell en `activate`. |
| `js/saas-guard.js`, `js/lectura.js` | Si `navigator.onLine === false` o hay error de red, mostrar un aviso propio ("Sin señal: se mostrará cuando vuelva") en vez de "No se pudo comprobar tu acceso", con reintento automático en `online`. **No** dejar pasar sin comprobar: eso le toca a la fase 3. |

**Beneficio real:** con señal intermitente, la app arranca al instante desde caché y reintenta. Sin ninguna señal, la maestra ve un aviso claro, no una pantalla blanca de error del navegador.

**Riesgos:**

- Mezcla de versiones, que se mitiga con "red primero" y el refresco completo del shell.
- Cuota: las respuestas opacas de Tailwind.
- Un service worker que no se actualiza (se mitiga con el desactivador de §4.4).

**Cómo probarlo:**

- DevTools > Application > Cache Storage: el contenido esperado.
- Casilla "Offline": abrir la app, navegar entre páginas y ver el aviso.
- Desplegar un cambio visible y comprobar que con red se ve en la siguiente carga, sin borrar caché.
- En Android, `chrome://inspect` para depurar el WebAPK.
- En iPhone, Web Inspector desde una Mac (Safari 26 puede inspeccionar service workers automáticamente [F5]).

### Fase 2.5: la cola de Hoy no se pierde (2 a 3 días), recomendada

- **Qué cambia:** `js/hoy.js` y un módulo nuevo, `js/bandeja-salida.js` (IndexedDB), que implementan el paso mínimo seguro de §4.3. Sin cambios de esquema. Opcional: `navigator.storage.persist()` en modo app [F26].
- **Riesgos:**
  - la lógica de "gana la captura más reciente";
  - equipos compartidos;
  - boleta cerrada;
  - todos cubiertos en §4.3.
- **Cómo probarlo:**
  - en DevTools > Network, poner "Offline" o "Slow 3G", capturar 10 asistencias y 5 calificaciones, **cerrar la pestaña o la app**, reabrir con red y comprobar en Supabase (**proyecto de pruebas `docentes-pruebas`, no producción**) que están todas, sin duplicados;
  - forzar un 4xx: debe aparecer en "No se pudo guardar";
  - dos dispositivos: la corrección más reciente gana;
  - en iPhone: modo avión, capturar, deslizar para cerrar la app, quitar el modo avión, reabrir.
- Usar solo el proyecto de pruebas (lección del 2026-09-23).

### Fase 3: captura 100 % sin conexión (solo si el piloto lo justifica)

- **Qué implica:**
  - foto del día en IndexedDB (alumnos, sesiones y productos de hoy, calificaciones previas);
  - candado sin red con `getSession()` local y una copia de `activo_saas`;
  - Hoy leyendo de la foto;
  - "Agregar producto" y "Trabajar hoy" desactivados sin red;
  - hacer lo mismo en `asistencia.js`, o redirigir la captura a Hoy.
- **Condición para hacerla:** que el piloto muestre que las maestras se quedan **sin nada de señal durante clases completas**, no solo con señal intermitente, que ya cubre la fase 2.5.
- **Privacidad:** guardaría en el dispositivo datos de menores, así que Jorge tiene que decidir y actualizar el aviso (§7).
- **Esfuerzo:** 1 a 2 semanas con QA.
- **Pruebas:** las de la fase 2.5, más un arranque en frío en modo avión en Android, en la Tab S9 y en iPhone.

---

## 7. Decisiones que necesita Jorge

1. Si se aprueba la ruta virtual `/salon/` (B2), con la prueba previa, o se prefiere `scope: "/"` (A).
2. **El ícono y el nombre de la app:** "Mi Salón" con ícono propio o el ícono de Jissez.
3. **Medir los arranques desde el ícono** (`perfiles.ultimo_uso_app`): es un dato nuevo, así que hay que revisar el aviso de privacidad.
4. **En modo app, la Tienda:** ocultarla, o que abra fuera de la app (recomendado).
5. **Fase 3:** si más adelante se guardan datos de alumnos en el dispositivo, eso requiere una decisión de privacidad y actualizar el aviso.
6. **Verificar en Supabase de producción** que no haya límite de duración ni de inactividad de sesión (afecta cuánto dura el login en la app).

---

## 8. Fuentes

- [F1] web.dev, "What does it take to be installable?" (2024-09-19). https://web.dev/articles/install-criteria
- [F2] MDN, "Making PWAs installable" (modificada 2026-09-07). https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
- [F3] Chrome for Developers, "Revisiting Chrome's installability criteria" (2023-12-05). https://developer.chrome.com/blog/update-install-criteria
- [F4] web.dev Learn PWA, "Installation" (2024-09-20). https://web.dev/learn/pwa/installation
- [F5] WebKit, "WebKit Features in Safari 26.0". https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- [F6] Apple Support, "Turn a website into an app in Safari on iPhone". https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios
- [F7] Chrome for Developers, "Uniquely identifying PWAs with the web app manifest id property". https://developer.chrome.com/docs/capabilities/pwa-manifest-id
- [F8] MDN, manifest `id` (2025-05-05). https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id
- [F9] web.dev, "Building multiple Progressive Web Apps on the same domain" (2024-09-20). https://web.dev/articles/building-multiple-pwas-on-the-same-domain
- [F10] MDN, "Installing and uninstalling web apps" (modificada 2026-09-17). https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing
- [F11] Samsung Internet Developers, "Progressive Web Apps". https://samsunginternet.github.io/docs/progressive-web-apps
- [F11b] Samsung Internet Developers (Medium), "PWA Series: Service Workers". https://medium.com/samsung-internet-dev/pwa-series-service-workers-the-basics-about-offline-a6e8f1d92dfd
- [F12] MDN browser-compat-data (consultado 2026-09-25): `manifests/webapp/{shortcuts,id,scope,start_url,icons,launch_handler}.json`, `api/SyncManager.json`, `api/Window.json` (`beforeinstallprompt`), `css/at-rules/media.json` (`display-mode`, nota del bug de WebKit 264218), `api/InstallEvent.json` (`addRoutes`). https://github.com/mdn/browser-compat-data
- [F13] WebKit, "WebKit Features in Safari 16.4". https://webkit.org/blog/13966/webkit-features-in-safari-16-4/
- [F14] Chrome for Developers, "Richer PWA installation UI" y web.dev "How to add Richer Install UI". https://developer.chrome.com/blog/richer-pwa-installation · https://web.dev/patterns/web-apps/richer-install-ui
- [F15] web.dev, "Adaptive icon support in PWAs with maskable icons". https://web.dev/articles/maskable-icon
- [F16] MDN, manifest `scope` (2025-06-23). https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/scope
- [F17] web.dev / Google Developers, "WebAPKs on Android" (filtros de intent para todo el scope). https://developers.google.com/web/fundamentals/integration/webapks
- [F18] Chrome for Developers, "Navigation management into installed PWAs" (Chrome 139, 2025-08-19). https://developer.chrome.com/docs/capabilities/pwa-navigation-management
- [F19] web.dev Learn PWA, "Window management" (fuera del scope; SafariViewController aislado en iOS). https://web.dev/learn/pwa/windows
- [F19b] web.dev Learn PWA, "Window management", sección OAuth y navegador dentro de la app. https://web.dev/learn/pwa/windows
- [F20] web.dev Learn PWA, "Detection" (2024-09-18). https://web.dev/learn/pwa/detection
- [F21] Cloudflare Docs, Workers Static Assets, "Redirects" (2026-08-25; proxy 200, splats, límites). https://developers.cloudflare.com/workers/static-assets/redirects/
- [F22] Cloudflare Docs, "HTML handling" (`auto-trailing-slash` por defecto; `/file.html` → 307 → `/file`). https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/
- [F23] MDN, manifest `shortcuts` (2025-11-30). https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/shortcuts
- [F24] web.dev, "Get things done quickly with app shortcuts". https://web.dev/articles/app-shortcuts
- [F25] WebKit, "Tracking Prevention in WebKit", sección "Home Screen Web Application Domain Exempt From ITP". https://webkit.org/tracking-prevention/
- [F26] WebKit, "Updates to Storage Policy" (2023-08-10). https://webkit.org/blog/14403/updates-to-storage-policy/
- [F27] Supabase Docs, "User sessions". https://supabase.com/docs/guides/auth/sessions
- [F28] Supabase Docs, `auth.getSession()`. https://supabase.com/docs/reference/javascript/auth-getsession
- [F29] web.dev, "How to provide your own in-app install experience". https://web.dev/articles/customize-install
- [F30] web.dev, "Storage for the web". https://web.dev/articles/storage-for-the-web
- [F31] Tailwind CSS, "Play CDN". https://tailwindcss.com/docs/installation/play-cdn
- [F32] MDN, "Background Synchronization API" (2024-04-22). https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API
- [F33] web.dev, "The service worker lifecycle". https://web.dev/articles/service-worker-lifecycle
- [F34] Cloudflare Docs, Workers Static Assets, "Headers" (`_headers` y `Cache-Control` por defecto). https://developers.cloudflare.com/workers/static-assets/headers/
- [F35] Chrome for Developers (Workbox), "Removing buggy service workers". https://developer.chrome.com/docs/workbox/remove-buggy-service-workers
- [F36] WebKit, "WebKit Features for Safari 27.0" (2026-09-17; Static Routing API). https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ · Chrome: https://developer.chrome.com/blog/service-worker-static-routing
- [F37] web.dev, "How to provide your own in-app install experience". https://web.dev/articles/customize-install
- [F38] web.dev Learn PWA, "Installation prompt". https://web.dev/learn/pwa/installation-prompt
- [F39] Chrome for Developers, "Debug Progressive Web Apps" (DevTools > Application). https://developer.chrome.com/docs/devtools/progressive-web-apps
- [F40] Lighthouse v12.0.0 (se quita la categoría PWA). https://github.com/GoogleChrome/lighthouse/releases/tag/v12.0.0

Verificado directamente en producción (2026-09-25, `curl -I`):
- `jissez.com/hoy.html` responde 307 → `/hoy`, y `/tienda/login.html` responde 307 → `/tienda/login`.
- Los assets llevan `Cache-Control: public, max-age=0, must-revalidate` con ETag.
- `cdn.tailwindcss.com` responde 302 → `/3.4.17`, sin CORS.
- `unpkg.com/lucide@latest` responde 302 → `1.48.0`.
- `supabase-js@2` en jsdelivr lleva `access-control-allow-origin: *`.

---

## Decisiones de Jorge (2026-09-25)

| Tema | Decisión |
|---|---|
| Separación | Ruta virtual `jissez.com/salon/` (scope `/salon/`), sin mover archivos. Antes, prueba de 1 a 2 horas en un deploy de preview de Cloudflare (redirección 307 de `.html` y `?query` dentro de `/salon/`); si falla, plan B: scope `/` con un service worker que ignore `/tienda/` |
| Nombre | `name`: "Jissez Mi Salón"; `short_name` (bajo el ícono): "Jissez MS" |
| Tienda dentro de la app | Se abre fuera, en el navegador |
| Alcance ahora | Fase 1 (instalable, entra directo a Hoy, atajos, página sin conexión) + fase 2.5 (la cola de Hoy se guarda en el dispositivo y se reenvía al volver la red). La captura 100 % sin conexión (fase 3) no se hace todavía |
| Medición de aperturas | No, por ahora (sería un dato nuevo para el aviso de privacidad) |

---

## 9. Lo que quedó hecho (fase 1 y fase 2.5, 2026-09-25)

Rama `mi-salon-parte-b`. Probado en local contra el proyecto de pruebas, con `/salon/` emulado en `.qa/servidor.js` (lee `_redirects` igual que Cloudflare) y Chromium de Playwright.

### 9.1 Archivos

| Archivo | Qué hace |
|---|---|
| `salon.webmanifest` | `id: "/mi-salon"` (fijo para siempre), `name` "Jissez Mi Salón", `short_name` "Jissez MS", `lang` es-MX, `scope` `/salon/`, `start_url` `/salon/hoy?origen=app`, `display` standalone, `theme_color` `#1e3a8a`, `background_color` `#faf9f4`, íconos 192 y 512 (`any`) y 512 (`maskable`, con la J dentro del círculo seguro) y 3 atajos: Pasar lista (`/salon/hoy?origen=atajo#asistencia`), Calificar trabajos (`#sesiones`) y Reportes (`/salon/reportes?origen=atajo`). |
| `iconos/` | Íconos con la J blanca de `tienda/assets/jissez-icon-white.png` sobre el azul pizarrón (generados con un canvas en Chromium: `.qa/constructor-p-pwa/iconos.js`): `mi-salon-192.png`, `mi-salon-512.png`, `mi-salon-maskable-512.png`, `apple-touch-icon-180.png` (opaco; iOS pone las esquinas) y los de los atajos. |
| `sw.js` | Se registra como `/salon/sw.js` (alcance `/salon/`). Navegaciones: red primero y, si falla o no contesta en 9 s (`LIMITE_NAVEGACION`: señal muy débil), la página "Sin conexión" guardada. Solo guarda esa página y su ícono, en un caché con `VERSION`; al activarse una versión nueva borra las anteriores. No toca otros orígenes (Supabase, CDN) ni guarda páginas, scripts o datos: con red siempre llega lo recién desplegado. **Al cambiar `sw.js` o `sin-conexion.html`, subir `VERSION`.** |
| `sin-conexion.html` | Página autónoma (sin CDN) con la marca y "Reintentar"; se recarga sola al volver la red. Si hay capturas de Hoy guardadas en el dispositivo, dice cuántas; con sesión, solo las de esa cuenta (la lee de la sesión guardada, sin red). |
| `js/app-instalada.js` | En el `<head>` de las 22 páginas de Mi Salón, junto con el manifest, `theme-color`, `apple-touch-icon` y los meta `apple-mobile-web-app-*` (rutas absolutas: valen desde `/` y desde `/salon/`). Registra el service worker solo bajo `/salon/`. Detecta el modo app: `display-mode: standalone` (o `minimal-ui`); en iPhone/iPad también `fullscreen` y `navigator.standalone`; y `?origen=app|atajo` (solo para esa página; no se guarda ni se manda). Pone `html.modo-app`. Botón "Instalar la app". |
| `js/secciones.js` | Bajo `/salon/`, la pestaña Tienda va a la tienda de siempre (`/tienda/`, fuera de la app) y, en la app instalada, con `target="_blank"` (se abre en el navegador). Mi Salón y Sala de Maestros se quedan en `/salon/`. Fuera de `/salon/` nada cambia. |
| `js/saas-guard.js`, `js/lectura.js` | Bajo `/salon/`, sin sesión se va al login **de la app** (`/salon/tienda/login?next=../<página>.html`), que regresa a la página que se abría. La capa de lectura lo hace también para las páginas que preguntan la sesión por su cuenta (antes mandaban a `index.html` y le ganaban al candado). Una cuenta sin acceso va a `/tienda/catalogo.html`. Fuera de `/salon/`, igual que antes. |
| `js/navbar.js`, `js/section-shell.js`, `js/cuenta.js`, `js/mi-grupo.js`, `js/sala-maestros.js` | Cerrar sesión bajo `/salon/` lleva al login de la app (`?next=../hoy.html`); fuera, como antes. El menú de la cuenta trae "Instalar la app" (oculto hasta que se pueda). |
| `index.html`, `js/portal.js` | `/salon/` (a donde llegan las salidas sin sesión) lleva al login de la app. El portal bajo `/salon/` nunca manda a la tienda. |
| `tienda/js/login.js` | Bajo `/salon/`: sin `?next=`, una cuenta con Mi Salón entra a Hoy (sin grupo, al alta); los enlaces de la página (Volver a la tienda, logo, aviso de privacidad, términos) van a `/tienda/...` y, en la app, al navegador. En `/tienda/login` no cambia nada. |
| `dashboard.html` | Lugar `#instalarAppSlot` para la tarjeta "Instala Mi Salón como app", al final de Inicio. |
| `hoy.html`, `js/hoy.js`, `js/bandeja-salida.js` | Fase 2.5 (§9.3). Las secciones tienen `id` (`asistencia`, `tareas`, `sesiones`, `cierre`) y Hoy salta al `#hash` después de pintar (atajos). |

### 9.2 Botón "Instalar la app"

- Solo con el acceso a Mi Salón confirmado por el candado, y nunca dentro de la app.
- **Chrome, Edge y Samsung Internet:** se guarda `beforeinstallprompt` y el botón abre el aviso del navegador. Chromium da el aviso también en las páginas de la raíz (el manifest instala la app de `/salon/`); si no llega, el botón lleva a `/salon/hoy?instalar=1`, que ofrece "Instalar" en cuanto llega el aviso o, si no llega en 4 s (ya instalada, o el navegador no lo da), explica cómo hacerlo desde el menú del navegador.
- **iPhone y iPad:** hoja con instrucciones (Compartir → Agregar a pantalla de inicio → dejar activado "Abrir como app web" → abrir Jissez MS e iniciar sesión una vez). Desde la raíz ofrece ir primero a Mi Salón.
- Lugares: tarjeta al final de Inicio y opción del menú de la cuenta. Iconos SVG en línea, botones de 44 px.

### 9.3 La cola de Hoy en el dispositivo (fase 2.5)

- Cada captura (asistencia, calificación de producto, cierre del día, retirar el cierre, retroalimentación) se guarda primero en IndexedDB (`jissez-bandeja`, almacén `pendientes`) y se envía en serie. Se borra solo cuando la base la confirmó. Sin IndexedDB, la cola vive en memoria como antes y cerrar la página pregunta.
- **Una captura por llave** (asistencia: grupo + alumno + fecha; cierre: alumno + fecha; calificación: alumno + producto): la más reciente del dispositivo reemplaza a la anterior. Si la versión vieja iba en camino, al volver no borra la nueva.
- **Concurrencia optimista: dos dispositivos no se pisan (2026-09-25, tras R11).** No depende de ningún reloj.
  - **La "versión" de un dato es su contenido en la base:** asistencia `{estado}`; cierre del día `{participación, conducta}`; calificación `{estado de entrega, semáforo, puntaje, retroalimentación}`; "no hay fila" es una versión más. Se eligió así porque `registro_diario` no tiene columna de versión y `evaluado_en` de `calificaciones` lo pone el reloj del aparato (`asistencias.updated_at` sí es del servidor, pero la regla es la misma para las tres tablas).
  - **Cada captura guarda la versión que vio** la pantalla al tocarla (`base`; Hoy la lleva en `enBase` y la actualiza con cada confirmación). Si ya había una captura pendiente de la misma llave, la nueva hereda esa base, y lo que este dispositivo ya pudo haber escrito (capturas que se intentaron enviar, o que llegaron mientras la nueva esperaba) queda como "propio".
  - **Al enviar, la escritura es condicional y atómica en un solo statement de PostgREST:** `update`/`delete` con filtros "la fila sigue con el valor que vi" (`eq`/`is null` por columna); si no existía, `insert` que no pisa (`ON CONFLICT DO NOTHING` en asistencias y cierre; en calificaciones el índice único es parcial, así que el insert que choca responde 23505, y una captura que esperó en la cola mira antes para no dejar un 409 en la consola). No hace falta función SQL: RLS y las políticas restrictivas de referencias propias aplican igual que antes, sin cambios de esquema.
  - **Si no aplicó, se lee la fila:** si ya tiene lo capturado, listo (reenviar no duplica); si tiene la versión vista o una propia, se repite la escritura condicional con ese valor; si tiene **otra cosa** (otro dispositivo la cambió, la creó o la borró), **no se pisa**: se conserva lo de la base, la captura sale de la cola, Hoy lo avisa con el alumno, lo que quedó y lo que no se aplicó ("Asistencia de Ana: se cambió desde otro dispositivo o pantalla (quedó: Falta). Se conservó eso; tu captura (Justificada) no se aplicó.") y **la pantalla muestra lo de la base sin recargar**.
  - Igual para asistencia, cierre del día, retiro del cierre (no borra un cierre que otro cambió) y calificación (semáforo, entrega, puntaje y retroalimentación).
  - **En línea** (un solo dispositivo) nada cambia para la maestra: cada toque es una sola escritura, sin lecturas extra. Una pantalla que se quedó abierta con datos viejos también queda protegida: el primer toque sobre un dato que cambió en otro lado avisa y muestra lo nuevo; el siguiente toque ya escribe.
  - Capturas pendientes de la versión anterior (sin `base`, las que estaban en un dispositivo al publicar): se tratan como "no existía"; si ya hay fila distinta, es conflicto y se avisa (lo conservador).
  - Una retroalimentación de más de 1000 caracteres no va como filtro en la URL: se compara leyendo justo antes (queda una ventana de carrera mínima solo en ese caso).
- **Reintentos solo de red**: sin respuesta ("Sin señal") o 408, 429, 5xx ("No se pudo guardar por ahora; se reintentará"), con espera creciente (1 s a 30 s), y reenvío inmediato con `online`, al volver a primer plano y al abrir Hoy. Sesión vencida: se refresca y se reintenta; si ya no hay sesión, se espera sin borrar. **Cualquier otro error** (400, 403, 404, 409, un CHECK o un trigger) no se reintenta: sale de la cola y Hoy lo avisa con el alumno, el producto y la explicación en español (el texto técnico de la base solo va a la consola), y muestra lo que quedó en la base.
- **Aviso visible:** "N capturas pendientes de enviar" mientras haya algo; sin red, "Sin señal: N capturas pendientes de enviar, guardadas en este dispositivo."; con error del servidor, "No se pudo guardar por ahora; se reintentará. …"; al vaciarse, "Todo guardado" (no si algo no se guardó: lo dice el aviso de arriba).
- **La cola es de la cuenta que capturó.** Antes de enviar y antes de dar por terminada cada captura (guardada, en conflicto o rechazada) se confirma que la sesión del dispositivo es de esa cuenta. Si cambió de cuenta sin cerrar sesión, no se envía nada ni se borra nada ("En este dispositivo entró otra cuenta. N capturas pendientes de la cuenta anterior siguen guardadas aquí…"); se envían cuando ella vuelve a entrar y abre Hoy. En un equipo compartido, lo de otra maestra se queda en el dispositivo. Al recargar, lo pendiente se pinta encima de lo leído de la base y el envío empieza después de pintar.
- **Cerrar sesión con capturas pendientes** (menú de la cuenta y Sala de Maestros; `js/bandeja-salida.js` se carga en esas páginas): pide confirmar ("Tienes N capturas de Hoy sin enviar. Se quedan guardadas en este dispositivo y se enviarán cuando vuelvas a entrar en él y abras Hoy. ¿Cerrar sesión de todos modos?").
- **"Trabajar hoy" / "Quitar de hoy"** esperan a que se envíe lo capturado, pero ya no se cuelgan: sin señal, con la cola atorada por el servidor o sin sesión, el botón vuelve y Hoy dice qué pasa y que se intente con señal (lo capturado sigue en el dispositivo).
- En la app instalada se pide `navigator.storage.persist()`.

### 9.4 Cómo se verificó

- `pruebas/pwa.test.js` (manifest, íconos, service worker y su tiempo límite, las 22 páginas, `_redirects`, modo app, rutas bajo `/salon/`, candado y capa de lectura sin sesión, bandeja donde hay "Cerrar sesión", aviso de privacidad) y `pruebas/bandeja-salida.test.js` (sin red, "recargar" sobre el mismo almacén, reenviar sin duplicar, 403, 409 y CHECK sin reintento y en español, 500 como "servidor", lote del cierre con una fila mala; concurrencia optimista: sin cambios se escribe, cambiado en otro lado no se pisa y se avisa en los seis datos, "no existía y ahora existe", retiro de cierre con conflicto, fila borrada, relojes desfasados, captura en camino, respuesta perdida, captura sin base; cuenta dueña, cambio de cuenta a media escritura, sesión vencida). Con `node pruebas/bandeja-salida.test.js <otra versión>` se corre contra otra versión: la anterior a esta regla da 23 fallas. `pruebas/hoy-arranque.test.js` ahora pasa por la bandeja.
- Concurrencia en navegador (2026-09-25, `.qa/constructor-q-cola/`, contra pruebas, `/salon/` emulado; `anterior` sirve el código previo): `q11-dos-dispositivos.js` (anterior: A pisa asistencia y cierre de B; nuevo: se conserva lo de B, A avisa los tres y su pantalla muestra lo de la base), `q13-no-existia.js`, `q23-reloj.js` (anterior: el reloj adelantado bloquea la corrección; nuevo: se guarda), `q10-cola.js` (uso normal sin red: todo una vez y con el último valor), `q12-en-linea.js` (una escritura por toque), `q15-errores.js`, `q17`/`q18` (cuenta dueña), `q22` (cerrar sesión con pendientes), `q30-trabajar-hoy.js` (anterior: se queda en "Guardando lo capturado..."), `q60-sw-lento.js` ("Sin conexión" a los 9 s) y `q21-privacidad.js`.
- `.qa/constructor-p-pwa/e2e.js`, en Chromium con ventana (sin ventana no existe el aviso de instalar): manifest sin errores e instalable (`Page.getInstallabilityErrors`), service worker activo en `/salon/`, `beforeinstallprompt` y `prompt()`, instalación y arranque por CDP (`PWA.install`, `PWA.launch`: abre `/salon/hoy?origen=app` en ventana standalone), los 3 atajos, el menú completo sin salir de `/salon/`, Tienda en otra ventana, cerrar sesión y login dentro de la app, abrir la app sin sesión, "Sin conexión", la cola sin red → recargar → volver la red (todo llegó una sola vez, verificado con lecturas a la base) y un 403 forzado (se avisa y se intenta una sola vez).
- `.qa/constructor-p-pwa/ios.js` (UA de iPhone/iPad a 390, 1024 y 1280), `humo-salon.js` (las 22 páginas bajo `/salon/`), `.qa/humo.js` (la raíz, sin cambios) y `tienda-igual.js` (28 capturas de la tienda, antes y ahora, idénticas píxel por píxel).

### 9.5 Cómo probarlo en una tablet real (Samsung Galaxy Tab S9 FE+)

Después de publicar (el service worker exige HTTPS: no funciona con la IP local de la PC).

1. **Instalar.** En Samsung Internet o Chrome, iniciar sesión en jissez.com y entrar a Mi Salón → Inicio. Al final aparece "Instala Mi Salón como app": tocar "Instalar la app" y aceptar. (También: menú de la cuenta → "Instalar la app", o el ícono "+" / "Instalar app" del navegador estando en `jissez.com/salon/hoy`.) Debe aparecer el ícono "Jissez MS" (J blanca sobre azul) en la pantalla de inicio y en el cajón de apps.
2. **Abrir.** Tocar el ícono: abre directo en Hoy, en horizontal, sin barra del navegador. Si pide iniciar sesión, iniciar una vez: debe volver a Hoy.
3. **Atajos.** Mantener presionado el ícono: "Pasar lista" abre Hoy en Asistencia; "Calificar trabajos", en Sesiones de hoy; "Reportes", Reportes.
4. **Navegar.** Recorrer Inicio, Hoy, Asistencia, Actividades, Tareas, Reportes, Proyectos y el menú de la cuenta: todo dentro de la app, sin que aparezca la barra del navegador. En el menú no debe aparecer "Instalar la app".
5. **Tienda.** Tocar "Tienda" en la barra de secciones: se abre en el navegador, no dentro de la app.
6. **Cerrar sesión.** Menú → Cerrar sesión: queda en el login dentro de la app; al entrar, vuelve a Hoy.
7. **Sin señal.** Con Hoy abierto, activar el modo avión. Marcar la asistencia de 3 alumnos y calificar 2 productos: abajo debe decir "Sin señal: N capturas pendientes de enviar, guardadas en este dispositivo." Cerrar la app por completo (deslizarla desde recientes). Abrirla: sale "Sin conexión" diciendo cuántas capturas esperan. Quitar el modo avión: la página se reabre sola, Hoy muestra lo capturado y abajo dice "Todo guardado". Revisar desde otro equipo que cada captura está una sola vez.
8. **Enlace de WhatsApp.** Un enlace de producto de la tienda enviado por WhatsApp debe abrir el navegador, no la app.
9. Si algo falla: con la tablet conectada por USB (depuración USB activada), Chrome en la PC → `chrome://inspect` muestra la consola de la app.

En iPhone (si hay uno a mano): Safari → `jissez.com/salon/hoy` → Compartir → Agregar a pantalla de inicio (dejar "Abrir como app web"), abrir Jissez MS, iniciar sesión una vez, cerrar la app a la fuerza y reabrirla (la sesión sigue), probar el modo avión como en el paso 7, y la descarga del PDF de la boleta y "compartir por WhatsApp" dentro de la app.

### 9.6 Pendiente o fuera de alcance

- Fase 2 (abrir sin red con el shell en caché y versiones fijas de los CDN) y fase 3 (captura 100 % sin red) no se hicieron.
- Asistencia (la pantalla aparte) tiene su propio autoguardado: su cola no vive en el dispositivo.
- Las capturas de días anteriores que se envían tarde no revisan si la boleta del trimestre ya se cerró (§4.3, punto 6).
- `_redirects`: la regla `/salon/index.html /salon/ 301` ya existe.

### 9.7 Límites conocidos de la versión publicada y rediseño pendiente (2026-09-25)

Se publica la cola de 3d48d1a por decisión de Jorge ("versión anterior ya y rediseño después"). R12 la aprobó en todo salvo dos carreras del **mismo** aparato. Con esta versión nada se pierde sin aviso: en el peor caso sale un aviso falso de "se cambió desde otro dispositivo" y la maestra repite el toque.

- **Doble toque con la señal muy lenta** (token vencido, refresco lento y respuesta perdida): el segundo toque puede descartarse con un aviso falso (`.qa/revisor-r12/r91-carrera-navegador.js`).
- **Hoy abierto en dos ventanas del mismo aparato** (la app y una pestaña): si una envía lo que capturó la otra, la siguiente corrección en la primera se descarta con un aviso falso (`r93-otra-pestana-envia.js`, `r92-dos-pestanas.js`). Recomendación para la maestra: usar solo la app.
- Menores: el aviso de conflicto está arriba de Hoy (no se ve desde Cierre del día); dos toques sobre un dato que otro aparato cambió dan dos avisos; fuera de Hoy nada menciona ni envía lo pendiente (llega al abrir Hoy).

El intento eadbe09 (contar como "propio" todo valor que el aparato anotó, en IndexedDB) quitó esos avisos falsos pero abrió pérdidas sin aviso (R13, `.qa/revisor-r13/`): una ventana vieja pisaba campos de otra ventana, y un valor igual puesto por otro aparato se tomaba como propio (vuelve el caso de R11). Se revirtió (cd40494). Al comparar por contenido no se distingue "lo escribí yo" de "otro puso el mismo valor".

**Rediseño pendiente: marca por captura.**
- Migración aditiva: una columna `captura_id uuid` (nula) en `asistencias`, `calificaciones` y `registro_diario`, que cada escritura llena con un id único generado en el aparato.
- La versión de un dato pasa a ser esa marca, no su contenido: la escritura es condicional sobre la marca que vio la pantalla, y "es mío" significa que la marca está entre las que este aparato generó. Sin ambigüedad ni relojes.
- Escrituras solo de los campos tocados, para que una ventana vieja no pise otros campos.
- El relleno 1/1 del cierre solo inserta, nunca actualiza.
- BroadcastChannel entre ventanas para repintar.
- Aviso fijo abajo en Hoy, y aviso "N capturas sin enviar" fuera de Hoy, que se pueda cerrar y que no tape controles.
- La migración va a producción solo con la confirmación de Jorge en el momento.

### 9.8 Marca por captura (rediseño hecho, 2026-09-25; rama sin publicar)

> **Sustituido por §9.9 (marca por campo).** R14 encontró dos pérdidas sin aviso con una sola marca por fila; la base, la regla de conflicto y la cadena de marcas propias cambiaron. Lo de esta sección que sigue igual: una escritura por toque en línea, cuenta dueña, avisos (fijo en Hoy y fuera de Hoy), Web Locks y BroadcastChannel, "Trabajar hoy"/"Quitar de hoy", conversión de capturas de 3d48d1a y degradación sin columnas.

Construido y probado contra el proyecto de pruebas. **La migración `supabase/mi_salon_b12_captura_id_2026-09.sql` está aplicada solo en pruebas**; en producción, cuando Jorge lo decida. El frontend funciona antes y después de la migración (el orden de despliegue no importa).

**Base (aditiva).** Columna `captura_id uuid` nula, sin default, en `asistencias`, `calificaciones` y `registro_diario` (las filas existentes quedan en null; RLS igual; sin índice: la condición va siempre con la llave única). Trigger `captura_id_sin_marca_nueva` (BEFORE UPDATE en las tres): una escritura que no trae una marca nueva (Asistencia, Evaluación formativa, la versión anterior de la app, SQL a mano) deja la fila **sin marca**, así una marca nunca queda sobre contenido que cambió otro. Revisados: los triggers de calificaciones y evaluación formativa, `cerrar_boleta`, `delete_own_account` y la exportación (ninguno hace `select *` ni inserta por posición; no hay vistas).

**Reglas (js/bandeja-salida.js).**
- Cada escritura de Hoy pone un uuid nuevo generado en el aparato (`crypto.randomUUID`, con respaldo). La versión de una fila es su marca; sin marca (filas viejas o de otra pantalla) se compara por contenido.
- Escritura condicional atómica: `update ... where <llave> and captura_id = <la que vio la pantalla>` (sin marca: `is null` + el contenido de los campos que se escriben); si no había fila, insert que no pisa. **Solo se escriben los campos que la maestra tocó** (semáforo+entrega juntos, puntaje, retroalimentación; participación, conducta; asistencia).
- **"Es mío"** = la marca está entre las que este aparato generó para esa llave (IndexedDB, almacén `propias`, compartido por todas las ventanas, por cuenta; hasta 40 por llave y 3000 llaves, poda por cantidad, sin reloj). Otro aparato nunca comparte un uuid: no hay ABA. Cada marca confirmada guarda qué campos escribió y sobre qué marca; así se sigue la cadena de capturas propias.
- Si la escritura no aplicó, se lee la fila y se decide por campo: lo último que lo escribió fue una captura propia más vieja → se escribe encima sin aviso; una propia más nueva → esta captura ya no aplica, sin aviso; otro aparato o sin marca → si el campo sigue con lo que vio la pantalla se escribe, si otro aparato lo cambió es **conflicto: no se pisa y se avisa** (solo ese campo). **Decisión (lo más conservador que no pierde nada): si otro aparato cambió solo OTROS campos, se aplica el campo tocado sin pisar los demás y sin aviso**; el aviso de un conflicto parcial agrega "Lo demás que capturaste sí se guardó".
- El relleno 1 y 1 del Cierre del día solo inserta donde no hay fila (sin marca) y nunca actualiza ni avisa. Retirar el cierre (falta después del cierre) borra solo si el cierre sigue como lo vio la pantalla o lo dejó este aparato.
- Ventanas del mismo aparato: una sola envía a la vez (Web Locks, si el navegador lo tiene) y se avisan por BroadcastChannel lo confirmado (la otra ventana actualiza su versión vista y repinta), los avisos y los cambios de la cola. Sin esas API, la marca sigue decidiendo bien (solo puede aparecer un 409 en la consola).
- Si la base no tiene la columna, Hoy lo detecta en su primera lectura (un 400 en la consola por carga) y la bandeja también al escribir, y se usa la regla por contenido de la versión publicada.
- Las capturas guardadas por la versión publicada (formato de 3d48d1a, `base` por contenido) se convierten al enviarlas y se envían con la regla por contenido. La base de IndexedDB sube a la versión 2 (almacenes `propias` y `meta`); una pestaña con la versión anterior abierta suelta la base al enterarse y sigue en memoria (pide no cerrarse) hasta que se recargue.

**Avisos.** En Hoy, el aviso fijo abajo (role=alert, "Ver detalle" y "Cerrar"), visible desde el Cierre del día, un renglón por dato. Fuera de Hoy (las páginas que cargan la bandeja): "Tienes N capturas de Hoy sin enviar..." con "Ir a Hoy" y "Ocultar", **dentro del flujo de la página, arriba del contenido** (nunca encima de controles), y la página envía lo pendiente con red. Los errores 4xx se explican en español sin códigos técnicos.

**Verificación.** `pruebas/bandeja-salida.test.js` §9 (r91, r92, r93, t20, t21, t31, campos por separado, relleno, otra pantalla, una escritura por toque, formato anterior, sin la columna, retiro): con 421cd57 dan 13 fallas y con eadbe09 10; con el código nuevo pasan. En navegador contra pruebas (`.qa/constructor-s-marca/`): r91, r92, r93 (también sin BroadcastChannel ni Web Locks), t20 (también sin canal), t21 (con y sin cerrojo), t31, t10 (con, sin, retiro, borrado), t22 a-h, t30 relojes, t40 sin red y recargar, t50/t51 cuenta dueña, t60 errores, t80 aviso fijo, t94 migración con pestaña vieja (a y b), `s71` aviso fuera de Hoy en 15 páginas a 1280 y 390 (ningún control tapado), `s90` base sin la columna, `s30` Quitar/Trabajar hoy, `s95` poda, humo y páginas bajo `/salon/`.

**Límites que quedan.**
- Filas sin marca (otra pantalla o versión anterior): se compara por contenido; si otro cambió un campo y lo regresó al valor que vio la pantalla, la captura de Hoy se aplica (lo que se reemplaza es igual a lo que la maestra tenía a la vista). Lo mismo si otro aparato deja un campo con el mismo valor que vio la pantalla.
- Posible aviso falso (nunca pérdida) solo en combinaciones raras: respuesta perdida + ventana vieja + capturas propias en campos distintos, o marcas podadas.
- Con Web Locks, una petición muy lenta en una ventana retrasa lo de las otras hasta 30 s (después se da por "sin señal" y se reintenta; si llega tarde, la marca la vuelve inofensiva).
- Una pestaña que se quedó abierta con la versión anterior durante la actualización usa su propia regla (y sus avisos falsos) hasta recargarse.

### 9.9 Marca por campo (2026-09-25, tras R14; rama sin publicar)

R14 encontró dos pérdidas sin aviso con la marca por fila de §9.8: (1) si otro aparato u otra pantalla cambiaba un dato y lo regresaba al valor que había visto este aparato (A → B → A), la captura sin señal de este aparato se escribía encima sin avisar; (2) en el mismo aparato, con la respuesta de una escritura perdida y una ventana vieja, el último toque de la maestra se descartaba con un aviso falso. Con una sola marca por fila no se sabía qué campo había tocado cada escritura, y una fila sin marca solo se podía comparar por contenido.

**Base: `supabase/mi_salon_b12_captura_id_2026-09.sql`** (sustituye la de 80a4375; aplicada solo en pruebas; en producción, con la confirmación de Jorge y **antes** de publicar el frontend). Una marca uuid (nula, sin default) por grupo de campos que Hoy escribe junto:

| Tabla | Marca | Campos |
|---|---|---|
| `asistencias` | `captura_id` | `asistencia_estado` |
| `registro_diario` | `captura_participacion` | `participacion` |
| `registro_diario` | `captura_conducta` | `conducta` |
| `calificaciones` | `captura_semaforo` | `estado_entrega` y `nivel` (el semáforo implica la entrega) |
| `calificaciones` | `captura_puntaje` | `puntaje` |
| `calificaciones` | `captura_retroalimentacion` | `retroalimentacion` |

- **Trigger BEFORE INSERT OR UPDATE** en las tres tablas (`marca_captura_asistencias`, `marca_captura_registro_diario`, `marca_captura_calificaciones`; `search_path` vacío, sin SECURITY DEFINER, sin DML). En un update, cada grupo cuyo valor cambió (`is distinct from`) sin que cambiara su marca recibe `gen_random_uuid()`: una **marca del servidor**, que ningún aparato tiene como propia. En un insert, cada marca nula recibe una. Así toda escritura (Asistencia, Evaluación formativa, SQL, la versión publicada de la app) deja una marca única, y un cambio de ida y vuelta siempre se nota. Hoy manda su propia marca y se respeta.
- No toca filas existentes (quedan en null: "sin cambios desde antes de la marca"; en producción son pocas y solo asistencias) ni RLS. Los demás triggers de estas tablas no cambian los valores de los grupos (tipo, `updated_at`, evaluación formativa), así que el orden de disparo no importa, y no hay recursión.
- En pruebas se quitaron además las columnas `captura_id` de `calificaciones` y `registro_diario` de la versión anterior: `supabase/mi_salon_b12b_limpieza_pruebas_2026-09.sql` (**solo pruebas**; en producción nunca existieron). El archivo principal quita el trigger y la función de 80a4375 con `if exists` (en producción no hace nada).
- Si el frontend llega antes que la migración, Hoy funciona con la regla por contenido de 3d48d1a y deja un 400 en la consola por cada carga (lo detecta y lee sin marcas). Por eso el orden es: migración, luego frontend.

**Reglas (`js/bandeja-salida.js`, formato de captura 3).**
- Cada captura lleva un uuid nuevo del aparato y lo pone en los grupos que escribe.
- **Marca inicial** (`00000000-0000-4000-8000-000000000000`): un insert de Hoy la pone en los grupos que la maestra no tocó y que quedan con su valor por defecto (el relleno 1 y 1 en los dos grupos; el puntaje y la retroalimentación vacíos de una calificación nueva). Dice "este grupo nadie lo ha escrito": para una pantalla que no veía la fila equivale a no haber fila, así que otro aparato puede escribir ahí sin aviso falso. Cualquier escritura posterior la cambia (la de Hoy trae su marca; cualquier otra recibe una del servidor), así que una ida y vuelta sobre ese grupo se sigue notando. Un grupo no tocado con otro valor lleva la marca propia. *Decisión de diseño (la más conservadora que no produce avisos falsos entre aparatos): sin ella, el relleno 1 y 1 o el puntaje vacío de una calificación que creó otro aparato daban conflicto al tocarlos aquí (R13-t20 "dos aparatos" y t10 "sin filas" volvían a fallar).* La escritura es condicional y atómica por grupo: `update ... where <marca de cada grupo escrito> = <la que vio la pantalla>`; si no había fila, insert que no pisa. Solo se escriben los grupos tocados. En línea sigue siendo una escritura por toque, sin lecturas.
- **Cadena propia.** Al encolar (en la misma transacción de IndexedDB que la captura, antes de enviarla) se anota en `propias` la marca con su número de captura, los grupos que tocó y la marca sobre la que se capturó cada uno (su padre). Una respuesta perdida o una ventana cerrada no la rompen.
- Si la escritura no aplicó, se lee la fila y se decide **por grupo**: ya tiene exactamente lo capturado → listo sin aviso (también si dos aparatos pusieron lo mismo); la marca sigue siendo la vista, o la pantalla no veía la fila y el grupo tiene la marca inicial con su valor por defecto → se escribe; es de una captura propia más vieja (o de un insert propio que no tocó ese grupo) → se escribe; es una marca ajena que este aparato ya vio (es padre de una captura propia más vieja, de otra ventana) → se escribe; es de una captura propia más nueva → esta ya no aplica, sin aviso; **cualquier otra marca → conflicto con aviso, aunque el valor coincida con el que vio la pantalla** (así se detecta A → B → A). Las filas sin marca (null) se comparan como antes (transición).
- **Relleno 1 y 1 del Cierre del día:** sigue insertando solo donde no hay fila, con la marca inicial en los dos grupos (no es una captura de la maestra: nunca le gana a una), y pide la fila de vuelta (la pantalla conoce su versión). No se pone a quien este aparato marcó con falta aunque haya sido en otra ventana sin BroadcastChannel: si la última captura propia de su asistencia es una falta, antes de insertar se lee su asistencia en la base (una lectura, solo en ese caso) y, si la base confirma la falta, no se inserta; si ya se corrigió en otra pantalla, sí.
- **Ninguna lectura tardía pisa una versión más nueva (`js/hoy.js`).** Cada versión que llega por la bandeja (confirmación, conflicto, rechazo u otra ventana por el canal) se numera; cada lectura de la carga anota el número al salir y, al llegar, no toca las llaves que recibieron algo después: la pantalla se queda con esa versión y la muestra.
- Capturas pendientes de 3d48d1a (el publicado) se convierten y se envían por contenido, como antes; las de 80a4375 (solo en aparatos de prueba) conservan su marca en asistencias y en lo demás se comparan por contenido.

**Verificación.** `pruebas/bandeja-salida.test.js` §10 (el Supabase falso simula el trigger nuevo y, para las versiones anteriores, su propio esquema): FAIL 1 en sus tres variantes (A usa Hoy, A solo vuelve a tocar, A usa la pantalla Asistencia), FAIL 2 (respuesta perdida, ventana cerrada, lectura tardía), dos aparatos con el mismo valor, marca ajena ya vista por otra ventana, relleno y falta en otra ventana, relleno con respuesta perdida, marca inicial entre dos aparatos, ida y vuelta sobre la marca inicial, falta anotada ya corregida en la base. Con 80a4375 fallan 12 comprobaciones; con el código nuevo pasan todas. `pruebas/hoy-lectura-tardia.test.js` ejecuta `js/hoy.js` con la lectura del cierre detenida y una versión más nueva por el canal (con 80a4375, 2 fallas). En SQL (transacción revertida en pruebas, `.qa/constructor-t-campo/sql-trigger.js` y `sql-migracion-estados.js`): ida y vuelta desde otra pantalla deja otra marca, Hoy conserva la suya, inserts sin marca reciben marcas, marcas por grupo independientes, los triggers existentes siguen, y el archivo corre igual sobre una base limpia y sobre la de 80a4375. En navegador contra pruebas (`.qa/constructor-t-campo/`, antes con 80a4375 y después con el código nuevo): x01, x01 retoque, x01 pantalla, x02 (pérdida, ventana cerrada, congelada, con y sin canal, control) y x05; y la regresión de §9.8.

**Límites que quedan.**
- Una fila sin marca (anterior a la migración) se compara por contenido: un A → B → A hecho por la versión publicada de la app **antes** de aplicar la migración no se distingue. Desde la migración, toda escritura deja marca.
- Una marca propia podada (más de 40 por llave) o una llave olvidada (más de 3000) se toma como ajena: a lo más un aviso falso, nunca pérdida.
- El relleno no se pone a quien este aparato marcó con falta (confirmado en la base); si la falta se marcó en OTRO aparato y este no lo sabe, el relleno sí se inserta (como antes); Asistencia o Hoy lo retiran cuando se vuelve a marcar.
- La marca inicial vale para "nadie escribió este grupo desde que se creó la fila": si otro aparato borró la fila y la volvió a crear con los valores por defecto, para una pantalla que no veía la fila es lo mismo (no hay intención de la maestra que perder).
- Una versión que llega por el canal durante la carga se toma como más nueva que la lectura que salió antes; si en realidad la lectura ya traía algo más nuevo de otro aparato, el siguiente toque sobre ese dato avisa (no se pierde nada).
