// Aprender de lo que registras para no tener que agendar a mano.
import { minuteOfDay, weekday, startOfDay, atMinute, dayKey, hhmmToMin } from "./time.js";

const DAY = 86_400_000;
const isWeekend = (wd) => wd === 0 || wd === 6;

// Hábitos: mismas cosas empezadas a una hora parecida, en el mismo tipo de día.
// sessions: [{item_id, title, started_at(ms), dur_ms}]
export function habits(sessions, now, tz, { dias = 28, minVeces = 3, minFrac = 0.3, ventana = 45 } = {}) {
  const desde = now - dias * DAY;
  const groups = new Map(); // `${item}|${finde}` -> [{min, dur, day}]
  for (const s of sessions) {
    if (!s.item_id || s.started_at < desde || s.started_at > now) continue;
    const key = `${s.item_id}|${isWeekend(weekday(s.started_at, tz)) ? 1 : 0}`;
    if (!groups.has(key)) groups.set(key, { item_id: s.item_id, title: s.title, finde: key.endsWith("1"), xs: [] });
    groups.get(key).xs.push({ min: minuteOfDay(s.started_at, tz), dur: s.dur_ms, day: dayKey(s.started_at, tz) });
  }
  // Días posibles de cada tipo en la ventana.
  let habiles = 0, findes = 0;
  for (let t = startOfDay(now, tz) - dias * DAY; t < now; t += DAY) isWeekend(weekday(t + 12 * 3600_000, tz)) ? findes++ : habiles++;
  const out = [];
  for (const g of groups.values()) {
    const xs = g.xs.sort((a, b) => a.min - b.min);
    // Agrupa por cercanía horaria (ida y vuelta del transporte quedan separadas).
    const clusters = [];
    for (const x of xs) {
      const c = clusters.at(-1);
      if (c && x.min - c.at(-1).min <= ventana) c.push(x); else clusters.push([x]);
    }
    for (const c of clusters) {
      const days = new Set(c.map((x) => x.day)).size;
      const posibles = g.finde ? findes : habiles;
      if (days < minVeces || !posibles || days / posibles < minFrac) continue;
      const med = (arr) => { const a = [...arr].sort((p, q) => p - q); return a[Math.floor(a.length / 2)]; };
      out.push({
        item_id: g.item_id, title: g.title, finde: g.finde,
        minuto: Math.round(med(c.map((x) => x.min)) / 5) * 5,
        dur_min: Math.max(5, Math.round(med(c.map((x) => x.dur)) / 60000 / 5) * 5),
        veces: days, de: posibles,
      });
    }
  }
  return out.sort((a, b) => a.minuto - b.minuto);
}

// Lo que sueles hacer cerca de esta hora (para el botón rápido y los avisos).
export function sugerencias(hab, rutinas, now, tz, n = 3, radio = 60) {
  const m = minuteOfDay(now, tz), finde = isWeekend(weekday(now, tz));
  const cerca = hab
    .filter((h) => h.finde === finde)
    .map((h) => ({ ...h, dist: Math.min(Math.abs(h.minuto - m), 1440 - Math.abs(h.minuto - m)) }))
    .filter((h) => h.dist <= radio)
    .sort((a, b) => a.dist - b.dist || b.veces - a.veces);
  const out = [];
  for (const h of cerca) if (!out.some((o) => o.item_id === h.item_id)) out.push({ item_id: h.item_id, title: h.title, motivo: `${h.veces} de ${h.de} días` });
  // Rutinas con hora fija cerca de ahora.
  for (const r of rutinas) {
    if (out.length >= n) break;
    if (!r.hora || out.some((o) => o.item_id === r.id)) continue;
    const rm = hhmmToMin(r.hora);
    if (Math.abs(rm - m) <= radio && (!r.dias || r.dias.includes(weekday(now, tz)))) out.push({ item_id: r.id, title: r.title, motivo: `rutina ${String(r.hora).slice(0, 5)}` });
  }
  return out.slice(0, n);
}

// Arma el día: bloques para hábitos y rutinas con hora, sin pisar lo que ya está.
// ocupado: [{start, end}] ms (bloques existentes + eventos de calendario).
export function armarDia(hab, rutinas, ocupado, now, tz, { desdeAhora = true } = {}) {
  const day = startOfDay(now, tz), wd = weekday(now, tz), finde = isWeekend(wd);
  const cands = [];
  for (const h of hab) if (h.finde === finde) cands.push({ item_id: h.item_id, title: h.title, minuto: h.minuto, dur: h.dur_min, motivo: `${h.veces} de ${h.de} días` });
  for (const r of rutinas) {
    if (!r.hora || (r.dias && !r.dias.includes(wd))) continue;
    if (cands.some((c) => c.item_id === r.id)) continue;
    cands.push({ item_id: r.id, title: r.title, minuto: hhmmToMin(r.hora), dur: r.est_min || 30, motivo: "rutina con hora fija" });
  }
  const busy = [...ocupado];
  const out = [];
  for (const c of cands.sort((a, b) => a.minuto - b.minuto)) {
    const start = atMinute(day, c.minuto, tz), end = start + c.dur * 60000;
    if (desdeAhora && end <= now) continue;
    if (busy.some((b) => b.start < end && b.end > start)) continue;
    busy.push({ start, end });
    out.push({ item_id: c.item_id, title: c.title, starts_at: start, ends_at: end, motivo: c.motivo });
  }
  return out;
}
