// Checks scripts/bigweb-data.mjs under Node, with listings shaped as
// Bigweb's product API answers them (2026-10-10):
//   node scripts/bigweb-data-check.mjs
import assert from 'node:assert/strict';

import { buildScryfallIndex, matchSealed } from './hareruya-data.mjs';
import { bigwebSet, matchBigwebSealed, matchBigwebSingle, parseBigwebSealed, parseBigwebSingle, pickBigwebPrices } from './bigweb-data.mjs';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`ok ${passed} ${name}`);
};

const JP = { id: 2, web: '日本語', slip_en: 'JP' };
const EN = { id: 1, web: '英語', slip_en: 'EN' };
const NM = { id: 1, web: 'ニアミント', name: 'NM' };
const FOIL_NM = { id: 4, web: 'FOILニアミント', name: 'NM' };
const SPECIAL_FOIL = { id: 9, web: '特殊FOIL NM', name: 'NM' };
const PLAYED = { id: 7, web: 'プレイド', name: 'EX' };
const NONE = { id: 0, web: '\r\n', name: '' };
const item = (o) => ({ id: 1, name: 'Lightning Bolt', fname: '稲妻', price: 100, stock_count: 1, is_sold_out: false, is_preorder_item: false, is_hidden_price: false, is_box: false, language: EN, condition: NM, cardset: { slip: 'FDN' }, comment: '', sale_words: '', ...o });

check('set codes: the base, a part of the set, a set of its own, promos with none', () => {
  assert.deepEqual(bigwebSet('FRA.'), { set: 'fra', variant: '', raw: 'FRA' });
  assert.deepEqual(bigwebSet('FRA_BF.'), { set: 'fra', variant: 'BF', raw: 'FRA_BF' });
  assert.deepEqual(bigwebSet('TSR_TSB'), { set: 'tsb', variant: 'TSB', raw: 'TSR_TSB' });
  assert.deepEqual(bigwebSet('10ED'), { set: '10e', variant: '', raw: '10ED' });
  assert.equal(bigwebSet('pPRE').set, '');
  assert.equal(bigwebSet('').set, '');
});

check('a single: name, number, language, finish, stock; what is not one', () => {
  const plain = parseBigwebSingle(item({}));
  assert.equal(plain.name, 'Lightning Bolt');
  assert.equal(plain.number, null);
  assert.equal(plain.lang, 'en');
  assert.equal(plain.finish, 'nonfoil');
  assert.equal(plain.stock, true);
  assert.equal(plain.set, 'fdn');
  const variant = parseBigwebSingle(item({ name: 'The Theorist, Jace Beleren(363', comment: '363<br>【管理コード:MTG-S】', cardset: { slip: 'FRA_BF' }, language: JP, condition: FOIL_NM }));
  assert.equal(variant.name, 'The Theorist, Jace Beleren');
  assert.equal(variant.number, '363');
  assert.equal(variant.lang, 'ja');
  assert.equal(variant.finish, 'foil');
  assert.equal(variant.variant, 'BF');
  assert.equal(parseBigwebSingle(item({ name: 'Emrakul, the Exigent Doom(413', condition: SPECIAL_FOIL, comment: 'なんば店で展示中 413 #0208' })).finish, 'foil');
  assert.equal(parseBigwebSingle(item({ name: 'Emrakul, the Exigent Doom', comment: '413<br>x' })).number, '413', 'the number from the comment alone');
  assert.equal(parseBigwebSingle(item({ stock_count: 0 })).stock, false);
  assert.equal(parseBigwebSingle(item({ is_sold_out: true, stock_count: 3 })).stock, false);
  assert.equal(parseBigwebSingle(item({ is_preorder_item: true })).stock, false, 'a preorder is not a shelf price');
  assert.equal(parseBigwebSingle(item({ condition: PLAYED })), null, 'played copies are left out');
  assert.equal(parseBigwebSingle(item({ condition: NONE })), null, 'no condition: a supply');
  assert.equal(parseBigwebSingle(item({ is_box: true, condition: NONE })), null, 'a sealed product');
  assert.equal(parseBigwebSingle(item({ is_hidden_price: true })), null);
  assert.equal(parseBigwebSingle(item({ language: { slip_en: 'FR' } })), null, 'other languages are not carried');
  assert.equal(parseBigwebSingle(item({ price: 0 })), null);
});

