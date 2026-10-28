-- =========================================================
-- SígueloCRM: seguimiento automático (Fase 1), negocios por número (Fase 2),
-- IA que responde (Fase 3), palabras y citas (Fase 4), inscripción con pago (Fase 5),
-- la IA en el seguimiento y el asistente
--
-- Recordatorios y reactivaciones por etapa del embudo, con una cola segura
-- (horario, tope diario y pausas al azar), traídos de la extensión SígueloCRM.
-- Varios números en el mismo CRM, cada uno con su negocio (sección 9 en adelante).
-- Y la IA que responde con la ficha de cada negocio (sección 13 en adelante).
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

-- =========================================================
-- Fase 3: la IA responde con la ficha de cada negocio
-- Lee cada conversación cuando el cliente termina de escribir y, con la
-- información del negocio de ese número: responde (o deja la respuesta para
-- que la apruebes), manda respuestas rápidas, mueve de etapa, invita a un
-- grupo, pasa al cliente a otra sucursal y te avisa por WhatsApp lo importante.
-- =========================================================

-- ---------- 13. Ajustes de la IA (uno por empresa) ----------
create table if not exists siguelo_ia (
  empresa_id uuid primary key references empresas (id) on delete cascade,
  activa boolean not null default false,
  -- apagado: solo lee y anota · borrador: la respuesta espera que la apruebes · automatico: responde sola
  modo text not null default 'borrador' check (modo in ('apagado', 'borrador', 'automatico')),
  modelo text not null default 'gpt-6-luna',
  -- Los últimos 4 caracteres de la clave, para saber cuál está guardada (la clave no se puede leer desde la página).
  clave_final text,
  estilo jsonb not null default '{"tono": "amable", "trato": "tu", "emojis": "pocos", "largo": "medio", "saltos": "normal", "usar_nombre": true}'::jsonb,
  firma text not null default '',
  instrucciones text not null default '',
  ejemplos text not null default '',
  -- Si no sabe la respuesta: avisar (no responde y te avisa) o espera (manda texto_espera y te avisa).
  si_no_sabe text not null default 'avisar' check (si_no_sabe in ('avisar', 'espera')),
  texto_espera text not null default 'Déjame consultarlo y te respondo en un momento 🙏',
  -- Franja en que responde (fuera de ella, la respuesta sale al abrir la franja).
  desde text not null default '07:00',
  hasta text not null default '22:00',
  espera_min_seg integer not null default 20 check (espera_min_seg between 0 and 3600),
  espera_max_seg integer not null default 60 check (espera_max_seg between 0 and 3600),
  max_por_cliente_dia integer not null default 10 check (max_por_cliente_dia >= 0),
  max_respuestas_dia integer not null default 150 check (max_respuestas_dia >= 0),
  max_consultas_dia integer not null default 500 check (max_consultas_dia >= 0),
  -- Si una persona escribió desde el CRM hace menos de esto, la IA no responde encima (deja borrador).
  pausa_si_escribes_min integer not null default 30 check (pausa_si_escribes_min >= 0),
  acciones jsonb not null default '{"mover_etapa": true, "no_quiere_mas": true, "respuestas_rapidas": true, "pases": true, "grupos": true}'::jsonb,
  -- Avisos a tu WhatsApp personal: desde qué número se mandan, qué casos, cuántos por día y cuántos minutos juntar.
  avisos jsonb not null default '{"activo": false, "telefono": "", "linea_id": null, "tipos": {"fuera": true, "compro": true, "pregunta": true, "molesto": true, "humano": true, "otro": false}, "max_dia": 30, "juntar_min": 5}'::jsonb,
  actualizado_en timestamptz not null default now()
);

-- La clave de OpenAI: solo la lee y la escribe el servidor (sin permisos para la página).
create table if not exists siguelo_ia_clave (
  empresa_id uuid primary key references empresas (id) on delete cascade,
  clave text not null,
  actualizado_en timestamptz not null default now()
);

-- La ficha de cada negocio suma lo que la IA usa para orientar al cliente.
alter table siguelo_negocios
  add column if not exists ia_activa boolean not null default true,
  -- Zonas o barrios que atiende cada sucursal (para sugerir la más cercana).
  add column if not exists zonas text,
  -- Grupos de WhatsApp a los que la IA puede invitar (solo manda el link, si el cliente acepta):
  -- [{ id, nombre, link, cuando }]
  add column if not exists grupos jsonb not null default '[]'::jsonb;

