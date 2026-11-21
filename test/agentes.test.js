// Agentes: tokens con alcance, cola con prioridad, carriles, WhatsApp primero, aprobación.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate } from "../src/db.js";
import { createApp } from "../src/app.js";
import { setupCode } from "../src/auth.js";
import { setClave } from "../src/cifrado.js";
import { esNoche, sanitizeConfig, DEFAULTS } from "../src/agentes.js";
import { zoned } from "../src/time.js";

const URL = process.env.TEST_DATABASE_URL;
let pool, server, base, cookie = "", agente = "", atajo = "";
const proy = {};

const call = async (path, { method = "GET", body, tok } = {}) => {
  const headers = {};
  if (tok) headers.authorization = `Bearer ${tok}`; else if (cookie) headers.cookie = cookie;
  if (body) headers["content-type"] = "application/json";
  const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie");
  if (sc && sc.startsWith("jdt_sesion=") && !sc.startsWith("jdt_sesion=;")) cookie = sc.split(";")[0];
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, body: ct.includes("json") ? await r.json() : await r.text() };
};
const nueva = (body) => call("/api/agente/tareas", { method: "POST", body, tok: agente }).then((r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.tarea; });

before(async () => {
  if (!URL) return;
  setClave("prueba");
  pool = createPool(URL);
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(pool);
  server = createApp(pool, { tz: "America/Santiago", empujarMs: 60_000 }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const code = await setupCode(pool);
  await call("/api/instalar", { method: "POST", body: { codigo: code, password: "clave-segura" } });
  // Apagada por defecto: sin el módulo no hay tokens de agente ni rutas.
  assert.equal((await call("/api/tokens", { method: "POST", body: { label: "Asistente", alcance: "agente" } })).status, 400);
  assert.equal((await call("/api/infra")).status, 404);
  assert.equal((await call("/api/estado")).body.modulos.infra, false);
  await call("/api/modulos", { method: "PUT", body: { infra: true } });
  agente = (await call("/api/tokens", { method: "POST", body: { label: "Asistente", alcance: "agente" } })).body.token;
  for (const nombre of ["Trabajo", "Personal"]) proy[nombre] = (await call("/api/proyectos", { method: "POST", body: { nombre } })).body.proyecto.id;
  atajo = (await call("/api/tokens", { method: "POST", body: { label: "iPhone" } })).body.token;
});
after(async () => { server?.close(); await pool?.end(); });

test("cada token abre solo lo suyo", { skip: !URL }, async () => {
  assert.match(agente, /^jdg_/);
  assert.equal((await call("/api/agente/contexto", { tok: agente })).status, 200);
  assert.equal((await call("/api/estado", { tok: agente })).status, 403);
  assert.equal((await call("/api/tokens", { tok: agente })).status, 403);
  assert.equal((await call("/api/infra", { tok: agente })).status, 403);
  assert.equal((await call("/api/agente/contexto", { tok: atajo })).status, 403);
  assert.equal((await call("/api/atajo/estado", { tok: atajo })).status, 200);
  assert.equal((await call("/api/atajo/estado", { tok: agente })).status, 403);
});

test("la cola respeta vencimiento, proyecto foco y prioridad", { skip: !URL }, async () => {
  await call("/api/infra/config", { method: "PUT", body: { foco: [proy.Trabajo], noche: { desde: "00:00", hasta: "00:01" }, pausa_conversacion_min: 0 } });
  const p4 = await nueva({ title: "Ordenar carpeta", asignado: "agente", prioridad: 4 });
  const foco = await nueva({ title: "Endpoint de flotas", asignado: "agente", prioridad: 3, proyecto: "Trabajo" });
  const p1 = await nueva({ title: "Borrador post", asignado: "agente", prioridad: 1, proyecto: "Personal" });
  const vence = await nueva({ title: "Informe mensual", asignado: "agente", prioridad: 4, due_date: new Date().toISOString().slice(0, 10) });
  await nueva({ title: "Investigar modelos", asignado: "agente", prioridad: 1, ventana: "noche" });
  await nueva({ title: "Llamar al banco", prioridad: 1 }); // tuya: nunca la toma un agente
  const orden = (await call("/api/agente/tareas?asignado=agente&estado=cola", { tok: agente })).body.map((t) => t.title);
  assert.deepEqual(orden.slice(0, 4), [vence.title, foco.title, p1.title, "Investigar modelos"]);
  assert.equal(orden.at(-1), p4.title);

  const r1 = await call("/api/agente/siguiente", { method: "POST", body: { carril: "local", agente: "worker-local" }, tok: agente });
  assert.equal(r1.body.tarea.title, vence.title);
  assert.equal(r1.body.tarea.estado, "trabajando");
  // Una a la vez por carril.
  assert.equal((await call("/api/agente/siguiente", { method: "POST", body: { carril: "local" }, tok: agente })).body.espera, "ocupado");
  await call(`/api/agente/tareas/${r1.body.tarea.id}`, { method: "PATCH", body: { estado: "revision", resultado: "Listo: informe.md" }, tok: agente });
  // De día no toma la nocturna.
  const r2 = await call("/api/agente/siguiente", { method: "POST", body: { carril: "local" }, tok: agente });
  assert.equal(r2.body.tarea.title, foco.title);
  await call(`/api/agente/tareas/${r2.body.tarea.id}`, { method: "PATCH", body: { estado: "bloqueada", nota: "Falta la API key" }, tok: agente });
  const r3 = await call("/api/agente/siguiente", { method: "POST", body: { carril: "local" }, tok: agente });
  assert.equal(r3.body.tarea.title, p1.title);
});

test("WhatsApp primero: mientras el asistente conversa, el carril local espera", { skip: !URL }, async () => {
  await pool.query("UPDATE items SET agente_estado='cola' WHERE agente_estado='trabajando'");
  await call("/api/agente/conversando", { method: "POST", body: { minutos: 2 }, tok: agente });
  assert.equal((await call("/api/agente/siguiente", { method: "POST", body: { carril: "local" }, tok: agente })).body.espera, "conversacion");
  await call("/api/agente/conversando", { method: "POST", body: { minutos: 0 }, tok: agente });
  assert.ok((await call("/api/agente/siguiente", { method: "POST", body: { carril: "local" }, tok: agente })).body.tarea);
});

test("cloud solo con tu OK", { skip: !URL }, async () => {
  const t = await nueva({ title: "Análisis largo de contratos", asignado: "agente", carril: "cloud", prioridad: 1 });
  assert.equal((await call("/api/agente/siguiente", { method: "POST", body: { carril: "cloud" }, tok: agente })).body.espera, "vacia");
  assert.equal((await call(`/api/agente/tareas/${t.id}`, { method: "PATCH", body: { cloud_ok: true }, tok: agente })).status, 403);
  assert.equal((await call(`/api/agente/tareas/${t.id}`, { method: "PATCH", body: { cloud_ok: true, confirmado_por: "sí, mándala a cloud" }, tok: agente })).status, 200);
  assert.equal((await call("/api/agente/siguiente", { method: "POST", body: { carril: "cloud" }, tok: agente })).body.tarea.id, t.id);
  const h = (await call(`/api/agente/tareas/${t.id}/historial`, { tok: agente })).body;
  assert.ok(h.some((e) => e.tipo === "cloud_ok" && e.texto.includes("mándala")));
});

test("aprobar deja la tarea hecha; contexto e infra", { skip: !URL }, async () => {
  const rev = (await call("/api/agente/tareas?estado=revision", { tok: agente })).body;
  assert.equal(rev.length, 1);
  await call(`/api/agente/tareas/${rev[0].id}`, { method: "PATCH", body: { estado: "aprobada" } });
  const it = (await pool.query("SELECT status, agente_estado FROM items WHERE id=$1", [rev[0].id])).rows[0];
  assert.deepEqual(it, { status: "hecha", agente_estado: "aprobada" });

  const now = Date.now();
  await call("/api/agente/bloques", { method: "POST", body: { title: "Reunión de equipo", inicio: new Date(now - 60_000).toISOString(), fin: new Date(now + 30 * 60_000).toISOString() }, tok: agente });
  const c = (await call("/api/agente/contexto", { tok: agente })).body;
  assert.equal(c.ocupado, true);
  assert.match(c.texto, /Ocupado hasta las \d\d:\d\d: Reunión de equipo/);
  assert.ok(c.mis_tareas.some((t) => t.title === "Llamar al banco"));

  await call("/api/agente/latido", { method: "POST", body: { agente: "worker-local", carril: "local", modelo: "qwen3.5:9b", maquina: "servidor" }, tok: agente });
  const inf = (await call("/api/infra")).body;
  assert.equal(inf.agentes[0].nombre, "worker-local");
  assert.equal(inf.tokens.length, 1);
  assert.ok(inf.eventos.length > 3);
  const s = (await call("/api/estado")).body;
  assert.ok(s.items.some((i) => i.asignado === "agente" && i.carril === "cloud"));
});

test("las tareas abandonadas vuelven a la cola", { skip: !URL }, async () => {
  await pool.query("UPDATE items SET agente_desde = now() - interval '3 hours' WHERE agente_estado='trabajando'");
  await pool.query("DELETE FROM settings WHERE key='conversando_hasta'");
  const r = await call("/api/agente/siguiente", { method: "POST", body: { carril: "local" }, tok: agente });
  assert.ok(r.body.tarea, JSON.stringify(r.body));
});

test("apagar la Infraestructura corta el acceso de los agentes", { skip: !URL }, async () => {
  assert.equal((await call("/api/modulos", { method: "PUT", body: { infra: true }, tok: agente })).status, 403);
  await call("/api/modulos", { method: "PUT", body: { infra: false } });
  assert.equal((await call("/api/agente/contexto", { tok: agente })).status, 404);
  assert.equal((await call("/api/infra")).status, 404);
  await call("/api/modulos", { method: "PUT", body: { infra: true } });
  assert.equal((await call("/api/agente/contexto", { tok: agente })).status, 200);
});

test("ventana nocturna y configuración", () => {
  const c = { ...DEFAULTS, noche: { desde: "23:00", hasta: "07:00" } };
  const tz = "America/Santiago";
  assert.equal(esNoche(zoned(2026, 11, 20, 23, 30, 0, tz), tz, c), true);
  assert.equal(esNoche(zoned(2026, 11, 20, 3, 0, 0, tz), tz, c), true);
  assert.equal(esNoche(zoned(2026, 11, 20, 12, 0, 0, tz), tz, c), false);
  const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222";
  const s = sanitizeConfig({ foco: `${a}, ${b}, ${a}, no-es-un-id`, noche: { desde: "25:00" }, max_por_carril: 99 });
  assert.deepEqual(s.foco, [a, b]);
  assert.equal(s.noche.desde, "00:00");
  assert.equal(s.max_por_carril, 5);
});

test("proyecto por nombre, Eisenhower «Delegar» y error claro si no existe", { skip: !URL }, async () => {
  const t = await nueva({ title: "Ordenar facturas", asignado: "agente", proyecto: "trabajo" });
  assert.equal(t.proyecto, "Trabajo");
  assert.equal(t.eisenhower, "Delegar");
  const r = await call("/api/agente/tareas", { method: "POST", body: { title: "X", asignado: "agente", proyecto: "Inexistente" }, tok: agente });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /No encontré el proyecto «Inexistente»\. Proyectos: Personal, Trabajo/);
});

