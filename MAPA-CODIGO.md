# Mapa del código — Veredicto

Generado por `node scripts/mapa-codigo.mjs`. No editar a mano: corre el script tras cambiar código.
Cada función de primer nivel aparece con su línea (`L`) y su propósito (el comentario que va encima).

## Rutas HTTP
| Ruta | Dónde |
| --- | --- |
| `PUT /api/modulos` | `src/agentes.js` L279 |
| `GET /api/agente/contexto` | `src/agentes.js` L288 |
| `GET /api/agente/agenda` | `src/agentes.js` L289 |
| `GET /api/agente/tareas` | `src/agentes.js` L297 |
| `POST /api/agente/tareas` | `src/agentes.js` L298 |
| `PATCH /api/agente/tareas/:id` | `src/agentes.js` L302 |
| `GET /api/agente/tareas/:id/historial` | `src/agentes.js` L306 |
| `POST /api/agente/siguiente` | `src/agentes.js` L309 |
| `POST /api/agente/latido` | `src/agentes.js` L314 |
| `POST /api/agente/conversando` | `src/agentes.js` L315 |
| `POST /api/agente/bloques` | `src/agentes.js` L316 |
| `POST /api/agente/capturar` | `src/agentes.js` L320 |
| `GET /api/infra` | `src/agentes.js` L326 |
| `PUT /api/infra/config` | `src/agentes.js` L327 |
| `DELETE /api/infra/agentes/:nombre` | `src/agentes.js` L333 |
| `GET /theme.css` | `src/app.js` L98 |
| `GET / · /index.html` | `src/app.js` L106 |
| `GET /manifest.webmanifest` | `src/app.js` L107 |
| `GET /api/sesion` | `src/app.js` L126 |
| `POST /api/instalar` | `src/app.js` L131 |
| `POST /api/entrar` | `src/app.js` L139 |
| `POST /api/salir` | `src/app.js` L148 |
| `GET /api/estado` | `src/app.js` L151 |
| `GET /api/eventos` | `src/app.js` L152 |
| `POST /api/iniciar` | `src/app.js` L166 |
| `POST /api/parar` | `src/app.js` L171 |
| `POST /api/pausar` | `src/app.js` L172 |
| `POST /api/seguir` | `src/app.js` L173 |
| `POST /api/registrar` | `src/app.js` L174 |
| `DELETE /api/sesiones/:id` | `src/app.js` L188 |
| `POST /api/items` | `src/app.js` L197 |
| `PATCH /api/items/:id` | `src/app.js` L201 |
| `POST /api/capturas` | `src/app.js` L207 |
| `PATCH /api/capturas/:id` | `src/app.js` L211 |
| `POST /api/capturas/:id/tarea` | `src/app.js` L218 |
| `POST /compartir` | `src/app.js` L228 |
| `POST /api/bloques` | `src/app.js` L236 |
| `PATCH /api/bloques/:id` | `src/app.js` L240 |
| `DELETE /api/bloques/:id` | `src/app.js` L245 |
| `PATCH /api/eventos` | `src/app.js` L250 |
| `GET /api/agenda` | `src/app.js` L255 |
| `GET /api/armar` | `src/app.js` L260 |
| `POST /api/armar` | `src/app.js` L261 |
| `GET /api/registro` | `src/app.js` L262 |
| `POST /api/calendarios` | `src/app.js` L273 |
| `DELETE /api/calendarios/:id` | `src/app.js` L280 |
| `POST /api/calendarios/refrescar` | `src/app.js` L281 |
| `GET /api/feed` | `src/app.js` L286 |
| `GET /cal/:s.ics` | `src/app.js` L291 |
| `GET /api/cuentas` | `src/app.js` L323 |
| `POST /api/cuentas/caldav` | `src/app.js` L345 |
| `POST /api/cuentas/:tipo(google|outlook)/oauth` | `src/app.js` L359 |
| `GET /oauth/:tipo(google|outlook)` | `src/app.js` L369 |
| `POST /api/cuentas/markdown` | `src/app.js` L391 |
| `POST /api/cuentas/notion` | `src/app.js` L399 |
| `DELETE /api/cuentas/:id` | `src/app.js` L408 |
| `PATCH /api/calendarios/:id` | `src/app.js` L416 |
| `POST /api/cuentas/:id/crear-calendario` | `src/app.js` L434 |
| `PUT /api/bandeja-destino` | `src/app.js` L455 |
| `POST /api/sincronizar` | `src/app.js` L460 |
| `GET /api/conflictos` | `src/app.js` L465 |
| `POST /api/conflictos/:id/:accion(revisado|deshacer)` | `src/app.js` L468 |
| `GET /api/avisos` | `src/app.js` L483 |
| `PUT /api/avisos` | `src/app.js` L499 |
| `POST /api/avisos/probar` | `src/app.js` L524 |
| `POST /api/avisos/telegram/chat` | `src/app.js` L533 |
| `POST /api/vigilante/revisar` | `src/app.js` L545 |
| `POST /api/vigilante/silenciar` | `src/app.js` L549 |
| `PUT /api/onboarding` | `src/app.js` L555 |
| `GET /api/plantillas` | `src/app.js` L559 |
| `PUT /api/plantillas` | `src/app.js` L563 |
| `DELETE /api/plantillas/:evento` | `src/app.js` L572 |
| `POST /api/plantillas/probar` | `src/app.js` L580 |
| `GET /api/prediccion` | `src/app.js` L605 |
| `PUT /api/prediccion` | `src/app.js` L617 |
| `GET /api/proyectos` | `src/app.js` L623 |
| `POST /api/proyectos` | `src/app.js` L624 |
| `PATCH /api/proyectos/:id` | `src/app.js` L625 |
| `POST /api/pilares` | `src/app.js` L626 |
| `PATCH /api/pilares/:id` | `src/app.js` L627 |
| `POST /api/cuentas/:id/notion-bases` | `src/app.js` L631 |
| `GET /api/notion-importacion` | `src/app.js` L664 |
| `POST /api/activitywatch/probar` | `src/app.js` L667 |
| `PUT /api/activitywatch` | `src/app.js` L671 |
| `DELETE /api/activitywatch` | `src/app.js` L681 |
| `POST /api/activitywatch/sincronizar` | `src/app.js` L682 |
| `GET /api/actividad` | `src/app.js` L686 |
| `POST /api/actividad/registrar` | `src/app.js` L693 |
| `POST /api/demo` | `src/app.js` L720 |
| `DELETE /api/demo` | `src/app.js` L726 |
| `GET /api/tokens` | `src/app.js` L732 |
| `POST /api/tokens` | `src/app.js` L733 |
| `DELETE /api/tokens/:id` | `src/app.js` L744 |
| `ALL /api/atajo/estado` | `src/app.js` L767 |
| `ALL /api/atajo/opciones` | `src/app.js` L768 |
| `ALL /api/atajo/iniciar` | `src/app.js` L779 |
| `ALL /api/atajo/parar` | `src/app.js` L785 |
| `ALL /api/atajo/pausar` | `src/app.js` L790 |
| `ALL /api/atajo/seguir` | `src/app.js` L791 |
| `ALL /api/atajo/alternar` | `src/app.js` L793 |
| `ALL /api/atajo/capturar` | `src/app.js` L808 |
| `ALL /api/atajo/agenda` | `src/app.js` L813 |
| `ALL /api/atajo/armar` | `src/app.js` L819 |
| `POST /a/:t` | `src/app.js` L837 |
| `GET /a/:t` | `src/app.js` L845 |
| `GET /salud` | `src/app.js` L851 |
| `GET /api/carpeta/pendientes` | `src/carpeta.js` L62 |
| `POST /api/carpeta/sync` | `src/carpeta.js` L63 |
| `POST /mcp` | `src/mcp.js` L179 |
| `GET /mcp` | `src/mcp.js` L193 |
| `DELETE /mcp` | `src/mcp.js` L194 |

