// Checks scripts/marketplace-data.mjs under Node, with answers shaped as
// Rakuten's and Yahoo!'s documentation gives them (not yet seen live:
// the keys were not in hand on 2026-10-10):
//   node scripts/marketplace-data-check.mjs
import assert from 'node:assert/strict';

import { marketplaceBody, marketplaceQuery, offerMatches, pickOffer, rakutenOffers, yahooOffers } from './marketplace-data.mjs';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`ok ${passed} ${name}`);
};

const box = { id: 'b1', name: 'Foundations Play Booster Box', short: 'Play Booster Box', cat: 'booster_box', sub: 'play', parts: [['p', 'fdn/play', 36]] };
const pack = { id: 'p1', name: 'Foundations Play Booster Pack', short: 'Play Booster Pack', cat: 'booster_pack', sub: 'play', parts: [['p', 'fdn/play', 1]] };
const collector = { id: 'c1', name: 'Foundations Collector Booster Box', short: 'Collector Booster Box', cat: 'booster_box', sub: 'collector', parts: [['p', 'fdn/collector', 12]] };
const bundle = { id: 'u1', name: 'Foundations Bundle', short: 'Bundle', cat: 'bundle', sub: 'default', parts: [] };
const gift = { id: 'g1', name: 'Foundations Gift Bundle', short: 'Gift Bundle', cat: 'bundle', sub: 'gift_bundle', parts: [] };
const deck = { id: 'd1', name: 'Foundations Starter Kit', short: 'Starter Kit', cat: 'multiple_decks', sub: 'two_player_starter', parts: [] };
const sample = { id: 's1', name: 'Foundations Collector Booster Sample Pack', short: 'Sample Pack', cat: 'booster_pack', sub: 'promotional', parts: [] };

check('the search: set, kind, unit and language; what is not asked for', () => {
  const q = marketplaceQuery(box, 'ファウンデーションズ', 'ja');
  assert.equal(q.text, 'MTG ファウンデーションズ プレイ・ブースター BOX 日本語版');
  assert.equal(q.unit, 'box');
  assert.equal(q.booster, 'play');
  assert.equal(q.packs, 36);
  assert.equal(marketplaceQuery(pack, 'ファウンデーションズ', 'en').text, 'MTG ファウンデーションズ プレイ・ブースター パック 英語版');
  assert.equal(marketplaceQuery(pack, 'ファウンデーションズ', 'en').packs, null);
  assert.equal(marketplaceQuery(bundle, 'ファウンデーションズ', 'ja').text, 'MTG ファウンデーションズ バンドル 日本語版');
  assert.equal(marketplaceQuery(gift, 'ファウンデーションズ', 'ja').text, 'MTG ファウンデーションズ ギフトバンドル 日本語版');
  assert.equal(marketplaceQuery(deck, 'ファウンデーションズ', 'ja'), null, 'decks and kits are not asked for');
  assert.equal(marketplaceQuery(sample, 'ファウンデーションズ', 'ja'), null, 'nor samples');
  assert.equal(marketplaceQuery(box, '', 'ja'), null, 'no Japanese set name, no search');
  assert.equal(marketplaceQuery(box, 'ファウンデーションズ', 'fr'), null);
});

