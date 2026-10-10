// The pure part of the marketplace reader (scripts/build-marketplaces.mjs):
// the search a sealed product is asked for at Rakuten Ichiba and Yahoo!
// Shopping, which of the offers answered is that product, and the file.
// No network: checked by scripts/marketplace-data-check.mjs.
//
// The marketplaces list sealed Magic products by free-text Japanese
// titles ("MTG ファウンデーションズ プレイ・ブースター BOX 日本語版 36パック"),
// so a product is searched for by its set's Japanese name and its kind's
// words, and an offer counts only when its title confirms the set, the
// kind (box or pack, which booster), the language and, when the title
// names one, the pack count. The cheapest such offer in stock is kept.

/** The Japanese words of a booster kind (the sealed set files' `sub`). */
const BOOSTER_WORDS = {
  play: 'プレイ・ブースター',
  collector: 'コレクター・ブースター',
  set: 'セット・ブースター',
  draft: 'ドラフト・ブースター',
  default: 'ブースター',
  jumpstart: 'ジャンプスタート',
};

const LANGUAGE_WORDS = { ja: '日本語版', en: '英語版' };

/**
 * What a shelf product is asked for: the query text, and what an offer's
 * title must say. Null for a kind the marketplaces are not asked about
 * (decks, kits, cases: their names do not travel in Japanese).
 */
export function marketplaceQuery(product, setNameJa, language) {
  if (!product || !setNameJa || !LANGUAGE_WORDS[language]) return null;
  const cat = product.cat ?? '';
  const sub = product.sub ?? 'default';
  let kind = null;
  if (cat === 'booster_box' || cat === 'booster_pack') {
    const booster = BOOSTER_WORDS[sub];
    if (!booster) return null;
    kind = { booster: sub, unit: cat === 'booster_box' ? 'box' : 'pack', words: `${booster} ${cat === 'booster_box' ? 'BOX' : 'パック'}` };
  } else if (cat === 'bundle') {
    kind = { booster: null, unit: 'bundle', words: sub === 'gift_bundle' ? 'ギフトバンドル' : 'バンドル' };
  } else return null;
  // Samples, promo packs and the like are not shelf products here.
  if (/\b(Sample|Promo|Topper|Prerelease|Minimal Packaging)\b/i.test(product.name ?? '')) return null;
  const packs = packsOf(product);
  return {
    text: `MTG ${setNameJa} ${kind.words} ${LANGUAGE_WORDS[language]}`,
    setNameJa,
    language,
    booster: kind.booster,
    unit: kind.unit,
    packs,
  };
}

/** How many packs a box holds, from its parts (the set files' `parts`: ['p', booster, count]), or null. */
function packsOf(product) {
  if (!Array.isArray(product.parts)) return null;
  let n = 0;
  for (const part of product.parts) if (Array.isArray(part) && part[0] === 'p') n += Number(part[2]) || 0;
  return n > 1 ? n : null;
}

const fold = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .replace(/[\s　]+/g, '')
    .toLowerCase();

/**
 * Whether an offer's title is the product asked for: it names the set, the
 * kind and the unit, says the language (or none, taken as Japanese for a
 * Japanese query), agrees on the pack count when it gives one, and is not
 * a lot, a part or a used box.
 */
export function offerMatches(query, title) {
  const t = fold(title);
  if (!t.includes(fold(query.setNameJa))) return false;
  if (/開封済|空箱|空き箱|バラ|シュリンク無|シュリンクなし|中古|ジャンク|\d+個セット|\d+箱セット|ケース\b/.test(title) || /\bcase\b/i.test(title)) return false;
  const says = (word) => t.includes(fold(word));
  if (query.language === 'ja' && says('英語版')) return false;
  if (query.language === 'en' && !says('英語版')) return false;
  if (query.unit === 'bundle') {
    if (!says('バンドル') && !/bundle/i.test(title)) return false;
    const gift = says('ギフト') || /gift/i.test(title);
    if (gift !== (query.booster === null && /ギフト/.test(query.text))) return false;
  } else {
    const booster = BOOSTER_WORDS[query.booster];
    const boosterSaid = says(booster) || says(booster.replace(/・/g, ''));
    if (!boosterSaid) return false;
    // Another booster kind named too (a listing of several) is not this one.
    for (const [sub, words] of Object.entries(BOOSTER_WORDS)) {
      if (sub === query.booster || sub === 'default') continue;
      if (says(words) && !booster.includes(words)) return false;
    }
    const box = says('box') || says('ボックス');
    if (query.unit === 'box' && !box) return false;
    if (query.unit === 'pack' && box) return false;
  }
  const count = title.match(/(\d+)\s*(?:パック|packs?)/i);
  if (count && query.packs !== null && Number(count[1]) !== query.packs) return false;
  return true;
}

/**
 * Rakuten's answer (IchibaItem Search 20260701: a lowercase `items` array,
 * flat with formatVersion 2 or each in an `item` wrapper; the older `Items`
 * and `Item` are read too) as offers: {price, url, title, seller, stock}.
 * The affiliate link, when the request carried an affiliate id, is the URL.
 */
export function rakutenOffers(json) {
  const items = Array.isArray(json?.items) ? json.items : Array.isArray(json?.Items) ? json.Items : [];
  return items
    .map((it) => (it && (it.item || it.Item)) || it)
    .filter((it) => it && typeof it === 'object')
    .map((it) => ({ price: Number(it.itemPrice), url: String(it.affiliateUrl || it.itemUrl || ''), title: String(it.itemName ?? ''), seller: String(it.shopName ?? ''), stock: Number(it.availability) === 1 }))
    .filter((o) => Number.isFinite(o.price) && o.price > 0 && o.url);
}

/** Yahoo! Shopping's answer (itemSearch V3) as offers. */
export function yahooOffers(json) {
  const hits = Array.isArray(json?.hits) ? json.hits : [];
  return hits
    .filter((h) => h && typeof h === 'object')
    .map((h) => ({ price: Number(h.price), url: String(h.url ?? ''), title: String(h.name ?? ''), seller: String(h.seller?.name ?? ''), stock: h.inStock !== false }))
    .filter((o) => Number.isFinite(o.price) && o.price > 0 && o.url);
}

/** The cheapest offer in stock that is the product, or null. */
export function pickOffer(query, offers) {
  let best = null;
  for (const o of offers) {
    if (!o.stock || !offerMatches(query, o.title)) continue;
    if (!best || o.price < best.price) best = o;
  }
  return best;
}

/**
 * The file's text: prices by the app's product id under each marketplace
 * and language, each [price, url, seller].
 */
export function marketplaceBody({ built, since, sources, counts }) {
  const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  const out = {};
  for (const [name, langs] of Object.entries(sources)) out[name] = { ja: sorted(langs.ja ?? {}), en: sorted(langs.en ?? {}) };
  return `${JSON.stringify({ v: 1, currency: 'JPY', built, since, counts, sources: out })}\n`;
}
