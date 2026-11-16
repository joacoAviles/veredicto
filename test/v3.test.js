// Veredicto 3: proyectos, modo demo, ActivityWatch, MCP y las 9 bases de Notion. Requiere TEST_DATABASE_URL.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate } from "../src/db.js";
import { createApp } from "../src/app.js";
import { presetAccount } from "../src/auth.js";
import { setClave } from "../src/cifrado.js";
import { sincronizar } from "../src/sync/motor.js";
import * as espejo from "../src/sync/espejo.js";
import { tramos } from "../src/sync/activitywatch.js";

const URL = process.env.TEST_DATABASE_URL;
const TZ = "America/Santiago";
let pool, server, base, cookie = "", token = "";

// ---------- Notion falso: bases y filas en memoria ----------
function notionFalso() {
  let n = 0;
  const dbs = new Map(), pages = new Map();
  const leerProp = (v) => {
    if (v.title) return { type: "title", title: v.title.map((t) => ({ plain_text: t.text.content })) };
    if (v.rich_text) return { type: "rich_text", rich_text: v.rich_text.map((t) => ({ plain_text: t.text.content })) };
    if ("number" in v) return { type: "number", number: v.number };
    if ("checkbox" in v) return { type: "checkbox", checkbox: v.checkbox };
    if ("select" in v) return { type: "select", select: v.select };
    if ("date" in v) return { type: "date", date: v.date };
    if (v.relation) return { type: "relation", relation: v.relation };
    return v;
  };
  const api = {
    dbs, paginas: pages,
    databases: {
      create: async ({ title, properties }) => { const id = `db${++n}`; dbs.set(id, { id, titulo: title[0].text.content, properties, filas: [] }); return { id }; },
      update: async ({ database_id, properties }) => { Object.assign(dbs.get(database_id).properties, properties); return {}; },
      query: async ({ database_id }) => ({ results: (dbs.get(database_id)?.filas || []).map((id) => pages.get(id)), has_more: false }),
    },
    pages: {
      retrieve: async () => ({ id: "raiz" }),
      create: async ({ parent, properties, children }) => {
        const id = `pg${++n}`;
        const props = Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, leerProp(v)]));
        pages.set(id, { id, parent, properties: props, children, last_edited_time: new Date().toISOString() });
        if (parent.database_id) dbs.get(parent.database_id).filas.push(id);
        return { id };
      },
      update: async ({ page_id, properties }) => {
        const p = pages.get(page_id);
        if (!p) throw Object.assign(new Error("no"), { status: 404 });
        for (const [k, v] of Object.entries(properties)) p.properties[k] = leerProp(v);
        return {};
      },
    },
    search: async ({ filter }) => ({
      results: filter?.value === "database" ? [...dbs.values()].map((d) => ({ id: d.id, object: "database", title: [{ plain_text: d.titulo }] })) : [],
      has_more: false,
    }),
    blocks: { children: { list: async () => ({ results: [], has_more: false }), append: async () => ({}) }, update: async () => ({}) },
  };
  return api;
}
const notion = notionFalso();

// ---------- ActivityWatch falso ----------
const t0 = Date.now() - 3 * 3600_000;
const ev = (min, dur, app, title) => ({ timestamp: new Date(t0 + min * 60000).toISOString(), duration: dur * 60, data: { app, title } });
const AW = {
  "/api/0/buckets/": { "aw-watcher-window_mac": {}, "aw-watcher-afk_mac": {} },
  window: [ev(0, 40, "Code", "pagos.js — api"), ev(41, 20, "Code", "pagos.js — api"), ev(70, 30, "Google Chrome", "Stripe docs — Google Chrome")],
  afk: [{ timestamp: new Date(t0).toISOString(), duration: 120 * 60, data: { status: "not-afk" } }],
};
const fetcher = async (url) => {
  const u = new globalThis.URL(url);
  let body = null;
  if (u.pathname === "/api/0/buckets/") body = AW["/api/0/buckets/"];
  else if (u.pathname.includes("aw-watcher-window")) body = AW.window;
  else if (u.pathname.includes("aw-watcher-afk")) body = AW.afk;
  if (!body) return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
};

