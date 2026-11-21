// Carpeta sincronizada: tus tareas pendientes en un archivo Markdown de cualquier computador.
// El cliente (integraciones/carpeta) manda lo que marcaste, renombraste o agregaste en el archivo
// y recibe la lista al día para reescribirlo. Veredicto sigue siendo la única verdad.
import * as core from "./core.js";
import { log } from "./db.js";
import * as proyectos from "./proyectos.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const ids = (xs) => (Array.isArray(xs) ? xs : []).map(String).filter((x) => UUID.test(x)).slice(0, 500);

export async function pendientes(q) {
  const r = await q.query(
    `SELECT i.id, i.title, p.nombre AS proyecto, i.eisenhower, i.due_date, i.status, i.fuente, i.nota_titulo
     FROM items i LEFT JOIN proyectos p ON p.id=i.proyecto_id
     WHERE i.kind='tarea' AND i.status NOT IN ('hecha','archivada') AND i.asignado='yo' AND NOT i.demo
     ORDER BY coalesce(p.nombre, i.nota_titulo, 'zzz'), (i.due_date IS NULL), i.due_date,
       array_position(ARRAY['Hacer ya','Agendar','Delegar','Eliminar'], i.eisenhower) NULLS LAST, i.created_at LIMIT 1000`);
  return r.rows.map((i) => ({
    id: i.id, title: i.title, grupo: i.proyecto || i.nota_titulo || null, proyecto: i.proyecto || null,
    eisenhower: i.eisenhower || null, due_date: i.due_date ? new Date(i.due_date).toISOString().slice(0, 10) : null,
    en_curso: i.status === "en curso", origen: i.fuente,
  }));
}

export async function sincronizar(q, b, { fuente = "carpeta" } = {}) {
  await core.lockTimer(q);
  const cambios = { hechas: 0, renombradas: 0, nuevas: 0 };
  for (const id of ids(b.hechas)) {
    const r = await q.query("SELECT 1 FROM items WHERE id=$1 AND kind='tarea' AND status NOT IN ('hecha','archivada')", [id]);
    if (r.rowCount) { await core.updateItem(q, id, { status: "hecha" }); cambios.hechas++; }
  }
  for (const x of (Array.isArray(b.renombradas) ? b.renombradas : []).slice(0, 200)) {
    const t = String(x?.title || "").trim().slice(0, 300);
    if (!UUID.test(String(x?.id)) || !t) continue;
    const r = await q.query("UPDATE items SET title=$2, updated_at=now() WHERE id=$1 AND kind='tarea' AND title<>$2 AND fuente='app' RETURNING id", [x.id, t]);
    cambios.renombradas += r.rowCount;
  }
  for (const n of (Array.isArray(b.nuevas) ? b.nuevas : []).slice(0, 200)) {
    const t = String(n?.title || "").trim();
    if (!t) continue;
    // El título «## Proyecto» del archivo es el proyecto; si no existe, se crea (los escribes a propósito).
    const nombre = String(n.proyecto || "").trim().slice(0, 160);
    let pid = null;
    if (nombre) {
      const ya = (await q.query("SELECT id FROM proyectos WHERE lower(nombre)=lower($1) AND estado<>'archivado' ORDER BY creado LIMIT 1", [nombre])).rows[0];
      pid = ya?.id || (await proyectos.crearProyecto(q, { nombre })).id;
    }
    const eis = core.EISEN.find((e) => e.toLowerCase() === String(n.eisenhower || "").toLowerCase()) || null;
    await core.createItem(q, { kind: "tarea", title: t, due_date: FECHA.test(String(n.due_date)) ? n.due_date : null, proyecto_id: pid, eisenhower: eis });
    cambios.nuevas++;
  }
  if (cambios.hechas || cambios.renombradas || cambios.nuevas) await log(q, "carpeta.sync", `${fuente}: ${JSON.stringify(cambios)}`);
  return cambios;
}

export function rutas(app, { pool, tx, need, wrap, changed, empujar }) {
  app.get("/api/carpeta/pendientes", need, wrap(async (req, res) => res.json({ tareas: await pendientes(pool) })));
  app.post("/api/carpeta/sync", need, wrap(async (req, res) => {
    const fuente = String(req.who?.label || "carpeta").slice(0, 40);
    const cambios = await tx(pool, (q) => sincronizar(q, req.body || {}, { fuente }));
    if (cambios.hechas || cambios.renombradas || cambios.nuevas) { changed("carpeta"); empujar(); }
    res.json({ ok: true, cambios, tareas: await pendientes(pool) });
  }));
}
