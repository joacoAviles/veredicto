# Variables comunes de la práctica (las cargan los demás scripts).
PRACTICA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$PRACTICA/../veredicto" && pwd)"
PUERTO="${PUERTO:-8090}"
URL="http://127.0.0.1:$PUERTO"
DB_ADMIN="${DB_ADMIN:-postgresql://avia:avia@localhost:5432/postgres}"
DB="${DB_ADMIN%/*}/veredicto_practica"
CLAVE_ADMIN="practica-local"   # solo para este Veredicto de práctica, que escucha en 127.0.0.1
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
ok(){ printf '  \033[32m✔\033[0m %s\n' "$*"; }; mal(){ printf '  \033[31m✘\033[0m %s\n' "$*"; }
