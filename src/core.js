// Operaciones del dominio. Todas reciben un cliente dentro de una transacción.
import { log } from "./db.js";
import { normalize } from "./time.js";

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Cola de cambios hacia tus cuentas (calendarios y notas). Un pendiente por objeto.
export const enqueue = (q, kind, ref, datos = {}) =>
  q.query(
    `INSERT INTO outbox(kind, ref, datos) SELECT $1::text,$2::uuid,$3::jsonb
     WHERE NOT EXISTS (SELECT 1 FROM outbox WHERE kind=$1 AND status<>'ok' AND (ref=$2 OR ($2::uuid IS NULL AND datos=$3::jsonb)))`,
    [kind, ref, JSON.stringify(datos)],
  ).then(() => q.query("UPDATE outbox SET next_at=now(), status='pendiente' WHERE kind=$1 AND status='error' AND (ref=$2 OR ($2::uuid IS NULL AND datos=$3::jsonb))", [kind, ref, JSON.stringify(datos)]));

// Si un ítem viene de la base «Flujo» de Notion, su fila se actualiza (estado, hora agendada, minutos).
export const enqueueFlujo = (q, { itemId = null, bloqueId = null }) =>
  q.query("SELECT id FROM items WHERE nota_ref='flujo' AND (id=$1 OR bloque_id=$2)", [itemId, bloqueId])
    .then(async (r) => { for (const it of r.rows) await enqueue(q, "gestion", it.id); });

// Serializa todo lo que toca la actividad abierta.
export const lockTimer = (q) => q.query("SELECT pg_advisory_xact_lock(4317001)");

export async function openSession(q) {
  const r = await q.query("SELECT * FROM sessions WHERE state IN ('running','paused') FOR UPDATE");
  return r.rows[0] || null;
}

async function measuredMs(q, sessionId) {
  const r = await q.query(
    "SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at))),0)::float AS s FROM segments WHERE session_id=$1",
    [sessionId],
  );
  return r.rows[0].s * 1000;
}

export async function stop(q, { now = new Date() } = {}) {
  const s = await openSession(q);
  if (!s) return null;
  await q.query("UPDATE segments SET ended_at=$2 WHERE session_id=$1 AND ended_at IS NULL", [s.id, now]);
  const ms = await measuredMs(q, s.id);
  if (ms < 30_000) {
    // Un toque por error no ensucia el registro.
    await q.query("DELETE FROM sessions WHERE id=$1", [s.id]);
    await log(q, "timer.descartado", s.title);
    return { ...s, discarded: true, ms };
  }
  const end = await q.query("SELECT MAX(ended_at) AS e FROM segments WHERE session_id=$1", [s.id]);
  await q.query("UPDATE sessions SET state='done', ended_at=$2 WHERE id=$1", [s.id, end.rows[0].e]);
  await enqueue(q, "sesion_cal", s.id);
  if (s.item_id) await enqueueFlujo(q, { itemId: s.item_id });
  await log(q, "timer.parado", s.title);
  return { ...s, state: "done", ms };
}

export async function pause(q, { now = new Date() } = {}) {
  const s = await openSession(q);
  if (!s || s.state !== "running") throw new HttpError(409, "No hay nada corriendo.");
  await q.query("UPDATE segments SET ended_at=$2 WHERE session_id=$1 AND ended_at IS NULL", [s.id, now]);
  await q.query("UPDATE sessions SET state='paused' WHERE id=$1", [s.id]);
  await log(q, "timer.pausa", s.title);
  return s;
}

export async function resume(q, { now = new Date() } = {}) {
  const s = await openSession(q);
  if (!s || s.state !== "paused") throw new HttpError(409, "No hay nada en pausa.");
  await q.query("INSERT INTO segments(session_id, started_at) VALUES ($1,$2)", [s.id, now]);
  await q.query("UPDATE sessions SET state='running' WHERE id=$1", [s.id]);
  await log(q, "timer.reanudado", s.title);
  return s;
}

// Busca una tarea o rutina por nombre; prefiere rutinas y coincidencias exactas.
export async function findItem(q, title) {
  const n = normalize(title);
  if (!n) return null;
  const r = await q.query("SELECT * FROM items WHERE status NOT IN ('hecha','archivada')");
  const score = (it) => {
    const t = normalize(it.title);
    const base = t === n ? 3 : t.startsWith(n) ? 2 : t.includes(n) ? 1 : 0;
    return base ? base * 2 + (it.kind === "rutina" ? 1 : 0) : 0;
  };
  return r.rows.map((it) => [score(it), it]).filter(([s]) => s).sort((a, b) => b[0] - a[0])[0]?.[1] || null;
}

