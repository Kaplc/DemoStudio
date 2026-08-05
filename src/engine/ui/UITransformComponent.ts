/**
 * UITransformComponent — UI 专用变换组件
 *
 * 继承 TransformComponent，为 UI Actor 增加"尺寸 + 九宫格锚点定位"能力
 * （Unity RectTransform 风格）：
 *  - worldWidth/worldHeight：控件世界尺寸（原在 canvasui/uiimage/uitext/uibutton 上，
 *    迁移至此处统一管理，渲染组件的面板 scale 由此驱动）
 *  - 锚点决定 UI 元素中心在父容器九宫格上的对齐位置
 *  - 默认贴合容器内边（不溢出），可用 anchorOffset 微调
 *  - 自身尺寸：本组件持有的 worldWidth/worldHeight
 *  - 容器尺寸：向上查找父 Actor 的画布（跳过 markerOnly）
 *
 * 数据驱动：blueprint { baseClass: 'UITransformComponent', properties: { position?, rotation?, scale?, worldWidth?, worldHeight?, anchor?, anchorOffset? } }
 * UI Actor 约定：每个 UI Actor 挂 uitransform + canvasui(markerOnly) + 功能组件（uitext/uiimage/uibutton），
 * 锚点与尺寸统一由本组件的 uitransform 承载。
 */
import type { Actor } from '../entity/Actor'
import { TransformComponent, ensureTransformComponent, type TransformComponentOptions } from '../entity/TransformComponent'
import { type EditableProperty } from '../entity/Component'
import { CanvasUIComponent } from '../rendering/CanvasUIComponent'
import { logger } from '../Logger'

/**
 * 九宫格锚点预设（相对父容器，Unity Anchor Preset 风格）
 *  - 决定 UI 元素中心在父容器九宫格上的对齐位置
 *  - 默认贴合容器内边（不溢出），可用 anchorOffset 微调
 *  - stretch（全锚）：元素填满父容器——尺寸跟随父容器（父变 → 自身尺寸/位置同步），
 *    通常配合父容器比例切换（如视口 16:9 → 4:3）让背景/面板自动铺满
 */
export type AnchorPreset =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'middle-center' | 'center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'
  | 'stretch'

/** 锚点 → 方向因子（x: -1 左/0 中/+1 右，y: -1 下/0 中/+1 上） */
const ANCHOR_FACTORS: Record<AnchorPreset, [number, number]> = {
  'top-left': [-1, 1], 'top-center': [0, 1], 'top-right': [1, 1],
  'middle-left': [-1, 0], 'middle-center': [0, 0], 'center': [0, 0], 'middle-right': [1, 0],
  'bottom-left': [-1, -1], 'bottom-center': [0, -1], 'bottom-right': [1, -1],
  // stretch 走 applyAnchor 的专用分支，不经过方向因子（占位）
  'stretch': [0, 0],
}

export interface UITransformComponentOptions extends TransformComponentOptions {
  /** 世界宽（米），默认 5 */
  worldWidth?: number
  /** 世界高（米），默认 2.5 */
  worldHeight?: number
  /** 九宫格锚点（相对父容器画布），默认 null（不自动定位，沿用 position） */
  anchor?: AnchorPreset
  /** 相对锚点的世界偏移 [x, y]，默认 [0, 0] */
  anchorOffset?: [number, number]
}

export class UITransformComponent extends TransformComponent {
  private _worldW = 5
  private _worldH = 2.5
  /** 尺寸是否被显式设置（JSON 数据给出 worldWidth/worldHeight） */
  private _worldSizeExplicit = false
  private _anchor: AnchorPreset | null = null
  private _anchorOffset: [number, number] = [0, 0]

  constructor(owner: Actor, options: UITransformComponentOptions = {}) {
    super(owner, options)
    this.name = 'UITransformComponent'
    if (options.worldWidth !== undefined) this._worldW = options.worldWidth
    if (options.worldHeight !== undefined) this._worldH = options.worldHeight
    if (options.worldWidth !== undefined || options.worldHeight !== undefined) this._worldSizeExplicit = true
    if (options.anchor !== undefined) this._anchor = options.anchor
    if (options.anchorOffset !== undefined) this._anchorOffset = options.anchorOffset
    else if (this._anchor) this._anchorOffset = [0, 0]
    logger.debug(`[UITransformComponent] 创建 "${this.name}": size=${this._worldW}x${this._worldH}, anchor=${this._anchor ?? 'null'}, offset=${JSON.stringify(this._anchorOffset)}`)
  }

  /** 世界尺寸是否显式设置（JSON 数据给出时 true） */
  get worldSizeExplicit(): boolean { return this._worldSizeExplicit }

  /** 获取世界尺寸 [w, h] */
  getWorldSize(): [number, number] {
    return [this._worldW, this._worldH]
  }

