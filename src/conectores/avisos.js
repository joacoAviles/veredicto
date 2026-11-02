// Canales de aviso: ntfy, Telegram y webhook. Cada aviso puede traer hasta 3 acciones (enlaces firmados).
export async function enviar(canales, aviso, { fetcher = fetch } = {}) {
  const res = [];
  const tasks = [];
  if (canales?.ntfy?.topic) tasks.push(["ntfy", () => ntfy(canales.ntfy, aviso, fetcher)]);
  if (canales?.telegram?.token && canales?.telegram?.chat) tasks.push(["telegram", () => telegram(canales.telegram, aviso, fetcher)]);
  if (canales?.webhook?.url) tasks.push(["webhook", () => webhook(canales.webhook, aviso, fetcher)]);
  for (const [name, fn] of tasks) {
    try { await fn(); res.push({ canal: name, ok: true }); }
    catch (e) { res.push({ canal: name, ok: false, error: String(e.message || e) }); }
  }
  return res;
}

async function ntfy(c, a, fetcher) {
  const server = (c.server || "https://ntfy.sh").replace(/\/$/, "");
  const r = await fetcher(server, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(c.token ? { Authorization: `Bearer ${c.token}` } : {}) },
    body: JSON.stringify({
      topic: c.topic, title: a.titulo, message: a.mensaje, priority: a.prioridad || 3,
      tags: a.tags ? String(a.tags).split(",").map((t) => t.trim()).filter(Boolean) : a.prioridad >= 5 ? ["rotating_light"] : ["stopwatch"],
      ...(a.abrir ? { click: a.abrir } : {}),
      ...(a.icono ? { icon: a.icono } : {}),
      actions: (a.acciones || []).slice(0, 3).map((x) => x.vista
        ? { action: "view", label: x.label.slice(0, 40), url: x.url, clear: true }
        : { action: "http", label: x.label.slice(0, 40), url: x.url, method: "POST", clear: true }),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`ntfy respondió ${r.status}`);
}

async function telegram(c, a, fetcher) {
  // Telegram no hace POST desde un botón: los botones abren el enlace firmado (GET).
  const keyboard = (a.acciones || []).slice(0, 3).map((x) => [{ text: x.label.slice(0, 40), url: x.url }]);
  const r = await fetcher(`https://api.telegram.org/bot${c.token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: c.chat, text: `${a.titulo}\n${a.mensaje}`, disable_notification: (a.prioridad || 3) < 4,
      ...(keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`Telegram respondió ${r.status}: ${(await r.text()).slice(0, 120)}`);
}

async function webhook(c, a, fetcher) {
  const r = await fetcher(c.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ titulo: a.titulo, mensaje: a.mensaje, prioridad: a.prioridad, acciones: a.acciones || [] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`el webhook respondió ${r.status}`);
}
