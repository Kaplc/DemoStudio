/**
 * PanelStateComponent — 面板选择态状态机组件（GameMode 上的组件位；2026-09-20 自 WarmCurrentGameMode 下沉）
 *
 * 职责（原 WarmCurrentGameMode 各面板 open/close 方法与选择态字段原样迁入）：
 *  - 居中面板互斥选择态权威：planetInfoSel / orbitBuildSel / shipyardSel / stationSel /
 *    designOpen（火箭设计工坊）/ buildingDetailSel（建筑详情浮层，与浮层并存不互斥）；
 *  - open 语义 = 清其余面板选择态 + 关全息（保持相机原位，见 memory:warm_panel_close_camera_semantics）
 *    + 船坞面板附加设计选择态复位；
 *  - closeAll：空地点击/重开/读档的统一收口（不含 designOpen——历史上重开不清设计面板，保持原行为）。
 *  兼容：GameMode 保留同名薄转发与只读 getter，UI 脚本调用面不变。
 */
import { BObjectComponent, audioSys, logger } from '@/engine'
import type { PlanetBodyId } from '../core/types'
import type { SolarBodyId } from '../core/helpers'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

export class PanelStateComponent extends BObjectComponent<WarmCurrentGameMode> {
  /** 星球信息面板当前展示的天体（null = 收起） */
  planetInfoSel: SolarBodyId | null = null
  /** 轨道建设面板当前锚天体（null = 收起） */
  orbitBuildSel: PlanetBodyId | null = null
  /** 船坞造船面板当前承接船坞 id（null = 收起，ShipyardPanelScript 消费） */
  shipyardSel: number | null = null
  /** 空间站舱段面板当前空间站 id（null = 收起，StationPanelScript 消费） */
  stationSel: number | null = null
  /** 火箭设计面板开合（null = 收起；ShipDesignScript 消费） */
  designOpen = false
  /** 建筑详情浮层当前建筑 id（null = 收起） */
  buildingDetailSel: number | null = null

  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'PanelStateComponent'
  }

  /** 打开星球信息面板（非航线编辑模式点星球 / 点不可拖天体；再点其它星球切换内容） */
  openPlanetInfo(body: SolarBodyId): void {
    if (this.owner.hologramSel) this.owner.closeHologram()
    this.planetInfoSel = body
    this.orbitBuildSel = null
    this.shipyardSel = null
    this.stationSel = null
    audioSys.play('wc.draw', { volume: 0.3 })
    logger.info(`[WarmCurrent] 星球信息面板：${body}`)
  }

  /** 关闭星球信息面板（面板内 ✕ / 点空地） */
  closePlanetInfo(): void {
    this.planetInfoSel = null
  }

  /** 打开轨道建设面板（星球信息面板「近地轨道建设」按钮 / 点已建成轨道设施） */
  openOrbitBuild(anchor: PlanetBodyId): void {
    if (this.owner.hologramSel) this.owner.closeHologram()
    this.orbitBuildSel = anchor
    this.planetInfoSel = null
    this.shipyardSel = null
    this.stationSel = null
    audioSys.play('wc.draw', { volume: 0.3 })
    logger.info(`[WarmCurrent] 轨道建设面板：${anchor}`)
  }

  /** 关闭轨道建设面板（面板内 ✕ / 点空地） */
  closeOrbitBuild(): void {
    this.orbitBuildSel = null
  }

  /** 打开船坞造船面板（星图点船坞轨道设施；与轨道建设/空间站/星球信息面板互斥） */
  openShipyardPanel(dockId: number): void {
    if (this.owner.hologramSel) this.owner.closeHologram()
    this.shipyardSel = dockId
    this.owner.ship.resetSelection()
    this.planetInfoSel = null
    this.orbitBuildSel = null
    this.stationSel = null
    audioSys.play('wc.draw', { volume: 0.3 })
    logger.info(`[WarmCurrent] 船坞造船面板：dock ${dockId}`)
  }

  /** 关闭船坞造船面板（面板内 ✕ / 点空地） */
  closeShipyardPanel(): void {
    this.shipyardSel = null
  }

  /** 打开空间站舱段面板（星图点空间站轨道设施；与船坞/轨道建设/星球信息面板互斥） */
  openStationPanel(obId: number): void {
    if (this.owner.hologramSel) this.owner.closeHologram()
    this.stationSel = obId
    this.planetInfoSel = null
    this.orbitBuildSel = null
    this.shipyardSel = null
    audioSys.play('wc.draw', { volume: 0.3 })
    logger.info(`[WarmCurrent] 空间站舱段面板：station ${obId}`)
  }

  /** 关闭空间站舱段面板（面板内 ✕ / 点空地） */
  closeStationPanel(): void {
    this.stationSel = null
  }

  /** 打开火箭设计面板（底部 HUD「火箭设计」按钮；选择态与船坞面板共享——
   *  船坞里配到一半的方案来这里接着调，反之亦然） */
  openShipDesign(): void {
    if (this.owner.hologramSel) this.owner.closeHologram()
    this.designOpen = true
    this.planetInfoSel = null
    this.shipyardSel = null
    this.owner.ship.closeShipyardAddMenu()
    this.stationSel = null
    this.orbitBuildSel = null
    audioSys.play('wc.draw', { volume: 0.3 })
    logger.info('[WarmCurrent] 火箭设计工坊：打开')
  }

  /** 关闭火箭设计面板 */
  closeShipDesign(): void {
    this.designOpen = false
  }

  /** 打开建筑详情浮层（点地图建筑：强化分支装拆流；与其它浮层并存不互斥——浮层贴选中建筑） */
  openBuildingDetail(id: number): void {
    this.buildingDetailSel = id
    audioSys.play('wc.draw', { volume: 0.3 })
  }

  /** 关闭建筑详情浮层（面板内 ✕ / 点空地 / 建筑被拆） */
  closeBuildingDetail(): void {
    this.buildingDetailSel = null
  }

  /** 统一收口（空地点击 / 重开 / 读档；不含 designOpen——重开不清设计面板为历史行为） */
  closeAll(): void {
    this.planetInfoSel = null
    this.orbitBuildSel = null
    this.shipyardSel = null
    this.stationSel = null
    this.buildingDetailSel = null
  }
}
