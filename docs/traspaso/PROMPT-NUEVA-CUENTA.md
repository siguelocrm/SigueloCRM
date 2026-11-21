# Prompt para la nueva cuenta de Claude

Abre Claude Code (claude.ai/code) con el repositorio **siguelocrm/SigueloCRM** y pega el texto de abajo
como primer mensaje.

---

```
Hola. Vengo de otra cuenta de Claude donde estuvimos trabajando en mi CRM. Necesito que sigas desde
donde quedamos.

QUIÉN SOY Y QUÉ ES EL PROYECTO
- SígueloCRM es mi CRM de WhatsApp: servidor Node/TypeScript con Baileys (server/), página React
  (client/) y Supabase (database/instalar.sql + database/siguelo.sql).
- Lo uso para mi club de clases, con 4 sedes que son 4 números de WhatsApp: Quillacollo, Cercado,
  El Alto y Online (Club Infinity Chess Online). También tengo una cuenta aparte para mi agencia de
  marketing, y mis clientes de la agencia tienen sus propias cuentas.
- Lo más importante para mí: que los mensajes lleguen, que la IA responda rápido con la info de cada
  negocio, y que los seguimientos y masivos salgan bien SIN arriesgar que WhatsApp restrinja mis
  números (ya me pasó una vez).

ANTES DE HACER NADA, LEE:
1. docs/traspaso/HISTORIAL-DEL-CHAT.md (todo lo que hicimos y lo que quedó abierto)
2. docs/traspaso/INDICACIONES.md
3. docs/SIGUELO-CONTINUAR.md (la guía técnica del proyecto)

CÓMO QUIERO QUE TRABAJES
- Háblame en español, de "tú", con explicaciones simples (no soy programador).
- No borres nada (ni datos, ni funciones, ni archivos) sin preguntarme.
- Yo pego el SQL en Supabase (SQL Editor → Run). Tú no tienes acceso a mi Supabase y no te voy a dar
  la clave de servicio. Cuando haga falta SQL nuevo, agrégalo como una sección numerada nueva al final
  de database/siguelo.sql y pásame solo esa parte para pegar.
- "Publicar" = hacer push a main (GitHub Actions lo sube solo a mi servidor). Antes de publicar:
  corre las pruebas (cd pruebas-siguelo && npm test), compila el servidor (cd server && npx tsc
  --noEmit -p .) y la página (cd client && npm run build). Publica solo si todo pasa, y revisa que
  la acción "Publicar CRM" haya terminado bien.
- Agrega una prueba para cada cosa que arregles o agregues.
- Si no estás seguro de la causa de un problema, dímelo, en vez de hacerme probar cosas a ciegas.
- Cuidado con WhatsApp: nada que mande muchos mensajes de golpe desde un número.

LO QUE QUEDÓ PENDIENTE
- Los ~50 mensajes que me llegaron la noche del 18 al 19 de noviembre con un número desconectado
  (restringido): todavía no aparecen en IA → "Chats que quedaron sin respuesta". La tarjeta ahora
  muestra qué pasó con el historial de WhatsApp de cada número. Te voy a mandar una captura de eso.
- Confirmar que pegué las secciones 43 a 47 de database/siguelo.sql.
- Me habían recomendado que las reactivaciones muy atrasadas se salten en vez de salir todas
  juntas. Quiero hacerlo.

Primero lee los documentos y dime en pocas líneas qué entendiste y qué propones hacer primero.
```
