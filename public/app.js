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
    try { S = await api("/api/estado"); render(); } catch {}
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
window.addEventListener("hashchange", render);

function render() {
  clearInterval(tick);
  if (!sesion.dentro) { $("#nav").hidden = true; vista.replaceChildren(sesion.cuenta ? vistaEntrar() : vistaInstalar()); return; }
  $("#nav").hidden = false;
  const v = (location.hash.slice(1).split(/[?&]/)[0] || "hoy");
  for (const a of document.querySelectorAll("#nav a")) a.classList.toggle("activa", a.dataset.v === v);
  const foco = document.activeElement?.id, val = foco && document.activeElement.value;
  const vistas = { hoy: vistaHoy, tareas: vistaTareas, bandeja: vistaBandeja, registro: vistaRegistro, ajustes: vistaAjustes };
  vista.replaceChildren(...[].concat((vistas[v] || vistaHoy)()));
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
  const agenda = ag.length ? h("ul", { class: "lista" }, ag.map((x) => h("li", { class: x.end <= now ? "pasado" : x.start <= now ? "ahora-mismo" : "" },
    h("span", { class: "hora" }, x.all_day ? "todo el día" : `${hora(x.start)}–${hora(x.end)}`),
    h("span", { class: "que" }, x.title, h("small", {}, x.tipo === "evento" ? x.calendario : x.origin === "auto" ? "armado solo" : "")),
    x.end > now && !x.all_day ? h("button", { class: "icono", title: "Iniciar", "aria-label": "Iniciar " + x.title, onclick: (e) => iniciarPor(x.item_id ? { item_id: x.item_id } : { title: x.title }, e.target) }, "▶") : null,
    x.tipo === "bloque" ? h("button", { class: "icono", title: "Quitar", "aria-label": "Quitar bloque", onclick: (e) => act(e.target, () => api(`/api/bloques/${x.id}`, { method: "DELETE" })) }, "✕") : null,
  ))) : h("p", { class: "vacio" }, "Nada agendado. Toca «Armar mi día» y lo armo con lo que sueles hacer.");

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
  const tareas = S.items.filter((i) => i.kind === "tarea");
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

// ---------- Bandeja ----------
function vistaBandeja() {
  const txt = h("textarea", { id: "nota", placeholder: "Escribe una idea o una nota. La primera línea es el título." });
  const tipo = h("select", { id: "nota-tipo" }, h("option", { value: "captura" }, "Captura (para procesar)"), h("option", { value: "nota" }, "Nota (para guardar)"));
  const abiertas = S.captures.filter((c) => c.status === "abierta");
  const notas = S.captures.filter((c) => c.kind === "nota" && c.status !== "abierta");
  const fila = (c) => h("li", {},
    h("span", { class: "que" }, c.text, h("small", {}, [c.kind, c.source, new Date(c.at).toLocaleDateString("es-CL"), c.en_notion ? "en Notion" : ""].filter(Boolean).join(" · ")), c.body ? h("small", {}, c.body.slice(0, 160)) : null),
    c.status === "abierta" ? h("button", { class: "icono", title: "Convertir en tarea", onclick: (e) => act(e.target, () => api(`/api/capturas/${c.id}/tarea`, { method: "POST" }), "Ahora es tarea.") }, "→") : null,
    c.status === "abierta" ? h("button", { class: "icono", title: "Procesada", onclick: (e) => act(e.target, () => api(`/api/capturas/${c.id}`, { method: "PATCH", body: { status: "procesada" } })) }, "✓") : null);
  return [
    h("section", { class: "tarjeta" }, h("label", { for: "nota" }, "Nueva"), txt, h("div", { class: "fila", style: "margin-top:.5rem" },
      h("div", { class: "crece" }, tipo),
      h("button", { class: "primario", onclick: (e) => { const t = txt.value.trim(); if (!t) return; act(e.target, async () => { await api("/api/capturas", { method: "POST", body: { text: t, kind: tipo.value } }); txt.value = ""; }, "Guardado."); } }, "Guardar"))),
    h("section", { class: "tarjeta" }, h("h2", {}, `Por procesar (${abiertas.length})`), abiertas.length ? h("ul", { class: "lista" }, abiertas.map(fila)) : h("p", { class: "vacio" }, "Bandeja vacía.")),
    notas.length ? h("section", { class: "tarjeta" }, h("h2", {}, "Notas"), h("ul", { class: "lista" }, notas.map(fila))) : null,
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
let avisosCfg = null, tokenNuevo = null, feedUrl = null;
function vistaAjustes() {
  if (!avisosCfg) { api("/api/avisos").then((r) => { avisosCfg = r; render(); }).catch((e) => toast(e.message, true)); return h("p", { class: "cargando" }, "Cargando…"); }
  const cx = S.conexiones;
  const listo = { avisos: cx.avisos.ntfy || cx.avisos.telegram || cx.avisos.webhook, cal: cx.calendarios.length > 0, notion: cx.notion.ok, atajos: !!tokenNuevo || avisosCfg.tokens > 0 };
  const paso = (n, ok, titulo, ...cuerpo) => h("section", { class: "tarjeta" }, h("div", { class: "paso" + (ok ? " listo" : "") }, h("span", { class: "num" }, ok ? "✓" : n), h("div", {}, h("h3", {}, titulo), ...cuerpo)));

  return [
    !sesion.onboarding?.listo ? h("section", { class: "tarjeta" }, h("h1", {}, "Configura en 4 pasos"),
      h("p", { class: "suave" }, "Todo queda en tu servidor. Puedes saltarte pasos y volver cuando quieras."),
      h("button", { class: "primario", onclick: (e) => act(e.target, async () => { await api("/api/onboarding", { method: "PUT", body: { listo: true } }); sesion.onboarding = { listo: true }; location.hash = "#hoy"; }) }, "Listo, ir a Hoy")) : null,
    paso(1, listo.avisos, "Avisos al celular", pasoAvisos()),
    paso(2, listo.cal, "Calendarios (Google, iCloud, Outlook)", pasoCalendarios()),
    paso(3, listo.notion, "Notion", pasoNotion()),
    paso(4, listo.atajos, "Atajos: Siri, Android y reloj", pasoAtajos()),
    h("section", { class: "tarjeta" }, h("h3", {}, "Tu agenda en otros calendarios"),
      h("p", { class: "suave" }, "Suscríbete a este enlace desde Google Calendar, Apple o Outlook para ver tus bloques y lo medido."),
      feedUrl ? h("code", { class: "codigo" }, feedUrl) : h("button", { onclick: (e) => act(e.target, async () => { feedUrl = (await api("/api/feed")).url; }) }, "Mostrar enlace")),
    h("section", { class: "tarjeta" }, h("h3", {}, "Apariencia"),
      h("p", { class: "suave" }, "Los colores, letras y logo vienen de una plantilla. Para personalizarla sin tocar el código, monta una carpeta con tu tema.css (y si quieres, letras e íconos) en /tema."),
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

function pasoCalendarios() {
  const nombre = h("input", { id: "cal-nombre", placeholder: "Trabajo, Personal…" });
  const url = h("input", { id: "cal-url", placeholder: "https://…/basic.ics", autocomplete: "off" });
  const cals = S.conexiones.calendarios;
  return [
    h("p", { class: "suave" }, "Leo tus calendarios con su enlace iCal secreto (solo lectura, sin dar contraseñas). Se actualizan cada 10 minutos y bloquean «Armar mi día»."),
    h("details", {}, h("summary", {}, "¿Dónde está el enlace?"),
      h("p", {}, h("b", {}, "Google: "), "calendar.google.com → ⚙ Configuración → elige el calendario → «Dirección secreta en formato iCal»."),
      h("p", {}, h("b", {}, "iCloud: "), "app Calendario → (i) junto al calendario → «Calendario público» → Compartir enlace (webcal://…)."),
      h("p", {}, h("b", {}, "Outlook: "), "outlook.com → ⚙ → Calendario → Calendarios compartidos → Publicar → copia el enlace ICS.")),
    cals.length ? h("ul", { class: "lista" }, cals.map((c) => h("li", {},
      h("span", { class: "que" }, c.name, h("small", {}, c.error ? `✗ ${c.error}` : c.last_ok_at ? `al día · ${hora(c.last_ok_at)}` : "pendiente")),
      h("button", { class: "icono", title: "Quitar", onclick: (e) => act(e.target, () => api(`/api/calendarios/${c.id}`, { method: "DELETE" })) }, "✕")))) : null,
    h("label", { for: "cal-nombre" }, "Nombre"), nombre, h("label", { for: "cal-url" }, "Enlace iCal"), url, h("p"),
    h("div", { class: "fila" },
      h("button", { class: "primario", onclick: (e) => act(e.target, async () => { await api("/api/calendarios", { method: "POST", body: { name: nombre.value || "Calendario", url: url.value } }); }, "Calendario agregado.") }, "Agregar"),
      cals.length ? h("button", { onclick: (e) => act(e.target, () => api("/api/calendarios/refrescar", { method: "POST" }), "Actualizado.") }, "Actualizar ahora") : null),
  ];
}

function pasoNotion() {
  const n = S.conexiones.notion;
  if (n.ok) return [
    h("p", {}, n.pendientes ? `Copiando a Notion: ${n.pendientes} pendientes.` : "Todo copiado a Notion."),
    n.error ? h("p", { class: "suave" }, `Último error: ${n.error}`) : null,
    h("p", { class: "suave" }, "Notion es una copia: tareas, tiempo registrado y notas. Lo que cambies allá no vuelve (así nunca hay conflictos)."),
    h("div", { class: "fila" }, h("button", { onclick: (e) => act(e.target, () => api("/api/notion/reintentar", { method: "POST" }), "Reintentado.") }, "Reintentar ahora"),
      h("button", { class: "peligro", onclick: (e) => { if (confirm("¿Desconectar Notion? No borra nada allá.")) act(e.target, () => api("/api/notion", { method: "DELETE" })); } }, "Desconectar")),
  ];
  const tok = h("input", { id: "n-token", placeholder: "ntn_… o secret_…", autocomplete: "off" });
  const pag = h("input", { id: "n-pag", placeholder: "https://www.notion.so/Mi-pagina-…" });
  return [
    h("ol", { class: "pasos" },
      h("li", {}, "Entra a ", h("a", { href: "https://www.notion.so/profile/integrations", target: "_blank", rel: "noopener" }, "notion.so/profile/integrations"), " → Nueva integración (interna) → copia el token."),
      h("li", {}, "Crea una página vacía en Notion (ej: «Juez del Tiempo»)."),
      h("li", {}, "En esa página: ••• → Conexiones → agrega tu integración."),
      h("li", {}, "Pega aquí el token y el enlace de la página. Creo tres bases: Tareas, Tiempo registrado y Capturas y notas.")),
    h("label", { for: "n-token" }, "Token"), tok, h("label", { for: "n-pag" }, "Enlace de la página"), pag, h("p"),
    h("button", { class: "primario", onclick: (e) => act(e.target, () => api("/api/notion", { method: "POST", body: { token: tok.value.trim(), pagina: pag.value.trim() } }), "Notion conectado.") }, "Conectar Notion"),
  ];
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
          h("li", {}, "Agrega «Mostrar resultado». Nómbralo «Juez» y di: «Oye Siri, Juez»."),
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

inicio().catch((e) => { vista.replaceChildren(h("p", { class: "vacio" }, "No pude conectar con el servidor. ", e.message)); });