const cards = [
  { id: 'bolt-fdn', set: 'fdn', collector_number: '216', name: 'Lightning Bolt', faces: [], special: false, retro: false },
  { id: 'bolt-fdn-sc', set: 'fdn', collector_number: '700', name: 'Lightning Bolt', faces: [], special: true, retro: false },
  { id: 'jace-fra', set: 'fra', collector_number: '70', name: 'The Theorist, Jace Beleren', faces: [], special: false, retro: false },
  { id: 'jace-fra-363', set: 'fra', collector_number: '363', name: 'The Theorist, Jace Beleren', faces: [], special: true, retro: false },
  { id: 'jace-fra-415', set: 'fra', collector_number: '415', name: 'The Theorist, Jace Beleren', faces: [], special: true, retro: false },
  { id: 'plains-1', set: 'fdn', collector_number: '272', name: 'Plains', faces: [], special: false, retro: false },
  { id: 'plains-2', set: 'fdn', collector_number: '273', name: 'Plains', faces: [], special: false, retro: false },
  { id: 'wolf-token', set: 'tfdn', collector_number: '12', name: 'Wolf', faces: [], special: false, retro: false },
];
const index = buildScryfallIndex(cards);

check('a match: by number, by the one name, by the kind the suffix names; the rest refused', () => {
  const m = (o) => matchBigwebSingle(parseBigwebSingle(item(o)), index);
  assert.equal(m({ name: 'The Theorist, Jace Beleren(363', cardset: { slip: 'FRA_BF' } }).id, 'jace-fra-363', 'by number');
  assert.equal(m({ name: 'The Theorist, Jace Beleren', cardset: { slip: 'FRA' } }).id, 'jace-fra', 'the plain code takes the plain printing');
  assert.equal(m({ name: 'The Theorist, Jace Beleren', cardset: { slip: 'FRA_BF' } }).id, null, 'two Booster Fun printings and no number: refused');
  assert.equal(m({ name: 'The Theorist, Jace Beleren', cardset: { slip: 'FRA_BF' } }).why, 'several printings of the name');
  assert.equal(m({ name: 'Lightning Bolt', cardset: { slip: 'FDN' } }).id, 'bolt-fdn');
  assert.equal(m({ name: 'Lightning Bolt', cardset: { slip: 'FDN_BF' } }).id, 'bolt-fdn-sc', 'the suffix takes the special one');
  assert.equal(m({ name: 'Plains', cardset: { slip: 'FDN' } }).id, null, 'two plain basics: refused, never the first');
  assert.equal(m({ name: 'Wolf Token', cardset: { slip: 'FDN' } }).id, 'wolf-token', 'a token in the token set');
  assert.equal(m({ name: 'Lightning Bolt', cardset: { slip: 'XYZ' } }).why, 'unknown set XYZ');
  assert.equal(m({ name: 'Counterspell', cardset: { slip: 'FDN' } }).why, 'name not in the set');
  assert.equal(m({ name: 'Lightning Bolt(999', cardset: { slip: 'FDN' } }).id, 'bolt-fdn', 'a number not in the set falls back to the name');
  assert.equal(m({ name: 'Counterspell(216', cardset: { slip: 'FDN' } }).id, null, 'a number whose printing has another name is not trusted');
});

