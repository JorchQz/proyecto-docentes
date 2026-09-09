# Reporte: venta individual, filtro por contenido, personalizados y legal

**Fecha de cierre:** 2026-09-09 · **Commits en `main` (sin push):** `9284ce8` (Bloques 0 y 1), `f0baf5e` (Bloque 2), `2e88d0d` (Bloque 3), `c22d70a` (Bloque 4) y el de documentación.
**Fuente:** `docs/referencia/instrucciones_venta-normalistas-completo.md` · **Plan:** `~/.claude/plans/revisa-el-archivo-instrucciones-venta-no-streamed-sunset.md`

Formato de la Sección 10 del documento: qué se construyó (hecho / parcial / pendiente), desviaciones, bloqueos y pruebas. Todo lo de base de datos y Edge Functions **ya está en producción**; el sitio (`tienda/`) está en `main` local y **no se ha empujado**: mientras tanto la tienda pública se comporta igual que antes porque ningún proyecto suelto está publicado.

---

## 1. Qué se construyó, por sección del documento

| Sección | Punto | Estado | Dónde |
|---|---|---|---|
| — | Admin en la cuenta de Jissez (`soporte.jissez@gmail.com`); la personal queda como cuenta normal | Hecho | `supabase/admin_cuenta_jissez.sql`, `tienda/js/tienda-common.js` |
| 4.2 | `tipo_paquete='proyecto'`, `precio_pdf_con_anexos`, `numero_proyecto`; Word siempre incluido; examen nunca | Hecho | `supabase/marketplace_proyectos_individuales.sql` |
| 4.2 | Admin publica sueltos | Hecho (mejor que lo pedido: detección automática de las carpetas P01-P12 y emparejamiento con el proyecto del bot) | `tienda/admin.html` pestaña "Proyectos sueltos", Edge `admin-proyectos-drive` |
| 5 | `anexo` reconoce el suelto y exige la versión con anexos | Hecho | `supabase/functions/anexo` |
| 5 | Funciones de archivos entregan Word siempre y subcarpetas solo con anexos | Hecho | `_shared/entrega.ts`, `puedeEntregarRuta` en `_shared/google-drive.ts`; `archivos-proyecto`, `ver-archivo`, `descargar-archivo`, `contenido-paquete`, `previsualizar` |
| 5 | `crear-preferencia-mp` acepta el suelto (sin/con anexos) | Hecho | `supabase/functions/crear-preferencia-mp` |
| 6 | Filtro por campo formativo, contenido y PDA; toggle paquete / proyecto individual | Hecho | `tienda/catalogo.html`, `tienda/js/catalogo.js`, RPC `marketplace_proyectos_publicos` |
| 6 | Landing para normalistas | Hecho | `tienda/practicantes.html` |
| 7.1-7.3 | Precios $120/$160 configurables, checkout integrado, formulario del pedido | Hecho | `marketplace_personalizados_config`, `tienda/personalizado.html`, `checkout.html?personalizado=1` |
| 7.4 | Estados `pendiente_pago → pendiente → en_proceso → completado / cancelado`, flag `vencido`, ventana configurable | Hecho | `marketplace_pedidos`, `admin_listar_pedidos` |
| 7.5 | Panel interno V1: marcar completado con la carpeta de Drive; confirmación antes de avisar | Hecho | Admin pestaña "A la medida", Edge `completar-pedido` |
| 7.6 | Subcarpeta por pedido `PZ-0001_Nombre` en "Proyectos Personalizados" | Hecho como convención manual (V1) | `bot/instrucciones_planeacion.md`, sugerida en el correo y en el admin |
| 7.7 | Correos Resend: al pagar (cliente), pedido nuevo (negocio), completado (cliente) | Hecho | `_shared/pagos.ts::activarPedidosDeOrden`, `completar-pedido` |
| 7.8 | Publicar el personalizado en el catálogo al completar | Hecho (casilla marcada por defecto) | `completar-pedido` |
| 8 | Términos y Aviso de Privacidad, enlaces en los footers, casilla en checkout, aviso visible en el formulario | Hecho, con huecos para tus datos | `tienda/terminos.html`, `tienda/privacidad.html`, `checkout.html`, `personalizado.html` |
| 9.a | Filtro vacío → pedido a la medida prellenado | Hecho | `catalogo.js` → `personalizado.html?org=&grado=&cf=&contenido_id=&pda_id=` |
| 9.b | Registro de búsquedas sin resultado + lista en admin | Hecho | `marketplace_busquedas_vacias`, `admin_busquedas_vacias` |
| 9.c | Aviso a Jorge de vencidos | Hecho | Edge `avisos-pedidos` + `pg_cron` diario (8:00 hora del centro) |
| 9.e | Tope de pedidos simultáneos aplicado de verdad | Hecho | `marketplace_personalizados_estado` (formulario, checkout y servidor) |
| 9.g | Chequeo de acceso de `anexo` | Hecho | ver 5 |
| 9.h | URL propia por proyecto | Hecho | `tienda/proyecto.html?id=` |
| 9.i, 9.j | Referidos; evitar duplicados al nutrir el catálogo | No construido (el documento los marca como futuro) | — |

