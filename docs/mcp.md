# Tu asistente (MCP): Claude, Aurora y otros

Veredicto es un servidor MCP en `https://TU-DOMINIO/mcp` (transporte HTTP). Tu asistente puede:

| Herramienta | Qué hace |
|---|---|
| `estado` | Qué corre ahora, cuánto llevas hoy y lo que viene |
| `iniciar` | Inicia algo (opcional: en un proyecto) |
| `parar`, `pausar`, `seguir` | El temporizador |
| `capturar` | Idea o nota a la bandeja (Notion/Obsidian) |
| `agenda` | Hoy y los próximos días |
| `proyectos`, `tareas` | Proyectos con minutos medidos; tareas abiertas |
| `crear_tarea`, `completar_tarea` | Tareas, con proyecto, minutos, fecha y Eisenhower |
| `agendar`, `armar_dia` | Bloques en tu calendario «Plan» |
| `registro` | Tiempo por proyecto en los últimos días |
| `actividad_computador` | Lo que vio ActivityWatch y lo sin registrar |

## 1. Crea el token
Ajustes → paso 6 → «Crear token del asistente». Ese token solo abre `/mcp` y los atajos: no ve tus cuentas ni tus ajustes.

## 2. Conéctalo

**Claude (escritorio y web):** Ajustes → Conectores → Agregar conector personalizado → URL `https://TU-DOMINIO/mcp?k=TU_TOKEN`. Necesita tu dirección pública (túnel).

**Claude Code:**
```sh
claude mcp add --transport http veredicto https://TU-DOMINIO/mcp --header "Authorization: Bearer TU_TOKEN"
```

**Programas con archivo de configuración (Cursor, Aurora, etc.):**
```json
{ "mcpServers": { "veredicto": { "command": "npx", "args": ["-y", "mcp-remote", "https://TU-DOMINIO/mcp", "--header", "Authorization: Bearer TU_TOKEN"] } } }
```
En tu red local también sirve `http://IP-DEL-NAS:8080/mcp`.

Para revocarlo: borra el token (o desde la base, tabla `api_tokens`).
