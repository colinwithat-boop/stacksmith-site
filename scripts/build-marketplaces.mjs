// Builds market/sealed.json: what the current sealed products (boosters,
// boxes and bundles of the sets in the Packs tab's window) sell for at
// Rakuten Ichiba and Yahoo! Shopping, in yen, through each marketplace's
// official item-search API (the owner, 2026-10-10: Rakuten and Yahoo
// Shopping for sealed only). Each product is searched for by its set's
// Japanese name (sets/names.json) and its kind's words, per language, and
// the cheapest offer in stock whose title confirms the product is kept
// (scripts/marketplace-data.mjs):
//
//   market/sealed.json  {v, currency, built, since, counts, sources: {rakuten: {ja: {<product id>: [price, url, seller]}, en: {...}}, yahoo: {...}}}
//
// Needs RAKUTEN_APP_ID (Rakuten Web Service application ID) and
// YAHOO_CLIENT_ID (Yahoo! JAPAN Developer Network client ID); a service
// whose id is not set is skipped, and with neither set the live file is
// published again. One request a second per service, one per product and
// language (a few hundred a run), and a run only when the live file is
// older than MAX_AGE_H hours (or MARKET_FORCE=true). Both services
// require their credit wherever the prices are shown (the app's job).
//
//   node scripts/build-marketplaces.mjs [--dir _site/market] [--no-live] [--max-products N] [--raw-dir <dir>]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { marketplaceBody, marketplaceQuery, pickOffer, rakutenOffers, yahooOffers } from './marketplace-data.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const SITE_URL = process.env.SITE_URL || 'https://stacksmith-app.pages.dev/';
const DIR = path.resolve(ROOT, arg('--dir', '_site/market'));
const RAW_DIR = arg('--raw-dir', null);
const MAX_PRODUCTS = Number(arg('--max-products', '0')) || 0;
const LIVE = args.includes('--no-live') ? null : `${SITE_URL.replace(/\/?$/, '/')}market/`;
const FORCE = process.env.MARKET_FORCE === 'true';
const MAX_AGE_H = Number(process.env.MARKET_MAX_AGE_H || '20');
const UA = 'Stacksmith prices (https://stacksmith-app.pages.dev/; stackscanapp@gmail.com)';
const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID || '';
const YAHOO_CLIENT_ID = process.env.YAHOO_CLIENT_ID || '';
const SPACING_MS = 1000;
const WINDOW_YEARS = 3;
const SETS_DIR = path.join(ROOT, 'sealed', 'sets');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(DIR, { recursive: true });
const write = (name, text) => fs.writeFileSync(path.join(DIR, name), text);

