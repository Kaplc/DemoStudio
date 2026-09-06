#!/usr/bin/env node
/**
 * hoi4-map-gen.mjs — HOI4-like 真实世界地图生成器 v2（一次性工具，产物提交进资产）
 *
 * 数据源：Natural Earth v5.1.2（公有领域，首次运行自动下载到 .cache/ne-vector/）
 *   ne_50m_admin_0_countries.geojson        国界（242 国，含中文名/人口）
 *   ne_50m_populated_places_simple.geojson  首都坐标（Admin-0 capital）
 *
 * 产物（projects/hoi4/asset/map/）：
 *   map.json      省/州元数据 + 邻接表 + 世界换算参数（结构与运行时契约不变）
 *   provinces.png 省份 ID 图：RGB = (id & 0xFF, id >> 8, 0)（无抗锯齿）
 *   terrain.png   地形底图（气候带真实着色 + 地形噪点 + 海洋深浅）
 * 另更新 projects/hoi4/asset/config/countries.table.json：
 *   10 个 playtag 手工块原样保留，其余真实国家自动追加。
 *
 * 流程：
 *   1. GeoJSON 扫描线栅格化 → 每像素国家 id（equirectangular，跨日界线 unwrap）
 *   2. 微型国家（像素过少）剔除 → 多源 BFS 就近归并
 *   3. 多密度抖动网格种子（欧洲/东亚/南亚 12px 细网格，全球陆 24px，海洋 60px）
 *   4. Jump Flooding 约束洪泛（省不跨海、不跨国界，国界像素级精确）
 *   5. 省连通修复 + 无种子像素（小岛/湖泊）BFS 归并邻省
 *   6. 邻接统计 → 国内 k-means 聚州 + 连通修复
 *   7. 首都 = 真实首都坐标最近的国内省（playtag 按合并成员序列匹配）
 *   8. 地形 = 气候带 + 区域框（山脉/沙漠/雨林）+ 噪声
 *
 * 用法：node scripts/hoi4-map-gen.mjs
 * 确定性：数据源固定 tag + 固定种子，重复运行产物逐字节一致。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'projects', 'hoi4', 'asset', 'map')
const CACHE_DIR = path.join(ROOT, '.cache', 'ne-vector')

const NE_TAG = 'v5.1.2'
const NE_BASE = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NE_TAG}/geojson`
const SOURCES = [
  { file: 'countries_50.geojson', remote: 'ne_50m_admin_0_countries.geojson' },
  { file: 'places_50.geojson', remote: 'ne_50m_populated_places_simple.geojson' },
]

// ───────────────────────── 参数 ─────────────────────────
const W = 2048
const H = 1024
const SEED = 20260906
/** 像素少于此的国家剔除（50m 数据下 <8px 的微国成不了省） */
const MIN_COUNTRY_PX = 8
/** 省→世界单位换算（地图平面 256×128 世界单位） */
const PX_PER_UNIT = 8
/** 陆省种子基础网格（8px 候选，按区域概率保留 → 主战场 8px / 腹地 ~26px 等效密度） */
const CELL = 8
/** 每州目标省数 / 州数上限 */
const PROV_PER_STATE = 5
const STATE_MAX = 12

// ───────────────────────── 随机 ─────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(SEED)

// value noise（地形纹理/海洋深浅用）
function makeValueNoise(seed) {
  const r = mulberry32(seed)
  const size = 256
  const perm = new Uint8Array(size * 2)
  const vals = new Float32Array(size)
  for (let i = 0; i < size; i++) { perm[i] = i; vals[i] = r() }
  for (let i = size - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = perm[i]; perm[i] = perm[j]; perm[j] = t }
  for (let i = 0; i < size; i++) perm[i + size] = perm[i]
  const fade = (t) => t * t * (3 - 2 * t)
  function noise2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y)
    const xf = x - xi, yf = y - yi
    const h = (a, b) => vals[perm[(perm[a & 255] + (b & 255)) & 255]]
    const u = fade(xf), v = fade(yf)
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  }
  function fbm(x, y, octaves = 4) {
    let amp = 1, freq = 1, sum = 0, norm = 0
    for (let o = 0; o < octaves; o++) {
      sum += noise2(x * freq, y * freq) * amp
      norm += amp
      amp *= 0.5; freq *= 2
    }
    return sum / norm
  }
  return { noise2, fbm }
}
const noiseA = makeValueNoise(SEED + 1)
const noiseB = makeValueNoise(SEED + 2)

// ───────────────────────── 数据下载/加载 ─────────────────────────
function ensureData() {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  for (const s of SOURCES) {
    const p = path.join(CACHE_DIR, s.file)
    if (!fs.existsSync(p)) {
      console.log(`下载 ${s.remote} …`)
      execFileSync('curl', ['-sL', '--max-time', '180', '-o', p, `${NE_BASE}/${s.remote}`], { stdio: 'inherit' })
    }
  }
}
ensureData()
const countriesGj = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'countries_50.geojson'), 'utf8'))
const placesGj = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'places_50.geojson'), 'utf8'))

// ───────────────────────── 国家清单：playtag 映射 / 历史合并 / 剔除 ─────────────────────────
/** 真实国家 → 运行时 tag 覆盖（playtag 语义锚定；未列出的国家 tag = ADM0_A3） */
const TAG_OVERRIDE = {
  Germany: 'GER', France: 'FRA', 'United Kingdom': 'ENG', Italy: 'ITA', Poland: 'POL',
  Russia: 'SOV', Hungary: 'HUN', Romania: 'ROM', Switzerland: 'SWI',
}
/** 1936 历史合并：多个现代国家 → 一个运行时国家（成员序列同时决定首都优先级） */
const HISTORY_MERGES = [
  { tag: 'YUG', name: '南斯拉夫', color: '#8a6fae', members: ['SRB', 'HRV', 'BIH', 'SVN', 'MNE', 'MKD', 'KOS'] },
  { tag: 'CZE', name: '捷克斯洛伐克', color: '#b8b24d', members: ['CZE', 'SVK'] },
  { tag: 'CHI', name: '中华民国', color: '#c8a05a', members: ['CHN', 'TWN', 'HKG', 'MAC'] },
  { tag: 'DNK', name: '丹麦', color: '#c46a6a', members: ['DNK', 'GRL'] },
]
/** 意识形态微调（未列出的自动国 = neutral） */
const IDEOLOGY_OVERRIDE = { USA: 'democratic', JPN: 'fascist', 'United States of America': 'democratic' }

