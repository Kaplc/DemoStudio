#!/usr/bin/env node
/**
 * hoi4-map-gen.mjs — HOI4-like 自制地图生成器（一次性工具，产物提交进资产）
 *
 * 产物（projects/hoi4/asset/map/）：
 *   map.json      省/州元数据 + 邻接表 + 世界换算参数（省=ID 图颜色，运行时查表）
 *   provinces.png 省份 ID 图：RGB = (id & 0xFF, id >> 8, 0)，像素值=省 id 编码（无抗锯齿）
 *   terrain.png   地形底图（按省填地形色 + 噪点纹理 + 海洋深浅）
 *
 * 流程：value-noise 陆地掩码 → 抖动网格种子 + Lloyd 松弛 Voronoi →
 *       邻接统计 → k-means 聚州（连通性修复）→ 国家区域生长（读 countries.table.json）→
 *       VP/资源/地形赋值 → PNG（手写编码器，zlib deflate）。
 *
 * 用法：node scripts/hoi4-map-gen.mjs
 * 确定性：固定种子，重复运行产物逐字节一致。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'projects', 'hoi4', 'asset', 'map')

// ───────────────────────── 参数 ─────────────────────────
const W = 2048
const H = 1024
const SEED = 20260905
/** 抖动网格：cols×rows 个候选种子（陆地上的才成为省份） */
const GRID_COLS = 34
const GRID_ROWS = 17
/** 海洋省种子网格（更稀疏） */
const SEA_COLS = 20
const SEA_ROWS = 10
/** 州数（陆地省聚类） */
const STATE_COUNT = 48
/** px → 世界单位换算（地图平面 256×128 世界单位） */
const PX_PER_UNIT = 8

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

// ───────────────────────── value noise / fBm ─────────────────────────
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
  function fbm(x, y, octaves = 5) {
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

// ───────────────────────── 陆地掩码 ─────────────────────────
/** 0..1，值越大越靠"内陆" */
const landMask = new Float32Array(W * H)
{
  // 边缘衰减（地图四周留海洋），叠加两层 fBm 成大陆形状
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = x / W, ny = y / H
      const edge = Math.min(nx, 1 - nx, ny, 1 - ny) // 0..0.5
      const fall = Math.min(1, edge / 0.10)          // 10% 边缘带衰减
      const base = noiseA.fbm(nx * 3.2, ny * 3.2, 5)
      const detail = noiseB.fbm(nx * 7, ny * 7, 4)
      const v = (base * 0.72 + detail * 0.28) * fall
      landMask[y * W + x] = v
    }
  }
  // 取分位点做阈值，控制陆地占比 ~52%
  const sample = []
  for (let i = 0; i < W * H; i += 97) sample.push(landMask[i])
  sample.sort((a, b) => a - b)
  const thr = sample[(sample.length * (1 - 0.52)) | 0]
  const isLand = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) isLand[i] = landMask[i] > thr ? 1 : 0
  globalThis.__isLand = isLand
  globalThis.__landThr = thr
}
const isLand = globalThis.__isLand

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
function encodePng(width, height, rgb /* Uint8Array W*H*3 */) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2 /* truecolor */; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter none
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const idat = zlib.deflateSync(raw, { level: 6 })
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))])
}

// ───────────────────────── 种子点 ─────────────────────────
const seeds = [] // { x, y, land }
{
  const cw = W / GRID_COLS, ch = H / GRID_ROWS
  for (let gy = 0; gy < GRID_ROWS; gy++) {
    for (let gx = 0; gx < GRID_COLS; gx++) {
      const x = Math.min(W - 1, Math.max(0, Math.round((gx + 0.5 + (rand() - 0.5) * 0.9) * cw)))
      const y = Math.min(H - 1, Math.max(0, Math.round((gy + 0.5 + (rand() - 0.5) * 0.9) * ch)))
      if (isLand[y * W + x]) seeds.push({ x, y, land: true })
    }
  }
  const sw = W / SEA_COLS, sh = H / SEA_ROWS
  for (let gy = 0; gy < SEA_ROWS; gy++) {
    for (let gx = 0; gx < SEA_COLS; gx++) {
      const x = Math.round((gx + 0.5 + (rand() - 0.5) * 0.8) * sw)
      const y = Math.round((gy + 0.5 + (rand() - 0.5) * 0.8) * sh)
      if (!isLand[y * W + x]) seeds.push({ x, y, land: false })
    }
  }
}

