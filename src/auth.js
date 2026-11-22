// Una cuenta por instalación: contraseña (scrypt), cookie de sesión y tokens para atajos.
import { randomBytes, scryptSync, timingSafeEqual, createHash, createHmac } from "node:crypto";
import { getSetting, setSetting } from "./db.js";

// SHA-256 en hexadecimal.
const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
// Compara dos textos en tiempo constante.
const same = (a, b) => {
  const x = Buffer.from(sha(a)), y = Buffer.from(sha(b));
  return timingSafeEqual(x, y);
};

// Hash scrypt con sal para la contraseña de la cuenta.
export function hashPassword(pw) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}
// Verifica una contraseña contra su hash scrypt.
export function checkPassword(pw, stored) {
  const [, salt, hex] = String(stored || "").split(":");
  if (!salt || !hex) return false;
  const a = scryptSync(String(pw), salt, 64), b = Buffer.from(hex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// Secreto del servidor para firmar acciones (se crea la primera vez).
export async function secret(pool) {
  let s = await getSetting(pool, "secreto");
  if (!s) { s = randomBytes(32).toString("hex"); await setSetting(pool, "secreto", s); }
  return s;
}

// Código de instalación: se muestra en los registros del contenedor hasta que crees la cuenta.
export async function setupCode(pool) {
  if (await getSetting(pool, "cuenta")) return null;
  let c = await getSetting(pool, "codigo_instalacion");
  if (!c) { c = randomBytes(4).toString("hex").toUpperCase(); await setSetting(pool, "codigo_instalacion", c); }
  return c;
}

// Crea la única cuenta con el código de instalación; falla si ya existe.
export async function createAccount(pool, { password, codigo }) {
  if (await getSetting(pool, "cuenta")) throw Object.assign(new Error("La cuenta ya existe."), { status: 409 });
  const expected = await getSetting(pool, "codigo_instalacion");
  if (!expected || !same(String(codigo || "").trim().toUpperCase(), expected)) throw Object.assign(new Error("Código de instalación incorrecto. Míralo en los registros del contenedor."), { status: 403 });
  if (String(password || "").length < 8) throw Object.assign(new Error("Usa al menos 8 caracteres."), { status: 400 });
  await setSetting(pool, "cuenta", { hash: hashPassword(password), creada: new Date().toISOString() });
  await pool.query("DELETE FROM settings WHERE key='codigo_instalacion'");
}

// Crea la cuenta desde una contraseña de entorno si aún no existe.
export async function presetAccount(pool, password) {
  if (!password || (await getSetting(pool, "cuenta"))) return;
  await setSetting(pool, "cuenta", { hash: hashPassword(password), creada: new Date().toISOString() });
  await pool.query("DELETE FROM settings WHERE key='codigo_instalacion'");
}

// Valida la contraseña y abre una sesión (cookie) nueva.
export async function login(pool, password, label = "") {
  const c = await getSetting(pool, "cuenta");
  if (!c || !checkPassword(password, c.hash)) return null;
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO auth_sessions(id_hash,label,expires_at) VALUES ($1,$2, now() + interval '180 days')", [sha(token), String(label).slice(0, 80)]);
  return token;
}

// Alcance: atajo (Siri, reloj, MCP) · agente (Hermes: /api/agente y MCP) · carpeta (carpeta sincronizada).
export async function newApiToken(pool, label, alcance = "atajo") {
  alcance = ["agente", "carpeta"].includes(alcance) ? alcance : "atajo";
  const token = { atajo: "jdt_", agente: "jdg_", carpeta: "jdc_" }[alcance] + randomBytes(24).toString("base64url");
  const r = await pool.query("INSERT INTO api_tokens(hash,label,alcance) VALUES ($1,$2,$3) RETURNING id, label, alcance, created_at",
    [sha(token), String(label || { atajo: "Atajo", agente: "Agente", carpeta: "Carpeta" }[alcance]).slice(0, 60), alcance]);
  return { ...r.rows[0], token };
}

const cookieName = "jdt_sesion";
// Lee la cookie de sesión de la petición.
export const readCookie = (req) =>
  (req.headers.cookie || "").split(";").map((x) => x.trim()).find((x) => x.startsWith(cookieName + "="))?.slice(cookieName.length + 1);

// Deja la cookie de sesión (HttpOnly, 180 días; Secure si corresponde).
export function setCookie(res, token, secure) {
  res.setHeader("Set-Cookie", `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${180 * 86400}${secure ? "; Secure" : ""}`);
}
// Borra la cookie de sesión.
export const clearCookie = (res) => res.setHeader("Set-Cookie", `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);

// Autentica por cookie (navegador) o por token (atajos): cabecera Bearer o ?k=.
export async function identify(pool, req) {
  const c = readCookie(req);
  if (c) {
    const r = await pool.query("SELECT 1 FROM auth_sessions WHERE id_hash=$1 AND expires_at > now()", [sha(c)]);
    if (r.rowCount) return { via: "cookie" };
  }
  const h = req.headers.authorization || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7).trim() : typeof req.query?.k === "string" ? req.query.k : null;
  if (tok) {
    const r = await pool.query("UPDATE api_tokens SET last_used_at=now() WHERE hash=$1 RETURNING id, label, alcance", [sha(tok)]);
    if (r.rowCount) return { via: "token", label: r.rows[0].label, alcance: r.rows[0].alcance };
  }
  return null;
}

// Cierra la sesión del navegador actual.
export async function logout(pool, req) {
  const c = readCookie(req);
  if (c) await pool.query("DELETE FROM auth_sessions WHERE id_hash=$1", [sha(c)]);
}

// Enlaces firmados para los botones de los avisos (válidos 12 horas).
export function signAction(sec, action, payload, ttlMs = 12 * 3600_000, now = Date.now()) {
  const exp = now + ttlMs;
  const body = Buffer.from(JSON.stringify({ a: action, p: payload, e: exp })).toString("base64url");
  const sig = createHmac("sha256", sec).update(body).digest("base64url");
  return `${body}.${sig}`;
}
// Verifica y decodifica un enlace de acción firmado (HMAC) que aún no vence.
export function verifyAction(sec, token, now = Date.now()) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", sec).update(body).digest("base64url");
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  const d = JSON.parse(Buffer.from(body, "base64url").toString());
  return d.e > now ? d : null;
}

export { sha };
