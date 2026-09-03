import fs from 'node:fs';
import path from 'node:path';

const dir = 'src/projects/fish/asset/blueprints/ui';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.widget.json')).sort();

const r = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);

function findComp(node, cls) {
  const arr = node.components;
  if (!Array.isArray(arr)) return null;
  return arr.find((c) => c && c.baseClass === cls) || null;
}

function walk(node, out, trail) {
  if (!node || typeof node !== 'object') return;
  const name = node.name || '(root)';
  const p = trail ? trail + '/' + name : name;
  const t = findComp(node, 'UITransformComponent');
  if (t && t.properties) {
    const q = t.properties;
    out.push({
      path: p,
      x: r(q.position?.[0]),
      y: r(q.position?.[1]),
      w: r(q.worldWidth),
      h: r(q.worldHeight),
      anchor: q.anchor || '',
      z: findComp(node, 'CanvasUIComponent')?.properties?.zOrder ?? null,
    });
  }
  const kids = node.children;
  if (Array.isArray(kids)) kids.forEach((k) => walk(k, out, p));
}

const report = {};
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const out = [];
  walk(j, out, '');
  report[f] = out;
}
fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
let n = 0;
for (const f of files) n += report[f].length;
console.log(`captured ${files.length} widgets, ${n} transforms -> ${process.argv[2]}`);