const call = async (path, { method = "GET", body, auth = "cookie" } = {}) => {
  const headers = {};
  if (auth === "cookie") headers.cookie = cookie;
  if (auth === "token") headers.authorization = `Bearer ${token}`;
  if (body) headers["content-type"] = "application/json";
  const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie");
  if (sc?.startsWith("jdt_sesion=") && !sc.startsWith("jdt_sesion=;")) cookie = sc.split(";")[0];
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, body: ct.includes("json") ? await r.json() : await r.text(), headers: r.headers };
};
const rpc = async (method, params, id = 1) => (await call("/mcp", { method: "POST", auth: "token", body: { jsonrpc: "2.0", id, method, params } })).body;

before(async () => {
  if (!URL) return;
  setClave("prueba-v3");
  pool = createPool(URL);
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(pool);
  const app = createApp(pool, { tz: TZ, publicUrl: "https://v.ejemplo.cl", fetcher, notionClient: notion, send: async () => [], empujarMs: 600_000 });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await presetAccount(pool, "clave-segura");
  await call("/api/entrar", { method: "POST", body: { password: "clave-segura" } });
});
after(async () => { server?.close(); await pool?.end(); });

test("la cookie es Secure solo si llegó por https", { skip: !URL }, async () => {
  const r = await fetch(base + "/api/entrar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "clave-segura" }) });
  assert.doesNotMatch(r.headers.get("set-cookie"), /Secure/);
  const s = await fetch(base + "/api/entrar", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-proto": "https" }, body: JSON.stringify({ password: "clave-segura" }) });
  assert.match(s.headers.get("set-cookie"), /Secure/);
});

test("proyectos: pilar, proyecto, tareas agrupadas y minutos medidos", { skip: !URL }, async () => {
  const pil = (await call("/api/pilares", { method: "POST", body: { nombre: "Aviación", color: "#e08a00" } })).body.pilar;
  const pro = (await call("/api/proyectos", { method: "POST", body: { nombre: "Licencia PPL", pilar_id: pil.id, fecha_limite: "2027-03-01" } })).body.proyecto;
  assert.ok(pro.id);
  const t = await call("/api/items", { method: "POST", body: { title: "Meteorología cap. 4", est_min: 60, proyecto_id: pro.id, eisenhower: "Agendar" } });
  assert.equal(t.status, 200);
  const item = t.body.estado.items.find((i) => i.title === "Meteorología cap. 4");
  assert.equal(item.proyecto_id, pro.id);
  assert.equal(item.eisenhower, "Agendar");
  await pool.query("INSERT INTO sessions(item_id,title,state,started_at,ended_at) VALUES ($1,$2,'done',now()-interval '50 min',now()-interval '5 min') RETURNING id", [item.id, item.title])
    .then((r) => pool.query("INSERT INTO segments(session_id,started_at,ended_at) VALUES ($1,now()-interval '50 min',now()-interval '5 min')", [r.rows[0].id]));
  const l = (await call("/api/proyectos")).body;
  const p = l.proyectos.find((x) => x.id === pro.id);
  assert.equal(p.abiertas, 1);
  assert.equal(p.min_medidos, 45);
  assert.equal(p.min_semana, 45);
  assert.equal((await call(`/api/proyectos/${pro.id}`, { method: "PATCH", body: { estado: "pausado" } })).status, 200);
  assert.equal((await call(`/api/items/${item.id}`, { method: "PATCH", body: { eisenhower: "Inventado" } })).status, 400);
});

test("modo demo: carga, no se duplica y se borra sin tocar lo tuyo", { skip: !URL }, async () => {
  const r = await call("/api/demo", { method: "POST" });
  assert.equal(r.status, 200);
  assert.equal(r.body.estado.demo, true);
  assert.ok(r.body.estado.proyectos.length >= 5);
  assert.ok(Number((await pool.query("SELECT count(*) FROM sessions WHERE demo")).rows[0].count) > 20);
  assert.equal((await call("/api/demo", { method: "POST" })).status, 409);
  const b = await call("/api/demo", { method: "DELETE" });
  assert.equal(b.body.estado.demo, false);
  assert.deepEqual(b.body.estado.proyectos.map((p) => p.nombre), ["Licencia PPL"]);
  assert.equal(Number((await pool.query("SELECT count(*) FROM actividad WHERE demo")).rows[0].count), 0);
});

test("ActivityWatch: tramos sin tiempo inactivo, y registrarlos crea la sesión", { skip: !URL }, async () => {
  const ts = tramos(AW.window, AW.afk);
  assert.equal(ts.length, 2);
  assert.equal(ts[0].app, "Code");
  assert.equal(Math.round((ts[0].fin - ts[0].inicio) / 60000), 61); // dos eventos con 1 min de pausa = un tramo
  assert.equal(ts[1].titulo, "Stripe docs");
  assert.equal((await call("/api/activitywatch", { method: "PUT", body: { url: "http://mac.local:9999" } })).status, 200);
  const a = (await call("/api/actividad")).body;
  assert.equal(a.tramos.length, 2);
  assert.ok(a.sin_registrar_ms > 80 * 60000);
  const r = await call("/api/actividad/registrar", { method: "POST", body: { ids: [a.tramos[0].id], title: "API de pagos" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.title, "API de pagos");
  const b = (await call("/api/actividad")).body;
  assert.equal(b.tramos.find((t) => t.id === a.tramos[0].id).registrado, true);
  assert.equal((await call("/api/actividad/registrar", { method: "POST", body: { ids: [a.tramos[0].id] } })).status, 409);
  assert.equal((await call("/api/activitywatch", { method: "PUT", body: { url: "nada" } })).status, 400);
});

test("MCP: tu asistente lista herramientas, inicia en un proyecto y para", { skip: !URL }, async () => {
  token = (await call("/api/tokens", { method: "POST", body: { label: "Claude" } })).body.token;
  assert.ok(token);
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "prueba", version: "1" } });
  assert.equal(init.result.serverInfo.name, "veredicto");
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.equal((await call("/mcp", { method: "POST", auth: "token", body: { jsonrpc: "2.0", method: "notifications/initialized" } })).status, 202);
  const tools = (await rpc("tools/list", {})).result.tools.map((t) => t.name);
  for (const t of ["estado", "iniciar", "parar", "capturar", "proyectos", "armar_dia", "actividad_computador"]) assert.ok(tools.includes(t), t);
  const ini = await rpc("tools/call", { name: "iniciar", arguments: { que: "Simulador de vuelo", proyecto: "licencia" } });
  assert.equal(ini.result.isError, false);
  assert.match(ini.result.content[0].text, /Iniciado: Simulador de vuelo/);
  const it = (await pool.query("SELECT i.* FROM items i JOIN proyectos p ON p.id=i.proyecto_id WHERE i.title='Simulador de vuelo' AND p.nombre='Licencia PPL'")).rows;
  assert.equal(it.length, 1);
  assert.match((await rpc("tools/call", { name: "estado", arguments: {} })).result.content[0].text, /Corriendo: Simulador de vuelo/);
  assert.match((await rpc("tools/call", { name: "proyectos", arguments: {} })).result.content[0].text, /Licencia PPL/);
  assert.match((await rpc("tools/call", { name: "actividad_computador", arguments: {} })).result.content[0].text, /Code/);
  const mal = await rpc("tools/call", { name: "iniciar", arguments: { que: "x", proyecto: "no existe" } });
  assert.equal(mal.result.isError, true);
  assert.equal((await rpc("nada/raro", {})).error.code, -32601);
  await pool.query("UPDATE segments SET started_at = started_at - interval '2 min'");
  assert.match((await rpc("tools/call", { name: "parar", arguments: {} })).result.content[0].text, /Registrado: Simulador de vuelo/);
  // El token sigue sin abrir el resto de la app.
  assert.equal((await call("/api/estado", { auth: "token" })).status, 403);
  assert.equal((await call("/mcp", { method: "POST", auth: "none", body: { jsonrpc: "2.0", id: 1, method: "ping" } })).status, 401);
});

test("Notion: crea las 9 bases, Flujo con Proyecto, la guía, y las llena", { skip: !URL }, async () => {
  const c = await call("/api/cuentas/notion", { method: "POST", body: { token: "secret_x", pagina: "https://notion.so/Raiz-3f33367eec9f81a2a5cf0b656e2c92aa" } });
  assert.equal(c.status, 200);
  const r = await call(`/api/cuentas/${c.body.cuenta}/notion-bases`, { method: "POST", body: { modo: "crear" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.bases, 9);
  assert.equal(r.body.guia, true);
  const titulos = [...notion.dbs.values()].map((d) => d.titulo);
  for (const [, nom] of espejo.BASES) assert.ok(titulos.includes(`Veredicto · ${nom}`), nom);
  const flujo = [...notion.dbs.values()].find((d) => d.titulo === "Flujo");
  assert.ok(flujo.properties.Proyecto?.relation);
  await sincronizar(pool, { tz: TZ, notionClient: notion });
  const dbPro = [...notion.dbs.values()].find((d) => d.titulo === "Veredicto · Proyectos");
  const nombres = dbPro.filas.map((id) => notion.paginas.get(id).properties.Nombre.title[0].plain_text);
  assert.deepEqual(nombres, ["Licencia PPL"]);
  const dbT = [...notion.dbs.values()].find((d) => d.titulo === "Veredicto · Tareas");
  const tarea = dbT.filas.map((id) => notion.paginas.get(id)).find((p) => p.properties.Nombre.title[0].plain_text === "Meteorología cap. 4");
  assert.equal(tarea.properties.Proyecto.relation[0].id, dbPro.filas[0]);
  // Una segunda pasada sin cambios no reescribe nada.
  const antes = notion.paginas.size;
  await sincronizar(pool, { tz: TZ, notionClient: notion });
  assert.equal(notion.paginas.size, antes);
});

test("Notion: adopta las «TimeMachine - …» del Juez antiguo e importa su historial", { skip: !URL }, async () => {
  const viejo = notionFalso();
  const mk = async (nom, props = {}) => (await viejo.databases.create({ title: [{ text: { content: `TimeMachine - ${nom}` } }], properties: props })).id;
  const ids = {};
  for (const [k, nom] of espejo.BASES) ids[k] = await mk(nom);
  const T = (s) => ({ title: [{ text: { content: s } }] }), R = (s) => ({ rich_text: [{ text: { content: s } }] });
  const pil = (await viejo.pages.create({ parent: { database_id: ids.pilares }, properties: { Nombre: T("Creación") } })).id;
  const pro = (await viejo.pages.create({ parent: { database_id: ids.proyectos }, properties: { Nombre: T("Canal YouTube"), Estado: R("Activo"), Pilar: { relation: [{ id: pil }] } } })).id;
  await viejo.pages.create({ parent: { database_id: ids.tareas }, properties: { Nombre: T("Editar video R22"), Completada: { checkbox: false }, Eisenhower: R("Hacer ya"), "Minutos planificados": { number: 90 }, Proyecto: { relation: [{ id: pro }] } } });
  await viejo.pages.create({ parent: { database_id: ids.sesiones }, properties: { Nombre: T("Editar video R22"), Intervalo: { date: { start: "2026-10-01T10:00:00-03:00", end: "2026-10-01T11:30:00-03:00" } } } });
  await viejo.pages.create({ parent: { database_id: ids.ideas }, properties: { Nombre: T("Serie de carburadores"), Estado: R("Abierta") } });
  const { bases, faltan } = await espejo.adoptar(viejo);
  assert.equal(Object.keys(bases).length, 9);
  assert.deepEqual(faltan, []);
  const r = await espejo.importar(pool, viejo, bases);
  assert.deepEqual([r.pilares, r.proyectos, r.tareas, r.sesiones, r.ideas], [1, 1, 1, 1, 1]);
  const t = (await pool.query("SELECT i.*, p.nombre pro FROM items i JOIN proyectos p ON p.id=i.proyecto_id WHERE i.title='Editar video R22'")).rows[0];
  assert.equal(t.pro, "Canal YouTube");
  assert.equal(t.est_min, 90);
  const s = (await pool.query("SELECT * FROM sessions WHERE source='importado'")).rows[0];
  assert.equal(s.item_id, t.id);
  // Importar dos veces no duplica.
  const r2 = await espejo.importar(pool, viejo, bases);
  assert.equal(r2.tareas + r2.sesiones + r2.proyectos, 0);
});
