/**
 * warm-current 地球特写 e2e（回归锁：大气/云层均资产声明、恰好一层）
 *
 * 需求沿革：
 * - 2026-09-10 用户要求地球无云 → 移除运行时挂载的云层壳（当时无真云图资产，
 *   程序化兜底读作灰斑）。
 * - 2026-09-10 用户决策（资产挂组件）：大气辉光壳改为 earth.blueprint.json 显式
 *   声明 AtmosphereComponent，setupCloseup 不再运行时挂载——防蓝图保存全量写回
 *   撞运行时挂载造成双实例叠光。
 * - 2026-09-12 群星观感改版：用户重新要求动态云层（拿到 NASA 系真云图
 *   earth_clouds.png），CloudLayerComponent 改回蓝图声明（受光 Lambert + alphaMap
 *   + 错速自转），与大气同走"资产挂组件"约定。
 *
 * 不变量：
 *  1. 星图 EarthActor 运行时组件表：SphereMeshComponent ×1、AtmosphereComponent ×1、
 *     CloudLayerComponent ×1（全部来自蓝图声明，运行时不得重复挂载叠实例）
 *  2. 场景大纲口径一致；其他天体（Sun/Moon）无大气/云层
 *  3. 行星观察分支：大气增益 ×1.8 生效、退出复位；观察进出不增减云层实例
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

test.describe('warm-current 地球特写（大气/云层资产声明）', () => {
  test.beforeEach(async ({ game, page }) => {
    // 主菜单 → 星图（__warmCurrent 桥在 switchToMapScene 才挂载）
    const click = await game.clickActor({ name: 'Btn_new' })
    expect(click.ok, '点 Btn_new 应进星图（主菜单按钮）').toBe(true)
    await waitWarmMap(page)
    // 冻结仿真：防自然 defeat 弹全屏 Dim 拦截层（doc/testing/playwright_commands.md 坑 45）
    await page.evaluate(`(() => { window.__warmCurrent.mode().togglePause() })()`)
  })

  test('星图 EarthActor：本体网格 + 大气×1 + 云层×2（全部蓝图声明）', async ({ page }) => {
    const comps = await readEarthComponents(page)
    expect(comps, '地球本体网格应在').toContain('SphereMeshComponent')
    expect(
      comps.filter((c) => c === 'AtmosphereComponent').length,
      '大气壳应恰好一个（蓝图资产声明，运行时不得重复挂载叠出双层辉光）',
    ).toBe(1)
    expect(
      comps.filter((c) => c === 'CloudLayerComponent').length,
      '云层应恰好两层（2026-09-12 双层体积感：低层浓 + 高层疏，均蓝图声明）',
    ).toBe(2)
  })

  test('场景大纲：EarthActor 有大气/云层；Sun/Moon 亦无（其他天体不声明）', async ({ game }) => {
    const outline = await game.outline({ maxDepth: 3, activeOnly: false })
    const earth = outline.find((n) => n.type === 'EarthActor')
    expect(earth, '星图应有 EarthActor').toBeTruthy()
    expect(earth!.components, '地球应保留大气壳').toContain('AtmosphereComponent')
    expect(earth!.components, '地球应保留受光云层壳').toContain('CloudLayerComponent')
    for (const type of ['SunActor', 'MoonActor']) {
      const node = outline.find((n) => n.type === type)
      expect(node, `星图应有 ${type}`).toBeTruthy()
      expect(node!.components, `${type} 不应有云层壳`).not.toContain('CloudLayerComponent')
      expect(node!.components, `${type} 不应有大气壳`).not.toContain('AtmosphereComponent')
    }
  })

  test('行星观察：大气增益 ×1.8 生效、退出复位；云层实例数不变', async ({ page }) => {
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
    const compsDuring = await readEarthComponents(page)
    expect(
      compsDuring.filter((c) => c === 'CloudLayerComponent').length,
      '观察中云层仍恰好两层（观察分支不重复挂载）',
    ).toBe(2)
    expect(compsDuring, '大气壳仍在').toContain('AtmosphereComponent')

    // 退出收口：resetObserveBoost 复位回基准
    await page.evaluate(`(() => { window.__warmCurrent.mode().exitPlanetObserve() })()`)
    const back = await readAtmo(page, 'earth')
    expect(back!.intensity, '退出观察后大气强度复位回基准').toBeCloseTo(before!.base, 5)
    const compsBack = await readEarthComponents(page)
    expect(
      compsBack.filter((c) => c === 'CloudLayerComponent').length,
      '退出观察后云层仍恰好两层',
    ).toBe(2)
  })
})
