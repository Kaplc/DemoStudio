/**
 * OrbitBlueprintComponent — 轨道蓝图台组件（2026-09-29：航线编辑合并建造+航线的统一模式）
 *
 * 用户需求：点底部「编辑」进入全息俯视角 + 全息网格地图；允许把建筑放置在任意
 * 轨道上（轨道环吸附示意）；航线按真实火箭转移轨道弧连接放置的建筑；并支持 KSP 式
 * 的轨道蓝图编辑（拖动手柄实时改轨道半径/相位，松开应用）。
 * 2026-09-29 编辑合并：底部「建造」+「航线编辑」合并为「编辑」按钮直开本台并预选
 * 轨道放置工具（中转站）；建造面板独立入口下架（选型并入编辑台）。
 *
 * 职责（权威状态机，GameMode.routeEditMode = 开关；渲染层经 GameMode 只读投影消费）：
 *  - 模式进出：enter（关面板/清拖拽/切全息俯视取景）/ exit（回地球系取景）；
 *  - 轨道环吸附（orbitRingAt）：行星绕日轨道环 + 卫星绕母星轨道环的目录与就近吸附；
 *  - 轨道放置（updatePlaceGhost/placeAtGhost）：建造面板选型后 ghost 吸附轨道环，
 *    点按落位（buildings.tryPlaceOnOrbit，锚可为太阳）；
 *  - 轨道蓝图编辑（KSP 式）：点轨道设施/入轨建筑选中 → 半径/相位两个手柄拖拽实时
 *    预览 → 松开应用（buildings.setOrbit / orbitBuild.setOrbitRing）；
 *  - 点按 vs 拖线仲裁（noteDragClick）：链路建筑（中转站）按住拖 = 建航线（既有 UX），
 *    原点点按 = 切轨道编辑选中。
 *  - 显示口径（2026-09-29 用户决策：其他星球移除；二次决策：太阳移除 + 地球冻结不公转）：
 *    蓝图台 = 纯地月系工作台（BLUEPRINT_BODIES = earth/moon），吸附目录/命中判定/渲染
 *    显隐三处同源此常量；不做幕解锁门控。
 *  本组件不做渲染不做拾取射线（纯画布坐标几何），渲染 overlay 在 StarMapRenderComponent。
 */
import { BObjectComponent, audioSys, logger } from '@/engine'
import { B } from '../core/balance'
import {
  buildingDefOf, buildingPos, orbitBuildingPos, starPosAt,
} from '../core/helpers'
import { clampOrbitRadius } from './BuildingsComponent'
import type { PlanetBodyId } from '../core/types'
import type { Endpoint } from '../core/types'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

/** 轨道蓝图台中被选中做轨道编辑的天体引用（map = 地图建筑 / orbit = 轨道设施） */
export type BpOrbitRef = { kind: 'map'; id: number } | { kind: 'orbit'; id: number }

/** 轨道放置 ghost（吸附轨道环后的预览落点；valid/label 口径 = orbitPlacementIssue） */
export interface BpGhost {
  x: number
  y: number
  anchor: PlanetBodyId | 'sun'
  r: number
  a: number
  valid: boolean
  label: string
}

/** 轨道编辑 overlay 投影（渲染层消费；全部画布系坐标）：
 *  sel 环（当前轨道）+ 预览环（拖拽中 edit.r）+ 预览点 + 半径/相位两手柄位 */
export interface BpOverlay {
  cx: number
  cy: number
  /** 当前轨道半径（px；拖拽中不变，预览环用 edit.r） */
  r: number
  /** 拖拽中的实时预览（null = 未在拖拽：预览 = 当前轨道/当前相位） */
  edit: { r: number; a: number } | null
  /** 预览点（建筑将处位置：极坐标 (edit.r, edit.a)） */
  gx: number
  gy: number
  /** 半径手柄（预览点沿径向外推 26px） */
  radX: number
  radY: number
  /** 相位手柄（预览点沿切向前推 26px） */
  phX: number
  phY: number
}

