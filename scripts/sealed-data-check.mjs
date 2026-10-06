// Checks scripts/sealed-data.mjs, the pure part of the sealed build, on
// small made-up tables: CSV lines, booster types (weights, picks, sheets,
// unresolved cards keeping their odds, a double-faced card's faces as one,
// digital boosters left out), deck lists, product parts (every kind, and a
// product left out when any part cannot be valued) and short names.
//
//   node scripts/sealed-data-check.mjs
import assert from 'node:assert/strict';

import {
  buildBoosters,
  contentHash,
  deckCards,
  finishCode,
  isDigitalBooster,
  isForeignBooster,
  isListedProduct,
  parseCsv,
  parseCsvLine,
  productParts,
  shortName,
} from './sealed-data.mjs';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`ok ${passed} ${name}`);
};

check('a CSV line with quotes, doubled quotes and empty fields', () => {
  assert.deepEqual(parseCsvLine('a,"b,c","say ""hi""",,e'), ['a', 'b,c', 'say "hi"', '', 'e']);
  assert.deepEqual(parseCsvLine('a,'), ['a', '']);
  assert.deepEqual(parseCsvLine('"x"'), ['x']);
  assert.throws(() => parseCsvLine('"open'));
});

check('a CSV text as rows, CRLF and a short row refused', () => {
  assert.deepEqual(parseCsv('h1,h2\r\n1,2\r\n'), [{ h1: '1', h2: '2' }]);
  assert.throws(() => parseCsv('h1,h2\n1\n'));
});

check('digital boosters', () => {
  assert.equal(isDigitalBooster('play-arena'), true);
  assert.equal(isDigitalBooster('arena'), true);
  assert.equal(isDigitalBooster('mtgo'), true);
  assert.equal(isDigitalBooster('play'), false);
  assert.equal(isDigitalBooster('collector-sample'), false);
});

const ids = new Map([
  ['u-a', 'S-A'],
  ['u-b', 'S-B'],
  ['u-b-back', 'S-B'],
  ['u-c', 'S-C'],
]);
const idOf = (u) => ids.get(u) ?? null;

const tables = {
  weights: [
    { setCode: 'TST', boosterName: 'play', boosterIndex: '0', boosterWeight: '3' },
    { setCode: 'TST', boosterName: 'play', boosterIndex: '1', boosterWeight: '1' },
    { setCode: 'TST', boosterName: 'play-arena', boosterIndex: '0', boosterWeight: '1' },
    { setCode: 'TST', boosterName: 'broken', boosterIndex: '0', boosterWeight: '1' },
  ],
  contents: [
    { setCode: 'TST', boosterName: 'play', boosterIndex: '0', sheetName: 'common', sheetPicks: '10' },
    { setCode: 'TST', boosterName: 'play', boosterIndex: '1', sheetName: 'common', sheetPicks: '9' },
    { setCode: 'TST', boosterName: 'play', boosterIndex: '1', sheetName: 'foil', sheetPicks: '1' },
    { setCode: 'TST', boosterName: 'play-arena', boosterIndex: '0', sheetName: 'common', sheetPicks: '10' },
    { setCode: 'TST', boosterName: 'broken', boosterIndex: '0', sheetName: 'missing', sheetPicks: '1' },
  ],
  sheets: [
    { setCode: 'TST', boosterName: 'play', sheetName: 'common', sheetIsFoil: 'false', sheetTotalWeight: '4' },
    { setCode: 'TST', boosterName: 'play', sheetName: 'foil', sheetIsFoil: 'true', sheetTotalWeight: '2' },
    { setCode: 'TST', boosterName: 'play-arena', sheetName: 'common', sheetIsFoil: 'false', sheetTotalWeight: '1' },
  ],
  sheetCards: [
    { setCode: 'TST', boosterName: 'play', sheetName: 'common', cardUuid: 'u-a', cardWeight: '2' },
    { setCode: 'TST', boosterName: 'play', sheetName: 'common', cardUuid: 'u-unknown', cardWeight: '1' },
    { setCode: 'TST', boosterName: 'play', sheetName: 'common', cardUuid: 'u-b', cardWeight: '1' },
    { setCode: 'TST', boosterName: 'play', sheetName: 'foil', cardUuid: 'u-b', cardWeight: '1' },
    { setCode: 'TST', boosterName: 'play', sheetName: 'foil', cardUuid: 'u-b-back', cardWeight: '1' },
    { setCode: 'TST', boosterName: 'play-arena', sheetName: 'common', cardUuid: 'u-a', cardWeight: '1' },
  ],
};