## Herramientas MCP
| Herramienta | Qué hace |
| --- | --- |
| `estado` | Qué está corriendo ahora, cuánto llevas medido hoy y lo que viene en la agenda. |
| `iniciar` | Inicia el temporizador sobre una tarea, rutina o algo nuevo. Si no existe, crea la tarea (opcionalmente en un proyecto). |
| `parar` | Detiene lo que esté corriendo y lo registra. |
| `pausar` | Pausa lo que esté corriendo. |
| `seguir` | Retoma lo pausado. |
| `capturar` | Guarda una idea, pendiente o nota en la bandeja (Notion/Obsidian si están conectados). |
| `agenda` | Bloques y eventos de calendario de hoy y los próximos días. |
| `proyectos` | Proyectos con tareas abiertas, minutos medidos (total y última semana) y fecha límite. |
| `tareas` | Tareas abiertas, opcionalmente de un proyecto. |
| `crear_tarea` | Crea una tarea. |
| `completar_tarea` | Marca una tarea como hecha (por nombre). |
| `agendar` | Agenda un bloque en tu calendario (se sincroniza con «Veredicto · Plan»). |
| `armar_dia` | Propone (o aplica) los bloques de hoy según hábitos, rutinas y pendientes «Por hacer». |
| `registro` | Tiempo medido por proyecto y por actividad en los últimos días. |
| `actividad_computador` | Lo que ActivityWatch vio en el computador (apps y tiempo) y cuánto quedó sin registrar. |
| `disponibilidad` | ¿El usuario está ocupado ahora (evento o bloque en su agenda) y hasta cuándo? Úsalo antes de responder mensajes por él. También trae lo próximo y sus pendientes. |
| `delegar` | Crea una tarea para que la haga un agente (queda en la cola de Infraestructura). |
| `cola_agentes` | Tareas de los agentes: en cola, trabajando, bloqueadas y las que esperan el OK del usuario. |
| `aprobar_agente` | Aprueba el resultado de una tarea de agente (la deja hecha). Solo cuando el usuario lo pide. |
| `corregir_agente` | Devuelve una tarea de agente a la cola con la corrección del usuario. |
| `autorizar_cloud` | Autoriza que una tarea use el carril cloud (proveedor pago). SOLO con un sí explícito del usuario: copia su respuesta textual. |

## Funciones por archivo

### `src/agentes.js`
Agentes (Hermes): una cola de tareas con prioridad, carriles (local/cloud), ventana nocturna y aprobación. Veredicto decide qué sigue; el agente solo pide la siguiente y reporta.
- `modulos` · L22 · exportada — Módulos opcionales encendidos (p. ej. infra), con sus valores por defecto.
- `config` · L25 · exportada — Configuración de agentes (foco, ventana de noche, pausas) mezclada con los valores por defecto.
- `sanitizeConfig` · L32 · exportada — Valida y normaliza la configuración de agentes que llega desde la app.
- `esNoche` · L46 · exportada — Si `now` cae dentro de la ventana de noche configurada (cruza medianoche si hace falta).
- `ordenArgs` · L56 — Parámetros SQL del orden de la cola: vence en ≤3 días, proyectos en foco y prioridad.
- `leerItem` · L59 — Lee una tarea con el nombre de su proyecto.
- `evento` · L62 — Registra un evento de agente (tomó, latido, terminó…) en agente_eventos.
- `vistaItem` · L66 · exportada — Forma pública de una tarea para agentes y la app (campos de agente incluidos).
- `siguiente` · L78 · exportada — Pide la siguiente tarea para un carril. Devuelve {tarea} o {espera: motivo}.
- `proyectoId` · L112 — «proyecto» puede venir como id o como nombre (lo que dice una persona por WhatsApp).
- `crear` · L124 · exportada — Crea una tarea delegable con prioridad, carril, ventana y asignación.
- `actualizar` · L133 · exportada — Cambia campos de una tarea; valida transiciones de estado y deja evento.
- `listar` · L187 · exportada — Lista tareas de agentes con filtros (asignado, estado, carril, proyecto) en orden de cola.
- `contexto` · L202 · exportada — Lo que tu asistente necesita para contestar WhatsApp: ¿estás ocupado?, qué viene, qué tienes pendiente.
- `latido` · L234 · exportada — Marca que un agente sigue vivo (y en qué tarea trabaja).
- `conversando` · L246 · exportada — Pausa el carril local unos minutos: WhatsApp tiene prioridad sobre las tareas.
- `infra` · L254 · exportada — Datos de la pestaña Infraestructura: agentes, tokens, eventos recientes y pausa.
- `rutas` · L271 · exportada — Rutas. Las mismas sirven a la app (cookie) y a los agentes (token de alcance «agente»).
- `buscarTareaAgente` · L340 — Encuentra una tarea por id corto o parte del título (para MCP y WhatsApp).
- `lineaCola` · L351 — Una línea de texto por tarea de la cola, para respuestas por chat.
- `mcpRun` · L373 · exportada — Implementación de las herramientas MCP de agentes (delegar, cola, aprobar, corregir, autorizar cloud).

