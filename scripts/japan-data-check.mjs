// Checks scripts/japan-data.mjs under Node:
//   node scripts/japan-data-check.mjs
import assert from 'node:assert/strict';

import { japanCardsBody, japanSealedBody, mergeCardRows, mergeSealed, stockOf } from './japan-data.mjs';

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
  assert.deepEqual(by.a, ['a', 500, 800, null, 450, null, null, 11, 'hareruya', 0b000011], 'in stock beats cheaper sold out; en the cheaper of two sold out; the shop of the cheapest in-stock cell');
  assert.deepEqual(by.b, ['b', 300, null, null, null, null, null, 12, 'hareruya', 0b000001]);
  assert.deepEqual(by.c, ['c', 200, null, null, null, null, null, 23, 'bigweb', 0], 'one shop, sold out: kept, marked');
  assert.deepEqual(by.d, ['d', 1000, null, null, null, null, null, 14, 'hareruya', 0b000001], "the old file's row counts as in stock and wins over a cheaper sold-out one");
  assert.deepEqual(rows.map((r) => r[0]), ['a', 'b', 'c', 'd'], 'sorted by id');
  assert.deepEqual(mergeCardRows({ hareruya: null, bigweb: { rows: [] } }), []);
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
