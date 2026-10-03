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
- `prices/`: the day's prices for every paper printing, built from
  Scryfall's bulk data by `scripts/build-prices.mjs` in the daily deploy and
  never committed. `version.json` names the current version's full file and
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
