// Checks scripts/japan-data.mjs under Node:
//   node scripts/japan-data-check.mjs
import assert from 'node:assert/strict';

import { dailyPrices, japanCardsBody, japanSealedBody, mergeCardRows, mergeSealed, outOfLine, stockOf } from './japan-data.mjs';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`ok ${passed} ${name}`);
};

check('the stock mask: its own, or every priced cell for a row from before it', () => {
  assert.equal(stockOf(['a', 100, null, null, 200, null, null, 1, 0b001001]), 0b001001);
  assert.equal(stockOf(['a', 100, null, null, 200, null, null, 1]), 0b001001, 'a file from before: priced means in stock');
  assert.equal(stockOf(['a', null, 50, null, null, null, 70, 1]), 0b100010);
  assert.equal(stockOf(['a', 100, null, null, null, null, null, 1, 0]), 0, 'a mask of 0: nothing in stock');
});

check('the cards merge: the cheapest in stock per cell across shops, else the cheapest; the shop of the best cell', () => {
  const rows = mergeCardRows({
    hareruya: {
      rows: [
        ['a', 500, 900, null, 450, null, null, 11, 0b000001], // ja in stock, ja_foil and en sold out
        ['b', 300, null, null, null, null, null, 12, 0b000001],
        ['d', 1000, null, null, null, null, null, 14], // a file from before the mask
      ],
    },
    bigweb: {
      rows: [
        ['a', 400, 800, null, 480, null, null, 21, 0b000010], // ja sold out though cheaper, ja_foil in stock, en sold out
        ['c', 200, null, null, null, null, null, 23, 0],
        ['d', 950, null, null, null, null, null, 24, 0],
      ],
    },
  });
  const by = Object.fromEntries(rows.map((r) => [r[0], r]));
  assert.deepEqual(by.a, ['a', 500, 800, null, 450, null, null, 11, 'hareruya', 0b000011, null, null, null, null, null], 'in stock beats cheaper sold out; en the cheaper of two sold out; the shop of the cheapest in-stock cell');
  assert.deepEqual(by.b, ['b', 300, null, null, null, null, null, 12, 'hareruya', 0b000001, null, null, null, null, null]);
  assert.deepEqual(by.c, ['c', 200, null, null, null, null, null, 23, 'bigweb', 0, null, null, null, null, null], 'one shop, sold out: kept, marked');
  assert.deepEqual(by.d, ['d', 1000, null, null, null, null, null, 14, 'hareruya', 0b000001, null, null, null, null, null], "the old file's row counts as in stock and wins over a cheaper sold-out one");
  assert.deepEqual(rows.map((r) => r[0]), ['a', 'b', 'c', 'd'], 'sorted by id');
  assert.deepEqual(mergeCardRows({ hareruya: null, bigweb: { rows: [] } }), []);
  // The day's dollars and euros beside the yen, when the daily file is given.
  const daily = dailyPrices({ rows: [['a', '0.34', '0.54', null, '0.35', '0.49', 558404, null], ['zz', '1', null, null, null, null, null, null]] });
  const withDay = mergeCardRows({ hareruya: { rows: [['a', 500, null, null, null, null, null, 11, 1], ['b', 300, null, null, null, null, null, 12, 1]] } }, daily);
  assert.deepEqual(withDay[0].slice(10), ['0.34', '0.54', null, '0.35', '0.49'], "the file's columns 1 to 5");
  assert.deepEqual(withDay[1].slice(10), [null, null, null, null, null], 'a printing the file lacks');
  assert.equal(withDay[0].length, 15);
  assert.deepEqual(withDay[2], ['zz', null, null, null, null, null, null, null, null, 0, '1', null, null, null, null], "a printing no shop lists: the day's prices alone, no shop, nothing in stock (2026-10-22)");
  assert.equal(withDay.length, 3);
  const dayEurOnly = dailyPrices({ rows: [['eu', null, null, null, '0.35', null, null, null], ['bare', null, null, null, null, null, null, null]] });
  assert.deepEqual(mergeCardRows({ hareruya: { rows: [] } }, dayEurOnly).map((r) => r[0]), ['eu'], 'a euro-only printing gets its row (a European copy is priced from it); one with no price at all none');
});

