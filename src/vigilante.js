// El vigilante: mira el servidor (la única verdad) cada minuto y avisa.
// Qué avisa y cómo suena lo deciden las plantillas (fábrica < equipo < tus ajustes).
import { getSetting, setSetting } from "./db.js";
import { currentSession, agendaRange } from "./estado.js";
import { sugerencias } from "./plan.js";
import { getPrediccion, habitosConModo, paraSugerir, rutinasPermitidas } from "./prediccion.js";
import { minuteOfDay, hhmmToMin, startOfDay, addDays, atMinute, fmtHora, fmtDur } from "./time.js";
import { enviar } from "./conectores/avisos.js";
import { signAction, secret } from "./auth.js";
import { merge, fill, loadPlantillas } from "./plantillas.js";

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
const msCorriendo = (c, now) => c.segments.reduce((a, [x, y]) => a + ((y || now) - x), 0);
const datosDe = (o) => (o.item_id ? { item_id: o.item_id } : { title: o.title });

// Convierte un evento + variables en un aviso usando su plantilla.
// op: { ahora, lista: [{item_id,title,seguir?}], current }
export function construirAviso(plantillas, key, vars, op = {}) {
  const P = plantillas || merge();
  const tpl = P.eventos[key];
  if (!tpl || tpl.activo === false) return null;
  const v = { nombre: "Veredicto", ...vars };
  const acciones = [];
  for (const a of tpl.acciones || []) {
    let x = null;
    if (a === "iniciar" && op.ahora) x = { label: `▶ ${op.ahora.title}`, accion: "iniciar", datos: datosDe(op.ahora) };
    if (a === "sugerencia1" || a === "sugerencia2") {
      const s = (op.lista || [])[a === "sugerencia1" ? 0 : 1];
      if (s) x = { label: `${s.seguir ? "⏯" : "▶"} ${s.title}`, accion: s.seguir ? "seguir" : "iniciar", datos: datosDe(s) };
    }
    if (a === "seguir" && op.current?.state === "paused") x = { label: `⏯ ${op.current.title}`, accion: "seguir", datos: {} };
    if (a === "parar" && op.current) x = { label: "■ Parar", accion: "parar", datos: {} };
    if (a === "silenciar30") x = { label: "Silenciar 30 min", accion: "silenciar", datos: { min: 30 } };
    if (a === "silenciar60") x = { label: "Silenciar 1 h", accion: "silenciar", datos: { min: 60 } };
    if (a === "armar") x = { label: "Armar mi día", accion: "armar", datos: {} };
    if (a === "abrir") x = { label: "Abrir", abrir: true };
    if (x && !acciones.some((y) => y.label === x.label)) acciones.push(x);
  }
  return {
    tipo: key, prioridad: tpl.prioridad || 3, tags: tpl.tags || "",
    titulo: `${P.global.prefijo || ""}${fill(tpl.titulo, v)}`.trim(),
    mensaje: fill(tpl.mensaje, v),
    acciones: acciones.slice(0, 3),
  };
}