### `src/app.js`
Rutas HTTP. Una sola verdad: PostgreSQL. Las pantallas y los atajos solo leen y piden cambios.
- `exists` · L34 — Si existe un archivo (sin lanzar error).
- `createApp` · L37 · exportada — Arma la app Express: autenticación, API, atajos, sincronización, MCP y archivos públicos.
- `escapeHtml` · L863 — Escapa texto para insertarlo en HTML.
- `actionPage` · L866 — Página HTML mínima que confirma una acción firmada (botones de avisos).

### `src/auth.js`
Una cuenta por instalación: contraseña (scrypt), cookie de sesión y tokens para atajos.
- `sha` · L6 — SHA-256 en hexadecimal.
- `same` · L8 — Compara dos textos en tiempo constante.
- `hashPassword` · L14 · exportada — Hash scrypt con sal para la contraseña de la cuenta.
- `checkPassword` · L19 · exportada — Verifica una contraseña contra su hash scrypt.
- `secret` · L27 · exportada — Secreto del servidor para firmar acciones (se crea la primera vez).
- `setupCode` · L34 · exportada — Código de instalación: se muestra en los registros del contenedor hasta que crees la cuenta.
- `createAccount` · L42 · exportada — Crea la única cuenta con el código de instalación; falla si ya existe.
- `presetAccount` · L52 · exportada — Crea la cuenta desde una contraseña de entorno si aún no existe.
- `login` · L59 · exportada — Valida la contraseña y abre una sesión (cookie) nueva.
- `newApiToken` · L68 · exportada — Alcance: atajo (Siri, reloj, MCP) · agente (Hermes: /api/agente y MCP) · carpeta (carpeta sincronizada).
- `readCookie` · L78 · exportada — Lee la cookie de sesión de la petición.
- `setCookie` · L82 · exportada — Deja la cookie de sesión (HttpOnly, 180 días; Secure si corresponde).
- `clearCookie` · L86 · exportada — Borra la cookie de sesión.
- `identify` · L89 · exportada — Autentica por cookie (navegador) o por token (atajos): cabecera Bearer o ?k=.
- `logout` · L105 · exportada — Cierra la sesión del navegador actual.
- `signAction` · L111 · exportada — Enlaces firmados para los botones de los avisos (válidos 12 horas).
- `verifyAction` · L118 · exportada — Verifica y decodifica un enlace de acción firmado (HMAC) que aún no vence.

### `src/carpeta.js`
Carpeta sincronizada: tus tareas pendientes en un archivo Markdown de cualquier computador. El cliente (integraciones/carpeta) manda lo que marcaste, renombraste o agregaste en el archivo y recibe la lista al día para reescribirlo. Veredicto sigue siendo la única verdad.
- `ids` · L11 — Filtra una lista dejando solo UUID válidos.
- `pendientes` · L14 · exportada — Tareas pendientes para la carpeta sincronizada (Pendientes.md).
- `sincronizar` · L29 · exportada — Aplica lo que cambió en la carpeta: hechas, renombradas y nuevas.
- `rutas` · L61 · exportada — Rutas /api/carpeta (token jdc_).

### `src/cifrado.js`
Credenciales de tus cuentas cifradas en la base (AES-256-GCM). La clave vive solo en tu servidor: variable CLAVE_CIFRADO o, si falta, /datos/clave/clave.key (se crea sola).
- `initClave` · L10 · exportada — Carga la clave de cifrado del entorno o del archivo /datos/clave (la crea si falta).
- `setClave` · L27 · exportada — Fija la clave de cifrado (derivada con SHA-256).
- `cifrar` · L30 · exportada — Cifra un objeto con AES-256-GCM (formato v1.iv.tag.datos).
- `descifrar` · L39 · exportada — Descifra lo que produjo cifrar().

### `src/conectores/avisos.js`
Canales de aviso: ntfy, Telegram y webhook. Cada aviso puede traer hasta 3 acciones (enlaces firmados).
- `enviar` · L2 · exportada — Canales de aviso: ntfy, Telegram y webhook. Cada aviso puede traer hasta 3 acciones (enlaces firmados).
- `ntfy` · L16 — Envía un aviso por ntfy, con botones de acción.
- `telegram` · L36 — Envía un aviso por Telegram; los botones abren enlaces firmados.
- `webhook` · L52 — Envía el aviso como JSON a un webhook.