// 收集 feature：key = 合并后 tag；合并块成员共享 tag
const feats = new Map() // a3 → feature
for (const f of countriesGj.features) {
  const a3 = f.properties.ADM0_A3 || f.properties.ISO_A3_EH || f.properties.ISO_A3
  if (a3 && a3 !== 'ATA' && a3 !== '-99') feats.set(a3, f) // 剔除南极
}
const a3ToTag = new Map()
const meta = new Map() // tag → { name, nameZh, color?, popEst, continent, memberA3s[] }
for (const m of HISTORY_MERGES) {
  const ms = m.members.filter((a) => feats.has(a))
  if (ms.length === 0) continue
  for (const a of ms) a3ToTag.set(a, m.tag)
  const pops = ms.map((a) => feats.get(a).properties.POP_EST ?? 0)
  meta.set(m.tag, {
    name: m.name, nameZh: m.name, color: m.color,
    popEst: pops.reduce((s, v) => s + v, 0), continent: 'Europe',
    memberA3s: ms, playtag: null,
  })
}
for (const [a3, f] of feats) {
  if (a3ToTag.has(a3)) continue
  const p = f.properties
  const tag = TAG_OVERRIDE[p.NAME] ?? a3
  a3ToTag.set(a3, tag)
  const existing = meta.get(tag)
  if (existing && existing.memberA3s) { existing.memberA3s.push(a3); existing.popEst += p.POP_EST ?? 0; continue }
  meta.set(tag, {
    name: p.NAME_ZH || p.NAME || tag, nameZh: p.NAME_ZH || p.NAME || tag,
    color: null, popEst: p.POP_EST ?? 0, continent: p.CONTINENT ?? '', memberA3s: [a3], playtag: null,
  })
}
// playtag 手工块：国家表唯一事实来源（数值沿用旧表，语义=真实国家）
const PLAYTAGS = ['GER', 'FRA', 'ENG', 'ITA', 'POL', 'SOV', 'HUN', 'ROM', 'YUG', 'SWI']
const PLAYTAG_DATA = {
  GER: { name: '德意志', color: '#7a7a6f', ideology: 'fascist', pp: 65, stability: 60, warSupport: 55, manpower: 1200, ai: { aggressive: 0.9, industrial: 0.9 } },
  FRA: { name: '法兰西', color: '#5b8fbf', ideology: 'democratic', pp: 55, stability: 65, warSupport: 40, manpower: 900, ai: { aggressive: 0.3, industrial: 0.7 } },
  ENG: { name: '不列颠', color: '#c96f6f', ideology: 'democratic', pp: 60, stability: 70, warSupport: 35, manpower: 850, ai: { aggressive: 0.25, industrial: 0.8 } },
  ITA: { name: '意大利', color: '#6faa72', ideology: 'fascist', pp: 58, stability: 55, warSupport: 50, manpower: 800, ai: { aggressive: 0.7, industrial: 0.55 } },
  POL: { name: '波兰', color: '#c9c9d6', ideology: 'neutral', pp: 45, stability: 55, warSupport: 45, manpower: 600, ai: { aggressive: 0.35, industrial: 0.45 } },
  SOV: { name: '苏维埃', color: '#b04a4a', ideology: 'communist', pp: 70, stability: 60, warSupport: 60, manpower: 2200, ai: { aggressive: 0.75, industrial: 0.95 } },
  HUN: { name: '匈牙利', color: '#7f9563', ideology: 'fascist', pp: 40, stability: 55, warSupport: 40, manpower: 300, ai: { aggressive: 0.5, industrial: 0.35 } },
  ROM: { name: '罗马尼亚', color: '#a98751', ideology: 'neutral', pp: 40, stability: 50, warSupport: 40, manpower: 350, ai: { aggressive: 0.4, industrial: 0.4 } },
  YUG: { name: '南斯拉夫', color: '#8a6fae', ideology: 'neutral', pp: 38, stability: 50, warSupport: 45, manpower: 380, ai: { aggressive: 0.35, industrial: 0.35 } },
  SWI: { name: '瑞士', color: '#d0695f', ideology: 'democratic', pp: 35, stability: 80, warSupport: 20, manpower: 200, ai: { aggressive: 0.05, industrial: 0.4 } },
}
for (const tag of PLAYTAGS) {
  const m = meta.get(tag)
  if (!m) throw new Error(`playtag ${tag} 在 NE 数据中找不到对应国家`)
  m.playtag = tag
  m.color = PLAYTAG_DATA[tag].color
}

// ───────────────────────── 栅格化：每像素国家 id ─────────────────────────
const lon2x = (lon) => ((lon + 180) / 360) * W
const lat2y = (lat) => ((90 - lat) / 180) * H

/** ring 经度 unwrap（跨日界线相邻点差 >180° 时 ±360 拉回连续域） */
function unwrapRing(ring) {
  const out = ring.map((c) => [c[0], c[1]])
  for (let i = 1; i < out.length; i++) {
    let d = out[i][0] - out[i - 1][0]
    while (d > 180) { out[i][0] -= 360; d = out[i][0] - out[i - 1][0] }
    while (d < -180) { out[i][0] += 360; d = out[i][0] - out[i - 1][0] }
  }
  return out
}

/** 扫描线填充一个 polygon（外环 + 洞）到 pxbuf（W 宽，unwrap 域坐标 mod W 落位） */
function fillPolygonRows(polygon, countryIdx) {
  const rowHits = Array.from({ length: H }, () => [])
  const rings = polygon.map(unwrapRing)
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const x1 = ring[i][0], y1 = ring[i][1]
      const x2 = ring[i + 1][0], y2 = ring[i + 1][1]
      if (y1 === y2) continue
      const latTop = Math.min(y1, y2), latBot = Math.max(y1, y2)
      // 行区间：latBot（纬度大）→ 行号小取 floor；latTop（纬度小）→ 行号大取 ceil
      const pyA = Math.max(0, Math.floor(lat2y(latBot)))
      const pyB = Math.min(H - 1, Math.ceil(lat2y(latTop)))
      for (let py = pyA; py <= pyB; py++) {
        const latAt = 90 - ((py + 0.5) / H) * 180
        if (latAt <= latTop || latAt > latBot) continue
        const t = (latAt - y1) / (y2 - y1)
        rowHits[py].push(lon2x(x1 + (x2 - x1) * t))
      }
    }
  }
  for (let py = 0; py < H; py++) {
    const xs = rowHits[py]
    if (xs.length < 2) continue
    xs.sort((a, b) => a - b)
    // 奇偶配对（洞=偶数次相交自然跳过）；unwrap 域坐标 mod W 落回主画布（跨日界线两侧像素都正确落位）
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5))
      const xb = Math.min(W * 2 - 1, Math.floor(xs[k + 1] - 0.5))
      for (let px = xa; px <= xb; px++) pxbuf[py * W + ((px % W) + W) % W] = countryIdx
    }
    xs.length = 0
  }
}

