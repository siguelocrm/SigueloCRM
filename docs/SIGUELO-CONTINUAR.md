# SígueloCRM: dónde quedamos y cómo seguir

Este archivo es para ti y para cualquier IA que siga el trabajo (otra cuenta de Claude u otra sesión).
Se actualiza al terminar cada fase. **Última actualización (29/10/2026): las Fases 1 a 5 están terminadas, más la IA que
adapta el seguimiento, el Asistente, el "cuándo la usa la IA" de respuestas rápidas y del bot, y la conexión con tu
sistema del club (Infinity Chess Gestión), y los usuarios con jerarquía, números por persona y vencimiento. El CRM ya
está publicado en https://siguelocrm.app.mapse.club (el usuario hace el push). Mira `git log` para ver qué está guardado.**

---

## 1. Lo que tienes que hacer tú

### Cada vez que cambie `database/siguelo.sql`
1. Entra a tu Supabase → **SQL Editor**.
2. Pega **todo** el archivo [`database/siguelo.sql`](../database/siguelo.sql) y pulsa **Run**.
   Es seguro repetirlo: no borra nada y agrega lo nuevo.

### Para usar el CRM en tu compu
```bash
npm install
```
```bash
npm run dev
```
Entra a http://localhost:5173. Los envíos automáticos los hace el **servidor**: tiene que estar prendido (`npm run dev`).

### Configurar, en este orden
1. **Administrar → Negocios**: un negocio por sucursal y uno por cada negocio distinto. En cada ficha: sus números,
   dirección, horario, zonas, **información para la IA** (qué vendes, precios, lo que no debe decir) y los grupos de
   WhatsApp a los que la IA puede invitar. En **Embudos**, el embudo propio del negocio que lo necesite.
2. **Automatizar → IA → Ajustes**: pega tu clave de OpenAI ("Guardar y probar"), deja el modo **Para aprobar** al
   principio y prueba en **Probar** con preguntas reales. Cuando te gusten las respuestas, pásalo a **Automática**.
