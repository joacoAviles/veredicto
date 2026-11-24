#!/usr/bin/env bash
# Apaga el Veredicto de práctica (los datos quedan; levantar.sh lo vuelve a encender).
. "$(dirname "$0")/comun.sh"
[ -f "$PRACTICA/servidor.pid" ] && kill "$(cat "$PRACTICA/servidor.pid")" 2>/dev/null && rm -f "$PRACTICA/servidor.pid" && ok "Veredicto de práctica apagado" || ok "no estaba corriendo"
