// Sincronización en ambos sentidos, de punta a punta.
// CalDAV contra un servidor real (Radicale) si RADICALE_URL está definido; Markdown con una carpeta real;
// Notion y Google con dobles en memoria.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPool, migrate } from "../src/db.js";
import { createApp } from "../src/app.js";
import { setClave, cifrar, descifrar } from "../src/cifrado.js";
import { sincronizar } from "../src/sync/motor.js";
import * as caldav from "../src/sync/caldav.js";
import * as google from "../src/sync/google.js";
import { tareas } from "../src/sync/markdown.js";
import { patchICS } from "../src/sync/caldav.js";

const URL = process.env.TEST_DATABASE_URL;
const RAD = process.env.RADICALE_URL;
const TZ = "America/Santiago";
let pool, server, base, cookie = "", notas;

// Doble de Notion: una página raíz con casillas.
const notionDb = { pages: [{ id: "pag1", title: "Proyecto", edited: "2026-11-16T10:00:00.000Z" }], todos: { pag1: [{ id: "blk1", text: "Llamar al notario", checked: false }] }, bandeja: [] };
notionDb.flujo = [];
const flujoPage = (f) => ({
  id: f.id, last_edited_time: f.edited, properties: {
    Nombre: { title: [{ plain_text: f.nombre }] }, Tipo: { select: f.tipo ? { name: f.tipo } : null }, Estado: { select: f.estado ? { name: f.estado } : null },
    "Duración (min)": { number: f.dur ?? null }, Agendar: { date: f.agendar || null }, "Minutos registrados": { number: f.min ?? null }, "Última sesión": { date: null },
  },
});
let reloj = Date.parse("2026-11-16T12:00:00.000Z");
const tick = () => new Date((reloj += 1000)).toISOString();
const fakeNotion = {
  pages: {
    retrieve: async () => ({ id: "raiz" }),
    create: async ({ parent, properties }) => {
      if (parent.database_id) {
        const f = { id: "fila" + (notionDb.flujo.length + 1), nombre: properties.Nombre.title[0].text.content, tipo: properties.Tipo.select.name, estado: properties.Estado.select.name, edited: tick() };
        notionDb.flujo.push(f);
        return { id: f.id };
      }
      return { id: "bandejaPage" };
    },
    update: async ({ page_id, properties }) => {
      const f = notionDb.flujo.find((x) => x.id === page_id);
      if (!f) { const e = new Error("no"); e.status = 404; throw e; }
      if (properties.Estado) f.estado = properties.Estado.select.name;
      if (properties.Agendar) f.agendar = properties.Agendar.date;
      if (properties["Minutos registrados"]) f.min = properties["Minutos registrados"].number;
      f.edited = tick();
      return {};
    },
  },
  databases: {
    create: async () => ({ id: "flujoDb" }),
    query: async ({ filter }) => {
      const desde = filter?.last_edited_time?.on_or_after;
      const rows = notionDb.flujo.filter((f) => !desde || f.edited >= desde).sort((a, b) => (a.edited < b.edited ? -1 : 1));
      return { results: rows.map(flujoPage), has_more: false };
    },
  },
  search: async () => ({ results: notionDb.pages.map((p) => ({ id: p.id, object: "page", last_edited_time: p.edited, properties: { title: { type: "title", title: [{ plain_text: p.title }] } } })), has_more: false }),
  blocks: {
    children: {
      list: async ({ block_id }) => ({ results: (notionDb.todos[block_id] || []).map((t) => ({ id: t.id, type: "to_do", has_children: false, to_do: { checked: t.checked, rich_text: [{ type: "text", plain_text: t.text }] } })), has_more: false }),
      append: async ({ children }) => { notionDb.bandeja.push(children[0].to_do.rich_text[0].text.content); return {}; },
    },
    update: async ({ block_id, to_do }) => { for (const l of Object.values(notionDb.todos)) for (const t of l) if (t.id === block_id) t.checked = to_do.checked; return {}; },
  },
};

