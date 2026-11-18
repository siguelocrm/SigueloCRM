-- DIAGNÓSTICO DEL SEGUIMIENTO (solo lee, no cambia nada).
-- En Supabase → SQL Editor: pega UNA consulta a la vez (de "-- 1" hasta su punto y coma), Run, y mándame la captura.

-- 1. Lo que salió cada día (últimos 14 días), por número
select (coalesce(c.cerrado_en, c.vence) at time zone 'America/La_Paz')::date as dia,
       l.nombre as numero,
       count(*) filter (where c.estado = 'enviado' and c.tipo = 'rec') as recordatorios,
       count(*) filter (where c.estado = 'enviado' and c.tipo = 'react') as reactivaciones,
       count(*) filter (where c.estado = 'enviado' and c.tipo = 'cita') as citas,
       count(*) filter (where c.estado = 'cancelado') as cancelados,
       count(*) filter (where c.estado = 'error') as con_error
from siguelo_cola c
join lineas_whatsapp l on l.id = c.linea_id
where c.estado <> 'pendiente' and coalesce(c.cerrado_en, c.vence) > now() - interval '14 days'
group by 1, 2
order by 1 desc, 2;

-- 2. Por qué se cancelaron o fallaron (últimos 14 días)
select c.estado, coalesce(c.motivo, '(sin motivo)') as motivo, count(*) as cuantos,
       max(c.cerrado_en) at time zone 'America/La_Paz' as ultima_vez
from siguelo_cola c
where c.estado in ('cancelado', 'error') and c.cerrado_en > now() - interval '14 days'
group by 1, 2
order by 3 desc
limit 30;

-- 3. Lo que está esperando ahora en la cola
select l.nombre as numero, c.tipo, count(*) as pendientes,
       count(*) filter (where c.vence <= now()) as ya_tocaban,
       min(c.vence) at time zone 'America/La_Paz' as el_mas_atrasado,
       count(*) filter (where s.respondio) as esperan_porque_respondio,
       count(*) filter (where s.pausado) as contacto_en_pausa
from siguelo_cola c
join lineas_whatsapp l on l.id = c.linea_id
left join siguelo_seguimientos s on s.contacto_id = c.contacto_id
where c.estado = 'pendiente'
group by 1, 2
order by 1, 2;

-- 4. Ajustes del seguimiento y cuántos salieron por día (para ver si se llegó al máximo)
select a.activo, a.pausado, a.motivo_pausa, a.hora_inicio, a.hora_fin, a.maximo_diario,
       a.pausa_min_seg, a.pausa_max_seg, a.min_entre_misma_persona_min, a.no_recordar_si_escribio_horas,
       (select string_agg(x.fecha::text || ': ' || x.total, ' · ' order by x.fecha desc)
          from (select fecha, sum(enviados) as total from siguelo_contador where empresa_id = a.empresa_id
                group by fecha order by fecha desc limit 14) x) as enviados_por_dia
from siguelo_ajustes a;

-- 5. Pausas y errores anotados (últimos 30 días)
select creado_en at time zone 'America/La_Paz' as cuando, tipo, texto
from siguelo_registro
where tipo in ('pausa', 'error')
order by creado_en desc
limit 25;
