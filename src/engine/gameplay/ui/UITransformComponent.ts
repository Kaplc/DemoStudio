/**
 * UITransformComponent — UI 专用变换组件
 *
 * 继承 TransformComponent，为 UI Actor 增加"九宫格锚点定位"能力
 * （Unity Anchor Preset 风格）：
 *  - 锚点决定 UI 元素中心在父容器九宫格上的对齐位置
 *  - 默认贴合容器内边（不溢出），可用 anchorOffset 微调
 *  - 自身尺寸：取 owner 上第一个"真实画布"（非 markerOnly CanvasUIComponent）
 *  - 容器尺寸：向上查找父 Actor 的画布（跳过 markerOnly）
 *
 * 数据驱动：blueprint { baseClass: 'uitransform', properties: { position?, rotation?, scale?, anchor?, anchorOffset? } }
 * UI Actor 约定：每个 UI Actor 挂 transform + canvasui(markerOnly) + 功能组件（uitext/uiimage/uibutton），
 * 锚点统一由本组件的 uitransform 承载。
 */
import type { Actor } from '../entity/Actor'
import { TransformComponent, ensureTransformComponent, type TransformComponentOptions } from '../entity/TransformComponent'
import { CanvasUIComponent } from '../rendering/CanvasUIComponent'
import { logger } from '../../Logger'

/**
 * 九宫格锚点预设（相对父容器，Unity Anchor Preset 风格）
 *  - 决定 UI 元素中心在父容器九宫格上的对齐位置
 *  - 默认贴合容器内边（不溢出），可用 anchorOffset 微调
 */
export type AnchorPreset =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'middle-center' | 'center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

/** 锚点 → 方向因子（x: -1 左/0 中/+1 右，y: -1 下/0 中/+1 上） */
const ANCHOR_FACTORS: Record<AnchorPreset, [number, number]> = {
  'top-left': [-1, 1], 'top-center': [0, 1], 'top-right': [1, 1],
  'middle-left': [-1, 0], 'middle-center': [0, 0], 'center': [0, 0], 'middle-right': [1, 0],
  'bottom-left': [-1, -1], 'bottom-center': [0, -1], 'bottom-right': [1, -1],
}

export interface UITransformComponentOptions extends TransformComponentOptions {
  /** 九宫格锚点（相对父容器画布），默认 null（不自动定位，沿用 position） */
  anchor?: AnchorPreset
  /** 相对锚点的世界偏移 [x, y]，默认 [0, 0] */
  anchorOffset?: [number, number]
}

export class UITransformComponent extends TransformComponent {
  private _anchor: AnchorPreset | null = null
  private _anchorOffset: [number, number] = [0, 0]

  constructor(owner: Actor, options: UITransformComponentOptions = {}) {
    super(owner, options)
    this.name = 'UITransformComponent'
    if (options.anchor !== undefined) this._anchor = options.anchor
    if (options.anchorOffset !== undefined) this._anchorOffset = options.anchorOffset
    else if (this._anchor) this._anchorOffset = [0, 0]
    logger.debug(`[UITransformComponent] 创建 "${this.name}": anchor=${this._anchor ?? 'null'}, offset=${JSON.stringify(this._anchorOffset)}`)
  }

  /** 九宫格锚点（null = 不自动定位，沿用 position） */
  get anchor(): AnchorPreset | null { return this._anchor }
  set anchor(v: AnchorPreset | null) {
    logger.debug(`[UITransformComponent] "${this.name}" 设置锚点: ${v ?? 'null'}（offset=${JSON.stringify(this._anchorOffset)}）`)
    this._anchor = v
    this.applyAnchor()
  }

  /** 相对锚点的世界偏移 */
  get anchorOffset(): [number, number] { return this._anchorOffset }
  set anchorOffset(v: [number, number]) {
    logger.debug(`[UITransformComponent] "${this.name}" 设置锚点偏移: [${v[0]}, ${v[1]}]`)
    this._anchorOffset = v
    this.applyAnchor()
  }

