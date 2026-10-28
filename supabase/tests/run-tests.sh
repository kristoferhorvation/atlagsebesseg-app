#!/usr/bin/env bash
# A tesztfájlok futtatása egy (már migrált) adatbázison, mindegyik saját tranzakcióban,
# a végén ROLLBACK – élő adatbázison sem hagy nyomot.
# Használat: tests/run-tests.sh <kapcsolati sztring>
set -euo pipefail
cd "$(dirname "$0")"
conn="$1"
fail=0
for t in rls_test.sql temp_gate_test.sql cameras_test.sql; do
  out=$(psql "$conn" -v ON_ERROR_STOP=1 -q -t -c 'begin' -f "$t" -c 'rollback' 2>&1) || { echo "$out" | tail -5; fail=1; }
  echo "$out" | grep -E '^(psql:[^ ]+ )?(NOTICE:  )?OK |zöld' | sed -E 's/^psql:[^ ]+ //; s/NOTICE:  //'
done
exit $fail
