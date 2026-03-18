# 🧪 TESTING - ProfeTech

Fecha de prueba: __18-03-2026_____________

---

## 1️⃣ REGISTRO (index.html)

- [✅ ] Click en "Regístrate aquí" cambia el formulario
- [✅ ] Ingresa correo válido
- [✅ ] Ingresa contraseña
- [✅ ] Click en "Crear Cuenta" funciona
- [✅ ] Aparece mensaje de éxito
- [✅ ] Redirige a onboarding.html automáticamente

**Comentarios:**
```
Aquí escribe cualquier problema o comportamiento extraño que veas
```

---

## 2️⃣ LOGIN (index.html)

- [✅ ] Vuelve a la pantalla de login (modo toggleado)
- [✅ ] Ingresa el correo que acabas de registrar
- [✅ ] Ingresa la contraseña correcta
- [ ✅] Click en "Iniciar Sesión" funciona
- [✅ ] Aparece mensaje de éxito
- [✅ ] Redirige a onboarding.html

**Comentarios:**
```

```

---

## 3️⃣ CREAR GRUPO (onboarding.html - Paso 1)

- [✅ ] Aparece el formulario de grupo
- [✅ ] Campo "Nombre del Grupo" existe y es editable
- [✅ ] Campo "Tipo de Organización" es un dropdown con 4 opciones
- [✅ ] Campo "Grado(s) que Atiendes" existe
- [✅ ] Campo "Escuela" existe (opcional)
- [✅ ] Campo "Descripción" existe (opcional)
- [✅ ] Click en "Crear Grupo" sin llenar campos requeridos muestra error
- [✅ ] Llena todos los requeridos y haz click en "Crear Grupo"
- [ ✅] Aparece mensaje de éxito
- [ ✅] El formulario desaparece y aparece el Paso 2

**Comentarios:**
```

```

---

## 4️⃣ AGREGAR ALUMNOS (onboarding.html - Paso 2)

- [✅ ] Aparece la sección "Paso 2: Agregar Alumnos"
- [✅ ] Campo "Nombre Completo" existe
- [✅ ] Campo "Número de Lista" existe (es número)
- [✅ ] Botón "+ Agregar Alumno" funciona
- [ ] Agrega 3 alumnos sin llenar "Número de Lista" (opcional)
- [✅ ] Los alumnos aparecen en la lista con formato: "Nombre (Lista: X)"
- [✅ ] Botón "Eliminar" en cada alumno funciona
- [✅] Contador de alumnos se actualiza correctamente
- [✅ ] Botón "Completar Configuración" está DESHABILITADO si hay 0 alumnos
- [✅] Botón "Completar Configuración" se HABILITA cuando hay al menos 1 alumno
- [ ] Click en "Completar Configuración" con alumnos agregados funciona
- [ ] Aparece mensaje de "Alumnos guardados"
- [ ] Redirige a dashboard.html después de 2-3 segundos

**Comentarios:**
```
Ahora Veo las 3 casillas pero me esta permitiendo agregar dos palabaras en las casillas y eso solo debería permitirse en nombre(s)
se que son cosas que el usuario deberia obviar pero lo haremos todo a prueba de errores
Revisa en supabase si también tenemos las columnas para los datos o solo es nombre y no por separado según las casillas de entrada que tenemos en este apartado, para que no queden datos flotando
```

---

## 5️⃣ DASHBOARD (dashboard.html)

- [ ] Aparece el dashboard sin errores
- [ ] Muestra tu correo electrónico en "Sesión iniciada como"
- [ ] Sección "Información del Grupo" existe
- [ ] Muestra el "Nombre del Grupo" que creaste
- [ ] Muestra el "Tipo de Organización" correctamente (Multigrado, Bidocente, etc)
- [ ] Muestra los "Grados que Atiende" (Ej: 4,5,6)
- [ ] Botón "Cerrar sesión" existe y es visible
- [ ] Click en "Cerrar sesión" funciona
- [ ] Después de cerrar sesión, redirige a index.html

**Comentarios:**
```
Aquí escribe cualquier problema o comportamiento extraño que veas
```

---

## 6️⃣ PROTECCIÓN DE SESIÓN

- [ ] En una pestaña nueva, intenta ir directamente a: http://localhost:5500/dashboard.html (o tu URL)
- [ ] Sin estar logueado, ¿te redirige a index.html?
- [ ] Abre el navegador en modo privado y entra a dashboard.html
- [ ] ¿Te redirige a index.html por no tener sesión?

**Comentarios:**
```
Aquí escribe cualquier problema o comportamiento extraño que veas
```

---

## 7️⃣ FLUJO COMPLETO (Segunda vez)

- [ ] Cierra sesión desde dashboard
- [ ] Haz login nuevamente con el mismo correo
- [ ] Sin crear nuevo grupo, ¿el dashboard carga directo?
- [ ] ¿Muestra el mismo grupo que creaste antes?
- [ ] ¿Los alumnos siguen ahí?

**Comentarios:**
```
Aquí escribe cualquier problema o comportamiento extraño que veas
```

---

## 🐛 ERRORES EN CONSOLA

Abre la consola del navegador (F12 → Consola):

- [ ] ¿Hay errores rojos?
- [ ] ¿Hay advertencias amarillas?

**Copiar errores aquí:**
```
[Pega aquí cualquier error que veas en la consola]
```

---

## RESUMEN GENERAL

**¿Funciona el flujo completo sin problemas graves?**
- [ ] SÍ
- [ ] NO (explicar abajo)

**¿Qué es lo principal que no funciona?**
```
Describe el problema más importante que encontraste
```

**¿Qué cambios sugerirías?**
```
Ideas de mejora o ajustes
```

---

Una vez llenes esto, pégamelo aquí en tu próximo mensaje y yo hago los ajustes necesarios. 👍
