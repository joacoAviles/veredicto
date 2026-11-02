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
import { setupNotion, pushPending } from "./conectores/notion.js";
import { enviar } from "./conectores/avisos.js";
import { DEFAULTS, vigilar } from "./vigilante.js";
import { fmtDur, fmtHora, isValidZone, startOfDay, addDays } from "./time.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const exists = (p) => access(p).then(() => true, () => false);

export function createApp(pool, opts = {}) {
  const cfg = {
    tz: opts.tz || "America/Santiago",
    publicUrl: opts.publicUrl || "",
    nombre: opts.nombre || "Juez del Tiempo",
    theme: opts.theme || "neutro",
    themeDir: opts.themeDir || "",
    secureCookie: opts.secureCookie ?? /^https:/.test(opts.publicUrl || ""),
    fetcher: opts.fetcher || fetch,
    send: opts.send || enviar,
    notionClient: opts.notionClient || null,
  };
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
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
    req.who = who;
    next();
  });
  const st = () => buildState(pool, { tz: cfg.tz });
  const done = async (res, extra = {}) => { changed(); res.json({ ok: true, ...extra, estado: await st() }); };

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
    await auth.createAccount(pool, { password: req.body.password, codigo: req.body.codigo });
    const token = await auth.login(pool, req.body.password, req.get("user-agent"));
    auth.setCookie(res, token, cfg.secureCookie);
    res.json({ ok: true });
  }));
  app.post("/api/entrar", wrap(async (req, res) => {
    await new Promise((r) => setTimeout(r, 300));
    const token = await auth.login(pool, req.body.password, req.get("user-agent"));
    if (!token) return res.status(401).json({ error: "Contraseña incorrecta." });
    auth.setCookie(res, token, cfg.secureCookie);
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
  app.post("/api/iniciar", need, timer((q, req) => core.start(q, { itemId: req.body.item_id || null, title: req.body.title || null, source: req.body.source || "app" })));
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
      await core.enqueue(q, "session", s.id);
    });
    await done(res);
  }));
  app.delete("/api/sesiones/:id", need, wrap(async (req, res) => {
    await pool.query("DELETE FROM sessions WHERE id=$1 AND state='done'", [req.params.id]);
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
      await core.enqueue(q, "capture", req.params.id);
    });
    await done(res);
  }));
  app.post("/api/capturas/:id/tarea", need, wrap(async (req, res) => {
    await tx(pool, async (q) => {
      const c = (await q.query("SELECT * FROM captures WHERE id=$1", [req.params.id])).rows[0];
      if (!c) throw new core.HttpError(404, "No existe.");
      await core.createItem(q, { title: c.text });
      await q.query("UPDATE captures SET status='procesada', updated_at=now() WHERE id=$1", [c.id]);
      await core.enqueue(q, "capture", c.id);
    });
    await done(res);
  }));
  // Compartir desde Android (PWA share target) cae aquí.
  app.post("/compartir", wrap(async (req, res) => {
    if (!(await auth.identify(pool, req))) return res.redirect(303, "/");
    const text = [req.body.title, req.body.text, req.body.url].filter(Boolean).join("\n");
    if (text.trim()) { await tx(pool, (q) => core.capture(q, { text, source: "compartir" })); changed(); }
    res.redirect(303, "/#bandeja");
  }));

  // ---------- Agenda ----------
  app.post("/api/bloques", need, wrap(async (req, res) => {
    await tx(pool, (q) => core.addBlock(q, { itemId: req.body.item_id || null, title: req.body.title, starts_at: req.body.inicio, ends_at: req.body.fin }));
    await done(res);
  }));
  app.delete("/api/bloques/:id", need, wrap(async (req, res) => { await pool.query("DELETE FROM blocks WHERE id=$1", [req.params.id]); await done(res); }));
  app.get("/api/armar", need, wrap(async (req, res) => res.json(await armarHoy(pool, cfg.tz))));
  app.post("/api/armar", need, wrap(async (req, res) => { const r = await armarHoy(pool, cfg.tz, { aplicar: true }); await done(res, r); }));
  app.get("/api/registro", need, wrap(async (req, res) => {
    const dias = Math.min(60, Math.max(1, Number(req.query.dias) || 7));
    const desde = addDays(startOfDay(Date.now(), cfg.tz), -(dias - 1), cfg.tz);
    const r = await pool.query(
      `SELECT s.id, s.title, s.source, s.started_at, s.ended_at,
         (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(g.ended_at, now())-g.started_at))),0) FROM segments g WHERE g.session_id=s.id)*1000 AS ms
       FROM sessions s WHERE s.started_at >= $1 ORDER BY s.started_at DESC`, [new Date(desde)]);
    res.json(r.rows.map((x) => ({ id: x.id, title: x.title, source: x.source, start: +x.started_at, end: x.ended_at ? +x.ended_at : null, ms: Number(x.ms) })));
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
  app.post("/api/calendarios/refrescar", need, wrap(async (req, res) => { await refreshCalendars(pool, cfg.tz, { fetcher: cfg.fetcher }); await done(res); }));
  app.get("/api/feed", need, wrap(async (req, res) => {
    let s = await getSetting(pool, "feed_secreto");
    if (!s || req.query.nuevo) { s = randomBytes(18).toString("base64url"); await setSetting(pool, "feed_secreto", s); }
    res.json({ url: `${cfg.publicUrl.replace(/\/$/, "")}/cal/${s}.ics` });
  }));
  app.get("/cal/:s.ics", wrap(async (req, res) => {
    const s = await getSetting(pool, "feed_secreto");
    if (!s || req.params.s !== s) return res.status(404).end();
    const from = new Date(Date.now() - 30 * 86_400_000), to = new Date(Date.now() + 14 * 86_400_000);
    const blocks = (await pool.query("SELECT id,title,starts_at,ends_at FROM blocks WHERE starts_at BETWEEN $1 AND $2", [from, to])).rows;
    const sessions = (await pool.query("SELECT id,title,started_at,ended_at FROM sessions WHERE state='done' AND started_at BETWEEN $1 AND $2", [from, to])).rows;
    res.type("text/calendar").send(buildICS({
      name: cfg.nombre,
      blocks: blocks.map((b) => ({ ...b, starts_at: +b.starts_at, ends_at: +b.ends_at })),
      sessions: sessions.map((x) => ({ ...x, started_at: +x.started_at, ended_at: +x.ended_at })),
    }));
  }));

  // ---------- Conexiones: Notion ----------
  app.post("/api/notion", need, wrap(async (req, res) => {
    await setupNotion(pool, { token: String(req.body.token || "").trim(), pagina: req.body.pagina }, { client: cfg.notionClient });
    pushPending(pool, { client: cfg.notionClient }).then(changed, () => {});
    await done(res);
  }));
  app.delete("/api/notion", need, wrap(async (req, res) => {
    await pool.query("DELETE FROM settings WHERE key='notion'");
    await pool.query("DELETE FROM outbox WHERE status <> 'ok'");
    await done(res);
  }));
  app.post("/api/notion/reintentar", need, wrap(async (req, res) => {
    await pool.query("UPDATE outbox SET next_at=now() WHERE status='error'");
    const r = await pushPending(pool, { client: cfg.notionClient });
    await done(res, { notion: r });
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
      sugerido_ntfy: "juez-" + randomBytes(9).toString("hex"),
      vigilante: await getSetting(pool, "vigilante", {}),
      tokens: (await pool.query("SELECT count(*)::int n FROM api_tokens")).rows[0].n,
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
      titulo: "Juez del Tiempo conectado", mensaje: "Así te voy a reclamar cuando no registres nada.", prioridad: 3,
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
    const r = await vigilar(pool, { tz: cfg.tz, publicUrl: cfg.publicUrl, send: cfg.send });
    res.json({ motivo: r.motivo, aviso: r.aviso?.titulo || null });
  }));
  app.post("/api/vigilante/silenciar", need, wrap(async (req, res) => {
    const min = Math.max(5, Math.min(24 * 60, Number(req.body.min) || 60));
    const s = await getSetting(pool, "vigilante", {});
    await setSetting(pool, "vigilante", { ...s, silencio_hasta: Date.now() + min * 60000 });
    res.json({ ok: true, hasta: Date.now() + min * 60000 });
  }));
  app.put("/api/onboarding", need, wrap(async (req, res) => { await setSetting(pool, "onboarding", { listo: !!req.body.listo, at: Date.now() }); res.json({ ok: true }); }));

  // ---------- Tokens para atajos ----------
  app.get("/api/tokens", need, wrap(async (req, res) => res.json((await pool.query("SELECT id,label,created_at,last_used_at FROM api_tokens ORDER BY created_at DESC")).rows)));
  app.post("/api/tokens", need, wrap(async (req, res) => {
    if (req.who.via !== "cookie") throw new core.HttpError(403, "Crea tokens desde la app.");
    res.json({ ...(await auth.newApiToken(pool, req.body.label)), base: cfg.publicUrl.replace(/\/$/, "") });
  }));
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
    const status = err.status || (err.type === "entity.parse.failed" ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? "Algo falló en el servidor." : err.message });
  });
  return app;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const LABEL = { iniciar: "Iniciar", seguir: "Seguir", parar: "Parar", silenciar: "Silenciar" };
function actionPage(nombre, msg, token, d) {
  const what = d ? `${LABEL[d.a] || d.a}${d.p?.title ? " · " + d.p.title : ""}${d.p?.min ? ` ${d.p.min} min` : ""}` : "";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(nombre)}</title><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/base.css"></head>
<body class="accion"><main class="tarjeta">${msg ? `<h1>${escapeHtml(msg)}</h1>` : `<form method="post" action="/a/${escapeHtml(token)}"><button class="grande primario">${escapeHtml(what)}</button></form>`}<p><a href="/">Abrir ${escapeHtml(nombre)}</a></p></main></body></html>`;
}
