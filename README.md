# stacksmith-site

The public files the Stacksmith app reads, served by Cloudflare Pages at
https://stacksmith-app.pages.dev/ (the app's address since 2026-10-03,
project stacksmith-app, deployed with the CLOUDFLARE_API_TOKEN and
CLOUDFLARE_ACCOUNT_ID secrets) and by GitHub Pages at
https://colinwithat-boop.github.io/stacksmith-site/ (for older app builds
and the store listings' privacy link; Pages source: GitHub
Actions, deployed by `.github/workflows/prices.yml` on every push and every
morning).

- `privacy.html`, `support.html`, `index.html`: the app's privacy policy and
  support pages (the policy's source copy lives in the app repo under
  `store/`; copy it here after a change).
- `packs/`: the card-language packs (names and rules text per language).
- `sets/names.json`: localized set names for the app's Home tab, refreshed
  every Monday by `.github/workflows/set-names.yml` from Wizards' product pages.
- `home/`: `latest.json`, what the app's Home tab shows under "Coming up":
  the next set releases (with the names above) and the Secret Lair drops
  from a few weeks back to the newest announced, by sale day and drop, each
  with a Scryfall search link. Built on every deploy by
  `scripts/build-home.mjs` from Scryfall (sets, the Secret Lair cards) and
  MTGJSON's SLD.json (the drop names, MIT); never committed. Grouping and
  shape: `scripts/home-data.mjs`, checked by `scripts/home-data-check.mjs`.
  Nothing is read from Wizards' Secret Lair store; the app only links to it.
