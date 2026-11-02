// Piezas compartidas por la app, los atajos y las tareas programadas.
import { EventEmitter } from "node:events";
import { tx, getSetting, setSetting, log } from "./db.js";
import { addBlock } from "./core.js";
import { agendaRange, sessionsForHabits } from "./estado.js";
import { habits, armarDia } from "./plan.js";
import { startOfDay, addDays, dayKey, fmtHora, minuteOfDay, hhmmToMin } from "./time.js";
import { enviar } from "./conectores/avisos.js";
import { DEFAULTS } from "./vigilante.js";

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
  const hab = habits(await sessionsForHabits(pool, now), now, tz);
  const plan = armarDia(hab, rutinas, ocupado, now, tz);
  if (!aplicar || !plan.length) return { plan, creados: 0 };
  await tx(pool, async (q) => {
    for (const p of plan) await addBlock(q, { itemId: p.item_id, title: p.title, starts_at: p.starts_at, ends_at: p.ends_at, origin: "auto" });
    await log(q, "dia.armado", `${plan.length} bloques`);
  });
  changed();
  return { plan, creados: plan.length };
}

// Cada mañana, al inicio de tu horario: arma el día solo y te manda el resumen.
export async function armadoMatinal(pool, tz, { publicUrl, now = Date.now(), send = enviar } = {}) {
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
  await send(cfg.canales, {
    titulo: "Tu día ya está armado", prioridad: 3,
    mensaje: lineas.join("\n"), abrir: publicUrl ? publicUrl.replace(/\/$/, "") + "/" : undefined, acciones: [],
  });
  return r;
}
