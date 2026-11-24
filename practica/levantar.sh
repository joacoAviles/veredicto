#!/usr/bin/env bash
# 1) Levanta un Veredicto de PRÁCTICA en http://127.0.0.1:8090 (base propia, no toca tu servidor real).
set -uo pipefail; . "$(dirname "$0")/comun.sh"
if curl -s "$URL/salud" | grep -q ok; then ok "ya estaba corriendo en $URL"; exit 0; fi
node -e "const{Client}=require('$REPO/node_modules/pg');const c=new Client('$DB_ADMIN');(async()=>{await c.connect();const r=await c.query(\"select 1 from pg_database where datname='veredicto_practica'\");if(!r.rowCount)await c.query('create database veredicto_practica');await c.end()})().catch(e=>{console.error(e.message);process.exit(1)})" \
  && ok "base veredicto_practica" || { mal "no hay PostgreSQL en localhost:5432 (corre ../preparar.sh)"; exit 1; }
mkdir -p "$PRACTICA/datos"
[ -f "$PRACTICA/datos/clave" ] || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" > "$PRACTICA/datos/clave"
cd "$REPO"
DATABASE_URL="$DB" PORT="$PUERTO" ADMIN_PASSWORD="$CLAVE_ADMIN" CLAVE_CIFRADO="$(cat "$PRACTICA/datos/clave")" \
  DATOS_DIR="$PRACTICA/datos" COOKIE_SEGURA=no URL_PUBLICA="$URL" NOMBRE="Veredicto práctica" \
  nohup node src/server.js > "$PRACTICA/servidor.log" 2>&1 &
echo $! > "$PRACTICA/servidor.pid"
for i in $(seq 30); do curl -s "$URL/salud" | grep -q ok && break; sleep 1; done
curl -s "$URL/salud" | grep -q ok && ok "Veredicto de práctica en $URL (clave: $CLAVE_ADMIN)" || { mal "no arrancó; mira practica/servidor.log"; tail -5 "$PRACTICA/servidor.log"; exit 1; }
