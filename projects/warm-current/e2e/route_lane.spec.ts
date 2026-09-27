/**
 * warm-current 运输连线样式 e2e（playwright.e2e.config.ts / testDir ./e2e）
 *
 * 前置：dev server 已在 :5173 运行（npm run electron:dev 或 vite）
 *
 * ★ 2026-09-29 轨道蓝图台改版口径：航线渲染从直弦升级为「转移轨道弧」ribbon
 *   （绕公共主天体弯曲的二次贝塞尔，helpers.transferArcPoint 单一口径）；
 *   飞船渲染位同步沿弧取点（仿真计时/油耗口径不变，纯视觉）。本文件断言即新口径：
 *   每航线 1 条 ribbon；在航船到弧线垂距 ≈0、到直弦垂距 > 0（弧线可见弯曲）。
 *
 * 观察面：StarMapRenderComponent 私有的 routeQuads（航线 ribbon）与 shipPool（飞船）。
 * 通过 mode.starMap 反射读取；弧采样走调试桥 routeArcSample（权威 helpers 口径）。
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

/** 读取渲染组件内部航线/飞船观测数据（弧线口径） */
async function probeRender(page: Page, routeId: number): Promise<{
  routeCount: number
  quadKeys: string[]
  maxLanePerRoute: number
  shipCount: number
  /** 在航船到转移弧采样折线的最大垂距（map px；沿弧应 ≈0） */
  maxArcOffset: number
  /** 弧中点比弦中点远离主天体的量（map px；= 0.5×BEND×弦长，相位无关不变量） */
  arcMidPrimaryGain: number
}> {
  return evalInGame(page, `() => {
    const b = window.__warmCurrent
    const mode = b.mode()
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
    // 坐标系换算（2026-09-19 实测坑：星球 mesh 是世界坐标、船挂 systemGroup 是舞台局部坐标，
    // 混读会凭空产出假偏轴——统一换算到星图画布系再比较）：
    //   船局部 = (mapX − 960, y, mapY − 540)；星球世界 → 画布 = world − stage + (960, 540)
    // 转移弧采样折线（调试桥 = helpers.transferArcPoint 权威口径）
    const arc = []
    for (let i = 0; i <= 64; i++) {
      const p = b.routeArcSample(${routeId}, i / 64)
      if (p) arc.push(p)
    }
    // 弦端点（弧 t=0/1）
    const a0 = arc[0]
    const a1 = arc[arc.length - 1]
    const dx = a1.x - a0.x, dy = a1.y - a0.y
    const chordLen = Math.hypot(dx, dy) || 1
    const segDist = (px, py, ax, ay, bx, by) => {
      const abx = bx - ax, aby = by - ay
      const l2 = abx * abx + aby * aby
      let t = l2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / l2 : 0
      t = Math.max(0, Math.min(1, t))
      return Math.hypot(px - (ax + abx * t), py - (ay + aby * t))
    }
    // 弧中点远离主天体量（确定性不变量）：offset 背向主天体 →
    // |arcMid − primary| − |chordMid − primary| = 0.5 × BEND × 弦长，与相位角无关
    // （初相位月球恰在地球径向上时弧与弦共线，垂直分量恒 0，勿用垂距断言）
    const mid = arc[Math.floor(arc.length / 2)]
    const primary = b.bodyPos('earth') // 月→地线公共主天体 = 地球
    const arcMidPrimaryGain = Math.hypot(mid.x - primary.x, mid.y - primary.y)
      - Math.hypot(((a0.x + a1.x) / 2) - primary.x, ((a0.y + a1.y) / 2) - primary.y)
    let maxArcOffset = 0
    let shipCount = 0
    for (const s of sm.shipPool) {
      if (!s.mesh.visible) continue
      shipCount++
      const mx = s.mesh.position.x + 960
      const my = s.mesh.position.z + 540
      // 到弧采样折线的最小垂距
      let best = Infinity
      for (let i = 0; i < arc.length - 1; i++) {
        best = Math.min(best, segDist(mx, my, arc[i].x, arc[i].y, arc[i + 1].x, arc[i + 1].y))
      }
      maxArcOffset = Math.max(maxArcOffset, best)
    }
    return {
      routeCount: state.routes.length,
      quadKeys,
      maxLanePerRoute,
      shipCount,
      maxArcOffset,
      arcMidPrimaryGain,
    }
  }`)
}

