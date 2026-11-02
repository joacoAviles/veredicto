# Atajos

Crea un token en **Ajustes → Atajos** (uno por dispositivo). Todas las direcciones responden texto simple y aceptan el token como encabezado `Authorization: Bearer TOKEN` o como `?k=TOKEN`.

| Dirección | Qué hace |
|---|---|
| `/api/atajo/alternar` | Un botón: si hay algo corriendo lo para; si no, inicia lo agendado ahora o lo que sueles hacer a esta hora. |
| `/api/atajo/iniciar` | Inicia lo que mandes en el cuerpo (texto) o en `?que=`. Si no existe, crea la tarea. |
| `/api/atajo/parar` · `pausar` · `seguir` | Lo obvio. |
| `/api/atajo/estado` | «▶ Transporte · 23 min» o «Nada corriendo…». |
| `/api/atajo/opciones` | Lista (una por línea) de lo agendado, lo habitual, rutinas y tareas. |
| `/api/atajo/capturar` | Guarda texto en la bandeja. `?tipo=nota` lo guarda como nota. |
| `/api/atajo/agenda` | Lo que queda de hoy. |
| `/api/atajo/armar` | Arma el día y devuelve los bloques creados. |

## iPhone (Siri)

**«Juez» (un toque):**
1. Atajos → **+** → *Obtener contenido de URL*.
2. URL `https://TU-DOMINIO/api/atajo/alternar`, Método **POST**, Encabezados: `Authorization` = `Bearer TOKEN`.
3. *Mostrar notificación* con *Contenido de URL*.
4. Nómbralo «Juez». Siri: «Oye Siri, Juez». Ponlo también en la pantalla de inicio, el botón de acción o el Apple Watch.

**«Iniciar…» (elegir de la lista):**
1. *Obtener contenido de URL* → `.../api/atajo/opciones` (GET, mismo encabezado).
2. *Dividir texto* por *Saltos de línea*.
3. *Elegir de la lista* (activa «Pedir texto si no está» si quieres dictar algo nuevo).
4. *Obtener contenido de URL* → `.../api/atajo/iniciar`, POST, Cuerpo de la solicitud: **Archivo** → *Elemento elegido* (o JSON `{"texto": Elemento elegido}`).
5. *Mostrar notificación*.

**«Anotar» (por voz):** *Dictar texto* → POST a `.../api/atajo/capturar` con el texto → *Mostrar notificación*.

**Automatización:** en Atajos → Automatización, «Al llegar a la oficina» / «Al conectar CarPlay» → iniciar «Trabajo» / «Transporte».

## Android

- **Instala la app** desde Chrome (⋮ → Instalar app). Mantén presionado el ícono: *Parar*, *Capturar*, *Armar mi día*.
- **Compartir**: desde cualquier app, compartir → Juez del Tiempo → queda en la bandeja.
- **Botones en la pantalla de inicio**: app *HTTP Shortcuts* (gratis) → nuevo atajo → POST `.../api/atajo/alternar` con encabezado `Authorization: Bearer TOKEN` → Respuesta: *mostrar como aviso (toast)*. Agrega el widget. Repite con `iniciar?que=Gimnasio`, etc.
- **Tasker / Automate**: la misma petición HTTP en cualquier perfil (llegar a un lugar, conectar el Bluetooth del auto…).

## Relojes

- **Apple Watch**: los atajos de Siri aparecen en la app Atajos del reloj.
- **Wear OS**: los widgets de HTTP Shortcuts / Tasker funcionan en tiles.
- **Garmin**: instala un widget de peticiones HTTP desde Connect IQ (por ejemplo «API Request»), configura POST a `https://TU-DOMINIO/api/atajo/alternar?k=TOKEN`. El reloj muestra la respuesta.

Si un token se pierde, bórralo en Ajustes y crea otro.
