// Checks scripts/hareruya-data.mjs, the pure part of the Hareruya build,
// on product names seen on the site: how a single's name is read (finish,
// number, frames, set code, names; lots refused), set codes, the match to
// a Scryfall printing (by number, by '★' number, by a unique name, a
// token's set), the cheapest-in-stock rule, the rows, and the sealed side
// (language, kind, the match to the app's products).
//
//   node scripts/hareruya-data-check.mjs
import assert from 'node:assert/strict';

import {
  buildScryfallIndex,
  cardRows,
  cardsBody,
  deckWords,
  matchSealed,
  matchSingle,
  namesAgree,
  nameKey,
  normalizeNumber,
  normalizeSetCode,
  parseSealedName,
  parseSingleName,
  pickPrices,
  scryfallCardSummary,
  sealedBody,
  sealedLanguage,
} from './hareruya-data.mjs';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`ok ${passed} ${name}`);
};

check('a plain single: number, names, set code', () => {
  const p = parseSingleName('(043)《理論家、ジェイス・ベレレン/The Theorist, Jace Beleren》[FRA] 青R');
  assert.equal(p.finish, 'nonfoil');
  assert.equal(p.number, '043');
  assert.equal(p.code, 'FRA');
  assert.deepEqual(p.english, ['The Theorist, Jace Beleren']);
  assert.deepEqual(p.frames, []);
});

check('foil, etched and textured tags; frames; notes; a double-faced card', () => {
  assert.equal(parseSingleName('【Foil】(179)《こだまの大広間/Hall of Echoes》[FRA] 土地R').finish, 'foil');
  const e = parseSingleName('【エッチング・Foil】(1117)■ボーダーレス■《思考囲い/Thoughtseize》[SLD] 黒R');
  assert.equal(e.finish, 'etched');
  assert.equal(e.number, '1117');
  assert.deepEqual(e.frames, ['ボーダーレス']);
  assert.equal(e.code, 'SLD');
  const t = parseSingleName('【テクスチャー・Foil】(469)■ボーダーレス■《知りたがりの学徒、タミヨウ/Tamiyo, Inquisitive Student》/《老練の学匠、タミヨウ/Tamiyo, Seasoned Scholar》[MH3-BF] 青R');
  assert.equal(t.finish, 'foil');
  assert.deepEqual(t.english, ['Tamiyo, Inquisitive Student', 'Tamiyo, Seasoned Scholar']);
  assert.equal(t.code, 'MH3-BF');
  const n = parseSingleName('【Foil】(090)■日本画■《悪魔の教示者/Demonic Tutor》※コレクターブースター版[STA-JP] 黒R');
  assert.equal(n.number, '090');
  assert.equal(n.code, 'STA-JP');
  const old = parseSingleName('■黒枠■《稲妻/Lightning Bolt》[4EDBB] 赤C');
  assert.equal(old.number, null);
  assert.deepEqual(old.frames, ['黒枠']);
  assert.equal(old.code, '4EDBB');
});

check('lots, sets of four and graded cards are refused', () => {
  assert.equal(parseSingleName('【委託商品/4枚セット】《稲妻/Lightning Bolt》[LEB] HP x 4'), null);
  assert.equal(parseSingleName('(001)《Black Lotus》[LEA] PSA 8'), null);
  assert.equal(parseSingleName(''), null);
});

check('set codes: suffixes off, aliases, unknown kept for the report', () => {
  assert.equal(normalizeSetCode('FRA'), 'fra');
  assert.equal(normalizeSetCode('MH3-BF'), 'mh3');
  assert.equal(normalizeSetCode('STA-JP'), 'sta');
  assert.equal(normalizeSetCode('4EDBB'), '4bb');
  assert.equal(normalizeSetCode('3EDBB'), 'fbb');
  assert.equal(normalizeSetCode('10ED'), '10e');
  assert.equal(normalizeSetCode('FAL'), 'fem');
  assert.equal(normalizeSetCode('XYZZY'), 'xyzzy');
  assert.equal(normalizeSetCode(null), '');
});

check('numbers and names as both sides compare them', () => {
  assert.equal(normalizeNumber('043'), '43');
  assert.equal(normalizeNumber('043a'), '43a');
  assert.equal(normalizeNumber('43★'), '43★');
  assert.equal(normalizeNumber('0'), '0');
  assert.equal(nameKey("Jace's Mindseeker"), 'jace s mindseeker');
  assert.equal(nameKey('Lim-Dûl the Necromancer'), 'lim dul the necromancer');
});

