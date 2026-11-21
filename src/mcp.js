// Servidor MCP (Model Context Protocol) en /mcp: Claude, Aurora u otro asistente pueden leer y manejar tu tiempo.
// Transporte «Streamable HTTP» sin estado: cada POST es una petición JSON-RPC y la respuesta va en JSON.
// Autenticación: token de Veredicto (Ajustes → Atajos) como «Authorization: Bearer jdt_…».
import { tx } from "./db.js";
import * as core from "./core.js";
import { buildState, agendaRange, currentSession } from "./estado.js";
import { armarHoy, changed } from "./servicios.js";
import * as proyectos from "./proyectos.js";
import { resumen as resumenActividad } from "./sync/activitywatch.js";
import { fmtDur, fmtHora, startOfDay, addDays, dayKey } from "./time.js";
import * as agentes from "./agentes.js";

const PROTOCOLOS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const TOOLS = [
  { name: "estado", description: "Qué está corriendo ahora, cuánto llevas medido hoy y lo que viene en la agenda.", inputSchema: { type: "object", properties: {} } },
  { name: "iniciar", description: "Inicia el temporizador sobre una tarea, rutina o algo nuevo. Si no existe, crea la tarea (opcionalmente en un proyecto).",
    inputSchema: { type: "object", properties: { que: { type: "string", description: "Qué vas a hacer" }, proyecto: { type: "string", description: "Nombre del proyecto (opcional)" } }, required: ["que"] } },
  { name: "parar", description: "Detiene lo que esté corriendo y lo registra.", inputSchema: { type: "object", properties: {} } },
  { name: "pausar", description: "Pausa lo que esté corriendo.", inputSchema: { type: "object", properties: {} } },
  { name: "seguir", description: "Retoma lo pausado.", inputSchema: { type: "object", properties: {} } },
  { name: "capturar", description: "Guarda una idea, pendiente o nota en la bandeja (Notion/Obsidian si están conectados).",
    inputSchema: { type: "object", properties: { texto: { type: "string" }, tipo: { type: "string", enum: ["captura", "nota"] } }, required: ["texto"] } },
  { name: "agenda", description: "Bloques y eventos de calendario de hoy y los próximos días.", inputSchema: { type: "object", properties: { dias: { type: "integer", minimum: 1, maximum: 14 } } } },
  { name: "proyectos", description: "Proyectos con tareas abiertas, minutos medidos (total y última semana) y fecha límite.", inputSchema: { type: "object", properties: {} } },
  { name: "tareas", description: "Tareas abiertas, opcionalmente de un proyecto.", inputSchema: { type: "object", properties: { proyecto: { type: "string" } } } },
  { name: "crear_tarea", description: "Crea una tarea.",
    inputSchema: { type: "object", properties: { titulo: { type: "string" }, proyecto: { type: "string" }, minutos: { type: "integer" }, fecha_limite: { type: "string", description: "AAAA-MM-DD" }, eisenhower: { type: "string", enum: core.EISEN } }, required: ["titulo"] } },
  { name: "completar_tarea", description: "Marca una tarea como hecha (por nombre).", inputSchema: { type: "object", properties: { titulo: { type: "string" } }, required: ["titulo"] } },
  { name: "agendar", description: "Agenda un bloque en tu calendario (se sincroniza con «Veredicto · Plan»).",
    inputSchema: { type: "object", properties: { titulo: { type: "string" }, inicio: { type: "string", description: "Fecha y hora ISO 8601" }, minutos: { type: "integer" } }, required: ["titulo", "inicio"] } },
  { name: "armar_dia", description: "Propone (o aplica) los bloques de hoy según hábitos, rutinas y pendientes «Por hacer».",
    inputSchema: { type: "object", properties: { aplicar: { type: "boolean" } } } },
  { name: "registro", description: "Tiempo medido por proyecto y por actividad en los últimos días.", inputSchema: { type: "object", properties: { dias: { type: "integer", minimum: 1, maximum: 60 } } } },
  { name: "actividad_computador", description: "Lo que ActivityWatch vio en el computador (apps y tiempo) y cuánto quedó sin registrar.",
    inputSchema: { type: "object", properties: { horas: { type: "integer", minimum: 1, maximum: 48 } } } },
];

