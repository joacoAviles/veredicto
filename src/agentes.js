// Agentes (Hermes): una cola de tareas con prioridad, carriles (local/cloud), ventana nocturna
// y aprobación. Veredicto decide qué sigue; el agente solo pide la siguiente y reporta.
import { getSetting, setSetting, log } from "./db.js";
import * as core from "./core.js";
import * as proyectos from "./proyectos.js";
import { agendaRange, currentSession } from "./estado.js";
import { startOfDay, addDays, dayKey, minuteOfDay, hhmmToMin, fmtHora } from "./time.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ESTADOS = ["cola", "trabajando", "revision", "bloqueada", "aprobada", "rechazada"];
export const DEFAULTS = {
  foco: [],                    // ids de los proyectos foco de la semana: van antes en la cola
  noche: { desde: "00:00", hasta: "07:00" },
  pausa_conversacion_min: 3,   // tras un mensaje de WhatsApp, el carril local espera esto
  max_por_carril: 1,           // tareas trabajando a la vez por carril
  trabajo_max_min: 90,         // una tarea «trabajando» sin latido por más que esto vuelve a la cola
};

// Módulos opcionales: la Infraestructura (agentes) viene apagada y se enciende en Ajustes.
export const MODULOS = { infra: false };
// Módulos opcionales encendidos (p. ej. infra), con sus valores por defecto.
export async function modulos(q) { return { ...MODULOS, ...((await getSetting(q, "modulos", {})) || {}) }; }

// Configuración de agentes (foco, ventana de noche, pausas) mezclada con los valores por defecto.
export async function config(q) {
  const c = { ...DEFAULTS, ...((await getSetting(q, "agentes", {})) || {}) };
  c.noche = { ...DEFAULTS.noche, ...(c.noche || {}) };
  return c;
}

// Valida y normaliza la configuración de agentes que llega desde la app.
export function sanitizeConfig(b, prev = DEFAULTS) {
  const hhmm = (v, d) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? String(v) : d);
  const num = (v, d, lo, hi) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d);
  const foco = Array.isArray(b.foco) ? b.foco : typeof b.foco === "string" ? b.foco.split(",") : prev.foco;
  return {
    foco: [...new Set(foco.map((x) => String(x).trim()).filter((x) => UUID.test(x)))].slice(0, 5),
    noche: { desde: hhmm(b.noche?.desde, prev.noche.desde), hasta: hhmm(b.noche?.hasta, prev.noche.hasta) },
    pausa_conversacion_min: num(b.pausa_conversacion_min, prev.pausa_conversacion_min, 0, 30),
    max_por_carril: num(b.max_por_carril, prev.max_por_carril, 1, 5),
    trabajo_max_min: num(b.trabajo_max_min, prev.trabajo_max_min, 10, 720),
  };
}

// Si `now` cae dentro de la ventana de noche configurada (cruza medianoche si hace falta).
export function esNoche(now, tz, c) {
  const m = minuteOfDay(now, tz), a = hhmmToMin(c.noche.desde), b = hhmmToMin(c.noche.hasta);
  return a <= b ? m >= a && m < b : m >= a || m < b;
}

// Orden de la cola: vence en ≤3 días → proyecto foco → prioridad (1 primero) → antigüedad.
const ORDEN = `(i.due_date IS NOT NULL AND i.due_date <= $1::date) DESC,
  (i.proyecto_id IS NOT NULL AND i.proyecto_id = ANY($2::uuid[])) DESC,
  coalesce(i.prioridad, 3), i.created_at`;
// Parámetros SQL del orden de la cola: vence en ≤3 días, proyectos en foco y prioridad.
const ordenArgs = (now, tz, c) => [dayKey(addDays(startOfDay(now, tz), 3, tz), tz), c.foco];
const SEL = "SELECT i.*, p.nombre AS proyecto_nombre FROM items i LEFT JOIN proyectos p ON p.id=i.proyecto_id";
// Lee una tarea con el nombre de su proyecto.
const leerItem = async (q, id) => (await q.query(`${SEL} WHERE i.id=$1`, [id])).rows[0];

