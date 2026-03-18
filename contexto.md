CONTEXTO DEL PROYECTO: SaaS EDUCATIVO "NEM" (Nueva Escuela Mexicana)
1. Visión General del Proyecto
Vamos a desarrollar una Web App (SaaS) diseñada específicamente para maestros de educación básica en México que trabajan bajo el modelo de la Nueva Escuela Mexicana (NEM). El objetivo es eliminar la carga administrativa de los maestros automatizando el registro diario, el cálculo de promedios y la generación de reportes oficiales.

El MVP (Producto Mínimo Viable) está enfocado en una maestra rural de escuela bidocente con un grupo multigrado (4º, 5º y 6º de primaria), pero la arquitectura debe ser escalable (Multi-tenant) para que cualquier maestro del país pueda registrarse, crear sus grupos y gestionar sus calificaciones de forma segura y privada.

2. Stack Tecnológico
Frontend: HTML5, CSS3 (recomendado Tailwind CSS para rapidez y diseño responsivo) y Vanilla JavaScript (o el framework ligero que decida el agente, ej. Vue/React).

Backend, Base de Datos y Autenticación: Supabase (PostgreSQL).

Control de Versiones y Despliegue: GitHub conectado a Cloudflare Pages para CI/CD automático.

Entorno Local: Visual Studio Code (Live Server).

3. Lógica de Negocio y Sistema Educativo (Reglas Clave)
El sistema ya no evalúa por materias tradicionales (Matemáticas, Español), sino por el modelo NEM:

Campos Formativos (Son 4 fijos): * Lenguajes

Saberes y Pensamiento Científico

Ética, Naturaleza y Sociedades

De lo Humano y lo Comunitario

Estructura de Trabajo: Se evalúa por Trimestres (1, 2 y 3). Dentro de cada trimestre, el maestro crea Proyectos (Ej. "Cuidemos el agua"), y cada proyecto ataca uno o varios Campos Formativos.

Evaluación Diaria: * Se utilizan exclusivamente números (del 5 al 10) para las calificaciones.

Rubros a calificar diariamente: Asistencia, Tareas de la clase anterior, Actividades de los proyectos del día.

Regla especial: La Participación y la Conducta se evalúan de forma GLOBAL por día, NO por campo formativo (para ahorrar tiempo).

Hardware de Destino: El usuario principal usará una Tablet Samsung Galaxy Tab S9 FE+ (12.4 pulgadas) con teclado y formato apaisado (landscape). La UI debe ser táctil, con botones grandes y responsiva.

4. Estructura de la Base de Datos (Supabase PostgreSQL)
El sistema utiliza Row Level Security (RLS) basado en el user_id de Supabase Auth para garantizar la privacidad (Multi-tenant).
Aquí tu me vas a ayudar a crear la base de datos, tengo el porject creado pero está totalmente vacío, me gusta usar sql editor así solo presion run y listo ya queda como tu lo necesitas

5. Módulos y Flujo del MVP a Programar
El agente de IA debe enfocarse en construir las siguientes vistas y funciones:

Auth & Onboarding: Login/Registro con Supabase. Pantalla inicial para dar de alta el Grupo y cargar la lista de Alumnos.

Módulo de Planeación: Interfaz donde el maestro da de alta los "Proyectos" del trimestre, definiendo fechas y a qué Campo Formativo pertenecen.

Dashboard Diario (El Asistente): * Flujo optimizado para el día a día: 1) Pase de Asistencia rápido. 2) Check de Tareas del día anterior. 3) Ingreso de calificaciones para la Actividad del día. 4) Asignación de Participación/Conducta global del día.

Generador de Reportes (Data Export):

Vista Recrea: Una tabla que calcula el promedio exacto del trimestre por alumno, redondeado a números enteros (5-10), desglosado por Campo Formativo, listo para exportar a .CSV o copiar y pegar en la plataforma del estado.

Concentrado Director: Agrupa automáticamente a los alumnos en niveles: Bajo (5-6), Medio (7-8) y Alto (9-10).

Boleta Padres: Generación de un ticket/documento en formato PDF (usando librerías JS como html2pdf) con el resumen del alumno.

6. Instrucciones para la IA (GitHub Copilot / Agente)
Modularidad: Divide el código HTML, CSS y JS en archivos modulares.

Integración Supabase: Utiliza el CDN oficial de Supabase JS (@supabase/supabase-js) para el Frontend.

UX/UI: Prioriza la velocidad de captura. Evita que el usuario tenga que usar el teclado en pantalla lo más posible; usa botones de un solo toque (Ej. [Asistió], [Faltó], [10], [9], [8]).

Escribe el código paso a paso. Comienza pidiendo confirmación de la estructura de carpetas y luego procede con la inicialización de Supabase y la pantalla de Login.