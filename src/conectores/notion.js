// Copia hacia Notion, en una sola dirección. El servidor manda; Notion muestra.
// Así no hay conflictos: si algo falla, se reintenta, y lo que ves en la app nunca depende de Notion.
import { Client } from "@notionhq/client";
import { getSetting, setSetting } from "../db.js";

export const makeClient = (token) => new Client({ auth: token, timeoutMs: 20_000 });

const t = (s) => [{ type: "text", text: { content: String(s ?? "").slice(0, 1900) } }];
const paragraphs = (body) =>
  String(body || "").split(/\n{2,}/).filter(Boolean).slice(0, 90)
    .map((p) => ({ object: "block", type: "paragraph", paragraph: { rich_text: t(p) } }));

export function pageIdFrom(input) {
  const m = String(input || "").match(/([0-9a-f]{32})|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? (m[1] || m[2]).replace(/-/g, "") : null;
}

// Asistente: valida el token y crea las bases dentro de la página que elijas.
export async function setupNotion(pool, { token, pagina }, { client = null } = {}) {
  const pageId = pageIdFrom(pagina);
  if (!token) throw Object.assign(new Error("Falta el token de la integración de Notion."), { status: 400 });
  if (!pageId) throw Object.assign(new Error("No reconozco esa página. Pega el enlace completo de la página de Notion."), { status: 400 });
  const n = client || makeClient(token);
  try {
    await n.pages.retrieve({ page_id: pageId });
  } catch (e) {
    const msg = e.status === 401 ? "Notion rechazó el token." : e.status === 404 ? "La integración no ve esa página. En Notion: ••• → Conexiones → agrega tu integración." : e.message;
    throw Object.assign(new Error(msg), { status: 400 });
  }
  const parent = { type: "page_id", page_id: pageId };
  const db = async (title, properties) => (await n.databases.create({ parent, title: t(title), properties })).id;
  const ids = {
    tareas: await db("Tareas", {
      Nombre: { title: {} },
      Tipo: { select: { options: [{ name: "Tarea", color: "default" }, { name: "Rutina", color: "blue" }] } },
      Estado: { select: { options: [{ name: "Pendiente", color: "gray" }, { name: "En curso", color: "yellow" }, { name: "Hecha", color: "green" }, { name: "Archivada", color: "brown" }] } },
      "Minutos estimados": { number: {} },
      "Fecha límite": { date: {} },
      ID: { rich_text: {} },
    }),
    sesiones: await db("Tiempo registrado", {
      Nombre: { title: {} },
      Intervalo: { date: {} },
      Minutos: { number: { format: "number" } },
      Fuente: { select: {} },
      ID: { rich_text: {} },
    }),
    capturas: await db("Capturas y notas", {
      Nombre: { title: {} },
      Tipo: { select: { options: [{ name: "Captura", color: "yellow" }, { name: "Nota", color: "purple" }] } },
      Estado: { select: { options: [{ name: "Abierta", color: "orange" }, { name: "Procesada", color: "green" }] } },
      Fuente: { select: {} },
      Fecha: { date: {} },
      ID: { rich_text: {} },
    }),
  };
  await setSetting(pool, "notion", { token, pagina: pageId, ...ids, desde: new Date().toISOString() });
  // Copia lo que ya existe.
  await pool.query("INSERT INTO outbox(kind,ref) SELECT 'item', id FROM items WHERE status <> 'archivada' AND notion_id IS NULL");
  await pool.query("INSERT INTO outbox(kind,ref) SELECT 'session', id FROM sessions WHERE state='done' AND notion_id IS NULL AND started_at > now() - interval '60 days'");
  await pool.query("INSERT INTO outbox(kind,ref) SELECT 'capture', id FROM captures WHERE notion_id IS NULL");
  return ids;
}

const ESTADO = { pendiente: "Pendiente", "en curso": "En curso", hecha: "Hecha", archivada: "Archivada" };

async function pushOne(q, n, cfg, job) {
  if (job.kind === "item") {
    const it = (await q.query("SELECT * FROM items WHERE id=$1", [job.ref])).rows[0];
    if (!it) return;
    const props = {
      Nombre: { title: t(it.title) },
      Tipo: { select: { name: it.kind === "rutina" ? "Rutina" : "Tarea" } },
      Estado: { select: { name: ESTADO[it.status] } },
      "Minutos estimados": { number: it.est_min },
      "Fecha límite": { date: it.due_date ? { start: new Date(it.due_date).toISOString().slice(0, 10) } : null },
      ID: { rich_text: t(it.id) },
    };
    if (it.notion_id) await n.pages.update({ page_id: it.notion_id, properties: props, archived: it.status === "archivada" });
    else {
      const p = await n.pages.create({ parent: { database_id: cfg.tareas }, properties: props });
      await q.query("UPDATE items SET notion_id=$2 WHERE id=$1", [it.id, p.id]);
    }
  } else if (job.kind === "session") {
    const s = (await q.query(
      `SELECT s.*, COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (g.ended_at-g.started_at))) FROM segments g WHERE g.session_id=s.id),0)::float AS secs
       FROM sessions s WHERE id=$1 AND state='done'`, [job.ref])).rows[0];
    if (!s) return;
    const props = {
      Nombre: { title: t(s.title) },
      Intervalo: { date: { start: s.started_at.toISOString(), end: s.ended_at.toISOString() } },
      Minutos: { number: Math.round(s.secs / 6) / 10 },
      Fuente: { select: { name: s.source.slice(0, 40) || "app" } },
      ID: { rich_text: t(s.id) },
    };
    if (s.notion_id) await n.pages.update({ page_id: s.notion_id, properties: props });
    else {
      const p = await n.pages.create({ parent: { database_id: cfg.sesiones }, properties: props });
      await q.query("UPDATE sessions SET notion_id=$2 WHERE id=$1", [s.id, p.id]);
    }
  } else if (job.kind === "capture") {
    const c = (await q.query("SELECT * FROM captures WHERE id=$1", [job.ref])).rows[0];
    if (!c) return;
    const props = {
      Nombre: { title: t(c.text) },
      Tipo: { select: { name: c.kind === "nota" ? "Nota" : "Captura" } },
      Estado: { select: { name: c.status === "procesada" ? "Procesada" : "Abierta" } },
      Fuente: { select: { name: c.source.slice(0, 40) || "app" } },
      Fecha: { date: { start: c.created_at.toISOString() } },
      ID: { rich_text: t(c.id) },
    };
    if (c.notion_id) await n.pages.update({ page_id: c.notion_id, properties: props });
    else {
      const p = await n.pages.create({ parent: { database_id: cfg.capturas }, properties: props, children: paragraphs(c.body) });
      await q.query("UPDATE captures SET notion_id=$2 WHERE id=$1", [c.id, p.id]);
    }
  }
}

const backoff = (n) => Math.min(30_000 * 2 ** (n - 1), 3_600_000);
export function describe(e) {
  if (e?.status === 429) return "Notion pidió esperar (429). Se reintenta solo.";
  if (e?.status === 401) return "Notion rechazó el token. Vuelve a conectarlo en Ajustes.";
  if (e?.status === 404) return "Notion no encuentra la base. ¿La borraste o quitaste la conexión?";
  if (e?.code === "notionhq_client_request_timeout") return "Notion tardó demasiado. Se reintenta solo.";
  return String(e?.message || e).slice(0, 300);
}

// Procesa la cola. Una llamada cada ~400 ms para respetar el límite de Notion.
export async function pushPending(pool, { client = null, limit = 40, pauseMs = 400 } = {}) {
  const cfg = await getSetting(pool, "notion");
  if (!cfg?.token) return { enviados: 0, errores: 0, configurado: false };
  const n = client || makeClient(cfg.token);
  const jobs = (await pool.query(
    "SELECT * FROM outbox WHERE status <> 'ok' AND next_at <= now() ORDER BY id LIMIT $1", [limit])).rows;
  let enviados = 0, errores = 0;
  for (const j of jobs) {
    try {
      await pushOne(pool, n, cfg, j);
      await pool.query("UPDATE outbox SET status='ok', attempts=attempts+1, last_error='', done_at=now() WHERE id=$1", [j.id]);
      enviados++;
    } catch (e) {
      errores++;
      const a = j.attempts + 1;
      await pool.query("UPDATE outbox SET status='error', attempts=$2, last_error=$3, next_at=now() + ($4 || ' milliseconds')::interval WHERE id=$1",
        [j.id, a, describe(e), String(backoff(a))]);
      if (e?.status === 401) break;
    }
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return { enviados, errores, configurado: true };
}
