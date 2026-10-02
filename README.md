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
- `prices/latest.json`: the day's prices for every paper printing, built
  from Scryfall's bulk data by `scripts/build-prices.mjs` in the daily
  deploy; it is never committed.