### `src/conectores/ical.js`
Lector iCal: sirve con el enlace privado de Google Calendar, iCloud y Outlook. Expande las repeticiones más comunes (diaria, semanal, mensual, anual) dentro de una ventana.
- `unfold` · L8 — Despliega las líneas plegadas de un iCalendar.
- `parseLine` · L12 — Separa una línea iCalendar en nombre, parámetros y valor.
- `unescape` · L21 — Quita los escapes de texto de iCalendar.
- `parseDate` · L34 · exportada — Fecha/hora iCalendar (con zona, UTC o día completo) a milisegundos.
- `parseDuration` · L50 — Duración ISO 8601 (P1DT2H…) a milisegundos.
- `parseICS` · L58 · exportada — Lee un .ics y devuelve sus eventos (con reglas de repetición).
- `occurrences` · L85 — Genera las fechas de inicio de una regla dentro de [from, to).
- `expand` · L128 · exportada — Devuelve [{uid, starts_at, ends_at, title, all_day}] dentro de la ventana.
- `refreshCalendars` · L157 · exportada — Actualiza los calendarios suscritos por URL .ics.
- `buildICS` · L187 · exportada — Feed propio: tu agenda y lo medido, para suscribirlo en Google/Apple/Outlook.

### `src/core.js`
Operaciones del dominio. Todas reciben un cliente dentro de una transacción.
- `enqueue` · L10 · exportada — Cola de cambios hacia tus cuentas (calendarios y notas). Un pendiente por objeto.
- `enqueueFlujo` · L18 · exportada — Si un ítem viene de la base «Flujo» de Notion, su fila se actualiza (estado, hora agendada, minutos).
- `lockTimer` · L23 · exportada — Serializa todo lo que toca la actividad abierta.
- `openSession` · L26 · exportada — Sesión de tiempo abierta (corriendo o en pausa), bloqueada para actualizar.
- `measuredMs` · L32 — Milisegundos medidos de una sesión sumando sus tramos.
- `stop` · L41 · exportada — Termina la sesión abierta y la registra.
- `pause` · L61 · exportada — Pausa la sesión que corre.
- `resume` · L71 · exportada — Reanuda la sesión en pausa.
- `findItem` · L81 · exportada — Busca una tarea o rutina por nombre; prefiere rutinas y coincidencias exactas.
- `createItem` · L94 · exportada — Crea una tarea o rutina validando nombre, duración y fecha.
- `clampMin` · L107 — Minutos entre 1 y 1440 (30 por defecto).
- `updateItem` · L110 · exportada — Actualiza los campos permitidos de una tarea o rutina.
- `start` · L144 · exportada — Inicia algo. Cierra lo que esté abierto. Si no existe con ese nombre, crea la tarea.
- `capture` · L171 · exportada — Guarda una captura rápida (texto o nota larga) desde la app o un atajo.
- `addBlock` · L189 · exportada — Agrega un bloque a la agenda (de una tarea o con título libre).
- `updateBlock` · L209 · exportada — Mueve, renombra o borra un bloque; el cambio viaja a tu calendario «Plan».
- `updateEvento` · L226 · exportada — Mueve o renombra un evento de otro calendario (solo los que no se repiten).

### `src/db.js`
_(sin comentario de cabecera)_
- `createPool` · L9 · exportada — Pool de conexiones PostgreSQL.
- `migrate` · L12 · exportada — Aplica en orden las migraciones de sql/ que falten.
- `tx` · L24 · exportada — Corre una función dentro de una transacción (BEGIN/COMMIT/ROLLBACK).
- `log` · L40 · exportada — Registra una línea en la bitácora de actividad.
- `getSetting` · L44 · exportada — Lee un ajuste guardado (o el valor por defecto).
- `setSetting` · L49 · exportada — Guarda un ajuste (insertar o reemplazar).

### `src/demo.js`
Modo demo: 3 semanas de datos de ejemplo para recorrer todo antes de conectar nada. Todo lo que crea queda marcado (demo = true) y se borra con un botón, sin tocar lo tuyo.
- `cargar` · L21 · exportada — Carga datos de ejemplo (proyectos, tareas, rutinas y 3 semanas de registro).
- `borrar` · L89 · exportada — Borra todos los datos de ejemplo.

### `src/estado.js`
Lo que ven la app, los atajos y el vigilante: siempre leído del servidor, nunca de una copia.
- `ms` · L8 — Fecha a milisegundos (null si no hay).
- `sessionsForHabits` · L11 · exportada — Sesiones de los últimos días con su duración, para detectar hábitos.
- `currentSession` · L22 · exportada — Sesión en curso con sus tramos.
- `agendaRange` · L33 · exportada — Bloques y eventos de calendario dentro de un rango.
- `buildState` · L50 · exportada — Estado completo que pinta la app: ahora, agenda, tareas, sugerencias, proyectos y conexiones.

### `src/mcp.js`
Servidor MCP (Model Context Protocol) en /mcp: Claude, Aurora u otro asistente pueden leer y manejar tu tiempo. Transporte «Streamable HTTP» sin estado: cada POST es una petición JSON-RPC y la respuesta va en JSON. Autenticación: token de Veredicto (Ajustes → Atajos) como «Authorization: Bearer jdt_…».
- `mcpRouter` · L40 · exportada — Servidor MCP (JSON-RPC en /mcp): herramientas de tiempo, agenda, tareas y agentes.

### `src/plan.js`
Aprender de lo que registras para no tener que agendar a mano.
- `isWeekend` · L6 — Si el día de la semana es sábado o domingo.
- `habits` · L10 · exportada — Hábitos: mismas cosas empezadas a una hora parecida, en el mismo tipo de día. sessions: [{item_id, title, started_at(ms), dur_ms}]
- `sugerencias` · L48 · exportada — Lo que sueles hacer cerca de esta hora (para el botón rápido y los avisos).
- `armarDia` · L69 · exportada — Arma el día: bloques para hábitos y rutinas con hora, sin pisar lo que ya está. ocupado: [{start, end}] ms (bloques existentes + eventos de calendario).

