/**
 * MeshComponent — 网格渲染组件（抽象基类，不允许直接挂载）
 *
 * 持有一个 ThreeObject<THREE.Mesh>，挂到 owner.root 下参与 Actor 生命周期。
 * EndPlay 时自动释放（由 ThreeObject.dispose 统一负责）。
 *
 * 本类是基类：资产（blueprint/scene JSON）不得声明 baseClass: 'MeshComponent'
 * （assetLint 报错 + ComponentRegistry 未注册），必须用具体派生类：
 *   - BoxMeshComponent     — 轴对齐盒（box 几何，建筑/障碍/不可见碰撞体）
 *   - SphereMeshComponent  — 球体（sphere 几何，球形指示器/命中球）
 *   - PlaneMeshComponent   — 平面（plane 几何，地面/水面/UI 背景）
 *   - CapsuleMeshComponent — 胶囊体（兵种等角色模型）
 *
 * 一个 Actor 只能挂载一个 mesh（组合网格请拆子 Actor，如 new GenericActor + attachTo）。
 *
 * 几何类型由派生类固定，不允许运行时跨类型切换；尺寸 setter 由各派生类实现，
 * 颜色 / 不透明度 / 可见性 setter 由本基类提供，调用方（代码侧 / Inspector 编辑）
 * 走两阶段：先 addComponent 再调 setter。
 */
import * as THREE from 'three'
import { ThreeObjectComponent } from './ThreeObjectComponent'
import { ThreeObject } from './ThreeObject'
import type { Actor } from '../entity/Actor'
import type { EditableProperty } from '../entity/ActorComponent'
import { logger } from '../Logger'

export abstract class MeshComponent extends ThreeObjectComponent<ThreeObject<THREE.Mesh>> {
  public readonly obj: ThreeObject<THREE.Mesh>

  /** 挂载是否被拒（owner 已有 MeshComponent 时 true，mesh 不挂树、组件无效） */
  readonly rejected: boolean

  constructor(owner: Actor, mesh: ThreeObject<THREE.Mesh> | THREE.Mesh, name = 'MeshComponent') {
    // 抽象基类运行时保护：TS abstract 编译后 JS 不检查，这里显式拒绝直接实例化
    // （资产/代码必须用派生类 BoxMeshComponent / SphereMeshComponent /
    //  PlaneMeshComponent / CapsuleMeshComponent）
    if (new.target === MeshComponent) {
      throw new Error(
        'MeshComponent 是抽象基类，不能直接实例化——请用派生类 BoxMeshComponent / SphereMeshComponent / PlaneMeshComponent / CapsuleMeshComponent',
      )
    }
    super(owner, name)
    this.obj = this.wrap(mesh)
    // 一个 Actor 只能挂一个 mesh（组合网格请拆子 Actor）：
    // 构造时检测 owner 是否已有 MeshComponent，已有则拒绝挂树（配合
    // AObject.addComponent 的拒绝逻辑，避免 mesh 成为无组件托管的孤儿）。
    const existing = owner
      .getAllComponents()
      .find((c) => c !== this && (c.constructor.name === 'MeshComponent' || c.constructor.name.endsWith('MeshComponent')))
    if (existing) {
      this.rejected = true
      logger.error(
        `[MeshComponent] 拒绝挂载: ${owner.name} 已有 ${existing.constructor.name}("${(existing as { name?: string }).name}")，` +
        `一个 Actor 只能挂载一个 MeshComponent（组合网格请拆成子 Actor）。被拒: "${name}"`,
      )
      return
    }
    this.rejected = false
    // 从原父节点移除，挂到 owner.root 下
    this.attachToRoot(this.obj)
  }

  /** 便捷访问（语义化别名） */
  get mesh(): THREE.Mesh {
    return this.obj.object
  }

  // ─── 公共 setter（基类共享）───
  // 调用方应走两阶段：先 addComponent(类, mesh, name)，再调 setter 设参。
  // 派生类各自暴露 size/radius 等几何参数 setter（不同几何 rebuild 方式不同）。

  /** 颜色（同步 mat.color；不做动画，调用方自行过渡） */
  setColor(color: THREE.ColorRepresentation): void {
    const m = this.obj.object.material as THREE.MeshStandardMaterial | null
    if (m?.color) m.color.set(color)
  }

  /** 不透明度（自动开 transparent） */
  setOpacity(opacity: number): void {
    const m = this.obj.object.material as THREE.MeshStandardMaterial | null
    if (m) {
      m.transparent = true
      m.opacity = Math.max(0, Math.min(1, opacity))
    }
  }

  /**
   * 替换材质球（旧材质自动 dispose，新材质由调用方经 utils 创建，如 createMeshBasicMaterial）。
   * 用于组件内部默认材质不满足需求时整体替换（如不可见碰撞体的 visible:false 材质）。
   */
  setMaterial(material: THREE.Material): void {
    const old = this.obj.object.material
    if (Array.isArray(old)) old.forEach((m) => m.dispose())
    else old.dispose()
    this.obj.object.material = material
  }

  /**
   * 派生类各自实现的尺寸 setter（box.size / sphere.radius / plane.size / capsule.radius+length）。
   * 抽象方法存在仅为类型提示；TS 不会强制派生类实现（TS 4.x abstract method 不检查），
   * 派生类各自暴露同名 setter 与 getter。
   */
  // 注：基类不强制声明 abstract getter/setter——派生类签名差异太大（box 是 [w,h,d]，plane 是 [w,h]，
  // sphere 是 number），强行 abstract 反而要派生类写复杂签名。基类只提供 color/opacity/visible 三件套。

  /**
   * 基类共享的可编辑属性：color / opacity / visible。
   * 几何类型与几何尺寸由各派生类暴露（各自 getEditableProperties 合并 size/radius/length）。
   */
  override getEditableProperties(): EditableProperty[] {
    const mat = this.obj.object.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial | null
    const getColor = () => {
      if (!mat) return '#ffffff'
      const c = (mat as THREE.MeshStandardMaterial).color
      return c ? `#${c.getHexString()}` : '#ffffff'
    }
    return [
      {
        key: 'color', type: 'color',
        get: getColor,
        set: (v) => this.setColor(v as string),
      },
      {
        key: 'opacity', type: 'number', step: 0.05, min: 0, max: 1,
        get: () => {
          const m = this.obj.object.material as THREE.MeshStandardMaterial | null
          return m ? Math.round((m.opacity ?? 1) * 100) / 100 : 1
        },
        set: (v) => this.setOpacity(v as number),
      },
      {
        key: 'visible', type: 'boolean',
        get: () => this.obj.object.visible,
        set: (v) => { this.setVisible(!!v) },
      },
    ]
  }
}