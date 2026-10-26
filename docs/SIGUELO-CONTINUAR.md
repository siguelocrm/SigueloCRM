# SígueloCRM: dónde quedamos y cómo seguir

Este archivo es para ti y para cualquier IA que siga el trabajo (otra cuenta de Claude u otra sesión).
Se actualiza al terminar cada fase. **Última actualización (26/10/2026): las Fases 1 a 5 están terminadas, más la IA que
adapta el seguimiento y el Asistente. Las Fases 3 en adelante todavía no tienen commit (mira `git log`).**

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
5. **Automatizar → Inscripciones → Cursos**: cada curso con su precio, la imagen del QR, el titular y número de cuenta,
   el link del grupo y los datos a pedir (los datos extra, como el carnet, se crean en **Administrar → Mi empresa**).
   Los comprobantes que lleguen se revisan solos; lo dudoso aparece en **Pagos** para que lo confirmes o rechaces, y en
   **Inscritos** ves cuántos y cuánto por mes (se puede bajar en Excel).
6. Prueba todo con un **número secundario** (automatizar WhatsApp tiene riesgo de bloqueo).

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
| 3 | IA que responde con la ficha: respuestas, respuestas rápidas, avisos a tu WhatsApp, pase entre sucursales, grupos | ✅ (sin commit todavía) |
| 4a | Palabras que cambian de etapa ("stop", "ya estoy"), frases parecidas para revisar, frases tuyas y deshacer | ✅ (sin commit todavía) |
| 4b | Citas con sus mensajes (antes y después de la cita) | ✅ (sin commit todavía) |
| 5 | Inscripción con pago: QR, la IA lee el comprobante, controles, datos a la ficha, link del grupo, reporte | ✅ (sin commit todavía) |
| + | La IA adapta cada recordatorio y reactivación a la conversación | ✅ (sin commit todavía) |
| + | Asistente: le preguntas y te propone cambios de configuración ("Aplicar") | ✅ (sin commit todavía) |

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
- `hooks.mjs` cambia `db.js` y `whatsapp/sesiones.js` por los de prueba; las pruebas fuerzan una URL de Supabase falsa.
- Pantallas: `npm run banco` y abre http://localhost:5199/banco?vista=seguimiento (o `negocios`, `embudo`, `ia`,
  `inscripciones`): la pantalla real con datos de ejemplo en memoria (`banco/mock-supabase.ts`).

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

### Pendientes conocidos e ideas
- El selector de etapa dentro del chat (curso: `HiloMensajes`/`PanelContacto`) lista etapas de todos los embudos.
- Dashboard y Reportes no separan por embudo.
- El seguimiento es uno por cliente (por el número de su chat principal).
- Las respuestas del Bot y lo escrito desde el teléfono cuentan como "le escribiste" (arrancan la reactivación).
- Pagos: no hay "esperar a que el dinero llegue al banco" (el otro proyecto lo tiene); los comprobantes en PDF dependen de
  que el modelo de OpenAI elegido acepte archivos.
- El Asistente todavía no crea cursos, etapas ni campos (dice en qué pantalla se hace).
