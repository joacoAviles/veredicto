// Las 9 bases del Juez del Tiempo en Notion: Pilares, Proyectos, Tareas, Ideas e Inbox, Rutinas y hábitos,
// Recurrencias, Calendario, Sesiones y Actividad y revisiones.
// Veredicto las crea (o adopta las «TimeMachine - …» que ya tienes, e importa su historial) y las mantiene al día.
// Igual que el Juez antiguo: se edita en Veredicto y Notion muestra; la base «Flujo» es la que va en ambos sentidos.
import { createHash } from "node:crypto";
import { pageIdFrom } from "./notion.js";

export const BASES = [
  ["pilares", "Pilares"], ["proyectos", "Proyectos"], ["tareas", "Tareas"], ["ideas", "Ideas e Inbox"],
  ["rutinas", "Rutinas y hábitos"], ["recurrencias", "Recurrencias"], ["calendario", "Calendario"],
  ["sesiones", "Sesiones"], ["actividad", "Actividad y revisiones"],
];
const NOMBRE = Object.fromEntries(BASES);

// Texto a rich_text de Notion (recortado).
const T = (s) => [{ type: "text", text: { content: String(s ?? "").slice(0, 1900) } }];
// rich_text de Notion a texto plano.
const plano = (rt) => (rt || []).map((x) => x.plain_text || "").join("").trim();
// Fecha a ISO (null si no hay).
const iso = (d) => (d ? new Date(d).toISOString() : null);
// Fecha a AAAA-MM-DD.
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const P = {
  title: (v) => ({ title: T(v) }), text: (v) => ({ rich_text: v ? T(v) : [] }), num: (v) => ({ number: v == null ? null : Math.round(v) }),
  date: (a, b) => ({ date: a ? { start: a, end: b || null } : null }), check: (v) => ({ checkbox: !!v }),
  sel: (v) => ({ select: v ? { name: String(v).slice(0, 90) } : null }), rel: (ids) => ({ relation: (ids || []).filter(Boolean).map((id) => ({ id })) }),
};

// Columnas comunes a 8 de las 9 bases (igual que las del Juez antiguo).
const comunes = (relPil, relPro) => ({
  Nombre: { title: {} }, Detalle: { rich_text: {} }, Estado: { rich_text: {} }, Tipo: { rich_text: {} }, Notas: { rich_text: {} },
  "Fecha límite": { date: {} }, Intervalo: { date: {} }, Sincronizado: { date: {} }, Legacy: { url: {} },
  "Minutos medidos": { number: {} }, "Minutos planificados": { number: {} }, UUID: { rich_text: {} }, Versión: { number: {} },
  ...(relPil ? { Pilar: { relation: { database_id: relPil, single_property: {} } } } : {}),
  ...(relPro ? { Proyecto: { relation: { database_id: relPro, single_property: {} } } } : {}),
});

// Crea las 9 bases bajo tu página de Notion.
// Agrega a «Flujo» la relación con Proyectos, para asignar un proyecto desde Notion.
export async function enlazarFlujo(n, flujoId, proyectosId) {
  try { await n.databases.update({ database_id: flujoId, properties: { Proyecto: { relation: { database_id: proyectosId, single_property: {} } } } }); }
  catch { /* si no se puede, Flujo sigue funcionando sin proyecto */ }
}

// Crea las 9 bases de Notion bajo la página raíz.
export async function crear(n, raiz) {
  const parent = { type: "page_id", page_id: pageIdFrom(raiz) };
  const mk = async (clave, properties) => (await n.databases.create({ parent, title: T(`Veredicto · ${NOMBRE[clave]}`), properties })).id;
  const ids = {};
  ids.pilares = await mk("pilares", comunes());
  ids.proyectos = await mk("proyectos", comunes());
  ids.tareas = await mk("tareas", { ...comunes(ids.pilares, ids.proyectos), Categoría: { rich_text: {} }, Eisenhower: { rich_text: {} }, Completada: { checkbox: {} }, "En progreso": { checkbox: {} }, Retrasada: { checkbox: {} } });
  for (const k of ["ideas", "rutinas", "recurrencias", "calendario", "actividad"]) ids[k] = await mk(k, comunes(ids.pilares, ids.proyectos));
  ids.sesiones = await mk("sesiones", {
    Nombre: { title: {} }, Detalle: { rich_text: {} },
    Estado: { select: { options: [{ name: "En curso", color: "green" }, { name: "Pausada", color: "yellow" }, { name: "Detenida", color: "gray" }] } },
    Intervalo: { date: {} }, "Minutos medidos": { number: {} }, Origen: { select: { options: [{ name: "Veredicto", color: "blue" }] } },
    "Objetivo UUID": { rich_text: {} }, "Proyecto UUID": { rich_text: {} }, "Pilar UUID": { rich_text: {} }, Sincronizado: { date: {} }, UUID: { rich_text: {} }, Versión: { number: {} },
  });
  return ids;
}

