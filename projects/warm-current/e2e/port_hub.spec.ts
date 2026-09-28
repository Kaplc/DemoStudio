/**
 * warm-current 枢纽补给 + 地球港泊位 e2e（playwright.e2e.config.ts / testDir ./e2e）
 *
 * 前置：dev server 已在 :5173 运行（E2E_BASE_URL 可指路自起实例）
 *
 * 锁定口径（doc/game/枢纽补给与港口泊位方案-V1.md）：
 *  ① 借站补给：forward 星→地线途经中转站（relay，带内 300px）→ 往返油耗 ×0.8，
 *     首航 hint 一次；月球线基准油耗 40（2×dist1.0×20×fuelMult1）→ 折后 32。
 *  ② 地球港泊位：满泊排队（waitPort）/ 让泊 FIFO 放行 / N 船 ≠ N 倍收益（ledger 按实际卸货计）。
 *  ③ 满泊时 relay_in 卸在建筑端点：不排地球队，直接入站缓存。
 *
 * 断言面：window.__warmCurrent 调试桥（mode/stepTicks/bodyPos）——状态权威值，不走渲染探针。
 */
import { expect, test, type Page } from '@playwright/test'

/**
 * 游戏引导链（同 route_lane.spec）：选工程卡 → 打开工程 → ▶ Launch → 主菜单 →
 * Btn_new 切星图 → 调试桥就绪。场景路由事实：启动默认进主菜单场景（无 __warmCurrent 桥），
 * 等 running 后点「Btn_new」切星图，桥才挂载就绪。
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  const card = page.locator('div, button').filter({ hasText: /^WarmCurrent/ }).last()
  await card.click()
  await page.getByRole('button', { name: '打开工程' }).click()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('button', { name: '打开工程' })).toBeHidden({ timeout: 30_000 })
  await page.locator('button', { hasText: '▶' }).first().click()
  await page.waitForFunction(() => {
    const ai = (window as unknown as { __ai?: { emit(e: string, p?: unknown): { results?: Array<{ running?: boolean }> } } }).__ai
    if (!ai) return false
    return ai.emit('ai.getState', {}).results?.[0]?.running === true
  }, { timeout: 60_000 })
  await page.waitForFunction(() => {
    const ai = (window as unknown as { __ai?: { emit(e: string, p?: unknown): { results?: Array<{ ok?: boolean }> } } }).__ai
    if (!ai) return false
    return ai.emit('ai.clickActor', { name: 'Btn_new' }).results?.[0]?.ok === true
  }, { timeout: 30_000 })
  // 切星图后调试桥才挂载：等 __warmCurrent.ready()
  await page.waitForFunction(() => {
    const b = (window as unknown as { __warmCurrent?: { ready: () => boolean } }).__warmCurrent
    return !!b && b.ready()
  }, { timeout: 60_000 })
})

async function evalInGame<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(() => { const __f = ${fn}; return __f() })()`) as Promise<T>
}

/**
 * 收集页面 console（Logger 落 console 通道）。提示/事件断言一律走这里：
 * EventFeedbackComponent.drain() 每帧清空 simState.events，事后读 events 必为空。
 */
function captureConsole(page: Page): string[] {
  const lines: string[] = []
  page.on('console', (msg) => lines.push(msg.text()))
  return lines
}

/** 构造一枚最小 SimShip（字段面 = makeShip；e2e 无模块导入，直接按形状给全） */
const MK_SHIP_FN = `(id, name, patch) => Object.assign({
  id, name, state: 'idle', routeId: null, leg: 'outbound', progress: 0, legTime: 1,
  timer: 0, cargo: 0, materials: 0, roundFuel: 0, speedMult: 1,
  recalling: false, resumeDelay: 0, mission: false, hull: 'standard', modules: [],
}, patch || {})`

test('借站补给：途经中转站的 forward 线油耗 ×0.8，首航日志一次', async ({ page }) => {
  const logs = captureConsole(page)
  const out = await evalInGame<{ ok: boolean; fuel: number; legTime: number }>(page, `() => {
    const b = window.__warmCurrent
    const mode = b.mode()
    const s = mode.simState.state
    s.starStock.moon = 800
    // 中转站落在 月球→地球 线段中点（画布系权威值；站带内 300px ≫ 天体漂移量）
    const moon = b.bodyPos('moon')
    const earth = b.bodyPos('earth')
    s.buildings.push({ id: 1, type: 'relay', x: (moon.x + earth.x) / 2, y: (moon.y + earth.y) / 2, stock: 0, invested: 0 })
    const ok = mode.transport.tryCreateRoute({ kind: 'star', star: 'moon' }, { kind: 'earth' })
    b.stepTicks(150) // 2.5s > 装货 2s → 出发并锁定本次往返油耗
    const ship = s.ships[0]
    return { ok, fuel: ship.roundFuel, legTime: ship.legTime }
  }`)
  expect(out.ok).toBe(true)
  // 平衡默认：月球线往返油耗 = 2×dist1.0×基础20×fuelMult1 = 40 → 借站 ×0.8 = 32
  expect(out.fuel).toBe(32)
  // 折扣沿日志（提示沿沿游戏内 events 走，每帧被 drain 清空，console 是可回读面）
  const joined = logs.join('\n')
  expect(joined).toContain('借站补给接力')
})

