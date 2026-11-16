// Pantalla fina: no guarda datos. Todo se lee del servidor y se actualiza en vivo.
const $ = (s, el = document) => el.querySelector(s);
const vista = $("#vista");
let S = null;          // último estado del servidor
let sesion = null;     // {cuenta, dentro, nombre, tz, onboarding}
let tick = null;

// ---------- utilidades ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else if (k === "style") el.style.cssText = v; // vía CSSOM: lo permite la política de seguridad
    else if (k === "checked" || k === "selected") el[k] = !!v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
const fmtDur = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000)), hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return hh ? `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${mm}:${String(ss).padStart(2, "0")}`;
};
const fmtCorto = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };
const hora = (ms) => new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: sesion?.tz }).format(ms);
const fecha = (ms) => new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long", timeZone: sesion?.tz }).format(ms);
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function toast(msg, error = false) {
  const t = $("#aviso");
  t.textContent = msg;
  t.className = "toast" + (error ? " error" : "");
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), error ? 5000 : 2200);
}

async function api(path, { method = "GET", body } = {}) {
  const r = await fetch(path, {
    method, credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== "/api/entrar") { sesion.dentro = false; render(); throw new Error(j.error || "Inicia sesión."); }
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  if (j.estado) { S = j.estado; }
  return j;
}
// Ejecuta una acción y re-dibuja. Los botones se deshabilitan mientras tanto.
async function act(btn, fn, okMsg) {
  if (btn) btn.disabled = true;
  try { const r = await fn(); if (okMsg) toast(okMsg); render(); return r; }
  catch (e) { toast(e.message, true); }
  finally { if (btn) btn.disabled = false; }
}

// ---------- en vivo ----------
let es = null, refrescando = null;
async function refrescar() {
  clearTimeout(refrescando);
  refrescando = setTimeout(async () => {
    try {
      S = await api("/api/estado");
      // En Ajustes hay formularios a medio llenar: se actualizan los datos sin redibujar.
      if (location.hash.startsWith("#agenda")) semana = null;
      if (location.hash.startsWith("#ajustes")) cuentasCfg = null; else render();
    } catch {}
  }, 120);
}
function conectarEnVivo() {
  if (es) es.close();
  es = new EventSource("/api/eventos");
  es.addEventListener("cambio", refrescar);
  es.onopen = () => { $("#conexion").classList.remove("caido"); refrescar(); };
  es.onerror = () => $("#conexion").classList.add("caido");
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && sesion?.dentro) refrescar(); });
setInterval(() => { if (sesion?.dentro && !document.hidden) refrescar(); }, 60_000);

// ---------- arranque ----------
async function inicio() {
  sesion = await (await fetch("/api/sesion")).json();
  if (sesion.dentro) {
    S = await api("/api/estado");
    conectarEnVivo();
    if (!sesion.onboarding?.listo && !location.hash) location.hash = "#ajustes";
  }
  render();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  // Atajos del ícono (Android/escritorio): /#accion=parar, etc.
  const m = location.hash.match(/accion=(\w+)/);
  if (m && sesion.dentro) {
    history.replaceState(null, "", "#hoy");
    if (m[1] === "parar") act(null, () => api("/api/parar", { method: "POST" }), "Parado.");
    if (m[1] === "armar") act(null, () => api("/api/armar", { method: "POST" }), "Día armado.");
    if (m[1] === "capturar") setTimeout(() => $("#captura")?.focus(), 200);
  }
}
window.addEventListener("hashchange", () => { document.querySelectorAll("dialog.dialogo").forEach((d) => d.remove()); render(); });

function render() {
  clearInterval(tick);
  if (!sesion.dentro) { $("#nav").hidden = true; vista.replaceChildren(sesion.cuenta ? vistaEntrar() : vistaInstalar()); return; }
  $("#nav").hidden = false;
  const [v0, sub] = location.hash.slice(1).split(/[?&]/)[0].split("/");
  const v = v0 || "hoy";
  const tab = { tareas: "gestiones", bandeja: "gestiones" }[v] || v;
  for (const a of document.querySelectorAll("#nav a")) a.classList.toggle("activa", a.dataset.v === tab);
  const foco = document.activeElement?.id, val = foco && document.activeElement.value;
  const vistas = { hoy: vistaHoy, agenda: vistaAgenda, gestiones: vistaGestiones, tareas: vistaTareas, bandeja: vistaGestiones, registro: vistaRegistro, ajustes: vistaAjustes };
  const sub_ = { "ajustes/avisos": vistaPlantillas, "ajustes/algoritmo": vistaAlgoritmo }[`${v}/${sub}`];
  vista.replaceChildren(...[].concat((sub_ || vistas[v] || vistaHoy)()).filter(Boolean));
  // Mantiene lo que estabas escribiendo si llega una actualización en vivo.
  if (foco) { const el = document.getElementById(foco); if (el) { if (val != null) el.value = val; el.focus(); } }
}

// ---------- cuenta ----------
function vistaInstalar() {
  const codigo = h("input", { id: "codigo", autocomplete: "off", placeholder: "Ej: 4F2A9C1B" });
  const pw = h("input", { id: "pw", type: "password", autocomplete: "new-password", minlength: 8 });
  return h("section", { class: "tarjeta entrada" },
    h("h1", {}, "Bienvenido"),
    h("p", { class: "suave" }, "Primera vez. El código de instalación aparece en los registros del contenedor (docker compose logs app)."),
    h("label", { for: "codigo" }, "Código de instalación"), codigo,
    h("label", { for: "pw" }, "Elige tu contraseña (8+ caracteres)"), pw,
    h("p"), h("button", { class: "primario grande", onclick: (e) => act(e.target, async () => {
      await api("/api/instalar", { method: "POST", body: { codigo: codigo.value, password: pw.value } });
      location.hash = "#ajustes"; await inicio();
    }) }, "Crear cuenta"));
}
function vistaEntrar() {
  const pw = h("input", { id: "pw", type: "password", autocomplete: "current-password" });
  const go = (e) => act(e?.target, async () => { await api("/api/entrar", { method: "POST", body: { password: pw.value } }); await inicio(); });
  pw.addEventListener("keydown", (e) => e.key === "Enter" && go());
  return h("section", { class: "tarjeta entrada" }, h("h1", {}, sesion.nombre), h("label", { for: "pw" }, "Contraseña"), pw, h("p"), h("button", { class: "primario grande", onclick: go }, "Entrar"));
}

// ---------- Hoy ----------
function msActual(c) { return c.segments.reduce((a, [x, y]) => a + ((y || Date.now()) - x), 0); }

function tarjetaAhora() {
  const c = S.current;
  if (c) {
    const reloj = h("div", { class: "reloj" }, fmtDur(msActual(c)));
    if (c.state === "running") tick = setInterval(() => (reloj.textContent = fmtDur(msActual(c))), 1000);
    return h("section", { class: "tarjeta ahora" },
      h("div", { class: "suave" }, c.state === "running" ? "Registrando" : "En pausa"),
      h("div", { class: "titulo" }, c.title), reloj,
      h("div", { class: "botones" },
        c.state === "running"
          ? h("button", { onclick: (e) => act(e.target, () => api("/api/pausar", { method: "POST" })) }, "Pausa")
          : h("button", { onclick: (e) => act(e.target, () => api("/api/seguir", { method: "POST" })) }, "Seguir"),
        h("button", { class: "primario", onclick: (e) => act(e.target, () => api("/api/parar", { method: "POST" }), "Registrado.") }, "Parar")));
  }
  const ult = S.hoy.tramos.filter((t) => t.end).map((t) => t.end).sort((a, b) => b - a)[0];
  return h("section", { class: "tarjeta ahora vacia" },
    h("div", { class: "titulo" }, "Nada corriendo"),
    h("div", { class: "reloj" }, ult ? `${fmtCorto(Date.now() - ult)} sin registrar` : "Sin registrar"));
}

function iniciarPor(datos, btn) { return act(btn, () => api("/api/iniciar", { method: "POST", body: datos })); }

