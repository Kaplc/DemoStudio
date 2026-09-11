/**
 * warm-current 槽位化 + 玩家设计权 e2e 探针（playwright.e2e.config.ts / testDir ./e2e）
 *
 * 前置：dev server 已在 :5173 运行（npm run electron:dev 或 vite）
 * 流程：选 WarmCurrent 工程卡 → 打开工程 → ▶ 运行 → Btn_new 进星图（桥挂载）→
 *       全程走 window.__warmCurrent 调试桥探针（不在页面 UI 上点击，规避点击冷却/射线命中干扰）。
 *
 * 覆盖（两方案实施记录承诺的 9.5 探针面）：
 *  ① 聚能环槽位制：安装扣费/重复与未建成拒绝 → 拆除反向灌入拆完回空置（拆装不降级）→ 再装
 *  ② 船型模块：兼容清单拒绝 / hauler+cargo_pod 整单下线定型
 *  ③ 建筑强化：冷库安装扣费并入 invested → 拆除费 20% 不返还 → 换装重载吊臂
 *  ④ 框选决策：预警期框选下令待命 → 爆发锁定 → 耀斑结束决策清空
 *
 * 确定性三板斧（doc-dev/warm-current/implementation.md §二）：
 *  - 关键段落在单次 evaluate 内「改状态+stepTicks」原子执行（JS 单线程，无 rAF 插入）；
 *  - 跨 evaluate 的非关键断言容忍漂移（>=/区间），精确等式只在原子段内使用；
 *  - 每个敏感段入口先 suppressFlare（幕转换会重置耀斑 nextIn）。
 *  - evaluate 模板字符串是页面原文执行（不过 TS 转译）：串内一律纯 JS，
 *    页面内只写 `window.__warmCurrent`，类型断言放串外。
 * 注意：不 pause 游戏——stepTicks 走 GameMode.Tick，暂停即冻结；改用大储量 + 压耀斑防自然败局。
 */
import { expect, test, type Page } from '@playwright/test'

/** 等游戏运行起来（▶ 后 ai.getState.running=true） */
async function waitGameRunning(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const ai = (window as unknown as { __ai?: { emit(e: string, p?: unknown): { results?: Array<{ running?: boolean }> } } }).__ai
    if (!ai) return false
    return ai.emit('ai.getState', {}).results?.[0]?.running === true
  }, { timeout: 60_000 })
}

/** 等星图场景桥就绪（window.__warmCurrent.ready()） */
async function waitGameReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const b = (window as unknown as { __warmCurrent?: { ready: () => boolean } }).__warmCurrent
    return !!b && b.ready()
  }, { timeout: 60_000 })
}

