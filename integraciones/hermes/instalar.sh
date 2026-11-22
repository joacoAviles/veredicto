#!/bin/bash
# Conecta Hermes Agent con Veredicto: servidor MCP, skills, hook de mensajería, trabajadores
# local/cloud (launchd en macOS, systemd en Linux), comando vd y rutinas. Se puede correr de nuevo sin romper nada.
#
#   MODELO_LOCAL=qwen3.5:9b-64k DUENO="Ana" bash instalar.sh
#
# Variables (todas opcionales salvo MODELO_LOCAL):
#   MODELO_LOCAL      modelo de Ollama para el carril local y las rutinas (obligatorio)
#   DUENO             tu nombre, como lo usarán las skills (por defecto: tu nombre de usuario)
#   CARPETA_TRABAJO   dónde dejan sus archivos los agentes (por defecto ~/Veredicto-agentes)
#   CANAL             adónde llegan el brief y los avisos (por defecto whatsapp; ej. telegram)
#   PROYECTOS         ruta a un proyectos.json: cada tarea corre en la carpeta de su proyecto (con su AGENTS.md)
#   CARRIL_CLOUD=no   no instala el trabajador cloud
#
# Antes: en Veredicto → Ajustes → Módulos, activa «Infraestructura»; luego Infra → Agentes y
# conexión → «Crear token», y pega las dos líneas en ~/.hermes/.env:
#   VEREDICTO_URL=https://veredicto.tudominio.cl     (o http://IP-del-servidor:8080 en tu red)
#   VEREDICTO_TOKEN=jdg_…
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
HH="${HERMES_HOME:-$HOME/.hermes}"
DEST="$HH/veredicto"
DUENO="${DUENO:-$(id -F 2>/dev/null || getent passwd "$USER" 2>/dev/null | cut -d: -f5 | cut -d, -f1 || true)}"; DUENO="${DUENO:-$USER}"
CARPETA_TRABAJO="${CARPETA_TRABAJO:-$HOME/Veredicto-agentes}"
CANAL="${CANAL:-whatsapp}"
HERMES_BIN="$(command -v hermes || true)"
PY="$(command -v python3 || true)"
SO="$(uname -s)"

[ -n "${MODELO_LOCAL:-}" ] || { echo "Falta MODELO_LOCAL (el modelo de Ollama con al menos 64K de contexto). Ej: MODELO_LOCAL=qwen3.5:9b-64k bash instalar.sh"; exit 1; }
[ -n "$HERMES_BIN" ] || { echo "No encuentro el comando hermes en el PATH."; exit 1; }
[ -n "$PY" ] || { echo "Falta python3."; exit 1; }
grep -q '^VEREDICTO_TOKEN=' "$HH/.env" 2>/dev/null || { echo "Falta VEREDICTO_URL y VEREDICTO_TOKEN en $HH/.env (créalo en Veredicto → Infra → Agentes y conexión)."; exit 1; }

poner() {  # copia una skill reemplazando {{DUENO}} y {{CARPETA_TRABAJO}}
  local origen="$1" destino="$2"
  rm -rf "$destino"; mkdir -p "$destino"
  sed -e "s|{{DUENO}}|$DUENO|g" -e "s|{{CARPETA_TRABAJO}}|$CARPETA_TRABAJO|g" "$origen/SKILL.md" > "$destino/SKILL.md"
}

echo "== 1. Archivos =="
mkdir -p "$DEST" "$HH/scripts" "$HH/hooks" "$HH/skills" "$HH/logs" "$CARPETA_TRABAJO"
cp "$AQUI/vd" "$AQUI/trabajador.py" "$AQUI/avisos.py" "$DEST/"
chmod +x "$DEST/vd" "$DEST/trabajador.py" "$DEST/avisos.py"
cp "$AQUI/avisos.py" "$HH/scripts/veredicto-avisos.py"      # los cron sin IA viven en scripts/
rm -rf "$HH/hooks/veredicto-whatsapp"; cp -R "$AQUI/hooks/veredicto-whatsapp" "$HH/hooks/"
poner "$AQUI/skills/veredicto" "$HH/skills/veredicto"
poner "$AQUI/skills/veredicto-trabajador" "$HH/skills/veredicto-trabajador"
BIN="$HOME/.local/bin"; mkdir -p "$BIN"
ln -sf "$DEST/vd" "$BIN/vd"
[[ ":$PATH:" == *":$BIN:"* ]] || echo "   Ojo: agrega $BIN a tu PATH para usar vd en la terminal."
"$DEST/vd" contexto >/dev/null && echo "   vd conectado con Veredicto ✓"

echo "== 2. Servidor MCP «veredicto» (agenda, tareas y cola de agentes) =="
CFG="$HH/config.yaml"
if grep -qE '^[[:space:]]+veredicto:' "$CFG" 2>/dev/null; then
  echo "   Ya estaba en $CFG"
elif ! grep -q '^mcp_servers:' "$CFG" 2>/dev/null; then
  printf '\nmcp_servers:\n  veredicto:\n    url: "${VEREDICTO_URL}/mcp"\n    headers:\n      Authorization: "Bearer ${VEREDICTO_TOKEN}"\n' >> "$CFG"
  echo "   Agregado a $CFG ✓"
