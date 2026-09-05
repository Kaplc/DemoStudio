/**
 * BaseHologram — 基地核心全息面板脚本（World-Space UI P2 fish 用例）
 *
 * 职责（七角色：UI Script 面板表现层）：
 *  - 基地阶段 BeginPlay 后经 UIManager.spawnAnchoredWidget 生成世界空间面板
 *    （base_hologram.widget.html 根已声明 UIWorldAnchorComponent mode='world'）；
 *  - 面板挂在城镇大厅上方（localOffset [0, 3, 0]），主场景渲染（深度遮挡/近大远小）；
 *  - 提供 open/close 供 GM 或后续交互调用（面板随场景切换由 destroyAll 统一回收）。
 *
 * 边界：不改 GameMode 状态、不写资产；面板仅展示。如需"点面板空白处不穿透到身后
 * 建筑"，给 base_hologram.widget.html 的带背景节点声明 `hit-test: block` 即可
 * （PhySys 已支持 world 模式 block 画布世界层拦截，见 doc/engine/physics_system.md 踩坑 8）。
 */
import { BehaviourScript, logger } from '@/engine'
import type { AnchoredWidgetHandle } from '@/engine'

const HOLOGRAM_WIDGET = 'asset/blueprints/ui/base_hologram.widget.json'

export class BaseHologram extends BehaviourScript {
  private handle: AnchoredWidgetHandle | null = null

  override onStart(_args?: Record<string, unknown>): void {
    const world = this.actor?.world
    if (!world) {
      logger.warn('[BaseHologram] 无 world 归属，跳过全息面板生成')
      return
    }
    // 找城镇大厅（面板挂点）；世界面板必须顶层 spawn（不能挂 HUD 子树）
    const townhall = world.findActorByName('Townhall')
    this.handle = world.ui.spawnAnchoredWidget(HOLOGRAM_WIDGET, null, {
      // 资产根已声明 UIWorldAnchorComponent(mode='world')，opts 不参与构造（仅
      // targetActorId 生效）；位姿由下方 setPosition 表达（城镇大厅上方 3m）
    })
    if (this.handle && townhall) {
      // 位姿跟随城镇大厅（世界面板静态位：面板不逐帧跟随，摆在核心上方）
      const pos = townhall.actorLocation
      this.handle.transform?.setPosition(pos.x, pos.y + 3, pos.z)
    }
    logger.info(`[BaseHologram] 全息面板已生成（townhall=${townhall ? '已找到' : '未找到'}）`)
  }

  override onDestroy(): void {
    this.handle?.release()
    this.handle = null
  }

  /** 关闭面板（GM/交互调用入口） */
  close(): void {
    this.handle?.release()
    this.handle = null
  }
}
