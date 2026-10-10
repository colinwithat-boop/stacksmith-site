// The pure part of the Hareruya build (scripts/build-hareruya.mjs): how a
// Hareruya product name is read, how its set code becomes Scryfall's, how
// a product row is matched to a Scryfall printing or to one of the app's
// sealed products, and the files' layout. No network, so
// scripts/hareruya-data-check.mjs can test it.
//
// Hareruya (晴れる屋, hareruyamtg.com) is Japan's largest Magic retailer.
// Its product search answers JSON (one document per SKU: a product in one
// language, one finish and one condition), with fields like
//   product        "197227"      the product (its page: /ja/products/detail/<product>)
//   product_name   "(043)《理論家、ジェイス・ベレレン/The Theorist, Jace Beleren》[FRA] 青R"
//   card_name      "The Theorist, Jace Beleren"   (singles only)
//   language       "1" JP, "2" EN, 3..12 other languages
//   foil_flg       "0" or "1"     (singles only; etched foils are "1" and named 【エッチング・Foil】)
//   card_condition "1" NM, other values for played copies
//   price          "11000"        yen, tax included
//   stock          "0"
// A product name reads, left to right: tags in 【】 (Foil, エッチング・Foil,
// テクスチャー・Foil, a language for sealed goods), the collector number in
// parentheses (newer sets), frame notes in ■■ (黒枠 black border, ボーダー
// レス borderless, 拡張アート extended art, 日本画 Japanese alternate art),
// the name(s) as 《Japanese/English》 (a double-faced card's faces joined by
// '/'), notes after ※, the set code in [] and the colour and rarity.

/** The file layout's version, in every file. */
export const FORMAT = 1;

/** Hareruya's language codes (its product page's `languages[]`). */
export const LANGUAGES = { 1: 'ja', 2: 'en', 3: 'zhs', 4: 'zht', 5: 'fr', 6: 'de', 7: 'it', 8: 'ko', 9: 'pt', 10: 'ru', 11: 'es', 12: 'grc' };

/**
 * Hareruya's set codes that are not Scryfall's, and what they are there.
 * Suffixes are handled by normalizeSetCode before this table is read:
 * "-BF" (Booster Fun: showcase, borderless and extended-art cards of the
 * same set), "-JP" (the Japanese-art Mystical Archive, Scryfall's sta too)
 * and "-PR"/"-PRM" (promos filed under the set).
 */
export const SET_ALIASES = {
  '3EDBB': 'fbb', // Revised, black-bordered foreign printings
  '4EDBB': '4bb', // Fourth Edition, black-bordered foreign printings
  CHRBB: 'bchr', // Chronicles, black-bordered Japanese printings
  FAL: 'fem', // Fallen Empires
  PT96: 'ptc', // Pro Tour Collector Set
  '10ED': '10e', // Tenth Edition
  PO2: 'p02', // Portal Second Age
  'SUMMER MAGIC': 'sum',
  SALVAT2005: 'psal',
  SALVAT2011: 'ps11',
  IE: 'cei', // International Collectors' Edition
  CE: 'ced', // Collectors' Edition
  CMA17: 'cma', // Commander Anthology
  'MH1-RT': 'h1r', // Modern Horizons' retro-frame cards (Timeshifts)
  'DBL-MID': 'dbl', // Innistrad: Double Feature, both halves
  'DBL-VOW': 'dbl',
  MPS2: 'mp2', // Amonkhet Invocations
  UBT: 'puma', // Ultimate Box Topper
  MED14: 'md1', // Modern Event Deck 2014
  'MED-GRN': 'med', // Mythic Edition
  'MED-RNA': 'med',
  'MED-WAR': 'med',
  HASCON2017: 'h17',
  SLIVERS: 'h09', // Premium Deck Series
  GRB: 'pd3',
  // Duel Decks, as Hareruya abbreviates them.
  IVG: 'ddj',
  JVV: 'ddm',
  HVM: 'ddl',
  SVT: 'ddk',
  VVK: 'ddi',
  PVC: 'dde',
  AVN: 'ddh',
  KVD: 'ddg',
  EVT: 'ddf',
  SVC: 'ddn',
  NVO: 'ddr',
  BVC: 'ddq',
  EVI: 'ddu',
  ZVE: 'ddp',
  MVM: 'dds',
  MVG: 'ddt',
  'DD3・GVL': 'gvl',
  'DD3・JVC': 'jvc',
  'DD3・DVD': 'dvd',
  'DD3・EVG': 'evg',
  // The List (Mystery Booster's and the Play Boosters' reprints), numbered "<set>-<number>" on both sides.
  'PWシンボル付き再版': 'plst',
  'MB2-LIST': 'plst',
};

