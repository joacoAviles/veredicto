#!/usr/bin/env python3
"""Aviso sin IA: lo que terminó un agente y espera tu OK, o lo que quedó bloqueado.

Corre como cron de Hermes sin modelo (cero tokens):
  hermes cron create "every 10m" --no-agent --script veredicto-avisos.py --deliver whatsapp
Si no hay nada nuevo no imprime nada y Hermes no manda mensaje.
"""
import json, os, sys
from pathlib import Path
import importlib.util
from importlib.machinery import SourceFileLoader

aqui = Path(os.environ.get("VEREDICTO_INTEGRACION", Path.home() / ".hermes" / "veredicto"))
_l = SourceFileLoader("vd", str(aqui / "vd"))
vd = importlib.util.module_from_spec(importlib.util.spec_from_loader("vd", _l))
_l.exec_module(vd)
estado_f = aqui / ".avisados.json"
vistos = set(json.loads(estado_f.read_text())) if estado_f.exists() else set()

rev = vd.api("GET", "/api/agente/tareas?estado=revision&limite=50")
blo = vd.api("GET", "/api/agente/tareas?estado=bloqueada&limite=50")
nuevos_r = [t for t in rev if f"r:{t['id']}" not in vistos]
nuevos_b = [t for t in blo if f"b:{t['id']}" not in vistos]
lineas = []
for t in nuevos_r:
    resumen = (t.get("resultado") or "").strip().splitlines()[:4]
    lineas.append(f"✅ Listo para tu OK [{t['id'][:6]}] {t['title']}" + ("".join(f"\n   {l}" for l in resumen)))
for t in nuevos_b:
    lineas.append(f"⛔ Bloqueada [{t['id'][:6]}] {t['title']}")
if lineas:
    lineas.append("Responde «ok ID» para aprobar o «corrige ID …» para devolverla.")
    print("\n".join(lineas))
vistos = {f"r:{t['id']}" for t in rev} | {f"b:{t['id']}" for t in blo}
estado_f.write_text(json.dumps(sorted(vistos)))
