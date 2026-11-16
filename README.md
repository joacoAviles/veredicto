# Veredicto

**El juez de tu tiempo, en tu servidor.**

Veredicto junta tus calendarios (Google, iCloud, Outlook, CalDAV) y tus notas (Obsidian o Notion) en una sola agenda, mide lo que realmente haces y te reclama cuando no estás registrando nada. Se instala como Immich: un `docker compose` en tu servidor. Lo único público es la herramienta; tus datos, tus cuentas y tu tema viven en tu carpeta `datos/` y nunca salen de ahí.

- **Calendarios en ambos sentidos.** Lo que mueves en Veredicto aparece en tu teléfono y al revés, cada 2 minutos. Tus bloques van a un calendario propio, «Veredicto · Plan»; lo medido, opcionalmente, a «Veredicto · Registrado».
- **De idea a calendario en Notion.** La base «Flujo» guarda ideas, videos y gestiones. Lo que pasas a «Por hacer» entra solo en tus huecos libres, la hora vuelve a Notion y lo que mides suma en su fila.
- **Notas = gestiones.** Cada casilla `- [ ]` de tus notas es una gestión. Márcala en la app, en Obsidian o en Notion y queda marcada en todos lados. Lo que capturas con Siri o Android cae en una nota «Bandeja» del día.
- **Registro de tiempo** con una sola actividad abierta a la vez, desde la web, Siri, Android o el reloj.
- **Vigilante.** Si no registras nada, te avisa a los 10, 30 y 60 minutos y después cada 10. Si algo agendado empieza, te manda el botón para iniciarlo. Funciona por ntfy, Telegram o webhook, con textos editables.
- **Armar mi día.** Aprende tus hábitos (lo mismo a una hora parecida varios días) y te arma el día sin pisar tus reuniones. Tú decides qué puede agendar solo, qué solo sugerir y qué ignorar.
- **Tu marca.** Colores, letras, logo y la voz de los avisos son una plantilla en `datos/tema/`.

## Instalar

Necesitas un servidor con Docker y Docker Compose v2 (un mini PC, un NAS Synology, un Mac con Colima o OrbStack, un VPS).

```bash
curl -fsSL https://github.com/joacoAviles/veredicto/releases/latest/download/instalar.sh | sh
```

El instalador crea la carpeta `veredicto/` con `compose.yaml`, un `.env` con contraseñas al azar y la carpeta `datos/`, baja la imagen y la levanta. Al final te muestra el **código de instalación**. Abre `http://localhost:8080`, pega el código, elige tu contraseña y sigue los 4 pasos del asistente:

1. **Avisos al celular:** ntfy (gratis), Telegram o webhook. Con «Probar» llega uno de prueba.
2. **Calendarios:** iCloud, Google, Outlook, otro CalDAV o un enlace iCal de solo lectura. Después crea «Veredicto · Plan» en la cuenta que más miras.
3. **Notas:** una carpeta Markdown (tu bóveda de Obsidian) o una página de Notion.
4. **Atajos:** un token por dispositivo para Siri, Android y el reloj.

### Instalación a mano

```bash
mkdir veredicto && cd veredicto
curl -LO https://github.com/joacoAviles/veredicto/releases/latest/download/compose.yaml
curl -L -o .env https://github.com/joacoAviles/veredicto/releases/latest/download/example.env
nano .env                      # DB_PASSWORD, CLAVE_CIFRADO, URL_PUBLICA
mkdir -p datos/db datos/tema datos/notas datos/respaldos datos/clave
docker compose up -d
docker compose logs app        # aquí está el código de instalación
```

### Publicarlo en tu dominio (Cloudflare Tunnel)

Para que funcionen los botones de los avisos y la conexión con Google u Outlook, Veredicto necesita una dirección `https`. Ver [docs/tunel.md](docs/tunel.md).

## Guías

| Para | Guía |
| --- | --- |
| iCloud (contraseña de app) | [docs/icloud.md](docs/icloud.md) |
| Google Calendar (tu cliente OAuth) | [docs/google.md](docs/google.md) |
| Outlook / Microsoft 365 (tu app de Azure) | [docs/outlook.md](docs/outlook.md) |
| Obsidian y Notion | [docs/notas.md](docs/notas.md) |
| Siri, Android y relojes | [docs/atajos.md](docs/atajos.md) |
| Dominio con Cloudflare Tunnel | [docs/tunel.md](docs/tunel.md) |
| Tema, logo y voz de los avisos | [docs/tema.md](docs/tema.md) |

## Dónde vive cada cosa

| Qué | Dónde |
| --- | --- |
| Código e imagen Docker | GitHub y `ghcr.io/joacoaviles/veredicto` (públicos) |
| Base de datos | `datos/db` |
| Credenciales de tus cuentas | En la base, cifradas con AES-256-GCM; la clave está en `.env` o en `datos/clave/` |
| Tema, logo, avisos del equipo | `datos/tema/` |
| Notas Markdown | `datos/notas/` o la carpeta que montes |
| Respaldos diarios (03:00, se guardan 14) | `datos/respaldos/` |

Los tokens de atajos solo sirven para las direcciones `/api/atajo/…`: si uno se filtra, no abre tus cuentas ni tus ajustes. La entrada se bloquea 15 minutos tras 8 contraseñas incorrectas.

No hay servidor central ni telemetría. Veredicto solo habla con tus propias cuentas y con el canal de avisos que elijas.

## Actualizar, respaldar, mover

```bash
docker compose pull && docker compose up -d     # actualizar (las migraciones corren solas)
./restaurar.sh datos/respaldos/veredicto-AAAA-MM-DD.sql.gz   # restaurar un respaldo
```

Para fijar una versión, pon `VEREDICTO_VERSION=v2.0.0` en `.env`. Para mover Veredicto a otro servidor, copia la carpeta completa (`compose.yaml`, `.env` y `datos/`).

**Guarda una copia de `.env`.** Sin la `CLAVE_CIFRADO` no se pueden leer las cuentas conectadas: tendrías que volver a conectarlas.

## Cómo sincroniza

- Cada cuenta externa sigue siendo dueña de lo suyo. Veredicto guarda un espejo y una cola de cambios con reintentos.
- Lo que cambias en la app sale a tus cuentas en un segundo; lo que cambias afuera llega en la siguiente pasada (cada 2 minutos, o al tocar «Sincronizar ahora»).
- Trae solo una ventana de 14 días hacia atrás y 60 hacia adelante.
- Si el mismo evento cambia en los dos lados entre dos pasadas, gana el más reciente. El otro queda en «Revisar conflictos», donde puedes deshacerlo.
- Si borras algo afuera, en Veredicto pasa a una papelera 30 días. Los eventos repetidos se ven, pero se editan en su calendario de origen.
- Si una cuenta lleva más de 1 hora fallando, te llega un aviso.

## Desarrollo

```bash
npm install
TEST_DATABASE_URL=postgres://usuario@localhost:5432/prueba RADICALE_URL=http://127.0.0.1:5232/ npm test
DATABASE_URL=postgres://usuario@localhost:5432/veredicto DATOS_DIR=./datos npm start
```

Las pruebas usan PostgreSQL real y un servidor CalDAV real (Radicale: `pip install radicale`). Para publicar una versión, crea la etiqueta: `git tag v2.0.0 && git push --tags`. GitHub Actions publica la imagen (amd64 y arm64) y adjunta `compose.yaml`, `example.env`, `instalar.sh` y `restaurar.sh` a la versión.

Licencia MIT.
