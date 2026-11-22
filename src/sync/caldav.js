// CalDAV en ambos sentidos: iCloud, Fastmail, Nextcloud, Synology Calendar, Radicale…
// Solo usa lo estándar (RFC 4791): PROPFIND, REPORT calendar-query, PUT con If-Match, DELETE, MKCALENDAR.
import { XMLParser } from "fast-xml-parser";
import { randomUUID } from "node:crypto";
import { parseICS, expand } from "../conectores/ical.js";

const xml = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: true });
// Valor a lista (null → []).
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
// Texto de un nodo XML.
const txt = (x) => (x == null ? "" : typeof x === "object" ? String(x["#text"] ?? "") : String(x));

export const ICLOUD = "https://caldav.icloud.com/";

// Cabecera Basic con usuario y clave.
function authHeader(cfg) {
  return "Basic " + Buffer.from(`${cfg.usuario}:${cfg.clave}`).toString("base64");
}

// Petición WebDAV con autenticación y tiempo límite.
async function dav(cfg, method, url, { body, depth, headers = {}, fetcher = fetch } = {}) {
  const r = await fetcher(url, {
    method,
    headers: {
      Authorization: authHeader(cfg), "User-Agent": "veredicto",
      ...(body ? { "Content-Type": method === "PUT" ? "text/calendar; charset=utf-8" : "application/xml; charset=utf-8" } : {}),
      ...(depth != null ? { Depth: String(depth) } : {}),
      ...headers,
    },
    body, redirect: "follow", signal: AbortSignal.timeout(30_000),
  });
  if (r.status === 401) throw Object.assign(new Error("El servidor rechazó el usuario o la contraseña de app."), { status: 401, fatal: true });
  return r;
}

// Respuestas de un multistatus.
const responses = (text) => arr(xml.parse(text)?.multistatus?.response);
// Propiedades del propstat con estado 200.
const okProp = (resp) => {
  const ps = arr(resp.propstat).find((p) => /200/.test(txt(p.status))) || arr(resp.propstat)[0];
  return ps?.prop || {};
};

// PROPFIND con las propiedades pedidas.
async function propfind(cfg, url, props, depth, opts) {
  const body = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/"><d:prop>${props}</d:prop></d:propfind>`;
  const r = await dav(cfg, "PROPFIND", url, { body, depth, ...opts });
  if (r.status !== 207) throw new Error(`PROPFIND ${url} respondió ${r.status}`);
  return responses(await r.text());
}

// Encuentra la carpeta de calendarios del usuario.
export async function discover(cfg, opts = {}) {
  const base = cfg.url || ICLOUD;
  let principal = base;
  const r1 = await propfind(cfg, base, "<d:current-user-principal/>", 0, opts);
  const cup = okProp(r1[0])["current-user-principal"];
  if (cup?.href) principal = new URL(txt(cup.href), base).href;
  const r2 = await propfind(cfg, principal, "<c:calendar-home-set/>", 0, opts);
  const home = okProp(r2[0])["calendar-home-set"]?.href;
  if (!home) throw new Error("No encontré la carpeta de calendarios en ese servidor.");
  return new URL(txt(arr(home)[0]), principal).href;
}

// Calendarios de la cuenta CalDAV.
export async function listCalendars(cfg, opts = {}) {
  const home = cfg.home || (await discover(cfg, opts));
  const rs = await propfind(cfg, home, "<d:resourcetype/><d:displayname/><ic:calendar-color/><c:supported-calendar-component-set/><d:current-user-privilege-set/>", 1, opts);
  const out = [];
  for (const r of rs) {
    const p = okProp(r);
    const rt = p.resourcetype || {};
    if (!("calendar" in rt)) continue;
    const comps = arr(p["supported-calendar-component-set"]?.comp).map((c) => c?.["@_name"]);
    if (comps.length && !comps.includes("VEVENT")) continue;
    const privs = JSON.stringify(p["current-user-privilege-set"] || {});
    out.push({
      remote_id: new URL(txt(r.href), home).href,
      nombre: txt(p.displayname) || "Calendario",
      color: txt(p["calendar-color"]).slice(0, 7) || null,
      editable: !privs || privs === "{}" || /write|all/.test(privs),
    });
  }
  return { home, calendarios: out };
}

// Crea un calendario «veredicto-…» en la cuenta.
export async function createCalendar(cfg, nombre, opts = {}) {
  const home = cfg.home || (await discover(cfg, opts));
  const url = new URL(`veredicto-${randomUUID().slice(0, 8)}/`, home).href;
  const body = `<?xml version="1.0" encoding="utf-8"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:set><d:prop><d:displayname>${esc(nombre)}</d:displayname><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>`;
  const r = await dav(cfg, "MKCALENDAR", url, { body, ...opts });
  if (r.status !== 201) throw new Error(`No pude crear el calendario «${nombre}» (${r.status}). Créalo a mano y elígelo en la lista.`);
  return url;
}

