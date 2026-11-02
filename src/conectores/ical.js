// Lector iCal: sirve con el enlace privado de Google Calendar, iCloud y Outlook.
// Expande las repeticiones más comunes (diaria, semanal, mensual, anual) dentro de una ventana.
import { zoned, isValidZone } from "../time.js";

const DAY = 86_400_000;

function unfold(text) {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}
function parseLine(line) {
  const i = line.indexOf(":");
  if (i < 0) return null;
  const head = line.slice(0, i), value = line.slice(i + 1);
  const [name, ...ps] = head.split(";");
  const params = Object.fromEntries(ps.map((p) => { const j = p.indexOf("="); return [p.slice(0, j).toUpperCase(), p.slice(j + 1).replace(/^"|"$/g, "")]; }));
  return { name: name.toUpperCase(), params, value };
}
const unescape = (s) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

// Algunos calendarios (Outlook) usan nombres de Windows; los más comunes en Latinoamérica.
const WIN = {
  "Pacific SA Standard Time": "America/Santiago", "SA Pacific Standard Time": "America/Bogota",
  "Argentina Standard Time": "America/Argentina/Buenos_Aires", "E. South America Standard Time": "America/Sao_Paulo",
  "Central Standard Time (Mexico)": "America/Mexico_City", "SA Western Standard Time": "America/La_Paz",
  "Pacific Standard Time": "America/Los_Angeles", "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago", "Romance Standard Time": "Europe/Paris",
  "W. Europe Standard Time": "Europe/Berlin", "GMT Standard Time": "Europe/London", "UTC": "UTC",
};

export function parseDate(value, params, defTz) {
  const v = value.trim();
  if (/^\d{8}$/.test(v) || params.VALUE === "DATE") {
    const y = +v.slice(0, 4), m = +v.slice(4, 6), d = +v.slice(6, 8);
    return { ms: zoned(y, m, d, 0, 0, 0, defTz), allDay: true, y, m, d };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const [, Y, M, D, h, mi, s, z] = m.map((x, i) => (i && i < 7 ? +x : x));
  if (z === "Z") return { ms: Date.UTC(Y, M - 1, D, h, mi, s), allDay: false };
  let tz = params.TZID ? WIN[params.TZID] || params.TZID : defTz;
  if (!isValidZone(tz)) tz = defTz;
  return { ms: zoned(Y, M, D, h, mi, s, tz), allDay: false, tz, wall: [Y, M, D, h, mi, s] };
}

function parseDuration(v) {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (((+m[2] || 0) * 7 + (+m[3] || 0)) * DAY + (+m[4] || 0) * 3600e3 + (+m[5] || 0) * 60e3 + (+m[6] || 0) * 1e3);
}

export function parseICS(text, defTz) {
  const events = [];
  let cur = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") { cur = { exdates: [] }; continue; }
    if (line === "END:VEVENT") { if (cur?.start) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === "UID") cur.uid = p.value;
    else if (p.name === "SUMMARY") cur.title = unescape(p.value);
    else if (p.name === "DTSTART") cur.start = parseDate(p.value, p.params, defTz);
    else if (p.name === "DTEND") cur.end = parseDate(p.value, p.params, defTz);
    else if (p.name === "DURATION") cur.duration = parseDuration(p.value);
    else if (p.name === "RRULE") cur.rrule = Object.fromEntries(p.value.split(";").map((kv) => kv.split("=")));
    else if (p.name === "EXDATE") for (const v of p.value.split(",")) { const d = parseDate(v, p.params, defTz); if (d) cur.exdates.push(d.ms); }
    else if (p.name === "RECURRENCE-ID") cur.recurrenceId = parseDate(p.value, p.params, defTz)?.ms;
    else if (p.name === "STATUS") cur.status = p.value.toUpperCase();
    else if (p.name === "TRANSP") cur.transp = p.value.toUpperCase();
  }
  return events;
}

const BYDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// Genera las fechas de inicio de una regla dentro de [from, to).
function* occurrences(ev, from, to, defTz) {
  const r = ev.rrule;
  const s = ev.start;
  if (!r) { yield s.ms; return; }
  const freq = r.FREQ, interval = Math.max(1, +r.INTERVAL || 1);
  const count = r.COUNT ? +r.COUNT : Infinity;
  const until = r.UNTIL ? parseDate(r.UNTIL, {}, defTz)?.ms ?? Infinity : Infinity;
  const tz = s.tz || defTz;
  const [Y, M, D, h, mi, sec] = s.wall || (s.allDay ? [s.y, s.m, s.d, 0, 0, 0] : null) || (() => {
    const d = new Date(s.ms); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()];
  })();
  const at = (y, m, d) => (s.wall || s.allDay ? zoned(y, m, d, h, mi, sec, tz) : Date.UTC(y, m - 1, d, h, mi, sec));
  const days = r.BYDAY ? r.BYDAY.split(",").map((x) => BYDAY[x.slice(-2)]).filter((x) => x !== undefined) : null;
  let n = 0;
  const emit = function* (t) { if (t < s.ms) return false; n++; if (n > count || t > until) return true; if (t >= from && t < to) yield t; return false; };
  const limit = to + DAY;
  if (freq === "DAILY") {
    for (let i = 0; ; i += interval) { const t = at(Y, M, D + i); if (t > limit || n >= count) return; if (yield* emit(t)) return; }
  } else if (freq === "WEEKLY") {
    const wd0 = new Date(Date.UTC(Y, M - 1, D)).getUTCDay();
    const set = (days || [wd0]).sort((a, b) => a - b);
    for (let w = 0; ; w += interval) {
      for (const wd of set) {
        const t = at(Y, M, D - wd0 + w * 7 + wd);
        if (t > limit || n >= count) return;
        if (yield* emit(t)) return;
      }
    }
  } else if (freq === "MONTHLY") {
    for (let i = 0; ; i += interval) {
      const t = at(Y, M + i, D);
      if (t > limit || n >= count) return;
      if (new Date(Date.UTC(Y, M - 1 + i, D)).getUTCDate() !== D) continue; // 31 en meses cortos
      if (yield* emit(t)) return;
    }
  } else if (freq === "YEARLY") {
    for (let i = 0; ; i += interval) { const t = at(Y + i, M, D); if (t > limit || n >= count) return; if (yield* emit(t)) return; }
  } else {
    yield s.ms;
  }
}