test('无站无线不折扣：月球线基准油耗 40（对照组）', async ({ page }) => {
  const logs = captureConsole(page)
  const out = await evalInGame<{ ok: boolean; fuel: number }>(page, `() => {
    const b = window.__warmCurrent
    const mode = b.mode()
    const s = mode.simState.state
    s.starStock.moon = 800
    const ok = mode.transport.tryCreateRoute({ kind: 'star', star: 'moon' }, { kind: 'earth' })
    b.stepTicks(150)
    const ship = s.ships[0]
    return { ok, fuel: ship.roundFuel }
  }`)
  expect(out.ok).toBe(true)
  expect(out.fuel).toBe(40)
  expect(logs.join('\n')).not.toContain('借站补给接力')
})

test('地球港泊位：满泊排队 / 让泊 FIFO 放行 / N 船 ≠ N 倍收益', async ({ page }) => {
  const logs = captureConsole(page)
  const out = await evalInGame<{
    ok: boolean
    queued: number
    firstTwo: number[]
    stillQueued: number
    ledgerAfterTwo: number
    secondPair: number[]
  }>(page, `() => {
    const b = window.__warmCurrent
    const mode = b.mode()
    const s = mode.simState.state
    s.starStock.moon = 800
    const mk = ${MK_SHIP_FN}
    const ok = mode.transport.tryCreateRoute({ kind: 'star', star: 'moon' }, { kind: 'earth' })
    for (let i = 0; i < 3; i++) s.ships.push(mk(1000 + i, 'queue' + i))
    for (let i = 0; i < 3; i++) mode.transport.assignIdleShip(s.routes[0])
    // 占泊船 ×2：任务返航口径占泊（unloadsAtEarth = mission && return），timer 拉满不结算
    for (let i = 0; i < 2; i++) s.ships.push(mk(2000 + i, 'blocker', { mission: true, leg: 'return', state: 'unloading', timer: 99999 }))
    b.stepTicks(150) // 全部装货出发（2.5s）
    b.stepTicks(480) // +8s：全部到港（leg 6s + 出港相位差 ≤1 帧）
    const routeShips = () => s.ships.filter((x) => x.routeId === s.routes[0].id)
    const queued = routeShips().filter((x) => x.waitPort !== undefined).length
    // 让泊 → 泊位结算按 waitPort FIFO（同帧到达按 id 稳定排序）放行 2 艘
    for (const x of s.ships) if (x.mission && x.state === 'unloading') x.state = 'idle'
    b.stepTicks(10)
    const firstTwo = routeShips().filter((x) => x.state === 'unloading').map((x) => x.id).sort((a, b2) => a - b2)
    const stillQueued = routeShips().filter((x) => x.state === 'flying' && x.waitPort !== undefined).length
    // 前两艘卸完（2s）→ 泊位腾出 → 后两艘补位；此刻只完成 2 趟卸货（堆船无线性增益）
    b.stepTicks(150)
    const secondPair = routeShips().filter((x) => x.state === 'unloading').map((x) => x.id).sort((a, b2) => a - b2)
    const ledgerAfterTwo = s.ledger.unload // 船 3/1000 刚补位未卸完（余 ~1.7s），账面只含前两趟
    return { ok, queued, firstTwo, stillQueued, ledgerAfterTwo, secondPair }
  }`)
  expect(out.ok).toBe(true)
  expect(out.queued).toBe(4) // 泊位 2 < 船 4：全员排队（满泊日志 + 到港排队日志走 console）
  expect(logs.join('\n')).toContain('地球港泊位 2/2') // 满泊到港日志
  expect(logs.join('\n')).toContain('泊位腾出') // FIFO 靠泊日志
  expect(out.firstTwo).toEqual([1, 2]) // FIFO：初始船 1、2 先靠泊
  expect(out.stillQueued).toBe(2)
  expect(out.ledgerAfterTwo).toBe(320) // 只完成 2 趟（2×(200−40)）：运力被泊位卡住
  expect(out.secondPair).toEqual([3, 1000]) // 后两艘按序补位
})

test('满泊时 relay_in 直接卸入站缓存：不排地球队', async ({ page }) => {
  const out = await evalInGame<{ ok: boolean; stockH3: number; everQueued: boolean }>(page, `() => {
    const b = window.__warmCurrent
    const mode = b.mode()
    const s = mode.simState.state
    s.starStock.moon = 800
    const mk = ${MK_SHIP_FN}
    for (let i = 0; i < 2; i++) s.ships.push(mk(2000 + i, 'blocker', { mission: true, leg: 'return', state: 'unloading', timer: 99999 }))
    const moon = b.bodyPos('moon')
    s.buildings.push({ id: 1, type: 'relay', x: moon.x + 120, y: moon.y, stock: 0, invested: 0 })
    const ok = mode.transport.tryCreateRoute({ kind: 'star', star: 'moon' }, { kind: 'building', buildingId: 1 })
    b.stepTicks(150)  // 出发（星→站段 120px ≈ 0.48 距离系数 → leg ≈2.9s）
    b.stepTicks(600)  // +10s：到站直卸（不排地球队）+ 卸完起飞
    const ship = s.ships.find((x) => x.routeId === s.routes[0].id)
    return { ok, stockH3: s.buildings[0].stockH3 ?? 0, everQueued: ship.waitPort !== undefined }
  }`)
  expect(out.ok).toBe(true)
  expect(out.stockH3).toBe(200) // 满载入站缓存（月球满载 200）
  expect(out.everQueued).toBe(false) // 全程未排地球队
})
