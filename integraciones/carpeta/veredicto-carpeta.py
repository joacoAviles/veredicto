#!/usr/bin/env python3
"""veredicto-carpeta — tus tareas pendientes de Veredicto en una carpeta de tu computador.

Escribe «Pendientes.md» (o un .md por proyecto) y lo mantiene al día en ambos sentidos:
  - Marca una casilla [x]            → la tarea queda hecha en Veredicto.
  - Cambia el texto de una tarea     → se renombra en Veredicto (solo tareas creadas en la app o aquí).
  - Agrega «- [ ] algo» bajo un título → se crea en ese proyecto (📅 AAAA-MM-DD = fecha límite,
    [Hacer ya] / [Agendar] / [Delegar] / [Eliminar] = cuadrante de Eisenhower).
  - Lo que hagas en Veredicto, en tu teléfono o en tus notas aparece en el archivo.

Solo usa la biblioteca estándar de Python 3.8+. Funciona en macOS, Linux y Windows.

  python3 veredicto-carpeta.py configurar --url https://veredicto.tudominio.cl --token jdc_… --carpeta ~/Tareas [--por-proyecto]
  python3 veredicto-carpeta.py            # una pasada (para launchd / systemd / Programador de tareas)
  python3 veredicto-carpeta.py --cada 60  # se queda corriendo, una pasada por minuto
  python3 veredicto-carpeta.py instalar   # deja la pasada automática cada 2 min en este computador

El token se crea en Veredicto → Ajustes → Carpeta sincronizada (empieza con jdc_).
"""
import argparse, hashlib, json, os, platform, re, subprocess, sys, tempfile, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

CONFIG = Path(os.environ.get("VEREDICTO_CARPETA_CONFIG", Path.home() / ".config" / "veredicto" / "carpeta.json"))
ESTADO = ".veredicto-carpeta.json"
UNICO = "Pendientes.md"
SIN = "Sin proyecto"
LINEA = re.compile(r"^(\s*)[-*]\s+\[( |x|X)\]\s+(.*?)\s*$")
MARCA = re.compile(r"\s*\^vd-([0-9a-f]{8})\s*$")
FECHA = re.compile(r"\s*📅\s*(\d{4}-\d{2}-\d{2})")
EISEN = ["Hacer ya", "Agendar", "Delegar", "Eliminar"]
EIS_RE = re.compile(r"\s*\[(Hacer ya|Agendar|Delegar|Eliminar)\]", re.I)
NO_VALIDO = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


# ---------- configuración ----------
def leer_config():
    c = json.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.exists() else {}
    c["url"] = (os.environ.get("VEREDICTO_URL") or c.get("url") or "").rstrip("/")
    c["token"] = os.environ.get("VEREDICTO_TOKEN_CARPETA") or c.get("token") or ""
    c["carpeta"] = os.path.expanduser(os.environ.get("VEREDICTO_CARPETA") or c.get("carpeta") or "")
    if not (c["url"] and c["token"] and c["carpeta"]):
        sys.exit(f"Falta configurar. Usa: {sys.argv[0]} configurar --url … --token jdc_… --carpeta …")
    return c


# ---------- servidor ----------
LOCALES = {"localhost", "127.0.0.1", "::1"}


def _abrir(req, url):
    """Abre la petición. A un Veredicto local nunca se va por proxy (un proxy del sistema respondería 403)."""
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    if host in LOCALES:
        return urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=30)
    return urllib.request.urlopen(req, timeout=30)


def api(c, metodo, ruta, cuerpo=None):
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = urllib.request.Request(c["url"] + ruta, data=datos, method=metodo,
                                 headers={"Authorization": f"Bearer {c['token']}", "Content-Type": "application/json"})
    try:
        with _abrir(req, c["url"]) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode()).get("error")
        except Exception:
            msg = str(e)
        raise SystemExit(f"Veredicto respondió {e.code}: {msg}")
    except urllib.error.URLError as e:
        raise SystemExit(f"No pude conectar con {c['url']}: {e.reason}")


# ---------- archivos ----------
def nombre_archivo(grupo):
    return (NO_VALIDO.sub("-", grupo or SIN).strip(" .") or SIN)[:80] + ".md"


def leer(ruta):
    """Devuelve las casillas del archivo: [(id_corto|None, hecha, titulo, grupo, fecha, prio)]."""
    if not ruta.exists():
        return []
    grupo, out = None, []
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        if linea.startswith("## "):
            grupo = linea[3:].strip()
            continue
        m = LINEA.match(linea)
        if not m:
            continue
        resto = m.group(3)
        mid = MARCA.search(resto)
        corto = mid.group(1) if mid else None
        resto = MARCA.sub("", resto)
        f = FECHA.search(resto)
        e = EIS_RE.search(resto)
        titulo = EIS_RE.sub("", FECHA.sub("", resto)).strip()
        if titulo:
            out.append((corto, m.group(2).lower() == "x", titulo, grupo, f.group(1) if f else None, e.group(1) if e else None))
    return out