// Busca tus bases existentes: «TimeMachine - X» (del Juez antiguo) o «Veredicto · X».
export async function adoptar(n) {
  const encontradas = {};
  let cursor;
  for (let i = 0; i < 10; i++) {
    const r = await n.search({ filter: { property: "object", value: "database" }, page_size: 100, start_cursor: cursor });
    for (const db of r.results) {
      if (db.archived || db.in_trash) continue;
      const t = plano(db.title);
      for (const [k, nombre] of BASES) if (t === `TimeMachine - ${nombre}` || t === `Veredicto · ${nombre}`) encontradas[k] ??= db.id;
    }
    if (!r.has_more) break;
    cursor = r.next_cursor;
  }
  const faltan = BASES.filter(([k]) => !encontradas[k]).map(([, n]) => n);
  return { bases: encontradas, faltan };
}

// ---------- Importar historial desde las bases adoptadas ----------
async function todas(n, database_id) {
  const out = [];
  let cursor;
  for (let i = 0; i < 100; i++) {
    const r = await n.databases.query({ database_id, page_size: 100, start_cursor: cursor });
    out.push(...r.results.filter((p) => !p.archived && !p.in_trash));
    if (!r.has_more) break;
    cursor = r.next_cursor;
  }
  return out;
}
// Lee una propiedad de una página de Notion como valor simple.
const leer = (p, k) => {
  const v = p.properties?.[k];
  if (!v) return null;
  if (v.type === "title") return plano(v.title);
  if (v.type === "rich_text") return plano(v.rich_text);
  if (v.type === "number") return v.number;
  if (v.type === "checkbox") return v.checkbox;
  if (v.type === "select") return v.select?.name || null;
  if (v.type === "date") return v.date;
  if (v.type === "relation") return (v.relation || []).map((x) => x.id);
  if (v.type === "url") return v.url;
  return null;
};
// Guarda qué página de Notion corresponde a cada fila local.
const recordar = (q, base, ref, page) => q.query(
  "INSERT INTO notion_espejo(base,ref,page_id,version) VALUES ($1,$2,$3,'importado') ON CONFLICT (base,ref) DO UPDATE SET page_id=EXCLUDED.page_id", [base, ref, page]);
// Id de Notion sin guiones.
const sinGuiones = (id) => String(id || "").replace(/-/g, "");

