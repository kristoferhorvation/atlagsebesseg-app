#!/bin/sh
# A webes apps/web/.env nyilvános kulcsaiból (VITE_MAPBOX_TOKEN, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
# elkészíti az apps/ios/Secrets.xcconfig-ot. Értéket nem ír ki a kimenetre; a cél gitignore-ban van.
set -eu
here="$(cd "$(dirname "$0")/.." && pwd)"
src="$here/../web/.env"
dst="$here/Secrets.xcconfig"
[ -f "$src" ] || { echo "nincs: $src" >&2; exit 1; }
val() { sed -n "s/^$1=//p" "$src" | tail -n 1 | sed 's/^"//; s/"$//'; }
umask 077
{
  echo "// GENERÁLT (scripts/secrets-from-web-env.sh) – gitignore-ban, ne commitold."
  echo "MAPBOX_ACCESS_TOKEN = $(val VITE_MAPBOX_TOKEN)"
  # az xcconfig-ban a // megjegyzés: https:// → https:/$()/
  echo "SUPABASE_URL = $(val VITE_SUPABASE_URL | sed 's#//#/$()/#')"
  echo "SUPABASE_ANON_KEY = $(val VITE_SUPABASE_ANON_KEY)"
} > "$dst"
for k in MAPBOX_ACCESS_TOKEN SUPABASE_URL SUPABASE_ANON_KEY; do
  if grep -q "^$k = .\+" "$dst"; then echo "$k: kitöltve"; else echo "$k: ÜRES"; fi
done