const pxbuf = new Int16Array(W * H).fill(-1)
/** 直接剔除的 feature（转海）：格陵兰冰盖等不可通行荒地 */
const DROP_A3 = new Set(['GRL'])
const tagList = [...meta.keys()] // countryIdx → tag
const countryOf = new Int16Array(W * H) // -1=海，else tagList 下标
for (const f of countriesGj.features) {
  const a3 = f.properties.ADM0_A3 || f.properties.ISO_A3_EH
  const tag = a3ToTag.get(a3)
  if (tag === undefined || DROP_A3.has(a3)) continue // 南极/格陵兰等
  const idx = tagList.indexOf(tag)
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
  for (const poly of polys) fillPolygonRows(poly, idx)
}
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) countryOf[y * W + x] = pxbuf[y * W + x]
}
console.log(`国家 feature 落图: ${tagList.length} 个 tag`)

// 国家像素计数 + 微国剔除 → 就近归并
const pxOfTag = new Map(tagList.map((t) => [t, 0]))
for (let i = 0; i < W * H; i++) {
  const c = countryOf[i]
  if (c >= 0) pxOfTag.set(tagList[c], pxOfTag.get(tagList[c]) + 1)
}
const dropTags = new Set(tagList.filter((t) => pxOfTag.get(t) < MIN_COUNTRY_PX))
const keptIdx = new Int16Array(tagList.length).fill(-1)
const keptTags = []
for (let i = 0; i < tagList.length; i++) {
  if (!dropTags.has(tagList[i])) { keptIdx[i] = keptTags.length; keptTags.push(tagList[i]) }
}
if (dropTags.size > 0) {
  // 多源 BFS：从所有存活国家像素扩散，微国像素继承最近的存活国
  const queue = new Int32Array(W * H)
  let qh = 0, qt = 0
  const owner = new Int16Array(W * H) // 扩散过程中的存活国归属
  for (let i = 0; i < W * H; i++) { owner[i] = countryOf[i]; if (countryOf[i] >= 0 && keptIdx[countryOf[i]] >= 0) queue[qt++] = i }
  while (qh < qt) {
    const i = queue[qh++]
    const x = i % W, y = (i / W) | 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const j = ny * W + nx
      if (owner[j] >= 0 && keptIdx[owner[j]] >= 0) continue
      if (owner[j] === -2) continue // 海洋不参与陆地归并
      owner[j] = owner[i]
      queue[qt++] = j
    }
  }
  for (let i = 0; i < W * H; i++) {
    if (countryOf[i] < 0) continue
    const k = owner[i]
    countryOf[i] = k >= 0 && keptIdx[k] >= 0 ? keptIdx[k] : -1
  }
  console.log(`剔除微国 ${dropTags.size} 个: ${[...dropTags].join(',')}`)
}
const NTAG = keptTags.length
console.log(`落图国家: ${NTAG}`)

// ───────────────────────── 省/海种子（多密度抖动网格） ─────────────────────────
/** 细密度区（经度1,纬度1,经度2,纬度2）——欧洲/东亚/南亚/北美东部历史主战场 */
const DENSE_BOXES = [
  [-12, 34, 45, 72], // 欧洲
  [98, 16, 148, 48], // 东亚
  [64, 5, 92, 36], // 南亚
  [-130, 24, -64, 52], // 北美东部
]
function inDense(lon, lat) {
  for (const [a, b, c, d] of DENSE_BOXES) if (lon >= a && lon <= c && lat >= b && lat <= d) return true
  return false
}
const seeds = [] // { x, y, sea, country }
{
  const cols = Math.floor(W / CELL), rows = Math.floor(H / CELL)
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const x = Math.min(W - 1, Math.max(0, Math.round((gx + 0.5 + (rand() - 0.5) * 0.9) * CELL)))
      const y = Math.min(H - 1, Math.max(0, Math.round((gy + 0.5 + (rand() - 0.5) * 0.9) * CELL)))
      const c = countryOf[y * W + x]
      const lon = ((x + 0.5) / W) * 360 - 180
      const lat = 90 - ((y + 0.5) / H) * 180
      if (c >= 0) {
        const keep = inDense(lon, lat) ? 1.0 : 0.095
        if (rand() < keep) seeds.push({ x, y, sea: false, country: c })
      } else if (rand() < 0.008) {
        seeds.push({ x, y, sea: true, country: -1 })
      }
    }
  }
  // 每个落图国家强制 ≥1 种子（像素质心；狭长国质心可能落在他国像素上，退回首个像素）——保底每国有省
  const hasSeed = new Set(seeds.filter((s) => !s.sea).map((s) => s.country))
  const acc = new Map() // country → {sx, sy, n, first}
  for (let i = 0; i < W * H; i++) {
    const c = countryOf[i]
    if (c < 0 || hasSeed.has(c)) continue
    const a = acc.get(c) ?? { sx: 0, sy: 0, n: 0, first: i }
    a.sx += i % W; a.sy += (i / W) | 0; a.n++
    acc.set(c, a)
  }
  for (const [c, a] of acc) {
    let x = Math.round(a.sx / a.n), y = Math.round(a.sy / a.n)
    if (countryOf[y * W + x] !== c) { x = a.first % W; y = (a.first / W) | 0 }
    seeds.push({ x, y, sea: false, country: c })
  }
  if (acc.size > 0) console.log(`[诊断] 强制补种子国家: ${[...acc.keys()].map((c) => keptTags[c]).join(',')}`)
}
console.log(`种子: ${seeds.length}（陆 ${seeds.filter((s) => !s.sea).length} / 海 ${seeds.filter((s) => s.sea).length}）`)

// ───────────────────────── JFA 约束洪泛 ─────────────────────────
const seedId = new Int32Array(W * H).fill(-1) // 每像素最近种子下标
{
  const sx = new Int16Array(seeds.length), sy = new Int16Array(seeds.length)
  const ssea = new Uint8Array(seeds.length)
  seeds.forEach((s, i) => { sx[i] = s.x; sy[i] = s.y; ssea[i] = s.sea ? 1 : 0 })
  const bestD = new Int32Array(W * H).fill(0x7fffffff)
  const trySeed = (px, py, si, i) => {
    if (si < 0) return
    if (ssea[si] !== (countryOf[i] < 0 ? 1 : 0)) return // 约束：海陆/国别不同不认领
    if (countryOf[i] >= 0 && countryOf[i] !== countryOf[sy[si] * W + sx[si]]) return
    const dx = sx[si] - px, dy = sy[si] - py
    const d = dx * dx + dy * dy
    if (d < bestD[i]) { bestD[i] = d; seedId[i] = si }
  }
  seeds.forEach((s, i) => trySeed(s.x, s.y, i, s.y * W + s.x))
  for (let k = Math.max(W, H) / 2; k >= 1; k = (k / 2) | 0) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        for (const [dx, dy] of [[-k, 0], [k, 0], [0, -k], [0, k], [-k, -k], [-k, k], [k, -k], [k, k]]) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          trySeed(x, y, seedId[ny * W + nx], i)
        }
      }
    }
  }
}

