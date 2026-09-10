/**
 * warm-current 地球特写 e2e（回归锁：地球不得回潮挂云层壳）
 *
 * 需求（2026-09-10 用户）：地球不需要云层 → 移除地球的云层壳组件。
 * 注意云层不在蓝图里（earth.blueprint.json 只有 Transform + SphereMesh），
 * 而是 EarthActor.setupCloseup() 在 BeginPlay 里 addComponent(CloudLayerComponent) 挂的，
 * 所以"移除"必须锁在运行时组件表上，断言口径 = 构造器名（与 ai.getSceneOutline 同源）。
 *
 * 不变量：
 *  1. 星图 EarthActor 运行时组件表：含 AtmosphereComponent / SphereMeshComponent，不含 CloudLayerComponent
 *  2. 场景大纲口径一致；其他天体（Sun/Moon）同样无云层壳（全仓已无 CloudLayerComponent 使用者）
 *  3. 行星观察分支（原「云层 opacity +0.1」增益所在路径）：地球仍无云层壳，
 *     大气增益 ×1.8 生效，退出观察复位回基准
 *
 * 前置：dev server 已在 :5173 运行（npm run dev）；跑法 npm run test:e2e:warm
 */
import type { Page } from '@playwright/test'
import { expect, test } from '../framework/fixtures'

test.use({ project: 'warm' })

/** 等暖流星图调试桥就绪（菜单场景没有它，必须先点 Btn_new 进星图） */
async function waitWarmMap(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const b = (window as unknown as { __warmCurrent?: { ready: () => boolean } }).__warmCurrent
      return !!b && b.ready()
    },
    undefined,
    { timeout: 60_000, polling: 500 },
  )
}

/** 地球 Actor 的运行时组件名表（构造器名口径） */
function readEarthComponents(page: Page): Promise<string[]> {
  return page.evaluate(`(() => {
    const earth = window.__warmCurrent.mode().starActors.get('earth')
    return earth.getAllComponents().map((c) => c.constructor.name)
  })()`) as Promise<string[]>
}

/** 天体大气壳的当前/基准强度（观察增益断言用；无大气壳返回 null） */
function readAtmo(page: Page, body: string): Promise<{ intensity: number, base: number } | null> {
  return page.evaluate(`(() => {
    const a = window.__warmCurrent.mode().starActors.get(${JSON.stringify(body)}).getAllComponents()
      .find((c) => c.constructor.name === 'AtmosphereComponent')
    return a ? { intensity: a.intensity, base: a.baseIntensity } : null
  })()`) as Promise<{ intensity: number, base: number } | null>
}

test.describe('warm-current 地球特写（云层壳已移除）', () => {
  test.beforeEach(async ({ game, page }) => {
    // 主菜单 → 星图（__warmCurrent 桥在 switchToMapScene 才挂载）
    const click = await game.clickActor({ name: 'Btn_new' })
    expect(click.ok, '点 Btn_new 应进星图（主菜单按钮）').toBe(true)
    await waitWarmMap(page)
    // 冻结仿真：防自然 defeat 弹全屏 Dim 拦截层（doc/testing/playwright_commands.md 坑 45）
    await page.evaluate(`(() => { window.__warmCurrent.mode().togglePause() })()`)
  })

  test('星图 EarthActor：保留大气壳与本体网格、无云层壳', async ({ page }) => {
    const comps = await readEarthComponents(page)
    expect(comps, '地球本体网格应在').toContain('SphereMeshComponent')
    expect(comps, '地球应保留大气壳').toContain('AtmosphereComponent')
    expect(comps, '地球不得挂云层壳（2026-09-10 用户要求移除）').not.toContain('CloudLayerComponent')
  })

  test('场景大纲：EarthActor 无云层壳；Sun/Moon 亦无（全仓无云层使用者）', async ({ game }) => {
    const outline = await game.outline({ maxDepth: 3, activeOnly: false })
    const earth = outline.find((n) => n.type === 'EarthActor')
    expect(earth, '星图应有 EarthActor').toBeTruthy()
    expect(earth!.components, '地球应保留大气壳').toContain('AtmosphereComponent')
    expect(earth!.components, '地球不得挂云层壳').not.toContain('CloudLayerComponent')
    for (const type of ['SunActor', 'MoonActor']) {
      const node = outline.find((n) => n.type === type)
      expect(node, `星图应有 ${type}`).toBeTruthy()
      expect(node!.components, `${type} 不应有云层壳`).not.toContain('CloudLayerComponent')
    }
  })

  test('行星观察：地球仍无云层壳，大气增益 ×1.8 生效、退出复位', async ({ page }) => {
    const before = await readAtmo(page, 'earth')
    expect(before, '地球大气壳应在').not.toBeNull()

    // 开局即地球系（viewMode=earth、planetFocusBody=earth），观察门禁成立
    const observed = await page.evaluate(`(() => {
      const m = window.__warmCurrent.mode()
      m.enterPlanetObserve('earth')
      return m.observeBody ?? null
    })()`) as string | null
    expect(observed, '进入行星观察后 observeBody 应为 earth').toBe('earth')

    const after = await readAtmo(page, 'earth')
    expect(after!.intensity, '观察增益：大气 ×1.8（上限 3）').toBeCloseTo(Math.min(3, before!.base * 1.8), 5)
    const comps = await readEarthComponents(page)
    expect(comps, '观察分支不再有云层壳可提亮').not.toContain('CloudLayerComponent')
    expect(comps, '大气壳仍在').toContain('AtmosphereComponent')

    // 退出收口：resetObserveBoost 复位回基准（原云层 opacity 复位已随组件删除）
    await page.evaluate(`(() => { window.__warmCurrent.mode().exitPlanetObserve() })()`)
    const back = await readAtmo(page, 'earth')
    expect(back!.intensity, '退出观察后大气强度复位回基准').toBeCloseTo(before!.base, 5)
  })
})
