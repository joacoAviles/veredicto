#!/usr/bin/env sh
# Restaura un respaldo: ./restaurar.sh datos/respaldos/veredicto-2026-11-16.sql.gz
set -eu
f="${1:?Indica el archivo de respaldo (.sql.gz)}"
[ -f "$f" ] || { echo "No existe $f"; exit 1; }
echo "Esto REEMPLAZA la base actual con $f. Escribe SI para seguir:"; read -r ok </dev/tty
[ "$ok" = "SI" ] || exit 1
docker compose stop app
docker compose exec -T db psql -U veredicto -d postgres -c "DROP DATABASE IF EXISTS veredicto WITH (FORCE)" -c "CREATE DATABASE veredicto OWNER veredicto"
gunzip -c "$f" | docker compose exec -T db psql -U veredicto -d veredicto -q
docker compose start app
echo "Restaurado."
