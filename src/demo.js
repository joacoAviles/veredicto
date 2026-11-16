// Modo demo: 3 semanas de datos de ejemplo para recorrer todo antes de conectar nada.
// Todo lo que crea queda marcado (demo = true) y se borra con un botón, sin tocar lo tuyo.
import { startOfDay, addDays, atMinute, weekday } from "./time.js";

const PILARES = [["Trabajo", "#2f6df6"], ["Creación", "#d6409f"], ["Salud", "#1f8a4c"], ["Aviación", "#e08a00"]];
const PROYECTOS = [
  ["Lanzar API pública", "Trabajo", 40 * 60, 21], ["Canal de YouTube", "Creación", 30 * 60, 35],
  ["Licencia de piloto privado", "Aviación", 60 * 60, 90], ["Entrenar para 10K", "Salud", 20 * 60, 45],
];
const TAREAS = [
  ["Documentar endpoints de pagos", "Lanzar API pública", 90, "Hacer ya", 2], ["Pruebas de carga", "Lanzar API pública", 120, "Agendar", 5],
  ["Revisar contrato con cliente", "Lanzar API pública", 45, "Hacer ya", 1], ["Guion: cómo se arranca un R22", "Canal de YouTube", 90, "Agendar", 4],
  ["Editar video del aeródromo", "Canal de YouTube", 120, "Agendar", 6], ["Miniaturas de la serie", "Canal de YouTube", 45, "Delegar", null],
  ["Estudiar meteorología (cap. 4)", "Licencia de piloto privado", 60, "Agendar", 3], ["Reservar avión para el sábado", "Licencia de piloto privado", 15, "Hacer ya", 0],
  ["Comprar zapatillas de trote", "Entrenar para 10K", 30, "Eliminar", null],
];
const RUTINAS = [["Transporte", "08:10", 50, [1, 2, 3, 4, 5]], ["Almuerzo", "13:30", 45, null], ["Gimnasio", "19:00", 60, [1, 3, 5]], ["Revisión del día", "22:00", 15, null]];
const CAPTURAS = ["Idea: serie sobre carburadores", "Llamar al taller por la revisión técnica", "Video: 5 errores del primer vuelo solo"];

