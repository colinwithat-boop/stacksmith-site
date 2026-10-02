// The price files' layout and the daily change file, kept apart from the
// build (scripts/build-prices.mjs) so scripts/price-changes-check.mjs can
// test them without the network. The app reads these files in
// lib/prices/priceFile.ts (the app repo); change the layout there too.
//
// prices/ on the site holds:
//   version.json   what is current: {v, id, date, built, count, full,
//                  changes, keep}. The ONLY file that changes in place.
//   full-<slug>.json        every paper printing with a price, one row
//                  each: [scryfall id, usd, usd_foil, usd_etched, eur,
//                  eur_foil, tcgplayer id, tcgplayer etched id].
//   changes-<from>-<to>.json  the rows that differ from the previous
//                  version's full file: a changed or new printing's whole
//                  row, and [scryfall id] alone for one that has no price
//                  any more.
//   latest.json    the current full file again, byte for byte, for app
//                  builds from before the change file (they read it with
//                  its ETag).
//
// The id is Scryfall's default_cards `updated_at`: the build is a pure
// function of that bulk file, so one id is one set of rows. Every file
// carries it, and the app checks it against version.json, so a cached copy
// of another day's file is never taken for today's. GitHub's CDN keeps a
// file up to 10 minutes and ignores query strings, so each version's files
// have names of their own, and the previous version's files are published
// once more ("keep") so a version.json still cached from before a deploy
// names files that are there.

/** The layout's version, in every file (the app refuses another). */
export const FORMAT = 1;
/**
 * No change file when the new full file has under this share of the
 * previous one's rows: a build from a broken bulk download would otherwise
 * tell every phone to take most prices away. Phones take the full file
 * instead, whose apply has its own guard (SWEEP_MIN_SHARE in the app).
 */
export const CHANGES_MIN_SHARE = 0.5;

/** A file-name-safe form of an id: its digits. */
export function slugOf(id) {
  const slug = String(id).replace(/[^0-9]/g, '');
  if (slug.length < 8) throw new Error(`not an id: ${id}`);
  return slug;
}

export function fullName(id) {
  return `full-${slugOf(id)}.json`;
}

export function changesName(from, to) {
  return `changes-${slugOf(from)}-${slugOf(to)}.json`;
}

/** The full file's text: one row per line (a diff of two days reads, and gzip does as well). */
export function fullBody({ id, date, built, rows }) {
  return `{"v":${FORMAT},"id":${JSON.stringify(id)},"date":"${date}","built":"${built}","count":${rows.length},"rows":[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]}\n`;
}

/**
 * The rows of `next` that differ from `prev` (both sorted or not, keyed
 * by scryfall id): a new or changed printing's whole row, then [id] for
 * each printing `prev` priced and `next` does not.
 */
export function diffRows(prev, next) {
  const before = new Map(prev.map((r) => [r[0], JSON.stringify(r)]));
  const rows = [];
  const seen = new Set();
  for (const r of next) {
    seen.add(r[0]);
    if (before.get(r[0]) !== JSON.stringify(r)) rows.push(r);
  }
  let removed = 0;
  for (const r of prev) {
    if (!seen.has(r[0])) {
      rows.push([r[0]]);
      removed++;
    }
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { rows, removed };
}

/** The change file's text, or null when it should not be published (CHANGES_MIN_SHARE). */
export function changesBody({ from, id, date, built, prevRows, rows }) {
  if (rows.length < prevRows.length * CHANGES_MIN_SHARE) return null;
  const diff = diffRows(prevRows, rows);
  const body = `{"v":${FORMAT},"from":${JSON.stringify(from)},"id":${JSON.stringify(id)},"date":"${date}","built":"${built}","total":${rows.length},"count":${diff.rows.length},"removed":${diff.removed},"rows":[\n${diff.rows.map((r) => JSON.stringify(r)).join(',\n')}\n]}\n`;
  return { body, count: diff.rows.length, removed: diff.removed };
}

/** version.json's text. */
export function versionBody({ id, date, built, count, changes, keep }) {
  return (
    JSON.stringify({
      v: FORMAT,
      id,
      date,
      built,
      count,
      full: fullName(id),
      changes: changes ? { from: changes.from, file: changesName(changes.from, id), count: changes.count, removed: changes.removed } : null,
      keep,
    }) + '\n'
  );
}

/** Whether `text` is a version.json this layout wrote, returning it parsed, else null. */
export function readVersion(text) {
  try {
    const v = JSON.parse(text);
    if (v?.v !== FORMAT || typeof v.id !== 'string' || typeof v.full !== 'string' || v.full !== fullName(v.id)) return null;
    if (v.changes !== null && (typeof v.changes?.file !== 'string' || v.changes.file !== changesName(v.changes.from, v.id))) return null;
    if (!Array.isArray(v.keep)) return null;
    return v;
  } catch {
    return null;
  }
}

/** The id inside a price file's text (full or change file), read from its head without parsing the rows; null when it has none. */
export function idOf(text) {
  const m = /^\{"v":(\d+),(?:"from":"[^"]*",)?"id":"([^"]+)"/.exec(text.slice(0, 300));
  return m && Number(m[1]) === FORMAT ? m[2] : null;
}