  /**
   * 应用九宫格锚点：按父容器画布尺寸把元素中心放到锚点位置。
   * 语义（Unity Anchor Preset）：
   *  - 元素边缘贴合容器内边（不溢出），中心 = 父中心 + 方向因子 × (父半尺寸 − 自身半尺寸)
   *  - anchorOffset 在此基准上微调
   *  - 找不到父画布（根画布自身）或自身无真实画布时跳过，沿用 position
   */
  applyAnchor(): void {
    logger.debug(`[UITransformComponent] "${this.name}" applyAnchor 进入 (anchor=${this._anchor ?? 'null'})`)
    if (!this._anchor) {
      logger.debug(`[UITransformComponent] "${this.name}" 无锚点，跳过定位（沿用 position）`)
      return
    }
    const container = this.findContainerSize()
    if (!container) {
      logger.warn(`[UITransformComponent] "${this.name}" 未找到父画布容器，跳过锚点 ${this._anchor}（树未构建？）`)
      return
    }
    const factors = ANCHOR_FACTORS[this._anchor]
    if (!factors) {
      logger.error(`[UITransformComponent] "${this.name}" 未知锚点值 "${this._anchor}"，已跳过`)
      return
    }
    const self = this.getSelfSize()
    if (!self) {
      logger.warn(`[UITransformComponent] "${this.name}" 自身无真实画布（全是仅标记组件），跳过锚点`)
      return
    }
    const [fx, fy] = factors
    const [cw, ch] = container
    const [sw, sh] = self
    const ox = this._anchorOffset[0] ?? 0
    const oy = this._anchorOffset[1] ?? 0
    const x = fx * (cw / 2 - sw / 2) + ox
    const y = fy * (ch / 2 - sh / 2) + oy
    this.owner.setPosition(x, y, this.owner.root.position.z)
    logger.info(`[UITransformComponent] "${this.name}" 锚点 ${this._anchor} → 位置 (${x.toFixed(3)}, ${y.toFixed(3)})（容器=${cw}x${ch}, 自身=${sw.toFixed(3)}x${sh.toFixed(3)}, offset=[${ox}, ${oy}]）`)
  }

  /** 自身世界尺寸：owner 上第一个"真实画布"（非仅标记） */
  private getSelfSize(): [number, number] | null {
    const ui = this.owner.getComponents(CanvasUIComponent).find((c) => !c.isMarkerOnly)
    return ui ? ui.getWorldSize() : null
  }

  /** 向上查找最近的父画布尺寸（父 Actor 上的 CanvasUIComponent 世界尺寸；跳过仅标记组件） */
  private findContainerSize(): [number, number] | null {
    let p = this.owner.parent
    let hops = 0
    while (p) {
      // 取该 Actor 上第一个"真正画布"（非仅标记）——markerOnly 组件只作 UI 标识，不作为容器
      const comp = p.getComponents(CanvasUIComponent).find((c) => !c.isMarkerOnly)
      if (comp) {
        const size = comp.getWorldSize()
        logger.debug(`[UITransformComponent] "${this.name}" 找到父画布: Actor="${p.name}" 尺寸=${size[0]}x${size[1]} (${hops + 1} 级向上)`)
        return size
      }
      p = p.parent
      hops++
    }
    logger.debug(`[UITransformComponent] "${this.name}" 未找到父画布（parent=${this.owner.parent?.name ?? 'null'}）`)
    return null
  }

  override BeginPlay(): void {
    super.BeginPlay()
    // 树构建完成（所有 attachTo 已就绪）后应用锚点定位
    this.applyAnchor()
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    const base = super.getProperties()
    return {
      ...base,
      Anchor: this._anchor ?? '（无）',
      AnchorOffset: `[${this._anchorOffset[0]}, ${this._anchorOffset[1]}]`,
    }
  }
}

/**
 * 确保 UI Actor 已挂载 UITransformComponent（UI 组件化约定）：
 *  - 已有 UITransformComponent → 复用
 *  - 已有普通 TransformComponent（旧数据）→ 以当前变换替换为 UITransformComponent
 *  - 没有 → 以当前变换补挂
 */
export function ensureUITransformComponent(actor: Actor): UITransformComponent {
  const existing = actor.getComponent(TransformComponent)
  if (existing instanceof UITransformComponent) return existing
  if (existing) {
    const uiTf = new UITransformComponent(actor, {
      position: [existing.position.x, existing.position.y, existing.position.z],
      rotation: [existing.rotation.x, existing.rotation.y, existing.rotation.z],
      scale: [existing.scale.x, existing.scale.y, existing.scale.z],
    })
    actor.removeComponent(existing)
    actor.addComponent(uiTf)
    logger.debug(`[UITransformComponent] 替换普通 TransformComponent → "${actor.name}" (uid=${actor.uid})`)
    return uiTf
  }
  const uiTf = new UITransformComponent(actor)
  actor.addComponent(uiTf)
  logger.debug(`[UITransformComponent] 自动补挂到 "${actor.name}" (uid=${actor.uid})`)
  return uiTf
}

/**
 * 智能补挂变换组件：UI Actor（有 CanvasUIComponent）挂 UITransformComponent（含锚点能力），
 * 普通 3D Actor 挂 TransformComponent。供 World 等通用实例化入口使用。
 */
export function ensureTransformForActor(actor: Actor): TransformComponent {
  if (actor.getComponent(CanvasUIComponent)) return ensureUITransformComponent(actor)
  return ensureTransformComponent(actor)
}