export async function createItem(q, { kind = "tarea", title, est_min = 30, due_date = null, hora = null, dias = null }) {
  title = String(title || "").trim().slice(0, 300);
  if (!title) throw new HttpError(400, "Falta el nombre.");
  if (!["tarea", "rutina"].includes(kind)) throw new HttpError(400, "Tipo no válido.");
  const r = await q.query(
    "INSERT INTO items(kind,title,est_min,due_date,hora,dias) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [kind, title, clampMin(est_min), due_date || null, hora || null, dias?.length ? dias : null],
  );
  await log(q, kind + ".creada", title);
  return r.rows[0];
}
const clampMin = (v) => Math.max(1, Math.min(1440, Math.round(Number(v) || 30)));

export async function updateItem(q, id, patch) {
  const allowed = { title: 1, status: 1, est_min: 1, due_date: 1, hora: 1, dias: 1, agendable: 1 };
  const sets = [], vals = [id];
  for (const [k, v] of Object.entries(patch || {})) {
    if (!allowed[k]) continue;
    let val = v;
    if (k === "title") { val = String(v || "").trim().slice(0, 300); if (!val) throw new HttpError(400, "Falta el nombre."); }
    if (k === "status" && !["pendiente", "en curso", "hecha", "archivada"].includes(v)) throw new HttpError(400, "Estado no válido.");
    if (k === "est_min") val = clampMin(v);
    if (k === "dias") val = Array.isArray(v) && v.length ? v.map(Number).filter((d) => d >= 0 && d <= 6) : null;
    if ((k === "hora" || k === "due_date") && !v) val = null;
    if (k === "agendable") val = !!v;
    vals.push(val);
    sets.push(`${k}=$${vals.length}`);
  }
  if (!sets.length) throw new HttpError(400, "Nada que cambiar.");
  const r = await q.query(`UPDATE items SET ${sets.join(",")}, updated_at=now() WHERE id=$1 RETURNING *`, vals);
  if (!r.rowCount) throw new HttpError(404, "No encontré esa tarea.");
  const it = r.rows[0];
  if (patch.status === "hecha") {
    const s = await openSession(q);
    if (s && s.item_id === id) await stop(q);
  }
  if (patch?.agendable && it.nota_ref === "flujo" && !it.bloque_id) {
    await q.query("UPDATE items SET etapa='Por hacer' WHERE id=$1", [id]);
    await enqueue(q, "gestion", id);
  }
  if (it.fuente !== "app" && "status" in (patch || {})) await enqueue(q, "gestion", id);
  return it;
}

// Inicia algo. Cierra lo que esté abierto. Si no existe con ese nombre, crea la tarea.
export async function start(q, { itemId = null, title = null, source = "app", now = new Date() }) {
  let item = null;
  if (itemId) {
    item = (await q.query("SELECT * FROM items WHERE id=$1", [itemId])).rows[0];
    if (!item) throw new HttpError(404, "No encontré esa tarea.");
  } else if (title) {
    item = (await findItem(q, title)) || (await createItem(q, { kind: "tarea", title }));
  } else throw new HttpError(400, "Dime qué iniciar.");
  if (["hecha", "archivada"].includes(item.status)) await updateItem(q, item.id, { status: "pendiente" });

  const open = await openSession(q);
  if (open && open.item_id === item.id) {
    if (open.state === "paused") await resume(q, { now });
    return { session: open, item, already: open.state === "running" };
  }
  if (open) await stop(q, { now });
  const s = (await q.query(
    "INSERT INTO sessions(item_id,title,state,started_at,source) VALUES ($1,$2,'running',$3,$4) RETURNING *",
    [item.id, item.title, now, source],
  )).rows[0];
  await q.query("INSERT INTO segments(session_id, started_at) VALUES ($1,$2)", [s.id, now]);
  if (item.kind === "tarea" && item.status === "pendiente") await updateItem(q, item.id, { status: "en curso" });
  await log(q, "timer.iniciado", `${item.title} · ${source}`);
  return { session: s, item };
}