// Registra un evento de agente (tomó, latido, terminó…) en agente_eventos.
const evento = (q, itemId, agente, tipo, texto = "") =>
  q.query("INSERT INTO agente_eventos(item_id, agente, tipo, texto) VALUES ($1,$2,$3,$4)", [itemId, String(agente || "").slice(0, 60), tipo, String(texto).slice(0, 2000)]);

// Forma pública de una tarea para agentes y la app (campos de agente incluidos).
export function vistaItem(i) {
  return {
    id: i.id, title: i.title, status: i.status, proyecto: i.proyecto_nombre || null, proyecto_id: i.proyecto_id || null,
    eisenhower: i.eisenhower || null, prioridad: i.prioridad || null,
    asignado: i.asignado, carril: i.carril, ventana: i.ventana, estado: i.agente_estado || null,
    agente: i.agente_por || null, desde: i.agente_desde ? +i.agente_desde : null, cloud_ok: !!i.cloud_ok,
    due_date: i.due_date ? new Date(i.due_date).toISOString().slice(0, 10) : null,
    est_min: i.est_min, detalle: i.detalle || "", resultado: i.resultado || "",
  };
}

// Pide la siguiente tarea para un carril. Devuelve {tarea} o {espera: motivo}.
export async function siguiente(q, { carril = "local", agente = "", tz, now = Date.now() }) {
  if (!["local", "cloud"].includes(carril)) throw new core.HttpError(400, "Carril no válido (local o cloud).");
  const c = await config(q);
  await q.query("SELECT pg_advisory_xact_lock(4317002)");
  // Lo que quedó «trabajando» sin noticias vuelve a la cola.
  const viejas = await q.query(
    `UPDATE items SET agente_estado='cola', agente_por=NULL, agente_desde=NULL
     WHERE asignado='agente' AND agente_estado='trabajando' AND agente_desde < now() - make_interval(mins => $1) RETURNING id, agente_por`, [c.trabajo_max_min]);
  for (const v of viejas.rows) await evento(q, v.id, v.agente_por, "devuelta", "Sin latido: vuelve a la cola.");
  if (carril === "local") {
    const hasta = Number(await getSetting(q, "conversando_hasta", 0)) || 0;
    if (hasta > now) return { espera: "conversacion", hasta };
  }
  const ocupados = (await q.query("SELECT count(*)::int n FROM items WHERE asignado='agente' AND agente_estado='trabajando' AND carril=$1", [carril])).rows[0].n;
  if (ocupados >= c.max_por_carril) return { espera: "ocupado" };
  const noche = esNoche(now, tz, c);
  const r = await q.query(
    `SELECT i.id FROM items i WHERE i.asignado='agente' AND i.agente_estado='cola' AND i.status NOT IN ('hecha','archivada')
       AND i.carril=$3 AND ($4 OR i.ventana='dia') AND (i.carril='local' OR i.cloud_ok)
     ORDER BY ${ORDEN} LIMIT 1 FOR UPDATE SKIP LOCKED`,
    [...ordenArgs(now, tz, c), carril, noche]);
  if (!r.rowCount) return { espera: "vacia" };
  await q.query(
    "UPDATE items SET agente_estado='trabajando', agente_por=$2, agente_desde=now(), status='en curso', updated_at=now() WHERE id=$1",
    [r.rows[0].id, String(agente || carril).slice(0, 60)]);
  const it = await leerItem(q, r.rows[0].id);
  await evento(q, it.id, agente, "tomada", `carril ${carril}`);
  await log(q, "agente.tomada", `${it.title} · ${agente || carril}`);
  return { tarea: vistaItem(it) };
}

const CAMPOS = ["title", "proyecto", "proyecto_id", "eisenhower", "prioridad", "asignado", "carril", "ventana", "due_date", "est_min", "detalle", "resultado", "estado", "cloud_ok"];

