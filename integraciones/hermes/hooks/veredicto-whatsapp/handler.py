"""Hook de gateway: al empezar un turno de WhatsApp, avisa a Veredicto que el asistente está conversando.

Veredicto deja de entregar tareas al carril local durante la pausa configurada
(Infra → Agentes y conexión → «Pausa tras WhatsApp»). No bloquea al asistente: si
Veredicto no responde, el mensaje se atiende igual.
"""
import asyncio, json, os, urllib.request
from pathlib import Path


def _env():
    v = {}
    p = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes")) / ".env"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, _, val = line.partition("=")
                v[k.strip()] = val.strip().strip('"').strip("'")
    return (os.environ.get("VEREDICTO_URL") or v.get("VEREDICTO_URL", "")).rstrip("/"), os.environ.get("VEREDICTO_TOKEN") or v.get("VEREDICTO_TOKEN", "")


def _avisar():
    url, tok = _env()
    if not url or not tok:
        return
    req = urllib.request.Request(f"{url}/api/agente/conversando", data=b"{}", method="POST",
                                 headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=4).read()
    except Exception:
        pass


async def handle(event_type: str, context: dict):
    if str(context.get("platform", "")).lower() != "whatsapp":
        return
    await asyncio.to_thread(_avisar)