---

## 2. Cómo quedó cada bloque

### Bloque 0 — administración
`es_admin()` compara contra `soporte.jissez@gmail.com`; es la única fuente del rol para todas las políticas y RPC. `ADMIN_EMAIL` en el navegador solo decide qué enlaces mostrar. Los avisos al negocio van al secreto nuevo `MAIL_ADMIN` (= ese buzón) y todo sale desde `soporte@jissez.com` (`MAIL_FROM`, ya verificado en Resend).

### Bloque 1 — vender y entregar un proyecto suelto
- Un suelto es una fila de `marketplace_productos` con `tipo_paquete='proyecto'`, la carpeta P0N del proyecto en Drive, `numero_proyecto` (1-12, el mismo `pr` de los links de anexo), `dosificacion_proyecto_id`, `precio_pdf` (sin anexos) y `precio_pdf_con_anexos`.
- Compra: `tipo='pdf'` = sin anexos, `tipo='anexos'` = con anexos. Accesos: `pdf`+`editable` (Word siempre) o `pdf`+`editable`+`anexos`. La fila `anexos` es el interruptor real de las subcarpetas; la fila `editable`, de los .docx. Regla única en `pagos.ts::tiposDeAcceso` y su espejo SQL `_accesos_por_tipo` (la vía manual del admin quedó alineada).
- `crear-preferencia-mp` exige PDF y Word en Drive antes de vender un suelto (y una subcarpeta si es con anexos), sella `terminos_aceptados_en`, y rechaza versiones que no existen.
- Admin "Proyectos sueltos": eliges un trimestre, la función lee las carpetas P01-P12, las empareja con el proyecto del bot, muestra si tienen PDF/Word/anexos y crea los productos ocultos a $80/$120; abajo editas precios y publicas. Los 4 sueltos de 1° T1 ya están creados (ocultos).

### Bloque 2 — catálogo, ficha y legal
- RPC pública `marketplace_proyectos_publicos(p_id)`: única vía por la que un anónimo lee `dosificacion_pdas`, limitada a sueltos publicados (decisión tuya).
- Catálogo: selector "Qué buscas" (paquetes / proyectos individuales), chips de campo con color NEM, contenido con lista acotada a lo que cubre algún proyecto, PDA al fijar contenido, tarjeta por proyecto, deep link `?vista=proyectos&g=&cf=&contenido=&pda=`, sin resultados → CTA a la medida.
- Ficha `proyecto.html`: datos, temario por campo (contenidos y PDAs), vista previa PDF del proyecto, sin/con anexos con promo, puente al paquete del trimestre, FAQ.
- Legal: textos íntegros de 8.1 y 8.2; cláusula 5 del aviso ajustada a lo que el sitio usa de verdad (sesión en el navegador y Meta Pixel). Huecos resaltados en amarillo: nombre/razón social, RFC, domicilio, ciudad, fecha.

### Bloque 3 — proyectos a la medida
- Formulario `personalizado.html`: organización y grado o combo (obligatorio), versión sin/con anexos (obligatorio), campo, contenido (del catálogo SEP de la fase), PDA, metodología, fecha, notas (opcionales). Prefill desde la URL. Muestra cupo y ventana. Aviso visible de que puede integrarse al catálogo.
- Checkout `?personalizado=1`: resumen "Lo que pediste", precio de la config con promo/cupón, casilla legal. `crear-preferencia-mp` valida, comprueba cupo y apertura, crea `marketplace_pedidos` (PZ-0001…) + orden + ítem con `pedido_id`, reutiliza el intento pendiente.
- Al acreditarse el pago (`procesarPago`): pedido a `pendiente`, `fecha_compromiso_entrega = pago + ventana`, correo al cliente (ventana y garantía) y al negocio (detalle y carpeta sugerida). Reembolso → pedido `cancelado`.
- Admin "A la medida": config (recibir pedidos, cupo semanal, ventana, precios, mensaje), tabla de pedidos con badge Vencido, acciones En elaboración / Cancelar / Entregar, y búsquedas sin resultado. "Entregar" pide el ID de carpeta, opcionalmente el proyecto del bot, título y precios, y confirma antes de avisar.
- `completar-pedido`: verifica en Drive PDF + Word (+ subcarpetas si con anexos), crea el producto `proyecto` (publicado si lo marcas), otorga el acceso (`pdf`+`editable`(+`anexos`)), marca completado y avisa al cliente. El cliente lo ve en Mis compras como cualquier compra; los links de anexo del personalizado usan `anexo.html?pedido=PZ-0001&a=…`.