// «proyecto» puede venir como id o como nombre (lo que dice una persona por WhatsApp).
async function proyectoId(q, b) {
  if (b.proyecto_id !== undefined) return b.proyecto_id || null;
  if (b.proyecto === undefined) return undefined;
  if (!b.proyecto) return null;
  if (UUID.test(String(b.proyecto))) return b.proyecto;
  const p = await proyectos.buscarProyecto(q, b.proyecto);
  if (p) return p.id;
  const hay = (await q.query("SELECT nombre FROM proyectos WHERE estado IN ('activo','pausado') ORDER BY nombre LIMIT 30")).rows.map((x) => x.nombre);
  throw new core.HttpError(400, `No encontré el proyecto «${b.proyecto}».${hay.length ? " Proyectos: " + hay.join(", ") + "." : " Aún no hay proyectos."}`);
}

// Crea una tarea delegable con prioridad, carril, ventana y asignación.
export async function crear(q, b, { agente = "" } = {}) {
  const it = await core.createItem(q, { kind: "tarea", title: b.title, est_min: b.est_min, due_date: b.due_date, eisenhower: b.eisenhower || (b.asignado === "agente" ? "Delegar" : null) });
  const asignado = b.asignado === "agente" ? "agente" : "yo";
  const out = await actualizar(q, it.id, { ...b, asignado, estado: asignado === "agente" ? b.estado || "cola" : undefined }, { agente, crear: true });
  await evento(q, it.id, agente, "creada", b.title);
  return out;
}

// Cambia campos de una tarea; valida transiciones de estado y deja evento.
export async function actualizar(q, id, b, { agente = "", via = "cookie", crear = false } = {}) {
  const prev = (await q.query("SELECT * FROM items WHERE id=$1 AND kind='tarea'", [id])).rows[0];
  if (!prev) throw new core.HttpError(404, "No encontré esa tarea.");
  b = { ...(b || {}) };
  const pid = await proyectoId(q, b);
  delete b.proyecto; delete b.proyecto_id;
  if (pid !== undefined) b.proyecto_id = pid;
  // Delegar a un agente es el cuadrante «Delegar» de Eisenhower si no tenía uno.
  if (b.asignado === "agente" && !prev.eisenhower && b.eisenhower === undefined) b.eisenhower = "Delegar";
  const sets = [], vals = [id];
  const set = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  for (const k of CAMPOS) {
    if (!(k in (b || {})) || b[k] === undefined || k === "title" && crear) continue;
    const v = b[k];
    if (k === "title") { const t = String(v || "").trim().slice(0, 300); if (!t) throw new core.HttpError(400, "Falta el nombre."); set("title", t); }
    if (k === "proyecto_id") set("proyecto_id", v || null);
    if (k === "eisenhower") { if (v && !core.EISEN.includes(v)) throw new core.HttpError(400, `Eisenhower: ${core.EISEN.join(", ")}.`); set("eisenhower", v || null); }
    if (k === "prioridad") { const p = v == null || v === "" ? null : Number(v); if (p != null && !(p >= 1 && p <= 4)) throw new core.HttpError(400, "Prioridad de 1 a 4."); set("prioridad", p); }
    if (k === "asignado") { if (!["yo", "agente"].includes(v)) throw new core.HttpError(400, "Asignado: yo o agente."); set("asignado", v); }
    if (k === "carril") { if (!["local", "cloud"].includes(v)) throw new core.HttpError(400, "Carril: local o cloud."); set("carril", v); }
    if (k === "ventana") { if (!["dia", "noche"].includes(v)) throw new core.HttpError(400, "Ventana: dia o noche."); set("ventana", v); }
    if (k === "due_date") set("due_date", v || null);
    if (k === "est_min") set("est_min", Math.max(1, Math.min(1440, Math.round(Number(v) || 30))));
    if (k === "detalle") set("detalle", String(v || "").slice(0, 20000));
    if (k === "resultado") set("resultado", String(v || "").slice(0, 50000));
    if (k === "cloud_ok") {
      // Mandar algo a un proveedor pago es decisión tuya: un agente solo lo marca citando tu respuesta.
      const conf = String(b.confirmado_por || "").trim();
      if (via === "token" && v && !conf) throw new core.HttpError(403, "El carril cloud lo apruebas tú: manda confirmado_por con tu respuesta textual.");
      set("cloud_ok", !!v);
      if (via === "token" && v) await evento(q, id, agente, "cloud_ok", `Confirmado: ${conf.slice(0, 300)}`);
    }
  }
  let estado = b?.estado;
  if (b?.asignado === "agente" && !prev.agente_estado && !estado) estado = "cola";
  if (b?.asignado === "yo") { set("agente_estado", null); set("agente_por", null); set("agente_desde", null); }
  else if (estado !== undefined) {
    if (!ESTADOS.includes(estado)) throw new core.HttpError(400, `Estado no válido: ${ESTADOS.join(", ")}.`);
    if (estado === "trabajando") throw new core.HttpError(400, "Para tomar una tarea usa /api/agente/siguiente.");
    set("agente_estado", estado);
    if (estado === "cola") { set("agente_por", null); set("agente_desde", null); }
    const status = { cola: "pendiente", rechazada: "pendiente", aprobada: "hecha", revision: "en curso", bloqueada: "en curso" }[estado];
    if (!("status" in b)) set("status", status);
  }
  if (!sets.length) throw new core.HttpError(400, "Nada que cambiar.");
  await q.query(`UPDATE items SET ${sets.join(",")}, updated_at=now() WHERE id=$1`, vals);
  const it = await leerItem(q, id);
  if (estado && estado !== prev.agente_estado && !crear) await evento(q, id, agente, estado, b.nota || b.resultado?.slice(0, 300) || "");
  else if (b?.nota) await evento(q, id, agente, "nota", b.nota);
  if (it.fuente !== "app" && it.status !== prev.status) await core.enqueue(q, "gestion", id);
  return vistaItem(it);
}

