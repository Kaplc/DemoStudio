/**
 * ShadowBlobComponent — Blob 假阴影组件（贴地半透明椭圆暗斑）
 *
 * 挂在单位/建筑 Actor 上，脚下生成一块程序化径向渐变的半透明椭圆 mesh，
 * 随 Actor 移动（挂 owner.root 子节点，零每帧代码）。服务三类真阴影覆盖
 * 不了的场景（doc-dev/scene-shadow/plan.md D3）：
 *   - unlit 材质场景（MeshBasicMaterial 不接收 shadow map）
 *   - 性能敏感的单位群（每 blob 1 draw call，无 depth pass）
 *   - 卡通风格控制的风格化阴影
 *
 * 贴地法线（双朝向场景约定，防"blob 立起来了"误用）：
 *   - XZ 地面（ClashMaster/fish 战斗，Y 向上）→ 缺省 `normal: [0, 1, 0]`
 *   - XY 世界（FishMenu，Z 为深度）→ `normal: [0, 0, 1]`
 *
 * 资源模型（与 SpriteComponent 同惯例）：
 *   - 共享单例：256² 程序化径向渐变贴图（2D canvas，jsdom 等无 2D 上下文环境自动
 *     降级等价 DataTexture）+ PlaneGeometry(1,1)，全实例复用不释放；
 *   - per-instance：MeshBasicMaterial clone（透明贴图共享、opacity 独立），
 *     EndPlay 只 dispose 材质 clone，共享贴图/几何存活。
 *
 * 排序与 z-fight（TC-S8）：
 *   - `transparent + depthWrite:false`：不写深度，不会遮挡后续透明体；
 *   - renderOrder = 1（高于地面默认 0）：保证绘制在地面之上；
 *   - offset 沿法线抬升 0.02（缺省）：与地面错开深度。
 */
import * as THREE from 'three'
import { ThreeObjectComponent } from './ThreeObjectComponent'
import { ThreeObject } from './ThreeObject'
import type { Actor } from '../entity/Actor'
import type { EditableProperty } from '../entity/ActorComponent'

export interface ShadowBlobComponentOptions {
  /** 贴地法线（局部空间）：[0,1,0]=XZ 地面（缺省），[0,0,1]=XY 世界 */
  normal?: [number, number, number]
  /** 沿法线抬升量（防与地面 z-fighting），缺省 0.02 */
  offset?: number
  /** 暗斑半径（世界单位），缺省 1 */
  radius?: number
  /** 暗斑不透明度 [0,1]，缺省 0.35 */
  opacity?: number
}

/** 模块级懒加载单例：程序化径向渐变贴图（中心黑 α0.5 → 边缘全透明） */
let sharedTexture: THREE.Texture | null = null

/**
 * 生成径向渐变贴图：优先 2D canvas（浏览器路径），jsdom/无 2D 上下文环境
 * （单测、极简容器）降级为等价 DataTexture——两者视觉一致（中心 α0.5 → 边缘 0）。
 * 贴图零资产依赖：不读任何文件，全程序化生成。
 */
function getSharedTexture(): THREE.Texture {
  if (!sharedTexture) {
    const size = 256
    let texture: THREE.Texture | null = null
    // 路径 1：2D canvas 径向渐变（浏览器）
    try {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (ctx) {
        const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
        grad.addColorStop(0, 'rgba(0,0,0,0.5)')
        grad.addColorStop(0.55, 'rgba(0,0,0,0.32)')
        grad.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, size, size)
        texture = new THREE.CanvasTexture(canvas)
      }
    } catch {
      /* fallthrough 到 DataTexture */
    }
    // 路径 2：DataTexture 等价兜底（α 沿半径线性衰减，255→0；中段 0.55 处 ≈163 与 canvas 版对齐）
    if (!texture) {
      const data = new Uint8Array(size * size * 4)
      const rMax = size / 2
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = x - rMax + 0.5
          const dy = y - rMax + 0.5
          const d = Math.min(1, Math.hypot(dx, dy) / rMax)
          const a = d <= 0.55 ? 0.5 - (0.18 / 0.55) * d : 0.32 * (1 - (d - 0.55) / 0.45)
          const i = (y * size + x) * 4
          data[i] = 0
          data[i + 1] = 0
          data[i + 2] = 0
          data[i + 3] = Math.round(THREE.MathUtils.clamp(a, 0, 1) * 255)
        }
      }
      const tex = new THREE.DataTexture(data, size, size)
      tex.needsUpdate = true
      texture = tex
    }
    sharedTexture = texture
  }
  return sharedTexture
}

/** 模块级懒加载单例：单位平面几何（scale 变半径） */
let sharedGeo: THREE.PlaneGeometry | null = null

function getSharedGeo(): THREE.PlaneGeometry {
  if (!sharedGeo) sharedGeo = new THREE.PlaneGeometry(1, 1)
  return sharedGeo
}