async function live(name) {
  if (LIVE === null) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep([0, 3000, 10000][attempt]);
    try {
      const res = await fetch(LIVE + name, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) });
      if (res.status === 404 || res.status === 410) return null;
      if (res.ok) return await res.text();
      console.warn(`live ${name}: ${res.status}`);
    } catch (e) {
      console.warn(`live ${name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return undefined;
}

const liveText = await live('sealed.json');
if (liveText === undefined) {
  console.error('::error::the live market/sealed.json could not be read: the live file is left as it is');
  process.exit(1);
}
if (!RAKUTEN_APP_ID && !YAHOO_CLIENT_ID) {
  if (liveText) write('sealed.json', liveText);
  console.log('::notice::No RAKUTEN_APP_ID or YAHOO_CLIENT_ID: the marketplaces were not asked' + (liveText ? '; the live file was published again.' : '.'));
  process.exit(0);
}
if (!FORCE && liveText) {
  let built = null;
  try {
    built = JSON.parse(liveText).built;
  } catch {
    built = null;
  }
  const age = built ? (Date.now() - Date.parse(built)) / 3_600_000 : Infinity;
  if (age < MAX_AGE_H) {
    write('sealed.json', liveText);
    console.log(`The live marketplace file is ${age.toFixed(1)} h old: published again as it is.`);
    process.exit(0);
  }
}

// ---- The products to ask about: shelf boosters, boxes and bundles of the window's sets.
const names = JSON.parse(fs.readFileSync(path.join(ROOT, 'sets', 'names.json'), 'utf8')).sets ?? {};
let since = null;
try {
  since = JSON.parse(fs.readFileSync(path.join(ROOT, '_site', 'sealed', 'prices.json'), 'utf8')).since ?? null;
} catch {
  since = null;
}
if (!since) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - WINDOW_YEARS);
  since = d.toISOString().slice(0, 10);
}
const asks = [];
const skippedSets = [];
for (const file of fs.readdirSync(SETS_DIR)) {
  if (!/^set-.*\.json$/.test(file)) continue;
  const set = JSON.parse(fs.readFileSync(path.join(SETS_DIR, file), 'utf8'));
  if ((set.date ?? '') < since) continue;
  const code = String(set.code).toLowerCase();
  const ja = names[code]?.ja;
  if (!ja) {
    skippedSets.push({ code, name: set.name });
    continue;
  }
  for (const product of set.products) {
    if ((product.date ?? set.date ?? '') < since) continue;
    for (const language of ['ja', 'en']) {
      const query = marketplaceQuery(product, ja, language);
      if (query) asks.push({ id: product.id, name: product.name, set: code, language, query });
    }
  }
}
const limited = MAX_PRODUCTS ? asks.slice(0, MAX_PRODUCTS) : asks;
console.log(`${limited.length} searches for ${new Set(limited.map((a) => a.id)).size} products of the sets since ${since} (${skippedSets.length} sets without a Japanese name skipped)`);

// ---- The services, one request a second each.
let requests = 0;
async function ask(service, url) {
  const key = RAW_DIR ? path.join(RAW_DIR, `${service}-${crypto.createHash('sha1').update(url).digest('hex')}.json`) : null;
  if (key && fs.existsSync(key)) return JSON.parse(fs.readFileSync(key, 'utf8'));
  for (let attempt = 0; ; attempt++) {
    await sleep(SPACING_MS);
    requests++;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`${res.status}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const text = await res.text();
      const data = JSON.parse(text);
      if (key) {
        fs.mkdirSync(RAW_DIR, { recursive: true });
        fs.writeFileSync(key, text);
      }
      return data;
    } catch (e) {
      if (attempt >= 2) {
        console.warn(`${service}: ${e instanceof Error ? e.message : e}: given up for this search`);
        return null;
      }
      await sleep([5_000, 20_000][attempt]);
    }
  }
}

const rakutenUrl = (text) =>
  `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?format=json&applicationId=${encodeURIComponent(RAKUTEN_APP_ID)}&keyword=${encodeURIComponent(text)}&availability=1&sort=${encodeURIComponent('+itemPrice')}&hits=30`;
const yahooUrl = (text) =>
  `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${encodeURIComponent(YAHOO_CLIENT_ID)}&query=${encodeURIComponent(text)}&in_stock=true&sort=${encodeURIComponent('+price')}&results=30`;

const sources = { rakuten: { ja: {}, en: {} }, yahoo: { ja: {}, en: {} } };
const counts = { searches: limited.length, rakuten: 0, yahoo: 0, requests: 0 };
let done = 0;
for (const a of limited) {
  if (RAKUTEN_APP_ID) {
    const data = await ask('rakuten', rakutenUrl(a.query.text));
    const offer = data ? pickOffer(a.query, rakutenOffers(data)) : null;
    if (offer) {
      sources.rakuten[a.language][a.id] = [offer.price, offer.url, offer.seller];
      counts.rakuten++;
    }
  }
  if (YAHOO_CLIENT_ID) {
    const data = await ask('yahoo', yahooUrl(a.query.text));
    const offer = data ? pickOffer(a.query, yahooOffers(data)) : null;
    if (offer) {
      sources.yahoo[a.language][a.id] = [offer.price, offer.url, offer.seller];
      counts.yahoo++;
    }
  }
  done++;
  if (done % 100 === 0) console.log(`${done} of ${limited.length} searches, ${requests} requests`);
}
counts.requests = requests;
const built = new Date().toISOString();
write('sealed.json', marketplaceBody({ built, since, sources, counts }));
write('report.json', JSON.stringify({ built, counts, skippedSets }, null, 1));
console.log(`Done: Rakuten ${counts.rakuten}, Yahoo ${counts.yahoo} of ${limited.length} searches, ${requests} requests`);
