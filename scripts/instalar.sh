#!/usr/bin/env sh
# Instalador de Veredicto. Uso:
#   curl -fsSL https://github.com/joacoAviles/veredicto/releases/latest/download/instalar.sh | sh
# Crea ./veredicto con compose.yaml, .env (contraseñas al azar) y la carpeta datos/.
set -eu
REPO="joacoAviles/veredicto"
DIR="${VEREDICTO_DIR:-veredicto}"
URL="https://github.com/$REPO/releases/latest/download"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Falta $1. Instálalo y vuelve a correr."; exit 1; }; }
need docker; need curl
docker compose version >/dev/null 2>&1 || { echo "Falta Docker Compose v2 (docker compose)."; exit 1; }

mkdir -p "$DIR" && cd "$DIR"
[ -f compose.yaml ] && echo "Ya existe compose.yaml: lo actualizo." 
curl -fsSL "$URL/compose.yaml" -o compose.yaml
curl -fsSL "$URL/restaurar.sh" -o restaurar.sh && chmod +x restaurar.sh
if [ ! -f .env ]; then
  curl -fsSL "$URL/example.env" -o .env
  rnd() { head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
  sed -i.bak "s|^DB_PASSWORD=.*|DB_PASSWORD=$(rnd 32)|; s|^CLAVE_CIFRADO=.*|CLAVE_CIFRADO=$(rnd 44)|; s|^PUID=.*|PUID=$(id -u)|; s|^PGID=.*|PGID=$(id -g)|" .env && rm -f .env.bak
  printf "Dirección pública con https (Enter para dejarlo para después): "
  read -r pub </dev/tty || pub=""
  [ -n "$pub" ] && sed -i.bak "s|^URL_PUBLICA=.*|URL_PUBLICA=$pub|" .env && rm -f .env.bak
  chmod 600 .env
fi
mkdir -p datos/db datos/tema datos/notas datos/respaldos datos/clave
docker compose pull
docker compose up -d
echo
echo "Listo. Abre http://localhost:$(grep -E '^PUERTO=' .env | cut -d= -f2) y pega el código de instalación:"
sleep 5
docker compose logs app 2>/dev/null | grep -A2 "Código de instalación" || echo "  docker compose logs app   (búscalo ahí en unos segundos)"
echo
echo "Guarda una copia de .env: sin la CLAVE_CIFRADO no se pueden leer tus cuentas conectadas."
