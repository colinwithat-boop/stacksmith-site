// Builds home/latest.json, what the Stacksmith app's Home tab shows under
// "Coming up": the next set releases (with their names in the app's
// languages, from sets/names.json) and the Secret Lair drops from a few
// weeks back to the newest announced. One file instead of two requests on
// every phone (Scryfall's set list and names.json; the app falls back to
// those when this file cannot be had). The shapes and the grouping are in
// scripts/home-data.mjs. Rebuilt on every publish of the site, on purpose:
// the file is not versioned, and a later run the same day only brings it
// up to date. By hand:
//
//   node scripts/build-home.mjs [--out _site/home/latest.json] [--names sets/names.json]
//
// Data by Scryfall (https://scryfall.com) and MTGJSON (https://mtgjson.com,
// MIT), credited in the app.
import { gunzipSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DROPS_BACK_DAYS, dayBefore, groupDrops, homeBody, upcomingSets } from './home-data.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const OUT = path.resolve(ROOT, arg('--out', '_site/home/latest.json'));
const NAMES = path.resolve(ROOT, arg('--names', 'sets/names.json'));
const UA = `Stacksmith home (${process.env.SITE_URL || 'https://stacksmith-app.pages.dev/'})`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scryfall(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
  if (res.status === 404) return null; // a search with no cards
  if (!res.ok) throw new Error(`Scryfall ${res.status} for ${url}`);
  return res.json();
}

const today = new Date().toISOString().slice(0, 10);

// The set list: required (no file without it; the live one is kept).
const setsJson = await scryfall('https://api.scryfall.com/sets');
if (!Array.isArray(setsJson?.data)) throw new Error('Scryfall sent no set list');
const sets = upcomingSets(setsJson.data, today);
await sleep(600);

// Secret Lair cards from DROPS_BACK_DAYS ago on, every page. A failure
// leaves the drops out of today's file rather than the sets.
let cards = [];
try {
  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`e:sld date>=${dayBefore(today, DROPS_BACK_DAYS)}`)}&unique=prints&include_extras=true&order=released&dir=desc`;
  while (url) {
    const page = await scryfall(url);
    if (page === null) break;
    cards.push(...(page.data ?? []));
    url = page.has_more ? page.next_page : null;
    if (url) await sleep(600);
  }
} catch (e) {
  console.warn(`::warning::Secret Lair cards could not be read: ${e instanceof Error ? e.message : e}`);
  cards = [];
}

// MTGJSON's drop names by collector number. Without them, every day's
// cards show as one unnamed "Secret Lair" drop.
const drops = new Map();
try {
  const res = await fetch('https://mtgjson.com/api/v5/SLD.json.gz', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`MTGJSON ${res.status}`);
  const sld = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8'));
  for (const c of sld.data?.cards ?? []) {
    const name = Array.isArray(c.subsets) && typeof c.subsets[0] === 'string' ? c.subsets[0] : null;
    if (name && typeof c.number === 'string' && !drops.has(c.number)) drops.set(c.number, name);
  }
} catch (e) {
  console.warn(`::warning::MTGJSON's Secret Lair names could not be read: ${e instanceof Error ? e.message : e}`);
}
const waves = groupDrops(cards, (n) => drops.get(n) ?? null, today);

let names = {};
try {
  names = JSON.parse(fs.readFileSync(NAMES, 'utf8')).sets ?? {};
} catch (e) {
  console.warn(`::warning::sets/names.json could not be read: ${e instanceof Error ? e.message : e}`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const body = homeBody({ built: new Date().toISOString(), sets, names, waves });
fs.writeFileSync(OUT, body);
const dropCount = waves.reduce((n, w) => n + w.drops.length, 0);
console.log(`${sets.length} upcoming sets, ${cards.length} Secret Lair cards in ${waves.length} sale days (${dropCount} drops, ${drops.size} names known), ${(body.length / 1024).toFixed(1)} KB -> ${OUT}`);