### `src/plantillas.js`
Plantillas de avisos. Tres capas, de menos a más importante:   1) las de fábrica (aquí)  2) las del equipo: tema/avisos.json  3) las tuyas, editadas en Ajustes.
- `merge` · L69 · exportada — Mezcla capas: cada capa solo pisa los campos que trae.
- `pick` · L80 — Copia solo las claves pedidas de un objeto.
- `equipo` · L83 · exportada — Plantillas de avisos del tema instalado (avisos.json), si hay.
- `loadPlantillas` · L89 · exportada — Plantillas de avisos: las del tema mezcladas con las tuyas.
- `fill` · L94 · exportada — Reemplaza {variables} en un texto de plantilla.
- `sanitize` · L97 · exportada — Valida lo que llega desde Ajustes.

### `src/prediccion.js`
Qué aprende el algoritmo y qué puede hacer con eso. Todo configurable desde Ajustes.
- `getPrediccion` · L18 · exportada — Ajustes del algoritmo de sugerencias con sus valores por defecto.
- `modoDe` · L25 · exportada — Modo de una tarea/rutina (sugerir, agendar o nunca).
- `habitosConModo` · L29 · exportada — Hábitos detectados con su modo ya aplicado.
- `paraAgendar` · L38 · exportada — Filtra según el uso: "agendar" solo deja lo que puede agendarse solo; "sugerir" deja agendar + sugerir.
- `paraSugerir` · L40 · exportada — Hábitos que se pueden sugerir (sin los marcados «nunca»).
- `rutinasPermitidas` · L42 · exportada — Rutinas permitidas para un uso (sugerir o agendar).
- `sanitizePred` · L49 · exportada — Valida los ajustes del algoritmo que llegan desde la app.

### `src/proyectos.js`
Pilares → proyectos → tareas, como en el Juez del Tiempo. Con minutos medidos y planificados.
- `txt` · L6 — Texto recortado a n caracteres.
- `crearPilar` · L10 · exportada — Crea un pilar.
- `editarPilar` · L19 · exportada — Edita un pilar.
- `crearProyecto` · L29 · exportada — Crea un proyecto (con pilar y fecha límite opcionales).
- `editarProyecto` · L40 · exportada — Edita un proyecto (estado, pilar, fechas, notas).
- `listar` · L53 · exportada — Lista con avance: tareas abiertas/hechas, minutos medidos (sesiones) y planificados (estimado de lo abierto).
- `asignar` · L79 · exportada — Asigna una tarea a un proyecto.
- `buscarProyecto` · L85 · exportada — Busca un proyecto por nombre aproximado.

### `src/server.js`
_(sin comentario de cabecera)_
- `every` · L58 — Tareas de fondo. Cada una protegida: un error no tumba el servidor.
- `bye` · L93 — Cierra el pool y termina el proceso (SIGTERM/SIGINT).

### `src/servicios.js`
Piezas compartidas por la app, los atajos y las tareas programadas.
- `changed` · L17 · exportada — Avisa a la app en vivo (SSE) que algo cambió.
- `armarHoy` · L20 · exportada — Propone (o crea) los bloques del día según tus hábitos y rutinas, sin pisar tu calendario.
- `enHuecos` · L54 · exportada — Ubica cada pendiente en el primer hueco libre (pasos de 15 min) dentro de tu horario de hoy.
- `armadoMatinal` · L74 · exportada — Cada mañana, al inicio de tu horario: arma el día solo y te manda el resumen (plantilla "armado").

### `src/sync/activitywatch.js`
ActivityWatch: qué hiciste en el computador (app y ventana), sin tiempo inactivo. Veredicto lee el servidor de ActivityWatch de tu computador por la red y guarda tramos resumidos.
- `aw` · L9 — GET a la API de ActivityWatch con tiempo límite.
- `probar` · L16 · exportada — Prueba la conexión a ActivityWatch y encuentra sus buckets.
- `activos` · L30 — Intervalos activos (no-afk) de un equipo.
- `recortar` · L36 — Recorta un tramo a los períodos con actividad (sin AFK).
- `limpiarTitulo` · L44 — Quita del título de ventana el nombre del navegador.
- `tramos` · L47 · exportada — Convierte eventos de ventana en tramos por app (unidos si hay pausas cortas).
- `sincronizar` · L71 · exportada — Trae las últimas horas y reemplaza los tramos no registrados de esa ventana.
- `resumen` · L106 · exportada — Resumen de un rango: tramos (con si ya están registrados o cubiertos por una sesión) y total por app.
- `reciente` · L127 · exportada — Lo que estás haciendo en el computador ahora (para el vigilante).

### `src/sync/caldav.js`
CalDAV en ambos sentidos: iCloud, Fastmail, Nextcloud, Synology Calendar, Radicale… Solo usa lo estándar (RFC 4791): PROPFIND, REPORT calendar-query, PUT con If-Match, DELETE, MKCALENDAR.
- `arr` · L9 — Valor a lista (null → []).
- `txt` · L11 — Texto de un nodo XML.
- `authHeader` · L16 — Cabecera Basic con usuario y clave.
- `dav` · L21 — Petición WebDAV con autenticación y tiempo límite.
- `responses` · L37 — Respuestas de un multistatus.
- `okProp` · L39 — Propiedades del propstat con estado 200.
- `propfind` · L45 — PROPFIND con las propiedades pedidas.
- `discover` · L53 · exportada — Encuentra la carpeta de calendarios del usuario.
- `listCalendars` · L66 · exportada — Calendarios de la cuenta CalDAV.
- `createCalendar` · L88 · exportada — Crea un calendario «veredicto-…» en la cuenta.
- `esc` · L98 — Escapa texto para XML.
- `dt` · L100 — Milisegundos a fecha UTC de iCalendar.
- `pull` · L103 · exportada — Trae los eventos de un calendario dentro de la ventana, con su etag.
- `toICS` · L119 · exportada — Arma el VEVENT de un bloque o evento.
- `patchICS` · L134 · exportada — Cambia solo título y horas de un evento que no es nuestro, sin perder el resto (invitados, alarmas, notas).
- `etagOf` · L157 — ETag actual de un evento.
- `put` · L163 · exportada — Crea o reemplaza un evento nuestro. Con etag, solo si nadie lo cambió (If-Match).
- `patch` · L174 · exportada — Mueve o renombra un evento ajeno conservando todo lo demás.
- `remove` · L187 · exportada — Borra un evento (con If-Match si hay ETag).

