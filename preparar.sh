#!/usr/bin/env bash
# Deja el repo de Veredicto listo para que Hermes lo programe y pruebe en este Mac.
# Uso:  bash ~/atlas/proyectos/joaquin/veredicto/preparar.sh     (instala lo que falte y corre las pruebas)
#       bash ~/atlas/proyectos/joaquin/veredicto/probar.sh       (solo las pruebas, ~15 s)
# Idempotente. No toca el servidor ni guarda secretos.
set -uo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"; REPO="$AQUI/veredicto"
ok(){ printf '  \033[32m✔\033[0m %s\n' "$*"; }; mal(){ printf '  \033[31m✘\033[0m %s\n' "$*"; }; paso(){ printf '\n==> %s\n' "$*"; }
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

paso "1/5 Repo al día"
cd "$REPO" && git pull -q --ff-only && ok "$(git log --oneline -1)" || mal "git pull falló (¿cambios locales?)"

paso "2/5 Node 20+ y dependencias"
if ! node -e 'process.exit(+process.versions.node.split(".")[0] < 20)' 2>/dev/null; then
  command -v brew >/dev/null && brew install -q node || { mal "falta Node 20+ (brew install node)"; exit 1; }
fi
ok "Node $(node -v)"
npm ci --silent --no-audit --no-fund >/dev/null 2>&1 && ok "dependencias (npm ci)" || { mal "npm ci falló"; exit 1; }

paso "3/5 PostgreSQL de pruebas (localhost:5432, base veredicto_test)"
# Usa el Postgres de pruebas que deja finanzas/preparar.sh (usuario avia/avia); si no está, lo levanta igual que ese script.
pg_ok(){ node -e "const{Client}=require('pg');const c=new Client('postgresql://avia:avia@localhost:5432/postgres');c.connect().then(()=>c.end()).catch(()=>process.exit(1))" 2>/dev/null; }
if ! pg_ok; then
  if [ -x "$AQUI/../finanzas/preparar.sh" ]; then bash "$AQUI/../finanzas/preparar.sh" >/dev/null 2>&1 || true; fi
fi
if pg_ok; then
  node -e "const{Client}=require('pg');const c=new Client('postgresql://avia:avia@localhost:5432/postgres');(async()=>{await c.connect();const r=await c.query(\"select 1 from pg_database where datname='veredicto_test'\");if(!r.rowCount)await c.query('create database veredicto_test');await c.end()})().catch(e=>{console.error(e.message);process.exit(1)})" \
    && ok "base veredicto_test lista" || mal "no pude crear veredicto_test"
else mal "no hay PostgreSQL en localhost:5432 (corre finanzas/preparar.sh)"; fi

paso "4/5 Radicale (CalDAV de pruebas en 127.0.0.1:5232)"
PY=$(command -v python3.12 || command -v python3)
[ -x "$AQUI/.radicale/bin/radicale" ] || { "$PY" -m venv "$AQUI/.radicale" && "$AQUI/.radicale/bin/pip" install -q radicale; }
if ! curl -s -o /dev/null http://127.0.0.1:5232/; then
  mkdir -p "$HOME/.cache/veredicto-radicale"
  nohup "$AQUI/.radicale/bin/radicale" --storage-filesystem-folder="$HOME/.cache/veredicto-radicale" --auth-type=none \
    --server-hosts=127.0.0.1:5232 >/dev/null 2>&1 &
  sleep 2
fi
curl -s -o /dev/null http://127.0.0.1:5232/ && ok "Radicale corriendo" || mal "Radicale no responde"

paso "5/5 Pruebas y GitHub"
bash "$AQUI/probar.sh"
git -C "$REPO" ls-remote -q origin HEAD >/dev/null 2>&1 && ok "GitHub: lectura OK" || mal "GitHub: no puedo leer"
git -C "$REPO" push --dry-run -q origin HEAD:refs/heads/hermes-prueba-permiso >/dev/null 2>&1 && ok "GitHub: push OK" || mal "GitHub: sin permiso de push (gh auth login)"
printf '\nListo. Hermes trabaja en: %s\n' "$REPO"
