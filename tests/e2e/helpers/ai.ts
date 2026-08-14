/**
 * window.__ai 事件桥封装 — AI 端到端测试的统一交互/断言入口
 *
 * 背景（见 doc/playwright_testing.md）：
 * 编辑器初始化时注册 window.__ai（EditorInitializer.registerEditorAIHandlers），
 * AI 可触发游戏/编辑器事件（clickActor/getActor/spawnActor/switchScene 等），
 * 全部按节点 name 驱动，不依赖屏幕坐标与渲染循环 —— 页面 hidden 也能跑。
 *
 * 注意：ai.getActor 返回的 actor.name 是类名（如 "Actor"/"GenericActor"），
 * 不是资产节点名；断言节点存在/状态请用本模块的 waitForActor/getActorState。
 */
import type { Page } from '@playwright/test'

export interface AIEmitResult {
  event: string
  handled: boolean
  results?: Array<Record<string, unknown>>
}

export interface ActorInfo {
  name: string
  type: string
  position?: { x: number; y: number; z: number }
  active?: boolean
  children?: unknown[]
  components?: unknown[]
}

/** 触发任意 AI 事件；window.__ai 未注册时给出明确报错 */
export async function emit(
  page: Page,
  event: string,
  payload: Record<string, unknown> = {},
): Promise<AIEmitResult> {
  return page.evaluate(
    async ([e, p]) => {
      const bridge = (window as unknown as { __ai?: { emit?: (ev: string, pl: unknown) => Promise<unknown> } }).__ai
      if (!bridge?.emit) {
        throw new Error('window.__ai 不可用：编辑器 AI 桥未注册（页面未加载完成或编辑器未初始化）')
      }
      return bridge.emit(e, p) as Promise<AIEmitResult>
    },
    [event, payload] as const,
  )
}

/** 按 UI 节点 root.name 递归查找并触发点击（无需屏幕坐标） */
export function clickActor(page: Page, name: string): Promise<AIEmitResult> {
  return emit(page, 'ai.clickActor', { name })
}

/** 按 name 查询 Actor（结果 actor.name 为类名，勿用于断言节点名） */
export async function getActor(page: Page, name: string): Promise<ActorInfo | null> {
  const r = await emit(page, 'ai.getActor', { name })
  const actor = r.results?.[0]?.actor as ActorInfo | undefined
  return actor ?? null
}

/** 查询 Actor 的 active 状态；节点不存在返回 null */
export async function actorActive(page: Page, name: string): Promise<boolean | null> {
  const a = await getActor(page, name)
  return a?.active ?? null
}

/** 枚举当前可用 AI 事件名列表 */
export async function listEvents(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bridge = (window as unknown as { __ai?: { listEvents?: () => string[] } }).__ai
    return bridge?.listEvents?.() ?? []
  })
}

/** 当前游戏阶段（window.__ai 事件桥是否就绪可作为"已启动"信号） */
export async function isBridgeReady(page: Page): Promise<boolean> {
  return (await listEvents(page)).includes('clickActor')
}