/**
 * Scryfall's code for a Hareruya set code: upper-cased, its suffixes taken
 * off, the alias table consulted, lower-cased. The caller checks the result
 * is a Scryfall set; an unknown code is reported, never guessed.
 *
 * A promo code (the set's own "-P" and "-PRE", or "Pスタンプ_<set>", the
 * promo-stamped cards of promo packs and prereleases) names Scryfall's
 * promo set of the set, "p<set>", where a card is numbered "<n>p" or
 * "<n>s"; normalizeSetCode gives that set, and matchSingle tries those
 * numbers. A code with a slash ("NvO/DDR") names the set after it.
 */
export function normalizeSetCode(raw) {
  let code = String(raw ?? '').trim().toUpperCase();
  if (!code) return '';
  if (code.includes('/')) code = code.slice(code.lastIndexOf('/') + 1).trim();
  const stamp = code.match(/^Pスタンプ_(.+)$/);
  if (stamp) return `p${normalizeSetCode(stamp[1])}`;
  const promo = code.match(/^([A-Z0-9]+)-(P|PRE)$/);
  if (promo) return `p${normalizeSetCode(promo[1])}`;
  if (SET_ALIASES[code]) return SET_ALIASES[code];
  code = code.replace(/-(BF|JP|PR|PRM)$/, '');
  if (SET_ALIASES[code]) return SET_ALIASES[code];
  // Any other suffix names a part of the set (-SF surge foils, -GF galaxy
  // foils, -BS a bonus sheet, -ART alternate art, -WU a guild kit's guild).
  const base = code.replace(/-[A-Z0-9]+$/, '');
  if (SET_ALIASES[base]) return SET_ALIASES[base];
  return base.toLowerCase();
}

/** Whether a Hareruya set code names a promo set (matchSingle tries the promo numbers). */
export function isPromoCode(raw) {
  const code = String(raw ?? '').trim().toUpperCase();
  return /^Pスタンプ_/.test(code) || /-(P|PRE)$/.test(code);
}

/**
 * Hareruya card sets whose products carry no usable code, by the set's
 * name in Hareruya's search form: Scryfall's code.
 */
export const SET_BY_HARERUYA_NAME = {
  サマーマジック: 'sum',
  'デュエルデッキ:迅速vs狡知': 'ddn',
  'デュエルデッキ:エルフvs発明者': 'ddu',
  'デュエルデッキ:正しき者vs堕ちし者': 'ddq',
  'デュエルデッキ:ゼンディカーvsエルドラージ': 'ddp',
};

const FINISH_TAGS = /【(エッチング・Foil|テクスチャー・Foil|Foil|ギャラクシー・Foil|サーフ・Foil|ヘイロー・Foil|レインボー・Foil|ステップ・アンド・コンプリート・Foil|オイルスリック・Foil|フラクチャー・Foil|シルバースクリーン・Foil|ダブルレインボー・Foil|ファーストプレイ・Foil|ネオン[^】]*Foil|[^】]*Foil)】/g;

/**
 * What a single's product name says. Returns null for a name that is not
 * one card (a set of four, a consignment lot, a graded card), which is
 * never priced.
 */
export function parseSingleName(name) {
  let s = String(name ?? '').trim();
  if (!s) return null;
  // Lots and graded cards: never a card's own price.
  if (/委託|セット】|\d枚セット|\bx ?\d+\s*$|PSA\s*\d|BGS\s*\d|CGC\s*\d/i.test(s)) return null;
  // Not a card: an art card, a sticker sheet, a punch-out counter.
  if (/アート・カード|ステッカー|パンチアウト|補助カード/.test(s)) return null;
  let finish = 'nonfoil';
  const tags = [];
  s = s.replace(/【([^】]*)】/g, (_, t) => {
    tags.push(t);
    return '';
  });
  for (const t of tags) {
    if (/エッチング/.test(t)) finish = 'etched';
    else if (/Foil/i.test(t) && finish === 'nonfoil') finish = 'foil';
  }
  s = s.trim();
  // The collector number, when the name carries one: "(043)", "(043a)", "(43★)".
  let number = null;
  const num = s.match(/^\(([^)]{1,12})\)/);
  if (num) {
    number = num[1].trim();
    s = s.slice(num[0].length).trim();
  }
  const frames = [];
  s = s.replace(/■([^■]*)■/g, (_, f) => {
    frames.push(f);
    return '';
  });
  // The set code: the last [..] group before the colour and rarity.
  const codes = [...s.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim()).filter(Boolean);
  const code = codes.length ? codes[codes.length - 1] : null;
  // The names: every 《ja/en》, the English after the last '/'.
  const faces = [...s.matchAll(/《([^》]*)》/g)].map((m) => m[1]);
  const english = faces.map((f) => {
    const i = f.lastIndexOf('/');
    return (i >= 0 ? f.slice(i + 1) : f).trim();
  });
  return { finish, number, code, frames, tags, english, lot: false };
}

