// Notas en Markdown (Obsidian, Logseq, cualquier carpeta de .md) en ambos sentidos.
// Cada casilla «- [ ] …» es una gestión. Marcarla en la app la marca en el archivo, y al revés.
import { readdir, readFile, writeFile, stat, mkdir, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const IGNORAR = new Set([".obsidian", ".trash", ".git", "node_modules", ".stfolder", "@eaDir", "#recycle"]);
const TAREA = /^(\s*)([-*+]|\d+[.)])\s+\[( |x|X)\]\s+(.+?)\s*$/;
const FECHA = /(?:📅|⏳|🛫)?\s*(\d{4}-\d{2}-\d{2})/;

// Ruta dentro de la carpeta; rechaza salirse de ella.
const seguro = (base, rel) => {
  const p = path.resolve(base, rel);
  if (!p.startsWith(path.resolve(base) + path.sep)) throw new Error("Ruta fuera de la carpeta de notas.");
  return p;
};

// Comprueba que la carpeta de notas exista.
export async function verificar(cfg) {
  const s = await stat(cfg.carpeta).catch(() => null);
  if (!s?.isDirectory()) throw new Error(`No encuentro la carpeta ${cfg.carpeta} dentro del contenedor. Revisa el volumen en compose.yaml.`);
  return true;
}

// Archivos .md de la carpeta (recursivo, con límite).
export async function listar(cfg, { max = 5000 } = {}) {
  const out = [];
  const walk = async (dir) => {
    for (const d of await readdir(dir, { withFileTypes: true })) {
      if (out.length >= max) return;
      if (d.name.startsWith(".") && d.name !== ".") { if (IGNORAR.has(d.name) || d.isDirectory()) continue; }
      if (IGNORAR.has(d.name)) continue;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) await walk(full);
      else if (d.name.toLowerCase().endsWith(".md")) {
        const s = await stat(full);
        out.push({ ref: path.relative(cfg.carpeta, full).split(path.sep).join("/"), version: String(Math.round(s.mtimeMs)), titulo: d.name.slice(0, -3) });
      }
    }
  };
  await walk(cfg.carpeta);
  return out;
}

// Texto de la tarea sin marcas de fecha ni de hecho.
const limpio = (t) => t.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/g, "").replace(FECHA, "").replace(/\s+/g, " ").trim();
// Id estable de una tarea Markdown (archivo + texto + ocurrencia).
const idDe = (ref, texto, n) => createHash("sha1").update(`${ref}|${limpio(texto).toLowerCase()}|${n}`).digest("hex").slice(0, 20);

// Tareas `- [ ]` de un archivo Markdown.
export function tareas(ref, text) {
  const vistos = new Map();
  const out = [];
  text.split(/\r?\n/).forEach((linea, i) => {
    const m = linea.match(TAREA);
    if (!m) return;
    const texto = m[4];
    const base = limpio(texto).toLowerCase();
    const n = vistos.get(base) || 0;
    vistos.set(base, n + 1);
    const f = texto.match(FECHA);
    out.push({ ext_id: idDe(ref, texto, n), titulo: limpio(texto).slice(0, 300) || "(sin título)", hecha: m[3] !== " ", fecha: f ? f[1] : null, linea: i });
  });
  return out;
}

// Lee las tareas de un archivo de la carpeta.
export async function leer(cfg, ref) {
  const text = await readFile(seguro(cfg.carpeta, ref), "utf8");
  return tareas(ref, text);
}

// Escribe un archivo de forma atómica (temporal + rename).
async function escribirAtomico(file, text) {
  const tmp = `${file}.veredicto-${process.pid}.tmp`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
}

// Marca o desmarca una casilla. Si el texto cambió en el archivo, no toca nada.
export async function marcar(cfg, ref, extId, hecha, { hoy } = {}) {
  const file = seguro(cfg.carpeta, ref);
  const text = await readFile(file, "utf8");
  const lineas = text.split(/\r?\n/);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const t = tareas(ref, text).find((x) => x.ext_id === extId);
  if (!t) throw Object.assign(new Error("La casilla ya no está en la nota."), { borrado: true });
  if (t.hecha === hecha) return false;
  const l = lineas[t.linea];
  lineas[t.linea] = hecha
    ? l.replace(/\[ \]/, "[x]") + (hoy && /✅/.test(text) ? ` ✅ ${hoy}` : "")
    : l.replace(/\[(x|X)\]/, "[ ]").replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, "");
  await escribirAtomico(file, lineas.join(eol));
  return true;
}

// Agrega una línea a la nota de bandeja del día (Bandeja/AAAA-MM-DD.md).
export async function bandeja(cfg, texto, { dia, carpeta = "Bandeja", casilla = true } = {}) {
  const dir = seguro(cfg.carpeta, carpeta);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${dia}.md`);
  const prev = await readFile(file, "utf8").catch(() => `# Bandeja ${dia}\n`);
  const lineas = String(texto).trim().split(/\r?\n/);
  const primera = `${casilla ? "- [ ] " : "- "}${lineas[0]}`;
  const resto = lineas.slice(1).map((l) => `    ${l}`);
  await escribirAtomico(file, `${prev.replace(/\n*$/, "\n")}${[primera, ...resto].join("\n")}\n`);
  return path.relative(cfg.carpeta, file).split(path.sep).join("/");
}
