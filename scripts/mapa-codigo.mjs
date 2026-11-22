#!/usr/bin/env node
// Genera MAPA-CODIGO.md: rutas HTTP, herramientas MCP y cada función de primer nivel con su línea y propósito.
// Uso: node scripts/mapa-codigo.mjs          (escribe el mapa)
//      node scripts/mapa-codigo.mjs --check  (falla si está desactualizado o falta un comentario)
// El propósito sale del comentario `//` (o `/** */`) justo encima de cada función.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SALIDA = path.join(RAIZ, "MAPA-CODIGO.md");
const FN = /^(export\s+)?(?:(async\s+)?function\s*\*?\s*(\w+)\s*\(|const\s+(\w+)\s*=\s*(async\s*)?(?:function\b|\([^)]*\)\s*=>|\w+\s*=>|\(\s*$))/;
const RUTA = /\bapp\.(get|post|put|patch|delete|all)\(\s*(\[[^\]]*\]|["'`][^"'`]+["'`])/g;

// Archivos .js de una carpeta, ordenados.
function archivos(dir) {
  const out = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d).sort()) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".js") || p.endsWith(".mjs")) out.push(p);
    }
  };
  walk(path.join(RAIZ, dir));
  return out;
}

// Comentario inmediatamente encima de la línea i (una o varias líneas `//`, o el final de un `/** */`).
function comentario(L, i) {
  const partes = [];
  let j = i - 1;
  if (j >= 0 && L[j].trim().endsWith("*/")) {
    while (j >= 0 && !L[j].includes("/*")) partes.unshift(L[j--]);
    if (j >= 0) partes.unshift(L[j]);
    return partes.join(" ").replace(/\/\*+|\*+\/|^\s*\*|\s\*\s/g, " ").replace(/\s+/g, " ").trim();
  }
  while (j >= 0 && L[j].trim().startsWith("//")) partes.unshift(L[j--].trim().replace(/^\/\/\s?/, ""));
  return partes.join(" ").trim();
}

export function generar() {
  const rutas = [], cuerpo = [], faltan = [];
  const fuentes = [...archivos("src"), path.join(RAIZ, "public/app.js"), path.join(RAIZ, "public/sw.js")];
  for (const f of fuentes) {
    const rel = path.relative(RAIZ, f);
    const L = fs.readFileSync(f, "utf8").split("\n");
    const cab = comentario(L, L.findIndex((l) => l.trim() && !l.trim().startsWith("//")) ) || "";
    const lineas = [];
    L.forEach((l, i) => {
      const m = l.match(FN);
      if (m) {
        const nombre = m[3] || m[4];
        const doc = comentario(L, i);
        if (!doc) faltan.push(`${rel}:${i + 1} ${nombre}`);
        lineas.push(`- \`${nombre}\` · L${i + 1}${m[1] ? " · exportada" : ""}${doc ? ` — ${doc}` : ""}`);
      }
      for (const r of l.matchAll(RUTA)) {
        const ruta = r[2].replace(/["'`\[\]]/g, "").replace(/,\s*/g, " · ");
        rutas.push(`| \`${r[1].toUpperCase()} ${ruta}\` | \`${rel}\` L${i + 1} |`);
      }
    });
    cuerpo.push(`\n### \`${rel}\``, cab ? cab : "_(sin comentario de cabecera)_", ...lineas);
  }
  const mcp = [];
  const fMcp = fs.readFileSync(path.join(RAIZ, "src/mcp.js"), "utf8") + fs.readFileSync(path.join(RAIZ, "src/agentes.js"), "utf8");
  for (const m of fMcp.matchAll(/name:\s*"(\w+)",\s*description:\s*"([^"]+)"/g)) mcp.push(`| \`${m[1]}\` | ${m[2]} |`);
  const texto = [
    "# Mapa del código — Veredicto",
    "",
    "Generado por `node scripts/mapa-codigo.mjs`. No editar a mano: corre el script tras cambiar código.",
    "Cada función de primer nivel aparece con su línea (`L`) y su propósito (el comentario que va encima).",
    "",
    "## Rutas HTTP",
    "| Ruta | Dónde |",
    "| --- | --- |",
    ...rutas,
    "",
    "## Herramientas MCP",
    "| Herramienta | Qué hace |",
    "| --- | --- |",
    ...mcp,
    "",
    "## Funciones por archivo",
    ...cuerpo,
    "",
  ].join("\n");
  return { texto, faltan };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { texto, faltan } = generar();
  if (process.argv.includes("--check")) {
    const actual = fs.existsSync(SALIDA) ? fs.readFileSync(SALIDA, "utf8") : "";
    const errores = [];
    if (faltan.length) errores.push("Funciones sin comentario:\n" + faltan.join("\n"));
    if (actual !== texto) errores.push("MAPA-CODIGO.md desactualizado: corre node scripts/mapa-codigo.mjs");
    if (errores.length) { console.error(errores.join("\n\n")); process.exit(1); }
  } else {
    fs.writeFileSync(SALIDA, texto);
    console.log(`MAPA-CODIGO.md: ${texto.split("\n").length} líneas${faltan.length ? `; sin comentario: ${faltan.length}` : ""}`);
  }
}
