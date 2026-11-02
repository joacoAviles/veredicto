import { createPool, migrate } from "./db.js";
import { createApp } from "./app.js";
import { setupCode, presetAccount } from "./auth.js";
import { refreshCalendars } from "./conectores/ical.js";
import { pushPending } from "./conectores/notion.js";
import { vigilar } from "./vigilante.js";
import { armadoMatinal, changed } from "./servicios.js";
import { isValidZone } from "./time.js";

const env = process.env;
const tz = env.ZONA_HORARIA || env.TZ || "America/Santiago";
if (!isValidZone(tz)) { console.error(`ZONA_HORARIA no válida: ${tz}`); process.exit(1); }
if (!env.DATABASE_URL) { console.error("Falta DATABASE_URL"); process.exit(1); }

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

const publicUrl = (env.URL_PUBLICA || "").replace(/\/$/, "");
const themeDir = env.TEMA_DIR || "/tema";
const app = createApp(pool, {
  tz, publicUrl,
  nombre: env.NOMBRE || "Juez del Tiempo",
  theme: env.TEMA || "neutro",
  themeDir,
  secureCookie: env.COOKIE_SEGURA ? env.COOKIE_SEGURA === "1" : undefined,
});
const port = Number(env.PORT || 8080);
app.listen(port, () => {
  console.log(`Juez del Tiempo escuchando en :${port} (${tz})`);
  if (!publicUrl) console.log("Aviso: sin URL_PUBLICA los botones de las notificaciones no funcionan.");
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
every(10 * 60_000, "calendarios", async () => { await refreshCalendars(pool, tz); changed("calendarios"); });
every(15_000, "notion", async () => { const r = await pushPending(pool); if (r.enviados || r.errores) changed("notion"); });
every(60_000, "vigilante", () => vigilar(pool, { tz, publicUrl, themeDir }));
every(5 * 60_000, "armado", () => armadoMatinal(pool, tz, { publicUrl, themeDir }));

const bye = async () => { await pool.end().catch(() => {}); process.exit(0); };
process.on("SIGTERM", bye);
process.on("SIGINT", bye);
