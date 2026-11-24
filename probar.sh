#!/usr/bin/env bash
# Corre todas las pruebas de Veredicto contra PostgreSQL y Radicale locales (los deja preparar.sh). ~15 s.
AQUI="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! curl -s -o /dev/null http://127.0.0.1:5232/ && [ -x "$AQUI/.radicale/bin/radicale" ]; then
  mkdir -p "$HOME/.cache/veredicto-radicale"
  nohup "$AQUI/.radicale/bin/radicale" --storage-filesystem-folder="$HOME/.cache/veredicto-radicale" --auth-type=none \
    --server-hosts=127.0.0.1:5232 >/dev/null 2>&1 &
  sleep 2
fi
cd "$AQUI/veredicto" || exit 1
# Reporter TAP explícito: con Node 23+ el formato por defecto cambia y el resumen no saldría.
TEST_DATABASE_URL=postgresql://avia:avia@localhost:5432/veredicto_test RADICALE_URL=http://127.0.0.1:5232 \
  node --test --test-concurrency=1 --test-reporter=tap test/*.test.js 2>&1 | tee "$AQUI/salidas/ultima-prueba.tap" | grep -E "^# (tests|pass|fail|skipped)|^not ok" | head -20