/** 最近种子光栅化：返回 owner 数组（Int32，索引=seed 下标），可选累计质心 */
function rasterize(step, owners, centroids) {
  const n = seeds.length
  if (centroids) { for (let i = 0; i < n; i++) { centroids[i].sx = 0; centroids[i].sy = 0; centroids[i].w = 0 } }
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      let best = -1, bd = Infinity
      for (let i = 0; i < n; i++) {
        const dx = seeds[i].x - x, dy = seeds[i].y - y
        const d = dx * dx + dy * dy
        if (d < bd) { bd = d; best = i }
      }
      owners[y * W + x] = best
      if (centroids) { const c = centroids[best]; c.sx += x; c.sy += y; c.w++ }
    }
  }
}

// Lloyd 松弛（1/4 分辨率两轮）
{
  const sub = new Int32Array(W * H)
  const cents = seeds.map(() => ({ sx: 0, sy: 0, w: 0 }))
  for (let iter = 0; iter < 2; iter++) {
    rasterize(4, sub, cents)
    for (let i = 0; i < seeds.length; i++) {
      if (cents[i].w > 0) {
        seeds[i].x = Math.min(W - 1, Math.max(0, Math.round(cents[i].sx / cents[i].w)))
        seeds[i].y = Math.min(H - 1, Math.max(0, Math.round(cents[i].sy / cents[i].w)))
        // 松弛后种子可能漂进海/陆地错误侧：按归属像素的主导性修正 land 标记
        seeds[i].land = isLand[seeds[i].y * W + seeds[i].x] === 1
      }
    }
  }
}

// 最终全分辨率光栅化 + 邻接统计
const owner = new Int32Array(W * H)
rasterize(1, owner, null)

// 陆地省 = 种子是陆地 && 其归属像素多数是陆地（防漂移）；海洋同理
{
  const landPixels = new Float64Array(seeds.length)
  const totPixels = new Float64Array(seeds.length)
  for (let i = 0; i < W * H; i++) { totPixels[owner[i]]++; if (isLand[i]) landPixels[owner[i]]++ }
  for (let i = 0; i < seeds.length; i++) seeds[i].land = landPixels[i] / Math.max(1, totPixels[i]) > 0.5
}

// 省 id 分配：陆地省 1..L，海洋省接着编（id 编码 16bit，RGB 低两位）
const landSeeds = [], seaSeeds = []
for (let i = 0; i < seeds.length; i++) (seeds[i].land ? landSeeds : seaSeeds).push(i)
if (landSeeds.length + seaSeeds.length > 65535) throw new Error('省数超 16bit 编码')
const seedToId = new Int32Array(seeds.length)
landSeeds.forEach((si, k) => { seedToId[si] = k + 1 })
seaSeeds.forEach((si, k) => { seedToId[si] = landSeeds.length + k + 1 })
const PROV_COUNT = landSeeds.length + seaSeeds.length
console.log(`省数: 陆地 ${landSeeds.length} + 海洋 ${seaSeeds.length} = ${PROV_COUNT}`)

// 邻接 + 质心 + 像素计数
const adjSet = Array.from({ length: PROV_COUNT + 1 }, () => new Set())
const cx = new Float64Array(PROV_COUNT + 1)
const cy = new Float64Array(PROV_COUNT + 1)
const pxCount = new Float64Array(PROV_COUNT + 1)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const o = owner[y * W + x]
    const id = seedToId[o]
    cx[id] += x; cy[id] += y; pxCount[id]++
    if (x + 1 < W) {
      const id2 = seedToId[owner[y * W + x + 1]]
      if (id2 !== id) { adjSet[id].add(id2); adjSet[id2].add(id) }
    }
    if (y + 1 < H) {
      const id2 = seedToId[owner[(y + 1) * W + x]]
      if (id2 !== id) { adjSet[id].add(id2); adjSet[id2].add(id) }
    }
  }
}

