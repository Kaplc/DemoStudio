/**
 * warm-current 荷载设计工坊 e2e 探针（playwright.e2e.config.ts / testDir ./e2e）
 *
 * 2026-09-13 火箭三部位改版（用户需求）：火箭槽位 = 荷载/燃料/引擎；荷载单独设计——
 * 火箭设计工坊「荷载设计」按钮 → 独立面板：① 选荷载主体（单选）→ ② 勾舱内附件（多选）→
 * 合成一件自定义荷载（造价 = (主体+Σ附件)×1.15 组装溢价，5 取整，占 1 荷载槽）→ 存为模板。
 *
 * 覆盖：
 *  ① 入口与互斥：火箭设计面板内按钮打开（真实 UI 点击）→ payloadDesignOpen=true、designOpen=false；
 *     面板内 ✕ 真实点击关闭；主体 3 行 / 附件 3 行 / 模板空
 *  ② 编辑合成：选主体（cargo_x）+ 勾附件（pump+heater）→ selChassis/selAttachments/
 *     合成造价 875（=(300+140+320)×1.15 进 5 取整）/ 预览文案含件名
 *  ③ 保存：payloadDesigns 入状态（uid=pd1）→ 合成定义可查（slotType=payload、cost=875）
 *  ④ 装配联动：standard 荷载槽部位清单只出玩家保存的设计（pd1/pd2=2 行）→ 选装 → 整单价 180+875=1055；
 *     装配台荷载格显示「自定义荷载 1」
 *  ⑤ 兼容闸：courier 无荷载槽 → pick 拒绝；hauler 白名单旁路（自定义荷载只受槽位闸）→ 接受
 *  ⑥ 引用保护与 uid 不复用：船型模板/现役飞船引用 → 删除拒绝；解除后可删；删后再存 uid 跳号（pd3）
 *  ⑦ 旧档迁移：restoreFromSave 补 payloadDesigns 空数组；开局初始状态含字段
 *
 * 确定性三板斧同 ship_design（原子 evaluate / 区间断言）。
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

/** 与页面同帧原子执行一段 JS（fn = () => {...} 字符串，页内立即调用） */
async function evalInGame<T>(page: Page, fn: string): Promise<T> {
  return await page.evaluate(`(() => { const __f = ${fn}; return __f() })()`) as T
}