// ───────────────────────── 省 id 分配 + 连通修复 + 未分配归并 ─────────────────────────
const landSeeds = [], seaSeeds = []
for (let i = 0; i < seeds.length; i++) (seeds[i].sea ? seaSeeds : landSeeds).push(i)
const seedToProv = new Int32Array(seeds.length)
landSeeds.forEach((si, k) => { seedToProv[si] = k + 1 })
seaSeeds.forEach((si, k) => { seedToProv[si] = landSeeds.length + k + 1 })
const PROV_COUNT = landSeeds.length + seaSeeds.length
const SEA_START = landSeeds.length + 1
const isSeaProv = new Uint8Array(PROV_COUNT + 1)
for (let k = 0; k < seaSeeds.length; k++) isSeaProv[SEA_START + k] = 1
console.log(`省: 陆 ${landSeeds.length} + 海 ${seaSeeds.length} = ${PROV_COUNT}`)
if (PROV_COUNT > 65000) throw new Error('省数超 16bit 编码')

const provOf = new Int32Array(W * H)
for (let i = 0; i < W * H; i++) provOf[i] = seedId[i] >= 0 ? seedToProv[seedId[i]] : 0 // 0=未分配

// 未分配像素（无种子小岛/湖）：多源 BFS 从已分配像素扩散继承省 id（海陆分别扩散）
{
  const queue = new Int32Array(W * H)
  let qh = 0, qt = 0
  for (let i = 0; i < W * H; i++) if (provOf[i] !== 0) queue[qt++] = i
  while (qh < qt) {
    const i = queue[qh++]
    const x = i % W, y = (i / W) | 0
    const sea = countryOf[i] < 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const j = ny * W + nx
      if (provOf[j] !== 0) continue
      if ((countryOf[j] < 0) !== sea) continue // 只在同型像素间扩散
      provOf[j] = provOf[i]
      queue[qt++] = j
    }
  }
}

// 省连通修复：非最大连通分量的碎块并入相邻省（保证每省像素连通 → 州/寻路无飞地）
{
  const comp = new Int32Array(W * H).fill(-1)
  const compSize = []
  for (let i = 0; i < W * H; i++) {
    if (comp[i] >= 0 || provOf[i] === 0) continue
    const cid = compSize.length
    const stack = [i]
    comp[i] = cid
    let n = 0
    while (stack.length) {
      const cur = stack.pop()
      n++
      const x = cur % W, y = (cur / W) | 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const j = ny * W + nx
        if (comp[j] >= 0 || provOf[j] !== provOf[i]) continue
        comp[j] = cid
        stack.push(j)
      }
    }
    compSize.push(n)
  }
  // 每省保留最大分量，其余像素改挂邻接省（BFS 找最近的不同省像素）
  const provComp = new Map() // prov → Map(cid→size)
  for (let i = 0; i < W * H; i++) {
    if (provOf[i] === 0) continue
    let m = provComp.get(provOf[i])
    if (!m) { m = new Map(); provComp.set(provOf[i], m) }
    m.set(comp[i], (m.get(comp[i]) ?? 0) + 1)
  }
  for (const [, m] of provComp) {
    let bestCid = -1, bestN = -1
    for (const [cid, n] of m) if (n > bestN) { bestN = n; bestCid = cid }
    for (const cid of [...m.keys()]) if (cid !== bestCid) m.set(cid, -1) // 标记弃
  }
  const reassign = new Int32Array(W * H) // 0=不变，else 新省
  const queue = new Int32Array(W * H)
  for (let i = 0; i < W * H; i++) {
    if (provOf[i] === 0) continue
    const m = provComp.get(provOf[i])
    if (m.get(comp[i]) > 0) continue
    queue[0] = i; let qh = 0, qt = 1
    const seen = new Set([i])
    let target = 0
    while (qh < qt && target === 0) {
      const cur = queue[qh++]
      const x = cur % W, y = (cur / W) | 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const j = ny * W + nx
        if (seen.has(j)) continue
        seen.add(j)
        if (provOf[j] !== 0 && provOf[j] !== provOf[i] && m.get(comp[j]) !== -1) { target = provOf[j]; break }
        if (provOf[j] === provOf[i]) { queue[qt++] = j }
      }
    }
    if (target) reassign[i] = target
  }
  for (let i = 0; i < W * H; i++) if (reassign[i]) provOf[i] = reassign[i]
}

// ───────────────────────── 邻接 + 质心 + 像素计数 ─────────────────────────
const adjSet = Array.from({ length: PROV_COUNT + 1 }, () => new Set())
const cx = new Float64Array(PROV_COUNT + 1)
const cy = new Float64Array(PROV_COUNT + 1)
const pxCount = new Float64Array(PROV_COUNT + 1)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const id = provOf[y * W + x]
    if (!id) continue
    cx[id] += x; cy[id] += y; pxCount[id]++
    if (x + 1 < W) {
      const id2 = provOf[y * W + x + 1]
      if (id2 && id2 !== id) { adjSet[id].add(id2); adjSet[id2].add(id) }
    }
    if (y + 1 < H) {
      const id2 = provOf[(y + 1) * W + x]
      if (id2 && id2 !== id) { adjSet[id].add(id2); adjSet[id2].add(id) }
    }
  }
}

// 省 → 国家：用种子像素的国别（JFA 约束保证省内像素同国；质心会落在省外不可靠）
const provCountry = new Int16Array(PROV_COUNT + 1).fill(-1)
for (let si = 0; si < seeds.length; si++) {
  const id = seedToProv[si]
  if (id && provCountry[id] === -1) provCountry[id] = countryOf[seeds[si].y * W + seeds[si].x]
}