// 地形赋值（陆地省）：fBm 分档
const TERRAINS = ['plains', 'forest', 'hills', 'mountain', 'marsh']
const provTerrain = new Array(PROV_COUNT + 1).fill('ocean')
{
  // 山地取陆地海拔高分位，保证有成片山脉
  const vals = landSeeds.map((si) => {
    const id = seedToId[si]
    return { id, v: noiseB.fbm((cx[id] / W) * 5, (cy[id] / H) * 5, 4) }
  }).sort((a, b) => a.v - b.v)
  const mThr = vals[(vals.length * 0.9) | 0].v
  const hThr = vals[(vals.length * 0.72) | 0].v
  for (const { id, v } of vals) {
    if (v > mThr) provTerrain[id] = 'mountain'
    else if (v > hThr) provTerrain[id] = 'hills'
  }
  for (const si of landSeeds) {
    const id = seedToId[si]
    if (provTerrain[id] !== 'ocean') continue
    const f = noiseA.fbm((cx[id] / W) * 6 + 11, (cy[id] / H) * 6 + 7, 4)
    const m = noiseB.fbm((cx[id] / W) * 9 + 3, (cy[id] / H) * 9 + 5, 3)
    if (m > 0.72) provTerrain[id] = 'marsh'
    else if (f > 0.58) provTerrain[id] = 'forest'
    else provTerrain[id] = 'plains'
  }
}

// ───────────────────────── 只保留最大陆块（孤岛降级为海，保证全图陆军可达） ─────────────────────────
{
  const landIds = landSeeds.map((si) => seedToId[si])
  const visited = new Set()
  let bestComp = []
  for (const start of landIds) {
    if (visited.has(start)) continue
    const comp = [start]
    visited.add(start)
    const stack = [start]
    while (stack.length) {
      const cur = stack.pop()
      for (const nb of adjSet[cur]) {
        if (visited.has(nb) || provTerrain[nb] === 'ocean') continue
        visited.add(nb)
        comp.push(nb)
        stack.push(nb)
      }
    }
    if (comp.length > bestComp.length) bestComp = comp
  }
  const keep = new Set(bestComp)
  for (const id of landIds) if (!keep.has(id)) provTerrain[id] = 'ocean'
  console.log(`主陆块 ${bestComp.length} 省（降级 ${landIds.length - bestComp.length} 个孤岛省为海）`)
}

