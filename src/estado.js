// Lo que ven la app, los atajos y el vigilante: siempre leído del servidor, nunca de una copia.
import { startOfDay, addDays } from "./time.js";
import { sugerencias } from "./plan.js";
import { getPrediccion, habitosConModo, paraSugerir, rutinasPermitidas } from "./prediccion.js";
import { getSetting } from "./db.js";

// Fecha a milisegundos (null si no hay).
const ms = (d) => (d ? new Date(d).getTime() : null);

// Sesiones de los últimos días con su duración, para detectar hábitos.
export async function sessionsForHabits(q, now, dias = 35) {
  const r = await q.query(
    `SELECT s.item_id, s.title, s.started_at,
            COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (g.ended_at-g.started_at))) FROM segments g WHERE g.session_id=s.id),0)*1000 AS dur_ms
     FROM sessions s WHERE s.state='done' AND s.started_at > $1`,
    [new Date(now - (dias + 1) * 86_400_000)],
  );
  return r.rows.map((x) => ({ item_id: x.item_id, title: x.title, started_at: ms(x.started_at), dur_ms: Number(x.dur_ms) }));
}

// Sesión en curso con sus tramos.
export async function currentSession(q) {
  const s = (await q.query("SELECT * FROM sessions WHERE state IN ('running','paused')")).rows[0];
  if (!s) return null;
  const segs = (await q.query("SELECT started_at, ended_at FROM segments WHERE session_id=$1 ORDER BY started_at", [s.id])).rows;
  return {
    id: s.id, item_id: s.item_id, title: s.title, state: s.state, started_at: ms(s.started_at), source: s.source,
    segments: segs.map((g) => [ms(g.started_at), ms(g.ended_at)]),
  };
}

// Bloques y eventos de calendario dentro de un rango.
export async function agendaRange(q, from, to) {
  const [blocks, events] = await Promise.all([
    q.query("SELECT b.*, c.name AS calendario FROM blocks b LEFT JOIN calendars c ON c.id=b.calendar_id WHERE b.borrado IS NULL AND b.starts_at < $2 AND b.ends_at > $1 ORDER BY b.starts_at", [new Date(from), new Date(to)]),
    q.query(
      `SELECT e.*, c.name AS calendario, c.color, c.editable, c.cuenta_id FROM calendar_events e JOIN calendars c ON c.id=e.calendar_id
       WHERE c.rol <> 'oculto' AND e.starts_at < $2 AND e.ends_at > $1 ORDER BY e.starts_at`, [new Date(from), new Date(to)]),
  ]);
  return {
    blocks: blocks.rows.map((b) => ({ id: b.id, item_id: b.item_id, title: b.title, start: ms(b.starts_at), end: ms(b.ends_at), origin: b.origin, calendario: b.calendario || null, sincronizado: !!b.etag })),
    events: events.rows.map((e) => ({
      uid: e.uid, calendar_id: e.calendar_id, title: e.title, start: ms(e.starts_at), end: ms(e.ends_at), all_day: e.all_day, calendario: e.calendario, color: e.color,
      editable: !!(e.cuenta_id && e.editable && e.href && !e.recurrente), recurrente: e.recurrente, pendiente: !!e.local_editado,
    })),
  };
}

