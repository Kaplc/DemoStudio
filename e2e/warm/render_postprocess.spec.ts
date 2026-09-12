/**
 * warm-current 渲染管线 e2e（2026-09-12 群星观感改版回归锁）
 *
 * 背景：用户拿《群星》截图对标——差距在「光照纪律 + 后处理 + 层次」。
 * 本次落地：引擎 SceneRendererComponent 增加 opt-in EffectComposer 管线
 * （RenderPass → UnrealBloomPass → OutputPass，HalfFloat + 4x MSAA），
 * warm 星图 BeginPlay 开启 bloom + ACES；光照改版（ambient 0.85→0.22、
 * 太阳点光 decay=0 全场承担主光 → 行星有向阳/背阳面）。
 *
 * 不变量（防回潮）：
 *  1. 星图场景后处理开启：bloom 三参数就位、色调映射 = ACESFilmic(4)
 *  2. 光照纪律：环境光 ≤0.35（旧值 0.85 会把暗面抬平，行星读作贴纸）
 *  3. 太阳系全景截图落盘（观感基准图，人工比对 + 后续视觉断言素材）
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

/** 读渲染管线快照（串内纯 JS；断言放串外——坑：模板串里写 TS 会 SyntaxError） */
function readRenderInfo(page: Page): Promise<{
  postProcess: { enabled: boolean; toneMapping: number; bloom: { strength: number; radius: number; threshold: number } | null }
  ambientIntensity: number
} | null> {
  return page.evaluate(`(() => window.__warmCurrent.renderInfo())()`) as ReturnType<typeof readRenderInfo>
}

test.describe('warm-current 后处理渲染管线', () => {
  test.beforeEach(async ({ game, page }) => {
    // 主菜单 → 星图（__warmCurrent 桥在 switchToMapScene 才挂载）
    const click = await game.clickActor({ name: 'Btn_new' })
    expect(click.ok, '点 Btn_new 应进星图（主菜单按钮）').toBe(true)
    await waitWarmMap(page)
  })

  test('星图后处理开启：bloom 就位 + ACES 色调映射', async ({ page }) => {
    const info = await readRenderInfo(page)
    expect(info, 'renderInfo 应可用（World.gameRenderer 已建）').not.toBeNull()
    expect(info!.postProcess.enabled, '星图应开启后处理管线').toBe(true)
    // THREE.ACESFilmicToneMapping === 4（r170 枚举序：No=0/Linear=1/Reinhard=2/Cineon=3/ACESFilmic=4）
    expect(info!.postProcess.toneMapping, '色调映射应为 ACESFilmic(4)').toBe(4)
    expect(info!.postProcess.bloom, 'bloom 参数应在').not.toBeNull()
    expect(info!.postProcess.bloom!.strength, 'bloom 强度应为正').toBeGreaterThan(0)
    expect(info!.postProcess.bloom!.threshold, 'bloom 阈值应低于 1（亮部参与泛光）').toBeLessThan(1)
  })

  test('光照纪律：环境光低位、主光由太阳承担（防 0.85 旧值回潮）', async ({ page }) => {
    const info = await readRenderInfo(page)
    expect(
      info!.ambientIntensity,
      '环境光应 ≤0.35（旧值 0.85 抬平暗面，行星读作贴纸）',
    ).toBeLessThanOrEqual(0.35)
    expect(info!.ambientIntensity, '环境光应 >0（暗面保留可读性）').toBeGreaterThan(0)
  })

  test('太阳系全景截图（观感基准图落盘）', async ({ page }) => {
    // 切太阳系全景（开局默认地球系；solar 全景口径 = focus('sun')），等视角切换收口再截
    await page.evaluate(`(() => { window.__warmCurrent.mode().focusSolarSystem('sun') })()`)
    await page.waitForFunction(
      () => {
        const b = (window as unknown as { __warmCurrent?: { view: () => { viewSwitching: boolean } | null } }).__warmCurrent
        const v = b ? b.view() : null
        return !!v && !v.viewSwitching
      },
      undefined,
      { timeout: 30_000, polling: 500 },
    )
    await page.screenshot({ path: 'test-results/warm-render-solar.png', fullPage: false })
  })

  test('地球特写截图（云层/海洋高光观感基准图落盘）', async ({ page }) => {
    await page.evaluate(`(() => { window.__warmCurrent.mode().enterPlanetObserve('earth') })()`)
    await page.waitForTimeout(1500)
    await page.screenshot({ path: 'test-results/warm-render-earth.png', fullPage: false })
    await page.evaluate(`(() => { window.__warmCurrent.mode().exitPlanetObserve() })()`)
  })

  test('云层独立运动：stepTicks 推进后云壳自转 + alphaMap 漂移（防 Tick 死代码回潮）', async ({ page }) => {
    // 坑：Actor 默认 _bTickEnabled=false，不开 Tick 云层组件 Tick 永不执行（云静止的根因）；
    // StarActor 构造已 enableTick。此断言锁"云确实在动"：自转增量 + 漂移增量均 > 0。
    const read = `(() => {
      const earth = window.__warmCurrent.mode().starActors.get('earth')
      const clouds = earth.getAllComponents().filter((c) => c.constructor.name === 'CloudLayerComponent')
      return clouds.map((c) => ({
        ry: c.obj.object.rotation.y,
        ox: c.obj.object.material.alphaMap ? c.obj.object.material.alphaMap.offset.x : -1,
      }))
    })()`
    const before = await page.evaluate(read) as Array<{ ry: number; ox: number }>
    expect(before.length, '地球应挂两层云').toBe(2)
    await page.evaluate(`(() => { window.__warmCurrent.stepTicks(60) })()`) // 推进 1s 仿真
    const after = await page.evaluate(read) as Array<{ ry: number; ox: number }>
    expect(after[0].ry, '低层云壳应自转（spin 0.35 rad/s）').toBeGreaterThan(before[0].ry)
    expect(after[1].ry, '高层云壳应自转且快于低层（spin 0.55）').toBeGreaterThan(after[0].ry)
    expect(after[0].ox, '低层云 alphaMap 应经向漂移（uvDrift 0.004）').toBeGreaterThan(before[0].ox)
  })
})
