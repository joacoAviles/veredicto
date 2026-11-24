# Guía: tu primera tarea para un agente (Veredicto → Hermes)

Esta práctica usa un **Veredicto de práctica** que corre solo en tu Mac (http://127.0.0.1:8090), con su
propia base de datos. No toca tu Veredicto del servidor ni tus proyectos reales. El agente trabaja
solo dentro de `practica/espacio/`.

Atajo para no escribir rutas largas: en la Terminal, primero

```bash
cd ~/atlas/proyectos/joaquin/veredicto/practica
```

## Cómo funciona (en una línea)
Tú creas la tarea en Veredicto → queda **En cola** → el trabajador le pide a Veredicto «¿qué sigue?» →
Veredicto le entrega una tarea → el trabajador abre Hermes (modelo local) en la carpeta del proyecto →
Hermes la hace y responde → la tarea pasa a **Espera tu OK** → tú apruebas o corriges.

---

## Paso 1 — Encender el Veredicto de práctica
```bash
bash levantar.sh
```
Debe decir `✔ Veredicto de práctica en http://127.0.0.1:8090 (clave: practica-local)`.

## Paso 2 — Prepararlo (una sola vez)
```bash
bash configurar.sh
```
Hace, en orden:
- Entra a Veredicto con la clave de práctica.
- Enciende **Infraestructura**. En tu Veredicto real esto es Ajustes → Módulos.
- Crea el proyecto **«Práctica agentes»**.
- Crea un **token de agente** (`jdg_…`), que queda en `practica/datos/agente.env`. Es la llave con que el trabajador habla con Veredicto. Solo abre la cola de agentes, nada más.
- Deja el perfil **worker-local** de Hermes con el modelo local y la skill del trabajador.

## Paso 3 — Crear la tarea en Veredicto
1. Abre **http://127.0.0.1:8090** en el navegador y entra con la clave `practica-local`.
2. Ve a la pestaña **Infra** → **Tablero de agentes**.
3. En **«Nueva tarea para un agente»** llena:
   - **Título:** `Crear un archivo en blanco y moverlo de carpeta`
   - **Proyecto:** `Práctica agentes`. Esto decide en qué carpeta trabaja el agente.
   - **Prioridad:** `P2 · importante`
   - **Detalle:**
     `1) Crea el archivo vacío salidas/borrador/nota-vacia.txt. 2) Muévelo a salidas/listo/nota-vacia.txt. Listo cuando salidas/listo/nota-vacia.txt exista y salidas/borrador esté vacía.`
4. Aprieta **Agregar a la cola**. La tarea aparece **En cola**. En Tareas queda en el cuadrante «Delegar».

> Truco: el **Detalle** es lo más importante. Di qué hacer y **cómo sabes que quedó bien** (el «criterio de listo»).
> Con un modelo chico, pasos numerados y rutas exactas funcionan mucho mejor.

## Paso 4 — Que el agente trabaje
```bash
bash trabajar.sh
```
Con el modelo local tarda de 1 a 3 minutos. Mientras corre, recarga el Tablero y verás la tarea en **Trabajando**.

Lo que hace por dentro (`integraciones/hermes/trabajador.py`):
1. Le pide a Veredicto la siguiente tarea del carril **local** (`POST /api/agente/siguiente`).
2. Manda un **latido** cada minuto para que Veredicto sepa que sigue vivo. Si se muere, la tarea vuelve sola a la cola.
3. Corre `hermes -p worker-local chat --oneshot` **dentro de `practica/espacio/`**, así que Hermes lee el `AGENTS.md` de esa carpeta.
4. Guarda la respuesta de Hermes en la tarea, que pasa a **Espera tu OK**.
   Si Hermes responde `BLOQUEADA: …`, la tarea queda **Bloqueada** con ese motivo.

## Paso 5 — Revisar y aprobar
```bash
bash estado.sh
open espacio/salidas
```
`estado.sh` muestra el estado de cada tarea, lo que respondió el agente y los archivos que quedaron.
Debe aparecer `./listo/nota-vacia.txt`, y `./borrador` debe estar vacía.

En el Tablero, la tarea está en **Espera tu OK** y abajo se ve el **Resultado**:
- **Aprobar**: queda hecha.
- **Corregir**: escribes qué falta y la tarea **vuelve a la cola** con tu nota. Para que lo rehaga, corre `bash trabajar.sh` otra vez.
- **Me la quedo yo**: deja de ser del agente y pasa a tus Tareas.

## Paso 6 — Practica con variaciones
Crea más tareas en el Tablero y repite el paso 4:
- **Renombrar:** «Renombra salidas/listo/nota-vacia.txt a salidas/listo/nota-final.txt».
- **Escribir contenido:** «Crea salidas/hola.md con un título y una lista de 3 puntos sobre qué es Veredicto».
- **Ordenar:** «Crea salidas/2026/noviembre y mueve ahí todos los .txt de salidas/listo».
- **Ver un bloqueo:** «Lee el archivo ~/Documents/secreto.txt». Está fuera de su carpeta, así que debería responder `BLOQUEADA: …`. La tarea queda **Bloqueada**: prueba **Reintentar** o **Me la quedo yo**.
- **Ver la prioridad:** crea dos tareas, una P4 y otra P1, y corre `trabajar.sh`. Primero toma la P1.

## Paso 7 — Apagar
```bash
bash parar.sh
```
Los datos quedan guardados: `bash levantar.sh` lo vuelve a encender tal cual.

---

## Cuando lo pases a tu Veredicto real
1. Actualiza el servidor a v3.1.0: publica la etiqueta y luego `sudo docker-compose pull && sudo docker-compose up -d` en `/volume1/docker/veredicto`.
2. Activa la Infraestructura en Ajustes → Módulos. Luego, en Infra → **Agentes y conexión** → **Crear token**, y pega `VEREDICTO_URL` y `VEREDICTO_TOKEN` en `~/.hermes/.env`.
3. Corre `integraciones/hermes/instalar.sh`. Deja el trabajador corriendo **solo cada 2 minutos** con launchd y conecta el MCP: no vuelves a correr `trabajar.sh` a mano.
4. Desde ahí también puedes delegar con el botón 🤖 en Tareas, o por WhatsApp: «Aurora, delega …».
