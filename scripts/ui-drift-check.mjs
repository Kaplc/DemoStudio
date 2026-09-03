import fs from 'node:fs';

const base = JSON.parse(fs.readFileSync('cache/ui-baseline-orig.json', 'utf8'));
const cur = JSON.parse(fs.readFileSync('cache/ui-current.json', 'utf8'));
const only = process.argv.slice(2);
const files = only.length ? only : Object.keys(base);

let issues = 0;
for (const f of files) {
  const B = base[f];
  const C = cur[f];
  if (!B) { console.log(`??? ${f} not in baseline`); continue; }
  if (!C) { console.log(`!!! ${f} MISSING`); issues++; continue; }
  const mb = Object.fromEntries(B.map((n) => [n.path, n]));
  const mc = Object.fromEntries(C.map((n) => [n.path, n]));
  const lost = Object.keys(mb).filter((p) => !mc[p]);
  const added = Object.keys(mc).filter((p) => !mb[p]);
  const drift = [];
  for (const p of Object.keys(mb)) {
    const x = mb[p], y = mc[p];
    if (!y) continue;
    const d = (a, b) => Math.abs((a ?? 0) - (b ?? 0));
    if (d(x.w, y.w) > 0.005 || d(x.h, y.h) > 0.005 || d(x.x, y.x) > 0.02 || d(x.y, y.y) > 0.02) {
      drift.push(`    ${p}: w${x.w}->${y.w} h${x.h}->${y.h} x${x.x}->${y.x} y${x.y}->${y.y}`);
    }
  }
  const restruct = lost.length && added.length;
  const tag = restruct ? 'RESTRUCT' : drift.length ? 'DRIFT' : 'OK';
  if (tag !== 'OK') issues++;
  console.log(`${tag.padEnd(9)} ${f}`);
  for (const l of drift) console.log(l);
  for (const l of lost) console.log(`    - lost: ${l}`);
  for (const a of added) console.log(`    + new:  ${a}`);
}
console.log(`\n${issues ? issues + ' file(s) need attention' : 'all clean'}`);
