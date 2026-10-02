// Builds facts/latest.json, the Stacksmith app's card facts: per card
// (oracle id), its legality in the app's formats, its colour identity and
// Scryfall's Game Changer flag, from Scryfall's oracle_cards bulk data
// (one object per card, ~25 MB gzipped JSONL). The app reads it about once
// a week into its card_legalities table (lib/cardData/facts.ts in the app
// repo), so it no longer asks Scryfall card by card. The prices workflow
// runs this beside the price file; by hand:
//
//   node scripts/build-facts.mjs [--out _site/facts/latest.json]
//
// Row: [oracle id, legality, identity, game changer], where legality is one
// letter per format in `formats` order (L legal, N not legal, B banned, R
// restricted, - not listed), identity is WUBRG letters in that order ('' is
// colourless, null when Scryfall gives none) and game changer is 1, 0 or
// null. A reversible card's faces carry their own oracle ids: each gets the
// card's row, as the app's per-card fetch stored them (oracleIdsOf).
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
const OUT = path.resolve(ROOT, i >= 0 ? args[i + 1] : '_site/facts/latest.json');
const UA = 'Stacksmith facts (https://colinwithat-boop.github.io/stacksmith-site/)';

// The app's LEGALITY_FORMATS (lib/cardData/legality.ts), in its order.
const FORMATS = [
  'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'pauper',
  'oathbreaker', 'paupercommander', 'duel', 'timeless', 'standardbrawl', 'brawl', 'competitivebrawl',
];
const LETTER = { legal: 'L', not_legal: 'N', banned: 'B', restricted: 'R' };
const WUBRG = ['W', 'U', 'B', 'R', 'G'];

const meta = await (await fetch('https://api.scryfall.com/bulk-data/oracle-cards', { headers: { 'User-Agent': UA, Accept: 'application/json' } })).json();
const url = meta.jsonl_download_uri;
if (!url) throw new Error('Scryfall lists no JSONL download for oracle_cards');
const date = String(meta.updated_at).slice(0, 10);
console.log(`oracle_cards of ${meta.updated_at}, ${Math.round((meta.compressed_size ?? 0) / 1e6)} MB: ${url}`);

const res = await fetch(url, { headers: { 'User-Agent': UA } });
if (!res.ok || !res.body) throw new Error(`${res.status} for ${url}`);
const rows = new Map();
let cards = 0;
let rest = '';
const take = (line) => {
  const trimmed = line.trim().replace(/,$/, '');
  if (!trimmed.startsWith('{')) return;
  const c = JSON.parse(trimmed);
  cards++;
  const legality = FORMATS.map((f) => LETTER[c.legalities?.[f]] ?? '-').join('');
  const identity = Array.isArray(c.color_identity) ? WUBRG.filter((x) => c.color_identity.includes(x)).join('') : null;
  const gc = c.game_changer === undefined ? null : c.game_changer ? 1 : 0;
  const ids = new Set();
  if (c.oracle_id) ids.add(c.oracle_id);
  for (const face of c.card_faces ?? []) if (face.oracle_id) ids.add(face.oracle_id);
  for (const id of ids) rows.set(id, [id, legality, identity, gc]);
};
// Split on '\n' only: Scryfall's text carries raw U+2028/2029.
for await (const chunk of Readable.fromWeb(res.body).pipe(createGunzip())) {
  rest += chunk.toString('utf8');
  let nl;
  while ((nl = rest.indexOf('\n')) >= 0) {
    take(rest.slice(0, nl));
    rest = rest.slice(nl + 1);
  }
}
if (rest.trim()) take(rest);
const sorted = [...rows.values()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
if (sorted.length < 20000) throw new Error(`only ${sorted.length} cards: not publishing a short file`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const built = new Date().toISOString();
const body = `{"v":1,"date":"${date}","built":"${built}","formats":${JSON.stringify(FORMATS)},"count":${sorted.length},"rows":[\n${sorted.map((r) => JSON.stringify(r)).join(',\n')}\n]}\n`;
fs.writeFileSync(OUT, body);
console.log(`${cards} cards read, ${sorted.length} oracle ids, ${(body.length / 1e6).toFixed(2)} MB -> ${OUT}`);
