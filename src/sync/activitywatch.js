// ActivityWatch: qué hiciste en el computador (app y ventana), sin tiempo inactivo.
// Veredicto lee el servidor de ActivityWatch de tu computador por la red y guarda tramos resumidos.
import { getSetting, setSetting } from "../db.js";

const MIN_TRAMO = 60_000;   // tramos de menos de 1 minuto no se guardan
const UNIR = 90_000;        // misma app con pausas cortas = un solo tramo

// GET a la API de ActivityWatch con tiempo límite.
async function aw(url, path, fetcher = fetch) {
  const r = await fetcher(url.replace(/\/$/, "") + path, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`ActivityWatch respondió ${r.status}`);
  return r.json();
}

// Prueba la conexión a ActivityWatch y encuentra sus buckets.
export async function probar(url, fetcher = fetch) {
  let buckets;
  try { buckets = await aw(url, "/api/0/buckets/", fetcher); }
  catch (e) {
    throw new Error(`No pude conectar con ActivityWatch en ${url}. Revisa que esté abierto y que acepte conexiones de la red (host = "0.0.0.0" en su configuración). Detalle: ${e.message}`);
  }
  const ids = Object.keys(buckets);
  const ventana = ids.filter((b) => b.startsWith("aw-watcher-window"));
  const afk = ids.filter((b) => b.startsWith("aw-watcher-afk"));
  if (!ventana.length) throw new Error("ActivityWatch responde, pero no tiene el vigilante de ventanas (aw-watcher-window).");
  return { equipos: ventana.map((b) => b.replace(/^aw-watcher-window_?/, "") || "equipo"), ventana, afk };
}

// Intervalos activos (no-afk) de un equipo.
const activos = (afkEvents) => afkEvents
  .filter((e) => e.data?.status === "not-afk")
  .map((e) => { const a = Date.parse(e.timestamp); return [a, a + e.duration * 1000]; })
  .sort((x, y) => x[0] - y[0]);

// Recorta un tramo a los períodos con actividad (sin AFK).
function recortar([a, b], acts) {
  if (!acts) return [[a, b]];
  const out = [];
  for (const [x, y] of acts) { const s = Math.max(a, x), t = Math.min(b, y); if (t > s) out.push([s, t]); }
  return out;
}

// Quita del título de ventana el nombre del navegador.
const limpiarTitulo = (t) => String(t || "").replace(/\s+[—–-]\s+(Google Chrome|Safari|Firefox|Arc|Brave|Microsoft Edge)$/i, "").slice(0, 160);

// Convierte eventos de ventana en tramos por app (unidos si hay pausas cortas).
export function tramos(windowEvents, afkEvents) {
  const acts = afkEvents?.length ? activos(afkEvents) : null;
  const piezas = [];
  for (const e of windowEvents) {
    const a = Date.parse(e.timestamp), b = a + (e.duration || 0) * 1000;
    if (b - a < 1000) continue;
    for (const [s, t] of recortar([a, b], acts)) piezas.push({ s, t, app: String(e.data?.app || "Desconocida").slice(0, 80), titulo: limpiarTitulo(e.data?.title) });
  }
  piezas.sort((x, y) => x.s - y.s);
  const out = [];
  for (const p of piezas) {
    const u = out.at(-1);
    if (u && u.app === p.app && p.s - u.fin <= UNIR) {
      u.fin = Math.max(u.fin, p.t);
      u.titulos.set(p.titulo, (u.titulos.get(p.titulo) || 0) + (p.t - p.s));
    } else out.push({ inicio: p.s, fin: p.t, app: p.app, titulos: new Map([[p.titulo, p.t - p.s]]) });
  }
  return out.filter((x) => x.fin - x.inicio >= MIN_TRAMO).map((x) => ({
    inicio: x.inicio, fin: x.fin, app: x.app,
    titulo: [...x.titulos].sort((a, b) => b[1] - a[1])[0][0],
  }));
}