// Lista tareas de agentes con filtros (asignado, estado, carril, proyecto) en orden de cola.
export async function listar(q, { asignado, estado, carril, proyecto, limite = 50, tz, now = Date.now() } = {}) {
  const c = await config(q);
  const w = ["i.kind='tarea'", "i.status <> 'archivada'"], vals = ordenArgs(now, tz, c);
  const add = (sql, v) => { vals.push(v); w.push(sql.replace("?", `$${vals.length}`)); };
  if (asignado) add("i.asignado=?", asignado);
  if (estado) add("i.agente_estado = ANY(?::text[])", String(estado).split(","));
  else w.push("i.status <> 'hecha'");
  if (carril) add("i.carril=?", carril);
  if (proyecto) add("i.proyecto_id=?", await proyectoId(q, { proyecto }));
  const lim = Math.max(1, Math.min(200, Number(limite) || 50));
  const r = await q.query(`${SEL} WHERE ${w.join(" AND ")} ORDER BY ${ORDEN} LIMIT ${lim}`, vals);
  return r.rows.map(vistaItem);
}

// Lo que tu asistente necesita para contestar WhatsApp: ¿estás ocupado?, qué viene, qué tienes pendiente.
export async function contexto(q, { tz, now = Date.now() }) {
  const day = startOfDay(now, tz);
  const a = await agendaRange(q, day, addDays(day, 2, tz));
  const todo = [...a.blocks.map((b) => ({ ...b, tipo: "bloque" })), ...a.events.filter((e) => !e.all_day).map((e) => ({ ...e, tipo: "evento" }))]
    .sort((x, y) => x.start - y.start);
  const ahora = todo.filter((x) => x.start <= now && x.end > now);
  const proximos = todo.filter((x) => x.start > now).slice(0, 5);
  const libreHasta = proximos[0]?.start || null;
  const sesion = await currentSession(q);
  const mias = await listar(q, { asignado: "yo", limite: 5, tz, now });
  const revision = await listar(q, { asignado: "agente", estado: "revision", limite: 10, tz, now });
  const cola = (await q.query("SELECT carril, agente_estado, count(*)::int n FROM items WHERE asignado='agente' AND agente_estado IN ('cola','trabajando','bloqueada') GROUP BY 1,2")).rows;
  const ocupado = ahora.length > 0;
  const hasta = ocupado ? Math.max(...ahora.map((x) => x.end)) : null;
  const h = (ms) => fmtHora(ms, tz);
  const texto = [
    ocupado ? `Ocupado hasta las ${h(hasta)}: ${ahora.map((x) => x.title).join(" + ")}.` : libreHasta ? `Libre hasta las ${h(libreHasta)}.` : "Libre el resto del día.",
    sesion ? `Registrando: ${sesion.title}${sesion.state === "paused" ? " (en pausa)" : ""}.` : null,
    proximos.length ? `Próximo: ${proximos.slice(0, 3).map((x) => `${h(x.start)} ${x.title}`).join(" · ")}.` : null,
    mias.length ? `Pendientes tuyos: ${mias.slice(0, 3).map((x) => x.title).join(" · ")}.` : null,
    revision.length ? `Esperan tu OK: ${revision.length}.` : null,
  ].filter(Boolean).join("\n");
  return {
    ahora: now, ocupado, en_reunion: ahora.some((x) => x.tipo === "evento"), ocupado_hasta: hasta, libre_hasta: ocupado ? null : libreHasta,
    en_curso: ahora.map((x) => ({ tipo: x.tipo, title: x.title, start: x.start, end: x.end, calendario: x.calendario || null })),
    proximos: proximos.map((x) => ({ tipo: x.tipo, title: x.title, start: x.start, end: x.end, calendario: x.calendario || null })),
    registrando: sesion ? { title: sesion.title, state: sesion.state } : null,
    mis_tareas: mias, en_revision: revision, cola, texto,
  };
}

