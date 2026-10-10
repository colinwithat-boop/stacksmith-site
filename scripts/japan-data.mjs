// The pure part of the Japan merge (scripts/build-japan.mjs): one price
// file across the Japanese shops the site reads (Hareruya, Bigweb), the
// cheapest IN-STOCK price per cell, else the cheapest listed, and the shop
// that has it, for the app's "Japan" price source (the owner, 2026-10-10:
// the cheapest in stock across shops, the Buy link to whichever has it;
// in stock before out of stock regardless of price). No network, no
// files: checked by scripts/japan-data-check.mjs.
//
// A shop's cards file (hareruya/cards.json, bigweb/cards.json) has rows
//   [scryfall id, ja, ja_foil, ja_etched, en, en_foil, en_etched, product, stock]
// where `stock` (since 2026-10-10) is a bitmask of the cells in stock
// (bit 0 ja, 1 ja_foil, 2 ja_etched, 3 en, 4 en_foil, 5 en_etched); a row
// without it (a file from before) counts every priced cell as in stock.
// The merged file's rows are
//   [scryfall id, ja, ja_foil, ja_etched, en, en_foil, en_etched, product, shop, stock]
// with `shop` the name of the shop whose `product` it is ("hareruya" or
// "bigweb"): the shop of the cheapest in-stock cell, else of the cheapest.
// A shop's sealed file has cells [price, product, in stock] under `ja` and
// `en`; the merged one [price, product, in stock, shop].

export const CELLS = 6;

/** The in-stock bitmask of a row: its own, or every priced cell for a row from before the mask. */
export function stockOf(row) {
  const mask = Number(row[8]);
  if (Number.isFinite(mask) && row.length > 8 && row[8] !== null) return mask;
  let m = 0;
  for (let i = 0; i < CELLS; i++) if (row[1 + i] !== null && row[1 + i] !== undefined) m |= 1 << i;
  return m;
}

/**
 * The merged rows: `files` maps a shop's name to its parsed cards file
 * ({rows}). Per printing, each cell takes the cheapest in-stock price
 * across the shops, else the cheapest listed; the row's shop and product
 * are the cheapest in-stock cell's shop, else the cheapest cell's.
 */
export function mergeCardRows(files) {
  const byId = new Map();
  for (const [shop, file] of Object.entries(files)) {
    if (!file || !Array.isArray(file.rows)) continue;
    for (const row of file.rows) {
      const id = row[0];
      if (typeof id !== 'string' || !id) continue;
      const stock = stockOf(row);
      let out = byId.get(id);
      if (!out) {
        out = { cells: new Array(CELLS).fill(null), best: null };
        byId.set(id, out);
      }
      for (let i = 0; i < CELLS; i++) {
        const price = row[1 + i];
        if (typeof price !== 'number' || !(price > 0)) continue;
        const inStock = (stock & (1 << i)) !== 0;
        const have = out.cells[i];
        if (!have || (inStock && !have.stock) || (inStock === have.stock && price < have.price)) out.cells[i] = { price, stock: inStock, shop, product: Number(row[7]) || null };
      }
    }
  }
  const rows = [];
  for (const [id, { cells }] of byId) {
    let best = null;
    let mask = 0;
    for (let i = 0; i < CELLS; i++) {
      const c = cells[i];
      if (!c) continue;
      if (c.stock) mask |= 1 << i;
      if (!best || (c.stock && !best.stock) || (c.stock === best.stock && c.price < best.price)) best = c;
    }
    if (!best) continue;
    rows.push([id, ...cells.map((c) => (c ? c.price : null)), best.product, best.shop, mask]);
  }
  return rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * The merged sealed prices: `files` maps a shop's name to its parsed
 * sealed file ({ja, en}); per product and language the cheapest in-stock
 * cell across the shops, else the cheapest, as [price, product, in stock, shop].
 */
export function mergeSealed(files) {
  const out = { ja: {}, en: {} };
  for (const lang of ['ja', 'en']) {
    for (const [shop, file] of Object.entries(files)) {
      const map = file && file[lang] && typeof file[lang] === 'object' ? file[lang] : {};
      for (const [id, cell] of Object.entries(map)) {
        if (!Array.isArray(cell)) continue;
        const price = Number(cell[0]);
        if (!Number.isFinite(price) || price <= 0) continue;
        const stock = cell.length > 2 ? Number(cell[2]) === 1 : true;
        const have = out[lang][id];
        if (!have || (stock && !have[2]) || (stock === Boolean(have[2]) && price < have[0])) out[lang][id] = [price, Number(cell[1]) || null, stock ? 1 : 0, shop];
      }
    }
  }
  return out;
}

/** The merged cards file's text, one row a line. */
export function japanCardsBody({ built, scraped, shops, rows }) {
  return `{"v":1,"source":"japan","currency":"JPY","built":"${built}","scraped":"${scraped}","shops":${JSON.stringify(shops)},"count":${rows.length},"rows":[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]}\n`;
}

/** The merged sealed file's text. */
export function japanSealedBody({ built, scraped, shops, ja, en }) {
  const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  return `{"v":1,"source":"japan","currency":"JPY","built":"${built}","scraped":"${scraped}","shops":${JSON.stringify(shops)},"ja":${JSON.stringify(sorted(ja))},"en":${JSON.stringify(sorted(en))}}\n`;
}
