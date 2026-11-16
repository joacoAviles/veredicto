# Publicar en tu dominio con Cloudflare Tunnel

Así Veredicto queda en `https://veredicto.tudominio.cl` sin abrir puertos en tu router.

1. Tu dominio tiene que estar en Cloudflare.
2. [one.dash.cloudflare.com](https://one.dash.cloudflare.com) → **Networks → Tunnels → Create a tunnel** → tipo **Cloudflared** → nombre «veredicto».
3. Copia el **token** (la cadena larga después de `--token`).
4. **Public hostname**: subdominio `veredicto`, tu dominio, servicio **HTTP** → `app:8080`.
5. En `.env`:
   ```
   TUNNEL_TOKEN=eyJ...
   URL_PUBLICA=https://veredicto.tudominio.cl
   ```
6. `docker compose --profile tunel up -d`

Recomendado: protege la dirección con **Cloudflare Access** solo si no usarás los botones de los avisos ni los atajos, porque esos llegan sin navegador. Veredicto ya pide contraseña y firma cada botón.