3. **Automatizar → IA → Asistente**: pregúntale lo que quieras ("¿cómo funciona el seguimiento?", "¿por qué no salió un
   mensaje hoy?") o pídele cambios con tus palabras ("pon las reactivaciones de 1, 3, 5 y 8 horas y los recordatorios al
   día 1, 3 y 5", "escríbeme los textos con la información de mi negocio"). Te muestra los cambios y se hacen **solo
   cuando pulsas "Aplicar"**.
4. **Automatizar → Seguimiento**: revisa los mensajes por etapa (o pídeselos al Asistente) y actívalo en **Ajustes**.
   Ahí mismo, **"La IA adapta cada mensaje a la conversación"**: antes de enviar cada recordatorio o reactivación, la IA
   lo reescribe para que siga lo que hablaron (tu texto es la base). En **Citas** agendas citas y sus recordatorios salen solos.
5. **Administrar → Negocios → Respuestas rápidas / Bot**: en cada una puedes escribir **"Cuándo la usa la IA"** (por
   ejemplo, el QR "cuando el cliente quiere inscribirse"). La IA la manda, o activa esa regla o flujo del bot, en esa situación.
6. **Tu sistema del club** (Automatizar → Inscripciones → **Sistema del club**):
   1. En tu sistema del club, **Vendedores** → crea un vendedor para el CRM (ej. "WhatsApp") con acceso a todas las sucursales.
   2. En el **Supabase de tu sistema del club** → Project Settings → API: copia la **Project URL** y la clave **anon public**.
   3. Pégalos en "Sistema del club" con el usuario y la contraseña de ese vendedor → **Conectar y probar**.
   4. En **Administrar → Negocios**, en cada negocio elige su **sucursal del club**: desde ahí la IA responde con los
      horarios, cupos y precios en vivo de esa sucursal.
   5. En **Inscripciones → Cursos**, crea un curso con **"Dejar la inscripción como reserva en mi sistema del club"** (precio 0
      si el total depende de cuántos cursos toma), con el QR y el link del grupo.
   Al pagar, la IA junta el nombre del tutor, del niño, su fecha de nacimiento y el curso y horario, y deja la reserva en
   **Reservas de vendedores** de tu sistema. La confirmas con un clic y al cliente le llega el link solo.
7. **Automatizar → Inscripciones → Cursos** (cursos que no son del club): precio, QR, titular y cuenta, link del grupo y los
   datos a pedir (los datos extra, como el carnet, se crean en **Administrar → Mi empresa**). Lo dudoso aparece en **Pagos**,
   y en **Inscritos** ves cuántos y cuánto por mes (se puede bajar en Excel).
8. **Administrar → Usuarios**: tú eres el **Dueño principal** (el primer usuario de la empresa: nadie puede editarte ni
   quitarte el rol). Crea Dueños de negocio, Gerentes y Vendedores; a cada uno le eliges sus **números** (todos, algunos o
   ninguno) y **hasta cuándo** tiene acceso (1 mes, 1 año, una fecha). Cada uno solo administra a los que están debajo de él
   y solo ve los chats de sus números. Al vencer, queda desactivado solo; para renovarlo, cambia la fecha.
9. Prueba todo con un **número secundario** (automatizar WhatsApp tiene riesgo de bloqueo).

### Guardar el trabajo (git)
Pídele a la IA: *"haz el commit de lo que hay (sin push)"*. No hagas `git push` mientras no tengas la ficha del profe o tu
propio servidor: GitHub intentaría publicar y fallaría (no rompe nada, pero da error).

---

## 2. Cómo seguir con otra cuenta (cuando se acaben los créditos)

1. **Antes de cambiar**, si puedes, pide: *"haz el commit de lo que hay (sin push)"*. Si no alcanzas, no pasa nada: los
   archivos quedan en tu compu igual, y la otra cuenta los ve.
2. En la app de Claude, **cierra sesión** y entra con la otra cuenta (o usa Claude Code en una terminal y escribe `/login`).
3. Abre **esta misma carpeta** del proyecto (`SigueloCRM`).
4. Pega este mensaje:

> Lee `docs/SIGUELO-CONTINUAR.md` y continúa desde ahí. Primero mira `git status` y `git log -5`, y corre las pruebas
> (`cd pruebas-siguelo`, `npm install`, `npm test`). Explícame en español, con "tú", paso a paso: no soy programador.
> No hagas `git push` ni pegues nada en mi Supabase: eso lo hago yo.

Con otra IA que no sea Claude sirve lo mismo, siempre que pueda leer y editar los archivos de esta carpeta.

---

## 3. Estado de cada fase

| Fase | Qué es | Estado |
|---|---|---|
| 1 | Seguimiento: recordatorios y reactivación por etapa, cola segura (horario, tope y pausas **por número**) | ✅ commit `e6edea0` |
| 2 | Negocios por número: ficha, embudos propios, respuestas rápidas, bot y textos por negocio | ✅ commit `1d877ff` |
| 3 | IA que responde con la ficha: respuestas, respuestas rápidas, avisos a tu WhatsApp, pase entre sucursales, grupos | ✅ commit `644d2d9` |
| 4a | Palabras que cambian de etapa ("stop", "ya estoy"), frases parecidas para revisar, frases tuyas y deshacer | ✅ commit `644d2d9` |
| 4b | Citas con sus mensajes (antes y después de la cita) | ✅ commit `644d2d9` |
| 5 | Inscripción con pago: QR, la IA lee el comprobante, controles, datos a la ficha, link del grupo, reporte | ✅ commit `644d2d9` |
| + | La IA adapta cada recordatorio y reactivación a la conversación | ✅ commit `644d2d9` |
| + | Asistente: le preguntas y te propone cambios de configuración ("Aplicar") | ✅ commit `644d2d9` |
| + | "Cuándo la usa la IA" en respuestas rápidas y reglas/flujos del bot | ✅ commit `7297fd0` |
| + | Sistema del club: horarios, cupos y precios en vivo; inscripción pagada → reserva de vendedor | ✅ commits `7297fd0` y `6fbb92d` |
| + | Usuarios: dueño principal, jerarquía, números por persona, vencimiento; el servidor pide sesión y acceso al número | ✅ (ver `git log`) |
| ⏳ | Clientes que compran el CRM, planes y cobros | por decidir (ver "Pendientes") |
| ⏳ | Facebook / Instagram (comentarios y mensajes) | por decidir (ver "Pendientes") |

---

## 4. Para la IA que continúe

### Reglas del proyecto
- Es el CRM de un **curso** (repo del profe). Para poder seguir trayendo sus mejoras, **todo lo nuevo va aparte** y los
  archivos del profe se tocan lo mínimo. Prefijo `siguelo_` en tablas.
- Lo nuevo vive en:
  - `database/siguelo.sql` — un solo archivo, **idempotente** (`if not exists`, `drop policy if exists`...), con secciones
    numeradas (1–26). El usuario lo vuelve a pegar entero en Supabase. Nunca tocar `instalar.sql`, `actualizar.sql` ni `esquema_version`.
  - `server/src/siguelo/` (motor, cola, citas, palabras, negocios, `ia/`, `pagos/`) — con su propio cliente tipado `db.ts`.
  - `client/src/features/seguimiento/`, `negocios/`, `ia/`, `inscripciones/`.
- Archivos del profe tocados (pocas líneas cada uno): `server/src/index.ts` (arranque y router de la IA),
  `server/src/whatsapp/bot-automatico.ts` (reglas por número), `client/src/features/bandeja/constantes.ts` y `Bandeja.tsx`
  (secciones Seguimiento, IA, Inscripciones, Negocios y filtro de respuestas por negocio), `client/src/features/pipeline/Pipeline.tsx`.
- El usuario **no es programador**: español con "tú" (Bolivia, America/La_Paz). Explicar en pasos simples.
- **No** hacer `git push` (dispara el workflow del curso, que falla sin secretos). **No** ejecutar SQL en su Supabase.
  Commit solo cuando lo pida.

### Cómo probar sin tocar nada real
```bash
cd pruebas-siguelo
npm install
npm test
```
- `calculo.test.mts`: horarios, textos y cálculo del embudo.
- `probar-sql.mjs`: instala `instalar.sql` + `siguelo.sql` en un Postgres en memoria (PGlite): permisos, disparadores, volver a pegar.
- `integracion.mts`: motor + cola del seguimiento, negocios, palabras y citas, con WhatsApp y reloj falsos.
- `integracion-ia.mts`: la IA con una OpenAI falsa (respuestas, respuestas rápidas, avisos, pases, grupos, errores).
- `integracion-pagos.mts`: comprobantes (confirmar, pedir datos, link, rechazos, revisar, QR, reintentos).
- `integracion-asistente.mts`: la IA que adapta el seguimiento y el asistente (proponer y aplicar cambios).
- `integracion-club.mts`: el sistema del club con un club falso (conectar, horarios en vivo, reserva, aprobada/rechazada).
- `integracion-usuarios.mts`: jerarquía, números por persona y vencimiento (reglas del servidor).
- `hooks.mjs` cambia `db.js` y `whatsapp/sesiones.js` por los de prueba; las pruebas fuerzan una URL de Supabase falsa.
- Pantallas: `npm run banco` y abre http://localhost:5199/banco?vista=seguimiento (o `negocios`, `embudo`, `ia`,
  `inscripciones`): la pantalla real con datos de ejemplo en memoria (`banco/mock-supabase.ts`).