// ───────────────────────── 地形：气候带 + 区域框 ─────────────────────────
const REGION_BOXES = {
  mountain: [
    [72, 26, 103, 38], [66, 38, 90, 46], [38, 39, 50, 45], [5, 43, 17, 48], [20, 44, 27, 49],
    [-75, -42, -62, 6], [-126, 34, -105, 60], [56, 52, 63, 68], [4, 57, 16, 66], [-9, 29, 2, 36],
    [-152, 58, -138, 68], [63, 34, 73, 38], [78, 34, 96, 42], [97, 26, 110, 34], [130, 32, 140, 40],
    [-72, -34, -68, -16], [28, -3, 36, 1], [146, -38, 149, -27],
  ],
  desert: [
    [-17, 15, 34, 30], [34, 12, 59, 31], [86, 38, 112, 48], [74, 36, 92, 42], [50, 36, 68, 48],
    [116, -31, 142, -18], [-118, 28, -101, 40], [12, -30, 24, -18], [-71, -27, -66, -17],
    [42, 2, 52, 11], [54, 26, 62, 36], [58, 44, 76, 52],
  ],
  rainforest: [
    [-75, -12, -48, 6], [9, -7, 32, 5], [94, -10, 141, 7], [-92, 8, -76, 18], [108, 4, 118, 12],
  ],
}
function inBoxes(boxes, lon, lat) {
  for (const [a, b, c, d] of boxes) if (lon >= a && lon <= c && lat >= b && lat <= d) return true
  return false
}
const provClimate = [] // 省 → 气候型（视觉着色用）
const provTerrain = new Array(PROV_COUNT + 1).fill('ocean')
for (let id = 1; id <= PROV_COUNT; id++) {
  if (pxCount[id] === 0 || isSeaProv[id]) { provClimate[id] = 'ocean'; continue }
  const px = cx[id] / pxCount[id], py = cy[id] / pxCount[id]
  const lon = ((px + 0.5) / W) * 360 - 180
  const lat = 90 - ((py + 0.5) / H) * 180
  const alat = Math.abs(lat)
  let climate = 'temperate'
  if (inBoxes(REGION_BOXES.desert, lon, lat)) climate = 'desert'
  else if (inBoxes(REGION_BOXES.rainforest, lon, lat)) climate = 'rainforest'
  else if (alat > 66) climate = 'snow'
  else if (alat > 55) climate = 'tundra'
  else if (alat > 42) climate = 'taiga'
  else if (alat > 23) climate = 'temperate'
  else climate = 'savanna'
  provClimate[id] = climate
  // 逻辑地形（5 种）：山框→mountain/hills，雨林/寒带林→forest，其余 plains 少量 marsh
  if (inBoxes(REGION_BOXES.mountain, lon, lat)) provTerrain[id] = rand() < 0.7 ? 'mountain' : 'hills'
  else if (climate === 'rainforest' || climate === 'taiga') provTerrain[id] = rand() < 0.75 ? 'forest' : 'plains'
  else {
    const n = noiseB.fbm((px / W) * 9 + 3, (py / H) * 9 + 5, 3)
    if (n > 0.74) provTerrain[id] = 'marsh'
    else if (n > 0.62) provTerrain[id] = 'hills'
    else provTerrain[id] = 'plains'
  }
}

// ───────────────────────── 州：国内 k-means 聚类 + 连通修复 ─────────────────────────
const stateOf = new Int32Array(PROV_COUNT + 1).fill(-1)
{
  const byCountry = new Map()
  for (let id = 1; id <= PROV_COUNT; id++) {
    if (isSeaProv[id] || pxCount[id] === 0) continue
    const c = provCountry[id]
    if (c < 0) continue
    let arr = byCountry.get(c)
    if (!arr) { arr = []; byCountry.set(c, arr) }
    arr.push(id)
  }
  let sid = 0
  const stateMeta = [] // { country, provinces: [] }
  for (const [c, provs] of [...byCountry.entries()].sort((a, b) => a[0] - b[0])) {
    const k = Math.max(1, Math.min(STATE_MAX, Math.round(provs.length / PROV_PER_STATE)))
    // k-means（省质心 + 像素权重）
    const pts = provs.map((id) => ({ id, x: cx[id], y: cy[id], w: pxCount[id] }))
    const centers = [pts.slice().sort((a, b) => b.w - a.w)[0]]
    while (centers.length < k) {
      let best = null, bd = -1
      for (const p of pts) {
        let d = Infinity
        for (const cc of centers) { const dx = p.x - cc.x, dy = p.y - cc.y; d = Math.min(d, dx * dx + dy * dy) }
        if (d > bd) { bd = d; best = p }
      }
      centers.push(best)
    }
    const assign = new Int32Array(pts.length)
    for (let iter = 0; iter < 16; iter++) {
      for (let i = 0; i < pts.length; i++) {
        let bi = 0, bd = Infinity
        for (let s = 0; s < centers.length; s++) {
          const dx = pts[i].x - centers[s].x, dy = pts[i].y - centers[s].y
          const d = dx * dx + dy * dy
          if (d < bd) { bd = d; bi = s }
        }
        assign[i] = bi
      }
      const sx = new Float64Array(centers.length), sy = new Float64Array(centers.length), sw = new Float64Array(centers.length)
      for (let i = 0; i < pts.length; i++) { const a = assign[i]; sx[a] += pts[i].x * pts[i].w; sy[a] += pts[i].y * pts[i].w; sw[a] += pts[i].w }
      for (let s = 0; s < centers.length; s++) if (sw[s] > 0) centers[s] = { x: sx[s] / sw[s], y: sy[s] / sw[s] }
    }
    const groups = Array.from({ length: k }, () => [])
    for (let i = 0; i < pts.length; i++) groups[assign[i]].push(pts[i].id)
    for (const g of groups) {
      if (g.length === 0) continue
      const mySid = sid++
      stateMeta.push({ country: c, provinces: g })
      for (const id of g) stateOf[id] = mySid
    }
  }
  // 连通修复：每州取最大分量，碎块向邻省借州
  const comp = new Map()
  const landIds = stateMeta.flatMap((s) => s.provinces)
  for (const id of landIds) {
    if (comp.has(id)) continue
    const root = id
    const queue = [id]; comp.set(id, root)
    while (queue.length) {
      const cur = queue.pop()
      for (const nb of adjSet[cur]) {
        if (stateOf[nb] === stateOf[id] && !comp.has(nb)) { comp.set(nb, root); queue.push(nb) }
      }
    }
  }
  for (const s of stateMeta) {
    const byComp = new Map()
    for (const id of s.provinces) byComp.set(comp.get(id), (byComp.get(comp.get(id)) ?? 0) + 1)
    let keep = -1, keepN = -1
    for (const [c, n] of byComp) if (n > keepN) { keepN = n; keep = c }
    for (const id of s.provinces) {
      if (comp.get(id) === keep) continue
      const queue = [id]
      const seen = new Set([id])
      let target = -1
      while (queue.length && target < 0) {
        const cur = queue.shift()
        for (const nb of adjSet[cur]) {
          if (seen.has(nb) || stateOf[nb] < 0) continue
          if (stateOf[nb] !== stateOf[id]) {
            // 只能借给同国的州，否则小国会整体并进邻国
            if (provCountry[nb] === provCountry[id]) { target = stateOf[nb]; break }
            continue
          }
          seen.add(nb)
          queue.push(nb)
        }
      }
      if (target >= 0) stateOf[id] = target
    }
  }
  globalThis.__stateMeta = stateMeta
}
const stateMeta = globalThis.__stateMeta
const STATE_COUNT = stateMeta.length
// 州下标压缩（有省的州才进 map.json）
const stateIdx = new Map() // stateOf 值 → state id
stateMeta.forEach((s, i) => stateIdx.set(i, i))
console.log(`州: ${STATE_COUNT}`)