// ───────────────────────── 州：k-means 聚类 + 连通性修复 ─────────────────────────
const stateOf = new Int32Array(PROV_COUNT + 1).fill(-1)
{
  // k-means 初始中心：陆地省里 k-means++ 简化（随机 + 最远点采样）；孤岛降级省排除
  const K = STATE_COUNT
  const pts = landSeeds.map((si) => { const id = seedToId[si]; return { id, x: cx[id], y: cy[id], w: pxCount[id] } })
    .filter((p) => provTerrain[p.id] !== 'ocean')
  const centers = [pts[(rand() * pts.length) | 0]]
  while (centers.length < K) {
    let best = null, bd = -1
    for (const p of pts) {
      let d = Infinity
      for (const c of centers) { const dx = p.x - c.x, dy = p.y - c.y; d = Math.min(d, dx * dx + dy * dy) }
      if (d > bd) { bd = d; best = p }
    }
    centers.push(best)
  }
  const assign = new Int32Array(pts.length)
  for (let iter = 0; iter < 24; iter++) {
    for (let i = 0; i < pts.length; i++) {
      let bi = 0, bd = Infinity
      for (let c = 0; c < K; c++) {
        const dx = pts[i].x - centers[c].x, dy = pts[i].y - centers[c].y
        const d = dx * dx + dy * dy
        if (d < bd) { bd = d; bi = c }
      }
      assign[i] = bi
    }
    const sx = new Float64Array(K), sy = new Float64Array(K), sw = new Float64Array(K)
    for (let i = 0; i < pts.length; i++) { const a = assign[i]; sx[a] += pts[i].x * pts[i].w; sy[a] += pts[i].y * pts[i].w; sw[a] += pts[i].w }
    for (let c = 0; c < K; c++) if (sw[c] > 0) { centers[c] = { x: sx[c] / sw[c], y: sy[c] / sw[c] } }
  }
  // 写回（state id 0..K-1）
  for (let i = 0; i < pts.length; i++) stateOf[pts[i].id] = assign[i]

  // 连通性修复：每个 state 取最大连通分量，其余省归给相邻 state（BFS 扩散）
  const landIds = pts.map((p) => p.id)
  const comp = new Map()
  for (const id of landIds) {
    if (comp.has(id)) continue
    const queue = [id]; comp.set(id, id)
    while (queue.length) {
      const cur = queue.pop()
      for (const nb of adjSet[cur]) {
        if (stateOf[nb] === stateOf[id] && !comp.has(nb)) { comp.set(nb, id); queue.push(nb) }
      }
    }
  }
  // 各分量的规模
  const compSize = new Map()
  for (const id of landIds) compSize.set(comp.get(id), (compSize.get(comp.get(id)) ?? 0) + 1)
  for (let s = 0; s < K; s++) {
    const members = landIds.filter((id) => stateOf[id] === s)
    if (members.length === 0) continue
    const byComp = new Map()
    for (const id of members) byComp.set(comp.get(id), (byComp.get(comp.get(id)) ?? 0) + 1)
    let keep = -1, keepN = -1
    for (const [c, n] of byComp) if (n > keepN) { keepN = n; keep = c }
    // 小分量：BFS 向邻省找非本 state 的省，借其 state
    for (const id of members) {
      if (comp.get(id) === keep) continue
      const queue = [id]
      const seen = new Set([id])
      let target = -1
      while (queue.length && target < 0) {
        const cur = queue.shift()
        for (const nb of adjSet[cur]) {
          if (seen.has(nb) || stateOf[nb] < 0) continue
          if (stateOf[nb] !== s) { target = stateOf[nb]; break }
          if (!seen.has(nb)) { seen.add(nb); queue.push(nb) }
        }
      }
      stateOf[id] = target >= 0 ? target : s
    }
  }
}

// ───────────────────────── 国家：区域生长 ─────────────────────────
const countriesPath = path.join(ROOT, 'projects', 'hoi4', 'asset', 'config', 'countries.table.json')
const countriesCfg = JSON.parse(fs.readFileSync(countriesPath, 'utf-8'))
const TAGS = Object.keys(countriesCfg).filter((k) => !k.startsWith('_'))
const ownerTag = new Array(PROV_COUNT + 1).fill(null) // 省 → 国家 tag（陆地）

