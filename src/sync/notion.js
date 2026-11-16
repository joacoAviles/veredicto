// Notion en ambos sentidos: las casillas (to_do) de las páginas bajo tu página raíz son gestiones.
import { Client } from "@notionhq/client";

export const cliente = (cfg, fetcher) => new Client({ auth: cfg.token, timeoutMs: 25_000, ...(fetcher ? { fetch: fetcher } : {}) });

export function pageIdFrom(input) {
  const m = String(input || "").match(/([0-9a-f]{32})|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? (m[1] || m[2]).replace(/-/g, "") : null;
}
const plano = (rt) => (rt || []).map((x) => x.plain_text || "").join("").trim();
const tituloDe = (p) => plano(Object.values(p.properties || {}).find((x) => x.type === "title")?.title) || "Sin título";

export async function verificar(cfg, n = cliente(cfg)) {
  const id = pageIdFrom(cfg.raiz);
  if (!id) throw new Error("No reconozco esa página. Pega el enlace completo de la página de Notion.");
  try { await n.pages.retrieve({ page_id: id }); } catch (e) {
    throw new Error(e.status === 401 ? "Notion rechazó el token." : e.status === 404 ? "La integración no ve esa página. En Notion: ••• → Conexiones → agrega tu integración." : e.message);
  }
  return id;
}

// Páginas editadas desde «desde» (ISO). La integración solo ve lo que compartiste con ella.
export async function cambiadas(cfg, desde, n = cliente(cfg)) {
  const out = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const r = await n.search({ filter: { property: "object", value: "page" }, sort: { direction: "descending", timestamp: "last_edited_time" }, page_size: 100, start_cursor: cursor });
    for (const p of r.results) {
      if (p.archived || p.in_trash) continue;
      if (desde && p.last_edited_time <= desde) return out;
      out.push({ ref: p.id, version: p.last_edited_time, titulo: tituloDe(p), url: p.url });
    }
    if (!r.has_more) break;
    cursor = r.next_cursor;
  }
  return out;
}

// Casillas de una página (incluye las anidadas hasta 2 niveles).
export async function leer(cfg, pageId, n = cliente(cfg)) {
  const out = [];
  const walk = async (id, nivel) => {
    let cursor;
    do {
      const r = await n.blocks.children.list({ block_id: id, page_size: 100, start_cursor: cursor });
      for (const b of r.results) {
        if (b.type === "to_do") {
          const texto = plano(b.to_do.rich_text);
          const fecha = (b.to_do.rich_text || []).find((x) => x.type === "mention" && x.mention?.type === "date")?.mention.date.start?.slice(0, 10) || null;
          if (texto) out.push({ ext_id: b.id, titulo: texto.slice(0, 300), hecha: !!b.to_do.checked, fecha });
        }
        if (b.has_children && nivel < 2 && b.type !== "child_page" && b.type !== "child_database") await walk(b.id, nivel + 1);
      }
      cursor = r.has_more ? r.next_cursor : undefined;
    } while (cursor);
  };
  await walk(pageId, 0);
  return out;
}

export async function marcar(cfg, blockId, hecha, n = cliente(cfg)) {
  try { await n.blocks.update({ block_id: blockId, to_do: { checked: !!hecha } }); }
  catch (e) { if (e.status === 404) throw Object.assign(new Error("La casilla ya no está en Notion."), { borrado: true }); throw e; }
  return true;
}

// Agrega una casilla a la página «Bandeja» (la crea bajo tu raíz la primera vez).
export async function bandeja(cfg, texto, { onConfig } = {}, n = cliente(cfg)) {
  if (!cfg.bandeja) {
    const p = await n.pages.create({ parent: { page_id: pageIdFrom(cfg.raiz) }, properties: { title: { title: [{ text: { content: "Bandeja" } }] } } });
    cfg.bandeja = p.id;
    if (onConfig) await onConfig(cfg);
  }
  const [primera, ...resto] = String(texto).trim().split(/\r?\n/);
  await n.blocks.children.append({
    block_id: cfg.bandeja,
    children: [{
      object: "block", type: "to_do",
      to_do: {
        rich_text: [{ type: "text", text: { content: primera.slice(0, 1900) } }], checked: false,
        children: resto.filter(Boolean).slice(0, 50).map((l) => ({ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: l.slice(0, 1900) } }] } })),
      },
    }],
  });
  return cfg.bandeja;
}
