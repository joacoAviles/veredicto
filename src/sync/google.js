// Google Calendar en ambos sentidos (API v3) con tu propio cliente OAuth.
import { api } from "./oauth.js";
import { zoned } from "../time.js";

const BASE = "https://www.googleapis.com/calendar/v3";
const g = (cfg, m, url, o = {}) => api("google", cfg, m, url.startsWith("http") ? url : BASE + url, o);
const fecha = (s, tz) => { const [y, m, d] = s.split("-").map(Number); return zoned(y, m, d, 0, 0, 0, tz); };

export async function listCalendars(cfg, o = {}) {
  const j = await g(cfg, "GET", "/users/me/calendarList?maxResults=250", o);
  return {
    calendarios: (j.items || []).map((c) => ({
      remote_id: c.id, nombre: c.summaryOverride || c.summary, color: c.backgroundColor || null,
      editable: c.accessRole === "owner" || c.accessRole === "writer",
    })),
  };
}

export async function createCalendar(cfg, nombre, o = {}) {
  const j = await g(cfg, "POST", "/calendars", { body: { summary: nombre, timeZone: o.tz || "UTC" }, ...o });
  return j.id;
}

export async function pull(cfg, calId, from, to, tz, o = {}) {
  const out = [];
  let page = "";
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ singleEvents: "true", timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), maxResults: "2500" });
    if (page) q.set("pageToken", page);
    const j = await g(cfg, "GET", `/calendars/${encodeURIComponent(calId)}/events?${q}`, o);
    for (const e of j.items || []) {
      if (e.status === "cancelled" || !e.start) continue;
      const allDay = !!e.start.date;
      out.push({
        uid: e.id, href: `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(e.id)}`, etag: e.etag,
        title: e.summary || "(sin título)", all_day: allDay,
        starts_at: allDay ? fecha(e.start.date, tz) : Date.parse(e.start.dateTime),
        ends_at: allDay ? fecha(e.end.date, tz) : Date.parse(e.end.dateTime),
        recurrente: !!e.recurringEventId, modificado: Date.parse(e.updated) || null,
      });
    }
    page = j.nextPageToken;
    if (!page) break;
  }
  return out;
}

const cuerpo = ({ title, start, end, all_day, descripcion }, tz) => ({
  ...(title != null ? { summary: title } : {}),
  ...(descripcion ? { description: descripcion } : {}),
  ...(start != null ? { start: all_day ? { date: new Date(start).toISOString().slice(0, 10) } : { dateTime: new Date(start).toISOString(), timeZone: tz } } : {}),
  ...(end != null ? { end: all_day ? { date: new Date(end).toISOString().slice(0, 10) } : { dateTime: new Date(end).toISOString(), timeZone: tz } } : {}),
});

export async function put(cfg, calId, ev, { href, etag } = {}, o = {}) {
  const j = href
    ? await g(cfg, "PATCH", href, { body: cuerpo(ev, o.tz || "UTC"), headers: etag ? { "If-Match": etag } : {}, ...o })
    : await g(cfg, "POST", `/calendars/${encodeURIComponent(calId)}/events`, { body: cuerpo(ev, o.tz || "UTC"), ...o });
  return { uid: j.id, href: `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(j.id)}`, etag: j.etag };
}

export async function patch(cfg, href, etag, cambios, o = {}) {
  const j = await g(cfg, "PATCH", href, { body: cuerpo(cambios, o.tz || "UTC"), headers: etag ? { "If-Match": etag } : {}, ...o });
  return { etag: j.etag };
}

export async function remove(cfg, href, etag, o = {}) {
  try { await g(cfg, "DELETE", href, { headers: etag ? { "If-Match": etag } : {}, ...o }); }
  catch (e) { if (!e.borrado) throw e; }
}