- `mock-bot.mjs` reemplaza al bot del profe en las pruebas (anota qué regla o flujo activó la IA).

### Cómo funciona (resumen)
- **Seguimiento** (`motor.ts`, `cola.ts`): cada 60 s el motor revisa los contactos en etapas con mensajes (función SQL
  `siguelo_actividad`), detecta "respondió" / "le escribiste", aplica las palabras (`palabras.ts`) y deja en `siguelo_cola`
  lo que toca. La cola (cada 5 s) envía uno por número por vuelta, con horario, pausa al azar, tope diario y mínimo por
  persona contados por número. Las citas (`citas.ts`) van por la misma cola con prioridad y su propia franja.
- **Adaptar** (`ia/adaptar.ts`): si `siguelo_ajustes.adaptar.activo`, la cola le pasa a la IA el texto elegido, la ficha
  del negocio y los últimos 20 mensajes; sale lo que devuelve. Si dice que no corresponde, el paso se cancela (y se salta);
  si falla, sale el texto original.
- **Negocios** (`negocios.ts`): número → negocio (ficha). Embudos propios con `siguelo_etapa_embudo`; un disparador
  pone a cada contacto nuevo en el embudo de su negocio. Textos de seguimiento propios por negocio (`siguelo_etapas.negocio_id`).
- **IA** (`ia/`): `lector.ts` lee cada conversación 45 s después de que el cliente deja de escribir
  (`siguelo_ia_por_leer`), llama a OpenAI (`openai.ts`, JSON) con la ficha (`contexto.ts`) y decide; `salida.ts` envía lo que
  quedó en `siguelo_ia_salida` (o espera aprobación si es "borrador"). También manda el QR de un curso (origen `qr`).
  La clave está en `siguelo_ia_clave` (sin permisos para la página; solo la escribe el servidor por `/siguelo/ia/clave`).
- **Pagos** (`pagos/`): cada 10 s, `inscripcion.ts` toma las fotos/PDF nuevas de clientes en números con cursos
  (`siguelo_pagos_por_leer`), las manda a la IA con visión, y `comprobante.ts` decide sin IA (monto, destinatario, fecha,
  transacción repetida, señales de edición). Confirmado → documento en la ficha, oportunidad ganada, etapa ganada, pide los
  datos (`campos_personalizados` / `contacto_campos`) y manda el link. Los mensajes salen por `siguelo_ia_salida` (origen `pago`).
  Mientras hay un pago en curso, el lector no le responde a ese cliente. Desde la pantalla se pide `accion` = confirmar/rechazar.
