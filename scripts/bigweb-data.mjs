// The pure part of the Bigweb (BIG MAGIC, bigweb.co.jp) reader: what a
// listing from its product API says, which Scryfall printing or sealed
// product it is, and the price cells. No network, no files: checked by
// scripts/bigweb-data-check.mjs. The build is scripts/build-bigweb.mjs.
//
// A listing (api.bigweb.co.jp/products?game_id=1&cardsets=<id>&page=N,
// 100 a page) carries:
//   name           the English card name; a variant printing (a Booster
//                  Fun, extended-art or alternate-art card) ends in "(363",
//                  its collector number, and `comment` starts with it too
//   fname          the Japanese name
//   price          yen (an integer); is_hidden_price hides it
//   stock_count    copies on hand; is_sold_out; is_preorder_item
//   language       {slip_en: "JP" | "EN" | ...}
//   condition      {web: "ニアミント" | "FOILニアミント" | "特殊FOIL NM" | "プレイド" | "", name: "NM" | ...}
//   cardset        {slip: "FRA" | "FRA_BF" | "TSR_TSB" | "pPRE" ...}: Bigweb's set code,
//                  Scryfall's with a suffix for a part of the set
//   is_box         a sealed product (a blank condition), named
//                  "日本語版 ファウンデーションズ コレクター・ブースターBOX（12パック入）"
import { buildScryfallIndex, isPromoCode, matchSealed, nameKey, normalizeNumber, normalizeSetCode, parseSealedName } from './hareruya-data.mjs';

export { buildScryfallIndex };

/**
 * Suffixes of Bigweb's set codes that name a Scryfall set of their own,
 * not a part of the base set.
 */
const SUFFIX_SETS = { TSB: 'tsb' };

/**
 * Bigweb's set code as Scryfall's: the base code (its own aliases through
 * normalizeSetCode) and the suffix, which names a part of the set (BF the
 * Booster Fun printings, EX extended art, JP Japanese alternate art, CMD
 * the Commander decks, BLK ...). A trailing dot is Bigweb's own mark.
 */
export function bigwebSet(raw) {
  const code = String(raw ?? '').trim().replace(/\.$/, '');
  if (!code) return { set: '', variant: '', raw: code };
  const m = code.match(/^([^_]+)(?:_(.+))?$/);
  const base = m ? m[1] : code;
  const variant = m && m[2] ? m[2].toUpperCase() : '';
  if (SUFFIX_SETS[variant]) return { set: SUFFIX_SETS[variant], variant, raw: code };
  // "pPRE", "pFNM": promo listings with no set of their own.
  if (/^p[A-Z]+$/.test(base)) return { set: '', variant, raw: code };
  return { set: normalizeSetCode(base), variant, raw: code };
}

const VARIANT_SUFFIXES = new Set(['BF', 'EX', 'JP', 'ALT', 'BLK', 'HO', 'VIP', 'RA']);

/**
 * What a single-card listing says, or null when it is not a priced single
 * (a sealed product, a played copy, a hidden price, a language the files
 * do not carry).
 */
