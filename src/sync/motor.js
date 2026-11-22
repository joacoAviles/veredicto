// Motor de sincronización. Trae cambios de cada cuenta, los concilia con el espejo local
// y despacha la cola de cambios hechos en la app. Un solo motor a la vez.
import { cifrar, descifrar } from "../cifrado.js";
import { log, getSetting } from "../db.js";
import { dayKey } from "../time.js";
import { enqueue, enqueueFlujo } from "../core.js";
import * as espejo from "./espejo.js";
import * as caldav from "./caldav.js";
import * as google from "./google.js";
import * as outlook from "./outlook.js";
import * as markdown from "./markdown.js";
import * as notion from "./notion.js";

export const CALENDARIO = { caldav, google, outlook };
export const NOTAS = { markdown, notion };
const DIA = 86_400_000;
export const VENTANA = { atras: 14 * DIA, adelante: 60 * DIA };

// Configuración descifrada de una cuenta y función para guardarla.
export async function cuentaConfig(pool, cuenta) {
  const cfg = descifrar(cuenta.config);
  const guardar = async (c) => pool.query("UPDATE cuentas SET config=$2 WHERE id=$1", [cuenta.id, cifrar(c)]);
  return { cfg, guardar };
}

// Registra un conflicto de sincronización (quién ganó).
const conflicto = (q, objeto, ref, titulo, ganador, perdedor) =>
  q.query("INSERT INTO conflictos(objeto,ref,titulo,ganador,perdedor) VALUES ($1,$2,$3,$4,$5)", [objeto, ref, String(titulo || "").slice(0, 300), ganador, JSON.stringify(perdedor)]);

// Cancela trabajos pendientes de la cola que perdieron contra un cambio externo.
const cancelarCola = (q, kind, cond, val) =>
  q.query(`UPDATE outbox SET status='ok', last_error='cancelado: ganó el cambio de afuera', done_at=now() WHERE kind=$1 AND status<>'ok' AND ${cond}`, [kind, val]);