const cards = [
  { id: 'a', set: 'fra', collector_number: '43', name: 'The Theorist, Jace Beleren', faces: [], special: false },
  { id: 'b', set: 'fra', collector_number: '343', name: 'The Theorist, Jace Beleren', faces: [], special: true },
  { id: 'c', set: '4ed', collector_number: '210', name: 'Lightning Bolt', faces: [], special: false },
  { id: 'd', set: 'sta', collector_number: '90', name: 'Demonic Tutor', faces: [], special: false },
  { id: 'e', set: 'war', collector_number: '4★', name: 'Ajani, the Greathearted', faces: [], special: false },
  { id: 'f', set: 'mh3', collector_number: '469', name: 'Tamiyo, Inquisitive Student // Tamiyo, Seasoned Scholar', faces: ['Tamiyo, Inquisitive Student', 'Tamiyo, Seasoned Scholar'], special: true },
  { id: 'g', set: 'tfdc', collector_number: '1', name: 'Angel // Angel', faces: ['Angel', 'Angel'], special: false },
  { id: 'h', set: 'lea', collector_number: '1', name: 'Forest', faces: [], special: false },
  { id: 'i', set: 'lea', collector_number: '2', name: 'Forest', faces: [], special: false },
];
const index = buildScryfallIndex(cards);

check('a match by set and number, by name when unique, by the plain printing, a ★ number, a token', () => {
  assert.equal(matchSingle(parseSingleName('(043)《理論家、ジェイス・ベレレン/The Theorist, Jace Beleren》[FRA] 青R'), 'The Theorist, Jace Beleren', index).id, 'a');
  assert.equal(matchSingle(parseSingleName('(343)■ボーダーレス■《理論家、ジェイス・ベレレン/The Theorist, Jace Beleren》[FRA-BF] 青R'), 'The Theorist, Jace Beleren', index).id, 'b');
  assert.equal(matchSingle(parseSingleName('《稲妻/Lightning Bolt》[4ED] 赤C'), 'Lightning Bolt', index).id, 'c');
  // Two printings of the name, no number: the plain one when the name describes no frame.
  assert.equal(matchSingle(parseSingleName('《理論家、ジェイス・ベレレン/The Theorist, Jace Beleren》[FRA] 青R'), 'The Theorist, Jace Beleren', index).id, 'a');
  assert.equal(matchSingle(parseSingleName('(090)■日本画■《悪魔の教示者/Demonic Tutor》[STA-JP] 黒R'), 'Demonic Tutor', index).id, 'd');
  assert.equal(matchSingle(parseSingleName('(004)■日本画■《巨智、アジャニ/Ajani, the Greathearted》[WAR] 白R'), 'Ajani, the Greathearted', index).id, 'e');
  assert.equal(matchSingle(parseSingleName('【テクスチャー・Foil】(469)■ボーダーレス■《A/Tamiyo, Inquisitive Student》/《B/Tamiyo, Seasoned Scholar》[MH3-BF] 青R'), 'Tamiyo, Inquisitive Student', index).id, 'f');
  assert.equal(matchSingle(parseSingleName('(001/002)《天使+天使トークン/Angel+Angel Token》[FDC] 白/白'), null, index).id, 'g');
});