-- ---------- 14. Lo que la IA leyó de cada conversación ----------
create table if not exists siguelo_ia_lecturas (
  conversacion_id uuid primary key references conversaciones (id) on delete cascade,
  empresa_id uuid not null references empresas (id) on delete cascade,
  contacto_id uuid references contactos (id) on delete cascade,
  linea_id uuid,
  -- Último mensaje del cliente que la IA ya leyó.
  leido_hasta timestamptz,
  fallos integer not null default 0,
  reintentar_en timestamptz,
  resumen text,
  interes text,
  -- Lo que necesita que lo veas: { tipo, motivo, ts, hecho }
  atencion jsonb,
  -- "La IA no le responde" a este cliente en este número.
  sin_respuestas boolean not null default false,
  -- Último aviso de cada tipo (para no repetirlo en 6 h): { tipo: milisegundos }
  avisado jsonb not null default '{}'::jsonb,
  espera_enviada timestamptz,
  actualizado_en timestamptz not null default now()
);
create index if not exists siguelo_ia_lecturas_empresa_idx on siguelo_ia_lecturas (empresa_id);

-- ---------- 15. Lo que la IA manda (y lo que espera tu aprobación) ----------
create table if not exists siguelo_ia_salida (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id) on delete cascade,
  -- null en los avisos a tu WhatsApp personal.
  conversacion_id uuid references conversaciones (id) on delete cascade,
  contacto_id uuid references contactos (id) on delete cascade,
  linea_id uuid not null,
  telefono text not null,
  origen text not null check (origen in ('respuesta', 'respuesta_rapida', 'grupo', 'pase', 'aviso')),
  -- Id de la respuesta rápida o del grupo: cada una se manda una sola vez a cada cliente.
  referencia text,
  tipo text not null default 'texto' check (tipo in ('texto', 'imagen', 'pdf', 'documento', 'audio')),
  contenido text not null default '',
  media_url text,
  mimetype text,
  vence timestamptz not null default now(),
  estado text not null default 'pendiente'
    check (estado in ('borrador', 'pendiente', 'enviando', 'enviado', 'cancelado', 'error')),
  -- Aprobado a mano: sale aunque la conversación haya seguido.
  aprobado boolean not null default false,
  -- Último mensaje del cliente que la IA leyó para armar esta respuesta: si
  -- después escribió otra cosa, la respuesta ya no sale (la IA vuelve a leer).
  base_cliente timestamptz,
  motivo text,
  -- Los mensajes de una misma respuesta (texto, foto, link...) salen juntos y en orden.
  lote uuid,
  orden integer not null default 0,
  mensaje_id uuid,
  whatsapp_id text,
  creado_en timestamptz not null default now(),
  cerrado_en timestamptz
);
create index if not exists siguelo_ia_salida_pendientes_idx on siguelo_ia_salida (empresa_id, estado, vence);
create index if not exists siguelo_ia_salida_conversacion_idx on siguelo_ia_salida (conversacion_id);
create index if not exists siguelo_ia_salida_mensaje_idx on siguelo_ia_salida (mensaje_id) where mensaje_id is not null;

-- ---------- 16. Consultas a la IA por día (uso y freno) ----------
create table if not exists siguelo_ia_uso (
  empresa_id uuid not null references empresas (id) on delete cascade,
  fecha text not null,
  consultas integer not null default 0,
  entrada bigint not null default 0,
  salida bigint not null default 0,
  primary key (empresa_id, fecha)
);

-- ---------- 17. Permisos de la Fase 3 ----------
alter table siguelo_ia enable row level security;
alter table siguelo_ia_clave enable row level security; -- sin políticas: solo el servidor
alter table siguelo_ia_lecturas enable row level security;
alter table siguelo_ia_salida enable row level security;
alter table siguelo_ia_uso enable row level security;

drop policy if exists "siguelo_ia_select" on siguelo_ia;
create policy "siguelo_ia_select" on siguelo_ia for select
  using (empresa_id = (select empresa_id from usuario_actual()));
drop policy if exists "siguelo_ia_admin" on siguelo_ia;
create policy "siguelo_ia_admin" on siguelo_ia for all
  using (empresa_id = (select empresa_id from usuario_actual()) and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[]))
  with check (empresa_id = (select empresa_id from usuario_actual()) and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[]));