export async function capture(q, { text, kind = "captura", body = "", source = "app" }) {
  text = String(text || "").trim();
  if (!text) throw new HttpError(400, "Escribe algo para guardar.");
  // Las notas largas: la primera línea es el título, el resto va al cuerpo.
  const [first, ...rest] = text.split("\n");
  const title = first.slice(0, 300);
  const fullBody = [rest.join("\n"), body].filter(Boolean).join("\n").trim().slice(0, 20000);
  if (!["captura", "nota"].includes(kind)) throw new HttpError(400, "Tipo no válido.");
  const r = await q.query(
    "INSERT INTO captures(kind,text,body,source) VALUES ($1,$2,$3,$4) RETURNING *",
    [kind, title, fullBody, String(source).slice(0, 40)],
  );
  await enqueue(q, "bandeja", r.rows[0].id);
  await log(q, kind + ".guardada", source);
  return r.rows[0];
}

export async function addBlock(q, { itemId = null, title = null, starts_at, ends_at, origin = "manual" }) {
  let t = title;
  if (itemId) {
    const it = (await q.query("SELECT title FROM items WHERE id=$1", [itemId])).rows[0];
    if (!it) throw new HttpError(404, "No encontré esa tarea.");
    t = t || it.title;
  }
  t = String(t || "").trim().slice(0, 300);
  if (!t) throw new HttpError(400, "Falta qué vas a hacer.");
  const a = new Date(starts_at), b = new Date(ends_at);
  if (!(a < b)) throw new HttpError(400, "El bloque debe terminar después de empezar.");
  const r = await q.query(
    "INSERT INTO blocks(item_id,title,starts_at,ends_at,origin) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [itemId, t, a, b, origin],
  );
  await enqueue(q, "bloque", r.rows[0].id);
  return r.rows[0];
}

// Mueve, renombra o borra un bloque; el cambio viaja a tu calendario «Plan».
export async function updateBlock(q, id, { title, starts_at, ends_at, borrar = false }) {
  const b = (await q.query("SELECT * FROM blocks WHERE id=$1 AND borrado IS NULL", [id])).rows[0];
  if (!b) throw new HttpError(404, "Ese bloque ya no existe.");
  if (borrar) {
    await q.query("UPDATE blocks SET borrado=now(), actualizado=now() WHERE id=$1", [id]);
  } else {
    const t = title != null ? String(title).trim().slice(0, 300) : b.title;
    const a = starts_at != null ? new Date(starts_at) : b.starts_at, z = ends_at != null ? new Date(ends_at) : b.ends_at;
    if (!t) throw new HttpError(400, "Falta el nombre.");
    if (!(a < z)) throw new HttpError(400, "El bloque debe terminar después de empezar.");
    await q.query("UPDATE blocks SET title=$2, starts_at=$3, ends_at=$4, actualizado=now() WHERE id=$1", [id, t, a, z]);
  }
  await enqueue(q, "bloque", id);
  await enqueueFlujo(q, { bloqueId: id });
}

// Mueve o renombra un evento de otro calendario (solo los que no se repiten).
export async function updateEvento(q, calendarId, uid, { title, starts_at, ends_at }) {
  const e = (await q.query(
    "SELECT e.*, c.editable, c.cuenta_id FROM calendar_events e JOIN calendars c ON c.id=e.calendar_id WHERE e.calendar_id=$1 AND e.uid=$2", [calendarId, uid])).rows[0];
  if (!e) throw new HttpError(404, "Ese evento ya no existe.");
  if (!e.cuenta_id || !e.editable || !e.href) throw new HttpError(400, "Ese calendario es de solo lectura.");
  if (e.recurrente) throw new HttpError(400, "Es un evento que se repite: muévelo en su calendario.");
  const t = title != null ? String(title).trim().slice(0, 300) : e.title;
  const a = starts_at != null ? new Date(starts_at) : e.starts_at, z = ends_at != null ? new Date(ends_at) : e.ends_at;
  if (!(a < z)) throw new HttpError(400, "Debe terminar después de empezar.");
  await q.query("UPDATE calendar_events SET title=$3, starts_at=$4, ends_at=$5, local_editado=now() WHERE calendar_id=$1 AND uid=$2", [calendarId, uid, t, a, z]);
  await enqueue(q, "evento", null, { calendar_id: calendarId, uid });
}
