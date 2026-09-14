/**
 * warm-current 火箭设计工坊 e2e 探针（playwright.e2e.config.ts / testDir ./e2e）
 *
 * 2026-09-13 用户需求：底部 HUD 新增「火箭设计」入口 → 独立设计面板（《火箭工坊》三区），
 * 不依赖船坞即可设计，有建成船坞可直接下水。
 * 2026-09-13 部位选件制：平铺部件库 → ① 选型号 → ② 装配台点部位 → ② 区出该槽型多档部件
 * （同功能不同数值），换装/对调/卸下都以 (槽型, 实例) 为单位。
 * 2026-09-13 火箭三部位改版（用户需求）：槽位 = 荷载(payload)/燃料(fuel)/引擎(engine)，功能槽下线；
 * 荷载可经「荷载设计」工坊单独设计（payload_design.spec.ts 覆盖）。
 *
 * 覆盖：
 *  ① 底部按钮打开：vm.shipDesign 非空、面板展开、未选部位 = 无清单
 *  ② 设计流：选船型 → 船坞面板旧入口 toggle 仍工作 → 部位选件（空槽装入/异实例对调/
 *     原位换装/再点卸下/不兼容拒绝）→ 槽位占用/装配台格子/整单价联动
 *  ③ 试航卡：三星口径吞吐率 > 0（未解锁星标幕数）
 *  ④ 模板：存为模板 → shipDesigns 入状态 → 删除
 *  ⑤ 无坞下单门：开局无船坞 → canQueue=false、空态引导文案；GM 造船坞后按钮池出现并可下单
 *
 * 确定性三板斧同 slots_design（原子 evaluate / 区间断言 / suppressFlare）。
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

/** 与页面同帧原子执行一段 JS（route_lane 同款：fn = () => {...} 字符串，页内立即调用） */
async function evalInGame<T>(page: Page, fn: string): Promise<T> {
  return await page.evaluate(`(() => { const __f = ${fn}; return __f() })()`) as T
}

