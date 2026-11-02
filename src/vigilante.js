// El vigilante: mira el servidor (la única verdad) cada minuto y reclama si no estás registrando nada.
// Si tienes algo agendado ahora, el aviso lo nombra y trae el botón para iniciarlo con un toque.
import { getSetting, setSetting } from "./db.js";
import { currentSession, agendaRange, sessionsForHabits } from "./estado.js";
import { habits, sugerencias } from "./plan.js";
import { minuteOfDay, hhmmToMin, startOfDay, addDays, atMinute, fmtHora, fmtDur } from "./time.js";
import { enviar } from "./conectores/avisos.js";
import { signAction, secret } from "./auth.js";

export const DEFAULTS = { activo: true, desde: "08:00", hasta: "23:30", niveles: [10, 30, 60], repetir: 10, canales: {} };

export function inWindow(m, desde, hasta) {
  const a = hhmmToMin(desde), b = hhmmToMin(hasta);
  return a <= b ? m >= a && m < b : m >= a || m < b;
}

// Inicio de la ventana de hoy (o de ayer si la ventana cruza medianoche y estamos de madrugada).
export function windowStart(now, tz, desde, hasta) {
  const day = startOfDay(now, tz), a = hhmmToMin(desde), b = hhmmToMin(hasta), m = minuteOfDay(now, tz);
  if (a > b && m < b) return atMinute(addDays(day, -1, tz), a, tz);
  return atMinute(day, a, tz);
}

const hayCanal = (c) => !!(c?.ntfy?.topic || (c?.telegram?.token && c?.telegram?.chat) || c?.webhook?.url);

// Decisión pura (sin red ni base): fácil de probar.
// ctx: { now, tz, cfg, st, current, idleSince, ahora: {tipo,id,title,start,end}|null, sugeridas: [{item_id,title}] }
export function decide(ctx) {
  const { now, tz, cfg, current, ahora } = ctx;
  const st = { nivel: 0, ultimo: 0, silencio_hasta: 0, bloques: [], ...ctx.st };
  const reset = { ...st, nivel: 0, ultimo: 0 };
  if (!cfg.activo || !hayCanal(cfg.canales)) return { aviso: null, st: reset, motivo: "apagado" };
  if (!inWindow(minuteOfDay(now, tz), cfg.desde, cfg.hasta)) return { aviso: null, st: reset, motivo: "fuera de horario" };
  if (current?.state === "running") return { aviso: null, st: reset, motivo: "registrando" };
  if (st.silencio_hasta > now) return { aviso: null, st, motivo: "silenciado" };

  // 1) Algo agendado que empezó y no lo iniciaste: un aviso específico, una vez por bloque.
  if (ahora && !st.bloques.includes(ahora.key)) {
    const st2 = { ...st, bloques: [...st.bloques.slice(-30), ahora.key], ultimo: now, nivel: Math.max(st.nivel, 1) };
    return {
      st: st2, motivo: "agendado",
      aviso: {
        tipo: "agendado", prioridad: 4,
        titulo: `Agendado: ${ahora.title}`,
        mensaje: `Desde las ${fmtHora(ahora.start, tz)} hasta las ${fmtHora(ahora.end, tz)}. ¿Lo inicio?`,
        acciones: [{ label: `▶ ${ahora.title}`, accion: "iniciar", datos: ahora.item_id ? { item_id: ahora.item_id } : { title: ahora.title } }],
      },
    };
  }

  // 2) Escalada por tiempo sin registrar.
  const idleMin = Math.floor((now - ctx.idleSince) / 60000);
  const niveles = cfg.niveles?.length ? cfg.niveles : DEFAULTS.niveles;
  let nivel = 0;
  niveles.forEach((n, i) => { if (idleMin >= n) nivel = i + 1; });
  if (!nivel) return { aviso: null, st: { ...st, nivel: 0 }, motivo: "todavía no" };
  const max = niveles.length;
  const repetir = (cfg.repetir || DEFAULTS.repetir) * 60000;
  const toca = nivel > st.nivel || (nivel === max && now - st.ultimo >= repetir);
  if (!toca) return { aviso: null, st, motivo: "esperando para repetir" };

  const texto = [
    null,
    { t: "¿Qué estás haciendo?", m: `Llevas ${fmtDur(now - ctx.idleSince)} sin registrar.`, p: 3 },
    { t: "Sigues sin registrar", m: `${fmtDur(now - ctx.idleSince)} en blanco. Elige algo, aunque sea "descanso".`, p: 4 },
    { t: "Juez del Tiempo: esto no se está midiendo", m: `${fmtDur(now - ctx.idleSince)} sin registro. Inicia algo ahora.`, p: 5 },
  ][Math.min(nivel, 3)];
  const opciones = [];
  if (ahora) opciones.push({ item_id: ahora.item_id, title: ahora.title });
  for (const s of ctx.sugeridas || []) if (!opciones.some((o) => o.title === s.title)) opciones.push(s);
  if (current?.state === "paused" && !opciones.some((o) => o.title === current.title)) opciones.unshift({ item_id: current.item_id, title: current.title, seguir: true });
  const acciones = opciones.slice(0, 2).map((o) => ({
    label: `${o.seguir ? "⏯" : "▶"} ${o.title}`, accion: o.seguir ? "seguir" : "iniciar",
    datos: o.item_id ? { item_id: o.item_id } : { title: o.title },
  }));
  acciones.push({ label: "Silenciar 1 h", accion: "silenciar", datos: { min: 60 } });
  return {
    st: { ...st, nivel, ultimo: now }, motivo: `nivel ${nivel}`,
    aviso: { tipo: "inactivo", nivel, prioridad: texto.p, titulo: texto.t, mensaje: texto.m, acciones },
  };
}

