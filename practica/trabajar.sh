#!/usr/bin/env bash
# 3) El agente toma UNA tarea de la cola de la práctica y la hace con Hermes (modelo local).
#    Es lo mismo que launchd hará cada 2 minutos cuando lo instales «de verdad».
set -uo pipefail; . "$(dirname "$0")/comun.sh"
[ -f "$PRACTICA/datos/agente.env" ] || { mal "corre primero configurar.sh"; exit 1; }
set -a; . "$PRACTICA/datos/agente.env"; set +a
export VEREDICTO_PROYECTOS="$PRACTICA/proyectos.json" VEREDICTO_DUENO="Joaquín" VEREDICTO_MODELO="${MODELO_LOCAL:-atlas-qwen3.5:4b-64k}"
echo "Trabajando… (con el modelo local puede tardar 1 a 3 minutos)"
python3 "$REPO/integraciones/hermes/trabajador.py" local && ok "listo: mira la tarea en Infra → Tablero (Espera tu OK o Bloqueada)"
