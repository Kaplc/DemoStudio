/**
 * UIButtonComponent — 按钮交互组件（交互 + 自动透明点击层）
 *
 * 模仿 Unity Button 的交互部分：状态切换（normal / hover / pressed / disabled）
 * 与点击事件回调。背景渲染由同一 Actor 上的 UIImageComponent 提供
 * （Unity Button.targetGraphic 模式：状态切换时驱动 Image 的颜色）。
 *
 * 背景可省略（不需要手动挂载 UIImageComponent）：
 *  - 资产只写 UIButtonComponent 时，BeginPlay 自动生成**透明点击层**
 *    （UIImageComponent，opacity 恒 0 + isClickOnly 标记）：仅提供命中 mesh，
 *    不渲染视觉——点击区域 = uitransform 世界尺寸；视觉背景由子节点
 *    （Frame 等）或其他渲染组件提供
 *  - 资产显式挂了 UIImageComponent 时，沿用显式背景（兼容旧资产，
 *    自定义圆角/图片源/底色的场景继续手动配置；此时状态色驱动其颜色）
 *
 * 注意：
 *  - 自动生成的透明点击层不参与状态色驱动 / TweenSystem.fade（避免 fade 后变可见）
 *  - 点击命中依赖同 Actor（或子树）上其他 UI 组件的 mesh
 *  - 按钮文字由独立子 Actor 挂 UITextComponent 提供（如 blueprints/ui/main_menu.widget.json）
 *  - 数据配置：{ baseClass: 'UIButtonComponent', properties: { colors: { normal, hover, pressed, disabled }, radius?, pressScale? } }
 *  - 按下动效：mousedown 命中（onPress）→ 立即微缩（pressScale=0.92）并保持；
 *    mouseup（onRelease）→ 恢复原始缩放（长按期间持续保持按下态）
 */
import * as THREE from 'three'
import { Component } from '../entity/Component'
import { ClickableComponent } from '../physics/ClickableComponent'
import { UIImageComponent } from './UIImageComponent'
import { UITransformComponent } from './UITransformComponent'
import { logger } from '../Logger'
import type { Actor } from '../entity/Actor'

export type ButtonState = 'normal' | 'hover' | 'pressed' | 'disabled'

export interface UIButtonComponentOptions {
  /** 各状态背景色（驱动背景图颜色；未挂 image 时 normal 色用作自动生成背景的底色） */
  colors?: Partial<Record<ButtonState, string>>
  /** 自动生成背景的圆角（无显式 UIImageComponent 时生效，默认 0） */
  radius?: number
  onClick?: () => void
  /** 按下缩放比例（默认 0.92；>=1 或 <=0 时关闭缩放动效） */
  pressScale?: number
}

export class UIButtonComponent extends Component<Actor> {
  private _state: ButtonState = 'normal'
  private _colors: Required<Record<ButtonState, string>>
  private _onClick: (() => void) | null
  /** 状态色驱动目标：同一 Actor 上的 UIImageComponent（Unity Button.targetGraphic） */
  private _graphic: UIImageComponent | null = null
  /** 自动生成的背景图组件（非资产配置，仅在无显式 image 时创建；保存时不写回 JSON） */
  private _autoGraphic: UIImageComponent | null = null
  /** 自动生成背景的圆角（无显式 image 时生效，资产 properties.radius 转入） */
  private _radius = 0
  /** 是否已尝试解析 graphic（组件挂载顺序可能导致构造时找不到） */
  private _graphicResolved = false
  /** 按下缩放比例（1 = 关闭动效） */
  private _pressScale: number
  /** 原始缩放：首次按下时缓存 owner.root.scale（尊重蓝图/Inspector 设置的原始缩放） */
  private _baseScale: THREE.Vector3 | null = null
  /** 鼠标是否正在按住本按钮（onPress 置位 / onRelease 清除；长按期间保持 pressed 状态） */
  private _pointerPressed = false

