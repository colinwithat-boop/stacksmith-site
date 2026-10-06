// Builds sealed/, what is inside every sealed Magic product the Stacksmith
// app's Packs tab can value: sealed/index.json (the sets, newest first) and
// sealed/sets/set-<CODE>.json (one set's products, the booster types they hold
// with every card's odds, and their deck lists). From MTGJSON
// (https://mtgjson.com, MIT): SetList.json (each set's sealed products and
// decks), the four booster tables and the card and token identifiers
// (MTGJSON uuid -> Scryfall id), ~22 MB gzipped in all. The pure part, and
// the format, are in scripts/sealed-data.mjs.
//
// The files carry no prices and no build time, so they change only when
// MTGJSON's data does: the sealed workflow (.github/workflows/sealed.yml)
// commits them when they changed, and the prices workflow publishes them
// with the site. By hand:
//
//   node scripts/build-sealed.mjs [--out sealed]
import { createGunzip } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

import {
  SEALED_FORMAT,
  buildBoosters,
  deckCards,
  deckKey,
  isListedProduct,
  parseCsv,
  parseCsvLine,
  productParts,
  shortName,
} from './sealed-data.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const i = args.indexOf('--out');
const OUT = path.resolve(ROOT, i >= 0 ? args[i + 1] : 'sealed');
const UA = 'Stacksmith sealed (https://stacksmith-app.pages.dev/)';
const API = 'https://mtgjson.com/api/v5/';

async function open(name) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(API + name, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(300_000) });
      if (!res.ok || !res.body) throw new Error(`${res.status} for ${name}`);
      return Readable.fromWeb(res.body).pipe(createGunzip());
    } catch (e) {
      if (attempt >= 3) throw e;
      console.warn(`${name}: ${e instanceof Error ? e.message : e}, trying again`);
      await new Promise((r) => setTimeout(r, 10_000 * attempt));
    }
  }
}

