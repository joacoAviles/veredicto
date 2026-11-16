# Notas: Obsidian y Notion

Cada casilla de tus notas es una **gestión** en Veredicto. Al marcarla en la app se marca en la nota, y al revés. Si la casilla tiene una fecha (`2026-11-20` o `📅 2026-11-20`, como en el plugin Tasks de Obsidian), queda como fecha límite.

```markdown
# Trámites
- [ ] Llamar al notario 📅 2026-11-20
- [ ] Renovar licencia
- [x] Pagar contribuciones
```

## Obsidian (o cualquier carpeta de .md)

Veredicto lee y escribe la carpeta directamente. Por defecto usa `datos/notas`. Para usar tu bóveda:

1. En `compose.yaml`, en el servicio `app`, agrega el volumen de tu bóveda:
   ```yaml
       volumes:
         - /volume1/Obsidian/MiBoveda:/datos/obsidian
   ```
2. `docker compose up -d`.
3. En Veredicto: **Ajustes → paso 3 → + Carpeta Markdown**, con la carpeta `/datos/obsidian`.

El usuario del contenedor (`PUID`/`PGID` en `.env`) tiene que poder escribir en esa carpeta. En Synology suele ser `1026:100`.

Para tener la misma bóveda en el iPhone, sincronízala con el servidor por otro camino: Syncthing (Möbius Sync en iOS), WebDAV del Synology con el plugin Remotely Save, u Obsidian Sync. Veredicto no depende de cuál uses.

Veredicto ignora `.obsidian`, `.trash` y `.git`. Escribe de forma atómica y solo cambia la línea de la casilla.

## Notion

1. Entra a [notion.so/profile/integrations](https://www.notion.so/profile/integrations) → **Nueva integración** (interna) → copia el token.
2. En Notion, en la página que contiene tus notas: **••• → Conexiones →** agrega tu integración. Todo lo que cuelga de esa página queda visible para Veredicto, y nada más.
3. En Veredicto: **Ajustes → paso 3 → + Notion**, con el token y el enlace de esa página.

Veredicto revisa las páginas editadas desde la última pasada y lee sus casillas (bloques «Lista de tareas»), incluidas las anidadas hasta 2 niveles.

### Base «Flujo»: de idea a tiempo en el calendario

Al conectar Notion, Veredicto crea bajo tu página la base **Flujo**. Cada fila es una idea, video, gestión o nota; el cuerpo de la página es la nota misma.

| Columna | Quién la llena | Para qué |
| --- | --- | --- |
| Nombre | Tú | El título |
| Tipo | Tú | Idea, Video, Gestión o Nota |
| Estado | Los dos | Bandeja → Idea → Por hacer → Agendada → En curso → Hecha (o Archivada) |
| Duración (min) | Tú | Cuánto bloque necesita (30 si la dejas vacía) |
| Agendar | Los dos | Fecha y hora del bloque en tu calendario |
| Minutos registrados | Veredicto | Suma de lo que mediste en esa fila |
| Última sesión | Veredicto | Cuándo trabajaste en ella por última vez |

El recorrido:

1. Capturas con Siri, Android o la app: aparece una fila con estado **Bandeja**.
2. En Notion la ordenas: tipo, duración, y la pasas a **Por hacer** (o tocas «Por hacer» en Gestiones).
3. **Armar mi día** la pone en el primer hueco libre de tu horario, sin pisar reuniones, y escribe la hora en **Agendar** (estado **Agendada**). Si tú pones fecha y hora en **Agendar**, se respeta la tuya. Si se la quitas, el bloque sale del calendario.
4. A esa hora el vigilante te avisa con el botón ▶. Lo que registras suma en **Minutos registrados**.
5. Al marcarla **Hecha** en la app o en Notion, queda igual en los dos lados.

No cambies el nombre de las columnas: Veredicto las busca por nombre.

## Bandeja

Lo que capturas con Siri, Android, el reloj o la app se agrega a la nota del día:

- Markdown: `Bandeja/AAAA-MM-DD.md`.
- Notion: una fila nueva en la base **Flujo** con estado «Bandeja».

Si conectas las dos, eliges a cuál va con «Las capturas van aquí».


## Las 9 bases del Juez del Tiempo
Con Notion conectado, en Ajustes → Notas eliges:

- **Usar mis bases del Juez:** busca tus «TimeMachine - …» (compártelas con la integración), importa pilares, proyectos, tareas, rutinas, sesiones, bloques del calendario e ideas, y desde ahí las mantiene al día.
- **Crear las 9 bases nuevas:** crea «Veredicto · Pilares», «Proyectos», «Tareas», «Ideas e Inbox», «Rutinas y hábitos», «Recurrencias», «Calendario», «Sesiones» y «Actividad y revisiones» bajo tu página, más una página «Veredicto · Cómo usar» con plantillas (video, gestión, revisión semanal, idea).

Las 9 bases se escriben desde Veredicto cada 2 minutos (máximo 60 filas por pasada) y sirven para mirar, filtrar y armar vistas. Lo que va en ambos sentidos es **Flujo**, que ahora también tiene la columna **Proyecto**: si eliges un proyecto en una fila, la tarea queda en ese proyecto. Los datos de ejemplo nunca se escriben en Notion.
