/**
 * SpriteComponent — 2D 精灵组件
 * 在 Actor 上挂一个位于 XY 平面、法线 +Z 的平面（PlaneGeometry），
 * 面向 -Z 方向的正交相机。支持纯色或纹理贴图。
 *
 * 所有实例共享一个单位 PlaneGeometry(1,1)，通过 mesh.scale 实现尺寸变化，
 * 避免大量重复几何体创建/销毁的 GC 开销。
 * 资源释放由 ThreeObjectComponent 基类统一负责（共享 geometry 跳过 dispose）。
 */
import * as THREE from 'three'
import { ThreeObject } from './ThreeObject'
import { ThreeObjectComponent } from './ThreeObjectComponent'
import type { Actor } from '../entity/Actor'
import { loadTexture } from './TextureLoader'

export class SpriteComponent extends ThreeObjectComponent<ThreeObject<THREE.Mesh>> {
  /** 所有 SpriteComponent 共享的单位平面几何体 */
  private static sharedGeo: THREE.PlaneGeometry | null = null

  private static getSharedGeo(): THREE.PlaneGeometry {
    if (!SpriteComponent.sharedGeo) {
      SpriteComponent.sharedGeo = new THREE.PlaneGeometry(1, 1)
    }
    return SpriteComponent.sharedGeo
  }

  /** 实际渲染对象，加到 owner.root */
  public readonly obj: ThreeObject<THREE.Mesh>
  private material: THREE.MeshBasicMaterial
  /** 逻辑宽高（用于 scale 换算） */
  private _width = 1
  private _height = 1

  constructor(owner: Actor, width = 1, height = 1, name = 'SpriteComponent') {
    super(owner, name)
    this._width = width
    this._height = height
    this.material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true })
    // 共享 geometry 不释放（disposeGeometry=false），材质由 ThreeObject.dispose 释放
    this.obj = new ThreeObject(new THREE.Mesh(SpriteComponent.getSharedGeo(), this.material), { disposeGeometry: false })
    this.obj.object.scale.set(width, height, 1)
    // 构造时即挂到 root，保证池对象在 activate 时网格已就位
    this.attachToRoot(this.obj)
  }

  /** 便捷访问（语义化别名） */
  get mesh(): THREE.Mesh {
    return this.obj.object
  }

  /** 便捷访问：底层 THREE 对象 */
  get object(): THREE.Mesh {
    return this.obj.object
  }

  // BeginPlay 不再需要挂网格 —— 构造时已完成

  /** 修改尺寸（不再重建几何体，只改 scale） */
  setSize(width: number, height: number) {
    this._width = width
    this._height = height
    this.object.scale.set(width, height, 1)
  }

  /** 设置纯色（与纹理互斥：有贴图时设为白色基底避免染色） */
  setColor(hex: THREE.ColorRepresentation) {
    this.material.color.set(hex)
  }

  /** 设置不透明度（<1 自动开启 transparent） */
  setOpacity(opacity: number) {
    this.material.opacity = opacity
    this.material.transparent = opacity < 1
  }

  /** 设置纹理：可传路径（走缓存）或已加载的 Texture */
  setTexture(pathOrTexture: string | THREE.Texture) {
    const tex = typeof pathOrTexture === 'string' ? loadTexture(pathOrTexture) : pathOrTexture
    this.material.map = tex
    this.material.color.set(0xffffff)
    this.material.needsUpdate = true
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    const size = this.getSize()
    return {
      Size: `${round2(size[0])}×${round2(size[1])}`,
      Color: `#${this.material.color.getHexString()}`,
      Opacity: round2(this.material.opacity),
      Texture: this.material.map ? '有' : '（无）',
    }
  }

  /** 获取网格宽高 */
  getSize(): [number, number] {
    return [this._width, this._height]
  }
}

/** 保留 2 位小数 */
function round2(v: number): number {
  return Math.round(v * 100) / 100
}