// Decisión pura (sin red ni base).
// ctx: { now, tz, cfg, st, current, idleSince, ahora, proximo, estimadoMin, sugeridas, plantillas }
export function decide(ctx) {
  const { now, tz, cfg, current, ahora, proximo } = ctx;
  const P = ctx.plantillas || merge();
  const st = { nivel: 0, ultimo: 0, silencio_hasta: 0, bloques: [], previos: [], excedidos: [], ...ctx.st };
  const reset = { ...st, nivel: 0, ultimo: 0 };
  if (!cfg.activo || !hayCanal(cfg.canales)) return { aviso: null, st: reset, motivo: "apagado" };
  if (!inWindow(minuteOfDay(now, tz), cfg.desde, cfg.hasta)) return { aviso: null, st: reset, motivo: "fuera de horario" };
  if (st.silencio_hasta > now) return { aviso: null, st, motivo: "silenciado" };
  const corriendo = current?.state === "running";
  const lista = [];
  const add = (o) => { if (o && !lista.some((x) => x.title === o.title)) lista.push(o); };
  if (current?.state === "paused") add({ item_id: current.item_id, title: current.title, seguir: true });
  add(ahora);
  (ctx.sugeridas || []).forEach(add);
  const op = { ahora, lista, current };
  const emitir = (key, vars, st2, motivo, extra = {}) => {
    const aviso = construirAviso(P, key, vars, op);
    return aviso ? { aviso: { ...aviso, ...extra }, st: st2, motivo } : null;
  };

  // 1) Aviso previo: algo empieza en pocos minutos.
  if (proximo && P.eventos.previo.activo !== false && !st.previos.includes(proximo.key)) {
    const r = emitir("previo", { titulo: proximo.title, hora: fmtHora(proximo.start, tz), fin: fmtHora(proximo.end, tz), minutos: Math.max(1, Math.round((proximo.start - now) / 60000)) },
      { ...st, previos: [...st.previos.slice(-30), proximo.key] }, "previo", {});
    if (r) { r.aviso.acciones = construirAviso(P, "previo", {}, { ...op, ahora: proximo }).acciones; return r; }
  }

  // 2) Empezó algo agendado y no es lo que estás registrando.
  const distinto = !current || !corriendo || (ahora && current.title !== ahora.title && (!ahora.item_id || ahora.item_id !== current.item_id));
  if (ahora && distinto && !st.bloques.includes(ahora.key)) {
    const r = emitir("agendado", { titulo: ahora.title, hora: fmtHora(ahora.start, tz), fin: fmtHora(ahora.end, tz) },
      { ...st, bloques: [...st.bloques.slice(-30), ahora.key], ultimo: now, nivel: corriendo ? st.nivel : Math.max(st.nivel, 1) }, "agendado");
    if (r) return r;
  }

  // 3) Lo que corre ya pasó de lo estimado.
  if (corriendo) {
    const lleva = msCorriendo(current, now), factor = P.eventos.excedido.factor || 1.5;
    if (ctx.estimadoMin && lleva > ctx.estimadoMin * factor * 60000 && !st.excedidos.includes(current.id)) {
      const r = emitir("excedido", { titulo: current.title, lleva: fmtDur(lleva), estimado: fmtDur(ctx.estimadoMin * 60000) },
        { ...reset, excedidos: [...st.excedidos.slice(-30), current.id] }, "excedido");
      if (r) return r;
    }
    return { aviso: null, st: reset, motivo: "registrando" };
  }

  // 4) Escalada por tiempo sin registrar.
  const idleMin = Math.floor((now - ctx.idleSince) / 60000);
  const niveles = cfg.niveles?.length ? cfg.niveles : DEFAULTS.niveles;
  let nivel = 0;
  niveles.forEach((n, i) => { if (idleMin >= n) nivel = i + 1; });
  if (!nivel) return { aviso: null, st: { ...st, nivel: 0 }, motivo: "todavía no" };
  const max = niveles.length;
  const repetir = (cfg.repetir || DEFAULTS.repetir) * 60000;
  const toca = nivel > st.nivel || (nivel === max && now - st.ultimo >= repetir);
  if (!toca) return { aviso: null, st, motivo: "esperando para repetir" };
  const key = nivel >= max ? "inactivo3" : `inactivo${Math.min(nivel, 2)}`;
  const r = emitir(key, { sin_registrar: fmtDur(now - ctx.idleSince), sugerencia: lista[0]?.title || "" }, { ...st, nivel, ultimo: now }, `nivel ${nivel}`, { nivel });
  return r || { aviso: null, st: { ...st, nivel, ultimo: now }, motivo: `nivel ${nivel} (aviso apagado)` };
}

