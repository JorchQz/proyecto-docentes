# Mi Salón a producción: pasos exactos (lanzamiento del 12 de octubre de 2026)

Preparado por el constructor AN el 2026-09-26 y ajustado por el constructor AO el mismo día (R27b:
orden de las Edge Functions, hora de poco uso, "si falla a medias", `lock_timeout`; b23: folio de
incidencias), sobre la rama `mi-salon-parte-b` ya integrada (registro histórico b20, acceso b21,
cobros b22, folio b23). Producción (`cluvaxxqvhtxxiwctpnl`, jissez.com) está en `b4c6958` y **no
tiene ninguna migración desde `jissez_interes_secciones`**. Todo lo de abajo se hace **solo con el
OK de Jorge**, en este orden. El proyecto de pruebas (`raoxdxwgsxbqlzdnndly`) ya quedó igual a lo
que irá a producción (mismas migraciones, mismo orden, mismo `delete_own_account`).

Resumen del orden:

1. Migraciones (en una transacción, a hora de poco uso) y el piloto de producción.
2. Secretos de las Edge Functions.
3. Despliegue de las Edge Functions (las que cobran primero; `comprar-mi-salon` al final).
4. Cron de los avisos.
5. Despliegue del frontend (push a `main`).
5b. Cargar PP-NIVELES en el grupo de Fanny (con b17 ya aplicada y después del push a `main`).
6. El 12 de octubre, con la confirmación de Jorge: encender el interruptor.

Por qué este orden: el frontend nuevo lee columnas y tablas de b20 a b23 (sin ellas, Hoy y Reportes
dicen "No se pudo cargar" e Incidencias no carga el folio); las Edge Functions nuevas llaman
funciones de b21 y b22; el cron llama a una Edge Function que ya debe existir. Mientras el
interruptor esté apagado, lo nuevo solo lo ven las cuentas con `activo_saas` o acceso `piloto`: el
público no nota nada.

---

## 0. Antes de empezar

- Hora de poco uso: las migraciones toman bloqueos breves en tablas de la tienda
  (`marketplace_ordenes`, funciones de cupones) y del SaaS. Correrlas de noche (por ejemplo, entre
  las 23:00 y las 6:00 del centro), sin ventas en curso. El script trae `lock_timeout = '5s'`: si una
  tabla está ocupada, falla y revierte todo en vez de hacer fila y trabar la tienda; se reintenta
  más tarde.
- Respaldo: confirmar en Supabase → Database → Backups que hay un respaldo de hoy (o PITR activo).
- Verificación de integridad de b19a en producción (solo lectura; todo debe dar 0). Está al final de
  `supabase/mi_salon_b19a_integridad_2026-09.sql`, comentada: copiarla y correrla en el editor SQL.
  Si algo no da 0, parar y revisar con Jorge antes de seguir.
- Plantillas de examen: no publicar ninguna (`examenes.estado` = 'publicado' con `maestro_id` null)
  antes de desplegar el frontend (paso 5). b18a aprieta la política de UPDATE de `examenes` y el
  frontend publicado (`b4c6958`) todavía "aplica" una plantilla con un UPDATE; hoy las 63 plantillas
  de producción están en 'borrador' y nadie ve ese botón.

## 1. Migraciones

En este orden exacto (cada una es aditiva e idempotente; b25, la última, define la versión final de
`delete_own_account`; b25 es de la Fase 3 del plan de Fanny y VA ANTES DE SU FRONTEND, ver más abajo):

| # | Archivo | Qué hace |
|---|---|---|
| 1 | `supabase/jissez_interes_secciones_2026-09.sql` | "Avísame" de las secciones por abrir |
| 2 | `supabase/mi_salon_b16_pda_campo_catalogo_2026-09.sql` | `v_avance_pda` con el campo del catálogo |
| 3 | `supabase/mi_salon_b17_flujo_libre_2026-09.sql` | actividades sueltas, "¿Para quién?", Incompleta |
| 4 | `supabase/mi_salon_b18_examenes_2026-09.sql` | exámenes de Mi Salón |
| 5 | `supabase/mi_salon_b18a_examenes_plantillas_2026-09.sql` | plantillas de examen: reemplaza UNA política (UPDATE de `examenes`, solo los propios) |
| 6 | `supabase/mi_salon_b19_examenes_cola_2026-09.sql` | exámenes en la cola sin señal |
| 7 | `supabase/mi_salon_b19a_integridad_2026-09.sql` | integridad (producto quitado, mismo grupo) |
| 8 | `supabase/mi_salon_b20_registro_historico_2026-09.sql` | Ponte al día, `es_historico`, calificación directa (ya confirmada en la boleta) |
| 9 | `supabase/mi_salon_b21_acceso_2026-09.sql` | periodos, accesos, T1 gratis a toda cuenta, interruptor (apagado), solo lectura en el servidor |
| 10 | `supabase/mi_salon_b22_cobros_2026-09.sql` | precios, fundador, cupones, órdenes y pagos, avisos, panel; parcha funciones de la tienda (abajo) |
| 11 | `supabase/mi_salon_b23_folio_incidencias_2026-09.sql` | folio RDI de incidencias (y a las que ya existen), directa con boleta cerrada, admin_ sin anon |
| 12 | `supabase/mi_salon_b25_jornada_comentario_2026-10.sql` | comentarios del día (`registro_diario.captura_nota`, con su marca), tabla `jornadas` ("Finalizar jornada"); `delete_own_account` FINAL |

