#!/usr/bin/env bash
# Muestra la cola de agentes de la práctica y lo que hay en la carpeta de trabajo.
set -uo pipefail; . "$(dirname "$0")/comun.sh"
set -a; . "$PRACTICA/datos/agente.env"; set +a
curl -s -H "Authorization: Bearer $VEREDICTO_TOKEN" "$URL/api/agente/tareas?asignado=agente" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);for(const t of (r.tareas||r)) console.log(`- [${t.estado}] ${t.title}${t.resultado?"\n    resultado: "+t.resultado.split("\n").slice(0,6).join("\n    "):""}${t.nota?"\n    nota: "+t.nota:""}`)})'
echo; echo "Archivos en practica/espacio/salidas:"; (cd "$PRACTICA/espacio/salidas" && find . -mindepth 1 | sort)
