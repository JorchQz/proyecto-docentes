# TESTING MANUAL — SaaS NEM para Docentes

**Última actualización:** 2026-09-03
**Dispositivo objetivo:** Samsung Galaxy Tab S9 FE+ (12.4", landscape) — simular con DevTools 1280×800

---

## CÓMO USAR ESTE CHECKLIST

Marca cada punto:
- `[✅]` — Funciona correctamente
- `[❌]` — Falla (describe el problema en "Comentarios")
- `[⏭]` — Omitido (anota por qué)

---

## 1. AUTH — index.html

### Registro
- [✅] Botón "Regístrate aquí" cambia el formulario al modo registro
- [✅] Validación: correo inválido muestra error
- [✅ ] Validación: contraseña corta muestra error
- [✅ ] Registro exitoso muestra mensaje de éxito y redirige a `onboarding.html` 

### Login
- [✅ ] Login con credenciales correctas redirige a `dashboard.html` (usuario con grupo)
- [✅ ] Login de usuario sin grupo redirige a `onboarding.html`
- [✅ ] Login con contraseña incorrecta muestra error claro (no crash)
- [✅ ] Olvidé contraseña: envía correo y muestra confirmación

**Edge cases:**
- [✅ ] Ir a `dashboard.html` sin sesión → redirige a `index.html`
- [✅ ] Ir a `asistencia.html` sin sesión → redirige a `index.html`

---

## 2. ONBOARDING — onboarding.html

### Paso 1: Crear grupo
- [✅ ] Dropdown "Tipo de Organización" muestra las opciones correctas
- [✅ ] El campo "Grados" acepta selección múltiple
- [✅ ] Enviar formulario vacío muestra validación
- [✅ ] Crear grupo con datos completos avanza al Paso 2
Cosas que corregir: 
En el ciclo escolar pide año de inicio y fin, siempre los ciclos serán el año en curso y el siguiente, pero por si acaso llegaran a registrarse al siguiente año entonces solo deja editable el año de inicio y el final se calcula con un año más que el inicio.
En el tipo de organización quita la explicación que hay entre parentesis e investiga si tetradocente y pentadocente son reales en la sep porque no lo creo

### Paso 2: Agregar alumnos
- [❌ ] Se puede agregar alumno con solo nombre (campos opcionales vacíos) Aquí debería aceptar solo datos completos o almenos un apellido
- [✅] Botón "Eliminar" en cada alumno funciona en lugar de la palabra eliminar me gustaría un icono de basura de la misma bibliote lucide y la posibilidad de editar con un icono de lapiz o algo así en color azul
- [ ] Contador de alumnos se actualiza
- [ ] "Completar Configuración" deshabilitado con 0 alumnos
- [ ] Con alumnos → guardar redirige a `dashboard.html`

**Edge cases:**
- [ ] Entrar a onboarding con grupo ya creado → redirige a `dashboard.html`
quita lo de Agrega alumnos uno por uno. es repetitivo
---

## 3. DASHBOARD — dashboard.html

### Estado sin proyecto activo
- [ ] Dashboard carga sin error en consola
- [ ] Muestra mensaje de "No hay proyecto activo"
- [ ] Enlace a `planeacion.html` o `crear_proyecto.html` visible
- [ ] NO muestra cards de asistencia/tareas/sesión

### Estado con proyecto activo (sesión pendiente)
- [ ] Card de Asistencia se muestra y carga los alumnos
- [ ] Cada alumno tiene checkbox y nombre legible
- [ ] Checkbox tiene tamaño táctil adecuado (≥ 44px aprox)
- [ ] "Marcar todos" marca todos como presente
- [ ] Autosave funciona (sin botón de guardar manual)
- [ ] Card de Tareas se muestra con las tareas de ayer
- [ ] Card de Sesión muestra: INICIO / DESARROLLO / CIERRE

### Modal de cierre de sesión
- [ ] Botón "✓ Sesión completada" abre el modal
- [ ] Modal tiene sección de Participación y Conducta por alumno
- [ ] Botones 10/9/8/7/6/5 son táctiles (≥ 44px)
- [ ] Setter global "Aplicar a todos: 10" cambia todos los alumnos
- [ ] Se puede ajustar alumno individual sin cambiar el resto
- [ ] Botón "Guardar y cerrar" cierra el modal y marca sesión como completada
- [ ] **Edge case:** Calificaciones fallan → sesión se cierra igual (no queda bloqueada)

### Estado con proyecto terminado
- [ ] Al cerrar la última sesión → resumen del día aparece
- [ ] Resumen muestra tareas para mañana (si las hay)

**Edge cases:**
- [ ] Sin alumnos en el grupo → asistencia muestra lista vacía sin crash
- [ ] Proyecto activo sin sesión activa → dashboard muestra "no hay sesión" sin crash
- [ ] Error de red → aparece mensaje de error claro

---

## 4. ASISTENCIA — asistencia.html

- [ ] Carga la lista de alumnos del grupo
- [ ] Selector de fecha funciona y carga asistencia del día seleccionado
- [ ] Cambiar fecha hacia el pasado carga los registros históricos
- [ ] "Marcar todos" → todos presentes
- [ ] "Limpiar" → todos desmarcados
- [ ] Autosave confirma guardado (indicador visible)

**Edge cases:**
- [ ] Sin asistencia registrada para una fecha → todos sin marcar (no crash)

---

## 5. MI GRUPO — mi-grupo.html

- [ ] Muestra nombre del grupo, tipo, grados y total de alumnos
- [ ] Botón de engranaje (≥ 44px) abre el menú de acciones
- [ ] "Editar grupo" abre el formulario con los datos actuales
- [ ] Tabs "Datos del grupo" / "Alumnos" funcionan
- [ ] Se puede agregar un alumno nuevo
- [ ] Se puede eliminar un alumno (confirmación aparece)
- [ ] "Eliminar grupo" muestra confirmación y redirige a onboarding

**Edge cases:**
- [ ] Cancelar eliminación → nada cambia

---

## 6. PLANEACIÓN — planeacion.html

### Lista de proyectos
- [ ] Carga los proyectos del maestro
- [ ] Muestra badge de estado (Listo / Activo / Pausado / Completado)
- [ ] Sin proyectos → muestra botón "Crear mi primer proyecto"

### Iniciar proyecto
- [ ] Botón "▶ Iniciar proyecto" abre modal con selector de fecha
- [ ] Confirmar con fecha → proyecto cambia a "Activo"
- [ ] Proyecto activo aparece en el Dashboard
- [ ] **Edge case:** Proyecto sin sesiones → muestra error "Edítalo para agregarlas" (no inicia)

### Pausar proyecto
- [ ] Botón "Pausar" cambia estado a "Pausado"
- [ ] Proyecto pausado ya no aparece como activo en el Dashboard

---

## 7. CREAR PROYECTO — crear_proyecto.html

### Paso 1
- [ ] Selector de grados muestra los del grupo del maestro
- [ ] Fases se derivan automáticamente al seleccionar grados
- [ ] Campos formativos: selección múltiple funciona
- [ ] Ejes articuladores: selección múltiple funciona
- [ ] Propósito y pregunta generadora: texto libre

### Paso 2
- [ ] Buscador de contenidos SEP funciona por campo formativo
- [ ] Agregar contenido lo muestra como chip
- [ ] PDAs aparecen al seleccionar contenidos
- [ ] Se puede guardar borrador

### Paso 3
- [ ] Agregar sesión crea un bloque nuevo
- [ ] Cada sesión tiene INICIO / DESARROLLO / CIERRE
- [ ] Actividades "Todos igual" vs "Diferenciado" funciona
- [ ] **Edge case:** Intentar eliminar la única sesión → toast de error (no la elimina)
- [ ] Guardar proyecto crea registro en Supabase y redirige a `planeacion.html`

---

## 8. ACTIVIDADES — actividades.html

- [ ] Carga las sesiones de todos los proyectos del maestro
- [ ] Filtro "Todos los proyectos" muestra todo; filtrar por proyecto funciona
- [ ] Filtro por campo formativo funciona
- [ ] Cards muestran actividades de INICIO / DESARROLLO / CIERRE
- [ ] Botón "Ver proyecto completo" redirige al proyecto correcto

**Edge cases:**
- [ ] Sin proyectos → muestra estado vacío con CTA "Crear mi primer proyecto"
- [ ] Proyectos sin sesiones → lista vacía sin crash

---

## 9. TAREAS — tareas.html

- [ ] Carga las tareas asignadas (generadas al cerrar sesiones)
- [ ] Cada tarea muestra: descripción, grado, fecha asignada
- [ ] Badge "Pendiente" / "Revisada" correcto
- [ ] Botón "✓ Marcar como revisada" actualiza en Supabase
- [ ] Botón cambia a "Marcar como pendiente" después de marcar
- [ ] Filtro por proyecto funciona
- [ ] Filtro por grado funciona

**Edge cases:**
- [ ] Sin tareas → estado vacío explica que se generan al cerrar sesiones
- [ ] Error al marcar → botón restaura su texto original (no queda en "Guardando...")

---

## 10. REPORTES — reportes.html

### Tab Asistencia
- [ ] Seleccionar fechas y generar → muestra tabla con Presentes / Faltas / Justificadas
- [ ] Color verde para asistencia alta, rojo para baja
- [ ] Botón PDF descarga el reporte

### Tab Vista Recrea
- [ ] Selector de trimestre funciona (o "Todos" para ver todo)
- [ ] Tabla muestra TODOS los alumnos (incluso sin calificaciones muestran "—")
- [ ] Promedios por campo formativo con color verde/amarillo/rojo
- [ ] Columna "Prom." muestra el promedio general
- [ ] Botón "Exportar CSV" descarga archivo que abre bien en Excel (sin caracteres rotos)

### Tab Concentrado Director
- [ ] Tres bloques: Alto (9-10) / Medio (7-8) / Bajo (5-6)
- [ ] Cada bloque muestra nombre, grado y promedio del alumno

**Edge cases:**
- [ ] Sin calificaciones registradas → mensaje explicativo en Vista Recrea
- [ ] Sin proyectos para el trimestre seleccionado → mensaje claro

---

## 11. MI CUENTA — mi-cuenta.html

- [ ] Muestra el email actual
- [ ] Cambiar email funciona y muestra confirmación
- [ ] Cambiar contraseña: validación de contraseña débil funciona
- [ ] Cambiar contraseña exitoso muestra mensaje de éxito

---

## 12. AJUSTES — ajustes.html

- [ ] Eliminar cuenta muestra confirmación doble
- [ ] Cancelar → no elimina nada
- [ ] Confirmar → elimina y redirige a `index.html`

---

## 13. NAVEGACIÓN Y UX GENERAL

- [ ] Navbar se muestra en todas las páginas protegidas
- [ ] Botón de menú hamburguesa abre/cierra el menú lateral
- [ ] "Cerrar sesión" desde el menú funciona
- [ ] Ningún botón de acción es menor a ~44px en altura (probar con dedo en tablet)
- [ ] En orientación landscape 1280×800 no hay scroll horizontal inesperado
- [ ] Los toasts de error aparecen en rojo (abajo a la derecha), los de éxito en verde

---

## ERRORES EN CONSOLA

Abrir DevTools (F12 → Consola) durante toda la sesión de pruebas:

- [ ] Sin errores rojos al cargar cada página
- [ ] Sin errores rojos durante las acciones

```
[Pega aquí errores de consola si los hay]
```

---

## 14. EVALUACIÓN FORMATIVA — evaluacion_formativa.html

- [ ] Se abre desde el dashboard tras cerrar sesión (botón "Ir a Evaluación Formativa" con `?sesion_id=`)
- [ ] Muestra un criterio por PDA del grado de cada alumno (multigrado: cada alumno ve solo los de su grado)
- [ ] Sesión sin PDAs: muestra el criterio genérico "Participación en la sesión"
- [ ] Tocar Logrado / En proceso / Requiere apoyo guarda al instante (autosave); recargar conserva la selección
- [ ] Observación por criterio se guarda al salir del campo (solo si hay semáforo)
- [ ] **Trazabilidad:** en SQL, toda fila nueva de `evaluacion_formativa` con PDA tiene `sesion_pda_id` NOT NULL
- [ ] **Backfill perezoso:** abrir una sesión creada ANTES de 2026-09 crea sus filas en `sesiones_pda` automáticamente

## 15. EVALUACIÓN DIAGNÓSTICA — evaluacion_diagnostica.html

- [ ] Selector de alumno marca quiénes ya fueron evaluados en el momento elegido
- [ ] Momentos disponibles: inicio de ciclo y trimestres 1–3
- [ ] Cuaderno (10 criterios), lectura (PPM + comprensión) y matemáticas (8 subhabilidades) se guardan con upsert
- [ ] Re-guardar al mismo alumno/momento actualiza (no duplica)

## 16. EXÁMENES — examen.html

- [ ] Crear examen desde banco de preguntas por grado/trimestre
- [ ] Aplicar y calificar; la auto-calificación reparte puntos por campo formativo
- [ ] La boleta refleja el puntaje del examen por campo

## 17. MARKETPLACE + IMPORTAR — marketplace.html

- [ ] Catálogo con filtros y preview de sesiones
- [ ] Importar un proyecto de UN grado (`6G_T2_P07`): crea proyecto + sesiones
- [ ] Importar el multigrado `4G-5G-6G_T2_P08`: la S01 crea 3 `productos_sesion` de trabajo (uno por grado, `diferenciada`, `origen='backfill'`) + tareas por grado + `sesiones_pda` por grado
- [ ] En SQL: `SELECT count(*) FROM productos_sesion WHERE array_length(grados,1) IS NULL` → 0
- [ ] Calificar una sesión importada escribe en `calificaciones` (mismo flujo que un proyecto propio)

## 18. BOLETA — reportes.html (pestaña Boleta)

- [ ] Generar boleta calcula calificación por campo con la ponderación de Ajustes (rubros ausentes renormalizan)
- [ ] **Persistencia:** escribir Fortalezas/Áreas en un campo (p. ej. LEN) y en Observaciones generales, recargar la página y regenerar → los textos siguen ahí
- [ ] En SQL: esas filas de `boleta_trimestral` tienen `editado_manual = true`
- [ ] El porcentaje/calificación por campo se persiste en `boleta_trimestral` al generar (filas no cerradas)
- [ ] PDF e imagen se generan; el resumen de WhatsApp abre con el texto correcto

## 19. CIERRE DE SESIÓN — regresión 2026-09

- [ ] El modal de cierre ya NO pide Participación/Conducta (solo notas)
- [ ] Cerrar sesión NO crea filas `tipo IN ('participacion','conducta')` en `calificaciones`
- [ ] Re-guardar la revisión de tareas del día NO duplica filas `tipo='tarea'` (se reemplazan)
- [ ] Crear proyecto propio con PDAs: al guardar se crean `sesiones_pda` y `productos_sesion` (`origen='maestro'`)
- [ ] En crear_proyecto, elegir un PDA muestra los criterios sugeridos del banco (tocar uno lo copia al textarea)

## 20. TIENDA — tienda/*.html (venta de proyectos sueltos, 2026-09)

Probar en `jissez.com` (o Live Server) con la cuenta admin `soporte.jissez@gmail.com` y con una cuenta de comprador. Existe un usuario de pruebas con un proyecto suelto ya comprado (con anexos): `pruebas.bloque1@jissez.com` / `PruebaBloque1-2026`.

### Bloque 0 — cuenta admin
- [ ] Entrar con `soporte.jissez@gmail.com` → `admin.html` carga y las pestañas Precios y Órdenes responden
- [ ] Entrar con `jorgequezadarm@gmail.com` → "Acceso restringido"

### Bloque 1 — proyectos sueltos (admin)
- [ ] Admin → pestaña **Proyectos sueltos** → elegir "1° Primaria — Trimestre 1" → "Detectar proyectos en Drive" lista P01–P04 con PDF, Word y número de anexos, y el nombre del proyecto del bot
- [ ] "Crear productos seleccionados" crea las filas ocultas; la tabla de abajo las muestra con $80 / $120
- [ ] Cambiar precios y marcar "Publicado" → Guardar → se refleja al recargar
- [ ] Catálogo de paquetes: la tarjeta de 1° sigue diciendo "desde $249" (los sueltos NO se cuelan)
- [ ] Landing: los "desde $X" no bajan a $80

### Bloque 1 — compra y entrega (comprador)
- [ ] `checkout.html?producto_id=<suelto>&tipo=pdf` muestra "Proyecto individual … sin anexos" y el precio sin anexos
- [ ] `…&tipo=anexos` muestra el desglose "Proyecto en PDF + Word" + "Anexos imprimibles"
- [ ] `…&tipo=editable` en un suelto → "Esta versión no existe para este producto"
- [ ] Sin marcar la casilla de Términos, "Continuar al pago" no avanza; marcada, redirige a Mercado Pago
- [ ] En SQL: la orden tiene `terminos_aceptados_en` lleno y el ítem `tipo='anexos'`
- [ ] Pagar (sandbox) la versión **con anexos** → Mis compras muestra "Proyecto N · Trimestre T" y "PDF + Word + anexos" → Abrir biblioteca lista planeación PDF, Word y subcarpetas S0X
- [ ] Abrir el link impreso en la planeación `anexo.html?aula=1&pr=1&a=ANX-2627-T1-1G-P01-S02-01` → se ve el anexo
- [ ] Pagar la versión **sin anexos** con otra cuenta → biblioteca sin subcarpetas; el link de anexo muestra "Este proyecto lo compraste sin anexos"
- [ ] Regresión: un comprador de paquete trimestral sigue viendo proyectos, examen y anexos igual que antes
- [ ] Admin → Acceso manual → versión "Con anexos" sobre un suelto crea pdf+editable+anexos; "Editable" sobre un suelto da error

### Bloque 2 — catálogo de proyectos, ficha y legal (probado en navegador el 2026-09-09; 41 comprobaciones)
- [x] `catalogo.html?vista=proyectos` muestra una tarjeta por proyecto con chips de campo formativo y "Desde $80"
- [x] Chip de campo, contenido (lista acotada) y PDA filtran; quitar el contenido restaura
- [x] Sin resultados → CTA "Pedir un proyecto a la medida" con los filtros en la URL; se registra en `marketplace_busquedas_vacias`
- [x] Vista de paquetes intacta (1° sigue "desde $249"); landing no baja a $80
- [x] `proyecto.html?id=` pinta título, dos versiones (con/sin anexos, promo aplicada), temario por campo, vista previa PDF, puente al paquete del trimestre; sin desborde en móvil
- [x] Checkout: resumen del proyecto, desglose "Proyecto en PDF + Word / Anexos imprimibles", casilla de Términos obligatoria, `tipo=editable` rechazado
- [x] `terminos.html` (12 cláusulas, huecos marcados) y `privacidad.html` (menciona Meta Pixel) con footer y enlaces en ambos footers
- [ ] Publicar sueltos reales: admin → Proyectos sueltos → detectar 1° T1 → crear → marcar Publicado (los 4 de 1° T1 ya están creados, ocultos)

### Bloque 3 — proyectos a la medida (probado el 2026-09-09)
- [x] `personalizado.html` con prefill desde la URL, contenidos de la fase filtrados por campo, PDAs del contenido, resumen y total con promo; cupo visible
- [x] Multigrado sin combo no avanza; con cupo 0 el formulario se bloquea y el checkout no deja pagar
- [x] Checkout modo pedido: resumen "Lo que pediste", casilla legal, `crear-preferencia-mp` crea pedido PZ-0001 + orden + ítem `anexos`, sella términos, reutiliza el intento pendiente y actualiza el formulario
- [x] Servidor: 409 `agotado` con cupo 0, 400 combo inválido, 400 `editable`
- [x] Mis compras: sección "Proyectos a la medida" con estado, número y fecha comprometida; el pedido pagado no sale como pago en proceso
- [x] `anexo.html?pedido=PZ-0001&a=…` de un pedido sin entregar: mensaje claro
- [x] RPC admin (listar con vencido, cambiar estado, estado/guardar config, búsquedas vacías) bajo la identidad del admin; rechazadas para no admin. `completar-pedido` y `admin-proyectos-drive` rechazan a no admin
- [ ] **Pendiente de probar con la cuenta admin en navegador:** admin → A la medida → Entregar PZ-0001 con una carpeta de prueba (PDF + Word + S01) → el cliente de pruebas ve el proyecto en su biblioteca y recibe el correo; y Proyectos sueltos → Detectar
- [ ] Correos de "pedido recibido" (cliente y negocio) se disparan al acreditarse un pago real; el helper de envío quedó probado con el aviso de vencidos

### Bloque 4 — mejoras (probado el 2026-09-09)
- [x] `avisos-pedidos`: 403 sin secreto; con un pedido vencido manda el correo a `soporte.jissez@gmail.com`; el job `avisos-pedidos-diario` (8:00 hora del centro) disparó la función vía pg_net + Vault y registró 200
- [x] `practicantes.html` carga sin errores ni desborde en escritorio y móvil, con enlaces al catálogo de proyectos y al pedido a la medida
- [x] Búsquedas vacías: inserción anónima permitida, lectura solo admin

---

## RESUMEN

| Módulo | Estado | Problemas encontrados |
|--------|--------|-----------------------|
| Tienda (proyectos sueltos) | | |
| Auth | | |
| Onboarding | | |
| Dashboard | | |
| Asistencia | | |
| Mi Grupo | | |
| Planeación | | |
| Crear Proyecto | | |
| Actividades | | |
| Tareas | | |
| Reportes | | |
| Mi Cuenta | | |
| Ajustes | | |
| Evaluación Formativa | | |
| Evaluación Diagnóstica | | |
| Exámenes | | |
| Marketplace | | |
| Boleta | | |