  constructor(owner: Actor, options: UIButtonComponentOptions = {}) {
    super(owner)
    this.name = 'UIButtonComponent'

    const defaultColors: Record<ButtonState, string> = {
      normal: '#3a4a5e',
      hover: '#4a6080',
      pressed: '#2a3850',
      disabled: '#666666',
    }
    this._colors = { ...defaultColors, ...(options.colors ?? {}) } as Required<Record<ButtonState, string>>
    this._onClick = options.onClick ?? null
    this._pressScale = options.pressScale ?? 0.92
    this._radius = options.radius ?? 0

    logger.info(`[UIButtonComponent] 创建: colors=${JSON.stringify(this._colors)}, pressScale=${this._pressScale}`)

    // 自动挂载可点击组件：命中按钮面板 → triggerClick（PhySys 射线分发，无需额外代码）
    // 复用已有 ClickableComponent（数据显式配置时），否则新建
    let clickable = owner.getComponent(ClickableComponent)
    if (!clickable) {
      clickable = new ClickableComponent(owner)
      owner.addComponent(clickable)
    }
    // UI 层：独立 UI 相机平行射线检测（双摄像机方案，UI 命中优先于 3D）
    clickable.layer = 'ui'
    // 按下：进入 pressed 并保持（长按持续按下，松手由 onRelease 恢复）
    clickable.onPress = () => this.press()
    clickable.onClick = () => {
      this.triggerClick()
    }
    clickable.onRelease = () => this.release()
  }

  override BeginPlay(): void {
    // 组件挂载顺序可能 uibutton 先于 uiimage，BeginPlay 时再解析一次关联背景；
    // 无显式 image 时自动生成背景（此时 transform 尺寸已就绪）
    this.resolveGraphic()
    this.applyStateColor()
  }

  get state(): ButtonState { return this._state }
  set state(v: ButtonState) {
    if (this._state === v) return
    this._state = v
    this.applyStateColor()
    this.applyPressScale()
    logger.info(`[UIButtonComponent] "${this.name}" 状态 -> ${v}`)
  }

  /** 点击回调（外部绑定，如菜单按钮 → 开始游戏） */
  get onClick(): (() => void) | null { return this._onClick }
  set onClick(fn: (() => void) | null) { this._onClick = fn }

  /** 按下缩放比例（1 = 关闭动效），AI/调试用 */
  get pressScale(): number { return this._pressScale }

  /** 自动生成背景的圆角（无显式 image 时生效；更新后立即重绘自动背景） */
  get radius(): number { return this._radius }
  set radius(v: number) {
    this._radius = v
    if (this._autoGraphic) this._autoGraphic.radius = v
  }

  /**
   * 获取按钮背景（显式配置的 UIImageComponent 或自动生成的背景）。
   * 未解析时立即解析——脚本在 spawnUIActor 返回后（BeginPlay 前）即可访问背景改色。
   */
  getBackground(): UIImageComponent | null {
    if (!this._graphic) this.resolveGraphic()
    return this._graphic
  }

  /** 更新状态色映射（数据热更新用），并立即应用当前状态色 */
  setColors(colors: Partial<Record<ButtonState, string>>): void {
    this._colors = { ...this._colors, ...colors }
    this.applyStateColor()
  }

  /**
   * 触发点击（外部输入系统 / AI 事件调用）。
   * 鼠标点击：pressed 状态由 onPress/onRelease 管理（长按保持，松手恢复），这里只触发逻辑；
   * 非鼠标通道（如 ai.clickActor 瞬时触发）：给出短促按下视觉后自动恢复。
   */
  triggerClick(): void {
    if (this._state === 'disabled') return
    logger.info(`[UIButtonComponent] "${this.name}" 被点击`)
    if (!this._pointerPressed) {
      // 非鼠标通道（AI 等）：短促按下动效
      this.state = 'pressed'
      setTimeout(() => {
        if (this._state === 'pressed' && !this._pointerPressed) this.state = 'normal'
      }, 100)
    }
    this._onClick?.()
  }

  /** 鼠标按下（PhySys 命中分发）：进入 pressed 并保持，直到 onRelease 恢复 */
  private press(): void {
    if (this._state === 'disabled') return
    this._pointerPressed = true
    this.state = 'pressed'
  }

  /** 鼠标释放（PhySys 释放分发）：无论在哪里松开都恢复非按下态 */
  private release(): void {
    this._pointerPressed = false
    if (this._state === 'pressed') this.state = 'normal'
  }

