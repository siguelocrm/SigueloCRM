-- =========================================================
-- SígueloCRM: seguimiento automático (Fase 1) y negocios por número (Fase 2)
--
-- Recordatorios y reactivaciones por etapa del embudo, con una cola segura
-- (horario, tope diario y pausas al azar), traídos de la extensión SígueloCRM.
-- Y varios números en el mismo CRM, cada uno con su negocio (sección 9 en adelante).
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

-- =========================================================
-- Fase 2: negocios por número
-- Un solo CRM con varios números, y cada número trabaja como un negocio con
-- su ficha (datos e información para la IA), sus respuestas rápidas, sus
-- reglas del bot, sus textos de seguimiento y, si hace falta, su propio embudo.
-- =========================================================

-- ---------- 9. Embudos propios ----------
-- Las etapas que NO están en siguelo_etapa_embudo son del embudo principal
-- (el de siempre). Un negocio con embudo propio usa solo las etapas de ese embudo.
create table if not exists siguelo_embudos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id) on delete cascade,
  nombre text not null,
  creado_en timestamptz not null default now()
);

create table if not exists siguelo_etapa_embudo (
  etapa_id uuid primary key references etapas_venta (id) on delete cascade,
  embudo_id uuid not null references siguelo_embudos (id) on delete cascade
);
create index if not exists siguelo_etapa_embudo_embudo_idx on siguelo_etapa_embudo (embudo_id);

-- ---------- 10. Negocios (la ficha de cada uno) ----------
create table if not exists siguelo_negocios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id) on delete cascade,
  nombre text not null,
  -- Variables de los textos: {negocio}, {sucursal}, {direccion}, {horario}.
  sucursal text,
  direccion text,
  horario text,
  -- Lo que la IA sabe de este negocio: qué vende, precios, horarios, lo que no debe decir.
  info_ia text not null default '',
  -- null = usa el embudo principal.
  embudo_id uuid references siguelo_embudos (id) on delete set null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists siguelo_negocios_empresa_idx on siguelo_negocios (empresa_id);

-- De qué negocio es cada número (un número sin fila no es de ningún negocio).
create table if not exists siguelo_lineas (
  linea_id uuid primary key references lineas_whatsapp (id) on delete cascade,
  empresa_id uuid not null references empresas (id) on delete cascade,
  negocio_id uuid not null references siguelo_negocios (id) on delete cascade
);

-- Respuestas rápidas y reglas del bot que son solo de algunos negocios.
-- Una respuesta o regla sin filas acá sirve para todos.
create table if not exists siguelo_respuesta_negocio (
  respuesta_id uuid not null references respuestas_rapidas (id) on delete cascade,
  negocio_id uuid not null references siguelo_negocios (id) on delete cascade,
  primary key (respuesta_id, negocio_id)
);

create table if not exists siguelo_bot_negocio (
  regla_id uuid not null references respuestas_automaticas (id) on delete cascade,
  negocio_id uuid not null references siguelo_negocios (id) on delete cascade,
  primary key (regla_id, negocio_id)
);

-- Los textos de seguimiento propios de un negocio se borran con él.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'siguelo_etapas_negocio_fk') then
    alter table siguelo_etapas
      add constraint siguelo_etapas_negocio_fk foreign key (negocio_id) references siguelo_negocios (id) on delete cascade;
  end if;
end $$;

-- ---------- 11. Permisos de la Fase 2 ----------
-- Todos los de la empresa ven; el dueño y los supervisores cambian.
alter table siguelo_embudos enable row level security;
alter table siguelo_etapa_embudo enable row level security;
alter table siguelo_negocios enable row level security;
alter table siguelo_lineas enable row level security;
alter table siguelo_respuesta_negocio enable row level security;
alter table siguelo_bot_negocio enable row level security;

drop policy if exists "siguelo_embudos_select" on siguelo_embudos;
create policy "siguelo_embudos_select" on siguelo_embudos for select
  using (empresa_id = (select empresa_id from usuario_actual()));
drop policy if exists "siguelo_embudos_admin" on siguelo_embudos;
create policy "siguelo_embudos_admin" on siguelo_embudos for all
  using (empresa_id = (select empresa_id from usuario_actual()) and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[]))
  with check (empresa_id = (select empresa_id from usuario_actual()) and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[]));

drop policy if exists "siguelo_negocios_select" on siguelo_negocios;
create policy "siguelo_negocios_select" on siguelo_negocios for select
  using (empresa_id = (select empresa_id from usuario_actual()));
drop policy if exists "siguelo_negocios_admin" on siguelo_negocios;
create policy "siguelo_negocios_admin" on siguelo_negocios for all
  using (empresa_id = (select empresa_id from usuario_actual()) and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[]))
  with check (empresa_id = (select empresa_id from usuario_actual()) and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[]));

