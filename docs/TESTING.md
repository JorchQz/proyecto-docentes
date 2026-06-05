# TESTING MANUAL — SaaS NEM para Docentes

**Última actualización:** 2026-05-13
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
- [ ] Botón "Regístrate aquí" cambia el formulario al modo registro
- [ ] Validación: correo inválido muestra error
- [ ] Validación: contraseña corta muestra error
- [ ] Registro exitoso muestra mensaje de éxito y redirige a `onboarding.html`

### Login
- [ ] Login con credenciales correctas redirige a `dashboard.html` (usuario con grupo)
- [ ] Login de usuario sin grupo redirige a `onboarding.html`
- [ ] Login con contraseña incorrecta muestra error claro (no crash)
- [ ] Olvidé contraseña: envía correo y muestra confirmación

**Edge cases:**
- [ ] Ir a `dashboard.html` sin sesión → redirige a `index.html`
- [ ] Ir a `asistencia.html` sin sesión → redirige a `index.html`

---

## 2. ONBOARDING — onboarding.html

### Paso 1: Crear grupo
- [ ] Dropdown "Tipo de Organización" muestra las opciones correctas
- [ ] El campo "Grados" acepta selección múltiple
- [ ] Enviar formulario vacío muestra validación
- [ ] Crear grupo con datos completos avanza al Paso 2

### Paso 2: Agregar alumnos
- [ ] Se puede agregar alumno con solo nombre (campos opcionales vacíos)
- [ ] Botón "Eliminar" en cada alumno funciona
- [ ] Contador de alumnos se actualiza
- [ ] "Completar Configuración" deshabilitado con 0 alumnos
- [ ] Con alumnos → guardar redirige a `dashboard.html`

**Edge cases:**
- [ ] Entrar a onboarding con grupo ya creado → redirige a `dashboard.html`

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

## RESUMEN

| Módulo | Estado | Problemas encontrados |
|--------|--------|-----------------------|
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