export function mcpRouter(app, pool, { need, cfg }) {
  const timer = (fn) => tx(pool, async (q) => { await core.lockTimer(q); return fn(q); });
  const linea = (x) => `${fmtHora(x.start, cfg.tz)}–${fmtHora(x.end, cfg.tz)} ${x.title}`;

  const extra = agentes.mcpRun(pool, { tz: cfg.tz, tx });
  const run = {
    async estado() {
      const s = await buildState(pool, { tz: cfg.tz });
      const c = s.current;
      const ms = c ? c.segments.reduce((a, [x, y]) => a + ((y || Date.now()) - x), 0) : 0;
      const prox = [...s.agenda.blocks, ...s.agenda.events.filter((e) => !e.all_day)].filter((x) => x.end > Date.now()).sort((a, b) => a.start - b.start).slice(0, 5);
      return [
        c ? `${c.state === "running" ? "Corriendo" : "En pausa"}: ${c.title} (${fmtDur(ms)})` : "Nada corriendo.",
        `Medido hoy: ${fmtDur(s.hoy.medido_ms)}.`,
        prox.length ? `Lo que viene:\n${prox.map(linea).join("\n")}` : "Nada más agendado hoy.",
        s.sugerencias.length ? `Sugerencias ahora: ${s.sugerencias.map((x) => x.title).join(", ")}` : "",
      ].filter(Boolean).join("\n");
    },
    async iniciar({ que, proyecto }) {
      const r = await timer(async (q) => {
        let itemId = null;
        if (proyecto) {
          const p = await proyectos.buscarProyecto(q, proyecto);
          if (!p) throw new core.HttpError(404, `No encontré el proyecto «${proyecto}».`);
          const ya = await core.findItem(q, que);
          itemId = ya?.id || (await core.createItem(q, { title: que, proyecto_id: p.id })).id;
        }
        return core.start(q, { itemId, title: itemId ? null : que, source: "mcp" });
      });
      return r.already ? `Ya estaba corriendo: ${r.item.title}` : `Iniciado: ${r.item.title}`;
    },
    async parar() { const r = await timer((q) => core.stop(q)); return r ? (r.discarded ? `Descartado (menos de 30 s): ${r.title}` : `Registrado: ${r.title} (${fmtDur(r.ms)})`) : "No había nada corriendo."; },
    async pausar() { const r = await timer((q) => core.pause(q)); return `En pausa: ${r.title}`; },
    async seguir() { const r = await timer((q) => core.resume(q)); return `Corriendo: ${r.title}`; },
    async capturar({ texto, tipo }) { await tx(pool, (q) => core.capture(q, { text: texto, kind: tipo === "nota" ? "nota" : "captura", source: "mcp" })); return "Guardado en la bandeja."; },
    async agenda({ dias = 1 }) {
      const d0 = startOfDay(Date.now(), cfg.tz), d1 = addDays(d0, Math.min(14, Math.max(1, dias)), cfg.tz);
      const a = await agendaRange(pool, d0, d1);
      const xs = [...a.blocks.map((b) => ({ ...b, k: "bloque" })), ...a.events.map((e) => ({ ...e, k: e.calendario }))].sort((x, y) => x.start - y.start);
      if (!xs.length) return "Nada agendado.";
      let dia = "", out = [];
      for (const x of xs) {
        const k = dayKey(x.start, cfg.tz);
        if (k !== dia) { out.push(`\n${k}`); dia = k; }
        out.push(x.all_day ? `todo el día ${x.title} (${x.k})` : `${linea(x)} (${x.k})`);
      }
      return out.join("\n").trim();
    },
    async proyectos() {
      const { proyectos: ps, pilares } = await proyectos.listar(pool);
      if (!ps.length) return "No hay proyectos.";
      const pil = new Map(pilares.map((p) => [p.id, p.nombre]));
      return ps.map((p) => `• ${p.nombre}${p.pilar_id ? ` [${pil.get(p.pilar_id)}]` : ""} — ${p.estado}; ${p.abiertas} abiertas, ${p.hechas} hechas; medido ${fmtDur(p.min_medidos * 60000)} (semana ${fmtDur(p.min_semana * 60000)})${p.fecha_limite ? `; vence ${p.fecha_limite}` : ""}`).join("\n");
    },
    async tareas({ proyecto }) {
      let pid = null;
      if (proyecto) { const p = await proyectos.buscarProyecto(pool, proyecto); if (!p) return `No encontré el proyecto «${proyecto}».`; pid = p.id; }
      const r = await pool.query(`SELECT i.title, i.status, i.est_min, i.due_date, i.eisenhower, p.nombre AS proyecto FROM items i LEFT JOIN proyectos p ON p.id=i.proyecto_id
        WHERE i.kind='tarea' AND i.status IN ('pendiente','en curso') AND ($1::uuid IS NULL OR i.proyecto_id=$1) ORDER BY i.due_date NULLS LAST, i.created_at LIMIT 60`, [pid]);
      return r.rows.length ? r.rows.map((t) => `• ${t.title}${t.proyecto ? ` [${t.proyecto}]` : ""} — ${t.est_min} min${t.due_date ? `, vence ${new Date(t.due_date).toISOString().slice(0, 10)}` : ""}${t.eisenhower ? `, ${t.eisenhower}` : ""}${t.status === "en curso" ? " (en curso)" : ""}`).join("\n") : "No hay tareas abiertas.";
    },
    async crear_tarea({ titulo, proyecto, minutos, fecha_limite, eisenhower }) {
      const it = await tx(pool, async (q) => {
        const p = proyecto ? await proyectos.buscarProyecto(q, proyecto) : null;
        if (proyecto && !p) throw new core.HttpError(404, `No encontré el proyecto «${proyecto}».`);
        return core.createItem(q, { title: titulo, est_min: minutos || 30, due_date: fecha_limite || null, proyecto_id: p?.id || null, eisenhower });
      });
      return `Tarea creada: ${it.title}`;
    },
    async completar_tarea({ titulo }) {
      return tx(pool, async (q) => {
        const it = await core.findItem(q, titulo);
        if (!it) return `No encontré «${titulo}».`;
        await core.lockTimer(q);
        await core.updateItem(q, it.id, { status: "hecha" });
        return `Hecha: ${it.title}`;
      });
    },
    async agendar({ titulo, inicio, minutos = 60 }) {
      const a = Date.parse(inicio);
      if (!Number.isFinite(a)) throw new core.HttpError(400, "La fecha de inicio no es válida (usa ISO 8601).");
      await tx(pool, (q) => core.addBlock(q, { title: titulo, starts_at: a, ends_at: a + Math.max(5, minutos) * 60000 }));
      return `Agendado: ${fmtHora(a, cfg.tz)} ${titulo} (${minutos} min)`;
    },
    async armar_dia({ aplicar = false }) {
      const r = await armarHoy(pool, cfg.tz, { aplicar: !!aplicar });
      if (!r.plan.length) return "No hay nada nuevo que agendar hoy.";
      return `${aplicar ? "Agendé" : "Propuesta"}:\n${r.plan.map((p) => `${fmtHora(p.starts_at, cfg.tz)} ${p.title} (${p.motivo || "rutina"})`).join("\n")}`;
    },
    async registro({ dias = 7 }) {
      const r = await pool.query(`SELECT COALESCE(p.nombre, 'Sin proyecto') AS proyecto, s.title, SUM(EXTRACT(EPOCH FROM (COALESCE(g.ended_at, now())-g.started_at)))*1000 AS ms
        FROM sessions s JOIN segments g ON g.session_id=s.id LEFT JOIN items i ON i.id=s.item_id LEFT JOIN proyectos p ON p.id=i.proyecto_id
        WHERE g.started_at > now() - ($1 || ' days')::interval GROUP BY 1, 2 ORDER BY 1, 3 DESC`, [String(Math.min(60, Math.max(1, dias)))]);
      if (!r.rows.length) return "Nada registrado en ese período.";
      const por = new Map();
      for (const x of r.rows) { if (!por.has(x.proyecto)) por.set(x.proyecto, []); por.get(x.proyecto).push(x); }
      return [...por].map(([p, xs]) => `${p}: ${fmtDur(xs.reduce((a, x) => a + Number(x.ms), 0))}\n${xs.slice(0, 6).map((x) => `  · ${x.title} ${fmtDur(Number(x.ms))}`).join("\n")}`).join("\n");
    },
    async actividad_computador({ horas = 8 }) {
      const r = await resumenActividad(pool, Date.now() - Math.min(48, horas) * 3600_000, Date.now());
      if (!r.tramos.length) return "No hay actividad del computador (¿ActivityWatch está conectado?).";
      return `En el computador: ${fmtDur(r.total_ms)}; sin registrar: ${fmtDur(r.sin_registrar_ms)}.\n${r.apps.slice(0, 8).map((a) => `• ${a.app} ${fmtDur(a.ms)}`).join("\n")}`;
    },
  };

  const responder = (id, result) => ({ jsonrpc: "2.0", id, result });
  const error = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

  async function manejar(m) {
    if (!m || m.jsonrpc !== "2.0" || typeof m.method !== "string") return error(m?.id, -32600, "Petición no válida");
    const esNotif = m.id === undefined || m.id === null;
    if (m.method === "notifications/initialized" || m.method.startsWith("notifications/")) return null;
    if (m.method === "initialize") {
      const v = PROTOCOLOS.includes(m.params?.protocolVersion) ? m.params.protocolVersion : PROTOCOLOS[0];
      return responder(m.id, {
        protocolVersion: v, capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "veredicto", title: cfg.nombre, version: cfg.version || "3" },
        instructions: "Veredicto es el registro de tiempo y la agenda personal del usuario. Usa «estado» para saber qué hace ahora, «disponibilidad» antes de responder mensajes por él, «iniciar»/«parar» para medir, «capturar» para guardar ideas y «armar_dia» para planificar. Las horas están en " + cfg.tz + ".",
      });
    }
    if (m.method === "ping") return responder(m.id, {});
    const infra = (await agentes.modulos(pool)).infra;
    if (m.method === "tools/list") return responder(m.id, { tools: [...TOOLS, ...agentes.MCP_SIEMPRE, ...(infra ? agentes.MCP_AGENTES : [])] });
    if (m.method === "tools/call") {
      const nombre = m.params?.name;
      const deAgentes = agentes.MCP_AGENTES.some((t) => t.name === nombre);
      const fn = (Object.hasOwn(run, nombre) && run[nombre]) || ((!deAgentes || infra) && Object.hasOwn(extra, nombre) && extra[nombre]);
      if (!fn) return error(m.id, -32602, `Herramienta desconocida: ${m.params?.name}`);
      try {
        const text = await fn(m.params?.arguments || {});
        changed("mcp");
        return responder(m.id, { content: [{ type: "text", text: String(text) }], isError: false });
      } catch (e) {
        return responder(m.id, { content: [{ type: "text", text: e.status ? e.message : `Error: ${e.message}` }], isError: true });
      }
    }
    return esNotif ? null : error(m.id, -32601, `Método no soportado: ${m.method}`);
  }

  app.post("/mcp", need, async (req, res) => {
    const body = req.body;
    try {
      if (Array.isArray(body)) {
        const out = (await Promise.all(body.map(manejar))).filter(Boolean);
        return out.length ? res.json(out) : res.status(202).end();
      }
      const r = await manejar(body);
      return r ? res.json(r) : res.status(202).end();
    } catch (e) {
      console.error(e);
      res.status(500).json(error(body?.id, -32603, "Error interno"));
    }
  });
  app.get("/mcp", (req, res) => res.status(405).set("Allow", "POST").end());
  app.delete("/mcp", (req, res) => res.status(405).set("Allow", "POST").end());
  void currentSession;
}