### `src/sync/espejo.js`
Las 9 bases del Juez del Tiempo en Notion: Pilares, Proyectos, Tareas, Ideas e Inbox, Rutinas y hábitos, Recurrencias, Calendario, Sesiones y Actividad y revisiones. Veredicto las crea (o adopta las «TimeMachine - …» que ya tienes, e importa su historial) y las mantiene al día. Igual que el Juez antiguo: se edita en Veredicto y Notion muestra; la base «Flujo» es la que va en ambos sentidos.
- `T` · L16 — Texto a rich_text de Notion (recortado).
- `plano` · L18 — rich_text de Notion a texto plano.
- `iso` · L20 — Fecha a ISO (null si no hay).
- `dia` · L22 — Fecha a AAAA-MM-DD.
- `comunes` · L30 — Columnas comunes a 8 de las 9 bases (igual que las del Juez antiguo).
- `enlazarFlujo` · L40 · exportada — Crea las 9 bases bajo tu página de Notion. Agrega a «Flujo» la relación con Proyectos, para asignar un proyecto desde Notion.
- `crear` · L46 · exportada — Crea las 9 bases de Notion bajo la página raíz.
- `adoptar` · L64 · exportada — Busca tus bases existentes: «TimeMachine - X» (del Juez antiguo) o «Veredicto · X».
- `todas` · L82 — ---------- Importar historial desde las bases adoptadas ----------
- `leer` · L94 — Lee una propiedad de una página de Notion como valor simple.
- `recordar` · L108 — Guarda qué página de Notion corresponde a cada fila local.
- `sinGuiones` · L111 — Id de Notion sin guiones.
- `importar` · L114 · exportada — Importa desde las 9 bases de Notion: pilares, proyectos, tareas, rutinas, sesiones, calendario e ideas.
- `hash` · L196 — ---------- Publicar: lo que cambió en Veredicto se escribe en su fila ----------
- `filas` · L200 — Filas locales de una base para publicar en Notion.
- `publicar` · L282 · exportada — Publica en Notion lo que cambió localmente (hasta `limite` filas).
- `guia` · L311 · exportada — Página guía con plantillas en Notion (viñetas, no casillas: las casillas se volverían gestiones).

### `src/sync/google.js`
Google Calendar en ambos sentidos (API v3) con tu propio cliente OAuth.
- `g` · L7 — Llamada a Google Calendar con OAuth.
- `fecha` · L9 — AAAA-MM-DD a medianoche en la zona dada.
- `listCalendars` · L12 · exportada — Calendarios de la cuenta de Google.
- `createCalendar` · L23 · exportada — Crea un calendario en Google.
- `pull` · L29 · exportada — Eventos de un calendario dentro del rango (paginado).
- `cuerpo` · L54 — Evento local al formato de Google.
- `put` · L62 · exportada — Crea o reemplaza un evento.
- `patch` · L70 · exportada — Cambia campos de un evento.
- `remove` · L76 · exportada — Borra un evento (ignora si ya no existe).

### `src/sync/markdown.js`
Notas en Markdown (Obsidian, Logseq, cualquier carpeta de .md) en ambos sentidos. Cada casilla «- [ ] …» es una gestión. Marcarla en la app la marca en el archivo, y al revés.
- `seguro` · L12 — Ruta dentro de la carpeta; rechaza salirse de ella.
- `verificar` · L19 · exportada — Comprueba que la carpeta de notas exista.
- `listar` · L26 · exportada — Archivos .md de la carpeta (recursivo, con límite).
- `limpio` · L46 — Texto de la tarea sin marcas de fecha ni de hecho.
- `idDe` · L48 — Id estable de una tarea Markdown (archivo + texto + ocurrencia).
- `tareas` · L51 · exportada — Tareas `- [ ]` de un archivo Markdown.
- `leer` · L68 · exportada — Lee las tareas de un archivo de la carpeta.
- `escribirAtomico` · L74 — Escribe un archivo de forma atómica (temporal + rename).
- `marcar` · L81 · exportada — Marca o desmarca una casilla. Si el texto cambió en el archivo, no toca nada.
- `bandeja` · L98 · exportada — Agrega una línea a la nota de bandeja del día (Bandeja/AAAA-MM-DD.md).

### `src/sync/motor.js`
Motor de sincronización. Trae cambios de cada cuenta, los concilia con el espejo local y despacha la cola de cambios hechos en la app. Un solo motor a la vez.
- `cuentaConfig` · L20 · exportada — Configuración descifrada de una cuenta y función para guardarla.
- `conflicto` · L27 — Registra un conflicto de sincronización (quién ganó).
- `cancelarCola` · L31 — Cancela trabajos pendientes de la cola que perdieron contra un cambio externo.
- `conciliarEventos` · L35 · exportada — ---------- Calendarios: espejo de eventos ajenos ----------
- `conciliarBloques` · L71 · exportada — ---------- Calendario «Plan»: sus eventos son tus bloques ----------
- `conciliarNota` · L113 · exportada — ---------- Notas: casillas = gestiones ----------
- `conciliarFila` · L146 · exportada — Concilia una tarea externa (Notion/Markdown) con la local.
- `pullNotas` · L191 — Trae tareas de Markdown o Notion de una cuenta.
- `withTx` · L227 — Transacción con conexión propia.
- `traer` · L235 · exportada — ---------- Traer ----------
- `backoff` · L260 — ---------- Despachar la cola ----------
- `calendarioCon` · L263 — Calendario con un rol (plan/registrado) y su cuenta.
- `despacharUno` · L270 — Envía un trabajo de la cola a su destino (calendario, notas).
- `despachar` · L355 · exportada — Envía los trabajos pendientes de la cola.
- `enSerie` · L382 — Encola trabajos para que corran de a uno.
- `empujar` · L385 · exportada — Solo empujar la cola (rápido, tras cada cambio en la app).
- `sincronizar` · L389 · exportada — Pasada completa: traer de cuentas, conciliar y empujar la cola.

