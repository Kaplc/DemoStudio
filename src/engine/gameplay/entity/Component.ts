/**
 * Component — 可附加到 Actor 上的行为模块
 * 模仿 UE ActorComponent
 */

import type { Actor } from './Actor'

/** 可编辑属性的数据类型（Inspector 根据类型渲染对应编辑器控件） */
export type EditablePropertyType = 'number' | 'string' | 'boolean' | 'enum' | 'vec2' | 'vec3' | 'color'

/**
 * 可编辑属性描述。组件注册后，Inspector 中该属性从"只读展示"变为"可编辑控件"。
 * - vec2/vec3：值用 [number, number] / [number, number, number] 表示
 * - enum：值用 string，options 提供可选值
 * - color：值用 '#rrggbb' 十六进制字符串
 */
export interface EditableProperty<T = unknown> {
  /** 属性标识（与 getProperties() 返回的 key 对应，Inspector 据此匹配渲染） */
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
}

export abstract class Component {
  public readonly owner: Actor
  public bEnabled = true
  public name = 'Component'

  constructor(owner: Actor) {
    this.owner = owner
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
}