Aparte, después de la 12:

| # | Archivo | Qué hace |
|---|---|---|
| 13 | `supabase/mi_salon_b21b_piloto_produccion_2026-09.sql` | acceso `piloto` todo el ciclo a soporte.jissez@gmail.com y a Fanny (sarayval034@gmail.com) |
| 14 | `supabase/mi_salon_b27_sesiones_varios_dias_2026-10.sql` | sesiones de varios días (Fase 5b): `sesiones.terminada_en`, `productos_sesion.fecha_trabajo`, tabla `sesion_dias`, triggers y respaldo; ver "Fase 5b" abajo (va después de b25 y antes de su frontend) |
| 15 | `supabase/mi_salon_b28_revoke_anon_2026-10.sql` | quita permisos de `anon` a las tablas de Mi Salón que no los usan (solo permisos; ver "b28" abajo; va después de b27 y es independiente del frontend) |

NO se aplican en producción: `mi_salon_b21c_piloto_pruebas_2026-09.sql` (cuentas QA, solo pruebas)
y `mi_salon_b22_avisos_cron_2026-09.sql` (va en el paso 4).

b24 (`mi_salon_b24_evidencia_incluidos_2026-09.sql`) se descartó por decisión de Jorge del 2026-09-27: el
alumno se evalúa siempre con los PDA de su grado (un trabajo por nivel que incluye alumnos de otro
grado se liga también a los PDA de ese grado; la evidencia la deja la regla de b5). Nunca se aplicó
en producción y ya no está en el repositorio (git conserva el historial); en pruebas se revirtió y
las dos funciones de evidencia quedaron iguales a las de producción.

Precisiones (verificadas contra el texto de cada archivo y con la cadena completa sobre una base
igual a producción, en una transacción revertida):

- Candado de solo lectura: **138 políticas en 46 tablas** (3 por tabla: `acceso_mi_salon_ins`,
  `_upd` y `_del`). Eran 132 en 44 hasta b22; b23 agrega `incidencias_folios` (135 en 45) y b25
  agrega `jornadas` (138 en 46).