### `src/sync/notion.js`
Notion en ambos sentidos: las casillas (to_do) de las páginas bajo tu página raíz son gestiones.
- `cliente` · L5 · exportada — Cliente de Notion con el token de la cuenta.
- `pageIdFrom` · L8 · exportada — Id de página desde un enlace o id de Notion.
- `plano` · L13 — rich_text a texto plano.
- `tituloDe` · L15 — Título de una página de Notion.
- `verificar` · L18 · exportada — Comprueba el acceso a la página raíz y encuentra las bases.
- `cambiadas` · L28 · exportada — Páginas editadas desde «desde» (ISO). La integración solo ve lo que compartiste con ella.
- `leer` · L45 · exportada — Casillas de una página (incluye las anidadas hasta 2 niveles).
- `marcar` · L67 · exportada — Marca o desmarca un to-do en Notion.
- `bandeja` · L74 · exportada — Agrega una casilla a la página «Bandeja» (la crea bajo tu raíz la primera vez).
- `crearFlujo` · L102 · exportada — Crea la base «flujo» en la página raíz.
- `sel` · L120 — Nombre de una propiedad select.
- `fila` · L122 · exportada — Página de la base flujo a fila local.
- `leerFlujo` · L139 · exportada — Filas editadas desde «desde» (ISO), de la más antigua a la más nueva.
- `escribirFila` · L156 · exportada — Escribe de vuelta lo que pasó en Veredicto: estado, hora agendada y tiempo registrado.
- `nuevaFila` · L167 · exportada — Crea una fila en la base flujo (idea o tarea).

### `src/sync/oauth.js`
OAuth con tu propio cliente (Google Cloud o Azure). Nada pasa por servidores de terceros.
- `redirectUri` · L18 · exportada — URL de retorno OAuth del proveedor.
- `authUrl` · L21 · exportada — URL para autorizar en Google u Outlook.
- `tokenCall` · L29 — Llamada al endpoint de tokens del proveedor.
- `exchange` · L45 · exportada — Cambia el código OAuth por tokens.
- `accessToken` · L52 · exportada — Devuelve un token válido; si el proveedor rota el refresh_token (Microsoft), avisa para guardarlo.
- `api` · L63 · exportada — Llamada autenticada (renueva el token si venció).

### `src/sync/outlook.js`
Outlook / Microsoft 365 en ambos sentidos (Microsoft Graph) con tu propio registro de app en Azure.
- `m` · L6 — Llamada a Microsoft Graph con zona UTC.
- `utc` · L10 — Fecha de Graph a milisegundos UTC.
- `listCalendars` · L13 · exportada — Calendarios de la cuenta de Outlook.
- `createCalendar` · L19 · exportada — Crea un calendario en Outlook.
- `pull` · L24 · exportada — Eventos de un calendario dentro del rango (paginado).
- `cuerpo` · L44 — Evento local al formato de Graph.
- `put` · L53 · exportada — Crea o reemplaza un evento.
- `patch` · L61 · exportada — Cambia campos de un evento.
- `remove` · L67 · exportada — Borra un evento (ignora si ya no existe).

### `src/time.js`
Fechas en la zona horaria configurada, sin librerías.
- `fmt` · L5 — Formateador por zona horaria (en caché).
- `parts` · L16 · exportada — Año, mes, día, hora, minuto, segundo y día de la semana en una zona.
- `isValidZone` · L21 · exportada — Si la zona horaria existe.
- `offset` · L25 — Diferencia de la zona con UTC en un instante.
- `zoned` · L30 · exportada — Hora de pared en tz → instante UTC.
- `startOfDay` · L38 · exportada — Inicio del día en la zona.
- `addDays` · L40 · exportada — Suma días respetando cambios de horario.
- `minuteOfDay` · L42 · exportada — Minuto del día en la zona.
- `weekday` · L44 · exportada — Día de la semana (0 = domingo) en la zona.
- `dayKey` · L46 · exportada — Fecha AAAA-MM-DD en la zona.
- `atMinute` · L48 · exportada — Instante de un minuto del día en la zona.
- `hhmmToMin` · L53 · exportada — «HH:MM» a minutos.
- `fmtDur` · L55 · exportada — Duración legible (1 h 20 min).
- `fmtHora` · L60 · exportada — Hora HH:MM en la zona.
- `normalize` · L62 · exportada — Texto sin tildes y en minúsculas, para comparar.

### `src/vigilante.js`
El vigilante: mira el servidor (la única verdad) cada minuto y avisa. Qué avisa y cómo suena lo deciden las plantillas (fábrica < equipo < tus ajustes).
- `inWindow` · L16 · exportada — Si un minuto del día cae en la ventana desde–hasta.
- `windowStart` · L22 · exportada — Inicio de la ventana de hoy (o de ayer si la ventana cruza medianoche y estamos de madrugada).
- `hayCanal` · L29 — Si hay algún canal de avisos configurado.
- `msCorriendo` · L31 — Milisegundos que lleva corriendo la sesión.
- `datosDe` · L33 — Datos mínimos para la acción firmada (item o título).
- `construirAviso` · L37 · exportada — Convierte un evento + variables en un aviso usando su plantilla. op: { ahora, lista: [{item_id,title,seguir?}], current }
- `decide` · L68 · exportada — Decisión pura (sin red ni base). ctx: { now, tz, cfg, st, current, idleSince, ahora, proximo, estimadoMin, sugeridas, plantillas }
- `idleSince` · L131 — Desde cuándo no se registra nada (inactividad).
- `timed` · L140 — Bloques y eventos con hora, en una sola lista.
- `agendadoAhora` · L145 · exportada — Lo que está ocurriendo ahora (bloques tuyos primero, luego el calendario).
- `proximoEn` · L147 · exportada — Lo que empieza dentro de los próximos `min` minutos.
- `entregar` · L150 · exportada — Firma los botones, agrega el ícono del equipo y manda por todos los canales.
- `vigilar` · L165 · exportada — Revisa el momento y manda los avisos que correspondan (empezar, parar, inactividad).

