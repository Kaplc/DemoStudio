/**
 * ViewDirectorComponent — 星图视图/相机决策组件（GameMode 上的组件位；2026-09-20 自 WarmCurrentGameMode 下沉）
 *
 * 职责（原 WarmCurrentGameMode 视图方法原样迁入）：
 *  - 视图状态权威：viewMode（earth 行星系跟随 / solar 太阳系全景）/ planetFocusBody
 *    / observeBody（行星/卫星观察）/ viewSwitching（切换防重入）/ viewLoadingPanel（加载遮罩）
 *    / moonAngleAtLeave（月球相位回拨记录）；
 *  - 取景：focusSolarSystem（恒斜视角 + 月球相位对齐）/ applyViewMode（视图隔离缩放边界）
 *    / switchView（加载遮罩先上屏防穿帮）/ viewStageOffset（世界→画布位移，指针拾取共用）；
 *  - 观察态：enterPlanetObserve/enterMoonObserve/exitPlanetObserve/clearObserveState
 *    （清观察态不动镜头——面板关闭保持玩家视角，见 memory:warm_panel_close_camera_semantics）
 *    / applyFocusCameraMode（聚焦环绕 vs 自由平移交互语义）/ applyZoomFloor（贴球缩放下限）
 *    / applyObserveBoost（行星特写大气增益）/ tickObserveFollow（卫星原地转头逐帧跟随）；
 *  - 滚轮落点平移的 warm 状态注入（attachScrollPan：候选/门槛/观察态重锁定语义）。
 *  兼容：GameMode 保留薄转发与只读 getter，Controller/渲染/e2e 调用面不变。
 */
import * as THREE from 'three'
import { AtmosphereComponent, BObjectComponent, audioSys, logger } from '@/engine'
import { B, toWX, toWZ } from '../core/balance'
import type { SolarFocusBody } from '../core/balance'
import { alignMoonRelativeAngle, moonRelativeAngle, starPosAt } from '../core/helpers'
import type { SolarBodyId } from '../core/helpers'
import type { MoonId, PlanetId } from '../core/types'
import { planetStageOffset } from '../map/StarMapRenderComponent'
import type { StarBodyId } from '../map/StarActor'
import { PLANET_NAMES } from '../core/planetNames'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

/** 视图切换加载遮罩 widget 资产（2026-09-20 随 switchView 自 GameMode 迁入） */
const VIEW_LOADING_WIDGET = 'asset/blueprints/ui/view_loading.widget.json'