function vistaHoy() {
  const now = Date.now();
  const input = h("input", { id: "que", list: "items-lista", placeholder: "¿Qué estás haciendo?", autocomplete: "off", enterkeyhint: "go" });
  const ir = (e) => { const t = input.value.trim(); if (!t) return input.focus(); input.value = ""; iniciarPor({ title: t }, e?.target); };
  input.addEventListener("keydown", (e) => e.key === "Enter" && ir());
  const datalist = h("datalist", { id: "items-lista" }, S.items.filter((i) => i.status !== "hecha").map((i) => h("option", { value: i.title })));

  const ahoraBloque = S.agenda.blocks.find((b) => b.start <= now && b.end > now);
  const chipsData = [];
  if (ahoraBloque) chipsData.push({ item_id: ahoraBloque.item_id, title: ahoraBloque.title, motivo: "agendado ahora" });
  for (const s of S.sugerencias) if (!chipsData.some((c) => c.title === s.title)) chipsData.push(s);
  const chips = h("div", { class: "chips" }, chipsData.map((s) =>
    h("button", { class: "chip", onclick: (e) => iniciarPor(s.item_id ? { item_id: s.item_id } : { title: s.title }, e.target) }, "▶ ", s.title, h("small", {}, s.motivo))));

  // Agenda de hoy: bloques + calendario, en orden.
  const ag = [
    ...S.agenda.blocks.map((b) => ({ ...b, tipo: "bloque" })),
    ...S.agenda.events.map((e) => ({ ...e, tipo: "evento" })),
  ].sort((a, b) => (a.all_day ? -1 : 0) - (b.all_day ? -1 : 0) || a.start - b.start);
  const agenda = ag.length ? h("ul", { class: "lista" }, ag.map((x) => filaAgenda(x, now))) : h("p", { class: "vacio" }, "Nada agendado. Toca «Armar mi día» y lo armo con lo que sueles hacer.");

  const capt = h("input", { id: "captura", placeholder: "Idea, pendiente, lo que sea…", enterkeyhint: "done" });
  const guardar = (e) => { const t = capt.value.trim(); if (!t) return; capt.value = ""; act(e?.target, () => api("/api/capturas", { method: "POST", body: { text: t } }), "A la bandeja."); };
  capt.addEventListener("keydown", (e) => e.key === "Enter" && guardar());

  return [
    tarjetaAhora(),
    h("section", { class: "tarjeta" },
      h("div", { class: "fila" }, h("div", { class: "crece" }, input), h("button", { class: "primario", onclick: ir }, "Iniciar")), datalist,
      chipsData.length ? chips : h("p", { class: "suave" }, "Cuando registres unos días, aquí te sugiero lo que sueles hacer a esta hora.")),
    h("section", { class: "tarjeta" },
      h("div", { class: "fila" }, h("h2", { class: "crece" }, "Agenda · ", fecha(now)),
        h("button", { onclick: armar }, "Armar mi día")),
      agenda, formBloque()),
    h("section", { class: "tarjeta" },
      h("h2", {}, `Medido hoy · ${fmtCorto(S.hoy.medido_ms + (S.current?.state === "running" ? 0 : 0))}`),
      resumenTramos(S.hoy.tramos)),
    h("section", { class: "tarjeta" }, h("h2", {}, "Captura rápida"), h("div", { class: "fila" }, h("div", { class: "crece" }, capt), h("button", { onclick: guardar }, "Guardar"))),
  ];
}

// Una fila de agenda: bloque tuyo o evento de tus calendarios. ▶ inicia, ✎ mueve o renombra, ✕ borra.
function filaAgenda(x, now, { conDia = false } = {}) {
  const editable = x.tipo === "bloque" || x.editable;
  const origen = x.tipo === "evento" ? x.calendario + (x.recurrente ? " · se repite" : "") + (x.pendiente ? " · enviando…" : "")
    : [x.origin === "auto" ? "armado solo" : "", x.calendario ? (x.sincronizado ? x.calendario : "enviando…") : ""].filter(Boolean).join(" · ");
  return h("li", { class: x.end <= now ? "pasado" : x.start <= now ? "ahora-mismo" : "" },
    h("span", { class: "hora" }, conDia ? h("b", {}, diaCorto(x.start) + " ") : null, x.all_day ? "todo el día" : `${hora(x.start)}–${hora(x.end)}`),
    h("span", { class: "que" }, x.color ? h("span", { class: "color", style: `background:${x.color}` }) : null, x.title, h("small", {}, origen)),
    x.end > now && !x.all_day ? h("button", { class: "icono", title: "Iniciar", "aria-label": "Iniciar " + x.title, onclick: (e) => iniciarPor(x.item_id ? { item_id: x.item_id } : { title: x.title }, e.target) }, "▶") : null,
    editable && !x.all_day ? h("button", { class: "icono", title: "Mover o renombrar", "aria-label": "Editar " + x.title, onclick: () => editarAgenda(x) }, "✎") : null,
    x.tipo === "bloque" ? h("button", { class: "icono", title: "Quitar", "aria-label": "Quitar bloque", onclick: (e) => act(e.target, () => api(`/api/bloques/${x.id}`, { method: "DELETE" })) }, "✕") : null,
  );
}
const diaCorto = (ms) => new Intl.DateTimeFormat("es-CL", { weekday: "short", day: "numeric", timeZone: sesion?.tz }).format(ms);
const hhmmDe = (ms) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: sesion?.tz }).format(ms);
const fechaDe = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: sesion?.tz }).format(ms);
// Fecha AAAA-MM-DD + HH:MM en la zona del servidor → milisegundos.
function enZona(fecha, hhmm) {
  const guess = Date.parse(`${fecha}T${hhmm}:00Z`);
  const off = Date.parse(new Date(guess).toLocaleString("en-US", { timeZone: sesion.tz }) + " UTC") - guess;
  return guess - off;
}

function editarAgenda(x) {
  const t = h("input", { id: "ed-t", value: x.title });
  const f = h("input", { id: "ed-f", type: "date", value: fechaDe(x.start) });
  const a = h("input", { id: "ed-a", type: "time", value: hhmmDe(x.start) });
  const b = h("input", { id: "ed-b", type: "time", value: hhmmDe(x.end) });
  const dlg = h("dialog", { class: "dialogo" },
    h("h3", {}, x.tipo === "bloque" ? "Mover bloque" : `Mover en ${x.calendario}`),
    h("label", { for: "ed-t" }, "Qué"), t, h("label", { for: "ed-f" }, "Día"), f,
    h("div", { class: "col2" }, h("div", {}, h("label", { for: "ed-a" }, "Desde"), a), h("div", {}, h("label", { for: "ed-b" }, "Hasta"), b)),
    h("p", { class: "suave" }, x.tipo === "bloque" ? "El cambio llega a tu calendario «Plan» en segundos." : "El cambio se escribe en el calendario de origen; invitados y alarmas se conservan."),
    h("div", { class: "fila" },
      h("button", { class: "primario", onclick: (e) => {
        const inicio = enZona(f.value, a.value);
        let fin = enZona(f.value, b.value);
        if (fin <= inicio) fin += 86_400_000;
        act(e.target, async () => {
          if (x.tipo === "bloque") await api(`/api/bloques/${x.id}`, { method: "PATCH", body: { title: t.value, inicio, fin } });
          else await api("/api/eventos", { method: "PATCH", body: { calendar_id: x.calendar_id, uid: x.uid, title: t.value, inicio, fin } });
          semana = null; dlg.close(); dlg.remove();
        }, "Guardado.");
      } }, "Guardar"),
      h("button", { onclick: () => { dlg.close(); dlg.remove(); } }, "Cancelar")));
  document.body.append(dlg);
  dlg.showModal();
}

// ---------- Agenda de la semana ----------
let semana = null, semanaDesde = null;
function vistaAgenda() {
  if (!semana) {
    api(`/api/agenda?dias=7${semanaDesde ? `&desde=${semanaDesde}` : ""}`).then((r) => { semana = r; render(); }).catch((e) => toast(e.message, true));
    return h("p", { class: "cargando" }, "Cargando…");
  }
  const now = Date.now();
  const todo = [...semana.blocks.map((b) => ({ ...b, tipo: "bloque" })), ...semana.events.map((e) => ({ ...e, tipo: "evento" }))].sort((a, b) => a.start - b.start);
  const porDia = new Map();
  for (const x of todo) { const k = fechaDe(Math.max(x.start, semanaDesde || 0)); if (!porDia.has(k)) porDia.set(k, []); porDia.get(k).push(x); }
  const mover = (d) => { const base = semanaDesde || enZona(fechaDe(now), "00:00"); semanaDesde = base + d * 7 * 86_400_000; semana = null; render(); };
  return [
    h("section", { class: "tarjeta" }, h("div", { class: "fila" },
      h("button", { class: "icono", "aria-label": "Semana anterior", onclick: () => mover(-1) }, "‹"),
      h("h2", { class: "crece", style: "text-align:center;margin:0" }, semanaDesde ? `Semana del ${fecha(semanaDesde)}` : "Próximos 7 días"),
      h("button", { class: "icono", "aria-label": "Semana siguiente", onclick: () => mover(1) }, "›")),
      h("div", { class: "fila", style: "margin-top:.5rem" },
        h("button", { onclick: (e) => act(e.target, async () => { await api("/api/sincronizar", { method: "POST" }); semana = null; }, "Sincronizado.") }, "Sincronizar ahora"),
        semanaDesde ? h("button", { onclick: () => { semanaDesde = null; semana = null; render(); } }, "Hoy") : null)),
    ...[...porDia].map(([dia, xs]) => h("section", { class: "tarjeta" },
      h("h2", {}, fecha(enZona(dia, "12:00"))),
      h("ul", { class: "lista" }, xs.map((x) => filaAgenda(x, now))))),
    porDia.size ? null : h("p", { class: "vacio" }, "Nada esta semana. Conecta tus calendarios en Ajustes."),
  ];
}

async function armar(e) {
  const btn = e.target;
  btn.disabled = true;
  try {
    const r = await api("/api/armar");
    if (!r.plan.length) { toast("No hay nada nuevo que agendar: registra unos días o crea rutinas con hora."); return; }
    const lista = r.plan.map((p) => `${hora(p.starts_at)} ${p.title}`).join("\n");
    if (confirm(`Agendo esto para hoy:\n\n${lista}`)) { await api("/api/armar", { method: "POST" }); toast("Día armado."); render(); }
  } catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
}

