/**
 * Component — 可附加到 Actor 上的行为模块
 * 模仿 UE ActorComponent
 */

import type { Actor } from './Actor'

/** 可编辑属性的数据类型（Inspector 根据类型渲染对应编辑器控件） */
export type EditablePropertyType = 'number' | 'string' | 'boolean' | 'enum' | 'vec2' | 'vec3' | 'color'

/**
 * 蓝图资产持久化目标（蓝图预览模式下由 Inspector 注入到可编辑属性上）。
 * 有值 → 编辑提交额外走 BlueprintEditorService.apply('setChildComponentProps')：
 * 改工作副本 + 进撤销栈（蓝图编辑语义）；
 * 无值 → 保持 prop.set() 直接改运行时组件（游戏模式/非蓝图语义）。
 */
export interface EditablePropertyAssetTarget {
  /** 蓝图资产路径（BlueprintEditorService.apply 的第一参） */
  assetPath: string
  /** 资产 children 中定位子节点的名称（= actor.root.name；找不到匹配时 op 返回错误，不新建节点） */
  childName: string
  /** 组件 baseClass（资产 components 定义按 baseClass 匹配，本地无则新建继承覆盖节点） */
  baseClass: string
}

/**
 * 可编辑属性描述。组件注册后，Inspector 中该属性从"只读展示"变为"可编辑控件"。
 * - vec2/vec3：值用 [number, number] / [number, number, number] 表示
 * - enum：值用 string，options 提供可选值
 * - color：值用 '#rrggbb' 十六进制字符串
 */
export interface EditableProperty<T = unknown> {
  /**
   * 属性标识（camelCase，与 TS 组件属性名 / JSON properties 键名完全一致）。
   * 例如 Text → 'text'，FontSize → 'fontSize'，WorldWidth → 'worldWidth'。
   * 该 key 同时用于：Inspector 渲染匹配（与 getProperties() 的键对应）、
   * 持久化写盘（getPersistentProps 直接读此 key）。
   */
  key: string
  type: EditablePropertyType
  /** 读取当前值（每次渲染调用，保证显示实时） */
  get: () => T
  /** 写回组件（setter 内部应触发重绘/同步） */
  set: (v: T) => void
  /** enum 类型的可选值 */
  options?: string[]
  min?: number
  max?: number
  step?: number
  /**
   * 是否可持久化到资产 JSON（默认 true）。
   * 运行时派生值 / 临时状态（如锚点联动计算值）置 false，
   * 蓝图预览模式下 Inspector 会跳过这些属性，不写资产、不进撤销。
   */
  persistent?: boolean
}

export abstract class Component {
  public readonly owner: Actor
  public bEnabled = true
  public name = 'Component'

  constructor(owner: Actor) {
    this.owner = owner
  }

  /**
   * 持久化时该组件在 JSON 中对应的 baseClass 标识。
   * 约定：baseClass 直接用完整 TS 类名（如 'UITransformComponent'），
   * 默认即 this.constructor.name——组件无需任何手动标记。
   */
  get persistType(): string {
    return this.constructor.name
  }

  /** 游戏开始/激活时调用 */
  BeginPlay(): void {}
  /** 每帧调用 */
  Tick(_deltaTime: number): void {}
  /** 绘制调试 Gizmos（由所属 Actor 每帧调用，可重写） */
  OnDrawGizmos(): void {}
  /** 销毁时调用 */
  EndPlay(): void {}

  /** 启用/禁用 */
  setEnabled(enabled: boolean) {
    this.bEnabled = enabled
  }

  /** 序列化（预留；子类按需 override 返回自定义数据） */
  serialize(): Record<string, unknown> {
    return {}
  }

  /**
   * 获取组件可展示属性（Inspector 用）。
   * 返回扁平的键值对，值应为可 JSON 化的基础类型（string/number/boolean/数组/对象）。
   * 子类按需 override；基类默认返回空对象。
   */
  getProperties(): Record<string, unknown> {
    return {}
  }

  /**
   * 获取组件可编辑属性（Inspector 用）。
   * 子类注册后，对应 key 的属性在 Inspector 中渲染为可编辑控件（number/string/boolean/
   * enum 下拉/vec2/vec3 向量/color 颜色）。未注册的属性保持只读展示。
   * 基类默认返回空数组（全部只读）。
   */
  getEditableProperties(): EditableProperty[] {
    return []
  }

  /**
   * 获取需要持久化的属性键值对（保存蓝图时写回 JSON properties）。
   * 默认实现：遍历 getEditableProperties()，直接取每个属性的当前值。
   * key 即 camelCase 的 JSON 属性名（约定），无需任何转换。
   * 子类可 override 增删（如 uitransform 拆分 worldWidth/worldHeight）。
   */
  getPersistentProps(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const p of this.getEditableProperties()) {
      out[p.key] = p.get()
    }
    return out
  }
}
