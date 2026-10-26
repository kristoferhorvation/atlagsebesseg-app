#!/usr/bin/env bash
# Migráció és tesztek az ÉLŐ Supabase-adatbázison.
#   SUPABASE_DB_URL a gyökér .env-ben (soha ne commitold).
# 1. supabase db push – a még nem alkalmazott migrációk
# 2. a tesztek tranzakcióban, ROLLBACK-kel (az élő adatokat nem módosítják)
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${SUPABASE_DB_URL:?Hiányzik a SUPABASE_DB_URL (lásd .env.example)}"
npx supabase db push --db-url "$SUPABASE_DB_URL"
supabase/tests/run-tests.sh "$SUPABASE_DB_URL"