  /** 按下/松开时立即应用缩放：pressed → 微缩，其他状态 → 恢复原始 */
  private applyPressScale(): void {
    // 动效关闭（pressScale 非法）
    if (this._pressScale >= 1 || this._pressScale <= 0) return

    if (this._state === 'pressed') {
      // 首次按下缓存原始缩放（尊重蓝图/Inspector 设置的原始缩放）
      if (!this._baseScale) this._baseScale = this.owner.root.scale.clone()
      this.owner.root.scale.set(
        this._baseScale.x * this._pressScale,
        this._baseScale.y * this._pressScale,
        this._baseScale.z * this._pressScale,
      )
      logger.debug(`[UIButtonComponent] 按下缩放: ${this._baseScale.x.toFixed(3)} → ${this.owner.root.scale.x.toFixed(3)} (pressScale=${this._pressScale})`)
    } else if (this._baseScale) {
      // 松开恢复原始缩放
      this.owner.root.scale.copy(this._baseScale)
      logger.debug(`[UIButtonComponent] 松开恢复缩放: ${this.owner.root.scale.x.toFixed(3)}`)
    }
  }

  /**
   * 解析背景图组件（作为状态色驱动目标）：
   *  - 同 Actor 有显式 UIImageComponent → 沿用（Unity Button.targetGraphic 模式）
   *  - 无显式背景 → 自动生成（尺寸 = uitransform 世界尺寸，颜色 = normal 状态色），
   *    资产中无需再挂 UIImageComponent
   */
  private resolveGraphic(): void {
    if (this._graphicResolved) return
    this._graphicResolved = true
    const g = this.owner.getComponent(UIImageComponent)
    if (g) {
      this._graphic = g
      // normal 态未显式配置时，以背景图当前颜色为准（保留数据里 uiimage.color 的语义）
      if (!this._colors.normal) this._colors.normal = g.color
    } else {
      this._graphic = this.createAutoGraphic()
      this._autoGraphic = this._graphic
    }
  }

  /**
   * 自动生成按钮点击层（无显式 UIImageComponent 时调用）：
   *  - 尺寸 = owner uitransform 世界尺寸（无 transform 时回退 1×1）
   *  - 像素 = 世界尺寸 × 200px/单位（与现有资产惯例一致，避免拉伸模糊）
   *  - **透明**（opacity 恒 0 + isClickOnly 标记）：仅提供命中 mesh，不渲染视觉——
   *    视觉背景由子节点（Frame 等）或其他渲染组件提供，按钮节点本身无需挂 image
   *  - 挂到 owner.root 的 panel mesh 自动参与 ClickableComponent 命中检测
   *  - 非资产组件：保存（getPersistentProps 回写）时 JSON 无对应组件 → 不会写入资产
   */
  private createAutoGraphic(): UIImageComponent | null {
    const tsf = this.owner.getComponent(UITransformComponent)
    const [w, h] = tsf ? tsf.getWorldSize() : [1, 1]
    if (w <= 0 || h <= 0) {
      logger.warn(`[UIButtonComponent] "${this.name}" 自动点击层失败：世界尺寸无效 ${w}×${h}`)
      return null
    }
    const pxW = Math.max(32, Math.round(w * 200))
    const pxH = Math.max(32, Math.round(h * 200))
    const img = new UIImageComponent(this.owner, {
      color: this._colors.normal,
      radius: this._radius,
      width: pxW,
      height: pxH,
      worldWidth: w,
      worldHeight: h,
      opacity: 0, // 透明点击层：不渲染视觉，仅命中
    })
    img.isClickOnly = true
    this.owner.addComponent(img)
    logger.info(`[UIButtonComponent] "${this.name}" 自动生成透明点击层: ${w}×${h} 世界（${pxW}×${pxH}px）`)
    return img
  }

  /**
   * 状态色驱动关联背景图（Unity Button.targetGraphic 模式）。
   * 自动生成的透明点击层跳过（不渲染视觉，无需重绘纹理）。
   */
  private applyStateColor(): void {
    if (!this._graphic) this.resolveGraphic()
    if (this._graphic && !this._autoGraphic) {
      this._graphic.color = this._colors[this._state]
    }
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    return {
      State: this._state,
      Colors: { ...this._colors },
      PressScale: this._pressScale,
      Graphic: this._autoGraphic ? 'UIImageComponent（透明点击层）' : (this._graphic ? this._graphic.constructor.name : '（无，需挂 uiimage）'),
    }
  }
}