// Trae las últimas horas y reemplaza los tramos no registrados de esa ventana.
export async function sincronizar(pool, { horas = 6, now = Date.now(), fetcher = fetch } = {}) {
  const cfg = await getSetting(pool, "activitywatch", null);
  if (!cfg?.url || cfg.activo === false) return { configurado: false };
  try {
    const info = await probar(cfg.url, fetcher);
    const desde = now - horas * 3600_000;
    const q = `?start=${new Date(desde).toISOString()}&end=${new Date(now).toISOString()}&limit=-1`;
    let total = 0;
    for (let i = 0; i < info.ventana.length; i++) {
      const equipo = info.equipos[i];
      const win = await aw(cfg.url, `/api/0/buckets/${encodeURIComponent(info.ventana[i])}/events${q}`, fetcher);
      const afkB = info.afk.find((b) => b.endsWith(equipo)) || info.afk[0];
      const afk = afkB ? await aw(cfg.url, `/api/0/buckets/${encodeURIComponent(afkB)}/events${q}`, fetcher) : [];
      const ts = tramos(win, afk);
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("DELETE FROM actividad WHERE fuente=$1 AND inicio >= $2 AND NOT registrado AND NOT demo", [equipo, new Date(desde)]);
        for (const t of ts) {
          await c.query("INSERT INTO actividad(fuente,inicio,fin,app,titulo) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (fuente,inicio,app,titulo) DO UPDATE SET fin=EXCLUDED.fin",
            [equipo, new Date(t.inicio), new Date(t.fin), t.app, t.titulo]);
        }
        await c.query("COMMIT");
      } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
      total += ts.length;
    }
    await setSetting(pool, "activitywatch", { ...cfg, ultimo_ok: now, error: "" });
    return { configurado: true, tramos: total, equipos: info.equipos };
  } catch (e) {
    await setSetting(pool, "activitywatch", { ...cfg, error: String(e.message).slice(0, 300) });
    throw e;
  }
}

// Resumen de un rango: tramos (con si ya están registrados o cubiertos por una sesión) y total por app.
export async function resumen(q, desde, hasta) {
  const ts = (await q.query("SELECT * FROM actividad WHERE inicio < $2 AND fin > $1 ORDER BY inicio", [new Date(desde), new Date(hasta)])).rows;
  const ses = (await q.query(
    "SELECT g.started_at a, COALESCE(g.ended_at, now()) b FROM segments g WHERE g.started_at < $2 AND COALESCE(g.ended_at, now()) > $1", [new Date(desde), new Date(hasta)])).rows
    .map((r) => [+r.a, +r.b]);
  const cubierto = (a, b) => ses.reduce((acc, [x, y]) => acc + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0) >= (b - a) * 0.6;
  const porApp = new Map();
  const tramosOut = ts.map((t) => {
    const a = +t.inicio, b = +t.fin;
    porApp.set(t.app, (porApp.get(t.app) || 0) + (b - a));
    return { id: Number(t.id), inicio: a, fin: b, app: t.app, titulo: t.titulo, equipo: t.fuente, registrado: t.registrado || cubierto(a, b) };
  });
  return {
    tramos: tramosOut,
    apps: [...porApp].sort((x, y) => y[1] - x[1]).map(([app, ms]) => ({ app, ms })),
    total_ms: [...porApp.values()].reduce((a, b) => a + b, 0),
    sin_registrar_ms: tramosOut.filter((t) => !t.registrado).reduce((a, t) => a + (t.fin - t.inicio), 0),
  };
}

// Lo que estás haciendo en el computador ahora (para el vigilante).
export async function reciente(q, now = Date.now()) {
  const r = (await q.query("SELECT app, inicio, fin FROM actividad WHERE fin > $1 ORDER BY fin DESC LIMIT 1", [new Date(now - 15 * 60_000)])).rows[0];
  return r ? { app: r.app, minutos: Math.round((+r.fin - +r.inicio) / 60000) } : null;
}