test.describe('warm-current 火箭设计工坊', () => {
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

  test('底部入口打开设计面板：三区渲染 + 设计流 + 试航卡 + 模板 + 下单门', async ({ page }) => {
    // ── 1. 开局面板收起 → 点底部「火箭设计」按钮（真实 UI 点击：按钮回调链路） ──
    const closed = await evalInGame<{ bridge: boolean; vm: unknown }>(page, `() => {
      const b = window.__warmCurrent
      if (!b) return { bridge: false, vm: undefined }
      return { bridge: true, vm: b.vm().shipDesign || null }
    }`)
    expect(closed.bridge).toBe(true)
    expect(closed.vm).toBeNull() // 开局收起

    // 底部按钮存在且点击打开（ai.clickActor 走 InputSys 真实射线管线）
    await page.waitForFunction(() => {
      const ai = (window as unknown as { __ai?: { emit: (e: string, p?: unknown) => { results?: Array<{ ok?: boolean }> } } }).__ai
      if (!ai) return false
      const r = ai.emit('ai.clickActor', { name: 'Btn_design' }) as { results?: Array<{ ok?: boolean }> }
      return r?.results?.[0]?.ok === true
    }, { timeout: 15_000, polling: 300 })

    const opened = await evalInGame<{
      open: boolean; hulls: number; slotCells: number; selSlotNull: boolean; options: number
      trials: number; price: number; canQueue: boolean; docks: number
    }>(page, `() => {
      const b = window.__warmCurrent
      const vm = b.vm().shipDesign
      if (!vm) return { open: false }
      return {
        open: b.mode().designOpen === true,
        hulls: vm.hulls.length, slotCells: vm.slotCells.length,
        selSlotNull: vm.selSlot === null, options: vm.slotOptions.length,
        trials: vm.trials.length, price: vm.price, canQueue: vm.canQueue, docks: vm.docks.length,
      }
    }`)
    expect(opened.open).toBe(true)
    expect(opened.hulls).toBe(4)      // ship_hull 表 4 船型
    expect(opened.slotCells).toBe(3)  // standard 默认 3 槽（火箭三部位：荷载/燃料/引擎）
    expect(opened.selSlotNull).toBe(true)   // 未点部位 → ② 区无清单（引导文案）
    expect(opened.options).toBe(0)
    expect(opened.trials).toBe(3)     // 三星口径
    expect(opened.price).toBeGreaterThan(0)
    expect(opened.canQueue).toBe(false) // 开局无船坞
    expect(opened.docks).toBe(0)

    // ── 2. 设计流原子段：船坞面板旧入口 toggle → 部位选件制（装入/对调/换装/卸下/拒绝） ──
    const designed = await evalInGame<{
      toggled: number; options: number; selTypeName: string; afterSwap: string[]
      finalCells: string[]; slotLine2: string; price2: number
    }>(page, `() => {
      const b = window.__warmCurrent
      const m = b.mode()
      m.setShipyardHull('hauler')
      // 船坞面板平铺勾选入口仍工作（与本面板共享选择态）
      m.toggleShipyardModule('cargo_pod')
      m.toggleShipyardModule('pump')
      const toggled = b.vm().shipDesign.slotCells.filter((c) => c.filled).length
      m.toggleShipyardModule('cargo_pod')
      m.toggleShipyardModule('pump')
      // ── 部位选件制（火箭三部位：payload 荷载 / fuel 燃料 / engine 引擎） ──
      m.selectShipyardSlot('payload', 0)
      const vm2 = b.vm().shipDesign
      const options = vm2.slotOptions.length          // 2026-09-14 口径：荷载部位清单只出玩家保存的设计（无设计 = 0 行，现货舱内件收口工坊合成）
      const selTypeName = vm2.selSlot ? vm2.selSlot.typeName : ''
      // 部位选件机制（装入/对调/换装/卸下）经共享选择态在数据层验证（pickShipyardSlotModule 校验不依赖清单渲染）
      m.pickShipyardSlotModule('payload', 0, 'cargo_hold') // 空槽装入固体货仓（×1.3）
      m.selectShipyardSlot('payload', 1)
      m.pickShipyardSlotModule('payload', 1, 'cryo_tank') // 第二荷载装低温液罐（×1.1）
      m.selectShipyardSlot('payload', 0)
      m.pickShipyardSlotModule('payload', 0, 'cryo_tank') // 目标件已装另一实例 → 对调
      const afterSwap = b.vm().shipDesign.slotCells.filter((c) => c.type === 'payload').map((c) => c.module)
      m.pickShipyardSlotModule('payload', 0, 'cargo_hold') // 原位换装：低温液罐 → 固体货仓
      m.pickShipyardSlotModule('payload', 0, 'cargo_hold') // 再点已装件 = 卸下
      m.pickShipyardSlotModule('fuel', 0, 'aux_tank')   // hauler 不兼容副油箱 → 拒绝
      const vm3 = b.vm().shipDesign
      return {
        toggled, options, selTypeName, afterSwap,
        finalCells: vm3.slotCells.map((c) => c.module || ''),
        slotLine2: vm3.slotRows.map((r) => r.name + ' ' + r.used + '/' + r.cap).join(','),
        price2: vm3.price,
      }
    }`)
    expect(designed.toggled).toBe(2)                  // 旧入口：货舱+货泵 = 2 格填充（泵现占荷载槽）
    expect(designed.options).toBe(0)                  // 2026-09-14 口径：荷载部位清单只出玩家保存的设计（现货舱内件收口工坊合成）
    expect(designed.selTypeName).toBe('荷载')
    expect(designed.afterSwap).toEqual(['低温液罐', '固体货仓'])  // 对调：#0↔#1
    // 卸下 #0 后同型实例左移补位（清单序派生：模块清单唯一权威，同类槽位互换数值不变）
    expect(designed.finalCells).toEqual(['固体货仓', '', ''])
    expect(designed.slotLine2).toContain('荷载 1/2')
    expect(designed.slotLine2).toContain('燃料 0/1')  // allowed 拒绝 aux_tank
    expect(designed.slotLine2).not.toContain('功能')  // 功能槽已下线（2026-09-13 三部位改版）
    expect(designed.price2).toBe(260 + 180)           // hauler 船体 + 固体货仓

    // ── 3. 试航卡：月球吞吐率 > 0、未解锁木卫二标幕数、反推非负 ──
    const trials = await evalInGame<Array<{ star: string; unlocked: boolean; throughput: number; shipsForGap: number }>>(page, `() => {
      return window.__warmCurrent.vm().shipDesign.trials.map((t) => ({
        star: t.star, unlocked: t.unlocked, throughput: t.throughput, shipsForGap: t.shipsForGap,
      }))
    }`)
    const moon = trials.find((t) => t.star === 'moon')!
    expect(moon.unlocked).toBe(true)
    expect(moon.throughput).toBeGreaterThan(0)
    const europa = trials.find((t) => t.star === 'europa')!
    expect(europa.unlocked).toBe(false)
    expect(europa.shipsForGap).toBe(-1)

    // ── 4. 模板：存 → 状态入列 → 载入回读 → 删 ──
    const template = await evalInGame<{ saved: number; loaded: boolean; afterDelete: number }>(page, `() => {
      const b = window.__warmCurrent
      const m = b.mode()
      m.saveShipDesign()
      const count = m.simState.state.shipDesigns.length
      m.shipyardSelHull = 'standard'
      m.shipyardSelModules = []
      const ok = m.loadShipDesign(0)
      const hull = m.shipyardSelHull
      m.deleteShipDesign(0)
      return { saved: count, loaded: ok && hull === 'hauler', afterDelete: m.simState.state.shipDesigns.length }
    }`)
    expect(template.saved).toBe(1)
    expect(template.loaded).toBe(true)
    expect(template.afterDelete).toBe(0)

    // ── 5. 下单门：GM 建船坞（直接入状态避开建造工期）→ 按钮池出现 → 下单成功入队 ──
    const ordered = await evalInGame<{ docks: number; canQueue: boolean; ordered: boolean; queue: number }>(page, `() => {
      const b = window.__warmCurrent
      const s = b.mode().simState.state
      s.earthH3 = 10_000
      s.ringSlots = 8
      s.orbitBuildings.push({ id: 1, type: 'dock', anchor: 'earth', a0: 0, progress: 1, built: true })
      const vm = b.vm().shipDesign
      const docks = vm.docks.length
      const canQueue = vm.canQueue
      const ok = docks > 0 ? b.mode().orderFromDesign(vm.docks[0].id) : false
      return { docks, canQueue, ordered: ok, queue: s.buildQueue.length }
    }`)
    expect(ordered.docks).toBe(1)
    expect(ordered.canQueue).toBe(true)
    expect(ordered.ordered).toBe(true)
    expect(ordered.queue).toBe(1)

    // ── 6. 关闭：面板收起（vm 归 null） ──
    const after = await evalInGame<boolean>(page, `() => {
      window.__warmCurrent.mode().closeShipDesign()
      return window.__warmCurrent.mode().designOpen === false
    }`)
    expect(after).toBe(true)
  })
})