### `public/app.js`
Pantalla fina: no guarda datos. Todo se lee del servidor y se actualiza en vivo.
- `h` · L9 — ---------- utilidades ----------
- `fmtDur` · L24 — Duración como reloj HH:MM:SS.
- `fmtCorto` · L29 — Duración corta (45 min, 1 h 20).
- `hora` · L31 — Hora HH:MM en la zona del servidor.
- `fecha` · L33 — Fecha larga en español.
- `toast` · L37 — Muestra un aviso breve (rojo si es error).
- `api` · L47 — fetch a la API con JSON y errores legibles.
- `act` · L60 — Ejecuta una acción y re-dibuja. Los botones se deshabilitan mientras tanto.
- `refrescar` · L70 — Vuelve a pedir el estado y repinta (agrupa llamadas seguidas).
- `conectarEnVivo` · L86 — Escucha /api/eventos (SSE) para refrescar al haber cambios.
- `inicio` · L97 — ---------- arranque ----------
- `render` · L118 — Pinta la vista según el hash de la URL.
- `vistaInstalar` · L142 — ---------- cuenta ----------
- `vistaEntrar` · L156 — Pantalla de ingreso o creación de cuenta.
- `msActual` · L164 — ---------- Hoy ----------
- `tarjetaAhora` · L167 — Tarjeta de lo que corre ahora, con su reloj y botones.
- `iniciarPor` · L188 — Inicia una sesión con los datos dados.
- `vistaHoy` · L191 — Vista Hoy: qué hacer ahora, agenda del día, sugerencias y tareas.
- `filaAgenda` · L235 — Una fila de agenda: bloque tuyo o evento de tus calendarios. ▶ inicia, ✎ mueve o renombra, ✕ borra.
- `diaCorto` · L248 — Día corto (lun 3).
- `hhmmDe` · L250 — HH:MM de un instante.
- `fechaDe` · L252 — AAAA-MM-DD de un instante.
- `enZona` · L254 — Fecha AAAA-MM-DD + HH:MM en la zona del servidor → milisegundos.
- `editarAgenda` · L261 — Formulario para editar un bloque de la agenda.
- `vistaAgenda` · L290 — Vista Agenda de la semana.
- `armar` · L316 — Arma el día con las sugerencias.
- `formBloque` · L328 — Formulario para agregar un bloque.
- `proximaMediaHora` · L341 — Próxima media hora redonda como HH:MM.
- `hoyA` · L343 — Hoy a las HH:MM en la zona del servidor (se asume la misma que la del teléfono; si difiere, se corrige con el desfase).
- `resumenTramos` · L353 — Resumen del tiempo en el computador por app.
- `vistaTareas` · L363 — ---------- Tareas y rutinas ----------
- `vistaGestiones` · L408 — ---------- Gestiones: casillas de tus notas + capturas ----------
- `vistaRegistro` · L453 — Vista Registro: lo hecho por día y proyecto.
- `vistaAjustes` · L489 — Vista Ajustes.
- `tarjetaTokens` · L542 — Lista y revoca tokens de acceso.
- `tarjetaCarpeta` · L555 — Instrucciones y token para la carpeta sincronizada.
- `pasoAvisos` · L572 — Ajustes de avisos (ntfy, Telegram, webhook y horario).
- `recargarCuentas` · L611 — Vuelve a pedir las cuentas conectadas.
- `estadoCuenta` · L614 — Texto de estado de una cuenta conectada.
- `pasoCalendarios` · L621 — Conectar calendarios (iCloud/CalDAV, Google, Outlook).
- `oauthForm` · L693 — Formulario de cliente OAuth (Google/Outlook).
- `pasoNotas` · L706 — Conectar notas (carpeta Markdown o Notion).
- `tarjetaSync` · L737 — Estado de la sincronización por cuenta.
- `pasoAtajos` · L752 — Atajos de iPhone: token y URLs.
- `vistaPlantillas` · L787 — Editor de textos de los avisos.
- `vistaAlgoritmo` · L840 — Ajustes del algoritmo de sugerencias.
- `vistaBienvenida` · L884 — Bienvenida guiada, paso n.
- `nombreProyecto` · L952 — Nombre de un proyecto por id.
- `selectorProyecto` · L954 — Selector de proyecto.
- `bandaDemo` · L959 — Banda que avisa que hay datos de ejemplo.
- `vistaProyectos` · L967 — Vista Proyectos y pilares.
- `tarjetaComputador` · L1038 — Tiempo en el computador (ActivityWatch).
- `pasoComputador` · L1067 — Conectar ActivityWatch.
- `pasoAsistente` · L1092 — Conectar un asistente por MCP (token y URL).
- `basesNotion` · L1118 — Estado de las 9 bases de Notion e importación.
- `haceTxt` · L1146 — Hace cuánto (hace 5 min).
- `cargarInfra` · L1149 — Pide los datos de la pestaña Infraestructura.
- `infraAct` · L1155 — Acción en Infraestructura y recarga.
- `patchTarea` · L1157 — Cambia una tarea de agente.
- `vistaInfra` · L1160 — Pestaña Infraestructura (tablero de agentes y ajustes).
- `filaTarea` · L1170 — Fila de una tarea en el tablero de agentes.
- `hojaTablero` · L1193 — Hoja Tablero: cola, trabajando, revisión y bloqueadas.
- `hojaAgentes` · L1238 — Hoja Agentes: foco, noche, carriles y agentes activos.

### `public/sw.js`
Sin caché de datos a propósito: la verdad vive en el servidor. Solo existe para que la app sea instalable.
