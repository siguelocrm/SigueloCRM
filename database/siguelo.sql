-- =========================================================
-- SígueloCRM: seguimiento automático por etapa (Fase 1)
--
-- Recordatorios y reactivaciones por etapa del embudo, con una cola segura
-- (horario, tope diario y pausas al azar), traídos de la extensión SígueloCRM.
--
-- Cómo usarlo: en tu proyecto de Supabase entra a "SQL Editor", pega TODO
-- este archivo y pulsa "Run". Es seguro repetirlo: no borra nada.
--
-- Va aparte de instalar.sql y actualizar.sql (los del curso) para que puedas
-- seguir trayendo las mejoras del profe sin mezclar los archivos.
-- =========================================================

-- ---------- 1. Ajustes generales (uno por empresa) ----------
create table if not exists siguelo_ajustes (
  empresa_id uuid primary key references empresas (id) on delete cascade,
  -- Apagado hasta que lo actives en la pantalla "Seguimiento".
  activo boolean not null default false,
  -- Los contactos que ya estaban en su etapa antes de esta fecha no reciben
  -- recordatorios (así no le llegan mensajes a todo tu historial de golpe).
  activado_en timestamptz,
  -- "Pausar todo": la cola no envía nada hasta que lo quites.
  pausado boolean not null default false,
  motivo_pausa text,
  zona_horaria text not null default 'America/La_Paz',
  hora_inicio text not null default '08:00',
  hora_fin text not null default '20:00',
  -- El tope diario y las pausas se cuentan por cada número de WhatsApp.
  pausa_min_seg integer not null default 45 check (pausa_min_seg between 0 and 3600),
  pausa_max_seg integer not null default 120 check (pausa_max_seg between 0 and 3600),
  maximo_diario integer not null default 30 check (maximo_diario between 0 and 1000),
  min_entre_misma_persona_min integer not null default 60 check (min_entre_misma_persona_min between 0 and 10080),
  no_recordar_si_escribio_horas numeric not null default 24 check (no_recordar_si_escribio_horas >= 0),
  atraso_max_reactivacion_horas numeric not null default 12 check (atraso_max_reactivacion_horas >= 0),
  ciclos_reactivacion_cada_horas numeric not null default 24 check (ciclos_reactivacion_cada_horas >= 0),
  -- Pie que se agrega al final de cada mensaje automático: { activo, variantes: [] }
  pie jsonb not null default '{"activo": false, "variantes": []}'::jsonb,
  actualizado_en timestamptz not null default now()
);

-- ---------- 2. Mensajes de cada etapa del embudo ----------
-- recordatorios / reactivacion: { activa, modo: 'origen' | 'encadenado', pasos: [{ horas, variantes: [] }] }
-- al_terminar: { etapa_id, dias } → pasar sola a otra etapa al terminar sin respuesta.
-- En los textos se puede usar {nombre} y {sucursal} (el nombre del número en Conexiones).
create table if not exists siguelo_etapas (
  id uuid primary key default gen_random_uuid(),
  etapa_id uuid not null references etapas_venta (id) on delete cascade,
  empresa_id uuid not null references empresas (id) on delete cascade,
  -- Para la fase de negocios por número: textos propios de un negocio que
  -- reemplazan a los generales. null = los de todos (hoy siempre es null).
  negocio_id uuid,
  recordatorios jsonb not null default '{"activa": false, "modo": "origen", "pasos": []}'::jsonb,
  reactivacion jsonb not null default '{"activa": false, "modo": "encadenado", "pasos": []}'::jsonb,
  al_terminar jsonb not null default '{"etapa_id": null, "dias": 0}'::jsonb,
  actualizado_en timestamptz not null default now()
);
create index if not exists siguelo_etapas_empresa_idx on siguelo_etapas (empresa_id);
-- Una sola configuración general por etapa, y una por negocio.
create unique index if not exists siguelo_etapas_unica_idx
  on siguelo_etapas (etapa_id, coalesce(negocio_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------- 3. En qué va cada contacto ----------
-- rec:   { etapa_id, origen, paso, ultimo_envio, previo }          (tiempos en milisegundos)
-- react: { etapa_id, activo, ciclo, inicio, origen, paso, ultimo_envio }
create table if not exists siguelo_seguimientos (
  contacto_id uuid primary key references contactos (id) on delete cascade,
  empresa_id uuid not null references empresas (id) on delete cascade,
  rec jsonb,
  react jsonb,
  -- El cliente respondió y espera que lo atiendas: los recordatorios esperan.
  respondio boolean not null default false,
  pausado boolean not null default false,
  -- Último mensaje del cliente y último tuyo ya revisados por el motor.
  visto_cliente timestamptz,
  visto_agente timestamptz,
  ultimo_automatico timestamptz,
  ultimo_texto_auto text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists siguelo_seguimientos_empresa_idx on siguelo_seguimientos (empresa_id);

-- ---------- 4. Cola de envío ----------
create table if not exists siguelo_cola (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id) on delete cascade,
  contacto_id uuid not null references contactos (id) on delete cascade,
  conversacion_id uuid not null references conversaciones (id) on delete cascade,
  linea_id uuid not null,
  telefono text not null,
  tipo text not null check (tipo in ('rec', 'react')),
  etapa_id uuid,
  paso integer not null,
  token text not null,
  -- Ej. "Primer Contacto · Recordatorio 1"
  nombre text not null,
  variantes text[] not null default '{}',
  vence timestamptz not null,
  max_atraso_ms bigint,
  -- Adelantado a mano: el motor ya no le cambia la hora.
  fijo boolean not null default false,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'enviando', 'enviado', 'cancelado', 'error')),
  -- Cancelado por una persona desde la pantalla: ese paso se salta.
  a_mano boolean not null default false,
  texto text,
  motivo text,
  mensaje_id uuid,
  whatsapp_id text,
  creado_en timestamptz not null default now(),
  cerrado_en timestamptz
);
create index if not exists siguelo_cola_pendientes_idx on siguelo_cola (empresa_id, estado, vence);
create index if not exists siguelo_cola_contacto_idx on siguelo_cola (contacto_id);
create index if not exists siguelo_cola_mensaje_idx on siguelo_cola (mensaje_id) where mensaje_id is not null;
create index if not exists siguelo_cola_whatsapp_idx on siguelo_cola (whatsapp_id) where whatsapp_id is not null;

