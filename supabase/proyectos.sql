-- Tabla de proyectos
create table if not exists proyectos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  fecha_inicio date not null,
  fecha_fin date not null,
  metodologia text not null,
  escenario text not null,
  created_at timestamp with time zone default now()
);
