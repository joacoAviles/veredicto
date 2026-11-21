# Cambios

## v3.1.0
- **Carpeta sincronizada**: tus tareas pendientes en un `.md` local (macOS, Linux, Windows), en ambos sentidos. Marcar, renombrar y crear desde el archivo, con proyecto (`## Proyecto`), fecha (`📅`) y Eisenhower (`[Hacer ya]`). Cliente sin dependencias en `integraciones/carpeta/` con `configurar` e `instalar` (launchd, systemd o el Programador de tareas). Tokens `jdc_…` que solo abren `/api/carpeta/…`.
- **Infraestructura (opcional, apagada por defecto)**: se activa en Ajustes → Módulos y agrega la pestaña Infra con las hojas «Tablero de agentes» y «Agentes y conexión». Es una cola de tareas para agentes de IA dentro de tus proyectos, con urgencia P1–P4, proyectos foco, carril local/cloud (cloud solo con tu OK) y ventana nocturna. Corre una tarea a la vez por carril y las abandonadas vuelven solas a la cola. Delegar marca «Delegar» en Eisenhower. Botón 🤖 en Tareas.
- **Mensajes primero**: mientras tu asistente conversa, el carril local no entrega tareas.
- **MCP**: nueva herramienta `disponibilidad` y, con Infraestructura, `delegar`, `cola_agentes`, `aprobar_agente`, `corregir_agente` y `autorizar_cloud`.
- **Tokens por alcance**: atajo (`jdt_`, atajos y MCP), agente (`jdg_`, `/api/agente` y MCP) y carpeta (`jdc_`). Ajustes muestra los tokens activos y permite revocarlos.
- **Hermes Agent** en `integraciones/hermes/`: servidor MCP, skills, hook de mensajería, trabajadores (launchd o systemd), comando `vd`, avisos sin IA e instalador con nombre, modelo, carpeta y canal configurables.

## v3.0.0
- **Proyectos y pilares** (como el Juez del Tiempo): tareas agrupadas, minutos medidos y de la semana, fecha límite, avance contra lo planificado y Eisenhower.
- **Las 9 bases de Notion**: crea las «Veredicto · …» o adopta tus «TimeMachine - …» e importa su historial; se mantienen al día solas. Flujo gana la columna Proyecto. Página guía con plantillas.
- **ActivityWatch**: lo que hiciste en el computador, sin tiempo inactivo, listo para registrar con un toque; los avisos dicen en qué app estás.
- **MCP** en `/mcp`: Claude, Aurora u otro asistente pueden ver tu estado, iniciar/parar, capturar, crear tareas, agendar y armar tu día.
- **Datos de ejemplo**: 3 semanas realistas que se cargan y se borran con un botón (nunca salen a tus calendarios ni a Notion).
- **Bienvenida nueva**: asistente paso a paso (avisos, calendarios, Notion, computador, atajos y asistente) con resumen final.
- La cookie de sesión es «Secure» solo si llegaste por https: ya no hace falta `COOKIE_SEGURA=0` para entrar por la IP local.

## v2.2.1
- El instalador y la restauración funcionan con `docker-compose` de Synology (Container Manager) además de `docker compose`.

## v2.2.0 — versión final
- Lo que cambias en la app sale a tus calendarios y notas en ~1 segundo; toda la sincronización corre en serie (sin dobles envíos).
- Borrar un registro lo saca también de «Veredicto · Registrado».
- Seguridad: los tokens de atajos solo abren `/api/atajo/…`; la entrada se bloquea tras 8 intentos fallidos; ids mal formados responden 404; proxy de confianza limitado a la red local.
- El feed de calendario ya no muestra bloques borrados; compartir desde Android vuelve a Gestiones.
- Teléfono: la hora va sobre el título en las listas y los formularios usan una columna.
- «Qué aprende el algoritmo» muestra solo rutinas y hábitos detectados.
- Las tareas hechas hace más de 30 días salen de la vista (siguen en la base).

## v2.1.0
- Base «Flujo» en Notion: de idea a bloque en el calendario y tiempo registrado de vuelta en la fila.

## v2.0.0
- Veredicto: calendarios (iCloud/CalDAV, Google, Outlook) y notas (Obsidian, Notion) en ambos sentidos, instalación tipo Immich, credenciales cifradas, respaldos.