async function idleSince(q, current, now, tz, cfg) {
  let last = null;
  if (current?.state === "paused") last = Math.max(...current.segments.map((s) => s[1] || 0));
  const r = await q.query("SELECT max(ended_at) AS e FROM sessions WHERE state='done'");
  const e = r.rows[0].e ? new Date(r.rows[0].e).getTime() : 0;
  last = Math.max(last || 0, e);
  return Math.max(last, windowStart(now, tz, cfg.desde, cfg.hasta));
}

// Lo agendado que está ocurriendo ahora (bloques primero, luego eventos de calendario con hora).
export function agendadoAhora(agenda, now) {
  const b = agenda.blocks.find((x) => x.start <= now && x.end > now);
  if (b) return { key: `b:${b.id}`, item_id: b.item_id, title: b.title, start: b.start, end: b.end };
  const e = agenda.events.find((x) => !x.all_day && x.start <= now && x.end > now);
  if (e) return { key: `e:${e.uid}:${e.start}`, item_id: null, title: e.title, start: e.start, end: e.end };
  return null;
}

export async function vigilar(pool, { tz, publicUrl, now = Date.now(), send = enviar }) {
  const cfg = { ...DEFAULTS, ...(await getSetting(pool, "avisos", {})) };
  const st = await getSetting(pool, "vigilante", {});
  const current = await currentSession(pool);
  const agenda = await agendaRange(pool, now - 60_000, now + 60_000);
  const rutinas = (await pool.query("SELECT * FROM items WHERE kind='rutina' AND status <> 'archivada'")).rows;
  const hab = habits(await sessionsForHabits(pool, now), now, tz);
  const ctx = {
    now, tz, cfg, st, current,
    idleSince: await idleSince(pool, current, now, tz, cfg),
    ahora: agendadoAhora(agenda, now),
    sugeridas: sugerencias(hab, rutinas, now, tz),
  };
  const out = decide(ctx);
  await setSetting(pool, "vigilante", { ...out.st, motivo: out.motivo, revisado: now });
  if (!out.aviso) return out;
  const sec = await secret(pool);
  const base = (publicUrl || "").replace(/\/$/, "");
  const aviso = {
    ...out.aviso,
    abrir: base ? base + "/" : undefined,
    acciones: base ? out.aviso.acciones.map((a) => ({ label: a.label, url: `${base}/a/${signAction(sec, a.accion, a.datos)}` })) : [],
  };
  out.envio = await send(cfg.canales, aviso);
  await pool.query("INSERT INTO activity(kind, detail) VALUES ('aviso', $1)", [`${aviso.titulo} → ${out.envio.map((x) => x.canal + (x.ok ? " ok" : " ✗ " + x.error)).join(", ")}`.slice(0, 500)]);
  return out;
}
