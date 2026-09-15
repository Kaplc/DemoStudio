/**
 * warm-current 聚焦环绕改版 e2e（2026-09-15：行星系聚焦相机语义 + 月球双击聚焦）
 *
 * 需求：进入行星系后默认聚焦地球，相机运动 = 环绕（右键拖拽绕聚焦天体旋转）而非
 * 空间自由平移（右键平移被取代、边缘平移关闭）；双击月球 = 聚焦月球（环绕 + 逐帧
 * 跟随公转），再双击/Esc 退出回默认聚焦；观察中双击另一天体 = 切换聚焦。
 *
 * ⚠ 坑 46（doc/testing/playwright_commands.md）：warm 游戏 e2e 一个 spec 合并为一个 test，
 * 断言按节组织（beforeEach 二次启动链路会超时）。
 *
 * 不变量：
 *  1. 开局默认聚焦环绕：orbitMode=true / leftOrbitEnabled=false / edgePanEnabled=false，
 *     target 钉地球（舞台中心），注视距离 3200
 *  2. 双击月球聚焦：observeBody='moon'、双键环绕开启、target≈月球实时位置、特写距离
 *  3. 聚焦月球时逐帧跟随公转：仿真推进后 target 仍锁定月球（rig.pan 成对平移）
 *  4. 再双击月球 = 退出回默认聚焦（observeBody 归零、target 回地球、环绕语义回落）
 *  5. 观察中双击另一天体 = 切换聚焦（地球 ↔ 月球）；Esc = 退出
 *  6. 太阳系全景下双击月球被门禁拒绝（仅地月系可聚焦卫星）
 *  7. 聚焦态边缘平移关闭：鼠标贴视口边缘相机不动
 *
 * 前置：dev server 已在 :5173 运行（npm run dev）；跑法 npm run test:e2e:warm
 */
import { expect, test, type Page } from '@playwright/test'
import { mouseDrag, mouseMove, projectScreenPos } from '../framework/ai'

async function waitGameReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const b = (window as unknown as { __warmCurrent?: { ready: () => boolean } }).__warmCurrent
    return !!b && b.ready()
  }, { timeout: 60_000 })
}

async function bootToMap(page: Page): Promise<void> {
  await page.goto('/')
  const card = page.locator('div, button').filter({ hasText: /^WarmCurrent/ }).last()
  await card.click()
  await page.getByRole('button', { name: '打开工程' }).click()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('button', { name: '打开工程' })).toBeHidden({ timeout: 30_000 })
  await page.locator('button', { hasText: '▶' }).first().click()
  await page.waitForFunction(() => {
    const ai = (window as unknown as { __ai?: { emit: (e: string, p?: unknown) => unknown } }).__ai
    if (!ai) return false
    const r = ai.emit('ai.clickActor', { name: 'Btn_new' }) as { results?: Array<{ ok?: boolean, error?: string }> }
    const first = r?.results?.[0]
    return !!first?.ok || first?.error !== '游戏未运行'
  }, { timeout: 60_000, polling: 500 })
  await waitGameReady(page)
}

/** 相机/聚焦全量快照（桥 view() + rig.target + 月球 Actor 实时位置 + 注视距离） */
interface FocusProbe {
  viewMode: string
  observeBody: string | null
  orbitMode: boolean
  leftOrbitEnabled: boolean
  edgePanEnabled: boolean
  tx: number; tz: number
  cx: number; cy: number; cz: number
  distTarget: number
  moonX: number; moonZ: number
  /** 相机到月球球心的 3D 距离（含 y：月球球心 y = r×0.55） */
  distMoon: number
}

function probe(page: Page): Promise<FocusProbe> {
  return page.evaluate(`(() => {
    const b = window.__warmCurrent
    const v = b.view()
    const m = b.mode()
    const t = m.cameraActor.rig.target
    const c = m.cameraActor.camera.position
    const moon = m.starActors.get('moon').root.position
    return {
      viewMode: v.viewMode, observeBody: v.observeBody,
      orbitMode: v.orbitMode, leftOrbitEnabled: v.leftOrbitEnabled, edgePanEnabled: v.edgePanEnabled,
      tx: t.x, tz: t.z, cx: c.x, cy: c.y, cz: c.z,
      distTarget: Math.hypot(c.x - t.x, c.y - t.y, c.z - t.z),
      moonX: moon.x, moonZ: moon.z,
      distMoon: Math.hypot(c.x - moon.x, c.y - moon.y, c.z - moon.z),
    }
  })()`) as Promise<FocusProbe>
}

