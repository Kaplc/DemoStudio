#!/usr/bin/env node
/**
 * DSH 契约 fixture 采集脚本（内核升级 SOP 第一步）
 *
 * 从真实 DSH 会话文件（session*.jsonl.zstd，多帧 zstd 追加格式）中抽取指定类型的
 * 事件载荷，生成适配层契约测试的 fixture 骨架（tests/contract/ 的素材来源）。
 *
 * 用法：
 *   node scripts/capture-dsh-fixtures.mjs [--type tool/result,turn/end] [--limit 3] [--out <file>]
 *     --type   逗号分隔的事件类型过滤（默认 tool/result,assistant/message,turn/end）
 *     --limit  每类最多抽取条数（默认 3）
 *     --out    输出 JSON 文件路径（缺省打印到 stdout）
 *
 * 依赖：Node >= 22（原生 node:zlib zstdDecompressSync）。
 * 已知坑：zstdDecompressSync 只解第一帧且不报错——本脚本按 magic 28 B5 2F FD 扫描逐帧解。
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const SESSIONS_DIR = path.join(os.homedir(), '.dsh', 'sessions')

function parseArgs() {
  const args = { type: 'tool/result,assistant/message,turn/end', limit: 3, out: null }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--type') args.type = argv[++i]
    else if (argv[i] === '--limit') args.limit = Number(argv[++i]) || 3
    else if (argv[i] === '--out') args.out = argv[++i]
  }
  return args
}

/** 解析多帧 zstd 文件：按 magic 扫描逐帧解压，拼接 UTF-8 文本 */
function decodeZstdMultiFrame(buf) {
  const chunks = []
  let pos = 0
  while (pos < buf.length) {
    const magicAt = buf.indexOf(ZSTD_MAGIC, pos)
    if (magicAt < 0) break
    // 从 magic 位置尝试解一帧（失败窗口向后挪 1 字节继续扫）
    try {
      const frame = zstdDecompressSync(buf.subarray(magicAt))
      chunks.push(frame)
      pos = magicAt + ZSTD_MAGIC.length
    } catch {
      pos = magicAt + 1
    }
  }
  return Buffer.concat(chunks).toString('utf-8')
}

/** 从目录递归收集 session*.jsonl.zstd 文件 */
function collectSessionFiles(dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collectSessionFiles(full, out)
    else if (e.isFile() && /^session.*\.jsonl\.zstd$/.test(e.name)) out.push(full)
  }
  return out
}

function main() {
  const args = parseArgs()
  const wanted = new Set(args.type.split(',').map((s) => s.trim()).filter(Boolean))
  if (!fs.existsSync(SESSIONS_DIR)) {
    console.error(`会话目录不存在: ${SESSIONS_DIR}`)
    process.exit(1)
  }
  const files = collectSessionFiles(SESSIONS_DIR)
  console.error(`扫描 ${files.length} 个会话文件，过滤类型: ${[...wanted].join(', ')}`)

  const picked = new Map() // type → 数组（最多 limit 条，取最新的）
  for (const file of files) {
    let text
    try { text = decodeZstdMultiFrame(fs.readFileSync(file)) } catch { continue }
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      let rec
      try { rec = JSON.parse(line) } catch { continue }
      // 会话文件记录形状：{type:'event', event:{type,seq,data}} 或直接事件对象
      const ev = rec?.type === 'event' && rec.event ? rec.event : rec
      const type = ev?.type
      if (typeof type !== 'string' || !wanted.has(type)) continue
      const bucket = picked.get(type) ?? []
      if (bucket.length >= args.limit) continue
      bucket.push({ source: path.basename(path.dirname(file)), seq: ev.seq, event: ev })
      picked.set(type, bucket)
    }
  }

  const fixture = {}
  for (const [type, bucket] of picked) fixture[type] = bucket
  const json = JSON.stringify(fixture, null, 2)
  if (args.out) {
    fs.writeFileSync(args.out, json, 'utf-8')
    console.error(`已写出: ${args.out}`)
  } else {
    console.log(json)
  }
  for (const [type, bucket] of picked) console.error(`  ${type}: ${bucket.length} 条`)
}

main()