// Importa desde las 9 bases de Notion: pilares, proyectos, tareas, rutinas, sesiones, calendario e ideas.
export async function importar(pool, n, bases, { log = () => {} } = {}) {
  const cuenta = { pilares: 0, proyectos: 0, tareas: 0, rutinas: 0, sesiones: 0, calendario: 0, ideas: 0 };
  const mapa = new Map(); // page id de Notion → id en Veredicto
  const q = pool;
  const ya = async (base, page) => (await q.query("SELECT ref FROM notion_espejo WHERE base=$1 AND replace(page_id,'-','')=$2", [base, sinGuiones(page)])).rows[0]?.ref;

  for (const p of await todas(n, bases.pilares)) {
    let id = await ya("pilares", p.id);
    if (!id) {
      id = (await q.query("INSERT INTO pilares(nombre,notas) VALUES ($1,$2) RETURNING id", [leer(p, "Nombre") || "Pilar", leer(p, "Notas") || ""])).rows[0].id;
      await recordar(q, "pilares", id, p.id); cuenta.pilares++;
    }
    mapa.set(sinGuiones(p.id), id);
  }
  log(`pilares: ${cuenta.pilares}`);
  const estadoProyecto = (e) => (/termin|hech|complet|done/i.test(e || "") ? "terminado" : /paus/i.test(e || "") ? "pausado" : /archiv/i.test(e || "") ? "archivado" : "activo");
  for (const p of await todas(n, bases.proyectos)) {
    let id = await ya("proyectos", p.id);
    if (!id) {
      const pil = (leer(p, "Pilar") || [])[0];
      id = (await q.query("INSERT INTO proyectos(nombre,pilar_id,estado,fecha_limite,minutos_plan,notas) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [
        leer(p, "Nombre") || "Proyecto", pil ? mapa.get(sinGuiones(pil)) || null : null, estadoProyecto(leer(p, "Estado")),
        leer(p, "Fecha límite")?.start?.slice(0, 10) || null, leer(p, "Minutos planificados") || null, leer(p, "Notas") || ""])).rows[0].id;
      await recordar(q, "proyectos", id, p.id); cuenta.proyectos++;
    }
    mapa.set(sinGuiones(p.id), id);
  }
  log(`proyectos: ${cuenta.proyectos}`);
  const proyDe = (p) => { const r = (leer(p, "Proyecto") || [])[0]; return r ? mapa.get(sinGuiones(r)) || null : null; };
  const estadoTarea = (p) => (leer(p, "Completada") || /hech|complet|done|termin/i.test(leer(p, "Estado") || "") ? "hecha" : /archiv|cancel/i.test(leer(p, "Estado") || "") ? "archivada" : leer(p, "En progreso") ? "en curso" : "pendiente");
  for (const p of await todas(n, bases.tareas)) {
    if (await ya("tareas", p.id)) continue;
    const it = (await q.query(
      "INSERT INTO items(kind,title,status,est_min,due_date,proyecto_id,eisenhower) VALUES ('tarea',$1,$2,$3,$4,$5,$6) RETURNING id", [
        (leer(p, "Nombre") || "Tarea").slice(0, 300), estadoTarea(p), Math.max(5, Math.min(1440, Math.round(leer(p, "Minutos planificados") || 30))),
        leer(p, "Fecha límite")?.start?.slice(0, 10) || null, proyDe(p), ["Hacer ya", "Agendar", "Delegar", "Eliminar"].includes(leer(p, "Eisenhower")) ? leer(p, "Eisenhower") : null])).rows[0];
    await recordar(q, "tareas", it.id, p.id); mapa.set(sinGuiones(p.id), it.id); cuenta.tareas++;
  }
  log(`tareas: ${cuenta.tareas}`);
  for (const p of await todas(n, bases.rutinas)) {
    if (await ya("rutinas", p.id)) continue;
    const ini = leer(p, "Intervalo")?.start;
    const hora = ini && ini.length > 10 ? new Date(ini).toTimeString().slice(0, 5) : null;
    const it = (await q.query("INSERT INTO items(kind,title,est_min,hora,proyecto_id) VALUES ('rutina',$1,$2,$3,$4) RETURNING id", [
      (leer(p, "Nombre") || "Rutina").slice(0, 300), Math.max(5, Math.min(1440, Math.round(leer(p, "Minutos planificados") || 30))), hora, proyDe(p)])).rows[0];
    await recordar(q, "rutinas", it.id, p.id); mapa.set(sinGuiones(p.id), it.id); cuenta.rutinas++;
  }
  log(`rutinas: ${cuenta.rutinas}`);
  for (const p of await todas(n, bases.sesiones)) {
    if (await ya("sesiones", p.id)) continue;
    const iv = leer(p, "Intervalo");
    if (!iv?.start || !iv.end) continue;
    const a = new Date(iv.start), b = new Date(iv.end);
    if (!(a < b)) continue;
    const s = (await q.query("INSERT INTO sessions(title,state,started_at,ended_at,source) VALUES ($1,'done',$2,$3,'importado') RETURNING id", [(leer(p, "Nombre") || "Sesión").slice(0, 300), a, b])).rows[0];
    await q.query("INSERT INTO segments(session_id,started_at,ended_at) VALUES ($1,$2,$3)", [s.id, a, b]);
    await recordar(q, "sesiones", s.id, p.id); cuenta.sesiones++;
  }
  // Enlaza las sesiones importadas con su tarea por nombre.
  await q.query(`UPDATE sessions s SET item_id=i.id FROM items i WHERE s.source='importado' AND s.item_id IS NULL AND lower(i.title)=lower(s.title)`);
  log(`sesiones: ${cuenta.sesiones}`);
  for (const p of await todas(n, bases.calendario)) {
    if (await ya("calendario", p.id)) continue;
    const iv = leer(p, "Intervalo");
    if (!iv?.start || iv.start.length <= 10) continue;
    const a = new Date(iv.start), b = iv.end ? new Date(iv.end) : new Date(+a + (leer(p, "Minutos planificados") || 30) * 60000);
    if (!(a < b) || b < new Date(Date.now() - 30 * 864e5)) continue;
    const bl = (await q.query("INSERT INTO blocks(title,starts_at,ends_at,origin) VALUES ($1,$2,$3,'manual') RETURNING id", [(leer(p, "Nombre") || "Bloque").slice(0, 300), a, b])).rows[0];
    await recordar(q, "calendario", bl.id, p.id); cuenta.calendario++;
  }
  log(`calendario: ${cuenta.calendario}`);
  for (const p of await todas(n, bases.ideas)) {
    if (await ya("ideas", p.id)) continue;
    const c = (await q.query("INSERT INTO captures(kind,text,body,source,status) VALUES ('captura',$1,$2,'importado',$3) RETURNING id", [
      (leer(p, "Nombre") || "Idea").slice(0, 300), leer(p, "Notas") || leer(p, "Detalle") || "", /proces|hech|archiv/i.test(leer(p, "Estado") || "") ? "procesada" : "abierta"])).rows[0];
    await recordar(q, "ideas", c.id, p.id); cuenta.ideas++;
  }
  log(`ideas: ${cuenta.ideas}`);
  return cuenta;
}

