# Handoff: Jissez — Tienda de Planeaciones NEM

> Paquete de entrega para implementar el sitio en un codebase real con Claude Code.
> Léelo completo antes de empezar. Es autosuficiente: describe el diseño, el comportamiento
> y todo lo que el backend necesita.

---

## 1. Qué es esto

**Jissez** es una tienda en línea donde docentes de primaria en México compran **planeaciones
didácticas alineadas a la NEM** (Nueva Escuela Mexicana). El docente:

1. Explora el catálogo por grado / multigrado.
2. Elige cobertura (Trimestre 1, 2, 3 o Ciclo completo) y formato (Solo PDF, o PDF + Word editable).
3. Paga (tarjeta, Mercado Pago, SPEI u OXXO).
4. Accede a su **biblioteca personal** y descarga archivos sin caducidad.

Hay además un **panel de administración privado** para la dueña del negocio (gestión de pedidos,
verificación de pagos SPEI/OXXO, acceso manual / regalos, edición de precios, contabilidad básica).

---

## 2. Sobre los archivos de diseño  ⚠️ LEER

Los archivos `.html` de este bundle son **referencias de diseño**, NO código de producción para
copiar tal cual. Son prototipos hechos en HTML + Tailwind (vía CDN) + Lucide icons que muestran
el **aspecto y comportamiento deseados**.

**La tarea es recrear estos diseños dentro del entorno del proyecto destino** (Next.js / React,
Astro, Laravel + Blade, lo que se decida) usando sus patrones, su router, su sistema de auth y su
ORM. Si todavía no existe un codebase, elige el stack más adecuado (recomendación abajo) e
impleméntalo ahí. **No** subas el HTML directo a producción ni dejes Tailwind por CDN.

### Fidelidad: **Alta (hi-fi)**
Colores, tipografía, espaciados, estados hover e interacciones son **definitivos**. Recréalos
pixel-perfect. Lo único que es de ejemplo son los **datos** (nombres, pedidos, precios pueden
moverse) y el contenido de las páginas PDF (placeholders rayados que dicen lo que va ahí).

### Stack recomendado (si parten de cero)
- **Next.js (App Router) + TypeScript + Tailwind CSS** — el diseño ya está en Tailwind, la
  migración es casi 1:1.
- **Base de datos**: Postgres (Supabase encaja bien: te da auth + storage + DB).
- **Auth**: email/contraseña + magic link. La dueña entra con su cuenta y, por su rol, se
  habilita el panel admin (ver §7).
- **Pagos**: **Mercado Pago Checkout Pro / API** — acepta tarjeta, SPEI y OXXO en un solo flujo.
- **Almacenamiento de archivos**: bucket privado (Supabase Storage / S3) con **URLs firmadas**
  de descarga (nunca exponer el archivo directo).

---

## 3. Design tokens

Todos los archivos declaran estos valores en el bloque `tailwind.config`. Conviértelos en tu
`tailwind.config.js` (o variables CSS) del proyecto.

### Colores
| Token | Hex | Uso |
|---|---|---|
| `board` | `#1e3a8a` | Azul pizarrón — color primario de marca, navbar, botones secundarios |
| `board.deep` | `#16276b` | Hover de board |
| `board.soft` | `#26499f` | Variante intermedia (gráficas) |
| `ink` | `#1c2434` | Texto principal |
| `mute` | `#5b6473` | Texto secundario |
| `line` | `#e7e6df` | Bordes y divisores |
| `action` | `#059669` | Verde — CTAs de compra |
| `action.dark` | `#047a55` | Hover de action |
| `paper` | `#faf9f4` | Fondo cálido de página |
| `warn` | `#b45309` | Estados de “pendiente / atención” (solo admin) |

**Colores de gis** (acentos tipo crayón, se usan para identificar grados y categorías):
| Token | Hex | Grado asociado |
|---|---|---|
| `gisAmarillo` | `#f2cf6b` | 1° |
| `gisCielo` | `#85b8e6` | 2° |
| `gisMenta` | `#79c8a6` | 3° |
| `gisLavanda` | `#a99fe0` | 4° |
| `gisCoral` | `#ef9277` | 5° |
| `gisDurazno` | `#f0b285` | 6° |

> Nota: en el catálogo los colores de grado se mapean ligeramente distinto (ver `Catálogo`),
> pero la paleta es la misma. Unifica en un solo mapa grado→color al implementar.

### Tipografía
- **Familia única**: `Inter` (Google Fonts), pesos 400/500/600/700/800/900.
- Títulos: 800–900 (font-black), `tracking-tight`.
- Cuerpo: 400–500. Texto secundario en `mute`.
- Tamaños frecuentes: H1 `clamp(1.7rem, 3vw, 2.3rem)`, cuerpo 15–17px, microcopy 11–13px.

### Radios, sombras, fondos
- Radios: tarjetas grandes `rounded-3xl` (24px), tarjetas/inputs `rounded-2xl` (16px),
  chips/botones chicos `rounded-xl` (12px), píldoras `rounded-full`.