/** A collector number as both sides compare it: leading zeros off the digits, '★' kept, letters lower-cased. */
export function normalizeNumber(n) {
  return String(n ?? '')
    .trim()
    .toLowerCase()
    .replace(/^0+(?=\d)/, '')
    .replace(/\s+/g, '');
}

/** A card name as both sides compare it: lower-cased, accents and punctuation off, one space between words. */
export function nameKey(name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The Scryfall printing a Hareruya single is: by set and collector number
 * when the name carries one, else by set and English name when exactly one
 * printing of that name is in the set. `index` is what buildScryfallIndex
 * returns. The result names why nothing matched, for the report.
 */
export function matchSingle(parsed, cardName, index, hareruyaSet = '') {
  if (!parsed) return { id: null, why: 'lot' };
  let set = normalizeSetCode(parsed.code);
  if (!set && SET_BY_HARERUYA_NAME[hareruyaSet]) set = SET_BY_HARERUYA_NAME[hareruyaSet];
  if (!set) return { id: null, why: 'no set code' };
  // A double-sided token or emblem is numbered "(001/002)", one side each,
  // and filed under its set; Scryfall keeps them in the set's token set.
  const token = parsed.english.some((n) => /\b(Token|Emblem)\b/i.test(n));
  const inSet = token && index.sets.has(`t${set}`) ? `t${set}` : set;
  if (!index.sets.has(inSet)) return { id: null, why: `unknown set ${parsed.code}` };
  if (parsed.number !== null) {
    const number = normalizeNumber(token ? parsed.number.split('/')[0] : parsed.number);
    // A promo set numbers a promo-pack card "<n>p" and a prerelease card
    // "<n>s"; Scryfall numbers a Japanese-art alternate, a surge or galaxy
    // foil "<n>★" where Hareruya does not.
    const promo = isPromoCode(parsed.code);
    const tries = promo ? [`${number}p`, `${number}s`, number] : [number, `${number}★`];
    let numbered = null;
    for (const t of tries) {
      const hit = index.byNumber.get(`${inSet}|${t}`);
      if (hit) {
        numbered = hit;
        break;
      }
    }
    // A promo-pack card the base set carries under its own number ("432"
    // in the set, not "432p" in its promo set).
    if (!numbered && promo) {
      const baseSet = normalizeSetCode(String(parsed.code).replace(/-(P|PRE)$/i, ''));
      if (index.sets.has(baseSet)) numbered = index.byNumber.get(`${baseSet}|${number}`) ?? null;
    }
    // The number is trusted only when the names agree: Hareruya's numbering
    // of a few sets (Secret Lair's biggest drops, some Universes Beyond
    // sets) is not Scryfall's, and a number alone would price another card.
    if (numbered && namesAgree(parsed, cardName, numbered)) return { id: numbered.id, why: null };
  }
  const names = [cardName, ...parsed.english].filter(Boolean);
  const prerelease = parsed.frames.some((f) => /プレリリース/.test(f)) || /-PRE$/i.test(String(parsed.code ?? ''));
  for (const n of names) {
    const hits = index.byName.get(`${inSet}|${nameKey(n)}`);
    if (!hits) continue;
    if (hits.length === 1) return { id: hits[0].id, why: null };
    // Several printings of the name in the set, and no number to tell them
    // apart: in a promo set, the prerelease ("<n>s") or promo-pack ("<n>p")
    // one; the retro-framed one when the name says 旧枠 (30th Anniversary
    // Edition, which has both frames), else the plain one: not a '★'
    // printing (the sample decks' copies in 7th to 10th Edition), not a
    // frame effect, promo or variant.
    let left = hits;
    if (isPromoCode(parsed.code)) left = left.filter((h) => new RegExp(prerelease ? 's$' : 'p$').test(String(h.collector_number)));
    const retro = parsed.frames.some((f) => /旧枠/.test(f));
    if (left.some((h) => h.retro) && left.some((h) => !h.retro)) left = left.filter((h) => Boolean(h.retro) === retro);
    if (left.length > 1) left = left.filter((h) => !String(h.collector_number).includes('★'));
    if (left.length > 1 && parsed.frames.length === 0) left = left.filter((h) => !h.special);
    if (left.length === 1) return { id: left[0].id, why: null };
    return { id: null, why: parsed.number === null ? 'several printings, no number' : 'number not in set' };
  }
  return { id: null, why: parsed.number === null ? 'name not in set' : 'number names another card' };
}

/**
 * Whether a Hareruya listing's names (the search's English card name, the
 * 《ja/en》 faces) name the Scryfall card: one of them is the card's name
 * or a face's. A token's "Angel Token" or "Angel+Angel Token" is the
 * token "Angel"; an emblem's "Emblem Chandra, ..." is "Chandra, ... Emblem".
 * A listing with no English name at all is taken on its number.
 */
export function namesAgree(parsed, cardName, card) {
  const given = [cardName, ...parsed.english].filter(Boolean).flatMap((n) => n.split('+'));
  if (given.length === 0) return true;
  const own = new Set([card.name, ...(card.faces ?? [])].map(nameKey));
  for (const n of given) {
    const k = nameKey(n);
    if (own.has(k)) return true;
    const bare = nameKey(n.replace(/\s*\([^)]*\)/g, '').replace(/\b(Token|Emblem)\b/gi, ' '));
    if (bare && (own.has(bare) || [...own].some((o) => o.replace(/\b(token|emblem)\b/g, ' ').trim().replace(/\s+/g, ' ') === bare))) return true;
  }
  return false;
}

