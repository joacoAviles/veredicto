// Lo que ven la app, los atajos y el vigilante: siempre leído del servidor, nunca de una copia.
import { startOfDay, addDays } from "./time.js";
import { habits, sugerencias } from "./plan.js";
import { getSetting } from "./db.js";

const ms = (d) => (d ? new Date(d).getTime() : null);

export async function sessionsForHabits(q, now) {
  const r = await q.query(
    `SELECT s.item_id, s.title, s.started_at,
            COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (g.ended_at-g.started_at))) FROM segments g WHERE g.session_id=s.id),0)*1000 AS dur_ms
     FROM sessions s WHERE s.state='done' AND s.started_at > $1`,
    [new Date(now - 35 * 86_400_000)],
  );
  return r.rows.map((x) => ({ item_id: x.item_id, title: x.title, started_at: ms(x.started_at), dur_ms: Number(x.dur_ms) }));
}

export async function currentSession(q) {
  const s = (await q.query("SELECT * FROM sessions WHERE state IN ('running','paused')")).rows[0];
  if (!s) return null;
  const segs = (await q.query("SELECT started_at, ended_at FROM segments WHERE session_id=$1 ORDER BY started_at", [s.id])).rows;
  return {
    id: s.id, item_id: s.item_id, title: s.title, state: s.state, started_at: ms(s.started_at), source: s.source,
    segments: segs.map((g) => [ms(g.started_at), ms(g.ended_at)]),
  };
}

export async function agendaRange(q, from, to) {
  const [blocks, events] = await Promise.all([
    q.query("SELECT * FROM blocks WHERE starts_at < $2 AND ends_at > $1 ORDER BY starts_at", [new Date(from), new Date(to)]),
    q.query(
      `SELECT e.*, c.name AS calendario FROM calendar_events e JOIN calendars c ON c.id=e.calendar_id
       WHERE e.starts_at < $2 AND e.ends_at > $1 ORDER BY e.starts_at`, [new Date(from), new Date(to)]),
  ]);
  return {
    blocks: blocks.rows.map((b) => ({ id: b.id, item_id: b.item_id, title: b.title, start: ms(b.starts_at), end: ms(b.ends_at), origin: b.origin })),
    events: events.rows.map((e) => ({ uid: e.uid, title: e.title, start: ms(e.starts_at), end: ms(e.ends_at), all_day: e.all_day, calendario: e.calendario })),
  };
}

export async function buildState(q, { tz, now = Date.now() }) {
  const day = startOfDay(now, tz), tomorrow = addDays(day, 1, tz);
  const [items, current, agenda, done, captures, outbox, cals, notion, avisos, hist] = await Promise.all([
    q.query("SELECT * FROM items WHERE status <> 'archivada' ORDER BY kind, (status='hecha'), (status='en curso') DESC, due_date NULLS LAST, created_at DESC LIMIT 500"),
    currentSession(q),
    agendaRange(q, day, tomorrow),
    q.query(
      `SELECT s.id, s.item_id, s.title, s.source, g.started_at, g.ended_at
       FROM sessions s JOIN segments g ON g.session_id=s.id
       WHERE g.started_at < $2 AND COALESCE(g.ended_at, now()) > $1 ORDER BY g.started_at`, [new Date(day), new Date(tomorrow)]),
    q.query("SELECT * FROM captures WHERE status='abierta' OR kind='nota' ORDER BY created_at DESC LIMIT 200"),
    q.query("SELECT status, count(*)::int AS n, max(last_error) FILTER (WHERE status='error') AS err FROM outbox WHERE status <> 'ok' OR done_at > now() - interval '1 day' GROUP BY status"),
    q.query("SELECT id, name, last_ok_at, last_error FROM calendars ORDER BY created_at"),
    getSetting(q, "notion"),
    getSetting(q, "avisos"),
    sessionsForHabits(q, now),
  ]);
  const rutinas = items.rows.filter((i) => i.kind === "rutina" && i.status !== "archivada");
  const hab = habits(hist, now, tz);
  const medido = done.rows.reduce((a, g) => a + Math.max(0, Math.min(ms(g.ended_at) || now, tomorrow) - Math.max(ms(g.started_at), day)), 0);
  const ob = Object.fromEntries(outbox.rows.map((r) => [r.status, r]));
  return {
    now, tz, day,
    current,
    items: items.rows.map((i) => ({
      id: i.id, kind: i.kind, title: i.title, status: i.status, est_min: i.est_min,
      due_date: i.due_date ? new Date(i.due_date).toISOString().slice(0, 10) : null,
      hora: i.hora ? String(i.hora).slice(0, 5) : null, dias: i.dias, en_notion: !!i.notion_id,
    })),
    agenda,
    hoy: {
      medido_ms: medido,
      tramos: done.rows.map((g) => ({ session_id: g.id, item_id: g.item_id, title: g.title, start: ms(g.started_at), end: ms(g.ended_at), source: g.source })),
    },
    captures: captures.rows.map((c) => ({ id: c.id, kind: c.kind, text: c.text, body: c.body, source: c.source, status: c.status, at: ms(c.created_at), en_notion: !!c.notion_id })),
    sugerencias: sugerencias(hab, rutinas, now, tz),
    habitos: hab,
    conexiones: {
      notion: notion?.token ? { ok: true, pendientes: (ob.pendiente?.n || 0) + (ob.error?.n || 0), error: ob.error?.err || "" } : { ok: false },
      calendarios: cals.rows.map((c) => ({ id: c.id, name: c.name, ok: !!c.last_ok_at && !c.last_error, last_ok_at: ms(c.last_ok_at), error: c.last_error })),
      avisos: {
        ntfy: !!avisos?.canales?.ntfy?.topic, telegram: !!avisos?.canales?.telegram?.chat, webhook: !!avisos?.canales?.webhook?.url,
        activo: avisos?.activo !== false,
      },
    },
  };
}
