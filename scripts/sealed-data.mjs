// What is inside sealed Magic products, for the Stacksmith app's Packs tab:
// the pure part of scripts/build-sealed.mjs (checked by
// scripts/sealed-data-check.mjs). Everything here works on MTGJSON's data
// (https://mtgjson.com, MIT): its set list (each set's sealed products and
// decks) and its booster tables (each booster type's slots, the sheets the
// slots draw from and every card's weight on its sheet).
//
// The app prices what is inside on the phone, from the prices it already
// holds (its daily price file), so these files carry no prices: only what
// a product holds and the odds of each card, by Scryfall id. They change
// when MTGJSON's data does, not daily.
//
// A product's contents are PARTS, each a small array:
//   ['c', scryfallId, finish, count]   a card (finish 0 nonfoil, 1 foil, 2 etched)
//   ['p', boosterKey, count]           packs of a booster type ('DSK/play')
//   ['d', deckKey, count]              a fixed deck list ('DSC/Death Toll')
//   ['s', productUuid, count]          other products ('a box holds 30 packs')
//   ['v', [[weight, parts], ...]]      one of several contents, by weight
// Items that are not cards (a deck box, a spindown, tokens) are left out.

export const SEALED_FORMAT = 1;

/** Booster types that exist only online (Arena's versions of a set's packs). */
export function isDigitalBooster(name) {
  return /(^|-)(arena|mtgo)($|-)/.test(name);
}

/**
 * Booster types of one non-English printing of a set (War of the Spark's
 * 'jp'): its cards are the set's own, in another language, and the app has
 * only the English printings' prices, so it would price them wrong.
 */
export function isForeignBooster(name) {
  return /^(jp|ja|japanese|italian|french|german|spanish|portuguese|chinese|korean|russian)$|-(jp|ja|japanese)$/.test(name);
}

/** A language a product's name says it is in. */
const LANGUAGE_IN_NAME = /\b(Japanese|Japan|Italian|French|German|Spanish|Portuguese|Chinese|Korean|Russian)\b/i;

/**
 * Products never listed:
 *  - online redemptions, which are not on any shelf;
 *  - a product in another language ("War of the Spark Japanese Booster
 *    Box", "Renaissance German Booster Pack", "Challenger Deck Japan
 *    2019"): it holds the set's cards in that language, and the app has
 *    only the English printings' prices (the owner, 2026-10-06: prices
 *    vary by language; Japan cannot be done yet). A Secret Lair drop in
 *    Japanese stays: its cards are their own Japanese printings, priced as
 *    such.
 */
export function isListedProduct(name, category, subtype) {
  if (subtype === 'mtgo_redemption') return false;
  if (LANGUAGE_IN_NAME.test(name) && subtype !== 'secret_lair' && subtype !== 'secret_lair_bundle') return false;
  return true;
}

/**
 * One CSV line's fields (MTGJSON's CSVs quote a field holding a comma or a
 * quote, doubling the quote). No field in the tables read here spans lines.
 */
export function parseCsvLine(line) {
  const out = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let value = '';
      i++;
      for (;;) {
        const q = line.indexOf('"', i);
        if (q < 0) throw new Error(`unterminated quote in ${line.slice(0, 80)}`);
        value += line.slice(i, q);
        if (line[q + 1] === '"') {
          value += '"';
          i = q + 2;
          continue;
        }
        i = q + 1;
        break;
      }
      out.push(value);
      if (line[i] === ',') i++;
      else break;
    } else {
      const comma = line.indexOf(',', i);
      if (comma < 0) {
        out.push(line.slice(i));
        break;
      }
      out.push(line.slice(i, comma));
      i = comma + 1;
      if (i === line.length) {
        out.push('');
        break;
      }
    }
  }
  return out;
}

/** Rows of a CSV text as objects keyed by its header. */
export function parseCsv(text) {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0);
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    if (fields.length !== header.length) throw new Error(`${fields.length} fields, header has ${header.length}: ${line.slice(0, 80)}`);
    const row = {};
    header.forEach((h, k) => (row[h] = fields[k]));
    return row;
  });
}

export const boosterKey = (set, name) => `${String(set).toUpperCase()}/${name}`;
export const deckKey = (set, name) => `${String(set).toUpperCase()}/${name}`;

