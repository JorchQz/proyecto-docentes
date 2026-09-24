# Plan de privacidad de Mi salón

Acompaña a `docs/legal/aviso-privacidad-mi-salon-BORRADOR.md`. Es un borrador para revisarlo
con un abogado. **No se ha cambiado código ni se ha publicado nada.**

**Fuentes:**
- Ley Federal de Protección de Datos Personales en Posesión de los Particulares, DOF
  20/03/2025, última reforma DOF 14/11/2025 (`docs/referencia/oficiales/LFPDPPP_2025_diputados.pdf`).
- Ley General de los Derechos de Niñas, Niños y Adolescentes, última reforma DOF 15/01/2026
  (`LGDNNA_diputados.pdf`).
- `docs/referencia/verificacion-auditoria-nem.md`, punto 14.
- Aviso de la tienda: `tienda/privacidad.html`.
- Código y esquema: `docs/CONTEXTO.md` §6, `js/`, `supabase/functions/redactar-boleta/` y
  `.qa/estructura-prod.sql` (copia de la estructura de producción del 24/09/2026).

---

## 0. Punto de partida: ¿Jissez es responsable o encargado?

**Qué dice la Ley.**
- **Responsable** es el particular que trata datos personales (art. 2-XIV y XVI).
- **Persona encargada** es quien trata datos "por cuenta del responsable" (art. 2-XII).
- Lo que se comunica a una persona encargada no es transferencia (art. 2-XX).
- La Ley de 2025 **no regula a detalle al encargado**: no fija sus obligaciones ni exige un
  contrato. La ley de 2010 remitía eso al Reglamento de 2011, y la Ley nueva menciona un
  Reglamento (art. 2-XIII) que no sabemos si ya se publicó.
- La LFPDPPP no tiene reglas propias para menores. La LGDNNA reconoce a niñas y niños el
  derecho a la intimidad y a la protección de sus datos personales, y prohíbe divulgarlos de
  forma ilícita (art. 76). El interés superior de la niñez es primordial (art. 2) y prohíbe
  la discriminación (art. 39). Los arts. 77 a 81 se dirigen a medios de comunicación y
  procedimientos, no a Mi salón.

**Opción A: Jissez como encargado del maestro o de la escuela.**
Se parece a lo que pasa en la práctica: el maestro decide a quién da de alta, qué captura y a
quién entrega la boleta. Pero tiene huecos:
1. En una **escuela pública**, el maestro es servidor público. Los datos escolares serían de
   un sujeto obligado, regido por la Ley General de Protección de Datos Personales en
   Posesión de Sujetos Obligados, que se expidió en el mismo decreto. El maestro, por sí
   solo, difícilmente puede contratar un encargado en nombre de la SEP, y Jissez no tiene
   contrato con ninguna escuela.
2. Si el maestro usa Mi salón por su cuenta, su tratamiento podría caer en la exclusión del
   art. 1-II (uso exclusivamente personal). Entonces no habría un "responsable" por cuya
   cuenta actúe Jissez. Jissez sí tiene fines comerciales, así que sigue sujeto a la Ley.
3. Jissez decide cosas propias de un responsable: los proveedores, que la base esté en EE.
   UU., la IA, los plazos de conservación y las reglas que proponen textos y calificaciones.

**Opción B, conservadora: Jissez responsable del tratamiento en la plataforma.**
Jissez asume ante las familias y la autoridad todo lo que ocurre dentro de Mi salón:
almacenamiento, seguridad, proveedores, IA, conservación y borrado. El maestro, o su escuela,
responde por capturar lícitamente y por entregar los documentos a las familias. Esto implica:
- publicar un aviso integral que también se dirija a las familias;
- atender derechos ARCO de madres, padres y tutores, verificando la representación;
- usar los datos solo para las finalidades del aviso;
- contratar a los proveedores como encargados de Jissez.