-- Marcar como visto, "La IA no le responde", aprobar o descartar respuestas: cualquiera de la empresa.
drop policy if exists "siguelo_ia_lecturas_select" on siguelo_ia_lecturas;
create policy "siguelo_ia_lecturas_select" on siguelo_ia_lecturas for select
  using (empresa_id = (select empresa_id from usuario_actual()));
drop policy if exists "siguelo_ia_lecturas_update" on siguelo_ia_lecturas;
create policy "siguelo_ia_lecturas_update" on siguelo_ia_lecturas for update
  using (empresa_id = (select empresa_id from usuario_actual()))
  with check (empresa_id = (select empresa_id from usuario_actual()));

drop policy if exists "siguelo_ia_salida_select" on siguelo_ia_salida;
create policy "siguelo_ia_salida_select" on siguelo_ia_salida for select
  using (empresa_id = (select empresa_id from usuario_actual()));
drop policy if exists "siguelo_ia_salida_update" on siguelo_ia_salida;
create policy "siguelo_ia_salida_update" on siguelo_ia_salida for update
  using (empresa_id = (select empresa_id from usuario_actual()))
  with check (empresa_id = (select empresa_id from usuario_actual()));

drop policy if exists "siguelo_ia_uso_select" on siguelo_ia_uso;
create policy "siguelo_ia_uso_select" on siguelo_ia_uso for select
  using (empresa_id = (select empresa_id from usuario_actual()));

-- ---------- 18. Conversaciones con mensajes del cliente que la IA no leyó ----------
-- Las de las últimas 48 h cuyo cliente dejó de escribir hace al menos p_quieto_seg
-- segundos (suelen mandar varios mensajes seguidos). La usa el servidor.
create or replace function siguelo_ia_por_leer(p_empresa uuid, p_quieto_seg integer default 45)
returns table (
  conversacion_id uuid,
  linea_id uuid,
  telefono text,
  contacto_id uuid,
  ultimo_cliente timestamptz
)
language sql
stable
set search_path = public
as $$
  select cv.id, cv.linea_id, cv.contacto_telefono, c.id, max(m.creado_en)
  from mensajes m
  join conversaciones cv on cv.id = m.conversacion_id
  join lineas_whatsapp l on l.id = cv.linea_id and l.empresa_id = p_empresa
  left join contactos c on c.empresa_id = p_empresa and c.telefono = cv.contacto_telefono
  left join siguelo_ia_lecturas lec on lec.conversacion_id = cv.id
  where m.remitente = 'cliente'
    and m.creado_en > now() - interval '48 hours'
  group by cv.id, cv.linea_id, cv.contacto_telefono, c.id, lec.leido_hasta, lec.reintentar_en
  having max(m.creado_en) > coalesce(lec.leido_hasta, '-infinity'::timestamptz)
     and max(m.creado_en) < now() - make_interval(secs => p_quieto_seg)
     and (lec.reintentar_en is null or lec.reintentar_en < now())
  order by max(m.creado_en) asc
  limit 20;
$$;

revoke execute on function siguelo_ia_por_leer(uuid, integer) from public, anon, authenticated;
grant execute on function siguelo_ia_por_leer(uuid, integer) to service_role;

-- =========================================================
-- Fase 4: palabras que cambian de etapa
-- =========================================================

-- ---------- 19. Palabras por etapa y "stop" ----------
-- En cada etapa (textos generales): { cliente: [], parecidas: [], tuyas: [], respuesta: "" }
--   cliente:   palabras del cliente que lo pasan solo a esta etapa (en un mensaje de 5 palabras o menos)
--   parecidas: frases que no actúan solas: piden que revises, sugiriendo esta etapa
--   tuyas:     frases tuyas (al principio de tu mensaje) que lo pasan a esta etapa
--   respuesta: lo que se le responde al llegar por una palabra del cliente (opcional)
alter table siguelo_etapas
  add column if not exists palabras jsonb not null default '{"cliente": [], "parecidas": [], "tuyas": [], "respuesta": ""}'::jsonb;

