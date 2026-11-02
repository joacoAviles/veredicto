import { test } from "node:test";
import assert from "node:assert/strict";
import { parseICS, expand } from "../src/conectores/ical.js";
import { habits, armarDia } from "../src/plan.js";
import { zoned } from "../src/time.js";
import { signAction, verifyAction } from "../src/auth.js";
import { inWindow } from "../src/vigilante.js";

const TZ = "America/Santiago";

test("iCal: semanal con zona, excepción y cancelación", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT", "UID:clase", "SUMMARY:Clase", "DTSTART;TZID=America/Santiago:20261102T090000", "DTEND;TZID=America/Santiago:20261102T103000",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6", "EXDATE;TZID=America/Santiago:20261104T090000", "END:VEVENT",
    "BEGIN:VEVENT", "UID:clase", "RECURRENCE-ID;TZID=America/Santiago:20261109T090000", "SUMMARY:Clase (movida)",
    "DTSTART;TZID=America/Santiago:20261109T120000", "DTEND;TZID=America/Santiago:20261109T133000", "END:VEVENT",
    "BEGIN:VEVENT", "UID:todo", "SUMMARY:Feriado", "DTSTART;VALUE=DATE:20261105", "DTEND;VALUE=DATE:20261106", "END:VEVENT",
    "END:VCALENDAR"].join("\r\n");
  const from = zoned(2026, 11, 1, 0, 0, 0, TZ), to = zoned(2026, 11, 30, 0, 0, 0, TZ);
  const ev = expand(parseICS(ics, TZ), from, to, TZ).sort((a, b) => a.starts_at - b.starts_at);
  const clases = ev.filter((e) => e.uid === "clase");
  assert.equal(clases.length, 5); // 6 menos el EXDATE
  assert.equal(clases[0].starts_at, zoned(2026, 11, 2, 9, 0, 0, TZ));
  const movida = clases.find((e) => e.title === "Clase (movida)");
  assert.equal(movida.starts_at, zoned(2026, 11, 9, 12, 0, 0, TZ));
  assert.ok(ev.find((e) => e.uid === "todo").all_day);
});

test("hábitos: transporte 08:10 de lunes a viernes se agenda solo", () => {
  const now = zoned(2026, 11, 2, 7, 0, 0, TZ); // lunes 07:00
  const ses = [];
  for (let d = 1; d <= 21; d++) {
    const t = now - d * 86400000;
    const wd = new Date(t).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(t).split("-").map(Number);
    ses.push({ item_id: "tr", title: "Transporte", started_at: zoned(day[0], day[1], day[2], 8, 10, 0, TZ), dur_ms: 50 * 60000 });
  }
  const h = habits(ses, now, TZ);
  assert.ok(h.some((x) => x.item_id === "tr" && !x.finde));
  const plan = armarDia(h, [], [], now, TZ);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].title, "Transporte");
  // si el calendario ya tiene algo a esa hora, no lo pisa
  const ocupado = [{ start: zoned(2026, 11, 2, 8, 0, 0, TZ), end: zoned(2026, 11, 2, 9, 0, 0, TZ) }];
  assert.equal(armarDia(h, [], ocupado, now, TZ).length, 0);
});

test("enlaces firmados vencen y no se pueden alterar", () => {
  const t = signAction("s", "iniciar", { title: "X" }, 1000, 0);
  assert.equal(verifyAction("s", t, 500).a, "iniciar");
  assert.equal(verifyAction("s", t, 2000), null);
  assert.equal(verifyAction("otra", t, 500), null);
});

test("horario que cruza medianoche", () => {
  assert.ok(inWindow(23 * 60, "08:00", "02:00"));
  assert.ok(inWindow(60, "08:00", "02:00"));
  assert.ok(!inWindow(5 * 60, "08:00", "02:00"));
});