- Sombra de “lift” en hover: `0 14px 34px -22px rgba(28,36,52,.4)` + `translateY(-2px)`.
- **Textura de pizarrón** (clase `.board-tex`) para navbar y sidebar admin:
  ```css
  background-color:#1e3a8a;
  background-image:
    radial-gradient(circle at 18% 8%, rgba(255,255,255,.08), transparent 40%),
    radial-gradient(rgba(255,255,255,.045) .6px, transparent .6px);
  background-size:auto, 4px 4px;
  ```
- **Placeholder de imagen** (clase `.ph`): cajas rayadas en diagonal con texto monoespaciado
  que indica qué imagen/contenido va ahí. Reemplázalas por imágenes reales / vistas previas de PDF.

### Iconos
**Lucide** (`lucide@latest`). En React usa `lucide-react`. Los nombres en el HTML
(`data-lucide="..."`) corresponden 1:1 a los de la librería.

---

## 4. Pantallas (vistas públicas + área de cuenta)

| Archivo | Ruta sugerida | Qué es |
|---|---|---|
| `Landing - Planeaciones NEM.html` | `/` | Página de inicio / marketing |
| `Catálogo - Planeaciones NEM.html` | `/catalogo` | Grid de productos con filtros |
| `Producto - Planeaciones NEM.html` | `/producto/[slug]` | Detalle: selector de cobertura + formato, precio dinámico, vista previa de páginas |
| `Checkout - Planeaciones NEM.html` | `/checkout` | Pago en pasos (cuenta → pago → confirmación) |
| `Mis compras - Planeaciones NEM.html` | `/mis-compras` | Pedidos del usuario (activas / pendientes) |
| `Biblioteca - Planeaciones NEM.html` | `/biblioteca` | Archivos descargables agrupados por tipo |
| `Admin - Planeaciones NEM.html` | `/admin` | Panel privado (ver §7) |

### 4.1 Landing
Navbar pizarrón sticky + CTA verde. Secciones: hero, “cómo funciona”, multigrado, beneficios
(tarjetas con flip en hover), catálogo destacado, testimonios, FAQ (acordeones `<details>`),
footer. Animaciones de entrada al hacer scroll (clase `.reveal`).

### 4.2 Catálogo
- Grid responsivo de tarjetas (`PRODUCTS` en el `<script>`): 6 grados “Organización completa”
  + variantes **Bidocente** y **Tridocente** (multigrado).
- Filtros por tipo de organización. Cada tarjeta muestra chips de grado con su color, precio
  “desde $X por trimestre” y CTA “Ver paquete” → página de producto.

### 4.3 Producto (la más interactiva)
- **Izquierda**: visor de páginas de muestra (portada, sesión, PDA, anexo, examen) con miniaturas.
- **Derecha**: selector de **Cobertura** (T1/T2/T3/Ciclo) y **Formato** (PDF / PDF+Word), precio
  que se actualiza con animación “bump”, barra sticky de compra.
- **Estado** se guarda en `localStorage` (`jissez_pkg`, `jissez_fmt`) y lo lee el checkout.
- Matriz de precios (ejemplo): trimestre `{pdf:149, word:199}`, ciclo `{pdf:349, word:449}`.

### 4.4 Checkout
Flujo en 2 pasos visibles (cuenta/login → pago) + overlay de confirmación. Tabs login/registro,
medidor de fuerza de contraseña, selección de método de pago. Resumen de orden lee el
`localStorage` del producto. **Aquí va la integración real de Mercado Pago.**

### 4.5 Mis compras
Tabs **Activas** / **Pendientes**. Cada compra: chip de grado, formato, fecha, nº de archivos,
botón “Abrir biblioteca”. Las pendientes (SPEI/OXXO) muestran código de pago y caducidad.

### 4.6 Biblioteca
Archivos agrupados en secciones colapsables (`<details>`): Planeaciones/Proyectos, **PDAs**,
Anexos, Exámenes. Filtros por trimestre. Botón de descarga por archivo (→ URL firmada).

---

## 5. Terminología importante (no cambiar)

- **PDA** = **Procesos de Desarrollo de Aprendizaje**. Cuando aparezca la sigla, déjala como
  `PDA` / `PDAs`. Cuando se escriba completo, **debe decir exactamente “Procesos de Desarrollo
  de Aprendizaje”** — los docentes notan cualquier variante incorrecta. No usar “Programa
  Didáctico de Aprendizaje” ni similares.
- **NEM** = Nueva Escuela Mexicana.
- **Multigrado**: Bidocente (2 docentes / 3 grados) y Tridocente (3 docentes / 2 grados).
- Cobertura: **Trimestre 1 / 2 / 3** o **Ciclo completo**.

---

## 6. Modelo de datos (mínimo sugerido)