-- "stop": el cliente pide no recibir más mensajes → pasa a la etapa "perdida" de su embudo.
alter table siguelo_ajustes
  add column if not exists stop jsonb not null default '{"activo": true, "palabras": ["stop"], "parecidas": ["no me interesa", "ya no me interesa", "no quiero mas mensajes", "no me escriban", "no me escribas", "dejen de escribir", "no molesten"], "respuesta": "Listo, no te enviaremos más mensajes. ¡Gracias!"}'::jsonb;

-- Lo que espera tu decisión ({ etapa_id, texto, ts }: los mensajes automáticos se pausan)
-- y lo último que se movió solo, para poder deshacerlo ({ etapa_antes, desde_antes, descripcion, ts }).
alter table siguelo_seguimientos
  add column if not exists revisar jsonb,
  add column if not exists deshacer jsonb;

-- ---------- 20. Citas y sus mensajes ----------
-- Una cita agendada por contacto (agendar otra reemplaza la anterior).
create table if not exists siguelo_citas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id) on delete cascade,
  contacto_id uuid not null references contactos (id) on delete cascade,
  inicio timestamptz not null,
  fin timestamptz not null,
  nota text,
  estado text not null default 'agendada' check (estado in ('agendada', 'cancelada')),
  -- Cuántos mensajes de la cita ya salieron (o se saltaron).
  paso integer not null default 0,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists siguelo_citas_empresa_idx on siguelo_citas (empresa_id, estado, inicio);

-- Mensajes de la cita: ref "inicio" o "fin" y horas (negativo = antes). Salen en su propia franja,
-- sin contar para el tope del día, y se cancelan si se atrasan más de max_atraso_min.
-- En los textos: {nombre}, {hora} (16:30) y {cuando} (hoy / mañana / el viernes 30/10), más las del negocio.
alter table siguelo_ajustes
  add column if not exists citas jsonb not null default '{
    "activa": true, "desde": "07:00", "hasta": "21:00", "max_atraso_min": 45,
    "pasos": [
      {"ref": "inicio", "horas": -2, "variantes": ["Hola {nombre}, te recuerdo tu cita {cuando} a las {hora}. ¡Te esperamos!", "{nombre}, ¡hola! Tu cita es {cuando} a las {hora}. Te esperamos."]},
      {"ref": "inicio", "horas": -1, "variantes": ["{nombre}, en una hora es tu cita. ¿Todo listo?"]},
      {"ref": "inicio", "horas": 0, "variantes": ["Ya estamos listos para tu cita, {nombre}. Te esperamos."]},
      {"ref": "fin", "horas": 2, "variantes": ["Hola {nombre}, ¿pudiste venir hoy? Cuéntame cómo te fue."]}
    ]
  }'::jsonb;

-- La cola ahora también lleva los mensajes de las citas.
alter table siguelo_cola drop constraint if exists siguelo_cola_tipo_check;
alter table siguelo_cola add constraint siguelo_cola_tipo_check check (tipo in ('rec', 'react', 'cita'));

alter table siguelo_citas enable row level security;
drop policy if exists "siguelo_citas_todo" on siguelo_citas;
create policy "siguelo_citas_todo" on siguelo_citas for all
  using (empresa_id = (select empresa_id from usuario_actual()))
  with check (empresa_id = (select empresa_id from usuario_actual()));

-- =========================================================
-- Fase 5: inscripción con pago
-- El cliente paga con el QR del curso y manda la foto (o el PDF) del
-- comprobante. La IA lo lee y se controla solo: monto, destinatario, fecha y
-- número de transacción no repetido. Si todo está bien se le confirma, se le
-- piden sus datos, se guardan en su ficha (campos, comprobante y una
-- oportunidad ganada) y se le manda el link del grupo. Si algo no cuadra,
-- queda "para revisar" y te avisa. Necesita la IA (Fase 3) activa con su clave.
-- =========================================================