function formBloque() {
  const t = h("input", { id: "b-que", placeholder: "Qué", list: "items-lista" });
  const ini = h("input", { id: "b-ini", type: "time", value: proximaMediaHora() });
  const dur = h("select", { id: "b-dur" }, [15, 30, 45, 60, 90, 120, 180].map((m) => h("option", { value: m, selected: m === 60 }, fmtCorto(m * 60000))));
  return h("details", {}, h("summary", {}, "Agendar algo"),
    h("div", { class: "col2" }, h("div", {}, h("label", { for: "b-que" }, "Qué"), t), h("div", { class: "col2" }, h("div", {}, h("label", { for: "b-ini" }, "Hora"), ini), h("div", {}, h("label", { for: "b-dur" }, "Dura"), dur))),
    h("p"), h("button", { class: "primario", onclick: (e) => {
      if (!t.value.trim() || !ini.value) return toast("Completa qué y a qué hora.", true);
      const inicio = hoyA(ini.value), fin = inicio + Number(dur.value) * 60000;
      act(e.target, () => api("/api/bloques", { method: "POST", body: { title: t.value.trim(), inicio, fin } }), "Agendado.");
    } }, "Agendar"));
}
function proximaMediaHora() { const d = new Date(Date.now() + 30 * 60000); d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
// Hoy a las HH:MM en la zona del servidor (se asume la misma que la del teléfono; si difiere, se corrige con el desfase).
function hoyA(hhmm) {
  const [H, M] = hhmm.split(":").map(Number);
  const d = new Date(); d.setHours(H, M, 0, 0);
  const local = d.getTime();
  const enZona = new Date(new Date(local).toLocaleString("en-US", { timeZone: sesion.tz })).getTime();
  const enAqui = new Date(new Date(local).toLocaleString("en-US")).getTime();
  return local - (enZona - enAqui);
}

function resumenTramos(tramos) {
  if (!tramos.length) return h("p", { class: "vacio" }, "Todavía nada.");
  const por = new Map();
  for (const t of tramos) por.set(t.title, (por.get(t.title) || 0) + ((t.end || Date.now()) - t.start));
  const max = Math.max(...por.values());
  return h("ul", { class: "lista" }, [...por].sort((a, b) => b[1] - a[1]).map(([t, ms]) =>
    h("li", {}, h("span", { class: "que" }, t, h("div", { class: "barra-total", style: `width:${Math.max(4, (ms / max) * 100)}%` })), h("span", { class: "hora" }, fmtCorto(ms)))));
}

// ---------- Tareas y rutinas ----------
function vistaTareas() {
  const tareas = S.items.filter((i) => i.kind === "tarea" && i.fuente === "app");
  const rutinas = S.items.filter((i) => i.kind === "rutina");
  const fila = (i) => h("li", { class: i.status === "hecha" ? "hecha" : "" },
    h("button", { class: "icono", title: "Iniciar", "aria-label": "Iniciar " + i.title, onclick: (e) => iniciarPor({ item_id: i.id }, e.target) }, "▶"),
    h("span", { class: "que" }, i.title, h("small", {}, [
      i.kind === "rutina" && i.hora ? `${i.hora}${i.dias ? " · " + i.dias.map((d) => DIAS[d]).join(" ") : " · todos los días"}` : "",
      i.due_date ? `vence ${i.due_date}` : "", i.status === "en curso" ? "en curso" : "", `${i.est_min} min`,
    ].filter(Boolean).join(" · "))),
    i.kind === "tarea" ? h("button", { class: "icono", title: i.status === "hecha" ? "Reabrir" : "Hecha", "aria-label": "Marcar hecha", onclick: (e) => act(e.target, () => api(`/api/items/${i.id}`, { method: "PATCH", body: { status: i.status === "hecha" ? "pendiente" : "hecha" } })) }, i.status === "hecha" ? "↺" : "✓") : null,
    h("button", { class: "icono", title: "Archivar", "aria-label": "Archivar", onclick: (e) => act(e.target, () => api(`/api/items/${i.id}`, { method: "PATCH", body: { status: "archivada" } }), "Archivada.") }, "✕"));

  const tipo = h("select", { id: "n-tipo" }, h("option", { value: "tarea" }, "Tarea"), h("option", { value: "rutina" }, "Rutina (se repite)"));
  const titulo = h("input", { id: "n-titulo", placeholder: "Nombre" });
  const est = h("input", { id: "n-est", type: "number", min: 5, step: 5, value: 30 });
  const vence = h("input", { id: "n-vence", type: "date" });
  const horaR = h("input", { id: "n-hora", type: "time" });
  const dias = DIAS.map((d, i) => h("label", { class: "chip", style: "display:inline-flex;align-items:center;gap:.3em;margin:0" }, h("input", { type: "checkbox", value: i, style: "width:auto" }), d));
  const extraR = h("div", { hidden: true }, h("label", { for: "n-hora" }, "Hora habitual (opcional)"), horaR, h("label", {}, "Días (ninguno = todos)"), h("div", { class: "chips" }, dias));
  const extraT = h("div", {}, h("label", { for: "n-vence" }, "Fecha límite (opcional)"), vence);
  tipo.addEventListener("change", () => { extraR.hidden = tipo.value !== "rutina"; extraT.hidden = tipo.value === "rutina"; });
  const crear = (e) => {
    const body = { kind: tipo.value, title: titulo.value.trim(), est_min: Number(est.value) || 30 };
    if (!body.title) return toast("Ponle nombre.", true);
    if (body.kind === "tarea") body.due_date = vence.value || null;
    else { body.hora = horaR.value || null; body.dias = dias.map((l) => l.firstChild).filter((c) => c.checked).map((c) => Number(c.value)); }
    act(e.target, () => api("/api/items", { method: "POST", body }), "Creada.");
  };
  titulo.addEventListener("keydown", (e) => e.key === "Enter" && crear(e));

  return [
    h("section", { class: "tarjeta" }, h("h2", {}, "Nueva"),
      h("div", { class: "col2" }, h("div", {}, h("label", { for: "n-titulo" }, "Nombre"), titulo), h("div", { class: "col2" }, h("div", {}, h("label", { for: "n-tipo" }, "Tipo"), tipo), h("div", {}, h("label", { for: "n-est" }, "Minutos"), est))),
      extraT, extraR, h("p"), h("button", { class: "primario", onclick: crear }, "Crear")),
    h("section", { class: "tarjeta" }, h("h2", {}, "Tareas"), tareas.length ? h("ul", { class: "lista" }, tareas.map(fila)) : h("p", { class: "vacio" }, "Sin tareas.")),
    h("section", { class: "tarjeta" }, h("h2", {}, "Rutinas"), h("p", { class: "suave" }, "Lo que se repite. Si le pones hora, «Armar mi día» la agenda sola."),
      rutinas.length ? h("ul", { class: "lista" }, rutinas.map(fila)) : h("p", { class: "vacio" }, "Sin rutinas.")),
  ];
}

// ---------- Gestiones: casillas de tus notas + capturas ----------
function vistaGestiones() {
  const txt = h("textarea", { id: "nota", placeholder: "Una idea o un pendiente. La primera línea es el título." });
  const tipo = h("select", { id: "nota-tipo" }, h("option", { value: "captura" }, "Pendiente (casilla)"), h("option", { value: "nota" }, "Nota (sin casilla)"));
  const gest = S.items.filter((i) => i.kind === "tarea" && i.fuente !== "app" && !i.flujo && i.status !== "hecha");
  const flujo = S.items.filter((i) => i.flujo && !["hecha", "archivada"].includes(i.status));
  const ETAPAS = ["Bandeja", "Idea", "Por hacer", "Agendada", "En curso"];
  const bloques = new Map(S.agenda.blocks.map((b) => [b.id, b]));
  const filaFlujo = (i) => h("li", {},
    h("button", { class: "icono", title: "Hecha", "aria-label": "Marcar hecha " + i.title, onclick: (e) => act(e.target, () => api(`/api/items/${i.id}`, { method: "PATCH", body: { status: "hecha" } }), "Hecha.") }, "☐"),
    h("span", { class: "que" }, i.title, h("small", {}, [i.tipo_nota, `${i.est_min} min`, bloques.get(i.bloque_id) ? `hoy ${hora(bloques.get(i.bloque_id).start)}` : i.bloque_id ? "agendada" : i.due_date ? `para ${i.due_date}` : ""].filter(Boolean).join(" · "))),
    ["Bandeja", "Idea"].includes(i.etapa) ? h("button", { title: "Pasar a «Por hacer»: Armar mi día le busca hueco", onclick: (e) => act(e.target, () => api(`/api/items/${i.id}`, { method: "PATCH", body: { agendable: true } }), "Por hacer: entra en el próximo «Armar mi día».") }, "Por hacer") : null,
    h("button", { class: "icono", title: "Iniciar", "aria-label": "Iniciar " + i.title, onclick: (e) => iniciarPor({ item_id: i.id }, e.target) }, "▶"));
  const hechas = S.items.filter((i) => i.kind === "tarea" && i.fuente !== "app" && i.status === "hecha").slice(0, 20);
  const porNota = new Map();
  for (const g of gest) { const k = g.nota || "Sin nota"; if (!porNota.has(k)) porNota.set(k, []); porNota.get(k).push(g); }
  const abiertas = S.captures.filter((c) => c.status === "abierta");
  const destino = S.conexiones.cuentas.some((c) => c.tipo === "markdown" || c.tipo === "notion");
  const fila = (i) => h("li", { class: i.status === "hecha" ? "hecha" : "" },
    h("button", { class: "icono", title: i.status === "hecha" ? "Reabrir" : "Hecha", "aria-label": "Marcar " + i.title, onclick: (e) => act(e.target, () => api(`/api/items/${i.id}`, { method: "PATCH", body: { status: i.status === "hecha" ? "pendiente" : "hecha" } })) }, i.status === "hecha" ? "☑" : "☐"),
    h("span", { class: "que" }, i.title, h("small", {}, [i.due_date ? `vence ${i.due_date}` : "", i.status === "en curso" ? "en curso" : "", i.fuente === "notion" ? "Notion" : "Markdown"].filter(Boolean).join(" · "))),
    i.status !== "hecha" ? h("button", { class: "icono", title: "Iniciar", "aria-label": "Iniciar " + i.title, onclick: (e) => iniciarPor({ item_id: i.id }, e.target) }, "▶") : null);
  const filaCap = (c) => h("li", {},
    h("span", { class: "que" }, c.text, h("small", {}, [c.source, new Date(c.at).toLocaleDateString("es-CL")].join(" · ")), c.body ? h("small", {}, c.body.slice(0, 160)) : null),
    h("button", { class: "icono", title: "Convertir en tarea", onclick: (e) => act(e.target, () => api(`/api/capturas/${c.id}/tarea`, { method: "POST" }), "Ahora es tarea.") }, "→"),
    h("button", { class: "icono", title: "Procesada", onclick: (e) => act(e.target, () => api(`/api/capturas/${c.id}`, { method: "PATCH", body: { status: "procesada" } })) }, "✓"));
  return [
    h("p", { class: "suave", style: "text-align:right;margin:0 0 .5rem" }, h("a", { href: "#tareas" }, "Tareas y rutinas de la app ›")),
    h("section", { class: "tarjeta" }, h("label", { for: "nota" }, destino ? "A la bandeja de tus notas" : "A la bandeja"), txt, h("div", { class: "fila", style: "margin-top:.5rem" },
      h("div", { class: "crece" }, tipo),
      h("button", { class: "primario", onclick: (e) => { const t = txt.value.trim(); if (!t) return; act(e.target, async () => { await api("/api/capturas", { method: "POST", body: { text: t, kind: tipo.value } }); txt.value = ""; }, "Guardado."); } }, "Guardar")),
      destino ? null : h("p", { class: "suave" }, "Conecta tus notas (Ajustes → paso 3) y esto se escribe en tu Obsidian o Notion.")),
    flujo.length ? h("section", { class: "tarjeta" },
      h("div", { class: "fila" }, h("h2", { class: "crece" }, "Flujo en Notion"), h("button", { onclick: armar }, "Armar mi día")),
      h("p", { class: "suave" }, "De idea a tiempo en el calendario: «Por hacer» entra solo en tus huecos libres y lo que registras suma en la fila de Notion."),
      ...ETAPAS.map((et) => { const xs = flujo.filter((i) => (i.etapa || "Bandeja") === et); return xs.length ? h("div", {}, h("h3", { class: "etapa" }, `${et} · ${xs.length}`), h("ul", { class: "lista" }, xs.map(filaFlujo))) : null; })) : null,
    ...[...porNota].map(([nota, xs]) => h("section", { class: "tarjeta" }, h("h2", {}, `${nota} · ${xs.length}`), h("ul", { class: "lista" }, xs.map(fila)))),
    gest.length || !destino ? null : h("p", { class: "vacio" }, "Sin casillas abiertas en tus notas."),
    abiertas.length ? h("section", { class: "tarjeta" }, h("h2", {}, destino ? `Enviando a tus notas (${abiertas.length})` : `Bandeja (${abiertas.length})`), h("ul", { class: "lista" }, abiertas.map(filaCap))) : null,
    hechas.length ? h("section", { class: "tarjeta" }, h("details", {}, h("summary", {}, `Hechas recientes (${hechas.length})`), h("ul", { class: "lista" }, hechas.map(fila)))) : null,
  ];
}

// ---------- Registro ----------
let registro = null, registroDias = 7;
function vistaRegistro() {
  if (!registro) { api(`/api/registro?dias=${registroDias}`).then((r) => { registro = r; render(); }).catch((e) => toast(e.message, true)); return h("p", { class: "cargando" }, "Cargando…"); }
  const porDia = new Map();
  for (const s of registro) { const k = fecha(s.start); if (!porDia.has(k)) porDia.set(k, []); porDia.get(k).push(s); }
  const sel = h("select", { id: "dias", onchange: () => { registroDias = Number(sel.value); registro = null; render(); } }, [7, 14, 30].map((d) => h("option", { value: d, selected: d === registroDias }, `Últimos ${d} días`)));
  const total = registro.reduce((a, s) => a + s.ms, 0);

  const q = h("input", { id: "r-que", list: "items-lista", placeholder: "Qué hiciste" });
  const a = h("input", { id: "r-a", type: "time" }), b = h("input", { id: "r-b", type: "time" });
  return [
    h("section", { class: "tarjeta" }, h("div", { class: "fila" }, h("h2", { class: "crece" }, `Total ${fmtCorto(total)}`), h("div", {}, sel))),
    h("section", { class: "tarjeta" }, h("details", {}, h("summary", {}, "Se me olvidó iniciar: registrar algo de hoy"),
      h("datalist", { id: "items-lista" }, S.items.map((i) => h("option", { value: i.title }))),
      h("label", { for: "r-que" }, "Qué"), q, h("div", { class: "col2" }, h("div", {}, h("label", { for: "r-a" }, "Desde"), a), h("div", {}, h("label", { for: "r-b" }, "Hasta"), b)),
      h("p"), h("button", { class: "primario", onclick: (e) => {
        if (!q.value.trim() || !a.value || !b.value) return toast("Completa los tres campos.", true);
        act(e.target, async () => { await api("/api/registrar", { method: "POST", body: { title: q.value.trim(), inicio: hoyA(a.value), fin: hoyA(b.value) } }); registro = null; }, "Registrado.");
      } }, "Registrar"))),
    ...[...porDia].map(([dia, ses]) => h("section", { class: "tarjeta" },
      h("h2", {}, `${dia} · ${fmtCorto(ses.reduce((x, s) => x + s.ms, 0))}`),
      h("ul", { class: "lista" }, ses.map((s) => h("li", {},
        h("span", { class: "hora" }, `${hora(s.start)}–${s.end ? hora(s.end) : "…"}`),
        h("span", { class: "que" }, s.title, h("small", {}, `${fmtCorto(s.ms)} · ${s.source}`)),
        s.end ? h("button", { class: "icono", title: "Borrar", "aria-label": "Borrar registro", onclick: (e) => { if (confirm("¿Borrar este registro?")) act(e.target, async () => { await api(`/api/sesiones/${s.id}`, { method: "DELETE" }); registro = null; }); } }, "✕") : null))))),
  ];
}

// ---------- Ajustes y asistente ----------
let avisosCfg = null, tokenNuevo = null, feedUrl = null, cuentasCfg = null, conectando = null, conflictosLista = null;
function vistaAjustes() {
  if (!avisosCfg) { api("/api/avisos").then((r) => { avisosCfg = r; render(); }).catch((e) => toast(e.message, true)); return h("p", { class: "cargando" }, "Cargando…"); }
  const cx = S.conexiones;
  if (!cuentasCfg) { api("/api/cuentas").then((r) => { cuentasCfg = r; render(); }).catch((e) => toast(e.message, true)); return h("p", { class: "cargando" }, "Cargando…"); }
  const avisoUrl = new URLSearchParams(location.hash.split("?")[1] || "").get("aviso");
  if (avisoUrl) { setTimeout(() => toast(avisoUrl, /No se pudo|venció|dijo/.test(avisoUrl)), 50); history.replaceState(null, "", "#ajustes"); }
  const cuentas = cuentasCfg.cuentas;
  const listo = {
    avisos: cx.avisos.ntfy || cx.avisos.telegram || cx.avisos.webhook,
    cal: cuentas.some((c) => ["caldav", "google", "outlook"].includes(c.tipo) && c.activa) || cuentasCfg.ical.length > 0,
    notas: cuentas.some((c) => c.tipo === "markdown" || c.tipo === "notion"),
    atajos: !!tokenNuevo || avisosCfg.tokens > 0,
  };
  const paso = (n, ok, titulo, ...cuerpo) => h("section", { class: "tarjeta" }, h("div", { class: "paso" + (ok ? " listo" : "") }, h("span", { class: "num" }, ok ? "✓" : n), h("div", {}, h("h3", {}, titulo), ...cuerpo)));

  return [
    !sesion.onboarding?.listo ? h("section", { class: "tarjeta" }, h("h1", {}, "Configura en 4 pasos"),
      h("p", { class: "suave" }, "Todo queda en tu servidor: las claves se guardan cifradas y nada pasa por terceros. Puedes saltarte pasos y volver cuando quieras."),
      h("button", { class: "primario", onclick: (e) => act(e.target, async () => { await api("/api/onboarding", { method: "PUT", body: { listo: true } }); sesion.onboarding = { listo: true }; location.hash = "#hoy"; }) }, "Listo, ir a Hoy")) : null,
    paso(1, listo.avisos, "Avisos al celular", pasoAvisos()),
    paso(2, listo.cal, "Calendarios: Google, iCloud, Outlook", pasoCalendarios()),
    paso(3, listo.notas, "Notas: Obsidian o Notion", pasoNotas()),
    paso(4, listo.atajos, "Atajos: Siri, Android y reloj", pasoAtajos()),
    tarjetaSync(),
    h("section", { class: "tarjeta" }, h("h3", {}, "Personalizar"),
      h("ul", { class: "lista" },
        h("li", {}, h("a", { class: "que", href: "#ajustes/avisos" }, "Avisos: textos, sonido y botones", h("small", {}, "Qué dice cada aviso y qué botones trae")), h("span", {}, "›")),
        h("li", {}, h("a", { class: "que", href: "#ajustes/algoritmo" }, "Qué aprende el algoritmo", h("small", {}, "Qué puede agendar solo, qué solo sugerir y qué ignorar")), h("span", {}, "›")))),
    h("section", { class: "tarjeta" }, h("h3", {}, "Tu agenda en otros calendarios"),
      h("p", { class: "suave" }, "Suscríbete a este enlace desde Google Calendar, Apple o Outlook para ver tus bloques y lo medido."),
      feedUrl ? h("code", { class: "codigo" }, feedUrl) : h("button", { onclick: (e) => act(e.target, async () => { feedUrl = (await api("/api/feed")).url; }) }, "Mostrar enlace")),
    h("section", { class: "tarjeta" }, h("h3", {}, "Apariencia"),
      h("p", { class: "suave" }, "Los colores, letras y logo vienen de una plantilla. Para personalizarla sin tocar el código, pon tu tema.css (y si quieres, letras e íconos) en la carpeta datos/tema de tu servidor."),
      h("button", { onclick: (e) => act(e.target, async () => { await api("/api/salir", { method: "POST" }); sesion.dentro = false; }) }, "Cerrar sesión")),
  ];
}

function pasoAvisos() {
  const a = avisosCfg, c = a.canales;
  const topic = h("input", { id: "ntfy-topic", value: c.ntfy?.topic || a.sugerido_ntfy });
  const server = h("input", { id: "ntfy-server", value: c.ntfy?.server || "https://ntfy.sh" });
  const tgTok = h("input", { id: "tg-token", value: c.telegram?.token || "", placeholder: "123456:ABC…", autocomplete: "off" });
  const tgChat = h("input", { id: "tg-chat", value: c.telegram?.chat || "", placeholder: "se detecta solo" });
  const wh = h("input", { id: "wh", value: c.webhook?.url || "", placeholder: "https://…" });
  const desde = h("input", { id: "v-desde", type: "time", value: a.desde }), hasta = h("input", { id: "v-hasta", type: "time", value: a.hasta });
  const activo = h("input", { id: "v-activo", type: "checkbox", style: "width:auto", checked: a.activo });
  const solo = h("input", { id: "v-solo", type: "checkbox", style: "width:auto", checked: a.armar_solo !== false });
  const guardar = (e, probar) => act(e.target, async () => {
    await api("/api/avisos", { method: "PUT", body: {
      activo: activo.checked, armar_solo: solo.checked, desde: desde.value, hasta: hasta.value,
      canales: { ntfy: { topic: topic.value.trim(), server: server.value.trim() }, telegram: { token: tgTok.value.trim(), chat: tgChat.value.trim() }, webhook: { url: wh.value.trim() } },
    } });
    avisosCfg = null;
    if (probar) { const r = await api("/api/avisos/probar", { method: "POST" }); toast(r.resultado.map((x) => `${x.canal}: ${x.ok ? "ok" : x.error}`).join(" · "), r.resultado.some((x) => !x.ok)); }
  }, probar ? null : "Guardado.");
  return [
    h("p", { class: "suave" }, "Si no estás registrando nada, te reclamo: a los 10, 30 y 60 minutos, y después cada 10. Si tienes algo agendado, te aviso con el botón para iniciarlo."),
    h("details", { open: !c.ntfy && !c.telegram }, h("summary", {}, "ntfy (recomendado, gratis)"),
      h("ol", { class: "pasos" }, h("li", {}, "Instala la app ntfy (App Store / Google Play)."), h("li", {}, "Toca + y suscríbete a este tema (es como una clave, no lo compartas):")),
      h("label", { for: "ntfy-topic" }, "Tema"), topic, h("label", { for: "ntfy-server" }, "Servidor"), server),
    h("details", { open: !!c.telegram }, h("summary", {}, "Telegram"),
      h("ol", { class: "pasos" }, h("li", {}, "Habla con @BotFather, escribe /newbot y copia el token."), h("li", {}, "Mándale cualquier mensaje a tu bot nuevo."), h("li", {}, "Pega el token y toca «Detectar chat».")),
      h("label", { for: "tg-token" }, "Token del bot"), tgTok, h("label", { for: "tg-chat" }, "Chat"),
      h("div", { class: "fila" }, h("div", { class: "crece" }, tgChat), h("button", { onclick: (e) => act(e.target, async () => { const r = await api("/api/avisos/telegram/chat", { method: "POST", body: { token: tgTok.value.trim() } }); tgChat.value = r.chat; }, "Chat encontrado.") }, "Detectar chat"))),
    h("details", { open: !!c.webhook }, h("summary", {}, "Webhook (Home Assistant, n8n, Zapier…)"), h("label", { for: "wh" }, "URL"), wh),
    h("details", {}, h("summary", {}, "Horario y comportamiento"),
      h("div", { class: "col2" }, h("div", {}, h("label", { for: "v-desde" }, "Desde"), desde), h("div", {}, h("label", { for: "v-hasta" }, "Hasta"), hasta)),
      h("label", {}, activo, " Reclamar cuando no registro nada"), h("label", {}, solo, " Armar mi día solo cada mañana y mandarme el resumen")),
    h("div", { class: "fila" }, h("button", { class: "primario", onclick: (e) => guardar(e, true) }, "Guardar y probar"), h("button", { onclick: (e) => guardar(e, false) }, "Solo guardar")),
    a.vigilante?.motivo ? h("p", { class: "suave" }, `Vigilante: ${a.vigilante.motivo}.`) : null,
  ];
}

const ROLES = { leer: "Mostrar", plan: "Plan (tus bloques)", registrado: "Registrado (lo medido)", oculto: "Ocultar" };
const TIPOS = { caldav: "CalDAV", google: "Google", outlook: "Outlook", markdown: "Markdown", notion: "Notion" };
const recargarCuentas = async () => { cuentasCfg = await api("/api/cuentas"); };

function estadoCuenta(c) {
  if (!c.activa) return "esperando permiso";
  if (c.ultimo_error) return `✗ ${c.ultimo_error}`;
  return c.ultimo_ok ? `al día · ${hora(new Date(c.ultimo_ok).getTime())}` : "sincronizando…";
}

function pasoCalendarios() {
  const cals = cuentasCfg.cuentas.filter((c) => ["caldav", "google", "outlook"].includes(c.tipo));
  const tienePlan = cals.some((c) => c.calendarios.some((k) => k.rol === "plan"));
  const cuenta = (c) => h("div", { class: "cuenta" },
    h("div", { class: "fila" }, h("b", { class: "crece" }, c.nombre, " ", h("span", { class: "etiqueta" }, TIPOS[c.tipo])),
      h("button", { class: "icono peligro", title: "Desconectar", "aria-label": "Desconectar " + c.nombre, onclick: (e) => { if (confirm(`¿Desconectar ${c.nombre}? No borra nada en la cuenta.`)) act(e.target, async () => { await api(`/api/cuentas/${c.id}`, { method: "DELETE" }); await recargarCuentas(); }); } }, "✕")),
    h("p", { class: "suave" }, estadoCuenta(c)),
    c.activa ? h("ul", { class: "lista" }, c.calendarios.map((k) => h("li", {},
      k.color ? h("span", { class: "color", style: `background:${k.color}` }) : null,
      h("span", { class: "que" }, k.name, h("small", {}, k.editable ? "" : "solo lectura")),
      h("select", { style: "width:auto", "aria-label": "Uso de " + k.name, onchange: (e) => act(e.target, async () => { await api(`/api/calendarios/${k.id}`, { method: "PATCH", body: { rol: e.target.value } }); await recargarCuentas(); }, "Listo.") },
        Object.entries(ROLES).filter(([r]) => k.editable || r === "leer" || r === "oculto").map(([r, l]) => h("option", { value: r, selected: k.rol === r }, l)))))) : null,
    c.activa ? h("div", { class: "fila", style: "flex-wrap:wrap;margin-top:.4rem" },
      h("button", { onclick: (e) => act(e.target, async () => { await api(`/api/cuentas/${c.id}/crear-calendario`, { method: "POST", body: { rol: "plan" } }); await recargarCuentas(); }, "Creado «Veredicto · Plan».") }, "Crear «Veredicto · Plan»"),
      h("button", { onclick: (e) => act(e.target, async () => { await api(`/api/cuentas/${c.id}/crear-calendario`, { method: "POST", body: { rol: "registrado" } }); await recargarCuentas(); }, "Creado «Veredicto · Registrado».") }, "Crear «Registrado»")) : null);

  const form = {
    icloud: () => {
      const u = h("input", { id: "ic-u", type: "email", placeholder: "tu@icloud.com", autocomplete: "off" });
      const k = h("input", { id: "ic-k", placeholder: "xxxx-xxxx-xxxx-xxxx", autocomplete: "off" });
      return [
        h("ol", { class: "pasos" },
          h("li", {}, "Entra a ", h("a", { href: "https://account.apple.com", target: "_blank", rel: "noopener" }, "account.apple.com"), " → Inicio de sesión y seguridad → Contraseñas de apps → crea una llamada «Veredicto»."),
          h("li", {}, "Pega tu correo de Apple y esa contraseña de app (no la de tu Apple ID). Requiere verificación en dos pasos.")),
        h("label", { for: "ic-u" }, "Correo de Apple"), u, h("label", { for: "ic-k" }, "Contraseña de app"), k, h("p"),
        h("button", { class: "primario", onclick: (e) => act(e.target, async () => { await api("/api/cuentas/caldav", { method: "POST", body: { nombre: "iCloud", usuario: u.value, clave: k.value } }); conectando = null; await recargarCuentas(); }, "iCloud conectado.") }, "Conectar iCloud"),
      ];
    },
    caldav: () => {
      const url = h("input", { id: "cd-url", placeholder: "https://servidor/dav/", autocomplete: "off" });
      const u = h("input", { id: "cd-u", autocomplete: "off" }), k = h("input", { id: "cd-k", type: "password", autocomplete: "off" });
      return [
        h("p", { class: "suave" }, "Fastmail: https://caldav.fastmail.com/ · Nextcloud: https://tu-nube/remote.php/dav/ · Synology: https://tu-nas:5001/caldav/"),
        h("label", { for: "cd-url" }, "Dirección CalDAV"), url, h("label", { for: "cd-u" }, "Usuario"), u, h("label", { for: "cd-k" }, "Contraseña de app"), k, h("p"),
        h("button", { class: "primario", onclick: (e) => act(e.target, async () => { await api("/api/cuentas/caldav", { method: "POST", body: { nombre: "CalDAV", url: url.value, usuario: u.value, clave: k.value } }); conectando = null; await recargarCuentas(); }, "Conectado.") }, "Conectar"),
      ];
    },
    google: () => oauthForm("google", [
      h("li", {}, "Entra a ", h("a", { href: "https://console.cloud.google.com/projectcreate", target: "_blank", rel: "noopener" }, "Google Cloud"), " y crea un proyecto «Veredicto»."),
      h("li", {}, "APIs y servicios → Biblioteca → activa «Google Calendar API»."),
      h("li", {}, "Pantalla de consentimiento: tipo Externo, agrega tu correo como usuario de prueba y luego toca «Publicar app» (si queda en Prueba, el permiso vence cada 7 días)."),
      h("li", {}, "Credenciales → Crear → ID de cliente OAuth → Aplicación web. En «URI de redireccionamiento autorizados» pega:", h("code", { class: "codigo" }, cuentasCfg.redirect.google || "define URL_PUBLICA en .env")),
      h("li", {}, "Copia el ID y el secreto aquí. Google te mostrará «app no verificada»: es tu propia app, toca Avanzado → Ir a Veredicto.")]),
    outlook: () => oauthForm("outlook", [
      h("li", {}, "Entra a ", h("a", { href: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade", target: "_blank", rel: "noopener" }, "Microsoft Entra → Registros de aplicaciones"), " → Nuevo registro «Veredicto»."),
      h("li", {}, "Tipos de cuenta: «Cuentas en cualquier directorio y cuentas personales de Microsoft»."),
      h("li", {}, "URI de redirección (Web):", h("code", { class: "codigo" }, cuentasCfg.redirect.outlook || "define URL_PUBLICA en .env")),
      h("li", {}, "Certificados y secretos → Nuevo secreto de cliente. Copia el «Valor» (no el ID del secreto) y el «Id. de aplicación (cliente)».")]),
    ical: () => {
      const n = h("input", { id: "cal-nombre", placeholder: "Feriados, equipo…" });
      const url = h("input", { id: "cal-url", placeholder: "https://…/basic.ics", autocomplete: "off" });
      return [
        h("p", { class: "suave" }, "Para calendarios ajenos que solo quieres ver (feriados, el de tu equipo). Se relee cada 10 minutos."),
        h("label", { for: "cal-nombre" }, "Nombre"), n, h("label", { for: "cal-url" }, "Enlace iCal"), url, h("p"),
        h("button", { class: "primario", onclick: (e) => act(e.target, async () => { await api("/api/calendarios", { method: "POST", body: { name: n.value || "Calendario", url: url.value } }); conectando = null; await recargarCuentas(); }, "Agregado.") }, "Agregar"),
      ];
    },
  };
  const opciones = { icloud: "iCloud", google: "Google", outlook: "Outlook", caldav: "Otro CalDAV", ical: "Enlace iCal (solo ver)" };
  return [
    h("p", { class: "suave" }, "Se sincronizan en ambos sentidos cada 2 minutos: lo que mueves aquí aparece en tu teléfono y al revés. Elige un calendario como «Plan»: ahí van los bloques que armas en la app."),
    ...cals.map(cuenta),
    cuentasCfg.ical.length ? h("div", { class: "cuenta" }, h("b", {}, "Enlaces iCal (solo ver)"), h("ul", { class: "lista" }, cuentasCfg.ical.map((k) => h("li", {},
      h("span", { class: "que" }, k.name, h("small", {}, k.last_error ? `✗ ${k.last_error}` : k.last_ok_at ? "al día" : "pendiente")),
      h("button", { class: "icono", title: "Quitar", onclick: (e) => act(e.target, async () => { await api(`/api/calendarios/${k.id}`, { method: "DELETE" }); await recargarCuentas(); }) }, "✕"))))) : null,
    cals.length && !tienePlan ? h("p", { class: "aviso-suave" }, "Falta elegir el calendario «Plan»: crea «Veredicto · Plan» en la cuenta que más miras en el teléfono.") : null,
    h("div", { class: "chips" }, Object.entries(opciones).map(([k, l]) => h("button", { class: "chip" + (conectando === k ? " activa" : ""), onclick: () => { conectando = conectando === k ? null : k; render(); } }, "+ ", l))),
    form[conectando] ? h("div", { class: "cuenta" }, ...form[conectando]()) : null,
  ];
}

function oauthForm(tipo, pasos) {
  const id = h("input", { id: `${tipo}-id`, autocomplete: "off" }), sec = h("input", { id: `${tipo}-sec`, type: "password", autocomplete: "off" });
  return [
    h("ol", { class: "pasos" }, pasos),
    h("label", { for: id.id }, "ID de cliente"), id, h("label", { for: sec.id }, "Secreto de cliente"), sec, h("p"),
    h("button", { class: "primario", onclick: (e) => act(e.target, async () => {
      const r = await api(`/api/cuentas/${tipo}/oauth`, { method: "POST", body: { client_id: id.value, client_secret: sec.value } });
      location.href = r.url;
    }) }, `Dar permiso en ${tipo === "google" ? "Google" : "Microsoft"}`),
  ];
}

function pasoNotas() {
  const notas = cuentasCfg.cuentas.filter((c) => c.tipo === "markdown" || c.tipo === "notion");
  const carpeta = h("input", { id: "md-dir", value: cuentasCfg.carpeta_notas });
  const tok = h("input", { id: "n-token", placeholder: "ntn_…", autocomplete: "off" });
  const pag = h("input", { id: "n-pag", placeholder: "https://www.notion.so/Mi-pagina-…" });
  return [
    h("p", { class: "suave" }, "Cada casilla «- [ ]» de tus notas aparece en Gestiones. Márcala aquí o allá y queda marcada en ambos. Las capturas de Siri y Android se agregan a una nota «Bandeja» del día."),
    ...notas.map((c) => h("div", { class: "cuenta" },
      h("div", { class: "fila" }, h("b", { class: "crece" }, c.nombre, " ", h("span", { class: "etiqueta" }, TIPOS[c.tipo])),
        h("button", { class: "icono peligro", title: "Desconectar", onclick: (e) => { if (confirm(`¿Desconectar ${c.nombre}? Tus notas no se tocan.`)) act(e.target, async () => { await api(`/api/cuentas/${c.id}`, { method: "DELETE" }); await recargarCuentas(); }); } }, "✕")),
      h("p", { class: "suave" }, `${estadoCuenta(c)} · ${c.notas.n} notas con casillas · ${c.notas.abiertas || 0} abiertas`),
      h("label", {}, h("input", { type: "radio", name: "bandeja", style: "width:auto", checked: cuentasCfg.bandeja === c.id, onchange: (e) => act(e.target, async () => { await api("/api/bandeja-destino", { method: "PUT", body: { cuenta_id: c.id } }); await recargarCuentas(); }, "Las capturas irán aquí.") }), " Las capturas van aquí"))),
    h("div", { class: "chips" },
      h("button", { class: "chip" + (conectando === "md" ? " activa" : ""), onclick: () => { conectando = conectando === "md" ? null : "md"; render(); } }, "+ Carpeta Markdown (Obsidian)"),
      h("button", { class: "chip" + (conectando === "notion" ? " activa" : ""), onclick: () => { conectando = conectando === "notion" ? null : "notion"; render(); } }, "+ Notion")),
    conectando === "md" ? h("div", { class: "cuenta" },
      h("p", { class: "suave" }, "La carpeta tiene que estar montada en el contenedor. Por defecto es la carpeta «notas» dentro de tus datos; para usar tu bóveda de Obsidian, móntala en compose.yaml (ver README)."),
      h("label", { for: "md-dir" }, "Carpeta dentro del contenedor"), carpeta, h("p"),
      h("button", { class: "primario", onclick: (e) => act(e.target, async () => { await api("/api/cuentas/markdown", { method: "POST", body: { carpeta: carpeta.value } }); conectando = null; await recargarCuentas(); }, "Notas conectadas.") }, "Conectar carpeta")) : null,
    conectando === "notion" ? h("div", { class: "cuenta" },
      h("ol", { class: "pasos" },
        h("li", {}, "Entra a ", h("a", { href: "https://www.notion.so/profile/integrations", target: "_blank", rel: "noopener" }, "notion.so/profile/integrations"), " → Nueva integración (interna) → copia el token."),
        h("li", {}, "Elige la página que contiene tus notas: ••• → Conexiones → agrega tu integración. Todo lo que cuelga de ella queda visible."),
        h("li", {}, "Pega aquí el token y el enlace de esa página.")),
      h("label", { for: "n-token" }, "Token"), tok, h("label", { for: "n-pag" }, "Enlace de la página"), pag, h("p"),
      h("button", { class: "primario", onclick: (e) => act(e.target, async () => { await api("/api/cuentas/notion", { method: "POST", body: { token: tok.value.trim(), pagina: pag.value.trim() } }); conectando = null; await recargarCuentas(); }, "Notion conectado.") }, "Conectar Notion")) : null,
  ];
}

function tarjetaSync() {
  const cx = S.conexiones;
  if (!cx.cuentas.length) return null;
  return h("section", { class: "tarjeta" }, h("h3", {}, "Sincronización"),
    h("p", { class: "suave" }, cx.cola.pendientes ? `${cx.cola.pendientes} cambios por enviar${cx.cola.error ? ` · último error: ${cx.cola.error}` : ""}` : "Todo enviado."),
    h("div", { class: "fila", style: "flex-wrap:wrap" },
      h("button", { onclick: (e) => act(e.target, async () => { await api("/api/sincronizar", { method: "POST" }); await recargarCuentas(); }, "Sincronizado.") }, "Sincronizar ahora"),
      cx.conflictos ? h("button", { onclick: (e) => act(e.target, async () => { conflictosLista = await api("/api/conflictos"); }) }, `Revisar ${cx.conflictos} conflictos`) : null),
    conflictosLista ? h("ul", { class: "lista" }, conflictosLista.filter((c) => !c.revisado).map((c) => h("li", {},
      h("span", { class: "que" }, c.titulo, h("small", {}, `${new Date(c.creado).toLocaleString("es-CL")} · ganó ${c.ganador === "remoto" ? "el cambio de afuera" : "tu cambio"}${c.perdedor.borrado_afuera ? " (lo borraron afuera)" : ` · se perdió: «${c.perdedor.title}» ${hora(c.perdedor.start)}`}`)),
      c.perdedor.borrado_afuera ? null : h("button", { title: "Volver a la versión perdida", onclick: (e) => act(e.target, async () => { await api(`/api/conflictos/${c.id}/deshacer`, { method: "POST" }); conflictosLista = await api("/api/conflictos"); }, "Restaurado.") }, "Deshacer"),
      h("button", { class: "icono", title: "Entendido", onclick: (e) => act(e.target, async () => { await api(`/api/conflictos/${c.id}/revisado`, { method: "POST" }); conflictosLista = await api("/api/conflictos"); }) }, "✓")))) : null);
}

function pasoAtajos() {
  const base = tokenNuevo?.base || location.origin;
  const t = tokenNuevo?.token;
  const url = (p) => `${base}/api/atajo/${p}`;
  return [
    h("p", { class: "suave" }, "Un token por dispositivo. Los atajos hablan directo con tu servidor: lo que hagas desde Siri, Android o el reloj aparece al instante aquí."),
    t ? h("div", {},
      h("p", {}, h("b", {}, "Copia este token ahora (no se vuelve a mostrar):")), h("code", { class: "codigo" }, t),
      h("details", { open: true }, h("summary", {}, "iPhone · Siri (app Atajos)"),
        h("ol", { class: "pasos" },
          h("li", {}, "Atajos → + → acción «Obtener contenido de URL»."),
          h("li", {}, "URL: ", h("code", {}, url("alternar")), ". Método POST. Encabezado ", h("code", {}, "Authorization"), " = ", h("code", {}, `Bearer ${t.slice(0, 8)}…`)),
          h("li", {}, "Agrega «Mostrar resultado». Nómbralo «Veredicto» y di: «Oye Siri, Veredicto»."),
          h("li", {}, "Para elegir qué iniciar: «Obtener contenido de URL» a ", h("code", {}, url("opciones")), " → «Dividir texto» por saltos de línea → «Elegir de la lista» → «Obtener contenido de URL» POST a ", h("code", {}, url("iniciar")), " con cuerpo Texto = elemento elegido."),
          h("li", {}, "Capturar por voz: «Dictar texto» → POST a ", h("code", {}, url("capturar")), " con el texto dictado."))),
      h("details", {}, h("summary", {}, "Android"),
        h("ol", { class: "pasos" },
          h("li", {}, "Instala esta app: en Chrome, menú ⋮ → «Instalar app». Mantén presionado el ícono: Parar, Capturar, Armar mi día."),
          h("li", {}, "Compartir cualquier texto o enlace → «", sesion.nombre, "» lo guarda en la bandeja."),
          h("li", {}, "Para botones en la pantalla de inicio: app «HTTP Shortcuts» → nuevo atajo POST a ", h("code", {}, url("alternar")), " con encabezado Authorization: Bearer y tu token. Muestra la respuesta como aviso."))),
      h("details", {}, h("summary", {}, "Reloj (Garmin, Wear OS, Apple Watch)"),
        h("p", {}, "Usa ", h("code", {}, url("alternar")), ": un solo toque para o inicia lo agendado/lo habitual. En Apple Watch el atajo de Siri funciona igual. En Garmin, con un widget de peticiones HTTP (ej. «API Request»), configura un POST a esa URL con ", h("code", {}, `?k=${t.slice(0, 8)}…`), " al final.")),
      h("details", {}, h("summary", {}, "Todas las direcciones"),
        h("ul", {}, ["estado", "opciones", "agenda", "iniciar?que=…", "alternar", "pausar", "seguir", "parar", "capturar?texto=…", "armar"].map((p) => h("li", {}, h("code", {}, url(p))))),
        h("p", { class: "suave" }, "Responden texto simple. Auth: encabezado «Authorization: Bearer TOKEN» o ?k=TOKEN.")))
      : h("div", { class: "fila" },
        h("input", { id: "tok-label", placeholder: "iPhone, Android, Reloj…", class: "crece" }),
        h("button", { class: "primario", onclick: (e) => act(e.target, async () => { tokenNuevo = await api("/api/tokens", { method: "POST", body: { label: $("#tok-label").value || "Atajo" } }); avisosCfg.tokens = 1; }) }, "Crear token")),
  ];
}

// ---------- Avisos: plantillas ----------
let PL = null;
const PRIORIDADES = { 1: "1 · mínima (sin sonido)", 2: "2 · baja", 3: "3 · normal", 4: "4 · alta", 5: "5 · urgente (insiste)" };
function vistaPlantillas() {
  if (!PL) { api("/api/plantillas").then((r) => { PL = r; render(); }).catch((e) => toast(e.message, true)); return h("p", { class: "cargando" }, "Cargando…"); }
  const E = PL.efectivas, tuyas = PL.tuyas.eventos || {};
  const prefijo = h("input", { id: "pl-prefijo", value: E.global.prefijo || "", placeholder: "Ej: EQUIPO · " });
  const icono = h("input", { id: "pl-icono", type: "checkbox", style: "width:auto", checked: E.global.icono !== false });
  const guardarGlobal = (e) => act(e.target, async () => { const r = await api("/api/plantillas", { method: "PUT", body: { global: { prefijo: prefijo.value, icono: icono.checked } } }); PL.efectivas = r.efectivas; PL = null; }, "Guardado.");
  const evento = (key) => {
    const t = E.eventos[key], f = PL.equipo.eventos[key], propio = !!tuyas[key];
    const id = (x) => `pl-${key}-${x}`;
    const activo = h("input", { id: id("activo"), type: "checkbox", style: "width:auto", checked: t.activo !== false });
    const titulo = h("input", { id: id("titulo"), value: t.titulo });
    const mensaje = h("textarea", { id: id("mensaje"), style: "min-height:3.5em" }); mensaje.value = t.mensaje;
    const prio = h("select", { id: id("prio") }, Object.entries(PRIORIDADES).map(([n, l]) => h("option", { value: n, selected: Number(n) === t.prioridad }, l)));
    const tags = h("input", { id: id("tags"), value: t.tags || "", placeholder: "stopwatch, fire…" });
    const acc = [0, 1, 2].map((i) => h("select", { id: id("acc" + i) }, h("option", { value: "" }, "—"), Object.entries(PL.acciones).map(([k, l]) => h("option", { value: k, selected: t.acciones?.[i] === k }, l))));
    const extra = key === "previo" ? h("input", { id: id("min"), type: "number", min: 1, max: 120, value: t.minutos })
      : key === "excedido" ? h("input", { id: id("fac"), type: "number", min: 1, max: 5, step: 0.1, value: t.factor }) : null;
    const leer = () => ({
      activo: activo.checked, titulo: titulo.value, mensaje: mensaje.value, prioridad: Number(prio.value), tags: tags.value,
      acciones: acc.map((x) => x.value).filter(Boolean), ...(key === "previo" ? { minutos: Number(extra.value) } : {}), ...(key === "excedido" ? { factor: Number(extra.value) } : {}),
    });
    return h("details", { class: "tarjeta", style: "padding:.6rem 1rem" },
      h("summary", { style: "color:var(--texto);font-weight:700" }, t.activo === false ? "○ " : "● ", t.nombre, propio ? h("span", { class: "etiqueta", style: "margin-left:.5em" }, "editado") : null),
      h("p", { class: "suave" }, t.ayuda),
      h("label", {}, activo, " Activo"),
      extra ? h("div", {}, h("label", { for: extra.id }, key === "previo" ? "Minutos antes" : "Avisar al pasar de lo estimado ×"), extra) : null,
      h("label", { for: titulo.id }, "Título"), titulo,
      h("label", { for: mensaje.id }, "Mensaje"), mensaje,
      h("div", { class: "col2" }, h("div", {}, h("label", { for: prio.id }, "Prioridad (sonido)"), prio), h("div", {}, h("label", { for: tags.id }, "Etiquetas ntfy (emoji)"), tags)),
      h("label", {}, "Botones (hasta 3, en orden)"), h("div", { style: "display:grid;gap:.4rem" }, acc),
      h("p", { class: "suave" }, "Del equipo: «", f.titulo, "»"),
      h("div", { class: "fila", style: "flex-wrap:wrap" },
        h("button", { class: "primario", onclick: (e) => act(e.target, async () => { const r = await api("/api/plantillas", { method: "PUT", body: { eventos: { [key]: leer() } } }); PL = { ...PL, efectivas: r.efectivas, tuyas: { ...PL.tuyas, eventos: { ...tuyas, [key]: leer() } } }; }, "Guardado.") }, "Guardar"),
        h("button", { onclick: (e) => act(e.target, async () => { const r = await api("/api/plantillas/probar", { method: "POST", body: { evento: key, borrador: leer() } }); toast(`Enviado: ${r.aviso.titulo}`); }) }, "Probar"),
        propio ? h("button", { onclick: (e) => act(e.target, async () => { await api(`/api/plantillas/${key}`, { method: "DELETE" }); PL = null; }, "Restaurado.") }, "Volver a la del equipo") : null));
  };
  return [
    h("p", {}, h("a", { href: "#ajustes" }, "‹ Ajustes")),
    h("section", { class: "tarjeta" }, h("h1", {}, "Avisos"),
      h("p", { class: "suave" }, PL.hay_equipo ? "Partes de la plantilla de tu equipo (tema/avisos.json). Lo que edites aquí manda sobre ella." : "Partes de las plantillas de fábrica. Tu equipo puede poner las suyas en tema/avisos.json."),
      h("details", {}, h("summary", {}, "Variables que puedes usar"), h("ul", {}, Object.entries(PL.variables).map(([k, d]) => h("li", {}, h("code", {}, `{${k}}`), " ", d)))),
      h("label", { for: "pl-prefijo" }, "Prefijo de todos los títulos"), prefijo,
      h("label", {}, icono, " Mostrar el ícono de la app en el aviso (ntfy)"),
      h("p"), h("button", { onclick: guardarGlobal }, "Guardar")),
    ...PL.orden.map(evento),
    Object.keys(tuyas).length ? h("p", {}, h("button", { class: "peligro", onclick: (e) => { if (confirm("¿Volver todos los avisos a la plantilla del equipo?")) act(e.target, async () => { await api("/api/plantillas/todo", { method: "DELETE" }); PL = null; }); } }, "Restaurar todo")) : null,
  ];
}

// ---------- Qué aprende el algoritmo ----------
let PR = null;
const MODOS = { agendar: "Agendar solo", sugerir: "Solo sugerir", nunca: "Ignorar" };
function vistaAlgoritmo() {
  if (!PR) { api("/api/prediccion").then((r) => { PR = r; render(); }).catch((e) => toast(e.message, true)); return h("p", { class: "cargando" }, "Cargando…"); }
  const c = PR.config;
  const guardar = (btn, body) => act(btn, async () => { await api("/api/prediccion", { method: "PUT", body }); PR = null; }, "Guardado.");
  const selModo = (itemId, actual) => h("select", { style: "width:auto", onchange: (e) => guardar(e.target, { modos: { [itemId]: e.target.value } }) },
    Object.entries(MODOS).map(([k, l]) => h("option", { value: k, selected: k === actual }, l)));
  const num = (id, label, val, min, max, step = 1) => h("div", {}, h("label", { for: id }, label), h("input", { id, type: "number", min, max, step, value: val }));
  return [
    h("p", {}, h("a", { href: "#ajustes" }, "‹ Ajustes")),
    h("section", { class: "tarjeta" }, h("h1", {}, "Qué aprende"),
      h("p", { class: "suave" }, "Miro lo que registras. Si haces lo mismo a una hora parecida varios días, lo considero un hábito: lo puedo agendar solo («Armar mi día»), solo sugerirlo en Hoy y en los avisos, o ignorarlo."),
      h("ul", { class: "lista" }, PR.habitos.length ? PR.habitos.map((x) => h("li", {},
        h("span", { class: "hora" }, x.hora),
        h("span", { class: "que" }, x.title, h("small", {}, `${x.finde ? "fin de semana" : "lunes a viernes"} · ${x.dur_min} min · ${x.veces} de ${x.de} días`)),
        selModo(x.item_id, x.modo))) : h("li", { class: "vacio" }, "Todavía no hay hábitos. Registra unos días."))),
    PR.items.length ? h("section", { class: "tarjeta" }, h("h2", {}, "Rutinas y hábitos"),
      h("p", { class: "suave" }, "Las rutinas con hora se agendan solas salvo que digas otra cosa. Lo de tus notas y Notion se agenda cuando lo pasas a «Por hacer»."),
      h("ul", { class: "lista" }, PR.items.map((i) => h("li", {},
        h("span", { class: "que" }, i.title, h("small", {}, [i.kind, i.hora, i.propio ? "" : "por defecto"].filter(Boolean).join(" · "))),
        selModo(i.id, i.modo))))) : null,
    h("section", { class: "tarjeta" }, h("h2", {}, "Sensibilidad"),
      h("div", { class: "col2" },
        num("p-dias", "Días de historial", c.dias, 7, 120), num("p-veces", "Mínimo de días", c.min_veces, 2, 30),
        num("p-frac", "Constancia mínima (%)", Math.round(c.min_frac * 100), 5, 100, 5), num("p-vent", "Tolerancia de hora (min)", c.ventana, 10, 120, 5),
        num("p-radio", "Sugerir hasta (min de distancia)", c.radio, 10, 180, 5),
        h("div", {}, h("label", { for: "p-def" }, "Hábito nuevo"), h("select", { id: "p-def" }, Object.entries(MODOS).map(([k, l]) => h("option", { value: k, selected: k === c.modo_defecto }, l))))),
      h("p"), h("button", { class: "primario", onclick: (e) => guardar(e.target, {
        dias: $("#p-dias").value, min_veces: $("#p-veces").value, min_frac: Number($("#p-frac").value) / 100,
        ventana: $("#p-vent").value, radio: $("#p-radio").value, modo_defecto: $("#p-def").value,
      }) }, "Guardar")),
  ];
}

inicio().catch((e) => { vista.replaceChildren(h("p", { class: "vacio" }, "No pude conectar con el servidor. ", e.message)); });
