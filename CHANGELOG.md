# Cambios

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
