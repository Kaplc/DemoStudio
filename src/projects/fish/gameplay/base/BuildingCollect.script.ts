/**
 * BuildingCollectScript — 收集泡泡行为脚本（场景 UI / World-Space 面板）
 *
 * 挂载于 building_collect.widget.json 根节点（data-script="gameplay/base/BuildingCollect"）：
 * 金矿/水库积压资源达到容量 80% 时由 FishBaseGameMode 在建筑头顶生成
 * （spawnAnchoredWidget，mode='world'），点击泡泡一键收集该矿全部积压。
 * 积压回落后（收集/升级重建等）由 GameMode 逐帧巡检销毁。
 *
 * 泡泡的图标固定金币（池里金矿/水库共用同一份 widget 资产）——收集量由
 * ProductionService.collect 按矿内实际积压结算，图标仅作交互提示。
 *
 * 交互态色：源 .Bubble:active（按下反馈）由编译器透传到 UIScript.args，
 * 这里消费 pressed 色（泡泡无 hover 语义，按下变色即可）。
 */
import { BehaviourScript, UIButtonComponent, UIImageComponent, UIScriptComponent, logger } from '@/engine'
import type { FishBaseGameMode } from './FishBaseGameMode'

/** 编译器 emitButtonStates 透传的交互态（仅 color/opacity） */
interface InteractiveStateArgs {
  hover?: { color?: string; opacity?: number }
  pressed?: { color?: string; opacity?: number }
}

export default class BuildingCollectScript extends BehaviourScript {
  /** GameMode 引用 */
  private mode: FishBaseGameMode | null = null
  private btn: UIButtonComponent | null = null
  private image: UIImageComponent | null = null
  private states: InteractiveStateArgs = {}
  private baseColor: string | null = null

  override onStart(_args?: Record<string, unknown>): void {
    this.mode = this.gameMode as FishBaseGameMode | null
    logger.info('[BuildingCollectScript] onStart: 收集泡泡脚本已挂载')

    const bubbleActor = this.findInChildren('Bubble')
    if (!bubbleActor) {
      logger.error('[BuildingCollectScript] 未找到 Bubble 节点，跳过绑定')
      return
    }
    this.btn = bubbleActor.getComponent(UIButtonComponent)
    this.image = bubbleActor.getComponent(UIImageComponent)
    this.states = (bubbleActor.getComponent(UIScriptComponent)?.args ?? {}) as InteractiveStateArgs
    this.baseColor = this.image?.color ?? null
    if (this.btn) {
      this.btn.onClick = () => this.collect()
      logger.info('[BuildingCollectScript] 收集按钮已绑定')
    }
  }

  /** 每帧：按下反馈色（pressed 优先，其余回常态） */
  override onUpdate(_deltaTime: number): void {
    if (!this.btn || !this.image) return
    const target =
      this.btn.state === 'pressed' ? this.states.pressed?.color ?? null
      : this.btn.state === 'hover' ? this.states.hover?.color ?? null
      : this.baseColor
    if (target && this.image.color !== target) this.image.color = target
  }

  /** 点击泡泡：一键收集——只把自身 actor 引用交给 GameMode，矿种由 GameMode 反查（多泡泡并存时全局态会串味） */
  private collect(): void {
    const mode = this.mode
    if (!mode) return
    const got = mode.collectFromBubble(this.actor)
    if (got > 0) {
      logger.info(`[BuildingCollectScript] 一键收集成功: +${got}`)
    }
  }
}