```
User        { id, email, password_hash, name, role: 'teacher' | 'admin', created_at }
Product     { id, slug, grade, type: 'regular'|'bidocente'|'tridocente',
              price_pdf, price_word, active }
            // “cobertura” (T1/T2/T3/ciclo) puede ser variante del producto o columna del item
Order       { id, user_id, status: 'paid'|'pending'|'gift', method: 'card'|'mercadopago'|'spei'|'oxxo'|'gift',
              amount, created_at, mp_payment_id }
OrderItem   { id, order_id, product_id, coverage, format: 'pdf'|'word', amount }
Access      { id, user_id, product_id, coverage, format, source: 'purchase'|'spei'|'gift'|'courtesy',
              granted_at }   // lo que habilita la biblioteca
File        { id, product_id, coverage, type: 'plan'|'pda'|'anexo'|'examen',
              format, storage_path, pages }
```

La **Biblioteca** se arma cruzando `Access` del usuario con `File`. La descarga genera una URL
firmada temporal del bucket privado.

---

## 7. Panel Admin — comportamiento y reglas

**Acceso:** ruta `/admin` **protegida por rol**. La dueña entra con su cuenta normal; si
`user.role === 'admin'`, se le habilita el panel (en el nav del sitio puede aparecer un acceso
solo para ella). Cualquier otro usuario → 404/redirect. No es un login separado.

Cinco vistas (una sola SPA con sidebar):

1. **Resumen** — KPIs del mes (ingresos, nº de ventas, pagos por verificar, producto top),
   gráfica de ingresos por mes, **desglose por método de pago** (para contabilidad) y ventas
   recientes. Banner que avisa de pagos SPEI/OXXO sin verificar.
2. **Pedidos** — tabla con filtros (Todos / Pagado / Pendiente / Regalo) + búsqueda + **Exportar
   CSV** (para llevar la contabilidad de la web). Los pedidos `pendiente` (SPEI/OXXO sin acreditar)
   tienen botón **“Confirmar”** que libera el acceso manualmente.
3. **Acceso manual** — formulario: correo del docente → grado, cobertura, formato, **motivo**
   (SPEI verificado / Regalo / Cortesía). Crea el `Access` (y la cuenta si no existe) y opcionalmente
   manda correo. Cubre dos casos reales: (a) confirmar transferencias SPEI a mano, (b) **regalar
   planeaciones a conocidos** sin pasar por el carrito.
4. **Productos y precios** — tabla con **precios editables inline** (PDF y PDF+Word) y toggle
   de disponibilidad. **Aquí se cambian los precios de toda la tienda** (deben persistir en DB y
   reflejarse en catálogo/producto/checkout).
5. **Clientes** — fichas de docentes con nº de compras y total gastado; acción rápida “Dar acceso”.

> **Automatización futura (recomendada):** Mercado Pago puede notificar por **webhook** cuando un
> pago SPEI/OXXO se acredita. Conéctalo para que el `Access` se libere solo y la verificación
> manual quede únicamente como respaldo. El acceso manual / regalos sí se queda permanente.

---

## 8. Interacciones y animaciones (resumen)

- Transiciones generales: `.12s–.28s`, easing `cubic-bezier(.2,.8,.2,1)` o `ease`.
- **Lift** en tarjetas: `translateY(-2px)` + sombra al hover.
- **Precio “bump”** en producto al cambiar selección: `scale(1)→1.06→1` en `.22s`.
- Acordeones nativos `<details>` con ícono `+` que rota 45° al abrir.
- Toggles de tabs/segmentos: el activo toma fondo `board` y texto blanco.
- Admin: drawer lateral para “Dar acceso rápido”, toasts de confirmación, gráfica de barras CSS.
- Respeta `prefers-reduced-motion` al recrear.

---

## 9. Assets

Carpeta `assets/` incluida en este bundle:
- `jissez-wordmark-white.png` / `jissez-wordmark-blue.png` — logotipo (texto).
- `jissez-icon-white.png` / `jissez-icon-blue.png` — isotipo.

Usa el wordmark **blanco** sobre fondos pizarrón y el **azul** sobre fondos claros (footer).
Las cajas `.ph` rayadas son placeholders: reemplázalas por imágenes reales o vistas previas
generadas de los PDF.

---

## 10. Archivos en este bundle

```
design_handoff_jissez/
├── README.md                          ← este archivo
├── assets/                            ← logos
├── Landing - Planeaciones NEM.html
├── Catálogo - Planeaciones NEM.html
├── Producto - Planeaciones NEM.html
├── Checkout - Planeaciones NEM.html
├── Mis compras - Planeaciones NEM.html
├── Biblioteca - Planeaciones NEM.html
└── Admin - Planeaciones NEM.html
```

Ábrelos en el navegador para ver el diseño objetivo y revisa el `<script>` de cada uno para la
lógica de estado (selectores, precios, filtros). Recréalos en el stack elegido siguiendo las
secciones anteriores.
