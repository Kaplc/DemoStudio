/**
 * cdp-shot.mjs — CDP 截图工具：连到运行中的编辑器（Electron）CDP，把 Game/预览画布截成本地 PNG：连到运行中编辑器的 CDP，把指定页签画面截成本地 PNG。
 * 用法：node cdp-shot.mjs [输出路径] ['canvas'|'page']
 *   输出路径默认 .tmp-shots/shot-<时间戳>.png；'canvas' 只截可见 canvas 区域（默认），'page' 截整页。
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const appdata = process.env.APPDATA
const ports = []
for (const name of ['demostudio', 'DemoStudio', 'Electron']) {
  try {
    const p = parseInt(fs.readFileSync(path.join(appdata, name, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0], 10)
    if (p > 0 && p <= 65535) ports.push(p)
  } catch {}
}
ports.push(9222)

async function pickBrowser() {
  for (const port of [...new Set(ports)]) {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 3000 })
      console.log(`[cdp-shot] 已连接端口 ${port}`)
      return browser
    } catch (e) {
      console.log(`[cdp-shot] 端口 ${port} 不可用: ${e.message.split('\n')[0]}`)
    }
  }
  throw new Error('没有可用的 CDP 端口（编辑器没开？）')
}

const outArg = process.argv[2]
const mode = process.argv[3] || 'canvas'
const out = outArg || path.join('.tmp-shots', `shot-${Date.now()}.png`)
fs.mkdirSync(path.dirname(out), { recursive: true })

const browser = await pickBrowser()
let page = null
for (const ctx of browser.contexts()) {
  for (const p of ctx.pages()) {
    const url = p.url()
    if (url.includes('localhost:5173') && !url.includes('agent.html') && !url.startsWith('devtools')) page = p
  }
}
if (!page) { console.error('未找到编辑器页面 (localhost:5173)'); process.exit(1) }
await page.bringToFront().catch(() => {})

if (mode === 'canvas') {
  const canvases = page.locator('canvas:visible')
  const n = await canvases.count()
  let best = null
  let bestArea = 0
  for (let i = 0; i < n; i++) {
    const box = await canvases.nth(i).boundingBox()
    if (box && box.width * box.height > bestArea) { bestArea = box.width * box.height; best = canvases.nth(i) }
  }
  if (!best) { console.error('无可见 canvas'); process.exit(1) }
  await best.screenshot({ path: out })
} else {
  await page.screenshot({ path: out })
}
console.log(`[cdp-shot] 已保存: ${path.resolve(out)}`)
process.exit(0)