// Marca que un agente sigue vivo (y en qué tarea trabaja).
export async function latido(q, b) {
  const nombre = String(b.agente || b.nombre || "").trim().slice(0, 60);
  if (!nombre) throw new core.HttpError(400, "Falta el nombre del agente.");
  await q.query(
    `INSERT INTO agentes(nombre, carril, modelo, maquina, estado, item_id, visto) VALUES ($1,$2,$3,$4,$5,$6,now())
     ON CONFLICT (nombre) DO UPDATE SET carril=$2, modelo=$3, maquina=$4, estado=$5, item_id=$6, visto=now()`,
    [nombre, b.carril === "cloud" ? "cloud" : "local", String(b.modelo || "").slice(0, 120), String(b.maquina || "").slice(0, 80), String(b.estado || "").slice(0, 200), b.item_id || null]);
  // Una tarea con latido no se considera abandonada.
  if (b.item_id) await q.query("UPDATE items SET agente_desde=now() WHERE id=$1 AND agente_estado='trabajando'", [b.item_id]);
}

// Pausa el carril local unos minutos: WhatsApp tiene prioridad sobre las tareas.
export async function conversando(q, { minutos, now = Date.now() } = {}) {
  const c = await config(q);
  const hasta = now + (Number.isFinite(Number(minutos)) ? Math.max(0, Math.min(30, Number(minutos))) : c.pausa_conversacion_min) * 60_000;
  await setSetting(q, "conversando_hasta", hasta);
  return hasta;
}

// Datos de la pestaña Infraestructura: agentes, tokens, eventos recientes y pausa.
export async function infra(q, { tz, now = Date.now() }) {
  const [ag, tok, ev, conv] = await Promise.all([
    q.query("SELECT a.*, i.title AS tarea FROM agentes a LEFT JOIN items i ON i.id=a.item_id ORDER BY visto DESC"),
    q.query("SELECT id, label, created_at, last_used_at FROM api_tokens WHERE alcance='agente' ORDER BY created_at DESC"),
    q.query("SELECT e.*, i.title FROM agente_eventos e LEFT JOIN items i ON i.id=e.item_id ORDER BY e.at DESC LIMIT 30"),
    getSetting(q, "conversando_hasta", 0),
  ]);
  const c = await config(q);
  return {
    config: c, noche: esNoche(now, tz, c), conversando_hasta: Number(conv) > now ? Number(conv) : null,
    agentes: ag.rows.map((a) => ({ nombre: a.nombre, carril: a.carril, modelo: a.modelo, maquina: a.maquina, estado: a.estado, tarea: a.tarea || null, visto: +a.visto })),
    tokens: tok.rows.map((t) => ({ id: t.id, label: t.label, creado: +t.created_at, usado: t.last_used_at ? +t.last_used_at : null })),
    eventos: ev.rows.map((e) => ({ item_id: e.item_id, title: e.title, agente: e.agente, tipo: e.tipo, texto: e.texto, at: +e.at })),
  };
}

