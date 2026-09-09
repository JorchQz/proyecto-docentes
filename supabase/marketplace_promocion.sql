-- =============================================================================
-- Promocion por tiempo limitado (septiembre 2026) -- capa sobre el tarifario
-- =============================================================================
--
-- El precio de LISTA no se toca. Vive donde siempre: marketplace_precios y las
-- columnas precio_pdf / precio_editable de marketplace_productos, que
-- marketplace_aplicar_precios() reescribe despues de cada venta y cada
-- reembolso. Un descuento guardado ahi se perderia en la siguiente compra.
--
-- La promocion es una CAPA que se aplica al pintar y al cobrar:
--
--   * marketplace_promocion            : fila unica con el interruptor y la
--                                        vigencia.
--   * marketplace_promocion_vigente()  : lo que ve el publico (RPC, evaluada
--     contra now()). Al pasar vigente_hasta devuelve activa=false sola: no hay
--     cron, no hay nada que apagar, no hay nada que revertir.
--   * marketplace_precio_final()       : el importe que se cobra.
--     crear-preferencia-mp la consulta con el precio de lista y graba lo que
--     devuelva. La regla de redondeo existe UNA vez, aqui.
--
-- Redondeo: 20% exacto, hacia ABAJO a peso entero.
--   249->199  298->238  499->399  598->478  299->239  348->278
--   599->479  698->558  449->359  498->398  899->719  998->798
--
-- No redefine ninguna funcion existente (marketplace_aplicar_precios,
-- marketplace_precio_unitaria, admin_estado_precios): manda la BD, y los .sql
-- del repo son historia de migraciones.
--
-- Idempotente: se puede volver a ejecutar sin romper nada.
-- =============================================================================

-- ── 1. Estado de la promocion (fila unica) ──────────────────────────────────
create table if not exists marketplace_promocion (
  id boolean primary key default true check (id),
  -- Interruptor de mano. Apaga la promo al instante, sin esperar a la fecha.
  activa boolean not null default false,
  porcentaje smallint not null default 20 check (porcentaje between 1 and 90),
  -- NULL = ya empezo / no caduca. La fecha limite es lo que la apaga sola.
  vigente_desde timestamptz,
  vigente_hasta timestamptz,
  etiqueta text not null default 'por tiempo limitado',
  actualizado_en timestamptz not null default now()
);

insert into marketplace_promocion (id) values (true)
on conflict (id) do nothing;

comment on table marketplace_promocion is
  'Promocion temporal (fila unica). El precio de lista no se toca: se aplica al pintar y al cobrar. Al pasar vigente_hasta se apaga sola.';

-- ── 2. La regla de redondeo, en un solo sitio ───────────────────────────────
-- Aritmetica sobre numeric: exacta, sin binario flotante de por medio.
-- El espejo en el navegador esta en tienda/js/tienda-common.js (precioFinal).
create or replace function marketplace_redondeo_promo(
  p_precio numeric,
  p_porcentaje smallint
)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case when p_precio is null then null
              else floor(p_precio * (100 - p_porcentaje) / 100)
         end;
$$;

-- ── 3. Promocion vigente (lectura publica) ──────────────────────────────────
-- Mismo patron que marketplace_precio_unitaria(): la tabla tiene RLS solo-admin
-- y el publico solo ve esta evaluacion puntual, ya resuelta contra now().
create or replace function marketplace_promocion_vigente()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case
       when p.activa
        and now() >= coalesce(p.vigente_desde, '-infinity'::timestamptz)
        and now() <  coalesce(p.vigente_hasta,  'infinity'::timestamptz)
       then jsonb_build_object(
              'activa', true,
              'porcentaje', p.porcentaje,
              'etiqueta', p.etiqueta,
              'vigente_hasta', p.vigente_hasta)
       else jsonb_build_object('activa', false)
     end
     from marketplace_promocion p where p.id),
    jsonb_build_object('activa', false)
  );
$$;

-- ── 4. El importe que se cobra ──────────────────────────────────────────────
-- UNICA autoridad sobre el precio. crear-preferencia-mp la llama con el precio
-- de lista; si la promo vencio devuelve el mismo precio de lista, asi que la
-- Edge Function no necesita saber nada de la promocion ni apagar nada.
create or replace function marketplace_precio_final(p_precio numeric)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_promo jsonb;
begin
  if p_precio is null then return null; end if;
  v_promo := marketplace_promocion_vigente();
  if coalesce((v_promo ->> 'activa')::boolean, false) then
    return marketplace_redondeo_promo(p_precio, (v_promo ->> 'porcentaje')::smallint);
  end if;
  return p_precio;
