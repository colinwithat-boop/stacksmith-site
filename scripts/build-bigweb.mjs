// Builds bigweb/cards.json and bigweb/sealed.json: what cards and sealed
// products sell for at Bigweb (BIG MAGIC, bigweb.co.jp), in yen, for the
// Stacksmith app's users in Japan (the owner, 2026-10-10: a second
// Japanese shop beside Hareruya). The files are shaped exactly as
// hareruya/cards.json and hareruya/sealed.json (scripts/build-hareruya.mjs),
// with "source": "bigweb", so the app reads both the same way:
//
//   bigweb/cards.json   one row per Scryfall printing Bigweb sells:
//                       [scryfall id, ja, ja_foil, ja_etched, en, en_foil,
//                       en_etched, product], yen or null; `product` opens
//                       the card's page: https://www.bigweb.co.jp/ja/products/mtg/cardViewer/<product>
//   bigweb/sealed.json  the sealed products' prices by the app's product id
//                       (the sealed set files' `id`), under `ja` and `en`,
//                       each [price, product, in stock].
//   bigweb/report.json  what did not match and why, for tuning the parser
//                       (scripts/bigweb-data.mjs).
//
// Read through Bigweb's own product API (api.bigweb.co.jp, JSON, 100
// listings a page; its site calls it the same way): the set list once,
// then every set whose code names a Scryfall set, page by page, and the
// sealed goods (is_box=1) whole. One request every SPACING_MS with an
// identifying User-Agent, about 2,800 requests a run (~20 minutes), and a
// run only when the live file is older than MAX_AGE_H hours (or
// FORCE=true); any other run republishes the live files. A run that fails
// leaves the live files as they are (the workflow's keep step). NM copies
// only; of several listings for one printing, language and finish, the
// cheapest in stock, else the cheapest at all.
//
//   node scripts/build-bigweb.mjs [--dir _site/bigweb] [--bulk <default-cards.jsonl.gz>]
//                                 [--raw-dir <dir>] [--no-live] [--max-sets N]
//
// --bulk reads a saved Scryfall bulk file instead of downloading it;
// --raw-dir keeps every Bigweb answer on disk and reads it back on the
// next run (for tuning the parser without asking Bigweb again).
import { createGunzip } from 'node:zlib';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

import { cardRows, cardsBody, scryfallCardSummary, sealedBody } from './hareruya-data.mjs';
import { bigwebSet, buildScryfallIndex, matchBigwebSealed, matchBigwebSingle, parseBigwebSealed, parseBigwebSingle, pickBigwebPrices } from './bigweb-data.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const SITE_URL = process.env.SITE_URL || 'https://stacksmith-app.pages.dev/';
const DIR = path.resolve(ROOT, arg('--dir', '_site/bigweb'));
const BULK = arg('--bulk', null);
const RAW_DIR = arg('--raw-dir', null);
const MAX_SETS = Number(arg('--max-sets', process.env.BIGWEB_MAX_SETS || '0')) || 0;
const LIVE = args.includes('--no-live') ? null : `${SITE_URL.replace(/\/?$/, '/')}bigweb/`;
const FORCE = process.env.BIGWEB_FORCE === 'true';
const MAX_AGE_H = Number(process.env.BIGWEB_MAX_AGE_H || '20');
const UA = 'Stacksmith prices (https://stacksmith-app.pages.dev/; stackscanapp@gmail.com)';
const API = 'https://api.bigweb.co.jp';
const GAME = 1; // Magic: The Gathering in Bigweb's games list
const SPACING_MS = 400;
const PER_PAGE = 100;
const SETS_DIR = path.join(ROOT, 'sealed', 'sets');

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
    console.error('::error::the live bigweb/cards.json could not be read: the live files are left as they are');
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
      console.log(`The live Bigweb files are ${age.toFixed(1)} h old: published again as they are.`);
      process.exit(0);
    }
    console.log(`The live Bigweb files are ${age === Infinity ? 'undated' : `${age.toFixed(1)} h old`}: building.`);
  }
}