/** 轨道环吸附半径（画布 px；光标距环 ≤ 此值即吸附） */
const ORBIT_SNAP_PX = 48
/** 手柄命中半径（画布 px） */
const HANDLE_HIT_PX = 30
/** 手柄离预览点的偏移（径向/切向，画布 px） */
const HANDLE_OFFSET_PX = 26

/** 轨道蓝图台保留的天体集（2026-09-29 用户决策：其他星球移除不显示；二次决策：太阳一并移除，
 *  地球冻结不公转——蓝图台 = 纯地月系工作台。渲染显隐（StarMapRenderComponent）、命中判定
 *  （MapHitTestComponent）与吸附目录（本组件 orbitRingAt，仅月球绕地环）三处同源此常量。
 *  剧情/幕系统另行重做，不做解锁门控。） */
export const BLUEPRINT_BODIES: ReadonlySet<string> = new Set(['earth', 'moon'])

export class OrbitBlueprintComponent extends BObjectComponent<WarmCurrentGameMode> {
  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'OrbitBlueprintComponent'
  }

  /** 轨道编辑选中的天体（null = 未选中） */
  orbitSel: BpOrbitRef | null = null
  /** 拖拽中的实时轨道预览（null = 未在拖拽） */
  edit: { r: number; a: number } | null = null
  /** 拖拽中的手柄（'radius' = 半径 / 'phase' = 相位；null = 未拖拽） */
  dragging: 'radius' | 'phase' | null = null
  /** 轨道放置 ghost（建造面板选型 + 指针吸附轨道环；null = 无工具/指针不在环上） */
  ghost: BpGhost | null = null

  // ─── 模式进出（GameMode.toggleRouteEditMode 调用） ───

  /** 进入轨道蓝图台：清拖拽与面板 → 切全息俯视取景 */
  enter(): void {
    const m = this.owner
    m.drag = null
    m.panels.closePlanetInfo()
    m.panels.closeOrbitBuild()
    m.cancelBuildMode()
    m.setHoloTool(null)
    m.view.enterBlueprintView()
    m.feedback.toast('编辑台：拖天体/建筑建航线 · 点轨道环放置建筑 · 点轨道设施编辑轨道', '#7fdcff')
    audioSys.play('wc.ok', { volume: 0.5 })
    logger.info('[OrbitBlueprint] 编辑台进入（全息俯视 + 网格 + 轨道示意）')
  }

  /** 退出轨道蓝图台：清编辑态 → 回地球系默认取景 */
  exit(): void {
    this.orbitSel = null
    this.edit = null
    this.dragging = null
    this.ghost = null
    const m = this.owner
    m.drag = null
    m.view.exitBlueprintView()
    m.feedback.toast('轨道蓝图台已退出 — 点星球查看信息', '#9fc4d8')
    audioSys.play('wc.ok', { volume: 0.3 })
    logger.info('[OrbitBlueprint] 轨道蓝图台退出')
  }

  /** 重开/读档清理（不动相机不动面板） */
  resetState(): void {
    this.orbitSel = null
    this.edit = null
    this.dragging = null
    this.ghost = null
  }

  // ─── 轨道环目录与吸附 ───

  /** 可放置轨道环就近吸附（画布坐标 p）：月球绕地环（锚 = 地球）。null = 光标不在环附近。
   *  2026-09-29 二次决策：太阳移除 + 地球冻结 → 行星绕日环整体退场（含地球绕日环），
   *  吸附目录只剩地月系卫星环。 */
  orbitRingAt(p: { x: number; y: number }): { anchor: PlanetBodyId | 'sun'; r: number; a: number } | null {
    const s = this.owner.simState.state
    let best: { anchor: PlanetBodyId | 'sun'; r: number; a: number } | null = null
    let bestD = ORBIT_SNAP_PX
    // 卫星绕母星环（锚 = 母星：建筑绕母星公转、与卫星共享环带）；BLUEPRINT_BODIES 过滤后只剩月球
    for (const [mid, mc] of Object.entries(B.map.moons)) {
      if (!BLUEPRINT_BODIES.has(mid)) continue
      const c = starPosAt(s, mc.parent)
      const d = Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - mc.radius)
      if (d < bestD) {
        bestD = d
        best = { anchor: mc.parent, r: mc.radius, a: Math.atan2(p.y - c.y, p.x - c.x) }
      }
    }
    return best
  }

  /** 刷新轨道放置 ghost（建造面板选型 + 蓝图态指针移动调用；点空处 = 清 ghost） */
  updatePlaceGhost(p: { x: number; y: number }): void {
    const m = this.owner
    if (!m.buildMode) {
      this.ghost = null
      return
    }
    const snap = this.orbitRingAt(p)
    if (!snap) {
      this.ghost = null
      return
    }
    const typeId = m.buildMode.typeId
    const rc = clampOrbitRadius(snap.anchor, snap.r)
    const c = starPosAt(m.simState.state, snap.anchor)
    const issue = m.buildings.orbitPlacementIssue(typeId, snap.anchor, snap.r, snap.a)
    const def = buildingDefOf(typeId)
    this.ghost = {
      x: c.x + Math.cos(snap.a) * rc,
      y: c.y + Math.sin(snap.a) * rc,
      anchor: snap.anchor,
      r: rc,
      a: snap.a,
      valid: issue === null,
      label: issue ?? `${def?.name ?? typeId} · ${def?.cost ?? '?'} H3 · 轨道 ${Math.round(rc)}`,
    }
  }

  /** 点按落位（GameMode.onMapPointerDown 蓝图放置分支）：ghost 合法才落；
   *  返回是否已消费（落位成功或非法点击都算消费——非法给 hint 留在工具中）。 */
  placeAtGhost(): boolean {
    const m = this.owner
    if (!m.buildMode) return false
    const g = this.ghost
    if (!g) {
      m.feedback.toast('轨道放置：先把指针移到轨道环附近（青色示意环）', '#9fc4d8')
      return true
    }
    if (!g.valid) return true
    const id = m.buildings.tryPlaceOnOrbit(m.buildMode.typeId, g.anchor, g.r, g.a)
    if (id !== null) {
      logger.info(`[OrbitBlueprint] 轨道放置成功 building#${id}（锚 ${g.anchor} r=${Math.round(g.r)}）`)
    }
    return true
  }

  // ─── 轨道蓝图编辑（KSP 式手柄） ───

  /** 选中引用的轨道环几何（null = 引用失效：建筑被拆/未入轨） */
  private refRing(ref: BpOrbitRef): { anchor: PlanetBodyId | 'sun'; r: number; cx: number; cy: number; bx: number; by: number } | null {
    const s = this.owner.simState.state
    if (ref.kind === 'map') {
      const b = s.buildings.find((x) => x.id === ref.id)
      if (!b || !b.anchor || b.surface) return null
      const c = starPosAt(s, b.anchor)
      const p = buildingPos(s, b)
      return { anchor: b.anchor, r: b.orbitR ?? clampOrbitRadius(b.anchor, 60), cx: c.x, cy: c.y, bx: p.x, by: p.y }
    }
    const ob = s.orbitBuildings.find((x) => x.id === ref.id)
    if (!ob) return null
    const c = starPosAt(s, ob.anchor)
    const p = orbitBuildingPos(s, ob)
    return { anchor: ob.anchor, r: ob.ringR ?? B.orbitBuild.ringRadius, cx: c.x, cy: c.y, bx: p.x, by: p.y }
  }

  /** 选中引用的当前公转角（rad；与位置口径同一纯时间函数） */
  private angleOf(ref: BpOrbitRef): number | null {
    const s = this.owner.simState.state
    const ring = this.refRing(ref)
    if (!ring) return null
    const ang = Math.atan2(ring.by - ring.cy, ring.bx - ring.cx)
    return ang
  }

  /** 点轨道设施 / 入轨建筑 → 轨道编辑引用（地表建筑/静态建筑不参与轨道编辑）。
   *  ⚠ 链路建筑（中转站）不在此选中——按住拖 = 建航线是核心循环（拖线优先），
   *  其轨道编辑选中走 noteDragClick（拖线原点点按仲裁）。 */
  selectRefAt(p: { x: number; y: number }): BpOrbitRef | null {
    const m = this.owner
    const ob = m.hit.orbitBuildingAt(p)
    if (ob) return { kind: 'orbit', id: ob.id }
    const b = m.hit.buildingAt(p)
    if (b && b.anchor && !b.surface) {
      if (buildingDefOf(b.type)?.linkable) return null
      return { kind: 'map', id: b.id }
    }
    return null
  }

  /** 蓝图态指针按下（GameMode.onMapPointerDown 消费式调用）：点建筑本体 = 取消选中，
   *  其余手柄拖拽优先，其次切换选中 */
  onPointerDown(p: { x: number; y: number }): boolean {
    if (this.orbitSel) {
      // 建筑本体点按（≤20px，手柄抓取区从本体 20px 外起——半径手柄悬在 +26px 处）
      const ring = this.refRing(this.orbitSel)
      if (ring && Math.hypot(p.x - ring.bx, p.y - ring.by) <= 20) {
        this.orbitSel = null
        this.edit = null
        logger.info('[OrbitBlueprint] 点建筑本体 → 轨道编辑取消选中')
        audioSys.play('wc.draw', { volume: 0.3 })
        return true
      }
      const h = this.handleHitAt(p)
      if (h) {
        this.beginDrag(h)
        return true
      }
    }
    const ref = this.selectRefAt(p)
    if (ref) {
      if (this.sameRef(ref, this.orbitSel)) {
        this.orbitSel = null
        this.edit = null
        logger.info('[OrbitBlueprint] 轨道编辑取消选中')
      } else {
        this.orbitSel = ref
        this.edit = null
        logger.info(`[OrbitBlueprint] 轨道编辑选中 ${ref.kind}#${ref.id}（拖手柄调轨道 · 再点取消）`)
      }
      audioSys.play('wc.draw', { volume: 0.3 })
      return true
    }
    return false
  }

  /** 拖线原点点按仲裁（GameMode.onMapPointerUp 调用）：按住在入轨建筑上未拖动 =
   *  切轨道编辑选中（而非"站→自己"的非法航线报错）。返回是否已消费。 */
  noteDragClick(from: Endpoint, hover: Endpoint): boolean {
    if (from.kind !== 'building' || hover.kind !== 'building') return false
    if (from.buildingId !== hover.buildingId) return false
    const b = this.owner.simState.state.buildings.find((x) => x.id === from.buildingId)
    if (!b || !b.anchor || b.surface) return false
    const ref: BpOrbitRef = { kind: 'map', id: b.id }
    if (this.sameRef(ref, this.orbitSel)) {
      this.orbitSel = null
      this.edit = null
    } else {
      this.orbitSel = ref
      this.edit = null
    }
    audioSys.play('wc.draw', { volume: 0.3 })
    logger.info(`[OrbitBlueprint] 点按建筑#${b.id} → 轨道编辑选中态 ${!!this.orbitSel}`)
    return true
  }

  private sameRef(a: BpOrbitRef | null, b: BpOrbitRef | null): boolean {
    if (!a || !b) return false
    return a.kind === b.kind && a.id === b.id
  }

  /** 手柄命中（画布坐标 p → 'radius' | 'phase'；都未命中 null）。两手柄都命中取更近者。 */
  handleHitAt(p: { x: number; y: number }): 'radius' | 'phase' | null {
    const ov = this.overlayView
    if (!ov) return null
    const dRad = Math.hypot(p.x - ov.radX, p.y - ov.radY)
    const dPh = Math.hypot(p.x - ov.phX, p.y - ov.phY)
    if (dRad > HANDLE_HIT_PX && dPh > HANDLE_HIT_PX) return null
    return dRad <= dPh ? 'radius' : 'phase'
  }

  /** 开始拖拽（记录预览起点 = 当前轨道/相位） */
  beginDrag(part: 'radius' | 'phase'): void {
    if (!this.orbitSel) return
    const ring = this.refRing(this.orbitSel)
    const a = this.angleOf(this.orbitSel)
    if (!ring || a === null) return
    this.edit = { r: ring.r, a }
    this.dragging = part
    logger.info(`[OrbitBlueprint] 轨道拖拽开始（${part} 手柄，r=${Math.round(ring.r)}）`)
  }

  /** 拖拽更新（GameMode.onMapPointerMove 消费式调用；返回是否处于拖拽中）：
   *  半径手柄 = 光标到环心距离（钳制）；相位手柄 = 光标方位角。 */
  onDragMove(p: { x: number; y: number }): boolean {
    if (!this.dragging || !this.orbitSel || !this.edit) return false
    const ring = this.refRing(this.orbitSel)
    if (!ring) return true
    const d = Math.hypot(p.x - ring.cx, p.y - ring.cy)
    const ang = Math.atan2(p.y - ring.cy, p.x - ring.cx)
    this.edit = this.dragging === 'radius'
      ? { r: clampOrbitRadius(ring.anchor, d), a: this.edit.a }
      : { r: this.edit.r, a: ang }
    return true
  }

  /** 拖拽收尾（GameMode.onMapPointerUp 消费式调用；返回是否刚结束一次拖拽）：
   *  应用半径/相位到权威状态（视觉角连续口径见各 setOrbit*）。 */
  endDragApply(): boolean {
    if (!this.dragging) return false
    const e = this.edit
    const ref = this.orbitSel
    this.dragging = null
    this.edit = null
    if (!e || !ref) return true
    const ok = ref.kind === 'map'
      ? this.owner.buildings.setOrbit(ref.id, e.r, e.a)
      : this.owner.orbitBuild.setOrbitRing(ref.id, e.r, e.a)
    if (ok) {
      audioSys.play('wc.ok', { volume: 0.4 })
      logger.info(`[OrbitBlueprint] 轨道编辑应用 ${ref.kind}#${ref.id} → r=${Math.round(e.r)} θ=${((e.a * 180) / Math.PI).toFixed(0)}°`)
    }
    return true
  }

  // ─── 渲染投影（GameMode getter 转发 StarMapRenderComponent 消费） ───

  /** 放置 ghost 投影（渲染层只需位置/合法性/文案） */
  get ghostView(): { x: number; y: number; valid: boolean; label: string } | null {
    return this.ghost ? { x: this.ghost.x, y: this.ghost.y, valid: this.ghost.valid, label: this.ghost.label } : null
  }

  /** 轨道编辑 overlay 投影（null = 无选中/引用失效） */
  get overlayView(): BpOverlay | null {
    if (!this.orbitSel) return null
    const ring = this.refRing(this.orbitSel)
    if (!ring) return null
    const e = this.edit ?? { r: ring.r, a: this.angleOf(this.orbitSel) ?? 0 }
    const gx = ring.cx + Math.cos(e.a) * e.r
    const gy = ring.cy + Math.sin(e.a) * e.r
    // 径向/切向单位向量（径向朝外 = 升轨方向；切向 = 公转前进方向）
    const rx = gx - ring.cx
    const ry = gy - ring.cy
    const rl = Math.hypot(rx, ry) || 1
    const tx = -ry / rl
    const ty = rx / rl
    return {
      cx: ring.cx,
      cy: ring.cy,
      r: ring.r,
      edit: this.edit ? { r: e.r, a: e.a } : null,
      gx, gy,
      radX: gx + (rx / rl) * HANDLE_OFFSET_PX,
      radY: gy + (ry / rl) * HANDLE_OFFSET_PX,
      phX: gx + tx * HANDLE_OFFSET_PX,
      phY: gy + ty * HANDLE_OFFSET_PX,
    }
  }

  /** HUD 提示文案（vm.blueprintHint；随子状态切换） */
  hint(): string {
    const m = this.owner
    if (m.buildMode) return '轨道放置：点轨道环落位（Esc 取消）· 指针靠近青色示意环自动吸附'
    if (this.dragging) return '轨道编辑：拖动手柄调整轨道 · 松开应用'
    if (this.orbitSel) return '轨道编辑：拖 ◇ 半径手柄升降轨道 · 拖 ▫ 相位手柄沿环转动 · 再点建筑取消'
    return '编辑台：拖天体/建筑建航线（真实转移轨道）· 点轨道环放置已选中建筑 · 点轨道设施编辑轨道'
  }
}
