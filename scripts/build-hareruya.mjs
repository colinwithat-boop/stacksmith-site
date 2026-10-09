// Builds hareruya/cards.json and hareruya/sealed.json: what cards and
// sealed products sell for at Hareruya (晴れる屋, hareruyamtg.com, Japan's
// largest Magic retailer), in yen, for the Stacksmith app's users in Japan
// (the owner, 2026-10-09: good card, pack and box prices for Japanese
// customers; Hareruya did not answer a request for a feed).
//
//   hareruya/cards.json   one row per Scryfall printing Hareruya sells:
//                         [scryfall id, ja, ja_foil, ja_etched, en, en_foil,
//                         en_etched, product], yen or null; the Japanese
//                         and English printings of the same card are the
//                         same Scryfall printing in two languages, so both
//                         are given. `product` opens the card's page there:
//                         https://www.hareruyamtg.com/ja/products/detail/<product>
//   hareruya/sealed.json  prices by the app's sealed product id (the sealed
//                         set files' `id`, MTGJSON's), under `ja` and `en`:
//                         [price, product].
//   hareruya/report.json  what did not match and why, for tuning the
//                         parser (scripts/hareruya-data.mjs).
//
// Read through the site's own product search, which answers JSON (one
// document per SKU; the page's own JavaScript calls it the same way), set
// by set: a query answers at most 4,000 rows, so a bigger set (Secret
// Lair) is split by language, then finish, then rarity, then price. The
// sealed categories (packs, boxes, bundles, decks, other) are read whole.
// Asked as little as can be: one request every SPACING_MS with an
// identifying User-Agent, about 600 requests a run, and a run only when
// the live file is older than MAX_AGE_H hours (or FORCE=true); any other
// run republishes the live files. A run that fails leaves the live files
// as they are (the workflow's keep step). NM copies only; of several SKUs
// for one printing, language and finish, the cheapest in stock, else the
// cheapest at all.
//
//   node scripts/build-hareruya.mjs [--dir _site/hareruya] [--bulk <default-cards.jsonl.gz>]
//                                   [--raw-dir <dir>] [--no-live] [--max-sets N]
//
// --bulk reads a saved Scryfall bulk file instead of downloading it;
// --raw-dir keeps every Hareruya answer on disk and reads it back on the
// next run (for tuning the parser without asking Hareruya again).
import { createGunzip } from 'node:zlib';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

import {
  LANGUAGES,
  buildScryfallIndex,
  cardRows,
  cardsBody,
  matchSealed,
  matchSingle,
  normalizeSetCode,
  parseSealedName,
  parseSingleName,
  pickPrices,
  scryfallCardSummary,
  sealedBody,
  sealedLanguage,
} from './hareruya-data.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const SITE_URL = process.env.SITE_URL || 'https://stacksmith-app.pages.dev/';
const DIR = path.resolve(ROOT, arg('--dir', '_site/hareruya'));
const BULK = arg('--bulk', null);
const RAW_DIR = arg('--raw-dir', null);
const MAX_SETS = Number(arg('--max-sets', process.env.HARERUYA_MAX_SETS || '0')) || 0;
const LIVE = args.includes('--no-live') ? null : `${SITE_URL.replace(/\/?$/, '/')}hareruya/`;
const FORCE = process.env.HARERUYA_FORCE === 'true';
const MAX_AGE_H = Number(process.env.HARERUYA_MAX_AGE_H || '20');
const UA = 'Stacksmith prices (https://stacksmith-app.pages.dev/; stackscanapp@gmail.com)';
const HARERUYA = 'https://www.hareruyamtg.com';
const API = `${HARERUYA}/ja/products/search/unisearch_api`;
const SPACING_MS = 400;
const ROWS = 2000;
/** The most rows one query answers; a filter answering more is split. */
const CAP = 4000;
const SETS_DIR = path.join(ROOT, 'sealed', 'sets');
/** Sealed goods (未開封商品), read whole, and its subcategories, which say what a listing is. */
const SEALED = '177:505';
const SEALED_CATEGORIES = { pack: '177:505:507', box: '177:505:506', bundle: '177:505:518', multiplayer: '177:505:519', deck: '177:505:520', limited: '177:505:521', other: '177:505:522' };
const SINGLES = '1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(DIR, { recursive: true });
const write = (name, text) => fs.writeFileSync(path.join(DIR, name), text);

// ---- The live files: published again while fresh enough.
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

