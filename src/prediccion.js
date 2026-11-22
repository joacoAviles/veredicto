// Qué aprende el algoritmo y qué puede hacer con eso. Todo configurable desde Ajustes.
import { getSetting } from "./db.js";
import { habits } from "./plan.js";
import { sessionsForHabits } from "./estado.js";

export const PRED_DEFAULTS = {
  dias: 28,          // historial que mira
  min_veces: 3,      // mínimo de días con la misma cosa a la misma hora
  min_frac: 0.3,     // y al menos esta fracción de los días posibles
  ventana: 45,       // minutos de tolerancia para considerar "la misma hora"
  radio: 60,         // qué tan cerca de la hora sugiere algo
  modo_defecto: "agendar", // qué hacer con un hábito nuevo: agendar | sugerir | nunca
  modos: {},         // por tarea/rutina: { [item_id]: "agendar" | "sugerir" | "nunca" }
};
export const MODOS = ["agendar", "sugerir", "nunca"];

// Ajustes del algoritmo de sugerencias con sus valores por defecto.
export async function getPrediccion(q) {
  const p = { ...PRED_DEFAULTS, ...(await getSetting(q, "prediccion", {})) };
  p.modos = { ...(p.modos || {}) };
  return p;
}

// Modo de una tarea/rutina (sugerir, agendar o nunca).
export const modoDe = (pred, itemId, { rutinaConHora = false } = {}) =>
  pred.modos[itemId] || (rutinaConHora ? "agendar" : pred.modo_defecto);

// Hábitos detectados con su modo ya aplicado.
export async function habitosConModo(q, now, tz, pred) {
  pred = pred || (await getPrediccion(q));
  const hab = habits(await sessionsForHabits(q, now, pred.dias), now, tz, {
    dias: pred.dias, minVeces: pred.min_veces, minFrac: pred.min_frac, ventana: pred.ventana,
  });
  return hab.map((h) => ({ ...h, modo: modoDe(pred, h.item_id) }));
}

// Filtra según el uso: "agendar" solo deja lo que puede agendarse solo; "sugerir" deja agendar + sugerir.
export const paraAgendar = (hab) => hab.filter((h) => h.modo === "agendar");
// Hábitos que se pueden sugerir (sin los marcados «nunca»).
export const paraSugerir = (hab) => hab.filter((h) => h.modo !== "nunca");
// Rutinas permitidas para un uso (sugerir o agendar).
export const rutinasPermitidas = (rutinas, pred, uso) =>
  rutinas.filter((r) => {
    const m = modoDe(pred, r.id, { rutinaConHora: !!r.hora });
    return uso === "agendar" ? m === "agendar" : m !== "nunca";
  });

// Valida los ajustes del algoritmo que llegan desde la app.
export function sanitizePred(prev, b = {}) {
  const n = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d);
  const out = { ...PRED_DEFAULTS, ...prev };
  if ("dias" in b) out.dias = Math.round(n(b.dias, 7, 120, out.dias));
  if ("min_veces" in b) out.min_veces = Math.round(n(b.min_veces, 2, 30, out.min_veces));
  if ("min_frac" in b) out.min_frac = n(b.min_frac, 0.05, 1, out.min_frac);
  if ("ventana" in b) out.ventana = Math.round(n(b.ventana, 10, 120, out.ventana));
  if ("radio" in b) out.radio = Math.round(n(b.radio, 10, 180, out.radio));
  if (MODOS.includes(b.modo_defecto)) out.modo_defecto = b.modo_defecto;
  if (b.modos && typeof b.modos === "object") {
    out.modos = { ...(prev.modos || {}) };
    for (const [k, v] of Object.entries(b.modos)) {
      if (!/^[0-9a-f-]{36}$/i.test(k)) continue;
      if (v === null || v === "") delete out.modos[k];
      else if (MODOS.includes(v)) out.modos[k] = v;
    }
  }
  return out;
}