// Rutas. Las mismas sirven a la app (cookie) y a los agentes (token de alcance «agente»).
export function rutas(app, { pool, tx, need, wrap, done, changed, tz }) {
  const via = (req) => req.who?.via || "cookie";
  // Con la Infraestructura apagada, nada de esto existe (ni para la app ni para los tokens).
  const activo = wrap(async (req, res, next) => {
    if (!(await modulos(pool)).infra) return res.status(404).json({ error: "La Infraestructura está apagada. Actívala en Ajustes → Módulos." });
    next();
  });
  app.use(["/api/agente", "/api/infra"], activo);
  app.put("/api/modulos", need, wrap(async (req, res) => {
    if (via(req) !== "cookie") throw new core.HttpError(403, "Esto se cambia desde la app.");
    const m = { ...(await modulos(pool)) };
    if ("infra" in (req.body || {})) m.infra = !!req.body.infra;
    await setSetting(pool, "modulos", m);
    await done(res, { modulos: m });
  }));
  const quien = (req) => String(req.body?.agente || req.query?.agente || req.who?.label || "").slice(0, 60);
  const ok = async (res, extra) => { changed("agentes"); res.json({ ok: true, ...extra }); };
  app.get("/api/agente/contexto", need, wrap(async (req, res) => res.json(await contexto(pool, { tz }))));
  app.get("/api/agente/agenda", need, wrap(async (req, res) => {
    const dias = Math.min(14, Math.max(1, Number(req.query.dias) || 1));
    const desde = startOfDay(Date.now(), tz);
    const a = await agendaRange(pool, desde, addDays(desde, dias, tz));
    res.json([...a.blocks.map((b) => ({ ...b, tipo: "bloque" })), ...a.events.map((e) => ({ ...e, tipo: "evento" }))]
      .sort((x, y) => x.start - y.start)
      .map((x) => ({ tipo: x.tipo, id: x.id || null, title: x.title, start: x.start, end: x.end, all_day: !!x.all_day, calendario: x.calendario || null, dia: dayKey(x.start, tz), hora: x.all_day ? null : fmtHora(x.start, tz) })));
  }));
  app.get("/api/agente/tareas", need, wrap(async (req, res) => res.json(await listar(pool, { ...req.query, tz }))));
  app.post("/api/agente/tareas", need, wrap(async (req, res) => {
    const t = await tx(pool, (q) => crear(q, req.body || {}, { agente: quien(req) }));
    await ok(res, { tarea: t });
  }));
  app.patch("/api/agente/tareas/:id", need, wrap(async (req, res) => {
    const t = await tx(pool, async (q) => { await core.lockTimer(q); return actualizar(q, req.params.id, req.body || {}, { agente: quien(req), via: via(req) }); });
    await ok(res, { tarea: t });
  }));
  app.get("/api/agente/tareas/:id/historial", need, wrap(async (req, res) => {
    res.json((await pool.query("SELECT agente, tipo, texto, at FROM agente_eventos WHERE item_id=$1 ORDER BY at DESC LIMIT 50", [req.params.id])).rows.map((e) => ({ ...e, at: +e.at })));
  }));
  app.post("/api/agente/siguiente", need, wrap(async (req, res) => {
    const r = await tx(pool, (q) => siguiente(q, { carril: req.body?.carril || req.query.carril || "local", agente: quien(req), tz }));
    if (r.tarea) changed("agentes");
    res.json(r);
  }));
  app.post("/api/agente/latido", need, wrap(async (req, res) => { await latido(pool, { ...req.body, agente: quien(req) }); res.json({ ok: true }); }));
  app.post("/api/agente/conversando", need, wrap(async (req, res) => res.json({ ok: true, hasta: await conversando(pool, { minutos: req.body?.minutos }) })));
  app.post("/api/agente/bloques", need, wrap(async (req, res) => {
    const b = await tx(pool, (q) => core.addBlock(q, { itemId: req.body.item_id || null, title: req.body.title, starts_at: req.body.inicio, ends_at: req.body.fin }));
    await done(res, { bloque: { id: b.id, title: b.title, start: +b.starts_at, end: +b.ends_at } });
  }));
  app.post("/api/agente/capturar", need, wrap(async (req, res) => {
    const c = await tx(pool, (q) => core.capture(q, { text: req.body.texto || req.body.text, kind: req.body.tipo === "nota" ? "nota" : "captura", source: "aurora" }));
    await done(res, { captura: { id: c.id } });
  }));
  // Solo la app: la hoja de Infraestructura y su configuración.
  const soloApp = (req) => { if (via(req) !== "cookie") throw new core.HttpError(403, "Esto se cambia desde la app."); };
  app.get("/api/infra", need, wrap(async (req, res) => { soloApp(req); res.json(await infra(pool, { tz })); }));
  app.put("/api/infra/config", need, wrap(async (req, res) => {
    soloApp(req);
    const c = sanitizeConfig(req.body || {}, await config(pool));
    await setSetting(pool, "agentes", c);
    await ok(res, { config: c });
  }));
  app.delete("/api/infra/agentes/:nombre", need, wrap(async (req, res) => { soloApp(req); await pool.query("DELETE FROM agentes WHERE nombre=$1", [req.params.nombre]); await ok(res); }));
}

