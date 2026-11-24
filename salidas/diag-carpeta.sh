#!/usr/bin/env bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")/../veredicto"
echo "python3 = $(command -v python3) $(python3 --version 2>&1)"
TEST_DATABASE_URL=postgresql://avia:avia@localhost:5432/veredicto_test RADICALE_URL=http://127.0.0.1:5232 \
  node --test --test-reporter=tap test/carpeta.test.js 2>&1 | grep -E "not ok|error:|Error|Traceback|File \"|stderr|SSL|urlopen|line [0-9]+" | head -25