**Recomendación: opción B.** Si una autoridad considerara que Jissez es responsable y no tiene
aviso, eso es infracción (art. 58-V), con multa de 100 a 160,000 UMA (art. 59-II), que puede
duplicarse si hay datos sensibles (art. 59-IV). Pasar después a la figura de encargado es más
fácil que lo contrario. El borrador del aviso ya está escrito con la opción B. El abogado
decide si se complementa con una cláusula en los Términos que diga que Jissez trata los datos
de alumnos "por instrucción del maestro" para las finalidades necesarias.

---

## 1. Textos de consentimiento para la interfaz

Hoy **ninguna** pantalla de alta pide aceptar un aviso de privacidad (revisado en `js/auth.js`
y `tienda/js/login.js`). Cada consentimiento debe guardarse con **versión del aviso y fecha**
(ver sección 4, P0-1).

### 1.1 Creación de cuenta del maestro

**Dónde va:** en los dos formularios de registro, `tienda/login.html` (`tienda/js/login.js`) e
`index.html` (`js/auth.js`), antes del botón "Crear cuenta".

**Aviso simplificado.** El art. 16-II lo exige cuando los datos se obtienen por medios
electrónicos. Debe contener lo del art. 15, fracciones I a IV, y la liga al aviso integral:

> **Aviso de privacidad simplificado.** [NOMBRE O RAZÓN SOCIAL] (Jissez), con domicilio en
> [DOMICILIO], usará tu nombre, correo, escuela y CCT para crear y administrar tu cuenta, darte
> acceso a los materiales y a Mi salón, y darte soporte. Si lo aceptas, también para enviarte
> novedades y promociones. Tus datos se guardan con proveedores en Estados Unidos. Puedes
> limitar su uso, oponerte o ejercer tus derechos en [CORREO DE PRIVACIDAD]. Aviso completo:
> [URL DEL AVISO INTEGRAL].

**Casillas.** Ninguna va marcada de antemano.

- [ ] (obligatoria) **He leído y acepto el [Aviso de privacidad] y los [Términos y
  condiciones].**
- [ ] (opcional) **Quiero recibir novedades y promociones de Jissez por correo.** Puedo darme
  de baja cuando quiera.

Si falta la primera casilla, el botón queda desactivado con el mensaje "Para crear tu cuenta
necesitas aceptar el aviso de privacidad."

> **Pendiente de decisión:** la tienda y Mi salón comparten la cuenta. Hay que decidir con el
> abogado si se publica un solo aviso con dos secciones (tienda y Mi salón) o dos avisos
> enlazados. El de la tienda dice hoy "No recabamos intencionalmente datos de menores", y eso
> deja de ser cierto para el mismo responsable cuando Mi salón abra al público.

### 1.2 Primera entrada a Mi salón

**Dónde va:** la primera vez que una cuenta con acceso a Mi salón (`perfiles.activo_saas`)
entra al SaaS, antes de dar de alta alumnos. El lugar natural es el guardia `js/saas-guard.js`,
que manda a una pantalla de aceptación. También se muestra a las cuentas que ya existen, en su
siguiente acceso, y cada vez que cambie la versión del aviso.

**Texto:**

> ### Antes de empezar: los datos de tus alumnos
>
> En Mi salón vas a registrar datos de niñas y niños: nombre, grado, asistencia, evidencias,
> calificaciones, participación, conducta, diagnóstico y observaciones. La ley protege de
> forma especial su intimidad y sus datos personales.
>
> Jissez guarda esta información con medidas de seguridad, solo tú la ves y no la usa para
> publicidad ni la vende. Los detalles están en el [Aviso de privacidad de Mi salón].
>
> Al continuar, te comprometes a:
> 1. Capturar solo datos de alumnos de tus grupos y solo para tu labor docente.
> 2. Informar a las madres, padres o tutores que usas Mi salón y dónde consultar el aviso de
>    privacidad. Te damos un texto listo para enviar.
> 3. **No escribir** diagnósticos médicos o psicológicos, discapacidades, condiciones de
>    salud, medicamentos, situación familiar o legal, religión ni origen étnico de ningún
>    alumno.
> 4. Compartir la boleta y los reportes solo con la familia de cada alumno.
> 5. No dejar tu sesión abierta en un equipo que usen otras personas.
>
> - [ ] **Entiendo y acepto estos compromisos y el aviso de privacidad de Mi salón.**
>
> [Continuar]   [Ver texto para las familias]

