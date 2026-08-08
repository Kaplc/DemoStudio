/**
 * UIButtonComponent — 按钮交互组件（纯交互，不负责渲染）
 *
 * 模仿 Unity Button 的交互部分：状态切换（normal / hover / pressed / disabled）
 * 与点击事件回调。背景渲染由同一 Actor 上的 UIImageComponent 提供
 * （Unity Button.targetGraphic 模式：状态切换时驱动 Image 的颜色）。
 *
 * 注意：
 *  - 本组件不创建任何画布/mesh，点击命中依赖同 Actor（或子树）上其他 UI 组件的 mesh
 *  - 按钮文字由独立子 Actor 挂 UITextComponent 提供（如 blueprints/ui/main_menu.widget.json）
 *  - 数据配置：{ baseClass: 'UIButtonComponent', properties: { colors: { normal, hover, pressed, disabled }, pressScale? } }
 *  - 默认动效：按下（pressed）时 owner 立即微缩（pressScale=0.92），松开立即恢复原始缩放
 */
import * as THREE from 'three'
import { Component } from '../entity/Component'
import { ClickableComponent } from '../physics/ClickableComponent'
import { UIImageComponent } from './UIImageComponent'
import { logger } from '../Logger'
import type { Actor } from '../entity/Actor'

export type ButtonState = 'normal' | 'hover' | 'pressed' | 'disabled'

export interface UIButtonComponentOptions {
  /** 各状态背景色（驱动同 Actor 上 UIImageComponent 的颜色） */
  colors?: Partial<Record<ButtonState, string>>
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
  /** 是否已尝试解析 graphic（组件挂载顺序可能导致构造时找不到） */
  private _graphicResolved = false
  /** 按下缩放比例（1 = 关闭动效） */
  private _pressScale: number
  /** 原始缩放：首次按下时缓存 owner.root.scale（尊重蓝图/Inspector 设置的原始缩放） */
  private _baseScale: THREE.Vector3 | null = null

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
    clickable.onClick = () => {
      this.triggerClick()
    }
  }

  override BeginPlay(): void {
    // 组件挂载顺序可能 uibutton 先于 uiimage，BeginPlay 时再解析一次关联背景
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

  /** 更新状态色映射（数据热更新用），并立即应用当前状态色 */
  setColors(colors: Partial<Record<ButtonState, string>>): void {
    this._colors = { ...this._colors, ...colors }
    this.applyStateColor()
  }

  /** 触发点击（外部输入系统 / AI 事件调用） */
  triggerClick(): void {
    if (this._state === 'disabled') return
    logger.info(`[UIButtonComponent] "${this.name}" 被点击`)
    this.state = 'pressed'
    this._onClick?.()
    // 复位状态下一帧执行（简化版）
    setTimeout(() => { if (this._state === 'pressed') this.state = 'normal' }, 100)
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

  /** 查找同 Actor 上的背景图组件（作为状态色驱动目标） */
  private resolveGraphic(): void {
    if (this._graphicResolved) return
    this._graphicResolved = true
    const g = this.owner.getComponent(UIImageComponent)
    if (g) {
      this._graphic = g
      // normal 态未显式配置时，以背景图当前颜色为准（保留数据里 uiimage.color 的语义）
      if (!this._colors.normal) this._colors.normal = g.color
    }
  }

  /** 状态色驱动关联背景图（Unity Button.targetGraphic 模式） */
  private applyStateColor(): void {
    if (!this._graphic) this.resolveGraphic()
    if (this._graphic) {
      this._graphic.color = this._colors[this._state]
    }
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    return {
      State: this._state,
      Colors: { ...this._colors },
      PressScale: this._pressScale,
      Graphic: this._graphic ? this._graphic.constructor.name : '（无，需挂 uiimage）',
    }
  }
}
