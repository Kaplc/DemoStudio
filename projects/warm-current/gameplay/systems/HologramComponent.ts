/**
 * HologramComponent — 全息勘探/全息地球建造组件（GameMode 上的组件位；2026-09-20 自 WarmCurrentGameMode 下沉）
 *
 * 职责（原 WarmCurrentGameMode 全息方法原样迁入）：
 *  - 状态权威：hologramSel（勘探目标）/ holoDepositSel（选中矿点）/ holoPlaceTool（放置工具）
 *    / holoTab（面板分类）/ holoGhost（落位预览）/ holoLastTarget（卫星跟随锚）；
 *  - 开合：openHologram（行星系门槛 + 矿点门槛 + 与观察互斥 + 原地包络取景，关闭保持相机原位）；
 *  - 建造：setHoloTab/setHoloTool/onHologramTap/onHologramHover/placeRingNodeAt
 *    （环节点落位 + 地表建筑放置，校验口径在本组件）；
 *  - tickFollow：卫星全息 rig.pan 逐帧跟随公转（GameMode.Tick 同位调用）；
 *  - 投影探针：holoNodeScreenPos/holoLatLonScreenPos/holoMarkerScreenPos（e2e 用）；
 *  - 面板投影：buildHologram（hologramSel → HudHologram）。
 *  兼容：GameMode 保留同名薄转发与只读 getter，Controller/GM/渲染 provider/面板脚本调用面不变。
 */
import * as THREE from 'three'
import { BObjectComponent, audioSys, logger } from '@/engine'
import { B } from '../core/balance'
import {
  buildingDefOf, pendingRingNodeCount, placedRingNodes, starMiningRate, starStockCapOf, starStockOf,
} from '../core/helpers'
import { depositDefOf, depositLeft, depositsOf, mineDefOf } from './MiningComponent'
import { isShipyardType, orbitBuildingDefOf } from './OrbitBuildComponent'
import { PLANET_NAMES } from '../core/planetNames'
import type { HoloTab, HudHoloBuildRow, HudHoloDepositRow, HudHoloEarth, HudHoloToolRow, HudHologram } from './ViewModelComponent'
import type { PlanetBodyId, PlanetId, StarId } from '../core/types'
import type { StarBodyId } from '../map/StarActor'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