{
  // 首都：最远点采样选 TAGS.length 个互相远离的陆地省（偏好 plains/hills）
  const landIds = landSeeds.map((si) => seedToId[si]).filter((id) => provTerrain[id] !== 'ocean')
  const okForCapital = (id) => provTerrain[id] === 'plains' || provTerrain[id] === 'hills' || provTerrain[id] === 'forest'
  const pool = landIds.filter(okForCapital)
  const capitals = [pool[(rand() * pool.length) | 0]]
  while (capitals.length < TAGS.length) {
    let best = null, bd = -1
    for (const id of pool) {
      if (capitals.includes(id)) continue
      let d = Infinity
      for (const c of capitals) { const dx = cx[id] - cx[c], dy = cy[id] - cy[c]; d = Math.min(d, dx * dx + dy * dy) }
      if (d > bd) { bd = d; best = id }
    }
    capitals.push(best)
  }
  // 州邻接图上生长：按州为单位分配（省碎分配会飞地）
  const stateAdj = Array.from({ length: STATE_COUNT }, () => new Set())
  for (let id = 1; id <= PROV_COUNT; id++) {
    if (stateOf[id] < 0) continue
    for (const nb of adjSet[id]) {
      if (stateOf[nb] >= 0 && stateOf[nb] !== stateOf[id]) { stateAdj[stateOf[id]].add(stateOf[nb]); stateAdj[stateOf[nb]].add(stateOf[id]) }
    }
  }
  const stateOwner = new Array(STATE_COUNT).fill(null)
  const frontier = [] // { state, tag, prio }
  const capStateOf = {}
  // 目标份额（相对权重，权重总和归一后决定各国产州数配额）
  const TAG_WEIGHT = { GER: 1.7, SOV: 1.9, FRA: 1.2, ENG: 1.1, ITA: 1.1, POL: 0.9, HUN: 0.6, ROM: 0.6, YUG: 0.6, SWI: 0.45 }
  const weight = (tag) => TAG_WEIGHT[tag] ?? 0.5
  const claimed = Object.fromEntries(TAGS.map((t) => [t, 0]))
  // 未占州总数（配额分母）
  TAGS.forEach((tag, i) => {
    const capProv = capitals[i]
    const s = stateOf[capProv]
    stateOwner[s] = tag
    capStateOf[tag] = capProv
    for (const nb of stateAdj[s]) frontier.push({ state: nb, tag, prio: rand() })
  })
  while (frontier.length) {
    // prio = 随机数 − 已占州数/目标权重：份额吃满的 tag 优先级跌到负值，产出均衡版图
    for (const f of frontier) f.prio = rand() - claimed[f.tag] / weight(f.tag)
    frontier.sort((a, b) => b.prio - a.prio)
    const { state, tag } = frontier.shift()
    if (stateOwner[state] !== null) continue
    stateOwner[state] = tag
    claimed[tag]++
    for (const nb of stateAdj[state]) if (stateOwner[nb] === null) frontier.push({ state: nb, tag })
  }
  // 未分配的州（孤岛）→ 最近的已分配州
  for (let s = 0; s < STATE_COUNT; s++) {
    if (stateOwner[s] !== null) continue
    const queue = [s]; const seen = new Set([s]); let found = null
    while (queue.length && !found) {
      const cur = queue.shift()
      for (const nb of stateAdj[cur]) {
        if (seen.has(nb)) continue
        seen.add(nb)
        if (stateOwner[nb] !== null) { found = stateOwner[nb]; break }
        queue.push(nb)
      }
    }
    stateOwner[s] = found ?? TAGS[0]
  }
  for (let id = 1; id <= PROV_COUNT; id++) if (stateOf[id] >= 0) ownerTag[id] = stateOwner[stateOf[id]]
  globalThis.__capitals = capStateOf
}
const capitals = globalThis.__capitals

// ───────────────────────── 州名 / VP / 资源 / 建筑位 ─────────────────────────
const STATE_NAMES = [
  '下原州', '临海州', '北岭州', '青川州', '东原州', '南谷州', '西坪州', '白石州',
  '黑森州', '洛林州', '威塞州', '安特州', '巴伐州', '波美州', '图林州', '摩泽州',
  '上奥州', '下奥州', '卡尔州', '蒂罗州', '波西州', '摩拉州', '克拉州', '马佐州',
  '大波州', '小波州', '立沃州', '库尔州', '明斯州', '沃里州', '基辅州', '顿河州',
  '伏尔州', '乌拉州', '梁赞州', '斯摩州', '图拉州', '诺夫州', '普斯科州', '维亚州',
  '多瑙州', '特兰州', '瓦拉州', '摩尔州', '萨瓦州', '德里纳州', '达尔州', '格劳州',
]
const stateVp = new Float64Array(STATE_COUNT)
const statePop = new Float64Array(STATE_COUNT)
const stateSlots = new Int32Array(STATE_COUNT)
const stateSteel = new Int32Array(STATE_COUNT)
const stateOil = new Int32Array(STATE_COUNT)
{
  for (let s = 0; s < STATE_COUNT; s++) {
    statePop[s] = Math.round((20 + rand() * 80) * 10) / 10
    stateSlots[s] = 2 + ((rand() * 4) | 0)
    const r = rand()
    if (r > 0.7) stateSteel[s] = 1 + ((rand() * 3) | 0)
    if (r < 0.12) stateOil[s] = 1 + ((rand() * 2) | 0)
  }
  // 首都州 VP 高，随机再撒一些次级 VP
  for (const tag of TAGS) {
    const s = stateOf[capitals[tag]]
    stateVp[s] = 5
  }
  let vpLeft = TAGS.length * 3
  while (vpLeft > 0) {
    const s = (rand() * STATE_COUNT) | 0
    if (stateVp[s] === 0) { stateVp[s] = 1 + ((rand() * 2) | 0); vpLeft-- }
  }
}