// Devuelve [{uid, starts_at, ends_at, title, all_day}] dentro de la ventana.
export function expand(events, from, to, defTz) {
  const out = [];
  const overrides = new Map();
  for (const e of events) if (e.recurrenceId) overrides.set(`${e.uid}|${e.recurrenceId}`, e);
  for (const e of events) {
    if (e.recurrenceId || e.status === "CANCELLED") continue;
    const dur = e.end ? e.end.ms - e.start.ms : e.duration || (e.start.allDay ? DAY : 0);
    const ex = new Set(e.exdates);
    let guard = 0;
    for (const t of occurrences(e, from - DAY * 2, to, defTz)) {
      if (++guard > 2000) break;
      if (ex.has(t)) continue;
      const o = overrides.get(`${e.uid}|${t}`);
      if (o) continue; // se agrega abajo como evento propio
      const end = t + Math.max(dur, 0);
      if (end <= from || t >= to) continue;
      out.push({ uid: e.uid || `${e.title}-${t}`, starts_at: t, ends_at: end || t + 30 * 60e3, title: e.title || "(sin título)", all_day: !!e.start.allDay });
    }
  }
  for (const o of overrides.values()) {
    if (o.status === "CANCELLED") continue;
    const dur = o.end ? o.end.ms - o.start.ms : o.duration || 0;
    if (o.start.ms + dur <= from || o.start.ms >= to) continue;
    out.push({ uid: o.uid, starts_at: o.start.ms, ends_at: o.start.ms + dur, title: o.title || "(sin título)", all_day: !!o.start.allDay });
  }
  return out;
}

export async function refreshCalendars(pool, tz, { fetcher = fetch, now = Date.now() } = {}) {
  const cals = (await pool.query("SELECT * FROM calendars")).rows;
  const from = now - DAY, to = now + 14 * DAY;
  for (const c of cals) {
    try {
      const url = c.url.replace(/^webcal:/i, "https:");
      const r = await fetcher(url, { signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "juez-del-tiempo" } });
      if (!r.ok) throw new Error(`el calendario respondió ${r.status}`);
      const text = await r.text();
      if (!text.includes("BEGIN:VCALENDAR")) throw new Error("el enlace no es un calendario iCal");
      const evs = expand(parseICS(text, tz), from, to, tz);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM calendar_events WHERE calendar_id=$1", [c.id]);
        for (const e of evs)
          await client.query(
            "INSERT INTO calendar_events VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
            [c.id, e.uid.slice(0, 500), new Date(e.starts_at), new Date(e.ends_at), e.title.slice(0, 300), e.all_day],
          );
        await client.query("UPDATE calendars SET last_ok_at=now(), last_error='' WHERE id=$1", [c.id]);
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
    } catch (e) {
      await pool.query("UPDATE calendars SET last_error=$2 WHERE id=$1", [c.id, String(e.message || e).slice(0, 300)]);
    }
  }
}

// Feed propio: tu agenda y lo medido, para suscribirlo en Google/Apple/Outlook.
export function buildICS({ blocks, sessions, name = "Juez del Tiempo" }) {
  const esc = (s) => String(s).replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  const dt = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const fold = (l) => { const out = []; while (l.length > 74) { out.push(l.slice(0, 74)); l = " " + l.slice(74); } out.push(l); return out.join("\r\n"); };
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Juez del Tiempo//ES", `X-WR-CALNAME:${esc(name)}`, "CALSCALE:GREGORIAN"];
  const stamp = dt(Date.now());
  for (const b of blocks)
    lines.push("BEGIN:VEVENT", `UID:bloque-${b.id}@juez`, `DTSTAMP:${stamp}`, `DTSTART:${dt(b.starts_at)}`, `DTEND:${dt(b.ends_at)}`, fold(`SUMMARY:${esc(b.title)}`), "TRANSP:OPAQUE", "END:VEVENT");
  for (const s of sessions)
    lines.push("BEGIN:VEVENT", `UID:sesion-${s.id}@juez`, `DTSTAMP:${stamp}`, `DTSTART:${dt(s.started_at)}`, `DTEND:${dt(s.ended_at)}`, fold(`SUMMARY:✓ ${esc(s.title)}`), "TRANSP:TRANSPARENT", "END:VEVENT");
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
