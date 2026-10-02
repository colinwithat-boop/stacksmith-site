// Builds prices/latest.json, the Stacksmith app's daily price file, from
// Scryfall's default_cards bulk data (every card in English, or in its
// printed language when there is no English printing; ~80 MB gzipped
// JSONL): one row per paper printing that has any price, as
//   [scryfall id, usd, usd_foil, usd_etched, eur, eur_foil, tcgplayer id, tcgplayer etched id]
// with Scryfall's decimal strings (TCGplayer Market in dollars, Cardmarket
// in euros) or null, and the ids as numbers or null. The app applies it
// once a day (lib/prices/priceFile.ts in the app repo). The prices
// workflow runs this and publishes the site; by hand:
//
//   node scripts/build-prices.mjs [--out _site/prices/latest.json]
//
// Data by Scryfall (https://scryfall.com), under its terms: the file is a
// cache for this app's users, credited in the app.
import { createGunzip } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const i = args.indexOf('--out');
const OUT = path.resolve(ROOT, i >= 0 ? args[i + 1] : '_site/prices/latest.json');
const UA = 'Stacksmith prices (https://colinwithat-boop.github.io/stacksmith-site/)';

const meta = await (await fetch('https://api.scryfall.com/bulk-data/default-cards', { headers: { 'User-Agent': UA, Accept: 'application/json' } })).json();
const url = meta.jsonl_download_uri;
if (!url) throw new Error('Scryfall lists no JSONL download for default_cards');
const date = String(meta.updated_at).slice(0, 10);
console.log(`default_cards of ${meta.updated_at}, ${Math.round((meta.compressed_size ?? 0) / 1e6)} MB: ${url}`);

const res = await fetch(url, { headers: { 'User-Agent': UA } });
if (!res.ok || !res.body) throw new Error(`${res.status} for ${url}`);
const num = (s) => (s === null || s === undefined ? null : s);
const rows = [];
let cards = 0;
let rest = '';
// Split on '\n' only: Scryfall's text carries raw U+2028/2029, which a
// line reader would take as line ends.
const take = (line) => {
  const trimmed = line.trim().replace(/,$/, '');
  if (!trimmed.startsWith('{')) return;
  const c = JSON.parse(trimmed);
  cards++;
  if (c.digital) return;
  const p = c.prices ?? {};
  if (!p.usd && !p.usd_foil && !p.usd_etched && !p.eur && !p.eur_foil) return;
  rows.push([c.id, num(p.usd), num(p.usd_foil), num(p.usd_etched), num(p.eur), num(p.eur_foil), c.tcgplayer_id ?? null, c.tcgplayer_etched_id ?? null]);
};
for await (const chunk of Readable.fromWeb(res.body).pipe(createGunzip())) {
  rest += chunk.toString('utf8');
  let nl;
  while ((nl = rest.indexOf('\n')) >= 0) {
    take(rest.slice(0, nl));
    rest = rest.slice(nl + 1);
  }
}
if (rest.trim()) take(rest);
rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const built = new Date().toISOString();
// One row per line: a diff of two days reads, and gzip does as well.
const body = `{"v":1,"date":"${date}","built":"${built}","count":${rows.length},"rows":[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]}\n`;
fs.writeFileSync(OUT, body);
console.log(`${cards} cards read, ${rows.length} paper printings with a price, ${(body.length / 1e6).toFixed(1)} MB -> ${OUT}`);