test("MCP: disponibilidad siempre; herramientas de agentes solo con Infraestructura", { skip: !URL }, async () => {
  const rpc = (method, params = {}, tok = agente) => call("/mcp", { method: "POST", body: { jsonrpc: "2.0", id: 1, method, params }, tok }).then((r) => r.body.result);
  let tools = (await rpc("tools/list")).tools.map((t) => t.name);
  assert.ok(tools.includes("disponibilidad") && tools.includes("delegar") && tools.includes("estado"));
  const d = await rpc("tools/call", { name: "delegar", arguments: { titulo: "Investigar proveedores", proyecto: "Personal", cloud: true } });
  assert.match(d.content[0].text, /En la cola de agentes: \[[0-9a-f]{6}\] Investigar proveedores \[Personal\].*cloud sin autorizar/);
  const sinOk = await rpc("tools/call", { name: "autorizar_cloud", arguments: { tarea: "Investigar proveedores", respuesta_textual: "" } });
  assert.equal(sinOk.isError, true);
  const ok = await rpc("tools/call", { name: "autorizar_cloud", arguments: { tarea: "Investigar proveedores", respuesta_textual: "sí, dale con cloud" } });
  assert.equal(ok.isError, false);
  assert.match((await rpc("tools/call", { name: "cola_agentes", arguments: {} })).content[0].text, /Investigar proveedores.*cloud ✓/);
  assert.match((await rpc("tools/call", { name: "disponibilidad", arguments: {} })).content[0].text, /Ocupado|Libre/);
  await call("/api/modulos", { method: "PUT", body: { infra: false } });
  tools = (await rpc("tools/list", {}, atajo)).tools.map((t) => t.name);
  assert.ok(tools.includes("disponibilidad") && !tools.includes("delegar"));
  const apagado = await call("/mcp", { method: "POST", body: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "delegar", arguments: { titulo: "x" } } }, tok: atajo });
  assert.match(apagado.body.error.message, /desconocida: delegar/);
  await call("/api/modulos", { method: "PUT", body: { infra: true } });
});
