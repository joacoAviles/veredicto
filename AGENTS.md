# AGENTS.md — Veredicto

Instrucciones para agentes (Hermes, Claude, Codex) que trabajen en este repo.

## Qué es
Veredicto es una app de agenda, tareas y registro de tiempo que corre en tu propio servidor.
Node 20+ con Express y PostgreSQL. Sincroniza en ambos sentidos con calendarios (CalDAV/iCloud, Google,
Outlook) y notas (Markdown, Notion). Tiene un vigilante que manda avisos, un MCP y un módulo opcional
de agentes (pestaña Infraestructura).

- `src/`: servidor. `app.js` arma la API; `core.js` maneja tiempo y tareas; `estado.js` arma lo que
  pinta la app; `sync/` sincroniza con cuentas externas; `agentes.js` maneja la cola de agentes;
  `carpeta.js` sincroniza la carpeta local; `mcp.js` es el servidor MCP.
- `public/`: la app web (un solo `app.js`, sin framework).
- `sql/`: migraciones en orden. **Nunca edites una migración ya publicada**: crea la siguiente (`006_…`).
- `themes/` + `datos/tema/`: plantilla visual. El repo trae solo el tema neutro. El tema de cada
  instalación (p. ej. JOACO) vive en `datos/tema/` del servidor, no en el repo (`docs/tema.md`).
- `integraciones/`: Hermes (worker, hook de WhatsApp, skills) y la carpeta sincronizada.

## Antes de tocar código
Lee **`MAPA-CODIGO.md`**. Tiene cada ruta HTTP, cada herramienta MCP y cada función de primer nivel
con su línea y su propósito.

## Pruebas
```bash
npm ci
# PostgreSQL 16 y Radicale (pip install radicale; radicale --auth-type=none --server-hosts=127.0.0.1:5232)
TEST_DATABASE_URL=postgresql://usuario:clave@localhost:5432/veredicto_test RADICALE_URL=http://127.0.0.1:5232 npm test
```
Si falta `TEST_DATABASE_URL`, las pruebas de base de datos se saltan: eso no cuenta como «en verde».
Una prueba exige que el mapa esté al día y que toda función de primer nivel tenga su comentario.

## Reglas
- Toda función de primer nivel lleva encima un comentario `//` de una línea que dice qué hace.
  Después corre `node scripts/mapa-codigo.mjs`.
- Cada cambio va por rama y PR, con `npm test` en verde (con base de datos). Nunca hagas push directo a `main`.
- Versión: sube `package.json` y `CHANGELOG.md`; la etiqueta `vX.Y.Z` publica la imagen (GitHub Actions).
- Producción (el servidor Synology `cl-nas`, `/volume1/docker/veredicto`): nunca sin respaldo y sin el OK del dueño.
  Prepara los comandos; no los ejecutes.
- Repo para terceros: no pongas datos personales, nombres de marca propios ni dominios privados en el
  código ni en los ejemplos.
- Los tokens (`jdt_`, `jdg_`, `jdc_`), las contraseñas y la `CLAVE_CIFRADO` nunca van en logs, commits ni chat.