- `sealed/`: what is inside sealed products, for the app's Packs tab:
  `index.json` (every set with a product the app can value, newest first,
  each with its products' short names, kinds, dates and TCGplayer ids, for
  the app's search over every set and its older products, by their place in
  the set file, and the file's content hash `h`, which the set file carries
  too, so the app can tell a copy from another build; ~55 KB gzipped) and `sets/set-<CODE>.json` (a set's products as a tree of parts: cards, packs
  of a booster type, deck lists and other products; every booster type's
  slot layouts with each sheet's cards and weights; the deck lists), all by
  Scryfall id. Built from MTGJSON (MIT: SetList.json, the booster tables,
  the card and token identifiers) by `scripts/build-sealed.mjs`, the pure
  part and format in `scripts/sealed-data.mjs`, checked by
  `scripts/sealed-data-check.mjs`. No prices and no build time, so the
  files change only when MTGJSON's data does: `.github/workflows/sealed.yml`
  rebuilds them daily (07:41 UTC) and commits them only when they changed,
  then publishes the site. A product is listed only when every part of it
  can be valued (its booster types' odds are in MTGJSON, its cards resolve
  to Scryfall ids); online redemptions and Arena's boosters never are.
  `prices.json` beside them (never committed) is the sealed products' own
  prices for every year's products (`since` is the first day of the last
  three years, which the app calls current), in each market the app
  prices in: `usd`, TCGplayer's Market by TCGplayer product id, from
  tcgcsv's group files, and `eur`, Cardmarket's trend by Cardmarket
  product id (the figure Scryfall's card prices in euros are), from
  Cardmarket's public daily price guide. Built in every deploy by
  `scripts/build-sealed-prices.mjs`, which keeps the live file's prices
  for a market that has not published since (tcgcsv's last-updated.txt,
  the guide's ETag). Of tcgcsv's ~300 groups, the current sets' (~50) are
  asked each publish and an older set's one day in seven, or when it was
  not asked for over eight days (`refreshed` in the file); a first run asks
  them all once. `SEALED_MAX_GROUPS=5` caps the groups asked, for a run by
  hand. Products in another language (War of the Spark's
  Japanese boosters, Renaissance's German ones) are left out: their cards
  are the set's own in that language, and the app has only English
  prices; a Secret Lair drop in Japanese stays (its own printings).
- `hareruya/`: what cards and sealed products sell for at Hareruya
  (晴れる屋, hareruyamtg.com, Japan's largest Magic retailer), in yen, for
  the app's users in Japan. `cards.json` holds one row per Scryfall
  printing Hareruya sells, `[scryfall id, ja, ja_foil, ja_etched, en,
  en_foil, en_etched, product]`: the Japanese-language and the
  English-language copies of the same printing, NM, the cheapest in
  stock (else the cheapest listed), and the Hareruya product id, whose
  page is `https://www.hareruyamtg.com/ja/products/detail/<product>`.
  `sealed.json` holds the sealed products' prices by the app's product id
  (the sealed set files' `id`), under `ja` and `en`, each `[price,
  product, in stock]` (1 in stock, 0 sold out; the app leaves a sold-out
  product out of its best-value strip). `report.json` says what did not match and why. Built by
  `scripts/build-hareruya.mjs` from Hareruya's own product search (JSON,
  one document per SKU, read set by set with one request every 0.4 s,
  ~600 a run) and Scryfall's bulk data (the set code and collector number
  in a product's name name the printing; the pure parsing and matching is
  `scripts/hareruya-data.mjs`, checked by `scripts/hareruya-data-check.mjs`).
  Hareruya is read once a day: the prices workflow builds only when the
  live `cards.json` is over 20 hours old (or its `hareruya` input is
  ticked) and republishes the live files otherwise. Never committed. By
  hand, with every answer kept on disk for tuning the parser:
  `HARERUYA_FORCE=true node scripts/build-hareruya.mjs --dir _site/hareruya --raw-dir /tmp/hareruya --no-live`.
- `bigweb/`: the same three files for Bigweb (BIG MAGIC, bigweb.co.jp),
  the second Japanese shop (2026-10-10), shaped exactly as `hareruya/`'s
  with `"source": "bigweb"`; a card's page is
  `https://www.bigweb.co.jp/ja/products/mtg/<product>`. Built by
  `scripts/build-bigweb.mjs` from Bigweb's own product API
  (api.bigweb.co.jp, JSON, 100 listings a page: the set list once, every
  set whose code names a Scryfall set page by page, the sealed goods
  whole; one request every 0.4 s, ~2,800 a run). A variant printing's
  listing carries its collector number ("(363"), a plain one matches by
  name within the set, a double-sided token by both names; the parsing
  and matching is `scripts/bigweb-data.mjs`, checked by
  `scripts/bigweb-data-check.mjs`. Sealed: boosters and bundles by kind,
  decks and kits only when the name has Latin words. Read once a day on
  the same rule as Hareruya (its `bigweb` input forces a read). By hand:
  `BIGWEB_FORCE=true node scripts/build-bigweb.mjs --dir _site/bigweb --raw-dir /tmp/bigweb --no-live [--max-sets 6]`.
- `prices/`: the day's prices for every paper printing, built from
  Scryfall's bulk data by `scripts/build-prices.mjs` in the daily deploy and
  never committed: TCGplayer Market in dollars and Cardmarket's trend in
  euros from Scryfall, and (since 2026-10-09) Cardmarket's cheapest listing
  and 30-day average from its public price guide, by the card's
  cardmarket_id, for the app's Cardmarket Low and Average levels. `version.json` names the current version's full file and
  the change file from the version before (the rows that differ, about
  half the size), which is what a phone holding yesterday's prices
  downloads; `latest.json` is the full file again for older app builds.
  The layout and its check: `scripts/price-changes.mjs`,
  `scripts/price-changes-check.mjs`. Only the morning run makes a new
  version (10:20 UTC; 14:20 is a catch-up that builds only if the morning
  run failed); a push or the set names' run publishes the live one again,
  so the change file always starts from what phones took the day before.
  `.github/workflows/keepalive.yml` commits a date weekly when nothing was
  committed for 40 days: GitHub turns a public repo's schedules off after
  60 days without a commit.
  The site's address is `SITE_URL` in the workflow (the app's
  `lib/site.ts` holds the same).