### Bloque 4 — mejoras
- `marketplace_busquedas_vacias` + lista en admin.
- `avisos-pedidos` + job `avisos-pedidos-diario` (14:00 UTC): correo solo si hay vencidos o por vencer en 24 h. Secreto en Vault (`cron_secret`) y en los secretos de Edge (`CRON_SECRET`).
- `practicantes.html`: landing para normalistas con enlaces al catálogo de proyectos y al pedido a la medida; enlaces nuevos en el footer del landing.

---

## 3. Desviaciones respecto al documento

1. "Con anexos" se modela como `tipo='anexos'` en la orden y como fila `anexos` en accesos (esa fila existía y nadie la leía), no como toggle nuevo.
2. Los precios de los sueltos viven en la fila del producto, no en `marketplace_precios`: `marketplace_aplicar_precios` hace JOIN por `tipo_paquete` y no los toca. Se editan en la pestaña de sueltos.
3. `dosificacion_pdas.proyecto_id` no existe: es `proyecto_dos_id`. Y la tabla solo se lee con sesión, por eso el filtro público va por RPC.
4. `EXIGIR_TERMINOS=false` en `crear-preferencia-mp` hasta que el checkout con la casilla esté servido; la fecha se sella igual cuando llega.
5. La vía manual (`admin_confirmar_orden`, `admin_otorgar_acceso`) tenía su propia regla y no otorgaba la fila `anexos`; quedó alineada con `pagos.ts`.
6. Entrega de personalizados V1 (decisión tuya): carpeta manual en Drive y el ID pegado en el admin; no hay escritura en Drive.
7. Los links de anexo de personalizados llevan el número de pedido (`?pedido=PZ-0001`), porque el producto no existe cuando el bot genera el documento.
8. Cambio de cuenta admin (pedido tuyo, no estaba en el documento).
9. **Corrección de seguridad no prevista:** los `*_drive_id` de productos eran legibles por cualquier anónimo (el REVOKE por columna de agosto no surtía efecto por el permiso de tabla). Ahora los permisos son por columna explícita en productos y pedidos.

---

## 4. Qué se probó y cómo

Todo lo de servidor se probó en producción con un usuario de pruebas (`pruebas.bloque1@jissez.com`, clave en `docs/TESTING.md` §20) y un producto `es_prueba` que apunta a la carpeta real P01 de 1° T1; lo de navegador con Chromium headless (Playwright) contra un servidor local de la carpeta del repo, hablando con la base y las funciones reales.

| Bloque | Qué | Resultado |
|---|---|---|
| 1 | Suelto sin anexos: biblioteca lista solo PDF y Word, visor bloquea subcarpetas, link de anexo → 403 `sin_anexos`, .docx de raíz se entrega sin comprar Word aparte | Correcto |
| 1 | Suelto con anexos: link de anexo → PDF, ZIP con subcarpetas, proyecto no comprado → 403 `sin_acceso` | Correcto |
| 1 | `crear-preferencia-mp`: `editable` en suelto → 400; sin anexos → orden $10; con anexos → orden $15 con ítem `anexos`; `terminos_aceptados_en` lleno; segundo clic reutiliza la orden | Correcto |
| 1 | `_accesos_por_tipo` en los cuatro casos; `admin-proyectos-drive` con no admin → 403; sintaxis de todos los JS | Correcto |
| 2 | 41 comprobaciones en navegador: vista de proyectos, chips de campo, contenido, PDA, limpiar, sin resultados con CTA prellenado, vista de paquetes intacta ("desde $249"), ficha (título, versiones, temario, vista previa, puente al paquete, footer), checkout (resumen, casilla obligatoria, desglose, `editable` rechazado), páginas legales, landing sin "desde $80", móvil sin desborde | Todas pasan, sin errores JS |
| 3 | Formulario con prefill, contenidos de la fase filtrados por campo, PDAs del contenido, multigrado sin combo bloqueado, total con promo; checkout con "Lo que pediste"; `crear-preferencia-mp` creó PZ-0001 + orden $128 (promo) + ítem `anexos`, y en el segundo intento reutilizó y actualizó el pedido | Correcto |
| 3 | Servidor: cupo 0 → 409 `agotado` con fecha de reapertura; combo inválido → 400; `editable` → 400. Formulario y checkout con cupo 0 bloquean | Correcto |
| 3 | Mis compras: sección de pedidos con estado, número y fecha comprometida; `anexo.html?pedido=` de pedido sin entregar → mensaje claro; `completar-pedido` y `admin_actualizar_pedido` con no admin → rechazo | Correcto |
| 3 | RPC de admin ejecutadas con la identidad del admin dentro de una transacción: listar, estado, guardar config, cambiar estado, búsquedas, detalle de orden "Proyecto a la medida PZ-0001 — con anexos" | Correcto |
| 3 | Seguridad: anónimo leyendo `proyecto_folder_drive_id` → "permission denied"; columnas públicas y RPC del catálogo siguen funcionando | Correcto |
| 4 | `avisos-pedidos`: sin secreto → 403; sin vencidos → sin correo; con PZ-0001 vencido → correo enviado; el job disparado vía `pg_net` + Vault registró 200 | Correcto (dos correos de prueba llegaron a `soporte.jissez@gmail.com`) |
| 4 | `practicantes.html` en escritorio y móvil: sin errores ni desborde, enlaces y footer | Correcto |

