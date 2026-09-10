/**
 * e2e/framework/session — GameSession：一次已引导的游戏会话
 *
 * 职责：
 * 1. boot：把页面从「编辑器首页」带到「目标项目游戏运行中」（复用 warm spec 已验证的引导路径）
 * 2. 包装 ai.ts 的查询/操作，顺手记录 lastState/lastHud 作为失败证据
 * 3. attachEvidenceIfFailed：用例失败时自动落盘并 attach
 *    game-console.log（页面控制台时间线）/ game-state.json / game-hud.json / game-final.png
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Page, TestInfo } from '@playwright/test'
import { ConsoleCollector } from './console'
import {
  clickActor as aiClickActor,
  findHUDNodes,
  flattenHUD,
  getState as aiGetState,
  getHUDRoots,
  getSceneOutlineRoots,
  gm as aiGm,
} from './ai'
import type {
  ClickActorResult,
  GameStateSnapshot,
  GMResult,
  HUDFlatEntry,
  HUDNode,
  ProjectDescriptor,
  SceneOutlineNode,
} from './types'

export class GameSession {
  readonly page: Page
  readonly project: ProjectDescriptor
  private readonly collector = new ConsoleCollector()
  private lastState: GameStateSnapshot | undefined
  private lastHudRoots: HUDNode[] = []

  private constructor(page: Page, project: ProjectDescriptor) {
    this.page = page
    this.project = project
  }

  /** 从编辑器首页一路引导到游戏运行（选卡 → 打开工程 → Launch → 等 running；被打回首页自动重试） */
  static async boot(page: Page, project: ProjectDescriptor): Promise<GameSession> {
    const session = new GameSession(page, project)
    session.collector.attach(page)

    const maxAttempts = 2
    let lastErr: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await session.bootOnce()
        return session
      } catch (err) {
        lastErr = err
        session.collector.mark(`boot 第 ${attempt} 次失败: ${(err as Error).message}`)
      }
    }
    throw lastErr
  }

  /**
   * 单次引导。已验证的坑：
   * - 不能用 hasText '▶' 定位启动按钮——大纲折叠箭头/agent 面板箭头都是 '▶'，.first() 是 DOM 序赌博；
   *   MenuBar 的启动按钮可访问名是 "▶ Launch"，且仅 currentProject 就绪时渲染，定位唯一语义正确（MenuBar.tsx:180-186）。
   * - Launch 点击会触发整页重载；浏览器模式（MockElectronAPI）下若重载早于工程状态持久化，
   *   会被打回首页（工程不持久），此时必须整轮重试而不是干等超时。
   */
  private async bootOnce(): Promise<void> {
    const { page, project } = this
    await page.goto('/')
    this.collector.mark(`boot 开始：project=${project.id} card=${project.cardName}`)

    const cardPattern = new RegExp(`^${project.cardName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
    const card = page.locator('div, button').filter({ hasText: cardPattern }).last()
    await card.click()
    await page.getByRole('button', { name: '打开工程' }).click()
    await page.getByRole('button', { name: '打开工程' }).waitFor({ state: 'hidden', timeout: 30_000 })

    const launch = page.getByRole('button', { name: '▶ Launch' })
    await launch.waitFor({ state: 'visible', timeout: 30_000 })
    this.collector.mark('工程已打开，点 Launch 运行游戏（可能触发整页重载）')
    await launch.click()

    const outcome = await this.waitRunningOrHome(30_000)
    if (outcome === 'home') {
      throw new Error('[e2e] Launch 后被整页 reload 打回首页（工程状态未持久），需要整轮重试')
    }
    this.collector.mark('游戏已运行（ai.getState.running=true）')
  }

  /** 轮询：游戏 running=true 返回 'running'；检测到被打回首页（打开工程按钮可见）立即返回 'home'，快速失败进重试 */
  private async waitRunningOrHome(timeoutMs: number): Promise<'running' | 'home'> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      // 注意：page.evaluate 的字符串按纯 JS 求值（不经过 TS 转译），此处禁止写 TS 语法
      const state = await this.page.evaluate(`(() => {
        const openBtn = Array.from(document.querySelectorAll('button'))
          .find((b) => (b.textContent || '').trim() === '打开工程')
        const ai = window.__ai
        let running = false
        if (ai) {
          const r = ai.emit('ai.getState', {})
          running = !!(r && r.results && r.results[0] && r.results[0].running === true)
        }
        return { openVisible: !!openBtn, running: running }
      })()`) as { openVisible: boolean, running: boolean }
      if (state.running) return 'running'
      if (state.openVisible) return 'home'
      await this.page.waitForTimeout(500)
    }
    throw new Error(`[e2e] 等待游戏运行超时（${timeoutMs}ms）且未回到首页；看 game-console.log 附件定位`)
  }

  // ─── 查询（每次都记录 lastState/lastHudRoots 作为失败证据） ───

  async state(): Promise<GameStateSnapshot> {
    this.lastState = await aiGetState(this.page)
    return this.lastState
  }

  /** 全部 UI 根 Actor（ai.getHUD 的 hud 数组，可能不止一根） */
  async hud(): Promise<HUDNode[]> {
    this.lastHudRoots = await getHUDRoots(this.page)
    return this.lastHudRoots
  }

  async outline(opts?: { maxDepth?: number, activeOnly?: boolean }): Promise<SceneOutlineNode[]> {
    return getSceneOutlineRoots(this.page, opts)
  }

  /** 当前 HUD 树的平铺列表（断言/调试输出都方便） */
  async hudFlat(): Promise<HUDFlatEntry[]> {
    return flattenHUD(await this.hud())
  }

  /** 不等待，直接在当前 HUD 树里找满足条件的节点 */
  async findHUD(pred: (node: HUDNode) => boolean): Promise<HUDNode[]> {
    return findHUDNodes(await this.hud(), pred)
  }

  /** 轮询等 HUD 出现满足条件的节点（等场景切换/面板挂载），返回匹配节点 */
  async waitHUD(pred: (node: HUDNode) => boolean, timeoutMs = 30_000): Promise<HUDNode[]> {
    const deadline = Date.now() + timeoutMs
    let last: HUDNode[] = []
    while (Date.now() < deadline) {
      last = await this.findHUD(pred)
      if (last.length > 0) return last
      await this.page.waitForTimeout(500)
    }
    throw new Error(`[e2e] waitHUD 超时（${timeoutMs}ms）：条件未满足；game-hud.json 附件是最后一帧 HUD 树`)
  }

  // ─── 操作 ───

  async clickActor(target: { name?: string, text?: string, path?: string }, timeoutMs?: number): Promise<ClickActorResult> {
    return aiClickActor(this.page, target, { timeoutMs })
  }

  async gm(command: string, args?: string[]): Promise<GMResult> {
    return aiGm(this.page, command, args)
  }

  // ─── 失败证据 ───

  /** 用例失败时自动落盘并 attach 游戏运行时证据（fixtures 的 teardown 调用） */
  async attachEvidenceIfFailed(testInfo: TestInfo): Promise<void> {
    if (testInfo.status !== 'failed' && testInfo.status !== 'timedOut') return

    // ① 页面控制台时间线（自 boot 起的环形缓冲）
    try {
      const consolePath = testInfo.outputPath('game-console.log')
      fs.mkdirSync(path.dirname(consolePath), { recursive: true })
      fs.writeFileSync(consolePath, this.collector.dump(), 'utf8')
      testInfo.attach('game-console.log', { path: consolePath, contentType: 'text/plain' })
    } catch { /* 页面已死也要保住已收集的内容 */ }

    // ② 游戏状态快照：优先现采，失败退回最后一次成功查询的缓存
    try {
      let state = this.lastState
      try { state = await aiGetState(this.page) } catch { /* 用缓存 */ }
      if (state) {
        const p = testInfo.outputPath('game-state.json')
        fs.mkdirSync(path.dirname(p), { recursive: true })
        fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf8')
        testInfo.attach('game-state.json', { path: p, contentType: 'application/json' })
      }
    } catch { /* 尽力而为 */ }

    // ③ HUD 树快照（断言 UI 的用例看这个最直观；全部 UI 根 Actor 数组）
    try {
      let hudRoots = this.lastHudRoots
      try { hudRoots = await getHUDRoots(this.page) } catch { /* 用缓存 */ }
      if (hudRoots.length > 0) {
        const p = testInfo.outputPath('game-hud.json')
        fs.mkdirSync(path.dirname(p), { recursive: true })
        fs.writeFileSync(p, JSON.stringify({ hud: hudRoots }, null, 2), 'utf8')
        testInfo.attach('game-hud.json', { path: p, contentType: 'application/json' })
      }
    } catch { /* 尽力而为 */ }

    // ④ 终帧截图（Playwright 自带 only-on-failure 截图在失败瞬间；这张是 teardown 时的补充）
    try {
      const shot = testInfo.outputPath('game-final.png')
      await this.page.screenshot({ path: shot })
      testInfo.attach('game-final.png', { path: shot, contentType: 'image/png' })
    } catch { /* 页面可能已崩溃 */ }
  }
}