const call = async (p, { method = "GET", body } = {}) => {
  const r = await fetch(base + p, { method, headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const sc = r.headers.get("set-cookie");
  if (sc?.startsWith("jdt_sesion=") && !sc.startsWith("jdt_sesion=;")) cookie = sc.split(";")[0];
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, body: ct.includes("json") ? await r.json() : await r.text(), headers: r.headers };
};
const sync = () => sincronizar(pool, { tz: TZ, notionClient: fakeNotion });

before(async () => {
  if (!URL) return;
  setClave("prueba-sync");
  pool = createPool(URL);
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(pool);
  notas = await mkdtemp(path.join(tmpdir(), "veredicto-notas-"));
  const app = createApp(pool, { tz: TZ, publicUrl: "https://v.ejemplo.cl", notasDir: notas, notionClient: fakeNotion, send: async () => [] });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const { presetAccount } = await import("../src/auth.js");
  await presetAccount(pool, "clave-segura");
  await call("/api/entrar", { method: "POST", body: { password: "clave-segura" } });
});
after(async () => { server?.close(); await pool?.end(); });

test("cifrado: ida y vuelta, y no se lee con otra clave", () => {
  setClave("a");
  const s = cifrar({ clave: "secreta" });
  assert.equal(descifrar(s).clave, "secreta");
  setClave("b");
  assert.throws(() => descifrar(s), /cambió la clave/);
  setClave("prueba-sync");
});

test("Markdown: casillas a gestiones, en ambos sentidos, y bandeja", { skip: !URL }, async () => {
  await writeFile(path.join(notas, "Trámites.md"), "# Trámites\n\n- [ ] Renovar licencia 📅 2026-11-20\n- [x] Pagar contribuciones\n- texto normal\n");
  let r = await call("/api/cuentas/markdown", { method: "POST", body: { carpeta: notas } });
  assert.equal(r.status, 200);
  await sync();
  let it = (await pool.query("SELECT * FROM items WHERE fuente='markdown' ORDER BY title")).rows;
  assert.deepEqual(it.map((i) => [i.title, i.status]), [["Pagar contribuciones", "hecha"], ["Renovar licencia", "pendiente"]]);
  assert.equal(new Date(it[1].due_date).toISOString().slice(0, 10), "2026-11-20");
  // App → nota
  await call(`/api/items/${it[1].id}`, { method: "PATCH", body: { status: "hecha" } });
  await sync();
  assert.match(await readFile(path.join(notas, "Trámites.md"), "utf8"), /- \[x\] Renovar licencia/);
  // Nota → app
  await new Promise((s) => setTimeout(s, 20));
  await writeFile(path.join(notas, "Trámites.md"), "# Trámites\n\n- [x] Renovar licencia 📅 2026-11-20\n- [ ] Pagar contribuciones\n- [ ] Nueva cosa\n");
  await sync();
  it = (await pool.query("SELECT title, status FROM items WHERE fuente='markdown' AND status<>'archivada' ORDER BY title")).rows;
  assert.deepEqual(it.map((i) => [i.title, i.status]), [["Nueva cosa", "pendiente"], ["Pagar contribuciones", "pendiente"], ["Renovar licencia", "hecha"]]);
  // Captura → Bandeja/AAAA-MM-DD.md → gestión
  await call("/api/capturas", { method: "POST", body: { text: "Idea: video del reloj" } });
  await sync();
  const dir = await readdir(path.join(notas, "Bandeja"));
  assert.equal(dir.length, 1);
  assert.match(await readFile(path.join(notas, "Bandeja", dir[0]), "utf8"), /- \[ \] Idea: video del reloj/);
  await sync();
  assert.ok((await pool.query("SELECT 1 FROM items WHERE title='Idea: video del reloj' AND fuente='markdown'")).rowCount);
  assert.equal((await pool.query("SELECT status FROM captures")).rows[0].status, "procesada");
});

test("Markdown: identidad de casillas repetidas y fechas", () => {
  const t = tareas("a.md", "- [ ] Comprar pan\n- [ ] Comprar pan\n  * [X] Sub tarea ⏳ 2026-01-02 ✅ 2026-01-03");
  assert.equal(t.length, 3);
  assert.notEqual(t[0].ext_id, t[1].ext_id);
  assert.equal(t[2].hecha, true);
  assert.equal(t[2].fecha, "2026-01-02");
  assert.equal(t[2].titulo, "Sub tarea");
});

test("Notion: casillas en ambos sentidos", { skip: !URL }, async () => {
  const r = await call("/api/cuentas/notion", { method: "POST", body: { token: "ntn_x", pagina: "https://www.notion.so/Raiz-0123456789abcdef0123456789abcdef" } });
  assert.equal(r.status, 200);
  await sync();
  const it = (await pool.query("SELECT * FROM items WHERE fuente='notion'")).rows;
  assert.equal(it.length, 1);
  assert.equal(it[0].nota_titulo, "Proyecto");
  await call(`/api/items/${it[0].id}`, { method: "PATCH", body: { status: "hecha" } });
  await sync();
  assert.equal(notionDb.todos.pag1[0].checked, true);
  notionDb.todos.pag1[0].checked = false;
  notionDb.pages[0].edited = "2026-11-16T11:00:00.000Z";
  await sync();
  assert.equal((await pool.query("SELECT status FROM items WHERE id=$1", [it[0].id])).rows[0].status, "pendiente");
});

test("CalDAV (Radicale): bloques al calendario Plan y cambios de afuera", { skip: !URL || !RAD }, async () => {
  const usuario = "prueba" + Date.now();
  let r = await call("/api/cuentas/caldav", { method: "POST", body: { nombre: "Radicale", url: RAD, usuario, clave: "x" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const cuenta = r.body.cuenta;
  r = await call(`/api/cuentas/${cuenta}/crear-calendario`, { method: "POST", body: { rol: "plan" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call(`/api/cuentas/${cuenta}/crear-calendario`, { method: "POST", body: { rol: "registrado" } });
  assert.equal(r.status, 200);
  // Un calendario «Trabajo» con una reunión creada afuera.
  const cfg = { url: RAD, usuario, clave: "x" };
  const trabajo = await caldav.createCalendar(cfg, "Trabajo");
  const now = Date.now();
  const reunion = await caldav.put(cfg, trabajo, { title: "Reunión", start: now + 3 * 3600e3, end: now + 4 * 3600e3 });
  const lista = await caldav.listCalendars(cfg);
  const cals = lista.calendarios.map((c) => ({ remote_id: c.remote_id, nombre: c.nombre }));
  for (const c of cals) await pool.query("INSERT INTO calendars(name,cuenta_id,remote_id,editable,rol) VALUES ($1,$2,$3,true,'leer') ON CONFLICT (cuenta_id, remote_id) WHERE cuenta_id IS NOT NULL DO NOTHING", [c.nombre, cuenta, c.remote_id]);

  // App → calendario: un bloque nuevo viaja a «Veredicto · Plan».
  r = await call("/api/bloques", { method: "POST", body: { title: "Escribir guion", inicio: now + 3600e3, fin: now + 2 * 3600e3 } });
  await sync();
  const plan = (await pool.query("SELECT * FROM calendars WHERE rol='plan'")).rows[0];
  let remotos = await caldav.pull(cfg, plan.remote_id, now - 864e5, now + 864e5, TZ);
  assert.deepEqual(remotos.map((x) => x.title), ["Escribir guion"]);
  const b = (await pool.query("SELECT * FROM blocks WHERE title='Escribir guion'")).rows[0];
  assert.ok(b.etag && b.remote_uid);

  // Afuera (iPhone) lo mueven 30 min: llega a la app.
  await caldav.patch(cfg, remotos[0].href, remotos[0].etag, { start: now + 5400e3, end: now + 9000e3 });
  await sync();
  const b2 = (await pool.query("SELECT * FROM blocks WHERE id=$1", [b.id])).rows[0];
  assert.equal(Math.floor(+b2.starts_at / 1000), Math.floor((now + 5400e3) / 1000));

  // Afuera crean un evento en «Veredicto · Plan»: aparece como bloque.
  await caldav.put(cfg, plan.remote_id, { title: "Gimnasio", start: now + 6 * 3600e3, end: now + 7 * 3600e3 });
  await sync();
  assert.ok((await pool.query("SELECT 1 FROM blocks WHERE title='Gimnasio' AND borrado IS NULL")).rowCount);

  // La reunión de «Trabajo» aparece en la agenda y se puede mover desde la app.
  let ag = (await call(`/api/agenda?dias=2`)).body;
  const ev = ag.events.find((e) => e.title === "Reunión");
  assert.ok(ev?.editable);
  r = await call("/api/eventos", { method: "PATCH", body: { calendar_id: ev.calendar_id, uid: ev.uid, inicio: now + 8 * 3600e3, fin: now + 9 * 3600e3 } });
  assert.equal(r.status, 200);
  await sync();
  remotos = await caldav.pull(cfg, trabajo, now - 864e5, now + 864e5, TZ);
  assert.equal(Math.floor(remotos[0].starts_at / 1000), Math.floor((now + 8 * 3600e3) / 1000));
  void reunion;

  // Conflicto: lo cambian afuera y en la app a la vez; gana el más reciente y queda registrado.
  const b3 = (await pool.query("SELECT * FROM blocks WHERE id=$1", [b.id])).rows[0];
  await call(`/api/bloques/${b.id}`, { method: "PATCH", body: { title: "Guion (app)" } });
  await new Promise((s) => setTimeout(s, 1100));
  await caldav.patch(cfg, b3.href, b3.etag, { title: "Guion (iPhone)" });
  await sync();
  const b4 = (await pool.query("SELECT * FROM blocks WHERE id=$1", [b.id])).rows[0];
  assert.equal(b4.title, "Guion (iPhone)");
  const conf = (await pool.query("SELECT * FROM conflictos WHERE ref=$1", [b.id])).rows;
  assert.equal(conf[0].ganador, "remoto");
  assert.equal(conf[0].perdedor.title, "Guion (app)");
  // Deshacer el conflicto vuelve a tu versión y la manda afuera.
  await call(`/api/conflictos/${conf[0].id}/deshacer`, { method: "POST" });
  await sync();
  remotos = await caldav.pull(cfg, plan.remote_id, now - 864e5, now + 864e5, TZ);
  assert.ok(remotos.some((x) => x.title === "Guion (app)"));

  // Borrado afuera → papelera; borrado en la app → se borra afuera.
  const gim = (await pool.query("SELECT * FROM blocks WHERE title='Gimnasio'")).rows[0];
  await caldav.remove(cfg, gim.href, gim.etag);
  await sync();
  assert.ok((await pool.query("SELECT borrado FROM blocks WHERE id=$1", [gim.id])).rows[0].borrado);
  await call(`/api/bloques/${b.id}`, { method: "DELETE" });
  await sync();
  remotos = await caldav.pull(cfg, plan.remote_id, now - 864e5, now + 864e5, TZ);
  assert.equal(remotos.length, 0);

  // Lo registrado va a «Veredicto · Registrado».
  await call("/api/iniciar", { method: "POST", body: { title: "Leer" } });
  await pool.query("UPDATE segments SET started_at=now()-interval '10 minutes' WHERE ended_at IS NULL");
  await pool.query("UPDATE sessions SET started_at=now()-interval '10 minutes' WHERE state='running'");
  await call("/api/parar", { method: "POST" });
  await sync();
  const reg = (await pool.query("SELECT * FROM calendars WHERE rol='registrado'")).rows[0];
  remotos = await caldav.pull(cfg, reg.remote_id, now - 864e5, now + 864e5, TZ);
  assert.deepEqual(remotos.map((x) => x.title), ["✓ Leer"]);
});

test("patchICS conserva invitados y alarmas", () => {
  const raw = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nSUMMARY:Viejo\r\nDTSTART;TZID=America/Santiago:20261116T100000\r\nATTENDEE:mailto:a@b.cl\r\nSEQUENCE:2\r\nBEGIN:VALARM\r\nTRIGGER:-PT10M\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR";
  const out = patchICS(raw, { title: "Nuevo", start: Date.UTC(2026, 10, 16, 14) });
  assert.match(out, /SUMMARY:Nuevo/);
  assert.match(out, /DTSTART:20261116T140000Z/);
  assert.match(out, /ATTENDEE:mailto:a@b\.cl/);
  assert.match(out, /SEQUENCE:3/);
  assert.match(out, /TRIGGER:-PT10M/);
});

test("Google: lee instancias y escribe con If-Match", async () => {
  const llamadas = [];
  const fetcher = async (url, init) => {
    llamadas.push([init.method, String(url), init.headers]);
    if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
    if (init.method === "GET") return new Response(JSON.stringify({ items: [
      { id: "e1", etag: '"1"', summary: "Clase", start: { dateTime: "2026-11-16T12:00:00Z" }, end: { dateTime: "2026-11-16T13:00:00Z" }, updated: "2026-11-15T00:00:00Z", recurringEventId: "r" },
      { id: "e2", etag: '"2"', summary: "Feriado", start: { date: "2026-11-17" }, end: { date: "2026-11-18" }, updated: "2026-11-15T00:00:00Z" },
      { id: "e3", status: "cancelled" },
    ] }), { status: 200 });
    if (init.method === "PATCH") return new Response(JSON.stringify({ id: "e2", etag: '"3"' }), { status: 200 });
    return new Response("{}", { status: 200 });
  };
  const cfg = { client_id: "c", client_secret: "s", refresh_token: "r" };
  const ev = await google.pull(cfg, "primary", 0, 1, TZ, { fetcher });
  assert.equal(ev.length, 2);
  assert.equal(ev[0].recurrente, true);
  assert.equal(ev[1].all_day, true);
  const r = await google.patch(cfg, ev[1].href, ev[1].etag, { title: "X" }, { fetcher, tz: TZ });
  assert.equal(r.etag, '"3"');
  const p = llamadas.find((l) => l[0] === "PATCH");
  assert.equal(p[2]["If-Match"], '"2"');
  assert.equal(llamadas.filter((l) => l[1].includes("oauth2")).length, 1); // el token se reutiliza
});


test("Notion Flujo: de idea a bloque en el calendario y tiempo de vuelta", { skip: !URL }, async () => {
  await pool.query("INSERT INTO settings(key,value) VALUES ('avisos', $1) ON CONFLICT (key) DO UPDATE SET value=$1", [JSON.stringify({ activo: true, desde: "00:00", hasta: "00:00", canales: {} })]);
  // 1. En Notion: un video «Por hacer» de 15 min.
  notionDb.flujo.push({ id: "v1", nombre: "Video R22", tipo: "Video", estado: "Por hacer", dur: 15, edited: tick() });
  await sync();
  let it = (await pool.query("SELECT * FROM items WHERE ext_id='v1'")).rows[0];
  assert.equal(it.etapa, "Por hacer");
  assert.equal(it.agendable, true);
  assert.equal(it.nota_titulo, "Video");
  // 2. «Armar mi día» lo pone en un hueco y escribe la hora en Notion.
  const r = await call("/api/armar", { method: "POST" });
  assert.equal(r.status, 200);
  assert.ok(r.body.plan.some((p) => p.item_id === it.id), "el video entra al plan");
  await sync();
  it = (await pool.query("SELECT * FROM items WHERE id=$1", [it.id])).rows[0];
  assert.ok(it.bloque_id);
  const f = notionDb.flujo.find((x) => x.id === "v1");
  assert.equal(f.estado, "Agendada");
  assert.ok(f.agendar?.start);
  // 3. Registras 20 minutos: suman en la fila.
  await call("/api/iniciar", { method: "POST", body: { item_id: it.id } });
  assert.equal((await pool.query("SELECT etapa FROM items WHERE id=$1", [it.id])).rows[0].etapa, "Agendada");
  await pool.query("UPDATE segments SET started_at=now()-interval '20 minutes' WHERE ended_at IS NULL");
  await pool.query("UPDATE sessions SET started_at=now()-interval '20 minutes' WHERE state='running'");
  await call("/api/parar", { method: "POST" });
  await sync();
  assert.equal(f.min, 20);
  assert.equal(f.estado, "En curso");
  // 4. La marcas hecha en la app: queda «Hecha» en Notion.
  await call(`/api/items/${it.id}`, { method: "PATCH", body: { status: "hecha" } });
  await sync();
  assert.equal(f.estado, "Hecha");
  // 5. En Notion le pones hora a otra fila: aparece como bloque.
  const inicio = new Date(Date.now() + 5 * 3600e3);
  inicio.setUTCSeconds(0, 0);
  notionDb.flujo.push({ id: "g1", nombre: "Notario", tipo: "Gestión", estado: "Agendada", dur: 45, agendar: { start: inicio.toISOString() }, edited: tick() });
  await sync();
  const g = (await pool.query("SELECT i.*, b.starts_at, b.ends_at FROM items i JOIN blocks b ON b.id=i.bloque_id WHERE i.ext_id='g1'")).rows[0];
  assert.equal(+g.starts_at, +inicio);
  assert.equal(+g.ends_at - +g.starts_at, 45 * 60000);
  // Le quitas la hora en Notion: el bloque sale de la agenda.
  notionDb.flujo.find((x) => x.id === "g1").agendar = null;
  notionDb.flujo.find((x) => x.id === "g1").edited = tick();
  await sync();
  assert.ok((await pool.query("SELECT borrado FROM blocks WHERE id=(SELECT id FROM blocks WHERE title='Notario' ORDER BY starts_at DESC LIMIT 1)")).rows[0].borrado);
  // 6. Una captura por Siri cae como fila «Bandeja».
  await pool.query("UPDATE settings SET value=to_jsonb((SELECT id::text FROM cuentas WHERE tipo='notion' LIMIT 1)) WHERE key='bandeja_cuenta'");
  await call("/api/capturas", { method: "POST", body: { text: "Idea: video sobre el carburador" } });
  await sync();
  const nueva = notionDb.flujo.find((x) => x.nombre === "Idea: video sobre el carburador");
  assert.ok(nueva);
  assert.equal(nueva.estado, "Bandeja");
});
