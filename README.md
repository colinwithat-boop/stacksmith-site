# stacksmith-site

The public files the Stacksmith app reads, served by GitHub Pages at
https://colinwithat-boop.github.io/stacksmith-site/ (Pages source: GitHub
Actions, deployed by `.github/workflows/prices.yml` on every push and every
morning).

- `privacy.html`, `support.html`, `index.html`: the app's privacy policy and
  support pages (the policy's source copy lives in the app repo under
  `store/`; copy it here after a change).
- `packs/`: the card-language packs (names and rules text per language).
- `sets/names.json`: localized set names for the app's Home tab, refreshed
  every Monday by `.github/workflows/set-names.yml` from Wizards' product pages.
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
