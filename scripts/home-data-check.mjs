// Checks scripts/home-data.mjs without the network: the upcoming sets'
// filter, the Secret Lair grouping (by day and drop name, the one-card gap
// MTGJSON leaves inside a drop, unnamed runs kept and lone cards left out),
// the Scryfall links and the file's shape. The prices workflow runs it
// before the Home build. Usage:
//   node scripts/home-data-check.mjs
import { FORMAT, MAX_SETS, PICTURES_PER_DROP, STORE_URL, dayBefore, groupDrops, homeBody, searchUrl, upcomingSets } from './home-data.mjs';

let checks = 0;
let failed = 0;
function expect(what, got, want) {
  checks++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed++;
    console.log(`FAIL ${what}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  }
}
const query = (url) => decodeURIComponent(url.split('?q=')[1].split('&')[0]);

const TODAY = '2026-10-03';
expect('dayBefore', dayBefore(TODAY, 35), '2026-08-29');
expect('dayBefore across a year', dayBefore('2026-01-01', 1), '2025-12-31');

// ------------------------------------------------------------- the sets
const set = (code, released_at, extra = {}) => ({ code, name: code.toUpperCase(), released_at, set_type: 'expansion', digital: false, card_count: 10, icon_svg_uri: `https://svgs.scryfall.io/sets/${code}.svg`, ...extra });
const sets = upcomingSets(
  [
    set('old', '2026-09-30'), // older than SETS_BACK_DAYS
    set('yst', '2026-10-01'), // two days back: kept (the app filters by the phone's own day)
    set('nxt', '2026-11-14'),
    set('soon', '2026-10-10'),
    set('dig', '2026-10-11', { digital: true }),
    set('tok', '2026-10-12', { set_type: 'token' }),
    set('nod', undefined),
    set('aaa', '2026-11-14'),
  ],
  TODAY,
);
expect('sets: kept, oldest first, code on a tie', sets.map((s) => s.code), ['yst', 'soon', 'aaa', 'nxt']);
expect('sets: the shape', sets[1], { code: 'soon', name: 'SOON', releasedAt: '2026-10-10', cardCount: 10, icon: 'https://svgs.scryfall.io/sets/soon.svg' });
expect('sets: capped', upcomingSets(Array.from({ length: 30 }, (_, i) => set('s' + i, '2026-12-01')), TODAY).length, MAX_SETS);

// ------------------------------------------------------- the search links
expect('link: a run', query(searchUrl(['12', '10', '11'])), 'e:sld cn>=10 cn<=12');
expect('link: a gap', query(searchUrl(['12', '10'])), 'e:sld (cn:10 or cn:12)');
expect('link: one card', query(searchUrl(['7'])), 'e:sld (cn:7)');
expect('link: a star number', query(searchUrl(['7', '7★'])), 'e:sld (cn:"7" or cn:"7★")');
expect('link: prints', searchUrl(['1']).endsWith('&unique=prints'), true);

// ------------------------------------------------------------- the drops
const card = (n, day, small = `https://cards.scryfall.io/small/front/${n}.jpg`) => ({ collector_number: String(n), released_at: day, image_uris: { small } });
const names = new Map([
  ['100', 'Drop A'], ['101', 'Drop A'], ['103', 'Drop A'], // 102 unnamed between two of A: joins it
  ['104', 'Drop B'], ['105', 'Drop B'],
  ['200', 'Later Drop'], ['201', 'Later Drop'],
  ['300', 'Old Drop'],
]);
const dropOf = (n) => names.get(n) ?? null;
const cards = [
  card(100, '2026-10-12'), card(101, '2026-10-12'), card(102, '2026-10-12'), card(103, '2026-10-12'),
  card(104, '2026-10-12'), card(105, '2026-10-12'),
  card(150, '2026-10-12'), card(151, '2026-10-12'), card(152, '2026-10-12'), // an unnamed run: one drop with no name
  card(160, '2026-10-12'), // a lone unnamed card: left out
  card(170, '2026-10-12'), card(172, '2026-10-12'), // scattered: left out
  card(200, '2026-10-26'), { collector_number: '201', released_at: '2026-10-26', card_faces: [{ image_uris: { small: 'https://x/201f.jpg' } }, {}] },
  card(300, '2026-08-01'), // older than DROPS_BACK_DAYS
  card(400, '2026-10-19'), // a day with only a lone unnamed card: no wave
];
const waves = groupDrops(cards, dropOf, TODAY);
expect('waves: newest first, empty and old days gone', waves.map((w) => w.date), ['2026-10-26', '2026-10-12']);
const oct12 = waves[1].drops;
expect('drops: named by name, then the unnamed run', oct12.map((d) => d.name), ['Drop A', 'Drop B', null]);
expect('drops: the gap joins its drop', [oct12[0].count, query(oct12[0].url)], [4, 'e:sld cn>=100 cn<=103']);
expect('drops: the unnamed run', [oct12[2].count, query(oct12[2].url)], [3, 'e:sld cn>=150 cn<=152']);
expect('drops: pictures by number, capped', oct12[0].pictures, ['100', '101', '102'].map((n) => `https://cards.scryfall.io/small/front/${n}.jpg`).slice(0, PICTURES_PER_DROP));
expect('drops: a two-faced card shows its front', waves[0].drops[0].pictures, ['https://cards.scryfall.io/small/front/200.jpg', 'https://x/201f.jpg']);
// A gap at the end of a drop (no named neighbour after it) is not filled.
const edge = groupDrops([card(1, '2026-10-12'), card(2, '2026-10-12'), card(3, '2026-10-12')], (n) => (n === '1' || n === '2' ? 'E' : null), TODAY);
expect('drops: an edge card is not guessed', edge[0].drops.map((d) => [d.name, d.count]), [['E', 2]]);
// Two drops with no gap between them do not swallow a card between different names.
const between = groupDrops([card(1, '2026-10-12'), card(2, '2026-10-12'), card(3, '2026-10-12')], (n) => (n === '1' ? 'X' : n === '3' ? 'Y' : null), TODAY);
expect('drops: a card between two drops stays out', between[0].drops.map((d) => [d.name, d.count]), [['X', 1], ['Y', 1]]);
// The same printing twice (two finishes in the search) counts once.
const twice = groupDrops([card(1, '2026-10-12'), card(1, '2026-10-12'), card(2, '2026-10-12')], () => 'T', TODAY);
expect('drops: a number counts once', [twice[0].drops[0].count, twice[0].drops[0].pictures.length], [2, 2]);
expect('drops: no names at all, a run still shows', groupDrops([card(5, '2026-10-12'), card(6, '2026-10-12')], () => null, TODAY)[0].drops[0].name, null);

// --------------------------------------------------------------- the file
const body = JSON.parse(homeBody({ built: '2026-10-03T10:30:00.000Z', sets, names: { mkm: { ja: 'x' } }, waves }));
expect('file: its keys', Object.keys(body), ['v', 'built', 'sets', 'names', 'secretLair']);
expect('file: format and store', [body.v, body.secretLair.store, body.secretLair.waves.length], [FORMAT, STORE_URL, 2]);

console.log(`${checks - failed} of ${checks} checks passed`);
if (failed > 0) process.exit(1);
