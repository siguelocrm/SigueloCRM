# SígueloCRM: todo lo que hace tu plataforma

SígueloCRM es tu CRM de WhatsApp. En un solo lugar atiendes los chats de todos tus números, la IA responde por ti
con la información de cada negocio, hace el seguimiento de cada cliente, cobra, inscribe y te avisa de lo importante.

Este documento explica **qué hace** cada parte, en palabras simples. Para el detalle técnico está
`docs/SIGUELO-CONTINUAR.md`.

---

## 1. Cómo está armado (en simple)

El CRM tiene tres partes:

| Parte | Qué es | Dónde vive |
|---|---|---|
| **El servidor** | Es el que está conectado a WhatsApp. Recibe y manda los mensajes y hace todo lo automático (IA, seguimiento, masivos, pagos). | En el servidor del curso (siguelocrm.app.mapse.club) o, por ahora, en tu compu (la ventana de PowerShell). |
| **La página** | Es lo que ves en Chrome: bandeja, contactos, ajustes. | En el mismo lugar que el servidor. |
| **La base de datos** | Guarda **todo**: contactos, chats, configuraciones, textos, negocios, ventas. | En **Supabase** (en internet, aparte). |

**Importante:**
- Tus datos y configuraciones están en Supabase. Si el servidor se cae, **no se pierden**.
- Lo automático solo funciona mientras el **servidor esté prendido**. Recargar o cerrar la página no lo apaga.
- Cada número de WhatsApp se vincula como un "dispositivo vinculado" de tu teléfono (como WhatsApp Web).

---

## 2. Cuentas, negocios y números

### Varias cuentas
- **Tu cuenta del club**: con tus 4 sedes (Quillacollo, Cercado, El Alto y Online / Club Infinity Chess Online).
- **Tu cuenta de la agencia de marketing**: aparte, con su propio usuario.
- **Las cuentas de tus clientes de la agencia**: cada una separada; ninguno ve lo de otro.
- Puedes **cambiar entre tus cuentas** (club ↔ agencia) con un botón, sin volver a escribir la contraseña.
- Puedes entrar con **usuario o correo**.

### Negocios (Administrar → Negocios)
Cada sede o negocio tiene su **ficha**:
- sus números de WhatsApp;
- dirección, horario y zonas;
- **información para la IA**: qué vendes, precios, lo que no debe decir;
- grupos de WhatsApp a los que la IA puede invitar;
- su propio embudo de ventas, si lo necesita;
- sus propias respuestas rápidas, bot y textos de seguimiento;
- horarios para **reuniones virtuales**, si quieres que la IA las agende.

### Números (Conexiones)
- Conectas cada número con **QR** o **con código** (sin QR, desde el mismo celular).
- Ves si cada número está conectado, conectando o desconectado.
- Un **vigía** revisa los números y los reconecta solo si se caen.

### Usuarios (Administrar → Usuarios)
- Tú eres el **Dueño principal**: nadie puede quitarte ese rol.
- Puedes crear Dueños de negocio, Gerentes y Vendedores.
- A cada uno le eliges **qué números ve** y **hasta cuándo** tiene acceso; al vencer se desactiva solo.
- Cada uno solo ve los chats de sus números y solo administra a los que están debajo de él.

---

## 3. Atender los chats

### Bandeja
- Todos los chats de todos tus números en un solo lugar, filtrados por número o negocio.
- Puedes responder, mandar fotos, audios y documentos, y usar respuestas rápidas.
- **Botón "Responder con IA"**: obliga a la IA a responder ese chat en ese momento, aunque ella sola no lo haría.
  Al lado te dice **por qué no respondió sola**.
- **Notas de voz**: la IA las pasa a texto y las responde. En la bandeja ves 🎤 con lo que dijo el cliente.
- Lo que escribes desde el teléfono también aparece en la bandeja.

