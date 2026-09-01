/**
 * TC-A3：Agent 独立入口模块图审计（对应 devdoc/agent-window-independent-entry/test-cases.md）
 *
 * 策略：构建产物分析，区分静态边与动态边：
 *  - 静态闭包（只沿 import/from 静态边）：agent 窗口启动即加载，必须零游戏/项目/主编辑器模块
 *  - 动态边（import()）：按需惰性加载，不进入静态闭包。agent 静态闭包允许的唯一动态出口是
 *    projects/registry（editorStore.setCurrentProject 惰性加载，agent 窗口运行时永不触发，
 *    见 plan.md Step 1）；registry 对各游戏项目的动态注册链同理（editor UI 才会触发）
 *
 * dev 运行时资源审计：/agent.html 实际发起的网络请求不得含游戏/registry 模块（运行时证据）。
 * 体积基线（TC-F3）：agent 静态闭包 < 主入口静态闭包 1/3。
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const DIST = path.resolve(__dirname, '..', 'dist')

interface Edge { to: string; from: string }
interface Graph {
  staticClosure: Map<string, number> // agent 静态闭包（运行时必加载）
  dynamicEdges: Edge[] // 静态闭包 chunk 发出的动态 import 边（按需加载出口）
  mainClosure: Map<string, number>
}

function readHtmlScripts(htmlFile: string): string[] {
  const html = fs.readFileSync(path.join(DIST, htmlFile), 'utf-8')
  const scripts = [...html.matchAll(/src="\.\/(assets\/[^"]+\.js)"/g)].map((m) => m[1])
  expect(scripts.length, `${htmlFile} 应引用至少一个 chunk`).toBeGreaterThan(0)
  return scripts
}

/** 只沿静态边（import/from）BFS；单独记录途经 chunk 的动态 import 出口（registry chunk 再深入一层收集） */
function bfsStatic(entryAssets: string[]): { reached: Map<string, number>; dynamicEdges: Edge[] } {
  const reached = new Map<string, number>()
  const dynamicEdges: Edge[] = []
  const queue = [...entryAssets]
  const dynamicQueue: string[] = [] // 经动态边可达的 registry chunk：只收集其动态边，不进静态闭包
  while (queue.length > 0) {
    const rel = queue.shift()!
    if (reached.has(rel)) continue
    const abs = path.join(DIST, rel)
    if (!fs.existsSync(abs)) continue
    const buf = fs.readFileSync(abs)
    reached.set(rel, buf.byteLength)
    const content = buf.toString('utf-8')
    for (const m of content.matchAll(/(?:from\s*|import\s*\(?\s*)["'](\.\/[^"']+\.js)["']/g)) {
      const dep = path.posix.join('assets', m[1].replace(/^\.\//, ''))
      const isDynamic = /import\s*\(\s*["']\.\//.test(m[0])
      if (isDynamic) {
        dynamicEdges.push({ from: rel, to: dep })
        if (/^registry-/.test(path.basename(dep))) dynamicQueue.push(dep)
        continue // 动态边不进入静态闭包
      }
      if (!reached.has(dep)) queue.push(dep)
    }
  }
  // registry chunk 内部的动态边（对游戏项目的 glob 注册）也纳入收集，不进静态闭包
  for (const rel of dynamicQueue) {
    if (reached.has(rel)) continue
    const abs = path.join(DIST, rel)
    if (!fs.existsSync(abs)) continue
    const content = fs.readFileSync(abs).toString('utf-8')
    for (const m of content.matchAll(/import\s*\(\s*["'](\.\/[^"']+\.js)["']\s*\)/g)) {
      dynamicEdges.push({ from: rel, to: path.posix.join('assets', m[1].replace(/^\.\//, '')) })
    }
  }
  return { reached, dynamicEdges }
}

let graph: Graph

test.beforeAll(() => {
  expect(fs.existsSync(path.join(DIST, 'agent.html')), 'dist/agent.html 不存在，请先 npm run build').toBe(true)
  expect(fs.existsSync(path.join(DIST, 'index.html')), 'dist/index.html 不存在，请先 npm run build').toBe(true)
  const agent = bfsStatic(readHtmlScripts('agent.html'))
  const main = bfsStatic(readHtmlScripts('index.html'))
  graph = { staticClosure: agent.reached, dynamicEdges: agent.dynamicEdges, mainClosure: main.reached }
})

test('agent 静态闭包（启动即加载）不含游戏项目 chunk（Fish/Snake/Clash/EatFish/Racing/Demo2D）', () => {
  const leaked = [...graph.staticClosure.keys()].filter((c) => /Fish|Snake|Clash|EatFish|Racing|Demo2D/.test(path.basename(c)))
  expect(leaked, `agent 静态闭包泄漏游戏 chunk: ${leaked.join(', ')}`).toEqual([])
})

test('agent 静态闭包不含 projects/registry chunk 与主入口 chunk', () => {
  const leaked = [...graph.staticClosure.keys()].filter((c) => /^registry-|^main-/.test(path.basename(c)))
  expect(leaked, `agent 静态闭包泄漏 registry/main chunk: ${leaked.join(', ')}`).toEqual([])
})

test('agent 图动态 import 出口边界：registry 惰性 + Mock 伪文件系统，禁止动态可达主编辑器', () => {
  const illegal = graph.dynamicEdges.filter((e) => {
    const to = path.basename(e.to)
    const from = path.basename(e.from)
    // 白名单 1：editorStore.setCurrentProject 对 projects/registry 的惰性加载（plan.md Step 1）
    if (/^registry-/.test(to)) return false
    // 白名单 2：MockElectronAPI 伪文件系统（浏览器模式 import.meta.glob 按需读取工程 JSON/脚本），
    // registry chunk 内部的游戏项目 glob 注册同理；agent 窗口运行时不触发（见运行时审计用例）
    if (/^MockElectronAPI-|^registry-/.test(from) && !/^main-/.test(to)) return false
    return true
  })
  expect(
    illegal.map((e) => `${e.from} → ${e.to}`),
    'agent 图动态 import 出口越过白名单（registry 惰性 / Mock 伪文件系统）或动态可达主编辑器 chunk'
  ).toEqual([])
})

test('agent 静态闭包含 AgentPanel（agent-panel 类名产物）', () => {
  const agentChunk = readHtmlScripts('agent.html')[0]
  const content = fs.readFileSync(path.join(DIST, agentChunk), 'utf-8')
  expect(content).toContain('agent-panel')
})

test('dev 运行时：/agent.html 实际网络请求不含游戏/registry 模块（TC-A3 步骤1+2）', async ({ page }) => {
  const requested: string[] = []
  page.on('request', (req) => {
    const url = req.url()
    if (url.includes('/src/')) requested.push(url)
  })
  await page.goto('/agent.html', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('.agent-panel', { timeout: 30000 })
  await page.waitForTimeout(1500)
  const leaked = requested.filter((u) => /Fish|Snake|Clash|EatFish|Racing|Demo2D|projects\/registry/.test(u))
  expect(leaked, `agent 窗口运行时加载了禁止模块: ${leaked.join(', ')}`).toEqual([])
})

test('agent 静态闭包总体积 < 主入口静态闭包总体积的 1/3（TC-F3 基线）', () => {
  let agentSum = 0
  for (const bytes of graph.staticClosure.values()) agentSum += bytes
  let mainSum = 0
  for (const bytes of graph.mainClosure.values()) mainSum += bytes
  expect(agentSum, `agent 静态闭包=${agentSum}B, main 静态闭包=${mainSum}B`).toBeLessThan(mainSum / 3)
})
