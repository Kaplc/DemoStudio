/**
 * e2e/framework/ai — window.__ai 事件桥封装
 *
 * 已知坑（全部来自 doc/testing/playwright_commands.md 与 warm spec 实战，勿删）：
 * 1. AIModule.emit 有三种静默失败：数据在 results[0] 而非返回值本身；
 *    处理器抛异常时 results[0] 为 undefined 且不抛错；事件未注册时 handled:false 且 results 为空。
 *    所以断言必须 results[0]?.xxx === true，把回执对象当真值会恒真。
 * 2. page.evaluate 的函数参数序列化在当前工具链不稳，统一 JSON 内联进求值字符串。
 * 3. ClickComponent.clickCooldown=500ms：back-to-back 点击会被冷却吞掉，
 *    clickActor 成功后固定等 600ms 吸收冷却窗。
 */
import type { Page } from '@playwright/test'
import type {
  AIEventEnvelope,
  ClickActorResult,
  GameStateSnapshot,
  GMResult,
  HUDFlatEntry,
  HUDNode,
  HUDQueryResult,
  OutlineQueryResult,
  SceneOutlineNode,
} from './types'

/** 在页面里同步调一次 ai 事件，拿聚合回执（信封含 handled/results） */
export function emitAI<T>(page: Page, event: string, payload?: unknown): Promise<AIEventEnvelope<T>> {
  return page.evaluate(
    `(() => { return window.__ai.emit(${JSON.stringify(event)}, ${JSON.stringify(payload ?? {})}) })()`,
  ) as Promise<AIEventEnvelope<T>>
}

/** 取 results[0]，并对三种静默失败给出可读报错（fail-fast，别让断言恒真） */
export function firstResult<T>(envelope: AIEventEnvelope<T> | undefined, event: string): T {
  if (!envelope || envelope.handled === false) {
    throw new Error(`[e2e] AI 事件 "${event}" 无处理器（未注册？）`)
  }
  const first = envelope.results?.[0]
  if (first === undefined) {
    throw new Error(`[e2e] AI 事件 "${event}" 处理器返回 undefined（处理器内部抛异常？看 game-console 附件）`)
  }
  return first
}

/** 轮询等游戏 running=true（▶ 后页面整页重载，__ai 会重新挂载，必须轮询而非一次调用） */
export async function waitGameRunning(page: Page, timeoutMs = 60_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const ai = (window as unknown as {
        __ai?: { emit(e: string, p?: unknown): { results?: Array<{ running?: boolean }> } }
      }).__ai
      if (!ai) return false
      return ai.emit('ai.getState', {}).results?.[0]?.running === true
    },
    undefined,
    { timeout: timeoutMs, polling: 500 },
  )
}

/** ai.getState 快照 */
export async function getState(page: Page): Promise<GameStateSnapshot> {
  return firstResult<GameStateSnapshot>(await emitAI<GameStateSnapshot>(page, 'ai.getState'), 'ai.getState')
}

/**
 * ai.getHUD：返回全部 UI 根 Actor。
 * 实测回执是 { ok, hud: HUDNode[] } 包一层（hud 是数组，可能不止一根），与 AIEvents.ts 注释的单根直觉不同。
 */
export async function getHUDRoots(page: Page): Promise<HUDNode[]> {
  const res = firstResult<HUDQueryResult>(await emitAI<HUDQueryResult>(page, 'ai.getHUD'), 'ai.getHUD')
  if (res.ok === false) throw new Error(`[e2e] ai.getHUD 失败: ${res.error ?? '未知原因'}`)
  return res.hud ?? []
}

/**
 * ai.getSceneOutline：返回场景大纲（3D + UI 根节点合并数组）。
 * 实测回执是 { ok, outline: SceneOutlineNode[] } 包一层。
 */
export async function getSceneOutlineRoots(
  page: Page,
  opts?: { maxDepth?: number, activeOnly?: boolean },
): Promise<SceneOutlineNode[]> {
  const res = firstResult<OutlineQueryResult>(
    await emitAI<OutlineQueryResult>(page, 'ai.getSceneOutline', { maxDepth: opts?.maxDepth, activeOnly: opts?.activeOnly }),
    'ai.getSceneOutline',
  )
  if (res.ok === false) throw new Error(`[e2e] ai.getSceneOutline 失败: ${res.error ?? '未知原因'}`)
  return res.outline ?? []
}

export interface ClickActorTarget {
  /** Actor 名称（精确匹配 .name / root.name） */
  name?: string
  /** UI 文字内容（模糊匹配 UITextComponent.text） */
  text?: string
  /** getHUD 返回的精确 path（最可靠） */
  path?: string
}

/**
 * ai.clickActor 带轮询重试：按钮未就绪时回执 ok=false，按 500ms 间隔重试至超时；
 * 成功后固定等 600ms 吸收 500ms 点击冷却窗，防止下一步点击被吞。
 */
export async function clickActor(
  page: Page,
  target: ClickActorTarget,
  opts?: { timeoutMs?: number },
): Promise<ClickActorResult> {
  const deadline = Date.now() + (opts?.timeoutMs ?? 15_000)
  let last: ClickActorResult = {}
  while (Date.now() < deadline) {
    const envelope = await emitAI<ClickActorResult>(page, 'ai.clickActor', target)
    last = envelope.results?.[0] ?? {}
    if (last.ok === true) {
      await page.waitForTimeout(600)
      return last
    }
    await page.waitForTimeout(500)
  }
  return last
}

/** ai.gmCommand 执行 GM 命令（等价游戏内控制台），返回 { ok, message } */
export async function gm(page: Page, command: string, args?: string[]): Promise<GMResult> {
  return firstResult<GMResult>(await emitAI<GMResult>(page, 'ai.gmCommand', { command, args }), 'ai.gmCommand')
}

/** 深度平铺多根 HUD 树，便于断言与调试输出 */
export function flattenHUD(roots: HUDNode[]): HUDFlatEntry[] {
  const out: HUDFlatEntry[] = []
  const walk = (node: HUDNode): void => {
    out.push({ name: node.name, path: node.path, text: node.text, active: node.active })
    for (const child of node.children ?? []) walk(child)
  }
  for (const root of roots) walk(root)
  return out
}

/** 在多根 HUD 树中找所有满足条件的节点（含根自身） */
export function findHUDNodes(roots: HUDNode[], pred: (node: HUDNode) => boolean): HUDNode[] {
  const out: HUDNode[] = []
  const walk = (node: HUDNode): void => {
    if (pred(node)) out.push(node)
    for (const child of node.children ?? []) walk(child)
  }
  for (const root of roots) walk(root)
  return out
}
