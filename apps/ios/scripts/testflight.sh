#!/bin/sh
# AOS16: TestFlight-build – build-szám növelése, archive (Release, generic iOS), export és feltöltés az App Store Connectbe.
#   npm run ios:testflight                 az Xcode-ban bejelentkezett Apple ID-val
#   ASC_KEY_ID + ASC_ISSUER_ID a Secrets.xcconfigban (vagy környezeti változóként) -> API-kulccsal, Xcode-bejelentkezés nélkül
#                                          (a kulcs: ASC_KEY_PATH, alapból apps/ios/secrets/AuthKey_<ID>.p8, utána ~/.appstoreconnect/private_keys/)
#   npm run ios:testflight -- --no-upload  archive + helyi export, feltöltés és build-szám növelés nélkül (próba)
set -eu
here="$(cd "$(dirname "$0")/.." && pwd)"
cd "$here"

upload=1
[ "${1:-}" = "--no-upload" ] && upload=0

team="$(sed -n 's/^DEVELOPMENT_TEAM = *//p' Secrets.xcconfig 2>/dev/null | tail -n 1)"
if [ -z "$team" ]; then
  echo "Hiányzik a DEVELOPMENT_TEAM az apps/ios/Secrets.xcconfig-ból (minta: Secrets.example.xcconfig)." >&2
  exit 1
fi

# hitelesítés (az exporthoz): API-kulcs, ha meg van adva (környezet vagy Secrets.xcconfig), különben az Xcode fiókja
ASC_KEY_ID="${ASC_KEY_ID:-$(sed -n 's/^ASC_KEY_ID = *//p' Secrets.xcconfig 2>/dev/null | tail -n 1)}"
ASC_ISSUER_ID="${ASC_ISSUER_ID:-$(sed -n 's/^ASC_ISSUER_ID = *//p' Secrets.xcconfig 2>/dev/null | tail -n 1)}"
set -- -allowProvisioningUpdates
if [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ]; then
  key="${ASC_KEY_PATH:-$here/secrets/AuthKey_$ASC_KEY_ID.p8}"
  [ -f "$key" ] || key="$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8"
  [ -f "$key" ] || { echo "Nincs meg az API-kulcs: $key" >&2; exit 1; }
  set -- "$@" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID" -authenticationKeyPath "$key"
  echo "Hitelesítés: App Store Connect API-kulcs"
else
  echo "Hitelesítés: az Xcode bejelentkezett Apple ID-ja"
fi

# a build-szám a project.yml-ben él (egy hely, mindkét target); feltöltésnél nő, a sikeres kör után commitold
current="$(sed -n 's/^    CURRENT_PROJECT_VERSION: "\([0-9]*\)"$/\1/p' project.yml)"
[ -n "$current" ] || { echo "Nincs CURRENT_PROJECT_VERSION a project.yml-ben." >&2; exit 1; }
build="$current"
if [ "$upload" = 1 ]; then
  build=$((current + 1))
  sed -i '' "s/^    CURRENT_PROJECT_VERSION: \"$current\"$/    CURRENT_PROJECT_VERSION: \"$build\"/" project.yml
fi
version="$(sed -n 's/^    MARKETING_VERSION: "\(.*\)"$/\1/p' project.yml)"
echo "Verzió: $version ($build)"

# sikertelen körben a build-szám visszaáll (nem került fel semmi)
restore() {
  [ "$build" = "$current" ] || { sed -i '' "s/^    CURRENT_PROJECT_VERSION: \"$build\"$/    CURRENT_PROJECT_VERSION: \"$current\"/" project.yml; xcodegen generate --quiet; }
}

xcodegen generate --quiet

out="build/testflight/$version-$build"
rm -rf "$out"
mkdir -p "$out"
archive="$out/Atlagsebesseg.xcarchive"

# Aláírás nélkül archiválunk, a végleges aláírást a disztribúciós profillal az export adja: az automatikus aláírás archive-kor
# fejlesztői profilt kérne, ahhoz regisztrált eszköz kellene (a TestFlighthoz nem kell). Az entitlementeket az export a meglévő
# aláírásból olvassa, ezért az archive után ad-hoc aláírással kerülnek vissza.
xcodebuild archive \
  -project Atlagsebesseg.xcodeproj \
  -scheme Atlagsebesseg \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$archive" \
  -derivedDataPath build/dd-release \
  CODE_SIGNING_ALLOWED=NO \
  > "$out/archive.log" 2>&1 || { restore; tail -n 40 "$out/archive.log" >&2; echo "Az archive nem sikerült: $here/$out/archive.log" >&2; exit 1; }
app="$archive/Products/Applications/Atlagsebesseg.app"
codesign --force --sign - --entitlements AtlagsebessegWidget/AtlagsebessegWidget.entitlements "$app/PlugIns/AtlagsebessegWidget.appex"
codesign --force --sign - --entitlements Atlagsebesseg/Atlagsebesseg.entitlements "$app"
echo "Archive kész: $archive"

destination=export
[ "$upload" = 1 ] && destination=upload
cat > "$out/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$destination</string>
  <key>teamID</key><string>$team</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST

xcodebuild -exportArchive \
  -archivePath "$archive" \
  -exportOptionsPlist "$out/ExportOptions.plist" \
  -exportPath "$out/export" \
  "$@" > "$out/export.log" 2>&1 || {
  restore
  tail -n 40 "$out/export.log" >&2
  if grep -q "App Store Connect Credentials Error" "$out/export.log"; then
    echo "Az Apple ID-hoz nincs használható App Store Connect-hozzáférés: lépj be az appstoreconnect.apple.com-ra, fogadd el a feltételeket, és hozd létre az app-rekordot (apps/ios/README.md › TestFlight)." >&2
  fi
  echo "Az export / feltöltés nem sikerült: $here/$out/export.log" >&2
  exit 1
}

if [ "$upload" = 1 ]; then
  echo "Feltöltve: $version ($build). A feldolgozás az App Store Connectben pár perc – utána jelenik meg a TestFlightban."
else
  echo "Helyi export kész (feltöltés nélkül): $here/$out/export"
fi