// ---- Bigweb, one request at a time.
let lastRequest = 0;
let requests = 0;
async function bigweb(url) {
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
      if (!data || data.success === false) throw new Error(`no success in the answer for ${url}`);
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

/** Every listing a filter answers, page by page. */
async function pages(filters) {
  const items = [];
  for (let page = 1; ; page++) {
    const q = Object.entries({ game_id: GAME, ...filters, page })
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const data = await bigweb(`${API}/products?${q}`);
    const got = Array.isArray(data.items) ? data.items : [];
    items.push(...got);
    const p = data.pagenate ?? {};
    if (got.length < PER_PAGE || p.nextPage === false || (p.pageCount && page >= p.pageCount)) return items;
    if (page > 5000) throw new Error(`${JSON.stringify(filters)}: no end of pages`);
  }
}

/** Bigweb's card sets: id, code and Japanese name. */
async function cardSets() {
  const data = await bigweb(`${API}/cardsets?game_id=${GAME}`);
  const sets = Array.isArray(data.cardsets) ? data.cardsets : [];
  if (sets.length < 100) throw new Error(`only ${sets.length} card sets listed`);
  return sets.map((s) => ({ id: s.id, code: String(s.code ?? ''), name: String(s.name ?? '').trim() }));
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
const index = buildScryfallIndex(await scryfall);
console.log(`${sets.length} card sets at Bigweb, ${index.byNumber.size} paper printings from Scryfall`);

// Singles: the sets whose code names a Scryfall set (supplies, promos
// with no set and unknown codes are skipped and reported).
const unknownSets = [];
const singles = [];
let setsRead = 0;
for (const set of sets) {
  const { set: code } = bigwebSet(set.code);
  if (!code || !index.sets.has(code)) {
    unknownSets.push({ id: set.id, code: set.code, name: set.name });
    continue;
  }
  if (MAX_SETS && setsRead >= MAX_SETS) break;
  const items = await pages({ cardsets: set.id });
  for (const it of items) {
    if (it.is_box) continue;
    singles.push(it);
  }
  setsRead++;
  if (setsRead % 50 === 0) console.log(`${setsRead} sets, ${singles.length} listings, ${requests} requests`);
}
console.log(`${singles.length} single-card listings from ${setsRead} sets (${unknownSets.length} sets skipped), ${requests} requests`);

// Sealed goods, whole.
const sealedItems = await pages({ is_box: 1 });
console.log(`${sealedItems.length} sealed listings, ${requests} requests in all`);
const scraped = new Date().toISOString();

// Singles: parse, match, pick.
const why = new Map();
const seen = new Set();
let matched = 0;
let parsedCount = 0;
const parsedSingles = [];
for (const it of singles) {
  if (seen.has(it.id)) continue;
  seen.add(it.id);
  const parsed = parseBigwebSingle(it);
  if (!parsed) continue;
  parsedCount++;
  const m = matchBigwebSingle(parsed, index);
  parsed.id = m.id;
  parsedSingles.push(parsed);
  if (m.id) matched++;
  else {
    const reason = m.why.startsWith('unknown set') ? 'unknown set' : m.why;
    const r = why.get(reason) ?? { count: 0, samples: [], bySet: {} };
    r.count++;
    if (r.samples.length < 8) r.samples.push({ product: parsed.product, name: it.name, set: parsed.rawSet });
    r.bySet[parsed.rawSet] = (r.bySet[parsed.rawSet] ?? 0) + 1;
    why.set(reason, r);
  }
}
const cells = pickBigwebPrices(parsedSingles);
const rows = cardRows(cells);
console.log(`${seen.size} listings: ${parsedCount} NM singles, ${matched} matched to a printing, ${rows.length} printings priced`);
for (const [reason, r] of [...why].sort((a, b) => b[1].count - a[1].count)) console.log(`  ${r.count} ${reason}`);
if (!MAX_SETS && parsedCount > 0 && matched < parsedCount * 0.7) {
  console.error(`::error::only ${matched} of ${parsedCount} singles matched: the live files are left as they are`);
  process.exit(1);
}

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
const note = (reason, it) => {
  const r = sealedWhy.get(reason) ?? { count: 0, samples: [] };
  r.count++;
  if (r.samples.length < 8) r.samples.push({ product: it.id, name: it.name });
  sealedWhy.set(reason, r);
};
for (const it of sealedItems) {
  if (sealedSeen.has(it.id)) continue;
  sealedSeen.add(it.id);
  const sealed = parseBigwebSealed(it);
  if (!sealed) {
    note('not a booster or bundle, or no language or set', it);
    continue;
  }
  const hit = matchBigwebSealed(sealed, products.get(sealed.set));
  if (!hit) {
    note(products.has(sealed.set) ? 'no product matched' : `unknown set ${sealed.set}`, it);
    if (sealedUnmatched.length < 400) sealedUnmatched.push({ product: it.id, name: it.name, set: sealed.set, kind: sealed.parsed.kind });
    continue;
  }
  const into = sealed.language === 'ja' ? ja : en;
  const have = into[hit.id];
  if (!have || (sealed.stock && !have[2]) || (sealed.stock === Boolean(have[2]) && sealed.price < have[0])) into[hit.id] = [sealed.price, sealed.product, sealed.stock ? 1 : 0];
  sealedMatched++;
}
console.log(`${sealedSeen.size} sealed listings: ${sealedMatched} matched (${Object.keys(ja).length} Japanese, ${Object.keys(en).length} English)`);
for (const [reason, r] of [...sealedWhy].sort((a, b) => b[1].count - a[1].count)) console.log(`  ${r.count} ${reason}`);

const built = new Date().toISOString();
const counts = { listings: seen.size, singles: parsedCount, matched, sealed: sealedSeen.size, sealedMatched, requests, sets: setsRead };
write('cards.json', cardsBody({ built, scraped, rows, counts, source: 'bigweb' }));
write('sealed.json', sealedBody({ built, scraped, ja, en, counts: { sealed: sealedSeen.size, matched: sealedMatched }, source: 'bigweb' }));
write(
  'report.json',
  JSON.stringify(
    {
      built,
      counts,
      singles: Object.fromEntries(why),
      unknownSets,
      sealed: Object.fromEntries(sealedWhy),
      sealedUnmatched,
    },
    null,
    1,
  ),
);
console.log(`Done in ${((Date.now() - started.getTime()) / 1000).toFixed(0)} s: ${rows.length} printings, ${Object.keys(ja).length + Object.keys(en).length} sealed prices, ${requests} requests`);
