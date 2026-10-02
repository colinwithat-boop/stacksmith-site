// Checks scripts/price-changes.mjs without the network: the change file
// rebuilds the new full file from the old one, names and ids round-trip,
// the guard against a broken build, and version.json's reader. The
// prices workflow runs it before each build. Usage:
//   node scripts/price-changes-check.mjs
import {
  CHANGES_MIN_SHARE,
  changesBody,
  changesName,
  diffRows,
  fullBody,
  fullName,
  idOf,
  readVersion,
  slugOf,
  versionBody,
} from './price-changes.mjs';

let checks = 0;
let failed = 0;
function expect(what, got, want) {
  checks++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed++;
    console.log(`FAIL ${what}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  }
}

/** What a phone ends up with: `prev` with the change file's rows applied (a lone id takes the row away). */
function apply(prev, changeRows) {
  const m = new Map(prev.map((r) => [r[0], r]));
  for (const r of changeRows) {
    if (r.length === 1) m.delete(r[0]);
    else m.set(r[0], r);
  }
  return [...m.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

const U = '2026-10-02T09:07:54.632+00:00';
const V = '2026-10-03T09:05:11.010+00:00';
const prev = [
  ['a', '1.00', null, null, '0.90', null, 1, null],
  ['b', '2.00', '3.00', null, null, null, 2, null],
  ['c', '5.00', null, null, '4.00', null, 3, null],
  ['d', '0.10', null, null, null, null, null, null],
];
const next = [
  ['a', '1.00', null, null, '0.90', null, 1, null], // unchanged
  ['b', '2.10', '3.00', null, null, null, 2, null], // dollars moved
  ['c', '5.00', null, null, '4.00', null, 3, 33], // only an id changed
  ['e', '9.99', null, null, null, null, 5, null], // new
]; // d: no price any more

const diff = diffRows(prev, next);
expect('changed, new and removed rows, sorted', diff.rows, [
  ['b', '2.10', '3.00', null, null, null, 2, null],
  ['c', '5.00', null, null, '4.00', null, 3, 33],
  ['d'],
  ['e', '9.99', null, null, null, null, 5, null],
]);
expect('one removed', diff.removed, 1);
expect('applied to yesterday it is today', apply(prev, diff.rows), next);
expect('no change, no rows', diffRows(next, next), { rows: [], removed: 0 });

// A larger, shuffled case: the change file always rebuilds the new file.
const rnd = (() => {
  let s = 7;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
})();
const big = (n, drift) =>
  Array.from({ length: n }, (_, i) => [`id${String(i).padStart(5, '0')}`, (i * drift).toFixed(2), null, null, rnd() < 0.5 ? '1.00' : null, null, i, null]).filter(
    () => rnd() > 0.05,
  );
const b1 = big(3000, 0.01);
const b2 = big(3000, 0.011);
expect('large: applied to yesterday it is today', JSON.stringify(apply(b1, diffRows(b1, b2).rows)), JSON.stringify(b2));

// The texts: ids readable from the head, the files parse, names from ids.
const built = '2026-10-03T10:21:00.000Z';
const full = fullBody({ id: V, date: '2026-10-03', built, rows: next });
expect('full file parses', JSON.parse(full).count, 4);
expect("full file's id", idOf(full), V);
const made = changesBody({ from: U, id: V, date: '2026-10-03', built, prevRows: prev, rows: next });
const parsed = JSON.parse(made.body);
expect('change file head', [parsed.from, parsed.id, parsed.total, parsed.count, parsed.removed], [U, V, 4, 4, 1]);
expect("change file's id is the new one", idOf(made.body), V);
expect('an old latest.json (no id) has none', idOf('{"v":1,"date":"2026-10-02","built":"x","count":0,"rows":[\n]}'), null);
expect('another format has none', idOf(`{"v":2,"id":"${V}"}`), null);
expect('slug is the digits', slugOf(V), '20261003090511010' + '0000');
expect('names', [fullName(V), changesName(U, V)], ['full-202610030905110100000.json', 'changes-202610020907546320000-202610030905110100000.json']);

// Too few rows: no change file.
const tiny = next.slice(0, 1);
expect(`under ${CHANGES_MIN_SHARE} of yesterday's rows: no change file`, changesBody({ from: U, id: V, date: '2026-10-03', built, prevRows: prev, rows: tiny }), null);

// version.json: written and read back; a tampered one refused.
const vt = versionBody({ id: V, date: '2026-10-03', built, count: 4, changes: { from: U, count: 4, removed: 1 }, keep: [fullName(U)] });
const v = readVersion(vt);
expect('version.json round-trips', [v.id, v.full, v.changes.file, v.changes.from, v.keep], [V, fullName(V), changesName(U, V), U, [fullName(U)]]);
expect('no change file: changes null', readVersion(versionBody({ id: V, date: '2026-10-03', built, count: 4, changes: null, keep: [] })).changes, null);
expect('a full name that is not the id refused', readVersion(vt.replace(fullName(V), fullName(U))), null);
expect('a path in a name refused', readVersion(vt.replace(changesName(U, V), '../x.json')), null);
expect('not JSON refused', readVersion('<html>'), null);

console.log(`${checks - failed} of ${checks} checks pass`);
process.exit(failed ? 1 : 0);
