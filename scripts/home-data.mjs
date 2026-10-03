// What Home's "Coming up" shows, shaped for the app: the upcoming sets and
// the Secret Lair drops, kept apart from the fetching (build-home.mjs) so
// home-data-check.mjs can test it without the network. The app reads it in
// lib/home/feeds.ts (parseHomeFile, splitDrops); change both together.
//
// Sources (one request each a day, from the job, never from phones):
//  - Scryfall's /sets: the next releases, in the shape the app needs and
//    nothing more (code, English name, date, cards so far, icon URL).
//  - Scryfall's card search on e:sld: the Secret Lair cards from a few
//    weeks back to the newest announced, with their sale day (released_at,
//    the US day) and a small picture.
//  - MTGJSON's SLD.json (MIT): each card's drop name (`subsets`).
// Grouping: by sale day, then by drop name. A card with no drop name whose
// neighbours on both sides (collector numbers n-1 and n+1, the same day)
// are one named drop joins it (MTGJSON missed #2840 inside a Labyrinth
// drop). Other unnamed cards show only as a RUN of two or more numbers in a
// row (a drop MTGJSON has not named yet, like the five Oddlands lands),
// each run as one drop with no name ("Secret Lair drop" in the app), never
// under an invented name; a lone or scattered one is a bonus card and left
// out. Each day also carries `saleAt`, the moment the drops go on sale
// (SALE_HOUR_LA, Los Angeles time, the store's): the app shows and sorts by
// it in the phone's own time zone, where the US day alone read a day early
// in Japan. Without MTGJSON's names every card would be unnamed and drops
// that meet would run together, so build-home.mjs then keeps the live
// file's drops instead (as it does when the Scryfall search fails).
// Nothing is read from Wizards' sites (the owner's call, 2026-10-03): the
// store is only linked to.

export const FORMAT = 1;
/** The set types a player calls a release (lib/home/news.ts RELEASE_TYPES). */
export const RELEASE_TYPES = new Set(['core', 'expansion', 'masters', 'commander', 'draft_innovation', 'starter']);
/** Sets and drops from this many days back are kept: the app filters again by the phone's own day. */
export const SETS_BACK_DAYS = 2;
export const DROPS_BACK_DAYS = 35;
export const MAX_SETS = 10;
/** Pictures per drop in the file (the app shows two or three). */
export const PICTURES_PER_DROP = 3;
export const STORE_URL = 'https://secretlair.wizards.com/';
/** Secret Lair drops go on sale at 9 am Pacific. */
export const SALE_HOUR_LA = 9;

/** The moment a sale day's drops go on sale: SALE_HOUR_LA o'clock in Los Angeles on `day`, as an ISO instant (PDT or PST by the date). */
export function saleAtOf(day) {
  const hourIn = (t) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' }).format(t));
  for (const offset of [7, 8]) {
    const t = new Date(Date.parse(day + 'T00:00:00Z') + (SALE_HOUR_LA + offset) * 3_600_000);
    if (hourIn(t) === SALE_HOUR_LA) return t.toISOString();
  }
  return new Date(Date.parse(day + 'T00:00:00Z') + (SALE_HOUR_LA + 7) * 3_600_000).toISOString();
}

/** A UTC day (YYYY-MM-DD) `days` before `today`. */
export function dayBefore(today, days) {
  return new Date(Date.parse(today + 'T00:00:00Z') - days * 86_400_000).toISOString().slice(0, 10);
}

/** The next releases from Scryfall's /sets `data`, oldest first. */
export function upcomingSets(sets, today) {
  const from = dayBefore(today, SETS_BACK_DAYS);
  return sets
    .filter((s) => !s.digital && RELEASE_TYPES.has(s.set_type) && typeof s.released_at === 'string' && s.released_at >= from)
    .sort((a, b) => (a.released_at < b.released_at ? -1 : a.released_at > b.released_at ? 1 : a.code < b.code ? -1 : 1))
    .slice(0, MAX_SETS)
    .map((s) => ({ code: s.code, name: s.name, releasedAt: s.released_at, cardCount: s.card_count ?? 0, icon: s.icon_svg_uri ?? null }));
}

