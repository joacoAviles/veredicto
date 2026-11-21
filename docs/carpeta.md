# Carpeta sincronizada

Tus tareas pendientes de Veredicto en un archivo Markdown de tu computador. Por ejemplo, Veredicto corre en el NAS y la carpeta está en tu Mac. Sirve con Obsidian, VS Code o cualquier editor, y sincroniza en ambos sentidos cada 2 minutos.

```markdown
# Tareas pendientes

## Trabajo
- [ ] Revisar facturas [Hacer ya] 📅 2026-12-01 ^vd-1a2b3c4d
- [ ] Llamar al contador ^vd-9f8e7d6c

## Sin proyecto
- [ ] Renovar dominio ^vd-0a1b2c3d
```

| En el archivo | En Veredicto |
| --- | --- |
| Marcas `[x]` | La tarea queda hecha. Si venía de tus notas o de Notion, también se marca allá. |
| Cambias el texto | Se renombra la tarea. Solo aplica a tareas creadas en la app o en la carpeta: las casillas de tus notas se editan en su nota. |
| Agregas `- [ ] algo` bajo un `## Proyecto` | Se crea en ese proyecto. Si el proyecto no existe, se crea. `📅 AAAA-MM-DD` es la fecha límite y `[Hacer ya]`, `[Agendar]`, `[Delegar]` o `[Eliminar]` el cuadrante de Eisenhower. |
| Borras una línea | No pasa nada: vuelve en la próxima pasada. Para quitarla, márcala hecha o archívala en la app. |

Lo que haces en Veredicto, en tu teléfono o en tus notas aparece en el archivo en la próxima pasada. El `^vd-…` al final de cada línea es el id de la tarea; Obsidian lo oculta en la vista de lectura. No lo borres.

## Instalar

Necesitas Python 3.8 o más nuevo; no hace falta instalar paquetes.

1. En Veredicto → **Ajustes → Carpeta sincronizada → Crear token** (uno por computador). Empieza con `jdc_` y solo sirve para esto.
2. En tu computador:

   ```bash
   curl -fsSLo veredicto-carpeta.py https://raw.githubusercontent.com/joacoAviles/veredicto/main/integraciones/carpeta/veredicto-carpeta.py
   python3 veredicto-carpeta.py configurar --url https://veredicto.tudominio.cl --token jdc_… --carpeta ~/Tareas
   python3 veredicto-carpeta.py instalar
   ```

`instalar` deja una pasada cada 2 minutos:

| Sistema | Cómo queda |
| --- | --- |
| macOS | launchd. El registro queda en `~/Library/Logs/veredicto-carpeta.log`. |
| Linux | Un timer de systemd del usuario. |
| Windows | El Programador de tareas (en Windows usa `py` en vez de `python3`). |

Si no quieres instalar nada, deja `python3 veredicto-carpeta.py --cada 60` corriendo.

- **Un archivo por proyecto:** agrega `--por-proyecto` a `configurar`. Se escribe `Trabajo.md`, `Casa.md`, etc. Un `.md` nuevo que crees en la carpeta pasa a ser un proyecto.
- **En tu red, sin dominio:** usa `--url http://IP-del-NAS:8080`. Para eso, `ESCUCHAR=0.0.0.0` debe estar en el `.env` de Veredicto.
- **Configuración:** se guarda en `~/.config/veredicto/carpeta.json`, con permisos solo para ti. Las variables `VEREDICTO_URL`, `VEREDICTO_TOKEN_CARPETA` y `VEREDICTO_CARPETA` la reemplazan.

## Detalles

- Solo muestra tus tareas, agrupadas por proyecto (o por nota, si vienen de tus notas) y ordenadas por fecha y Eisenhower. Las de los agentes están en la pestaña Infra y los datos de ejemplo no aparecen.
- Escribe de forma atómica. Si estás editando el archivo justo cuando toca reescribirlo, espera a la próxima pasada para no pisar tus cambios.
- Una tarea nueva no se crea dos veces aunque el archivo no se haya podido reescribir.
- En la carpeta guarda `.veredicto-carpeta.json`, con los ids que vio. Si lo borras, no pasa nada grave: las líneas con `^vd-` que ya no reconozca se ignoran hasta la próxima reescritura.