check('a number is trusted only when the names agree; tokens and emblems by their bare names', () => {
  const bolt = { name: 'Lightning Bolt', faces: [] };
  assert.equal(namesAgree(parseSingleName('(210)《稲妻/Lightning Bolt》[4ED] 赤C'), 'Lightning Bolt', bolt), true);
  assert.equal(namesAgree(parseSingleName('(210)《巨大化/Giant Growth》[4ED] 緑C'), 'Giant Growth', bolt), false);
  assert.equal(namesAgree(parseSingleName('(001/002)《天使+天使トークン/Angel+Angel Token》[FDC] 白/白'), null, { name: 'Angel // Angel', faces: ['Angel', 'Angel'] }), true);
  assert.equal(namesAgree(parseSingleName('(017/018)《紋章(遵守の冷気、チャンドラ)/Emblem Chandra, Chill of Compliance》[FRA]'), null, { name: 'Chandra, Chill of Compliance Emblem', faces: [] }), true);
  assert.equal(namesAgree(parseSingleName('(001)《Black Lotus》[LEA]'), null, bolt), false);
  // Hareruya's number names another card: the name decides when it is unique in the set.
  const two = buildScryfallIndex([
    { id: 'k', set: 'tmc', collector_number: '8', name: 'Endless Foot Assault', faces: [] },
    { id: 'l', set: 'tmc', collector_number: '12', name: 'Krang, Dimension X Overlord', faces: [] },
  ]);
  assert.equal(matchSingle(parseSingleName('(008)《Krang, Dimension X Overlord》[TMC]'), 'Krang, Dimension X Overlord', two).id, 'l');
  // In a promo set, a prerelease listing takes the "s" number and a promo pack the "p" one.
  const promos = buildScryfallIndex([
    { id: 'p', set: 'pone', collector_number: '10p', name: 'Elesh Norn, Mother of Machines', faces: [] },
    { id: 's', set: 'pone', collector_number: '10s', name: 'Elesh Norn, Mother of Machines', faces: [] },
    { id: 'base', set: 'one', collector_number: '10', name: 'Elesh Norn, Mother of Machines', faces: [] },
  ]);
  assert.equal(matchSingle(parseSingleName('【Foil】■プレリリース■《機械の母、エリシュ・ノーン/Elesh Norn, Mother of Machines》[ONE-PRE] 白R'), 'Elesh Norn, Mother of Machines', promos).id, 's');
  assert.equal(matchSingle(parseSingleName('(010)■プロモスタンプ付■《機械の母、エリシュ・ノーン/Elesh Norn, Mother of Machines》[Pスタンプ_ONE] 白R'), 'Elesh Norn, Mother of Machines', promos).id, 'p');
  assert.equal(normalizeSetCode('Pスタンプ_ONE'), 'pone');
  assert.equal(normalizeSetCode('ONE-PRE'), 'pone');
  assert.equal(normalizeSetCode('40K-SF'), '40k');
  assert.equal(normalizeSetCode('NvO/DDR'), 'ddr');
  assert.equal(normalizeSetCode('PWシンボル付き再版'), 'plst');
  // 7th Edition's sample-deck copies are "★" numbers; the plain one is the card.
  const seventh = buildScryfallIndex([
    { id: 'g', set: '7ed', collector_number: '190', name: 'Goblin King', faces: [], retro: true },
    { id: 'g★', set: '7ed', collector_number: '190★', name: 'Goblin King', faces: [], retro: true },
  ]);
  assert.equal(matchSingle(parseSingleName('《ゴブリンの王/Goblin King》[7ED] 赤R'), 'Goblin King', seventh).id, 'g');
});

check('what does not match says why', () => {
  assert.equal(matchSingle(null, 'x', index).why, 'lot');
  assert.equal(matchSingle(parseSingleName('《稲妻/Lightning Bolt》[XYZ] 赤C'), 'Lightning Bolt', index).why, 'unknown set XYZ');
  // A number Scryfall does not have falls back to a name unique in the set, else says so.
  assert.equal(matchSingle(parseSingleName('(999)《稲妻/Lightning Bolt》[4ED] 赤C'), 'Lightning Bolt', index).id, 'c');
  assert.equal(matchSingle(parseSingleName('(999)《森/Forest》[LEA] 土地C'), 'Forest', index).why, 'number not in set');
  assert.equal(matchSingle(parseSingleName('《森/Forest》[LEA] 土地C'), 'Forest', index).why, 'several printings, no number');
  assert.equal(matchSingle(parseSingleName('《稲妻/Lightning Bolt》[FRA] 赤C'), 'Lightning Bolt', index).why, 'name not in set');
});

check('the Scryfall summary keeps paper cards and marks special printings', () => {
  assert.equal(scryfallCardSummary({ id: 'x', set: 'fra', digital: true }), null);
  const s = scryfallCardSummary({ id: 'x', set: 'fra', collector_number: '343', name: 'N', card_faces: [{ name: 'A' }, { name: 'B' }], frame_effects: ['showcase'] });
  assert.deepEqual(s, { id: 'x', set: 'fra', collector_number: '343', name: 'N', faces: ['A', 'B'], special: true, retro: false });
  assert.equal(scryfallCardSummary({ id: 'z', set: '30a', collector_number: '300', name: 'N', frame: '1993' }).retro, true);
  assert.equal(scryfallCardSummary({ id: 'y', set: 'fra', collector_number: '1', name: 'N' }).special, false);
});