export async function cargar(pool, tz, now = Date.now()) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const pil = {};
    for (const [i, [n, color]] of PILARES.entries()) pil[n] = (await c.query("INSERT INTO pilares(nombre,color,orden,demo) VALUES ($1,$2,$3,true) RETURNING id", [n, color, i])).rows[0].id;
    const pro = {};
    for (const [n, p, plan, dias] of PROYECTOS) {
      pro[n] = (await c.query("INSERT INTO proyectos(nombre,pilar_id,minutos_plan,fecha_limite,demo) VALUES ($1,$2,$3,$4,true) RETURNING id",
        [n, pil[p], plan, new Date(now + dias * 864e5).toISOString().slice(0, 10)])).rows[0].id;
    }
    const tareas = [];
    for (const [t, p, est, eis, dias] of TAREAS) {
      tareas.push((await c.query("INSERT INTO items(kind,title,est_min,proyecto_id,eisenhower,due_date,demo,agendable) VALUES ('tarea',$1,$2,$3,$4,$5,true,$6) RETURNING id, title, proyecto_id",
        [t, est, pro[p], eis, dias == null ? null : new Date(now + dias * 864e5).toISOString().slice(0, 10), eis === "Agendar"])).rows[0]);
    }
    const rut = [];
    for (const [t, hora, est, dias] of RUTINAS) rut.push({ t, hora, est, dias, id: (await c.query("INSERT INTO items(kind,title,hora,est_min,dias,demo) VALUES ('rutina',$1,$2,$3,$4,true) RETURNING id", [t, hora, est, dias])).rows[0].id });

    // 21 días de registros: rutinas a su hora (con variación) y trabajo en proyectos.
    const hoy = startOfDay(now, tz);
    const sesion = async (itemId, title, a, b) => {
      if (b > now) return;
      const s = (await c.query("INSERT INTO sessions(item_id,title,state,started_at,ended_at,source,demo) VALUES ($1,$2,'done',$3,$4,'demo',true) RETURNING id", [itemId, title, new Date(a), new Date(b)])).rows[0];
      await c.query("INSERT INTO segments(session_id,started_at,ended_at) VALUES ($1,$2,$3)", [s.id, new Date(a), new Date(b)]);
    };
    let semilla = 7;
    const azar = (n) => { semilla = (semilla * 9301 + 49297) % 233280; return Math.floor((semilla / 233280) * n); };
    for (let d = 21; d >= 0; d--) {
      const dia = addDays(hoy, -d, tz), wd = weekday(dia, tz);
      for (const r of rut) {
        if (r.dias && !r.dias.includes(wd)) continue;
        if (azar(10) < 2) continue;
        const [h, m] = r.hora.split(":").map(Number);
        const a = atMinute(dia, h * 60 + m + azar(15) - 5, tz);
        await sesion(r.id, r.t, a, a + (r.est + azar(15) - 5) * 60000);
      }
      if (wd >= 1 && wd <= 5) {
        const t1 = tareas[azar(3)], t2 = tareas[3 + azar(3)];
        const a = atMinute(dia, 9 * 60 + 30 + azar(30), tz);
        await sesion(t1.id, t1.title, a, a + (90 + azar(60)) * 60000);
        const b = atMinute(dia, 15 * 60 + azar(45), tz);
        await sesion(t2.id, t2.title, b, b + (60 + azar(60)) * 60000);
      } else if (azar(2)) {
        const t = tareas[6 + azar(2)];
        const a = atMinute(dia, 10 * 60 + azar(60), tz);
        await sesion(t.id, t.title, a, a + 75 * 60000);
      }
    }
    // Bloques de hoy y mañana, capturas y actividad del computador de hoy.
    for (const [i, t] of [tareas[0], tareas[3]].entries()) {
      const a = atMinute(addDays(hoy, i, tz), 16 * 60, tz);
      await c.query("INSERT INTO blocks(item_id,title,starts_at,ends_at,origin,demo) VALUES ($1,$2,$3,$4,'manual',true)", [t.id, t.title, new Date(a), new Date(a + 90 * 60000)]);
    }
    for (const t of CAPTURAS) await c.query("INSERT INTO captures(kind,text,source,demo) VALUES ('captura',$1,'demo',true)", [t]);
    const apps = [["Visual Studio Code", "api/pagos.js — web-api"], ["Google Chrome", "Documentación Stripe"], ["Slack", "#equipo-api"], ["DaVinci Resolve", "R22 arranque — Timeline 1"]];
    let t = Math.max(atMinute(hoy, 9 * 60, tz), now - 5 * 3600_000);
    for (let i = 0; t < now - 10 * 60000 && i < 20; i++) {
      const [app, titulo] = apps[azar(apps.length)], dur = (10 + azar(35)) * 60000;
      await c.query("INSERT INTO actividad(fuente,inicio,fin,app,titulo,demo) VALUES ('demo',$1,$2,$3,$4,true) ON CONFLICT DO NOTHING", [new Date(t), new Date(Math.min(t + dur, now)), app, titulo]);
      t += dur + azar(5) * 60000;
    }
    await c.query("COMMIT");
    return { pilares: PILARES.length, proyectos: PROYECTOS.length, tareas: TAREAS.length, rutinas: RUTINAS.length };
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}

export async function borrar(pool) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("DELETE FROM sessions WHERE demo OR item_id IN (SELECT id FROM items WHERE demo)");
    await c.query("DELETE FROM blocks WHERE demo");
    await c.query("DELETE FROM items WHERE demo");
    await c.query("DELETE FROM captures WHERE demo");
    await c.query("DELETE FROM actividad WHERE demo");
    await c.query("DELETE FROM proyectos WHERE demo");
    await c.query("DELETE FROM pilares WHERE demo");
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}
