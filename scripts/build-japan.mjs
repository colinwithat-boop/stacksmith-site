// Builds japan/cards.json and japan/sealed.json, the app's "Japan" price
// source: the Japanese shops' files (hareruya/, bigweb/, as the prices
// workflow just built or republished them under _site) merged into one,
// the cheapest in-stock price per cell and the shop that has it
// (scripts/japan-data.mjs). No requests: a merge of what is on disk, so
// no age rule; a shop whose files are missing is left out and said.
//
//   node scripts/build-japan.mjs [--site _site]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { japanCardsBody, japanSealedBody, mergeCardRows, mergeSealed } from './japan-data.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const SITE = path.resolve(ROOT, arg('--site', '_site'));
const SHOPS = ['hareruya', 'bigweb'];

const read = (shop, name) => {
  const file = path.join(SITE, shop, name);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.warn(`::warning::${shop}/${name} could not be read: ${e instanceof Error ? e.message : e}`);
    return null;
  }
};

const cards = {};
const sealed = {};
const shops = {};
for (const shop of SHOPS) {
  const c = read(shop, 'cards.json');
  const s = read(shop, 'sealed.json');
  if (c && c.source === shop && Array.isArray(c.rows)) {
    cards[shop] = c;
    shops[shop] = { built: c.built ?? null, printings: c.rows.length };
  } else console.warn(`::warning::no ${shop}/cards.json to merge`);
  if (s && s.source === shop && s.ja && s.en) {
    sealed[shop] = s;
    shops[shop] = { ...(shops[shop] ?? {}), sealed: Object.keys(s.ja).length + Object.keys(s.en).length };
  }
}
if (Object.keys(cards).length === 0) {
  console.error('::error::no shop file to merge: japan/ is left as it is');
  process.exit(1);
}
const rows = mergeCardRows(cards);
const merged = mergeSealed(sealed);
const built = new Date().toISOString();
// The newest shop read: the app dates the file by it.
const scraped = Object.values(cards).map((c) => c.scraped).filter((d) => typeof d === 'string').sort().pop() ?? built;
const dir = path.join(SITE, 'japan');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'cards.json'), japanCardsBody({ built, scraped, shops, rows }));
fs.writeFileSync(path.join(dir, 'sealed.json'), japanSealedBody({ built, scraped, shops, ja: merged.ja, en: merged.en }));
const byShop = {};
for (const r of rows) byShop[r[8]] = (byShop[r[8]] ?? 0) + 1;
console.log(`japan/: ${rows.length} printings (${JSON.stringify(byShop)}), ${Object.keys(merged.ja).length} Japanese and ${Object.keys(merged.en).length} English sealed prices, from ${Object.keys(shops).join(' and ')}`);