- **Asistente** (`ia/asistente.ts`, rutas `/siguelo/ia/asistente` y `/aplicar`): arma el estado real (etapas con sus
  textos, ajustes, negocios, IA, cursos, registro) más un manual del CRM; la IA responde y propone acciones (`secuencia`,
  `seguimiento`, `adaptar`, `ia`, `ficha`, `palabras`) que se validan en el servidor y se guardan en `siguelo_asistente`.
  Se hacen solo con "Aplicar" (una sola vez).

- **Cuándo la usa la IA** (`siguelo_cuando_ia`, sección 27): el texto de cada respuesta rápida o regla del bot va al prompt
  del lector; la IA devuelve `bot` y `salida.ts` lanza la regla con `enviarPasos` / `iniciarFlujo` del bot del profe
  (origen `bot`). Si un flujo espera la respuesta del cliente (`bot_sesiones`), el lector no responde.
- **Sistema del club** (`club/`, sección 28): `club.ts` llama a las funciones públicas del club (`publico_sucursales`,
  `publico_cursos` con el cupo de cada grupo, `publico_tarifas`) y, como vendedor (correo `usuario@usuarios.infinitychess.local`),
  a `vendedor_yo`, `vendedor_reservar` y `vendedor_reservas`, y sube la foto al almacenamiento `reservas`. La clave y la
  contraseña están en `siguelo_club` (sin permisos para la página). `pagos/reserva.ts` arma la reserva igual que el panel de
  vendedores (total sugerido con las tarifas, celular sin 591, fecha de inicio). En `inscripcion.ts`, un curso con `club`
  junta los datos (`completarClub`), deja la reserva (`crearReserva`, estado `reservado`) y cada 2 min revisa si la
  aprobaste (`revisarReservas`) para mandar el link.

- **Usuarios** (`usuarios/`, secciones 29 a 31): `siguelo_accesos` guarda jefe, dueño principal, números y vencimiento.
  Las funciones `siguelo_ve_linea`, `siguelo_ve_contacto`, `siguelo_es_subordinado` y `siguelo_nivel` reemplazan los
  permisos del curso (contactos, chats, mensajes, programados, números y usuarios); `usuario_actual()` ahora no devuelve
  a un usuario desactivado o vencido. En el servidor, `usuarios/rutas.ts` crea/edita/elimina con la jerarquía y
  `usuarios/proteger.ts` (`conNumero`) exige sesión y acceso al número en `/enviar`, `/etiquetas`, `/lineas/*` y el bot;
  la página manda el token con `conSesion()` (lib/backend.ts). La ruta del curso `POST /usuarios` quedó cerrada (410).

### Pendientes conocidos e ideas
- El selector de etapa dentro del chat (curso: `HiloMensajes`/`PanelContacto`) lista etapas de todos los embudos.
- Dashboard y Reportes no separan por embudo.
- El seguimiento es uno por cliente (por el número de su chat principal).
- Las respuestas del Bot y lo escrito desde el teléfono cuentan como "le escribiste" (arrancan la reactivación).
- Pagos: no hay "esperar a que el dinero llegue al banco" (el otro proyecto lo tiene); los comprobantes en PDF dependen de
  que el modelo de OpenAI elegido acepte archivos.
- El Asistente todavía no crea cursos, etapas ni campos (dice en qué pantalla se hace).
- **Vender el CRM a clientes (planes, cobros):** el CRM del curso tiene una sola empresa, y la configuración (IA y su clave,
  seguimiento, negocios, cursos) es de toda la empresa. Para vender a otros negocios hay que decidir: un CRM aparte por
  cliente (como lo diseñó el curso), o pasarlo a varias empresas (cambio grande). Por ahora, los "Dueños de negocio" son
  para tu propio equipo o socios, no para clientes ajenos.
- **Redes sociales:** Facebook e Instagram se pueden conectar con una App de Meta (comentarios: responder, ocultar o
  borrar; mensajes: responder dentro de 24 h). TikTok no da acceso a comentarios ni mensajes a cuentas comunes.
- Sistema del club: si el comprobante llega en PDF, la reserva queda sin foto y con "pagado por QR" en 0 (la nota lo dice);
  el total sugerido es aproximado (tu sistema lo recalcula al registrar). Una reserva es de una sucursal.
