// Credenciales de tus cuentas cifradas en la base (AES-256-GCM).
// La clave vive solo en tu servidor: variable CLAVE_CIFRADO o, si falta, /datos/clave/clave.key (se crea sola).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

let KEY = null;

export async function initClave({ env = process.env, datos = "/datos" } = {}) {
  let raw = env.CLAVE_CIFRADO;
  if (!raw) {
    const f = path.join(datos, "clave", "clave.key");
    try { raw = (await readFile(f, "utf8")).trim(); } catch {
      raw = randomBytes(32).toString("base64url");
      await mkdir(path.dirname(f), { recursive: true }).catch(() => {});
      await writeFile(f, raw + "\n", { mode: 0o600 }).catch((e) => {
        throw new Error(`No pude guardar la clave de cifrado en ${f}: ${e.message}. Define CLAVE_CIFRADO en .env.`);
      });
      console.log(`Clave de cifrado nueva guardada en ${f}. Respáldala junto con la base.`);
    }
  }
  setClave(raw);
}

export const setClave = (raw) => { KEY = createHash("sha256").update(String(raw)).digest(); };

export function cifrar(obj) {
  if (!KEY) throw new Error("Clave de cifrado sin iniciar.");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", KEY, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}

export function descifrar(s) {
  if (!KEY) throw new Error("Clave de cifrado sin iniciar.");
  const [v, iv, tag, data] = String(s).split(".");
  if (v !== "v1") throw new Error("Formato cifrado desconocido.");
  const d = createDecipheriv("aes-256-gcm", KEY, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  try {
    return JSON.parse(Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8"));
  } catch {
    throw new Error("No pude descifrar una cuenta: ¿cambió la clave de cifrado?");
  }
}
