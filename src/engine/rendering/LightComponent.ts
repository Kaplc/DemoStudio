/**
 * LightComponent — 灯光组件
 *
 * 把 THREE 灯光挂载到 Actor 上（仿 UE LightActor 模式），使灯光成为
 * 场景中可选中/可编辑的 Actor，而不是裸加到 scene 的对象。
 *
 * 用法：
 *   const actor = new GenericActor('KeyLight')
 *   actor.addComponent(new LightComponent(actor, {
 *     type: 'directional', color: '#ffffff', intensity: 1.2,
 *     position: [20, 30, 10], castShadow: true,
 *   }))
 *   world.SpawnActor(actor)   // 或 scene.add(actor.root)（无 World 的纯预览场景）
 *
 * 支持类型：directional / point / ambient / hemisphere / spot。
 * Inspector 可编辑：type / color / intensity / castShadow。
 */
import * as THREE from 'three'
import { Component } from '../entity/Component'
import type { Actor } from '../entity/Actor'

export type LightType = 'directional' | 'point' | 'ambient' | 'hemisphere' | 'spot'

export interface LightComponentOptions {
  type?: LightType
  color?: string | number
  intensity?: number
  distance?: number
  decay?: number
  angle?: number
  penumbra?: number
  castShadow?: boolean
  /** 灯光相对 owner 的位置（方向光/点光常用；默认 (0,0,0)） */
  position?: [number, number, number]
}

/** 创建对应类型的 THREE.Light */
function createLight(type: LightType, color: THREE.ColorRepresentation, intensity: number): THREE.Light {
  switch (type) {
    case 'point':
      return new THREE.PointLight(color, intensity)
    case 'ambient':
      return new THREE.AmbientLight(color, intensity)
    case 'hemisphere': {
      const l = new THREE.HemisphereLight(color, 0x3a3a4a, intensity)
      return l
    }
    case 'spot': {
      const l = new THREE.SpotLight(color, intensity)
      l.angle = 0.5
      l.penumbra = 0.3
      return l
    }
    case 'directional':
    default:
      return new THREE.DirectionalLight(color, intensity)
  }
}

export class LightComponent extends Component {
  readonly light: THREE.Light
  private _lightType: LightType
  private _castShadow: boolean

  constructor(owner: Actor, options: LightComponentOptions = {}, name = 'LightComponent') {
    super(owner)
    this.name = name
    this._lightType = options.type ?? 'directional'
    this._castShadow = options.castShadow ?? false
    this.light = createLight(
      this._lightType,
      (options.color ?? '#ffffff') as THREE.ColorRepresentation,
      options.intensity ?? 1,
    )
    if (options.position) this.light.position.set(options.position[0], options.position[1], options.position[2])
    if (options.distance !== undefined && this.light instanceof THREE.PointLight) {
      this.light.distance = options.distance
    }
    if (options.decay !== undefined && this.light instanceof THREE.PointLight) {
      this.light.decay = options.decay
    }
    if (options.angle !== undefined && this.light instanceof THREE.SpotLight) {
      this.light.angle = options.angle
    }
    if (options.penumbra !== undefined && this.light instanceof THREE.SpotLight) {
      this.light.penumbra = options.penumbra
    }
    this.light.castShadow = this._castShadow
    // 挂到 owner.root（从原父节点移除，与 MeshComponent 一致）
    if (this.light.parent) this.light.parent.remove(this.light)
    owner.root.add(this.light)
  }

  get lightType(): LightType { return this._lightType }
  set lightType(v: LightType) {
    if (v === this._lightType) return
    // 类型切换：重建 light（保留位置/颜色/强度）
    const pos = this.light.position.clone()
    const color = (this.light as THREE.Light).color.clone()
    const intensity = this.light.intensity
    const old = this.light
    this._lightType = v
    const next = createLight(v, color, intensity)
    next.position.copy(pos)
    next.castShadow = this._castShadow
    if (old.parent) old.parent.remove(old)
    this.owner.root.add(next)
    // 替换引用（readonly 字段通过断言更新）
    ;(this as unknown as { light: THREE.Light }).light = next
    if (old instanceof THREE.PointLight && next instanceof THREE.PointLight) {
      next.distance = old.distance
      next.decay = old.decay
    }
    old.dispose()
  }

  get color(): THREE.Color {
    return (this.light as THREE.Light).color
  }
  set color(v: THREE.ColorRepresentation) {
    (this.light as THREE.Light).color.set(v)
  }

  get intensity(): number { return this.light.intensity }
  set intensity(v: number) { this.light.intensity = v }

  get castShadow(): boolean { return this._castShadow }
  set castShadow(v: boolean) {
    this._castShadow = v
    this.light.castShadow = v
  }

  /** 灯光局部位置（相对 owner） */
  get lightPosition(): [number, number, number] {
    return [this.light.position.x, this.light.position.y, this.light.position.z]
  }
  set lightPosition(v: [number, number, number]) {
    this.light.position.set(v[0], v[1], v[2])
  }

  override EndPlay(): void {
    this.light.dispose()
    super.EndPlay()
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    return {
      Type: this._lightType,
      Color: `#${this.color.getHexString()}`,
      Intensity: Math.round(this.intensity * 100) / 100,
      'Cast Shadow': this._castShadow,
      Position: `[${this.lightPosition.map((n) => Math.round(n * 100) / 100).join(', ')}]`,
    }
  }

  /** Inspector 可编辑属性（camelCase 与 JSON 属性名一致） */
  override getEditableProperties(): ReturnType<Component['getEditableProperties']> {
    return [
      {
        key: 'type', type: 'enum',
        options: ['directional', 'point', 'ambient', 'hemisphere', 'spot'],
        get: () => this._lightType,
        set: (v) => { this.lightType = v as LightType },
      },
      {
        key: 'color', type: 'color',
        get: () => `#${this.color.getHexString()}`,
        set: (v) => { this.color = v as string },
      },
      {
        key: 'intensity', type: 'number', step: 0.1, min: 0,
        get: () => Math.round(this.intensity * 100) / 100,
        set: (v) => { this.intensity = v as number },
      },
      {
        key: 'castShadow', type: 'boolean',
        get: () => this._castShadow,
        set: (v) => { this.castShadow = !!v },
      },
    ]
  }
}
