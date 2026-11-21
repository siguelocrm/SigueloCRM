# Indicaciones y sugerencias para seguir con SígueloCRM

## 1. Al empezar con la nueva cuenta
1. En la nueva cuenta, conecta GitHub y dale acceso al repositorio **siguelocrm/SigueloCRM**
   (claude.ai → Settings → Connectors / GitHub).
2. Abre Claude Code con ese repositorio y pega el prompt de `docs/traspaso/PROMPT-NUEVA-CUENTA.md`.
3. Todo el trabajo está en `main` (y en la rama `claude/busy-fermi-hpha11`). No se perdió nada:
   - el código está en GitHub;
   - los datos están en tu Supabase;
   - los documentos de traspaso están en `docs/traspaso/`.
4. **No le des a ninguna cuenta de Claude tu clave de servicio de Supabase** (`SUPABASE_SERVICE_KEY`)
   ni la llave del servidor. Si alguna vez la pegaste en un chat, cámbiala en Supabase.

## 2. Pendientes tuyos (en este orden)
1. **Supabase → SQL Editor:** pega el archivo completo `database/siguelo.sql` y pulsa Run. Así te
   aseguras de tener hasta la sección 47 (es seguro volver a pegarlo entero).
2. **Los mensajes de la noche del 18 al 19:**
   1. Mira primero la Bandeja.
   2. Si no están, vincula ese número una vez más con código (Conexiones → Desvincular → Conectar →
      "Vincular con código").
   3. En IA → "Chats que quedaron sin respuesta", pulsa Revisar cada minuto, unas 3–4 veces.
   4. Mira qué dice debajo del número y mándale una captura a la nueva cuenta.
3. **El número que fue restringido**, en Seguimiento → Ajustes → "Cada número":
   - por 3–4 días: máximo **40–60 por día** y pausa de **90 a 180 segundos**;
   - después, sube de a poco.
4. **Supabase → Usage:** revisa en unos días si bajó el consumo (Egress y Log Ingestion). Si sigue
   pasado del plan gratis, pídele a Claude que revise qué consume más antes de pagar el Pro.

## 3. Para cuidar tus números de WhatsApp
- **Seguimiento, en general:** máximo **100–150 por número por día**, pausas de **60 a 180 segundos**
  entre mensajes.
- **Masivos:** tandas de 100–200 por día por número, mejor a gente que ya te escribió. Evita mandar
  masivos y seguimientos fuertes el mismo día desde el mismo número.
- **Número nuevo:** empieza bajo (20–40 por día) y sube de a poco durante 1–2 semanas.
- **Si WhatsApp restringe un número:**
  - páusalo solo a él ("Cada número" → Pausar);
  - deja que la IA responda solo a quien escribe;
  - cuando se levante, responde lo atrasado con "Chats que quedaron sin respuesta".
- **Pídele a la nueva cuenta** que haga que las **reactivaciones muy atrasadas se salten**, para que
  no vuelva a salir una ráfaga como la del 19 de noviembre.
- **Riesgo de fondo:** automatizar WhatsApp con un número normal va contra sus términos. Si el negocio
  crece mucho, considera la API oficial de WhatsApp Business (Meta), que no tiene este riesgo (tiene
  costo por conversación).

## 4. Buenas prácticas con Claude
- Pide **una cosa a la vez** y di qué esperas ver ("quiero que en la Cola salga X").
- Si algo no funciona, manda **captura + qué hiciste + a qué hora**. Ayuda mucho.
- Pide que **no publique si las pruebas fallan**, y que te diga cuándo terminó de instalarse
  ("Publicar CRM" en GitHub → Actions).
- Si Claude no está seguro de la causa, pídele que **agregue un diagnóstico visible en el CRM** antes
  de hacerte probar varias veces (como la tarjeta del historial).
- Cuando una conversación se vuelve muy larga, pídele que actualice `docs/SIGUELO-CONTINUAR.md` y
  `docs/traspaso/`, para no perder el hilo.

## 5. Seguridad
- Usa contraseñas distintas para la cuenta del club y la de la agencia, y activa la verificación en
  dos pasos de GitHub y de Supabase.
- Los clientes de la agencia solo ven su propia cuenta (está probado en `pruebas-siguelo/probar-sql.mjs`).
- Haz un respaldo de Supabase de vez en cuando (Database → Backups, o exportar las tablas
  importantes).
