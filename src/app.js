// Rutas HTTP. Una sola verdad: PostgreSQL. Las pantallas y los atajos solo leen y piden cambios.
import express from "express";
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { tx, getSetting, setSetting, log } from "./db.js";
import * as core from "./core.js";
import * as auth from "./auth.js";
import { buildState, currentSession, agendaRange } from "./estado.js";
import { bus, changed, armarHoy } from "./servicios.js";
import { refreshCalendars, buildICS } from "./conectores/ical.js";
import { cifrar, descifrar } from "./cifrado.js";
import { sincronizar, empujar, CALENDARIO, cuentaConfig } from "./sync/motor.js";
import { authUrl, exchange, redirectUri } from "./sync/oauth.js";
import * as caldavA from "./sync/caldav.js";
import * as markdownA from "./sync/markdown.js";
import * as notionA from "./sync/notion.js";
import { enviar } from "./conectores/avisos.js";
import { DEFAULTS, vigilar, construirAviso, entregar } from "./vigilante.js";
import { EVENTOS, ACCIONES, VARIABLES, merge, equipo, sanitize as sanitizePlantillas } from "./plantillas.js";
import { getPrediccion, habitosConModo, sanitizePred, modoDe } from "./prediccion.js";
import { fmtDur, fmtHora, isValidZone, startOfDay, addDays } from "./time.js";
import * as proyectos from "./proyectos.js";
import * as espejo from "./sync/espejo.js";
import * as aw from "./sync/activitywatch.js";
import * as demo from "./demo.js";
import { mcpRouter } from "./mcp.js";
import * as agentes from "./agentes.js";
import * as carpeta from "./carpeta.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// Si existe un archivo (sin lanzar error).
const exists = (p) => access(p).then(() => true, () => false);