async function text(name) {
  const chunks = [];
  for await (const chunk of await open(name)) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/** uuid -> Scryfall id from an identifiers CSV, read line by line (it is ~100 MB unpacked). */
async function readIdentifiers(name, into) {
  let rest = '';
  let header = null;
  let uuidAt = -1;
  let scryfallAt = -1;
  const take = (line) => {
    if (!line) return;
    const fields = parseCsvLine(line.replace(/\r$/, ''));
    if (!header) {
      header = fields;
      uuidAt = header.indexOf('uuid');
      scryfallAt = header.indexOf('scryfallId');
      if (uuidAt < 0 || scryfallAt < 0) throw new Error(`${name}: no uuid or scryfallId column`);
      return;
    }
    if (fields[scryfallAt]) into.set(fields[uuidAt], fields[scryfallAt]);
  };
  for await (const chunk of await open(name)) {
    rest += chunk.toString('utf8');
    let nl;
    while ((nl = rest.indexOf('\n')) >= 0) {
      take(rest.slice(0, nl));
      rest = rest.slice(nl + 1);
    }
  }
  take(rest);
}

const meta = JSON.parse(await (await fetch(API + 'Meta.json', { headers: { 'User-Agent': UA } })).text());
console.log(`MTGJSON ${meta.meta?.version ?? meta.data?.version}`);

const ids = new Map();
await readIdentifiers('csv/cardIdentifiers.csv.gz', ids);
const cardIds = ids.size;
await readIdentifiers('csv/tokenIdentifiers.csv.gz', ids);
console.log(`${cardIds} cards and ${ids.size - cardIds} tokens with a Scryfall id`);
const idOf = (uuid) => ids.get(uuid) ?? null;

const [contents, weights, sheets, sheetCards] = await Promise.all(
  ['setBoosterContents', 'setBoosterContentWeights', 'setBoosterSheets', 'setBoosterSheetCards'].map(async (t) => parseCsv(await text(`csv/${t}.csv.gz`))),
);
const { boosters, unresolved, merged } = buildBoosters({ contents, weights, sheets, sheetCards }, idOf);
console.log(`${boosters.size} booster types; ${unresolved} sheet entries with no Scryfall id, ${merged} faces merged`);

const setList = JSON.parse(await text('SetList.json.gz')).data.filter((s) => !s.isOnlineOnly);
const setByCode = new Map(setList.map((s) => [s.code.toUpperCase(), s]));

const decks = new Map();
let unresolvedDecks = 0;
for (const set of setList) {
  for (const deck of set.decks ?? []) {
    const key = deckKey(set.code, deck.name);
    if (decks.has(key)) continue;
    const cards = deckCards(deck, idOf);
    if (!cards) unresolvedDecks++;
    decks.set(key, cards);
  }
}
console.log(`${decks.size} decks, ${unresolvedDecks} with a card that does not resolve`);

// Every product, and its parts once resolved (null: cannot be valued).
const productByUuid = new Map();
for (const set of setList) for (const p of set.sealedProduct ?? []) productByUuid.set(p.uuid, { set, p });
const resolved = new Map();
const resolving = new Set();
const has = {
  booster: (key) => boosters.has(key),
  deck: (key) => !!decks.get(key),
  product: (uuid) => resolve(uuid) !== null,
};
function resolve(uuid) {
  if (resolved.has(uuid)) return resolved.get(uuid);
  const entry = productByUuid.get(uuid);
  if (!entry || resolving.has(uuid)) return null;
  resolving.add(uuid);
  const parts = productParts(entry.p.contents, idOf, has);
  resolving.delete(uuid);
  const out = parts && parts.length ? parts : null;
  resolved.set(uuid, out);
  return out;
}

function productEntry(set, p) {
  const out = {
    id: p.uuid,
    name: p.name,
    short: shortName(p.name, set.name),
    cat: p.category ?? null,
    sub: p.subtype ?? null,
    date: p.releaseDate ?? set.releaseDate ?? null,
  };
  const tcg = p.identifiers?.tcgplayerProductId;
  if (tcg) out.tcg = String(tcg);
  // Cardmarket's product id: its price for the product, for a phone priced in euros.
  const mcm = p.identifiers?.mcmId;
  if (mcm) out.mcm = String(mcm);
  out.parts = resolve(p.uuid);
  return out;
}

/** Everything a set's products refer to: boosters, decks, and other sets' products. */
function collect(parts, need) {
  for (const part of parts) {
    if (part[0] === 'p') need.boosters.add(part[1]);
    else if (part[0] === 'd') need.decks.add(part[1]);
    else if (part[0] === 's') {
      if (need.products.has(part[1])) continue;
      need.products.add(part[1]);
      collect(resolve(part[1]), need);
    } else if (part[0] === 'v') for (const [, inner] of part[1]) collect(inner, need);
  }
}

// Every product left out for its language, for the log (sealed-data.mjs isListedProduct).
const foreign = setList.flatMap((set) => (set.sealedProduct ?? []).filter((p) => !isListedProduct(p.name, p.category, p.subtype) && p.subtype !== 'mtgo_redemption').map((p) => `${set.code} ${p.name}`));
console.log(`${foreign.length} products left out for their language:\n  ${foreign.join('\n  ')}`);

const sortedKeys = (map) => Object.fromEntries([...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));

fs.mkdirSync(path.join(OUT, 'sets'), { recursive: true });
const index = [];
const written = new Set();
let listedProducts = 0;
let bytes = 0;
for (const set of setList) {
  const code = set.code.toUpperCase();
  const listed = (set.sealedProduct ?? [])
    .filter((p) => isListedProduct(p.name, p.category, p.subtype) && resolve(p.uuid))
    .map((p) => productEntry(set, p))
    .sort((a, b) => (a.date ?? '') < (b.date ?? '') ? 1 : (a.date ?? '') > (b.date ?? '') ? -1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  if (!listed.length) continue;
  const need = { boosters: new Set(), decks: new Set(), products: new Set() };
  for (const p of listed) collect(p.parts, need);
  const listedIds = new Set(listed.map((p) => p.id));
  const refs = new Map();
  for (const uuid of need.products) {
    if (listedIds.has(uuid)) continue;
    const { set: other, p } = productByUuid.get(uuid);
    refs.set(uuid, { name: p.name, parts: resolve(uuid), set: other.code.toUpperCase() });
  }
  const file = {
    v: SEALED_FORMAT,
    code,
    name: set.name,
    date: set.releaseDate ?? null,
    type: set.type ?? null,
    group: set.tcgplayerGroupId ?? null,
    products: listed,
    refs: sortedKeys(refs),
    boosters: sortedKeys(new Map([...need.boosters].map((k) => [k, boosters.get(k)]))),
    decks: sortedKeys(new Map([...need.decks].map((k) => [k, decks.get(k)]))),
  };
  const body = JSON.stringify(file) + '\n';
  // set-CON.json, not CON.json: CON (Conflux), like PRN, AUX or NUL, is a
  // device name Windows will not make a file of, so a clone there lost it.
  const fileName = `set-${code}.json`;
  fs.writeFileSync(path.join(OUT, 'sets', fileName), body);
  written.add(fileName);
  bytes += body.length;
  listedProducts += listed.length;
  // Dated by its newest product when that is later than the set: Secret
  // Lair's set is dated 2019 and would sort below every set since, while
  // its drops come out every week.
  const newest = listed.reduce((d, p) => ((p.date ?? '') > d ? p.date : d), set.releaseDate ?? '');
  index.push({ code, name: set.name, date: newest || null, type: set.type ?? null, n: listed.length });
}
// A set that no longer has a product to value loses its file.
for (const name of fs.readdirSync(path.join(OUT, 'sets'))) if (!written.has(name)) fs.rmSync(path.join(OUT, 'sets', name));

index.sort((a, b) => ((a.date ?? '') < (b.date ?? '') ? 1 : (a.date ?? '') > (b.date ?? '') ? -1 : a.code < b.code ? -1 : 1));
if (index.length < 100 || listedProducts < 1000) throw new Error(`only ${index.length} sets and ${listedProducts} products: not writing a short index`);
const indexBody = `{"v":${SEALED_FORMAT},"sets":[\n${index.map((s) => JSON.stringify(s)).join(',\n')}\n]}\n`;
fs.writeFileSync(path.join(OUT, 'index.json'), indexBody);
console.log(`${index.length} sets, ${listedProducts} products, ${Math.round(bytes / 1024)} KB of set files, index ${Math.round(indexBody.length / 1024)} KB`);