### Contactos, embudo y oportunidades
- **Contactos**: la ficha de cada cliente, con sus datos, notas, etiquetas y documentos.
- **Embudo (Pipeline)**: tus clientes por etapa (Primer contacto, En negociación, Ganado, Venta perdida…).
  Cada negocio puede tener el suyo.
- **Oportunidades**: las ventas en curso de cada cliente.
- **Palabras que cambian la etapa**: si el cliente escribe "stop", "ya estoy inscrito", etc., cambia de etapa solo.
  Puedes revisar frases parecidas, agregar las tuyas y deshacer.

### Respuestas rápidas y bot
- **Respuestas rápidas**: textos guardados para mandar con un clic. Pueden tener **varios mensajes**
  (texto + imagen + texto…).
- **Bot de reglas y flujos**: respuestas automáticas por palabras clave y flujos de varios pasos.
- **"Cuándo la usa la IA"**: en cada respuesta rápida o regla del bot escribes cuándo usarla
  (por ejemplo: "el QR, cuando el cliente quiere inscribirse") y la IA la manda en ese momento.

### Otros
- **Hoy / Agenda / Tareas**: lo que tienes pendiente hoy y tus citas.
- **Mensajes programados**: dejas un mensaje listo para que salga a una hora.
- **Reportes y panel**: cuántos chats, ventas y resultados.

---

## 4. La IA que responde por ti

### Cómo responde
- Lee cada chat **unos segundos después** de que el cliente deja de escribir (para no cortarlo a la mitad).
- Responde con la **ficha del negocio** de ese número: precios, horarios, dirección, cursos.
- Puede mandar **respuestas rápidas**, activar el **bot**, invitar a **grupos** y **pasar al cliente a otra sede**
  si le queda mejor.
- Si está conectada a tu **sistema del club**, responde con **horarios, cupos y precios en vivo** de cada sucursal.
- Tiene dos modos:
  - **Para aprobar**: escribe la respuesta y tú la apruebas antes de que salga.
  - **Automática**: responde sola.

### Cuándo NO responde (a propósito)
- Si el mensaje del cliente es de **hace más de 2 horas**, por ejemplo porque el número estuvo desconectado.
  Así no sale todo de golpe.
- Si ya le escribió una persona, si hay un flujo del bot esperando respuesta o un pago en revisión.
- Si el chat tiene la IA apagada o está en "Venta perdida".

### "Chats que quedaron sin respuesta" (IA → arriba)
- Busca los chats de los **últimos 4 días** donde el cliente escribió último y nadie respondió.
- Al pulsar el botón, la IA los responde **de a uno, despacio** (45 a 90 segundos entre cada uno), cada número con su fila.
- Lo que escriben recién tiene prioridad.
- Debajo de cada número muestra **qué pasó con el historial** de WhatsApp al vincular: si lo mandó, cuántos mensajes
  trajo y cuántos se guardaron.
- **Límite:** solo puede responder lo que llegó al CRM. Si un mensaje llegó con el número desconectado y WhatsApp no lo
  mandó al volver a vincular, solo está en el teléfono.

### Avisos a tu WhatsApp
- La IA te avisa a tu WhatsApp personal de lo importante: ventas, pagos, preguntas que no sabe responder,
  reuniones agendadas.
- Cuando no sabe algo, te pregunta con un código. Respondes **"R12 tu respuesta"** y la IA lo usa y lo aprende.

### Asistente (IA → Asistente)
- Le preguntas lo que quieras sobre el CRM: "¿cómo funciona el seguimiento?", "¿por qué no salió un mensaje hoy?".
- **Preguntas sobre tus datos**: "¿cuántos respondieron en Cercado esta semana?". También se lo puedes preguntar
  **desde tu WhatsApp principal**.