/** A Scryfall search URL for these Secret Lair collector numbers: a range when they run without a gap. */
export function searchUrl(numbers) {
  const nums = [...new Set(numbers)];
  const ints = nums.map((n) => (/^\d+$/.test(n) ? Number(n) : NaN));
  let q;
  if (ints.every(Number.isFinite)) {
    const sorted = [...ints].sort((a, b) => a - b);
    const contiguous = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
    q = contiguous && sorted.length > 1 ? `e:sld cn>=${sorted[0]} cn<=${sorted[sorted.length - 1]}` : `e:sld (${sorted.map((n) => `cn:${n}`).join(' or ')})`;
  } else {
    q = `e:sld (${nums.map((n) => `cn:"${n}"`).join(' or ')})`;
  }
  return `https://scryfall.com/search?q=${encodeURIComponent(q)}&unique=prints`;
}

/** A card's small picture from a Scryfall card object (the front face of a two-faced one). */
export function pictureOf(card) {
  return card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small ?? null;
}

/**
 * The drops by sale day, newest day first, from Scryfall's e:sld cards and
 * MTGJSON's drop names (`dropOf(number)` gives the name or null). Each day:
 * its drops by name, a lone unnamed card left out, two or more unnamed
 * cards as one drop with no name.
 */
export function groupDrops(cards, dropOf, today) {
  const from = dayBefore(today, DROPS_BACK_DAYS);
  // Each day's cards, by collector number, with the drop MTGJSON names.
  const days = new Map();
  for (const c of cards) {
    if (typeof c.released_at !== 'string' || c.released_at < from) continue;
    if (!days.has(c.released_at)) days.set(c.released_at, []);
    days.get(c.released_at).push(c);
  }
  return [...days.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, list]) => {
      const named = new Map(); // number -> drop name, this day
      for (const c of list) {
        const name = dropOf(c.collector_number);
        if (name) named.set(c.collector_number, name);
      }
      const groups = new Map(); // key -> cards; ''-prefixed keys are unnamed runs
      const unnamed = [];
      for (const c of list) {
        let name = named.get(c.collector_number) ?? null;
        if (name === null && /^\d+$/.test(c.collector_number)) {
          const n = Number(c.collector_number);
          const before = named.get(String(n - 1));
          if (before && before === named.get(String(n + 1))) name = before;
        }
        if (name === null) {
          unnamed.push(c);
          continue;
        }
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(c);
      }
      // Unnamed cards: runs of consecutive numbers, two or more long.
      const nums = [...new Set(unnamed.map((c) => c.collector_number).filter((n) => /^\d+$/.test(n)).map(Number))].sort((a, b) => a - b);
      let run = [];
      const flush = () => {
        if (run.length >= 2) groups.set('' + run[0], unnamed.filter((c) => run.includes(Number(c.collector_number))));
        run = [];
      };
      for (const n of nums) {
        if (run.length > 0 && n !== run[run.length - 1] + 1) flush();
        run.push(n);
      }
      flush();
      return { date, drops: [...groups.entries()] };
    })
    .map(({ date, drops }) => ({
      date,
      saleAt: saleAtOf(date),
      drops: drops
        .sort((a, b) => {
          const ua = !Number.isNaN(Number(a[0])) || a[0] === '';
          const ub = !Number.isNaN(Number(b[0])) || b[0] === '';
          if (ua !== ub) return ua ? 1 : -1;
          return a[0].localeCompare(b[0]);
        })
        .map(([key, list]) => {
          const numbers = [...new Set(list.map((c) => c.collector_number))];
          const byNumber = [...list].sort((a, b) => collator(a.collector_number, b.collector_number));
          return {
            name: /^\d*$/.test(key) ? null : key,
            count: numbers.length,
            pictures: byNumber
              .map(pictureOf)
              .filter(Boolean)
              .filter((p, i, all) => all.indexOf(p) === i)
              .slice(0, PICTURES_PER_DROP),
            url: searchUrl(numbers),
          };
        }),
    }))
    .filter((wave) => wave.drops.length > 0);
}

function collator(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The live file's drops still within DROPS_BACK_DAYS of `today`, for a run whose own could not be built; [] when it has none. */
export function carriedWaves(liveFile, today) {
  const waves = liveFile?.secretLair?.waves;
  if (!Array.isArray(waves)) return [];
  const from = dayBefore(today, DROPS_BACK_DAYS);
  return waves.filter((w) => typeof w?.date === 'string' && w.date >= from && Array.isArray(w.drops) && w.drops.length > 0);
}

/** The file's text. */
export function homeBody({ built, sets, names, waves }) {
  return JSON.stringify({ v: FORMAT, built, sets, names, secretLair: { store: STORE_URL, waves } }) + '\n';
}