### 1.3 Activación de la redacción con IA

**Dónde va:**
- En **Reportes → Boleta**, la primera vez que el maestro pulsa "Redactar con IA" (`js/reportes.js`).
- En **Ajustes**, como interruptor "Redacción con IA", apagado por defecto.

Mientras no haya consentimiento guardado, el botón abre este diálogo en vez de redactar.

**Texto:**

> ### Redactar la boleta con inteligencia artificial
>
> Esta función opcional mejora la redacción de los textos de fortalezas, áreas de oportunidad
> y sugerencias. **Tú revisas el resultado antes de entregar la boleta.**
>
> **Qué se envía:** las frases que Mi salón ya propuso, el campo formativo, el grado y la
> fase.
> **Qué no se envía:** el nombre del alumno, su número de lista, sus calificaciones, lo que
> escribiste a mano ni los datos de tu escuela. La IA escribe `{nombre}` y Mi salón pone el
> nombre de pila después.
>
> **Quién lo procesa:** Anthropic, PBC, en Estados Unidos, como proveedor de Jissez. No usa
> estos datos para entrenar sus modelos. [VERIFICAR con los términos vigentes]
>
> La IA no decide calificaciones ni niveles, y no cambia los cuadros que tú escribiste.
> Puedes apagarla cuando quieras en Ajustes.
>
> [Activar la redacción con IA]   [Ahora no]

### 1.4 Avisos breves en otras pantallas

Van en el momento en que los datos salen de Mi salón:

| Pantalla | Texto |
|---|---|
| Junta, interruptor "Mostrar nombres" (`js/junta.js`) | "Solo muestra nombres si proyectas en un lugar donde únicamente están las familias de esos alumnos. Las láminas de áreas de atención y de fluidez nunca muestran nombres." |
| Boleta, botón WhatsApp (`js/reportes.js`) | "Envía la boleta solo al número de la madre, padre o tutor de este alumno. El mensaje incluye su nombre completo y sus calificaciones." |
| Exportar (`exportar.html`) | "El archivo contiene datos de todo el grupo. Guárdalo en un equipo protegido y no lo compartas por grupos de mensajería." |
| Ajustes → Eliminar cuenta (`ajustes.html`) | Agregar: "También se borran las calificaciones, las boletas, los diagnósticos y los registros diarios de tus alumnos. Descarga antes lo que necesites conservar." |

---

## 2. Aviso corto junto a los cuadros de observaciones

**Texto** (bajo el cuadro, en gris, con un icono Lucide `shield-alert`, sin emoji):

> No escribas diagnósticos, datos de salud, discapacidades ni situaciones familiares. Describe
> lo que observas en el aprendizaje.

**Versión larga** para una ayuda desplegable o para la primera vez:

> Estas notas pueden llegar a la familia o quedarse guardadas varios ciclos. Escribe lo que
> observas en clase ("se le dificulta seguir instrucciones escritas"), no etiquetas ni
> diagnósticos ("tiene TDAH", "es disléxico"). Si un alumno recibe apoyo de USAER o de un
> especialista, esa información se queda en el expediente de la escuela, no en Mi salón.

**Dónde va.** Cuadros de texto libre que se encontraron en el código:

| Pantalla | Cuadro | Archivo | Llega a la familia |
|---|---|---|---|
| Evaluación diagnóstica | Observaciones del alumno | `js/evaluacion_diagnostica.js` (`#inputObs`) | Sí, en la boleta como "Trabajo diario" |
| Hoy | Retroalimentación por producto | `js/hoy.js` (`data-retroalimentacion`) | Sí |
| Evaluación formativa | Observación por criterio | `js/evaluacion_formativa.js` (`data-obs-alumno`) | Revisar |
| Reportes → Boleta | Trabajo diario, Fortalezas, Áreas de oportunidad y Sugerencias | `js/reportes.js` (`#boletaObsTrabajo`, `textareaBoleta`) | Sí |
| Inicio → Terminar sesión | Notas de cierre | `js/dashboard.js` (`#notasCierreInput`) | No, pero puede nombrar alumnos |
| Mi grupo | Descripción del grupo | `mi-grupo.html` (`#editGroupDescription`) | No |
| Columnas sin pantalla hoy | `calificaciones.nota_privada`, `registro_diario.nota` | — | Llevar el mismo aviso cuando se les dé pantalla |