async function idleSince(q, current, now, tz, cfg) {
  let last = 0;
  if (current?.state === "paused") last = Math.max(...current.segments.map((s) => s[1] || 0));
  const r = await q.query("SELECT max(ended_at) AS e FROM sessions WHERE state='done'");
  const e = r.rows[0].e ? new Date(r.rows[0].e).getTime() : 0;
  return Math.max(last, e, windowStart(now, tz, cfg.desde, cfg.hasta));
}

const timed = (agenda) => [
  ...agenda.blocks.map((b) => ({ key: `b:${b.id}`, item_id: b.item_id, title: b.title, start: b.start, end: b.end })),
  ...agenda.events.filter((e) => !e.all_day).map((e) => ({ key: `e:${e.uid}:${e.start}`, item_id: null, title: e.title, start: e.start, end: e.end })),
];
// Lo que está ocurriendo ahora (bloques tuyos primero, luego el calendario).
export const agendadoAhora = (agenda, now) => timed(agenda).find((x) => x.start <= now && x.end > now) || null;
export const proximoEn = (agenda, now, min) => timed(agenda).filter((x) => x.start > now && x.start <= now + min * 60000).sort((a, b) => a.start - b.start)[0] || null;

// Firma los botones, agrega el ícono del equipo y manda por todos los canales.
export async function entregar(pool, cfg, aviso, { publicUrl, plantillas, send = enviar }) {
  const sec = await secret(pool);
  const base = (publicUrl || "").replace(/\/$/, "");
  const final = {
    ...aviso,
    abrir: base ? base + "/" : undefined,
    icono: base && plantillas?.global?.icono !== false ? `${base}/icono-192.png` : undefined,
    acciones: base ? aviso.acciones.map((a) => (a.abrir ? { label: a.label, url: base + "/", vista: true } : { label: a.label, url: `${base}/a/${signAction(sec, a.accion, a.datos)}` })) : [],
  };
  const envio = await send(cfg.canales, final);
  await pool.query("INSERT INTO activity(kind, detail) VALUES ('aviso', $1)", [`${final.titulo} → ${envio.map((x) => x.canal + (x.ok ? " ok" : " ✗ " + x.error)).join(", ")}`.slice(0, 500)]);
  return { envio, final };
}

export async function vigilar(pool, { tz, publicUrl, themeDir, now = Date.now(), send = enviar }) {
  const cfg = { ...DEFAULTS, ...(await getSetting(pool, "avisos", {})) };
  const plantillas = await loadPlantillas(pool, themeDir);
  const st = await getSetting(pool, "vigilante", {});
  const current = await currentSession(pool);
  const anticipo = plantillas.eventos.previo.minutos || 5;
  const agenda = await agendaRange(pool, now - 60_000, now + (anticipo + 1) * 60_000);
  const pred = await getPrediccion(pool);
  const rutinas = (await pool.query("SELECT * FROM items WHERE kind='rutina' AND status <> 'archivada'")).rows.map((r) => ({ ...r, hora: r.hora ? String(r.hora).slice(0, 5) : null }));
  const hab = await habitosConModo(pool, now, tz, pred);
  const est = current?.item_id ? (await pool.query("SELECT est_min FROM items WHERE id=$1", [current.item_id])).rows[0]?.est_min : null;
  const ctx = {
    now, tz, cfg, st, current, plantillas, estimadoMin: est,
    idleSince: await idleSince(pool, current, now, tz, cfg),
    ahora: agendadoAhora(agenda, now),
    proximo: proximoEn(agenda, now, anticipo),
    sugeridas: sugerencias(paraSugerir(hab), rutinasPermitidas(rutinas, pred, "sugerir"), now, tz, 3, pred.radio),
  };
  const out = decide(ctx);
  await setSetting(pool, "vigilante", { ...out.st, motivo: out.motivo, revisado: now });
  if (!out.aviso) return out;
  const r = await entregar(pool, cfg, out.aviso, { publicUrl, plantillas, send });
  out.envio = r.envio;
  out.enviado = r.final;
  return out;
}
