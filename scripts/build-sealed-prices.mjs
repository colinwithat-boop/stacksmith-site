// Builds sealed/prices.json: what sealed products sell for, for the
// Stacksmith app's Packs tab, beside what the cards inside are worth, in
// the market of the phone's price source (the owner, 2026-10-06: local
// prices where possible):
//  - `usd`: TCGplayer's Market price in dollars, by TCGplayer product id,
//    for phones on a TCGplayer price (Market, Low, Mid). From tcgcsv.com, a
//    one-person free mirror of TCGplayer's price files: one file per
//    TCGplayer group (roughly a set), sealed products included.
//  - `eur`: Cardmarket's trend price in euros, by Cardmarket product id,
//    for phones on Cardmarket. From Cardmarket's own price guide, a public
//    daily download "available to all of our users" (news.cardmarket.com,
//    sealed products since its non-singles were added). Trend, because
//    the cards' euro prices are Cardmarket's trend too (Scryfall's `eur`,
//    checked on Duskmourn's mythics 2026-10-06: equal to the trend or a
//    day behind it), so a box and its cards are priced the same way. A
//    sealed product's Cardmarket price covers every language of it.
// The product ids come from MTGJSON (each product's tcgplayerProductId and
// mcmId, in the committed sealed/sets/set-*.json). Every year's products are
// priced (the owner, 2026-10-06: the app can load every set). `since`, the
// first day of the last CURRENT_YEARS, is in the file: the app's Packs tab
// calls those products current and ranks them.
//
// Asked as little as can be: tcgcsv one request started every 250 ms as
// its FAQ asks, with an identifying User-Agent, and not at all when it has
// not published since the live file was built (its last-updated.txt). Of
// its groups, the current sets' are asked every day it publishes; an older
// set's sealed prices move slowly, so its group is asked one day in
// ROTATION_DAYS (by group id), or sooner when the file has no refresh of it
// within ROTATION_DAYS + 1 days (a first run asks every group once). That is
// ~50 requests a day and ~40 more, against ~330 every day. `refreshed` in
// the file says when each group was last asked. Cardmarket's 26 MB guide,
// which holds every product, only when its ETag moved (a HEAD request
// first). Otherwise the live file's prices are republished. A tcgcsv group
// that fails keeps the live file's prices for its products.
//
//   node scripts/build-sealed-prices.mjs [--out _site/sealed/prices.json]
//
// The prices workflow runs it (optional: the app shows no online price
// without the file).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const i = args.indexOf('--out');
const OUT = path.resolve(ROOT, i >= 0 ? args[i + 1] : '_site/sealed/prices.json');
const SETS_DIR = path.join(ROOT, 'sealed', 'sets');
const SITE_URL = process.env.SITE_URL || 'https://stacksmith-app.pages.dev/';
const UA = 'Stacksmith sealed prices (https://stacksmith-app.pages.dev/; stackscanapp@gmail.com)';
const TCGCSV = 'https://tcgcsv.com/tcgplayer/1/';
const CARDMARKET_GUIDE = 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_1.json';
const CURRENT_YEARS = 3;
const ROTATION_DAYS = 7;
const SPACING_MS = 250;
const DAY_MS = 24 * 60 * 60 * 1000;

const now = Date.now();
const since = new Date(now);
since.setUTCFullYear(since.getUTCFullYear() - CURRENT_YEARS);
const SINCE = since.toISOString().slice(0, 10);
const TODAY = new Date(now).toISOString().slice(0, 10);

// Which TCGplayer groups and products, and which Cardmarket products, are
// wanted: every product of every set. A group is current when one of its
// products is from the last CURRENT_YEARS.
const wantedTcg = new Map();
const currentGroups = new Set();
const wantedMcm = new Set();
for (const name of fs.readdirSync(SETS_DIR).sort()) {
  const set = JSON.parse(fs.readFileSync(path.join(SETS_DIR, name), 'utf8'));
  for (const p of set.products) if (p.mcm) wantedMcm.add(p.mcm);
  if (!set.group) continue;
  const group = String(set.group);
  for (const p of set.products) {
    if (!p.tcg) continue;
    if (!wantedTcg.has(group)) wantedTcg.set(group, new Set());
    wantedTcg.get(group).add(p.tcg);
    if ((p.date ?? set.date ?? '') >= SINCE) currentGroups.add(group);
  }
}
const groups = [...wantedTcg.keys()].sort((a, b) => Number(a) - Number(b));
const wantedTcgIds = new Set([...wantedTcg.values()].flatMap((ids) => [...ids]));
console.log(`${groups.length} TCGplayer groups (${currentGroups.size} current), ${wantedTcgIds.size} TCGplayer and ${wantedMcm.size} Cardmarket products; current since ${SINCE}`);