// Arma la app Express: autenticación, API, atajos, sincronización, MCP y archivos públicos.
export function createApp(pool, opts = {}) {
  const cfg = {
    tz: opts.tz || "America/Santiago",
    publicUrl: opts.publicUrl || "",
    nombre: opts.nombre || "Veredicto",
    theme: opts.theme || "neutro",
    themeDir: opts.themeDir || "",
    notasDir: opts.notasDir || "/datos/notas",
    secureCookie: opts.secureCookie, // sin definir: Secure solo si la petición llegó por https (túnel o proxy)
    version: opts.version || "",
    fetcher: opts.fetcher || fetch,
    send: opts.send || enviar,
    notionClient: opts.notionClient || null,
    empujarMs: opts.empujarMs ?? 1000,
  };
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback, linklocal, uniquelocal"); // el túnel o tu proxy en la red de Docker
  app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.use(express.json({ limit: "200kb" }));
  app.use(express.text({ type: ["text/plain"], limit: "200kb" }));
  app.use(express.urlencoded({ extended: false, limit: "200kb" }));
  // Los atajos de iPhone a veces mandan el texto como "archivo": se acepta cualquier tipo.
  app.use("/api/atajo", express.text({ type: () => true, limit: "200kb" }));

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const need = wrap(async (req, res, next) => {
    const who = await auth.identify(pool, req);
    if (!who) return res.status(401).json({ error: "Inicia sesión." });
    // Cada token abre solo lo suyo: si se filtra, no abre tus cuentas ni tus ajustes.
    //   atajo   (Siri, reloj, asistente MCP) → /api/atajo/… y /mcp
    //   agente  (Hermes u otro agente)       → /api/agente/… y /mcp
    //   carpeta (carpeta sincronizada)       → /api/carpeta/…
    if (who.via === "token") {
      const ruta = req.originalUrl.split("?")[0];
      const ok = { atajo: ruta.startsWith("/api/atajo/") || ruta === "/mcp", agente: ruta.startsWith("/api/agente/") || ruta === "/mcp", carpeta: ruta.startsWith("/api/carpeta/") }[who.alcance || "atajo"];
      if (!ok) return res.status(403).json({ error: { atajo: "Este token solo sirve para atajos y para tu asistente (MCP).", agente: "Este token solo sirve para agentes (y MCP).", carpeta: "Este token solo sirve para la carpeta sincronizada." }[who.alcance || "atajo"] });
    }
    req.who = who;
    next();
  });
  // Ids mal formados: 404 en vez de un error de base de datos.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  app.param("id", (req, res, next, id) => (UUID.test(id) || /^\d+$/.test(id) ? next() : res.status(404).json({ error: "No existe." })));

  // Intentos de entrada: 8 fallidos por IP en 15 minutos y se bloquea un rato.
  const fallos = new Map();
  const bloqueado = (ip) => { const f = fallos.get(ip); return f && f.n >= 8 && Date.now() - f.t < 15 * 60_000; };
  const fallo = (ip) => { const f = fallos.get(ip); fallos.set(ip, f && Date.now() - f.t < 15 * 60_000 ? { n: f.n + 1, t: f.t } : { n: 1, t: Date.now() }); };
  const st = () => buildState(pool, { tz: cfg.tz });
  // Tras cada cambio, la cola sale a tus cuentas en ~1 s (sin esperar la pasada de 2 minutos).
  let empujando = null;
  const empujarPronto = () => { clearTimeout(empujando); empujando = setTimeout(() => empujar(pool, { tz: cfg.tz, fetcher: cfg.fetcher, notionClient: cfg.notionClient }).then((r) => { if (r.ok || r.err) changed("sync"); }, () => {}), cfg.empujarMs); empujando.unref?.(); };
  const done = async (res, extra = {}) => { changed(); empujarPronto(); res.json({ ok: true, ...extra, estado: await st() }); };

  // ---------- Plantilla visual ----------
  app.get("/theme.css", wrap(async (req, res) => {
    const own = cfg.themeDir && path.join(cfg.themeDir, "tema.css");
    const file = own && (await exists(own)) ? own : path.join(root, "themes", `${cfg.theme.replace(/[^a-z0-9_-]/gi, "")}.css`);
    const css = (await exists(file)) ? await readFile(file, "utf8") : await readFile(path.join(root, "themes", "neutro.css"), "utf8");
    res.type("text/css").setHeader("Cache-Control", "no-cache");
    res.send(css);
  }));
  const page = async (name) => (await readFile(path.join(root, "public", name), "utf8")).replaceAll("{{NOMBRE}}", escapeHtml(cfg.nombre));
  app.get(["/", "/index.html"], wrap(async (req, res) => { res.setHeader("Cache-Control", "no-cache"); res.type("html").send(await page("index.html")); }));
  app.get("/manifest.webmanifest", wrap(async (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.type("application/manifest+json").send(await page("manifest.webmanifest"));
  }));
  // Íconos: si tu carpeta de tema trae icono.svg / icono-180.png / icono-192.png / icono-512.png, se usan esos.
  app.get(/^\/icono(-base|-180|-192|-512)?\.(svg|png)$/, wrap(async (req, res, next) => {
    const name = req.path.slice(1).replace("-base", "");
    const custom = cfg.themeDir ? path.join(cfg.themeDir, name) : "/nonexistent";
    const builtin = path.join(root, "public", req.path.endsWith(".svg") ? "icono-base.svg" : name);
    res.setHeader("Cache-Control", "no-cache");
    if (await exists(custom)) return res.sendFile(custom);
    if (await exists(builtin)) return res.sendFile(builtin);
    next();
  }));
  // Archivos de tu tema (letras, imágenes): /tema/…
  if (cfg.themeDir) app.use("/tema", express.static(cfg.themeDir, { index: false, dotfiles: "deny", maxAge: "1h" }));
  app.use(express.static(path.join(root, "public"), { index: false, setHeaders: (res) => res.setHeader("Cache-Control", "no-cache") }));

  // ---------- Cuenta ----------
  app.get("/api/sesion", wrap(async (req, res) => {
    const cuenta = !!(await getSetting(pool, "cuenta"));
    const who = await auth.identify(pool, req);
    res.json({ cuenta, dentro: !!who, nombre: cfg.nombre, tz: cfg.tz, onboarding: (await getSetting(pool, "onboarding")) || null });
  }));
  app.post("/api/instalar", wrap(async (req, res) => {
    if (bloqueado(req.ip)) return res.status(429).json({ error: "Demasiados intentos. Espera 15 minutos." });
    try { await auth.createAccount(pool, { password: req.body.password, codigo: req.body.codigo }); }
    catch (e) { if (e.status === 403) fallo(req.ip); throw e; }
    const token = await auth.login(pool, req.body.password, req.get("user-agent"));
    auth.setCookie(res, token, cfg.secureCookie ?? req.secure);
    res.json({ ok: true });
  }));
  app.post("/api/entrar", wrap(async (req, res) => {
    if (bloqueado(req.ip)) return res.status(429).json({ error: "Demasiados intentos. Espera 15 minutos." });
    await new Promise((r) => setTimeout(r, 300));
    const token = await auth.login(pool, req.body.password, req.get("user-agent"));
    if (!token) { fallo(req.ip); return res.status(401).json({ error: "Contraseña incorrecta." }); }
    fallos.delete(req.ip);
    auth.setCookie(res, token, cfg.secureCookie ?? req.secure);
    res.json({ ok: true });
  }));
  app.post("/api/salir", wrap(async (req, res) => { await auth.logout(pool, req); auth.clearCookie(res); res.json({ ok: true }); }));

  // ---------- Estado en vivo ----------
  app.get("/api/estado", need, wrap(async (req, res) => res.json(await st())));
  app.get("/api/eventos", need, (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 3000\n\n");
    const on = (w) => res.write(`event: cambio\ndata: ${JSON.stringify(w)}\n\n`);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    bus.on("cambio", on);
    req.on("close", () => { clearInterval(ping); bus.off("cambio", on); });
  });

  // ---------- Temporizador ----------
  const timer = (fn) => wrap(async (req, res) => {
    const r = await tx(pool, async (q) => { await core.lockTimer(q); return fn(q, req); });
    await done(res, { resultado: r });
  });
  app.post("/api/iniciar", need, timer(async (q, req) => {
    const r = await core.start(q, { itemId: req.body.item_id || null, title: req.body.title || null, source: req.body.source || "app" });
    if (req.body.proyecto_id && !r.item.proyecto_id) await proyectos.asignar(q, r.item.id, req.body.proyecto_id);
    return r;
  }));
  app.post("/api/parar", need, timer((q) => core.stop(q)));
  app.post("/api/pausar", need, timer((q) => core.pause(q)));
  app.post("/api/seguir", need, timer((q) => core.resume(q)));
  app.post("/api/registrar", need, wrap(async (req, res) => {
    // Registrar algo que ya pasó (olvidé iniciar el temporizador).
    const { title, item_id, inicio, fin } = req.body;
    const a = new Date(inicio), b = new Date(fin);
    if (!(a < b) || b > new Date(Date.now() + 60_000)) throw new core.HttpError(400, "Revisa las horas.");
    await tx(pool, async (q) => {
      const item = item_id ? (await q.query("SELECT * FROM items WHERE id=$1", [item_id])).rows[0] : (await core.findItem(q, title)) || (await core.createItem(q, { title }));
      if (!item) throw new core.HttpError(404, "No encontré esa tarea.");
      const s = (await q.query("INSERT INTO sessions(item_id,title,state,started_at,ended_at,source) VALUES ($1,$2,'done',$3,$4,'manual') RETURNING id", [item.id, item.title, a, b])).rows[0];
      await q.query("INSERT INTO segments(session_id,started_at,ended_at) VALUES ($1,$2,$3)", [s.id, a, b]);
      await core.enqueue(q, "sesion_cal", s.id);
    });
    await done(res);
  }));
  app.delete("/api/sesiones/:id", need, wrap(async (req, res) => {
    await tx(pool, async (q) => {
      const r = await q.query("DELETE FROM sessions WHERE id=$1 AND state='done' RETURNING cal_ref", [req.params.id]);
      if (r.rows[0]?.cal_ref?.href) await core.enqueue(q, "sesion_cal", null, { borrar: r.rows[0].cal_ref });
    });
    await done(res);
  }));

  // ---------- Tareas y rutinas ----------
  app.post("/api/items", need, wrap(async (req, res) => {
    const it = await tx(pool, (q) => core.createItem(q, req.body));
    await done(res, { item: it });
  }));
  app.patch("/api/items/:id", need, wrap(async (req, res) => {
    await tx(pool, async (q) => { await core.lockTimer(q); return core.updateItem(q, req.params.id, req.body); });
    await done(res);
  }));

  // ---------- Bandeja: capturas y notas ----------
  app.post("/api/capturas", need, wrap(async (req, res) => {
    const c = await tx(pool, (q) => core.capture(q, { text: req.body.text, kind: req.body.kind, source: req.body.source || "app" }));
    await done(res, { captura: c });
  }));
  app.patch("/api/capturas/:id", need, wrap(async (req, res) => {
    const status = req.body.status === "procesada" ? "procesada" : "abierta";
    await tx(pool, async (q) => {
      await q.query("UPDATE captures SET status=$2, updated_at=now() WHERE id=$1", [req.params.id, status]);
    });
    await done(res);
  }));
  app.post("/api/capturas/:id/tarea", need, wrap(async (req, res) => {
    await tx(pool, async (q) => {
      const c = (await q.query("SELECT * FROM captures WHERE id=$1", [req.params.id])).rows[0];
      if (!c) throw new core.HttpError(404, "No existe.");
      await core.createItem(q, { title: c.text });
      await q.query("UPDATE captures SET status='procesada', updated_at=now() WHERE id=$1", [c.id]);
    });
    await done(res);
  }));
  // Compartir desde Android (PWA share target) cae aquí.
  app.post("/compartir", wrap(async (req, res) => {
    if (!(await auth.identify(pool, req))) return res.redirect(303, "/");
    const text = [req.body.title, req.body.text, req.body.url].filter(Boolean).join("\n");
    if (text.trim()) { await tx(pool, (q) => core.capture(q, { text, source: "compartir" })); changed(); }
    res.redirect(303, "/#gestiones");
  }));

  // ---------- Agenda ----------
  app.post("/api/bloques", need, wrap(async (req, res) => {
    await tx(pool, (q) => core.addBlock(q, { itemId: req.body.item_id || null, title: req.body.title, starts_at: req.body.inicio, ends_at: req.body.fin }));
    await done(res);
  }));
  app.patch("/api/bloques/:id", need, wrap(async (req, res) => {
    await tx(pool, (q) => core.updateBlock(q, req.params.id, { title: req.body.title, starts_at: req.body.inicio, ends_at: req.body.fin }));
    await done(res);
    syncPronto();
  }));
  app.delete("/api/bloques/:id", need, wrap(async (req, res) => {
    await tx(pool, (q) => core.updateBlock(q, req.params.id, { borrar: true }));
    await done(res);
    syncPronto();
  }));
  app.patch("/api/eventos", need, wrap(async (req, res) => {
    await tx(pool, (q) => core.updateEvento(q, req.body.calendar_id, req.body.uid, { title: req.body.title, starts_at: req.body.inicio, ends_at: req.body.fin }));
    await done(res);
    syncPronto();
  }));
  app.get("/api/agenda", need, wrap(async (req, res) => {
    const dias = Math.min(14, Math.max(1, Number(req.query.dias) || 7));
    const desde = req.query.desde ? Number(req.query.desde) : startOfDay(Date.now(), cfg.tz);
    res.json(await agendaRange(pool, desde, addDays(desde, dias, cfg.tz)));
  }));
  app.get("/api/armar", need, wrap(async (req, res) => res.json(await armarHoy(pool, cfg.tz))));
  app.post("/api/armar", need, wrap(async (req, res) => { const r = await armarHoy(pool, cfg.tz, { aplicar: true }); await done(res, r); }));
  app.get("/api/registro", need, wrap(async (req, res) => {
    const dias = Math.min(60, Math.max(1, Number(req.query.dias) || 7));
    const desde = addDays(startOfDay(Date.now(), cfg.tz), -(dias - 1), cfg.tz);
    const r = await pool.query(
      `SELECT s.id, s.title, s.source, s.started_at, s.ended_at, i.proyecto_id,
         (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(g.ended_at, now())-g.started_at))),0) FROM segments g WHERE g.session_id=s.id)*1000 AS ms
       FROM sessions s LEFT JOIN items i ON i.id=s.item_id WHERE s.started_at >= $1 ORDER BY s.started_at DESC`, [new Date(desde)]);
    res.json(r.rows.map((x) => ({ id: x.id, title: x.title, source: x.source, start: +x.started_at, end: x.ended_at ? +x.ended_at : null, ms: Number(x.ms), proyecto_id: x.proyecto_id || null })));
  }));

  // ---------- Conexiones: calendarios ----------
  app.post("/api/calendarios", need, wrap(async (req, res) => {
    const url = String(req.body.url || "").trim();
    if (!/^(https?|webcal):\/\//i.test(url)) throw new core.HttpError(400, "Pega el enlace iCal secreto (empieza con https:// o webcal://).");
    await pool.query("INSERT INTO calendars(name,url) VALUES ($1,$2)", [String(req.body.name || "Calendario").slice(0, 80), url]);
    await refreshCalendars(pool, cfg.tz, { fetcher: cfg.fetcher });
    await done(res);
  }));
  app.delete("/api/calendarios/:id", need, wrap(async (req, res) => { await pool.query("DELETE FROM calendars WHERE id=$1", [req.params.id]); await done(res); }));
  app.post("/api/calendarios/refrescar", need, wrap(async (req, res) => {
    await refreshCalendars(pool, cfg.tz, { fetcher: cfg.fetcher });
    const r = await sincronizar(pool, syncOpts());
    await done(res, { sync: r });
  }));
  app.get("/api/feed", need, wrap(async (req, res) => {
    let s = await getSetting(pool, "feed_secreto");
    if (!s || req.query.nuevo) { s = randomBytes(18).toString("base64url"); await setSetting(pool, "feed_secreto", s); }
    res.json({ url: `${cfg.publicUrl.replace(/\/$/, "")}/cal/${s}.ics` });
  }));
  app.get("/cal/:s.ics", wrap(async (req, res) => {
    const s = await getSetting(pool, "feed_secreto");
    if (!s || req.params.s !== s) return res.status(404).end();
    const from = new Date(Date.now() - 30 * 86_400_000), to = new Date(Date.now() + 14 * 86_400_000);
    const blocks = (await pool.query("SELECT id,title,starts_at,ends_at FROM blocks WHERE borrado IS NULL AND starts_at BETWEEN $1 AND $2", [from, to])).rows;
    const sessions = (await pool.query("SELECT id,title,started_at,ended_at FROM sessions WHERE state='done' AND started_at BETWEEN $1 AND $2", [from, to])).rows;
    res.type("text/calendar").send(buildICS({
      name: cfg.nombre,
      blocks: blocks.map((b) => ({ ...b, starts_at: +b.starts_at, ends_at: +b.ends_at })),
      sessions: sessions.map((x) => ({ ...x, started_at: +x.started_at, ended_at: +x.ended_at })),
    }));
  }));

  // ---------- Cuentas conectadas (sincronización en ambos sentidos) ----------
  const syncOpts = () => ({ tz: cfg.tz, fetcher: cfg.fetcher, notionClient: cfg.notionClient });
  let pronto = null;
  const syncPronto = () => { clearTimeout(pronto); pronto = setTimeout(() => sincronizar(pool, syncOpts()).then(() => changed("sync"), () => {}), 1500); };
  const NOMBRES = { plan: "Veredicto · Plan", registrado: "Veredicto · Registrado" };

  async function guardarCalendarios(cuentaId, lista) {
    for (const c of lista)
      await pool.query(
        `INSERT INTO calendars(name, cuenta_id, remote_id, color, editable, rol) VALUES ($1,$2,$3,$4,$5,'leer')
         ON CONFLICT (cuenta_id, remote_id) WHERE cuenta_id IS NOT NULL DO UPDATE SET name=$1, color=$4, editable=$5`,
        [String(c.nombre).slice(0, 120), cuentaId, c.remote_id, c.color, !!c.editable],
      );
  }
  const descifrarSeguro = (x) => { try { return descifrar(x) || {}; } catch { return {}; } };
  async function nuevaCuenta(tipo, nombre, config, activa = true) {
    return (await pool.query("INSERT INTO cuentas(tipo,nombre,config,activa) VALUES ($1,$2,$3,$4) RETURNING id", [tipo, String(nombre).slice(0, 80), cifrar(config), activa])).rows[0].id;
  }

  app.get("/api/cuentas", need, wrap(async (req, res) => {
    const cuentas = (await pool.query("SELECT id,tipo,nombre,activa,ultimo_ok,ultimo_error,error_desde,creada FROM cuentas ORDER BY creada")).rows;
    const cals = (await pool.query("SELECT id,name,cuenta_id,remote_id,rol,color,editable,last_ok_at,last_error FROM calendars ORDER BY name")).rows;
    const notas = (await pool.query("SELECT cuenta_id, count(*)::int n, sum(abiertas)::int abiertas FROM notas_estado GROUP BY cuenta_id")).rows;
    res.json({
      cuentas: await Promise.all(cuentas.map(async (c) => {
        let espejo_ = null;
        if (c.tipo === "notion") {
          const conf = descifrarSeguro((await pool.query("SELECT config FROM cuentas WHERE id=$1", [c.id])).rows[0].config);
          espejo_ = { flujo: !!conf.flujo, guia: !!conf.guia, modo: conf.espejo?.modo || null, bases: Object.keys(conf.espejo?.bases || {}).length };
        }
        return { ...c, calendarios: cals.filter((x) => x.cuenta_id === c.id), notas: notas.find((n) => n.cuenta_id === c.id) || { n: 0, abiertas: 0 }, espejo: espejo_ };
      })),
      importacion: (await getSetting(pool, "notion_importacion")) || null,
      ical: cals.filter((x) => !x.cuenta_id),
      bandeja: (await getSetting(pool, "bandeja_cuenta")) || null,
      redirect: { google: cfg.publicUrl ? redirectUri(cfg.publicUrl, "google") : null, outlook: cfg.publicUrl ? redirectUri(cfg.publicUrl, "outlook") : null },
      carpeta_notas: cfg.notasDir,
    });
  }));

  // iCloud y cualquier servidor CalDAV: usuario + contraseña de app.
  app.post("/api/cuentas/caldav", need, wrap(async (req, res) => {
    const conf = { url: String(req.body.url || caldavA.ICLOUD).trim(), usuario: String(req.body.usuario || "").trim(), clave: String(req.body.clave || "").replace(/\s+/g, "") };
    if (!conf.usuario || !conf.clave) throw new core.HttpError(400, "Falta el usuario o la contraseña de app.");
    let lista;
    try { lista = await caldavA.listCalendars(conf, { fetcher: cfg.fetcher }); }
    catch (e) { throw new core.HttpError(400, e.status === 401 ? "Usuario o contraseña de app incorrectos. En iCloud usa una contraseña de app, no la de tu Apple ID." : `No pude conectar: ${e.message}`); }
    conf.home = lista.home;
    const id = await nuevaCuenta("caldav", req.body.nombre || (/icloud/.test(conf.url) ? "iCloud" : "CalDAV"), conf);
    await guardarCalendarios(id, lista.calendarios);
    await done(res, { cuenta: id });
    syncPronto();
  }));

  // Google y Outlook: tu propio cliente OAuth. Paso 1: guardar cliente y pedir permiso.
  app.post("/api/cuentas/:tipo(google|outlook)/oauth", need, wrap(async (req, res) => {
    if (!cfg.publicUrl) throw new core.HttpError(400, "Define URL_PUBLICA en .env: el permiso vuelve a esa dirección.");
    const client_id = String(req.body.client_id || "").trim(), client_secret = String(req.body.client_secret || "").trim();
    if (!client_id || !client_secret) throw new core.HttpError(400, "Faltan el ID y el secreto del cliente.");
    const tipo = req.params.tipo;
    const id = await nuevaCuenta(tipo, tipo === "google" ? "Google" : "Outlook", { client_id, client_secret }, false);
    const state = auth.signAction(await auth.secret(pool), "oauth", { cuenta: id }, 30 * 60_000);
    res.json({ url: authUrl(tipo, { client_id, redirect: redirectUri(cfg.publicUrl, tipo), state }) });
  }));
  // Paso 2: el proveedor vuelve aquí con el código.
  app.get("/oauth/:tipo(google|outlook)", wrap(async (req, res) => {
    const volver = (msg) => res.redirect(303, `/#ajustes?${new URLSearchParams({ aviso: msg })}`);
    if (req.query.error) return volver(`El proveedor dijo: ${req.query.error}`);
    const d = auth.verifyAction(await auth.secret(pool), req.query.state);
    if (!d || d.a !== "oauth") return volver("El permiso venció. Vuelve a intentarlo.");
    const cuenta = (await pool.query("SELECT * FROM cuentas WHERE id=$1", [d.p.cuenta])).rows[0];
    if (!cuenta) return volver("Esa conexión ya no existe.");
    try {
      const { cfg: c } = await cuentaConfig(pool, cuenta);
      const tok = await exchange(req.params.tipo, { ...c, code: String(req.query.code || ""), redirect: redirectUri(cfg.publicUrl, req.params.tipo) }, cfg.fetcher);
      const conf = { ...c, ...tok };
      const lista = await CALENDARIO[req.params.tipo].listCalendars(conf, { fetcher: cfg.fetcher });
      await pool.query("UPDATE cuentas SET config=$2, activa=true WHERE id=$1", [cuenta.id, cifrar(conf)]);
      await guardarCalendarios(cuenta.id, lista.calendarios);
      changed();
      syncPronto();
      volver(`${cuenta.nombre} conectado: ${lista.calendarios.length} calendarios.`);
    } catch (e) {
      volver(`No se pudo conectar: ${e.message}`);
    }
  }));

  app.post("/api/cuentas/markdown", need, wrap(async (req, res) => {
    const conf = { carpeta: path.resolve(String(req.body.carpeta || cfg.notasDir).trim()) };
    try { await markdownA.verificar(conf); } catch (e) { throw new core.HttpError(400, e.message); }
    const id = await nuevaCuenta("markdown", req.body.nombre || "Notas", conf);
    if (!(await getSetting(pool, "bandeja_cuenta"))) await setSetting(pool, "bandeja_cuenta", id);
    await done(res, { cuenta: id });
    syncPronto();
  }));
  app.post("/api/cuentas/notion", need, wrap(async (req, res) => {
    const conf = { token: String(req.body.token || "").trim(), raiz: String(req.body.pagina || "").trim() };
    if (!conf.token) throw new core.HttpError(400, "Falta el token de la integración.");
    try { conf.raiz = await notionA.verificar(conf, cfg.notionClient || notionA.cliente(conf)); } catch (e) { throw new core.HttpError(400, e.message); }
    const id = await nuevaCuenta("notion", "Notion", conf);
    if (!(await getSetting(pool, "bandeja_cuenta"))) await setSetting(pool, "bandeja_cuenta", id);
    await done(res, { cuenta: id });
    syncPronto();
  }));
  app.delete("/api/cuentas/:id", need, wrap(async (req, res) => {
    await pool.query("UPDATE items SET status='archivada' WHERE cuenta_id=$1", [req.params.id]);
    await pool.query("UPDATE blocks SET calendar_id=NULL, remote_uid=NULL, href=NULL, etag=NULL WHERE calendar_id IN (SELECT id FROM calendars WHERE cuenta_id=$1)", [req.params.id]);
    await pool.query("DELETE FROM cuentas WHERE id=$1", [req.params.id]);
    if ((await getSetting(pool, "bandeja_cuenta")) === req.params.id) await pool.query("DELETE FROM settings WHERE key='bandeja_cuenta'");
    await done(res);
  }));
  // Qué hace cada calendario: leer, plan (tus bloques), registrado (lo medido) u oculto.
  app.patch("/api/calendarios/:id", need, wrap(async (req, res) => {
    const rol = req.body.rol;
    if (!["leer", "plan", "registrado", "oculto"].includes(rol)) throw new core.HttpError(400, "Rol no válido.");
    const c = (await pool.query("SELECT * FROM calendars WHERE id=$1", [req.params.id])).rows[0];
    if (!c?.cuenta_id && rol !== "leer" && rol !== "oculto") throw new core.HttpError(400, "Un enlace iCal es solo de lectura.");
    if ((rol === "plan" || rol === "registrado") && !c.editable) throw new core.HttpError(400, "No tienes permiso de escritura en ese calendario.");
    await tx(pool, async (q) => {
      if (rol === "plan" || rol === "registrado") await q.query("UPDATE calendars SET rol='leer' WHERE rol=$1", [rol]);
      await q.query("UPDATE calendars SET rol=$2 WHERE id=$1", [c.id, rol]);
      if (rol === "plan") {
        await q.query("DELETE FROM calendar_events WHERE calendar_id=$1", [c.id]);
        for (const b of (await q.query("SELECT id FROM blocks WHERE borrado IS NULL AND remote_uid IS NULL AND ends_at > now()")).rows) await core.enqueue(q, "bloque", b.id);
      }
    });
    await done(res);
    syncPronto();
  }));
  // Crea «Veredicto · Plan» o «Veredicto · Registrado» en la cuenta que elijas.
  app.post("/api/cuentas/:id/crear-calendario", need, wrap(async (req, res) => {
    const rol = req.body.rol === "registrado" ? "registrado" : "plan";
    const cuenta = (await pool.query("SELECT * FROM cuentas WHERE id=$1", [req.params.id])).rows[0];
    if (!cuenta || !CALENDARIO[cuenta.tipo]) throw new core.HttpError(400, "Esa cuenta no tiene calendarios.");
    const { cfg: c, guardar } = await cuentaConfig(pool, cuenta);
    let remoteId;
    try { remoteId = await CALENDARIO[cuenta.tipo].createCalendar(c, NOMBRES[rol], { fetcher: cfg.fetcher, tz: cfg.tz, onConfig: guardar }); }
    catch (e) { throw new core.HttpError(400, e.message); }
    const cal = (await pool.query(
      `INSERT INTO calendars(name,cuenta_id,remote_id,editable,rol) VALUES ($1,$2,$3,true,'leer')
       ON CONFLICT (cuenta_id, remote_id) WHERE cuenta_id IS NOT NULL DO UPDATE SET name=$1 RETURNING id`, [NOMBRES[rol], cuenta.id, remoteId])).rows[0];
    req.params.id = cal.id;
    req.body.rol = rol;
    await tx(pool, async (q) => {
      await q.query("UPDATE calendars SET rol='leer' WHERE rol=$1", [rol]);
      await q.query("UPDATE calendars SET rol=$2 WHERE id=$1", [cal.id, rol]);
      if (rol === "plan") for (const b of (await q.query("SELECT id FROM blocks WHERE borrado IS NULL AND remote_uid IS NULL AND ends_at > now()")).rows) await core.enqueue(q, "bloque", b.id);
    });
    await done(res);
    syncPronto();
  }));
  app.put("/api/bandeja-destino", need, wrap(async (req, res) => {
    if (req.body.cuenta_id) await setSetting(pool, "bandeja_cuenta", req.body.cuenta_id);
    else await pool.query("DELETE FROM settings WHERE key='bandeja_cuenta'");
    res.json({ ok: true });
  }));
  app.post("/api/sincronizar", need, wrap(async (req, res) => {
    await refreshCalendars(pool, cfg.tz, { fetcher: cfg.fetcher });
    const r = await sincronizar(pool, syncOpts());
    await done(res, { sync: r });
  }));
  app.get("/api/conflictos", need, wrap(async (req, res) => {
    res.json((await pool.query("SELECT * FROM conflictos ORDER BY creado DESC LIMIT 100")).rows);
  }));
  app.post("/api/conflictos/:id/:accion(revisado|deshacer)", need, wrap(async (req, res) => {
    const c = (await pool.query("SELECT * FROM conflictos WHERE id=$1", [req.params.id])).rows[0];
    if (!c) throw new core.HttpError(404, "No existe.");
    if (req.params.accion === "deshacer" && !c.perdedor.borrado_afuera) {
      const p = c.perdedor;
      await tx(pool, (q) => (c.objeto === "bloque"
        ? core.updateBlock(q, c.ref, { title: p.title, starts_at: p.start, ends_at: p.end })
        : q.query("SELECT calendar_id FROM calendar_events WHERE uid=$1 LIMIT 1", [c.ref]).then((r) => r.rows[0] && core.updateEvento(q, r.rows[0].calendar_id, c.ref, { title: p.title, starts_at: p.start, ends_at: p.end }))));
      syncPronto();
    }
    await pool.query("UPDATE conflictos SET revisado=true WHERE id=$1", [c.id]);
    await done(res);
  }));

  // ---------- Conexiones: avisos ----------
  app.get("/api/avisos", need, wrap(async (req, res) => {
    const a = { ...DEFAULTS, ...(await getSetting(pool, "avisos", {})) };
    // Nunca devolvemos los secretos completos.
    const c = a.canales || {};
    res.json({
      ...a,
      canales: {
        ntfy: c.ntfy ? { server: c.ntfy.server || "https://ntfy.sh", topic: c.ntfy.topic, token: c.ntfy.token ? "••••" : "" } : null,
        telegram: c.telegram ? { chat: c.telegram.chat, token: c.telegram.token ? "••••" : "" } : null,
        webhook: c.webhook ? { url: c.webhook.url } : null,
      },
      sugerido_ntfy: "veredicto-" + randomBytes(9).toString("hex"),
      vigilante: await getSetting(pool, "vigilante", {}),
      tokens: (await pool.query("SELECT count(*)::int n FROM api_tokens WHERE alcance='atajo'")).rows[0].n,
    });
  }));
  app.put("/api/avisos", need, wrap(async (req, res) => {
    const prev = { ...DEFAULTS, ...(await getSetting(pool, "avisos", {})) };
    const b = req.body || {}, hhmm = /^\d{2}:\d{2}$/;
    const next = { ...prev };
    if (typeof b.activo === "boolean") next.activo = b.activo;
    if (typeof b.armar_solo === "boolean") next.armar_solo = b.armar_solo;
    if (hhmm.test(b.desde || "")) next.desde = b.desde;
    if (hhmm.test(b.hasta || "")) next.hasta = b.hasta;
    if (Array.isArray(b.niveles)) next.niveles = b.niveles.map(Number).filter((n) => n > 0 && n < 600).sort((x, y) => x - y).slice(0, 3);
    if (b.repetir) next.repetir = Math.max(5, Math.min(120, Number(b.repetir)));
    const c = { ...(prev.canales || {}) };
    const keep = (nv, ov) => (nv === "••••" ? ov : nv);
    if ("ntfy" in (b.canales || {})) {
      const n = b.canales.ntfy;
      c.ntfy = n?.topic ? { server: (n.server || "https://ntfy.sh").trim(), topic: n.topic.trim(), token: keep(n.token || "", c.ntfy?.token) } : undefined;
    }
    if ("telegram" in (b.canales || {})) {
      const t = b.canales.telegram;
      c.telegram = t?.token ? { token: keep(t.token.trim(), c.telegram?.token), chat: String(t.chat || "").trim() } : undefined;
    }
    if ("webhook" in (b.canales || {})) c.webhook = b.canales.webhook?.url ? { url: b.canales.webhook.url.trim() } : undefined;
    next.canales = JSON.parse(JSON.stringify(c));
    await setSetting(pool, "avisos", next);
    await done(res);
  }));
  app.post("/api/avisos/probar", need, wrap(async (req, res) => {
    const a = await getSetting(pool, "avisos", {});
    const r = await cfg.send(a.canales || {}, {
      titulo: `${cfg.nombre} conectado`, mensaje: "Así te voy a reclamar cuando no registres nada.", prioridad: 3,
      abrir: cfg.publicUrl || undefined, acciones: [],
    }, { fetcher: cfg.fetcher });
    if (!r.length) throw new core.HttpError(400, "No hay ningún canal configurado.");
    res.json({ resultado: r });
  }));
  app.post("/api/avisos/telegram/chat", need, wrap(async (req, res) => {
    // Busca el chat del último mensaje que le mandaste al bot.
    const a = await getSetting(pool, "avisos", {});
    const token = req.body.token && req.body.token !== "••••" ? req.body.token.trim() : a.canales?.telegram?.token;
    if (!token) throw new core.HttpError(400, "Pega primero el token del bot.");
    const r = await cfg.fetcher(`https://api.telegram.org/bot${token}/getUpdates`, { signal: AbortSignal.timeout(15_000) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new core.HttpError(400, "Telegram rechazó el token.");
    const chat = [...(j.result || [])].reverse().map((u) => (u.message || u.channel_post)?.chat).find(Boolean);
    if (!chat) throw new core.HttpError(404, "Mándale cualquier mensaje a tu bot y vuelve a tocar el botón.");
    res.json({ chat: String(chat.id), nombre: chat.first_name || chat.title || "" });
  }));
  app.post("/api/vigilante/revisar", need, wrap(async (req, res) => {
    const r = await vigilar(pool, { tz: cfg.tz, publicUrl: cfg.publicUrl, themeDir: cfg.themeDir, send: cfg.send });
    res.json({ motivo: r.motivo, aviso: r.aviso?.titulo || null });
  }));
  app.post("/api/vigilante/silenciar", need, wrap(async (req, res) => {
    const min = Math.max(5, Math.min(24 * 60, Number(req.body.min) || 60));
    const s = await getSetting(pool, "vigilante", {});
    await setSetting(pool, "vigilante", { ...s, silencio_hasta: Date.now() + min * 60000 });
    res.json({ ok: true, hasta: Date.now() + min * 60000 });
  }));
  app.put("/api/onboarding", need, wrap(async (req, res) => { await setSetting(pool, "onboarding", { listo: !!req.body.listo, at: Date.now() }); res.json({ ok: true }); }));

  // ---------- Plantillas de avisos ----------
  const capas = async () => ({ equipo: await equipo(cfg.themeDir), tuyas: await getSetting(pool, "plantillas", null) });
  app.get("/api/plantillas", need, wrap(async (req, res) => {
    const c = await capas();
    res.json({ efectivas: merge(c.equipo, c.tuyas), equipo: merge(c.equipo), fabrica: merge(), tuyas: c.tuyas || { global: {}, eventos: {} }, hay_equipo: !!c.equipo, acciones: ACCIONES, variables: VARIABLES, orden: Object.keys(EVENTOS) });
  }));
  app.put("/api/plantillas", need, wrap(async (req, res) => {
    const nuevo = sanitizePlantillas(req.body);
    const prev = (await getSetting(pool, "plantillas", null)) || { global: {}, eventos: {} };
    const out = { global: { ...prev.global, ...nuevo.global }, eventos: { ...prev.eventos } };
    for (const [k, v] of Object.entries(nuevo.eventos)) out.eventos[k] = { ...(prev.eventos?.[k] || {}), ...v };
    await setSetting(pool, "plantillas", out);
    const c = await capas();
    res.json({ ok: true, efectivas: merge(c.equipo, c.tuyas) });
  }));
  app.delete("/api/plantillas/:evento", need, wrap(async (req, res) => {
    // Vuelve a la plantilla del equipo (o de fábrica) para un evento, o para todos con "todo".
    const prev = (await getSetting(pool, "plantillas", null)) || { global: {}, eventos: {} };
    if (req.params.evento === "todo") await pool.query("DELETE FROM settings WHERE key='plantillas'");
    else { delete prev.eventos[req.params.evento]; await setSetting(pool, "plantillas", prev); }
    const c = await capas();
    res.json({ ok: true, efectivas: merge(c.equipo, c.tuyas) });
  }));
  app.post("/api/plantillas/probar", need, wrap(async (req, res) => {
    const key = req.body.evento;
    if (!EVENTOS[key]) throw new core.HttpError(400, "Evento desconocido.");
    const c = await capas();
    const P = merge(c.equipo, c.tuyas, req.body.borrador ? sanitizePlantillas({ eventos: { [key]: req.body.borrador } }) : null);
    P.eventos[key].activo = true;
    const s = await st();
    const now = Date.now();
    const ej = s.sugerencias[0] || { title: "Transporte" };
    const vars = {
      titulo: s.current?.title || s.agenda.blocks[0]?.title || "Reunión de ejemplo", hora: fmtHora(now + 5 * 60000, cfg.tz), fin: fmtHora(now + 65 * 60000, cfg.tz),
      minutos: P.eventos.previo.minutos || 5, sin_registrar: "32 min", sugerencia: ej.title, lleva: "1:30:00", estimado: "1:00:00",
      agenda: "08:10 Transporte\n09:00 Reunión\n18:00 Gimnasio", nombre: cfg.nombre,
    };
    const aviso = construirAviso(P, key, vars, { ahora: { title: vars.titulo }, lista: [ej, { title: "Descanso" }], current: s.current || { state: "running", title: vars.titulo } });
    aviso.titulo = "[prueba] " + aviso.titulo;
    // Los botones de prueba silencian 1 minuto: no cambian lo que estás registrando.
    aviso.acciones = aviso.acciones.map((a) => (a.abrir ? a : { ...a, accion: "silenciar", datos: { min: 1 } }));
    const a = { ...DEFAULTS, ...(await getSetting(pool, "avisos", {})) };
    const r = await entregar(pool, a, aviso, { publicUrl: cfg.publicUrl, plantillas: P, send: (cn, av) => cfg.send(cn, av, { fetcher: cfg.fetcher }) });
    if (!r.envio.length) throw new core.HttpError(400, "No hay ningún canal configurado (paso 1).");
    res.json({ resultado: r.envio, aviso: { titulo: r.final.titulo, mensaje: r.final.mensaje, acciones: r.final.acciones.map((x) => x.label) } });
  }));

  // ---------- Qué aprende el algoritmo ----------
  app.get("/api/prediccion", need, wrap(async (req, res) => {
    const pred = await getPrediccion(pool);
    const hab = await habitosConModo(pool, Date.now(), cfg.tz, pred);
    // Solo lo que el algoritmo puede agendar: rutinas y lo que ya detectó como hábito.
    const ids = hab.map((h) => h.item_id).filter(Boolean);
    const items = (await pool.query("SELECT id, kind, title, hora, dias, est_min FROM items WHERE status <> 'archivada' AND (kind='rutina' OR id = ANY($1::uuid[])) ORDER BY kind DESC, title", [ids])).rows;
    res.json({
      config: pred,
      habitos: hab.map((h) => ({ ...h, hora: `${String(Math.floor(h.minuto / 60)).padStart(2, "0")}:${String(h.minuto % 60).padStart(2, "0")}` })),
      items: items.map((i) => ({ id: i.id, kind: i.kind, title: i.title, hora: i.hora ? String(i.hora).slice(0, 5) : null, modo: modoDe(pred, i.id, { rutinaConHora: !!i.hora }), propio: !!pred.modos[i.id] })),
    });
  }));
  app.put("/api/prediccion", need, wrap(async (req, res) => {
    await setSetting(pool, "prediccion", sanitizePred(await getPrediccion(pool), req.body));
    await done(res);
  }));

  // ---------- Proyectos y pilares ----------
  app.get("/api/proyectos", need, wrap(async (req, res) => res.json(await proyectos.listar(pool, { incluirArchivados: req.query.todos === "1" }))));
  app.post("/api/proyectos", need, wrap(async (req, res) => { const p = await tx(pool, (q) => proyectos.crearProyecto(q, req.body)); await done(res, { proyecto: p }); }));
  app.patch("/api/proyectos/:id", need, wrap(async (req, res) => { await tx(pool, (q) => proyectos.editarProyecto(q, req.params.id, req.body)); await done(res); }));
  app.post("/api/pilares", need, wrap(async (req, res) => { const p = await tx(pool, (q) => proyectos.crearPilar(q, req.body)); await done(res, { pilar: p }); }));
  app.patch("/api/pilares/:id", need, wrap(async (req, res) => { await tx(pool, (q) => proyectos.editarPilar(q, req.params.id, req.body)); await done(res); }));

  // ---------- Las 9 bases de Notion ----------
  // modo «crear»: bases nuevas «Veredicto · …»; «adoptar»: usa tus «TimeMachine - …» y (si quieres) importa su historial.
  app.post("/api/cuentas/:id/notion-bases", need, wrap(async (req, res) => {
    const cuenta = (await pool.query("SELECT * FROM cuentas WHERE id=$1 AND tipo='notion'", [req.params.id])).rows[0];
    if (!cuenta) throw new core.HttpError(404, "Esa cuenta de Notion no existe.");
    const { cfg: c, guardar } = await cuentaConfig(pool, cuenta);
    const n = cfg.notionClient || notionA.cliente(c);
    const modo = req.body.modo === "adoptar" ? "adoptar" : "crear";
    let bases, faltan = [];
    try {
      if (modo === "adoptar") {
        ({ bases, faltan } = await espejo.adoptar(n));
        if (!Object.keys(bases).length) throw new core.HttpError(400, "No encontré bases «TimeMachine - …» ni «Veredicto · …». Compártelas con tu integración (••• → Conexiones) o elige «Crear nuevas».");
      } else bases = await espejo.crear(n, c.raiz);
      if (!c.flujo) c.flujo = await notionA.crearFlujo(c, n);
      if (bases.proyectos) await espejo.enlazarFlujo(n, c.flujo, bases.proyectos);
      if (!c.guia && req.body.guia !== false) c.guia = await espejo.guia(n, c.raiz, { flujo: c.flujo, bases }).catch(() => null);
    } catch (e) { if (e instanceof core.HttpError) throw e; throw new core.HttpError(400, `Notion: ${e.message}`); }
    c.espejo = { modo, bases };
    await guardar(c);
    const importar = modo === "adoptar" && req.body.importar !== false;
    if (importar) {
      const prog = { estado: "corriendo", cuenta: cuenta.id, inicio: Date.now(), log: [] };
      await setSetting(pool, "notion_importacion", prog);
      const anota = (m) => { prog.log.push(m); prog.log = prog.log.slice(-30); setSetting(pool, "notion_importacion", prog).catch(() => {}); changed("importacion"); };
      espejo.importar(pool, n, bases, { log: anota }).then(async (r) => {
        await setSetting(pool, "notion_importacion", { ...prog, estado: "listo", fin: Date.now(), resultado: r });
        changed("importacion"); syncPronto();
      }, async (e) => {
        await setSetting(pool, "notion_importacion", { ...prog, estado: "error", fin: Date.now(), error: String(e.message).slice(0, 300) });
        changed("importacion");
      });
    } else syncPronto();
    await done(res, { bases: Object.keys(bases).length, faltan, importando: importar, guia: !!c.guia });
  }));
  app.get("/api/notion-importacion", need, wrap(async (req, res) => res.json((await getSetting(pool, "notion_importacion")) || null)));

  // ---------- ActivityWatch: lo que haces en el computador ----------
  app.post("/api/activitywatch/probar", need, wrap(async (req, res) => {
    try { res.json({ ok: true, ...(await aw.probar(String(req.body.url || "").trim(), cfg.fetcher)) }); }
    catch (e) { throw new core.HttpError(400, e.message); }
  }));
  app.put("/api/activitywatch", need, wrap(async (req, res) => {
    const url = String(req.body.url || "").trim().replace(/\/$/, "");
    if (!/^https?:\/\//.test(url)) throw new core.HttpError(400, "La dirección debe empezar con http:// (ej. http://192.168.68.20:5600).");
    const activo = req.body.activo !== false;
    if (activo) { try { await aw.probar(url, cfg.fetcher); } catch (e) { throw new core.HttpError(400, e.message); } }
    const prev = (await getSetting(pool, "activitywatch")) || {};
    await setSetting(pool, "activitywatch", { ...prev, url, activo, error: "" });
    if (activo) await aw.sincronizar(pool, { horas: 24, fetcher: cfg.fetcher }).catch(() => {});
    await done(res);
  }));
  app.delete("/api/activitywatch", need, wrap(async (req, res) => { await pool.query("DELETE FROM settings WHERE key='activitywatch'"); await done(res); }));
  app.post("/api/activitywatch/sincronizar", need, wrap(async (req, res) => {
    try { const r = await aw.sincronizar(pool, { horas: 24, fetcher: cfg.fetcher }); await done(res, { sync: r }); }
    catch (e) { throw new core.HttpError(400, e.message); }
  }));
  app.get("/api/actividad", need, wrap(async (req, res) => {
    const d = req.query.dia ? Date.parse(req.query.dia + "T12:00:00Z") : Date.now();
    if (!Number.isFinite(d)) throw new core.HttpError(400, "Día no válido.");
    const a = startOfDay(d, cfg.tz);
    res.json(await aw.resumen(pool, a, addDays(a, 1, cfg.tz)));
  }));
  // Convierte tramos del computador en una sesión registrada (con su tarea o proyecto).
  app.post("/api/actividad/registrar", need, wrap(async (req, res) => {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isFinite).slice(0, 200);
    if (!ids.length) throw new core.HttpError(400, "Elige qué tramos registrar.");
    const r = await tx(pool, async (q) => {
      const ts = (await q.query("SELECT * FROM actividad WHERE id = ANY($1) AND NOT registrado ORDER BY inicio", [ids])).rows;
      if (!ts.length) throw new core.HttpError(409, "Esos tramos ya estaban registrados.");
      let item = null;
      if (req.body.item_id) item = (await q.query("SELECT * FROM items WHERE id=$1", [req.body.item_id])).rows[0];
      const titulo = String(req.body.title || "").trim() || item?.title || ts[0].app;
      if (!item) item = (await core.findItem(q, titulo)) || (await core.createItem(q, { title: titulo, proyecto_id: req.body.proyecto_id || null }));
      else if (req.body.proyecto_id && !item.proyecto_id) await proyectos.asignar(q, item.id, req.body.proyecto_id);
      // Une tramos separados por menos de 5 minutos.
      const segs = [];
      for (const t of ts) { const last = segs.at(-1); if (last && +t.inicio - last[1] <= 5 * 60000) last[1] = Math.max(last[1], +t.fin); else segs.push([+t.inicio, +t.fin]); }
      const s = (await q.query("INSERT INTO sessions(item_id,title,state,started_at,ended_at,source) VALUES ($1,$2,'done',$3,$4,'computador') RETURNING id",
        [item.id, item.title, new Date(segs[0][0]), new Date(segs.at(-1)[1])])).rows[0];
      for (const [a, b] of segs) await q.query("INSERT INTO segments(session_id,started_at,ended_at) VALUES ($1,$2,$3)", [s.id, new Date(a), new Date(b)]);
      await q.query("UPDATE actividad SET registrado=true WHERE id = ANY($1)", [ts.map((t) => t.id)]);
      await core.enqueue(q, "sesion_cal", s.id);
      await core.enqueueFlujo(q, { itemId: item.id });
      await log(q, "actividad.registrada", `${item.title} · ${ts.length} tramos`);
      return { sesion: s.id, ms: segs.reduce((a, [x, y]) => a + y - x, 0), title: item.title };
    });
    await done(res, r);
  }));

  // ---------- Modo demo ----------
  app.post("/api/demo", need, wrap(async (req, res) => {
    if ((await st()).demo) throw new core.HttpError(409, "Los datos de ejemplo ya están cargados.");
    const r = await demo.cargar(pool, cfg.tz);
    await log(pool, "demo.cargado", "");
    changed(); res.json({ ok: true, ...r, estado: await st() });
  }));
  app.delete("/api/demo", need, wrap(async (req, res) => { await demo.borrar(pool); await log(pool, "demo.borrado", ""); changed(); res.json({ ok: true, estado: await st() }); }));

  // ---------- MCP: tu asistente (Claude, Aurora) maneja tu tiempo ----------
  mcpRouter(app, pool, { need, cfg });

  // ---------- Tokens para atajos ----------
  app.get("/api/tokens", need, wrap(async (req, res) => res.json((await pool.query("SELECT id,label,alcance,created_at,last_used_at FROM api_tokens ORDER BY created_at DESC")).rows)));
  app.post("/api/tokens", need, wrap(async (req, res) => {
    if (req.who.via !== "cookie") throw new core.HttpError(403, "Crea tokens desde la app.");
    if (req.body.alcance === "agente" && !(await agentes.modulos(pool)).infra) throw new core.HttpError(400, "Activa la Infraestructura en Ajustes → Módulos para crear tokens de agente.");
    res.json({ ...(await auth.newApiToken(pool, req.body.label, req.body.alcance)), base: cfg.publicUrl.replace(/\/$/, "") });
  }));

  // ---------- Infraestructura (opcional): agentes de IA ----------
  agentes.rutas(app, { pool, tx, need, wrap, done, changed, tz: cfg.tz });

  // ---------- Carpeta sincronizada: tus pendientes en un .md de cualquier computador ----------
  carpeta.rutas(app, { pool, tx, need, wrap, changed, empujar: empujarPronto });
  app.delete("/api/tokens/:id", need, wrap(async (req, res) => { await pool.query("DELETE FROM api_tokens WHERE id=$1", [req.params.id]); res.json({ ok: true }); }));

  // ---------- Atajos (Siri, Android, Garmin): respuestas en texto simple ----------
  const textoDe = (req) => String(req.query.que || req.query.texto || (typeof req.body === "string" ? req.body : req.body?.texto || req.body?.que || req.body?.text || "")).trim();
  const atajo = (fn) => wrap(async (req, res) => {
    try {
      const msg = await fn(req);
      changed();
      res.type("text/plain; charset=utf-8").send(msg);
    } catch (e) {
      res.status(e.status || 500).type("text/plain; charset=utf-8").send(e.status ? e.message : "Algo falló en el servidor.");
    }
  });
  const resumen = async () => {
    const c = await currentSession(pool);
    if (!c) {
      const r = await pool.query("SELECT max(ended_at) e FROM sessions WHERE state='done'");
      return r.rows[0].e ? `Nada corriendo. Último registro hace ${fmtDur(Date.now() - +r.rows[0].e)}.` : "Nada corriendo.";
    }
    const ms = c.segments.reduce((a, [x, y]) => a + ((y || Date.now()) - x), 0);
    return `${c.state === "running" ? "▶" : "⏸"} ${c.title} · ${fmtDur(ms)}`;
  };
  const viaTimer = (fn) => tx(pool, async (q) => { await core.lockTimer(q); return fn(q); });
  app.all("/api/atajo/estado", need, atajo(resumen));
  app.all("/api/atajo/opciones", need, atajo(async () => {
    const s = await st();
    const now = Date.now();
    const lista = [];
    const add = (t) => { if (t && !lista.includes(t)) lista.push(t); };
    s.agenda.blocks.filter((b) => b.end > now).slice(0, 2).forEach((b) => add(b.title));
    s.sugerencias.forEach((x) => add(x.title));
    s.items.filter((i) => i.kind === "rutina").forEach((i) => add(i.title));
    s.items.filter((i) => i.kind === "tarea" && i.status !== "hecha").slice(0, 15).forEach((i) => add(i.title));
    return lista.slice(0, 25).join("\n");
  }));
  app.all("/api/atajo/iniciar", need, atajo(async (req) => {
    const que = textoDe(req);
    if (!que) throw new core.HttpError(400, "Dime qué iniciar.");
    const r = await viaTimer((q) => core.start(q, { title: que, source: req.query.fuente || "atajo" }));
    return r.already ? `Ya estaba corriendo: ${r.item.title}` : `▶ ${r.item.title}`;
  }));
  app.all("/api/atajo/parar", need, atajo(async () => {
    const r = await viaTimer((q) => core.stop(q));
    if (!r) return "No había nada corriendo.";
    return r.discarded ? `Descartado (menos de 30 s): ${r.title}` : `■ ${r.title} · ${fmtDur(r.ms)}`;
  }));
  app.all("/api/atajo/pausar", need, atajo(async () => { const r = await viaTimer((q) => core.pause(q)); return `⏸ ${r.title}`; }));
  app.all("/api/atajo/seguir", need, atajo(async () => { const r = await viaTimer((q) => core.resume(q)); return `▶ ${r.title}`; }));
  // Un solo botón (reloj, widget): si hay algo corriendo lo para; si no, inicia lo agendado o lo habitual.
  app.all("/api/atajo/alternar", need, atajo(async (req) => {
    const c = await currentSession(pool);
    if (c?.state === "running") {
      const r = await viaTimer((q) => core.stop(q));
      return r.discarded ? `Descartado: ${r.title}` : `■ ${r.title} · ${fmtDur(r.ms)}`;
    }
    if (c?.state === "paused") { await viaTimer((q) => core.resume(q)); return `▶ ${c.title}`; }
    const s = await st();
    const now = Date.now();
    const b = s.agenda.blocks.find((x) => x.start <= now + 10 * 60000 && x.end > now);
    const pick = b ? { itemId: b.item_id, title: b.title } : s.sugerencias[0] ? { itemId: s.sugerencias[0].item_id, title: s.sugerencias[0].title } : null;
    if (!pick) return "No sé qué iniciar. Usa «Iniciar» y dime qué.";
    const r = await viaTimer((q) => core.start(q, { itemId: pick.itemId, title: pick.title, source: req.query.fuente || "atajo" }));
    return `▶ ${r.item.title}`;
  }));
  app.all("/api/atajo/capturar", need, atajo(async (req) => {
    const t = textoDe(req);
    await tx(pool, (q) => core.capture(q, { text: t, kind: req.query.tipo === "nota" ? "nota" : "captura", source: req.query.fuente || "atajo" }));
    return "Guardado en la bandeja.";
  }));
  app.all("/api/atajo/agenda", need, atajo(async () => {
    const now = Date.now();
    const a = await agendaRange(pool, now, addDays(startOfDay(now, cfg.tz), 1, cfg.tz));
    const l = [...a.blocks, ...a.events.filter((e) => !e.all_day)].sort((x, y) => x.start - y.start).map((x) => `${fmtHora(x.start, cfg.tz)} ${x.title}`);
    return l.length ? l.join("\n") : "Nada más agendado hoy.";
  }));
  app.all("/api/atajo/armar", need, atajo(async () => {
    const r = await armarHoy(pool, cfg.tz, { aplicar: true });
    return r.creados ? r.plan.map((p) => `${fmtHora(p.starts_at, cfg.tz)} ${p.title}`).join("\n") : "No encontré nada nuevo que agendar.";
  }));

  // ---------- Botones de los avisos (enlaces firmados) ----------
  const runAction = async (d) => {
    if (d.a === "iniciar") { const r = await viaTimer((q) => core.start(q, { itemId: d.p?.item_id || null, title: d.p?.title || null, source: "aviso" })); return `▶ ${r.item.title}`; }
    if (d.a === "seguir") { const r = await viaTimer((q) => core.resume(q)); return `▶ ${r.title}`; }
    if (d.a === "parar") { const r = await viaTimer((q) => core.stop(q)); return r ? `■ ${r.title}` : "No había nada corriendo."; }
    if (d.a === "armar") { const r = await armarHoy(pool, cfg.tz, { aplicar: true }); return r.creados ? `Agendé ${r.creados} bloques.` : "No había nada nuevo que agendar."; }
    if (d.a === "silenciar") {
      const s = await getSetting(pool, "vigilante", {});
      await setSetting(pool, "vigilante", { ...s, silencio_hasta: Date.now() + (d.p?.min || 60) * 60000 });
      return `Silenciado ${d.p?.min || 60} min.`;
    }
    throw new core.HttpError(400, "Acción desconocida.");
  };
  app.post("/a/:t", wrap(async (req, res) => {
    const d = auth.verifyAction(await auth.secret(pool), req.params.t);
    if (!d) return res.status(410).type("text/plain").send("Este botón ya venció.");
    const msg = await runAction(d).catch((e) => (e.status ? e.message : Promise.reject(e)));
    changed();
    if ((req.get("accept") || "").includes("text/html")) return res.type("html").send(actionPage(cfg.nombre, msg, null));
    res.type("text/plain; charset=utf-8").send(msg);
  }));
  app.get("/a/:t", wrap(async (req, res) => {
    // Desde Telegram el botón abre el navegador: mostramos un botón para confirmar (los visores de enlaces no ejecutan nada).
    const d = auth.verifyAction(await auth.secret(pool), req.params.t);
    res.type("html").send(actionPage(cfg.nombre, d ? null : "Este botón ya venció.", d ? req.params.t : null, d));
  }));

  app.get("/salud", wrap(async (req, res) => { await pool.query("SELECT 1"); res.json({ ok: true }); }));

  app.use((err, req, res, next) => {
    const status = err.status || (err.type === "entity.parse.failed" || err.code === "22P02" || err.code === "22007" || err.code === "22008" ? 400 : 500);
    if (status === 400 && err.code) err.message = "Dato no válido.";
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? "Algo falló en el servidor." : err.message });
  });
  return app;
}

// Escapa texto para insertarlo en HTML.
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const LABEL = { iniciar: "Iniciar", seguir: "Seguir", parar: "Parar", silenciar: "Silenciar" };
// Página HTML mínima que confirma una acción firmada (botones de avisos).
function actionPage(nombre, msg, token, d) {
  const what = d ? `${LABEL[d.a] || d.a}${d.p?.title ? " · " + d.p.title : ""}${d.p?.min ? ` ${d.p.min} min` : ""}` : "";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(nombre)}</title><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/theme.css"></head>
<body class="accion"><main class="tarjeta">${msg ? `<h1>${escapeHtml(msg)}</h1>` : `<form method="post" action="/a/${escapeHtml(token)}"><button class="grande primario">${escapeHtml(what)}</button></form>`}<p><a href="/">Abrir ${escapeHtml(nombre)}</a></p></main></body></html>`;
}
