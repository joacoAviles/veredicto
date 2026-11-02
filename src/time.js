// Fechas en la zona horaria configurada, sin librerías.
const MIN = 60_000;
const fmtCache = new Map();
function fmt(tz) {
  if (!fmtCache.has(tz))
    fmtCache.set(tz, new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short", hourCycle: "h23",
    }));
  return fmtCache.get(tz);
}
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function parts(ms, tz) {
  const p = Object.fromEntries(fmt(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second, wd: WD[p.weekday] };
}
export function isValidZone(tz) {
  try { fmt(tz); return true; } catch { return false; }
}
const offset = (ms, tz) => {
  const p = parts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
};
// Hora de pared en tz → instante UTC.
export function zoned(y, m, d, h = 0, mi = 0, s = 0, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  let t = guess - offset(guess, tz);
  const o2 = offset(t, tz);
  if (guess - o2 !== t) t = guess - o2;
  return t;
}
export const startOfDay = (ms, tz) => { const p = parts(ms, tz); return zoned(p.y, p.m, p.d, 0, 0, 0, tz); };
export const addDays = (dayStart, n, tz) => { const p = parts(dayStart + 12 * 3600_000, tz); return zoned(p.y, p.m, p.d + n, 0, 0, 0, tz); };
export const minuteOfDay = (ms, tz) => { const p = parts(ms, tz); return p.h * 60 + p.mi; };
export const weekday = (ms, tz) => parts(ms, tz).wd;
export const dayKey = (ms, tz) => { const p = parts(ms, tz); return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`; };
export const atMinute = (dayStart, minute, tz) => {
  const p = parts(dayStart + 12 * 3600_000, tz);
  return zoned(p.y, p.m, p.d, Math.floor(minute / 60), minute % 60, 0, tz);
};
export const hhmmToMin = (s) => { const [h, m] = String(s).split(":").map(Number); return h * 60 + (m || 0); };
export const fmtDur = (ms) => {
  const min = Math.max(0, Math.round(ms / MIN)), h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
};
export const fmtHora = (ms, tz) => { const p = parts(ms, tz); return `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`; };
export const normalize = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