export class HologramComponent extends BObjectComponent<WarmCurrentGameMode> {
  /** 全息勘探目标天体（null = 收起。与观察模式互斥同款相机语义） */
  hologramSel: PlanetBodyId | null = null
  /** 全息勘探当前选中矿点（mineral_deposit 行键；null = 未选中） */
  holoDepositSel: string | null = null
  /** 全息地球放置工具（null = 未选；ring = 落位环节点，building = 放置地表建筑） */
  holoPlaceTool: { kind: 'ring' } | { kind: 'building'; typeId: string } | null = null
  /** 全息地球面板内容分类（开全息重置为 resources，2026-09-18 改版） */
  holoTab: HoloTab = 'resources'
  /** 全息地球放置预览（指针球面交点 + 校验结果；null = 无工具/未悬停） */
  holoGhost: { lat: number; lon: number; valid: boolean; label: string } | null = null
  /** 卫星全息跟随：上一帧卫星 Actor 世界位（pan 增量 = 公转漂移补偿） */
  private holoLastTarget: { x: number; z: number } | null = null

  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'HologramComponent'
  }

  /** 卫星全息跟随（GameMode.Tick 同位调用）：rig.pan 同步平移 target+camera（保持环绕几何），
   *  镜头锚住公转中的卫星；全息地球不参与（行星钉在舞台中心静态，原地包络无需 pan 跟随） */
  tickFollow(): void {
    if (this.hologramSel && this.hologramSel !== 'earth') {
      const holoActor = this.owner.starActors.get(this.hologramSel)
      if (holoActor) {
        const p = holoActor.root.position
        if (this.holoLastTarget) {
          this.owner.cameraActor.rig.pan(p.x - this.holoLastTarget.x, p.z - this.holoLastTarget.z)
        }
        this.holoLastTarget = { x: p.x, z: p.z }
      }
    }
  }

  /** 清瞬态（GameMode.clearObserveState 收口调用）：勘探目标/矿点/工具/ghost/跟随锚一并归零 */
  clearTransient(): void {
    this.hologramSel = null
    this.holoDepositSel = null
    this.holoPlaceTool = null
    this.holoGhost = null
    this.holoLastTarget = null
  }

  /** 打开全息勘探（星球信息面板按钮）。
   *  Earth = 全息地球建造场景（2026-09-12 立项；2026-09-15 起与矿点勘探同口径原地包络，
   *  勘探期间真球隐藏）：HUD 进建造模式，环节点球面落位 + 融化区内放地表建筑；无需矿点门槛。
   *  其他天体 = 矿点勘探（必须有矿点）。
   *  相机语义与行星观察同款：斜视角环绕 + 关边缘平移；退出保持当前视角（closeHologram 不重新取景）。
   *  卫星随母星系判定（地月系内可全息月球）；取景收口真实 Actor 位置（卫星不在舞台中心，
   *  Tick 逐帧 rig.pan 跟随公转漂移）。
   *  ⚠ 仅限本行星系视角（太阳系全景行星公转漂移，镜头锚不住）。 */
  openHologram(body: PlanetBodyId): void {
    const mc = B.map.moons[body as keyof typeof B.map.moons]
    const systemRoot = mc ? mc.parent : body
    if (this.owner.viewMode !== 'earth' || this.owner.planetFocusBody !== systemRoot) {
      this.owner.simState.hint('需进入该行星系（双击行星）后可全息勘探')
      return
    }
    const isEarth = body === 'earth'
    if (!isEarth && depositsOf(body).length === 0) {
      this.owner.simState.hint('该天体无已探明矿产')
      return
    }
    // 与观察模式互斥：观察中先退出（复位俯视，随后全息重新取景）
    if (this.owner.observeBody) this.owner.exitPlanetObserve()
    this.hologramSel = body
    this.holoDepositSel = null
    this.holoLastTarget = null
    this.holoPlaceTool = null
    this.holoGhost = null
    this.holoTab = 'resources'
    const r = B.map.nodes[body].r
    const actor = this.owner.starActors.get(body as StarBodyId)
    // 取景锚 = 天体真实位置（行星钉在舞台中心 = 原点；卫星用实时公转位），注视高度 = 球心
    const wx = actor ? actor.root.position.x : 0
    const wz = actor ? actor.root.position.z : 0
    this.owner.cameraActor.rig.setEdgePanEnabled(false)
    // 全息统一原地包络取景（2026-09-15 用户定案：地球不再远处独立投影，与月球同口径；
    // 球面落位/建筑操作空间 = B.holo.pickRadius 拾取半径 + 环绕边缘平移保障）
    this.owner.applyZoomFloor(r)
    this.owner.cameraActor.observeFocus(wx, wz, r * 4.5, THREE.MathUtils.degToRad(35), r * 0.55)
    if (isEarth) this.owner.feedback.toast('全息地球已展开 — 右侧选建造工具，点球面落位', '#7fdcff')
    this.owner.cameraActor.rig.orbitMode = true
    // 全息态星图点击判定冻结（放置工具走屏幕空间拾取），左键空闲 → 左键也环绕（历史交互不变）
    this.owner.cameraActor.rig.leftOrbitEnabled = true
    audioSys.play('wc.ok', { volume: 0.4 })
    logger.info(`[WarmCurrent] 全息${isEarth ? '地球建造' : '勘探'}：${PLANET_NAMES[body] ?? body}（拖拽环绕 · Esc 退出）`)
  }

  /** 关闭全息勘探（面板 ✕ / Esc）：保持当前相机位置（2026-09-15 用户定案：关闭不重新取景，
   *  玩家环绕/缩放出的视角原样保留）。字段与相机交互清理交由 clearObserveState
   *  （hologramSel/orbitMode/边缘平移/特写增益一并回落视图默认语义），不飞镜头；
   *  缩放下限回落聚焦天体口径（全息期间可能贴合过更小的卫星球面）。 */
  closeHologram(): void {
    if (!this.hologramSel) return
    this.owner.clearObserveState()
    this.owner.applyZoomFloor(B.map.nodes[this.owner.planetFocusBody as PlanetId].r)
    logger.info('[WarmCurrent] 全息勘探关闭（保持当前相机位置）')
  }

  /** 选中矿点（面板行点击；id 须属当前勘探天体） */
  selectHoloDeposit(id: string | null): void {
    if (id && depositDefOf(id)?.planet !== this.hologramSel) return
    this.holoDepositSel = id
    if (id) audioSys.play('wc.draw', { volume: 0.25 })
  }

  // ─── 全息地球建造（环节点落位 / 地表建筑放置） ───

  /** 切换面板内容分类（底部资源/地表建筑/轨道建筑按钮；同值重复点击幂等忽略） */
  setHoloTab(tab: HoloTab): void {
    if (this.holoTab === tab) return
    this.holoTab = tab
    audioSys.play('wc.draw', { volume: 0.2 })
    logger.info(`[WarmCurrent] 全息面板切换分类：${tab}`)
  }

  /** 选择放置工具（面板行点击；kind=null 清除。建筑 typeId 非法忽略） */
  setHoloTool(kind: 'ring' | 'building' | null, typeId?: string): void {
    if (kind === null || (this.holoPlaceTool?.kind === kind && (kind !== 'building' || (this.holoPlaceTool as { typeId: string }).typeId === typeId))) {
      // 再点同工具 = 取消
      this.holoPlaceTool = null
      this.holoGhost = null
      return
    }
    if (kind === 'ring') {
      this.holoPlaceTool = { kind: 'ring' }
    } else {
      if (!buildingDefOf(typeId ?? '')) return
      this.holoPlaceTool = { kind: 'building', typeId: typeId! }
    }
    audioSys.play('wc.draw', { volume: 0.25 })
  }

  /** 环节点落位合法性（null = 可落位）：须有待落位的已交付槽位 */
  private holoRingNodeIssue(): string | null {
    const s = this.owner.simState.state
    if (s.flare.phase === 'active') return '太阳耀斑 · 通讯中断，无法落位'
    if (pendingRingNodeCount(s) <= 0) return '无待落位节点（建设泵交付新环段后可落位）'
    return null
  }

  /** 全息视图左键轻点（Controller 派发）：放置工具激活 = 球面落位；否则 = 矿点拾取 */
  onHologramTap(screenX: number, screenY: number): void {
    if (!this.hologramSel) return
    if (this.holoPlaceTool && this.hologramSel === 'earth') {
      this.applyHoloToolAt(screenX, screenY)
      return
    }
    const id = this.owner.starMap?.pickHoloDeposit(screenX, screenY) ?? null
    this.selectHoloDeposit(id)
  }

  /** 工具落位（轻点处球面交点）：环节点连续落位不退工具；地表建筑一次一放 */
  private applyHoloToolAt(screenX: number, screenY: number): void {
    const hit = this.owner.starMap?.pickHoloSurface(screenX, screenY)
    if (!hit) return
    const tool = this.holoPlaceTool!
    if (tool.kind === 'ring') {
      const issue = this.placeRingNodeAt(hit.lat, hit.lon)
      if (issue) {
        this.owner.simState.hint(issue)
        audioSys.play('wc.bad', { volume: 0.4 })
        return
      }
      audioSys.play('wc.build')
      this.owner.feedback.toast(`环节点已落位（${Math.round(hit.lat)}°, ${Math.round(hit.lon)}°）— 周边冰雪开始消融`, '#7fe0a0')
      return
    }
    const ok = this.owner.buildings.tryPlaceSurface(tool.typeId, hit.lat, hit.lon)
    if (ok) {
      audioSys.play('wc.build')
      this.setHoloTool(null)
    } else {
      audioSys.play('wc.bad', { volume: 0.5 })
    }
  }

  /** 环节点直落（屏幕落位/GM 共用校验链；返回 null = 成功，否则为拒绝原因） */
  placeRingNodeAt(lat: number, lon: number): string | null {
    const issue = this.holoRingNodeIssue()
    if (issue) return issue
    const s = this.owner.simState.state
    const idx = s.ringNodes.findIndex((n, i) => i < s.ringSlots && !n)
    if (idx < 0) return '无待落位槽位'
    s.ringNodes[idx] = { lat, lon }
    return null
  }

  /** 全息地球指针悬停（Controller 移动派发）：更新放置预览（渲染 ghost + 面板校验文案） */
  onHologramHover(screenX: number, screenY: number): void {
    if (!this.hologramSel || this.hologramSel !== 'earth' || !this.holoPlaceTool) {
      this.holoGhost = null
      return
    }
    const hit = this.owner.starMap?.pickHoloSurface(screenX, screenY)
    if (!hit) {
      this.holoGhost = null
      return
    }
    const tool = this.holoPlaceTool
    if (tool.kind === 'ring') {
      const issue = this.holoRingNodeIssue()
      this.holoGhost = {
        ...hit,
        valid: !issue,
        label: issue ?? `环节点 · 融冰半径 ${B.holoEarth.meltRadiusDeg}°（点击落位）`,
      }
      return
    }
    const def = buildingDefOf(tool.typeId)
    const issue = this.owner.buildings.surfacePlacementIssue(tool.typeId, hit.lat, hit.lon)
    this.holoGhost = {
      ...hit,
      valid: !issue,
      label: issue ?? `${def?.name ?? tool.typeId} · ${def?.cost ?? 0} H3（点击放置）`,
    }
  }

  /** 环节点标记的屏幕坐标（e2e/引导探针；null = 全息未开/未落位该槽） */
  holoNodeScreenPos(slot: number): { x: number; y: number } | null {
    return this.owner.starMap?.holoNodeScreenPos(slot) ?? null
  }

  /** 目标 lat/lon 球面点的屏幕坐标（e2e 真实点击测试用；含当前自转相位） */
  holoLatLonScreenPos(lat: number, lon: number): { x: number; y: number } | null {
    return this.owner.starMap?.holoLatLonScreenPos(lat, lon) ?? null
  }

  /** 矿点标记的屏幕坐标（e2e 真实点击测试用；null = 全息未开/无此矿点） */
  holoMarkerScreenPos(depositId: string): { x: number; y: number } | null {
    return this.owner.starMap?.holoMarkerScreenPos(depositId) ?? null
  }

  /** 全息勘探面板数据装配（hologramSel → HudHologram；矿点行/建造行全表驱动） */
  buildHologram(body: PlanetBodyId): HudHologram {
    const s = this.owner.simState.state
    const types = B.mineralTypes as Record<string, { name: string; desc: string; color: string } | undefined>
    const deposits: HudHoloDepositRow[] = depositsOf(body).map(({ id, def }) => {
      const t = types[def.type]
      const mine = this.owner.mining.mineAt(id)
      const left = depositLeft(s, id)
      let status: string
      if (mine && !mine.built) status = `建造中 ${Math.floor(mine.progress * 100)}%`
      else if (mine && left <= 0) status = '已枯竭'
      else if (mine) status = `开采中 · 余 ${Math.round(left)} t`
      else status = '未开发'
      return {
        id,
        typeName: t?.name ?? def.type,
        color: t?.color ?? '#4fd8ff',
        reserve: def.reserve,
        left,
        status,
        mineType: mine?.type ?? null,
        progress: mine?.progress ?? 0,
        selected: this.holoDepositSel === id,
      }
    })
    const selDef = this.holoDepositSel ? depositDefOf(this.holoDepositSel) : null
    let detail = '点矿点或列表行选中矿点'
    if (selDef) {
      const t = types[selDef.type]
      const mine = this.owner.mining.mineAt(this.holoDepositSel!)
      const left = depositLeft(s, this.holoDepositSel!)
      const lines = [
        `${t?.name ?? selDef.type}（${t?.desc ?? ''}）`,
        `储量 ${Math.round(left)} / ${selDef.reserve} t`,
      ]
      if (mine && !mine.built) {
        const md = mineDefOf(mine.type)
        lines.push(`${md?.name ?? mine.type} 建造中 ${Math.floor(mine.progress * 100)}%`)
      } else if (mine) {
        const md = mineDefOf(mine.type)
        lines.push(left > 0
          ? `${md?.name ?? mine.type} 运转中 · 产出 ${md?.yieldPerS ?? 0}/s`
          : '矿点已枯竭 · 设施停摆')
      }
      detail = lines.join('\n')
    }
    const playable = s.outcome === 'playing' || s.sandbox
    const buildRows: HudHoloBuildRow[] = Object.entries(B.mineBuildings).map(([id, def]) => {
      const issue = this.holoDepositSel ? this.owner.mining.placementIssue(this.holoDepositSel, id) : '未选中矿点'
      return {
        id, name: def.name, desc: def.desc, cost: def.cost,
        buildTime: def.buildTime, yieldPerS: def.yieldPerS,
        canBuild: playable && !issue,
      }
    })
    // 全息地球态（仅 Earth）：节点统计 + 建造工具行（ring + building 表键序）+ ghost 提示
    let earth: HudHoloEarth | null = null
    if (body === 'earth') {
      const pending = pendingRingNodeCount(s)
      const placed = placedRingNodes(s)
      const tools: HudHoloToolRow[] = [
        {
          id: 'ring',
          name: '⚡ 环节点',
          desc: `点球面落位待建节点 · 融冰 ${B.holoEarth.meltRadiusDeg}°`,
          selected: this.holoPlaceTool?.kind === 'ring',
          canUse: playable && pending > 0,
        },
        ...Object.entries(B.buildings).map(([id, def]) => ({
          id,
          name: def.name,
          desc: `地表建筑 · 需融化区 · ${def.cost} H3`,
          selected: this.holoPlaceTool?.kind === 'building' && (this.holoPlaceTool as { typeId: string }).typeId === id,
          canUse: playable && s.earthH3 >= def.cost,
        })),
      ]
      const earthYard = this.owner.orbitBuild.shipyardMults('earth')
      const earthShipCost = Math.round(B.shipBuildCost * (earthYard?.costMult ?? 1))
      earth = {
        tab: this.holoTab,
        pendingNodes: pending,
        placedNodes: placed.length,
        builtSlots: s.ringSlots,
        meltRadiusDeg: B.holoEarth.meltRadiusDeg,
        tools,
        orbitRows: this.owner.vm.orbitBuildTypeRows('earth'),
        orbitIntro: earthYard
          ? `船坞就绪 · 点轨道上的船坞打开造船面板（${earthShipCost} H3/艘）`
          : `造船 ${earthShipCost} H3（建船坞解锁 · 点船坞造船）`,
        toolActive: !!this.holoPlaceTool,
        ghostLabel: this.holoGhost?.label ?? '',
      }
    }
    return {
      body,
      bodyName: B.stars[body as StarId]?.name ?? PLANET_NAMES[body] ?? body,
      deposits,
      buildRows,
      selectedId: this.holoDepositSel,
      detail,
      stockyard: (B.starStockCap as Record<string, number | undefined>)[body] !== undefined
        ? { stock: Math.floor(starStockOf(s, body)), cap: (B.starStockCap as Record<string, number>)[body], miningRate: Math.round(starMiningRate(s, body) * 10) / 10 }
        : null,
      earth,
    }
  }
}