if (!FORCE) {
  const cards = await live('cards.json');
  if (cards === undefined) {
    console.error('::error::the live hareruya/cards.json could not be read: the live files are left as they are');
    process.exit(1);
  }
  if (cards !== null) {
    let built = null;
    try {
      built = JSON.parse(cards).built;
    } catch {
      built = null;
    }
    const age = built ? (Date.now() - Date.parse(built)) / 3_600_000 : Infinity;
    if (age < MAX_AGE_H) {
      write('cards.json', cards);
      for (const name of ['sealed.json', 'report.json']) {
        const text = await live(name);
        if (typeof text === 'string') write(name, text);
      }
      console.log(`The live Hareruya files are ${age.toFixed(1)} h old: published again as they are.`);
      process.exit(0);
    }
    console.log(`The live Hareruya files are ${age === Infinity ? 'undated' : `${age.toFixed(1)} h old`}: building.`);
  }
}

// ---- Hareruya, one request at a time.
let lastRequest = 0;
let requests = 0;
async function hareruya(url) {
  const key = RAW_DIR ? path.join(RAW_DIR, `${crypto.createHash('sha1').update(url).digest('hex')}.json`) : null;
  if (key && fs.existsSync(key)) return JSON.parse(fs.readFileSync(key, 'utf8'));
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequest + SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    requests++;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`${res.status}`);
      if (!res.ok) throw new Error(`${res.status} for ${url}`);
      const text = await res.text();
      const data = JSON.parse(text);
      if (!data.response || !Array.isArray(data.response.docs)) throw new Error(`no documents in the answer for ${url}`);
      if (key) {
        fs.mkdirSync(RAW_DIR, { recursive: true });
        fs.writeFileSync(key, text);
      }
      return data;
    } catch (e) {
      if (attempt >= 3) throw e;
      const delay = [5_000, 20_000, 60_000][attempt];
      console.warn(`${e instanceof Error ? e.message : e}: again in ${delay / 1000} s`);
      await sleep(delay);
    }
  }
}

