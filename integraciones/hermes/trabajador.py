#!/usr/bin/env python3
"""Trabajador de Veredicto: toma UNA tarea de la cola y la hace con Hermes.

  trabajador.py local   → perfil worker-local (Ollama)
  trabajador.py cloud   → perfil worker-cloud (solo tareas con tu OK cloud)

Lo lanza launchd cada 2 minutos. Veredicto decide qué sigue y si toca esperar:
si el asistente está en WhatsApp, si ya hay una tarea corriendo en el carril, o si es
de noche/día. El script no decide nada por su cuenta.

Si VEREDICTO_PROYECTOS apunta a un proyectos.json ({"proyectos": [{"nombre", "ruta"}]}), la tarea
corre DENTRO de la carpeta de su proyecto: Hermes carga su AGENTS.md y deja lo que haga en ./salidas/.

Resultado: lo que Hermes responde queda en la tarea y pasa a «Espera tu OK».
Si la respuesta empieza con «BLOQUEADA:», la tarea queda bloqueada con ese motivo.
"""
import json, os, socket, subprocess, sys, threading, time
from pathlib import Path

import importlib.util
from importlib.machinery import SourceFileLoader


def _cargar(ruta):
    l = SourceFileLoader("vd", str(ruta))
    m = importlib.util.module_from_spec(importlib.util.spec_from_loader("vd", l))
    l.exec_module(m)
    return m


vd = _cargar(Path(__file__).resolve().parent / "vd")

CARRIL = sys.argv[1] if len(sys.argv) > 1 else "local"
PERFIL = os.environ.get("VEREDICTO_PERFIL") or f"worker-{CARRIL}"
MODELO = os.environ.get("VEREDICTO_MODELO", "")
MAQUINA = socket.gethostname().split(".")[0]
HERMES = os.environ.get("HERMES_BIN", "hermes")
DUENO = os.environ.get("VEREDICTO_DUENO", "el dueño de esta instalación")
TRABAJO = os.path.expanduser(os.environ.get("VEREDICTO_CARPETA_TRABAJO", "~/Veredicto-agentes"))
PROYECTOS = os.path.expanduser(os.environ.get("VEREDICTO_PROYECTOS", ""))
LIMITE_MIN = int(os.environ.get("VEREDICTO_LIMITE_MIN", "80"))  # menor que trabajo_max_min de Veredicto


def latido(estado, item=None):
    try:
        vd.api("POST", "/api/agente/latido", {"agente": PERFIL, "carril": CARRIL, "modelo": MODELO, "maquina": MAQUINA, "estado": estado, "item_id": item})
    except SystemExit:
        pass


def carpeta_proyecto(t):
    """Carpeta del proyecto según proyectos.json (o None si no hay índice o no está)."""
    if not PROYECTOS or not t.get("proyecto"):
        return None
    try:
        idx = json.loads(Path(PROYECTOS).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    for p in idx.get("proyectos", []):
        if p.get("nombre", "").strip().lower() == t["proyecto"].strip().lower():
            d = Path(PROYECTOS).parent / p["ruta"]
            (d / "salidas").mkdir(parents=True, exist_ok=True)
            return d
    return None


def prompt(t, cwd=None):
    detalle = ("Detalle y criterio de listo:\n" + t["detalle"]) if t.get("detalle") else ""
    carpeta = (t.get("proyecto") or "general").replace("/", "-")
    destino = f"{cwd}/salidas/" if cwd else f"{TRABAJO}/{carpeta}/"
    contexto = "- Estás en la carpeta del proyecto: sigue su AGENTS.md (objetivo, decisiones, reglas).\n" if cwd else ""
    return f"""Eres {PERFIL}, un agente que trabaja para {DUENO}. Tienes UNA tarea de su cola en Veredicto.

Tarea: {t['title']}
Proyecto: {t.get('proyecto') or 'sin proyecto'}
Prioridad: P{t.get('prioridad') or 3}
{detalle}

Reglas:
{contexto}- Haz solo esta tarea. Guarda archivos en {destino} .
- No envíes mensajes a nadie ni cambies nada fuera de esa carpeta: {DUENO} revisa y aprueba después.
- No uses proveedores pagos ni cambies de modelo.
- Si no puedes terminar (falta un dato, un acceso, una decisión), responde en una línea que empiece con
  «BLOQUEADA:» y di exactamente qué necesitas.
- Si terminas, responde con un resumen de máximo 10 líneas: qué hiciste y la ruta de cada archivo.
"""


def main():
    r = vd.api("POST", "/api/agente/siguiente", {"carril": CARRIL, "agente": PERFIL})
    if "tarea" not in r:
        latido({"conversacion": "esperando: el asistente está en WhatsApp", "ocupado": "trabajando", "vacia": "libre"}.get(r.get("espera"), r.get("espera", "")))
        return
    t = r["tarea"]
    latido("trabajando", t["id"])
    fin = threading.Event()

    def pulso():
        while not fin.wait(60):
            latido("trabajando", t["id"])
    threading.Thread(target=pulso, daemon=True).start()

    cmd = [HERMES, "-p", PERFIL, "chat", "--oneshot", "-Q", "--query-file", "-", "-s", "veredicto-trabajador"]
    cwd = carpeta_proyecto(t)
    try:
        p = subprocess.run(cmd, input=prompt(t, cwd), capture_output=True, text=True, timeout=LIMITE_MIN * 60, cwd=str(cwd) if cwd else None)
        salida, err, code = p.stdout.strip(), p.stderr.strip(), p.returncode
    except subprocess.TimeoutExpired:
        salida, err, code = "", f"Se pasó de {LIMITE_MIN} min.", 124
    except FileNotFoundError:
        salida, err, code = "", f"No encontré «{HERMES}». Pon HERMES_BIN con la ruta completa.", 127
    finally:
        fin.set()

    if code == 0 and salida and not salida.upper().startswith("BLOQUEADA"):
        vd.api("PATCH", f"/api/agente/tareas/{t['id']}", {"estado": "revision", "resultado": salida[-50000:], "agente": PERFIL})
        latido("libre")
    else:
        motivo = salida if salida.upper().startswith("BLOQUEADA") else f"Hermes salió con código {code}. {err[-1500:]}"
        vd.api("PATCH", f"/api/agente/tareas/{t['id']}", {"estado": "bloqueada", "nota": motivo[:1900], "resultado": salida[-50000:], "agente": PERFIL})
        latido("libre (última bloqueada)")


if __name__ == "__main__":
    main()