/**
 * Every booster type, keyed 'SET/name', from MTGJSON's four booster tables
 * (rows as parseCsv gives them). `idOf(uuid)` gives a card's Scryfall id or
 * null. A booster:
 *   { c: [[weight, { sheetName: picks }], ...],
 *     s: { sheetName: { f: 0|1, t: totalWeight, c: [[scryfallId, weight], ...] } } }
 * A sheet keeps MTGJSON's total weight: a card that does not resolve keeps
 * its share of the odds (the app values it at nothing and says so) rather
 * than raise every other card's. Two uuids of one Scryfall card on one sheet
 * (a double-faced card's two faces) are one entry, their weights summed.
 * Digital boosters are left out. Returns { boosters, unresolved, merged }.
 */
export function buildBoosters({ contents, weights, sheets, sheetCards }, idOf) {
  const boosters = new Map();
  const get = (set, name) => {
    if (isDigitalBooster(name)) return null;
    const key = boosterKey(set, name);
    let b = boosters.get(key);
    if (!b) boosters.set(key, (b = { configs: new Map(), s: {} }));
    return b;
  };
  for (const r of weights) {
    const b = get(r.setCode, r.boosterName);
    if (!b) continue;
    b.configs.set(r.boosterIndex, { w: Number(r.boosterWeight), picks: {} });
  }
  for (const r of contents) {
    const b = get(r.setCode, r.boosterName);
    if (!b) continue;
    const config = b.configs.get(r.boosterIndex);
    if (!config) throw new Error(`no weight for ${r.setCode} ${r.boosterName} #${r.boosterIndex}`);
    config.picks[r.sheetName] = Number(r.sheetPicks);
  }
  for (const r of sheets) {
    const b = get(r.setCode, r.boosterName);
    if (!b) continue;
    b.s[r.sheetName] = { f: r.sheetIsFoil === 'true' ? 1 : 0, t: Number(r.sheetTotalWeight), cards: new Map() };
  }
  let unresolved = 0;
  let merged = 0;
  for (const r of sheetCards) {
    const b = get(r.setCode, r.boosterName);
    if (!b) continue;
    const sheet = b.s[r.sheetName];
    if (!sheet) throw new Error(`no sheet ${r.sheetName} in ${r.setCode} ${r.boosterName}`);
    const id = idOf(r.cardUuid);
    if (!id) {
      unresolved++;
      continue;
    }
    if (sheet.cards.has(id)) merged++;
    sheet.cards.set(id, (sheet.cards.get(id) ?? 0) + Number(r.cardWeight));
  }
  const out = new Map();
  for (const [key, b] of boosters) {
    const configs = [...b.configs.entries()]
      .sort((x, y) => Number(x[0]) - Number(y[0]))
      .map(([, c]) => [c.w, sortObject(c.picks)])
      .filter(([w]) => w > 0);
    if (!configs.length) continue;
    const s = {};
    for (const name of Object.keys(b.s).sort()) {
      const sheet = b.s[name];
      const cards = [...sheet.cards.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
      s[name] = { f: sheet.f, t: sheet.t, c: cards };
    }
    // A config naming a sheet the tables do not have cannot be valued.
    if (configs.some(([, picks]) => Object.keys(picks).some((name) => !s[name]))) continue;
    out.set(key, { c: configs, s });
  }
  return { boosters: out, unresolved, merged };
}

function sortObject(o) {
  const out = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k];
  return out;
}

/** A finish code from MTGJSON's card fields: 2 etched, 1 foil, 0 nonfoil. */
export function finishCode({ foil, finishes, isFoil, isEtched }) {
  if (isEtched) return 2;
  if (Array.isArray(finishes) && finishes.length === 1 && finishes[0] === 'etched') return 2;
  if (foil || isFoil) return 1;
  if (Array.isArray(finishes) && finishes.length === 1 && finishes[0] === 'foil') return 1;
  return 0;
}

/**
 * A deck list as [[scryfallId, count, finish], ...]: its commander(s), main
 * deck, sideboard, planes and schemes (all cards a player gets); tokens and
 * the oversized display commander are left out. Returns null when a card
 * does not resolve, so a deck is never valued short.
 */
