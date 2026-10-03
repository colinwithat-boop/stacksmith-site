// Builds the Stacksmith app's daily price files in prices/ from Scryfall's
// default_cards bulk data (every card in English, or in its printed
// language when there is no English printing; ~80 MB gzipped JSONL): one
// row per paper printing that has any price, as
//   [scryfall id, usd, usd_foil, usd_etched, eur, eur_foil, tcgplayer id, tcgplayer etched id]
// with Scryfall's decimal strings (TCGplayer Market in dollars, Cardmarket
// in euros) or null, and the ids as numbers or null. The layout (a full
// file, the day's change file, version.json, latest.json) is
// scripts/price-changes.mjs; the app applies it once a day
// (lib/prices/priceFile.ts in the app repo).
//
// A VERSION is made once a day, by the morning run (NEW_VERSION=true; or
// by hand, ticking it), so the change file always starts from the version
// phones took the day before. Scryfall refreshes its bulk data every ~12 h,
// and a version from a push or the weekly set names' run in between would
// leave every phone that skipped it to download the full file the next
// morning. Every other run publishes the live files again byte for byte,
// as does a morning run whose bulk data or rows are the live version's.
// Another run builds only when the live version MISSED today's slot (built
// before the last PRICE_SLOT_UTC, the morning run's time) AND Scryfall has
// a new day's data (18 h past the live version's): the morning run failed
// or was cancelled, and the afternoon catch-up run (or a push) stands in.
// A live file that is there but cannot be read (a timeout, a 5xx) fails the
// run, so the live site stays as it is; only a 404 means "none". By hand:
//
//   node scripts/build-prices.mjs [--dir _site/prices] [--live <url>|--no-live]
//
// --live defaults to $SITE_URL + 'prices/' (the workflow sets SITE_URL:
// the one place the site's address lives, beside the app's lib/site.ts).
//
// Data by Scryfall (https://scryfall.com), under its terms: the files are
// a cache for this app's users, credited in the app.
import { createGunzip } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

import { changesBody, changesName, diffRows, fullBody, fullName, idOf, readVersion, versionBody } from './price-changes.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const SITE_URL = process.env.SITE_URL || 'https://stacksmith-app.pages.dev/';
const DIR = path.resolve(ROOT, arg('--dir', '_site/prices'));
const LIVE = args.includes('--no-live') ? null : arg('--live', `${SITE_URL.replace(/\/?$/, '/')}prices/`);
const UA = `Stacksmith prices (${SITE_URL})`;
/** Whether this run may make a new version (the morning run; unset, as by hand, it may). */
const MAY_BUILD = process.env.NEW_VERSION === undefined || process.env.NEW_VERSION === 'true';
/** The morning run's time (UTC, "HH:MM"), as prices.yml's first cron. */
const SLOT = (process.env.PRICE_SLOT_UTC || '10:20').split(':').map(Number);
/** Scryfall's data counts as a new day's this long after the live version's (its refreshes are ~12 h apart). */
const NEW_DAY_MS = 18 * 60 * 60 * 1000;
/** The last slot at or before `now`. */
function lastSlot(now) {
  const d = new Date(now);
  const slot = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), SLOT[0], SLOT[1]);
  return slot <= now ? slot : slot - 86_400_000;
}
/** Stops the run with an error: the build job fails, nothing is deployed, the live site stays as it is. */
function fail(why) {
  console.error(`::error::${why}: the live site is left as it is`);
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(DIR, { recursive: true });
const write = (name, text) => fs.writeFileSync(path.join(DIR, name), text);

/**
 * A file the live site serves: its text, null when it has none (404, 410),
 * or undefined when it could not be read after three tries (a timeout, a
 * 5xx, a 429), which must never be taken for "none".
 */
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
  console.warn(`::warning::could not read the live ${name}`);
  return undefined;
}

/**
 * The live version's files, checked to carry its id: undefined when the
 * full file could not be read, null when it is not there (or not this
 * version's). Its change file is best effort (the next version's change
 * file needs only the full file; a phone finding it missing takes the full
 * file), null when it cannot be had.
 */
async function liveFiles(version) {
  const full = await live(version.full);
  if (full === undefined) return undefined;
  if (full === null || idOf(full) !== version.id) return null;
  let changes = null;
  if (version.changes !== null) {
    const c = await live(version.changes.file);
    changes = typeof c === 'string' && idOf(c) === version.id ? c : null;
  }
  return { full, changes };
}