export class ViewDirectorComponent extends BObjectComponent<WarmCurrentGameMode> {
  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'ViewDirectorComponent'
  }

  /** 星图视角模式：earth = 行星系跟随取景（聚焦 planetFocusBody，开局默认地球系），solar = 太阳系全景 */
  viewMode: 'earth' | 'solar' = 'earth'
  /** 行星系视角当前聚焦的行星（viewMode='earth' 时生效；太阳系全景忽略） */
  planetFocusBody: SolarBodyId = 'earth'
  /** 离开地球系时记录的月球相对相位（rad；null = 无待回拨），切回地球系时对齐用 */
  private moonAngleAtLeave: number | null = null
  /** 视图切换进行中（加载遮罩已上屏、镜头尚未跳转）：期间忽略重复切换（e2e 桥只读） */
  viewSwitching = false
  /** 当前加载遮罩面板（null = 无；e2e 断言切换收尾后必须归零） */
  viewLoadingPanel: import('@/engine').Actor | null = null

  /** 行星观察模式当前观察的天体（null = 未在观察；行星系内双击聚焦进入，Esc 退出。
   *  2026-09-15 聚焦环绕改版：卫星（月球）也可双击聚焦观察，类型放宽到 MoonId） */
  observeBody: PlanetId | MoonId | null = null
  /** 卫星观察逐帧跟随的上一帧位置（null = 无跟随； observeBody 为卫星时每帧把注视点
   *  rig.target.x/z 拉向卫星实时位（原地转头，相机不动），跟随卫星公转漂移） */
  private observeFollowLast: { x: number; z: number } | null = null


  /** 滚轮落点平移的 warm 状态注入（GameMode 构造后调用）：候选 = 聚焦行星 + 本系卫星
   *  （球心取 Actor 实时位，半径取 B.map.nodes），门槛 = 行星系视角且非切换中
   *  （瞄准滑移由组件自查 isAiming） */
  attachScrollPan(): void {
    // 滚轮落点平移组件的 warm 状态注入：候选 = 聚焦行星 + 本系卫星（球心取 Actor 实时位，
    // 半径取 B.map.nodes），门槛 = 行星系视角且非切换中（瞄准滑移由组件自查 isAiming）
    this.owner.cameraActor.scrollPan.source = {
      candidates: () => {
        const focus = this.planetFocusBody as PlanetId
        const out: Array<{ id: StarBodyId; pos: THREE.Vector3; r: number }> = []
        const focusActor = this.owner.starActors.get(focus)
        if (focusActor) out.push({ id: focus, pos: focusActor.root.position, r: B.map.nodes[focus].r })
        for (const [id, mc] of Object.entries(B.map.moons)) {
          if (mc.parent !== focus) continue
          const a = this.owner.starActors.get(id as StarBodyId)
          if (a) out.push({ id: id as StarBodyId, pos: a.root.position, r: B.map.nodes[id as StarBodyId].r })
        }
        return out
      },
      allowed: () => (this.viewMode === 'earth' || this.owner.routeEditMode) && !this.viewSwitching,
      // 共享锁定变量（2026-09-20 用户口径）：滚轮拉近锁定的目标即唯一锁定变量 rig.target，
      // 观察态（双击/滚轮建立）内滚轮重新锁定 → warm 跟随对象同步切换；俯视态保持落点
      // 平移定版语义（只写 rig.target，不扰地图交互/不进观察）；空目标 → 观察软退出
      onLock: (id) => {
        if (this.viewMode !== 'earth' || this.viewSwitching) return
        if (id === null) {
          // 空目标（黄道落点）：观察态软退出——observeBody 归零 + 语义回落默认（左键回
          // 地图交互），不做 focusSolarSystem 复位取景（镜头位置/注视点归滚轮锁定）
          if (this.observeBody) {
            this.observeBody = null
            this.observeFollowLast = null
            this.owner.pendingObserveClick = null
            this.owner.cameraActor.rig.leftOrbitEnabled = false
            this.owner.cameraActor.rig.orbitMode = true
            logger.info('[WarmCurrent] 滚轮锁定空目标：观察态软退出（镜头归滚轮）')
          }
          return
        }
        // 俯视态：落点平移定版——锁定只写 rig.target（组件已写），观察态不动
        if (!this.observeBody) return
        // 观察态内重新锁定：跟随对象切换（观察语义开关已就位，只换对象 + 缩放下限贴新目标）
        if (B.map.moons[id as keyof typeof B.map.moons]) {
          if (this.observeBody !== id) {
            this.resetObserveBoost()
            this.observeBody = id as MoonId
            const a = this.owner.starActors.get(id as StarBodyId)
            this.observeFollowLast = a ? { x: a.root.position.x, z: a.root.position.z } : null
            this.applyZoomFloor(B.map.nodes[id as StarBodyId].r)
            logger.info(`[WarmCurrent] 滚轮锁定卫星：跟随切换 → ${PLANET_NAMES[id] ?? id}`)
          }
        } else if (id === this.planetFocusBody) {
          if (this.observeBody !== id) {
            this.resetObserveBoost()
            this.observeBody = id as PlanetId
            this.observeFollowLast = null
            this.applyZoomFloor(B.map.nodes[id as PlanetId].r)
            logger.info(`[WarmCurrent] 滚轮锁定聚焦体：跟随切换 → ${PLANET_NAMES[id] ?? id}`)
          }
        } else {
          // 非本系天体不会出现在候选里，防御性忽略
          logger.warn(`[WarmCurrent] 滚轮锁定忽略非候选天体：${id}`)
        }
      },
    }
  }

  /** 卫星观察逐帧跟随（GameMode.Tick 同位调用；2026-09-15 五版·原地转头口径）：
   *  双击聚焦卫星后逐帧把注视点 rig.target 拉向卫星实时位（lookAt 随之摆动，
   *  相机位置不动——位置归玩家），与全息卫星跟随（pan 口径，保持环绕几何）刻意不同。
   *  观察行星不参与（舞台钉扎静态，注视点恒在舞台中心）。 */
  tickObserveFollow(): void {
    if (!this.observeBody) return
    const mc = B.map.moons[this.observeBody as keyof typeof B.map.moons]
    const actor = mc ? this.owner.starActors.get(this.observeBody as StarBodyId) : undefined
    if (actor) {
      const p = actor.root.position
      // 滑移进行中不写 target：aimAt 锚点闭包每帧取卫星实时位，滑移自身跟踪公转（双重移动会打架）
      if (this.observeFollowLast && !this.owner.cameraActor.isAiming()) {
        this.owner.cameraActor.rig.target.set(p.x, this.owner.cameraActor.rig.target.y, p.z)
        this.owner.cameraActor.SyncCameraLook()
      }
      this.observeFollowLast = { x: p.x, z: p.z }
    }
  }

  /** 重开/读档收口：月球相位回拨记录归零 + 清观察态 */
  resetForRestart(): void {
    this.moonAngleAtLeave = null
    this.clearObserveState()
  }

  // ═══════════════════════════════════════════
  //  太阳系取景（sol GM 命令 + 缩放相机）
  // ═══════════════════════════════════════════

  /** 地球系视图拉远上限（距离）：独立小星系取景（月球轨道 1200：全景 5200 全入画留边）。
   *  拉近下限不设静态值：applyViewMode 按聚焦天体半径动态贴合（applyZoomFloor ×1.15）。 */
  private static readonly EARTH_VIEW_MAX_DIST = 5200

  /** 轨道蓝图台俯视取景距离：地月系工作台入画（月球环 1200px 为视野主体；玩家可滚轮拉远） */
  private static readonly BLUEPRINT_VIEW_DIST = 4600

  /** 进入轨道蓝图台俯视取景（2026-09-29 轨道蓝图台）：近垂直俯视（88°），
   *  全息网格 + 轨道环示意的镜头基础。这是 2026-09-14「锁定地球视角」后唯一合法的
   *  太阳系全景进入路径（旧全景按钮/点太阳路径仍保持屏蔽）。
   *  2026-09-29 二次决策：太阳移除 + 地球冻结不公转 → 取景中心 = 冻结的地球
   *  （纯地月系工作台），不再对准日心。 */
  enterBlueprintView(): void {
    if (this.viewSwitching) return
    // 月球相位回拨记账（离开地月系，回地球系时对齐——与 focusSolarSystem 同口径）
    if (this.viewMode === 'earth' && this.planetFocusBody === 'earth') {
      this.moonAngleAtLeave = moonRelativeAngle(this.owner.simState.state)
    }
    this.viewMode = 'solar'
    this.applyViewMode()
    this.clearObserveState()
    // 近垂直俯视（88°，90° 会与 up=(0,1,0) 平行使 lookAt 退化）：轨道环读成圆，
    // KSP 式蓝图编辑的几何基准
    const ep = starPosAt(this.owner.simState.state, 'earth')
    this.owner.cameraActor.observeFocus(toWX(ep.x), toWZ(ep.y), ViewDirectorComponent.BLUEPRINT_VIEW_DIST, THREE.MathUtils.degToRad(88))
    this.applyFocusCameraMode(true)
    logger.info(`[WarmCurrent] 轨道蓝图台取景：地月系俯视（心 = 地球）dist=${ViewDirectorComponent.BLUEPRINT_VIEW_DIST} pitch=88°`)
  }

  /** 退出轨道蓝图台取景：回地球系默认聚焦取景（模式级退出重取景，同 exitPlanetObserve 口径；
   *  focusSolarSystem 顺带完成月球相位对齐与相机交互语义回落） */
  exitBlueprintView(): void {
    this.focusSolarSystem('earth')
    logger.info('[WarmCurrent] 轨道蓝图台取景退出（回地球系）')
  }

  /** 聚焦指定天体（内部机制保留供 e2e/开发直调；玩家入口已于 2026-09-14 全部屏蔽）：
   *  太阳 = 太阳系全景；行星 = 进入其行星系（跟随取景）。机位数学在 SolarCameraActor.observeFocus（恒斜视角）。 */
  focusSolarSystem(body: SolarFocusBody): void {
    const toSolar = body === 'sun'
    // 月球相位对齐（仅地月系）：离开地月系时记录相位，切回地月系（含从其它行星系切回）时拨回
    const leavingEarthSys = this.viewMode === 'earth' && this.planetFocusBody === 'earth'
    const enteringEarthSys = !toSolar && body === 'earth'
    if (leavingEarthSys && !enteringEarthSys) this.moonAngleAtLeave = moonRelativeAngle(this.owner.simState.state)
    if (enteringEarthSys && this.moonAngleAtLeave !== null) {
      alignMoonRelativeAngle(this.owner.simState.state, this.moonAngleAtLeave)
      this.moonAngleAtLeave = null
    }
    if (!toSolar) this.planetFocusBody = body
    this.viewMode = toSolar ? 'solar' : 'earth'
    this.applyViewMode()
    // 取景距离随星体尺寸：太阳 1000（中景看内系统：水/金/地轨道入画），地球 3200（月球环 1200 全入画留边），其余行星 220
    const d = body === 'sun' ? 1000 : body === 'earth' ? 3200 : 220
    // 行星系取景目标 = 舞台中心（行星会被渲染钉在舞台中心，镜头只是切区）
    const off = this.viewMode === 'earth' ? planetStageOffset(this.planetFocusBody as PlanetId) : { x: 0, z: 0 }
    // 任何取景切换统一退出观察态（切太阳/切行星系/视角按钮都会走到这里）
    this.clearObserveState()
    // 恒斜视角取景（2026-09-14 移除垂直俯视）：地球 3200 斜视地月系，太阳 1000 斜视内系统
    this.owner.cameraActor.observeFocus(off.x, off.z, d)
    // 相机交互语义随视图收敛（2026-09-15 聚焦环绕改版）：行星系聚焦 = 环绕，太阳系全景 = 自由平移
    this.applyFocusCameraMode(toSolar)
    logger.info(`[WarmCurrent] 太阳系取景 → ${body} (dist=${d}, mode=${this.viewMode}，斜视角)`)
  }

  /** 行星系聚焦默认相机交互语义（2026-09-15 聚焦环绕改版）：
   *  行星系聚焦态（body ≠ sun）：右键拖拽 = 绕聚焦天体环绕（orbitMode），滚轮缩放不变；
   *  屏蔽空间自由平移——右键平移被环绕取代，边缘平移关闭（防拖走注视点破坏聚焦）；
   *  左键环绕关闭（leftOrbitEnabled=false），左键留给地图交互（耀斑框选/拖线仍可用）。
   *  太阳系全景：保持历史自由平移（右键平移 + 边缘平移；玩家入口已屏蔽，仅内部/e2e 可达）。
   *  观察态（enterPlanetObserve/enterMoonObserve/openHologram）在取景后自行开左键环绕。 */
  private applyFocusCameraMode(solar: boolean): void {
    const rig = this.owner.cameraActor.rig
    rig.orbitMode = !solar
    rig.leftOrbitEnabled = false
    rig.setEdgePanEnabled(solar)
    logger.info(`[WarmCurrent] 聚焦相机语义：${solar ? '太阳系全景（右键/边缘自由平移）' : '行星系聚焦环绕（右键环绕 · 滚轮缩放 · 边缘平移关 · 左键留地图交互）'}`)
  }

  /** 清观察态（不做取景复位）：observeBody 归零 + 相机交互回落视图默认语义
   *  （applyFocusCameraMode：行星系 = 聚焦环绕，太阳系 = 自由平移）+ 复位特写增益。
   *  全息勘探/卫星观察同语义互斥收口（hologramSel 归零共用）。
   *  取景切换 / 重开 / 读档三条退出路径共用，保证清理不漏。 */
  clearObserveState(): void {
    if (!this.observeBody && !this.owner.holo.hologramSel) return
    this.observeBody = null
    this.owner.pendingObserveClick = null
    this.owner.holo.clearTransient()
    this.observeFollowLast = null
    this.applyFocusCameraMode(this.viewMode === 'solar')
    this.resetObserveBoost()
  }


  /** 缩放下限贴球心（2026-09-15 贴地缩放）：min 距离 = 天体显示半径 × 1.15。
   *  注视点抬到球心高度（StarActor 球心 y = r×0.55）后，任意环绕俯仰角相机到球面
   *  都保有 ≥15% 半径余量——滚轮可一路贴近星球表面而不穿入球体。下限 24 防小微天体过近。 */
  applyZoomFloor(bodyR: number): void {
    this.owner.cameraActor.rig.minDistance = Math.max(24, bodyR * 1.15)
  }

  /** 视图模式 → 相机缩放边界（视图隔离：地球系锁死地月尺度，滚轮拉远也只见地月；
   *  拉近下限 = 聚焦天体半径动态贴合，贴地特写） */
  private applyViewMode(): void {
    const solar = this.viewMode === 'solar'
    const rig = this.owner.cameraActor.rig
    const focusR = solar ? B.map.nodes.sun.r : B.map.nodes[this.planetFocusBody as PlanetId].r
    this.applyZoomFloor(focusR)
    rig.maxDistance = solar ? 12000 : ViewDirectorComponent.EARTH_VIEW_MAX_DIST
    // 星图渲染分组同步切换（其它行星/轨道/太阳光晕显隐）
    this.owner.starMap?.setViewMode(this.viewMode)
    logger.info(`[WarmCurrent] 视图隔离：${solar ? `太阳系全景（缩放 ${this.owner.cameraActor.rig.minDistance.toFixed(0)}~12000）` : `地球系小星系（缩放 ${this.owner.cameraActor.rig.minDistance.toFixed(0)}~${ViewDirectorComponent.EARTH_VIEW_MAX_DIST}，只见地月）`}`)
  }

  /** 视角切换（历史 ViewToggle widget 按钮路径；2026-09-14 起 widget 已下架，仅存作兼容入口）：
   *  solar = 已屏蔽（视角锁定地球系）；earth = 回地球系默认取景。
   *  ⚠ 按钮路径绕过 enterPlanetSystem 的观察 toggle：已在地球系 = 复位默认斜视取景，不进观察 */
  setViewMode(mode: 'earth' | 'solar'): void {
    if (this.viewSwitching) return
    if (mode === 'solar') {
      logger.warn('[WarmCurrent] 太阳系全景视角已屏蔽（2026-09-14 锁定地球视角），忽略 setViewMode(\'solar\')')
      return
    }
    if (this.viewMode === 'earth' && this.planetFocusBody === 'earth') {
      // 已在地球系：复位默认斜视取景（观察态由 focusSolarSystem 统一清理）
      this.focusSolarSystem('earth')
      return
    }
    this.switchView('earth')
  }



  /** 双击行星（2026-09-14 视角锁定地球系：仅地球响应——双击地球 = 切换行星观察视角；
   *  双击其它行星不再切换行星系，仅提示）。 */
  enterPlanetSystem(body: SolarBodyId): void {
    if (body !== 'earth') {
      logger.warn(`[WarmCurrent] 行星系切换已屏蔽（2026-09-14 锁定地球视角），忽略双击 → ${body}`)
      return
    }
    // 切换进行中忽略（450ms 窗口内 toggle 会先观察再被延迟取景清掉，镜头闪跳）
    if (this.viewSwitching) return
    if (this.viewMode === 'earth' && this.planetFocusBody === body) {
      // 已在该行星系：双击 = 切换观察视角（未观察 → 进入环绕；观察中 → 退出回俯视）
      if (this.observeBody === body) this.exitPlanetObserve()
      else this.enterPlanetObserve(body as PlanetId)
      return
    }
    this.switchView(body)
  }


  /** 进入行星观察视角：斜对准行星（3D 环绕，左键/右键拖拽旋转，Esc 退出回俯视取景）。
   *  （2026-09-15 三版）聚焦只切瞄准点不飞镜头：保持玩家当前距离与姿态，滚轮控制远近。
   *  ⚠ 仅限当前行星系内：不在该行星系时忽略（跨系观察先双击进入行星系） */
  enterPlanetObserve(body: PlanetId): void {
    if (this.viewMode !== 'earth' || this.planetFocusBody !== body) return
    // 与全息勘探互斥：全息中先退出（保持相机原位不重新取景，随后观察重新取景）
    if (this.owner.hologramSel) this.owner.closeHologram()
    // 建筑/航线编辑模式与观察互斥（左键在观察中是环绕拖拽，不能同时落位/拖线）
    if (this.owner.buildMode) this.owner.cancelBuildMode()
    if (this.owner.routeEditMode) this.owner.toggleRouteEditMode()
    this.observeBody = body

    const rig = this.owner.cameraActor.rig
    // 观察距离 = 节点半径 × 4；缩放下限贴球心（可滚到近乎贴着行星表面）
    const r = B.map.nodes[body].r
    // 定位用舞台偏移权威值（右键平移过地图时 rig.target 已偏离舞台，不可作锚点）
    const stage = planetStageOffset(body)
    // 边缘平移会拖走注视点破坏环绕，观察期间关闭（退出/切视图时恢复）
    rig.setEdgePanEnabled(false)
    // 注视点 = 球心高度（StarActor 球心 y = r×0.55）：特写行星屏幕居中，缩放下限以球心计量
    this.applyZoomFloor(r)
    // 聚焦看向（2026-09-15 七版·群星式滚动吸附）：边转头边把距离收拢到取景距离（r×4），
    // 行星舞台钉扎静态 → 锚点闭包直接返回固定点
    this.owner.cameraActor.aimAt(() => new THREE.Vector3(stage.x, r * 0.55, stage.z), r * 4)
    rig.orbitMode = true
    // 观察态星图点击判定冻结，左键空闲 → 左键拖拽也环绕（双键环绕，历史交互不变）
    rig.leftOrbitEnabled = true
    // 行星钉在舞台中心（静态），无公转跟随
    this.observeFollowLast = null
    // 特写观感增强：被观察行星的大气提亮（组件在无此挂载的天体上自动跳过）
    this.applyObserveBoost(body)
    audioSys.play('wc.ok', { volume: 0.4 })
    logger.info(`[WarmCurrent] 行星观察：${PLANET_NAMES[body] ?? body}（拖拽环绕 · 滚轮缩放 · Esc/再双击退出）`)

  }

  /** 进入卫星观察视角（2026-09-15 聚焦环绕改版）：双击卫星（月球）聚焦，镜头转头看向卫星，
   *  并在 Tick 逐帧把注视点拉向卫星（原地转头跟随公转漂移，相机位置不动）；
   *  Esc/再双击退出回行星系默认聚焦取景。卫星无大气壳，进入时统一复位特写增益
   *  （从行星观察切换过来时清掉该行星的 ×1.8 增益）。
   *  （2026-09-15 三版）聚焦只切瞄准点不飞镜头：保持玩家当前距离与姿态，滚轮控制远近。
   *  ⚠ 仅限卫星母星系视角（月球须在地月系：公转跟随依赖本系舞台钉扎口径）。 */
  enterMoonObserve(body: MoonId): void {
    const mc = B.map.moons[body]
    if (!mc || this.viewMode !== 'earth' || this.planetFocusBody !== mc.parent) return
    // 与全息勘探互斥：全息中先退出（保持相机原位不重新取景，随后观察重新取景）
    if (this.owner.hologramSel) this.owner.closeHologram()
    // 建筑/航线编辑模式与观察互斥（左键在观察中是环绕拖拽，不能同时落位/拖线）
    if (this.owner.buildMode) this.owner.cancelBuildMode()
    if (this.owner.routeEditMode) this.owner.toggleRouteEditMode()
    this.observeBody = body
    // 观察距离 = 卫星半径 × 4；缩放下限贴球心（卫星特写可滚到近乎贴着表面）
    const r = B.map.nodes[body].r
    // 取景锚 = 卫星真实位置（ Actor root 权威值；卫星不在舞台中心，随公转走）
    const actor = this.owner.starActors.get(body as StarBodyId)
    const wx = actor ? actor.root.position.x : 0
    const wz = actor ? actor.root.position.z : 0
    const rig = this.owner.cameraActor.rig
    rig.setEdgePanEnabled(false)
    // 注视点 = 球心高度：特写卫星屏幕居中，缩放下限以球心计量
    this.applyZoomFloor(r)
    // 聚焦看向（2026-09-15 七版·群星式滚动吸附）：边转头看向卫星实时位边把距离收拢到
    // 取景距离（r×4），锚点闭包每帧取卫星 root.position → 滑移期间自动跟踪公转漂移
    this.owner.cameraActor.aimAt(() => new THREE.Vector3(
      (this.owner.starActors.get(body)?.root.position.x ?? wx),
      r * 0.55,
      (this.owner.starActors.get(body)?.root.position.z ?? wz),
    ), r * 4)
    rig.orbitMode = true
    rig.leftOrbitEnabled = true
    this.observeFollowLast = { x: wx, z: wz }
    this.resetObserveBoost()
    audioSys.play('wc.ok', { volume: 0.4 })
    logger.info(`[WarmCurrent] 卫星观察：${PLANET_NAMES[body] ?? body}（环绕跟随公转 · 滚轮缩放 · Esc/再双击退出）`)
  }

  /**
   * 行星观察特写增益：大气 ×1.8（上限 3）。基础值由组件快照持有，退出经 resetObserveBoost
   * 统一复位。云层增益随云层壳移除（2026-09-10，地球不再挂云，全仓无 CloudLayerComponent）。
   */
  private applyObserveBoost(body: PlanetId): void {
    for (const [id, actor] of this.owner.starActors) {
      const on = id === body
      const atmo = actor.getComponent(AtmosphereComponent)
      if (atmo) atmo.intensity = on ? Math.min(3, atmo.baseIntensity * 1.8) : atmo.baseIntensity
    }
  }

  /** 复位全部天体的特写增益（退出观察/清理收口共用） */
  private resetObserveBoost(): void {
    for (const actor of this.owner.starActors.values()) {
      const atmo = actor.getComponent(AtmosphereComponent)
      if (atmo) atmo.intensity = atmo.baseIntensity
    }
  }

  /** 当前视图的世界位移（世界坐标 → 地图画布坐标须减去）：
   *  行星系视角 = 舞台位移（stage - 聚焦行星世界位置，与渲染 syncStage/StarActor.syncFrom
   *  同口径——聚焦行星在隔离口径下恒钉在舞台中心，两者恒等）；太阳系全景 = 0
   *  （世界原点即地图中心）。PlayerController 指针拾取/命中组件共用，改口径须两边同步。 */
  viewStageOffset(): { x: number; z: number } {
    if (this.viewMode !== 'earth') return { x: 0, z: 0 }
    const stage = planetStageOffset(this.planetFocusBody as PlanetId)
    const f = starPosAt(this.owner.simState.state, this.planetFocusBody)
    return { x: stage.x - toWX(f.x), z: stage.z - toWZ(f.y) }
  }

  /** 退出行星/卫星观察视角：复位该行星系默认聚焦取景（斜视 + 聚焦环绕语义，
   *  focusSolarSystem 顺带清观察状态与相机交互开关） */
  exitPlanetObserve(): void {
    if (!this.observeBody) return
    this.focusSolarSystem(this.planetFocusBody)
    logger.info('[WarmCurrent] 行星观察退出（回行星系斜视取景）')
  }



  /** 统一视图切换：加载遮罩先上屏（盖住舞台搬移/镜头跳转防穿帮），下一拍再切。
   *  2026-09-14 视角锁定地球系：solar 目标已屏蔽（防御性兜底，玩家入口均已封）。 */
  private switchView(target: 'solar' | SolarBodyId): void {
    if (this.viewSwitching) return
    if (target === 'solar') {
      logger.warn('[WarmCurrent] 太阳系全景视角已屏蔽（2026-09-14 锁定地球视角），忽略 switchView(\'solar\')')
      return
    }
    // solar 已在上方屏蔽返回；此处 target 收窄为 SolarBodyId
    this.viewSwitching = true
    const panel = this.owner.world?.ui.spawnUIActor(VIEW_LOADING_WIDGET) ?? null
    this.viewLoadingPanel = panel
    if (!panel) logger.warn('[WarmCurrent] 视图切换加载遮罩生成失败，退化为硬切')
    window.setTimeout(() => {
      try {
        this.focusSolarSystem(target)
      } finally {
        // 遮罩销毁失败不得卡死 viewSwitching（否则后续所有切换永久失灵）
        try { panel?.destroy() } catch (e) { logger.error(`[WarmCurrent] 加载遮罩销毁失败：${e}`) }
        this.viewLoadingPanel = null
        this.viewSwitching = false
      }
    }, 450)
  }
}
