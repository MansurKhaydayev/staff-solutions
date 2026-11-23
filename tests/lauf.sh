#!/usr/bin/env bash
# Führt alle Tests aus, die ohne Datenbank laufen (Einheitstests und Browser-Tests).
# Die Datenbank-Tests (supabase/tests/*.sql) laufen über das Supabase-Werkzeug execute_sql.
set -euo pipefail
cd "$(dirname "$0")/.."
export NODE_PATH="${NODE_PATH:-$(npm root -g)}"
node --test tests/unit/*.test.mjs
for t in tests/ui/mock.js tests/ui/*.test.js; do
  [ -e "$t" ] || continue
  echo "== $t"; node "$t" app "${1:-/tmp/ui}"
done
