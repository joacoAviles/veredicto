# Juez del Tiempo

Registro de tiempo autoalojado, en español. Un solo servidor guarda todo; el celular, el computador, Siri, Android y el reloj son solo ventanas. **No hay sincronización que pueda fallar**: lo que inicias desde un aviso, un atajo o la web es lo mismo que ves en todas partes, al instante.

- **Hoy**: qué estás haciendo, tu agenda (tus bloques + tus calendarios), sugerencias según lo que sueles hacer a esta hora.
- **Armar mi día**: agenda sola tus hábitos (lo que registras seguido a la misma hora) y tus rutinas, sin pisar tus reuniones. Puede hacerlo cada mañana y mandarte el resumen.
- **Vigilante**: si no registras nada, te reclama a los 10, 30 y 60 minutos, y después cada 10. Si tienes algo agendado, te avisa con el botón para iniciarlo.
- **Conectores**: avisos por ntfy, Telegram o webhook · calendarios de Google, iCloud y Outlook (enlace iCal, solo lectura) · copia a Notion (tareas, tiempo y notas) · feed iCal propio.
- **Atajos**: Siri, Android (accesos del ícono, compartir, HTTP Shortcuts) y relojes, con respuestas en texto simple.
- **Plantilla**: colores, letras y logo en un CSS aparte. Montas tu tema sin tocar el código.

## Instalar (Docker)

```bash
git clone https://github.com/<tu-usuario>/juez-del-tiempo.git
cd juez-del-tiempo
cp .env.example .env        # edita DB_PASSWORD y URL_PUBLICA
docker compose up -d --build
docker compose logs app     # aquí aparece el código de instalación
```

Abre `http://localhost:8080`, pega el código, elige tu contraseña y sigue los 4 pasos (avisos, calendarios, Notion, atajos).

### Publicarlo con Cloudflare Tunnel

1. Cloudflare → Zero Trust → Networks → Tunnels → **Create tunnel** (cloudflared) → copia el token.
2. En el túnel: **Public hostname** → tu subdominio → servicio `http://app:8080`.
3. En `.env`: `TUNNEL_TOKEN=...` y `URL_PUBLICA=https://tu-subdominio`.
4. `docker compose --profile tunel up -d`

### Actualizar

```bash
git pull && docker compose up -d --build
```

### Respaldo

```bash
docker compose exec db pg_dump -U juez juez > respaldo-$(date +%F).sql
```

## Tu propio tema

Crea una carpeta `tema/` junto a `compose.yaml` con un `tema.css` (copia `themes/neutro.css` como punto de partida). Opcionales en la misma carpeta: `icono.svg`, `icono-180.png`, `icono-192.png`, `icono-512.png`, y letras u otros archivos, que se sirven en `/tema/…`. La carpeta `tema/` está en `.gitignore`: tu marca no se mezcla con el repositorio.

Variables que puedes cambiar: `--fondo`, `--superficie`, `--texto`, `--suave`, `--linea`, `--acento`, `--acento-texto`, `--peligro`, `--ok`, `--fuente`, `--fuente-titulos`, `--mayus-titulos`, `--radio`, `--sombra`, `--logo`.

## Cómo funciona

- PostgreSQL es la única verdad. Una sola actividad abierta a la vez (lo garantiza la base de datos).
- La pantalla se actualiza en vivo (Server-Sent Events) y no guarda datos en el teléfono.
- Notion es una **copia de una sola dirección** con cola y reintentos: si Notion falla, no pierdes nada y no hay conflictos.
- Los botones de los avisos son enlaces firmados que vencen en 12 horas.

Atajos paso a paso: [docs/atajos.md](docs/atajos.md).

## Desarrollo

```bash
npm install
TEST_DATABASE_URL=postgres://usuario@localhost:5432/prueba npm test
DATABASE_URL=postgres://usuario@localhost:5432/juez npm start
```

Licencia MIT.