def escribir_si_cambia(ruta, texto, mtime_leido):
    """Escritura atómica. Si el archivo cambió mientras sincronizábamos, no lo pisa (se toma en la próxima pasada)."""
    if ruta.exists():
        if ruta.read_text(encoding="utf-8") == texto:
            return False
        if mtime_leido is not None and ruta.stat().st_mtime != mtime_leido:
            return False
    fd, tmp = tempfile.mkstemp(dir=str(ruta.parent), prefix=".vd-", suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(texto)
    os.replace(tmp, ruta)
    return True


def linea_tarea(t):
    extra = (f" [{t['eisenhower']}]" if t.get("eisenhower") else "") + (f" 📅 {t['due_date']}" if t.get("due_date") else "")
    return f"- [ ] {t['title']}{extra} ^vd-{t['id'][:8]}"


def render(tareas, titulo, grupos_fijos=()):
    grupos = {}
    for g in grupos_fijos:
        grupos.setdefault(g, [])
    for t in tareas:
        grupos.setdefault(t.get("grupo") or SIN, []).append(t)
    partes = [f"# {titulo}", "",
              "<!-- Veredicto: marca [x] para terminar, edita el texto para renombrar, agrega «- [ ] algo» bajo un título para crear (📅 AAAA-MM-DD = fecha, [Hacer ya] = Eisenhower). Este archivo se reescribe solo. -->", ""]
    orden = sorted(grupos, key=lambda g: (g == SIN, g.lower()))
    for g in orden:
        partes.append(f"## {g}")
        partes += [linea_tarea(t) for t in grupos[g]]
        partes.append("")
    return "\n".join(partes).rstrip() + "\n"


# ---------- una pasada ----------
def pasada(c, verbose=True):
    carpeta = Path(c["carpeta"])
    carpeta.mkdir(parents=True, exist_ok=True)
    por_proyecto = bool(c.get("por_proyecto"))
    est_f = carpeta / ESTADO
    est = json.loads(est_f.read_text(encoding="utf-8")) if est_f.exists() else {"ids": {}, "titulos": {}, "archivos": []}
    ids, titulos = est.get("ids", {}), est.get("titulos", {})

    archivos = [carpeta / a for a in est.get("archivos", [])] if por_proyecto else [carpeta / UNICO]
    if por_proyecto:  # también archivos .md nuevos que hayas creado tú en la carpeta
        archivos += [p for p in carpeta.glob("*.md") if p not in archivos]
    mtimes = {p: (p.stat().st_mtime if p.exists() else None) for p in archivos}

    hechas, renombradas, nuevas = [], [], []
    # Lo que se envió como nuevo en una pasada cuyo archivo no se pudo reescribir: no se crea dos veces.
    ya_enviadas = {tuple(x) for x in est.get("enviadas", [])}
    for ruta in archivos:
        grupo_archivo = ruta.stem if por_proyecto else None
        for corto, hecha, titulo, grupo, fecha, eis in leer(ruta):
            completo = ids.get(corto) if corto else None
            if completo:
                if hecha:
                    hechas.append(completo)
                elif titulos.get(completo) and titulo != titulos[completo]:
                    renombradas.append({"id": completo, "title": titulo})
            elif not corto and not hecha:
                g = grupo or grupo_archivo
                if (titulo, "" if g in (None, SIN) else g) in ya_enviadas:
                    continue
                nuevas.append({"title": titulo, "proyecto": None if g in (None, SIN) else g, "due_date": fecha, "eisenhower": eis})

    r = api(c, "POST", "/api/carpeta/sync", {"hechas": hechas, "renombradas": renombradas, "nuevas": nuevas})
    tareas = r["tareas"]

    escritos = []
    if por_proyecto:
        por = {}
        for t in tareas:
            por.setdefault(t.get("grupo") or SIN, []).append(t)
        for g, xs in por.items():
            ruta = carpeta / nombre_archivo(g)
            if escribir_si_cambia(ruta, render(xs, g), mtimes.get(ruta)):
                escritos.append(ruta.name)
        # Archivos de proyectos que quedaron sin pendientes: se vacían (no se borran) para que puedas agregar ahí.
        vigentes = {nombre_archivo(g) for g in por}
        for ruta in archivos:
            if ruta.exists() and ruta.name not in vigentes and any(x[0] for x in leer(ruta)):
                if escribir_si_cambia(ruta, render([], ruta.stem, [ruta.stem]), mtimes.get(ruta)):
                    escritos.append(ruta.name)
        lista = sorted({nombre_archivo(g) for g in por} | {p.name for p in archivos if p.exists()})
    else:
        ruta = carpeta / UNICO
        if escribir_si_cambia(ruta, render(tareas, "Tareas pendientes"), mtimes.get(ruta)):
            escritos.append(ruta.name)
        lista = [UNICO]

    pendientes_sin_id = any(not x[0] and not x[1] for p in archivos if p.exists() for x in leer(p))
    enviadas = sorted(ya_enviadas | {(n["title"], n["proyecto"] or "") for n in nuevas}) if pendientes_sin_id else []
    est = {"ids": {t["id"][:8]: t["id"] for t in tareas}, "titulos": {t["id"]: t["title"] for t in tareas}, "archivos": lista,
           "enviadas": enviadas, "ultima": time.strftime("%Y-%m-%d %H:%M:%S")}
    # Conserva los ids recién marcados por si el archivo no se pudo reescribir (para no recrearlos).
    for corto, completo in ids.items():
        est["ids"].setdefault(corto, completo)
    est_f.write_text(json.dumps(est, ensure_ascii=False, indent=1), encoding="utf-8")
    cam = r.get("cambios", {})
    if verbose and (any(cam.values()) or escritos):
        print(time.strftime("%H:%M"), f"hechas {cam.get('hechas', 0)} · renombradas {cam.get('renombradas', 0)} · nuevas {cam.get('nuevas', 0)} · escribí {', '.join(escritos) or 'nada'}", flush=True)
    return cam, escritos


# ---------- instalar la pasada automática ----------
def instalar(cada=120):
    py, script = sys.executable, str(Path(__file__).resolve())
    sistema = platform.system()
    if sistema == "Darwin":
        label = "cl.veredicto.carpeta"
        plist = Path.home() / "Library" / "LaunchAgents" / f"{label}.plist"
        log = Path.home() / "Library" / "Logs" / "veredicto-carpeta.log"
        plist.write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>{label}</string>
  <key>ProgramArguments</key><array><string>{py}</string><string>{script}</string></array>
  <key>StartInterval</key><integer>{cada}</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>{log}</string>
  <key>StandardErrorPath</key><string>{log}</string>
</dict></plist>
""", encoding="utf-8")
        uid = os.getuid()
        subprocess.run(["launchctl", "bootout", f"gui/{uid}/{label}"], capture_output=True)
        subprocess.run(["launchctl", "bootstrap", f"gui/{uid}", str(plist)], check=True)
        print(f"Listo: cada {cada} s con launchd. Registro: {log}")
    elif sistema == "Linux":
        d = Path.home() / ".config" / "systemd" / "user"
        d.mkdir(parents=True, exist_ok=True)
        (d / "veredicto-carpeta.service").write_text(f"[Unit]\nDescription=Veredicto: carpeta sincronizada\n\n[Service]\nType=oneshot\nExecStart={py} {script}\n", encoding="utf-8")
        (d / "veredicto-carpeta.timer").write_text(f"[Unit]\nDescription=Veredicto: carpeta cada {cada} s\n\n[Timer]\nOnBootSec=30\nOnUnitActiveSec={cada}\n\n[Install]\nWantedBy=timers.target\n", encoding="utf-8")
        subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
        subprocess.run(["systemctl", "--user", "enable", "--now", "veredicto-carpeta.timer"], check=True)
        print("Listo: systemd (usuario). Registro: journalctl --user -u veredicto-carpeta -f")
    elif sistema == "Windows":
        cmd = ["schtasks", "/Create", "/F", "/SC", "MINUTE", "/MO", str(max(1, cada // 60)), "/TN", "Veredicto carpeta", "/TR", f'"{py}" "{script}"']
        subprocess.run(cmd, check=True)
        print("Listo: Programador de tareas de Windows («Veredicto carpeta»).")
    else:
        sys.exit(f"No sé instalar en {sistema}: corre «{py} {script} --cada {cada}» al iniciar.")


def main():
    ap = argparse.ArgumentParser(description="Tus tareas pendientes de Veredicto en una carpeta local.")
    ap.add_argument("accion", nargs="?", choices=["sync", "configurar", "instalar"], default="sync")
    ap.add_argument("--url"); ap.add_argument("--token"); ap.add_argument("--carpeta")
    ap.add_argument("--por-proyecto", action="store_true", help="un .md por proyecto en vez de Pendientes.md")
    ap.add_argument("--cada", type=int, default=0, help="segundos entre pasadas (0 = una sola)")
    a = ap.parse_args()
    if a.accion == "configurar":
        if not (a.url and a.token and a.carpeta):
            sys.exit("configurar necesita --url, --token y --carpeta")
        CONFIG.parent.mkdir(parents=True, exist_ok=True)
        CONFIG.write_text(json.dumps({"url": a.url.rstrip("/"), "token": a.token, "carpeta": a.carpeta, "por_proyecto": a.por_proyecto}, indent=1), encoding="utf-8")
        try:
            os.chmod(CONFIG, 0o600)
        except OSError:
            pass
        c = leer_config()
        pasada(c)
        print(f"Configurado. Tus pendientes están en {Path(c['carpeta']) / ('' if a.por_proyecto else UNICO)}")
        return
    if a.accion == "instalar":
        leer_config()
        instalar(a.cada or 120)
        return
    c = leer_config()
    if a.por_proyecto:
        c["por_proyecto"] = True
    if not a.cada:
        pasada(c)
        return
    while True:
        try:
            pasada(c)
        except SystemExit as e:
            print(time.strftime("%H:%M"), e, file=sys.stderr, flush=True)
        time.sleep(max(10, a.cada))


if __name__ == "__main__":
    main()
