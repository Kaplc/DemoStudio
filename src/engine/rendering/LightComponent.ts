/**
 * LightComponent — 灯光组件
 *
 * 把 THREE 灯光挂载到 Actor 上（仿 UE LightActor 模式），使灯光成为
 * 场景中可选中/可编辑的 Actor，而不是裸加到 scene 的对象。
 *
 * 用法：
 *   const actor = new GenericActor('KeyLight')
 *   actor.addComponent(LightComponent, {
 *     type: 'directional', color: '#ffffff', intensity: 1.2,
 *     position: [20, 30, 10], castShadow: true,
 *     shadowExtent: 40, shadowMapSize: 2048,      // 阴影参数（见下）
 *   })
 *   spawnActor(actor)   // 或 scene.add(actor.root)（无 World 的纯预览场景）
 *
 * 支持类型：directional / point / ambient / hemisphere / spot。
 * Inspector 可编辑：type / color / intensity / castShadow / shadow* 五参数。
 *
 * 阴影参数（scene-shadow 方案，doc-dev/scene-shadow/plan.md D2）：
 *   - shadowExtent：DirectionalLight 的 shadow.camera 正交四边 = ±extent。
 *     three r170 默认 ±5，fish 48×48 地图会被截断到原点一小块——必须显式放宽。
 *     （SpotLight 的 shadow camera 是透视投影，无正交四边，此参数对 spot 无效。）
 *   - shadowMapSize：贴图边长。须在首帧渲染前设置；运行中修改会 dispose 旧
 *     shadow.map（下一帧由 WebGLShadowMap 重建生效），避免"改了没反应"。
 *   - shadowBias / shadowNormalBias / shadowRadius：防痤疮/漏光/软硬度的基本旋钮。
 *   - 以上缺省均为"不改"（保持 three 默认），零破坏。
 *   - ambient/hemisphere 无 shadow（three 语义），所有 shadow 参数对其为 no-op。
 *
 * light.target 显式化：three 的 DirectionalLight/SpotLight.target 默认是不在场景树
 * 上的 Object3D（matrixWorld 恒单位阵）——灯光照向世界原点只是"碰巧能工作"。这里
 * 显式创建 target 并挂到 owner.root（跟随 Actor 移动，语义 = 灯光照向自身锚点
 * 方向），EndPlay 一并移除。
 */
import * as THREE from 'three'
import { Component } from '../entity/Component'
import type { Actor } from '../entity/Actor'
import { logger } from '../Logger'

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
  /** 阴影正交范围（directional 专用）：shadow.camera 四边 = ±extent；缺省 0 = 不改（three 默认 ±5） */
  shadowExtent?: number
  /** 阴影贴图边长（512/1024/2048），缺省不改（three 默认 512）；运行中修改会 dispose 旧 map 下一帧生效 */
  shadowMapSize?: number
  /** 阴影深度偏移（防阴影痤疮），缺省不改。透传 light.shadow.bias */
  shadowBias?: number
  /** 法线偏移（防漏光/彼得平移），缺省不改。透传 light.shadow.normalBias */
  shadowNormalBias?: number
  /** PCF 阴影边缘柔化半径，缺省不改。透传 light.shadow.radius */
  shadowRadius?: number
  /** 灯光相对 owner 的位置（方向光/点光常用；默认 (0,0,0)） */
  position?: [number, number, number]
  /** target 相对 owner 的局部偏移（directional/spot 有效；缺省 [0,0,0] 不改）。
   *  「actor 定位」模式（owner 在灯位、light 局部原点）必须设为灯位负值，
   *  否则 target 世界位置 = owner 世界位置，光照方向仅剩 three 默认的竖直向下。 */
  targetPosition?: [number, number, number]
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

export class LightComponent extends Component<Actor> {
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

    // ─── 阴影参数（scene-shadow 方案 D2；ambient/hemisphere 无 shadow，自动跳过）───
    const shadow = this.light.shadow
    if (shadow) {
      // shadowExtent：directional 正交 shadow camera 四边 = ±extent（缺省 0 不改）
      if (options.shadowExtent && options.shadowExtent > 0 && this._lightType === 'directional') {
        this.applyShadowExtent(shadow as THREE.DirectionalLightShadow, options.shadowExtent)
      }
      // shadowMapSize：须在首帧渲染前设置（构造期必然满足）
      if (options.shadowMapSize && options.shadowMapSize > 0) {
        shadow.mapSize.set(options.shadowMapSize, options.shadowMapSize)
      }
      // bias / normalBias / radius：缺省不改
      if (options.shadowBias !== undefined) shadow.bias = options.shadowBias
      if (options.shadowNormalBias !== undefined) shadow.normalBias = options.shadowNormalBias
      if (options.shadowRadius !== undefined) shadow.radius = options.shadowRadius
    }