export class ShadowBlobComponent extends ThreeObjectComponent<ThreeObject<THREE.Mesh>> {
  public readonly obj: ThreeObject<THREE.Mesh>

  private _radius: number
  private _opacity: number
  private _normal: [number, number, number]
  private _offset: number
  /** per-instance 材质 clone（EndPlay 只释放它；贴图/几何共享） */
  private material: THREE.MeshBasicMaterial

  constructor(owner: Actor, options: ShadowBlobComponentOptions = {}, name = 'ShadowBlobComponent') {
    super(owner, name)
    this._radius = options.radius ?? 1
    this._opacity = options.opacity ?? 0.35
    this._normal = options.normal ?? [0, 1, 0]
    this._offset = options.offset ?? 0.02

    // per-instance 材质（map 共享、opacity 独立）；共享 geometry（disposeGeometry=false）
    this.material = new THREE.MeshBasicMaterial({
      map: getSharedTexture(),
      transparent: true,
      depthWrite: false,
      opacity: this._opacity,
    })
    this.obj = new ThreeObject(new THREE.Mesh(ShadowBlobComponent_getSharedGeo(), this.material), {
      disposeGeometry: false,
    })

    const mesh = this.obj.object
    mesh.scale.set(this._radius, this._radius, 1)
    mesh.renderOrder = 1
    this.applyGrounding()
    // 构造时即挂到 root（与 SpriteComponent 一致：池对象 activate 时网格已就位）
    this.attachToRoot(this.obj)
  }

  /** 应用贴地姿态：按 normal 旋转 + 沿法线抬升 offset */
  private applyGrounding(): void {
    const mesh = this.obj.object
    const [nx, ny, nz] = this._normal
    const len = Math.hypot(nx, ny, nz) || 1
    // PlaneGeometry 原生法线 +Z → 旋转到目标法线（四元数 setFromUnitVectors 处理任意轴向）
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(nx / len, ny / len, nz / len),
    )
    mesh.quaternion.copy(q)
    mesh.position.set(
      (nx / len) * this._offset,
      (ny / len) * this._offset,
      (nz / len) * this._offset,
    )
  }

  /** 便捷访问：blob mesh */
  get mesh(): THREE.Mesh {
    return this.obj.object
  }

  /** 暗斑半径（世界单位） */
  get radius(): number { return this._radius }
  set radius(v: number) {
    if (v <= 0) return
    this._radius = v
    this.obj.object.scale.set(v, v, 1)
  }

  /** 暗斑不透明度 [0,1]（<1 自动透明） */
  get opacity(): number { return this._opacity }
  set opacity(v: number) {
    this._opacity = THREE.MathUtils.clamp(v, 0, 1)
    this.material.opacity = this._opacity
    this.material.transparent = this._opacity < 1
  }

  /** 贴地法线（局部空间）：改后立即重算贴地姿态 */
  get normal(): [number, number, number] { return [...this._normal] }
  set normal(v: [number, number, number]) {
    this._normal = [v[0] ?? 0, v[1] ?? 1, v[2] ?? 0]
    this.applyGrounding()
  }

  /** 沿法线抬升量：改后立即重算贴地姿态 */
  get offset(): number { return this._offset }
  set offset(v: number) {
    this._offset = v
    this.applyGrounding()
  }

  override EndPlay(): void {
    // 只 dispose per-instance 材质 clone（内含对共享贴图的引用——MeshBasicMaterial.dispose
    // 不释放 map 本身，贴图由模块单例持有，生命周期与进程一致）
    this.material.dispose()
    super.EndPlay()
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    return {
      Radius: Math.round(this._radius * 100) / 100,
      Opacity: Math.round(this._opacity * 100) / 100,
      Normal: `[${this._normal.map((n) => Math.round(n * 100) / 100).join(', ')}]`,
      Offset: Math.round(this._offset * 100) / 100,
    }
  }

  /** Inspector 可编辑属性（camelCase 与 JSON 属性名一致） */
  override getEditableProperties(): EditableProperty[] {
    return [
      {
        key: 'radius', type: 'number', step: 0.1, min: 0,
        get: () => this._radius,
        set: (v) => { this.radius = v as number },
      },
      {
        key: 'opacity', type: 'number', step: 0.05, min: 0, max: 1,
        get: () => this._opacity,
        set: (v) => { this.opacity = v as number },
      },
      {
        key: 'normal', type: 'vec3', step: 0.1,
        get: () => [...this._normal],
        set: (v) => { this.normal = v as [number, number, number] },
      },
      {
        key: 'offset', type: 'number', step: 0.01, min: 0,
        get: () => this._offset,
        set: (v) => { this.offset = v as number },
      },
    ]
  }
}

/** 模块级共享几何取值别名（避免类体内引用未初始化的模块变量） */
function ShadowBlobComponent_getSharedGeo(): THREE.PlaneGeometry {
  return getSharedGeo()
}