// Escapa texto para XML.
const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);
// Milisegundos a fecha UTC de iCalendar.
const dt = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// Trae los eventos de un calendario dentro de la ventana, con su etag.
export async function pull(cfg, calUrl, from, to, tz, opts = {}) {
  const body = `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${dt(from)}" end="${dt(to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  const r = await dav(cfg, "REPORT", calUrl, { body, depth: 1, ...opts });
  if (r.status !== 207) throw new Error(`El calendario respondió ${r.status}`);
  const out = [];
  for (const resp of responses(await r.text())) {
    const p = okProp(resp);
    const data = txt(p["calendar-data"]);
    if (!data) continue;
    const href = new URL(txt(resp.href), calUrl).href, etag = txt(p.getetag);
    for (const e of expand(parseICS(data, tz), from, to, tz)) out.push({ ...e, href, etag });
  }
  return out;
}

// Arma el VEVENT de un bloque o evento.
export function toICS({ uid, title, start, end, all_day, descripcion }) {
  const d = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
  const fold = (l) => { const o = []; while (l.length > 74) { o.push(l.slice(0, 74)); l = " " + l.slice(74); } o.push(l); return o.join("\r\n"); };
  const e = (s) => String(s).replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Veredicto//ES", "BEGIN:VEVENT",
    `UID:${uid}`, `DTSTAMP:${dt(Date.now())}`, `LAST-MODIFIED:${dt(Date.now())}`,
    all_day ? `DTSTART;VALUE=DATE:${d(start)}` : `DTSTART:${dt(start)}`,
    all_day ? `DTEND;VALUE=DATE:${d(end)}` : `DTEND:${dt(end)}`,
    fold(`SUMMARY:${e(title)}`), ...(descripcion ? [fold(`DESCRIPTION:${e(descripcion)}`)] : []),
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}

// Cambia solo título y horas de un evento que no es nuestro, sin perder el resto (invitados, alarmas, notas).
export function patchICS(raw, { title, start, end }) {
  const lines = raw.replace(/\r\n[ \t]/g, "").split(/\r?\n/);
  let inEv = false, depth = 0;
  const out = [];
  const e = (s) => String(s).replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  for (const l of lines) {
    if (l === "BEGIN:VEVENT") { inEv = true; depth++; }
    if (inEv && depth === 1 && /^BEGIN:VALARM/.test(l)) depth++;
    if (inEv && depth === 2 && /^END:VALARM/.test(l)) { depth--; out.push(l); continue; }
    if (inEv && depth === 1) {
      if (title != null && /^SUMMARY[:;]/.test(l)) { out.push(`SUMMARY:${e(title)}`); continue; }
      if (start != null && /^DTSTART[:;]/.test(l)) { out.push(`DTSTART:${dt(start)}`); continue; }
      if (end != null && /^DTEND[:;]/.test(l)) { out.push(`DTEND:${dt(end)}`); continue; }
      if (/^(LAST-MODIFIED|DTSTAMP)[:;]/.test(l)) { out.push(`${l.split(/[:;]/)[0]}:${dt(Date.now())}`); continue; }
      if (/^SEQUENCE:/.test(l)) { out.push(`SEQUENCE:${Number(l.slice(9)) + 1}`); continue; }
    }
    if (l === "END:VEVENT") { inEv = false; depth = 0; }
    out.push(l);
  }
  return out.join("\r\n");
}

// ETag actual de un evento.
async function etagOf(cfg, href, opts) {
  const rs = await propfind(cfg, href, "<d:getetag/>", 0, opts);
  return txt(okProp(rs[0]).getetag) || null;
}

// Crea o reemplaza un evento nuestro. Con etag, solo si nadie lo cambió (If-Match).
export async function put(cfg, calUrl, ev, { href, etag } = {}, opts = {}) {
  const uid = ev.uid || `${randomUUID()}@veredicto`;
  const target = href || new URL(`${encodeURIComponent(uid.replace(/@.*/, ""))}.ics`, calUrl).href;
  const headers = href && etag ? { "If-Match": etag } : href ? {} : { "If-None-Match": "*" };
  const r = await dav(cfg, "PUT", target, { body: toICS({ ...ev, uid }), headers, ...opts });
  if (r.status === 412) throw Object.assign(new Error("Cambió afuera mientras tanto."), { conflicto: true });
  if (![200, 201, 204].includes(r.status)) throw new Error(`No pude guardar el evento (${r.status}).`);
  return { uid, href: target, etag: r.headers.get("etag") || (await etagOf(cfg, target, opts)) };
}

// Mueve o renombra un evento ajeno conservando todo lo demás.
export async function patch(cfg, href, etag, cambios, opts = {}) {
  const g = await dav(cfg, "GET", href, opts);
  if (g.status === 404) throw Object.assign(new Error("Ya no existe."), { borrado: true });
  if (!g.ok) throw new Error(`No pude leer el evento (${g.status}).`);
  const actual = g.headers.get("etag");
  if (etag && actual && actual !== etag) throw Object.assign(new Error("Cambió afuera mientras tanto."), { conflicto: true });
  const r = await dav(cfg, "PUT", href, { body: patchICS(await g.text(), cambios), headers: actual ? { "If-Match": actual } : {}, ...opts });
  if (r.status === 412) throw Object.assign(new Error("Cambió afuera mientras tanto."), { conflicto: true });
  if (![200, 201, 204].includes(r.status)) throw new Error(`No pude guardar el cambio (${r.status}).`);
  return { etag: r.headers.get("etag") || (await etagOf(cfg, href, opts)) };
}

// Borra un evento (con If-Match si hay ETag).
export async function remove(cfg, href, etag, opts = {}) {
  const r = await dav(cfg, "DELETE", href, { headers: etag ? { "If-Match": etag } : {}, ...opts });
  if (r.status === 412) throw Object.assign(new Error("Cambió afuera mientras tanto."), { conflicto: true });
  if (![200, 204, 404].includes(r.status)) throw new Error(`No pude borrar el evento (${r.status}).`);
}