-- ---------- 21. Cursos (o lo que se cobra) ----------
create table if not exists siguelo_cursos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id) on delete cascade,
  -- De qué negocio es (sus números reciben los comprobantes). null = de todos.
  negocio_id uuid references siguelo_negocios (id) on delete set null,
  nombre text not null,
  activo boolean not null default true,
  precio numeric not null default 0 check (precio >= 0),
  moneda text not null default 'Bs',
  -- Imagen del QR de pago (la IA la manda cuando el cliente quiere pagar).
  qr_url text,
  -- A quién le llega el pago: nombre(s) del titular separados por coma y número de cuenta.
  destinatario text not null default '',
  cuenta text not null default '',
  link_grupo text not null default '',
  -- Datos que se le piden al inscribirse: ids de campos_personalizados, o "nombre" (nombre del contacto).
  datos jsonb not null default '[]'::jsonb,
  -- Etapa a la que pasa al pagar (null = la etapa "ganada" del embudo de su negocio).
  etapa_id uuid references etapas_venta (id) on delete set null,
  -- Antigüedad máxima del comprobante.
  max_horas integer not null default 72 check (max_horas between 1 and 720),
  -- Textos que recibe el cliente. Variables: {nombre}, {curso}, {monto}, {datos}, {link}, {motivo}.
  textos jsonb not null default '{
    "confirmado": "¡Listo, {nombre}! Recibimos tu pago de {monto} para {curso}. ✅",
    "pedir_datos": "Para completar tu inscripción, envíame por favor:\n{datos}",
    "falta": "¡Gracias! Solo me falta:\n{datos}",
    "link": "¡Ya estás inscrito en {curso}! 🎉 Únete al grupo aquí:\n{link}",
    "revisar": "Recibimos tu comprobante 🙌 Lo estamos revisando y en un momento te confirmamos.",
    "rechazado": "No pudimos validar tu comprobante: {motivo}. Si crees que es un error, escríbenos por aquí."
  }'::jsonb,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists siguelo_cursos_empresa_idx on siguelo_cursos (empresa_id);

-- ---------- 22. Pagos (un comprobante por fila) ----------
-- estado: leyendo (la IA lo está leyendo) · no_es (no era un comprobante) · revisar (te toca verlo)
--         rechazado · datos (pagó; faltan sus datos) · inscrito (listo, se le mandó el link)
create table if not exists siguelo_pagos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id) on delete cascade,
  contacto_id uuid references contactos (id) on delete cascade,
  conversacion_id uuid references conversaciones (id) on delete set null,
  linea_id uuid,
  telefono text not null,
  curso_id uuid references siguelo_cursos (id) on delete set null,
  -- La foto o el PDF del comprobante en el chat: cada uno se lee una sola vez.
  mensaje_id uuid unique,
  media_url text,
  estado text not null default 'leyendo'
    check (estado in ('leyendo', 'no_es', 'revisar', 'rechazado', 'datos', 'reservado', 'inscrito')),
  -- Lo que leyó la IA y cada control ({ codigo, nombre, ok, detalle }).
  lectura jsonb,
  controles jsonb not null default '[]'::jsonb,
  motivo text,
  monto numeric,
  transaccion text,
  pagado_en timestamptz,
  -- Datos que mandó el cliente ({ campo_id: valor }); datos_leido = hasta qué mensaje suyo se leyeron.
  datos jsonb not null default '{}'::jsonb,
  datos_desde timestamptz,
  datos_leido timestamptz,
  rondas integer not null default 0,
  -- Lo que pediste desde la pantalla (confirmar o rechazar); lo hace el servidor.
  accion text check (accion in ('confirmar', 'rechazar')),
  intentos integer not null default 0,
  oportunidad_id uuid,
  avisado boolean not null default false,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists siguelo_pagos_empresa_idx on siguelo_pagos (empresa_id, estado, creado_en);
create index if not exists siguelo_pagos_transaccion_idx on siguelo_pagos (empresa_id, transaccion) where transaccion is not null;
create index if not exists siguelo_pagos_conversacion_idx on siguelo_pagos (conversacion_id);

-- La IA también manda el QR del curso, los mensajes del pago y activa reglas del bot (sección 27).
alter table siguelo_ia_salida drop constraint if exists siguelo_ia_salida_origen_check;
alter table siguelo_ia_salida add constraint siguelo_ia_salida_origen_check
  check (origen in ('respuesta', 'respuesta_rapida', 'grupo', 'pase', 'aviso', 'qr', 'pago', 'bot'));

-- ---------- 23. Permisos de la Fase 5 ----------
alter table siguelo_cursos enable row level security;
alter table siguelo_pagos enable row level security;

drop policy if exists "siguelo_cursos_select" on siguelo_cursos;
create policy "siguelo_cursos_select" on siguelo_cursos for select
  using (empresa_id = (select empresa_id from usuario_actual()));