// ---------- Publicar: lo que cambió en Veredicto se escribe en su fila ----------
const hash = (o) => createHash("sha1").update(JSON.stringify(o)).digest("hex").slice(0, 16);
const SESION_DIAS = 60;

// Filas locales de una base para publicar en Notion.
async function filas(q, base, tz) {
  const pg = async (b) => new Map((await q.query("SELECT ref, page_id FROM notion_espejo WHERE base=$1", [b])).rows.map((r) => [r.ref, r.page_id]));
  if (base === "pilares") {
    return (await q.query("SELECT * FROM pilares WHERE NOT demo")).rows.map((p) => ({ ref: p.id, props: {
      Nombre: P.title(p.nombre), Estado: P.text(p.estado === "activo" ? "Activo" : "Archivado"), Notas: P.text(p.notas), UUID: P.text(p.id), Tipo: P.text("Pilar"),
    } }));
  }
  const pil = await pg("pilares"), pro = await pg("proyectos");
  if (base === "proyectos") {
    return (await q.query(`SELECT p.*, (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (g.ended_at-g.started_at))),0)/60 FROM sessions s JOIN segments g ON g.session_id=s.id JOIN items i ON i.id=s.item_id WHERE i.proyecto_id=p.id AND g.ended_at IS NOT NULL)::int AS med,
      (SELECT COALESCE(SUM(est_min),0) FROM items i WHERE i.proyecto_id=p.id AND i.status IN ('pendiente','en curso'))::int AS plan FROM proyectos p WHERE NOT demo`)).rows.map((p) => ({ ref: p.id, props: {
      Nombre: P.title(p.nombre), Estado: P.text({ activo: "Activo", pausado: "Pausado", terminado: "Terminado", archivado: "Archivado" }[p.estado]),
      "Fecha límite": P.date(dia(p.fecha_limite)), "Minutos medidos": P.num(p.med), "Minutos planificados": P.num(p.minutos_plan ?? p.plan),
      Notas: P.text(p.notas), UUID: P.text(p.id), Tipo: P.text("Proyecto"),
    } }));
  }
  const relPro = (id) => P.rel(id && pro.get(id) ? [pro.get(id)] : []);
  const relPil = (id) => P.rel(id && pil.get(id) ? [pil.get(id)] : []);
  if (base === "tareas" || base === "rutinas" || base === "recurrencias") {
    const kind = base === "tareas" ? "tarea" : "rutina";
    const rows = (await q.query(`SELECT i.*, pr.pilar_id,
      (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (g.ended_at-g.started_at))),0)/60 FROM sessions s JOIN segments g ON g.session_id=s.id WHERE s.item_id=i.id AND g.ended_at IS NOT NULL)::int AS med
      FROM items i LEFT JOIN proyectos pr ON pr.id=i.proyecto_id WHERE i.kind=$1 AND NOT i.demo AND (i.nota_ref IS DISTINCT FROM 'flujo')
      AND (i.status <> 'hecha' OR i.updated_at > now() - interval '60 days')`, [kind])).rows;
    const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    const regla = (i) => `${i.dias?.length ? i.dias.map((d) => DIAS[d]).join(" ") : "Todos los días"}${i.hora ? " · " + String(i.hora).slice(0, 5) : ""}`;
    if (base === "recurrencias") return rows.filter((i) => i.hora || i.dias?.length).map((i) => ({ ref: i.id, props: {
      Nombre: P.title(i.title), Detalle: P.text(regla(i)), Tipo: P.text("Recurrencia"), Estado: P.text(i.status === "archivada" ? "Archivada" : "Activa"),
      "Minutos planificados": P.num(i.est_min), Proyecto: relPro(i.proyecto_id), Pilar: relPil(i.pilar_id), UUID: P.text(i.id),
    } }));
    const est = { pendiente: "Pendiente", "en curso": "En curso", hecha: "Hecha", archivada: "Archivada" };
    return rows.map((i) => ({ ref: i.id, props: {
      Nombre: P.title(i.title), Estado: P.text(est[i.status]), Tipo: P.text(kind === "tarea" ? "Tarea" : "Rutina"),
      "Minutos planificados": P.num(i.est_min), "Minutos medidos": P.num(i.med), "Fecha límite": P.date(dia(i.due_date)),
      Proyecto: relPro(i.proyecto_id), Pilar: relPil(i.pilar_id), UUID: P.text(i.id),
      ...(kind === "tarea" ? {
        Completada: P.check(i.status === "hecha"), "En progreso": P.check(i.status === "en curso"),
        Retrasada: P.check(i.due_date && i.status !== "hecha" && dia(i.due_date) < dia(Date.now())), Eisenhower: P.text(i.eisenhower || ""),
        Categoría: P.text({ app: "Veredicto", markdown: "Obsidian", notion: "Notion" }[i.fuente] || i.fuente),
      } : { Detalle: P.text(regla(i)) }),
    } }));
  }
  if (base === "ideas") {
    return (await q.query("SELECT * FROM captures WHERE NOT demo AND created_at > now() - interval '90 days'")).rows.map((c) => ({ ref: c.id, props: {
      Nombre: P.title(c.text), Notas: P.text(c.body), Estado: P.text(c.status === "procesada" ? "Procesada" : "Abierta"),
      Tipo: P.text(c.kind === "nota" ? "Nota" : "Idea"), Detalle: P.text(c.source), UUID: P.text(c.id), "Fecha límite": P.date(null),
    } }));
  }
  if (base === "calendario") {
    return (await q.query(`SELECT b.*, i.proyecto_id, pr.pilar_id FROM blocks b LEFT JOIN items i ON i.id=b.item_id LEFT JOIN proyectos pr ON pr.id=i.proyecto_id
      WHERE NOT b.demo AND b.borrado IS NULL AND b.starts_at > now() - interval '30 days' AND b.starts_at < now() + interval '30 days'`)).rows.map((b) => ({ ref: b.id, props: {
      Nombre: P.title(b.title), Intervalo: P.date(iso(b.starts_at), iso(b.ends_at)), "Minutos planificados": P.num((b.ends_at - b.starts_at) / 60000),
      Tipo: P.text(b.origin === "auto" ? "Armado solo" : "Agendado"), Estado: P.text("Planificado"), Proyecto: relPro(b.proyecto_id), Pilar: relPil(b.pilar_id), UUID: P.text(b.id),
    } }));
  }
  if (base === "sesiones") {
    return (await q.query(`SELECT s.*, i.proyecto_id, pr.pilar_id,
      (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (g.ended_at-g.started_at))),0)/60 FROM segments g WHERE g.session_id=s.id AND g.ended_at IS NOT NULL) AS med
      FROM sessions s LEFT JOIN items i ON i.id=s.item_id LEFT JOIN proyectos pr ON pr.id=i.proyecto_id
      WHERE NOT s.demo AND s.state='done' AND s.started_at > now() - ($1 || ' days')::interval`, [String(SESION_DIAS)])).rows.map((s) => ({ ref: s.id, props: {
      Nombre: P.title(s.title), Estado: P.sel("Detenida"), Intervalo: P.date(iso(s.started_at), iso(s.ended_at)), "Minutos medidos": P.num(s.med),
      Origen: P.sel("Veredicto"), Detalle: P.text(s.source), "Objetivo UUID": P.text(s.item_id || ""), "Proyecto UUID": P.text(s.proyecto_id || ""),
      "Pilar UUID": P.text(s.pilar_id || ""), UUID: P.text(s.id),
    } }));
  }
  if (base === "actividad") {
    // Una fila por día: lo medido, lo que vio ActivityWatch y lo que quedó sin registrar.
    const rows = (await q.query(`SELECT to_char(d, 'YYYY-MM-DD') AS dia,
      (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (g.ended_at-g.started_at))),0)/60 FROM segments g WHERE g.ended_at IS NOT NULL AND (g.started_at AT TIME ZONE $1)::date = d) AS med,
      (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (a.fin-a.inicio))),0)/60 FROM actividad a WHERE NOT a.demo AND (a.inicio AT TIME ZONE $1)::date = d) AS pc,
      (SELECT string_agg(app || ' ' || round(m)::text || ' min', ', ' ORDER BY m DESC) FROM (SELECT app, SUM(EXTRACT(EPOCH FROM (fin-inicio)))/60 m FROM actividad a WHERE NOT a.demo AND (a.inicio AT TIME ZONE $1)::date = d GROUP BY app ORDER BY m DESC LIMIT 5) t) AS apps
      FROM generate_series((now() AT TIME ZONE $1)::date - 13, (now() AT TIME ZONE $1)::date, interval '1 day') d`, [tz])).rows;
    return rows.filter((r) => r.med > 0 || r.pc > 0).map((r) => ({ ref: r.dia, props: {
      Nombre: P.title(`Día ${r.dia}`), Tipo: P.text("Revisión diaria"), Intervalo: P.date(r.dia), "Minutos medidos": P.num(r.med),
      "Minutos planificados": P.num(null), Detalle: P.text(r.apps ? `Computador: ${Math.round(r.pc)} min (${r.apps})` : "Sin actividad del computador"),
      Estado: P.text(r.pc > r.med ? `${Math.round(r.pc - r.med)} min del computador sin registrar` : "Al día"), UUID: P.text(r.dia),
    } }));
  }
  return [];
}