check("a yen price out of line with the day's dollars is dropped: the gold Smaug at ¥2,500 against $24,500", () => {
  assert.equal(outOfLine(2500, 24500), true, 'a 25th of $24,500 is ¥147,000');
  assert.equal(outOfLine(3500, 17.97), false, 'an $18 card at ¥3,500');
  assert.equal(outOfLine(30000, 184.1), false, 'a $184 card at ¥30,000');
  assert.equal(outOfLine(100000, 1), true, 'a $1 card at ¥100,000');
  assert.equal(outOfLine(500, 0.1), false, 'bulk at ¥500: a card under $1 is never doubted on the high side');
  assert.equal(outOfLine(30, 2), false, 'a $2 card at ¥30: under $5 never doubted on the low side');
  assert.equal(outOfLine(2500, null), false, 'no dollars, no doubt');
  const daily = dailyPrices({ rows: [['smaug', null, '24500.00', null, null, '300.00', null, null], ['fine', '17.97', '20.18', null, null, null, null, null]] });
  const dropped = [];
  const rows = mergeCardRows(
    {
      bigweb: { rows: [['smaug', null, null, null, null, 2500, null, 3574280, 0], ['fine', 4500, 3500, null, 4000, 3500, null, 195782, 0b011011]] },
      hareruya: { rows: [['smaug', null, 200000, null, null, null, null, 77, 0]] },
    },
    daily,
    dropped,
  );
  const by = Object.fromEntries(rows.map((r) => [r[0], r]));
  assert.deepEqual(by.smaug.slice(0, 10), ['smaug', null, 200000, null, null, null, null, 77, 'hareruya', 0], "Bigweb's ¥2,500 English foil is gone; Hareruya's ¥200,000 Japanese foil stays");
  assert.deepEqual(by.fine.slice(1, 7), [4500, 3500, null, 4000, 3500, null], 'a card in line keeps every cell');
  assert.deepEqual(dropped, [['smaug', 4, 'bigweb', 2500, 24500]]);
  // The only cell dropped: a row of the day's dollars alone, so the app prices it from TCGplayer in yen rather than at ¥2,500.
  assert.deepEqual(mergeCardRows({ bigweb: { rows: [['smaug', null, null, null, null, 2500, null, 3574280, 0]] } }, daily), [
    ['fine', null, null, null, null, null, null, null, null, 0, '17.97', '20.18', null, null, null],
    ['smaug', null, null, null, null, null, null, null, null, 0, null, '24500.00', null, null, '300.00'],
  ]);
});

check('the sealed merge: per product and language, in stock first, then price, with the shop', () => {
  const m = mergeSealed({
    hareruya: { ja: { p1: [16000, 100, 0], p2: [900, 101, 1] }, en: { p1: [19000, 102, 1] } },
    bigweb: { ja: { p1: [16850, 200, 1], p2: [1000, 201, 1] }, en: { p1: [18000, 202, 0], p3: [5000, 203] } },
  });
  assert.deepEqual(m.ja.p1, [16850, 200, 1, 'bigweb'], 'in stock over a cheaper sold-out one');
  assert.deepEqual(m.ja.p2, [900, 101, 1, 'hareruya'], 'both in stock: the cheaper');
  assert.deepEqual(m.en.p1, [19000, 102, 1, 'hareruya']);
  assert.deepEqual(m.en.p3, [5000, 203, 1, 'bigweb'], 'a two-cell file from before counts as in stock');
});

check('the files', () => {
  const cards = JSON.parse(japanCardsBody({ built: 'B', scraped: 'S', shops: { hareruya: { built: 'H' } }, rows: [['a', 1, null, null, null, null, null, 9, 'hareruya', 1]] }));
  assert.equal(cards.source, 'japan');
  assert.equal(cards.currency, 'JPY');
  assert.equal(cards.count, 1);
  assert.equal(cards.scraped, 'S');
  assert.equal(cards.rows[0][8], 'hareruya');
  const sealed = JSON.parse(japanSealedBody({ built: 'B', scraped: 'S', shops: {}, ja: { b: [1, 2, 1, 'bigweb'], a: [3, 4, 0, 'hareruya'] }, en: {} }));
  assert.equal(sealed.source, 'japan');
  assert.deepEqual(Object.keys(sealed.ja), ['a', 'b']);
});

console.log(`${passed} checks passed`);
