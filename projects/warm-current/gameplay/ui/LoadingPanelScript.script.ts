/**
 * LoadingPanelScript — 进图 loading 面板行为脚本（loading.widget.json 根节点）
 *
 * 由 WarmCurrentGameInstance 在「开始游戏/读档进星图」时 spawn（菜单场景亮一次，
 * 切场景销毁后在星图 setup 回调同任务重建——同步切换无渲染帧，玩家无感）。
 * 面板全屏 hit-test: block 吞掉点击；完全加载完毕（LoadingSettle 组结算）由
 * 实例侧销毁。动画全部脚本驱动（编译器无 @keyframes）：
 *  - 12 段旋转点阵：CanvasUIComponent.active 显隐轮转（UIImage 改色不重绘，显隐是本仓既定模式）
 *  - 阶段文案由实例侧 setStage 推送
 */
import { BehaviourScript, CanvasUIComponent, GameInstance, logger, UITextComponent } from '@/engine'
import type { Actor } from '@/engine'
import { findChild } from './uiCommon'

/** loading widget 资产路径（WarmCurrentGameInstance spawn 用） */
export const LOADING_WIDGET = 'asset/blueprints/ui/loading.widget.json'

const SEG_COUNT = 12
const LIT_SEGMENTS = 3
const STEP_INTERVAL = 0.09

export default class LoadingPanelScript extends BehaviourScript {
  private segs: Actor[] = []
  private stageComp: UITextComponent | null = null
  private stage = ''
  private acc = 0
  private head = 0

  override onStart(): void {
    for (let i = 0; i < SEG_COUNT; i++) {
      const a = findChild(this.actor, `SpinSeg_${i}`)
      if (a) this.segs.push(a)
    }
    const stageActor = findChild(this.actor, 'StageText')
    this.stageComp = stageActor?.getComponent(UITextComponent) ?? null
    if (this.stageComp && this.stage) this.stageComp.text = this.stage
    this.paint()
    // 实例侧挂接：面板跨场景重建，实例持最新一份引用并推送当前阶段
    const inst = GameInstance.current as { onLoadingPanelMounted?(s: LoadingPanelScript): void } | null
    inst?.onLoadingPanelMounted?.(this)
    logger.info('[LoadingPanelScript] loading 面板就绪')
  }

  override onDestroy(): void {
    const inst = GameInstance.current as { onLoadingPanelDestroyed?(s: LoadingPanelScript): void } | null
    inst?.onLoadingPanelDestroyed?.(this)
  }

  override onUpdate(dt: number): void {
    this.acc += dt
    if (this.acc < STEP_INTERVAL) return
    this.acc = 0
    this.head = (this.head + 1) % SEG_COUNT
    this.paint()
  }

  /** 实例侧推送阶段文案 */
  setStage(text: string): void {
    this.stage = text
    if (this.stageComp) this.stageComp.text = text
  }

  /** 点阵轮转一帧：头段起 3 段常亮，其余暗（显隐而非改色，避免不重绘坑） */
  private paint(): void {
    for (let i = 0; i < this.segs.length; i++) {
      const c = this.segs[i].getComponent(CanvasUIComponent)
      if (c) c.bActive = ((this.head - i + SEG_COUNT) % SEG_COUNT) < LIT_SEGMENTS
    }
  }
}