else
  echo "   Ya tienes mcp_servers en $CFG: agrega a mano, dentro de ese bloque:"
  printf '     veredicto:\n       url: "${VEREDICTO_URL}/mcp"\n       headers:\n         Authorization: "Bearer ${VEREDICTO_TOKEN}"\n'
fi

echo "== 3. Perfiles de trabajo =="
CARRILES="local"; [ "${CARRIL_CLOUD:-si}" = "no" ] || CARRILES="local cloud"
for c in $CARRILES; do
  "$HERMES_BIN" profile create "worker-$c" >/dev/null 2>&1 || true
  poner "$AQUI/skills/veredicto-trabajador" "$HH/profiles/worker-$c/skills/veredicto-trabajador"
done
echo "   La primera vez: hermes -p worker-local model   → Custom endpoint http://localhost:11434/v1, modelo $MODELO_LOCAL"
[[ "$CARRILES" == *cloud* ]] && echo "                   hermes -p worker-cloud model   → el proveedor pago que uses"

echo "== 4. Trabajadores (cada 2 min; Veredicto decide si toca esperar) =="
for c in $CARRILES; do
  MOD="$([ "$c" = local ] && echo "$MODELO_LOCAL" || echo cloud)"
  if [ "$SO" = Darwin ]; then
    L="cl.veredicto.trabajador-$c"; P="$HOME/Library/LaunchAgents/$L.plist"
    cat > "$P" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$L</string>
  <key>ProgramArguments</key><array><string>$PY</string><string>$DEST/trabajador.py</string><string>$c</string></array>
  <key>StartInterval</key><integer>120</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$PATH</string>
    <key>HERMES_HOME</key><string>$HH</string>
    <key>HERMES_BIN</key><string>$HERMES_BIN</string>
    <key>VEREDICTO_MODELO</key><string>$MOD</string>
    <key>VEREDICTO_DUENO</key><string>$DUENO</string>
    <key>VEREDICTO_CARPETA_TRABAJO</key><string>$CARPETA_TRABAJO</string>
    <key>VEREDICTO_PROYECTOS</key><string>${PROYECTOS:-}</string>
  </dict>
  <key>StandardOutPath</key><string>$HH/logs/veredicto-$c.log</string>
  <key>StandardErrorPath</key><string>$HH/logs/veredicto-$c.log</string>
</dict></plist>
PLIST
    launchctl bootout "gui/$(id -u)/$L" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$P"
  else
    D="$HOME/.config/systemd/user"; mkdir -p "$D"
    cat > "$D/veredicto-trabajador-$c.service" <<UNIT
[Unit]
Description=Veredicto: trabajador $c

[Service]
Type=oneshot
Environment=PATH=$PATH
Environment=HERMES_HOME=$HH
Environment=HERMES_BIN=$HERMES_BIN
Environment=VEREDICTO_MODELO=$MOD
Environment=VEREDICTO_DUENO=$DUENO
Environment=VEREDICTO_CARPETA_TRABAJO=$CARPETA_TRABAJO
Environment=VEREDICTO_PROYECTOS=${PROYECTOS:-}
ExecStart=$PY $DEST/trabajador.py $c
StandardOutput=append:$HH/logs/veredicto-$c.log
StandardError=append:$HH/logs/veredicto-$c.log
UNIT
    cat > "$D/veredicto-trabajador-$c.timer" <<UNIT
[Unit]
Description=Veredicto: trabajador $c cada 2 min

[Timer]
OnBootSec=60
OnUnitInactiveSec=120

[Install]
WantedBy=timers.target
UNIT
    systemctl --user daemon-reload
    systemctl --user enable --now "veredicto-trabajador-$c.timer" >/dev/null
  fi
  echo "   trabajador $c ✓  (registro: $HH/logs/veredicto-$c.log)"
done

echo "== 5. Rutinas de Hermes =="
existe() { "$HERMES_BIN" cron list 2>/dev/null | grep -q "$1"; }
TZ_LOCAL="$(readlink /etc/localtime 2>/dev/null | sed 's|.*/zoneinfo/||')"; TZ_LOCAL="${TZ_LOCAL:-UTC}"
existe "veredicto-brief" || "$HERMES_BIN" cron create "every 1d at 07:30" --name veredicto-brief \
  --provider ollama --model "$MODELO_LOCAL" --timezone "$TZ_LOCAL" --skill veredicto --deliver "$CANAL" \
  "Haz el brief diario de la skill veredicto."
existe "veredicto-avisos" || "$HERMES_BIN" cron create "every 10m" --name veredicto-avisos \
  --no-agent --script veredicto-avisos.py --deliver "$CANAL"
"$HERMES_BIN" cron list 2>/dev/null | grep -i veredicto || true

echo "== 6. Gateway =="
"$HERMES_BIN" gateway install >/dev/null 2>&1 || true   # vuelve a capturar el PATH (para vd)
"$HERMES_BIN" gateway restart || true
cat <<FIN

Listo. Te queda:
  1. Activar la skill «veredicto» en el perfil que atiende tus mensajes (hermes skills).
  2. Mandar /sethome en tu chat de $CANAL para que el brief y los avisos lleguen ahí.
  3. Probar: «qué tengo hoy» · «delega: resumir los correos de clientes de esta semana».
El tablero está en Veredicto → Infra.
FIN
