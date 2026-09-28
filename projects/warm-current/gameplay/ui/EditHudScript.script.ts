/**
 * EditHudScript — 轨道蓝图台编辑态底部 HUD 行为脚本（edit_hud.widget.json 根节点）
 *
 * 职责（2026-09-30 用户需求：进入编辑态隐藏主 HUD 底栏，换编辑台专用底栏）：
 *  - vm.routeEditMode（编辑态）→ EditBar 显形（蓝图青风格，与 holo_hud 同观感同占位）
 *  - 工具行：建造选型（开合建造面板，展开态 ● + 金色）· 取消放置（仅放置中显形，同 Esc 第一优先）
 *  - 主行：模式标题 + 状态行（放置选型 > vm.blueprintHint，口径在 editHudModel 单测锁定）
 *    + ✕ 退出（收建造面板 + 取消放置 + 退出蓝图台，回地球系默认交互）
 *  - 建造面板引用走惰性自查（HUD Actor 兄弟 widget），不吃 spawn/BeginPlay 时序坑
 *  - 8Hz 差分同步（TextBinder/VisBinder/ColorBinder，避免逐帧重绘）
 */
import { BehaviourScript, UIScriptComponent, logger } from '@/engine'
import { ColorBinder, TextBinder, VisBinder, findButton, findText, wcMode } from './uiCommon'
import { EDIT_HUD_TITLE, editBuildButtonLabel, editCancelVisible, editHudStatusLine } from './editHudModel'
import BuildPanelScript from './BuildPanelScript.script'

/** 编辑 HUD widget 资产路径（HudScript 生成入口） */
export const EDIT_HUD_WIDGET = 'asset/blueprints/ui/edit_hud.widget.json'

export default class EditHudScript extends BehaviourScript {
  private binder = new TextBinder()
  private colors = new ColorBinder()
  private vis = new VisBinder()
  private acc = 1

  /**
   * 建造面板脚本实例（惰性查找，不依赖注入时序）：
   * spawnUIActor 只入队，BeginPlay（脚本实例化 + onStart）下一帧 tickUI 才派发——
   * HUD onStart 互传引用时对方 instance 必为 null（2026-09-30 e2e 实证）。故运行时
   * 按"HUD Actor 的兄弟 widget"自查：EditHud 与 BuildPanel 同挂 HUD Actor 下。
   */
  private panelScript(): BuildPanelScript | null {
    const hud = this.actor?.parent
    if (!hud) return null
    for (const child of hud.getChildren()) {
      const inst = child.getComponent(UIScriptComponent)?.instance
      if (inst instanceof BuildPanelScript) return inst
    }
    return null
  }

  override onStart(): void {
    const bind = (name: string, fn: () => void): void => {
      const btn = findButton(this.actor, name)
      if (btn) btn.onClick = fn
      else logger.warn(`[EditHudScript] 按钮 ${name} 未找到（widget 节点缺失?）`)
    }
    // 建造选型：开合建造面板（蓝图台内的建筑选型工具，进入蓝图台时由 HudScript 预开）
    bind('EditBtn_build', () => {
      const panel = this.panelScript()
      if (!panel) {
        logger.warn('[EditHudScript] 建造选型点击但面板引用缺失')
        return
      }
      if (panel.isOpen) {
        panel.close()
        logger.info('[EditHudScript] 建造面板收起（编辑 HUD）')
      } else {
        panel.open()
        logger.info('[EditHudScript] 建造面板打开（编辑 HUD）')
      }
    })
    // 取消放置：同 Esc 第一优先（退出 buildMode，留在蓝图台继续编辑）
    bind('EditBtn_cancel', () => {
      wcMode()?.cancelBuildMode()
      logger.info('[EditHudScript] 取消放置（编辑 HUD）')
    })
    // ✕ 退出：收建造面板 + 取消放置 + 退出蓝图台（回地球系默认交互）
    bind('EditBtn_exit', () => {
      const m = wcMode()
      if (!m) return
      this.panelScript()?.close()
      m.cancelBuildMode()
      m.toggleRouteEditMode()
      logger.info(`[EditHudScript] 退出编辑台 → routeEditMode=${m.routeEditMode}`)
    })
    // 默认收起（脚本置位，先于首帧渲染）。走 setPanel：UIManager 会把面板根整树
    // 失活，此处需同步置面板根，保证后续打开时不被父链 effective 压制。
    this.vis.setPanel(this.actor, 'EditBar', false)
    logger.info('[EditHudScript] 编辑台 HUD 就绪（默认收起）')
  }

  override onUpdate(dt: number): void {
    const mode = wcMode()
    if (!mode) return
    this.acc += dt
    if (this.acc < 0.12) return
    this.acc = 0
    const vm = mode.buildViewModel()
    // 编辑态显隐（与主 HUD 底栏互斥：HudScript 同帧藏 BottomBar）
    this.vis.setPanel(this.actor, 'EditBar', vm.routeEditMode)
    if (!vm.routeEditMode) return

    // 标题 + 状态行（口径在 editHudModel，单测锁定）：放置选型名 > 通用蓝图提示
    const buildName = vm.buildActive
      ? (vm.buildRows.find((r) => r.id === vm.buildActive)?.name ?? vm.buildActive)
      : null
    this.binder.set(findText(this.actor, 'EditTitle'), EDIT_HUD_TITLE)
    this.binder.set(findText(this.actor, 'EditStatus'), editHudStatusLine(buildName, vm.blueprintHint))

    // 取消放置：仅放置中显形
    this.vis.set(this.actor, 'EditBtn_cancel', editCancelVisible(vm.buildActive))

    // 建造选型按钮：面板展开态 ● + 金色（与全息底栏选中态同表达）
    const open = this.panelScript()?.isOpen ?? false
    const label = findText(this.actor, 'EditBuildLabel')
    this.binder.set(label, editBuildButtonLabel(open))
    this.colors.set(label, open ? '#ffe9a8' : '#4fd8ff')
  }

  override onDestroy(): void {
    // 随世界销毁，无需单独清理
  }
}