// ---------- Herramientas MCP ----------
// «disponibilidad» siempre está; las de la cola de agentes solo con la Infraestructura encendida.
const HEX = /^[0-9a-f]{6,36}$/i;
// Encuentra una tarea por id corto o parte del título (para MCP y WhatsApp).
async function buscarTareaAgente(q, ref) {
  ref = String(ref || "").trim();
  if (!ref) throw new core.HttpError(400, "Dime qué tarea (id o parte del título).");
  const r = HEX.test(ref.replace(/-/g, ""))
    ? await q.query("SELECT id FROM items WHERE asignado='agente' AND id::text LIKE $1 LIMIT 2", [ref.toLowerCase() + "%"])
    : await q.query("SELECT id FROM items WHERE asignado='agente' AND agente_estado IN ('revision','bloqueada','cola','trabajando') AND title ILIKE $1 ORDER BY updated_at DESC LIMIT 2", [`%${ref}%`]);
  if (!r.rowCount) throw new core.HttpError(404, `No encontré una tarea de agente con «${ref}».`);
  if (r.rowCount > 1) throw new core.HttpError(400, `«${ref}» coincide con más de una tarea: usa el id.`);
  return r.rows[0].id;
}
// Una línea de texto por tarea de la cola, para respuestas por chat.
const lineaCola = (t) => `[${t.id.slice(0, 6)}] ${t.title}${t.proyecto ? ` [${t.proyecto}]` : ""} — ${ESTADO_TXT[t.estado] || t.estado}${t.prioridad ? `, P${t.prioridad}` : ""}${t.carril === "cloud" ? (t.cloud_ok ? ", cloud ✓" : ", cloud sin autorizar") : ""}${t.ventana === "noche" ? ", de noche" : ""}`;
const ESTADO_TXT = { cola: "en cola", trabajando: "trabajando", revision: "espera tu OK", bloqueada: "bloqueada", aprobada: "aprobada", rechazada: "rechazada" };