---

## 3. Responsabilidades del maestro frente a las familias

Estos compromisos van en los Términos de Mi salón y se aceptan en la primera entrada (1.2):

1. **Informar a las familias**, al inicio del ciclo o al dar de alta a un alumno, que usa Mi
   salón y dónde consultar el aviso. Puede usar el texto modelo de abajo, impreso o por
   mensaje. Si la escuela tiene su propio aviso o formato, se sigue el de la escuela.
2. **Consultar a su dirección** si la escuela o la autoridad educativa permiten usar
   herramientas externas para registrar datos de alumnos. En escuelas públicas puede haber
   reglas de la SEP o del estado.
3. **Capturar solo lo necesario** para evaluar y acompañar el aprendizaje. No escribir datos
   sensibles (sección 2) ni subir fotos de alumnos o de sus trabajos con nombre como recursos
   de proyecto.
4. **Entregar cada boleta solo a su familia.** Verificar el número antes de enviar por
   WhatsApp. En la junta, mantener los nombres ocultos salvo que el contexto lo permita.
5. **Proteger el acceso.** Tener una contraseña propia, cerrar sesión en tabletas compartidas
   y no prestar la cuenta.
6. **Atender o canalizar** las solicitudes de las familias: corregir datos inexactos en Mi
   salón y reenviar a [CORREO DE PRIVACIDAD] las solicitudes de acceso, cancelación u oposición.
7. **Recordar que Mi salón no es el registro oficial.** La boleta oficial sale del sistema de
   control escolar (SIGED). Mi salón ya lo advierte en la boleta, el reporte, la junta y la
   exportación.
8. **Al dejar el grupo o cerrar el ciclo**, exportar lo que deba conservar la escuela y borrar
   lo que ya no se necesite.
9. **Avisar a Jissez** si sospecha que alguien entró a su cuenta.

**Texto modelo para las familias**, que Mi salón mostraría en "Ver texto para las familias":

> Estimadas familias: para llevar la asistencia, las evidencias y las calificaciones del
> grupo uso la herramienta **Mi salón** de Jissez. En ella registro el nombre, grado y número
> de lista de su hija o hijo, su asistencia, sus trabajos y evaluaciones, y observaciones
> sobre su aprendizaje. Esta información la veo solo yo, se guarda con medidas de seguridad,
> no se usa para publicidad ni se vende, y no incluye datos de salud. La boleta oficial sigue
> siendo la de la SEP. Pueden consultar el aviso de privacidad en [URL DEL AVISO INTEGRAL] y
> pedir acceso, corrección o eliminación de los datos escribiendo a [CORREO DE PRIVACIDAD] o
> conmigo. — [Nombre del maestro], [Escuela], grupo [grupo].

---

## 4. Cambios técnicos recomendados, priorizados

**P0** = antes de publicar el aviso o de abrir Mi salón al público. **P1** = en el primer
ciclo. **P2** = mejora. Nada de esto se ha programado. Se prueba en una rama o un proyecto de
Supabase aparte, no en producción.

### P0

1. **Registro de consentimientos.** Crear la tabla `consentimientos` (`maestro_id`, `tipo`
   ∈ `aviso_cuenta` / `mi_salon` / `ia` / `novedades`, `version_aviso`, `aceptado_en`,
   `revocado_en`), con RLS del propio maestro. Las pantallas 1.1, 1.2 y 1.3 escriben ahí. El
   guardia `saas-guard.js` exige `mi_salon` con la versión vigente.
