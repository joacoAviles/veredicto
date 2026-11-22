// Carpeta sincronizada: el cliente Python real contra el servidor real, en una carpeta temporal.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, migrate } from "../src/db.js";
import { createApp } from "../src/app.js";
import { setupCode } from "../src/auth.js";
import { setClave } from "../src/cifrado.js";

const URL = process.env.TEST_DATABASE_URL;
const run = promisify(execFile);
// Como en un Mac con proxy del sistema: el cliente debe ir directo a un Veredicto local, nunca por el proxy.
const SIN_PROXY_LOCAL = { HTTP_PROXY: "http://127.0.0.1:9", http_proxy: "http://127.0.0.1:9", NO_PROXY: "", no_proxy: "" };
// El cliente da prioridad a VEREDICTO_URL / VEREDICTO_TOKEN_CARPETA / VEREDICTO_CARPETA del entorno.
// En un equipo con Veredicto configurado (p. ej. un agente con VEREDICTO_URL) la prueba hablaría con ese
// servidor real: se quitan para que solo cuente la configuración de la prueba.
const ENTORNO = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^VEREDICTO_(URL|TOKEN_CARPETA|CARPETA)$/.test(k)));
const CLIENTE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "integraciones", "carpeta", "veredicto-carpeta.py");
let pool, server, base, cookie = "", token = "", dir, cfg;

const call = async (p, { method = "GET", body, tok } = {}) => {
  const headers = {};
  if (tok) headers.authorization = `Bearer ${tok}`; else if (cookie) headers.cookie = cookie;
  if (body) headers["content-type"] = "application/json";
  const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie");
  if (sc && sc.startsWith("jdt_sesion=") && !sc.startsWith("jdt_sesion=;")) cookie = sc.split(";")[0];
  return { status: r.status, body: await r.json().catch(() => null) };
};
const cliente = (...args) => run("python3", [CLIENTE, ...args], { env: { ...ENTORNO, ...SIN_PROXY_LOCAL, VEREDICTO_CARPETA_CONFIG: cfg } });
const archivo = () => readFile(path.join(dir, "Pendientes.md"), "utf8");
const nombreProyecto = async (id) => (await call("/api/estado")).body.proyectos.find((p) => p.id === id)?.nombre;
const pendientes = async () => (await call("/api/estado")).body.items.filter((i) => i.kind === "tarea" && i.status !== "hecha");

before(async () => {
  if (!URL) return;
  setClave("prueba");
  pool = createPool(URL);
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(pool);
  server = createApp(pool, { tz: "America/Santiago", empujarMs: 60_000 }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await call("/api/instalar", { method: "POST", body: { codigo: await setupCode(pool), password: "clave-segura" } });
  token = (await call("/api/tokens", { method: "POST", body: { label: "MacBook", alcance: "carpeta" } })).body.token;
  dir = await mkdtemp(path.join(tmpdir(), "vd-carpeta-"));
  cfg = path.join(dir, "..", path.basename(dir) + "-config.json");
  await call("/api/items", { method: "POST", body: { title: "Pagar patente", due_date: "2026-11-30" } });
  await call("/api/items", { method: "POST", body: { title: "Renovar dominio" } });
});
after(async () => { server?.close(); await pool?.end(); });

test("el token de carpeta solo abre la carpeta", { skip: !URL }, async () => {
  assert.match(token, /^jdc_/);
  assert.equal((await call("/api/carpeta/pendientes", { tok: token })).status, 200);
  assert.equal((await call("/api/estado", { tok: token })).status, 403);
  assert.equal((await call("/api/atajo/estado", { tok: token })).status, 403);
});

test("configurar escribe Pendientes.md con las tareas del servidor", { skip: !URL }, async () => {
  await cliente("configurar", "--url", base, "--token", token, "--carpeta", dir);
  const md = await archivo();
  assert.match(md, /^# Tareas pendientes/);
  assert.match(md, /- \[ \] Pagar patente 📅 2026-11-30 \^vd-[0-9a-f]{8}/);
  assert.match(md, /- \[ \] Renovar dominio \^vd-[0-9a-f]{8}/);
});

test("marcar, renombrar y agregar en el archivo llega a Veredicto", { skip: !URL }, async () => {
  let md = await archivo();
  md = md.replace(/- \[ \] Pagar patente/, "- [x] Pagar patente").replace("Renovar dominio", "Renovar dominio aviles.cl");
  md += "\n## Trabajo\n- [ ] Revisar facturas [Hacer ya] 📅 2026-12-01\n";
  await writeFile(path.join(dir, "Pendientes.md"), md);
  await cliente();
  const xs = await pendientes();
  assert.deepEqual(xs.map((i) => i.title).sort(), ["Renovar dominio aviles.cl", "Revisar facturas"]);
  const f = xs.find((i) => i.title === "Revisar facturas");
  assert.equal(await nombreProyecto(f.proyecto_id), "Trabajo");
  assert.equal(f.eisenhower, "Hacer ya");
  assert.equal(f.due_date, "2026-12-01");
  md = await archivo();
  assert.doesNotMatch(md, /Pagar patente/);
  assert.match(md, /## Trabajo\n- \[ \] Revisar facturas \[Hacer ya\] 📅 2026-12-01 \^vd-/);
  // Una segunda pasada sin cambios no crea nada ni reescribe.
  const antes = md;
  await cliente();
  assert.equal((await pendientes()).length, 2);
  assert.equal(await archivo(), antes);
});

test("lo que cambia en Veredicto aparece en el archivo", { skip: !URL }, async () => {
  const x = (await pendientes()).find((i) => i.title === "Renovar dominio aviles.cl");
  await call(`/api/items/${x.id}`, { method: "PATCH", body: { status: "hecha" } });
  await call("/api/items", { method: "POST", body: { title: "Llamar al contador" } });
  await cliente();
  const md = await archivo();
  assert.doesNotMatch(md, /Renovar dominio/);
  assert.match(md, /Llamar al contador/);
});

test("un archivo por proyecto", { skip: !URL }, async () => {
  const d2 = await mkdtemp(path.join(tmpdir(), "vd-proyectos-"));
  await run("python3", [CLIENTE, "configurar", "--url", base, "--token", token, "--carpeta", d2, "--por-proyecto"], { env: { ...ENTORNO, ...SIN_PROXY_LOCAL, VEREDICTO_CARPETA_CONFIG: cfg + "2" } });
  const files = (await readdir(d2)).filter((f) => f.endsWith(".md")).sort();
  assert.deepEqual(files, ["Sin proyecto.md", "Trabajo.md"]);
  await writeFile(path.join(d2, "Casa.md"), "# Casa\n\n- [ ] Pagar cuota\n");
  await run("python3", [CLIENTE], { env: { ...ENTORNO, ...SIN_PROXY_LOCAL, VEREDICTO_CARPETA_CONFIG: cfg + "2" } });
  const t = (await pendientes()).find((i) => i.title === "Pagar cuota");
  assert.equal(await nombreProyecto(t.proyecto_id), "Casa");
  assert.match(await readFile(path.join(d2, "Casa.md"), "utf8"), /Pagar cuota \^vd-/);
});