/** 等相机停稳（headless 拖拽步进定时器可能被节流到 1s/步，轮询至连续两次读数一致） */
async function waitCameraSettled(page: Page, deadlineMs = 14_000): Promise<FocusProbe> {
  const deadline = Date.now() + deadlineMs
  let cur = await probe(page)
  let stable = 0
  while (Date.now() < deadline && stable < 2) {
    await page.waitForTimeout(300)
    const next = await probe(page)
    stable = Math.abs(next.cx - cur.cx) < 1 && Math.abs(next.cz - cur.cz) < 1 ? stable + 1 : 0
    cur = next
  }
  return cur
}

test.describe('warm-current 聚焦环绕改版（默认聚焦环绕 + 月球双击聚焦）', () => {
  test('默认环绕语义 + 月球聚焦/跟随/退出/切换/门禁/边缘平移关（单 test 分节）', async ({ page }) => {
    test.setTimeout(240_000)
    await bootToMap(page)

    // ── 1. 开局默认聚焦环绕语义：orbitMode=true（右键环绕取代自由平移）、
    //      左键留地图交互、边缘平移关；target 钉地球（舞台中心）、注视距离 3200 ──
    const p0 = await probe(page)
    expect(p0.viewMode, '开局应为地球系视角').toBe('earth')
    expect(p0.observeBody, '开局不应处于观察态').toBeNull()
    expect(p0.orbitMode, '行星系聚焦默认环绕（右键拖拽绕地球）').toBe(true)
    expect(p0.leftOrbitEnabled, '聚焦默认左键留地图交互（不环绕）').toBe(false)
    expect(p0.edgePanEnabled, '聚焦默认关闭边缘平移（防拖走注视点）').toBe(false)
    expect(Math.hypot(p0.tx, p0.tz), 'target 应钉在舞台中心（地球钉扎点）').toBeLessThan(5)
    expect(Math.abs(p0.distTarget - 3200), '默认取景注视距离 3200（地月系全景）').toBeLessThan(5)

    // ── 2. 双击月球 = 聚焦月球：观察态 + 双键环绕 + target 贴月球实时位置 + 特写距离 ──
    await page.evaluate(`(() => { window.__warmCurrent.doubleClickPlanet('moon') })()`)
    const p1 = await probe(page)
    expect(p1.observeBody, '双击月球应进入卫星观察').toBe('moon')
    expect(p1.orbitMode, '卫星观察为环绕语义').toBe(true)
    expect(p1.leftOrbitEnabled, '观察态左键也环绕（星图点击已冻结）').toBe(true)
    expect(p1.edgePanEnabled, '观察态边缘平移关闭').toBe(false)
    expect(
      Math.hypot(p1.tx - p1.moonX, p1.tz - p1.moonZ),
      '聚焦月球后 target 应贴月球实时位置',
    ).toBeLessThan(5)
    // 特写距离 = r×4=88（缩放下限已动态贴合球心 r×1.15≈25，不再兜底）；相机到月球球心 3D 距离 = 88
    expect(p1.distMoon, '特写取景应贴月球（3D 球心距离）').toBeGreaterThan(70)
    expect(p1.distMoon).toBeLessThan(95)

    // ── 3. 聚焦月球时逐帧跟随公转：仿真 +20s（月球切向 ≈3.3px/s → 位移 ≈66px），target 跟上 ──
    await page.evaluate(`(() => {
      const m = window.__warmCurrent.mode()
      m.simState.state.time += 20
      window.__warmCurrent.stepTicks(1)
    })()`)
    const p2 = await probe(page)
    expect(
      Math.hypot(p2.moonX - p1.moonX, p2.moonZ - p1.moonZ),
      '仿真推进后月球应已公转漂移（前置有效性）',
    ).toBeGreaterThan(30)
    expect(
      Math.hypot(p2.tx - p2.moonX, p2.tz - p2.moonZ),
      '跟随公转：target 应继续锁定月球新位置',
    ).toBeLessThan(5)
    expect(
      Math.abs(p2.distMoon - p1.distMoon),
      '跟随为成对平移，注视距离保持',
    ).toBeLessThan(3)

    // ── 4. 观察态右键拖拽 = 绕月球环绕：相机位移、注视距离不变、target 仍锁定月球 ──
    await page.evaluate(`(() => { window.__warmCurrent.mode().closePlanetInfo() })()`)
    const moonScreen = await projectScreenPos(page, { actor: 'MoonActor' })
    expect(moonScreen.ok && moonScreen.inFront, '月球应可投影（特写取景在视口内）').toBe(true)
    const drag = await mouseDrag(page, {
      startX: moonScreen.screenX! + 120,
      startY: moonScreen.screenY!,
      endX: moonScreen.screenX! - 120,
      endY: moonScreen.screenY!,
      button: 2,
      steps: 8,
      stepDelayMs: 16,
    })
    expect(drag.ok, `右键环绕拖拽应 ok：${drag.error ?? ''}`).toBe(true)
    const p3 = await waitCameraSettled(page)
    expect(
      Math.hypot(p3.cx - p2.cx, p3.cz - p2.cz),
      '环绕拖拽应显著移动相机',
    ).toBeGreaterThan(60)
    expect(
      Math.abs(p3.distMoon - p2.distMoon),
      '环绕不改变与月球的注视距离',
    ).toBeLessThan(5)
    expect(
      Math.hypot(p3.tx - p3.moonX, p3.tz - p3.moonZ),
      '环绕 + 跟随复合：target 仍锁定月球',
    ).toBeLessThan(5)

    // ── 5. 再双击月球 = 退出回默认聚焦：observeBody 归零、target 回地球、语义回落 ──
    await page.evaluate(`(() => { window.__warmCurrent.doubleClickPlanet('moon') })()`)
    const p4 = await probe(page)
    expect(p4.observeBody, '再双击月球应退出观察').toBeNull()
    expect(p4.leftOrbitEnabled, '退出后左键回落地图交互').toBe(false)
    expect(p4.orbitMode, '退出后保持聚焦环绕（默认语义）').toBe(true)
    expect(Math.hypot(p4.tx, p4.tz), '退出后 target 回地球钉扎点').toBeLessThan(5)
    expect(Math.abs(p4.distTarget - 3200), '退出后复位默认取景距离').toBeLessThan(5)

    // ── 6. 观察中双击另一天体 = 切换聚焦（地球 → 月球） ──
    await page.evaluate(`(() => { window.__warmCurrent.doubleClickPlanet('earth') })()`)
    const p5 = await probe(page)
    expect(p5.observeBody, '双击地球应进入行星观察').toBe('earth')
    await page.evaluate(`(() => { window.__warmCurrent.doubleClickPlanet('moon') })()`)
    const p6 = await probe(page)
    expect(p6.observeBody, '观察地球时双击月球应切换聚焦到月球').toBe('moon')
    expect(
      Math.hypot(p6.tx - p6.moonX, p6.tz - p6.moonZ),
      '切换聚焦后 target 应贴月球',
    ).toBeLessThan(5)

    // ── 7. Esc = 退出观察回默认聚焦 ──
    const esc = await page.evaluate(`(() => {
      const r = window.__ai.emit('ai.keyPress', { key: 'Escape' })
      return r?.results?.[0] ?? {}
    })()`) as { ok?: boolean }
    expect(esc.ok, 'Esc 按键应被输入系统接收').toBe(true)
    const p7 = await probe(page)
    expect(p7.observeBody, 'Esc 应退出卫星观察').toBeNull()
    expect(Math.hypot(p7.tx, p7.tz), 'Esc 退出后 target 回地球').toBeLessThan(5)

    // ── 8. 太阳系全景下双击月球被门禁拒绝（卫星聚焦仅限母星系视角） ──
    await page.evaluate(`(() => {
      const m = window.__warmCurrent.mode()
      m.focusSolarSystem('sun')
      window.__warmCurrent.doubleClickPlanet('moon')
    })()`)
    const p8 = await probe(page)
    expect(p8.viewMode, '应处于太阳系全景（开发直调路径）').toBe('solar')
    expect(p8.observeBody, '非母星系视角双击卫星应被门禁拒绝').toBeNull()

    // ── 9. 回地球系：聚焦态边缘平移关闭（鼠标贴视口左缘相机不动） ──
    await page.evaluate(`(() => { window.__warmCurrent.mode().focusSolarSystem('earth') })()`)
    await page.waitForTimeout(300)
    const p9 = await probe(page)
    expect(p9.orbitMode, '回地球系恢复聚焦环绕语义').toBe(true)
    expect(p9.edgePanEnabled, '聚焦态边缘平移关闭').toBe(false)
    const rect = await page.evaluate(`(() => {
      const r = [...document.querySelectorAll('canvas')]
        .map((c) => c.getBoundingClientRect())
        .filter((r) => r.width > 100 && r.height > 100)
        .sort((a, c) => c.width * c.height - a.width * a.height)[0]
      return { left: r.left, top: r.top, width: r.width, height: r.height }
    })()`) as { left: number, top: number, width: number, height: number }
    // 鼠标移到视口左缘（边缘平移触发区内：x-rect.left=5 < 40px）并保持
    await mouseMove(page, { screenX: rect.left + 5, screenY: rect.top + rect.height / 2 })
    await page.waitForTimeout(1_200)
    const p10 = await probe(page)
    expect(
      Math.hypot(p10.cx - p9.cx, p10.cz - p9.cz),
      '聚焦态鼠标贴边不应移动相机（边缘平移已关闭）',
    ).toBeLessThan(2)
    expect(Math.hypot(p10.tx, p10.tz), '贴边后 target 不应被拖走').toBeLessThan(5)

    // ── 10. 滚轮聚焦吸附（光标悬空）：拉近滚动不切换聚焦，仅普通缩放 ──
    // 空点 = 画布上沿 22% 高度处（避开顶部 HUD 条与中央地球投影）；撞月球投影则右移。
    // ⚠ wheel 派发在真实 CDP 光标位（框架 mouseMove 是直驱 InputSys，不动真实光标），先 page.mouse.move 就位
    const projMoon0 = await projectScreenPos(page, { actor: 'MoonActor' })
    let emptyX = rect.left + rect.width * 0.5
    const emptyY = rect.top + rect.height * 0.22
    if (projMoon0.ok && Math.hypot(emptyX - projMoon0.screenX!, emptyY - projMoon0.screenY!) < 260) {
      emptyX = rect.left + rect.width * 0.78
    }
    await page.mouse.move(emptyX, emptyY)
    const pA = await probe(page)
    await page.mouse.wheel(0, -120)
    await page.waitForTimeout(200)
    const pB = await probe(page)
    expect(pB.observeBody, '光标悬空拉近不应切换聚焦').toBeNull()
    expect(
      pB.distTarget,
      '悬空拉近应发生普通缩放（注视距离缩短）',
    ).toBeLessThan(pA.distTarget)

    // ── 11. 滚轮聚焦吸附（光标悬月球）：拉近滚动 → 吸附聚焦月球（观察取景覆盖普通缩放） ──
    const projMoon1 = await projectScreenPos(page, { actor: 'MoonActor' })
    expect(projMoon1.ok && projMoon1.inFront, '月球应可投影（吸附前置）').toBe(true)
    await page.mouse.move(projMoon1.screenX!, projMoon1.screenY!)
    await page.mouse.wheel(0, -120)
    await page.waitForTimeout(200)
    const pC = await probe(page)
    expect(pC.observeBody, '光标悬月球拉近应吸附聚焦月球').toBe('moon')
    expect(
      Math.hypot(pC.tx - pC.moonX, pC.tz - pC.moonZ),
      '吸附后 target 应贴月球实时位置',
    ).toBeLessThan(5)
    // 吸附取景 = r×4 = 88（注视点 = 球心）；缩放下限同步贴合月球半径 22×1.15 ≈ 25.3
    expect(pC.distMoon, '吸附取景应贴月球（3D 球心距离）').toBeGreaterThan(70)
    expect(pC.distMoon).toBeLessThan(95)
    const minD = await page.evaluate(`(() => window.__warmCurrent.mode().cameraActor.rig.minDistance)()`)
    expect(minD, '吸附后缩放下限应贴合月球半径').toBeGreaterThan(20)
    expect(minD).toBeLessThan(31)

    // ── 12. 已聚焦天体再滚：继续贴近（命中自身不重吸附回 r×4 取景） ──
    await page.mouse.wheel(0, -120)
    await page.waitForTimeout(200)
    const pD = await probe(page)
    expect(pD.observeBody, '再滚应保持月球聚焦').toBe('moon')
    expect(
      pD.distMoon,
      '再滚应继续贴近月球（不重吸附回默认特写距离）',
    ).toBeLessThan(pC.distMoon)
  })
})