// Estado completo que pinta la app: ahora, agenda, tareas, sugerencias, proyectos y conexiones.
export async function buildState(q, { tz, now = Date.now() }) {
  const day = startOfDay(now, tz), tomorrow = addDays(day, 1, tz);
  const pred = await getPrediccion(q);
  const [items, current, agenda, done, captures, outbox, cals, cuentas, avisos, hab, conflictos, proyectos, pilares, demo, aw] = await Promise.all([
    q.query("SELECT * FROM items WHERE status <> 'archivada' AND NOT (status='hecha' AND updated_at < now() - interval '30 days') ORDER BY kind, (status='hecha'), (status='en curso') DESC, due_date NULLS LAST, created_at DESC LIMIT 500"),
    currentSession(q),
    agendaRange(q, day, tomorrow),
    q.query(
      `SELECT s.id, s.item_id, s.title, s.source, g.started_at, g.ended_at
       FROM sessions s JOIN segments g ON g.session_id=s.id
       WHERE g.started_at < $2 AND COALESCE(g.ended_at, now()) > $1 ORDER BY g.started_at`, [new Date(day), new Date(tomorrow)]),
    q.query("SELECT * FROM captures WHERE status='abierta' OR kind='nota' ORDER BY created_at DESC LIMIT 200"),
    q.query("SELECT status, count(*)::int AS n, max(last_error) FILTER (WHERE status='error') AS err FROM outbox WHERE status <> 'ok' GROUP BY status"),
    q.query("SELECT id, name, last_ok_at, last_error, cuenta_id, rol, color, editable FROM calendars ORDER BY created_at"),
    q.query("SELECT id, tipo, nombre, activa, ultimo_ok, ultimo_error, error_desde FROM cuentas ORDER BY creada"),
    getSetting(q, "avisos"),
    habitosConModo(q, now, tz, pred),
    q.query("SELECT count(*)::int n FROM conflictos WHERE NOT revisado"),
    q.query("SELECT id, nombre, color, pilar_id, estado FROM proyectos WHERE estado IN ('activo','pausado') ORDER BY nombre"),
    q.query("SELECT id, nombre, color FROM pilares WHERE estado='activo' ORDER BY orden, nombre"),
    q.query("SELECT EXISTS(SELECT 1 FROM items WHERE demo) OR EXISTS(SELECT 1 FROM sessions WHERE demo) AS hay"),
    getSetting(q, "activitywatch"),
  ]);
  const rutinas = items.rows.filter((i) => i.kind === "rutina" && i.status !== "archivada");
  const medido = done.rows.reduce((a, g) => a + Math.max(0, Math.min(ms(g.ended_at) || now, tomorrow) - Math.max(ms(g.started_at), day)), 0);
  const ob = Object.fromEntries(outbox.rows.map((r) => [r.status, r]));
  return {
    now, tz, day,
    current,
    proyectos: proyectos.rows, pilares: pilares.rows, demo: !!demo.rows[0].hay,
    modulos: { infra: false, ...((await getSetting(q, "modulos", {})) || {}) },
    activitywatch: aw?.url ? { url: aw.url, activo: aw.activo !== false, ultimo_ok: aw.ultimo_ok || null, error: aw.error || "" } : null,
    items: items.rows.map((i) => ({
      id: i.id, kind: i.kind, title: i.title, status: i.status, est_min: i.est_min,
      due_date: i.due_date ? new Date(i.due_date).toISOString().slice(0, 10) : null,
      hora: i.hora ? String(i.hora).slice(0, 5) : null, dias: i.dias,
      fuente: i.fuente, nota: i.nota_titulo || null, nota_ref: i.nota_ref || null,
      proyecto_id: i.proyecto_id || null, eisenhower: i.eisenhower || null, demo: !!i.demo,
      prioridad: i.prioridad || null, asignado: i.asignado || "yo", carril: i.carril || "local", ventana: i.ventana || "dia",
      agente_estado: i.agente_estado || null, agente: i.agente_por || null, cloud_ok: !!i.cloud_ok,
      flujo: i.nota_ref === "flujo", etapa: i.etapa || null, tipo_nota: i.tipo_nota || null, agendable: !!i.agendable, bloque_id: i.bloque_id || null,
    })),
    agenda,
    hoy: {
      medido_ms: medido,
      tramos: done.rows.map((g) => ({ session_id: g.id, item_id: g.item_id, title: g.title, start: ms(g.started_at), end: ms(g.ended_at), source: g.source })),
    },
    captures: captures.rows.map((c) => ({ id: c.id, kind: c.kind, text: c.text, body: c.body, source: c.source, status: c.status, at: ms(c.created_at) })),
    sugerencias: sugerencias(paraSugerir(hab), rutinasPermitidas(rutinas.map((r) => ({ ...r, hora: r.hora ? String(r.hora).slice(0, 5) : null })), pred, "sugerir"), now, tz, 3, pred.radio),
    habitos: hab,
    conexiones: {
      cuentas: cuentas.rows.map((c) => ({ id: c.id, tipo: c.tipo, nombre: c.nombre, activa: c.activa, ok: !!c.ultimo_ok && !c.ultimo_error, ultimo_ok: ms(c.ultimo_ok), error: c.ultimo_error, error_desde: ms(c.error_desde) })),
      calendarios: cals.rows.map((c) => ({ id: c.id, name: c.name, cuenta_id: c.cuenta_id, rol: c.rol, color: c.color, editable: c.editable, ok: !!c.last_ok_at && !c.last_error, last_ok_at: ms(c.last_ok_at), error: c.last_error })),
      cola: { pendientes: (ob.pendiente?.n || 0) + (ob.error?.n || 0), error: ob.error?.err || "" },
      conflictos: conflictos.rows[0].n,
      avisos: {
        ntfy: !!avisos?.canales?.ntfy?.topic, telegram: !!avisos?.canales?.telegram?.chat, webhook: !!avisos?.canales?.webhook?.url,
        activo: avisos?.activo !== false,
      },
    },
  };
}
