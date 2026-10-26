#!/usr/bin/env bash
# A migráció és az RLS-szabályok kipróbálása sima, helyi PostgreSQL-en (Supabase-projekt nélkül).
# A kapcsolatot a szokásos libpq-változók adják (PGHOST, PGPORT, PGUSER, PGPASSWORD).
# Használat: PGHOST=localhost PGUSER=postgres supabase/tests/run-local.sh
# Egy eldobható adatbázist hoz létre, és a végén törli.
set -euo pipefail
cd "$(dirname "$0")"
DB="atlag_rls_test_$$"
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT
args=(-f stub_supabase.sql)
for m in ../migrations/*.sql; do args+=(-f "$m"); done
args+=(-f rls_test.sql)
out=$(psql -d "$DB" -v ON_ERROR_STOP=1 -q -t "${args[@]}" 2>&1) || { echo "$out"; exit 1; }
echo "$out" | grep -E 'OK|HIBA|zöld' | sed -E 's/^psql:[^ ]+ //; s/NOTICE:  //'