/**
 * The index of Scryfall's default_cards for matchSingle, built from the
 * fields the build keeps per paper card: {id, set, collector_number, name,
 * faces (the face names), special (a frame effect, promo or variation: a
 * printing a plain name does not mean)}.
 */
export function buildScryfallIndex(cards) {
  const byNumber = new Map();
  const byName = new Map();
  const sets = new Set();
  for (const c of cards) {
    sets.add(c.set);
    byNumber.set(`${c.set}|${normalizeNumber(c.collector_number)}`, c);
    const names = new Set([c.name, ...(c.faces ?? [])].map(nameKey));
    for (const n of names) {
      const key = `${c.set}|${n}`;
      const list = byName.get(key);
      if (list) list.push(c);
      else byName.set(key, [c]);
    }
  }
  return { byNumber, byName, sets };
}

/** What the build keeps of one Scryfall card (a bulk-file object), or null when it is not a paper card. */
export function scryfallCardSummary(c) {
  if (c.digital || !c.set || !c.id) return null;
  const faces = Array.isArray(c.card_faces) ? c.card_faces.map((f) => f.name).filter(Boolean) : [];
  const promoTypes = (c.promo_types ?? []).filter((t) => t !== 'universesbeyond');
  const special = Boolean((c.frame_effects && c.frame_effects.length) || c.promo || c.variation || c.full_art || c.border_color === 'borderless' || c.textless || promoTypes.length);
  const retro = c.frame === '1993' || c.frame === '1997';
  return { id: c.id, set: c.set, collector_number: c.collector_number, name: c.name, faces, special, retro };
}

/**
 * One price cell per (printing, language, finish): the lowest NM price
 * among the SKUs in stock, else the lowest NM price at all (a sold-out
 * card keeps its list price). `docs` are Hareruya documents already
 * matched (each with `id` and `parsed`).
 */