export const MCP_SIEMPRE = [
  { name: "disponibilidad", description: "¿El usuario está ocupado ahora (evento o bloque en su agenda) y hasta cuándo? Úsalo antes de responder mensajes por él. También trae lo próximo y sus pendientes.", inputSchema: { type: "object", properties: {} } },
];
export const MCP_AGENTES = [
  { name: "delegar", description: "Crea una tarea para que la haga un agente (queda en la cola de Infraestructura).",
    inputSchema: { type: "object", properties: { titulo: { type: "string" }, proyecto: { type: "string" }, detalle: { type: "string", description: "Contexto y cómo se sabe que quedó bien" },
      prioridad: { type: "integer", minimum: 1, maximum: 4, description: "1 urgente … 4 cuando se pueda" }, fecha_limite: { type: "string", description: "AAAA-MM-DD" },
      noche: { type: "boolean", description: "Solo en la ventana nocturna" }, cloud: { type: "boolean", description: "Carril cloud (pago): no corre hasta que el usuario lo autorice" } }, required: ["titulo"] } },
  { name: "cola_agentes", description: "Tareas de los agentes: en cola, trabajando, bloqueadas y las que esperan el OK del usuario.",
    inputSchema: { type: "object", properties: { estado: { type: "string", enum: ["cola", "trabajando", "revision", "bloqueada"] } } } },
  { name: "aprobar_agente", description: "Aprueba el resultado de una tarea de agente (la deja hecha). Solo cuando el usuario lo pide.",
    inputSchema: { type: "object", properties: { tarea: { type: "string", description: "id (6+ caracteres) o parte del título" } }, required: ["tarea"] } },
  { name: "corregir_agente", description: "Devuelve una tarea de agente a la cola con la corrección del usuario.",
    inputSchema: { type: "object", properties: { tarea: { type: "string" }, correccion: { type: "string" } }, required: ["tarea", "correccion"] } },
  { name: "autorizar_cloud", description: "Autoriza que una tarea use el carril cloud (proveedor pago). SOLO con un sí explícito del usuario: copia su respuesta textual.",
    inputSchema: { type: "object", properties: { tarea: { type: "string" }, respuesta_textual: { type: "string", description: "Lo que respondió el usuario, tal cual" } }, required: ["tarea", "respuesta_textual"] } },
];

// Implementación de las herramientas MCP de agentes (delegar, cola, aprobar, corregir, autorizar cloud).
export function mcpRun(pool, { tz, tx }) {
  const quien = "mcp";
  return {
    async disponibilidad() { return (await contexto(pool, { tz })).texto; },
    async delegar({ titulo, proyecto, detalle, prioridad, fecha_limite, noche, cloud }) {
      const t = await tx(pool, (q) => crear(q, { title: titulo, proyecto, detalle, prioridad, due_date: fecha_limite, ventana: noche ? "noche" : "dia", carril: cloud ? "cloud" : "local", asignado: "agente" }, { agente: quien }));
      return `En la cola de agentes: ${lineaCola(t)}${cloud ? "\nOjo: el carril cloud no corre hasta que el usuario lo autorice." : ""}`;
    },
    async cola_agentes({ estado }) {
      const xs = await listar(pool, { asignado: "agente", estado: estado || "cola,trabajando,revision,bloqueada", limite: 40, tz });
      return xs.length ? xs.map((t) => lineaCola(t) + (t.estado === "revision" && t.resultado ? `\n   ${t.resultado.split("\n").slice(0, 3).join("\n   ")}` : "")).join("\n") : "No hay tareas de agentes.";
    },
    async aprobar_agente({ tarea }) {
      const t = await tx(pool, async (q) => actualizar(q, await buscarTareaAgente(q, tarea), { estado: "aprobada" }, { agente: quien }));
      return `Aprobada: ${t.title}`;
    },
    async corregir_agente({ tarea, correccion }) {
      const t = await tx(pool, async (q) => {
        const id = await buscarTareaAgente(q, tarea);
        const prev = (await q.query("SELECT detalle FROM items WHERE id=$1", [id])).rows[0];
        return actualizar(q, id, { estado: "cola", nota: correccion, detalle: [prev.detalle, `Corrección: ${correccion}`].filter(Boolean).join("\n") }, { agente: quien });
      });
      return `De vuelta a la cola con tu corrección: ${t.title}`;
    },
    async autorizar_cloud({ tarea, respuesta_textual }) {
      const t = await tx(pool, async (q) => actualizar(q, await buscarTareaAgente(q, tarea), { cloud_ok: true, confirmado_por: respuesta_textual }, { agente: quien, via: "token" }));
      return `Cloud autorizado: ${t.title}`;
    },
  };
}
