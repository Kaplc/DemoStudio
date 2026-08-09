/**
 * ClashBuildingScript — 部落冲突建筑行为脚本（挂到建筑蓝图资产根节点）
 *
 * 通过 ScriptComponent（通用挂载点，非 UI 专属）挂载到建筑 .blueprint.json 的根节点，
 * 资产数据（显示名/占地格子数/主体尺寸）经 ScriptComponent 的 args 传入，实现：
 *  - 点击 → 通知基地 GameMode 选中（onBuildingClick）
 *  - 选中高亮线框（金色 EdgesBox，动态创建 + LineComponent 托管）
 *
 * 建筑结构（结构）与行为（脚本）解耦：新增建筑 = 新建 .blueprint.json + 本脚本，
 * 无需写 TS 类。
 *
 * 文件名 `.script.ts` 后缀 + 默认导出：由 asset/index.ts 的 import.meta.glob 自动扫描
 * 注册，注册 id = `gameplay/base/ClashBuilding`（路径式）。
 */
import * as THREE from 'three'
import { BehaviourScript, ClickableComponent, LineComponent, logger } from '@/engine'
import type { FishBaseGameMode } from './FishBaseGameMode'

export default class ClashBuildingScript extends BehaviourScript {
  /** 建筑显示名（资产 args.buildingName，如"城镇大厅"） */
  buildingName = '建筑'
  /** 放置占地格子数（资产 args.footprint，N×N 格） */
  footprint = 1

  /** 主体底面尺寸（资产 args.size，高亮线框用） */
  private size = 1
  /** 主体高度（资产 args.height，高亮线框用） */
  private height = 1

  /** 选中高亮线框（LineComponent 托管：挂 root + EndPlay 自动释放资源） */
  private glow: THREE.LineSegments | null = null
  /** 是否被选中 */
  private _selected = false

  override onStart(args?: Record<string, unknown>): void {
    if (typeof args?.buildingName === 'string') this.buildingName = args.buildingName
    if (typeof args?.footprint === 'number') this.footprint = args.footprint
    if (typeof args?.size === 'number') this.size = args.size
    if (typeof args?.height === 'number') this.height = args.height

    // ─── 点击 → 通知基地 GameMode 选中/取消选中 ───
    const clickable = this.actor.getComponent(ClickableComponent)
    if (clickable) {
      clickable.onClick = () => {
        logger.info(`[ClashScript] "${this.buildingName}" 被点击`)
        const mode = this.gameMode as FishBaseGameMode | null
        mode?.onBuildingClick(this.actor)
      }
    } else {
      logger.warn(`[ClashScript] "${this.buildingName}" 缺少 ClickableComponent，点击无法生效`)
    }

    // ─── 选中高亮线框（金色，包裹主体）───
    const w = this.world
    if (w) {
      const glow = w.createEdgesBox(this.size + 0.25, this.height + 0.25, this.size + 0.25, 0xffd700, true, 0.9)
      glow.position.y = 0.15 + this.height / 2
      glow.visible = false
      this.actor.addComponent(new LineComponent(this.actor, glow, 'GlowLine'))
      this.glow = glow
    }

    logger.info(`[ClashScript] "${this.buildingName}" 就绪（占地 ${this.footprint}x${this.footprint} 格）`)
  }

  /** 设置选中状态（GameMode 调用：显示/隐藏金色线框） */
  setSelected(selected: boolean): void {
    this._selected = selected
    if (this.glow) this.glow.visible = selected
  }

  get selected(): boolean {
    return this._selected
  }

  override onDestroy(): void {
    // glow 由 LineComponent.EndPlay 自动释放 geometry/material
    this.glow = null
  }
}