2. **Que la IA exija el consentimiento en el servidor.** `redactar-boleta` debe responder 403
   si no hay consentimiento `ia` vigente, además de ocultar el botón. Hoy el botón aparece
   para todos en cuanto existe el secreto `ANTHROPIC_API_KEY`.
3. **Arreglar "Eliminar cuenta".** `delete_own_account()` solo hace
   `DELETE FROM auth.users`. En la estructura de producción, estas tablas apuntan a
   `auth.users` **sin** `ON DELETE CASCADE`:
   - `maestro_ajustes`, que el onboarding crea para todos;
   - `boleta_trimestral`, `calificaciones`, `evaluacion_diagnostica`,
     `evaluacion_formativa`, `registro_diario`, `productos_sesion`, `tareas` y
     `dias_no_habiles_extra`;
   - `marketplace_ordenes`, `marketplace_accesos` y `marketplace_pedidos`.

   Algunas se vacían antes en cascada por `alumnos` o `sesiones`, pero `maestro_ajustes` no.
   Lo más probable es que **eliminar la cuenta falle para cualquier maestro que hizo el
   onboarding**. Hay que verificarlo en una rama. La corrección:
   - borrar explícitamente en orden, o poner cascada donde corresponda;
   - borrar los archivos del bucket `recursos` del maestro;
   - para órdenes con valor fiscal, bloquear y quitar datos personales en vez de borrar.
4. **Aviso corto en los cuadros** de la sección 2.
5. **Quitar el píxel de Meta de `reset-password.html`** y decidir qué pasa con `index.html`.
   Las dos páginas son la entrada compartida de tienda y SaaS. Además, la de restablecer
   contraseña recibe el token de recuperación en la URL. Hay que confirmar si el píxel envía
   la URL completa, que es un riesgo de seguridad aparte de la privacidad.
6. **Contratos con proveedores (DPA).** Aceptar o descargar el acuerdo de tratamiento de datos
   de Supabase, Cloudflare, Resend y Anthropic. Guardarlos en una carpeta fuera del repo.
7. **Publicar el aviso** en una URL estable, por ejemplo `privacidad-mi-salon.html`, enlazado
   desde el pie de todas las pantallas de Mi salón y desde el registro. Solo después de la
   revisión del abogado y con los P0 anteriores terminados.

### P1: minimización

8. **Columnas sin uso en `perfiles`.** `zona`, `estado`, `municipio` y `grados_asignados`
   tienen permiso de escritura, pero ninguna pantalla actual las llena. Hay que decidir si se
   eliminan o si se justifican en el aviso.
9. **`sexo_docente` opcional**, con la opción "prefiero no decir", y su uso explicado.
10. **Resumen de WhatsApp.** Hoy lleva el nombre completo del alumno y sus calificaciones.
    Proponer nombre de pila y grupo, o una liga al PDF en vez del texto.
11. **Enlaces firmados de `recursos` de un año** (`crear_proyecto.js`, 31,536,000 s).
    Acortarlos, o generarlos al momento de abrir el archivo.
12. **Cargar las bibliotecas desde el propio dominio** (Tailwind, supabase-js, Lucide) en vez
    de CDNs públicos. Así la IP del maestro no llega a terceros y se quita esa fila del aviso.

### P1: retención y borrado

13. **Fijar plazos** y ponerlos en el aviso: [PLAZO DE CONSERVACIÓN DE DATOS DE ALUMNOS],
    [PLAZO DE RESPALDOS] y [PLAZO DE CONSERVACIÓN DE REGISTROS]. Propuesta para discutir:
    - datos de alumnos, hasta **2 ciclos escolares** después del cierre del ciclo;
    - respaldos, el tiempo que el plan de Supabase los guarde (confirmar en el panel);
    - registros de acceso, 12 meses.