drop policy if exists "siguelo_cursos_admin" on siguelo_cursos;
create policy "siguelo_cursos_admin" on siguelo_cursos for all
  using (empresa_id = (select empresa_id from usuario_actual()) and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[]))
  with check (empresa_id = (select empresa_id from usuario_actual()) and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[]));

-- Ver los pagos: cualquiera de la empresa. Confirmar o rechazar: supervisor o dueño.
drop policy if exists "siguelo_pagos_select" on siguelo_pagos;
create policy "siguelo_pagos_select" on siguelo_pagos for select
  using (empresa_id = (select empresa_id from usuario_actual()));
drop policy if exists "siguelo_pagos_update" on siguelo_pagos;
create policy "siguelo_pagos_update" on siguelo_pagos for update
  using (empresa_id = (select empresa_id from usuario_actual()) and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[]))
  with check (empresa_id = (select empresa_id from usuario_actual()) and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[]));

-- ---------- 24. Fotos y PDF de clientes que todavía no se revisaron ----------
-- De las últimas 48 h, en números de negocios con algún curso activo. La usa el servidor.
create or replace function siguelo_pagos_por_leer(p_empresa uuid)
returns table (
  mensaje_id uuid,
  conversacion_id uuid,
  linea_id uuid,
  telefono text,
  contacto_id uuid,
  tipo text,
  media_url text,
  contenido text,
  creado_en timestamptz
)
language sql
stable
set search_path = public
as $$
  select m.id, cv.id, cv.linea_id, cv.contacto_telefono, c.id, m.tipo::text, m.media_url, m.contenido, m.creado_en
  from mensajes m
  join conversaciones cv on cv.id = m.conversacion_id
  join lineas_whatsapp l on l.id = cv.linea_id and l.empresa_id = p_empresa
  left join siguelo_lineas sl on sl.linea_id = cv.linea_id
  left join contactos c on c.empresa_id = p_empresa and c.telefono = cv.contacto_telefono
  where m.remitente = 'cliente'
    and m.tipo in ('imagen', 'pdf')
    and m.media_url is not null
    and m.creado_en > now() - interval '48 hours'
    and not exists (select 1 from siguelo_pagos p where p.mensaje_id = m.id)
    and exists (
      select 1 from siguelo_cursos k
      where k.empresa_id = p_empresa and k.activo and (k.negocio_id is null or k.negocio_id = sl.negocio_id)
    )
  order by m.creado_en
  limit 10;
$$;

revoke execute on function siguelo_pagos_por_leer(uuid) from public, anon, authenticated;
grant execute on function siguelo_pagos_por_leer(uuid) to service_role;

-- =========================================================
-- La IA en el seguimiento y el asistente
-- La IA adapta cada recordatorio y reactivación a la conversación antes de
-- enviarlo, y un asistente responde tus preguntas y te propone cambios en la
-- configuración (se hacen solo cuando pulsas "Aplicar").
-- =========================================================

-- ---------- 25. La IA adapta los recordatorios y reactivaciones ----------
-- { activo, recordatorios, reactivaciones, instrucciones }: con activo, cada mensaje
-- se reescribe con la conversación y la ficha del negocio justo antes de salir.
-- Si la IA falla, sale el texto que escribiste.
alter table siguelo_ajustes
  add column if not exists adaptar jsonb not null default '{"activo": false, "recordatorios": true, "reactivaciones": true, "instrucciones": ""}'::jsonb;

-- ---------- 26. Conversación con el asistente ----------
create table if not exists siguelo_asistente (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas (id) on delete cascade,
  usuario_id uuid references usuarios (id) on delete set null,
  rol text not null check (rol in ('usuario', 'asistente')),
  texto text not null default '',
  -- Cambios que propone ({ tipo, descripcion, ... }); se hacen solo al pulsar "Aplicar".
  acciones jsonb not null default '[]'::jsonb,
  aplicado_en timestamptz,
  resultado text,
  creado_en timestamptz not null default now()
);
create index if not exists siguelo_asistente_empresa_idx on siguelo_asistente (empresa_id, creado_en);

-- La leen (y la borran) el supervisor y el dueño; la escribe el servidor.
alter table siguelo_asistente enable row level security;
drop policy if exists "siguelo_asistente_select" on siguelo_asistente;
create policy "siguelo_asistente_select" on siguelo_asistente for select
  using (empresa_id = (select empresa_id from usuario_actual()) and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[]));