// ---------- Calendarios: espejo de eventos ajenos ----------
export async function conciliarEventos(q, cal, remotos, now) {
  const locales = (await q.query("SELECT * FROM calendar_events WHERE calendar_id=$1 AND local_editado IS NOT NULL", [cal.id])).rows;
  const pend = new Map(locales.map((r) => [r.uid, r]));
  await q.query("DELETE FROM calendar_events WHERE calendar_id=$1 AND local_editado IS NULL", [cal.id]);
  const vistos = new Set();
  for (const r of remotos) {
    const p = pend.get(r.uid);
    if (p && !r.recurrente) {
      vistos.add(r.uid);
      if (r.etag === p.etag) continue; // nada cambió afuera: manda lo tuyo
      const remotoMas = (r.modificado || now) > new Date(p.local_editado).getTime();
      if (remotoMas) {
        await conflicto(q, "evento", r.uid, r.title, "remoto", { title: p.title, start: +p.starts_at, end: +p.ends_at });
        await q.query("DELETE FROM calendar_events WHERE calendar_id=$1 AND uid=$2", [cal.id, r.uid]);
        await cancelarCola(q, "evento", "datos->>'uid'=$2", r.uid);
      } else {
        await conflicto(q, "evento", r.uid, p.title, "local", { title: r.title, start: r.starts_at, end: r.ends_at });
        await q.query("UPDATE calendar_events SET etag=$3 WHERE calendar_id=$1 AND uid=$2", [cal.id, r.uid, r.etag]);
        continue;
      }
    }
    await q.query(
      `INSERT INTO calendar_events(calendar_id,uid,starts_at,ends_at,title,all_day,href,etag,recurrente,remoto_editado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
      [cal.id, String(r.uid).slice(0, 500), new Date(r.starts_at), new Date(r.ends_at), String(r.title).slice(0, 300), !!r.all_day, r.href || null, r.etag || null, !!r.recurrente, r.modificado ? new Date(r.modificado) : null],
    );
  }
  for (const p of locales) if (!vistos.has(p.uid)) {
    // Lo borraron afuera mientras lo editabas: gana el borrado.
    await conflicto(q, "evento", p.uid, p.title, "remoto", { title: p.title, start: +p.starts_at, end: +p.ends_at, borrado_afuera: true });
    await q.query("DELETE FROM calendar_events WHERE calendar_id=$1 AND uid=$2", [cal.id, p.uid]);
    await cancelarCola(q, "evento", "datos->>'uid'=$2", p.uid);
  }
}

// ---------- Calendario «Plan»: sus eventos son tus bloques ----------
export async function conciliarBloques(q, cal, remotos, now) {
  const bloques = (await q.query("SELECT * FROM blocks WHERE calendar_id=$1 AND remote_uid IS NOT NULL", [cal.id])).rows;
  const porUid = new Map(bloques.map((b) => [b.remote_uid, b]));
  const pendientes = new Set((await q.query("SELECT ref FROM outbox WHERE kind='bloque' AND status<>'ok'")).rows.map((r) => r.ref));
  const vistos = new Set();
  for (const r of remotos) {
    if (r.recurrente || r.all_day) continue;
    vistos.add(r.uid);
    const b = porUid.get(r.uid);
    if (!b) {
      await q.query(
        "INSERT INTO blocks(title,starts_at,ends_at,origin,calendar_id,remote_uid,href,etag) VALUES ($1,$2,$3,'manual',$4,$5,$6,$7) ON CONFLICT DO NOTHING",
        [String(r.title).slice(0, 300), new Date(r.starts_at), new Date(r.ends_at), cal.id, r.uid, r.href, r.etag],
      );
      continue;
    }
    if (b.borrado || r.etag === b.etag) continue;
    if (pendientes.has(b.id)) {
      const remotoMas = (r.modificado || now) > new Date(b.actualizado).getTime();
      if (remotoMas) {
        await conflicto(q, "bloque", b.id, b.title, "remoto", { title: b.title, start: +b.starts_at, end: +b.ends_at });
        await cancelarCola(q, "bloque", "ref=$2", b.id);
      } else {
        await conflicto(q, "bloque", b.id, b.title, "local", { title: r.title, start: r.starts_at, end: r.ends_at });
        await q.query("UPDATE blocks SET etag=$2 WHERE id=$1", [b.id, r.etag]);
        continue;
      }
    }
    await q.query("UPDATE blocks SET title=$2, starts_at=$3, ends_at=$4, etag=$5, href=$6, actualizado=now() WHERE id=$1",
      [b.id, String(r.title).slice(0, 300), new Date(r.starts_at), new Date(r.ends_at), r.etag, r.href]);
    if (+b.starts_at !== r.starts_at || +b.ends_at !== r.ends_at) await enqueueFlujo(q, { bloqueId: b.id });
  }
  const desde = now - VENTANA.atras, hasta = now + VENTANA.adelante;
  for (const b of bloques) {
    if (vistos.has(b.remote_uid) || b.borrado || pendientes.has(b.id)) continue;
    if (+b.starts_at < desde || +b.starts_at > hasta) continue;
    await q.query("UPDATE blocks SET borrado=now() WHERE id=$1", [b.id]); // a la papelera, 30 días
    await enqueueFlujo(q, { bloqueId: b.id });
  }
}

// ---------- Notas: casillas = gestiones ----------
export async function conciliarNota(q, cuenta, nota, tareas) {
  const ids = [];
  for (const t of tareas) {
    ids.push(t.ext_id);
    const prev = (await q.query("SELECT * FROM items WHERE cuenta_id=$1 AND ext_id=$2", [cuenta.id, t.ext_id])).rows[0];
    const status = t.hecha ? "hecha" : "pendiente";
    if (!prev) {
      await q.query(
        `INSERT INTO items(kind,title,status,due_date,fuente,cuenta_id,ext_id,nota_ref,nota_titulo) VALUES ('tarea',$1,$2,$3,$4,$5,$6,$7,$8)`,
        [t.titulo, status, t.fecha, cuenta.tipo, cuenta.id, t.ext_id, nota.ref, nota.titulo],
      );
      continue;
    }
    const pend = (await q.query("SELECT 1 FROM outbox WHERE kind='gestion' AND ref=$1 AND status<>'ok'", [prev.id])).rowCount;
    const nuevoStatus = pend ? prev.status : t.hecha ? "hecha" : ["hecha", "archivada"].includes(prev.status) ? "pendiente" : prev.status;
    await q.query("UPDATE items SET title=$2, due_date=$3, nota_ref=$4, nota_titulo=$5, status=$6, updated_at=now() WHERE id=$1",
      [prev.id, t.titulo, t.fecha, nota.ref, nota.titulo, nuevoStatus]);
  }
  // Casillas que ya no están en esa nota: se archivan.
  await q.query(
    "UPDATE items SET status='archivada', updated_at=now() WHERE cuenta_id=$1 AND nota_ref=$2 AND status<>'archivada' AND NOT (ext_id = ANY($3::text[]))",
    [cuenta.id, nota.ref, ids],
  );
  await q.query(
    `INSERT INTO notas_estado(cuenta_id,ref,titulo,version,abiertas) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (cuenta_id,ref) DO UPDATE SET titulo=$3, version=$4, abiertas=$5, visto=now()`,
    [cuenta.id, nota.ref, nota.titulo, nota.version, tareas.filter((t) => !t.hecha).length],
  );
}

// ---------- Base «Flujo» de Notion: cada fila es un ítem; con hora agendada, un bloque en tu calendario ----------
const STATUS = { Bandeja: "pendiente", Idea: "pendiente", "Por hacer": "pendiente", Agendada: "pendiente", "En curso": "en curso", Hecha: "hecha", Archivada: "archivada" };
// Concilia una tarea externa (Notion/Markdown) con la local.
export async function conciliarFila(q, cuenta, r) {
  const prev = (await q.query("SELECT * FROM items WHERE cuenta_id=$1 AND ext_id=$2", [cuenta.id, r.id])).rows[0];
  const pend = prev ? (await q.query("SELECT 1 FROM outbox WHERE kind='gestion' AND ref=$1 AND status<>'ok'", [prev.id])).rowCount > 0 : false;
  const etapa = r.archivada ? "Archivada" : r.etapa;
  const est = Math.max(5, Math.min(1440, Math.round(r.dur || prev?.est_min || 30)));
  const conHora = !!r.agendar?.conHora;
  const due = r.agendar && !conHora ? r.agendar.start.slice(0, 10) : null;
  const proyectoId = r.proyecto ? (await q.query("SELECT ref FROM notion_espejo WHERE base='proyectos' AND replace(page_id,'-','')=$1", [r.proyecto.replace(/-/g, "")])).rows[0]?.ref || null : null;
  let item = prev;
  if (!prev) {
    item = (await q.query(
      `INSERT INTO items(kind,title,status,est_min,due_date,fuente,cuenta_id,ext_id,nota_ref,nota_titulo,tipo_nota,etapa,agendable,proyecto_id)
       VALUES ('tarea',$1,$2,$3,$4,'notion',$5,$6,'flujo',$7,$7,$8,$9,$10) RETURNING *`,
      [r.titulo.slice(0, 300), STATUS[etapa], est, due, cuenta.id, r.id, r.tipo, etapa, etapa === "Por hacer" && !conHora, proyectoId])).rows[0];
  } else if (pend) {
    await q.query("UPDATE items SET title=$2, est_min=$3, nota_titulo=$4, tipo_nota=$4, updated_at=now() WHERE id=$1", [prev.id, r.titulo.slice(0, 300), est, r.tipo]);
    return;
  } else {
    item = (await q.query(
      `UPDATE items SET title=$2, status=$3, est_min=$4, due_date=$5, nota_titulo=$6, tipo_nota=$6, etapa=$7, agendable=$8, proyecto_id=COALESCE($9, proyecto_id), updated_at=now() WHERE id=$1 RETURNING *`,
      [prev.id, r.titulo.slice(0, 300), STATUS[etapa], est, due, r.tipo, etapa, etapa === "Por hacer" && !conHora, proyectoId])).rows[0];
  }
  const bloque = item.bloque_id ? (await q.query("SELECT * FROM blocks WHERE id=$1 AND borrado IS NULL", [item.bloque_id])).rows[0] : null;
  if (conHora && etapa !== "Archivada") {
    const a = Date.parse(r.agendar.start), z = r.agendar.end ? Date.parse(r.agendar.end) : a + est * 60000;
    if (!(a < z)) return;
    if (bloque) {
      if (+bloque.starts_at !== a || +bloque.ends_at !== z || bloque.title !== item.title) {
        await q.query("UPDATE blocks SET title=$2, starts_at=$3, ends_at=$4, actualizado=now() WHERE id=$1", [bloque.id, item.title, new Date(a), new Date(z)]);
        await enqueue(q, "bloque", bloque.id);
      }
    } else {
      const b = (await q.query("INSERT INTO blocks(item_id,title,starts_at,ends_at,origin) VALUES ($1,$2,$3,$4,'manual') RETURNING id", [item.id, item.title, new Date(a), new Date(z)])).rows[0];
      await q.query("UPDATE items SET bloque_id=$2 WHERE id=$1", [item.id, b.id]);
      await enqueue(q, "bloque", b.id);
    }
  } else if (bloque && (!r.agendar || etapa === "Archivada") && +bloque.ends_at > Date.now()) {
    // Le quitaste la hora en Notion: el bloque futuro sale del calendario.
    await q.query("UPDATE blocks SET borrado=now(), actualizado=now() WHERE id=$1", [bloque.id]);
    await q.query("UPDATE items SET bloque_id=NULL WHERE id=$1", [item.id]);
    await enqueue(q, "bloque", bloque.id);
  }
}

// Trae tareas de Markdown o Notion de una cuenta.
async function pullNotas(pool, cuenta, cfg, guardar, o) {
  if (cuenta.tipo === "markdown") {
    await markdown.verificar(cfg);
    const archivos = await markdown.listar(cfg);
    const vistos = new Map((await pool.query("SELECT ref, version FROM notas_estado WHERE cuenta_id=$1", [cuenta.id])).rows.map((r) => [r.ref, r.version]));
    for (const a of archivos) {
      if (vistos.get(a.ref) === a.version) continue;
      const t = await markdown.leer(cfg, a.ref);
      if (!t.length && !vistos.has(a.ref)) continue;
      await withTx(pool, (q) => conciliarNota(q, cuenta, a, t));
    }
    const actuales = new Set(archivos.map((a) => a.ref));
    for (const ref of vistos.keys()) if (!actuales.has(ref)) await withTx(pool, (q) => conciliarNota(q, cuenta, { ref, titulo: "", version: "borrada" }, []));
  } else if (cuenta.tipo === "notion") {
    const n = o.notionClient || notion.cliente(cfg, o.fetcher === fetch ? undefined : o.fetcher);
    if (!cfg.flujo) { cfg.flujo = await notion.crearFlujo(cfg, n); await guardar(cfg); }
    const filas = await notion.leerFlujo(cfg, cfg.cursor_flujo || null, n);
    for (const f of filas) await withTx(pool, (q) => conciliarFila(q, cuenta, f));
    if (filas.length && filas.at(-1).editado !== cfg.cursor_flujo) { cfg.cursor_flujo = filas.at(-1).editado; await guardar(cfg); }
    if (cfg.espejo?.bases) {
      const r = await espejo.publicar(pool, n, cfg.espejo.bases, { tz: o.tz });
      if (r.hechos) await log(pool, "notion.espejo", `${r.hechos} filas al día en las 9 bases`);
    }
    const desde = cfg.cursor || null;
    const pags = await notion.cambiadas(cfg, desde, n);
    for (const p of pags) {
      const t = await notion.leer(cfg, p.ref, n);
      const ya = (await pool.query("SELECT 1 FROM notas_estado WHERE cuenta_id=$1 AND ref=$2", [cuenta.id, p.ref])).rowCount;
      if (!t.length && !ya) continue;
      await withTx(pool, (q) => conciliarNota(q, cuenta, p, t));
    }
    if (pags.length) { cfg.cursor = pags[0].version; await guardar(cfg); }
  }
}

// Transacción con conexión propia.
async function withTx(pool, fn) {
  const c = await pool.connect();
  try { await c.query("BEGIN"); const r = await fn(c); await c.query("COMMIT"); return r; }
  catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { c.release(); }
}

// ---------- Traer ----------
export async function traer(pool, cuenta, { tz, now = Date.now(), fetcher = fetch, notionClient } = {}) {
  const { cfg, guardar } = await cuentaConfig(pool, cuenta);
  const o = { fetcher, tz, onConfig: guardar, notionClient };
  if (CALENDARIO[cuenta.tipo]) {
    const A = CALENDARIO[cuenta.tipo];
    // Calendarios nuevos o borrados en la cuenta.
    const lista = (await A.listCalendars(cfg, o)).calendarios;
    for (const c of lista)
      await pool.query(
        `INSERT INTO calendars(name, cuenta_id, remote_id, color, editable, rol) VALUES ($1,$2,$3,$4,$5,'leer')
         ON CONFLICT (cuenta_id, remote_id) WHERE cuenta_id IS NOT NULL DO UPDATE SET name=$1, color=COALESCE($4, calendars.color), editable=$5`,
        [String(c.nombre).slice(0, 120), cuenta.id, c.remote_id, c.color, !!c.editable]);
    if (lista.length) await pool.query("DELETE FROM calendars WHERE cuenta_id=$1 AND NOT (remote_id = ANY($2::text[]))", [cuenta.id, lista.map((c) => c.remote_id)]);
    const cals = (await pool.query("SELECT * FROM calendars WHERE cuenta_id=$1 AND rol IN ('leer','plan')", [cuenta.id])).rows;
    for (const cal of cals) {
      const remotos = await A.pull(cfg, cal.remote_id, now - VENTANA.atras, now + VENTANA.adelante, tz, o);
      await withTx(pool, (q) => (cal.rol === "plan" ? conciliarBloques(q, cal, remotos, now) : conciliarEventos(q, cal, remotos, now)));
      await pool.query("UPDATE calendars SET last_ok_at=now(), last_error='' WHERE id=$1", [cal.id]);
    }
  } else {
    await pullNotas(pool, cuenta, cfg, guardar, o);
  }
}

// ---------- Despachar la cola ----------
const backoff = (n) => Math.min(30_000 * 2 ** (n - 1), 3_600_000);

// Calendario con un rol (plan/registrado) y su cuenta.
async function calendarioCon(pool, rol) {
  const r = await pool.query(
    "SELECT c.*, k.tipo, k.config, k.id AS cuenta FROM calendars c JOIN cuentas k ON k.id=c.cuenta_id WHERE c.rol=$1 AND k.activa ORDER BY c.created_at LIMIT 1", [rol]);
  return r.rows[0] || null;
}

// Envía un trabajo de la cola a su destino (calendario, notas).
async function despacharUno(pool, job, o) {
  const conCfg = async (cuentaRow) => {
    const { cfg, guardar } = await cuentaConfig(pool, cuentaRow);
    return { cfg, opts: { ...o, onConfig: guardar } };
  };
  if (job.kind === "bloque") {
    const b = (await pool.query("SELECT * FROM blocks WHERE id=$1", [job.ref])).rows[0];
    if (!b) return;
    const cal = b.calendar_id
      ? (await pool.query("SELECT c.*, k.tipo, k.config, k.id AS cuenta FROM calendars c JOIN cuentas k ON k.id=c.cuenta_id WHERE c.id=$1", [b.calendar_id])).rows[0]
      : await calendarioCon(pool, "plan");
    if (!cal) return; // sin calendario de plan: el bloque vive solo aquí
    const A = CALENDARIO[cal.tipo];
    const { cfg, opts } = await conCfg({ id: cal.cuenta, config: cal.config });
    if (b.borrado) {
      if (b.href) await A.remove(cfg, b.href, b.etag, opts);
      return;
    }
    const ev = { uid: b.remote_uid || undefined, title: b.title, start: +b.starts_at, end: +b.ends_at, descripcion: "Planificado en Veredicto" };
    const r = await A.put(cfg, cal.remote_id, ev, b.href ? { href: b.href, etag: b.etag } : {}, opts);
    await pool.query("UPDATE blocks SET calendar_id=$2, remote_uid=$3, href=$4, etag=$5 WHERE id=$1", [b.id, cal.id, r.uid, r.href, r.etag]);
  } else if (job.kind === "evento") {
    const e = (await pool.query(
      "SELECT e.*, c.remote_id, k.tipo, k.config, k.id AS cuenta FROM calendar_events e JOIN calendars c ON c.id=e.calendar_id JOIN cuentas k ON k.id=c.cuenta_id WHERE e.calendar_id=$1 AND e.uid=$2 AND e.local_editado IS NOT NULL",
      [job.datos.calendar_id, job.datos.uid])).rows[0];
    if (!e) return;
    const A = CALENDARIO[e.tipo];
    const { cfg, opts } = await conCfg({ id: e.cuenta, config: e.config });
    const r = await A.patch(cfg, e.href, e.etag, { title: e.title, start: +e.starts_at, end: +e.ends_at }, opts);
    await pool.query("UPDATE calendar_events SET etag=$3, local_editado=NULL WHERE calendar_id=$1 AND uid=$2", [e.calendar_id, e.uid, r.etag]);
  } else if (job.kind === "sesion_cal" && job.datos?.borrar) {
    // Borraste un registro en la app: sale también de «Veredicto · Registrado».
    const ref = job.datos.borrar;
    const cal = (await pool.query("SELECT c.*, k.tipo, k.config, k.id AS cuenta FROM calendars c JOIN cuentas k ON k.id=c.cuenta_id WHERE c.id=$1", [ref.calendar_id])).rows[0];
    if (!cal) return;
    const { cfg, opts } = await conCfg({ id: cal.cuenta, config: cal.config });
    await CALENDARIO[cal.tipo].remove(cfg, ref.href, ref.etag, opts);
  } else if (job.kind === "sesion_cal") {
    const s = (await pool.query("SELECT * FROM sessions WHERE id=$1 AND state='done'", [job.ref])).rows[0];
    if (!s) return;
    const cal = await calendarioCon(pool, "registrado");
    if (!cal) return;
    const A = CALENDARIO[cal.tipo];
    const { cfg, opts } = await conCfg({ id: cal.cuenta, config: cal.config });
    const prev = s.cal_ref || {};
    const r = await A.put(cfg, cal.remote_id, { uid: prev.uid, title: `✓ ${s.title}`, start: +s.started_at, end: +s.ended_at, descripcion: `Registrado en Veredicto (${s.source})` }, prev.href ? prev : {}, opts);
    await pool.query("UPDATE sessions SET cal_ref=$2 WHERE id=$1", [s.id, JSON.stringify({ calendar_id: cal.id, ...r })]);
  } else if (job.kind === "gestion") {
    const it = (await pool.query("SELECT i.*, k.tipo, k.config FROM items i JOIN cuentas k ON k.id=i.cuenta_id WHERE i.id=$1", [job.ref])).rows[0];
    if (!it || !it.ext_id) return;
    const { cfg, opts } = await conCfg({ id: it.cuenta_id, config: it.config });
    const hecha = it.status === "hecha";
    if (it.tipo === "notion" && it.nota_ref === "flujo") {
      const n = o.notionClient || notion.cliente(cfg);
      const b = it.bloque_id ? (await pool.query("SELECT * FROM blocks WHERE id=$1 AND borrado IS NULL", [it.bloque_id])).rows[0] : null;
      const t = (await pool.query(
        `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (g.ended_at-g.started_at))),0)::float/60 AS min, max(s.ended_at) AS ultima
         FROM sessions s JOIN segments g ON g.session_id=s.id WHERE s.item_id=$1 AND s.state='done'`, [it.id])).rows[0];
      const etapa = { hecha: "Hecha", archivada: "Archivada", "en curso": "En curso" }[it.status] || (b ? "Agendada" : it.etapa === "Agendada" || it.etapa === "En curso" ? "Por hacer" : it.etapa || "Por hacer");
      await notion.escribirFila(cfg, it.ext_id, {
        etapa, minutos: t.min, ultima: t.ultima ? new Date(t.ultima).toISOString() : null,
        agendar: b ? { start: new Date(b.starts_at).toISOString(), end: new Date(b.ends_at).toISOString() } : it.etapa === "Agendada" ? null : undefined,
      }, n);
      await pool.query("UPDATE items SET etapa=$2 WHERE id=$1", [it.id, etapa]);
      return;
    }
    if (it.tipo === "markdown") await markdown.marcar(cfg, it.nota_ref, it.ext_id, hecha, { hoy: dayKey(Date.now(), o.tz) });
    else if (it.tipo === "notion") await notion.marcar(cfg, it.ext_id, hecha, o.notionClient || notion.cliente(cfg));
    void opts;
  } else if (job.kind === "bandeja") {
    const c = (await pool.query("SELECT * FROM captures WHERE id=$1", [job.ref])).rows[0];
    if (!c || c.status === "procesada") return;
    const destino = await getSetting(pool, "bandeja_cuenta");
    const cuenta = destino && (await pool.query("SELECT * FROM cuentas WHERE id=$1 AND activa AND tipo IN ('markdown','notion')", [destino])).rows[0];
    if (!cuenta) return; // sin notas conectadas: queda en la bandeja de la app
    const { cfg, opts } = await conCfg(cuenta);
    const texto = [c.text, c.body].filter(Boolean).join("\n");
    if (cuenta.tipo === "markdown") await markdown.bandeja(cfg, texto, { dia: dayKey(+c.created_at, o.tz), casilla: c.kind !== "nota" });
    else if (cfg.flujo) await notion.nuevaFila(cfg, texto, { tipo: c.kind === "nota" ? "Nota" : "Idea", etapa: "Bandeja" }, o.notionClient || notion.cliente(cfg));
    else await notion.bandeja(cfg, texto, { onConfig: opts.onConfig }, o.notionClient || notion.cliente(cfg));
    await pool.query("UPDATE captures SET status='procesada', updated_at=now() WHERE id=$1", [c.id]);
  }
}

// Envía los trabajos pendientes de la cola.
export async function despachar(pool, o = {}, { limit = 50 } = {}) {
  const jobs = (await pool.query(
    "SELECT * FROM outbox WHERE status<>'ok' AND next_at<=now() AND kind IN ('bloque','evento','sesion_cal','gestion','bandeja') ORDER BY id LIMIT $1", [limit])).rows;
  // Los tipos antiguos (copia a Notion de una sola vía) ya no se usan.
  await pool.query("UPDATE outbox SET status='ok', done_at=now(), last_error='reemplazado por la sincronización en dos sentidos' WHERE status<>'ok' AND kind IN ('item','session','capture')");
  let ok = 0, err = 0;
  for (const j of jobs) {
    try {
      await despacharUno(pool, j, o);
      await pool.query("UPDATE outbox SET status='ok', attempts=attempts+1, last_error='', done_at=now() WHERE id=$1", [j.id]);
      ok++;
    } catch (e) {
      err++;
      const terminal = e.borrado;
      await pool.query(
        "UPDATE outbox SET status=$5, attempts=attempts+1, last_error=$3, next_at=now() + ($4 || ' milliseconds')::interval, done_at=CASE WHEN $5='ok' THEN now() END WHERE id=$1",
        [j.id, j.attempts + 1, String(e.message || e).slice(0, 300), String(backoff(j.attempts + 1)), terminal ? "ok" : "error"],
      );
    }
  }
  return { ok, err };
}

// ---------- Una pasada completa ----------
// Todo pasa en serie: nunca dos despachos a la vez sobre la misma cola.
let cola = Promise.resolve();
// Encola trabajos para que corran de a uno.
const enSerie = (fn) => { const p = cola.then(fn, fn); cola = p.catch(() => {}); return p; };

// Solo empujar la cola (rápido, tras cada cambio en la app).
export const empujar = (pool, o = {}) => enSerie(() => despachar(pool, o));

let enCurso = null;
// Pasada completa: traer de cuentas, conciliar y empujar la cola.
export function sincronizar(pool, o = {}) {
  if (enCurso) return enCurso;
  enCurso = enSerie(async () => {
    const now = o.now || Date.now();
    const res = { cuentas: [], cola: null };
    const cuentas = (await pool.query("SELECT * FROM cuentas WHERE activa ORDER BY creada")).rows.filter((c) => !o.cuentaId || c.id === o.cuentaId);
    for (const c of cuentas) {
      try {
        await traer(pool, c, { ...o, now });
        await pool.query("UPDATE cuentas SET ultimo_ok=now(), ultimo_error='', error_desde=NULL WHERE id=$1", [c.id]);
        res.cuentas.push({ id: c.id, ok: true });
      } catch (e) {
        const msg = String(e.message || e).slice(0, 300);
        await pool.query("UPDATE cuentas SET ultimo_error=$2, error_desde=COALESCE(error_desde, now()) WHERE id=$1", [c.id, msg]);
        await log(pool, "sync.error", `${c.nombre}: ${msg}`);
        res.cuentas.push({ id: c.id, ok: false, error: msg });
      }
    }
    res.cola = await despachar(pool, o);
    await pool.query("DELETE FROM blocks WHERE borrado < now() - interval '30 days'");
    await pool.query("DELETE FROM outbox WHERE status='ok' AND done_at < now() - interval '14 days'");
    return res;
  }).finally(() => { enCurso = null; });
  return enCurso;
}
