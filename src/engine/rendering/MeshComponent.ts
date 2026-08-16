/**
 * MeshComponent — 网格渲染组件（抽象基类，不允许直接挂载）
 *
 * 持有一个 ThreeObject<THREE.Mesh>，挂到 owner.root 下参与 Actor 生命周期。
 * EndPlay 时自动释放（由 ThreeObject.dispose 统一负责）。
 *
 * 本类是基类：资产（blueprint/scene JSON）不得声明 baseClass: 'MeshComponent'
 * （assetLint 报错 + ComponentRegistry 未注册），必须用具体派生类：
 *   - PrimitiveMeshComponent — 基础几何（box/sphere/plane 参数化，资产通用网格）
 *   - CapsuleMeshComponent — 胶囊体（兵种等角色模型）
 *
 * 代码用法（THREE 对象必须经 Game 工厂创建，禁止裸 new）：
 *   const actor = new GenericActor('Cube')
 *   const mesh = game.createMesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial())
 *   actor.addComponent(new PrimitiveMeshComponent(actor, mesh))
 *   world.SpawnActor(actor)
 *
 * 一个 Actor 只能挂载一个 mesh（组合网格请拆子 Actor，如 new GenericActor + attachTo）。
 */
import * as THREE from 'three'
import { ThreeObjectComponent } from './ThreeObjectComponent'
import { ThreeObject } from './ThreeObject'
import type { Actor } from '../entity/Actor'
import type { EditableProperty } from '../entity/ActorComponent'
import { logger } from '../Logger'

export abstract class MeshComponent extends ThreeObjectComponent<ThreeObject<THREE.Mesh>> {
  public readonly obj: ThreeObject<THREE.Mesh>

  /** 几何类型（可编辑属性重建用；由构造时的 geometry 推导） */
  private _geometryType: 'box' | 'sphere' | 'plane' = 'box'
  /** 几何尺寸（可编辑属性重建用；box=[w,h,d] / sphere=[r,0,0] / plane=[w,h,0]） */
  private _geoSize: [number, number, number] = [1, 1, 1]
  /** 挂载是否被拒（owner 已有 MeshComponent 时 true，mesh 不挂树、组件无效） */
  readonly rejected: boolean

  constructor(owner: Actor, mesh: ThreeObject<THREE.Mesh> | THREE.Mesh, name = 'MeshComponent') {
    // 抽象基类运行时保护：TS abstract 编译后 JS 不检查，这里显式拒绝直接实例化
    // （资产/代码必须用派生类 PrimitiveMeshComponent / CapsuleMeshComponent）
    if (new.target === MeshComponent) {
      throw new Error(
        'MeshComponent 是抽象基类，不能直接实例化——请用派生类 PrimitiveMeshComponent（基础几何）或 CapsuleMeshComponent（胶囊体）',
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

    // 从 geometry 推导几何类型与尺寸（供可编辑属性 setter 重建）
    const g = this.obj.object.geometry
    if (g instanceof THREE.SphereGeometry) {
      this._geometryType = 'sphere'
      this._geoSize = [g.parameters.radius, 0, 0]
    } else if (g instanceof THREE.PlaneGeometry) {
      this._geometryType = 'plane'
      this._geoSize = [g.parameters.width, g.parameters.height, 0]
    } else {
      this._geometryType = 'box'
      const p = (g as THREE.BoxGeometry).parameters
      this._geoSize = [p.width ?? 1, p.height ?? 1, p.depth ?? 1]
    }
  }

  /** 重建几何（可编辑属性 setter：尺寸/几何类型变化时调用，dispose 旧几何） */
  private rebuildGeometry(): void {
    const old = this.obj.object.geometry
    let geo: THREE.BufferGeometry
    const s = this._geoSize
    switch (this._geometryType) {
      case 'sphere':
        geo = new THREE.SphereGeometry(s[0] || 0.5, 16, 16)
        break
      case 'plane':
        geo = new THREE.PlaneGeometry(s[0] || 1, s[1] || 1)
        break
      default:
        geo = new THREE.BoxGeometry(s[0] || 1, s[1] || 1, s[2] || 1)
    }
    this.obj.object.geometry = geo
    old.dispose()
  }

  /** 便捷访问（语义化别名） */
  get mesh(): THREE.Mesh {
    return this.obj.object
  }

  /**
   * Inspector 属性展示。
   * key 必须与 getEditableProperties() 的 key 完全一致（camelCase），
   * Inspector 组件区按 key 匹配 editable → 渲染可编辑控件；不匹配则只读展示。
   */
  override getProperties(): Record<string, unknown> {
    const mat = this.obj.object.material as THREE.MeshStandardMaterial | null
    return {
      geometry: this._geometryType,
      size: [...this._geoSize] as number[],
      color: mat?.color ? `#${mat.color.getHexString()}` : '#ffffff',
      opacity: mat ? Math.round((mat.opacity ?? 1) * 100) / 100 : 1,
      visible: this.obj.object.visible,
    }
  }

  /**
   * Inspector 可编辑属性（camelCase 与 JSON 属性名一致）：
   * geometry 几何类型 / size 尺寸 / color 颜色 / opacity 不透明度 / visible 可见性。
   * 一个 Actor 一个 MeshComponent 的约定下，这些属性精确对应"本 actor 的几何"，
   * 修改后经场景预览撤回系统（commitPropertyEdit）进撤销栈，undo 原地回滚。
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
        key: 'geometry', type: 'enum',
        options: ['box', 'sphere', 'plane'],
        get: () => this._geometryType,
        set: (v) => {
          const t = v as 'box' | 'sphere' | 'plane'
          if (t === this._geometryType) return
          this._geometryType = t
          this.rebuildGeometry()
        },
      },
      {
        key: 'size', type: 'vec3', step: 0.1,
        get: () => [...this._geoSize] as number[],
        set: (v) => {
          const arr = v as number[]
          this._geoSize = [arr[0] ?? 1, arr[1] ?? 1, arr[2] ?? 1]
          this.rebuildGeometry()
        },
      },
      {
        key: 'color', type: 'color',
        get: getColor,
        set: (v) => {
          const m = this.obj.object.material as THREE.MeshStandardMaterial | null
          if (m?.color) m.color.set(v as string)
        },
      },
      {
        key: 'opacity', type: 'number', step: 0.05, min: 0, max: 1,
        get: () => {
          const m = this.obj.object.material as THREE.MeshStandardMaterial | null
          return m ? Math.round((m.opacity ?? 1) * 100) / 100 : 1
        },
        set: (v) => {
          const m = this.obj.object.material as THREE.MeshStandardMaterial | null
          if (m) {
            m.transparent = true
            m.opacity = Math.max(0, Math.min(1, v as number))
          }
        },
      },
      {
        key: 'visible', type: 'boolean',
        get: () => this.obj.object.visible,
        set: (v) => { this.setVisible(!!v) },
      },
    ]
  }
}