// ───────────────────────── 首都：真实坐标 → 国内最近省 ─────────────────────────
const capitals = {} // tag → 省 id
{
  // Admin-0 capital 坐标表（a3 → lon/lat）
  const capOfA3 = new Map()
  for (const f of placesGj.features) {
    const p = f.properties
    const cla = String(p.featurecla ?? '')
    if (!cla.startsWith('Admin-0 capital') || cla.includes('alt') || cla.includes('Approximate')) continue
    if (!capOfA3.has(p.adm0_a3)) capOfA3.set(p.adm0_a3, [p.longitude, p.latitude])
  }
  for (const tag of keptTags) {
    const m = meta.get(tag)
    const provs = []
    for (let id = 1; id <= PROV_COUNT; id++) if (!isSeaProv[id] && provCountry[id] >= 0 && keptTags[provCountry[id]] === tag) provs.push(id)
    if (provs.length === 0) continue
    let capXY = null
    for (const a3 of m.memberA3s) {
      if (capOfA3.has(a3)) { capXY = capOfA3.get(a3); break }
    }
    let capId = 0
    if (capXY) {
      const px = lon2x(capXY[0]), py = lat2y(capXY[1])
      let bd = Infinity
      for (const id of provs) {
        const dx = cx[id] / pxCount[id] - px, dy = cy[id] / pxCount[id] - py
        const d = dx * dx + dy * dy
        if (d < bd) { bd = d; capId = id }
      }
  } else {
    capId = provs.reduce((a, b) => (pxCount[a] >= pxCount[b] ? a : b))
  }
  if (tag === 'SOV' || tag === 'EGY') {
    const pxc = lon2x(capXY ? capXY[0] : 0), pyc = lat2y(capXY ? capXY[1] : 0)
    console.log(`[诊断] ${tag} capXY=${capXY} provs=${provs.length} chosen=${capId}`
      + ` | 265在provs:${provs.includes(265)} cx265=${cx[265]?.toFixed(1)} cy265=${cy[265]?.toFixed(1)}`
      + ` d265=${((cx[265] - pxc) ** 2 + (cy[265] - pyc) ** 2).toFixed(1)} d256=${((cx[256] - pxc) ** 2 + (cy[256] - pyc) ** 2).toFixed(1)}`)
  }
  capitals[tag] = capId
  }
}