// Publica en Notion lo que cambió localmente (hasta `limite` filas).
export async function publicar(pool, n, bases, { tz = "UTC", limite = 60 } = {}) {
  let hechos = 0;
  for (const [base] of BASES) {
    if (!bases[base]) continue;
    const vistos = new Map((await pool.query("SELECT ref, page_id, version FROM notion_espejo WHERE base=$1", [base])).rows.map((r) => [r.ref, r]));
    for (const f of await filas(pool, base, tz)) {
      if (hechos >= limite) return { hechos, pendiente: true };
      const v = hash(f.props), prev = vistos.get(String(f.ref));
      if (prev && prev.version === v) continue;
      const props = { ...f.props, Sincronizado: P.date(new Date().toISOString()) };
      try {
        if (prev) await n.pages.update({ page_id: prev.page_id, properties: props });
        else {
          const p = await n.pages.create({ parent: { database_id: bases[base] }, properties: props });
          await pool.query("INSERT INTO notion_espejo(base,ref,page_id,version) VALUES ($1,$2,$3,'') ON CONFLICT (base,ref) DO UPDATE SET page_id=EXCLUDED.page_id", [base, String(f.ref), p.id]);
        }
      } catch (e) {
        if (e.status === 404 && prev) { await pool.query("DELETE FROM notion_espejo WHERE base=$1 AND ref=$2", [base, String(f.ref)]); continue; }
        if (e.status === 400 && /property/i.test(e.message)) throw new Error(`La base «${NOMBRE[base]}» no tiene una columna que Veredicto necesita: ${e.message}`);
        throw e;
      }
      await pool.query("UPDATE notion_espejo SET version=$3 WHERE base=$1 AND ref=$2", [base, String(f.ref), v]);
      hechos++;
    }
  }
  return { hechos, pendiente: false };
}