14. **Depuración por ciclo.** Aviso al maestro 30 días antes, con botón de exportar. Después,
    se borran los alumnos de ciclos vencidos y todo lo que cuelga de ellos. `asistencias`,
    `calificaciones`, `registro_diario`, `boleta_trimestral` y `respuestas_examen` ya caen en
    cascada al borrar el alumno. En `evaluacion_diagnostica`, la llave a `alumnos` la agrega
    `supabase/mi_salon_b9_diagnostica_cascada_2026-09.sql`, pero no aparece en la estructura
    copiada. Hay que confirmar que esa migración está aplicada en producción.
15. **Bloqueo** (arts. 2-III y 24). Al cancelar una cuenta con obligaciones pendientes, marcar
    los datos como bloqueados en vez de borrarlos, y suprimirlos al vencer el plazo.

### P1: exportación y derechos ARCO

16. **"Descargar todos mis datos"** en Mi cuenta: un ZIP con JSON o XLSX de cada tabla del
    maestro. Hoy solo existe el concentrado de `exportar.html`.
17. **Expediente por alumno.** Exportar todo lo de un alumno para responder la solicitud de
    acceso de una familia. `reporte-alumno.html` cubre casi todo; faltan el registro diario,
    las notas y las respuestas de examen.
18. **Procedimiento interno ARCO:** bandeja en [CORREO DE PRIVACIDAD], plantilla de respuesta,
    control de plazos (20 + 15 días hábiles) y registro de cada solicitud.

### P2: cifrado y registro de accesos

19. **Cifrado.** Confirmar en el plan de Supabase el cifrado en reposo y los respaldos
    cifrados. Evaluar cifrar por columna (Vault o pgsodium) los campos de texto libre:
    `nota_privada`, `observaciones`, `observacion`, `nota` y `retroalimentacion`.
20. **Cierre de sesión por inactividad** en Mi salón, por ejemplo a los 30 minutos, pensado
    para la tableta del salón. Ofrecer verificación en dos pasos para el maestro.
21. **Registro de accesos.** Crear una tabla `bitacora` que solo pueda insertar el sistema
    (maestro, acción, fecha y cantidad de registros) para exportaciones, borrados masivos,
    llamadas a la IA y accesos de soporte. Revisar cuánto tiempo guarda Supabase los registros
    de autenticación.
22. **Regla interna de acceso de Jissez.** Hoy `es_admin()` no da acceso a tablas de alumnos,
    lo cual está bien. Pero la cuenta dueña del proyecto y el `service_role` sí pueden ver
    todo. Por escrito: nadie consulta datos de alumnos sin una solicitud del maestro, y cada
    consulta se anota en la bitácora.
23. **Plan de respuesta a vulneraciones** (art. 19): quién decide, en cuánto tiempo se avisa a
    los maestros y qué texto se usa.

---

## 5. Dudas para el abogado

1. **Figura jurídica.** ¿Jissez es responsable, encargado o ambas cosas según el dato? ¿Cambia
   si la escuela es pública (Ley General de Protección de Datos Personales en Posesión de
   Sujetos Obligados) o privada?
2. **Base del tratamiento de los datos de alumnos.** ¿Basta el consentimiento tácito de la
   familia (art. 7) si el maestro le informa? ¿Aplica alguna excepción del art. 9, como la I
   o la IV, a la labor docente? ¿Debe el maestro recabar un consentimiento por escrito?
3. **Datos no obtenidos del titular** (art. 17). ¿Cómo cumple Jissez la obligación de dar a
   conocer el aviso a las familias, si no tiene contacto con ellas? ¿Sirven como medidas
   compensatorias la publicación en el sitio, el texto modelo para el maestro y una línea en la
   boleta impresa con la URL del aviso?
4. **Reglamento.** ¿Se publicó ya el nuevo Reglamento de la LFPDPPP? ¿Siguen aplicando el
   Reglamento de 2011 y los Lineamientos del Aviso de Privacidad de 2013, en lo que no se
   opongan a la Ley nueva?
5. **Encargados en el extranjero.** Con la Ley de 2025, ¿basta aceptar los DPA estándar de
   Supabase, Cloudflare, Resend y Anthropic? ¿Hay que decir algo más en el aviso sobre el
   almacenamiento en EE. UU.?
