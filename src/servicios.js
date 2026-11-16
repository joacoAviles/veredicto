// Piezas compartidas por la app, los atajos y las tareas programadas.
import { EventEmitter } from "node:events";
import { tx, getSetting, setSetting, log } from "./db.js";
import { addBlock, enqueueFlujo } from "./core.js";
import { agendaRange } from "./estado.js";
import { armarDia } from "./plan.js";
import { getPrediccion, habitosConModo, paraAgendar, rutinasPermitidas } from "./prediccion.js";
import { startOfDay, addDays, dayKey, fmtHora, minuteOfDay, hhmmToMin, atMinute } from "./time.js";
import { enviar } from "./conectores/avisos.js";
import { DEFAULTS, construirAviso, entregar } from "./vigilante.js";
import { loadPlantillas } from "./plantillas.js";

// Avisa a las pantallas abiertas que algo cambió (Server-Sent Events).
export const bus = new EventEmitter();
bus.setMaxListeners(200);
export const changed = (what = "estado") => bus.emit("cambio", what);

// Propone (o crea) los bloques del día según tus hábitos y rutinas, sin pisar tu calendario.
export async function armarHoy(pool, tz, { aplicar = false, now = Date.now() } = {}) {
  const day = startOfDay(now, tz), tomorrow = addDays(day, 1, tz);
  const agenda = await agendaRange(pool, day, tomorrow);
  const ocupado = [
    ...agenda.blocks.map((b) => ({ start: b.start, end: b.end })),
    ...agenda.events.filter((e) => !e.all_day).map((e) => ({ start: e.start, end: e.end })),
  ];
  const rutinas = (await pool.query("SELECT * FROM items WHERE kind='rutina' AND status <> 'archivada'")).rows
    .map((r) => ({ ...r, hora: r.hora ? String(r.hora).slice(0, 5) : null }));
  const pred = await getPrediccion(pool);
  const hab = await habitosConModo(pool, now, tz, pred);
  const plan = armarDia(paraAgendar(hab), rutinasPermitidas(rutinas, pred, "agendar"), ocupado, now, tz);
  // Lo que marcaste «Por hacer» (en Notion o en la app) entra en los huecos libres de tu horario.
  const cfgAv = { ...DEFAULTS, ...(await getSetting(pool, "avisos", {})) };
  const pendientes = (await pool.query(
    "SELECT * FROM items WHERE agendable AND status='pendiente' AND bloque_id IS NULL ORDER BY due_date NULLS LAST, created_at LIMIT 20")).rows;
  plan.push(...enHuecos(pendientes, [...ocupado, ...plan.map((p) => ({ start: p.starts_at, end: p.ends_at }))], now, tz, cfgAv));
  plan.sort((a, b) => a.starts_at - b.starts_at);
  if (!aplicar || !plan.length) return { plan, creados: 0 };
  await tx(pool, async (q) => {
    for (const p of plan) {
      const b = await addBlock(q, { itemId: p.item_id, title: p.title, starts_at: p.starts_at, ends_at: p.ends_at, origin: "auto" });
      if (p.hueco) {
        await q.query("UPDATE items SET bloque_id=$2, agendable=false, etapa=CASE WHEN nota_ref='flujo' THEN 'Agendada' ELSE etapa END WHERE id=$1", [p.item_id, b.id]);
        await enqueueFlujo(q, { itemId: p.item_id });
      }
    }
    await log(q, "dia.armado", `${plan.length} bloques`);
  });
  changed();
  return { plan, creados: plan.length };
}

// Ubica cada pendiente en el primer hueco libre (pasos de 15 min) dentro de tu horario de hoy.
export function enHuecos(items, ocupado, now, tz, { desde = "08:00", hasta = "23:30" } = {}) {
  const day = startOfDay(now, tz), Q = 15 * 60000;
  const a = hhmmToMin(desde), z = hhmmToMin(hasta);
  let cursor = Math.max(Math.ceil(now / Q) * Q, atMinute(day, a, tz));
  const fin = z > a ? atMinute(day, z, tz) : addDays(day, 1, tz);
  const busy = [...ocupado];
  const out = [];
  for (const it of items) {
    const dur = Math.max(15, it.est_min || 30) * 60000;
    for (let t = cursor; t + dur <= fin; t += Q) {
      if (busy.some((b) => b.start < t + dur && b.end > t)) continue;
      busy.push({ start: t, end: t + dur });
      out.push({ item_id: it.id, title: it.title, starts_at: t, ends_at: t + dur, motivo: it.nota_ref === "flujo" ? `${it.tipo_nota || "Idea"} por hacer en Notion` : "pendiente por hacer", hueco: true });
      break;
    }
  }
  return out;
}

// Cada mañana, al inicio de tu horario: arma el día solo y te manda el resumen (plantilla "armado").
export async function armadoMatinal(pool, tz, { publicUrl, themeDir, now = Date.now(), send = enviar } = {}) {
  const cfg = { ...DEFAULTS, ...(await getSetting(pool, "avisos", {})) };
  if (cfg.armar_solo === false) return null;
  const hoy = dayKey(now, tz);
  if ((await getSetting(pool, "armado_matinal")) === hoy) return null;
  const m = minuteOfDay(now, tz), desde = hhmmToMin(cfg.desde);
  if (m < desde || m > desde + 120) return null;
  await setSetting(pool, "armado_matinal", hoy);
  const r = await armarHoy(pool, tz, { aplicar: true, now });
  const agenda = await agendaRange(pool, now, addDays(startOfDay(now, tz), 1, tz));
  const lineas = [...agenda.blocks, ...agenda.events.filter((e) => !e.all_day)]
    .sort((a, b) => a.start - b.start).slice(0, 8).map((x) => `${fmtHora(x.start, tz)} ${x.title}`);
  if (!lineas.length) return r;
  const plantillas = await loadPlantillas(pool, themeDir);
  const aviso = construirAviso(plantillas, "armado", { agenda: lineas.join("\n"), bloques: String(r.creados) }, {});
  if (aviso) await entregar(pool, cfg, aviso, { publicUrl, plantillas, send });
  return r;
}
