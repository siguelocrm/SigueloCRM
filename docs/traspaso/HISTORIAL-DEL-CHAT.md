# SígueloCRM — Historial del chat con Claude (hasta el 21 nov 2026)

Resumen de todo lo que se pidió, se hizo y quedó pendiente en la conversación con Claude Code
(rama `claude/busy-fermi-hpha11`, publicado siempre en `main`). Para el detalle técnico de cada
parte, ver `docs/SIGUELO-CONTINUAR.md` (la guía viva del proyecto).

---

## 1. El negocio y el proyecto

- **SígueloCRM**: CRM de WhatsApp propio. Servidor Node/TypeScript con Baileys (`server/`), página
  React (`client/`), base de datos Supabase (`database/instalar.sql` + `database/siguelo.sql`).
- Se publica solo: cada `git push` a `main` dispara GitHub Actions → "Publicar CRM", que compila y
  lo sube al servidor (un VPS). Se puede ver si terminó en la pestaña Actions de GitHub.
- **Cuentas que usa el dueño:**
  - Club de clases (ajedrez y otros cursos): sedes **Quillacollo, Cercado, El Alto** y **Online/virtual
    (Club Infinity Chess Online)**. Cada sede es un número de WhatsApp y un "negocio".
  - **Agencia de marketing**: cuenta aparte (otro usuario/correo), con botón para cambiar entre las
    dos. Los clientes de la agencia tienen cuentas totalmente separadas.
- **Prioridad del dueño:** que los mensajes lleguen, que la IA responda rápido con la información de
  cada negocio, y que los seguimientos y masivos salgan bien y sin riesgo para los números.
- **Forma de trabajar acordada:**
  - Hablar en español, de "tú", con explicaciones simples.
  - No borrar nada.
  - El dueño pega el SQL en Supabase (SQL Editor → Run); Claude no tiene acceso a Supabase y se
    recomendó **no darle la clave de servicio**.
  - "Publicar" = hacer push a `main`.

---

## 2. Lo que se hizo (en orden)

### Antes de este chat (ya estaba)
Bot y flujos, masivos con pausas/horario/tope, aula virtual (la IA vende planes del aula y crea la
cuenta del alumno), vigía que reconecta números caídos, avisos al WhatsApp del dueño, IA que responde
en segundos y explica por qué no responde, seguimiento por etapas con "¿Por qué no se programa?".

### En este chat
1. **Error 400 de OpenAI por emojis partidos** al recortar textos → arreglado (`siguelo/textos.ts`).
2. **Botón "Responder con IA"** en la Bandeja: obliga a la IA a responder ese chat (texto, respuesta
   rápida o lo que corresponda).
3. **Notas de voz**: la IA las pasa a texto y las responde (se ve 🎤 con la transcripción).
4. **Varias cuentas y sección Agencia**:
   - planes (con o sin WhatsApp), ventas, cuentas de clientes, accesos;
   - cambiar de cuenta solo entre las propias (club ↔ agencia);
   - entrar con usuario o correo.
5. **La IA vende y registra**: cuando un cliente paga, registra la venta, crea el acceso si el plan lo
   incluye, avisa al dueño con todos los datos y le confirma al cliente.
6. **Reuniones virtuales**: la IA ofrece horarios libres, agenda, manda el link y recordatorios a las
   24 h, 1 h y 15 min.
