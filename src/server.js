import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createPool, migrate, getSetting, setSetting } from "./db.js";
import { createApp } from "./app.js";
import { setupCode, presetAccount } from "./auth.js";
import { initClave } from "./cifrado.js";
import { refreshCalendars } from "./conectores/ical.js";
import { sincronizar } from "./sync/motor.js";
import { vigilar, DEFAULTS } from "./vigilante.js";
import { armadoMatinal, changed } from "./servicios.js";
import { enviar } from "./conectores/avisos.js";
import { isValidZone } from "./time.js";

const env = process.env;
const tz = env.ZONA_HORARIA || env.TZ || "America/Santiago";
if (!isValidZone(tz)) { console.error(`ZONA_HORARIA no válida: ${tz}`); process.exit(1); }
if (!env.DATABASE_URL) { console.error("Falta DATABASE_URL"); process.exit(1); }

// Todo lo tuyo vive en una sola carpeta: /datos (tema, notas, respaldos, clave).
const datos = env.DATOS_DIR || "/datos";
const themeDir = env.TEMA_DIR || path.join(datos, "tema");
const notasDir = env.NOTAS_DIR || path.join(datos, "notas");
for (const d of [themeDir, notasDir]) await mkdir(d, { recursive: true }).catch(() => {});
await initClave({ env, datos });

const pool = createPool(env.DATABASE_URL);
for (let i = 0; ; i++) {
  try { await pool.query("SELECT 1"); break; } catch (e) {
    if (i > 30) throw e;
    console.log("Esperando la base de datos…");
    await new Promise((r) => setTimeout(r, 2000));
  }
}
await migrate(pool);
await presetAccount(pool, env.ADMIN_PASSWORD);

const nombre = env.NOMBRE || "Veredicto";
const publicUrl = (env.URL_PUBLICA || "").replace(/\/$/, "");
const app = createApp(pool, {
  tz, publicUrl, nombre, themeDir, notasDir,
  theme: env.TEMA || "neutro",
  secureCookie: env.COOKIE_SEGURA ? env.COOKIE_SEGURA === "1" : undefined,
});
const port = Number(env.PORT || 8080);
app.listen(port, () => {
  console.log(`${nombre} escuchando en :${port} (${tz}) · datos en ${datos}`);
  if (!publicUrl) console.log("Aviso: sin URL_PUBLICA no funcionan los botones de los avisos ni la conexión con Google/Outlook.");
});

const code = await setupCode(pool);
if (code) console.log(`\n  ┌──────────────────────────────────────────┐\n  │  Código de instalación:  ${code}        │\n  │  Ábrelo en el navegador y crea tu clave. │\n  └──────────────────────────────────────────┘\n`);

// Tareas de fondo. Cada una protegida: un error no tumba el servidor.
const every = (ms, name, fn) => {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try { await fn(); } catch (e) { console.error(`[${name}]`, e.message || e); } finally { busy = false; }
  };
  setTimeout(run, 3000);
  return setInterval(run, ms);
};
const minutosSync = Math.max(1, Number(env.SYNC_MINUTOS || 2));
every(minutosSync * 60_000, "sincronizar", async () => {
  const r = await sincronizar(pool, { tz });
  if (r.cuentas.length || r.cola.ok || r.cola.err) changed("sync");
});
every(10 * 60_000, "ical", async () => { await refreshCalendars(pool, tz); changed("calendarios"); });
every(60_000, "vigilante", () => vigilar(pool, { tz, publicUrl, themeDir }));
every(5 * 60_000, "armado", () => armadoMatinal(pool, tz, { publicUrl, themeDir }));
// Si una cuenta lleva más de 1 hora fallando, te avisa una vez.
every(10 * 60_000, "salud", async () => {
  const malas = (await pool.query("SELECT id, nombre, ultimo_error FROM cuentas WHERE activa AND error_desde < now() - interval '1 hour'")).rows;
  const avisadas = (await getSetting(pool, "cuentas_avisadas", {})) || {};
  const cfg = { ...DEFAULTS, ...(await getSetting(pool, "avisos", {})) };
  for (const c of malas) {
    if (avisadas[c.id]) continue;
    await enviar(cfg.canales, { titulo: `${c.nombre} no sincroniza`, mensaje: c.ultimo_error, prioridad: 4, abrir: publicUrl ? `${publicUrl}/#ajustes` : undefined, acciones: [] });
    avisadas[c.id] = Date.now();
  }
  for (const id of Object.keys(avisadas)) if (!malas.some((c) => c.id === id)) delete avisadas[id];
  await setSetting(pool, "cuentas_avisadas", avisadas);
});

const bye = async () => { await pool.end().catch(() => {}); process.exit(0); };
process.on("SIGTERM", bye);
process.on("SIGINT", bye);
