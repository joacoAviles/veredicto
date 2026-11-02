// Plantillas de avisos. Tres capas, de menos a más importante:
//   1) las de fábrica (aquí)  2) las del equipo: tema/avisos.json  3) las tuyas, editadas en Ajustes.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSetting } from "./db.js";

export const EVENTOS = {
  previo: {
    nombre: "Antes de algo agendado", ayuda: "Unos minutos antes de que empiece un bloque o una reunión.",
    activo: true, minutos: 5, prioridad: 3, tags: "alarm_clock",
    titulo: "En {minutos} min: {titulo}", mensaje: "{hora}–{fin}", acciones: ["iniciar", "silenciar30"],
  },
  agendado: {
    nombre: "Empezó algo agendado", ayuda: "Llegó la hora de un bloque o reunión y no lo estás registrando.",
    activo: true, prioridad: 4, tags: "calendar",
    titulo: "Agendado: {titulo}", mensaje: "Desde las {hora} hasta las {fin}. ¿Lo inicio?", acciones: ["iniciar", "silenciar60"],
  },
  inactivo1: {
    nombre: "Sin registrar · primer aviso", ayuda: "Primer nivel (por defecto a los 10 min).",
    activo: true, prioridad: 3, tags: "stopwatch",
    titulo: "¿Qué estás haciendo?", mensaje: "Llevas {sin_registrar} sin registrar.", acciones: ["sugerencia1", "sugerencia2", "silenciar60"],
  },
  inactivo2: {
    nombre: "Sin registrar · segundo aviso", ayuda: "Segundo nivel (por defecto a los 30 min).",
    activo: true, prioridad: 4, tags: "stopwatch",
    titulo: "Sigues sin registrar", mensaje: "{sin_registrar} en blanco. Elige algo, aunque sea «descanso».", acciones: ["sugerencia1", "sugerencia2", "silenciar60"],
  },
  inactivo3: {
    nombre: "Sin registrar · insistente", ayuda: "Último nivel; se repite cada X minutos hasta que registres.",
    activo: true, prioridad: 5, tags: "rotating_light",
    titulo: "Esto no se está midiendo", mensaje: "{sin_registrar} sin registro. Inicia algo ahora.", acciones: ["sugerencia1", "sugerencia2", "silenciar60"],
  },
  excedido: {
    nombre: "Se pasó de lo estimado", ayuda: "Lo que corre ya superó su tiempo estimado (× factor).",
    activo: true, factor: 1.5, prioridad: 3, tags: "hourglass",
    titulo: "{titulo}: ya van {lleva}", mensaje: "Estimaste {estimado}. ¿Sigues o paras?", acciones: ["parar", "silenciar30"],
  },
  armado: {
    nombre: "Resumen de la mañana", ayuda: "Cuando el día se arma solo al inicio de tu horario.",
    activo: true, prioridad: 3, tags: "sunrise",
    titulo: "Tu día ya está armado", mensaje: "{agenda}", acciones: ["abrir"],
  },
};

export const ACCIONES = {
  iniciar: "▶ Iniciar lo agendado",
  sugerencia1: "▶ Primera sugerencia",
  sugerencia2: "▶ Segunda sugerencia",
  seguir: "⏯ Seguir lo pausado",
  parar: "■ Parar",
  silenciar30: "Silenciar 30 min",
  silenciar60: "Silenciar 1 h",
  armar: "Armar mi día",
  abrir: "Abrir la app",
};

export const VARIABLES = {
  titulo: "lo agendado o lo que corre", hora: "hora de inicio", fin: "hora de término", minutos: "minutos que faltan",
  sin_registrar: "tiempo sin registrar", sugerencia: "primera sugerencia", lleva: "tiempo que lleva", estimado: "tiempo estimado",
  agenda: "lista del día", nombre: "nombre de la app",
};

export const GLOBAL_DEFAULTS = { prefijo: "", icono: true };

const CAMPOS = ["activo", "titulo", "mensaje", "prioridad", "tags", "acciones", "minutos", "factor"];

// Mezcla capas: cada capa solo pisa los campos que trae.
export function merge(...capas) {
  const out = { global: { ...GLOBAL_DEFAULTS }, eventos: {} };
  for (const [k, v] of Object.entries(EVENTOS)) out.eventos[k] = { ...v };
  for (const c of capas) {
    if (!c) continue;
    Object.assign(out.global, pick(c.global || {}, ["prefijo", "icono"]));
    for (const [k, v] of Object.entries(c.eventos || {})) if (out.eventos[k] && v) Object.assign(out.eventos[k], pick(v, CAMPOS));
  }
  return out;
}
const pick = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k, v]) => keys.includes(k) && v !== undefined && v !== null));

export async function equipo(themeDir) {
  if (!themeDir) return null;
  try { return JSON.parse(await readFile(path.join(themeDir, "avisos.json"), "utf8")); } catch { return null; }
}

export async function loadPlantillas(q, themeDir) {
  return merge(await equipo(themeDir), await getSetting(q, "plantillas", null));
}

export const fill = (s, vars) => String(s ?? "").replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? "") : m));

// Valida lo que llega desde Ajustes.
export function sanitize(b = {}) {
  const out = { global: {}, eventos: {} };
  if (b.global) {
    if (typeof b.global.prefijo === "string") out.global.prefijo = b.global.prefijo.slice(0, 40);
    if (typeof b.global.icono === "boolean") out.global.icono = b.global.icono;
  }
  for (const [k, v] of Object.entries(b.eventos || {})) {
    if (!EVENTOS[k] || !v) continue;
    const e = {};
    if (typeof v.activo === "boolean") e.activo = v.activo;
    if (typeof v.titulo === "string") e.titulo = v.titulo.slice(0, 120);
    if (typeof v.mensaje === "string") e.mensaje = v.mensaje.slice(0, 500);
    if (v.prioridad != null) e.prioridad = Math.max(1, Math.min(5, Math.round(Number(v.prioridad) || 3)));
    if (typeof v.tags === "string") e.tags = v.tags.replace(/[^\w,+-]/g, "").slice(0, 80);
    if (Array.isArray(v.acciones)) e.acciones = v.acciones.filter((a) => ACCIONES[a]).slice(0, 3);
    if (k === "previo" && v.minutos != null) e.minutos = Math.max(1, Math.min(120, Math.round(Number(v.minutos) || 5)));
    if (k === "excedido" && v.factor != null) e.factor = Math.max(1, Math.min(5, Number(v.factor) || 1.5));
    out.eventos[k] = e;
  }
  return out;
}