test.describe('warm-current 运输连线：转移轨道弧（单线多船沿弧行进）', () => {
  let routeId = 0
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
    routeId = 0
  })

  test('一条航线挂 3 艘船 → 共用 1 条转移轨道弧（多船同弧，弧线绕主天体弯曲）', async ({ page }) => {
    const res = await evalInGame<{ ok: boolean; ships: number; routes: number; flying: number; routeId: number }>(page, `() => new Promise((resolve) => {
      const b = window.__warmCurrent
      b.createRoute('moon', 'earth')
      const r = b.routes()[0]
      if (!r) { resolve({ ok: false, ships: 0, routes: 0, flying: 0, routeId: 0 }); return }
      b.addShip(r.id)
      b.addShip(r.id)
      // 2026-09 起新船入列先在月球装货（120 tick 起飞）。月球线 leg 仅 6s（dist=1.0），
      // 锁步三船的弧上位置对 tick 数超敏感（可能恰好落在端点贴弦）——
      // 推进到全员起飞后，用 setShipFlying(0.5) 把一艘钉在弧中段（弯垂距最大处）取证。
      b.stepTicks(200)
      const flying = b.mode().simState.state.ships.filter((s) => s.state === 'flying').length
      b.setShipFlying(0.5)
      // render（syncShips）由 rAF 驱动、manualTick 不带渲染：等两帧让在航船摆上转移弧
      requestAnimationFrame(() => requestAnimationFrame(() => {
        resolve({ ok: true, ships: b.routes()[0].ships, routes: b.routes().length, flying, routeId: r.id })
      }))
    })`)
    expect(res.ok).toBe(true)
    expect(res.routes).toBe(1)
    expect(res.ships).toBe(3)
    expect(res.flying, '推进装货时长后三船应全部起飞（在航）').toBe(3)

    const probe = await probeRender(page, res.routeId)

    // ── 转移轨道弧口径（2026-09-29 改版：每航线 1 条 ribbon，船沿弧行进）──
    expect(probe.maxLanePerRoute, '3 艘船 → 仍只有 1 条转移弧 ribbon').toBe(1)
    expect(probe.maxArcOffset, '飞船（含钉在弧中段的取样船）沿转移弧行进（到弧垂距 ≈0）').toBeLessThan(6)
    expect(probe.arcMidPrimaryGain, '弧中点比弦中点远离主天体（0.5×BEND×弦长 ≈ 144，相位无关）').toBeGreaterThan(60)
    // 无论单线还是多线，可见飞船数都应与航线船数一致（剔除 frozen）
    expect(probe.shipCount, '可见飞船数应与航线在航船数一致').toBe(3)
  })

  test('单船航线仅一条 ribbon（单船场景沿弧口径不变）', async ({ page }) => {
    const res = await evalInGame<{ ok: boolean; ships: number; routeId: number }>(page, `() => {
      const b = window.__warmCurrent
      b.createRoute('moon', 'earth')
      const r = b.routes()[0]
      if (!r) return { ok: false, ships: 0, routeId: 0 }
      b.stepTicks(2)
      return { ok: true, ships: b.routes()[0].ships, routeId: r.id }
    }`)
    expect(res.ok).toBe(true)
    expect(res.ships).toBe(1)

    const probe = await probeRender(page, res.routeId)
    expect(probe.maxLanePerRoute, '1 艘船 → 1 条 ribbon（改造前后都应保持）').toBe(1)
  })
})
