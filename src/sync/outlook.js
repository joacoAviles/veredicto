// Outlook / Microsoft 365 en ambos sentidos (Microsoft Graph) con tu propio registro de app en Azure.
import { api } from "./oauth.js";

const BASE = "https://graph.microsoft.com/v1.0";
const m = (cfg, method, url, o = {}) => api("outlook", cfg, method, url.startsWith("http") ? url : BASE + url, {
  ...o, headers: { Prefer: 'outlook.timezone="UTC"', ...(o.headers || {}) },
});
const utc = (s) => Date.parse(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z");

export async function listCalendars(cfg, o = {}) {
  const j = await m(cfg, "GET", "/me/calendars?$top=100", o);
  return { calendarios: (j.value || []).map((c) => ({ remote_id: c.id, nombre: c.name, color: c.hexColor || null, editable: c.canEdit !== false })) };
}

export async function createCalendar(cfg, nombre, o = {}) {
  return (await m(cfg, "POST", "/me/calendars", { body: { name: nombre }, ...o })).id;
}

export async function pull(cfg, calId, from, to, tz, o = {}) {
  const out = [];
  let url = `/me/calendars/${encodeURIComponent(calId)}/calendarView?startDateTime=${new Date(from).toISOString()}&endDateTime=${new Date(to).toISOString()}&$top=500&$select=id,subject,start,end,isAllDay,type,lastModifiedDateTime,isCancelled`;
  for (let i = 0; url && i < 20; i++) {
    const j = await m(cfg, "GET", url, o);
    for (const e of j.value || []) {
      if (e.isCancelled) continue;
      out.push({
        uid: e.id, href: `/me/events/${encodeURIComponent(e.id)}`, etag: e["@odata.etag"] || null,
        title: e.subject || "(sin título)", all_day: !!e.isAllDay,
        starts_at: utc(e.start.dateTime), ends_at: utc(e.end.dateTime),
        recurrente: e.type === "occurrence" || e.type === "exception", modificado: Date.parse(e.lastModifiedDateTime) || null,
      });
    }
    url = j["@odata.nextLink"] || null;
  }
  return out;
}

const cuerpo = ({ title, start, end, all_day, descripcion }) => ({
  ...(title != null ? { subject: title } : {}),
  ...(descripcion ? { body: { contentType: "text", content: descripcion } } : {}),
  ...(start != null ? { start: { dateTime: new Date(start).toISOString().replace("Z", ""), timeZone: "UTC" } } : {}),
  ...(end != null ? { end: { dateTime: new Date(end).toISOString().replace("Z", ""), timeZone: "UTC" } } : {}),
  ...(all_day != null ? { isAllDay: !!all_day } : {}),
});

export async function put(cfg, calId, ev, { href, etag } = {}, o = {}) {
  const j = href
    ? await m(cfg, "PATCH", href, { body: cuerpo(ev), headers: etag ? { "If-Match": etag } : {}, ...o })
    : await m(cfg, "POST", `/me/calendars/${encodeURIComponent(calId)}/events`, { body: cuerpo(ev), ...o });
  return { uid: j.id, href: `/me/events/${encodeURIComponent(j.id)}`, etag: j["@odata.etag"] || null };
}

export async function patch(cfg, href, etag, cambios, o = {}) {
  const j = await m(cfg, "PATCH", href, { body: cuerpo(cambios), headers: etag ? { "If-Match": etag } : {}, ...o });
  return { etag: j["@odata.etag"] || null };
}

export async function remove(cfg, href, etag, o = {}) {
  try { await m(cfg, "DELETE", href, { headers: etag ? { "If-Match": etag } : {}, ...o }); }
  catch (e) { if (!e.borrado) throw e; }
}