6. **IA.** Las frases que se envían no llevan nombre, pero Jissez puede volver a asociarlas al
   alumno. ¿Es una comunicación a un encargado que debe informarse, como está en el borrador?
   ¿Hace falta el consentimiento del maestro, o también el de la familia?
7. **Datos sensibles escritos por el maestro.** Si un maestro escribe un diagnóstico pese a la
   advertencia, ¿qué responsabilidad tiene Jissez? ¿Conviene detectar palabras clave, como
   "TDAH", "autismo" o "medicamento", y bloquear el guardado, o basta con avisar?
8. **BAP.** ¿Registrar que un alumno "enfrenta BAP", sin decir la causa, es un dato sensible?
   Esto decide si algún día puede existir un campo estructurado para BAP.
9. **Calificaciones y conducta.** ¿Son datos que puedan dar origen a discriminación y, por lo
   tanto, sensibles según el art. 2-VI? El borrador los trata como datos escolares no
   sensibles.
10. **Propuesta automática de calificaciones.** Con la confirmación obligatoria del maestro,
    ¿queda fuera del art. 26-II (tratamiento automatizado sin intervención humana)?
11. **Aviso único o separado.** ¿Un solo aviso para la tienda y Mi salón, o dos? ¿Hay que
    corregir ya la frase del aviso de la tienda sobre menores?
12. **Plazos de conservación.** ¿Hay alguna norma escolar que obligue o impida conservar
    calificaciones y asistencia fuera del sistema oficial por cierto tiempo? ¿Cuál es el plazo
    de bloqueo razonable?
13. **ARCO de familias.** ¿Qué documentos debe pedir Jissez para acreditar la patria potestad o
    la tutela? ¿Puede delegar la verificación en el maestro?
14. **Términos y condiciones de Mi salón.** ¿Qué cláusulas deben ir ahí? Por ejemplo, las
    obligaciones del maestro de la sección 3, la prohibición de datos sensibles, la
    responsabilidad por el mal uso y la indemnización.
15. **Registro ante la autoridad.** ¿Hay que registrar algo o notificar a la Secretaría
    Anticorrupción y Buen Gobierno? La Ley no lo exige para particulares, salvo los esquemas de
    autorregulación del art. 37.

---

## 6. Marcadores por llenar

| Marcador | Dónde aparece | Nota |
|---|---|---|
| `[NOMBRE O RAZÓN SOCIAL]` | Aviso §1, aviso simplificado | El mismo que falta en `tienda/privacidad.html` |
| `[DOMICILIO]` | Aviso §1 y pie, aviso simplificado | Domicilio para oír notificaciones |
| `[CORREO DE PRIVACIDAD]` | Aviso §1, §6, §7 y pie; textos de interfaz; texto para familias | La tienda usa hoy `soporte@jissez.com`. Conviene uno dedicado, como privacidad@jissez.com |
| `[NOMBRE DE LA PERSONA O ÁREA DE DATOS PERSONALES]` | Aviso §1 | Exigido por el art. 29 |
| `[URL DEL AVISO INTEGRAL]` | Aviso §5 y §12, aviso simplificado, texto para familias | Por ejemplo, jissez.com/privacidad-mi-salon |
| `[FECHA DE ÚLTIMA ACTUALIZACIÓN]` | Aviso, encabezado y pie | Fecha de publicación |
| `[PLAZO DE CONSERVACIÓN DE DATOS DE ALUMNOS]` | Aviso §9 | Propuesta: 2 ciclos después del cierre |
| `[PLAZO DE RESPALDOS]` | Aviso §9 | Según el plan de Supabase |
| `[PLAZO DE CONSERVACIÓN DE REGISTROS]` | Aviso §9 | Propuesta: 12 meses |
| `[RETENCIÓN DE ANTHROPIC — VERIFICAR PLAZO Y CONDICIONES VIGENTES]` | Aviso §8; texto 1.3 (`[VERIFICAR…]`) | Revisar los términos comerciales y la política de retención de la API vigentes |
