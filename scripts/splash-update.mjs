#!/usr/bin/env node
/**
 * splash-update.mjs — 独立开屏进度写入助手
 *
 * editor.bat 在每个真实启动步骤完成后调用本脚本，把进度合并写入
 * DEMOSTUDIO_SPLASH_STATE 指向的 JSON 状态文件；scripts/splash.ps1
 * 开屏窗口以 80ms 轮询读取该文件刷新进度条。Electron 主进程起来后
 * 接管同一文件继续推送（见 electron/main.ts 的 writeSplashState）。
 *
 * 任何失败都静默退出（exit 0），绝不阻塞/中断启动流程。
 *
 * 用法: node scripts/splash-update.mjs <percent> "<status>" [--done]
 */
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const pct = Math.max(0, Math.min(100, Number(args[0]) || 0))
const status = args.length > 1 && !args[1].startsWith('--') ? args[1] : ''
const done = args.includes('--done')
const file =
  process.env.DEMOSTUDIO_SPLASH_STATE || path.resolve('cache/splash/state.json')

try {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const state = { pct, status, done, ts: Date.now() }
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state), 'utf8')
  fs.renameSync(tmp, file)
} catch {
  /* 开屏不可用时不影响启动 */
}
process.exit(0)