check('booster types: configs, sheets, odds kept for an unknown card, faces merged', () => {
  const { boosters, unresolved, merged } = buildBoosters(tables, idOf);
  assert.equal(unresolved, 1);
  assert.equal(merged, 1);
  assert.deepEqual([...boosters.keys()], ['TST/play']);
  const b = boosters.get('TST/play');
  assert.deepEqual(b.c, [
    [3, { common: 10 }],
    [1, { common: 9, foil: 1 }],
  ]);
  assert.deepEqual(b.s.common, { f: 0, t: 4, c: [['S-A', 2], ['S-B', 1]] });
  assert.deepEqual(b.s.foil, { f: 1, t: 2, c: [['S-B', 2]] });
});

check('finish codes', () => {
  assert.equal(finishCode({ foil: true, finishes: ['foil'] }), 1);
  assert.equal(finishCode({ finishes: ['etched'] }), 2);
  assert.equal(finishCode({ isFoil: true }), 1);
  assert.equal(finishCode({ isEtched: true, isFoil: true }), 2);
  assert.equal(finishCode({ finishes: ['nonfoil'] }), 0);
  assert.equal(finishCode({ finishes: ['foil'] }), 1);
  assert.equal(finishCode({}), 0);
});

check('a deck list: boards summed by card and finish, tokens left out, null when a card is unknown', () => {
  const deck = {
    commander: [{ uuid: 'u-a', count: 1, isFoil: true }],
    mainBoard: [{ uuid: 'u-b', count: 2 }, { uuid: 'u-b-back', count: 1 }, { uuid: 'u-c', count: 1 }],
    sideBoard: [],
    tokens: [{ uuid: 'u-unknown', count: 1 }],
  };
  assert.deepEqual(deckCards(deck, idOf), [['S-A', 1, 1], ['S-B', 3, 0], ['S-C', 1, 0]]);
  assert.equal(deckCards({ mainBoard: [{ uuid: 'u-unknown', count: 1 }] }, idOf), null);
  assert.equal(deckCards({ mainBoard: [] }, idOf), null);
});

const has = {
  booster: (k) => k === 'TST/play',
  deck: (k) => k === 'TST/Deck One',
  product: (u) => u === 'p-pack',
};

check('product parts: cards, packs, decks, other products and a choice', () => {
  const parts = productParts(
    {
      card: [{ uuid: 'u-a', foil: true, finishes: ['foil'] }],
      pack: [{ code: 'play', set: 'tst' }],
      deck: [{ name: 'Deck One', set: 'tst' }],
      sealed: [{ uuid: 'p-pack', count: 30, name: 'Pack', set: 'tst' }],
      other: [{ name: 'Spindown' }],
      variable: [{ configs: [{ card: [{ uuid: 'u-b' }], variable_config: [{ chance: 1, weight: 4 }] }, { card: [{ uuid: 'u-c' }], variable_config: [{ chance: 1, weight: 1 }] }] }],
    },
    idOf,
    has,
  );
  assert.deepEqual(parts, [
    ['c', 'S-A', 1, 1],
    ['p', 'TST/play', 1],
    ['d', 'TST/Deck One', 1],
    ['s', 'p-pack', 30],
    ['v', [[4, [['c', 'S-B', 0, 1]]], [1, [['c', 'S-C', 0, 1]]]]],
  ]);
});

check('a product with any part that cannot be valued is left out', () => {
  assert.equal(productParts({ pack: [{ code: 'play-arena', set: 'tst' }] }, idOf, has), null);
  assert.equal(productParts({ pack: [{ code: 'collector', set: 'tst' }] }, idOf, has), null);
  assert.equal(productParts({ card: [{ uuid: 'u-unknown' }] }, idOf, has), null);
  assert.equal(productParts({ deck: [{ name: 'Deck Two', set: 'tst' }] }, idOf, has), null);
  assert.equal(productParts({ sealed: [{ uuid: 'p-other', count: 1 }] }, idOf, has), null);
  assert.equal(productParts({ variable: [{ configs: [{ variable_config: [{ chance: 1, weight: 1 }] }] }] }, idOf, has), null);
  assert.deepEqual(productParts({ other: [{ name: 'Deck box' }] }, idOf, has), []);
  assert.equal(productParts(undefined, idOf, has), null);
});

