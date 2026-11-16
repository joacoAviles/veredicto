// Pilares → proyectos → tareas, como en el Juez del Tiempo. Con minutos medidos y planificados.
import { HttpError, enqueue } from "./core.js";
import { log } from "./db.js";

const txt = (v, n = 300) => String(v ?? "").trim().slice(0, n);
const ESTADOS = ["activo", "pausado", "terminado", "archivado"];

export async function crearPilar(q, { nombre, color = null, notas = "" }) {
  nombre = txt(nombre, 120);
  if (!nombre) throw new HttpError(400, "Ponle nombre al pilar.");
  const r = await q.query("INSERT INTO pilares(nombre,color,notas) VALUES ($1,$2,$3) RETURNING *", [nombre, color, txt(notas, 4000)]);
  await log(q, "pilar.creado", nombre);
  return r.rows[0];
}

export async function editarPilar(q, id, p) {
  const prev = (await q.query("SELECT * FROM pilares WHERE id=$1", [id])).rows[0];
  if (!prev) throw new HttpError(404, "No existe ese pilar.");
  const r = await q.query("UPDATE pilares SET nombre=$2, color=$3, notas=$4, estado=$5, actualizado=now() WHERE id=$1 RETURNING *", [
    id, p.nombre != null ? txt(p.nombre, 120) || prev.nombre : prev.nombre, p.color !== undefined ? p.color : prev.color,
    p.notas != null ? txt(p.notas, 4000) : prev.notas, p.estado === "archivado" || p.estado === "activo" ? p.estado : prev.estado]);
  return r.rows[0];
}

export async function crearProyecto(q, { nombre, pilar_id = null, fecha_limite = null, minutos_plan = null, color = null, notas = "" }) {
  nombre = txt(nombre, 160);
  if (!nombre) throw new HttpError(400, "Ponle nombre al proyecto.");
  const r = await q.query(
    "INSERT INTO proyectos(nombre,pilar_id,fecha_limite,minutos_plan,color,notas) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [nombre, pilar_id || null, fecha_limite || null, minutos_plan ? Math.round(Number(minutos_plan)) : null, color, txt(notas, 4000)]);
  await log(q, "proyecto.creado", nombre);
  return r.rows[0];
}

export async function editarProyecto(q, id, p) {
  const prev = (await q.query("SELECT * FROM proyectos WHERE id=$1", [id])).rows[0];
  if (!prev) throw new HttpError(404, "No existe ese proyecto.");
  if (p.estado != null && !ESTADOS.includes(p.estado)) throw new HttpError(400, "Estado no válido.");
  const v = (k, f = (x) => x) => (p[k] !== undefined ? f(p[k]) : prev[k]);
  const r = await q.query(
    "UPDATE proyectos SET nombre=$2, pilar_id=$3, estado=$4, fecha_limite=$5, minutos_plan=$6, color=$7, notas=$8, actualizado=now() WHERE id=$1 RETURNING *",
    [id, v("nombre", (x) => txt(x, 160) || prev.nombre), v("pilar_id", (x) => x || null), v("estado"), v("fecha_limite", (x) => x || null),
      v("minutos_plan", (x) => (x ? Math.round(Number(x)) : null)), v("color"), v("notas", (x) => txt(x, 4000))]);
  return r.rows[0];
}

// Lista con avance: tareas abiertas/hechas, minutos medidos (sesiones) y planificados (estimado de lo abierto).
export async function listar(q, { incluirArchivados = false } = {}) {
  const pil = (await q.query("SELECT * FROM pilares WHERE ($1 OR estado='activo') ORDER BY orden, nombre", [incluirArchivados])).rows;
  const pro = (await q.query(
    `SELECT p.*,
       (SELECT count(*)::int FROM items i WHERE i.proyecto_id=p.id AND i.status IN ('pendiente','en curso')) AS abiertas,
       (SELECT count(*)::int FROM items i WHERE i.proyecto_id=p.id AND i.status='hecha') AS hechas,
       (SELECT COALESCE(SUM(i.est_min),0)::int FROM items i WHERE i.proyecto_id=p.id AND i.status IN ('pendiente','en curso')) AS min_pendiente,
       (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(g.ended_at, now())-g.started_at))),0)/60
          FROM sessions s JOIN segments g ON g.session_id=s.id JOIN items i ON i.id=s.item_id WHERE i.proyecto_id=p.id)::int AS min_medidos,
       (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(g.ended_at, now())-g.started_at))),0)/60
          FROM sessions s JOIN segments g ON g.session_id=s.id JOIN items i ON i.id=s.item_id
          WHERE i.proyecto_id=p.id AND g.started_at > now() - interval '7 days')::int AS min_semana,
       (SELECT max(s.ended_at) FROM sessions s JOIN items i ON i.id=s.item_id WHERE i.proyecto_id=p.id) AS ultima
     FROM proyectos p WHERE ($1 OR p.estado IN ('activo','pausado')) ORDER BY p.estado, p.fecha_limite NULLS LAST, p.nombre`, [incluirArchivados])).rows;
  return {
    pilares: pil.map((x) => ({ id: x.id, nombre: x.nombre, color: x.color, notas: x.notas, estado: x.estado, demo: x.demo })),
    proyectos: pro.map((p) => ({
      id: p.id, nombre: p.nombre, pilar_id: p.pilar_id, estado: p.estado, color: p.color, notas: p.notas, demo: p.demo,
      fecha_limite: p.fecha_limite ? new Date(p.fecha_limite).toISOString().slice(0, 10) : null, minutos_plan: p.minutos_plan,
      abiertas: p.abiertas, hechas: p.hechas, min_pendiente: p.min_pendiente, min_medidos: p.min_medidos, min_semana: p.min_semana,
      ultima: p.ultima ? +p.ultima : null,
    })),
  };
}

export async function asignar(q, itemId, proyectoId) {
  const r = await q.query("UPDATE items SET proyecto_id=$2, updated_at=now() WHERE id=$1 RETURNING id", [itemId, proyectoId || null]);
  if (!r.rowCount) throw new HttpError(404, "No existe esa tarea.");
}

export async function buscarProyecto(q, texto) {
  const t = txt(texto, 160).toLowerCase();
  if (!t) return null;
  const r = await q.query("SELECT * FROM proyectos WHERE estado<>'archivado' ORDER BY (lower(nombre)=$1) DESC, (lower(nombre) LIKE $1 || '%') DESC, length(nombre) LIMIT 1", [t]);
  const p = r.rows[0];
  return p && p.nombre.toLowerCase().includes(t) ? p : null;
}

void enqueue;
