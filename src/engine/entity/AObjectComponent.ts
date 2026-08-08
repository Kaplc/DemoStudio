/**
 * AObjectComponent — AObject 组件基类（最底层）
 *
 * 可附加到 AObject 上的行为模块，只提供基础能力：
 *  - owner 引用
 *  - 启停开关（bEnabled / setEnabled）
 *  - 序列化（serialize）
 *  - Inspector 属性展示（getProperties）
 *
 * 不含生命周期钩子（AObject 无 BeginPlay/Tick/EndPlay），
 * 生命周期由 BObjectComponent 提供；
 * 可编辑属性体系（EditableProperty）由 ActorComponent 提供。
 *
 * 继承 OObject：组件也属于"引擎对象"体系（统一类型标记），
 * 但只持有 owner 引用（组合关系），不继承宿主 AObject。
 *
 * 分层：
 *   OObject（空基类，统一标记）
 *    ├── AObject（宿主体系）
 *    └── AObjectComponent（本类：组件体系 + 基础能力）
 *         └── BObjectComponent（+ BeginPlay/Tick/EndPlay/OnDrawGizmos 生命周期）
 *              └── ActorComponent（+ 泛型限定 Actor + 可编辑属性体系）
 */

import type { AObject } from './AObject'
import { OObject } from './OObject'

export abstract class AObjectComponent<T extends AObject = AObject> extends OObject {
  public readonly owner: T
  public bEnabled = true
  public name = 'Component'

  constructor(owner: T) {
    super()
    this.owner = owner
  }

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
}