drop policy if exists "siguelo_lineas_select" on siguelo_lineas;
create policy "siguelo_lineas_select" on siguelo_lineas for select
  using (empresa_id = (select empresa_id from usuario_actual()));
drop policy if exists "siguelo_lineas_admin" on siguelo_lineas;
create policy "siguelo_lineas_admin" on siguelo_lineas for all
  using (empresa_id = (select empresa_id from usuario_actual()) and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[]))
  with check (empresa_id = (select empresa_id from usuario_actual()) and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[]));

drop policy if exists "siguelo_etapa_embudo_select" on siguelo_etapa_embudo;
create policy "siguelo_etapa_embudo_select" on siguelo_etapa_embudo for select
  using (embudo_id in (select id from siguelo_embudos where empresa_id = (select empresa_id from usuario_actual())));
drop policy if exists "siguelo_etapa_embudo_admin" on siguelo_etapa_embudo;
create policy "siguelo_etapa_embudo_admin" on siguelo_etapa_embudo for all
  using (
    embudo_id in (select id from siguelo_embudos where empresa_id = (select empresa_id from usuario_actual()))
    and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[])
  )
  with check (
    embudo_id in (select id from siguelo_embudos where empresa_id = (select empresa_id from usuario_actual()))
    and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[])
  );

drop policy if exists "siguelo_respuesta_negocio_select" on siguelo_respuesta_negocio;
create policy "siguelo_respuesta_negocio_select" on siguelo_respuesta_negocio for select
  using (negocio_id in (select id from siguelo_negocios where empresa_id = (select empresa_id from usuario_actual())));
drop policy if exists "siguelo_respuesta_negocio_admin" on siguelo_respuesta_negocio;
create policy "siguelo_respuesta_negocio_admin" on siguelo_respuesta_negocio for all
  using (
    negocio_id in (select id from siguelo_negocios where empresa_id = (select empresa_id from usuario_actual()))
    and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[])
  )
  with check (
    negocio_id in (select id from siguelo_negocios where empresa_id = (select empresa_id from usuario_actual()))
    and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[])
  );

drop policy if exists "siguelo_bot_negocio_select" on siguelo_bot_negocio;
create policy "siguelo_bot_negocio_select" on siguelo_bot_negocio for select
  using (negocio_id in (select id from siguelo_negocios where empresa_id = (select empresa_id from usuario_actual())));
drop policy if exists "siguelo_bot_negocio_admin" on siguelo_bot_negocio;
create policy "siguelo_bot_negocio_admin" on siguelo_bot_negocio for all
  using (
    negocio_id in (select id from siguelo_negocios where empresa_id = (select empresa_id from usuario_actual()))
    and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[])
  )
  with check (
    negocio_id in (select id from siguelo_negocios where empresa_id = (select empresa_id from usuario_actual()))
    and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[])
  );

-- ---------- 12. Un cliente nuevo entra al embudo de su negocio ----------
-- La base del curso pone a todo contacto nuevo en la primera etapa de la
-- empresa. Este disparador (corre después de ese, por orden alfabético) lo
-- pasa a la primera etapa del embudo del negocio del número por el que
-- escribió. Si la ficha se creó con una etapa elegida a mano, no la toca.
create or replace function siguelo_contacto_embudo() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_embudo uuid;
  v_defecto uuid;
  v_actual uuid;
  v_etapa uuid;
begin
  -- La etapa que pone la base del curso cuando no se eligió ninguna.
  select id into v_defecto from etapas_venta
  where empresa_id = new.empresa_id and tipo = 'normal'
  order by orden asc limit 1;
  if new.etapa_id is distinct from v_defecto then return new; end if;

  -- Embudo del negocio de su primer chat (null = principal, también si no hay negocio).
  select n.embudo_id into v_embudo
  from conversaciones c
  join lineas_whatsapp l on l.id = c.linea_id and l.empresa_id = new.empresa_id
  join siguelo_lineas sl on sl.linea_id = c.linea_id
  join siguelo_negocios n on n.id = sl.negocio_id
  where c.contacto_telefono = new.telefono
  order by c.creado_en asc
  limit 1;

  select embudo_id into v_actual from siguelo_etapa_embudo where etapa_id = new.etapa_id;
  if v_actual is not distinct from v_embudo then return new; end if;

  select e.id into v_etapa
  from etapas_venta e
  left join siguelo_etapa_embudo ee on ee.etapa_id = e.id
  where e.empresa_id = new.empresa_id and e.tipo = 'normal' and ee.embudo_id is not distinct from v_embudo
  order by e.orden asc
  limit 1;
  if v_etapa is not null then
    new.etapa_id := v_etapa;
    new.etapa_actualizada_en := now();
  end if;
  return new;
end;
$$;

drop trigger if exists siguelo_contactos_embudo on contactos;
create trigger siguelo_contactos_embudo before insert on contactos
  for each row execute function siguelo_contacto_embudo();
