import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const sqlDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "sql");

// Pool de conexiones PostgreSQL.
export const createPool = (url) => new pg.Pool({ connectionString: url, max: 10 });

// Aplica en orden las migraciones de sql/ que falten.
export async function migrate(pool) {
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now())");
  for (const f of (await readdir(sqlDir)).filter((x) => x.endsWith(".sql")).sort()) {
    if ((await pool.query("SELECT 1 FROM schema_migrations WHERE name=$1", [f])).rowCount) continue;
    await tx(pool, async (q) => {
      await q.query(await readFile(path.join(sqlDir, f), "utf8"));
      await q.query("INSERT INTO schema_migrations(name) VALUES ($1)", [f]);
    });
  }
}

// Corre una función dentro de una transacción (BEGIN/COMMIT/ROLLBACK).
export async function tx(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// Registra una línea en la bitácora de actividad.
export const log = (q, kind, detail = "") =>
  q.query("INSERT INTO activity(kind, detail) VALUES ($1,$2)", [kind, String(detail).slice(0, 500)]);

// Lee un ajuste guardado (o el valor por defecto).
export async function getSetting(q, key, fallback = null) {
  const r = await q.query("SELECT value FROM settings WHERE key=$1", [key]);
  return r.rowCount ? r.rows[0].value : fallback;
}
// Guarda un ajuste (insertar o reemplazar).
export const setSetting = (q, key, value) =>
  q.query("INSERT INTO settings(key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [key, JSON.stringify(value)]);
