import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, construirAviso } from "../src/vigilante.js";
import { merge, sanitize, fill } from "../src/plantillas.js";
import { sanitizePred, rutinasPermitidas, paraAgendar, paraSugerir } from "../src/prediccion.js";

const now = Date.UTC(2026, 10, 2, 15, 0);
const cfg = { activo: true, desde: "00:00", hasta: "23:59", niveles: [10, 30, 60], repetir: 10, canales: { ntfy: { topic: "t" } } };
const base = { now, tz: "UTC", cfg, st: {}, current: null, ahora: null, proximo: null, sugeridas: [], idleSince: now };

test("capas: fábrica < equipo < tuyas", () => {
  const equipo = { global: { prefijo: "EQUIPO · " }, eventos: { inactivo1: { titulo: "Oye, {sin_registrar} en blanco", tags: "eyes" } } };
  const tuyas = { eventos: { inactivo1: { tags: "fire" } } };
  const P = merge(equipo, tuyas);
  assert.equal(P.eventos.inactivo1.titulo, "Oye, {sin_registrar} en blanco");
  assert.equal(P.eventos.inactivo1.tags, "fire");
  assert.equal(P.eventos.agendado.titulo, "Agendado: {titulo}");
  const r = decide({ ...base, plantillas: P, idleSince: now - 11 * 60000, sugeridas: [{ item_id: "1", title: "Leer" }] });
  assert.equal(r.aviso.titulo, "EQUIPO · Oye, 11 min en blanco");
  assert.equal(r.aviso.tags, "fire");
});

test("acciones elegidas por plantilla", () => {
  const P = merge(null, { eventos: { inactivo1: { acciones: ["armar", "sugerencia1", "abrir"] } } });
  const r = decide({ ...base, plantillas: P, idleSince: now - 11 * 60000, sugeridas: [{ item_id: "1", title: "Leer" }] });
  assert.deepEqual(r.aviso.acciones.map((a) => a.label), ["Armar mi día", "▶ Leer", "Abrir"]);
});

test("evento apagado: no avisa pero avanza el nivel", () => {
  const P = merge(null, { eventos: { inactivo1: { activo: false } } });
  const r = decide({ ...base, plantillas: P, idleSince: now - 11 * 60000 });
  assert.equal(r.aviso, null);
  assert.equal(r.st.nivel, 1);
});

test("aviso previo, una vez por bloque", () => {
  const proximo = { key: "b:1", item_id: "x", title: "Clase", start: now + 4 * 60000, end: now + 64 * 60000 };
  const r = decide({ ...base, proximo });
  assert.equal(r.aviso.tipo, "previo");
  assert.equal(r.aviso.titulo, "En 4 min: Clase");
  assert.equal(r.aviso.acciones[0].label, "▶ Clase");
  assert.notEqual(decide({ ...base, proximo, st: r.st }).aviso?.tipo, "previo");
});

test("agendado mientras registras otra cosa: ofrece cambiar", () => {
  const current = { id: "s1", item_id: "a", title: "Correo", state: "running", segments: [[now - 60000, null]] };
  const ahora = { key: "b:2", item_id: "b", title: "Reunión", start: now - 60000, end: now + 3600000 };
  const r = decide({ ...base, current, ahora });
  assert.equal(r.aviso.tipo, "agendado");
  assert.equal(r.aviso.acciones[0].label, "▶ Reunión");
  // si ya estás en eso, silencio
  assert.equal(decide({ ...base, current: { ...current, item_id: "b", title: "Reunión" }, ahora }).motivo, "registrando");
});

test("se pasó de lo estimado", () => {
  const current = { id: "s1", item_id: "a", title: "Correo", state: "running", segments: [[now - 50 * 60000, null]] };
  const r = decide({ ...base, current, estimadoMin: 30 });
  assert.equal(r.aviso.tipo, "excedido");
  assert.equal(r.aviso.acciones[0].label, "■ Parar");
  assert.equal(decide({ ...base, current, estimadoMin: 30, st: r.st }).motivo, "registrando");
  assert.equal(decide({ ...base, current, estimadoMin: 40 }).motivo, "registrando");
});

test("sanitize descarta lo inválido", () => {
  const s = sanitize({ eventos: { inactivo1: { prioridad: 9, acciones: ["borrar_todo", "parar"], tags: "a<b" }, malo: {} } });
  assert.equal(s.eventos.inactivo1.prioridad, 5);
  assert.deepEqual(s.eventos.inactivo1.acciones, ["parar"]);
  assert.equal(s.eventos.inactivo1.tags, "ab");
  assert.equal(s.eventos.malo, undefined);
  assert.equal(fill("{a} y {b}", { a: 1 }), "1 y {b}");
});

test("modos del algoritmo", () => {
  const ID = "11111111-1111-1111-1111-111111111111";
  const pred = sanitizePred({}, { modos: { [ID]: "nunca", "no-uuid": "agendar" }, min_veces: 1, modo_defecto: "sugerir" });
  assert.equal(pred.min_veces, 2);
  assert.deepEqual(pred.modos, { [ID]: "nunca" });
  const hab = [{ item_id: ID, modo: "nunca" }, { item_id: "x", modo: "sugerir" }, { item_id: "y", modo: "agendar" }];
  assert.deepEqual(paraAgendar(hab).map((h) => h.item_id), ["y"]);
  assert.deepEqual(paraSugerir(hab).map((h) => h.item_id), ["x", "y"]);
  const rut = [{ id: ID, hora: "08:00" }, { id: "z", hora: "09:00" }, { id: "w", hora: null }];
  assert.deepEqual(rutinasPermitidas(rut, pred, "agendar").map((r) => r.id), ["z"]);
});
