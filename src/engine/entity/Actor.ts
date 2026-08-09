/**
 * Actor — 世界中的场景对象
 * 模仿 UE Actor，继承 BObject 并拥有 Transform（root）、可见性树、子节点层级。
 * 凡是要出现在 3D 场景里的实体（Pawn / 建筑 / UI / 摄像机 / 装饰）都继承本类。
 */
import * as THREE from 'three'
import { BObject } from './BObject'
import type { Component } from './Component'
import type { World } from '../gameflow/World'
import type { PropertyPatch } from '../tools/deepMerge'
import { clonePatch } from '../tools/deepMerge'

export abstract class Actor extends BObject {
  public readonly root: THREE.Group

  /** 所属世界（由 World.SpawnActor 设置；场景对象专属，非场景对象不持有） */
  public world: World | null = null

  /** Blueprint 实例元数据（由 SpawnActorFromBlueprint 设置；非蓝图实例为 null） */
  public blueprintRef: { id: string; overrides?: PropertyPatch } | null = null
  /** 由 ref 子节点生成，大纲中不展开其内部子 Actor */
  public isRefInstance = false

  private children: Actor[] = []
  private _parent: Actor | null = null

  constructor(name = 'Actor') {
    super(name)
    this.root = new THREE.Group()
    this.root.name = name
    this.root.userData.actorRef = this
    this.root.userData.actorUid = this.uid
  }

  // ═══════════════════════════════════
  //  生命周期（扩展：递归子 Actor）
  // ═══════════════════════════════════

  /** 游戏开始，所有组件就绪后调用一次 */
  override BeginPlay(): void {
    if (this.bHasBegunPlay) return
    super.BeginPlay()
    // 递归子 Actor（内联子节点经 attachTo 挂载，不在 World.allActors 中，
    // 由父链传播 BeginPlay；bHasBegunPlay 防止 ref 子节点重复调用）
    for (const child of this.children) {
      child.BeginPlay()
    }
  }

  /** 销毁前调用 */
  override EndPlay(): void {
    super.EndPlay()
    // 递归销毁子 Actor
    for (const child of [...this.children]) {
      child.destroy()
    }
  }

  /** 销毁自己，由 World 实际清理（场景对象专属） */
  destroy() {
    if (this.bPendingDestroy) return
    this.bPendingDestroy = true
    if (this.world) {
      this.world.DestroyObject(this)
    } else {
      // 无 world 归属（如 UI 内联子节点：attachTo 挂树、从不经 SpawnActor）：
      // 无法走 World 统一销毁，直接本地 EndPlay（递归子树 + 组件 + 注册表注销）
      this.EndPlay()
    }
  }

  /** 组件列表收窄为 ActorComponent（含可编辑属性体系 persistType/getPersistentProps） */
  override getAllComponents(): import('./ActorComponent').ActorComponent[] {
    return super.getAllComponents() as import('./ActorComponent').ActorComponent[]
  }

  // ═══════════════════════════════════
  //  Active（激活状态）
  // ═══════════════════════════════════

  private _bActive = true
  /**
   * 大纲"小眼睛"的临时预览隐藏（仅影响渲染表现，不写入资产/蓝图）。
   * 与 _bActive 解耦：active 控制节点级语义并参与 save/load；
   * previewHidden 仅用于编辑器预览，调用 setPreviewHidden 切换。
   * applyActiveTree 计算最终 visible 时综合两者：visible = effective && !previewHidden。
   */
  private _previewHidden = false

  /**
   * 是否激活（默认 true）。
   * false = 节点已创建但不渲染，同时作用于整个子树（子节点继承父节点失活）。
   * 组件/脚本生命周期照常运行，仅控制可见性（root.visible）。
   * 注：命名避开对象池语义的 active（FishBullet 等池化 Actor 用 active 表示"池中占用"）。
   */
  get bActive(): boolean { return this._bActive }

  set bActive(v: boolean) {
    if (this._bActive === v) return
    this._bActive = v
    // 从根重新应用整个祖先链，保证"父失活 → 子树全部隐藏"的一致性
    let top: Actor = this
    while (top.parent) top = top.parent
    top.applyActiveTree(true)
  }

  /** 仅编辑器大纲使用：临时预览隐藏，不修改 active、不写入资产/蓝图 */
  get previewHidden(): boolean { return this._previewHidden }

  /**
   * 大纲"小眼睛"调用的临时隐藏入口。
   * 仅切换 _previewHidden 并重算 visible，不动 _bActive、不触发蓝图层 active 变更。
   * @param hidden true = 暂时隐藏（仅预览），false = 恢复（受 active 接管）
   */
  setPreviewHidden(hidden: boolean): void {
    if (this._previewHidden === hidden) return
    this._previewHidden = hidden
    // 从根重新应用祖先链，让 previewHidden 与 active 共同决定的 visible 生效
    let top: Actor = this
    while (top.parent) top = top.parent
    top.applyActiveTree(true)
  }