// Página guía con plantillas en Notion (viñetas, no casillas: las casillas se volverían gestiones).
export async function guia(n, raiz, { flujo, bases = {} } = {}) {
  const b = (type, text, extra = {}) => ({ object: "block", type, [type]: { rich_text: T(text), ...extra } });
  const mencion = (id, txt) => id ? { object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "mention", mention: { database: { id } } }, { type: "text", text: { content: "  " + txt } }] } } : b("paragraph", txt);
  const plantilla = (titulo, pasos) => [b("heading_3", titulo), ...pasos.map((p) => b("bulleted_list_item", p))];
  const children = [
    b("callout", "Veredicto mide tu tiempo y lo pone en tu calendario. Notion es donde viven tus ideas y notas: escribe aquí, Veredicto agenda y registra.", { icon: { type: "emoji", emoji: "⚖️" }, color: "gray_background" }),
    b("heading_2", "De idea a tiempo en el calendario"),
    b("numbered_list_item", "Anota en «Flujo» (o desde el iPhone con el atajo Capturar). Entra como Bandeja."),
    b("numbered_list_item", "Cuando la idea madura, cámbiala a Idea; cuando vas a hacerla, a «Por hacer» y pon la Duración en minutos."),
    b("numbered_list_item", "Si eliges día y hora en «Agendar», aparece en tu calendario. Si no, «Armar mi día» la ubica en un hueco libre."),
    b("numbered_list_item", "Al iniciarla en Veredicto pasa a «En curso»; al pararla, se suman los «Minutos registrados». Márcala Hecha cuando termines."),
    mencion(flujo, "← tu base Flujo (va en ambos sentidos)"),
    b("heading_2", "Las 9 bases"),
    b("paragraph", "Pilares, Proyectos, Tareas, Ideas e Inbox, Rutinas y hábitos, Recurrencias, Calendario, Sesiones y Actividad y revisiones. Veredicto las mantiene al día cada 2 minutos: úsalas para ver, filtrar y armar vistas. Para cambiar algo, hazlo en Veredicto o en Flujo."),
    ...BASES.filter(([k]) => bases[k]).map(([k, nom]) => mencion(bases[k], nom)),
    b("heading_2", "Plantillas"),
    b("paragraph", "Copia estas listas en el cuerpo de una fila de Flujo. Si las conviertes en casillas, cada casilla se vuelve una gestión en Veredicto."),
    ...plantilla("🎬 Video", ["Guion (60 min)", "Grabación (90 min)", "Edición (120 min)", "Miniatura y título (30 min)", "Publicar y responder comentarios (20 min)"]),
    ...plantilla("📋 Gestión", ["Qué hay que conseguir", "A quién llamar o escribir", "Documentos que necesito", "Fecha límite"]),
    ...plantilla("🗓 Revisión semanal (domingo, 30 min)", ["Vacía la Bandeja: cada cosa pasa a Idea, Por hacer o Archivada", "Mira Sesiones: ¿dónde se fue el tiempo?", "Elige 3 «Por hacer» para la semana y dales Duración", "Revisa Proyectos con fecha límite cercana"]),
    ...plantilla("💡 Idea", ["Qué es, en una frase", "Por qué importa", "Primer paso concreto"]),
  ];
  const p = await n.pages.create({ parent: { page_id: pageIdFrom(raiz) }, icon: { type: "emoji", emoji: "⚖️" }, properties: { title: { title: T("Veredicto · Cómo usar") } }, children });
  return p.id;
}
