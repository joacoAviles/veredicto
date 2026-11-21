# Agentes (Hermes y otros)

Veredicto puede tener una cola de tareas para agentes de IA, además de las tuyas. Veredicto decide qué sigue y cuándo. Los agentes solo piden la siguiente tarea, trabajan y reportan. Tú apruebas.

Es un módulo **opcional** y viene apagado. Actívalo en **Ajustes → Módulos → Infraestructura y agentes de IA**. Si lo apagas, desaparece la pestaña y los tokens de agente dejan de funcionar; nada más cambia, y lo que había queda guardado para cuando lo vuelvas a encender.

Se ve en **Infra**, la pestaña de Infraestructura:

- **Tablero de agentes:** lo que espera tu OK, lo que está trabajando, lo bloqueado y la cola en orden. Desde ahí también creas tareas nuevas para un agente.
- **Agentes y conexión:** qué agentes se han reportado, las reglas de la cola y los tokens de agente.

También puedes delegar una tarea existente desde **Gestiones → Tareas** con el botón 🤖. Delegar marca la tarea en el cuadrante **Delegar** de Eisenhower si no tenía uno, y las tareas de agentes viven en tus mismos **proyectos**.

## Cómo se ordena la cola

1. Lo que vence en 3 días o menos (o ya venció).
2. Lo que es de un **proyecto foco** de la semana (hasta 5 de tus proyectos, en Infra → Reglas de la cola).
3. La **urgencia** de la tarea en la cola: P1 urgente, P2 importante, P3 normal, P4 cuando se pueda. Tus propias tareas siguen usando Eisenhower.
4. La más antigua.

Reglas de la cola:

- **Una tarea a la vez por carril** (configurable).
- **Carriles:**
  - **local:** tu modelo en casa, por ejemplo Ollama.
  - **cloud:** un proveedor pago. Una tarea cloud no corre hasta que tú la apruebas con el botón «OK cloud» o respondiendo que sí a tu asistente. El agente solo puede marcarla citando tu respuesta textual, que queda en el historial.
- **Ventana:** «solo de noche» espera al horario nocturno configurado (por defecto 00:00–07:00).
- **WhatsApp primero:** si un agente avisa que está conversando (`/api/agente/conversando`), el carril local no entrega tareas durante la pausa configurada (por defecto 3 minutos). Así el modelo queda libre para responder.
- Una tarea «trabajando» que pasa más de 90 minutos sin latido vuelve sola a la cola.

Estados: `cola → trabajando → revision → aprobada`. Desde ahí también puede pasar a `bloqueada` o a `rechazada`. Aprobar deja la tarea hecha; «Corregir» la devuelve a la cola con tu nota.

## Token de agente

En Infra → Agentes y conexión → «Crear token». Un token de agente (`jdg_…`) abre `/api/agente/…` y el servidor MCP (`/mcp`). No abre tus cuentas, tus ajustes ni los atajos. Puedes revocar cada token por separado en Ajustes → Tokens activos.

## MCP

Con Infraestructura encendida, el servidor MCP de Veredicto (ver [mcp.md](mcp.md)) suma `delegar`, `cola_agentes`, `aprobar_agente`, `corregir_agente` y `autorizar_cloud`. Esta última exige la respuesta textual del usuario y la deja en el historial. `disponibilidad` está siempre: dice si estás ocupado y hasta cuándo, para que tu asistente sepa si responder por ti.

## API

Usa el encabezado `Authorization: Bearer jdg_…`. Todas las rutas aceptan y devuelven JSON.

| Ruta | Qué hace |
| --- | --- |
| `GET /api/agente/contexto` | Si estás ocupado y hasta cuándo, qué viene, qué estás registrando, tus pendientes y lo que espera tu OK. Trae un campo `texto` listo para leer. |
| `GET /api/agente/agenda?dias=1` | Agenda (eventos de todos tus calendarios y bloques) de hoy o de N días. |
| `GET /api/agente/tareas?asignado=yo\|agente&estado=cola,revision&carril=&proyecto=&limite=` | Tareas, en el orden de la cola. |
| `POST /api/agente/tareas` | Crea una tarea: `{title, asignado, proyecto (nombre o id), eisenhower, prioridad, carril, ventana, due_date, detalle}`. |
| `PATCH /api/agente/tareas/:id` | Cambia campos o estado: `{estado, resultado, nota, prioridad, …}`. Para aprobar cloud: `{cloud_ok: true, confirmado_por: "<respuesta textual>"}`. |
| `GET /api/agente/tareas/:id/historial` | Qué hizo cada agente con la tarea. |
| `POST /api/agente/siguiente` | `{carril, agente}` → `{tarea}` o `{espera: "conversacion" \| "ocupado" \| "vacia"}`. |
| `POST /api/agente/latido` | `{agente, carril, modelo, maquina, estado, item_id}`. Aparece en Infra y mantiene viva su tarea. |
| `POST /api/agente/conversando` | `{minutos?}`: pausa el carril local. |
| `POST /api/agente/bloques` | `{title, inicio, fin, item_id?}`: agenda un bloque en tu calendario «Plan». |
| `POST /api/agente/capturar` | `{texto, tipo?}`: a la bandeja. |

## Hermes Agent (WhatsApp, Telegram…)

En [`integraciones/hermes/`](../integraciones/hermes/) está todo lo necesario:

- **Servidor MCP `veredicto`:** el instalador lo agrega a `~/.hermes/config.yaml`. Es como tu asistente lee la agenda, las tareas y la cola.
- **`vd`:** lo mismo desde la terminal (`vd contexto`, `vd delegar`, `vd aprobar`…).
- **Skills:** `veredicto` (asistente + mensajería + agenda) y `veredicto-trabajador`.
- **Hook `veredicto-whatsapp`:** cada turno de WhatsApp pausa el carril local.
- **`trabajador.py`:** toma una tarea y la corre con `hermes -p worker-local chat --oneshot`. Lo lanza launchd cada 2 minutos.
- **`avisos.py`:** un cron sin IA que te avisa por WhatsApp lo que espera tu OK.
- **`instalar.sh`:** instala todo lo anterior.

Funciona en macOS (con launchd) y en Linux (con systemd del usuario). Con `VEREDICTO_URL` y `VEREDICTO_TOKEN` ya en `~/.hermes/.env`:

```bash
git clone https://github.com/joacoAviles/veredicto
MODELO_LOCAL=qwen3.5:9b-64k DUENO="Tu nombre" bash veredicto/integraciones/hermes/instalar.sh
```

| Variable | Para qué |
| --- | --- |
| `MODELO_LOCAL` | El modelo de Ollama del carril local y de las rutinas. Hermes pide al menos 64K de contexto. Es obligatoria. |
| `DUENO` | Tu nombre, como lo usan las skills. |
| `CARPETA_TRABAJO` | Dónde dejan sus archivos los agentes. Por defecto `~/Veredicto-agentes`. |
| `CANAL` | Adónde llegan el brief y los avisos: `whatsapp` (por defecto), `telegram`, etc. |
| `CARRIL_CLOUD=no` | No instala el trabajador cloud. |

Después, en tu chat de ese canal, manda `/sethome` para que el brief y los avisos lleguen ahí.

Si antes activaste el Kanban de Hermes, apaga su despachador para no tener dos colas: pon `kanban.dispatch_in_gateway: false` en `~/.hermes/config.yaml`.