  /** 递归应用可见性（内部）：visible = 自身激活 && 祖先链有效 && 未预览隐藏 */
  private applyActiveTree(parentEffective: boolean): void {
    const effective = this._bActive && parentEffective
    this.root.visible = effective && !this._previewHidden
    for (const child of this.children) {
      child.applyActiveTree(effective)
    }
  }

  // ═══════════════════════════════════
  //  Transform
  // ═══════════════════════════════════

  get position(): THREE.Vector3 { return this.root.position }
  set position(v: THREE.Vector3) { this.root.position.copy(v) }

  get rotation(): THREE.Euler { return this.root.rotation }
  set rotation(v: THREE.Euler) { this.root.rotation.copy(v) }

  get scale(): THREE.Vector3 { return this.root.scale }
  set scale(v: THREE.Vector3) { this.root.scale.copy(v) }

  setPosition(x: number, y: number, z: number) { this.root.position.set(x, y, z) }
  setRotation(x: number, y: number, z: number) { this.root.rotation.set(x, y, z) }
  setScale(x: number, y: number, z: number) { this.root.scale.set(x, y, z) }

  get actorLocation(): THREE.Vector3 {
    const v = new THREE.Vector3()
    this.root.getWorldPosition(v)
    return v
  }

  // ═══════════════════════════════════
  //  层级关系
  // ═══════════════════════════════════

  get parent(): Actor | null { return this._parent }

  attachTo(parent: Actor) {
    if (this._parent) this.detach()
    this._parent = parent
    parent.children.push(this)
    parent.root.add(this.root)
  }

  detach() {
    if (!this._parent) return
    const idx = this._parent.children.indexOf(this)
    if (idx >= 0) this._parent.children.splice(idx, 1)
    this._parent.root.remove(this.root)
    this._parent = null
  }

  getChildren(): readonly Actor[] { return this.children }

  /** 在场景中查找指定类型的 Actor（递归） */
  findActorInChildren<T extends Actor>(type: new (...args: any[]) => T): T | null {
    for (const child of this.children) {
      if (child instanceof type) return child
      const found = child.findActorInChildren(type)
      if (found) return found
    }
    return null
  }

  // ═══════════════════════════════════
  //  便利方法
  // ═══════════════════════════════════

  /** 添加到 World 的场景中（由 SpawnActor 调用） */
  addToScene(scene: THREE.Scene) {
    scene.add(this.root)
  }

  /** 从场景移除 */
  removeFromScene(scene: THREE.Scene) {
    scene.remove(this.root)
  }

  // ═══════════════════════════════════
  //  Blueprint 数据驱动
  // ═══════════════════════════════════

  /**
   * 应用属性补丁（Blueprint 实例化注入 CDO 默认值、运行时覆盖共用）。
   *
   * 先解析约定 transform 字段（position / rotation / scale，number[3]）调对应 setter，
   * 剩余字段深拷贝后交给 applyCustomDefaults（行为类 override 读取自定义参数）。
   *
   * 注意：本方法不触碰 world / 不构建几何；行为类的几何构建仍留 BeginPlay。
   */
  applyPatch(patch: PropertyPatch): void {
    const pos = patch.position
    if (Array.isArray(pos)) this.setPosition(pos[0], pos[1], pos[2])
    const rot = patch.rotation
    if (Array.isArray(rot)) this.setRotation(rot[0], rot[1], rot[2])
    const scl = patch.scale
    if (Array.isArray(scl)) this.setScale(scl[0], scl[1], scl[2])

    const rest: PropertyPatch = {}
    for (const k of Object.keys(patch)) {
      if (k !== 'position' && k !== 'rotation' && k !== 'scale') rest[k] = patch[k]
    }
    if (Object.keys(rest).length > 0) {
      this.applyCustomDefaults(clonePatch(rest))
    }
  }

  /**
   * 子类 override：从补丁读取自定义参数（如 FishHouseActor 读 houseSize / houseColors）。
   * 默认实现忽略。约束：只赋值字段，绝不触碰 world 或构建几何。
   * 收到的 patch 已是深拷贝，可安全直接赋值。
   */
  applyCustomDefaults(_patch: PropertyPatch): void {}

  // ═══════════════════════════════════
  //  序列化（为未来场景保存预留；当前存档系统不遍历调用）
  // ═══════════════════════════════════

  /** 序列化：name + transform，子类 override 追加自定义数据 */
  override serialize(): Record<string, unknown> {
    return {
      ...super.serialize(),
      position: [this.position.x, this.position.y, this.position.z],
      rotation: [this.rotation.x, this.rotation.y, this.rotation.z],
      scale: [this.scale.x, this.scale.y, this.scale.z],
    }
  }

  /** 反序列化：默认仅恢复 transform（name 在构造时确定） */
  override deserialize(data: Record<string, unknown>): void {
    super.deserialize(data)
    const pos = data.position as [number, number, number] | undefined
    if (pos) this.setPosition(pos[0], pos[1], pos[2])
    const rot = data.rotation as [number, number, number] | undefined
    if (rot) this.setRotation(rot[0], rot[1], rot[2])
    const scl = data.scale as [number, number, number] | undefined
    if (scl) this.setScale(scl[0], scl[1], scl[2])
  }
}
