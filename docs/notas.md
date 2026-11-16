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

## Bandeja

Lo que capturas con Siri, Android, el reloj o la app se agrega a la nota del día:

- Markdown: `Bandeja/AAAA-MM-DD.md`.
- Notion: una página «Bandeja» que Veredicto crea bajo tu página raíz.

Si conectas las dos, eliges a cuál va con «Las capturas van aquí».