    // ─── light.target 显式化（scene-shadow 方案 §2.3 隐坑规整）───
    // three 的 target 默认不在场景树上（matrixWorld 恒单位阵 → 永远照向世界原点）。
    // 显式挂到 owner.root：跟随 Actor 移动，语义 = 灯光照向自身锚点方向。
    // target 局部偏移（targetPosition）：缺省 (0,0,0) 不改，兼容既有场景。
    // 「actor 定位」模式（owner 在灯位、light 局部原点）必须设为灯位负值，
    // 否则 target 世界位置 = owner 世界位置，光照方向只剩 three 默认的竖直向下。
    const withTarget = this.asTargetLight()
    if (withTarget) {
      const tp = options.targetPosition ?? [0, 0, 0]
      withTarget.target.position.set(tp[0], tp[1], tp[2])
      owner.root.add(withTarget.target)
    }

    // 挂到 owner.root（从原父节点移除，与 MeshComponent 一致）
    if (this.light.parent) this.light.parent.remove(this.light)
    owner.root.add(this.light)
    logger.info(`[LightComponent] "${name}" type=${this._lightType} castShadow=${this._castShadow}` +
      `${options.shadowExtent ? ` shadowExtent=${options.shadowExtent}` : ''}` +
      `${options.shadowMapSize ? ` shadowMapSize=${options.shadowMapSize}` : ''}` +
      `${options.targetPosition ? ` targetPosition=[${options.targetPosition.join(',')}]` : ''} 挂载到 "${owner.name}"`)
  }

  /** 当前灯型有 target（directional/spot）→ 返回具体灯型实例，否则 null */
  private asTargetLight(): THREE.DirectionalLight | THREE.SpotLight | null {
    if (this._lightType === 'directional') return this.light as THREE.DirectionalLight
    if (this._lightType === 'spot') return this.light as THREE.SpotLight
    return null
  }

  /** 应用阴影正交范围（DirectionalLight 专用正交 shadow camera） */
  private applyShadowExtent(shadow: THREE.DirectionalLightShadow, extent: number): void {
    const cam = shadow.camera
    cam.left = -extent
    cam.right = extent
    cam.top = extent
    cam.bottom = -extent
    cam.updateProjectionMatrix()
  }

  /** 阴影正交范围（directional 有效；未设置时返回 0 = three 默认 ±5；其它灯型 0） */
  get shadowExtent(): number {
    if (this._lightType !== 'directional') return 0
    const s = this.light.shadow as THREE.DirectionalLightShadow | undefined
    return s ? s.camera.right : 0
  }
  set shadowExtent(v: number) {
    if (v <= 0 || this._lightType !== 'directional') return
    const s = this.light.shadow as THREE.DirectionalLightShadow | undefined
    if (s) this.applyShadowExtent(s, v)
  }

  /** 阴影贴图边长（无 shadow 灯型返回 0）。运行中修改会 dispose 旧 shadow.map（下一帧重建生效） */
  get shadowMapSize(): number {
    return this.light.shadow?.mapSize.x ?? 0
  }
  set shadowMapSize(v: number) {
    const s = this.light.shadow
    if (!s || v <= 0 || v === s.mapSize.x) return
    s.mapSize.set(v, v)
    // 运行中改 mapSize 必须释放旧贴图，否则 WebGLShadowMap 复用旧尺寸 RT → "改了没反应"
    if (s.map) {
      s.map.dispose()
      s.map = null
      logger.info(`[LightComponent] "${this.name}" shadowMapSize → ${v}，旧 shadow.map 已 dispose（下一帧重建）`)
    }
  }

  /** 阴影深度偏移（防阴影痤疮） */
  get shadowBias(): number { return this.light.shadow?.bias ?? 0 }
  set shadowBias(v: number) {
    if (this.light.shadow) this.light.shadow.bias = v
  }

  /** 法线偏移（防漏光/彼得平移） */
  get shadowNormalBias(): number { return this.light.shadow?.normalBias ?? 0 }
  set shadowNormalBias(v: number) {
    if (this.light.shadow) this.light.shadow.normalBias = v
  }

  /** PCF 阴影边缘柔化半径 */
  get shadowRadius(): number { return this.light.shadow?.radius ?? 0 }
  set shadowRadius(v: number) {
    if (this.light.shadow) this.light.shadow.radius = v
  }

  get lightType(): LightType { return this._lightType }
  set lightType(v: LightType) {
    if (v === this._lightType) return
    // 类型切换：重建 light（保留位置/颜色/强度/阴影参数/target 挂载）
    const pos = this.light.position.clone()
    const color = (this.light as THREE.Light).color.clone()
    const intensity = this.light.intensity
    const old = this.light
    this._lightType = v
    const next = createLight(v, color, intensity)
    next.position.copy(pos)
    next.castShadow = this._castShadow
    // 阴影参数迁移（新 light 是全新的 shadow 对象；两侧都可能无 shadow）
    const oldShadow = old.shadow
    const nextShadow = next.shadow
    if (oldShadow && nextShadow) {
      nextShadow.mapSize.copy(oldShadow.mapSize)
      nextShadow.bias = oldShadow.bias
      nextShadow.normalBias = oldShadow.normalBias
      nextShadow.radius = oldShadow.radius
    }
    // 正交范围迁移（仅 directional → directional）
    const oldDirShadow = old.shadow as THREE.DirectionalLightShadow | undefined
    const nextDirShadow = next.shadow as THREE.DirectionalLightShadow | undefined
    if (
      old instanceof THREE.DirectionalLight && next instanceof THREE.DirectionalLight &&
      oldDirShadow && nextDirShadow && oldDirShadow.camera.right !== 5
    ) {
      const oc = oldDirShadow.camera
      const nc = nextDirShadow.camera
      nc.left = oc.left
      nc.right = oc.right
      nc.top = oc.top
      nc.bottom = oc.bottom
      nc.updateProjectionMatrix()
    }
    // target 重挂（target 是 directional/spot 的字段，新 light 有自己的 target）
    const oldTargetLight = old instanceof THREE.DirectionalLight || old instanceof THREE.SpotLight ? old : null
    const nextTargetLight = next instanceof THREE.DirectionalLight || next instanceof THREE.SpotLight ? next : null
    if (nextTargetLight) {
      if (oldTargetLight && oldTargetLight.target.parent) oldTargetLight.target.parent.remove(oldTargetLight.target)
      // 保留 targetPosition（旧 target 局部位置拷贝到新 target；无旧灯时回到 (0,0,0) 缺省）
      if (oldTargetLight) nextTargetLight.target.position.copy(oldTargetLight.target.position)
      else nextTargetLight.target.position.set(0, 0, 0)
      this.owner.root.add(nextTargetLight.target)
    } else if (oldTargetLight && oldTargetLight.target.parent) {
      // 新灯型无 target（point/ambient/hemisphere）：旧 target 从树移除
      oldTargetLight.target.parent.remove(oldTargetLight.target)
    }
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

  /** target 局部偏移（相对 owner，directional/spot 有效；其它灯型恒 [0,0,0]） */
  get targetPosition(): [number, number, number] {
    const t = this.asTargetLight()
    if (!t) return [0, 0, 0]
    return [t.target.position.x, t.target.position.y, t.target.position.z]
  }
  set targetPosition(v: [number, number, number]) {
    const t = this.asTargetLight()
    if (!t) return
    t.target.position.set(v[0], v[1], v[2])
  }

  override EndPlay(): void {
    // target 显式挂树（构造时 add），销毁时一并移除
    const t = this.asTargetLight()
    if (t && t.target.parent) t.target.parent.remove(t.target)
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
      'Shadow Extent': this.shadowExtent || '默认(±5)',
      'Shadow MapSize': this.shadowMapSize || '默认(512)',
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
      {
        key: 'shadowExtent', type: 'number', step: 5, min: 0,
        get: () => this.shadowExtent,
        set: (v) => { this.shadowExtent = v as number },
      },
      {
        key: 'shadowMapSize', type: 'number', step: 512, min: 0,
        get: () => this.shadowMapSize,
        set: (v) => { this.shadowMapSize = v as number },
      },
      {
        key: 'targetPosition', type: 'vec3', step: 0.5,
        get: () => this.targetPosition,
        set: (v) => { this.targetPosition = v as [number, number, number] },
      },
      {
        key: 'shadowBias', type: 'number', step: 0.0001,
        get: () => this.shadowBias,
        set: (v) => { this.shadowBias = v as number },
      },
      {
        key: 'shadowNormalBias', type: 'number', step: 0.005, min: 0,
        get: () => this.shadowNormalBias,
        set: (v) => { this.shadowNormalBias = v as number },
      },
      {
        key: 'shadowRadius', type: 'number', step: 0.5, min: 0,
        get: () => this.shadowRadius,
        set: (v) => { this.shadowRadius = v as number },
      },
    ]
  }
}
