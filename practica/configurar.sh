#!/usr/bin/env bash
# 2) Deja la práctica lista: Infraestructura encendida, proyecto «Práctica agentes», token de agente
#    y el perfil worker-local de Hermes con su skill. Idempotente.
set -uo pipefail; . "$(dirname "$0")/comun.sh"
JAR="$PRACTICA/datos/cookie"; c(){ curl -s -b "$JAR" -c "$JAR" -H 'content-type: application/json' "$@"; }
c -X POST "$URL/api/entrar" -d "{\"password\":\"$CLAVE_ADMIN\"}" | grep -q ok && ok "sesión iniciada" || { mal "no pude entrar (¿corriste levantar.sh?)"; exit 1; }
c -X PUT "$URL/api/modulos" -d '{"infra":true}' >/dev/null && ok "Infraestructura encendida"
if c "$URL/api/proyectos" | grep -q '"Práctica agentes"'; then ok "proyecto «Práctica agentes» ya existe"
else c -X POST "$URL/api/proyectos" -d '{"nombre":"Práctica agentes","notas":"Tareas de prueba para aprender el flujo con Hermes."}' >/dev/null && ok "proyecto «Práctica agentes» creado"; fi
if [ -f "$PRACTICA/datos/agente.env" ]; then ok "token de agente ya creado"
else
  T=$(c -X POST "$URL/api/tokens" -d '{"label":"Hermes práctica","alcance":"agente"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).token||""))')
  [ -n "$T" ] || { mal "no pude crear el token"; exit 1; }
  umask 077; printf 'VEREDICTO_URL=%s\nVEREDICTO_TOKEN=%s\n' "$URL" "$T" > "$PRACTICA/datos/agente.env"; ok "token de agente guardado en practica/datos/agente.env"
fi
# La tarea corre dentro de practica/espacio (con su propio AGENTS.md), no en tus proyectos reales.
printf '{"proyectos":[{"nombre":"Práctica agentes","ruta":"espacio"}]}\n' > "$PRACTICA/proyectos.json"
mkdir -p "$PRACTICA/espacio/salidas"
# Perfil de Hermes para el carril local (modelo de Ollama) y la skill del trabajador.
if command -v hermes >/dev/null; then
  hermes profile create worker-local >/dev/null 2>&1 || true
  hermes -p worker-local config set model.provider custom >/dev/null 2>&1
  hermes -p worker-local config set model.base_url http://localhost:11434/v1 >/dev/null 2>&1
  hermes -p worker-local config set model.default "${MODELO_LOCAL:-atlas-qwen3.5:4b-64k}" >/dev/null 2>&1
  hermes -p worker-local config set approvals.mode smart >/dev/null 2>&1
  S="$HOME/.hermes/profiles/worker-local/skills/veredicto-trabajador"; mkdir -p "$S"
  sed -e "s|{{DUENO}}|Joaquín|g" -e "s|{{CARPETA_TRABAJO}}|$PRACTICA/espacio/salidas|g" "$REPO/integraciones/hermes/skills/veredicto-trabajador/SKILL.md" > "$S/SKILL.md"
  ok "perfil worker-local de Hermes listo (modelo ${MODELO_LOCAL:-atlas-qwen3.5:4b-64k})"
else mal "no encuentro el comando hermes"; fi
echo; echo "Abre $URL en tu navegador (clave: $CLAVE_ADMIN) → pestaña Infra."