7. **Límites por cuenta**: 1 número y 1 negocio por defecto (ampliable o "sin límite").
8. **Preguntas sobre tus datos**: en IA → Asistente y desde tu WhatsApp principal ("¿cuántos
   respondieron en Cercado esta semana?").
9. **El asistente ve toda la configuración** (números, negocios, respuestas rápidas, bot).
10. **Respuestas rápidas con varios mensajes** (texto + imagen + texto…, como un flujo).
11. **Menos consumo de Supabase**: la cuota del plan gratis se había pasado (Log Ingestion y Egress).
    Se pasó a trabajar por eventos y con vueltas de respaldo más lentas.
12. **Confiabilidad del seguimiento y masivos**:
    - "Connection Closed" ya no pierde mensajes (reintenta con la conexión nueva);
    - nada queda trabado si WhatsApp no responde (límites de tiempo y candados que se liberan solos);
    - los masivos que se pausan dicen el error exacto.
13. **Cola por número**: cada número con su propia cola, pausa y errores (uno con muchos pendientes ya
    no atrasa a los demás); botones para ver la cola de cada número.
14. **"¿Por qué no se programa?"** cuenta los textos propios de cada sucursal y muestra qué usa cada
    sede en las etapas sin textos propios (por ejemplo "En Negociación" usa los de "Primer Contacto").
15. **Error grave de las 1000 filas** (19 nov): Supabase devuelve como mucho 1000 filas por consulta.
    El motor del seguimiento leía todos los contactos de una vez. Con más de 1000, cada minuto veía un
    grupo distinto y cancelaba o reprogramaba mensajes ("Ya no corresponde").
    - Ahora lee por partes.
    - Cada minuto revisa solo a los contactos con novedades.
    - Una vez por hora (o al cambiar textos o ajustes) revisa a todos.
    - Sección 46 del SQL. La pantalla de la Cola también contaba mal (se cortaba en 1000); arreglado.
16. **Restricción de WhatsApp (19 nov)**: un número quedó restringido ~5 h. Causa probable: al
    arreglar lo de las 1000 filas salió de golpe una ráfaga de reactivaciones atrasadas desde ese
    número (que solo tenía seguimientos, no masivos), con pausas de 10–20 s. A raíz de eso:
    - **Cada número con sus propios límites** (máximo por día, pausas) y **"Pausar" solo ese número**:
      Seguimiento → Ajustes → "Cada número" (sección 47).
    - **IA → "Chats que quedaron sin respuesta"**: responde despacio los chats donde el cliente escribió
      último y nadie contestó (últimos 4 días); uno por uno, 45–90 s entre cada uno, cada número con su
      propia fila a la vez; con los frenos de siempre. Lo que escriben recién tiene prioridad.
    - **Vincular con código (sin QR)** desde el mismo celular (Conexiones → Conectar → "¿Solo tienes
      este celular? Vincular con código").
    - **Historial al volver a vincular**: el CRM ahora guarda los mensajes que llegaron con el número
      desconectado (antes los ignoraba). También lo que WhatsApp entrega tarde al reconectar se guarda
      con su hora real, para que la IA no responda todo de golpe.

---

## 3. Lo que quedó abierto (importante)

### A. Los ~50 mensajes de la noche del 18 al 19 nov (número restringido)
- El número estuvo desconectado de ~20:00 del 18 a ~08:00 del 19. Esos mensajes quedaron solo en el
  teléfono.
- Se vinculó de nuevo varias veces, pero en "Chats que quedaron sin respuesta" seguían saliendo solo
  7 (los anteriores).
- Arreglos hechos en el camino:
  1. el historial antes se ignoraba;
  2. la hora venía en un formato (Long) que se descartaba;
  3. tardaba muchos minutos descargando fotos/audios;
  4. los mensajes "envueltos" (temporales) se descartaban;
  5. la ventana pasó de 48 h a 4 días.
- **No se confirmó todavía si funciona.** Desde el 20 nov la tarjeta muestra, debajo de cada número,
  qué pasó con el historial (si WhatsApp lo mandó, cuántos mensajes trajo, cuántos se guardaron,
  errores).
- **Siguiente paso:**
  1. Revisar primero la Bandeja (puede que ya estén).
  2. Si no están, vincular una vez más con código.
  3. Pulsar "Revisar" varias veces y mirar ese texto.
  4. Si dice "WhatsApp no mandó historial", el límite es de WhatsApp: responder desde el teléfono.

### B. Pendientes de confirmar con el dueño
- Que estén pegadas en Supabase las secciones **43 a 47** de `database/siguelo.sql` (la 46 y la 47 son
  las últimas). Es seguro volver a pegar el archivo completo.
- Resultados de las consultas de diagnóstico 1–4 (`docs/diagnosticos/seguimiento.sql`) y el error del
  masivo que se pausó a las 15:24 del 18 nov (no llegaron).
- Revisar el uso de Supabase (Usage) unos días después de los cambios. El ciclo terminaba el 25 nov; la
  restricción por cuota iba a ser desde el 15 dic si seguía pasado.

### C. Ideas ofrecidas y no hechas (el dueño no respondió)
- Que las reactivaciones con **muchas horas de atraso se salten** en vez de salir juntas (para que no
  se repita la ráfaga del 19 nov). **Recomendado hacerlo.**
- Filtro por número en el Registro del seguimiento.
- La pantalla de Reuniones del negocio no se revisó visualmente (sí sus pruebas).

---

## 4. Datos técnicos útiles

- **Pruebas:** `cd pruebas-siguelo && npm test` (15 grupos, base en memoria PGlite, WhatsApp y OpenAI
  falsos).
  - Antes de publicar, deben pasar todas.
  - `db.maxFilas` en `mock-db.mjs` simula el tope de 1000 filas.
  - `integracion-historial.mts` prueba el historial.
- **Compilar:** `cd server && npx tsc --noEmit -p .` y `cd client && npm run build` (y `npm run lint`).
- **Tiempos del servidor** (`server/src/siguelo/index.ts`):
  - motor: 1 min en horario (5 min fuera), con vuelta completa cada hora;
  - cola: se programa sola (mín. 3 s, 20 s sin nada);
  - lector de la IA: por eventos, con respaldo cada 2 min;
  - salida: 20 s;
  - pagos: 1 min;
  - masivos: 5 s si hay uno en marcha, si no 1 min.
- **SQL:** cada sección de `database/siguelo.sql` está numerada; las nuevas van al final y se pueden
  volver a pegar sin romper nada (lo prueba `pruebas-siguelo/probar-sql.mjs`).
- **Diagnóstico con datos reales:** `docs/diagnosticos/seguimiento.sql`.