test.describe('warm-current 槽位化 + 玩家设计权探针', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    const card = page.locator('div, button').filter({ hasText: /^WarmCurrent/ }).last()
    await card.click()
    await page.getByRole('button', { name: '打开工程' }).click()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('button', { name: '打开工程' })).toBeHidden({ timeout: 30_000 })
    await page.locator('button', { hasText: '▶' }).first().click()
    await waitGameRunning(page)
    await page.waitForFunction(() => {
      const ai = (window as unknown as { __ai?: { emit: (e: string, p?: unknown) => { results?: Array<{ ok?: boolean }> } } }).__ai
      if (!ai) return false
      const r = ai.emit('ai.clickActor', { name: 'Btn_new' }) as { results?: Array<{ ok?: boolean }> }
      return r?.results?.[0]?.ok === true
    }, { timeout: 60_000, polling: 500 })
    await waitGameReady(page)
  })

  test('全链路探针：环段装拆 / 船型模块下线 / 建筑强化计费 / 框选决策锁定清空', async ({ page }) => {
    // ─── 基线：开局 1 格建成空槽（startSlots=1，引导首次安装） ───
    const base = await page.evaluate(`(() => {
      const b = window.__warmCurrent
      b.setH3(1e9)
      b.suppressFlare()
      const info = b.ringInfo()
      return { built: info.built, total: info.total, slot0: info.buildings[0] }
    })()`) as { built: number; total: number; slot0: string | null }
    expect(base.built).toBe(1)
    expect(base.total).toBe(25)
    expect(base.slot0).toBeNull()

    // ─── ① 环段安装：开局空槽可装，重复/未建成/未知拒绝（原子段） ───
    const install = await page.evaluate(`(() => {
      const b = window.__warmCurrent
      b.suppressFlare()
      const ok = b.installRing(0, 'regulator')
      const rejectedDup = b.installRing(0, 'conduit')
      const rejectedUnbuilt = b.installRing(5, 'conduit')
      const rejectedUnknown = b.installRing(1, 'ghost_ring')
      const info = b.ringInfo()
      return { ok, rejectedDup, rejectedUnbuilt, rejectedUnknown, installed: info.buildings[0], fee: info.fees[0] }
    })()`) as { ok: boolean; rejectedDup: boolean; rejectedUnbuilt: boolean; rejectedUnknown: boolean; installed: string | null; fee: number }
    expect(install.ok).toBe(true)
    expect(install.rejectedDup).toBe(false) // 已装槽先拆再换
    expect(install.rejectedUnbuilt).toBe(false) // 下标 ≥ 已建成数
    expect(install.rejectedUnknown).toBe(false)
    expect(install.installed).toBe('regulator')
    expect(install.fee).toBe(40) // round(200 × 0.2)

    // ─── ① 环段拆除：反向灌入拆完回空置（拆装不降级），再装 ───
    // ledger 口径精确断言：拆除窗口内泵只灌拆除格，ledger.ringBuild 增量 = 拆除费；
    // 拆完立即回收点数停泵（防续建灌入/焚烧污染 earthH3 差值）
    const demolish = await page.evaluate(`(() => {
      const b = window.__warmCurrent
      b.suppressFlare()
      b.allocateBuildPoints(1)
      b.allocateBuildPoints(1)
      b.allocateBuildPoints(1) // 4 点：泵 8 H3/s，拆除费 40 → 5s
      const led0 = b.state().ledger.ringBuild
      const ok = b.demolishRing(0)
      let guard = 0
      while (b.ringInfo().demolish !== null && guard < 3000) { b.stepTicks(10); guard++ }
      const led1 = b.state().ledger.ringBuild
      b.allocateBuildPoints(-1)
      b.allocateBuildPoints(-1)
      b.allocateBuildPoints(-1)
      b.allocateBuildPoints(-1) // 拆完停泵
      const info = b.ringInfo()
      return {
        ok,
        feeSpent: led1 - led0,
        slotCleared: info.buildings[0] === null,
        demolishDone: info.demolish === null,
        builtKept: info.built,
        slots: b.state().ringSlots,
      }
    })()`) as { ok: boolean; feeSpent: number; slotCleared: boolean; demolishDone: boolean; builtKept: number; slots: number }
    expect(demolish.ok).toBe(true)
    expect(demolish.feeSpent).toBeCloseTo(40, 0) // 拆除费经泵逐步扣，总量 = 造价 × 20%（ledger 口径）
    expect(demolish.slotCleared).toBe(true)
    expect(demolish.demolishDone).toBe(true)
    expect(demolish.builtKept).toBe(1) // 拆除只摘建筑，不降级
    expect(demolish.slots).toBe(1)

    const reinstall = await page.evaluate(`(() => {
      const b = window.__warmCurrent
      b.suppressFlare()
      const ok = b.installRing(0, 'conduit')
      return { ok, installed: b.ringInfo().buildings[0] }
    })()`) as { ok: boolean; installed: string | null }
    expect(reinstall.ok).toBe(true) // 回空置可再装
    expect(reinstall.installed).toBe('conduit')

    // ─── ② 船型模块：兼容拒绝 + hauler+cargo_pod 下线定型（原子段） ───
    const ship = await page.evaluate(`(() => {
      const b = window.__warmCurrent
      b.suppressFlare()
      b.setSlots(8) // Lv8 → 船位上限 6，腾出造船余量
      b.setH3(1e9)
      const slots = b.state().ringSlots
      const rejectedIncompatible = b.buildShipHull('hauler', 'ion_engine')
      const ok = b.buildShipHull('hauler', 'cargo_pod')
      const ledger = b.state().ledger.shipBuild
      b.stepTicks(960) // 16s > 无船坞工期 15s → 下线
      const st = b.state()
      const launched = st.ships.find((s) => s.hull === 'hauler' && s.modules.includes('cargo_pod'))
      return { slots, rejectedIncompatible, ok, ledger, launched: !!launched, modules: launched ? launched.modules : [] }
    })()`) as { slots: number; rejectedIncompatible: boolean; ok: boolean; ledger: number; launched: boolean; modules: string[] }
    expect(ship.slots).toBe(8)
    expect(ship.rejectedIncompatible).toBe(false) // hauler 兼容清单无离子引擎
    expect(ship.ok).toBe(true)
    expect(ship.ledger).toBe(440) // 整单价 260 + 180（无船坞原价）
    expect(ship.launched).toBe(true)
    expect(ship.modules).toEqual(['cargo_pod'])

    // ─── ③ 建筑强化：冷库装拆计费（安装并入 invested / 拆除 20% 不返还）+ 换装吊臂 ───
    const upgrade = await page.evaluate(`(() => {
      const b = window.__warmCurrent
      b.suppressFlare()
      b.setH3(1e9)
      const placed = b.placeBuilding('relay', 960, 900)
      const bs = b.state().buildings
      const id = bs[bs.length - 1].id
      // 活引用纪律：state() 是活对象，find 结果是引用——每步立即提取原语快照，
      // 否则 return 时读到的是换装后的最终值（别名坑）
      const snap = () => {
        const x = b.state().buildings.find((v) => v.id === id)
        return { upgrade: x ? x.upgrade : null, invested: x ? x.invested : 0 }
      }
      const h0 = b.state().earthH3
      const installed = b.installUpgrade(id, 'cold_store')
      const h1 = b.state().earthH3
      const s1 = snap()
      const removed = b.removeUpgrade(id)
      const h2 = b.state().earthH3
      const s2 = snap()
      const switched = b.installUpgrade(id, 'heavy_hook')
      const s3 = snap()
      return {
        placed, installed, removed, switched,
        installFee: h0 - h1, removeFee: h1 - h2,
        installedUpgrade: s1.upgrade, investedAfterInstall: s1.invested,
        removedUpgrade: s2.upgrade, investedAfterRemove: s2.invested,
        switchedUpgrade: s3.upgrade,
      }
    })()`) as {
      placed: boolean; installed: boolean; removed: boolean; switched: boolean
      installFee: number; removeFee: number
      installedUpgrade: string | null; investedAfterInstall: number
      removedUpgrade: string | null; investedAfterRemove: number
      switchedUpgrade: string | null
    }
    expect(upgrade.placed).toBe(true)
    expect(upgrade.installed).toBe(true)
    expect(upgrade.installFee).toBe(120) // 冷库造价点击即扣
    expect(upgrade.installedUpgrade).toBe('cold_store')
    expect(upgrade.investedAfterInstall).toBe(270) // 放置 150 + 强化 120（拆除返还折算口径）
    expect(upgrade.removed).toBe(true)
    expect(upgrade.removeFee).toBe(24) // 120 × 20% 纯损耗不返还
    expect(upgrade.removedUpgrade).toBeNull()
    expect(upgrade.investedAfterRemove).toBe(150)
    expect(upgrade.switched).toBe(true) // 一槽二选一：拆完换装另一支
    expect(upgrade.switchedUpgrade).toBe('heavy_hook')

    // ─── ④ 框选决策：预警期框选下令 → 爆发锁定 → 耀斑结束清空（原子段） ───
    const order = await page.evaluate(`(() => {
      const b = window.__warmCurrent
      b.suppressFlare()
      const created = b.createRoute('moon', 'earth')
      const rid = b.routes()[b.routes().length - 1].id
      const added = b.addShip(rid)
      b.beginFlareWarn() // 进耀斑预警态（框选决策窗口；suppressFlare 把 phase 置回 idle，需显式进 warn）
      const moon = b.bodyPos('moon')
      const selected = b.selectShipsInRect(moon.x - 60, moon.y - 60, moon.x + 60, moon.y + 60)
      const ordered = b.orderShips('hold')
      const hasHold = b.state().ships.some((s) => s.order === 'hold')
      b.triggerFlare() // 爆发 = 通讯中断，决策锁定
      const locked = b.orderShips('run')
      const duringFlare = b.state().flare.phase
      b.stepTicks(1300) // 21.7s > 耀斑时长 20s → 结束结算 + clearOrders
      const st = b.state()
      return {
        created, added, selected, ordered, hasHold, locked, duringFlare,
        endPhase: st.flare.phase,
        ordersCleared: st.ships.every((s) => !s.order),
        noNewFrozen: st.ships.every((s) => s.state !== 'frozen'),
      }
    })()`) as {
      created: boolean; added: boolean; selected: number; ordered: number; hasHold: boolean; locked: number
      duringFlare: string; endPhase: string; ordersCleared: boolean; noNewFrozen: boolean
    }
    expect(order.created).toBe(true)
    expect(order.added).toBe(true)
    expect(order.selected).toBeGreaterThanOrEqual(1) // 月球端装货船入框
    expect(order.ordered).toBeGreaterThanOrEqual(1)
    expect(order.hasHold).toBe(true)
    expect(order.locked).toBe(0) // 爆发后窗口关闭，下令拒绝
    expect(order.duringFlare).toBe('active')
    expect(order.endPhase).toBe('idle') // 耀斑结束
    expect(order.ordersCleared).toBe(true) // 决策清空，回到常规
    expect(order.noNewFrozen).toBe(true) // 待命船没出发，港内不冻毁
  })
})