async function get(url, { tries = 3, okMissing = false, method = 'GET' } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { method, headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(180_000) });
      if (okMissing && res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status} for ${url}`);
      return res;
    } catch (e) {
      if (attempt >= tries) throw e;
      await new Promise((r) => setTimeout(r, 5_000 * attempt));
    }
  }
}

// The live file, whose prices are kept for whatever is not asked again.
let live = null;
try {
  const res = await get(`${SITE_URL}sealed/prices.json`, { okMissing: true });
  live = res ? await res.json() : null;
  if (live && (live.v !== 2 || typeof live.usd !== 'object' || typeof live.eur !== 'object')) live = null;
} catch (e) {
  console.warn(`::warning::The live sealed prices could not be read: ${e instanceof Error ? e.message : e}`);
  live = null;
}

const pick = (prices, ids) => Object.fromEntries(Object.entries(prices ?? {}).filter(([id]) => ids.has(id)));

// ---- TCGplayer, through tcgcsv
const tcgcsv = (await (await get('https://tcgcsv.com/last-updated.txt')).text()).trim();
// Start from the live file's prices: a group not asked today keeps them.
const usd = pick(live?.usd, wantedTcgIds);
const refreshed = pick(live?.refreshed, new Set(groups));
let tcgFailed = 0;
let asked = [];
if (live && live.tcgcsv === tcgcsv && live.refreshed && typeof live.refreshed === 'object') {
  // tcgcsv has not published since: its prices are kept, but a group the
  // live file never asked (a set added since) is asked now (review, 2026-10-06).
  asked = groups.filter((g) => !refreshed[g]);
  console.log(`tcgcsv has not published since ${tcgcsv}: its prices are kept${asked.length ? `, ${asked.length} new groups asked` : ''}.`);
} else {
  const day = Math.floor(now / DAY_MS);
  const due = (g) => {
    const last = refreshed[g];
    return !last || now - Date.parse(`${last}T00:00:00Z`) >= (ROTATION_DAYS + 1) * DAY_MS;
  };
  asked = groups.filter((g) => currentGroups.has(g) || Number(g) % ROTATION_DAYS === day % ROTATION_DAYS || due(g));
  console.log(`asking tcgcsv for ${asked.length} of ${groups.length} groups today`);
}
// For trying the script by hand without asking tcgcsv for every group: SEALED_MAX_GROUPS=5.
if (process.env.SEALED_MAX_GROUPS) asked = asked.slice(0, Number(process.env.SEALED_MAX_GROUPS));
{
  let started = 0;
  for (const group of asked) {
    const wait = started + SPACING_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    started = Date.now();
    const want = wantedTcg.get(group);
    try {
      const body = await (await get(`${TCGCSV}${group}/prices`)).json();
      // Not a price list (a bad publish of one group): the live prices stay
      // and the group stays due, never "refreshed" with nothing (review).
      if (!body || body.success === false || !Array.isArray(body.results)) throw new Error('not a price list');
      const named = body.results.filter((r) => want.has(String(r.productId))).length;
      const livePriced = [...want].filter((id) => live?.usd?.[id] !== undefined).length;
      if (named === 0 && livePriced >= 2) throw new Error(`names none of its ${want.size} products`);
      // The group's answer replaces its products' prices: one no longer
      // priced there loses its old price.
      for (const id of want) delete usd[id];
      for (const r of body.results) {
        const id = String(r.productId);
        if (!want.has(id) || typeof r.marketPrice !== 'number' || !(r.marketPrice > 0)) continue;
        // A sealed product has one row, Normal; never let a Foil row win over it.
        if (usd[id] !== undefined && r.subTypeName !== 'Normal') continue;
        usd[id] = Math.round(r.marketPrice * 100) / 100;
      }
      refreshed[group] = TODAY;
    } catch (e) {
      tcgFailed++;
      console.warn(`::warning::tcgcsv group ${group}: ${e instanceof Error ? e.message : e}`);
      Object.assign(usd, pick(live?.usd, want));
    }
  }
  // A share of a handful (the keep branch's new groups) says nothing about tcgcsv: those keep their live prices.
  if (asked.length >= 5 && tcgFailed > asked.length / 2) throw new Error(`${tcgFailed} of ${asked.length} tcgcsv groups failed: not publishing`);
}

// ---- Cardmarket's price guide
const guideTag = (await get(CARDMARKET_GUIDE, { method: 'HEAD' })).headers.get('etag') ?? '';
let eur;
let cardmarket;
// Kept only while the guide is the same AND the products wanted are the ones
// the live file was built for (a file of the last three years alone, or a new
// set's products, needs the guide read again).
if (live && guideTag && live.cardmarketEtag === guideTag && live.eur && live.cardmarketWanted === wantedMcm.size) {
  eur = pick(live.eur, wantedMcm);
  cardmarket = live.cardmarket;
  console.log(`Cardmarket's price guide of ${cardmarket} is unchanged: its prices are kept.`);
} else {
  const guide = await (await get(CARDMARKET_GUIDE)).json();
  if (!Array.isArray(guide.priceGuides) || guide.priceGuides.length < 10_000) throw new Error('Cardmarket price guide: not a price guide');
  eur = {};
  for (const g of guide.priceGuides) {
    const id = String(g.idProduct);
    if (wantedMcm.has(id) && typeof g.trend === 'number' && g.trend > 0) eur[id] = Math.round(g.trend * 100) / 100;
  }
  cardmarket = String(guide.createdAt ?? '');
}

const sortById = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => Number(a[0]) - Number(b[0])));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const body =
  `{"v":2,"since":${JSON.stringify(SINCE)},"tcgcsv":${JSON.stringify(tcgcsv)},"refreshed":${JSON.stringify(sortById(refreshed))},"cardmarket":${JSON.stringify(cardmarket)},` +
  `"cardmarketEtag":${JSON.stringify(guideTag)},"cardmarketWanted":${wantedMcm.size},"usd":${JSON.stringify(sortById(usd))},"eur":${JSON.stringify(sortById(eur))}}\n`;
fs.writeFileSync(OUT, body);
console.log(`${Object.keys(usd).length} TCGplayer prices (tcgcsv ${tcgcsv}), ${Object.keys(eur).length} Cardmarket prices (guide ${cardmarket}), ${Math.round(body.length / 1024)} KB`);