drop policy if exists "siguelo_asistente_delete" on siguelo_asistente;
create policy "siguelo_asistente_delete" on siguelo_asistente for delete
  using (empresa_id = (select empresa_id from usuario_actual()) and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[]));

-- ---------- 27. Cuándo usa la IA cada respuesta rápida o regla del bot ----------
-- tipo 'respuesta' (respuestas_rapidas) o 'bot' (respuestas_automaticas). Con "cuándo", la IA
-- manda esa respuesta rápida en esa situación, o activa esa regla o flujo del bot
-- (además de sus palabras clave).
create table if not exists siguelo_cuando_ia (
  empresa_id uuid not null references empresas (id) on delete cascade,
  tipo text not null check (tipo in ('respuesta', 'bot')),
  item_id uuid not null,
  cuando text not null default '',
  actualizado_en timestamptz not null default now(),
  primary key (tipo, item_id)
);

alter table siguelo_cuando_ia enable row level security;
drop policy if exists "siguelo_cuando_ia_select" on siguelo_cuando_ia;
create policy "siguelo_cuando_ia_select" on siguelo_cuando_ia for select
  using (empresa_id = (select empresa_id from usuario_actual()));
drop policy if exists "siguelo_cuando_ia_admin" on siguelo_cuando_ia;
create policy "siguelo_cuando_ia_admin" on siguelo_cuando_ia for all
  using (empresa_id = (select empresa_id from usuario_actual()) and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[]))
  with check (empresa_id = (select empresa_id from usuario_actual()) and (select rol from usuario_actual()) = any (array['supervisor', 'dueno']::rol_usuario[]));

-- =========================================================
-- Tu sistema del club (Infinity Chess Gestión)
-- La IA consulta en vivo los horarios, cupos y precios de cada sucursal (con las
-- funciones públicas del sistema), y cada inscripción pagada queda como
-- "Reserva de vendedor" para que la confirmes con un clic. El CRM entra como un
-- vendedor (una cuenta que creas tú en tu sistema): solo puede hacer lo que hace
-- un vendedor.
-- =========================================================

-- ---------- 28. Conexión con el sistema del club ----------
-- Dirección y clave pública de su Supabase, y usuario/contraseña del vendedor del CRM.
-- Sin políticas: solo la lee el servidor (la página nunca ve la contraseña).
create table if not exists siguelo_club (
  empresa_id uuid primary key references empresas (id) on delete cascade,
  url text not null,
  clave_publica text not null,
  usuario text not null,
  contrasena text not null,
  actualizado_en timestamptz not null default now()
);
alter table siguelo_club enable row level security;

-- Lo que sí ve la página: si está conectado, con qué vendedor y las sucursales.
create table if not exists siguelo_club_info (
  empresa_id uuid primary key references empresas (id) on delete cascade,
  conectado boolean not null default false,
  vendedor text,
  sucursales jsonb not null default '[]'::jsonb,
  error text,
  actualizado_en timestamptz not null default now()
);
alter table siguelo_club_info enable row level security;
drop policy if exists "siguelo_club_info_select" on siguelo_club_info;
create policy "siguelo_club_info_select" on siguelo_club_info for select
  using (empresa_id = (select empresa_id from usuario_actual()));

-- Cada negocio del CRM es una sucursal del club.
alter table siguelo_negocios add column if not exists club_sucursal_id text;

-- Un curso "del club": al pagar, la inscripción queda como reserva en el sistema del club
-- (con precio 0, el monto lo decide el sistema del club y no se controla contra un precio fijo).
alter table siguelo_cursos add column if not exists club boolean not null default false;

-- El pago guarda los datos de la reserva ({ tutor, estudiantes: [{ nombre, fecha_nacimiento, grupo }] })
-- y el id y estado de la reserva en el club. "reservado" = espera que la confirmes en el club.
alter table siguelo_pagos
  add column if not exists club jsonb,
  add column if not exists club_reserva_id text,
  add column if not exists club_revisado_en timestamptz;
alter table siguelo_pagos drop constraint if exists siguelo_pagos_estado_check;
alter table siguelo_pagos add constraint siguelo_pagos_estado_check
  check (estado in ('leyendo', 'no_es', 'revisar', 'rechazado', 'datos', 'reservado', 'inscrito'));