**No probado en vivo** (requiere la sesión del admin en navegador, que no tengo): el botón "Detectar proyectos en Drive" y "Entregar" un pedido de punta a punta (creación del producto, acceso y correo de entrega). El código de ambos comparte los mismos helpers que sí se probaron (lectura de Drive, accesos, envío de correo); las RPC y los rechazos de autorización sí se probaron. El pedido de prueba PZ-0001 quedó en cola para que lo entregues tú con una carpeta de prueba y veas el flujo completo; consume 1 de los 5 lugares del cupo hasta que lo entregues o canceles.

---

## 5. Pendiente de tu decisión o de tu mano

1. **Push a `main`** (despliega jissez.com). Al hacerlo, avisa: pongo `EXIGIR_TERMINOS=true` y redespliego `crear-preferencia-mp`, y aviso a la sesión de cupones para que aplique `marketplace_escalon_retiro.sql`.
2. **Datos legales**: llenar los huecos amarillos de `terminos.html` y `privacidad.html` (nombre o razón social, RFC, domicilio, ciudad, fecha) y, si quieres, revisión de abogado. No conviene empujar sin llenarlos.
3. **Publicar sueltos**: los 4 de 1° T1 están creados ocultos; en admin → Proyectos sueltos los publicas y detectas los demás trimestres.
4. **Probar como admin**: entrar con `soporte.jissez@gmail.com`, Detectar y Entregar PZ-0001 con una carpeta de prueba.
5. Fila huérfana en `dosificacion_proyectos` (combo 1-2, número 1, sin trimestre): no afecta, pero convendría borrarla.
6. Usuario y producto de prueba: se quedan para pruebas; dime si prefieres que los borre.
7. Ideas a futuro del documento (referidos, evitar duplicados al nutrir el catálogo): no construidas.

---

## 6. Archivos nuevos y modificados (resumen)

- **SQL (aplicados en producción):** `admin_cuenta_jissez.sql`, `marketplace_proyectos_individuales.sql`, `marketplace_catalogo_proyectos.sql`, `marketplace_personalizados.sql`, `marketplace_avisos_cron.sql`.
- **Edge Functions (desplegadas):** nuevas `admin-proyectos-drive`, `completar-pedido`, `avisos-pedidos`; modificadas `anexo`, `archivos-proyecto`, `ver-archivo`, `descargar-archivo`, `contenido-paquete`, `previsualizar`, `crear-preferencia-mp`, `webhook-mercadopago`, `confirmar-pago`; helpers `_shared/google-drive.ts`, `_shared/pagos.ts`, nuevo `_shared/entrega.ts`.
- **Secretos nuevos:** `MAIL_ADMIN`, `CRON_SECRET`; Vault `cron_secret`.
- **Tienda:** nuevas `proyecto.html` + `js/proyecto.js`, `personalizado.html` + `js/personalizado.js`, `terminos.html`, `privacidad.html`, `practicantes.html`; modificadas `catalogo.html/js`, `checkout.html/js`, `mis-compras.html/js`, `admin.html/js`, `index.html`, `js/tienda-common.js`, `js/anexo.js`, `js/landing.js`, `README-DESPLIEGUE.md`.
- **Docs:** `docs/CONTEXTO.md` §6.4 y §7, `docs/TESTING.md` §20, `bot/instrucciones_planeacion.md` (carpeta y link de personalizados), corrección de `proyecto_dos_id` en la spec.
