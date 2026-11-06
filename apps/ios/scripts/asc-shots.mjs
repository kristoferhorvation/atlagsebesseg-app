// AW25b: képernyőképek feltöltése az App Store Connectbe (az asc.mjs `shots` parancsa): <mappa>/<locale>/*.png → APP_IPHONE_67 (6,9").
// Lokalizációnként a meglévő képsor képeit törli és sorrendben újratölti (ez a kör saját képei – szöveges metaadathoz nem nyúl).
const DISPLAY = 'APP_IPHONE_67';

export async function run({ api, get, context, LOCALES, dir, readdirSync, readFileSync, statSync, createHash, join }) {
  if (!dir) throw new Error('használat: node scripts/asc.mjs shots <mappa>');
  const { version } = await context();
  if (!version) throw new Error('nincs szerkeszthető App Store-verzió');
  const loc = await get(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
  let total = 0;
  const failed = [];
  for (const locale of Object.values(LOCALES)) {
    const l = loc.data.find((x) => x.attributes.locale === locale);
    let files = [];
    try {
      files = readdirSync(join(dir, locale)).filter((f) => f.endsWith('.png')).sort();
    } catch {
      // nincs mappa
    }
    if (!l || !files.length) {
      failed.push(`${locale}: ${!l ? 'nincs verzió-lokalizáció' : 'nincs kép'}`);
      continue;
    }
    try {
      const sets = await get(`/v1/appStoreVersionLocalizations/${l.id}/appScreenshotSets?include=appScreenshots`);
      let set = sets.data.find((s) => s.attributes.screenshotDisplayType === DISPLAY);
      if (set) {
        for (const s of set.relationships.appScreenshots.data) await api('DELETE', `/v1/appScreenshots/${s.id}`);
      } else {
        set = (await api('POST', '/v1/appScreenshotSets', { data: { type: 'appScreenshotSets', attributes: { screenshotDisplayType: DISPLAY }, relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: l.id } } } } })).data;
      }
      for (const f of files) {
        const path = join(dir, locale, f);
        const bytes = readFileSync(path);
        const shot = (await api('POST', '/v1/appScreenshots', { data: { type: 'appScreenshots', attributes: { fileName: f, fileSize: statSync(path).size }, relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } } } })).data;
        for (const op of shot.attributes.uploadOperations) {
          const headers = Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value]));
          const r = await fetch(op.url, { method: op.method, headers, body: bytes.subarray(op.offset, op.offset + op.length) });
          if (!r.ok) throw new Error(`${f}: feltöltés HTTP ${r.status}`);
        }
        await api('PATCH', `/v1/appScreenshots/${shot.id}`, { data: { type: 'appScreenshots', id: shot.id, attributes: { uploaded: true, sourceFileChecksum: createHash('md5').update(bytes).digest('hex') } } });
        total++;
      }
      console.log(`✓ ${locale}: ${files.length} kép`);
    } catch (e) {
      failed.push(`${locale}: ${e.message}`);
      console.log(`✗ ${locale}: ${e.message}`);
    }
  }
  // az Apple a feltöltés után feldolgozza a képeket: az állapotot visszaolvassuk
  await new Promise((ok) => setTimeout(ok, 20_000));
  for (const l of loc.data) {
    const sets = await get(`/v1/appStoreVersionLocalizations/${l.id}/appScreenshotSets?include=appScreenshots`);
    const states = (sets.included ?? []).filter((x) => x.type === 'appScreenshots').map((x) => x.attributes.assetDeliveryState?.state ?? '?');
    const count = states.reduce((m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {});
    console.log(`  ${l.attributes.locale}: ${JSON.stringify(count)}`);
  }
  console.log(`\nfeltöltve: ${total} kép, hiba: ${failed.length}`);
  for (const f of failed) console.log(`  – ${f}`);
  if (failed.length) process.exitCode = 1;
}