- Le pides cambios con tus palabras ("pon las reactivaciones de 1, 3, 5 y 8 horas", "escríbeme los textos con la
  información de mi negocio"). Te muestra el cambio y **solo se hace cuando pulsas "Aplicar"**.
- Ve toda tu configuración: números, negocios, respuestas rápidas, bot.

---

## 5. Seguimiento automático (Automatizar → Seguimiento)

### Qué hace
Para que ningún cliente se enfríe, el CRM le escribe solo según la **etapa** en la que está:
- **Recordatorios**: mientras el cliente no responde (por ejemplo, al día 1, 3 y 5).
- **Reactivaciones**: después de que le escribiste, si el cliente deja de responder (por ejemplo, a las 1, 3, 5 y 8 horas).
- **Cambio de etapa solo**: si termina los recordatorios y pasan los días sin conversación, pasa a la etapa que elijas.
- **Textos por sede**: cada negocio puede tener sus propios textos. Si una etapa no tiene textos propios, usa los de otra
  (por ejemplo, "En negociación" usa los de "Primer contacto").
- **La IA adapta cada mensaje**: antes de mandarlo, lo reescribe para que siga lo que hablaron. Tu texto es la base.
  Si no corresponde mandarlo, lo salta.

### Citas
- Agendas citas y sus recordatorios salen solos (por ejemplo, 24 h, 1 h y 15 min antes) y también después de la cita.

### Cuidado de tus números
- **Cola por número**: cada número tiene su propia fila. Uno con muchos pendientes no atrasa a los demás.
- **Horario de envío**, **pausa al azar** entre mensajes y **máximo por día**, todo por número.
- **Cada número** (Ajustes → "Cada número"): sus propios límites y un botón **Pausar** solo para ese número.
  La IA sigue respondiendo; solo se frenan recordatorios y reactivaciones.
- **Mínimo entre dos mensajes** automáticos a la misma persona.
- **Reactivaciones atrasadas**: si una reactivación se atrasa más de lo que elijas (por defecto 12 h), se cancela.
- Si WhatsApp corta la conexión, reintenta con la conexión nueva. Si hay 3 errores seguidos, pausa ese número
  30 minutos.

### Para revisar
- **Cola**: qué va a salir, de qué número y a qué hora aproximada.
- **Registro**: qué salió, qué se canceló y por qué.
- **"¿Por qué no se programa?"**: te explica por qué a un contacto no le toca mensaje.

---

## 6. Mensajes masivos (Automatizar → Mensajes masivos)

- Eliges **desde qué número** y **a quiénes**: los que tienen chat con ese número, todos tus contactos o una lista pegada.
  Puedes filtrar por etapa y etiqueta. Por defecto no les llega a los de "Venta perdida".
- Escribes **2 o 3 versiones** del mensaje; a cada persona le llega una al azar. Puedes usar `{nombre}`, `{sucursal}`
  y adjuntar imagen o PDF.
- **"Enviar prueba"** a tu número antes de lanzarlo.
- Sale **de a uno**, con horario, pausa al azar y máximo por día por número.
- Lo puedes **pausar, reanudar o cancelar**, y ver a quién le llegó.
- Si se pausa solo por errores, te dice **el error exacto**.
- Un masivo **no** arranca el seguimiento como si fuera "le escribiste".

---

## 7. Cobros e inscripciones (Automatizar → Inscripciones)

### Cursos y pagos
- Cada curso tiene precio, **QR de pago**, titular y cuenta, link del grupo y los datos a pedir.
- Cuando el cliente manda la **foto o PDF del comprobante**, la IA lo lee y el CRM revisa monto, destinatario, fecha,
  transacciones repetidas y señales de edición.
- **Si está bien**: guarda el comprobante en la ficha, marca la venta como ganada, pide los datos que falten y manda el
  link del grupo.
- **Si hay dudas**: queda en **Pagos** para que lo revises y lo confirmes o rechaces.
- **Inscritos**: cuántos y cuánto por mes; se puede bajar en Excel.

### Tu sistema del club (Infinity Chess Gestión)
- La IA responde con horarios, cupos y precios **en vivo** de cada sucursal.
- Al pagar, junta los datos (tutor, niño, fecha de nacimiento, curso y horario) y deja una **reserva** en tu sistema.
- La confirmas con un clic y al cliente le llega el link solo.

### Tu Aula virtual
- La IA ofrece los **planes del aula en vivo**.
- Al pagar, elige el plan, **crea la cuenta del alumno** (o usa la que ya tiene), lo inscribe y le manda el link,
  su usuario y su contraseña.

---

## 8. Agencia de marketing (solo en tu cuenta de agencia)

- **Planes**: con o sin WhatsApp (con CRM o sin CRM), con sus límites.
- **Ventas**: registro de lo que vendiste; el cliente queda como ganado en tu cuenta.
- **Cuentas de clientes**: crear, vencer, pausar y cambiar contraseña. Una cuenta vencida o en pausa no ve nada
  y su IA, seguimiento y masivos se detienen.
- **Límites por cuenta**: 1 número y 1 negocio por defecto (ampliable o "sin límite").
- **La IA vende tus planes**: cuando un cliente paga, registra la venta, **crea su acceso** si el plan lo incluye,
  te avisa con todos los datos y le confirma al cliente con su usuario y contraseña. Si vuelve a pagar, se renueva.

---

## 9. Reuniones virtuales

- En la ficha del negocio eliges días, horas, duración, aviso mínimo y el link de la reunión.
- La IA **ofrece los horarios libres**, agenda, manda el link y te avisa.
- Recordatorios automáticos a las **24 h, 1 h y 15 min** antes.
- Si el cliente ya tenía una reunión, la cambia.

---

## 10. Redes sociales (Automatizar → Redes sociales)

- Conectas tus páginas de **Facebook** e **Instagram** (profesional).
- La IA **responde los comentarios** con la información del negocio.
- **Oculta o borra** los comentarios negativos.
- Lo que no sabe te lo pregunta a tu WhatsApp ("R12 …"), lo publica y lo aprende.
  Si no respondes en 6 horas, publica una respuesta que lleva a tu WhatsApp.
- **Pendiente**: los mensajes privados de Facebook e Instagram (falta la revisión de Meta).

---

## 11. Cuando un número se desconecta o lo restringen

- Lo que llega con el número desconectado queda **solo en el teléfono**.
- Al volver a vincular, WhatsApp manda una parte de lo reciente (historial). El CRM guarda lo de los últimos 4 días
  con su hora real, **sin** que la IA responda todo de golpe.
- Lo que WhatsApp entrega tarde al reconectar también se guarda con su hora real.
- Para responder lo atrasado: IA → **"Chats que quedaron sin respuesta"**.
- Si WhatsApp restringe un número: páusalo en "Cada número", deja que la IA responda solo a quien escribe y,
  cuando se levante, responde lo atrasado despacio.

---

## 12. Recomendaciones para cuidar tus números

- **Seguimiento**: máximo 100–150 por número por día, pausas de 60 a 180 segundos.
- **Masivos**: 100–200 por día por número, mejor a gente que ya te escribió. No mezcles masivos y seguimiento fuerte
  el mismo día desde el mismo número.
- **Número nuevo o que fue restringido**: empieza bajo (20–60 por día) y sube de a poco.
- **Riesgo de fondo**: automatizar WhatsApp con un número normal va contra sus términos. Si el negocio crece mucho,
  considera la API oficial de WhatsApp Business (Meta).

---

## 13. Publicación y respaldo

- Cada cambio del programa se publica solo al servidor (GitHub → Actions → "Publicar CRM").
- Antes de publicar se corren las pruebas automáticas (WhatsApp, OpenAI y base de datos falsos).
- Los cambios de la base de datos van en `database/siguelo.sql`; lo pegas entero en Supabase → SQL Editor → Run
  (es seguro repetirlo).
- **Si el servidor se cae**, puedes prender el CRM en tu compu (`npm run dev`) con todos tus datos. Hay que volver a
  vincular los números y apagarlo cuando el servidor vuelva, para que no respondan los dos a la vez.