export function parseBigwebSingle(item) {
  if (!item || item.is_box) return null;
  if (item.is_hidden_price) return null;
  const price = Number(item.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const langTag = String(item.language?.slip_en ?? '').toUpperCase();
  const lang = langTag === 'JP' ? 'ja' : langTag === 'EN' ? 'en' : null;
  if (!lang) return null;
  const condition = String(item.condition?.web ?? '').trim();
  const conditionName = String(item.condition?.name ?? '').trim().toUpperCase();
  // NM only: Bigweb files played copies as プレイド (name EX/PL), and a
  // listing with no condition at all is a supply or a sealed product.
  if (!condition || !(conditionName === 'NM' || /ニアミント/.test(condition))) return null;
  if (/プレイド/.test(condition)) return null;
  const rawName = String(item.name ?? '').trim();
  // A double-sided token is "GOBLIN ARMY(03 | TREASURE(12": one name a
  // side, each with its number; the first side is the card's.
  const sides = rawName.split(/\s*\|\s*/).filter(Boolean);
  // A variant printing's name ends in "(363" (the closing bracket left
  // out) or "(363)"; the comment starts with the same number.
  const inName = (sides[0] ?? rawName).match(/^(.*?)\s*\((\d+[a-z★]*)\)?\s*$/);
  const name = inName ? inName[1].trim() : (sides[0] ?? rawName);
  const faces = sides.slice(1).map((s) => s.replace(/\s*\(\d+[a-z★]*\)?\s*$/, '').trim()).filter(Boolean);
  const comment = String(item.comment ?? '');
  const inComment = comment.match(/^\s*(\d+[a-z★]*)\s*(?:<br>|$)/);
  const number = inName ? inName[2] : inComment ? inComment[1] : null;
  if (!name) return null;
  const etched = /エッチング/i.test(`${condition} ${rawName} ${item.sale_words ?? ''}`);
  const finish = etched ? 'etched' : /FOIL/i.test(condition) ? 'foil' : 'nonfoil';
  const { set, variant, raw } = bigwebSet(item.cardset?.slip ?? item.cardset?.code);
  const stock = !item.is_sold_out && !item.is_preorder_item && Number(item.stock_count) > 0;
  return { product: Number(item.id), name, faces, nameJa: String(item.fname ?? ''), number, lang, finish, price, stock, set, variant, rawSet: raw };
}

/**
 * The Scryfall printing a Bigweb single is: by set and collector number
 * when the listing carries one, else by set and English name when exactly
 * one printing of that name is in the set, or exactly one of the kind the
 * set code's suffix names (a plain code the plain printing, a variant
 * suffix a special one). `index` is buildScryfallIndex's. The result names
 * why nothing matched, for the report.
 */
export function matchBigwebSingle(parsed, index) {
  if (!parsed) return { id: null, why: 'not a single' };
  const set = parsed.set;
  if (!set) return { id: null, why: 'no set code' };
  // A token: named so, or a double-sided one (two names), or filed in a
  // set that has only a token set at Scryfall.
  const token = /\b(Token|Emblem)\b/i.test(parsed.name) || parsed.faces.length > 0 || (!index.sets.has(set) && index.sets.has(`t${set}`));
  const inSet = token && index.sets.has(`t${set}`) ? `t${set}` : set;
  if (!index.sets.has(inSet)) return { id: null, why: `unknown set ${parsed.rawSet}` };
  if (parsed.number !== null) {
    const number = normalizeNumber(parsed.number);
    const promo = isPromoCode(parsed.rawSet);
    const tries = promo ? [`${number}p`, `${number}s`, number] : [number, `${number}★`];
    for (const t of tries) {
      const hit = index.byNumber.get(`${inSet}|${t}`);
      if (hit && namesAgreeLoosely(parsed.name, hit)) return { id: hit.id, why: null };
    }
  }
  // A token or emblem is listed as "Wolf Token"; Scryfall names it "Wolf".
  const bare = token ? parsed.name.replace(/\s+(Token|Emblem)\s*$/i, '') : parsed.name;
  let candidates = index.byName.get(`${inSet}|${nameKey(bare)}`) ?? index.byName.get(`${inSet}|${nameKey(parsed.name)}`) ?? [];
  // A double-sided token lists both sides: the one both names fit.
  if (token && parsed.faces.length > 0 && candidates.length > 1) {
    const keys = parsed.faces.map(nameKey);
    const both = candidates.filter((c) => keys.every((k) => [c.name, ...(c.faces ?? [])].map(nameKey).includes(k)));
    if (both.length >= 1) candidates = both;
  }
  if (candidates.length === 0) return { id: null, why: parsed.number !== null ? 'number not in the set' : 'name not in the set' };
  if (candidates.length === 1) return { id: candidates[0].id, why: null };
  const wanted = VARIANT_SUFFIXES.has(parsed.variant) ? candidates.filter((c) => c.special) : candidates.filter((c) => !c.special && !c.retro);
  if (wanted.length === 1) return { id: wanted[0].id, why: null };
  return { id: null, why: 'several printings of the name' };
}

/** The listing's name and the printing's agree (a number alone never decides: Bigweb's numbers come from its own catalogue). */
function namesAgreeLoosely(name, card) {
  const key = nameKey(name);
  if (!key) return false;
  const names = [card.name, ...(card.faces ?? [])].map(nameKey);
  return names.some((n) => n === key || n.startsWith(key) || key.startsWith(n));
}

/**
 * One price cell per (printing, language, finish): the lowest price among
 * the listings in stock, else the lowest at all (a sold-out card keeps its
 * list price). `singles` are parsed listings with `id` set by the match.
 * The cells are what hareruya-data's cardRows writes.
 */
export function pickBigwebPrices(singles) {
  const cells = new Map();
  for (const s of singles) {
    if (!s.id) continue;
    const key = `${s.id}|${s.lang}|${s.finish}`;
    const have = cells.get(key);
    if (!have || (s.stock && !have.stock) || (s.stock === have.stock && s.price < have.price)) cells.set(key, { price: s.price, stock: s.stock, product: s.product });
  }
  return cells;
}

// ---- Sealed products

/**
 * What a sealed listing says, in the shape hareruya-data's matchSealed
 * takes, with its language and set: "日本語版 ファウンデーションズ
 * コレクター・ブースターBOX（12パック入）" is Japanese, a collector booster
 * box of 12 packs, of the set the listing is filed under. Null when it
 * is not a sealed product, has no language or set, or is a deck or kit
 * (their names carry no Latin words to match by).
 */
export function parseBigwebSealed(item) {
  if (!item || !item.is_box) return null;
  if (item.is_hidden_price) return null;
  const price = Number(item.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const raw = String(item.name ?? '').trim();
  const langMatch = raw.match(/^(日本語版|英語版)\s*/);
  const language = langMatch ? (langMatch[1] === '日本語版' ? 'ja' : 'en') : null;
  if (!language) return null;
  const { set } = bigwebSet(item.cardset?.slip ?? item.cardset?.code);
  if (!set) return null;
  // Bigweb's full-width brackets and "入" (packs inside) as Hareruya writes them.
  const name = raw
    .slice(langMatch[0].length)
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\((\d+)\s*パック入\)/, '($1パック)');
  const category = /BOX|ボックス/i.test(name) ? 'box' : /バンドル|Bundle/i.test(name) ? 'bundle' : /デッキ|Deck/i.test(name) ? 'deck' : /パック|Pack/i.test(name) ? 'pack' : 'other';
  const parsed = parseSealedName(`${name} [${set.toUpperCase()}]`, '', category);
  if (!parsed || !parsed.kind) return null;
  // Boosters and bundles match by kind alone; a deck, kit or anything
  // else only by the Latin words of its name ("Foundations Commander Deck
  // 5種セット" has them, "統率者デッキ" has none).
  const byKind = /^booster_/.test(parsed.kind.cat ?? '') || parsed.kind.cat === 'bundle';
  if (!byKind && parsed.words.length === 0) return null;
  const stock = !item.is_sold_out && !item.is_preorder_item && Number(item.stock_count) > 0;
  return { product: Number(item.id), name: raw, language, set, parsed, price, stock };
}

/** The app's sealed product a parsed Bigweb listing is, or null. */
export function matchBigwebSealed(sealed, products) {
  if (!sealed || !products) return null;
  return matchSealed(sealed.parsed, products, sealed.language);
}