const query = (filters, page, rows = ROWS) => {
  const q = Object.entries(filters)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${API}?${q}&rows=${rows}&page=${page}&sort=${encodeURIComponent('product_class asc')}`;
};

/** How many documents a filter answers. */
async function count(filters) {
  return (await hareruya(query(filters, 1, 1))).response.numFound;
}

/** Every document a filter answers, within the cap. */
async function pages(filters) {
  const docs = [];
  for (let page = 1; ; page++) {
    const data = await hareruya(query(filters, page));
    docs.push(...data.response.docs);
    if (data.response.docs.length < ROWS || docs.length >= data.response.numFound) return docs;
  }
}

/**
 * The ways a filter is split when it answers more than the cap, in
 * order: by language, finish, rarity, then price bands.
 */
const SPLITS = [
  ['fq.language', ['1', '2', Object.keys(LANGUAGES).filter((k) => k !== '1' && k !== '2').join('|')]],
  ['fq.foil_flg', ['0', '1']],
  ['fq.rarity', ['C', 'U', 'R', 'M', 'L|S|T|P|B']],
  ['fq.price', ['1~299', '300~999', '1000~4999', '5000~*']],
];

async function all(filters, depth = 0) {
  const n = await count(filters);
  if (n === 0) return [];
  if (n <= CAP) return pages(filters);
  if (depth >= SPLITS.length) {
    console.warn(`::warning::${JSON.stringify(filters)} answers ${n} rows and cannot be split further: the first ${CAP} taken`);
    return pages(filters);
  }
  const [field, values] = SPLITS[depth];
  const docs = [];
  for (const v of values) docs.push(...(await all({ ...filters, [field]: v }, depth + 1)));
  return docs;
}

/** Hareruya's card sets (id and name) from its search form. */
async function cardSets() {
  const url = `${HARERUYA}/ja/products/search`;
  const key = RAW_DIR ? path.join(RAW_DIR, 'search-form.html') : null;
  let html;
  if (key && fs.existsSync(key)) html = fs.readFileSync(key, 'utf8');
  else {
    await sleep(SPACING_MS);
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`${res.status} for the search form`);
    html = await res.text();
    if (key) {
      fs.mkdirSync(RAW_DIR, { recursive: true });
      fs.writeFileSync(key, html);
    }
  }
  const select = html.match(/name="cardset"[^>]*>([\s\S]*?)<\/select>/);
  if (!select) throw new Error('the search form has no card set list');
  const sets = [...select[1].matchAll(/<option value="(\d+)"[^>]*>\s*([^<]*?)\s*<\/option>/g)].map((m) => ({ id: m[1], name: m[2] }));
  if (sets.length < 100) throw new Error(`only ${sets.length} card sets in the search form`);
  return sets;
}

// ---- Scryfall's printings.
async function scryfallCards() {
  let stream;
  if (BULK) stream = fs.createReadStream(BULK);
  else {
    const meta = await (await fetch('https://api.scryfall.com/bulk-data/default-cards', { headers: { 'User-Agent': UA, Accept: 'application/json' } })).json();
    if (!meta.jsonl_download_uri) throw new Error('Scryfall lists no JSONL download for default_cards');
    console.log(`default_cards of ${meta.updated_at}`);
    const res = await fetch(meta.jsonl_download_uri, { headers: { 'User-Agent': UA } });
    if (!res.ok || !res.body) throw new Error(`${res.status} for ${meta.jsonl_download_uri}`);
    stream = Readable.fromWeb(res.body);
  }
  const cards = [];
  let rest = '';
  const take = (line) => {
    const trimmed = line.trim().replace(/,$/, '');
    if (!trimmed.startsWith('{')) return;
    const c = scryfallCardSummary(JSON.parse(trimmed));
    if (c) cards.push(c);
  };
  for await (const chunk of stream.pipe(createGunzip())) {
    rest += chunk.toString('utf8');
    let nl;
    while ((nl = rest.indexOf('\n')) >= 0) {
      take(rest.slice(0, nl));
      rest = rest.slice(nl + 1);
    }
  }
  if (rest.trim()) take(rest);
  return cards;
}

// ---- The build.
const started = new Date();
const scryfall = scryfallCards();
const sets = await cardSets();
console.log(`${sets.length} card sets at Hareruya`);
const totalSingles = await count({ 'fq.category_id': SINGLES });
const singles = [];
let setsRead = 0;
for (const set of sets) {
  if (MAX_SETS && setsRead >= MAX_SETS) break;
  const docs = await all({ 'fq.category_id': SINGLES, 'fq.cardset': set.id });
  for (const d of docs) d.cardset = set.name;
  singles.push(...docs);
  setsRead++;
  if (setsRead % 50 === 0) console.log(`${setsRead} sets, ${singles.length} documents, ${requests} requests`);
}
console.log(`${singles.length} single-card documents from ${setsRead} sets (${totalSingles} singles listed), ${requests} requests`);
if (!MAX_SETS && singles.length < totalSingles * 0.9) {
  console.error(`::error::only ${singles.length} of ${totalSingles} singles were read: the live files are left as they are`);
  process.exit(1);
}

const sealedDocs = await all({ 'fq.category_id': SEALED });
const categoryOf = new Map();
for (const [category, id] of Object.entries(SEALED_CATEGORIES)) for (const d of await all({ 'fq.category_id': id })) categoryOf.set(d.product, category);
for (const d of sealedDocs) d.category = categoryOf.get(d.product) ?? 'other';
console.log(`${sealedDocs.length} sealed documents, ${requests} requests in all`);
const scraped = new Date().toISOString();

const index = buildScryfallIndex(await scryfall);
console.log(`${index.byNumber.size} paper printings from Scryfall`);

// Singles: parse, match, pick.
const why = new Map();
const unknownSets = new Map();
const seen = new Set();
let matched = 0;
let parsedCount = 0;
for (const d of singles) {
  if (seen.has(d.product_class)) continue;
  seen.add(d.product_class);
  d.parsed = parseSingleName(d.product_name);
  if (d.parsed) parsedCount++;
  const m = matchSingle(d.parsed, d.card_name, index, d.cardset);
  d.id = m.id;
  if (m.id) matched++;
  else if (m.why !== 'lot') {
    const reason = m.why.startsWith('unknown set') ? 'unknown set' : m.why;
    const r = why.get(reason) ?? { count: 0, samples: [], bySet: {} };
    r.count++;
    if (r.samples.length < 8) r.samples.push({ product: d.product, name: d.product_name, set: d.cardset });
    r.bySet[d.cardset] = (r.bySet[d.cardset] ?? 0) + 1;
    why.set(reason, r);
    if (reason === 'unknown set') {
      const code = d.parsed.code ?? '';
      const u = unknownSets.get(code) ?? { count: 0, hareruyaSet: d.cardset, sample: d.product_name };
      u.count++;
      unknownSets.set(code, u);
    }
  }
}
const cells = pickPrices(singles.filter((d) => d.id));
const rows = cardRows(cells);
console.log(`${seen.size} SKUs: ${parsedCount} cards, ${matched} matched to a printing, ${rows.length} printings priced`);
for (const [reason, r] of [...why].sort((a, b) => b[1].count - a[1].count)) console.log(`  ${r.count} ${reason}`);

// Sealed: the app's products per set, then match.
const products = new Map();
for (const name of fs.readdirSync(SETS_DIR)) {
  if (!/^set-.*\.json$/.test(name)) continue;
  const set = JSON.parse(fs.readFileSync(path.join(SETS_DIR, name), 'utf8'));
  products.set(String(set.code).toLowerCase(), set.products.map((p) => ({ id: p.id, name: p.name, short: p.short, cat: p.cat, sub: p.sub })));
}
const ja = {};
const en = {};
const sealedWhy = new Map();
const sealedUnmatched = [];
let sealedMatched = 0;
const sealedSeen = new Set();
const note = (reason, d) => {
  const r = sealedWhy.get(reason) ?? { count: 0, samples: [] };
  r.count++;
  if (r.samples.length < 8) r.samples.push({ product: d.product, name: d.product_name, en: d.product_name_en ?? null });
  sealedWhy.set(reason, r);
};
for (const d of sealedDocs) {
  if (sealedSeen.has(d.product)) continue;
  sealedSeen.add(d.product);
  const price = Number(d.price);
  if (!Number.isFinite(price) || price <= 0 || d.card_condition !== '1') continue;
  const lang = sealedLanguage(d.product_name, d.product_name_en);
  const parsed = parseSealedName(d.product_name, d.product_name_en, d.category);
  if (!parsed) {
    note('damaged, opened or graded', d);
    continue;
  }
  const codes = parsed.codes.map(normalizeSetCode).filter((c) => products.has(c));
  // A listing that names no language is English (Secret Lair drops, gift
  // bundles): Hareruya marks its Japanese goods.
  const language = lang ?? 'en';
  if (lang === null) note('language assumed English', d);
  if (language !== 'ja' && language !== 'en') {
    note('another language', d);
    continue;
  }
  if (codes.length === 0) {
    note(parsed.codes.length ? 'unknown set' : 'no set code', d);
    sealedUnmatched.push({ product: d.product, name: d.product_name, en: d.product_name_en ?? null, why: parsed.codes.length ? `unknown set ${parsed.codes.join(',')}` : 'no set code' });
    continue;
  }
  let hit = null;
  for (const code of codes) {
    hit = matchSealed(parsed, products.get(code), language);
    if (hit) break;
  }
  if (!hit) {
    note('no product matched', d);
    if (sealedUnmatched.length < 400) sealedUnmatched.push({ product: d.product, name: d.product_name, en: d.product_name_en ?? null, kind: parsed.kind, sets: codes });
    continue;
  }
  const into = language === 'ja' ? ja : en;
  const stock = Number(d.stock) > 0;
  const have = into[hit.id];
  if (!have || (stock && !have[2]) || (stock === Boolean(have[2]) && price < have[0])) into[hit.id] = [price, Number(d.product), stock ? 1 : 0];
  sealedMatched++;
}
for (const o of [ja, en]) for (const k of Object.keys(o)) o[k] = o[k].slice(0, 2);
console.log(`${sealedSeen.size} sealed products: ${sealedMatched} matched (${Object.keys(ja).length} Japanese, ${Object.keys(en).length} English)`);
for (const [reason, r] of [...sealedWhy].sort((a, b) => b[1].count - a[1].count)) console.log(`  ${r.count} ${reason}`);

const built = new Date().toISOString();
const counts = { skus: seen.size, matched, sealed: sealedSeen.size, sealedMatched, requests };
write('cards.json', cardsBody({ built, scraped, rows, counts }));
write('sealed.json', sealedBody({ built, scraped, ja, en, counts: { sealed: sealedSeen.size, matched: sealedMatched } }));
write(
  'report.json',
  JSON.stringify(
    {
      built,
      counts,
      singles: Object.fromEntries([...why].sort((a, b) => b[1].count - a[1].count).map(([k, r]) => [k, { ...r, bySet: Object.fromEntries(Object.entries(r.bySet).sort((a, b) => b[1] - a[1]).slice(0, 60)) }])),
      unknownSets: Object.fromEntries([...unknownSets].sort((a, b) => b[1].count - a[1].count)),
      sealed: Object.fromEntries([...sealedWhy].sort((a, b) => b[1].count - a[1].count)),
      sealedUnmatched,
    },
    null,
    1,
  ),
);
console.log(`${rows.length} rows -> cards.json, ${Object.keys(ja).length + Object.keys(en).length} sealed prices -> sealed.json, ${requests} requests, ${Math.round((Date.now() - started.getTime()) / 1000)} s`);