check('products in another language are left out, but not a Secret Lair drop of its own printings', () => {
  // The 24 MTGJSON lists today, among them:
  for (const [name, cat, sub] of [
    ['War of the Spark Japanese Booster Box', 'booster_box', 'default'],
    ['Renaissance German Booster Pack', 'booster_pack', 'default'],
    ['Legends Italian Booster Box Case', 'booster_case', 'default'],
    ['Challenger Deck Japan 2019 Song Dance', 'deck', 'challenger'],
    ['Duel Deck Jace vs Chandra Japanese', 'deck', 'duel'],
  ])
    assert.equal(isListedProduct(name, cat, sub), false, name);
  for (const [name, cat, sub] of [
    ['Secret Lair Drop Special Guest Junji Ito Japanese', 'box_set', 'secret_lair'],
    ['Secret Lair Bundle Summer Superdrop 2025 The Japanese FINAL FANTASY Bundle', 'box_set', 'secret_lair_bundle'],
    ['Duskmourn House of Horror Play Booster Box', 'booster_box', 'play'],
    // A word that only contains a language's name.
    ['Germanic Myths Booster Pack', 'booster_pack', 'default'],
  ])
    assert.equal(isListedProduct(name, cat, sub), true, name);
  assert.equal(isListedProduct('Duskmourn House of Horror MTGO Redemption', 'box_set', 'mtgo_redemption'), false);
  assert.equal(isForeignBooster('jp'), true);
  assert.equal(isForeignBooster('collector-jp'), true);
  for (const name of ['play', 'collector', 'bonus-marvels-deadpool-i-fixed-it-youre-welcome-foil', 'prerelease-jeskai', 'theme-de'])
    assert.equal(isForeignBooster(name), false, name);
  assert.equal(productParts({ pack: [{ code: 'jp', set: 'tst' }] }, idOf, { ...has, booster: () => true }), null, 'a Japanese pack in a product');
});

check('short names', () => {
  assert.equal(shortName('Duskmourn House of Horror Play Booster Box', 'Duskmourn: House of Horror'), 'Play Booster Box');
  assert.equal(shortName('Duskmourn House of Horror Commander Deck Death Toll', 'Duskmourn: House of Horror Commander'), 'Commander Deck Death Toll');
  assert.equal(shortName('Marvels Spider Man Welcome Deck Black', "Marvel's Spider-Man"), 'Welcome Deck Black');
  assert.equal(shortName('Warhammer 40000 Commander Deck Tyranid Swarm', 'Warhammer 40,000 Commander'), 'Commander Deck Tyranid Swarm');
  assert.equal(shortName('Magic 30th Anniversary Edition Booster Box', '30th Anniversary Edition'), 'Booster Box');
  assert.equal(shortName('Unlimited Booster Pack', 'Unlimited Edition'), 'Booster Pack');
  assert.equal(shortName('Bloomburrow Deluxe Commander Kit Animated Army', 'Bloomburrow Commander'), 'Deluxe Commander Kit Animated Army');
  assert.equal(shortName('Adventures in the Forgotten Realms Commander Deck Aura of Courage', 'Forgotten Realms Commander'), 'Commander Deck Aura of Courage');
  assert.equal(shortName('Secret Lair Drop Legendary Flyers Not That Kind Foil', 'Secret Lair Drop'), 'Legendary Flyers Not That Kind Foil');
  // Nothing left, or no word but a small one in common: the whole name.
  assert.equal(shortName('Commander Collection Green', 'Commander Collection: Green'), 'Commander Collection Green');
  assert.equal(shortName('The Big Box', 'The Hobbit'), 'The Big Box');
  assert.equal(shortName('Anthologies', 'Anthologies'), 'Anthologies');
});

check("a set file's content hash: 12 hex characters, the same for the same file, another for another", () => {
  const file = { v: 1, code: 'XYZ', products: [{ id: 'a', short: 'Play Booster Pack' }] };
  const h = contentHash(file);
  assert.match(h, /^[0-9a-f]{12}$/);
  assert.equal(contentHash(JSON.parse(JSON.stringify(file))), h, 'read back, the same');
  assert.notEqual(contentHash({ ...file, products: [{ id: 'b', short: 'Play Booster Pack' }] }), h, 'another product, another hash');
});

console.log(`${passed} checks passed`);
