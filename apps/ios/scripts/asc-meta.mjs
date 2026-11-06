// AW25b: a NEM szöveges App Store-metaadat feltöltése (az asc.mjs `meta` parancsa). Beadás nincs; minden lépés külön próbálkozik, a hiba nem állítja meg a többit.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Kor-besorolás: nincs erőszak, szexuális tartalom, szerencsejáték, csevegés, reklám, korlátlan web. A bejelentés rögzített típus (szabad szöveg és kép nélkül). */
const AGE = {
  alcoholTobaccoOrDrugUseOrReferences: 'NONE',
  contests: 'NONE',
  gamblingSimulated: 'NONE',
  gunsOrOtherWeapons: 'NONE',
  horrorOrFearThemes: 'NONE',
  matureOrSuggestiveThemes: 'NONE',
  medicalOrTreatmentInformation: 'NONE',
  profanityOrCrudeHumor: 'NONE',
  sexualContentGraphicAndNudity: 'NONE',
  sexualContentOrNudity: 'NONE',
  violenceCartoonOrFantasy: 'NONE',
  violenceRealistic: 'NONE',
  violenceRealisticProlongedGraphicOrSadistic: 'NONE',
  gambling: false,
  lootBox: false,
  unrestrictedWebAccess: false,
  advertising: false,
  ageAssurance: false,
  healthOrWellnessTopics: false,
  messagingAndChat: false,
  parentalControls: false,
  userGeneratedContent: false,
  socialMedia: false,
};