test.describe('warm-current 荷载设计工坊', () => {
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

  test('入口互斥 + 编辑合成 + 保存 + 装配联动 + 兼容闸 + 引用保护 + 迁移', async ({ page }) => {
    // ── 1. 入口：火箭设计面板收起 → 打开火箭设计 → 点「荷载设计」按钮（真实 UI 点击） ──
    await page.waitForFunction(() => {
      const ai = (window as unknown as { __ai?: { emit: (e: string, p?: unknown) => { results?: Array<{ ok?: boolean }> } } }).__ai
      if (!ai) return false
      const open = ai.emit('ai.clickActor', { name: 'Btn_design' }) as { results?: Array<{ ok?: boolean }> }
      return open?.results?.[0]?.ok === true
    }, { timeout: 15_000, polling: 300 })
    // 等面板首帧渲染完（0.12s 差分 cadence），再点面板内「荷载设计」——避免重试 toggle 振荡
    await page.waitForFunction(() => {
      const b = (window as unknown as { __warmCurrent?: { mode: () => { designOpen: boolean } } }).__warmCurrent
      return !!b && b.mode().designOpen === true
    }, { timeout: 15_000 })
    await page.waitForFunction(() => {
      const ai = (window as unknown as { __ai?: { emit: (e: string, p?: unknown) => { results?: Array<{ ok?: boolean }> } } }).__ai
      if (!ai) return false
      const r = ai.emit('ai.clickActor', { name: 'Btn_dsn_payload' }) as { results?: Array<{ ok?: boolean }> }
      return r?.results?.[0]?.ok === true
    }, { timeout: 15_000, polling: 300 })

    const entry = await evalInGame<{
      payloadOpen: boolean; designOpen: boolean; hasVM: boolean
      chassis: number; attachments: number; designs: number; canSave: boolean
    }>(page, `() => {
      const b = window.__warmCurrent
      const vm = b.vm().payloadDesign
      return {
        payloadOpen: b.mode().payloadDesignOpen === true,
        designOpen: b.mode().designOpen === true,
        hasVM: !!vm,
        chassis: vm ? vm.chassis.length : -1,
        attachments: vm ? vm.attachments.length : -1,
        designs: vm ? vm.designs.length : -1,
        canSave: vm ? vm.canSave : false,
      }
    }`)
    expect(entry.payloadOpen).toBe(true)
    expect(entry.designOpen).toBe(false)  // 与火箭设计互斥
    expect(entry.hasVM).toBe(true)
    expect(entry.chassis).toBe(3)         // 轻量/标准/特扩货舱
    expect(entry.attachments).toBe(8)     // 备用货泵/快速货泵/防冻加热器 + 二批五附件
    expect(entry.designs).toBe(0)
    expect(entry.canSave).toBe(true)

    // ── 2. 编辑合成：选低温液罐 + 勾快速货泵/防冻加热器 → 预览造价 965 ──
    const edited = await evalInGame<{
      selChassis: string; selAttachments: string[]; synthCost: number
      synthHasChassis: boolean; synthHasPump: boolean; synthHasHeater: boolean
    }>(page, `() => {
      const b = window.__warmCurrent
      const m = b.mode()
      m.selectPayloadChassis('cryo_tank')
      m.togglePayloadAttachment('pump')
      m.togglePayloadAttachment('heater')
      const vm = b.vm().payloadDesign
      return {
        selChassis: vm.selChassis,
        selAttachments: vm.selAttachments,
        synthCost: vm.synthCost,
        synthHasChassis: vm.synthDesc.includes('低温液罐'),
        synthHasPump: vm.synthDesc.includes('快速货泵'),
        synthHasHeater: vm.synthDesc.includes('防冻加热器'),
      }
    }`)
    expect(edited.selChassis).toBe('cryo_tank')
    expect(edited.selAttachments).toEqual(['pump', 'heater'])
    expect(edited.synthCost).toBe(965)    // (380+140+320)×1.15 = 966 → 5 取整 965
    expect(edited.synthHasChassis).toBe(true)
    expect(edited.synthHasPump).toBe(true)
    expect(edited.synthHasHeater).toBe(true)

    // ── 3. 保存：入状态（uid=pd1）→ 再存一件（pd2，供 uid 跳号断言） ──
    const saved = await evalInGame<{ count: number; uid1: string; uid2: string }>(page, `() => {
      const b = window.__warmCurrent
      const m = b.mode()
      m.savePayloadDesign()
      const d1 = m.simState.state.payloadDesigns[0]
      m.savePayloadDesign()
      const d2 = m.simState.state.payloadDesigns[1]
      return {
        count: m.simState.state.payloadDesigns.length,
        uid1: d1 ? d1.uid : '',
        uid2: d2 ? d2.uid : '',
      }
    }`)
    expect(saved.count).toBe(2)
    expect(saved.uid1).toBe('pd1')
    expect(saved.uid2).toBe('pd2')
    // 注册表投影验证：火箭设计荷载槽部位清单含 pd1（注册表生效的直接证据）
    const def = await evalInGame<{ cost: number; slot: string; name: string; options: number }>(page, `() => {
      const b = window.__warmCurrent
      const m = b.mode()
      m.openShipDesign()
      m.setShipyardHull('standard')
      m.selectShipyardSlot('payload', 0)
      const vm = b.vm().shipDesign
      const opt = vm.slotOptions.find((o) => o.id === 'pd1')
      return { cost: opt ? opt.cost : -1, slot: opt ? (opt.slotType ?? '') : '', name: opt ? opt.name : '', options: vm.slotOptions.length }
    }`)
    expect(def.cost).toBe(875)
    expect(def.slot).toBe('payload')
    expect(def.name).toBe('自定义荷载 1')
    expect(def.options).toBe(2) // 荷载槽只出玩家保存的设计（pd1/pd2；现货舱内件收口工坊合成）

    // ── 4. 装配联动：standard 荷载槽 2 行（只出设计件）→ 选装 pd1 → 整单价 1055 ──
    const installed = await evalInGame<{ options: number; cells: string[]; price: number }>(page, `() => {
      const b = window.__warmCurrent
      const m = b.mode()
      m.openShipDesign()
      m.setShipyardHull('standard')
      m.selectShipyardSlot('payload', 0)
      const vm = b.vm().shipDesign
      const options = vm.slotOptions.length
      m.pickShipyardSlotModule('payload', 0, 'pd1')
      const vm2 = b.vm().shipDesign
      return {
        options,
        cells: vm2.slotCells.map((c) => c.module || ''),
        price: vm2.price,
      }
    }`)
    expect(installed.options).toBe(2) // 荷载槽只出玩家保存的设计（pd1/pd2；2026-09-14 现货件收口工坊合成）
    expect(installed.cells).toContain('自定义荷载 1')
    expect(installed.price).toBe(180 + 875) // standard 船体 + 合成荷载

    // ── 5. 兼容闸：courier 无荷载槽拒绝；hauler 白名单旁路接受 ──
    const gates = await evalInGame<{ courierRejected: boolean; haulerPrice: number }>(page, `() => {
      const b = window.__warmCurrent
      const m = b.mode()
      m.setShipyardHull('courier')
      m.shipyardSelModules = []
      m.pickShipyardSlotModule('payload', 0, 'pd1')   // 无荷载槽 → 防御拒绝
      const courierRejected = m.shipyardSelModules.length === 0
      m.setShipyardHull('hauler')
      m.selectShipyardSlot('payload', 0)
      m.pickShipyardSlotModule('payload', 0, 'pd1')   // 白名单旁路，只受槽位闸
      const vm = b.vm().shipDesign
      return { courierRejected, haulerPrice: vm.price }
    }`)
    expect(gates.courierRejected).toBe(true)
    expect(gates.haulerPrice).toBe(260 + 875) // hauler 船体 + 合成荷载

    // ── 6. 引用保护 + uid 不复用：模板/飞船/当前装配引用拒删；解除后可删；再存跳号 pd3 ──
    const refs = await evalInGame<{
      tmplBlocked: boolean; shipBlocked: boolean; deleted: number; nextUid: string
    }>(page, `() => {
      const b = window.__warmCurrent
      const m = b.mode()
      // pd2 已在 ③ 存好；把 pd1 存成船型模板引用 + 塞进现役飞船引用（当前装配本就持有 pd1）
      m.shipyardSelModules = ['pd1']
      m.saveShipDesign()
      m.simState.state.ships[0].modules.push('pd1')
      const tmplBlocked = m.deletePayloadDesign(0) === false       // 模板+飞船+装配引用 pd1
      const shipBlocked = (() => {
        m.shipyardSelModules = []                                  // 解除装配引用
        m.simState.state.shipDesigns[0].modules = []               // 解除模板引用
        return m.deletePayloadDesign(0) === false                  // 飞船仍引用 → 拒删
      })()
      m.simState.state.ships[0].modules = m.simState.state.ships[0].modules.filter((x) => x !== 'pd1')
      const deleted = m.deletePayloadDesign(0)                     // 引用全解除 → 删除成功
      m.selectPayloadChassis('cryo_tank')
      m.savePayloadDesign()                                        // uid 跳号：pd1 已占用过 → pd3
      const nextUid = m.simState.state.payloadDesigns[m.simState.state.payloadDesigns.length - 1].uid
      return { tmplBlocked, shipBlocked, deleted, nextUid }
    }`)
    expect(refs.tmplBlocked).toBe(true)
    expect(refs.shipBlocked).toBe(true)
    expect(refs.deleted).toBe(true)
    expect(refs.nextUid).toBe('pd3')

    // ── 7. 旧档迁移：缺 payloadDesigns 的存档 restore 后补空数组 ──
    const migrated = await evalInGame<{ hasField: boolean; freshHasField: boolean }>(page, `() => {
      const b = window.__warmCurrent
      const m = b.mode()
      const legacy = JSON.parse(JSON.stringify(m.simState.state))
      delete legacy.payloadDesigns
      const pack = m.restoreFromSave(legacy)
      const hasField = !!pack && Array.isArray(pack.state.payloadDesigns)
      // 复原：恢复带字段状态（payloadDesigns 当前 1 件 pd3）
      const back = m.restoreFromSave(m.simState.state)
      return { hasField, freshHasField: !!back && Array.isArray(back.state.payloadDesigns) }
    }`)
    expect(migrated.hasField).toBe(true)
    expect(migrated.freshHasField).toBe(true)

    // ── 8. 关闭：面板内 ✕ 真实点击 → vm 归 null ──
    const reopened = await evalInGame<boolean>(page, `() => {
      window.__warmCurrent.mode().openPayloadDesign()
      return window.__warmCurrent.mode().payloadDesignOpen === true
    }`)
    expect(reopened).toBe(true)
    await page.waitForFunction(() => {
      const ai = (window as unknown as { __ai?: { emit: (e: string, p?: unknown) => { results?: Array<{ ok?: boolean }> } } }).__ai
      if (!ai) return false
      const r = ai.emit('ai.clickActor', { name: 'Btn_pd_close' }) as { results?: Array<{ ok?: boolean }> }
      return r?.results?.[0]?.ok === true
    }, { timeout: 15_000, polling: 300 })
    const closed = await evalInGame<boolean>(page, `() => {
      const b = window.__warmCurrent
      return b.mode().payloadDesignOpen === false && b.vm().payloadDesign === null
    }`)
    expect(closed).toBe(true)
  })
})