check('the cheapest in stock per printing, language and finish, else the cheapest listed', () => {
  const s = (o, id) => ({ ...parseBigwebSingle(item(o)), id });
  const cells = pickBigwebPrices([
    s({ id: 1, price: 300, stock_count: 2 }, 'a'),
    s({ id: 2, price: 200, stock_count: 0 }, 'a'),
    s({ id: 3, price: 250, stock_count: 1 }, 'a'),
    s({ id: 4, price: 900, stock_count: 0, condition: FOIL_NM }, 'a'),
    s({ id: 5, price: 50, language: JP }, 'a'),
    { ...s({ id: 6, price: 10 }, null) },
  ]);
  assert.deepEqual(cells.get('a|en|nonfoil'), { price: 250, stock: true, product: 3 }, 'in stock beats a cheaper sold-out copy');
  assert.deepEqual(cells.get('a|en|foil'), { price: 900, stock: false, product: 4 }, 'a sold-out copy keeps its price');
  assert.deepEqual(cells.get('a|ja|nonfoil'), { price: 50, stock: true, product: 5 });
  assert.equal(cells.size, 3, 'an unmatched listing prices nothing');
});

const products = [
  { id: 'p1', name: 'Foundations Play Booster Box', short: 'Play Booster Box', cat: 'booster_box', sub: 'play' },
  { id: 'p2', name: 'Foundations Play Booster Pack', short: 'Play Booster Pack', cat: 'booster_pack', sub: 'play' },
  { id: 'p3', name: 'Foundations Collector Booster Box', short: 'Collector Booster Box', cat: 'booster_box', sub: 'collector' },
  { id: 'p4', name: 'Foundations Collector Booster Pack', short: 'Collector Booster Pack', cat: 'booster_pack', sub: 'collector' },
  { id: 'p5', name: 'Foundations Bundle', short: 'Bundle', cat: 'bundle', sub: 'default' },
  { id: 'p6', name: 'Foundations Starter Kit', short: 'Starter Kit', cat: 'multiple_decks', sub: 'two_player_starter' },
];

check('a sealed listing: language, set, kind and packs; decks and kits refused; the match', () => {
  const box = (name, o = {}) => ({ id: 9, name, fname: '', price: 16850, stock_count: 6, is_sold_out: false, is_preorder_item: false, is_hidden_price: false, is_box: true, language: JP, condition: NONE, cardset: { slip: 'FDN' }, ...o });
  const b = parseBigwebSealed(box('日本語版 ファウンデーションズ プレイ・ブースターBOX（36パック入）'));
  assert.equal(b.language, 'ja');
  assert.equal(b.set, 'fdn');
  assert.deepEqual(b.parsed.kind, { cat: 'booster_box', sub: 'play' });
  assert.equal(b.parsed.packs, 36);
  assert.equal(b.stock, true);
  assert.equal(matchBigwebSealed(b, products).id, 'p1');
  const pack = parseBigwebSealed(box('英語版 ファウンデーションズ コレクター・ブースターパック', { stock_count: 0 }));
  assert.equal(pack.language, 'en');
  assert.deepEqual(pack.parsed.kind, { cat: 'booster_pack', sub: 'collector' });
  assert.equal(pack.stock, false);
  assert.equal(matchBigwebSealed(pack, products).id, 'p4');
  assert.equal(matchBigwebSealed(parseBigwebSealed(box('日本語版 ファウンデーションズ バンドル')), products).id, 'p5');
  assert.equal(parseBigwebSealed(box('日本語版 ファウンデーションズ スターターキット')), null, 'a kit has no Latin words to match by');
  assert.equal(parseBigwebSealed(box('日本語版 ファウンデーションズ 統率者デッキ 4種セット')), null, 'decks too');
  assert.equal(parseBigwebSealed(box('ファウンデーションズ プレイ・ブースターBOX（36パック入）')), null, 'no language');
  assert.equal(parseBigwebSealed(box('日本語版 ファウンデーションズ プレイ・ブースターBOX（36パック入）', { cardset: { slip: 'pPRE' } })), null, 'no set');
  assert.equal(parseBigwebSealed(box('日本語版 ファウンデーションズ プレイ・ブースターBOX（36パック入）', { is_box: false })), null, 'not a sealed product');
  assert.equal(matchBigwebSealed(b, undefined), null, 'a set the app has no file for');
  assert.equal(matchSealed(b.parsed, products, 'ja').id, 'p1', 'the same matcher as Hareruya');
});

console.log(`${passed} checks passed`);