  /** 设置世界尺寸并同步 owner 上所有 UI 组件（真实画布面板 panel.scale + 尺寸变化钩子） */
  setWorldSize(w: number, h: number) {
    this._worldW = w
    this._worldH = h
    this._worldSizeExplicit = true
    for (const ui of this.owner.getComponents(CanvasUIComponent)) {
      // 真实画布：同步面板缩放
      if (!ui.isMarkerOnly && ui.panel) ui.panel.scale.set(w, h, 1)
      // 所有 UI 组件（含 markerOnly 文本）：通知尺寸变化，让子类重算内部布局（如 troika 字号）
      ui.onWorldSizeChange()
    }
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
    // 全锚（stretch）：填满父容器——自身尺寸 = 容器尺寸，位置 = 父中心（相对父为 0,0）。
    // 父容器尺寸变化（视口比例切换等）→ 再次 applyAnchor 时尺寸/位置自动跟随
    if (this._anchor === 'stretch') {
      const [cw, ch] = container
      this.setWorldSize(cw, ch)
      this.owner.setPosition(0, 0, this.owner.root.position.z)
      logger.info(`[UITransformComponent] "${this.name}" 全锚 stretch → 填满父容器 ${cw.toFixed(3)}x${ch.toFixed(3)}`)
      return
    }
    const factors = ANCHOR_FACTORS[this._anchor]
    if (!factors) {
      logger.error(`[UITransformComponent] "${this.name}" 未知锚点值 "${this._anchor}"，已跳过`)
      return
    }
    const self = this.getSelfSize()
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

  /** 自身世界尺寸：本组件持有的 worldWidth/worldHeight（尺寸已迁移到 transform 上） */
  private getSelfSize(): [number, number] {
    return [this._worldW, this._worldH]
  }

  /**
   * 向上查找最近的父容器尺寸（UI 层级语义）。
   *
   * 规则（优先级从高到低）：
   *  1. 父 Actor 的 UITransformComponent 且 worldSizeExplicit（显式设置了 worldWidth/worldHeight）
   *     —— markerOnly 容器（如 BottomBar）也有明确世界尺寸，它就是子元素的布局容器；
   *     若跳过它直接找根画布，子元素锚点会相对根画布再次叠加父容器的锚点偏移 → 双重叠加掉出画布
   *  2. 父 Actor 上的真实画布（非 markerOnly CanvasUIComponent），兜底
   */
  private findContainerSize(): [number, number] | null {
    let p = this.owner.parent
    let hops = 0
    while (p) {
      // 1. 父 Actor 显式设置的 uitransform 尺寸 → 容器基准
      const tf = p.getComponent(UITransformComponent)
      if (tf && tf.worldSizeExplicit) {
        const size = tf.getWorldSize()
        logger.debug(`[UITransformComponent] "${this.name}" 找到父容器: Actor="${p.name}" 尺寸=${size[0]}x${size[1]}（uitransform 显式，${hops + 1} 级向上）`)
        return size
      }
      // 2. 兜底：真实画布（非仅标记）——markerOnly 组件只作 UI 标识，不作为容器
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
      worldWidth: this.round2(this._worldW),
      worldHeight: this.round2(this._worldH),
      anchor: this._anchor ?? '（无）',
      anchorOffset: [this.round2(this._anchorOffset[0]), this.round2(this._anchorOffset[1])],
    }
  }

  /** Inspector 可编辑属性：世界宽/高（number）、锚点（枚举下拉）、锚点偏移（vec2） */
  override getEditableProperties(): EditableProperty[] {
    const base = super.getEditableProperties() // position/rotation/scale（由 collectSaveData 回写）
    const ANCHOR_OPTIONS: string[] = [
      '（无）',
      'top-left', 'top-center', 'top-right',
      'middle-left', 'middle-center', 'center', 'middle-right',
      'bottom-left', 'bottom-center', 'bottom-right',
      'stretch',
    ]
    return [
      ...base,
      {
        key: 'worldWidth', type: 'number', step: 0.01, min: 0,
        get: () => this.round2(this._worldW),
        set: (v) => this.setWorldSize(v as number, this._worldH),
      },
      {
        key: 'worldHeight', type: 'number', step: 0.01, min: 0,
        get: () => this.round2(this._worldH),
        set: (v) => this.setWorldSize(this._worldW, v as number),
      },
      {
        key: 'anchor', type: 'enum', options: ANCHOR_OPTIONS,
        get: () => this._anchor ?? '（无）',
        set: (v) => { this.anchor = (v === '（无）' ? null : v as AnchorPreset) },
      },
      {
        key: 'anchorOffset', type: 'vec2', step: 0.01,
        get: () => [this.round2(this._anchorOffset[0]), this.round2(this._anchorOffset[1])],
        set: (v) => { this.anchorOffset = [(v as number[])[0], (v as number[])[1]] },
      },
    ]
  }

  /**
   * 持久化：worldWidth/worldHeight/anchor/anchorOffset 由可编辑属性扫描收集
   * （camelCase key 与 JSON 属性名一致）；position/rotation/scale 由 collectSaveData 回写。
   * 注意：anchor 输出原始值（null = 无锚点），'（无）' 仅是 Inspector 显示占位，不落盘。
   */
  override getPersistentProps(): Record<string, unknown> {
    return {
      worldWidth: this.round2(this._worldW),
      worldHeight: this.round2(this._worldH),
      anchor: this._anchor,
      anchorOffset: [this.round2(this._anchorOffset[0]), this.round2(this._anchorOffset[1])],
    }
  }

  /** 保留 2 位小数的数值 */
  protected round2(v: number): number {
    return Math.round(v * 100) / 100
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
