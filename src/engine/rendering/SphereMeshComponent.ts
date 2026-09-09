/**
 * SphereMeshComponent — 球体几何网格组件
 *
 * MeshComponent 的具体派生，几何类型固定为 THREE.SphereGeometry。
 * 蓝图声明用：
 *   { "baseClass": "SphereMeshComponent", "properties": { "radius": 0.5, "color": "#ff0000" } }
 *
 * 两阶段创建：
 *   const geo = createSphereGeometry(0.5)
 *   const mat = createMeshBasicMaterial({ color: 0xff0000 })
 *   const mesh = world.factory.createMesh(geo, mat)
 *   const comp = actor.addComponent(SphereMeshComponent, mesh, 'Marker') as SphereMeshComponent
 *   comp.radius = 0.5
 *   comp.color = '#ff0000'
 */
import * as THREE from 'three'
import { MeshComponent } from './MeshComponent'
import { loadTexture } from './TextureLoader'
import { createSphereGeometry } from '../gameflow/ThreeObjectUtils'
import type { Actor } from '../entity/Actor'
import type { EditableProperty } from '../entity/ActorComponent'

export class SphereMeshComponent extends MeshComponent {
  /** 球半径 */
  private _radius: number = 0.5
  /** 球体分段 [widthSegments, heightSegments]（横向/纵向），重建几何时保留，不回退默认值 */
  private _segments: [number, number] = [16, 16]

  constructor(
    owner: Actor,
    mesh: ConstructorParameters<typeof MeshComponent>[1],
    name = 'SphereMeshComponent',
  ) {
    super(owner, mesh, name)
    // 从已挂载 mesh.geometry.parameters 推导真实半径与分段（入参可能是 ThreeObject，统一读 this.obj.object）
    const g = this.obj.object.geometry
    const p = (g as THREE.SphereGeometry).parameters
    this._radius = p.radius ?? 0.5
    this._segments = [p.widthSegments ?? 16, p.heightSegments ?? 16]
  }

  /** 半径 setter：写入后立即重建 SphereGeometry（走 factory），保留当前分段 */
  set radius(v: number) {
    this._radius = Math.max(0.01, v)
    this.rebuildSphere()
  }
  get radius(): number {
    return this._radius
  }

  /** 分段 setter（Inspector 可编辑）：[widthSegments, heightSegments]，写入后立即重建几何 */
  set segments(v: [number, number]) {
    const w = Number.isFinite(v?.[0]) ? Math.max(3, Math.floor(v[0])) : this._segments[0]
    const h = Number.isFinite(v?.[1]) ? Math.max(3, Math.floor(v[1])) : this._segments[1]
    this._segments = [w, h]
    this.rebuildSphere()
  }
  get segments(): [number, number] {
    return [this._segments[0], this._segments[1]]
  }

  private rebuildSphere(): void {
    const old = this.obj.object.geometry
    this.obj.object.geometry = createSphereGeometry(this._radius, this._segments[0], this._segments[1])
    old.dispose()
  }

  /** 设置贴图（路径走 loadTexture 缓存；传 Texture 直接用） */
  setTexture(pathOrTexture: string | THREE.Texture): void {
    const mat = this.obj.object.material as THREE.MeshStandardMaterial
    mat.map = typeof pathOrTexture === 'string' ? loadTexture(pathOrTexture) : pathOrTexture
    mat.needsUpdate = true
  }

  // ─── 地形/夜灯材质三件套（行星特写观感；仅 MeshStandardMaterial 生效）───

  /** 凹凸贴图（路径走 loadTexture 缓存；传 Texture 直接用；null 清除） */
  setBumpMap(pathOrTexture: string | THREE.Texture | null): void {
    const mat = this.obj.object.material as THREE.MeshStandardMaterial
    mat.bumpMap = pathOrTexture === null
      ? null
      : typeof pathOrTexture === 'string' ? loadTexture(pathOrTexture) : pathOrTexture
    mat.needsUpdate = true
  }

  /** 凹凸强度 */
  set bumpScale(v: number) {
    const mat = this.obj.object.material as THREE.MeshStandardMaterial
    mat.bumpScale = v
  }
  get bumpScale(): number {
    return (this.obj.object.material as THREE.MeshStandardMaterial).bumpScale ?? 0
  }

  /** 粗糙度贴图（水面高光分区等；null 清除） */
  setRoughnessMap(pathOrTexture: string | THREE.Texture | null): void {
    const mat = this.obj.object.material as THREE.MeshStandardMaterial
    mat.roughnessMap = pathOrTexture === null
      ? null
      : typeof pathOrTexture === 'string' ? loadTexture(pathOrTexture) : pathOrTexture
    mat.needsUpdate = true
  }

  /** 自发光贴图（夜面城市灯光等；null 清除） */
  setEmissiveMap(pathOrTexture: string | THREE.Texture | null): void {
    const mat = this.obj.object.material as THREE.MeshStandardMaterial
    mat.emissiveMap = pathOrTexture === null
      ? null
      : typeof pathOrTexture === 'string' ? loadTexture(pathOrTexture) : pathOrTexture
    mat.needsUpdate = true
  }

  /** 自发光颜色（#000 = 不发光；emissiveMap 存在时作贴图乘色） */
  set emissive(v: string) {
    const mat = this.obj.object.material as THREE.MeshStandardMaterial
    mat.emissive.set(v)
  }
  get emissive(): string {
    return `#${(this.obj.object.material as THREE.MeshStandardMaterial).emissive.getHexString()}`
  }

  /** 自发光强度 */
  set emissiveIntensity(v: number) {
    const mat = this.obj.object.material as THREE.MeshStandardMaterial
    mat.emissiveIntensity = v
  }
  get emissiveIntensity(): number {
    return (this.obj.object.material as THREE.MeshStandardMaterial).emissiveIntensity ?? 1
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    const mat = this.obj.object.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial | null
    return {
      radius: Math.round(this._radius * 100) / 100,
      segments: [this._segments[0], this._segments[1]],
      color: mat?.color ? `#${mat.color.getHexString()}` : '#ffffff',
      opacity: mat ? Math.round((mat.opacity ?? 1) * 100) / 100 : 1,
      texture: (mat as THREE.MeshStandardMaterial | null)?.map ? '已设置' : '（无）',
      visible: this.obj.object.visible,
    }
  }

  /** Sphere 可编辑属性：radius + segments + 继承基类的 color/opacity/visible */
  override getEditableProperties(): EditableProperty[] {
    return [
      {
        key: 'radius', type: 'number', step: 0.05, min: 0,
        get: () => Math.round(this._radius * 100) / 100,
        set: (v) => { this.radius = v as number },
      },
      {
        key: 'segments', type: 'vec2', min: 3, step: 1,
        get: () => [this._segments[0], this._segments[1]],
        set: (v) => { this.segments = v as [number, number] },
      },
      ...super.getEditableProperties(),
    ]
  }
}
