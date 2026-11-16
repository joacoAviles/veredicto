# Tu computador con ActivityWatch

[ActivityWatch](https://activitywatch.net) anota qué app y qué ventana tienes al frente, y descuenta cuando estás lejos del teclado. Veredicto lo lee cada 5 minutos por tu red y:

- en **Registro → Tu computador hoy** te muestra lo que no registraste, para asignarlo a una tarea o proyecto con un toque;
- en los avisos agrega «En el computador: Code (40 min)» (variable `{computador}` en las plantillas);
- tu asistente lo ve con la herramienta `actividad_computador`;
- en Notion, la base «Actividad y revisiones» lleva un resumen diario.

## Pasos (Mac)
1. Instala ActivityWatch y ábrelo.
2. Deja que tu servidor lo lea por la red (por defecto solo escucha en el mismo computador):
   ```sh
   mkdir -p ~/Library/Application\ Support/activitywatch/aw-server-rust
   printf 'host = "0.0.0.0"\nport = 5600\n' > ~/Library/Application\ Support/activitywatch/aw-server-rust/config.toml
   ```
   Cierra ActivityWatch (ícono → Quit) y ábrelo de nuevo.
3. IP del Mac: Ajustes del Sistema → Wi-Fi → Detalles. Resérvala en tu router para que no cambie.
4. En Veredicto: Ajustes → paso 4 → `http://IP-DEL-MAC:5600` → Probar → Conectar.

Windows: el archivo es `%LOCALAPPDATA%\activitywatch\aw-server-rust\config.toml`.

Solo se guardan tramos resumidos (app, título principal, inicio y fin) de 1 minuto o más. Abrir el puerto 5600 en tu red local deja que otros equipos de tu red lean tu actividad: hazlo solo en una red de confianza.