export async function run({ api, get, context, TERRITORIES, LOCALES, SUPPORT_URL, PRIVACY_URL, ROOT }) {
  const { app, version, info } = await context();
  const done = [];
  const failed = [];
  const step = async (name, fn) => {
    try {
      const r = await fn();
      done.push(r ? `${name}: ${r}` : name);
      console.log(`✓ ${name}${r ? ` (${r})` : ''}`);
    } catch (e) {
      failed.push(`${name}: ${e.message}`);
      console.log(`✗ ${name}: ${e.message}`);
    }
  };

  await step('kategória Navigation / Travel', async () => {
    await api('PATCH', `/v1/appInfos/${info.id}`, {
      data: { type: 'appInfos', id: info.id, relationships: { primaryCategory: { data: { type: 'appCategories', id: 'NAVIGATION' } }, secondaryCategory: { data: { type: 'appCategories', id: 'TRAVEL' } } } },
    });
  });

  await step('kor-besorolás', async () => {
    const decl = await get(`/v1/appInfos/${info.id}/ageRatingDeclaration`);
    const known = Object.keys(decl.data.attributes);
    const attributes = Object.fromEntries(Object.entries(AGE).filter(([k]) => known.includes(k)));
    await api('PATCH', `/v1/ageRatingDeclarations/${decl.data.id}`, { data: { type: 'ageRatingDeclarations', id: decl.data.id, attributes } });
    return `${Object.keys(attributes).length} válasz`;
  });

  await step('ár: ingyenes', async () => {
    const sched = await get(`/v1/apps/${app.id}/appPriceSchedule?include=manualPrices,baseTerritory`).catch(() => null);
    const manual = sched?.included?.filter((x) => x.type === 'appPrices') ?? [];
    if (manual.length) {
      const pp = await get(`/v1/appPriceSchedules/${sched.data.id}/manualPrices?include=appPricePoint&limit=5`);
      const points = (pp.included ?? []).filter((x) => x.type === 'appPricePoints');
      if (points.length && points.every((x) => Number(x.attributes.customerPrice) === 0)) return 'már ingyenes';
    }
    const free = await get(`/v1/apps/${app.id}/appPricePoints?filter[territory]=USA&limit=200`);
    const zero = free.data.find((x) => Number(x.attributes.customerPrice) === 0);
    if (!zero) throw new Error('nincs 0-s árpont');
    await api('POST', '/v1/appPriceSchedules', {
      data: {
        type: 'appPriceSchedules',
        relationships: {
          app: { data: { type: 'apps', id: app.id } },
          baseTerritory: { data: { type: 'territories', id: 'USA' } },
          manualPrices: { data: [{ type: 'appPrices', id: '${free}' }] },
        },
      },
      included: [{ type: 'appPrices', id: '${free}', attributes: { startDate: null }, relationships: { appPricePoint: { data: { type: 'appPricePoints', id: zero.id } } } }],
    });
    return 'beállítva';
  });

  await step(`elérhetőség (${TERRITORIES.length} ország)`, async () => {
    const existing = await get(`/v1/apps/${app.id}/appAvailabilityV2`).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    if (existing) {
      // már van: az országonkénti elérhetőség módosítása tételesen
      const list = [];
      let next = `/v2/appAvailabilities/${existing.data.id}/territoryAvailabilities?include=territory&limit=200`;
      while (next) {
        const page = await get(next);
        list.push(...page.data);
        next = page.links?.next ?? null;
      }
      let changed = 0;
      for (const ta of list) {
        const want = TERRITORIES.includes(ta.relationships.territory.data.id);
        if (ta.attributes.available !== want) {
          await api('PATCH', `/v1/territoryAvailabilities/${ta.id}`, { data: { type: 'territoryAvailabilities', id: ta.id, attributes: { available: want } } });
          changed++;
        }
      }
      return `meglévő, ${changed} módosítás`;
    }
    // az API minden országot vár: a listán kívüliek `available: false`
    const all = [];
    let next = '/v1/territories?limit=200';
    while (next) {
      const page = await get(next);
      all.push(...page.data.map((t) => t.id));
      next = page.links?.next ?? null;
    }
    const missing = TERRITORIES.filter((t) => !all.includes(t));
    if (missing.length) throw new Error(`ismeretlen ország: ${missing.join(', ')}`);
    await api('POST', '/v2/appAvailabilities', {
      data: {
        type: 'appAvailabilities',
        attributes: { availableInNewTerritories: false },
        relationships: { app: { data: { type: 'apps', id: app.id } }, territoryAvailabilities: { data: all.map((t) => ({ type: 'territoryAvailabilities', id: `\${${t}}` })) } },
      },
      included: all.map((t) => ({ type: 'territoryAvailabilities', id: `\${${t}}`, attributes: { available: TERRITORIES.includes(t) }, relationships: { territory: { data: { type: 'territories', id: t } } } })),
    });
    return 'létrehozva';
  });

  await step('privacy URL (appInfo, meglévő lokalizációk)', async () => {
    const ail = await get(`/v1/appInfos/${info.id}/appInfoLocalizations`);
    for (const l of ail.data) await api('PATCH', `/v1/appInfoLocalizations/${l.id}`, { data: { type: 'appInfoLocalizations', id: l.id, attributes: { privacyPolicyUrl: PRIVACY_URL } } });
    return ail.data.map((l) => l.attributes.locale).join(', ');
  });

  if (!version) {
    failed.push('nincs szerkeszthető App Store-verzió: a verzió-szintű lépések kimaradtak');
  } else {
    await step('verzió-lokalizációk + support URL (szöveg nélkül)', async () => {
      const loc = await get(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
      const have = new Map(loc.data.map((l) => [l.attributes.locale, l]));
      const made = [];
      for (const locale of Object.values(LOCALES)) {
        const l = have.get(locale);
        if (l) await api('PATCH', `/v1/appStoreVersionLocalizations/${l.id}`, { data: { type: 'appStoreVersionLocalizations', id: l.id, attributes: { supportUrl: SUPPORT_URL } } });
        else {
          await api('POST', '/v1/appStoreVersionLocalizations', {
            data: { type: 'appStoreVersionLocalizations', attributes: { locale, supportUrl: SUPPORT_URL }, relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } } },
          });
          made.push(locale);
        }
      }
      return made.length ? `új: ${made.join(', ')}` : 'mind megvolt';
    });

    await step('review-jegyzet (demo-fiók nélkül)', async () => {
      const notes = readFileSync(join(ROOT, 'docs', 'store', 'review-notes.en.txt'), 'utf8').trim();
      const rd = await get(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`).catch(() => null);
      const attributes = { notes, demoAccountRequired: false };
      if (rd?.data && (rd.data.attributes.notes ?? '').trim() === notes) return 'változatlan';
      // a módosításhoz az ASC a kapcsolattartó adatait is kéri (Kristof tölti ki)
      if (rd?.data) await api('PATCH', `/v1/appStoreReviewDetails/${rd.data.id}`, { data: { type: 'appStoreReviewDetails', id: rd.data.id, attributes } });
      else await api('POST', '/v1/appStoreReviewDetails', { data: { type: 'appStoreReviewDetails', attributes, relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } } } });
      return `${notes.length} karakter`;
    });

    await step('advertising identifier: nem', async () => {
      await api('PATCH', `/v1/appStoreVersions/${version.id}`, { data: { type: 'appStoreVersions', id: version.id, attributes: { usesIdfa: false } } });
    });
  }

  console.log(`\nkész: ${done.length}, hiba: ${failed.length}`);
  for (const f of failed) console.log(`  – ${f}`);
  if (failed.length) process.exitCode = 1;
}