check('the cheapest NM copy in stock per printing, language and finish; the rows', () => {
  const doc = (id, language, finish, price, stock, product, card_condition = '1') => ({ id, language, price: String(price), stock: String(stock), product, card_condition, parsed: { finish } });
  const cells = pickPrices([
    doc('a', '1', 'nonfoil', 500, 3, '10'),
    doc('a', '1', 'nonfoil', 400, 0, '11'), // cheaper but sold out
    doc('a', '1', 'nonfoil', 450, 1, '12'), // in stock and cheaper than 500
    doc('a', '2', 'nonfoil', 300, 0, '13'), // English, sold out: its list price still counts
    doc('a', '2', 'foil', 900, 2, '14'),
    doc('a', '1', 'etched', 1200, 1, '15'),
    doc('a', '1', 'nonfoil', 100, 9, '16', '2'), // a played copy, never
    doc('a', '5', 'nonfoil', 50, 9, '17'), // French, never
    doc('b', '2', 'nonfoil', 80, 1, '18'),
    doc(null, '1', 'nonfoil', 1, 1, '19'),
  ]);
  const rows = cardRows(cells);
  assert.deepEqual(rows, [
    ['a', 450, null, 1200, 300, 900, null, 13],
    ['b', null, null, null, 80, null, null, 18],
  ]);
  const body = cardsBody({ built: 'B', scraped: 'S', rows, counts: { skus: 10 } });
  const parsed = JSON.parse(body);
  assert.equal(parsed.v, 1);
  assert.equal(parsed.currency, 'JPY');
  assert.equal(parsed.count, 2);
  assert.deepEqual(parsed.rows, rows);
  assert.equal(body.split('\n').length, 5);
});

check('a sealed listing: language', () => {
  assert.equal(sealedLanguage('(36パック)《ファウンデーションズ プレイ・ブースターBOX》《○日本語版》[FDN]', '(36Packs)《Foundations Play Booster BOX[JP]》'), 'ja');
  assert.equal(sealedLanguage('(36パック)《基本セット2013 ブースターBOX ●英語版》[M13]', '(36Packs) 《Magic 2013 Booster BOX[ENG]》'), 'en');
  assert.equal(sealedLanguage('【JP】《統率者2019 4種類セット》[C19]', '【JP】《Commander 2019 Set of four》[C19]'), 'ja');
  assert.equal(sealedLanguage('【FR】(1パック)【黒枠】《リバイズド ブースターパック フランス語版》[3EDBB]', ''), 'fr');
  assert.equal(sealedLanguage('(36パック)《第4版 ブースターBOX スペイン版》[4ED]', '(36Packs) 《4th Edition Booster BOX[ESP]》'), 'other');
  assert.equal(sealedLanguage('(1パック)《ポータル ブースターパック●英語版》[POR]', '(1Packs) 《Portal Booster Pack[ENG]》[POR]'), 'en');
  assert.equal(sealedLanguage('Secret Lair x The Office: Dwight\'s Destiny [SLD]', 'Secret Lair x The Office: Dwight\'s Destiny [SLD]'), null);
});

check('a sealed listing: kind, packs, set codes, refused states', () => {
  const box = parseSealedName('(36パック)《ファウンデーションズ プレイ・ブースターBOX》《○日本語版》[FDN]', '*ships to domestic only(36Packs)《Foundations Play Booster BOX[JP]》', 'box');
  assert.deepEqual(box.kind, { cat: 'booster_box', sub: 'play' });
  assert.equal(box.packs, 36);
  assert.deepEqual(box.codes, ['FDN']);
  const pack = parseSealedName('(1パック)《アサシンクリードコレクター・ブースターパック●英語版》[ACR]', '(1Pack) 《Assassin\'s Creed Collector Booster Pack[EN]》[ACR]', 'pack');
  assert.deepEqual(pack.kind, { cat: 'booster_pack', sub: 'collector' });
  const kit = parseSealedName('《ブルームバロウ スターターキット ●英語版》[BLB]', '《Bloomburrow Starter Kit[EN]》', 'pack');
  assert.deepEqual(kit.kind, { cat: null, sub: null });
  const deck = parseSealedName('《カルドハイム 統率者デッキ「エルフの帝国」》《●英語版》[KHC]', ' 【EN】《Kaldheim Commander Elven Empire》[KHC]', 'deck');
  assert.deepEqual(deck.kind, { cat: 'deck', sub: 'commander' });
  assert.deepEqual(deck.words, ['kaldheim', 'elven', 'empire']);
  const four = parseSealedName('《ダスクモーン：戦慄の館 統率者デッキ4種セット》《●英語版》[DSC]', '*ships to domestic only【EN】《Duskmourn: House of Horror Commander Deck Set of four》', 'deck');
  assert.equal(four.setOf, 4);
  const portal = parseSealedName('(1パック)《ポータル ブースターパック●英語版》[POR]', '(1Packs) 《Portal Booster Pack[ENG]》[POR]', 'pack');
  assert.deepEqual(portal.codes, ['POR']);
  assert.equal(parseSealedName('【黒枠】(1パック)《第4版 ブースターパック〇日本語版》[4EDBB] ※外装傷アリ品', '', 'pack'), null);
  assert.equal(parseSealedName('(1パック)《ベータ ブースターパック●英語版》[LEB] PSA9', '', 'pack'), null);
});