export function pickPrices(docs) {
  const cells = new Map();
  for (const d of docs) {
    if (!d.id || d.card_condition !== '1') continue;
    const lang = LANGUAGES[Number(d.language)] ?? null;
    if (lang !== 'ja' && lang !== 'en') continue;
    const price = Number(d.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const stock = Number(d.stock) > 0;
    const key = `${d.id}|${lang}|${d.parsed.finish}`;
    const have = cells.get(key);
    if (!have || (stock && !have.stock) || (stock === have.stock && price < have.price)) cells.set(key, { price, stock, product: d.product });
  }
  return cells;
}

const FINISH_SLOT = { nonfoil: 0, foil: 1, etched: 2 };

/**
 * The cards file's rows from pickPrices' cells, sorted by id:
 *   [scryfall id, ja, ja_foil, ja_etched, en, en_foil, en_etched, product]
 * prices in yen (integers) or null; `product` is the Hareruya product id of
 * the cheapest cell (the card's page there).
 */
export function cardRows(cells) {
  const rows = new Map();
  for (const [key, cell] of cells) {
    const [id, lang, finish] = key.split('|');
    let row = rows.get(id);
    if (!row) {
      row = [id, null, null, null, null, null, null, null, Infinity];
      rows.set(id, row);
    }
    row[1 + (lang === 'en' ? 3 : 0) + FINISH_SLOT[finish]] = cell.price;
    if (cell.price < row[8]) {
      row[8] = cell.price;
      row[7] = Number(cell.product);
    }
  }
  return [...rows.values()].map((r) => r.slice(0, 8)).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** The cards file's text: one row per line. */
export function cardsBody({ built, scraped, rows, counts }) {
  return `{"v":${FORMAT},"source":"hareruya","currency":"JPY","built":"${built}","scraped":"${scraped}","counts":${JSON.stringify(counts)},"count":${rows.length},"rows":[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]}\n`;
}

// ---- Sealed products

const SEALED_LANG_TAGS = { JP: 'ja', EN: 'en', FR: 'fr', IT: 'it', DE: 'de', SC: 'zhs', CT: 'zht', TC: 'zht', SP: 'es', PO: 'pt', KR: 'ko', RU: 'ru' };

/**
 * The language a sealed product's name says it is in: 'ja', 'en', another
 * code, or null when it says nothing. Hareruya writes 【JP】/【EN】, 〇日本語版
 * / ●英語版 (and plain 日本語版 / 英語版), [JP]/[EN]/[JPN]/[ENG] in the English
 * name, and other languages by name.
 */
export function sealedLanguage(name, nameEn) {
  // The Japanese name first: the English name's tag is sometimes the
  // other language's ("《○日本語版》" beside "【EN】").
  const ja = String(name ?? '');
  if (/日本語版/.test(ja)) return 'ja';
  if (/英語版/.test(ja)) return 'en';
  const s = `${ja} ${nameEn ?? ''}`;
  for (const [tag, lang] of Object.entries(SEALED_LANG_TAGS)) if (ja.includes(`【${tag}】`)) return lang;
  if (/(イタリア|フランス|ドイツ|スペイン|ポルトガル|中国|韓国|ロシア|簡体字|繁体字)(語)?版/.test(s)) return 'other';
  for (const [tag, lang] of Object.entries(SEALED_LANG_TAGS)) if (s.includes(`【${tag}】`)) return lang;
  const en = s.match(/\[(JPN?|ENG?|ITA(?:LY)?|FRA|GER|SPA|POR|CHS|CHT|KOR|RUS)\]/i);
  if (en) {
    const t = en[1].toUpperCase();
    if (t === 'JP' || t === 'JPN') return 'ja';
    if (t === 'EN' || t === 'ENG') return 'en';
    return 'other';
  }
  if (/\b(Japanese|Italian|French|German|Spanish|Portuguese|Chinese|Korean|Russian)\b/i.test(s)) return /\bJapanese\b/i.test(s) ? 'ja' : 'other';
  return null;
}

/**
 * What a sealed product is, from its names and the Hareruya category it
 * was listed under ('pack', 'box', 'bundle', 'deck', 'other'): a kind the
 * app's sealed files know (MTGJSON's category and subtype), the set codes
 * named, how many packs, and the words of its English name for a deck.
 * Damaged, opened and lot listings are refused (null).
 */
export function parseSealedName(name, nameEn, category) {
  const s = String(name ?? '');
  const en = String(nameEn ?? '');
  if (/状態難|外装開封|開封済|破損|傷アリ|傷あり|折れ|値札跡|バーコード有|\(PLD\)|※①|※②|PSA\s*\d|BGS\s*\d/.test(s)) return null;
  // The set codes in the Japanese name ([POR] is Portal there; the English
  // name's [ENG]/[JPN] are languages, and are not read here).
  const codes = [...s.matchAll(/\[([A-Za-z0-9][A-Za-z0-9_\-]*)\]/g)].map((m) => m[1]).filter((c) => !/^(BB|WB)$/i.test(c));
  const packs = s.match(/\((\d+)\s*パック\)/) ?? en.match(/\((\d+)\s*Packs?\)/i);
  const n = packs ? Number(packs[1]) : null;
  const both = `${s} ${en}`;
  let booster = null;
  if (/プレイ・?ブースター|Play Booster/i.test(both)) booster = 'play';
  else if (/コレクター|Collector/i.test(both)) booster = 'collector';
  else if (/セット・?ブースター|Set Booster/i.test(both)) booster = 'set';
  else if (/ジャンプスタート|Jumpstart/i.test(both)) booster = 'jumpstart';
  else if (/ドラフト・?ブースター|Draft Booster/i.test(both)) booster = 'draft';
  else if (/ブースター|Booster/i.test(both)) booster = 'default';
  let kind = null;
  // A kit (a Starter Kit is two decks) and anything under the pack and box
  // categories that is not a booster are matched by name, below.
  if (/キット|\bKit\b/i.test(both)) kind = { cat: null, sub: null };
  else if (/ケース|Case\b/i.test(both) && booster && (category === 'box' || category === 'other')) kind = { cat: 'booster_case', sub: booster };
  else if (booster && (category === 'box' || (n !== null && n > 1))) kind = { cat: 'booster_box', sub: booster };
  else if (booster && (category === 'pack' || n === 1)) kind = { cat: 'booster_pack', sub: booster };
  else if (category === 'bundle' || /Bundle|バンドル|ファットパック|Fat Pack/i.test(both)) kind = { cat: 'bundle', sub: /ギフト|Gift/i.test(both) ? 'gift_bundle' : /ファットパック|Fat Pack/i.test(both) ? 'fat_pack' : 'default' };
  else if (/プレリリース|Prerelease/i.test(both)) kind = { cat: 'limited_aid_tool', sub: 'prerelease_kit' };
  else if (/統率者|Commander/i.test(both)) kind = { cat: 'deck', sub: 'commander' };
  else if (/スターター|Starter/i.test(both)) kind = { cat: 'deck', sub: 'starter_deck' };
  else if (/チャレンジャー|Challenger/i.test(both)) kind = { cat: 'deck', sub: 'challenger' };
  else if (/プレインズウォーカーデッキ|Planeswalker Deck/i.test(both)) kind = { cat: 'deck', sub: 'planeswalker' };
  else if (/イントロ|Intro/i.test(both)) kind = { cat: 'deck', sub: 'intro' };
  else if (/構築済|テーマデッキ|Theme Deck|Deck/i.test(both)) kind = { cat: 'deck', sub: null };
  else if (/プレリリース|Prerelease/i.test(both)) kind = { cat: 'limited_aid_tool', sub: 'prerelease_kit' };
  else kind = { cat: null, sub: null };
  const setOfMatch = both.match(/(\d)種(?:類)?セット/) ?? both.match(/Set of (\w+)/i);
  const setOf = setOfMatch ? Number(NUMBER_WORDS[setOfMatch[1].toLowerCase()] ?? setOfMatch[1]) || null : null;
  // The words that name the product: the English name's, and any Latin
  // words of the Japanese name (Hareruya's English name is sometimes the
  // plain product's: "Nightmare Bundle" beside "Bundle").
  const words = [...new Set([...deckWords(en || s), ...deckWords(s)])].filter((w) => !(setOf && /^\d+$/.test(w)));
  return { codes, packs: n, booster, kind, setOf, words };
}

/** The words of a sealed product's name that name the deck or product inside it, for matching. */
export function deckWords(name) {
  const clean = (t) =>
    String(t)
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\*ships to domestic only/gi, ' ');
  // The quoted parts name the product; when they hold no Latin words (a
  // "《●英語版》" alone), the whole name does.
  const inner = [...String(name).matchAll(/《([^》]*)》|「([^」]*)」|『([^』]*)』/g)].map((m) => m[1] ?? m[2] ?? m[3]).join(' ');
  const words = wordsOf(clean(inner)).filter((w) => !STOP_WORDS.has(w));
  if (words.length) return words;
  return wordsOf(clean(name)).filter((w) => !STOP_WORDS.has(w));
}

const NUMBER_WORDS = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };

/**
 * A name's words as both sides compare them: letters and digits apart
 * ("Horizon3"), number words as digits, plurals singular ("Horizons",
 * "Decks"), one-letter words (the s of "Collector's") dropped.
 */
function wordsOf(text) {
  return nameKey(
    String(text)
      .replace(/[™®©]/g, ' ')
      .replace(/([a-z])(\d)/gi, '$1 $2')
      .replace(/(\d)([a-z])/gi, '$1 $2'),
  )
    .split(' ')
    .filter((w) => w && w !== 's')
    .map((w) => NUMBER_WORDS[w] ?? (w.length > 3 && /[a-z]s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w));
}

const STOP_WORDS = new Set(['the', 'of', 'and', 'en', 'jp', 'eng', 'jpn', 'box', 'pack', 'booster', 'edition', 'set', 'deck', 'commander', 'magic', 'gathering', 'mtg', 'ver', 'version', 'drop', 'series']);

/**
 * The app's sealed product (from its set file) a Hareruya sealed listing
 * is, or null. `products` are the set's products as the set file lists
 * them (name, short, cat, sub, id). Boosters match by kind alone (a set has
 * one Play Booster Box); anything else by kind and the words of the name.
 */
export function matchSealed(parsed, products, language = 'en') {
  if (!parsed || !parsed.kind) return null;
  const { cat, sub } = parsed.kind;
  if (cat === 'booster_box' || cat === 'booster_pack' || cat === 'booster_case') {
    const wanted = products.filter((p) => p.cat === cat && (p.sub === sub || (sub === 'default' && p.sub === 'draft') || (sub === 'draft' && p.sub === 'default')));
    if (wanted.length === 1) return wanted[0];
    if (wanted.length > 1) {
      // Several boosters of the kind (a set's own and a Japanese one, or a
      // promotional pack): the plain one, the shortest name.
      const plain = wanted.filter((p) => !/\b(Japanese|Japan|Promo|Sample|Topper|Prerelease|Minimal Packaging)\b/i.test(p.name));
      if (plain.length === 1) return plain[0];
      return null;
    }
    return null;
  }
  let candidates;
  if (cat === 'bundle' || cat === 'bundle_case') {
    candidates = products.filter((p) => p.cat === cat && (sub === 'default' ? p.sub !== 'gift_bundle' : p.sub === sub || (sub === 'fat_pack' && p.sub === 'default')));
    if (candidates.length === 1) return candidates[0];
    if (candidates.length === 0) return null;
  } else {
    candidates = products.filter((p) => {
      if (/^booster_/.test(p.cat ?? '')) return false;
      if (cat === 'deck' && !(p.cat === 'deck' || (parsed.setOf && (p.cat === 'multiple_decks' || p.cat === 'subset' || p.cat === 'box_set' || p.cat === 'deck_box')))) return false;
      if (sub && p.cat === 'deck' && p.sub && p.sub !== sub) return false;
      if (parsed.setOf && p.cat === 'deck') return false;
      if (!parsed.setOf && /\bSet of \d|\bDisplay\b|\bCase\b/i.test(p.name)) return false;
      return true;
    });
  }
  // Anything named (a deck, a kit, a Secret Lair drop, one bundle of
  // several): every word of the Hareruya name must be in the product's
  // name, the fewest extra words wins, ties lose. A Japanese listing
  // takes a product named Japanese when there is one; an English one
  // never does.
  const words = parsed.words;
  const japanese = (p) => /\bJapanese\b/i.test(p.name);
  if (language === 'ja' && candidates.some(japanese)) candidates = candidates.filter(japanese);
  else candidates = candidates.filter((p) => !japanese(p));
  let best = null;
  let bestExtra = Infinity;
  let tie = false;
  for (const p of candidates) {
    const pw = new Set(wordsOf(p.name));
    if (!words.every((w) => pw.has(w))) continue;
    const extra = [...pw].filter((w) => !STOP_WORDS.has(w) && !words.includes(w) && w !== 'japanese').length;
    if (extra < bestExtra) {
      best = p;
      bestExtra = extra;
      tie = false;
    } else if (extra === bestExtra) tie = true;
  }
  return tie ? null : best;
}

/** The sealed file's text: prices by the app's product id, per language. */
export function sealedBody({ built, scraped, ja, en, counts }) {
  const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  return `{"v":${FORMAT},"source":"hareruya","currency":"JPY","built":"${built}","scraped":"${scraped}","counts":${JSON.stringify(counts)},"ja":${JSON.stringify(sorted(ja))},"en":${JSON.stringify(sorted(en))}}\n`;
}
