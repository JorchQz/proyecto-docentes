-- Tabla de actividades de proyecto
create table if not exists actividades_proyecto (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid references proyectos(id) on delete cascade,
  nombre text not null,
  tipo text not null, -- Tarea o Clase
  pda text not null,  -- Asociado al PDA
  created_at timestamp with time zone default now()
);