export function deckCards(deck, idOf) {
  const totals = new Map();
  for (const board of ['commander', 'mainBoard', 'sideBoard', 'planes', 'schemes']) {
    for (const card of deck[board] ?? []) {
      const id = idOf(card.uuid);
      if (!id) return null;
      const key = `${id}|${finishCode(card)}`;
      totals.set(key, (totals.get(key) ?? 0) + Number(card.count ?? 1));
    }
  }
  if (!totals.size) return null;
  return [...totals.entries()]
    .map(([key, n]) => {
      const [id, f] = key.split('|');
      return [id, n, Number(f)];
    })
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[2] - y[2]));
}

/**
 * A product's contents as parts (see the header), or null when any part
 * that holds cards cannot be resolved: a product is listed only when all
 * of it can be valued. `has` answers whether a booster, deck or product
 * exists: has.booster(key), has.deck(key), has.product(uuid).
 */
export function productParts(contents, idOf, has) {
  if (!contents) return null;
  const parts = [];
  for (const card of contents.card ?? []) {
    const id = idOf(card.uuid);
    if (!id) return null;
    parts.push(['c', id, finishCode(card), Number(card.count ?? 1)]);
  }
  for (const pack of contents.pack ?? []) {
    const key = boosterKey(pack.set, pack.code);
    if (isDigitalBooster(pack.code) || isForeignBooster(pack.code) || !has.booster(key)) return null;
    parts.push(['p', key, Number(pack.count ?? 1)]);
  }
  for (const deck of contents.deck ?? []) {
    const key = deckKey(deck.set, deck.name);
    if (!has.deck(key)) return null;
    parts.push(['d', key, Number(deck.count ?? 1)]);
  }
  for (const sealed of contents.sealed ?? []) {
    if (!sealed.uuid || !has.product(sealed.uuid)) return null;
    parts.push(['s', sealed.uuid, Number(sealed.count ?? 1)]);
  }
  for (const variable of contents.variable ?? []) {
    const options = [];
    for (const config of variable.configs ?? []) {
      const weight = Number(config.variable_config?.[0]?.weight ?? 1);
      const inner = productParts(config, idOf, has);
      if (!inner || !inner.length) return null;
      options.push([weight, inner]);
    }
    if (!options.length) return null;
    parts.push(['v', options]);
  }
  return parts;
}

/** Words of a name for comparing: lower case, apostrophes, digit commas and punctuation out. */
function words(name) {
  return String(name)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/(\d),(\d)/g, '$1$2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** Words that never make a set's name match on their own. */
const SMALL_WORDS = new Set(['the', 'of', 'a', 'an', 'and', 'in', 'magic', 'mtg']);

/**
 * A product's name inside its set's page: the set's name taken off the
 * front ("Duskmourn House of Horror Play Booster Box" in "Duskmourn: House
 * of Horror" is "Play Booster Box"). The run of the set's words may start a
 * few words in ("Magic 30th Anniversary Edition Booster Box" is "Booster
 * Box") and may stop short of the set's whole name ("Bloomburrow Deluxe
 * Commander Kit" in "Bloomburrow Commander" is "Deluxe Commander Kit"), as
 * long as it holds a word that is not a small one. The product's own
 * spelling of the rest is kept. A Commander set's decks keep "Commander"
 * ("Commander Deck Death Toll", not "Deck Death Toll").
 */
export function shortName(name, setName) {
  const original = String(name).trim();
  const tokens = original.split(/\s+/);
  // Each token's words, with the token it came from.
  const flat = [];
  tokens.forEach((t, k) => {
    for (const w of words(t)) flat.push({ w, k });
  });
  const setWords = words(setName);
  let best = null;
  for (let start = 0; start <= 3 && start < flat.length; start++) {
    let n = 0;
    while (n < setWords.length && start + n < flat.length && flat[start + n].w === setWords[n]) n++;
    if (!n || !setWords.slice(0, n).some((w) => !SMALL_WORDS.has(w))) continue;
    if (!best || n > best.n) best = { start, n };
  }
  if (!best) return original;
  const end = flat[best.start + best.n - 1].k;
  let rest = tokens.slice(end + 1).join(' ').trim();
  if (!rest) return original;
  if (setWords.includes('commander') && setWords.slice(0, best.n).includes('commander') && /^decks?\b/i.test(rest)) rest = `Commander ${rest}`;
  return rest;
}