/** Publishes the live version again, byte for byte (the previous version's files too, as far as they can be had). */
async function republish(version, versionText, files, why) {
  write(version.full, files.full);
  write('latest.json', files.full);
  if (files.changes !== null) write(version.changes.file, files.changes);
  for (const name of version.keep) {
    const text = await live(name);
    if (typeof text === 'string') write(name, text);
  }
  write('version.json', versionText);
  console.log(`${why}: the live price files (${version.id}) published again as they are`);
  process.exit(0);
}

const meta = await (await fetch('https://api.scryfall.com/bulk-data/default-cards', { headers: { 'User-Agent': UA, Accept: 'application/json' } })).json();
const url = meta.jsonl_download_uri;
if (!url || typeof meta.updated_at !== 'string') throw new Error('Scryfall lists no JSONL download for default_cards');
const id = meta.updated_at;
const date = id.slice(0, 10);
console.log(`default_cards of ${id}, ${Math.round((meta.compressed_size ?? 0) / 1e6)} MB: ${url}`);

const versionText = await live('version.json');
if (versionText === undefined) fail('version.json could not be read');
const version = versionText === null ? null : readVersion(versionText);
// The morning run did not make today's version, and Scryfall has a new day's data.
const missedSlot = version !== null && Date.parse(version.built) < lastSlot(Date.now()) && Date.parse(id) - Date.parse(version.id) >= NEW_DAY_MS;
let liveSet = null;
if (version !== null && (version.id === id || (!MAY_BUILD && !missedSlot))) {
  liveSet = await liveFiles(version);
  if (liveSet === undefined) fail(`${version.full} could not be read`);
  if (liveSet !== null) await republish(version, versionText, liveSet, version.id === id ? "Scryfall's data unchanged" : 'Not the morning run');
  console.warn('::warning::the live price files are not there: building them again');
}

// The previous version, for the change file: the live one, else (it IS
// this id, and its files could not be had) the one it starts from, else
// (the site from before the change file) latest.json when it has an id.
let prev = null;
if (version !== null && version.id !== id) {
  const files = liveSet ?? (await liveFiles(version));
  if (files === undefined) fail(`${version.full} could not be read`);
  if (files !== null) prev = { id: version.id, name: version.full, text: files.full, changes: files.changes === null ? null : { name: version.changes.file, text: files.changes } };
} else if (version !== null && version.changes !== null) {
  const from = version.changes.from;
  const text = await live(fullName(from));
  if (text === undefined) fail(`${fullName(from)} could not be read`);
  if (typeof text === 'string' && idOf(text) === from) prev = { id: from, name: fullName(from), text, changes: null };
} else if (version === null) {
  const text = await live('latest.json');
  if (text === undefined) fail('latest.json could not be read');
  const pid = typeof text === 'string' ? idOf(text) : null;
  if (pid !== null && pid !== id) prev = { id: pid, name: fullName(pid), text, changes: null };
}
console.log(prev === null ? '::warning::no previous file with an id: no change file this time' : `previous file ${prev.id}`);

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

const prevRows = prev === null ? null : JSON.parse(prev.text).rows;
// Scryfall's data moved on with no price changed (its evening refresh, often):
// no new version, so phones holding the live one have nothing to fetch.
if (prev !== null && version !== null && prev.id === version.id && diffRows(prevRows, rows).rows.length === 0) {
  await republish(version, versionText, { full: prev.text, changes: prev.changes?.text ?? null }, `No price changed since ${version.id}`);
}

const built = new Date().toISOString();
const body = fullBody({ id, date, built, rows });
write(fullName(id), body);
write('latest.json', body);
console.log(`${cards} cards read, ${rows.length} paper printings with a price, ${(body.length / 1e6).toFixed(1)} MB -> ${fullName(id)} and latest.json`);

let changes = null;
const keep = [];
if (prev !== null) {
  const made = changesBody({ from: prev.id, id, date, built, prevRows, rows });
  if (made === null) {
    console.warn(`::warning::${rows.length} rows against ${prevRows.length} before: no change file, phones take the full file`);
  } else {
    write(changesName(prev.id, id), made.body);
    changes = { from: prev.id, count: made.count, removed: made.removed };
    console.log(`change file: ${made.count} rows (${made.removed} without a price now), ${(made.body.length / 1e6).toFixed(1)} MB -> ${changesName(prev.id, id)}`);
  }
  // The previous version's files once more, for a version.json a cache
  // still holds from before this deploy.
  write(prev.name, prev.text);
  keep.push(prev.name);
  if (prev.changes !== null) {
    write(prev.changes.name, prev.changes.text);
    keep.push(prev.changes.name);
  }
}
write('version.json', versionBody({ id, date, built, count: rows.length, changes, keep }));