-- ---------- 5. Cuántos salieron cada día por número (para el tope diario) ----------
create table if not exists siguelo_contador (
  empresa_id uuid not null references empresas (id) on delete cascade,
  linea_id uuid not null references lineas_whatsapp (id) on delete cascade,
  fecha text not null,
  enviados integer not null default 0,
  primary key (empresa_id, linea_id, fecha)
);

-- ---------- 6. Registro: lo último que hizo el seguimiento ----------
create table if not exists siguelo_registro (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id) on delete cascade,
  contacto_id uuid references contactos (id) on delete cascade,
  tipo text not null,
  texto text not null,
  creado_en timestamptz not null default now()
);
create index if not exists siguelo_registro_empresa_idx on siguelo_registro (empresa_id, creado_en desc);

-- ---------- 7. Permisos (Row Level Security) ----------
-- El servidor usa la clave secreta y no pasa por estas reglas. Desde la página:
-- todos los de la empresa ven; los ajustes y los mensajes de cada etapa solo
-- los cambian el dueño y los supervisores.
alter table siguelo_ajustes enable row level security;
alter table siguelo_etapas enable row level security;
alter table siguelo_seguimientos enable row level security;
alter table siguelo_cola enable row level security;
alter table siguelo_contador enable row level security;
alter table siguelo_registro enable row level security;

drop policy if exists "siguelo_ajustes_select" on siguelo_ajustes;
create policy "siguelo_ajustes_select" on siguelo_ajustes for select
  using (empresa_id = (select empresa_id from usuario_actual()));

drop policy if exists "siguelo_ajustes_admin" on siguelo_ajustes;
create policy "siguelo_ajustes_admin" on siguelo_ajustes for all
  using (
    empresa_id = (select empresa_id from usuario_actual())
    and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[])
  )
  with check (
    empresa_id = (select empresa_id from usuario_actual())
    and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[])
  );

drop policy if exists "siguelo_etapas_select" on siguelo_etapas;
create policy "siguelo_etapas_select" on siguelo_etapas for select
  using (empresa_id = (select empresa_id from usuario_actual()));

drop policy if exists "siguelo_etapas_admin" on siguelo_etapas;
create policy "siguelo_etapas_admin" on siguelo_etapas for all
  using (
    empresa_id = (select empresa_id from usuario_actual())
    and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[])
  )
  with check (
    empresa_id = (select empresa_id from usuario_actual())
    and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[])
  );

-- Pausar un contacto o marcarlo como atendido lo puede hacer cualquiera de la empresa.
drop policy if exists "siguelo_seguimientos_select" on siguelo_seguimientos;
create policy "siguelo_seguimientos_select" on siguelo_seguimientos for select
  using (empresa_id = (select empresa_id from usuario_actual()));

