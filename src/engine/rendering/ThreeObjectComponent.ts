/**
 * ThreeObjectComponent — THREE 对象托管组件基类
 *
 * 统一托管一个 ThreeObject（Mesh / LineSegments / Sprite / Group ...），
 * 提供：
 *  - 挂载：构造时从原父节点移除，挂到 owner.root 下（参与 Actor 生命周期）
 *  - 释放：EndPlay 时调用 ThreeObject.dispose()（geometry/material/texture 统一释放）
 *  - 可见性：setVisible 与 owner.bActive 联动
 *
 * 接受两种创建方式（推荐前者）：
 *  1. Game 工厂创建（追踪释放）：game.createMesh(geo, mat) → ThreeObject
 *  2. 裸 THREE 对象（World 工厂等）：构造时自动包装为 ThreeObject，释放统一走 dispose
 *
 * 子类只需提供对象类型与专属方法（如 MeshComponent.mesh、LineComponent.lines），
 * 资源释放逻辑统一由 ThreeObject 承担 —— 不再需要各组件重复写 dispose。
 *
 * 用法：
 *   const actor = new GenericActor('Obj')
 *   actor.addComponent(BoxMeshComponent.CreateBox(actor, 'Box', 1, 1, 1, 0xffffff))
 *   spawnActor(actor)   // EndPlay 时自动释放
 */
import * as THREE from 'three'
import { ThreeObject } from './ThreeObject'
import { Component } from '../entity/Component'
import type { Actor } from '../entity/Actor'

export abstract class ThreeObjectComponent<T extends ThreeObject = ThreeObject> extends Component<Actor> {
  /** 托管的 THREE 对象包装（object 为底层 THREE 实例） */
  public abstract readonly obj: T

  constructor(owner: Actor, name = 'ThreeObjectComponent') {
    super(owner)
    this.name = name
  }

  /** 从原父节点移除并挂到 owner.root 下（子类构造末尾调用） */
  protected attachToRoot(obj: ThreeObject): void {
    if (obj.object.parent) obj.object.parent.remove(obj.object)
    // 写入挂载归属（shutdown 兜底时用于孤儿诊断）
    obj.owner = this.owner
    this.owner.root.add(obj.object)
  }

  /**
   * 包装输入：接受 ThreeObject 或裸 THREE 对象（自动包装）。
   * 子类构造传入时调用。
   */
  protected wrap<T2 extends THREE.Object3D>(obj: ThreeObject<T2> | T2): ThreeObject<T2> {
    return obj instanceof ThreeObject ? obj : new ThreeObject(obj)
  }

  override EndPlay(): void {
    const obj = this.obj
    this.owner.root.remove(obj.object)
    obj.dispose()
    super.EndPlay()
  }

  /** 设置对象可见性（与 owner.bActive 联动：两者都可见才显示） */
  setVisible(visible: boolean): void {
    this.obj.object.visible = visible && this.owner.bActive !== false
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    return {
      Type: this.obj.object.type,
      Visible: this.obj.object.visible,
    }
  }
}