// ───────────────────────── 州名 / VP / 人口 / 资源 ─────────────────────────
const DIR8 = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']
function stateName(tag, provinces) {
  const m = meta.get(tag)
  const cname = m.playtag ? PLAYTAG_DATA[tag].name : m.nameZh
  if (provinces.length === 1) return cname
  // 质心方位相对国家 bbox
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity
  let sx = 0, sy = 0, sw = 0
  for (const id of provinces) {
    minx = Math.min(minx, cx[id]); maxx = Math.max(maxx, cx[id])
    miny = Math.min(miny, cy[id]); maxy = Math.max(maxy, cy[id])
    sx += cx[id] * pxCount[id]; sy += cy[id] * pxCount[id]; sw += pxCount[id]
  }
  const nx = (sx / sw - minx) / Math.max(1, maxx - minx)
  const ny = (sy / sw - miny) / Math.max(1, maxy - miny)
  const ang = Math.atan2(-(ny - 0.5), nx - 0.5) // 屏幕系 y 向下 → 纬度北为负方向
  const dir = DIR8[Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8]
  return `${cname}·${dir}`
}
const stateVp = new Float64Array(STATE_COUNT)
const statePop = new Float64Array(STATE_COUNT)
const stateSlots = new Int32Array(STATE_COUNT)
const stateSteel = new Int32Array(STATE_COUNT)
const stateOil = new Int32Array(STATE_COUNT)
const STATE_NAMES_OVERRIDE = {
  GER: ['莱茵兰', '巴伐利亚', '普鲁士', '萨克森', '汉诺威', '符腾堡', '黑森', '西里西亚', '威斯特法伦', '图林根', '勃兰登堡', '石勒苏益格'],
  FRA: ['法兰西岛', '普罗旺斯', '勃艮第', '阿基坦', '布列塔尼', '诺曼底', '洛林', '朗格多克', '皮卡第', '奥弗涅', '里昂', '香槟'],
  ENG: ['米德兰兹', '约克郡', '兰开斯特', '诺森伯兰', '康沃尔', '威尔士', '苏格兰低地', '苏格兰高地'],
  ITA: ['伦巴第', '威尼托', '皮埃蒙特', '托斯卡纳', '教皇国', '那不勒斯', '西西里', '撒丁', '热那亚', '艾米利亚'],
  POL: ['大波兰', '小波兰', '马佐维亚', '加利西亚', '波美拉尼亚', '库亚维', '西里西亚'],
  SOV: ['莫斯科', '列宁格勒', '顿河', '伏尔加', '乌拉尔', '西西伯利亚', '东西伯利亚', '雅库特', '远东', '堪察加', '卡累利阿', '北高加索'],
  HUN: ['佩斯', '多瑙河西岸', '蒂萨平原'],
  ROM: ['瓦拉几亚', '摩尔达维亚', '特兰西瓦尼亚', '多布罗加'],
  YUG: ['塞尔维亚', '克罗地亚', '波斯尼亚', '斯洛文尼亚', '黑山', '马其顿'],
  SWI: ['瑞士'],
}
const stateNames = new Array(STATE_COUNT)
{
  const provTotalOfTag = new Map()
  for (const s of stateMeta) {
    const tag = keptTags[s.country]
    provTotalOfTag.set(tag, (provTotalOfTag.get(tag) ?? 0) + s.provinces.length)
  }
  const usedNames = new Map() // tag → 已用真实区名
  const pending = [] // 非（首都/唯一）州，第二遍按面积从大到小分配名字
  const statesPerTag = new Map()
  for (const sm of stateMeta) statesPerTag.set(sm.country, (statesPerTag.get(sm.country) ?? 0) + 1)
  // 第一遍：首都州拿真实核心区名（pool[0]），全国唯一州用国名
  for (let s = 0; s < STATE_COUNT; s++) {
    const sm = stateMeta[s]
    const tag = keptTags[sm.country]
    const pool = STATE_NAMES_OVERRIDE[tag]
    const isCapState = capitals[tag] !== undefined && sm.provinces.includes(capitals[tag])
    if (isCapState && pool) {
      stateNames[s] = pool[0]
      usedNames.set(tag, new Set([pool[0]]))
    } else if (statesPerTag.get(sm.country) === 1) {
      const m = meta.get(tag)
      stateNames[s] = m.playtag ? PLAYTAG_DATA[tag].name : m.nameZh
    } else pending.push(s)
  }
  // 第二遍：多州国按州面积从大到小分配剩余真实区名，用尽后退回方位命名
  pending.sort((a, b) => statePxSum(b) - statePxSum(a))
  function statePxSum(s) {
    return stateMeta[s].provinces.reduce((sum, id) => sum + pxCount[id], 0)
  }
  for (const s of pending) {
    const sm = stateMeta[s]
    const tag = keptTags[sm.country]
    const pool = STATE_NAMES_OVERRIDE[tag]
    let used = usedNames.get(tag)
    if (!used) { used = new Set(); usedNames.set(tag, used) }
    const name = pool?.find((n) => !used.has(n))
    if (name) { stateNames[s] = name; used.add(name) }
    else stateNames[s] = stateName(tag, sm.provinces)
  }
  // 第三遍：数值（人口=国家真实人口按省数份额分摊；首都州 VP 5；资源随机撒）
  for (let s = 0; s < STATE_COUNT; s++) {
    const sm = stateMeta[s]
    const tag = keptTags[sm.country]
    const m = meta.get(tag)
    const popM = (m.popEst ?? 0) / 1e6
    const share = sm.provinces.length / Math.max(1, provTotalOfTag.get(tag))
    statePop[s] = Math.round(Math.min(150, Math.max(3, popM * share * 10)) * 10) / 10
    stateSlots[s] = Math.min(8, 1 + Math.round(sm.provinces.length / 3))
    const r = rand()
    if (r > 0.68) stateSteel[s] = 1 + ((rand() * 3) | 0)
    if (r < 0.1) stateOil[s] = 1 + ((rand() * 3) | 0)
    if (capitals[tag] !== undefined && stateOf[capitals[tag]] === s) stateVp[s] = 5
  }
  // 工业保底：≥2 州的国家至少一州有钢、≥4 州国家再保底油——否则资源归零卡死生产线（如德国）
  {
    const byTag = new Map()
    for (let s = 0; s < STATE_COUNT; s++) {
      const tag = keptTags[stateMeta[s].country]
      let arr = byTag.get(tag)
      if (!arr) { arr = []; byTag.set(tag, arr) }
      arr.push(s)
    }
    for (const [, arr] of byTag) {
      if (arr.length < 2) continue
      if (!arr.some((s) => stateSteel[s] > 0)) stateSteel[arr[(rand() * arr.length) | 0]] = 1 + ((rand() * 3) | 0)
      if (arr.length >= 4 && !arr.some((s) => stateOil[s] > 0)) stateOil[arr[(rand() * arr.length) | 0]] = 1 + ((rand() * 2) | 0)
    }
  }
  let vpLeft = 40
  while (vpLeft > 0) {
    const s = (rand() * STATE_COUNT) | 0
    if (stateVp[s] === 0) { stateVp[s] = 1 + ((rand() * 2) | 0); vpLeft-- }
  }
}

// ───────────────────────── PNG 编码器 ─────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function encodePng(width, height, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const idat = zlib.deflateSync(raw, { level: 6 })
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))])
}

// ───────────────────────── 产物：map.json ─────────────────────────
const provincesJson = {}
for (let id = 1; id <= PROV_COUNT; id++) {
  if (pxCount[id] === 0) continue
  const sea = isSeaProv[id] === 1
  provincesJson[id] = {
    x: Math.round(cx[id] / pxCount[id]),
    y: Math.round(cy[id] / pxCount[id]),
    terrain: provTerrain[id],
    sea,
    coastal: !sea && [...adjSet[id]].some((nb) => isSeaProv[nb] === 1),
    neighbors: [...adjSet[id]].sort((a, b) => a - b),
    state: stateOf[id],
  }
}
const statesJson = []
for (let s = 0; s < STATE_COUNT; s++) {
  const sm = stateMeta[s]
  const tag = keptTags[sm.country]
  const provs = sm.provinces.filter((id) => stateOf[id] === s)
  if (provs.length === 0) continue
  statesJson.push({
    id: s,
    name: stateNames[s],
    provinces: provs,
    owner: tag,
    capital: provs.includes(capitals[tag]) ? capitals[tag] : provs[0],
    vp: stateVp[s],
    pop: statePop[s],
    slots: stateSlots[s],
    steel: stateSteel[s],
    oil: stateOil[s],
  })
}
const mapJson = {
  width: W,
  height: H,
  pxPerUnit: PX_PER_UNIT,
  worldWidth: W / PX_PER_UNIT,
  worldHeight: H / PX_PER_UNIT,
  capitals,
  provinces: provincesJson,
  states: statesJson,
}
fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(path.join(OUT_DIR, 'map.json'), JSON.stringify(mapJson))

// ───────────────────────── 产物：provinces.png ─────────────────────────
{
  const rgb = new Uint8Array(W * H * 3)
  for (let i = 0; i < W * H; i++) {
    const id = provOf[i]
    rgb[i * 3] = id & 255
    rgb[i * 3 + 1] = (id >> 8) & 255
    rgb[i * 3 + 2] = 0
  }
  fs.writeFileSync(path.join(OUT_DIR, 'provinces.png'), encodePng(W, H, rgb))
}

