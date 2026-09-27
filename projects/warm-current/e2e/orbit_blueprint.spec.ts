/**
 * warm-current 轨道蓝图台 e2e（2026-09-29 航线编辑合并升级）
 *
 * 覆盖（调试桥驱动，gameplay 链路与真实指针事件一致）：
 *   1. 点「航线编辑」进入统一蓝图台：全息俯视（取景中心 = 冻结地球 + 近垂直 88° 相机）+
 *      全息网格地图（buildGroup 常驻）+ 轨道环示意 + vm.blueprintHint 上下文提示
 *   2. 太阳与其他星球移除（2026-09-29）：蓝图台 = 纯地月系工作台——太阳组（本体/光晕/
 *      标签/绕日环）不可见、地球冻结不公转；月球本体可见且全息质感（半透明青调）、
 *      全息网格线常驻（空手态也铺设）；水星/火星/木卫二本体点不到（命中收口），
 *      太阳不可点，火星/金星/地球绕日环不吸附，月球环保留；渲染侧行星本体与绕日环不可见
 *   3. 任意轨道放置：建造面板选型（enterBuildMode）→ 指针吸附月球轨道环（ghost 锚=地球）
 *      → 点按落位（anchor=earth orbitR≈1200，扣预算，自动退出放置工具）
 *   4. 真实转移轨道航线：月→地建线后弧端点恒等天体、t=0.5 背向主天体（地球）鼓出
 *   5. KSP 式轨道蓝图编辑：点轨道设施（船坞）选中 → 拖 ◇ 半径手柄 96→300 →
 *      松开应用（ringR=300，orbitBuildingPos 立即生效）→ 再点取消选中
 *   6. 退出蓝图台：回地球系取景，建筑保留
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

test.describe('warm-current 轨道蓝图台（全息俯视 + 任意轨道放置 + 转移轨道航线 + KSP 轨道编辑）', () => {
  test('进入俯视蓝图台 → 轨道环放置 → 转移弧航线 → KSP 手柄改轨道 → 退出恢复', async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 1600, height: 900 })
    await page.goto('/')
    const card = page.locator('div, button').filter({ hasText: /^WarmCurrent/ }).last()
    await card.click()
    await page.getByRole('button', { name: '打开工程' }).click()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('button', { name: '打开工程' })).toBeHidden({ timeout: 30_000 })
    await page.locator('button', { hasText: '▶' }).first().click()
    // 场景路由事实（同 route_lane）：主菜单 → Btn_new 切星图 → 桥就绪
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
    await waitGameReady(page)

    // ── 1. 进入轨道蓝图台（底部「航线编辑」同链路 toggleRouteEditMode）──
    await page.evaluate(`(() => { window.__warmCurrent.setRouteEditMode(true) })()`)
    await expect.poll(async () => {
      return page.evaluate(`(() => window.__warmCurrent.routeEditMode())()`)
    }, { message: '应进入轨道蓝图台', timeout: 5_000 }).toBe(true)

    const enterSnap = await evalInGame<{
      viewMode: string
      cameraY: number
      camOffX: number
      camOffZ: number
      gridVisible: boolean
      planetInfoClosed: boolean
      hint: string
    }>(page, `() => {
      const b = window.__warmCurrent
      const m = b.mode()
      const v = b.view()
      const e = b.bodyPos('earth')
      return {
        viewMode: v.viewMode,
        cameraY: v.cameraY,
        // 画布→世界：toWX = x−960、toWZ = y−540；取景中心应 = 冻结地球
        camOffX: v.cameraX - (e.x - 960),
        camOffZ: v.cameraZ - (e.y - 540),
        gridVisible: m.starMap.buildGroup.visible,
        planetInfoClosed: m.planetInfoSel === null,
        hint: b.vm().blueprintHint,
      }
    }`)
    expect(enterSnap.viewMode, '蓝图台 = 太阳系全景俯视').toBe('solar')
    expect(enterSnap.cameraY, '近垂直俯视（88°）：相机高度 ≈ 取景距离').toBeGreaterThan(4000)
    expect(Math.abs(enterSnap.camOffX), '取景中心 = 冻结地球（x 对准）').toBeLessThan(80)
    expect(Math.abs(enterSnap.camOffZ), '取景中心 = 冻结地球（z 对准，88° 抬升余量内）').toBeLessThan(400)
    expect(enterSnap.gridVisible, '全息网格地图常驻').toBe(true)
    expect(enterSnap.planetInfoClosed, '进入蓝图台关闭信息面板').toBe(true)
    expect(enterSnap.hint, 'vm.blueprintHint 上下文提示非空').toContain('航线')

    // ── 2. 太阳与其他星球移除（2026-09-29）：蓝图台 = 纯地月系工作台 ──
    const removedSnap = await evalInGame<{
      mercuryHit: string | null
      marsHit: string | null
      europaHit: string | null
      sunPickable: boolean
      marsRingSnap: unknown
      venusRingSnap: unknown
      earthRingSnap: unknown
      moonRingSnap: { anchor: string } | null
      sunGroupVisible: boolean
      marsBodyVisible: boolean
      earthBodyVisible: boolean
      earthHoloOpacity: number
      moonBodyVisible: boolean
      moonHoloOpacity: number
      gridLinesReady: boolean
      earthRingVisible: boolean
      marsRingVisible: boolean
      europaMoonRingVisible: boolean
      moonRingVisible: boolean
    }>(page, `() => {
      const b = window.__warmCurrent
      const m = b.mode()
      // 命中口径：水星/火星/木卫二本体点不到；太阳不可点（sunAt 收口）
      const hitAt = (name) => m.hit.bodyAt(b.bodyPos(name))
      // 吸附口径：星球在绕日环上（starPosAt = 轨道半径处）——火星/金星/地球环均不再吸附；
      // 月球环点仍吸附（锚 earth）
      const e = b.bodyPos('earth')
      const moonRingSnap = m.blueprint.orbitRingAt({
        x: e.x + Math.cos(0.3) * 1200, y: e.y + Math.sin(0.3) * 1200,
      })
      // 渲染口径：太阳组/行星本体/绕日环不可见（私有字段反射；权威交互口径已另行断言）
      const sm = m.starMap
      return {
        mercuryHit: hitAt('mercury'),
        marsHit: hitAt('mars'),
        europaHit: hitAt('europa'),
        sunPickable: m.hit.sunAt(b.bodyPos('sun')),
        marsRingSnap: m.blueprint.orbitRingAt(b.bodyPos('mars')),
        venusRingSnap: m.blueprint.orbitRingAt(b.bodyPos('venus')),
        earthRingSnap: m.blueprint.orbitRingAt({ x: e.x, y: e.y }),
        moonRingSnap,
        sunGroupVisible: sm.sunGroup.visible,
        marsBodyVisible: sm.starViews.mars.body.visible,
        earthBodyVisible: sm.starViews.earth.body.visible,
        earthHoloOpacity: sm.starViews.earth.mat.opacity,
        moonBodyVisible: sm.starViews.moon.body.visible,
        moonHoloOpacity: sm.starViews.moon.mat.opacity,
        gridLinesReady: !!sm.gridLines && sm.gridLines.visible,
        earthRingVisible: sm.planetOrbitRings.get('earth').visible,
        marsRingVisible: sm.planetOrbitRings.get('mars').visible,
        europaMoonRingVisible: sm.moonRings.get('europa').visible,
        moonRingVisible: sm.moonRings.get('moon').visible,
      }
    }`)
    expect(removedSnap.mercuryHit, '水星本体点不到').toBeNull()
    expect(removedSnap.marsHit, '火星本体点不到').toBeNull()
    expect(removedSnap.europaHit, '木卫二本体点不到').toBeNull()
    expect(removedSnap.sunPickable, '太阳移除：点地图中心不命中（无"全景已屏蔽"误提示）').toBe(false)
    expect(removedSnap.marsRingSnap, '火星绕日环不再吸附').toBeNull()
    expect(removedSnap.venusRingSnap, '金星绕日环不再吸附').toBeNull()
    expect(removedSnap.earthRingSnap, '地球绕日环随太阳移除退场，不再吸附').toBeNull()
    expect(removedSnap.moonRingSnap, '月球环保留吸附（锚 earth）').not.toBeNull()
    expect(removedSnap.moonRingSnap!.anchor).toBe('earth')
    expect(removedSnap.sunGroupVisible, '太阳组（本体光晕/标签/绕日环）不可见').toBe(false)
    expect(removedSnap.marsBodyVisible, '火星本体不可见').toBe(false)
    expect(removedSnap.earthBodyVisible, '地球本体可见').toBe(true)
    expect(removedSnap.earthHoloOpacity, '地球本体全息半透明').toBeCloseTo(0.5, 1)
    expect(removedSnap.moonBodyVisible, '月球本体可见').toBe(true)
    expect(removedSnap.moonHoloOpacity, '月球本体全息半透明').toBeCloseTo(0.5, 1)
    expect(removedSnap.gridLinesReady, '全息网格线已铺设（蓝图台空手态）').toBe(true)
    expect(removedSnap.earthRingVisible, '地球绕日环不可见').toBe(false)
    expect(removedSnap.marsRingVisible, '火星绕日环不可见').toBe(false)
    expect(removedSnap.europaMoonRingVisible, '木卫二环不可见').toBe(false)
    expect(removedSnap.moonRingVisible, '月球环可见（放置/编辑目标）').toBe(true)

    // ── 2. 任意轨道放置：月球轨道环（锚=地球）上放中转站 ──
    const placeSnap = await evalInGame<{
      entered: boolean
      ghost: { anchor: string; r: number; valid: boolean } | null
      placed: boolean
      anchor: string | null
      orbitR: number
      h3Dropped: boolean
      toolExited: boolean
    }>(page, `() => {
      const b = window.__warmCurrent
      const m = b.mode()
      const entered = m.enterBuildMode('relay')
      if (!entered) return { entered: false, ghost: null, placed: false, anchor: null, orbitR: 0, h3Dropped: false, toolExited: false }
      // 月球轨道环上 a=0.3 的点（环心 = 地球实时位，r = 1200）
      const e = b.bodyPos('earth')
      const px = e.x + Math.cos(0.3) * 1200
      const py = e.y + Math.sin(0.3) * 1200
      b.pointerMove(px, py)
      const g = m.blueprint.ghost
      const ghost = g ? { anchor: g.anchor, r: g.r, valid: g.valid } : null
      const h3Before = b.state().earthH3
      b.pointerDown(px, py)
      b.pointerUp(px, py)
      const s = b.state()
      const bd = s.buildings[0]
      return {
        entered: true,
        ghost,
        placed: !!bd,
        anchor: bd ? bd.anchor : null,
        orbitR: bd ? bd.orbitR : 0,
        h3Dropped: s.earthH3 < h3Before,
        toolExited: m.buildMode === null,
      }
    }`)
    expect(placeSnap.entered, '建造面板选型进入放置工具').toBe(true)
    expect(placeSnap.ghost, '指针吸附月球轨道环出 ghost').not.toBeNull()
    expect(placeSnap.ghost!.anchor, 'ghost 锚 = 母星地球').toBe('earth')
    expect(placeSnap.ghost!.valid, 'ghost 合法（预算内/无间距冲突）').toBe(true)
    expect(placeSnap.placed, '点按落位成功').toBe(true)
    expect(placeSnap.anchor, '建筑锚定地球（月球环带）').toBe('earth')
    expect(placeSnap.orbitR, '本征轨道半径 = 月球环 1200').toBeGreaterThan(1100)
    expect(placeSnap.h3Dropped, '落位扣预算').toBe(true)
    expect(placeSnap.toolExited, '落位后自动退出放置工具').toBe(true)

    // ── 3. 真实转移轨道航线：蓝图态内真实拖线 月 → 地（指针路由 fall-through 链路），
    //        弧端点恒等天体 + 背向主天体（地球）鼓出 ──
    const arcSnap = await evalInGame<{
      created: boolean
      t0: { x: number; y: number } | null
      t1: { x: number; y: number } | null
      bulgeOut: boolean
      chordBulge: number
    }>(page, `() => {
      const b = window.__warmCurrent
      // 真实拖线：按住月球拖到地球抬起（引导期唯一合法组合 = 月↔地）
      const moon = b.bodyPos('moon')
      const earth = b.bodyPos('earth')
      b.pointerDown(moon.x, moon.y)
      b.pointerMove(earth.x, earth.y)
      b.pointerUp(earth.x, earth.y)
      const created = b.routes().length >= 1
      if (!created) return { created: false, t0: null, t1: null, bulgeOut: false, chordBulge: 0 }
      // 同帧采样（行星在公转，跨 evaluate 比较会漂）
      const r = b.routes()[0]
      const t0 = b.routeArcSample(r.id, 0)
      const t1 = b.routeArcSample(r.id, 1)
      const mid = b.routeArcSample(r.id, 0.5)
      const e = b.bodyPos('earth')
      const mn = b.bodyPos('moon')
      const chordMid = { x: (mn.x + e.x) / 2, y: (mn.y + e.y) / 2 }
      const dArc = Math.hypot(mid.x - e.x, mid.y - e.y)
      const dChord = Math.hypot(chordMid.x - e.x, chordMid.y - e.y)
      return { created: true, t0, t1, bulgeOut: dArc > dChord + 20, chordBulge: dArc - dChord }
    }`)
    expect(arcSnap.created, '月→地建线成功').toBe(true)
    expect(arcSnap.t0 && arcSnap.t1, '弧采样可用').toBeTruthy()
    const moon = await evalInGame<{ x: number; y: number }>(page, `() => window.__warmCurrent.bodyPos('moon')`)
    const earth = await evalInGame<{ x: number; y: number }>(page, `() => window.__warmCurrent.bodyPos('earth')`)
    expect(Math.hypot(arcSnap.t0!.x - moon.x, arcSnap.t0!.y - moon.y), '弧起点 = 月球').toBeLessThan(30)
    expect(Math.hypot(arcSnap.t1!.x - earth.x, arcSnap.t1!.y - earth.y), '弧终点 = 地球').toBeLessThan(30)
    expect(arcSnap.bulgeOut, '弧 t=0.5 背向主天体（地球）鼓出（转移椭圆观感）').toBe(true)

    // ── 4. KSP 式轨道蓝图编辑：船坞选中 → 拖半径手柄 96 → 300 ──
    const dockSel = await evalInGame<{ placed: boolean; id: number }>(page, `() => {
      const b = window.__warmCurrent
      const ok = b.placeOrbitBuilding('dock', 'earth')
      const ob = b.state().orbitBuildings[0]
      return { placed: ok && !!ob, id: ob ? ob.id : 0 }
    }`)
    expect(dockSel.placed, '预置一座船坞轨道设施').toBe(true)

    const dragSnap = await evalInGame<{
      selected: boolean
      ringBefore: number
      applied: boolean
      ringAfter: number
      posRadius: number
      overlayGone: boolean
    }>(page, `() => {
      const b = window.__warmCurrent
      const m = b.mode()
      const ob = b.state().orbitBuildings[0]
      // 点船坞原点点按 = 轨道编辑选中（overlay 未开时用轨道位兜底：绕地 96px 环 a=ob.a0+ωt）
      const obPos = m.blueprint.overlayView
        ? { x: m.blueprint.overlayView.gx, y: m.blueprint.overlayView.gy }
        : null
      let clickPt = obPos
      if (!clickPt) {
        const e = b.bodyPos(ob.anchor)
        const ang = ob.a0 + (0.5 / 96) * b.state().time
        clickPt = { x: e.x + Math.cos(ang) * 96, y: e.y + Math.sin(ang) * 96 }
      }
      b.pointerDown(clickPt.x, clickPt.y)
      b.pointerUp(clickPt.x, clickPt.y)
      const selected = !!m.blueprint.orbitSel && m.blueprint.orbitSel.kind === 'orbit'
      const ringBefore = m.blueprint.overlayView ? m.blueprint.overlayView.r : -1
      // 拖 ◇ 半径手柄：从手柄位拖到 r=300 的径向点（同角度）
      const ov = m.blueprint.overlayView
      const cx = ov.cx, cy = ov.cy
      const ang = Math.atan2(ov.gy - cy, ov.gx - cx)
      const target = { x: cx + Math.cos(ang) * 300, y: cy + Math.sin(ang) * 300 }
      b.pointerDown(ov.radX, ov.radY)
      b.pointerMove(target.x, target.y)
      b.pointerUp(target.x, target.y)
      const obAfter = b.state().orbitBuildings.find((x) => x.id === ob.id)
      // orbitBuildingPos 半径核对（当下位置距锚 = ringR）
      const e2 = b.bodyPos(ob.anchor)
      const posNow = m.blueprint.overlayView ? { x: m.blueprint.overlayView.gx, y: m.blueprint.overlayView.gy } : null
      const posRadius = posNow ? Math.hypot(posNow.x - e2.x, posNow.y - e2.y) : -1
      // 再点船坞取消选中
      const click2 = { x: cx + Math.cos(ang) * (obAfter.ringR ?? 96), y: cy + Math.sin(ang) * (obAfter.ringR ?? 96) }
      b.pointerDown(click2.x, click2.y)
      b.pointerUp(click2.x, click2.y)
      return {
        selected,
        ringBefore,
        applied: !!obAfter.ringR,
        ringAfter: obAfter.ringR ?? -1,
        posRadius,
        overlayGone: m.blueprint.orbitSel === null,
      }
    }`)
    expect(dragSnap.selected, '点轨道设施 = 轨道编辑选中').toBe(true)
    expect(dragSnap.ringBefore, '选中 overlay 显示当前环半径 96').toBeCloseTo(96, 0)
    expect(dragSnap.applied, '拖半径手柄松开 = 应用（写入 ringR）').toBe(true)
    expect(dragSnap.ringAfter, '环半径 96 → 300').toBeCloseTo(300, 0)
    expect(dragSnap.posRadius, '轨道设施当下位置随新环生效（距锚 300）').toBeCloseTo(300, 0)
    expect(dragSnap.overlayGone, '再点建筑取消选中').toBe(true)

    // ── 5. 退出蓝图台：回地球系，资产保留 ──
    await page.evaluate(`(() => { window.__warmCurrent.setRouteEditMode(false) })()`)
    await expect.poll(async () => {
      return page.evaluate(`(() => window.__warmCurrent.routeEditMode())()`)
    }, { message: '应退出轨道蓝图台', timeout: 5_000 }).toBe(false)
    const exitSnap = await evalInGame<{ viewMode: string; buildings: number; orbitDocks: number; routes: number }>(page, `() => {
      const b = window.__warmCurrent
      const s = b.state()
      return {
        viewMode: b.view().viewMode,
        buildings: s.buildings.length,
        orbitDocks: s.orbitBuildings.length,
        routes: s.routes.length,
      }
    }`)
    expect(exitSnap.viewMode, '退出回地球系取景').toBe('earth')
    expect(exitSnap.buildings, '轨道中转站保留').toBe(1)
    expect(exitSnap.orbitDocks, '船坞保留').toBe(1)
    expect(exitSnap.routes, '转移弧航线保留').toBe(1)
  })
})