check('deck words leave the set, the kind and the language out', () => {
  assert.deepEqual(deckWords('*ships to domestic only【EN】《FINAL FANTASY Commander Deck Set of Four》'), ['final', 'fantasy', '4']);
  assert.deepEqual(deckWords('【JP】《Apocalypse Theme Deck『Burial』》'), ['apocalypse', 'theme', 'burial']);
});

const products = [
  { id: 'p1', name: 'Foundations Play Booster Box', short: 'Play Booster Box', cat: 'booster_box', sub: 'play' },
  { id: 'p2', name: 'Foundations Play Booster Pack', short: 'Play Booster Pack', cat: 'booster_pack', sub: 'play' },
  { id: 'p3', name: 'Foundations Collector Booster Pack', short: 'Collector Booster Pack', cat: 'booster_pack', sub: 'collector' },
  { id: 'p4', name: 'Foundations Collector Booster Pack Minimal Packaging', short: 'Collector Booster Pack Minimal Packaging', cat: 'booster_pack', sub: 'collector' },
  { id: 'p5', name: 'Foundations Collector Booster Sample Pack', short: 'Sample Pack', cat: 'booster_pack', sub: 'promotional' },
  { id: 'p6', name: 'Foundations Bundle', short: 'Bundle', cat: 'bundle', sub: 'default' },
  { id: 'p7', name: 'Foundations Starter Kit', short: 'Starter Kit', cat: 'multiple_decks', sub: 'two_player_starter' },
  { id: 'p8', name: 'Kaldheim Commander Deck Elven Empire', short: 'Elven Empire', cat: 'deck', sub: 'commander' },
  { id: 'p9', name: 'Kaldheim Commander Deck Phantom Premonition', short: 'Phantom Premonition', cat: 'deck', sub: 'commander' },
  { id: 'p10', name: 'Kaldheim Commander Decks Set of 2', short: 'Set of 2', cat: 'subset', sub: 'commander' },
  { id: 'p11', name: 'Kaldheim Commander Deck Elven Empire Display', short: 'Elven Empire Display', cat: 'deck_box', sub: 'commander' },
];

check('a sealed match: boosters by kind, a kit and decks by name, a set of decks, ambiguity refused', () => {
  const m = (ja, en, category) => matchSealed(parseSealedName(ja, en, category), products)?.id ?? null;
  assert.equal(m('(36パック)《ファウンデーションズ プレイ・ブースターBOX》《○日本語版》[FDN]', '(36Packs)《Foundations Play Booster BOX[JP]》', 'box'), 'p1');
  assert.equal(m('(1パック)《ファウンデーションズ プレイ・ブースターパック》《○日本語版》[FDN]', '(1Pack)《Foundations Play Booster Pack[JP]》', 'pack'), 'p2');
  assert.equal(m('(1パック)《ファウンデーションズ コレクター・ブースターパック》《●英語版》[FDN]', '(1Pack)《Foundations Collector Booster Pack[EN]》', 'pack'), 'p3');
  assert.equal(m('《ファウンデーションズ Bundle》《●英語版》[FDN]', '《Foundations Bundle[EN]》', 'bundle'), 'p6');
  assert.equal(m('《ファウンデーションズ スターターキット ●英語版》[FDN]', '《Foundations Starter Kit[EN]》', 'pack'), 'p7');
  assert.equal(m('《カルドハイム 統率者デッキ「エルフの帝国」》《●英語版》[KHC]', '【EN】《Kaldheim Commander Elven Empire》[KHC]', 'deck'), 'p8');
  assert.equal(m('《カルドハイム 統率者デッキ2種セット》《●英語版》[KHC]', '【EN】《Kaldheim Commander Deck Set of two》[KHC]', 'deck'), 'p10');
  // "Kaldheim Commander" alone fits two decks: no match.
  assert.equal(m('《カルドハイム 統率者デッキ》《●英語版》[KHC]', '【EN】《Kaldheim Commander》[KHC]', 'deck'), null);
  assert.equal(matchSealed(null, products), null);
});

check('the sealed file', () => {
  const body = sealedBody({ built: 'B', scraped: 'S', ja: { b: [100, 2], a: [50, 1] }, en: {}, counts: { sealed: 2 } });
  const parsed = JSON.parse(body);
  assert.equal(parsed.currency, 'JPY');
  assert.deepEqual(Object.keys(parsed.ja), ['a', 'b']);
  assert.deepEqual(parsed.en, {});
});

console.log(`${passed} checks passed`);
