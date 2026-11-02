// Piezas compartidas por la app, los atajos y las tareas programadas.
import { EventEmitter } from "node:events";
import { tx, getSetting, setSetting, log } from "./db.js";
import { addBlock } from "./core.js";
import { agendaRange } from "./estado.js";
import { armarDia } from "./plan.js";
import { getPrediccion, habitosConModo, paraAgendar, rutinasPermitidas } from "./prediccion.js";
import { startOfDay, addDays, dayKey, fmtHora, minuteOfDay, hhmmToMin } from "./time.js";
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
  if (!aplicar || !plan.length) return { plan, creados: 0 };
  await tx(pool, async (q) => {
    for (const p of plan) await addBlock(q, { itemId: p.item_id, title: p.title, starts_at: p.starts_at, ends_at: p.ends_at, origin: "auto" });
    await log(q, "dia.armado", `${plan.length} bloques`);
  });
  changed();
  return { plan, creados: plan.length };
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
