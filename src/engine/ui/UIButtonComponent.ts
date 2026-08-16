/**
 * UIButtonComponent — 按钮交互组件（纯交互 + 自有透明点击层）
 *
 * 模仿 Unity Button 的交互部分：状态机（normal / hover / pressed / disabled）、
 * 点击回调、按下缩放动效。**不渲染任何视觉、不驱动任何 Image 的颜色**：
 *  - 视觉背景由同 Actor 的 UIImageComponent 或子节点（Frame 等）提供
 *  - 颜色变化（hover 高亮等）由脚本 / Inspector 直接修改目标 Image，按钮不代理
 *
 * 命中层（射线语义）：
 *  - BeginPlay 自动生成**透明点击层**（UIImageComponent，opacity 恒 0 +
 *    isClickOnly 标记）：仅提供命中 mesh，不渲染视觉
 *  - ClickableComponent 的射线目标精确锁定为该层 mesh（setTargets）——
 *    点击区域 = owner uitransform 世界尺寸的矩形，**与子节点无关**
 *    （子节点 Frame / Text 的 mesh 不参与本按钮的射线）
 *  - 裸 Image（无 ClickableComponent）不注册到 PhySys → 不响应射线，点击穿透；
 *    只有「挂了 ClickableComponent 的节点 + 其目标 mesh」才消费点击
 *
 * 注意：
 *  - 透明点击层不参与状态色驱动 / TweenSystem.fade（避免 fade 后变可见）
 *  - 按钮文字由独立子 Actor 挂 UITextComponent 提供（如 blueprints/ui/main_menu.widget.json）
 *  - 数据配置：{ baseClass: 'UIButtonComponent', properties: { pressScale? } }
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
  onClick?: () => void
  /** 按下缩放比例（默认 0.92；>=1 或 <=0 时关闭缩放动效） */
  pressScale?: number
}

export class UIButtonComponent extends Component<Actor> {
  private _state: ButtonState = 'normal'
  private _onClick: (() => void) | null
  /** 透明点击层（自动生成的 UIImageComponent，非资产配置；保存时不写回 JSON） */
  private _hitLayer: UIImageComponent | null = null
  /** 按下缩放比例（1 = 关闭动效） */
  private _pressScale: number
  /** 原始缩放：首次按下时缓存 owner.root.scale（尊重蓝图/Inspector 设置的原始缩放） */
  private _baseScale: THREE.Vector3 | null = null
  /** 鼠标是否正在按住本按钮（onPress 置位 / onRelease 清除；长按期间保持 pressed 状态） */
  private _pointerPressed = false

  constructor(owner: Actor, options: UIButtonComponentOptions = {}) {
    super(owner)
    this.name = 'UIButtonComponent'

    this._onClick = options.onClick ?? null
    this._pressScale = options.pressScale ?? 0.92

    logger.info(`[UIButtonComponent] 创建: pressScale=${this._pressScale}`)

    // 自动挂载可点击组件：命中透明点击层 → triggerClick（PhySys 射线分发，无需额外代码）
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
    // 悬停：驱动状态机（外部可查询；无颜色副作用，视觉高亮由脚本自理）
    clickable.onHover = (hit) => this.hover(hit !== null)
  }

  override BeginPlay(): void {
    // 此时 transform 尺寸已就绪：生成透明点击层并锁定射线目标
    this.createHitLayer()
  }

  get state(): ButtonState { return this._state }
  set state(v: ButtonState) {
    if (this._state === v) return
    this._state = v
    this.applyPressScale()
    logger.info(`[UIButtonComponent] "${this.name}" 状态 -> ${v}`)
  }

  /** 点击回调（外部绑定，如菜单按钮 → 开始游戏） */
  get onClick(): (() => void) | null { return this._onClick }
  set onClick(fn: (() => void) | null) { this._onClick = fn }

  /** 按下缩放比例（1 = 关闭动效），AI/调试用 */
  get pressScale(): number { return this._pressScale }

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

  /** 悬停状态机：进入 hover / 离开回 normal（pressed/disabled 期间不抢占） */
  private hover(enter: boolean): void {
    if (this._state === 'disabled' || this._pointerPressed) return
    this.state = enter ? 'hover' : 'normal'
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
   * 生成透明点击层并把射线目标锁定到它：
   *  - 尺寸 = owner uitransform 世界尺寸（无 transform 时回退 1×1）
   *  - 像素 = 世界尺寸 × 200px/单位（与现有资产惯例一致，避免拉伸模糊）
   *  - **透明**（opacity 恒 0 + isClickOnly 标记）：仅提供命中 mesh，不渲染视觉
   *  - ClickableComponent.setTargets([panel])：命中 = 本按钮矩形，
   *    子节点 mesh 不参与（裸 Image 无 ClickableComponent 本就穿透）
   *  - 非资产组件：保存（getPersistentProps 回写）时 JSON 无对应组件 → 不会写入资产
   */
  private createHitLayer(): void {
    const clickable = this.owner.getComponent(ClickableComponent)
    if (!clickable) {
      logger.warn(`[UIButtonComponent] "${this.name}" 缺少 ClickableComponent，无法锁定射线目标`)
      return
    }
    // 幂等：BeginPlay 可能被多次调用（编辑器预览重建）
    if (this._hitLayer) return

    const tsf = this.owner.getComponent(UITransformComponent)
    const [w, h] = tsf ? tsf.getWorldSize() : [1, 1]
    if (w <= 0 || h <= 0) {
      logger.warn(`[UIButtonComponent] "${this.name}" 透明点击层生成失败：世界尺寸无效 ${w}×${h}`)
      return
    }
    const pxW = Math.max(32, Math.round(w * 200))
    const pxH = Math.max(32, Math.round(h * 200))
    const img = new UIImageComponent(this.owner, {
      color: '#ffffff',
      width: pxW,
      height: pxH,
      worldWidth: w,
      worldHeight: h,
      opacity: 0, // 透明点击层：不渲染视觉，仅命中
    })
    img.isClickOnly = true
    this.owner.addComponent(img)
    this._hitLayer = img

    // 射线目标锁定：命中区域 = 本按钮矩形（子节点 Frame/Text 的 mesh 不参与本按钮射线）
    if (img.panel) clickable.setTargets([img.panel])
    logger.info(`[UIButtonComponent] "${this.name}" 生成透明点击层: ${w}×${h} 世界（${pxW}×${pxH}px），射线目标已锁定`)
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    return {
      State: this._state,
      PressScale: this._pressScale,
      HitLayer: this._hitLayer ? 'UIImageComponent（透明点击层）' : '（未生成，等待 BeginPlay）',
    }
  }
}