// ───────────────────────── 产物：map.json ─────────────────────────
const provincesJson = {}
for (let id = 1; id <= PROV_COUNT; id++) {
  const sea = pxCount[id] === 0 ? false : !isLand[(Math.round(cy[id] / pxCount[id]) * W + Math.round(cx[id] / pxCount[id]))]
  provincesJson[id] = {
    x: Math.round(cx[id] / Math.max(1, pxCount[id])),
    y: Math.round(cy[id] / Math.max(1, pxCount[id])),
    terrain: provTerrain[id],
    sea: provTerrain[id] === 'ocean' || sea,
    coastal: [...adjSet[id]].some((nb) => provTerrain[nb] === 'ocean') && provTerrain[id] !== 'ocean',
    neighbors: [...adjSet[id]].sort((a, b) => a - b),
    state: stateOf[id],
  }
}
const statesJson = []
for (let s = 0; s < STATE_COUNT; s++) {
  const provs = []
  for (let id = 1; id <= PROV_COUNT; id++) if (stateOf[id] === s) provs.push(id)
  if (provs.length === 0) continue
  statesJson.push({
    id: s,
    name: STATE_NAMES[s % STATE_NAMES.length],
    provinces: provs,
    owner: ownerTag[provs[0]],
    capital: provs.includes(capitals[ownerTag[provs[0]]]) ? capitals[ownerTag[provs[0]]] : provs[0],
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
    const id = seedToId[owner[i]]
    rgb[i * 3] = id & 255
    rgb[i * 3 + 1] = (id >> 8) & 255
    rgb[i * 3 + 2] = 0
  }
  fs.writeFileSync(path.join(OUT_DIR, 'provinces.png'), encodePng(W, H, rgb))
}

// ───────────────────────── 产物：terrain.png ─────────────────────────
{
  const TERRAIN_COLOR = {
    ocean: [38, 62, 92], plains: [122, 148, 90], forest: [72, 104, 68],
    hills: [148, 132, 88], mountain: [128, 120, 112], marsh: [96, 116, 96], city: [150, 140, 128],
  }
  const rgb = new Uint8Array(W * H * 3)
  const elev = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      elev[y * W + x] = noiseB.fbm((x / W) * 14, (y / H) * 14, 4)
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const id = seedToId[owner[i]]
      const t = provTerrain[id]
      const c = TERRAIN_COLOR[t] ?? TERRAIN_COLOR.plains
      let r = c[0], g = c[1], b = c[2]
      if (t === 'ocean') {
        // 离岸越远越深
        let deep = 0
        for (let d = 1; d <= 6; d++) {
          const yy = y + d * 8
          if (yy >= H) break
          if (provTerrain[seedToId[owner[yy * W + x]]] !== 'ocean') break
          deep++
        }
        const k = 1 - deep * 0.09 + elev[i] * 0.12
        r *= k; g *= k; b *= k
      } else {
        // 地形纹理：高频噪点 + 海拔微亮
        const k = 0.88 + elev[i] * 0.3 + noiseA.noise2(x * 0.35, y * 0.35) * 0.12
        r *= k; g *= k; b *= k
      }
      rgb[i * 3] = Math.max(0, Math.min(255, r | 0))
      rgb[i * 3 + 1] = Math.max(0, Math.min(255, g | 0))
      rgb[i * 3 + 2] = Math.max(0, Math.min(255, b | 0))
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, 'terrain.png'), encodePng(W, H, rgb))
}

// ───────────────────────── 汇总 ─────────────────────────
const dist = {}
for (const tag of TAGS) dist[tag] = statesJson.filter((s) => s.owner === tag).length
console.log('州-国家分布:', dist)
console.log('首都:', capitals)
console.log(`完成 → ${OUT_DIR}`)
