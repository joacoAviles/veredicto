// Pruebas de punta a punta contra PostgreSQL real. Requiere TEST_DATABASE_URL.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, getSetting, setSetting } from "../src/db.js";
import { createApp } from "../src/app.js";
import { setupCode } from "../src/auth.js";
import { vigilar, decide } from "../src/vigilante.js";
import { pushPending } from "../src/conectores/notion.js";

const URL = process.env.TEST_DATABASE_URL;
if (!URL) { test("sin TEST_DATABASE_URL", { skip: true }, () => {}); }

let pool, server, base, cookie = "", token = "";
const sent = [];
const fakeSend = async (canales, aviso) => { sent.push(aviso); return [{ canal: "ntfy", ok: true }]; };
const ICS = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:reunion-1", "SUMMARY:Reunión con cliente",
  `DTSTART:${iso(Date.now() - 10 * 60000)}`, `DTEND:${iso(Date.now() + 50 * 60000)}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
function iso(ms) { return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
const fakeFetch = async (url) => ({ ok: true, status: 200, text: async () => ICS, json: async () => ({}) });

const call = async (path, { method = "GET", body, auth = "cookie", text } = {}) => {
  const headers = {};
  if (auth === "cookie" && cookie) headers.cookie = cookie;
  if (auth === "token") headers.authorization = `Bearer ${token}`;
  if (body) headers["content-type"] = "application/json";
  if (text != null) headers["content-type"] = "text/plain";
  const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : text, redirect: "manual" });
  const sc = r.headers.get("set-cookie");
  if (sc && sc.startsWith("jdt_sesion=") && !sc.startsWith("jdt_sesion=;")) cookie = sc.split(";")[0];
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, body: ct.includes("json") ? await r.json() : await r.text() };
};

before(async () => {
  if (!URL) return;
  pool = createPool(URL);
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(pool);
  const app = createApp(pool, { tz: "America/Santiago", publicUrl: "https://juez.ejemplo.cl", send: fakeSend, fetcher: fakeFetch });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server?.close(); await pool?.end(); });

test("instalación con código y entrada", { skip: !URL }, async () => {
  assert.equal((await call("/api/estado")).status, 401);
  const code = await setupCode(pool);
  assert.match(code, /^[0-9A-F]{8}$/);
  assert.equal((await call("/api/instalar", { method: "POST", body: { codigo: "MALO", password: "12345678" } })).status, 403);
  assert.equal((await call("/api/instalar", { method: "POST", body: { codigo: code, password: "clave-segura" } })).status, 200);
  assert.equal(await setupCode(pool), null);
  cookie = "";
  assert.equal((await call("/api/entrar", { method: "POST", body: { password: "otra" } })).status, 401);
  assert.equal((await call("/api/entrar", { method: "POST", body: { password: "clave-segura" } })).status, 200);
  const s = await call("/api/sesion");
  assert.equal(s.body.dentro, true);
});

test("temporizador: una sola actividad abierta, toques cortos se descartan", { skip: !URL }, async () => {
  let r = await call("/api/iniciar", { method: "POST", body: { title: "Escribir guion" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.estado.current.title, "Escribir guion");
  r = await call("/api/iniciar", { method: "POST", body: { title: "Transporte" } });
  assert.equal(r.body.estado.current.title, "Transporte");
  const open = await pool.query("SELECT count(*)::int n FROM sessions WHERE state IN ('running','paused')");
  assert.equal(open.rows[0].n, 1);
  // la anterior duró menos de 30 s: descartada
  assert.equal((await pool.query("SELECT count(*)::int n FROM sessions WHERE title='Escribir guion'")).rows[0].n, 0);
  // simular que lleva 20 min
  await pool.query("UPDATE segments SET started_at = now() - interval '20 minutes' WHERE ended_at IS NULL");
  await pool.query("UPDATE sessions SET started_at = now() - interval '20 minutes' WHERE state='running'");
  r = await call("/api/pausar", { method: "POST" });
  assert.equal(r.body.estado.current.state, "paused");
  r = await call("/api/parar", { method: "POST" });
  assert.equal(r.body.estado.current, null);
  assert.ok(r.body.estado.hoy.medido_ms >= 19 * 60000);
  assert.equal((await pool.query("SELECT count(*)::int n FROM outbox WHERE kind='session'")).rows[0].n, 1);
});

test("dos pedidos simultáneos no dejan dos actividades abiertas", { skip: !URL }, async () => {
  await Promise.all(["A", "B", "C", "D"].map((t) => call("/api/iniciar", { method: "POST", body: { title: t } })));
  assert.equal((await pool.query("SELECT count(*)::int n FROM sessions WHERE state IN ('running','paused')")).rows[0].n, 1);
  await call("/api/parar", { method: "POST" });
});

test("atajos en texto simple con token", { skip: !URL }, async () => {
  const t = await call("/api/tokens", { method: "POST", body: { label: "iPhone" } });
  token = t.body.token;
  assert.match(token, /^jdt_/);
  assert.equal((await call("/api/atajo/estado", { auth: "none" })).status, 401);
  let r = await call("/api/atajo/iniciar", { method: "POST", auth: "token", text: "Gimnasio" });
  assert.equal(r.body, "▶ Gimnasio");
  r = await call("/api/atajo/estado", { auth: "token" });
  assert.match(r.body, /^▶ Gimnasio · /);
  r = await call(`/api/atajo/capturar?k=${token}&texto=${encodeURIComponent("Idea de video: reloj")}`, { auth: "none" });
  assert.equal(r.body, "Guardado en la bandeja.");
  await pool.query("UPDATE segments SET started_at = now() - interval '5 minutes' WHERE ended_at IS NULL");
  r = await call("/api/atajo/alternar", { method: "POST", auth: "token" });
  assert.match(r.body, /^■ Gimnasio · 5 min/);
  r = await call("/api/atajo/opciones", { auth: "token" });
  assert.ok(r.body.split("\n").includes("Gimnasio"));
  // un token de atajo no puede crear más tokens
  assert.equal((await call("/api/tokens", { method: "POST", auth: "token", body: {} })).status, 403);
});

test("calendario iCal: el evento aparece en la agenda", { skip: !URL }, async () => {
  const r = await call("/api/calendarios", { method: "POST", body: { name: "Trabajo", url: "webcal://ejemplo/cal.ics" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.estado.conexiones.calendarios[0].ok, true);
  assert.ok(r.body.estado.agenda.events.some((e) => e.title === "Reunión con cliente"));
});

test("vigilante: si hay algo agendado y no registras, avisa con botón para iniciarlo", { skip: !URL }, async () => {
  await setSetting(pool, "avisos", { activo: true, desde: "00:00", hasta: "23:59", canales: { ntfy: { topic: "x" } } });
  sent.length = 0;
  const out = await vigilar(pool, { tz: "America/Santiago", publicUrl: "https://juez.ejemplo.cl", send: fakeSend });
  assert.equal(out.aviso.tipo, "agendado");
  assert.equal(sent[0].titulo, "Agendado: Reunión con cliente");
  const url = sent[0].acciones[0].url;
  assert.ok(url.startsWith("https://juez.ejemplo.cl/a/"));
  // el mismo bloque no se repite
  const again = await vigilar(pool, { tz: "America/Santiago", publicUrl: "https://juez.ejemplo.cl", send: fakeSend });
  assert.notEqual(again.aviso?.tipo, "agendado");
  // tocar el botón del aviso inicia la actividad en el servidor
  const path = url.replace("https://juez.ejemplo.cl", "");
  const r = await call(path, { method: "POST", auth: "none" });
  assert.equal(r.body, "▶ Reunión con cliente");
  const st = await call("/api/estado");
  assert.equal(st.body.current.title, "Reunión con cliente");
  // con algo corriendo, el vigilante calla
  assert.equal((await vigilar(pool, { tz: "America/Santiago", publicUrl: "https://juez.ejemplo.cl", send: fakeSend })).motivo, "registrando");
  // enlace alterado: rechazado
  assert.equal((await call(path.slice(0, -2) + "xx", { method: "POST", auth: "none" })).status, 410);
  await call("/api/parar", { method: "POST" });
});

test("decide(): escalada 10/30/60 y repetición", () => {
  const cfg = { activo: true, desde: "00:00", hasta: "23:59", niveles: [10, 30, 60], repetir: 10, canales: { ntfy: { topic: "t" } } };
  const now = Date.UTC(2026, 10, 2, 15, 0);
  const base = { now, tz: "UTC", cfg, current: null, ahora: null, sugeridas: [{ item_id: "1", title: "Transporte" }] };
  assert.equal(decide({ ...base, st: {}, idleSince: now - 5 * 60000 }).aviso, null);
  const a1 = decide({ ...base, st: {}, idleSince: now - 12 * 60000 });
  assert.equal(a1.aviso.nivel, 1);
  assert.equal(a1.aviso.acciones[0].label, "▶ Transporte");
  assert.equal(decide({ ...base, st: a1.st, idleSince: now - 12 * 60000 }).aviso, null);
  const a3 = decide({ ...base, st: { nivel: 2, ultimo: now - 60000 }, idleSince: now - 61 * 60000 });
  assert.equal(a3.aviso.prioridad, 5);
  assert.equal(decide({ ...base, now: now + 5 * 60000, st: a3.st, idleSince: now - 61 * 60000 }).aviso, null);
  assert.ok(decide({ ...base, now: now + 10 * 60000, st: a3.st, idleSince: now - 61 * 60000 }).aviso);
  assert.equal(decide({ ...base, st: { silencio_hasta: now + 1 }, idleSince: 0 }).motivo, "silenciado");
  assert.equal(decide({ ...base, cfg: { ...cfg, canales: {} }, st: {}, idleSince: 0 }).motivo, "apagado");
});

test("armar mi día crea bloques con hábitos y no pisa el calendario", { skip: !URL }, async () => {
  // 5 días de "Transporte" a las 08:10 hora Chile
  const it = (await pool.query("INSERT INTO items(kind,title,est_min) VALUES ('rutina','Transporte',50) RETURNING id")).rows[0];
  const now = Date.now();
  for (let d = 1; d <= 7; d++) {
    const dia = new Date(now - d * 86400000);
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(dia);
    const wd = new Date(ymd + "T12:00:00Z").getUTCDay();
    const r = await pool.query("SELECT ($1::date + time '08:10') AT TIME ZONE 'America/Santiago' AS s", [ymd]);
    const s = r.rows[0].s;
    const ses = (await pool.query("INSERT INTO sessions(item_id,title,state,started_at,ended_at,source) VALUES ($1,'Transporte','done',$2,$2::timestamptz + interval '50 min','app') RETURNING id", [it.id, s])).rows[0];
    await pool.query("INSERT INTO segments(session_id,started_at,ended_at) VALUES ($1,$2,$2::timestamptz + interval '50 min')", [ses.id, s]);
    void wd;
  }
  const r = await call("/api/armar");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.plan));
});

test("Notion: la cola se envía y reintenta sin perder nada", { skip: !URL }, async () => {
  let calls = 0, fail = true;
  const client = {
    pages: {
      retrieve: async () => ({}),
      create: async () => { calls++; if (fail) { const e = new Error("rate"); e.status = 429; throw e; } return { id: "p" + calls }; },
      update: async () => ({}),
    },
    databases: { create: async () => ({ id: "db" + Math.random() }) },
  };
  const { setupNotion } = await import("../src/conectores/notion.js");
  await setupNotion(pool, { token: "secret_x", pagina: "https://www.notion.so/Pagina-0123456789abcdef0123456789abcdef" }, { client });
  let r = await pushPending(pool, { client, pauseMs: 0 });
  assert.ok(r.errores > 0);
  assert.equal((await pool.query("SELECT count(*)::int n FROM outbox WHERE status='error'")).rows[0].n > 0, true);
  fail = false;
  await pool.query("UPDATE outbox SET next_at=now()");
  r = await pushPending(pool, { client, pauseMs: 0, limit: 200 });
  assert.equal(r.errores, 0);
  assert.equal((await pool.query("SELECT count(*)::int n FROM outbox WHERE status<>'ok'")).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int n FROM items WHERE notion_id IS NULL AND status<>'archivada'")).rows[0].n, 0);
  const cfg = await getSetting(pool, "notion");
  assert.equal(cfg.pagina, "0123456789abcdef0123456789abcdef");
});

test("plantilla y feed de calendario", { skip: !URL }, async () => {
  const css = await call("/theme.css", { auth: "none" });
  assert.match(css.body, /--acento/);
  const html = await call("/", { auth: "none" });
  assert.match(html.body, /<title>Juez del Tiempo<\/title>/);
  const f = await call("/api/feed");
  const ics = await call(f.body.url.replace("https://juez.ejemplo.cl", ""), { auth: "none" });
  assert.match(ics.body, /BEGIN:VCALENDAR/);
  assert.equal((await call("/cal/malo.ics", { auth: "none" })).status, 404);
});

test("plantillas: editar, probar y volver a la del equipo; modos del algoritmo", { skip: !URL }, async () => {
  let r = await call("/api/plantillas");
  assert.equal(r.body.efectivas.eventos.agendado.titulo, "Agendado: {titulo}");
  r = await call("/api/plantillas", { method: "PUT", body: { global: { prefijo: "JDT · " }, eventos: { inactivo1: { titulo: "Hey {sugerencia}", acciones: ["sugerencia1", "abrir"] } } } });
  assert.equal(r.body.efectivas.eventos.inactivo1.titulo, "Hey {sugerencia}");
  sent.length = 0;
  r = await call("/api/plantillas/probar", { method: "POST", body: { evento: "inactivo1" } });
  assert.equal(r.status, 200);
  assert.match(sent[0].titulo, /^\[prueba\] JDT · Hey /);
  assert.ok(sent[0].acciones.at(-1).vista);
  r = await call("/api/plantillas/inactivo1", { method: "DELETE" });
  assert.equal(r.body.efectivas.eventos.inactivo1.titulo, "¿Qué estás haciendo?");
  const it = (await pool.query("SELECT id FROM items WHERE title='Transporte' AND kind='rutina'")).rows[0];
  r = await call("/api/prediccion", { method: "PUT", body: { modos: { [it.id]: "nunca" } } });
  assert.equal(r.status, 200);
  r = await call("/api/prediccion");
  assert.equal(r.body.items.find((i) => i.id === it.id).modo, "nunca");
  r = await call("/api/armar");
  assert.ok(!r.body.plan.some((p) => p.item_id === it.id));
});