check('an offer is the product only when its title says so', () => {
  const ja = marketplaceQuery(box, 'ファウンデーションズ', 'ja');
  const en = marketplaceQuery(box, 'ファウンデーションズ', 'en');
  assert.ok(offerMatches(ja, 'MTG ファウンデーションズ プレイ・ブースター BOX 日本語版 36パック入り'));
  assert.ok(offerMatches(ja, '【日本語版】マジック：ザ・ギャザリング ファウンデーションズ プレイブースター ボックス'), 'no language word reads as Japanese; a middle dot may be dropped');
  assert.ok(!offerMatches(ja, 'MTG ファウンデーションズ プレイ・ブースター BOX 英語版'), 'the other language');
  assert.ok(offerMatches(en, 'MTG ファウンデーションズ プレイ・ブースター BOX 英語版'));
  assert.ok(!offerMatches(en, 'MTG ファウンデーションズ プレイ・ブースター BOX'), 'English must be said');
  assert.ok(!offerMatches(ja, 'MTG ファウンデーションズ コレクター・ブースター BOX 日本語版'), 'another booster');
  assert.ok(!offerMatches(ja, 'MTG ファウンデーションズ プレイ・ブースター パック 日本語版'), 'a pack is not a box');
  assert.ok(!offerMatches(ja, 'MTG ファウンデーションズ プレイ・ブースター BOX 日本語版 2箱セット'), 'a lot');
  assert.ok(!offerMatches(ja, 'MTG ファウンデーションズ プレイ・ブースター BOX 日本語版 開封済'), 'opened');
  assert.ok(!offerMatches(ja, 'MTG ファウンデーションズ プレイ・ブースター BOX 日本語版 30パック'), 'the wrong pack count');
  assert.ok(!offerMatches(ja, 'MTG ダスクモーン プレイ・ブースター BOX 日本語版'), 'another set');
  const p = marketplaceQuery(pack, 'ファウンデーションズ', 'ja');
  assert.ok(offerMatches(p, 'MTG ファウンデーションズ プレイ・ブースターパック 日本語版 1パック'));
  assert.ok(!offerMatches(p, 'MTG ファウンデーションズ プレイ・ブースター BOX 日本語版'), 'a box is not a pack');
  const c = marketplaceQuery(collector, 'ファウンデーションズ', 'ja');
  assert.ok(offerMatches(c, 'ファウンデーションズ コレクター・ブースター BOX 12パック'));
  const g = marketplaceQuery(gift, 'ファウンデーションズ', 'ja');
  assert.ok(offerMatches(g, 'MTG ファウンデーションズ ギフトバンドル 日本語版'));
  assert.ok(!offerMatches(g, 'MTG ファウンデーションズ バンドル 日本語版'), 'a plain bundle is not the gift one');
  const u = marketplaceQuery(bundle, 'ファウンデーションズ', 'ja');
  assert.ok(!offerMatches(u, 'MTG ファウンデーションズ ギフトバンドル 日本語版'), 'nor the other way');
});

check("the services' answers as offers, and the cheapest in stock that fits", () => {
  const ja = marketplaceQuery(box, 'ファウンデーションズ', 'ja');
  const rakuten = rakutenOffers({
    Items: [
      { Item: { itemName: 'MTG ファウンデーションズ プレイ・ブースター BOX 日本語版', itemPrice: 17800, itemUrl: 'https://item.rakuten.co.jp/a/1/', availability: 1, shopName: 'A' } },
      { Item: { itemName: 'MTG ファウンデーションズ プレイ・ブースター BOX 日本語版', itemPrice: 15800, itemUrl: 'https://item.rakuten.co.jp/b/1/', availability: 0, shopName: 'B' } },
      { Item: { itemName: 'MTG ファウンデーションズ プレイ・ブースター BOX 英語版', itemPrice: 9800, itemUrl: 'https://item.rakuten.co.jp/c/1/', availability: 1, shopName: 'C' } },
      { Item: { itemName: 'MTG ファウンデーションズ プレイ・ブースター BOX 日本語版', itemPrice: 16500, itemUrl: 'https://item.rakuten.co.jp/d/1/', availability: 1, shopName: 'D' } },
    ],
  });
  assert.equal(rakuten.length, 4);
  assert.deepEqual(pickOffer(ja, rakuten), { price: 16500, url: 'https://item.rakuten.co.jp/d/1/', title: 'MTG ファウンデーションズ プレイ・ブースター BOX 日本語版', seller: 'D', stock: true });
  const yahoo = yahooOffers({
    hits: [
      { name: 'ファウンデーションズ プレイブースター BOX 日本語版 36パック', price: 16200, url: 'https://store.shopping.yahoo.co.jp/x/1.html', inStock: true, seller: { name: 'X' } },
      { name: 'ファウンデーションズ プレイブースター BOX 日本語版', price: 15000, url: 'https://store.shopping.yahoo.co.jp/y/1.html', inStock: false, seller: { name: 'Y' } },
    ],
  });
  assert.equal(pickOffer(ja, yahoo).price, 16200);
  assert.equal(pickOffer(ja, []), null);
  assert.deepEqual(rakutenOffers({}), []);
  assert.deepEqual(yahooOffers(null), []);
});

check('the file', () => {
  const body = marketplaceBody({ built: 'B', since: '2023-10-06', sources: { rakuten: { ja: { b: [1, 'u', 's'], a: [2, 'v', 't'] }, en: {} }, yahoo: { ja: {}, en: {} } }, counts: { searches: 2 } });
  const parsed = JSON.parse(body);
  assert.equal(parsed.v, 1);
  assert.equal(parsed.currency, 'JPY');
  assert.deepEqual(Object.keys(parsed.sources.rakuten.ja), ['a', 'b']);
  assert.deepEqual(parsed.sources.yahoo, { ja: {}, en: {} });
});

console.log(`${passed} checks passed`);
