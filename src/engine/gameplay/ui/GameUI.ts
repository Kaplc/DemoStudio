/**
 * GameUI — 游戏 UI 容器
 *
 * 仅作为 DOM 容器宿主（挂载到 GameSceneManager.uiLayer），
 * 供 PhySys 射线检测做屏幕坐标换算（getBoundingClientRect）。
 * React HUD 渲染通道已移除，2D UI 渲染统一走 UICamera + UI Component（CanvasTexture）体系。
 */
export class GameUI {
  /** DOM 容器（由 GameSceneManager.uiLayer 挂载） */
  readonly el: HTMLDivElement

  /** UI 逻辑尺寸 */
  width: number
  height: number

  constructor(width = 480, height = 360) {
    this.width = width
    this.height = height

    this.el = document.createElement('div')
    this.el.className = 'gameui-root'
    this.el.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      overflow: hidden;
      z-index: 100;
    `
  }

  // ════════════════════════════════════════════
  //  生命周期
  // ════════════════════════════════════════════

  resize(width: number, height: number) {
    this.width = width
    this.height = height
  }

  /** 清空容器子节点（停止游戏时调用） */
  clearElements() {
    this.el.innerHTML = ''
  }

  /** 销毁容器 */
  dispose() {
    this.el.remove()
  }
}