// ───────────────────────── 产物：terrain.png（气候带真实着色） ─────────────────────────
{
  const CLIMATE_COLOR = {
    snow: [225, 230, 235], tundra: [150, 158, 145], taiga: [74, 104, 78], temperate: [124, 158, 92],
    savanna: [168, 168, 96], desert: [214, 190, 138], rainforest: [58, 100, 62], ocean: [44, 74, 108],
  }
  const rgb = new Uint8Array(W * H * 3)
  // 海洋离岸深度（两遍 chamfer 距离变换）
  const seaDist = new Int16Array(W * H)
  {
    const INF = 32767
    for (let i = 0; i < W * H; i++) seaDist[i] = countryOf[i] >= 0 ? 0 : INF
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x
      let d = seaDist[i]
      if (x > 0) d = Math.min(d, seaDist[i - 1] + 3)
      if (y > 0) d = Math.min(d, seaDist[i - W] + 3)
      if (x > 0 && y > 0) d = Math.min(d, seaDist[i - W - 1] + 4)
      if (x < W - 1 && y > 0) d = Math.min(d, seaDist[i - W + 1] + 4)
      seaDist[i] = d
    }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x
      let d = seaDist[i]
      if (x < W - 1) d = Math.min(d, seaDist[i + 1] + 3)
      if (y < H - 1) d = Math.min(d, seaDist[i + W] + 3)
      if (x < W - 1 && y < H - 1) d = Math.min(d, seaDist[i + W + 1] + 4)
      if (x > 0 && y < H - 1) d = Math.min(d, seaDist[i + W - 1] + 4)
      seaDist[i] = d
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const id = provOf[i]
      let r, g, b
      if (countryOf[i] < 0 || id === 0) {
        // 海洋：纬度色温（赤道暖浅 → 极地冷深）+ 离岸深度变深 + 噪纹
        const lat = Math.abs(90 - ((y + 0.5) / H) * 180)
        const warm = 1 - Math.min(1, lat / 80)
        const deep = Math.min(1, seaDist[i] / 90)
        r = 52 + warm * 24 - deep * 22
        g = 88 + warm * 26 - deep * 30
        b = 122 + warm * 30 - deep * 26
        const n = noiseA.noise2(x * 0.08, y * 0.08) * 10
        r += n; g += n; b += n
      } else {
        const cl = provClimate[id] ?? 'temperate'
        const c = CLIMATE_COLOR[cl] ?? CLIMATE_COLOR.temperate
        r = c[0]; g = c[1]; b = c[2]
        // 山地省：海拔噪声提灰，tundra/snow 气候的高山雪线
        if (provTerrain[id] === 'mountain') {
          const e = noiseB.fbm((x / W) * 22, (y / H) * 22, 4)
          const k = 0.72 + e * 0.75
          r = (r * 0.55 + 130) * k; g = (g * 0.55 + 126) * k; b = (b * 0.55 + 120) * k
          if (e > 0.66 && (cl === 'snow' || cl === 'tundra' || e > 0.78)) { r = 235; g = 238; b = 242 }
        } else {
          const k = 0.88 + noiseA.noise2(x * 0.35, y * 0.35) * 0.14 + noiseB.fbm((x / W) * 14, (y / H) * 14, 3) * 0.12
          r *= k; g *= k; b *= k
        }
      }
      rgb[i * 3] = Math.max(0, Math.min(255, r | 0))
      rgb[i * 3 + 1] = Math.max(0, Math.min(255, g | 0))
      rgb[i * 3 + 2] = Math.max(0, Math.min(255, b | 0))
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, 'terrain.png'), encodePng(W, H, rgb))
}

// ───────────────────────── 产物：countries.table.json（playtag 手工块 + 自动国） ─────────────────────────
{
  const CONTINENT_HUE = {
    Europe: [210, 55], Asia: [28, 55], Africa: [95, 45], 'North America': [350, 45],
    'South America': [170, 45], Oceania: [265, 45], 'Seven seas (open ocean)': [200, 40], Antarctica: [200, 30],
  }
  function hashStr(s) {
    let h = 2166136261
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
    return (h >>> 0) / 4294967296
  }
  function autoColor(tag, continent) {
    const [h0, s0] = CONTINENT_HUE[continent] ?? [200, 40]
    const h = (h0 + (hashStr(tag) - 0.5) * 70 + 360) % 360
    const s = s0 + (hashStr(tag + 's') - 0.5) * 16
    const l = 42 + (hashStr(tag + 'l') - 0.5) * 18
    const f = (n) => {
      const k = (n + h / 30) % 12
      const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
      const v = l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
      return Math.round(v * 255).toString(16).padStart(2, '0')
    }
    return `#${f(0)}${f(8)}${f(4)}`
  }
  const table = {
    _comment: 'HOI4-like 国家表（DataTable 行表）。10 个 playtag（GER/FRA/ENG/ITA/POL/SOV/HUN/ROM/YUG/SWI）为手工调校数据，'
      + '其余真实国家由 scripts/hoi4-map-gen.mjs 从 Natural Earth 数据自动生成（tag=ADM0_A3，可手工微调后重跑生成器保留）。\n'
      + '字段：name=显示名（中文）；color=政治地图色 #rrggbb；ideology=democratic/communist/fascist/neutral；'
      + 'pp=初始政治点；stability=初始稳定度(0-100)；warSupport=初始战争支持度(0-100)；manpower=初始人力（k 人）；'
      + 'ai=AI 权重（aggressive 越高越倾向进攻）。',
  }
  const ideologyOf = (tag) => IDEOLOGY_OVERRIDE[tag] ?? 'neutral'
  for (const tag of PLAYTAGS) table[tag] = PLAYTAG_DATA[tag]
  const others = keptTags.filter((t) => !PLAYTAGS.includes(t)).sort((a, b) => {
    const ca = meta.get(a), cb = meta.get(b)
    return (cb.popEst ?? 0) - (ca.popEst ?? 0)
  })
  for (const tag of others) {
    const m = meta.get(tag)
    table[tag] = {
      name: m.nameZh,
      color: m.color ?? autoColor(tag, m.continent),
      ideology: ideologyOf(tag),
      pp: 40, stability: 55, warSupport: 40,
      manpower: Math.max(20, Math.round((m.popEst ?? 0) / 1000 * 0.15)),
      ai: { aggressive: 0.3, industrial: 0.4 },
    }
  }
  fs.writeFileSync(path.join(ROOT, 'projects', 'hoi4', 'asset', 'config', 'countries.table.json'),
    JSON.stringify(table, null, 2) + '\n')
}

// ───────────────────────── 汇总 ─────────────────────────
const dist = {}
for (const s of statesJson) dist[s.owner] = (dist[s.owner] ?? 0) + 1
const top = Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 12)
console.log('州数 Top12:', top.map(([t, n]) => `${t}:${n}`).join(' '))
console.log(`国家: ${keptTags.length}（含 playtag ${PLAYTAGS.length}）`)
console.log(`首都落实: ${Object.keys(capitals).length}`)
console.log(`完成 → ${OUT_DIR}`)
