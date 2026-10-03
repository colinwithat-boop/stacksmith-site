// Fills sets/names.json, the localized set names the Stacksmith app's Home
// tab shows, from Wizards' localized product pages: the first <h1> of
// magic.wizards.com/<lang>/products/<slug>, where the slug is the English
// name in lower-case hyphens. No API carries these (Scryfall is English
// only; MTGJSON's translations stop in 2023), and Wizards keeps many names
// English in some languages (then the entry is left out and the app shows
// English). The set-names workflow (.github/workflows/set-names.yml) runs
// it weekly and commits the result; by hand:
//
//   node scripts/update-set-names.mjs [--out sets/names.json] [--since 2025-01-01] [--codes fra,trk]
//
// Default: every non-digital set of a release type whose release date is
// within the last 400 days or in the future. Six languages, one request
// each per set, 250 ms apart; a 404 (no product page) is normal for
// commander decks and the like, which the app names after their main set.
// `updated` moves only when a name changed, so an unchanged run leaves the
// file untouched and the workflow commits nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const OUT = path.resolve(ROOT, opt('--out', 'sets/names.json'));
const SINCE = opt('--since', new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10));
const ONLY = opt('--codes', '')
  .split(',')
  .map((c) => c.trim().toLowerCase())
  .filter(Boolean);
const UA = 'Stacksmith set-names (https://stacksmith-app.pages.dev/)';
const RELEASE_TYPES = new Set(['core', 'expansion', 'masters', 'commander', 'draft_innovation', 'starter']);
// Wizards' site path per app language.
const SITE_LANGS = { ja: 'ja', de: 'de', fr: 'fr', es: 'es', it: 'it', pt: 'pt-br' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugOf = (name) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function decode(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (w, ref) => {
    if (ref[0] !== '#') return named[ref];
    const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
    return String.fromCodePoint(code);
  });
}

/**
 * The product page's name, cleaned: the quotes Japanese pages wrap it in
 * (sometimes around the brand prefix too, sometimes with spaces inside),
 * the "Magic: The Gathering |" brand prefix of Universes Beyond pages in
 * either language, and the trademark sign. Each step is tried twice so
 * the order they appear in does not matter.
 */
function cleanName(h1) {
  let s = decode(h1).replace(/<[^>]+>/g, '').replace(/™/g, '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i++) {
    s = s
      .replace(/^『\s*(.*?)\s*』$/, '$1')
      .replace(/^(Magic: The Gathering|マジック：ザ・ギャザリング)\s*[|｜]\s*/i, '')
      .trim();
  }
  return s;
}

async function pageName(lang, slug) {
  const res = await fetch(`https://magic.wizards.com/${SITE_LANGS[lang]}/products/${slug}`, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (res.status !== 200) return null;
  const html = await res.text();
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1];
  return h1 ? cleanName(h1) : null;
}

const sets = (await (await fetch('https://api.scryfall.com/sets', { headers: { 'User-Agent': UA, Accept: 'application/json' } })).json()).data
  .filter((s) => !s.digital && RELEASE_TYPES.has(s.set_type) && (s.released_at ?? '') >= SINCE)
  .filter((s) => ONLY.length === 0 || ONLY.includes(s.code))
  .sort((a, b) => a.released_at.localeCompare(b.released_at));
console.log(`${sets.length} sets since ${SINCE}; writing ${OUT}`);

const file = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { updated: '', sets: {} };
let changed = 0;
for (const s of sets) {
  const slug = slugOf(s.name);
  const entry = { en: s.name };
  for (const lang of Object.keys(SITE_LANGS)) {
    let name = null;
    try {
      name = await pageName(lang, slug);
    } catch (e) {
      console.log(`  ${s.code} ${lang}: ${e.message}`);
    }
    await sleep(250);
    if (name && name.toLowerCase() !== s.name.toLowerCase() && name !== '404') entry[lang] = name;
  }
  const before = JSON.stringify(file.sets[s.code] ?? null);
  if (Object.keys(entry).length > 1) {
    file.sets[s.code] = entry;
    if (JSON.stringify(entry) !== before) {
      changed++;
      console.log(`${s.code} ${s.name}: ${Object.entries(entry).filter(([k]) => k !== 'en').map(([k, v]) => `${k}=${v}`).join(' | ')}`);
    }
  } else if (file.sets[s.code]) {
    // Every page kept the English name (or none exists): nothing to show.
    delete file.sets[s.code];
    changed++;
    console.log(`${s.code} ${s.name}: no localized name any more, dropped`);
  } else {
    console.log(`${s.code} ${s.name}: English everywhere`);
  }
}
if (changed > 0 || !file.updated) file.updated = new Date().toISOString().slice(0, 10);
file.sets = Object.fromEntries(Object.entries(file.sets).sort(([a], [b]) => a.localeCompare(b)));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(file, null, 2) + '\n');
console.log(`${changed} set(s) changed; ${Object.keys(file.sets).length} in the file`);