drop policy if exists "siguelo_seguimientos_update" on siguelo_seguimientos;
create policy "siguelo_seguimientos_update" on siguelo_seguimientos for update
  using (empresa_id = (select empresa_id from usuario_actual()))
  with check (empresa_id = (select empresa_id from usuario_actual()));

-- Cancelar o adelantar un mensaje de la cola, también.
drop policy if exists "siguelo_cola_select" on siguelo_cola;
create policy "siguelo_cola_select" on siguelo_cola for select
  using (empresa_id = (select empresa_id from usuario_actual()));

drop policy if exists "siguelo_cola_update" on siguelo_cola;
create policy "siguelo_cola_update" on siguelo_cola for update
  using (empresa_id = (select empresa_id from usuario_actual()))
  with check (empresa_id = (select empresa_id from usuario_actual()));

drop policy if exists "siguelo_contador_select" on siguelo_contador;
create policy "siguelo_contador_select" on siguelo_contador for select
  using (empresa_id = (select empresa_id from usuario_actual()));

drop policy if exists "siguelo_registro_select" on siguelo_registro;
create policy "siguelo_registro_select" on siguelo_registro for select
  using (empresa_id = (select empresa_id from usuario_actual()));

-- ---------- 8. Actividad de cada contacto (la usa el servidor) ----------
-- Por cada contacto que está en una etapa con mensajes configurados: su chat
-- (la conversación abierta o la más reciente) y cuándo fue el primer mensaje,
-- el último del cliente, el último nuestro y el último nuestro escrito a mano
-- (sin contar los que mandó el propio seguimiento).
create or replace function siguelo_actividad(p_empresa uuid)
returns table (
  contacto_id uuid,
  telefono text,
  nombre text,
  etapa_id uuid,
  etapa_actualizada_en timestamptz,
  contacto_creado_en timestamptz,
  conversacion_id uuid,
  linea_id uuid,
  primer_mensaje timestamptz,
  ultimo_cliente timestamptz,
  ultimo_saliente timestamptz,
  ultimo_manual timestamptz
)
language sql
stable
set search_path = public
as $$
  with contactos_en_seguimiento as (
    select c.id, c.telefono, c.nombre, c.etapa_id, c.etapa_actualizada_en, c.creado_en
    from contactos c
    where c.empresa_id = p_empresa
      and c.etapa_id in (select se.etapa_id from siguelo_etapas se where se.empresa_id = p_empresa)
  ),
  chats as (
    select cv.id, cv.linea_id, cv.contacto_telefono, cv.estado, cv.ultima_actividad
    from conversaciones cv
    join lineas_whatsapp l on l.id = cv.linea_id
    where l.empresa_id = p_empresa
      and cv.contacto_telefono in (select telefono from contactos_en_seguimiento)
  ),
  chat_principal as (
    select distinct on (contacto_telefono) contacto_telefono, id, linea_id
    from chats
    order by contacto_telefono, (estado = 'abierto') desc, ultima_actividad desc
  ),
  tiempos as (
    select
      ch.contacto_telefono,
      min(m.creado_en) as primer_mensaje,
      max(m.creado_en) filter (where m.remitente = 'cliente') as ultimo_cliente,
      max(m.creado_en) filter (where m.remitente = 'agente') as ultimo_saliente,
      max(m.creado_en) filter (
        where m.remitente = 'agente'
          and not exists (select 1 from siguelo_cola q where q.mensaje_id = m.id)
          and (m.whatsapp_id is null or not exists (select 1 from siguelo_cola q where q.whatsapp_id = m.whatsapp_id))
      ) as ultimo_manual
    from chats ch
    join mensajes m on m.conversacion_id = ch.id
    group by ch.contacto_telefono
  )
  select
    c.id, c.telefono, c.nombre, c.etapa_id, c.etapa_actualizada_en, c.creado_en,
    cp.id, cp.linea_id,
    t.primer_mensaje, t.ultimo_cliente, t.ultimo_saliente, t.ultimo_manual
  from contactos_en_seguimiento c
  join chat_principal cp on cp.contacto_telefono = c.telefono
  left join tiempos t on t.contacto_telefono = c.telefono;
$$;

-- Solo el servidor la usa: desde la página no se puede llamar.
revoke execute on function siguelo_actividad(uuid) from public, anon, authenticated;
grant execute on function siguelo_actividad(uuid) to service_role;
