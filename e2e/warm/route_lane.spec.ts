/**
 * warm-current 运输连线样式 e2e（playwright.e2e.config.ts / testDir ./e2e）
 *
 * 前置：dev server 已在 :5173 运行（npm run electron:dev 或 vite）
 *
 * ★ TDD 已完成：运输连线已改造为「每条航线共用一条运输线」（多船同线，
 *   不再按船数画平行线）。本文件断言即新口径，防回退。
 *
 * 观察面：StarMapRenderComponent 私有的 routeQuads（航线 quad）与 shipPool（飞船）。
 * 通过 mode.starMap 反射读取（每 route 恒 1 个 quad key；飞船到航线中轴线垂距 ≈0）。
 */
import { expect, test, type Page } from '@playwright/test'

/** 等待游戏桥接就绪（window.__warmCurrent.ready()） */
async function waitGameReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const b = (window as unknown as { __warmCurrent?: { ready: () => boolean } }).__warmCurrent
    return !!b && b.ready()
  }, { timeout: 60_000 })
}

async function evalInGame<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(() => { const __f = ${fn}; return __f() })()`) as Promise<T>
}

/** 读取渲染组件内部航线/飞船观测数据 */
async function probeRender(page: Page): Promise<{
  routeCount: number
  quadKeys: string[]
  maxLanePerRoute: number
  shipCount: number
  maxRouteOffset: number
}> {
  return evalInGame<{
    routeCount: number
    quadKeys: string[]
    maxLanePerRoute: number
    shipCount: number
    maxRouteOffset: number
  }>(page, `() => {
    const mode = window.__warmCurrent.mode()
    const sm = mode.starMap
    const state = mode.simState.state
    const quadKeys = []
    for (const k of sm.routeQuads.keys()) quadKeys.push(k)
    // 每条航线最多几个 lane（key 形如 'routeId:laneIndex'）
    const byRoute = new Map()
    for (const k of quadKeys) {
      const [rid] = k.split(':')
      byRoute.set(rid, (byRoute.get(rid) || 0) + 1)
    }
    let maxLanePerRoute = 0
    for (const v of byRoute.values()) maxLanePerRoute = Math.max(maxLanePerRoute, v)
    // 航线中轴线 = 首条航线两端天体（月球→地球）世界坐标连线
    // 注意：星球 mesh.position 是相对 Actor root 的局部坐标，须读 matrixWorld 平移分量
    const wm = (m) => { const e = m.matrixWorld.elements; return { x: e[12], y: e[13], z: e[14] } }
    const moonP = wm(sm.starViews.moon.body)
    const earthP = wm(sm.starViews.earth.body)
    const dx = earthP.x - moonP.x, dz = earthP.z - moonP.z
    const len = Math.hypot(dx, dz) || 1
    // 可见飞船到中轴线的最大垂距（平行线样式 >0；共用单线应 ≈0）
    let maxRouteOffset = 0
    let shipCount = 0
    for (const s of sm.shipPool) {
      if (!s.mesh.visible) continue
      shipCount++
      const d = Math.abs((s.mesh.position.x - moonP.x) * dz - (s.mesh.position.z - moonP.z) * dx) / len
      maxRouteOffset = Math.max(maxRouteOffset, d)
    }
    return {
      routeCount: state.routes.length,
      quadKeys,
      maxLanePerRoute,
      shipCount,
      maxRouteOffset,
    }
  }`)
}

test.describe('warm-current 运输连线：单线多船（共用一条运输线）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    const card = page.locator('div, button').filter({ hasText: /^WarmCurrent/ }).last()
    await card.click()
    await page.getByRole('button', { name: '打开工程' }).click()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('button', { name: '打开工程' })).toBeHidden({ timeout: 30_000 })
    await page.locator('button', { hasText: '▶' }).first().click()
    // 场景路由事实（同 warm_save_menu）：启动默认进主菜单场景（无 __warmCurrent 桥），
    // 等 running 后点「Btn_new 新的远征」切星图，桥才挂载就绪。
    await page.waitForFunction(() => {
      const ai = (window as unknown as { __ai?: { emit(e: string, p?: unknown): { results?: Array<{ running?: boolean }> } } }).__ai
      if (!ai) return false
      return ai.emit('ai.getState', {}).results?.[0]?.running === true
    }, { timeout: 60_000 })
    await page.waitForFunction(() => {
      const ai = (window as unknown as { __ai?: { emit(e: string, p?: unknown): { results?: Array<{ ok?: boolean }> } } }).__ai
      if (!ai) return false
      // 面板未挂载时 ok=false 轮询重试；成功即停，不重复触发
      return ai.emit('ai.clickActor', { name: 'Btn_new' }).results?.[0]?.ok === true
    }, { timeout: 30_000 })
    await waitGameReady(page)
  })

  test('一条航线挂 3 艘船 → 共用 1 条运输线（多船同线，无平行线）', async ({ page }) => {
    const res = await evalInGame<{ ok: boolean; ships: number; routes: number }>(page, `() => {
      const b = window.__warmCurrent
      b.createRoute('moon', 'earth')
      const r = b.routes()[0]
      if (!r) return { ok: false, ships: 0, routes: 0 }
      b.addShip(r.id)
      b.addShip(r.id)
      b.stepTicks(2)
      return { ok: true, ships: b.routes()[0].ships, routes: b.routes().length }
    }`)
    expect(res.ok).toBe(true)
    expect(res.routes).toBe(1)
    expect(res.ships).toBe(3)

    const probe = await probeRender(page)

    // ── 新口径断言（改造后：每条航线一条运输线，多船同线行进）──
    expect(probe.maxLanePerRoute, '3 艘船 → 仍只有 1 条运输线 quad').toBe(1)
    expect(probe.maxRouteOffset, '飞船全部沿航线中轴线行进（无横向偏移）').toBeLessThan(0.5)
    // 无论单线还是多线，可见飞船数都应与航线船数一致（剔除 frozen）
    expect(probe.shipCount, '可见飞船数应与航线在航船数一致').toBe(3)
  })

  test('单船航线仅一条 quad（单船场景无平行线，口径不变）', async ({ page }) => {
    const res = await evalInGame<{ ok: boolean; ships: number }>(page, `() => {
      const b = window.__warmCurrent
      b.createRoute('moon', 'earth')
      const r = b.routes()[0]
      if (!r) return { ok: false, ships: 0 }
      b.stepTicks(2)
      return { ok: true, ships: b.routes()[0].ships }
    }`)
    expect(res.ok).toBe(true)
    expect(res.ships).toBe(1)

    const probe = await probeRender(page)
    expect(probe.maxLanePerRoute, '1 艘船 → 1 条 quad（改造前后都应保持）').toBe(1)
    expect(probe.shipCount).toBe(1)
  })
})