- b18a solo reemplaza la política de UPDATE de `examenes` ("examenes reclamar/editar" → "examenes
  editar propios"); no toca filas ni columnas.
- Funciones que YA existen en producción y la cadena reemplaza (mismo resultado para lo que ya
  había): de la tienda, `marketplace_promocion_aplica` (b22: el ámbito nuevo 'mi_salon' nunca lleva
  la oferta), `admin_listar_ordenes` y `admin_estado_cuenta_cupon` (b22: el detalle de una orden de
  Mi Salón; las de la tienda salen idénticas); del SaaS, `marca_captura_calificaciones` (b20),
  `incrementar_uso_criterio` (b21) y `delete_own_account`. b23 quita EXECUTE a anon y PUBLIC de las
  funciones `admin_` (en producción lo tenían `admin_ajustar_lanzamiento`, `admin_estado_precios`,
  `admin_estado_promocion`, `admin_guardar_promocion`, `admin_confirmar_orden` y
  `admin_otorgar_acceso`); el panel entra con sesión y sigue igual.
- b23 asigna folio a las incidencias que ya existen, en orden de creación por grupo y ciclo. En la
  lectura del 2026-09-26 producción tenía **1** incidencia (de la cuenta de soporte, 2 alumnos,
  ciclo 2026-2027): quedará `RDI-2026-2027-0001`.

Cómo aplicarlas (una sola transacción con `lock_timeout` de 5 s: si una falla, no queda nada a
medias). El script versionado es `scripts/aplicar-migraciones-prod.js` (copia del de `.qa/`, que no
está en git); toma `PROD_DB_URL` de la variable de entorno o de `.env.local` y el paquete `pg` de
`.qa/node_modules` (o de un `npm install pg`).

**Estado real (2026-09-27, 03:45 del centro):** las once (de `interes_secciones` a b23) YA están
aplicadas en producción, en una transacción, con la comprobación final correcta. **b21b también ya está
aplicada** (2026-09-27 por la mañana: Fanny y soporte con acceso `piloto` T1-T3 hasta el 2027-07-30,
`piloto = 2` verificado). NO volver a correr la cadena de abajo; este comando de b21b queda solo como
registro (es idempotente):

```
node scripts/aplicar-migraciones-prod.js supabase/mi_salon_b21b_piloto_produccion_2026-09.sql
```

La comprobación final da `piloto = 2`.

**Fase 3 (2026-09-29): falta b25**, la migración de los comentarios del día y "Finalizar jornada". Va
**ANTES del frontend de la Fase 3** (el Hoy nuevo lee `registro_diario.captura_nota` y escribe en
`jornadas`), pero después de b23 (que ya está en producción). Es aditiva e idempotente (una columna
nula, una tabla nueva con su RLS y su candado, la función de marcas ampliada y `delete_own_account`
final) y el frontend anterior sigue funcionando igual con ella. Solo con el OK de Jorge, a hora de
poco uso:

```
node scripts/aplicar-migraciones-prod.js supabase/mi_salon_b25_jornada_comentario_2026-10.sql
```

Comprobación de b25 (editor SQL de producción, solo lectura; todo lo de la derecha debe coincidir):

```sql
select
  (select count(*) from information_schema.columns where table_schema = 'public'
     and table_name = 'registro_diario' and column_name = 'captura_nota')         as columna,          -- 1
  to_regclass('public.jornadas') is not null                                       as tabla,            -- true
  (select count(*) from pg_policies where policyname like 'acceso_mi_salon%')     as candados,         -- 138
  (select count(distinct tablename) from pg_policies where policyname like 'acceso_mi_salon%') as tablas_candado, -- 46
  (select count(*) from pg_policies where tablename = 'jornadas')                  as politicas,        -- 7 (4 propias + 3 del candado)
  position('captura_nota' in pg_get_functiondef('public.marca_captura_registro_diario'::regproc)) > 0 as marca_nota, -- true
  position('jornadas' in pg_get_functiondef('public.delete_own_account'::regproc)) > 0
    and position('incidencias_folios' in pg_get_functiondef('public.delete_own_account'::regproc)) > 0 as borrar_final; -- true
```

Si el frontend de la Fase 3 llegara antes que b25 (no debe): Hoy sigue funcionando, con un 400 en la
consola por carga (`registro_diario.captura_nota` no existe): la bandeja detecta que faltan las columnas
de marca y compara por contenido (la regla de antes de b12, para todo Hoy); los comentarios se guardan;
"Finalizar jornada" avisa "No se pudo registrar la jornada" y NO marca el día; Inicio no muestra la fila
Jornada. Se arregla aplicando b25 y recargando.

Después del push a `main` del frontend de la Fase 3: **pedir que se recargue la app en todos los aparatos**
(Fanny: la tableta, el celular y cualquier pestaña abierta; basta cerrar y volver a abrir la app o recargar la
página). Una pantalla de Asistencia de antes que siga abierta, al marcar Falta, borraría la fila del cierre de ese
alumno aunque ya tenga un comentario del día; la versión nueva le quita solo el 1 y 1 y deja el comentario.

Para una base sin ninguna de las migraciones, la cadena completa es:

```
node scripts/aplicar-migraciones-prod.js supabase/jissez_interes_secciones_2026-09.sql supabase/mi_salon_b16_pda_campo_catalogo_2026-09.sql supabase/mi_salon_b17_flujo_libre_2026-09.sql supabase/mi_salon_b18_examenes_2026-09.sql supabase/mi_salon_b18a_examenes_plantillas_2026-09.sql supabase/mi_salon_b19_examenes_cola_2026-09.sql supabase/mi_salon_b19a_integridad_2026-09.sql supabase/mi_salon_b20_registro_historico_2026-09.sql supabase/mi_salon_b21_acceso_2026-09.sql supabase/mi_salon_b22_cobros_2026-09.sql supabase/mi_salon_b23_folio_incidencias_2026-09.sql supabase/mi_salon_b25_jornada_comentario_2026-10.sql
node scripts/aplicar-migraciones-prod.js supabase/mi_salon_b21b_piloto_produccion_2026-09.sql
```

Si no se puede usar el script: pegarlas una por una, en ese orden, en el editor SQL de producción,
empezando cada una con `begin; set local lock_timeout = '5s';` y terminando con `commit;` (el editor
corre cada pegada como un bloque). La consulta final de b21b debe devolver dos filas, origen
`piloto`, vence `2027-07-30`.

Comprobación final (editor SQL de producción, solo lectura):

```sql
select
  (select mi_salon_abierto from public.jissez_config)                                   as abierto,          -- false
  (select count(*) from public.mi_salon_periodos where ciclo = '2026-2027')             as periodos,         -- 3
  (select count(*) from public.mi_salon_precios where ciclo = '2026-2027')              as precios,          -- 3
  (select count(*) from public.mi_salon_avisos)                                         as avisos,           -- 10
  (select count(*) from auth.users u where not exists (
     select 1 from public.mi_salon_accesos a where a.docente_id = u.id))                as sin_acceso,       -- 0 (hasta el 18-dic)
  (select count(*) from public.mi_salon_accesos where origen = 'piloto')                as piloto,           -- 2
  (select count(*) from pg_policies where policyname like 'acceso_mi_salon%')           as candados,         -- 138
  (select count(distinct tablename) from pg_policies where policyname like 'acceso_mi_salon%') as tablas_candado, -- 46
  (select count(*) from public.incidencias where folio is null)                         as sin_folio,        -- 0
  (select count(*) from public.incidencias i where not exists (
     select 1 from public.incidencias_folios f where f.grupo_id = i.grupo_id))          as sin_contador,     -- 0
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'admin\_%'
     and has_function_privilege('anon', oid, 'execute'))                                as admin_anon,       -- 0
  position('m.aprobado_en is not null' in pg_get_functiondef('public.mi_salon_aplicar_pago(uuid,jsonb)'::regprocedure)) > 0 as pago_reparable, -- true
  position('incidencias_folios' in pg_get_functiondef('public.delete_own_account'::regproc)) > 0
    and position('mi_salon_ordenes' in pg_get_functiondef('public.delete_own_account'::regproc)) > 0
    and position('jornadas' in pg_get_functiondef('public.delete_own_account'::regproc)) > 0 as borrar_final; -- true
```

## Aparte: b26, los archivos de Crear proyecto solo para su cuenta

`supabase/mi_salon_b26_recursos_storage_2026-10.sql` (constructor AX, 2026-09-29). Arreglo de
seguridad del bucket privado `recursos`: sus tres políticas (`recursos_select_autenticado`,
`recursos_upload_autenticado`, `recursos_delete_autenticado`, para `{public}` con
`auth.role() = 'authenticated'`) dejaban a CUALQUIER cuenta con sesión listar, descargar, subir y
borrar los archivos de cualquier docente. b26 las quita y deja SELECT y DELETE solo para la cuenta
que subió el archivo (`(storage.foldername(name))[2] = auth.uid()::text`). No crea política de
INSERT: Mi Salón solo guarda enlaces (decisión de Jorge del 2026-09-29), así que subir falla para
todos. No toca objetos, ni el bucket, ni `assets`. Es idempotente, no depende de ninguna otra
migración ni redefine `delete_own_account`: va sola, en su propia transacción, cuando Jorge dé el OK.

- Cuándo: a hora de poco uso (crear y quitar políticas bloquea `storage.objects` un instante; la
  tienda lee ahí sus vistas previas y el `lock_timeout` de 5 s la protege). Lo ideal es junto con el
  push a `main` del frontend que ya no sube archivos (el mismo commit del constructor AX) o después.
  Si va antes, el "subir archivo" viejo de Crear proyecto muestra "No se pudo subir ... Puedes
  continuar sin ese archivo" y el proyecto se guarda igual; nada más cambia.
- Probada en pruebas (dos veces, idempotente) con QA1 y QA2: cada cuenta lista, descarga, firma y
  borra solo lo suyo; la otra recibe 0 filas u "Object not found"; subir y sobrescribir fallan para
  las dos; las URL firmadas creadas antes siguen sirviendo; "Archivos que subiste antes" en Crear
  proyecto se ve y se quita (evidencia en `.qa/constructor-ax/b26-*.txt`).

```
node scripts/aplicar-migraciones-prod.js supabase/mi_salon_b26_recursos_storage_2026-10.sql
```

Comprobación (editor SQL de producción, solo lectura):

```sql
select policyname, roles, cmd from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and (qual like '%recursos%' or with_check like '%recursos%') order by cmd;
-- Dos filas: "recursos: borrado de la propia cuenta" {authenticated} DELETE
--            "recursos: lectura de la propia cuenta" {authenticated} SELECT
select count(*) from storage.objects where bucket_id = 'recursos';   -- igual que antes (4 el 2026-09-29)
```

Si falla: el script revierte todo y las políticas viejas se quedan; se reintenta a otra hora.

## Aparte: b27, las sesiones de varios días (Fase 5b)

**Falta b27** (Fase 5b del plan de Fanny, 2026-10-02), la migración de las sesiones de varios días
(`supabase/mi_salon_b27_sesiones_varios_dias_2026-10.sql`). Va **DESPUÉS de b25 y ANTES del frontend de la
Fase 5b** (el Hoy, Inicio, Proyecto y motor nuevos leen `sesiones.terminada_en`, `productos_sesion.fecha_trabajo` y
`sesion_dias`). Es aditiva e idempotente y el frontend anterior sigue igual con ella (no lee ninguna columna nueva;
los triggers solo llenan datos nuevos). **Antes de aplicarla, medir su impacto** con la consulta de solo lectura
`scripts/medir-b27.sql` (editor SQL de producción): por grupo, cuántas sesiones en curso, cuántas actividades activas
tienen un campo distinto del de su sesión (la única diferencia aceptada en la calificación) y cuántas filas llenaría
su respaldo. Solo con el OK de Jorge, a hora de poco uso:

```
node scripts/aplicar-migraciones-prod.js supabase/mi_salon_b27_sesiones_varios_dias_2026-10.sql
```

Qué hace, en una transacción: dos columnas nulas (`sesiones.terminada_en`, `productos_sesion.fecha_trabajo`), la
tabla `sesion_dias` (RLS por `maestro_id`, `ref_propia_sesion` y candado de solo lectura), la función
`sesion_terminada(sesiones)` (completada o con fecha anterior al corte 2026-09-30), tres triggers
(`sesiones_dias_trabajo` sobre `sesiones.fecha`; `marca_historico_productos`, la de b20 más el día de la actividad;
`calificaciones_dia_actividad`), `mover_producto_a_sesion` (la de b19a más una línea) y el respaldo: a las actividades de
las sueltas y de las sesiones terminadas les pone el día de su sesión, a las de las sesiones en curso con captura el
primer día de captura (las demás quedan "por trabajar") y crea un `sesion_dias` por cada sesión de proyecto con fecha
(cerrado si está terminada; abierto si sigue en curso: Hoy preguntará qué se trabajó ese día). Correrla dos veces no
cambia nada.

Comprobación de b27 (editor SQL de producción, solo lectura; todo lo de la derecha debe coincidir):

```sql
select
  (select count(*) from information_schema.columns where table_schema = 'public'
     and ((table_name = 'sesiones' and column_name = 'terminada_en')
       or (table_name = 'productos_sesion' and column_name = 'fecha_trabajo')))   as columnas,        -- 2
  to_regclass('public.sesion_dias') is not null                                    as tabla,           -- true
  (select count(*) from pg_policies where tablename = 'sesion_dias')               as politicas,       -- 7 (4 propias + 3 del candado)
  (select count(distinct tablename) from pg_policies where policyname like 'acceso_mi_salon%') as tablas_candado, -- 47 (46 de b25 + sesion_dias)
  (select count(*) from pg_trigger where tgname in ('sesiones_dias_trabajo', 'calificaciones_dia_actividad') and not tgisinternal) as triggers, -- 2
  position('fecha_trabajo' in pg_get_functiondef('public.marca_historico_productos'::regproc)) > 0 as historico_con_dia, -- true
  position('fecha_trabajo' in pg_get_functiondef('public.mover_producto_a_sesion'::regproc)) > 0   as mover_con_dia,     -- true
  -- el respaldo no deja actividades de sesiones terminadas sin día (salvo tareas y las quitadas): debe dar 0
  (select count(*) from public.productos_sesion ps join public.sesiones s on s.id = ps.sesion_id
     join public.proyectos p on p.id = s.proyecto_id
   where p.tipo = 'proyecto' and public.sesion_terminada(s) and ps.activo and ps.tipo <> 'tarea'
     and ps.fecha_trabajo is null and s.fecha is not null)                         as sin_respaldo;    -- 0
```

Reversa de b27 (a mano, solo si hiciera falta; el frontend de la Fase 5b dejaría de funcionar y el anterior no se
entera; no borra datos de calificación):

```sql
drop trigger if exists calificaciones_dia_actividad on public.calificaciones;
drop trigger if exists sesiones_dias_trabajo on public.sesiones;
drop function if exists public.calificaciones_dia_actividad();
drop function if exists public.sesiones_dias_trabajo();
-- marca_historico_productos: volver a la de supabase/mi_salon_b20_registro_historico_2026-09.sql (create or replace)
-- mover_producto_a_sesion: volver a la de supabase/mi_salon_b19a_integridad_2026-09.sql (create or replace)
drop table if exists public.sesion_dias;
drop function if exists public.sesion_terminada(public.sesiones);
alter table public.productos_sesion drop column if exists fecha_trabajo;
alter table public.sesiones drop column if exists terminada_en;
```

(`scripts/aplicar-migraciones-prod.js` no lleva una cadena fija: recibe los archivos como argumentos, así que b27 solo
se agrega a las listas de esta guía. Va aparte de la cadena de `delete_own_account`: no la redefine.)

## Aparte: b28, quitar permisos de anon (hallazgo de BB)

**Falta b28** (`supabase/mi_salon_b28_revoke_anon_2026-10.sql`). Solo quita permisos (`revoke`): no toca datos, políticas ni
funciones, es idempotente y el frontend no cambia (ninguna de estas tablas se lee sin sesión). RLS ya impedía el acceso
real de anon; esto quita además el permiso por omisión del esquema. Con el OK de Jorge:

```
node scripts/aplicar-migraciones-prod.js supabase/mi_salon_b28_revoke_anon_2026-10.sql
```

Qué quita a `anon`: todo en `jornadas`, `mi_salon_avisos`, `mi_salon_accesos`, `mi_salon_correos` y `mi_salon_ordenes`; y todo lo que
no sea SELECT en `mi_salon_periodos`, `mi_salon_precios` y `jissez_config` (esas tres las lee la tienda pública sin sesión y
se quedan con SELECT). No toca `marketplace_*`, catálogos ni vistas `v_*` (aparte: siguen con permisos de anon por omisión;
quien lo decida debe revisar primero qué usa la tienda sin sesión).

Comprobación (editor SQL de producción, solo lectura; la columna `anon` debe dar lo de la derecha):

```sql
select t, has_table_privilege('anon', 'public.' || t, 'select') as anon_select, has_table_privilege('anon', 'public.' || t, 'insert') as anon_insert
from unnest(array['jornadas','mi_salon_avisos','mi_salon_accesos','mi_salon_correos','mi_salon_ordenes',
                  'mi_salon_periodos','mi_salon_precios','jissez_config']) t order by t;
-- anon_insert: false en las 8. anon_select: false en las 5 primeras; true en mi_salon_periodos, mi_salon_precios y jissez_config.
```

Y sin sesión: `tienda/index.html`, el catálogo y `tienda/conoce-mi-salon.html` (precios y "Quedan N lugares") cargan igual.

Reversa (los grant exactos que había; en producción confirmar antes con `information_schema.role_table_grants` que eran los mismos):

```sql
grant delete, insert, references, select, trigger, truncate, update on public.jornadas to anon;
grant delete, insert, references, select, trigger, truncate, update on public.mi_salon_avisos to anon;
grant references, select, trigger, truncate on public.mi_salon_accesos to anon;
grant references, select, trigger, truncate on public.mi_salon_correos to anon;
grant references, select, trigger, truncate on public.mi_salon_ordenes to anon;
grant delete, insert, update, truncate, references, trigger on public.mi_salon_periodos to anon;
grant delete, insert, update, truncate, references, trigger on public.mi_salon_precios to anon;
grant truncate, references, trigger on public.jissez_config to anon;
```

## 2. Secretos de las Edge Functions

Supabase → Edge Functions → Secrets (o `supabase secrets list --project-ref cluvaxxqvhtxxiwctpnl`).
Los de la tienda ya existen; confirmar que estén todos:

| Secreto | Lo usan | Nota |
|---|---|---|
| `MP_ACCESS_TOKEN` | comprar-mi-salon, webhook-mercadopago, confirmar-pago | el de la tienda |
| `MP_WEBHOOK_SECRET` | webhook-mercadopago | el de la tienda |
| `SITE_URL` | comprar-mi-salon, avisos-mi-salon, bienvenida-mi-salon, pagos | `https://jissez.com` |
| `RESEND_API_KEY` | correos (bienvenida, avisos, confirmación de pago) | el de la tienda |
| `MAIL_FROM` | correos | el de la tienda |
| `CRON_SECRET` | avisos-mi-salon (y avisos-pedidos) | el mismo que ya usa avisos-pedidos |
| `ANTHROPIC_API_KEY` | redactar-boleta (textos con IA) | **falta**; debe estar antes del 13 de noviembre |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` los pone Supabase solo.

## 3. Despliegue de las Edge Functions

Desde la raíz del repo, con la rama integrada (`supabase/config.toml` ya trae `verify_jwt = false`
para las tres nuevas: validan la sesión o el `CRON_SECRET` por dentro). **En este orden**: primero
las que procesan pagos (así, cuando exista la primera orden de Mi Salón, el webhook ya sabe
encaminarla) y al final `comprar-mi-salon`, la única que crea órdenes de Mi Salón:

```
supabase functions deploy webhook-mercadopago --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy confirmar-pago      --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy avisos-pedidos      --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy completar-pedido    --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy redactar-boleta     --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy bienvenida-mi-salon --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy avisos-mi-salon     --project-ref cluvaxxqvhtxxiwctpnl
supabase functions deploy comprar-mi-salon    --project-ref cluvaxxqvhtxxiwctpnl
```

- Nuevas: `bienvenida-mi-salon` (b21), `comprar-mi-salon` y `avisos-mi-salon` (b22).
- Otra vez: `redactar-boleta` (exige acceso vigente, b21) y las que importan `_shared/pagos.ts`, que
  cambió (una orden de Mi Salón va por `_shared/mi-salon-pagos.ts`; si no se puede saber si una
  orden es de Mi Salón por una falla pasajera, la orden queda pendiente y se repara sola con
  confirmar-pago o el siguiente aviso de Mercado Pago; una orden de la tienda sin renglones ya no
  se marca pagada; las demás órdenes de la tienda siguen igual): `webhook-mercadopago`,
  `confirmar-pago`, `avisos-pedidos` y `completar-pedido`.
- La URL del webhook de Mercado Pago no cambia.
- Comprobación: Supabase → Edge Functions muestra las ocho con la versión de hoy; en los registros
  de `webhook-mercadopago`, la siguiente venta de la tienda se procesa como siempre.

## Si falla a medias

Cada paso deja producción en un estado que funciona; así se sale de cada uno:

- **Falla una migración (paso 1).** El script revierte TODO (una transacción): producción queda
  como estaba, sin ninguna migración nueva. Leer el error: si es `lock_timeout` (tabla ocupada),
  reintentar más tarde a otra hora de poco uso; si es otra cosa, parar y revisarlo en pruebas antes
  de volver a intentar. No aplicar las migraciones por separado para "avanzar lo que sí pasa".
- **Falla b21b (piloto).** No afecta lo demás (las migraciones ya quedaron). Es idempotente: se
  corrige y se vuelve a correr.
- **Falla el despliegue de una Edge Function (paso 3).** Las ya desplegadas funcionan con la base
  migrada; la que falló sigue en su versión anterior. Las cuatro de la tienda (webhook,
  confirmar-pago, avisos-pedidos, completar-pedido) son compatibles con la base nueva también en su
  versión anterior (las órdenes de la tienda no cambian). Reintentar la que falló antes de seguir y,
  sobre todo, **no desplegar `comprar-mi-salon` mientras `webhook-mercadopago` y `confirmar-pago`
  no estén en la versión nueva** (una orden de Mi Salón con el webhook viejo quedaría pagada sin
  acceso). Si ya se desplegó por error, borrarla desde el panel de Edge Functions hasta tener el
  webhook nuevo: con el interruptor apagado nadie del público llega a la compra.
- **Falla el cron (paso 4).** No envía nada con el interruptor apagado; se corrige antes del 12 de
  octubre.
- **Falla el push o el despliegue del frontend (paso 5).** jissez.com sigue con `b4c6958`, que
  funciona con la base migrada (las migraciones son aditivas; con el interruptor apagado el público
  no nota nada). Si el sitio nuevo sale con un error, `git revert` del merge y push a `main`
  (vuelve a `b4c6958`); la base se queda migrada, no hay que deshacerla.
- **Algo sale mal después de encender el interruptor (paso 6).** Apagarlo (botón del panel o el
  `update` del paso 6). Apagar no quita accesos ni datos.
- **Pago de Mi Salón que quedó 'pagado' sin acceso** (el defecto de R27b, antes de este arreglo):
  con b22 corregida, `confirmar-pago` o el siguiente aviso del webhook lo aplican solos. Para
  revisarlos: `select o.id, o.estado, m.aprobado_en from marketplace_ordenes o join mi_salon_ordenes m
  on m.orden_id = o.id where o.estado = 'pagado' and m.aprobado_en is null;` (debe dar 0 filas).
- **No se toca a mano**: nunca borrar filas de `mi_salon_accesos`, `incidencias_folios` ni
  `marketplace_ordenes` para "limpiar" un intento fallido; todo lo de arriba es idempotente.

## 4. Cron de los avisos

1. Confirmar que Vault tiene el secreto `cron_secret` (lo creó `marketplace_avisos_cron.sql` para
   avisos-pedidos): `select name from vault.secrets where name = 'cron_secret';`. Si no está:
   `select vault.create_secret('<el valor de CRON_SECRET>', 'cron_secret');`
2. Correr `supabase/mi_salon_b22_avisos_cron_2026-09.sql` en el editor SQL de producción (programa
   `avisos-mi-salon-hora`, cada hora al minuto 5).
3. Comprobar: `select jobname, schedule from cron.job where jobname = 'avisos-mi-salon-hora';`

Con el interruptor apagado la función no manda nada (solo envía con Mi Salón abierto, entre las
8:00 y las 21:00 del centro, una vez por cuenta y aviso).

## 5. Despliegue del frontend

Jorge decide fusionar a `main`. El push a `main` publica jissez.com solo (Worker de Cloudflare
"jissez"):

```
git checkout main
git merge --no-ff mi-salon-parte-b
for t in pruebas/*.test.js; do node $t | tail -1; done    # todas deben pasar
git push origin main
```

Después del despliegue (con el interruptor apagado):
- Una compra de la tienda de prueba sigue igual (catálogo, checkout, Mis compras).
- Con la cuenta de soporte (piloto): Inicio, Hoy, Ponte al día, Reportes y la compra
  (`/tienda/mi-salon-compra`) abren sin errores; el panel → Mi Salón muestra el interruptor apagado.
- Una cuenta sin `activo_saas` ni piloto sigue viendo solo la tienda.
- `tienda/conoce-mi-salon` sigue oculta: sin enlaces en la tienda y con `noindex`.

## 5b. Cargar PP-NIVELES en el grupo de Fanny

Va **después** del paso 1 (las migraciones: necesita b17, ya aplicada el 2026-09-27 con las once) y
del paso 5 (el push a `main`): el script usa el código de la rama publicada (importador,
materializador y "¿Para quién?"). Solo con el OK de Jorge. Se corre desde la raíz del repo, en la
computadora que tiene el plan `docs/referencia/pp-niveles-plan.json` (trae nombres de alumnos: está fuera de git) y `PROD_DB_URL` en
`.env.local` (o en la variable de entorno; nunca se imprime). Todo va en una transacción como la
docente (RLS y candado de solo lectura); si la comprobación final no cuadra, no escribe nada.

```
node scripts/cargar-pp-niveles.js --base prod --grupo 34fc6a07-ec93-449f-8c73-e651bbeec0d8 --simular
node scripts/cargar-pp-niveles.js --base prod --grupo 34fc6a07-ec93-449f-8c73-e651bbeec0d8 --aplicar
```

- `--simular` no escribe nada (transacción de solo lectura). Debe terminar con "Comprobación: OK" y
  "Simulación: no se escribió nada." (código 0). Antes de las migraciones se detiene con código 3
  ("La base aún no tiene «¿Para quién?» (migración b17)").
- Antes de escribir, el script revisa que cada alumno reciba en cada sesión un trabajo ligado a un PDA
  de SU grado (el alumno se evalúa siempre con los PDA de su grado: en PP-NIVELES, Morado y
  Triángulos van ligados a los de 1° y de 2°, y el alumno de 2° deja su evidencia en los de 2°); si
  no, se detiene sin escribir (código 1). Al final lo comprueba otra vez con lo escrito.
- `--aplicar` solo después de una simulación limpia. Termina con "COMMIT: cargado." Si el proyecto
  ya está en el grupo, no hace nada (código 2): no se carga dos veces.
- Comprobar con la cuenta de soporte o la de Fanny: Inicio muestra la sesión 1 como siguiente, Hoy
  ofrece "Trabajar hoy" y cada trabajo sale para sus alumnos (tabla en
  `docs/referencia/pp-niveles-asignacion.md`).

## 6. El 12 de octubre: encender el interruptor (con la confirmación de Jorge)

1. Panel de administración → Mi Salón → "Abrir Mi Salón" (o, en el editor SQL:
   `update public.jissez_config set mi_salon_abierto = true, mi_salon_abierto_desde = coalesce(mi_salon_abierto_desde, now()), actualizado_en = now() where id;`).
   Desde ese momento toda cuenta ve Mi Salón (con el T1 gratis hasta el 18 de diciembre), la tienda
   enlaza la presentación, las cuentas nuevas reciben la bienvenida y la presentación muestra los
   precios de la tabla con "Quedan N lugares".
2. Indexar la presentación (no se enciende con lógica): en un commit aparte, quitar
   `<meta name="robots" content="noindex, nofollow">` de `tienda/conoce-mi-salon.html` y las reglas
   `/tienda/conoce-mi-salon` y `/tienda/conoce-mi-salon.html` de `_headers`; ajustar
   `pruebas/presentaciones.test.js` §1 a "indexada"; push a `main`. La Sala sigue oculta.
3. Aviso de lanzamiento a las cuentas que ya existían: panel → Mi Salón → "Aviso de lanzamiento" → "Enviar aviso
   de lanzamiento" (una vez por cuenta; no a piloto ni a cuentas nuevas, que reciben la bienvenida).
4. Comprobar: una cuenta nueva de prueba ve la bienvenida y "Ponte al día"; el panel cuenta
   "nuevas desde el lanzamiento".

Para apagarlo (si algo sale mal): el mismo botón, o `update public.jissez_config set mi_salon_abierto = false where id;`.
Apagar no quita accesos ni datos.

## Después del lanzamiento (fechas de la spec)

- Antes del 13 de noviembre: `ANTHROPIC_API_KEY` (textos de la boleta con IA).
- Los avisos del 6 y 13 de noviembre, del 30 de noviembre y de diciembre salen solos (cron y tabla
  `mi_salon_avisos`); el panel → Mi Salón → Cobros los muestra por segmento para WhatsApp.
- Antes del 30 de noviembre: revisar precios y cupo fundador en el panel (ya cargados: $199/$299,
  $399/$549, cupo 100).