end;
$$;

-- ── 5. Panel de administracion ──────────────────────────────────────────────
-- Devuelve la fila CRUDA (para poder rellenar el formulario aunque la promo
-- este programada o vencida) mas una previsualizacion del tarifario con el
-- descuento puesto: asi se comprueban las cifras antes de encenderla.
create or replace function admin_estado_promocion()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not es_admin() then
    raise exception 'No autorizado';
  end if;

  select jsonb_build_object(
    'activa', p.activa,
    'porcentaje', p.porcentaje,
    'vigente_desde', p.vigente_desde,
    'vigente_hasta', p.vigente_hasta,
    'etiqueta', p.etiqueta,
    'actualizado_en', p.actualizado_en,
    'vigente_ahora',
      coalesce((marketplace_promocion_vigente() ->> 'activa')::boolean, false),
    'previsualizacion', (
      select jsonb_agg(jsonb_build_object(
               'modalidad_precio', t.modalidad_precio,
               'tipo_paquete', t.tipo_paquete,
               'lista_pdf', t.precio_base,
               'lista_editable', t.precio_base + t.precio_addon_editable,
               'promo_pdf', marketplace_redondeo_promo(t.precio_base, p.porcentaje),
               'promo_editable', marketplace_redondeo_promo(
                 t.precio_base + t.precio_addon_editable, p.porcentaje))
             order by t.modalidad_precio, t.tipo_paquete)
      from marketplace_precios t
      where t.nivel = 1
    )
  ) into v
  from marketplace_promocion p where p.id;

  return v;
end;
$$;

create or replace function admin_guardar_promocion(
  p_activa boolean,
  p_porcentaje smallint default null,
  p_vigente_hasta timestamptz default null,
  p_vigente_desde timestamptz default null,
  p_etiqueta text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not es_admin() then
    raise exception 'No autorizado';
  end if;

  -- Las fechas se escriben tal cual llegan (NULL incluido): asi se puede
  -- quitar la fecha limite, no solo cambiarla.
  update marketplace_promocion
  set activa         = p_activa,
      porcentaje     = coalesce(p_porcentaje, porcentaje),
      vigente_desde  = p_vigente_desde,
      vigente_hasta  = p_vigente_hasta,
      etiqueta       = coalesce(nullif(btrim(p_etiqueta), ''), etiqueta),
      actualizado_en = now()
  where id;

  return admin_estado_promocion();
end;
$$;

-- ── 6. Permisos y RLS ───────────────────────────────────────────────────────
-- Sin lectura publica de la tabla: el publico pasa por la RPC, igual que con
-- marketplace_precios.
alter table marketplace_promocion enable row level security;

drop policy if exists "promocion: solo admin" on marketplace_promocion;
create policy "promocion: solo admin" on marketplace_promocion
  for select using (es_admin());

-- El cliente nunca necesita marketplace_precio_final(): calcula en local con el
-- porcentaje que ya le dio marketplace_promocion_vigente(). Solo la Edge
-- Function (service role) decide importes.
revoke all on function marketplace_precio_final(numeric) from public, anon, authenticated;
revoke all on function marketplace_redondeo_promo(numeric, smallint) from public, anon;

grant execute on function marketplace_promocion_vigente() to anon, authenticated;
grant execute on function admin_estado_promocion() to authenticated;
grant execute on function admin_guardar_promocion(boolean, smallint, timestamptz, timestamptz, text) to authenticated;

-- ── 7. Comprobacion: las doce cifras del acuerdo ────────────────────────────
select modalidad_precio, tipo_paquete,
       precio_base                                           as lista_pdf,
       marketplace_redondeo_promo(precio_base, 20::smallint)  as pdf_20,
       precio_base + precio_addon_editable                    as lista_editable,
       marketplace_redondeo_promo(precio_base + precio_addon_editable, 20::smallint)
                                                              as editable_20
from marketplace_precios
where nivel = 1
order by modalidad_precio, tipo_paquete;

-- ── 8. Encender ─────────────────────────────────────────────────────────────
-- Se deja APAGADA a proposito: aplicar este archivo no cambia nada visible ni
-- cobrable. Se enciende desde el panel admin (o descomentando esto).
--
-- update marketplace_promocion
-- set activa = true, porcentaje = 20,
--     vigente_desde = null,
--     vigente_hasta = '2026-09-30 23:59:59-06',
--     etiqueta = 'por tiempo limitado',
--     actualizado_en = now()
-- where id;
